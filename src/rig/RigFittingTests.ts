import assert from 'node:assert/strict';
import * as THREE from 'three';
import {analyzeRigFitting} from './RigFitting';
import {RigEditSession} from './RigEditSession';
import {createPresentationWrapper} from '../viewer/AssetPresentation';
import {packRoot,unpackRoot} from '../workers/GeometryPacket';
import {transferBuffers} from '../workers/GeometryPacket';
import {RigFittingService} from './RigFittingService';
import {GLBLoaderService} from '../loaders/GLBLoaderService';
import {buildRigExportPacket,patchRigGlb} from './RigGlbPatch';
import {verifyEditedRig,rigIdentities} from './RigExportVerification';
import {packClips,unpackClips} from '../animation/ClipPacket';
import {rigFixture} from '../../tests/rig-fixtures';
import {documentMatrix} from '../viewer/AssetPresentation';

import {fittingFixture,fittingGlb} from '../../tests/fitting-fixtures';
const close=(a:number[],b:number[])=>{assert.equal(a.length,b.length);a.forEach((value,i)=>assert.ok(Math.abs(value-b[i])<2e-5,`${value} != ${b[i]}`));};
function vertices(root:THREE.Group){root.updateMatrixWorld(true);const result:number[]=[];root.traverse(node=>{if(node instanceof THREE.SkinnedMesh){node.skeleton.update();for(let i=0;i<node.geometry.getAttribute('position').count;i++)result.push(...node.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(node.matrixWorld).toArray());}});return result;}
function state(session:RigEditSession) {const snapshot=session.snapshot();return JSON.stringify({nodes:[...snapshot.nodes],joints:[...snapshot.joints.values()],skins:[...snapshot.skins.values()],clips:snapshot.clips.map(clip=>[clip.name,clip.duration,clip.tracks.map(track=>[track.name,Array.from(track.times),Array.from(track.values)])])});}
export async function runRigFittingTests() {
 const results:{name:string;passed:boolean;actual?:unknown;expected?:unknown}[]=[];
 const test=async(name:string,run:()=>void|Promise<void>)=>{try{await run();results.push({name,passed:true});}catch(error){results.push({name,passed:false,actual:String(error),expected:'Fitting proposal and authored-data contract holds'});}};
 await test('Fitting finds separate local section centres without changing authored rig or weights',()=>{
  const {root,session,mesh,middle,other}=fittingFixture(),before=state(session),bytes=Array.from(mesh.geometry.getAttribute('position').array);
  const result=analyzeRigFitting(root);for(const [bone,target]of [[middle,[0,1,0]],[other,[2,1,0]]] as const){const proposal=result.proposals.find(p=>p.uuid===bone.uuid)!;assert.equal(proposal.status,'suggested');close(proposal.target,[...target]);assert.ok(proposal.support>=6);}
  assert.equal(result.vertices,72);assert.equal(state(session),before);assert.deepEqual(Array.from(mesh.geometry.getAttribute('position').array),bytes);assert.equal(session.revision,0);
 });
 await test('Fitting leaves unweighted joints explicit and never guesses a global root position',()=>{
  const {root,base}=fittingFixture(),proposal=analyzeRigFitting(root).proposals.find(p=>p.uuid===base.uuid)!;assert.equal(proposal.status,'insufficient');close(proposal.current,proposal.target);
 });
 await test('Fitting ignores unreferenced influence vertices instead of biasing the local centre',()=>{
  const {root,mesh,middle}=fittingFixture(),geometry=mesh.geometry;
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([...geometry.getAttribute('position').array,1000,1,0],3));
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute([...geometry.getAttribute('skinIndex').array,1,0,0,0],4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([...geometry.getAttribute('skinWeight').array,1,0,0,0],4));geometry.setIndex(Array.from({length:72},(_,i)=>i));
  const result=analyzeRigFitting(root);assert.equal(result.vertices,72);close(result.proposals.find(p=>p.uuid===middle.uuid)!.target,[0,1,0]);
 });
 await test('Fitting uses referenced influence vertices and rejects nonfinite influences atomically',()=>{
  const {root,mesh,session}=fittingFixture();mesh.geometry.getAttribute('skinWeight').setX(0,NaN);const before=state(session);assert.throws(()=>analyzeRigFitting(root),/influence|weight|finite/i);assert.equal(state(session),before);
 });
 await test('Fitting document coordinates are independent of presentation turntable and grounding',()=>{
  const {root}=fittingFixture(),plain=analyzeRigFitting(root),wrapper=createPresentationWrapper(root);wrapper.rotation.y=1;wrapper.position.y=5;wrapper.updateMatrixWorld(true);
  const wrapped=analyzeRigFitting(root);plain.proposals.forEach((p,i)=>close(p.target,wrapped.proposals[i].target));
 });
 await test('Fitting decoded worker packet produces the same proposals without losing source arrays',()=>{
  const {root,mesh}=fittingFixture(),before=mesh.geometry.getAttribute('position').array.slice(),packet=packRoot(root),workerRoot=unpackRoot(structuredClone(packet));
  const a=analyzeRigFitting(root),b=analyzeRigFitting(workerRoot);a.proposals.forEach((p,i)=>close(p.target,b.proposals[i].target));assert.deepEqual(mesh.geometry.getAttribute('position').array,before);
 });
 await test('Applying fitting positions is one Undo step and preserves rest shape, unselected joint world positions and exact Redo',()=>{
  const {root,session,middle,other}=fittingFixture(),before=state(session),shape=vertices(root),tip=root.getObjectByName('MiddleTip')!.getWorldPosition(new THREE.Vector3()).toArray();
  const apply=Reflect.get(session,'applyFittingPositions');assert.equal(typeof apply,'function');apply.call(session,[{uuid:middle.uuid,position:[0,1,0]},{uuid:other.uuid,position:[2,1,0]}]);
  assert.equal(session.revision,1);close(vertices(root),shape);close(root.getObjectByName('MiddleTip')!.getWorldPosition(new THREE.Vector3()).toArray(),tip);
  const changed=state(session);session.undo();assert.equal(state(session),before);assert.equal(session.canUndo,false);session.redo();assert.equal(state(session),changed);session.reset();assert.equal(state(session),before);
 });
 await test('A rejected fitting batch preserves the earlier edit and Redo history without partial transforms',()=>{
  const {session,middle}=fittingFixture();session.renameClip(0,'Existing');session.undo();const before=state(session),revision=session.revision;
  const apply=Reflect.get(session,'applyFittingPositions');assert.equal(typeof apply,'function');assert.throws(()=>apply.call(session,[{uuid:middle.uuid,position:[0,1,0]},{uuid:'missing',position:[1,2,3]}]));assert.equal(state(session),before);assert.equal(session.revision,revision);session.redo();assert.equal(session.clips[0].name,'Existing');
 });
 await test('Translation-only fitting preserves authored quaternion sample bytes instead of normalizing unrelated rotation keys',()=>{
  const {root,middle}=fittingFixture(),clip=new THREE.AnimationClip('Rotation',2,[new THREE.QuaternionKeyframeTrack('Middle.quaternion',[0,2],[0,0,0,.99999994,0,0,.70710677,.70710677])]);
  const session=new RigEditSession(root,[clip]);session.enterEdit();const before=Array.from(session.clips[0].tracks[0].values);session.applyFittingPositions([{uuid:middle.uuid,position:[0,1,0]}]);assert.deepEqual(Array.from(session.clips[0].tracks[0].values),before);
 });
 await test('Fitting Worker transport transfers only copies, and byte-level in-place edits invalidate a review',async()=>{
  const {root,session,mesh}=fittingFixture(),before=state(session),buffer=mesh.geometry.getAttribute('position').array.buffer;
  const service=new RigFittingService({dispose(){},async request<T>(payload:unknown){const copy=structuredClone(payload,{transfer:transferBuffers(payload)}) as {root:ReturnType<typeof packRoot>};return analyzeRigFitting(unpackRoot(copy.root)) as T;}});
  const review=await service.analyze(session);assert.ok(buffer.byteLength>0);assert.equal(state(session),before);assert.ok(review.stillCurrent());assert.ok(review.proposals.some(p=>p.status==='suggested'));
  mesh.geometry.getAttribute('position').setX(0,10);assert.equal(review.stillCurrent(),false);service.cancel();
 });
 await test('Fitting cancels delayed results and propagates worker errors without an authored mutation',async()=>{
  const {session}=fittingFixture(),before=state(session);let release!:()=>void;
  const service=new RigFittingService({dispose(){},async request<T>(){await new Promise<void>(resolve=>release=resolve);return {proposals:[],vertices:0} as T;}});
  const pending=service.analyze(session);service.cancel();release();await assert.rejects(pending,/stale/i);assert.equal(state(session),before);
  const failed=new RigFittingService({dispose(){},request(){return Promise.reject(new Error('Actual compute failure'));}});await assert.rejects(failed.analyze(session),/compute failure/);assert.equal(state(session),before);
 });
 await test('Fitting review remains valid through presentation-only rotation and grounding while authored coordinates stay fixed',async()=>{
  const {root,session,middle}=fittingFixture(),wrapper=createPresentationWrapper(root),before=state(session);
  const service=new RigFittingService({dispose(){},async request<T>(payload:unknown){const {root:packet}=payload as {root:ReturnType<typeof packRoot>};wrapper.rotation.y=1;wrapper.position.y=5;wrapper.updateMatrixWorld(true);return analyzeRigFitting(unpackRoot(structuredClone(packet))) as T;}});
  const review=await service.analyze(session);assert.ok(review.stillCurrent());assert.equal(state(session),before);
  wrapper.rotation.y=2;wrapper.updateMatrixWorld(true);assert.ok(review.stillCurrent());
  session.applyFittingPositions([{uuid:middle.uuid,position:review.proposals.find(p=>p.uuid===middle.uuid)!.target}]);
  close(new THREE.Vector3().setFromMatrixPosition(documentMatrix(middle)).toArray(),[0,1,0]);session.undo();assert.equal(state(session),before);
 });
 await test('Fitting rejects an incomplete worker command instead of exposing an Apply action',async()=>{
  const {session}=fittingFixture(),before=state(session);const service=new RigFittingService({dispose(){},async request<T>(){return {proposals:[],vertices:72} as T;}});
  await assert.rejects(service.analyze(session),/omitted/);assert.equal(state(session),before);
 });
 for(const kind of ['joint-order','new-skeleton','inverse-bind','bind-matrix','reparent','local-transform','renamed-node'] as const)for(const phase of ['pending','ready'] as const)await test(`Fitting rejects ${kind} changes in ${phase} state without restoring or overwriting the changed model`,async()=>{
  const {root,session,mesh,middle,other}=fittingFixture(),revision=session.revision;let release!:()=>void;
  const service=new RigFittingService({dispose(){},async request<T>(payload:unknown){const {root:packet}=payload as {root:ReturnType<typeof packRoot>};const result=analyzeRigFitting(unpackRoot(structuredClone(packet)));if(phase==='pending')await new Promise<void>(resolve=>release=resolve);return result as T;}});
  const pending=service.analyze(session),review=phase==='ready'?await pending:null;
  if(kind==='joint-order')mesh.skeleton.bones.reverse();
  if(kind==='new-skeleton')mesh.skeleton=new THREE.Skeleton(mesh.skeleton.bones.slice(),mesh.skeleton.boneInverses.map(matrix=>matrix.clone()));
  if(kind==='inverse-bind')mesh.skeleton.boneInverses[1].elements[12]+=.2;
  if(kind==='bind-matrix')mesh.bindMatrix.elements[12]+=.2;
  if(kind==='reparent')other.add(middle);
  if(kind==='local-transform')middle.position.x+=.2;
  if(kind==='renamed-node')middle.name='Renamed';
  const changed=vertices(root),parent=middle.parent;
  if(phase==='pending'){release();await assert.rejects(pending,/stale/);}else assert.equal(review!.stillCurrent(),false);
  close(vertices(root),changed);assert.equal(middle.parent,parent);assert.equal(session.revision,revision);assert.equal(session.canUndo,false);
 });
 for(const kind of ['longitudinal','mismatched-current','inconsistent-offset','inconsistent-length'] as const)await test(`Fitting rejects ${kind} worker proposals before they become authored commands`,async()=>{
  const {root,session}=fittingFixture(),before=state(session);
  const service=new RigFittingService({dispose(){},async request<T>(payload:unknown){const {root:packet}=payload as {root:ReturnType<typeof packRoot>},result=analyzeRigFitting(unpackRoot(structuredClone(packet))),proposal=result.proposals.find(p=>p.name==='Middle')!;
   if(kind==='longitudinal'){proposal.target=[proposal.current[0],proposal.current[1]+100,proposal.current[2]];proposal.offset=100;}
   if(kind==='mismatched-current')proposal.current[0]+=.2;
   if(kind==='inconsistent-offset')proposal.offset+=10;
   if(kind==='inconsistent-length')proposal.length+=10;
   return result as T;
  }});await assert.rejects(service.analyze(session),/reference|lateral/);assert.equal(state(session),before);assert.equal(session.canUndo,false);
 });
 await test('Fitting rejects already-divergent live hierarchy or inverse binds before starting the worker',async()=>{
  for(const kind of ['reparent','inverse'] as const) {
   const {root,session,mesh,middle,other}=fittingFixture();if(kind==='reparent')other.add(middle);else mesh.skeleton.boneInverses[1].elements[12]+=.1;
   let requested=false;const service=new RigFittingService({dispose(){},async request<T>(){requested=true;return {} as T;}});const shape=vertices(root);
   await assert.rejects(service.analyze(session),/authored rest/);assert.equal(requested,false);close(vertices(root),shape);assert.equal(session.revision,0);
  }
 });
 await test('Pre-analysis transform and morph drift cannot reset an unselected joint or rest shape during partial fitting',async()=>{
  for(const kind of ['position','quaternion','scale','matrix','morph']) {
   const {root,mesh,middle}=fittingFixture();mesh.morphTargetInfluences=[0];const session=new RigEditSession(root,[]);session.enterEdit();
   if(kind==='position')middle.position.x+=.2;
   if(kind==='quaternion')middle.rotateZ(.2);
   if(kind==='scale')middle.scale.x=2;
   if(kind==='matrix'){middle.matrixAutoUpdate=false;middle.matrix.elements[12]+=.2;}
   if(kind==='morph')mesh.morphTargetInfluences[0]=.2;
   const shape=vertices(root),position=middle.position.toArray(),morph=mesh.morphTargetInfluences.slice(),matrix=middle.matrix.toArray();let requested=false;
   const service=new RigFittingService({dispose(){},async request<T>(payload:unknown){requested=true;const {root:packet}=payload as {root:ReturnType<typeof packRoot>};return analyzeRigFitting(unpackRoot(structuredClone(packet))) as T;}});
   await assert.rejects(service.analyze(session),/authored rest/);assert.equal(requested,false);close(vertices(root),shape);assert.deepEqual(middle.position.toArray(),position);assert.deepEqual(mesh.morphTargetInfluences,morph);assert.deepEqual(middle.matrix.toArray(),matrix);assert.equal(session.revision,0);assert.equal(session.canUndo,false);
  }
 });
 await test('Fitting preserves nonuniform rest, shared clip semantics and author extras through a real GLB reimport verifier',async()=>{
  const source=await fittingGlb(true),loader=new GLBLoaderService();
  try {
   const loaded=await loader.loadFromArrayBuffer(source,'fit.glb'),session=new RigEditSession(loaded.root,loaded.animations);session.enterEdit();
   const before=vertices(loaded.root),proposal=analyzeRigFitting(loaded.root).proposals.filter(p=>p.status==='suggested');assert.ok(proposal.length>=2);
   session.applyFittingPositions(proposal.map(p=>({uuid:p.uuid,position:p.target})));close(vertices(loaded.root),before);
   const packet=buildRigExportPacket(session,source),output=patchRigGlb(packet),expected=unpackRoot(structuredClone(packRoot(loaded.root)));
   const result=await verifyEditedRig(packet,output,expected,unpackClips(packClips(session.clips)),rigIdentities(loaded.root));assert.equal(result.status,'VERIFIED',result.reasons.join('; '));assert.equal(result.sourcePreserved,true);assert.equal(result.clipCount,loaded.animations.length);
  } finally{loader.dispose();}
 });
 await test('Fitting batch retains morphs, STEP and shared CUBICSPLINE samples under nonuniform authored ancestors',async()=>{
  const source=rigFixture({morphWeights:true,rootScale:[2,1,.75],anchorScale:[1.5,.75,2]}).buffer,loader=new GLBLoaderService();
  try {
   const loaded=await loader.loadFromArrayBuffer(source,'morph-fit.glb'),session=new RigEditSession(loaded.root,loaded.animations);session.enterEdit();const before=vertices(loaded.root);
   const changes=['Root','Child'].map(name=>{const bone=loaded.root.getObjectByName(name)!;return {uuid:bone.uuid,position:new THREE.Vector3().setFromMatrixPosition(documentMatrix(bone)).add(new THREE.Vector3(.05,0,.02)).toArray()};});
   const times=session.clips.map(clip=>clip.tracks.map(track=>Array.from(track.times)));session.applyFittingPositions(changes);close(vertices(loaded.root),before);assert.deepEqual(session.clips.map(clip=>clip.tracks.map(track=>Array.from(track.times))),times);
   const packet=buildRigExportPacket(session,source),output=patchRigGlb(packet),expected=unpackRoot(structuredClone(packRoot(loaded.root)));
   const result=await verifyEditedRig(packet,output,expected,unpackClips(packClips(session.clips)),rigIdentities(loaded.root));assert.equal(result.status,'VERIFIED',result.reasons.join('; '));assert.equal(result.clipCount,5);
  }finally{loader.dispose();}
 });
 return results;
}
