import assert from 'node:assert/strict';
import * as THREE from 'three';
import {RigEditSession} from './RigEditSession';

export function runRigMemoryRegressionTests(){
 const results:{name:string;passed:boolean;actual?:unknown;expected?:unknown}[]=[];
 const root=new THREE.Group(),bones=Array.from({length:64},(_,i)=>{const bone=new THREE.Bone();bone.name=`Joint_${i}`;root.add(bone);return bone;});
 const times=Float32Array.from({length:2000},(_,i)=>i/30),values=Float32Array.from({length:6000},(_,i)=>Math.sin(i*.031)*.03);
 const clip=new THREE.AnimationClip('Dense animation',times.at(-1)!,bones.map(bone=>new THREE.VectorKeyframeTrack(`${bone.name}.position`,times.slice(),values.slice())));
 const session=new RigEditSession(root,[clip]);session.enterEdit();const initial=session.snapshot(),unaffected=session.clips[0].tracks[1],changed=session.clips[0].tracks[0];
 try{
  for(let i=1;i<=40;i++)session.commitJoint(bones[0].uuid,{quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),i*.012).toArray()});
  assert.equal(session.clips[0].tracks[1],unaffected,'Unchanged tracks must share immutable storage');
  assert.equal(session.clips[0].tracks[0].times,changed.times,'Rest rotation never changes sample times');
  assert.notEqual(session.clips[0].tracks[0].values,changed.values,'Changed values must own their storage');
  assert.ok(session.getHistoryMemoryUsage().bytes<16*1024*1024,'Small repeated edits must not retain expanded copies of every animation');
  const final=session.snapshot();let undos=0,redos=0;
  while(session.canUndo){session.undo();undos++;}assert.equal(undos,40);assert.equal(session.hasEdits,false);
  for(let i=0;i<initial.clips[0].tracks.length;i++)assert.deepEqual(session.clips[0].tracks[i].values,initial.clips[0].tracks[i].values);
  while(session.canRedo){session.redo();redos++;}assert.equal(redos,40);assert.deepEqual(session.clips[0].tracks[0].values,final.clips[0].tracks[0].values);
  results.push({name:'Forty dense-animation joint rotations share untouched streams and preserve exact Undo/Redo within the default budget',passed:true});
 }catch(error){results.push({name:'Forty dense-animation joint rotations share untouched streams and preserve exact Undo/Redo within the default budget',passed:false,actual:String(error),expected:'40 exact undoable edits'});}
 return results;
}
