import type * as THREE from 'three';

const MiB=1024*1024;
const modelFile=64*MiB;
// Operational binary budgets, sized above the measured 500001-triangle control.
// They are not estimates of available RAM, process heap limits or GPU memory.
// Every one of Compare's eight slots admits the same per-file allowance.
export const memoryLimits={modelFile,compareSources:8*modelFile,packet:32*MiB,workerInputs:64*MiB,history:128*MiB} as const;
export class MemoryBudgetError extends Error {
 constructor(readonly requestedBytes:number,readonly limitBytes:number,label:string){
  const size=(value:number)=>Number.isFinite(value)&&value>=0?`${(value/MiB).toFixed(2)} MiB`:'invalid size';
  super(`${label} exceeds the configured memory budget (${size(requestedBytes)}; maximum ${size(limitBytes)}).`);this.name='MemoryBudgetError';
 }
}

export function assertMemoryBytes(bytes:number,limit:number,label='Operation'){
 if(!Number.isSafeInteger(bytes)||bytes<0||bytes>limit){
  throw new MemoryBudgetError(bytes,limit,label);
 }
}
export class ByteBudget {
 private occupied=0;
 constructor(readonly limit:number){}
 get used(){return this.occupied;}
 reserve(bytes:number){
  assertMemoryBytes(bytes,this.limit-this.occupied);this.occupied+=bytes;
  let released=false;return()=>{if(!released){released=true;this.occupied-=bytes;}};
 }
}
export const workerInputBudget=new ByteBudget(memoryLimits.workerInputs);

export function geometryArrays(geometry:THREE.BufferGeometry):ArrayBufferView[]{
 return [...Object.values(geometry.attributes),...Object.values(geometry.morphAttributes).flat(),...(geometry.index?[geometry.index]:[])].map(attribute=>attribute.array);
}
/** Actual retained backing buffers; aliases and interleaved attributes are counted once. */
export function binaryBytes(value:unknown):number {
 const seen=new Set<object>(),buffers=new Set<ArrayBufferLike>();
 const visit=(item:unknown)=>{
  if(item instanceof ArrayBuffer){buffers.add(item);return;}
  if(ArrayBuffer.isView(item)){buffers.add(item.buffer);return;}
  if(!item||typeof item!=='object'||seen.has(item))return;seen.add(item);
  if(item instanceof Map||item instanceof Set){for(const entry of item.values())visit(entry);}
  else Object.values(item).forEach(visit);
 };visit(value);return [...buffers].reduce((sum,buffer)=>sum+buffer.byteLength,0);
}
