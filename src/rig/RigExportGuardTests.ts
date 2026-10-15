import {GLBLoaderService} from '../loaders/GLBLoaderService';
import {disposeModelResources} from '../loaders/ModelResources';
import {rigFixture} from '../../tests/rig-fixtures';
import {RigEditSession} from './RigEditSession';
import {RigExportService} from './RigExportService';
import * as THREE from 'three';

/** Isolate freshness guards from the independent deformation verifier, tested separately. */
export async function runRigExportGuardTests(){
 const loader=new GLBLoaderService(),fixture=rigFixture(),loaded=await loader.loadFromArrayBuffer(fixture.buffer);
 const service=new RigExportService();
 try{
  Reflect.set(service,'compute',{request:async()=>({buffer:fixture.buffer.slice(0),verification:{status:'VERIFIED',reasons:[]}}),dispose:()=>{}});
  const session=new RigEditSession(loaded.root,loaded.animations);session.enterEdit();
  const result=await service.export(session,fixture.buffer,'guard.glb'),clip=session.clips[0],track=clip.tracks[0];
  let passed=result.stillCurrent();const details:Record<string,boolean>={};
  const check=(name:string,change:()=>()=>void)=>{const restore=change();details[name]=!result.stillCurrent();restore();passed=passed&&details[name]&&result.stillCurrent();};
  check('sample',()=>{const old=track.values[0];track.values[0]+=1;return()=>{track.values[0]=old;};});
  check('time',()=>{const old=track.times[1];track.times[1]+=.1;return()=>{track.times[1]=old;};});
  check('name',()=>{const old=clip.name;clip.name+='changed';return()=>{clip.name=old;};});
  check('duration',()=>{const old=clip.duration;clip.duration+=1;return()=>{clip.duration=old;};});
  check('interpolation',()=>{const old=(track as any).createInterpolant;track.setInterpolation(THREE.InterpolateDiscrete);return()=>{(track as any).createInterpolant=old;};});
  return [{name:'Review rig export exact freshness guard detects raw animation edits without a session revision',passed,actual:details,expected:'Samples, times, name, duration, interpolation all invalidate; exact restoration recovers'}];
 }finally{service.cancelActive();disposeModelResources(loaded.root);loader.dispose();}
}
