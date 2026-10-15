param([Parameter(Mandatory)][string]$PidFile,[Parameter(Mandatory)][string]$OutputFile)
# Only PIDs reported by this test's dedicated Chromium CDP connection are sampled.
$writer=[IO.StreamWriter]::new($OutputFile,$false)
try {
 while(Test-Path -LiteralPath $PidFile){
  try {
   $identifiers=@(Get-Content -Raw -LiteralPath $PidFile | ConvertFrom-Json)
   $processes=@(Get-Process -Id $identifiers -ErrorAction SilentlyContinue)
   $sample=[ordered]@{timestamp=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();privateBytes=($processes | Measure-Object PrivateMemorySize64 -Sum).Sum;workingSetBytes=($processes | Measure-Object WorkingSet64 -Sum).Sum;processCount=$processes.Count}
   $writer.WriteLine(($sample | ConvertTo-Json -Compress));$writer.Flush()
  }catch { }
  Start-Sleep -Milliseconds 100
 }
}finally{$writer.Dispose()}
