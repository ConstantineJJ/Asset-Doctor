use std::{fs::{self, OpenOptions}, io::Write, path::Path, sync::Mutex};
use tauri::Manager;

const LIMIT:u64=2*1024*1024;
#[derive(Default)]
pub struct DebugLog(pub Mutex<()>);
fn names()->[&'static str;3]{["asset-doctor-system.2.jsonl","asset-doctor-system.1.jsonl","asset-doctor-system.jsonl"]}
fn remove_if_present(path:&Path)->Result<(),String>{match fs::remove_file(path){Ok(())=>Ok(()),Err(error) if error.kind()==std::io::ErrorKind::NotFound=>Ok(()),Err(error)=>Err(error.to_string())}}
fn append(directory:&Path,batch:&[String],limit:u64)->Result<(),String>{
 if batch.is_empty(){return Ok(());}
 let mut normalized=Vec::with_capacity(batch.len());
 if batch.len()>8||batch.iter().map(|line|line.len()+1).sum::<usize>()>128*1024{return Err("Log batch too large".into());}
 for line in batch{
  if line.len()+1>16384{return Err("Log entry too large".into());}
  let value:serde_json::Value=serde_json::from_str(line).map_err(|_|"Invalid log JSON")?;
  if !value.is_object()||!value["sessionId"].is_string()||!value["event"].is_string()||!matches!(value["level"].as_str(),Some("debug"|"info"|"warn"|"error")){return Err("Invalid log event".into());}
  normalized.push(value.to_string());
 }
 fs::create_dir_all(directory).map_err(|error|error.to_string())?;
 let files=names();let current=directory.join(files[2]);
 let text=normalized.join("\n")+"\n";
 if fs::metadata(&current).map(|metadata|metadata.len()).unwrap_or(0)+text.len() as u64>limit{
  remove_if_present(&directory.join(files[0]))?;
  if directory.join(files[1]).exists(){fs::rename(directory.join(files[1]),directory.join(files[0])).map_err(|error|error.to_string())?;}
  if current.exists(){fs::rename(&current,directory.join(files[1])).map_err(|error|error.to_string())?;}
 }
 let mut file=OpenOptions::new().create(true).append(true).open(current).map_err(|error|error.to_string())?;
 file.write_all(text.as_bytes()).and_then(|_|file.flush()).map_err(|error|error.to_string())
}
#[tauri::command]
pub async fn debug_log_append(app:tauri::AppHandle,state:tauri::State<'_,std::sync::Arc<DebugLog>>,batch:Vec<String>)->Result<(),String>{
 let directory=app.path().app_log_dir().map_err(|error|error.to_string())?;let state=state.inner().clone();
 tauri::async_runtime::spawn_blocking(move||{let _lock=state.0.lock().map_err(|error|error.to_string())?;append(&directory,&batch,LIMIT)}).await.map_err(|error|error.to_string())?
}
#[tauri::command]
pub async fn debug_log_read(app:tauri::AppHandle,state:tauri::State<'_,std::sync::Arc<DebugLog>>)->Result<String,String>{
 let directory=app.path().app_log_dir().map_err(|error|error.to_string())?;let state=state.inner().clone();
 tauri::async_runtime::spawn_blocking(move||{
  let _lock=state.0.lock().map_err(|error|error.to_string())?;let mut output=String::new();
  for name in names(){let path=directory.join(name);if !path.exists(){continue;}if fs::metadata(&path).map_err(|error|error.to_string())?.len()>LIMIT{return Err("Log file exceeds read limit".into());}output.push_str(&fs::read_to_string(path).map_err(|error|error.to_string())?);}
  // Existing native stage-only traces remain useful when startup failed before JS.
  if let Ok(entries)=fs::read_dir(&directory){
   let mut traces:Vec<_>=entries.flatten().filter(|entry|entry.file_type().map(|kind|kind.is_file()&&!kind.is_symlink()).unwrap_or(false)&&entry.file_name().to_string_lossy().starts_with("startup-")&&entry.path().extension().is_some_and(|extension|extension=="log")).collect();
   traces.sort_by_key(|entry|entry.metadata().and_then(|metadata|metadata.modified()).ok());
   for trace in traces.iter().rev().take(3){if trace.metadata().map(|metadata|metadata.len()<=16384).unwrap_or(false){if let Ok(text)=fs::read_to_string(trace.path()){output.push_str(&serde_json::json!({"kind":"native_startup_trace","name":trace.file_name().to_string_lossy(),"content":text}).to_string());output.push('\n');}}}
  }
  Ok(output)
 }).await.map_err(|error|error.to_string())?
}
#[tauri::command]
pub async fn debug_log_clear(app:tauri::AppHandle,state:tauri::State<'_,std::sync::Arc<DebugLog>>)->Result<(),String>{
 let directory=app.path().app_log_dir().map_err(|error|error.to_string())?;let state=state.inner().clone();
 tauri::async_runtime::spawn_blocking(move||{let _lock=state.0.lock().map_err(|error|error.to_string())?;for name in names(){remove_if_present(&directory.join(name))?;}Ok(())}).await.map_err(|error|error.to_string())?
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn rotation_is_bounded_and_preserves_valid_json(){
  let dir=std::env::temp_dir().join(format!("asset-doctor-log-test-{}",std::process::id()));fs::create_dir_all(&dir).unwrap();
  let line=serde_json::json!({"sessionId":"test","event":"stage","level":"info"}).to_string();
  for _ in 0..10{append(&dir,&[line.clone()],(line.len()+2)as u64).unwrap();}
  assert_eq!(fs::read_dir(&dir).unwrap().count(),3);
  for entry in fs::read_dir(&dir).unwrap(){let text=fs::read_to_string(entry.unwrap().path()).unwrap();assert_eq!(text.lines().count(),1);assert!(serde_json::from_str::<serde_json::Value>(text.trim()).is_ok());}
  for name in names(){fs::remove_file(dir.join(name)).unwrap();}fs::remove_dir(dir).unwrap();
 }
 #[test]fn invalid_events_are_rejected_before_io(){let dir=std::env::temp_dir().join("asset-doctor-invalid-log-never-created");assert!(append(&dir,&["not json".into()],LIMIT).is_err());assert!(!dir.exists());}
 #[test]fn pretty_json_is_normalized_to_one_line(){let dir=std::env::temp_dir().join(format!("asset-doctor-log-json-test-{}",std::process::id()));let line="{\n\"sessionId\":\"test\",\n\"event\":\"test\",\n\"level\":\"info\"\n}";append(&dir,&[line.into()],LIMIT).unwrap();let file=dir.join(names()[2]);assert_eq!(fs::read_to_string(&file).unwrap().lines().count(),1);fs::remove_file(file).unwrap();fs::remove_dir(dir).unwrap();}
}
