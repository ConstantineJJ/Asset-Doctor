import {version} from '../../package.json';
export type LogLevel='debug'|'info'|'warn'|'error';
export interface LogEvent {time:string;sessionId:string;sequence:number;version:string;level:LogLevel;scope:string;event:string;operationId?:string;context:Record<string,unknown>}
export interface LogSnapshot {enabled:boolean;verbose:boolean;entries:readonly LogEvent[];retainedBytes:number;writeError:string;unconfirmedDiskEntries:number}
type Local=Pick<Storage,'getItem'|'setItem'>;
const encoder=new TextEncoder(),preferences='asset-doctor.system-log.v1';
function localStorageOrNone(){try{return typeof window==='undefined'?undefined:window.localStorage;}catch{return undefined;}}
export function sanitizeLogText(value:string){
 return value.slice(0,10000).replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi,'Bearer [redacted]')
  .replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)["']?[^\s,"']+/gi,'$1[redacted]')
  .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home)\/)[^\r\n"'<>|]+/g,path=>`<local>/${path.split(/[\\/]/).at(-1)}`);
}
const allowed=new Set(['asset','assetId','jointId','tool','space','historyBytes','historyLimitBytes','undoSteps','redoSteps','fileName','parentOperationId','stage','reason','durationMs','count','triangles','vertices','status','revision','mode','fileBytes','error','userAgent','surface']);
function safeContext(input:Record<string,unknown>){
 const result:Record<string,unknown>={};
 for(const [key,value]of Object.entries(input)){
  if(!allowed.has(key))continue;
  if(key==='error'){
   const error=value instanceof Error?value:typeof value==='object'&&value?value as {name?:unknown;message?:unknown;stack?:unknown}:{message:String(value)};
   result.error={name:sanitizeLogText(String(error.name??'Error')).slice(0,100),message:sanitizeLogText(String(error.message??value)).slice(0,2000),stack:sanitizeLogText(String(error.stack??'')).slice(0,6000)};
   const budget=error as {requestedBytes?:unknown;limitBytes?:unknown};
   if(typeof budget.requestedBytes==='number'&&Number.isFinite(budget.requestedBytes)&&typeof budget.limitBytes==='number'&&Number.isFinite(budget.limitBytes))Object.assign(result.error as object,{requestedBytes:budget.requestedBytes,limitBytes:budget.limitBytes});
  }else if(typeof value==='string')result[key]=sanitizeLogText(value).slice(0,1000);
  else if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))result[key]=value;
 }
 return result;
}
/** Bounded local observer. Failure to log never changes model/repair/export outcomes. */
export class SystemLogStore {
 readonly sessionId=globalThis.crypto?.randomUUID?.()??`session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
 private state:LogSnapshot={enabled:true,verbose:false,entries:[],retainedBytes:0,writeError:'',unconfirmedDiskEntries:0};
 private sizes:number[]=[];
 private listeners=new Set<()=>void>();
 private writer:((lines:string[])=>Promise<void>)|null=null;
 private queue:{line:string;bytes:number}[]=[];
 private queuedBytes=0;
 private pumping:Promise<void>|null=null;
 private serial=0;
 private eventSerial=0;
 constructor(private readonly local:Local|undefined=localStorageOrNone(),private readonly maxEntries=500,private readonly maxBytes=1024*1024){
  try{const saved=JSON.parse(local?.getItem(preferences)??'null');if(saved)this.state={...this.state,enabled:saved.enabled!==false,verbose:saved.verbose===true};}catch{}
 }
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(patch:Partial<LogSnapshot>){this.state={...this.state,...patch};this.listeners.forEach(listener=>{try{listener();}catch{}});}
 private savePreferences(){try{this.local?.setItem(preferences,JSON.stringify({enabled:this.state.enabled,verbose:this.state.verbose}));}catch{this.publish({writeError:'Could not persist log preferences.'});}}
 setEnabled(enabled:boolean){this.publish({enabled});this.savePreferences();if(enabled)this.record('info','app','logging_enabled');}
 setVerbose(verbose:boolean){this.publish({verbose});this.savePreferences();}
 clear(){this.sizes=[];this.publish({entries:[],retainedBytes:0});}
 setWriter(writer:(lines:string[])=>Promise<void>){this.writer=writer;this.pump();}
 record(level:LogLevel,scope:string,event:string,context:Record<string,unknown>={},operationId?:string){
  if(!this.state.enabled||level==='debug'&&!this.state.verbose)return;
  try{
   const entry:LogEvent={time:new Date().toISOString(),sessionId:this.sessionId,sequence:++this.eventSerial,version,level,scope:scope.slice(0,64),event:event.slice(0,64),operationId,context:safeContext(context)};
   let line=JSON.stringify(entry),bytes=encoder.encode(line).byteLength+1;
   if(bytes>16384){entry.context={reason:'Details truncated to fit log entry limit'};line=JSON.stringify(entry);bytes=encoder.encode(line).byteLength+1;}
   const entries=[...this.state.entries,entry];this.sizes.push(bytes);let retainedBytes=this.state.retainedBytes+bytes;
   while(entries.length>this.maxEntries||retainedBytes>this.maxBytes){entries.shift();retainedBytes-=this.sizes.shift()!;}
   this.publish({entries,retainedBytes});
   if(this.writer){
    this.queue.push({line,bytes});this.queuedBytes+=bytes;let dropped=0;
    while(this.queue.length>128||this.queuedBytes>1024*1024){this.queuedBytes-=this.queue.shift()!.bytes;dropped++;}
    if(dropped)this.publish({unconfirmedDiskEntries:this.state.unconfirmedDiskEntries+dropped});
    this.pump();
   }
  }catch{/* Logging is never an operation failure. */}
 }
 begin(scope:string,context:Record<string,unknown>={}){
  const operationId=`${this.sessionId}:${++this.serial}`,started=performance.now();
  this.record('info',scope,'started',context,operationId);
  let ended=false;
  return {id:operationId,end:(status:'completed'|'cancelled'|'failed',details:Record<string,unknown>={})=>{if(ended)return;ended=true;this.record(status==='failed'?'error':status==='cancelled'?'warn':'info',scope,status,{...context,...details,durationMs:performance.now()-started},operationId);}};
 }
 private pump(){
  if(!this.writer||this.pumping||!this.queue.length)return;
  this.pumping=(async()=>{
   while(this.queue.length){
    const batch=this.queue.splice(0,8);this.queuedBytes-=batch.reduce((sum,item)=>sum+item.bytes,0);
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
     await Promise.race([this.writer!(batch.map(item=>item.line)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Log write timeout')),10000);})]);
     if(this.state.writeError)this.publish({writeError:''});
    }catch(error){const lost=batch.length+this.queue.length;this.queue=[];this.queuedBytes=0;this.publish({writeError:sanitizeLogText(String(error)),unconfirmedDiskEntries:this.state.unconfirmedDiskEntries+lost});break;}
    finally{clearTimeout(timer);}
   }
  })().finally(()=>{this.pumping=null;if(this.queue.length)this.pump();});
 }
 async flush(){while(this.pumping)await this.pumping;}
 exportText(){return JSON.stringify({kind:'AssetDoctorSystemLog',version,sessionId:this.sessionId,exportedAt:new Date().toISOString(),enabled:this.state.enabled,unconfirmedDiskEntries:this.state.unconfirmedDiskEntries})+'\n'+this.state.entries.map(entry=>JSON.stringify(entry)).join('\n')+'\n';}
}
export const systemLog=new SystemLogStore();

/** Keep earlier evidence when a crash interrupted the last disk record. */
export function mergeSystemLogText(current:string,disk:string){
 const local=current.trim().split('\n').map(line=>JSON.parse(line)),known=new Set<string>();
 const lines=disk.split('\n').filter(Boolean).map(line=>{
  try{const item=JSON.parse(line);if(item?.sessionId&&item?.sequence)known.add(`${item.sessionId}:${item.sequence}`);return JSON.stringify(item);}
  catch{return JSON.stringify({kind:'incomplete_disk_record',text:sanitizeLogText(line).slice(0,2000)});}
 });
 return [JSON.stringify(local[0]),...lines,...local.slice(1).filter(item=>!known.has(`${item.sessionId}:${item.sequence}`)).map(item=>JSON.stringify(item))].join('\n')+'\n';
}
