import * as THREE from 'three';
import {ByteBudget,binaryBytes} from './MemoryBudget';
import {ComputeWorkerClient} from '../workers/ComputeWorkerClient';
import {packRoot} from '../workers/GeometryPacket';
import {SurgicalHealEngine} from '../heal/SurgicalHealEngine';
import {RigEditSession} from '../rig/RigEditSession';
import {GLBLoaderService} from '../loaders/GLBLoaderService';
import {memoryLimits} from './MemoryBudget';

export async function runMemoryBudgetTests(){
 const results:{name:string;passed:boolean;actual?:unknown;expected?:unknown}[]=[];
 const budget=new ByteBudget(8),release=budget.reserve(6);
 let blocked=false;try{budget.reserve(3);}catch{blocked=true;}
 release();release();
 results.push({name:'F07 shared byte reservations reject overflow and release exactly once',passed:blocked&&budget.used===0});
 const bytes=new Uint8Array(8);results.push({name:'F07 binary accounting counts backing storage once across aliases',passed:binaryBytes([bytes,bytes.subarray(2),bytes.buffer])===8});
 let created=0;const client=new ComputeWorkerClient(()=>{created++;throw new Error('must not create');},new ByteBudget(1));
 let computeBlocked=false;try{await client.request({bytes});}catch(error){computeBlocked=String(error).includes('memory');}
 results.push({name:'F07 oversized worker inputs never create a worker or detach caller bytes',passed:computeBlocked&&created===0&&bytes.byteLength===8});client.dispose();
 const shared=new ByteBudget(8);
 class ControlledWorker {
  listeners=new Map<string,Set<(event:any)=>void>>();
  addEventListener(name:string,listener:(event:any)=>void){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name)!.add(listener);}
  removeEventListener(name:string,listener:(event:any)=>void){this.listeners.get(name)?.delete(listener);}
  postMessage(){}terminate(){}
  succeed(){this.listeners.get('message')?.forEach(listener=>listener({data:{success:true,result:7}}));}
 }
 const workerA=new ControlledWorker(),workerB=new ControlledWorker();
 const clientA=new ComputeWorkerClient(()=>workerA as unknown as Worker,shared),clientB=new ComputeWorkerClient(()=>workerB as unknown as Worker,shared);
 const jobA=clientA.request({buffer:new Uint8Array(4)}).catch(error=>error.name),jobB=clientB.request({buffer:new Uint8Array(4)});
 const occupied=shared.used;clientA.dispose();workerB.succeed();
 results.push({name:'F07 shared worker leases survive concurrency and release on cancellation and success',passed:occupied===8&&await jobA==='AbortError'&&await jobB===7&&shared.used===0});clientB.dispose();
 const broken=new ComputeWorkerClient(()=>{throw new Error('construction failed');},shared);try{await broken.request({buffer:new Uint8Array(2)});}catch{}
 results.push({name:'F07 worker construction failure returns its memory reservation',passed:shared.used===0});broken.dispose();
 let read=false;const loader=new GLBLoaderService();
 const file={size:memoryLimits.modelFile+1,name:'oversized.glb',arrayBuffer:async()=>{read=true;return new ArrayBuffer(1);}} as File;
 try{await loader.loadFromFile(file);}catch{}
 results.push({name:'F07 oversized model admission runs before File.arrayBuffer',passed:!read});loader.dispose();
 const queuedLoader=new GLBLoaderService();let releaseRead!:(bytes:ArrayBuffer)=>void,thirdRead=false;
 const barrier=new Promise<ArrayBuffer>(resolve=>{releaseRead=resolve;});
 const firstFile={size:1,name:'first.glb',arrayBuffer:()=>barrier} as File;
 const firstLoad=queuedLoader.loadFromFile(firstFile),secondLoad=queuedLoader.loadFromFile({size:1,name:'second.glb',arrayBuffer:async()=>new ArrayBuffer(1)} as File);
 let queueBlocked=false;const thirdLoad=queuedLoader.loadFromFile({size:1,name:'third.glb',arrayBuffer:async()=>{thirdRead=true;return new ArrayBuffer(1);}} as File).catch(error=>{queueBlocked=String(error).includes('queued');});
 await Promise.race([thirdLoad,new Promise(resolve=>setTimeout(resolve,0))]);
 releaseRead(new ArrayBuffer(1));await Promise.allSettled([firstLoad,secondLoad,thirdLoad]);
 results.push({name:'F07 loader keeps at most one active and one queued File without reading rejected requests',passed:queueBlocked&&!thirdRead});queuedLoader.dispose();
 const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3)).setIndex([0,1,2,0,0,0]);
 const root=new THREE.Group(),mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());root.add(mesh);
 let copied=false;const array=geometry.getAttribute('position').array as Float32Array,original=array.slice;array.slice=function(...args:any[]){copied=true;return original.apply(this,args as [number?,number?]);};
 let packetBlocked=false;try{packRoot(root,undefined,1);}catch(error){packetBlocked=String(error).includes('memory');}
 results.push({name:'F07 geometry packet admission rejects before cloning large attribute arrays',passed:packetBlocked&&!copied});array.slice=original;
 const engine=new SurgicalHealEngine(1);engine.previewRemoveDegenerateTriangles(root,mesh.uuid);const applied=engine.applyPending(root,'budget');
 results.push({name:'F07 full Heal Undo budget refuses mutation and retains the original index',passed:!applied.success&&geometry.index!.count===6&&!engine.getUndoState().available});engine.clear();
 const second=mesh.clone();second.geometry=geometry.clone();root.add(second);
 const bounded=new SurgicalHealEngine(60);bounded.previewRemoveDegenerateTriangles(root,mesh.uuid);const first=bounded.applyPending(root,'first');
 bounded.previewRemoveDegenerateTriangles(root,second.uuid);const refused=bounded.applyPending(root,'second');
 const preserved=first.success&&!refused.success&&second.geometry.index!.count===6&&bounded.getUndoState().available&&bounded.undoLast(root).success&&geometry.index!.count===6;
 results.push({name:'F07 saturated Heal history preserves earlier Undo and never evicts repair evidence',passed:preserved});bounded.clear();second.geometry.dispose();root.remove(second);
 const bone=new THREE.Bone();bone.name='Joint';root.add(bone);const rig=new RigEditSession(root,[],undefined,undefined,1);rig.enterEdit();
 let rigBlocked=false;try{rig.commitJoint(bone.uuid,{position:[1,0,0]});}catch(error){rigBlocked=String(error).includes('memory');}
 results.push({name:'F07 full Rig history budget refuses a transaction without changing rest or Undo',passed:rigBlocked&&bone.position.x===0&&!rig.canUndo&&!rig.hasEdits});rig.dispose();
 const dragRig=new RigEditSession(root,[],undefined,undefined,1);dragRig.enterEdit();let dragRefused=false;
 dragRig.beginGesture();try{dragRig.previewJoint(bone.uuid,{position:[1,0,0]},'follow');}catch{dragRefused=true;dragRig.cancelGesture();}dragRig.finishGesture();
 results.push({name:'F07 drag budget refusal follows the cancellable preview path and leaves no stuck gesture',passed:dragRefused&&!dragRig.isGestureActive&&bone.position.x===0&&!dragRig.canUndo});dragRig.dispose();
 const boundedRig=new RigEditSession(root,[],undefined,undefined,32768);boundedRig.enterEdit();let changed=0,refusedRig=false;
 for(let i=1;i<=30;i++){try{boundedRig.commitJoint(bone.uuid,{position:[i/100,0,0]});changed++;}catch{refusedRig=true;break;}}
 const last=bone.position.x;while(boundedRig.canUndo)boundedRig.undo();const restored=bone.position.x===0;
 while(boundedRig.canRedo)boundedRig.redo();
 results.push({name:'F07 saturated Rig history preserves exact Undo and Redo instead of dropping old states',passed:refusedRig&&changed>0&&restored&&bone.position.x===last});boundedRig.dispose();
 const metadataRoot=new THREE.Group(),metadataBone=new THREE.Bone();metadataRoot.add(metadataBone);
 const namedRig=new RigEditSession(metadataRoot,[new THREE.AnimationClip('a'.repeat(8192),1,[])],undefined,undefined,32768);namedRig.enterEdit();let namedRefusal=false;
 try{namedRig.commitJoint(metadataBone.uuid,{position:[1,0,0]});}catch{namedRefusal=true;}
 results.push({name:'F07 Rig history accounts for long authored clip names even without track buffers',passed:namedRefusal&&metadataBone.position.x===0&&!namedRig.canUndo});namedRig.dispose();
 geometry.dispose();(mesh.material as THREE.Material).dispose();return results;
}
