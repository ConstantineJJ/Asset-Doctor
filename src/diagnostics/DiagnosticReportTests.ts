import {buildDiagnosticReport,type DiagnosticReportInput} from './DiagnosticReport';
import type {HealthIssue} from '../types';
export function runDiagnosticReportTests():{name:string;passed:boolean;actual?:unknown;expected?:unknown}[]{
 const issues:HealthIssue[]=[{id:'manual',category:'Geometry',severity:'WARNING',title:'Manual issue',description:'Measured',repairability:'MANUAL',meshUuid:'mesh-1',meshName:'Body',affectedIndices:Array.from({length:1500},(_,i)=>i),evidence:'1500 affected',suggestedAction:'Inspect mesh'},{id:'unknown',category:'Topology',severity:'UNKNOWN',title:'Unknown',description:'Scan failed'},{id:'ok',category:'UV',severity:'OK',title:'OK',description:'OK'}];
 const input:DiagnosticReportInput={assetName:'D:\\Private\\Модель.glb',assetId:'asset-1',scanRevision:7,profileId:'general',stages:{geometry:'done',materials:'done',textures:'done',skeleton:'done',animations:'done',transforms:'done',performance:'done',topology:'error'},issues,scope:'all',language:'en'};
 const result=buildDiagnosticReport(input),single=buildDiagnosticReport({...input,scope:'single',issues:[issues[0]]});
 const bounded=buildDiagnosticReport({...input,issues:Array.from({length:20},(_,i)=>({...issues[0],id:String(i),description:'x'.repeat(8000)}))},24000);
 return [
  {name:'Diagnostic bulk snapshot includes manual and unknown issues, excludes OK cards',passed:result.report.findings.map(x=>x.id).join(',')==='manual,unknown'&&result.report.totalScanCards===3},
  {name:'Diagnostic report preserves asset, revision, partial scan and measured location',passed:result.report.asset.name==='Модель.glb'&&result.report.asset.id==='asset-1'&&result.report.scan.revision===7&&result.report.scan.status==='partial'&&result.report.findings[0].meshUuid==='mesh-1'},
  {name:'Diagnostic samples retain explicit total and never mutate source indices',passed:result.report.findings[0].affectedIndices?.length===1024&&result.report.findings[0].affectedIndicesTotal===1500&&issues[0].affectedIndices?.length===1500},
  {name:'Single finding export captures exactly one issue with its evidence and action',passed:single.report.findings.length===1&&single.report.findings[0].evidence==='1500 affected'&&single.report.findings[0].suggestedAction==='Inspect mesh'},
  {name:'Large reports stay within byte budget and explicitly count omitted findings',passed:new TextEncoder().encode(bounded.text).length<=24000&&bounded.report.omittedFindings>0&&bounded.report.includedFindings+bounded.report.omittedFindings===20},
 ];
}
