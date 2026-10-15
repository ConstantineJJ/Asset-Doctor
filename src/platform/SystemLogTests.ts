import {SystemLogStore,mergeSystemLogText} from './SystemLog';
export async function runSystemLogTests(){
 const results:{name:string;passed:boolean;actual?:unknown;expected?:unknown}[]=[],log=new SystemLogStore(undefined,3,1800);
 for(let i=0;i<20;i++)log.record('info','test','event',{count:i,error:new Error('D:\\Private\\Models\\character.glb Bearer abcdefghijklmnop')});
 const snapshot=log.getSnapshot(),text=log.exportText();
 results.push({name:'System log retains bounded events and byte storage',passed:snapshot.entries.length<=3&&snapshot.retainedBytes<=1800});
 results.push({name:'System log strips absolute local model paths and bearer tokens',passed:!text.includes('D:\\\\Private')&&!text.includes('abcdefghijklmnop')});
 const operation=log.begin('test');operation.end('completed');operation.end('failed');
 results.push({name:'System log correlates each operation and records only one terminal outcome',passed:log.getSnapshot().entries.filter(entry=>entry.operationId===operation.id&&entry.event!=='started').length===1});
 const before=log.getSnapshot().entries.length;log.setEnabled(false);log.record('error','test','ignored');
 results.push({name:'Disabled system logging does not capture subsequent errors',passed:log.getSnapshot().entries.length===before});
 const disk=new SystemLogStore(),batches:string[][]=[];disk.setWriter(async batch=>{batches.push(batch);});disk.record('error','test','failed',{error:new Error('Expected')});await disk.flush();
 results.push({name:'System log serializes valid JSON batches and drains the native writer',passed:batches.length===1&&JSON.parse(batches[0][0]).event==='failed'});
 const failed=new SystemLogStore();failed.setWriter(async()=>{throw new Error('disk unavailable');});failed.record('info','test','event');await failed.flush();
 results.push({name:'System log reports disk failures while keeping UI entries without throwing',passed:failed.getSnapshot().entries.length===1&&failed.getSnapshot().unconfirmedDiskEntries===1&&failed.getSnapshot().writeError.includes('disk unavailable')});
 const huge=new SystemLogStore();huge.record('error','test','huge',{error:new Error('Ж'.repeat(30000))});
 results.push({name:'System log bounds oversized Unicode error payloads before queuing disk writes',passed:new TextEncoder().encode(JSON.stringify(huge.getSnapshot().entries[0])).byteLength<16384});
 const pressure=new SystemLogStore();let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});pressure.setWriter(async()=>barrier);
 for(let i=0;i<250;i++)pressure.record('info','test','queued',{count:i});
 results.push({name:'Slow disk writer bounds pending events and discloses dropped entries',passed:pressure.getSnapshot().unconfirmedDiskEntries>=121&&pressure.getSnapshot().entries.length===250});release();await pressure.flush();
 const merged=mergeSystemLogText(disk.exportText(),JSON.stringify(disk.getSnapshot().entries[0])+'\n'+JSON.stringify({sessionId:'prior',sequence:1,event:'old'})+'\n{"interrupted":');
 results.push({name:'System export keeps earlier evidence and deduplicates current events when the last disk line is interrupted',passed:merged.includes('prior')&&merged.includes('incomplete_disk_record')&&merged.trim().split('\n').length===4});
 return results;
}
