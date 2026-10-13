import * as THREE from 'three';
import {packGeometry,unpackGeometry,packRoot,unpackRoot,transferBuffers} from './GeometryPacket';
import {captureGeometry,geometryMatches} from '../heal/GeometrySnapshot';
import {SurgicalHealEngine} from '../heal/SurgicalHealEngine';
import {healMetrics} from '../heal/HealVerification';
import {analyzeMeshTopology} from '../analysis/TopologyAnalyzer';
import {meshTopologyData} from '../analysis/MeshTopologyData';

export async function runComputeWorkerTests() {
 const results:{name:string;passed:boolean;actual?:unknown;expected?:unknown}[]=[];
 const geometry=new THREE.BufferGeometry(),buffer=new THREE.InterleavedBuffer(new Float32Array([0,0,0,0,0,1,0,0,1,0,0,1,0,0,1]),5);
 geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));geometry.setAttribute('uv',new THREE.InterleavedBufferAttribute(buffer,2,3));geometry.setIndex([0,1,2,0,0,0]);
 geometry.morphAttributes.position=[new THREE.Float32BufferAttribute([0,0,1,1,0,1,0,1,1],3)];geometry.morphTargetsRelative=true;
 const source=captureGeometry(geometry),packet=packGeometry(geometry),transport=structuredClone(packet,{transfer:transferBuffers(packet)}),copy=unpackGeometry(transport);
 results.push({name:'F02 geometry packet preserves exact interleaved/morph layout and bytes without detaching live arrays',passed:buffer.array.byteLength===60 && geometryMatches(copy,source) && copy.getAttribute('position').getY(2)===1 && copy.getAttribute('uv').getX(1)===1});
 const half=new THREE.Float16BufferAttribute([0x3c00,0x4000,0x4200],3);geometry.setAttribute('half',half);
 const halfCopy=unpackGeometry(packGeometry(geometry)).getAttribute('half');
 results.push({name:'F02 geometry packet retains Float16 logical values and attribute class',passed:halfCopy instanceof THREE.Float16BufferAttribute && halfCopy.getX(0)===1 && halfCopy.getY(0)===2});
 const root=new THREE.Group(),bone=new THREE.Bone();bone.name='Joint';root.add(bone);
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(12),4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));
 const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshStandardMaterial());root.add(mesh,new THREE.Mesh(geometry,new THREE.MeshStandardMaterial()));root.updateMatrixWorld(true);mesh.bind(new THREE.Skeleton([bone]));
 const rebuilt=unpackRoot(packRoot(root)),rebuiltMesh=rebuilt.getObjectByProperty('uuid',mesh.uuid) as THREE.SkinnedMesh;
 results.push({name:'F02 worker graph preserves shared-geometry guard and skeleton ownership/bind data',passed:rebuiltMesh.geometry===(rebuilt.children[2] as THREE.Mesh).geometry && rebuiltMesh.skeleton.bones[0]===rebuilt.children[0] && rebuiltMesh.bindMatrix.equals(mesh.bindMatrix) && rebuiltMesh.uuid===mesh.uuid});
 const bytesGeometry=new THREE.BufferGeometry();bytesGeometry.setAttribute('tiny',new THREE.Uint8BufferAttribute([1,2,3,4,5],1));const exact=captureGeometry(bytesGeometry);bytesGeometry.getAttribute('tiny').array[4]=6;
 results.push({name:'F02 exact word comparison still catches trailing byte edits without needsUpdate',passed:!geometryMatches(bytesGeometry,exact)});

 // The fake supplies actual analyzer results across a structured-clone boundary;
 // it also gives deterministic control over cancellation and postcheck failure.
 const originalWorker=globalThis.Worker;
 let measureCount=0,failAfter=false,pending:(()=>void)|undefined,delay=false;
 class FakeWorker {
  listeners=new Map<string,Set<(event:any)=>void>>();terminated=false;
  addEventListener(name:string,listener:(event:any)=>void){let values=this.listeners.get(name);if(!values){values=new Set();this.listeners.set(name,values);}values.add(listener);}
  removeEventListener(name:string,listener:(event:any)=>void){this.listeners.get(name)?.delete(listener);}
  terminate(){this.terminated=true;}
  postMessage(data:any,transfer:ArrayBuffer[]) {
   const input=structuredClone(data,{transfer});
   const finish=()=>{
    if(this.terminated)return;
    const root=unpackRoot(input.root),mesh=root.getObjectByProperty('uuid',input.meshUuid) as THREE.Mesh;
    const result=healMetrics(analyzeMeshTopology(meshTopologyData(mesh)),mesh.geometry,mesh);
    const response=failAfter && ++measureCount===2?{success:false,error:'Forced postcheck failure'}:{success:true,result};
    this.listeners.get('message')?.forEach(listener=>listener({data:response}));
   };
   if(delay)pending=finish;else queueMicrotask(finish);
  }
 }
 Object.assign(globalThis,{Worker:FakeWorker});
 const make=()=>{const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3)).setIndex([0,1,2,0,0,0]),new THREE.MeshStandardMaterial());root.add(mesh);const engine=new SurgicalHealEngine();engine.previewRemoveDegenerateTriangles(root,mesh.uuid);return {root,mesh,engine};};
 try {
  const valid=make();const result=await valid.engine.applyPendingAsync(valid.root,'fixture');
  results.push({name:'F02 async Apply independently measures actual mutation and preserves Undo',passed:result.success && result.report?.targetStatus==='VERIFIED' && valid.engine.undoLast(valid.root).success && valid.mesh.geometry.index?.count===6});valid.engine.clear();
  failAfter=true;measureCount=0;const failed=make();const partial=await failed.engine.applyPendingAsync(failed.root,'fixture');
  results.push({name:'F02 worker postcheck error cannot certify VERIFIED and retains safe Undo',passed:partial.success && partial.report?.targetStatus==='PARTIAL' && failed.engine.getUndoState().available && failed.engine.undoLast(failed.root).success});failed.engine.clear();failAfter=false;
  delay=true;const stale=make();const task=stale.engine.applyPendingAsync(stale.root,'fixture');stale.mesh.geometry.getAttribute('position').array[0]=42;pending!();
  const rejected=await task;results.push({name:'F02 raw in-place edit while before-check awaits cancels Apply',passed:!rejected.success && stale.mesh.geometry.index?.count===6 && !stale.engine.getUndoState().available});stale.engine.clear();
  const replaced=make();const cancelled=replaced.engine.applyPendingAsync(replaced.root,'fixture');replaced.engine.clear();
  const cancelledResult=await cancelled;results.push({name:'F02 asset replacement cancels pending worker without mutation or old report',passed:!cancelledResult.success && replaced.mesh.geometry.index?.count===6 && replaced.engine.getLastOperation()===null});
 }finally {Object.assign(globalThis,{Worker:originalWorker});}
 geometry.dispose();copy.dispose();bytesGeometry.dispose();mesh.skeleton.dispose();
 return results;
}
