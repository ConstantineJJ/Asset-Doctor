import * as THREE from 'three';
import { cloneClips, rebaseClips, retimeClip } from '../animation/ClipEdits';
import { documentMatrix } from '../viewer/AssetPresentation';
import { getSourceAssociation, getSourceDocument } from '../loaders/AssetRuntimeMetadata';

export type RigMode='inspect'|'edit'|'pose';
export type ChildPolicy='follow'|'hold';
export interface JointChange { position?:number[]; quaternion?:number[] }
export interface NodeRest { position:number[]; quaternion:number[]; scale:number[] }
export interface RigSnapshot {
  nodes:Map<string,NodeRest>;
  skins:Map<THREE.Skeleton,number[][]>;
  clips:THREE.AnimationClip[];
  tips:Map<string,number[]>;
  morphs:Map<string,number[]>;
}

function assertFinite(values:number[], count:number) {
  if(values.length!==count || values.some(value=>!Number.isFinite(value))) throw new Error('Joint values must be finite.');
}
function invertible(matrix:THREE.Matrix4) {
  const determinant=matrix.determinant();
  if(!Number.isFinite(determinant) || Math.abs(determinant)<1e-10) throw new Error('Singular or nearly singular rig transform.');
}
function equalArray(a:number[],b:number[],epsilon=1e-7) { return a.every((value,i)=>Math.abs(value-b[i])<=epsilon); }

/** Authoritative rest and clips are independent of mixer caches and transient pose. */
export class RigEditSession {
  readonly root:THREE.Group;
  private objects=new Map<string,THREE.Object3D>();
  private bones=new Map<string,THREE.Bone>();
  private skeletons=new Set<THREE.Skeleton>();
  private authored:RigSnapshot;
  private baseline:RigSnapshot;
  private past:RigSnapshot[]=[];
  private future:RigSnapshot[]=[];
  private signatures=new WeakMap<RigSnapshot,string>();
  private gesture:{base:RigSnapshot;past:RigSnapshot[];future:RigSnapshot[];revision:number}|null=null;
  mode:RigMode='inspect';
  revision=0;

  constructor(root:THREE.Group, clips:THREE.AnimationClip[]) {
    this.root=root;
    root.traverse(node=>{
      this.objects.set(node.uuid,node);
      if(node instanceof THREE.Bone) this.bones.set(node.uuid,node);
      if(node instanceof THREE.SkinnedMesh) this.skeletons.add(node.skeleton);
    });
    const tips=new Map<string,number[]>(),document=getSourceDocument(root);
    for(const [uuid,bone] of this.bones) {
      const index=getSourceAssociation(bone)?.nodes,tip=index===undefined?undefined:document?.nodes?.[index]?.extras?.assetDoctorRigTip;
      if(tip?.version===1&&Array.isArray(tip.point)&&tip.point.length===3&&tip.point.every(Number.isFinite)&&Object.keys(tip).every(key=>['version','point'].includes(key)))tips.set(uuid,tip.point.slice());
    }
    this.authored=this.capture(cloneClips(clips),tips);
    this.baseline=this.authored;
  }
  get clips() { return this.authored.clips; }
  get hasSkeleton() { return this.skeletons.size>0; }
  get isGestureActive() {return this.gesture!==null;}
  get canUndo() { return this.past.length>0; }
  get canRedo() { return this.future.length>0; }
  get hasEdits() { return this.signature(this.authored)!==this.signature(this.baseline); }
  getRest(uuid:string) { const rest=this.authored.nodes.get(uuid); return rest && structuredClone(rest); }
  getTerminalTip(uuid:string) { return this.authored.tips.get(uuid)?.slice(); }
  snapshot():RigSnapshot { return this.captureSnapshot(this.authored); }
  originalSnapshot():RigSnapshot {return this.captureSnapshot(this.baseline);}

  private signature(snapshot:RigSnapshot) {
    let signature=this.signatures.get(snapshot);
    if(signature===undefined) {
      signature=JSON.stringify([[...snapshot.nodes],[...snapshot.tips],snapshot.clips.map(clip=>[clip.duration,clip.tracks.map(track=>[Array.from(track.times),Array.from(track.values)])])]);
      this.signatures.set(snapshot,signature);
    }
    return signature;
  }
  private capture(clips:THREE.AnimationClip[],tips:Map<string,number[]>):RigSnapshot {
    return {nodes:new Map([...this.objects].map(([uuid,node])=>[uuid,{position:node.position.toArray(),quaternion:node.quaternion.toArray(),scale:node.scale.toArray()}])),
      skins:new Map([...this.skeletons].map(skeleton=>[skeleton,skeleton.boneInverses.map(matrix=>matrix.toArray())])),clips,tips:new Map([...tips].map(([id,point])=>[id,point.slice()])),
      morphs:new Map([...this.objects].filter(([,node])=>(node as THREE.Mesh).morphTargetInfluences).map(([uuid,node])=>[uuid,(node as THREE.Mesh).morphTargetInfluences!.slice()]))};
  }
  private captureSnapshot(state:RigSnapshot):RigSnapshot {
    return {nodes:new Map([...state.nodes].map(([id,rest])=>[id,structuredClone(rest)])),skins:new Map([...state.skins].map(([skin,inverses])=>[skin,inverses.map(matrix=>matrix.slice())])),clips:cloneClips(state.clips),tips:new Map([...state.tips].map(([id,point])=>[id,point.slice()])),morphs:new Map([...state.morphs].map(([id,values])=>[id,values.slice()]))};
  }
  private apply(snapshot:RigSnapshot) {
    for(const [uuid,rest] of snapshot.nodes) {
      const node=this.objects.get(uuid)!;
      node.position.fromArray(rest.position); node.quaternion.fromArray(rest.quaternion); node.scale.fromArray(rest.scale); node.updateMatrix();
    }
    for(const [skeleton,inverses] of snapshot.skins) skeleton.boneInverses=inverses.map(values=>new THREE.Matrix4().fromArray(values));
    for(const [uuid,values] of snapshot.morphs) (this.objects.get(uuid) as THREE.Mesh).morphTargetInfluences=values.slice();
    this.root.updateWorldMatrix(true,true); this.root.updateMatrixWorld(true);
    for(const skeleton of this.skeletons) skeleton.update();
  }
  restoreRest() { this.apply(this.authored); }
  enterEdit() { this.restoreRest(); this.mode='edit'; }
  enterPose() { this.restoreRest(); this.mode='pose'; }

  beginGesture() {
    if(this.gesture) throw new Error('A rig gesture is already active.');
    this.gesture={base:this.authored,past:this.past.slice(),future:this.future.slice(),revision:this.revision};
  }
  previewJoint(uuid:string,change:JointChange,policy:ChildPolicy) {
    if(!this.gesture) throw new Error('No rig gesture is active.');
    const gesture=this.gesture;
    this.authored=gesture.base; this.past=gesture.past.slice(); this.future=gesture.future.slice(); this.revision=gesture.revision;
    this.restoreRest();
    try {this.commitJoint(uuid,change,policy);} finally {this.past=gesture.past.slice();this.future=gesture.future.slice();this.revision=gesture.revision;}
  }
  finishGesture() {
    if(!this.gesture) return;
    const gesture=this.gesture; this.gesture=null;
    if(this.signature(this.authored)!==this.signature(gesture.base)) {this.past.push(gesture.base);this.future=[];this.revision++;}
  }
  cancelGesture() {
    if(!this.gesture) return;
    const gesture=this.gesture;this.gesture=null;this.authored=gesture.base;this.past=gesture.past;this.future=gesture.future;this.revision=gesture.revision;this.restoreRest();
  }

  private transaction(update:()=>void) {
    const live=this.capture(this.authored.clips,this.authored.tips), previous=this.authored;
    try {
      this.restoreRest(); update();
      this.authored=this.capture(this.authored.clips,this.authored.tips);
      if(this.signature(previous)===this.signature(this.authored)) { this.authored=previous; return; }
      this.past.push(previous); if(this.past.length>100) this.past.shift();
      this.future=[]; this.revision++;
    } catch(error) { this.authored=previous; this.apply(live); throw error; }
  }
  commitJoint(uuid:string,change:JointChange,childPolicy:ChildPolicy='follow') {
    if(this.mode!=='edit') throw new Error('Enter Edit Skeleton before changing authored rest.');
    const joint=this.bones.get(uuid); if(!joint) throw new Error('Unknown joint.');
    if(change.position) assertFinite(change.position,3);
    if(change.quaternion) { assertFinite(change.quaternion,4); if(new THREE.Quaternion().fromArray(change.quaternion).length()<1e-8) throw new Error('Invalid joint rotation.'); }
    this.root.updateWorldMatrix(true,true);
    for(const bone of this.bones.values()) invertible(documentMatrix(bone));
    this.transaction(()=>{
      const oldWorld=new Map([...this.bones].map(([id,bone])=>[id,documentMatrix(bone)]));
      const children=joint.children.filter(child=>!child.name.startsWith('__ascope_internal'));
      const childWorld=new Map(children.map(child=>[child.uuid,documentMatrix(child)]));
      if(change.position) joint.position.fromArray(change.position);
      if(change.quaternion) joint.quaternion.fromArray(change.quaternion).normalize();
      joint.updateMatrix(); this.root.updateWorldMatrix(true,true);
      if(childPolicy==='hold') {
        const parentWorld=documentMatrix(joint); invertible(parentWorld);
        for(const child of children) {
          if(!(child instanceof THREE.Bone)) throw new Error('Holding a non-joint attachment is unsupported; use Follow chain.');
          const local=parentWorld.clone().invert().multiply(childWorld.get(child.uuid)!);
          const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
          local.decompose(position,rotation,scale);
          const rebuilt=new THREE.Matrix4().compose(position,rotation,scale);
          if(!equalArray(local.toArray(),rebuilt.toArray(),1e-6) || !equalArray(scale.toArray(),child.scale.toArray(),1e-6)) throw new Error('Holding children requires shear or scale changes; use Follow chain.');
          child.position.copy(position); child.quaternion.copy(rotation); child.updateMatrix();
        }
        this.root.updateWorldMatrix(true,true);
      }
      const changes=new Map();
      for(const [id,bone] of this.bones) {
        const old=this.authored.nodes.get(id)!;
        if(equalArray(old.position,bone.position.toArray()) && equalArray(old.quaternion,bone.quaternion.toArray())) continue;
        const rotation=bone.quaternion.clone().multiply(new THREE.Quaternion().fromArray(old.quaternion).invert());
        changes.set(id,{oldPosition:new THREE.Vector3().fromArray(old.position),newPosition:bone.position.clone(),rotation});
      }
      for(const skeleton of this.skeletons) skeleton.boneInverses=skeleton.bones.map((bone,i)=>{
        const world=documentMatrix(bone); invertible(world);
        return world.invert().multiply(oldWorld.get(bone.uuid)!).multiply(skeleton.boneInverses[i]);
      });
      this.authored={...this.authored,clips:rebaseClips(this.root,this.authored.clips,changes)};
    });
  }
  setBoneLength(uuid:string,childUuid:string|null,length:number) {
    if(!(length>0) || !Number.isFinite(length)) throw new Error('Length must be finite and positive.');
    const joint=this.bones.get(uuid),child=childUuid && this.bones.get(childUuid);
    if(!joint) throw new Error('Unknown joint.');
    if(!childUuid) {
      const direction=new THREE.Vector3().fromArray(this.getTerminalTip(uuid)??[0,1,0]);
      if(direction.length()<1e-8) throw new Error('Terminal guide has no direction.');
      this.setTerminalTip(uuid,direction.normalize().multiplyScalar(length).toArray()); return;
    }
    if(!child || child.parent!==joint || child.position.length()<1e-8) throw new Error('Select a direct child joint with a valid direction.');
    this.commitJoint(child.uuid,{position:child.position.clone().normalize().multiplyScalar(length).toArray()});
  }
  setTerminalTip(uuid:string,point:number[]) {
    assertFinite(point,3);
    const joint=this.bones.get(uuid); if(!joint || joint.children.some(node=>node instanceof THREE.Bone)) throw new Error('Terminal guide requires a leaf joint.');
    if(this.mode!=='edit') throw new Error('Enter Edit Skeleton before authoring a guide.');
    const source=getSourceDocument(this.root),index=getSourceAssociation(joint)?.nodes;
    const definition=index===undefined?undefined:source?.nodes?.[index];
    if(definition && Object.hasOwn(definition,'extras')) {
      const extras=definition.extras;
      const tip=extras?.assetDoctorRigTip,known=tip?.version===1&&Array.isArray(tip.point)&&tip.point.length===3&&tip.point.every(Number.isFinite)&&Object.keys(tip).every(key=>['version','point'].includes(key));
      if(!extras || typeof extras!=='object' || Array.isArray(extras) || (Object.hasOwn(extras,'assetDoctorRigTip')&&!known)) throw new Error('Original extras cannot accept a terminal guide without loss.');
    }
    this.transaction(()=>{this.authored={...this.authored,tips:new Map(this.authored.tips).set(uuid,point.slice())};});
  }
  setClipDuration(index:number,seconds:number) {
    if(this.isGestureActive)throw new Error('Finish the joint drag before changing clip duration.');
    if(!this.clips[index]) throw new Error('Unknown animation clip.');
    const changed=retimeClip(this.clips[index],seconds);
    this.transaction(()=>{const clips=this.clips.slice(); clips[index]=changed; this.authored={...this.authored,clips};});
  }
  previewPoseRotation(uuid:string,rotation:number[]) {
    if(this.mode!=='pose') throw new Error('Enter Pose Preview before posing.');
    assertFinite(rotation,4); const joint=this.bones.get(uuid);
    if(!joint || new THREE.Quaternion().fromArray(rotation).length()<1e-8) throw new Error('Invalid preview joint rotation.');
    joint.quaternion.fromArray(rotation).normalize(); joint.updateMatrix(); this.root.updateMatrixWorld(true);
  }
  undo() { if(this.isGestureActive)throw new Error('Finish the joint drag before Undo.');const state=this.past.pop(); if(!state) return; this.future.push(this.authored); this.authored=state; this.restoreRest(); this.revision++; }
  redo() { if(this.isGestureActive)throw new Error('Finish the joint drag before Redo.');const state=this.future.pop(); if(!state) return; this.past.push(this.authored); this.authored=state; this.restoreRest(); this.revision++; }
  reset() { if(this.isGestureActive)throw new Error('Finish the joint drag before Reset.');if(!this.hasEdits) {this.restoreRest(); return;} this.past.push(this.authored); this.future=[]; this.authored=this.baseline; this.restoreRest(); this.revision++; }
}
