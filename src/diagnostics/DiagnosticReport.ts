import {version} from '../../package.json';
import type {HealthIssue,ProgressiveAnalysisState,DiagnosticProfileId} from '../types';
import {localizeHealthIssue} from '../health/HealthIssueLocalization';

export function reportableFinding(issue:HealthIssue){
 return ['ERROR','WARNING','UNKNOWN'].includes(issue.severity)||issue.repairability==='MANUAL';
}
const encoder=new TextEncoder();
const text=(value:string|undefined)=>value===undefined?undefined:value.length>8000?value.slice(0,8000)+' [truncated]':value;
function finding(issue:HealthIssue,language:'ru'|'en'){
 const localized=localizeHealthIssue(issue,language);
 return {
  id:text(issue.id),category:issue.category,severity:issue.severity,layer:issue.layer,
  title:text(issue.title),description:text(issue.description),evidence:text(issue.evidence),
  localized:{title:text(localized.title),description:text(localized.description),evidence:text(localized.evidence),suggestedAction:text(localized.suggestedAction)},
  whyItMatters:text(issue.whyItMatters),suggestedAction:text(issue.suggestedAction),technicalDetails:text(issue.technicalDetails),
  repairability:issue.repairability??'NONE',profileId:issue.profileId,profileDependent:issue.profileDependent,
  meshName:text(issue.meshName),meshUuid:text(issue.meshUuid),nodeName:text(issue.nodeName),boneName:text(issue.boneName),clipName:text(issue.clipName),
  count:issue.count,ratio:text(issue.ratio),affectedElement:issue.affectedElement,focusPosition:issue.focusPosition,
  affectedIndices:issue.affectedIndices?.slice(0,1024),affectedIndicesTotal:issue.affectedIndices?.length,
  locations:issue.locations?.slice(0,32).map(location=>({...location,meshName:text(location.meshName),meshUuid:text(location.meshUuid),affectedIndices:location.affectedIndices?.slice(0,1024),affectedIndicesTotal:location.affectedIndices?.length})),
  locationsTotal:issue.locations?.length,
 };
}
export interface DiagnosticReportInput {
 assetName:string;assetId:string;fileBytes?:number;scanRevision:number;profileId:DiagnosticProfileId;
 stages:ProgressiveAnalysisState;issues:readonly HealthIssue[];totalScanCards?:number;scope:'all'|'single';language:'ru'|'en';
}
/** A bounded snapshot; no live model references, buffers or scan mutation. */
export function buildDiagnosticReport(input:DiagnosticReportInput,maxBytes=4*1024*1024){
 const source=input.scope==='all'?input.issues.filter(reportableFinding):input.issues;
 const report={kind:'AssetDoctorDiagnosticReport',schemaVersion:1,appVersion:version,createdAt:new Date().toISOString(),
  asset:{name:input.assetName.split(/[\\/]/).at(-1),id:input.assetId,fileBytes:input.fileBytes},
  scan:{revision:input.scanRevision,profile:input.profileId,status:Object.values(input.stages).every(stage=>stage==='done')?'complete':'partial',stages:{...input.stages}},
  language:input.language,scope:input.scope,totalScanCards:input.totalScanCards??input.issues.length,eligibleFindings:source.length,
  includedFindings:0,omittedFindings:0,
  limits:{affectedIndicesPerLocation:1024,locationsPerFinding:32,stringCharacters:8000,reportBytes:maxBytes,note:'Totals preserve sample truncation. UNKNOWN and partial scans are not a clean bill of health.'},
  findings:[] as ReturnType<typeof finding>[],
 };
 let bytes=encoder.encode(JSON.stringify(report,null,2)).length+1024;
 for(const issue of source){const entry=finding(issue,input.language),size=encoder.encode(JSON.stringify(entry,null,2).replace(/^/gm,'    ')).length+2;if(bytes+size>maxBytes){report.omittedFindings++;continue;}bytes+=size;report.findings.push(entry);}
 report.includedFindings=report.findings.length;
 const output=JSON.stringify(report,null,2)+'\n';
 if(encoder.encode(output).length>maxBytes)throw new Error('Diagnostic report exceeds the text export limit.');
 return {report,text:output,fileName:`${(report.asset.name??'model').replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,100)}_diagnostics_${input.scope}_${report.createdAt.replace(/[:.]/g,'-')}.json`};
}
