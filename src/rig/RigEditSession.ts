import * as THREE from 'three';
import { cloneClips, rebaseClips, retimeClip } from '../animation/ClipEdits';
import { documentMatrix } from '../viewer/AssetPresentation';
import { getSourceAssociation, getSourceDocument, getSourceAudit } from '../loaders/AssetRuntimeMetadata';

export type RigMode='inspect'|'edit'|'pose';
export type ChildPolicy='follow'|'hold';
export interface JointChange { position?:number[]; quaternion?:number[] }
export interface NodeRest { position:number[]; quaternion:number[]; scale:number[] }
export interface RigSnapshot {
  nodes:Map<string,NodeRest>;
  children:Map<string,string[]>;
  joints:Map<THREE.Skeleton,string[]>;
  geometries:Map<string,THREE.BufferGeometry>;
  geometryEdits:Map<string,{before:THREE.BufferGeometry;geometry:THREE.BufferGeometry}>;
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
  private created=new Set<string>();
  private ownedGeometries=new Set<THREE.BufferGeometry>();
  private appliedGeometryEdits=new Map<string,{before:THREE.BufferGeometry;geometry:THREE.BufferGeometry}>();
  private authored:RigSnapshot;
  private baseline:RigSnapshot;
  private past:RigSnapshot[]=[];
  private future:RigSnapshot[]=[];
  private signatures=new WeakMap<RigSnapshot,string>();
  private gesture:{base:RigSnapshot;past:RigSnapshot[];future:RigSnapshot[];revision:number}|null=null;
  mode:RigMode='inspect';
  revision=0;
  previewRevision=0;

  constructor(root:THREE.Group, clips:THREE.AnimationClip[],private geometrySource:(mesh:THREE.Mesh)=>THREE.BufferGeometry=mesh=>mesh.geometry,private applyGeometry:(mesh:THREE.Mesh,geometry:THREE.BufferGeometry)=>void=(mesh,geometry)=>{mesh.geometry=geometry;}) {
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
  /** Export identities are compiled separately from immutable importer associations. */
  exportNodeIndices():Map<string,number> {
    let next=getSourceDocument(this.root)?.nodes?.length??0;
    return new Map([...this.created].filter(id=>this.authored.nodes.has(id)).map(id=>[id,next++]));
  }
  isCreatedJoint(uuid:string) {return this.created.has(uuid);}
  get hasJointIndexEdits() {return this.authored.geometryEdits.size>0;}
  sourceNodeIndexFor(uuid:string) {const node=this.objects.get(uuid);return node&&getSourceAssociation(node)?.nodes;}

  private signature(snapshot:RigSnapshot) {
    let signature=this.signatures.get(snapshot);
    if(signature===undefined) {
      signature=JSON.stringify([[...snapshot.nodes],[...snapshot.children],[...snapshot.joints].map(([skin,joints])=>[skin.uuid,joints]),[...snapshot.geometryEdits].map(([id,edit])=>[id,edit.geometry.uuid]),[...snapshot.tips],snapshot.clips.map(clip=>[clip.name,clip.duration,clip.tracks.map(track=>[Array.from(track.times),Array.from(track.values)])])]);
      this.signatures.set(snapshot,signature);
    }
    return signature;
  }
  private capture(clips:THREE.AnimationClip[],tips:Map<string,number[]>):RigSnapshot {
    const active:THREE.Object3D[]=[];this.root.traverse(node=>{if(this.objects.has(node.uuid))active.push(node);});
    return {nodes:new Map(active.map(node=>[node.uuid,{position:node.position.toArray(),quaternion:node.quaternion.toArray(),scale:node.scale.toArray()}])),
      children:new Map(active.map(node=>[node.uuid,node.children.filter(child=>this.objects.has(child.uuid)).map(child=>child.uuid)])),
      joints:new Map([...this.skeletons].map(skin=>[skin,skin.bones.map(bone=>bone.uuid)])),
      geometries:new Map(active.filter((node):node is THREE.Mesh=>node instanceof THREE.Mesh).map(mesh=>[mesh.uuid,this.geometrySource(mesh)])),
      geometryEdits:new Map(this.authored?.geometryEdits??[]),
      skins:new Map([...this.skeletons].map(skeleton=>[skeleton,skeleton.boneInverses.map(matrix=>matrix.toArray())])),clips,tips:new Map([...tips].map(([id,point])=>[id,point.slice()])),
      morphs:new Map([...this.objects].filter(([,node])=>(node as THREE.Mesh).morphTargetInfluences).map(([uuid,node])=>[uuid,(node as THREE.Mesh).morphTargetInfluences!.slice()]))};
  }
  private captureSnapshot(state:RigSnapshot):RigSnapshot {
    return {nodes:new Map([...state.nodes].map(([id,rest])=>[id,structuredClone(rest)])),children:new Map([...state.children].map(([id,children])=>[id,children.slice()])),joints:new Map([...state.joints].map(([skin,joints])=>[skin,joints.slice()])),geometries:new Map(state.geometries),geometryEdits:new Map(state.geometryEdits),skins:new Map([...state.skins].map(([skin,inverses])=>[skin,inverses.map(matrix=>matrix.slice())])),clips:cloneClips(state.clips),tips:new Map([...state.tips].map(([id,point])=>[id,point.slice()])),morphs:new Map([...state.morphs].map(([id,values])=>[id,values.slice()]))};
  }
  private apply(snapshot:RigSnapshot) {
    const changes:{mesh:THREE.Mesh;geometry:THREE.BufferGeometry}[]=[];
    for(const id of new Set([...this.appliedGeometryEdits.keys(),...snapshot.geometryEdits.keys()])) {
      const old=this.appliedGeometryEdits.get(id),next=snapshot.geometryEdits.get(id);
      if(old?.geometry===next?.geometry)continue;
      const mesh=this.objects.get(id) as THREE.Mesh,expected=old?.geometry??next!.before,geometry=next?.geometry??old!.before;
      if(this.geometrySource(mesh)!==expected)throw new Error('Joint-index history conflicts with later geometry changes.');
      changes.push({mesh,geometry});
    }
    for(const [id,node] of this.objects)if(!snapshot.nodes.has(id))node.removeFromParent();
    for(const [id,children] of snapshot.children) {
      const parent=this.objects.get(id)!;
      if(children.join('|')!==parent.children.filter(child=>this.objects.has(child.uuid)).map(child=>child.uuid).join('|')) {
        for(const child of [...parent.children])if(this.objects.has(child.uuid))parent.remove(child);
        for(const child of children)parent.add(this.objects.get(child)!);
      }
    }
    for(const [uuid,rest] of snapshot.nodes) {
      const node=this.objects.get(uuid)!;
      node.position.fromArray(rest.position); node.quaternion.fromArray(rest.quaternion); node.scale.fromArray(rest.scale); node.updateMatrix();
    }
    for(const [skeleton,inverses] of snapshot.skins) this.setSkin(skeleton,snapshot.joints.get(skeleton)!.map(id=>this.bones.get(id)!),inverses.map(values=>new THREE.Matrix4().fromArray(values)));
    // Replay only a structural delta, never geometry captured by unrelated rig actions.
    for(const {mesh,geometry} of changes)this.applyGeometry(mesh,geometry);
    this.appliedGeometryEdits=new Map(snapshot.geometryEdits);
    for(const [uuid,values] of snapshot.morphs) (this.objects.get(uuid) as THREE.Mesh).morphTargetInfluences=values.slice();
    this.root.updateWorldMatrix(true,true); this.root.updateMatrixWorld(true);
    for(const skeleton of this.skeletons) skeleton.update();
  }
  private setSkin(skin:THREE.Skeleton,bones:THREE.Bone[],inverses:THREE.Matrix4[]) {
    const changed=skin.bones.length!==bones.length||skin.bones.some((bone,i)=>bone!==bones[i]);
    skin.bones=bones;skin.boneInverses=inverses;
    if(changed){skin.boneTexture?.dispose();skin.boneTexture=null;skin.init();}
  }
  private editableStructure() {
    if(this.mode!=='edit')throw new Error('Enter Edit Skeleton before changing joints.');
    if(this.isGestureActive)throw new Error('Finish the joint drag before changing joints.');
  }
  addJoint(parentUuid:string):string {
    this.editableStructure();
    const parent=this.bones.get(parentUuid);
    if(!parent||!this.authored.nodes.has(parentUuid))throw new Error('Select an active parent joint.');
    const skins=[...this.skeletons].filter(skin=>skin.bones.includes(parent));
    if(!skins.length)throw new Error('Parent joint belongs to no skin.');
    const bone=new THREE.Bone();let ordinal=1;
    while([...this.objects.values()].some(node=>node.name===`Joint_${ordinal}`))ordinal++;
    bone.name=`Joint_${ordinal}`;
    bone.position.fromArray(this.getTerminalTip(parentUuid)??[0,.2,0]);
    this.objects.set(bone.uuid,bone);this.bones.set(bone.uuid,bone);this.created.add(bone.uuid);
    this.transaction(()=>{
      parent.add(bone);this.root.updateWorldMatrix(true,true);
      const world=documentMatrix(bone);invertible(world);
      for(const skin of skins)this.setSkin(skin,[...skin.bones,bone],[...skin.boneInverses,world.clone().invert()]);
    });
    return bone.uuid;
  }
  deletionBlockReason(uuid:string):string|null {
    const bone=this.bones.get(uuid),source=getSourceDocument(this.root),index=bone&&getSourceAssociation(bone)?.nodes;
    if(!bone||!this.authored.nodes.has(uuid))return 'Select an active joint.';
    if(!(bone.parent instanceof THREE.Bone))return 'Root joints cannot be deleted.';
    if(bone.children.length)return 'Delete only a leaf joint without children or attachments.';
    if(index!==undefined&&(source?.skins??[]).some((skin:any)=>skin.skeleton===index))return 'The skin skeleton anchor cannot be deleted.';
    if(index!==undefined&&(source?.animations??[]).some((clip:any)=>clip.channels.some((channel:any)=>channel.target?.node===index)))return 'Animated joints cannot be deleted.';
    const rawWeights=getSourceAudit(this.root)?.rawSkinWeights;
    // Import normalizes weights. Unreadable/malformed source weights cannot prove zero influence.
    if(index!==undefined&&rawWeights&&(rawWeights.unreadableAccessors||rawWeights.invalidSumVertices||rawWeights.zeroWeightVertices))return 'Original skin weights need repair and reimport before safe joint deletion.';
    for(const clip of this.clips)for(const track of clip.tracks) {
      const binding=THREE.PropertyBinding.parseTrackName(track.name);
      if(THREE.PropertyBinding.findNode(this.root,binding.nodeName)===bone)return 'Animated joints cannot be deleted.';
    }
    for(const skin of this.skeletons)if(skin.bones.includes(bone)&&skin.bones.length===1)return 'The last skin joint cannot be deleted.';
    let reason:string|null=null;
    this.root.traverse(node=>{
      if(reason||!(node instanceof THREE.SkinnedMesh)||!node.skeleton.bones.includes(bone))return;
      const association=getSourceAssociation(node),primitive=source?.meshes?.[association?.meshes!]?.primitives?.[association?.primitives!];
      if(primitive?.extensions?.KHR_draco_mesh_compression||Object.keys(primitive?.attributes??{}).some(key=>/^(JOINTS|WEIGHTS)_[1-9]/.test(key))){reason='Compressed or additional skin influences require a separate deletion contract.';return;}
      const joints=node.geometry.getAttribute('skinIndex'),weights=node.geometry.getAttribute('skinWeight'),slot=node.skeleton.bones.indexOf(bone);
      if(!joints||!weights||joints.count!==weights.count||joints.itemSize!==4||weights.itemSize!==4){reason='Skin influence attributes are invalid.';return;}
      for(let v=0;v<joints.count;v++)for(let c=0;c<4;c++) {
        const joint=joints.getComponent(v,c),weight=weights.getComponent(v,c);
        if(!Number.isInteger(joint)||joint<0||joint>=node.skeleton.bones.length||!Number.isFinite(weight)||weight<0){reason='Skin influence attributes are invalid.';return;}
        if(joint===slot&&weight>0){reason='Weighted joints cannot be deleted.';return;}
      }
    });
    if(!reason)try{this.jointRewrites(bone);}catch(error){reason=error instanceof Error?error.message:String(error);}
    return reason;
  }
  private jointRewrites(bone:THREE.Bone) {
    const rewrites=new Map<THREE.BufferGeometry,Uint16Array>(),sourceRewrites=new Map<string,Uint16Array>(),meshes:THREE.SkinnedMesh[]=[];
    this.root.traverse(node=>{if(node instanceof THREE.SkinnedMesh)meshes.push(node);});
    for(const mesh of meshes) {
      const slot=mesh.skeleton.bones.indexOf(bone),attribute=mesh.geometry.getAttribute('skinIndex');
      const values=new Uint16Array(attribute.count*attribute.itemSize);
      for(let v=0;v<attribute.count;v++)for(let c=0;c<attribute.itemSize;c++) {
        const value=attribute.getComponent(v,c);values[v*attribute.itemSize+c]=slot<0?value:value===slot?0:value>slot?value-1:value;
      }
      const association=getSourceAssociation(mesh),key=association?.meshes===undefined?null:`${association.meshes}:${association.primitives}`;
      const existing=rewrites.get(mesh.geometry)??(key?sourceRewrites.get(key):undefined);
      if(existing&&!equalArray(Array.from(existing),Array.from(values),0))throw new Error('Shared geometry requires conflicting joint-index rewrites.');
      rewrites.set(mesh.geometry,values);if(key)sourceRewrites.set(key,values);
    }return {rewrites,meshes};
  }
  deleteJoint(uuid:string) {
    this.editableStructure();const reason=this.deletionBlockReason(uuid);if(reason)throw new Error(reason);
    const bone=this.bones.get(uuid)!;
    this.transaction(()=>{
      // A shared primitive can have several skins. All consumers must agree on its rewrite.
      const {rewrites,meshes}=this.jointRewrites(bone);
      const clones=new Map<THREE.BufferGeometry,THREE.BufferGeometry>();
      for(const mesh of meshes) {
        const values=rewrites.get(mesh.geometry)!,old=mesh.geometry.getAttribute('skinIndex');
        if(values.every((value,i)=>value===old.getComponent(Math.floor(i/old.itemSize),i%old.itemSize)))continue;
        let clone=clones.get(mesh.geometry);
        if(!clone){clone=mesh.geometry.clone();clone.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(values,old.itemSize));clones.set(mesh.geometry,clone);this.ownedGeometries.add(clone);}
        const previous=this.authored.geometryEdits.get(mesh.uuid),edit={before:previous?.before??this.geometrySource(mesh),geometry:clone};
        this.authored={...this.authored,geometryEdits:new Map(this.authored.geometryEdits).set(mesh.uuid,edit)};
        this.applyGeometry(mesh,clone);this.appliedGeometryEdits.set(mesh.uuid,edit);
      }
      bone.removeFromParent();
      for(const skin of this.skeletons) {
        const slot=skin.bones.indexOf(bone);if(slot<0)continue;
        this.setSkin(skin,skin.bones.filter((_,i)=>i!==slot),skin.boneInverses.filter((_,i)=>i!==slot));
      }
      const tips=new Map(this.authored.tips);tips.delete(uuid);this.authored={...this.authored,tips};
    });
  }
  dispose() {for(const geometry of this.ownedGeometries)geometry.dispose();this.ownedGeometries.clear();}
  restoreRest() { this.apply(this.authored);if(this.mode==='pose')this.previewRevision++; }
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
    const joint=this.bones.get(uuid); if(!joint||!this.authored.nodes.has(uuid)) throw new Error('Unknown joint.');
    if(change.position) assertFinite(change.position,3);
    if(change.quaternion) { assertFinite(change.quaternion,4); if(new THREE.Quaternion().fromArray(change.quaternion).length()<1e-8) throw new Error('Invalid joint rotation.'); }
    this.root.updateWorldMatrix(true,true);
    for(const [id,bone] of this.bones)if(this.authored.nodes.has(id))invertible(documentMatrix(bone));
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
        const old=this.authored.nodes.get(id);if(!old)continue;
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
  setBoneLength(uuid:string,childUuid:string|null,length:number,childPolicy:ChildPolicy='follow') {
    if(!(length>0) || !Number.isFinite(length)) throw new Error('Length must be finite and positive.');
    const joint=this.bones.get(uuid),child=childUuid && this.bones.get(childUuid);
    if(!joint||!this.authored.nodes.has(uuid)) throw new Error('Unknown joint.');
    if(!childUuid) {
      const direction=new THREE.Vector3().fromArray(this.getTerminalTip(uuid)??[0,1,0]);
      if(direction.length()<1e-8) throw new Error('Terminal guide has no direction.');
      this.setTerminalTip(uuid,direction.normalize().multiplyScalar(length).toArray()); return;
    }
    if(!child || child.parent!==joint || child.position.length()<1e-8) throw new Error('Select a direct child joint with a valid direction.');
    this.commitJoint(child.uuid,{position:child.position.clone().normalize().multiplyScalar(length).toArray()},childPolicy);
  }
  setTerminalTip(uuid:string,point:number[]) {
    assertFinite(point,3);
    const joint=this.bones.get(uuid); if(!joint||!this.authored.nodes.has(uuid)||joint.children.some(node=>node instanceof THREE.Bone)) throw new Error('Terminal guide requires an active leaf joint.');
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
  renameClip(index:number,name:string) {
    if(this.isGestureActive)throw new Error('Finish the joint drag before renaming a clip.');
    if(!Number.isInteger(index)||!this.clips[index])throw new Error('Unknown animation clip.');
    const trimmed=name.trim();
    if(!trimmed || trimmed.length>256 || /[\u0000-\u001f\u007f]/.test(trimmed))throw new Error('Clip name must contain 1–256 printable characters.');
    this.transaction(()=>{const clips=this.clips.slice();clips[index]=cloneClips([clips[index]])[0];clips[index].name=trimmed;this.authored={...this.authored,clips};});
  }
  previewPoseRotation(uuid:string,rotation:number[]) {
    if(this.mode!=='pose') throw new Error('Enter Pose Preview before posing.');
    assertFinite(rotation,4); const joint=this.bones.get(uuid);
    if(!joint||!this.authored.nodes.has(uuid)||new THREE.Quaternion().fromArray(rotation).length()<1e-8) throw new Error('Invalid preview joint rotation.');
    joint.quaternion.fromArray(rotation).normalize(); joint.updateMatrix(); this.root.updateMatrixWorld(true);
    this.previewRevision++;
  }
  undo() { if(this.isGestureActive)throw new Error('Finish the joint drag before Undo.');const state=this.past.at(-1); if(!state) return; this.apply(state);this.past.pop();this.future.push(this.authored);this.authored=state;if(this.mode==='pose')this.previewRevision++;this.revision++; }
  redo() { if(this.isGestureActive)throw new Error('Finish the joint drag before Redo.');const state=this.future.at(-1); if(!state) return;this.apply(state);this.future.pop();this.past.push(this.authored);this.authored=state;if(this.mode==='pose')this.previewRevision++;this.revision++; }
  reset() { if(this.isGestureActive)throw new Error('Finish the joint drag before Reset.');if(!this.hasEdits) {this.restoreRest(); return;}this.apply(this.baseline);this.past.push(this.authored);this.future=[];this.authored=this.baseline;if(this.mode==='pose')this.previewRevision++;this.revision++; }
}
