import * as THREE from 'three';
import { GLBLoaderService } from '../loaders/GLBLoaderService';
import { getSourceAssociation } from '../loaders/AssetRuntimeMetadata';
import { disposeModelResources } from '../loaders/ModelResources';
import { isGltfCubic } from '../animation/ClipEdits';
import { mapChannels,parseGlb,cleanLegacyExtras,sourceNodeIndex,type RigExportPacket } from './RigGlbPatch';

export interface RigVerification {status:'VERIFIED'|'REGRESSION';reasons:string[];meshCount:number;clipCount:number;sampledVertices:number;phases:number[];sourcePreserved:boolean}
export interface RigIdentity {uuid:string;node?:number;mesh?:number;primitive?:number;ancestor?:number}
export function rigIdentities(root:THREE.Group):RigIdentity[] {
  const identities:RigIdentity[]=[];
  root.traverse(node=>{
    const association=getSourceAssociation(node);
    if(association)identities.push({uuid:node.uuid,node:association.nodes,mesh:association.meshes,primitive:association.primitives,ancestor:sourceNodeIndex(node)});
  });return identities;
}
function key(identity:RigIdentity) {return identity.node!==undefined?`node:${identity.node}`:identity.mesh!==undefined?`node:${identity.ancestor}/mesh:${identity.mesh}/primitive:${identity.primitive}`:null;}
function canonical(value:any):string {
  const sorted=(item:any):any=>Array.isArray(item)?item.map(sorted):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(name=>[name,sorted(item[name])])):item;
  return JSON.stringify(sorted(value));
}
function close(a:ArrayLike<number>,b:ArrayLike<number>,context:string,epsilon=2e-5) {
  if(a.length!==b.length)throw new Error(`${context}: sample count differs.`);
  for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i])||!Number.isFinite(b[i])||Math.abs(a[i]-b[i])>epsilon*Math.max(1,Math.abs(a[i]),Math.abs(b[i])))throw new Error(`${context}: value ${i} differs (${a[i]} / ${b[i]}).`);
}
function restoreField(target:any,source:any,field:string) {if(Object.hasOwn(source,field))target[field]=structuredClone(source[field]);else delete target[field];}

/** Reverse only authorized fields, then compare the whole source JSON and binary prefix. */
export function verifyRigSourcePreservation(packet:RigExportPacket,output:ArrayBuffer) {
  const source=parseGlb(packet.source),candidate=parseGlb(output),expected=structuredClone(source.document),actual=structuredClone(candidate.document);
  close(candidate.binary.subarray(0,source.binary.length),source.binary,'Original GLB binary bytes',0);
  const verifyStream=(index:number,oldIndex:number|undefined,values:Float32Array|Uint32Array|Uint16Array,type:string,count:number)=>{
    const definition=candidate.document.accessors[index],old=oldIndex===undefined?{}:source.document.accessors[oldIndex],view=candidate.document.bufferViews[definition?.bufferView];
    const componentType=values instanceof Float32Array?5126:values instanceof Uint16Array?5123:5125;
    if(!definition||!view||definition.componentType!==componentType||definition.type!==type||definition.count!==count||definition.normalized||definition.sparse||(definition.byteOffset??0)!==0||view.buffer!==0||view.byteStride||view.extensions||(view.byteOffset??0)<source.binary.length||view.byteLength!==values.byteLength)throw new Error('Serialized replacement accessor descriptor differs.');
    const authorFields=(accessor:any)=>{
      const fields=structuredClone(accessor);
      for(const field of ['bufferView','byteOffset','componentType','type','count','sparse','normalized','min','max'])delete fields[field];
      if(fields.extensions && Object.keys(fields.extensions).length===0)delete fields.extensions;
      cleanLegacyExtras({extras:fields.extras});return fields;
    };
    if(canonical(authorFields(definition))!==canonical(authorFields(old)))throw new Error('Active accessor author metadata differs.');
    const oldView=old.bufferView===undefined?{}:source.document.bufferViews[old.bufferView];
    const authorView=(value:any)=>{
      const fields:any={};for(const field of ['name','extras'])if(Object.hasOwn(value,field))fields[field]=structuredClone(value[field]);
      cleanLegacyExtras(fields);return fields;
    };
    if(canonical(authorView(view))!==canonical(authorView(oldView)))throw new Error('Active buffer view author metadata differs.');
    const expectedBytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength),offset=view.byteOffset??0;
    close(candidate.binary.subarray(offset,offset+view.byteLength),expectedBytes,'Serialized replacement bytes',0);
    if(type==='SCALAR') {
      let min=Infinity,max=-Infinity;for(const value of values){min=Math.min(min,value);max=Math.max(max,value);}
      if(canonical(definition.min)!==canonical([min])||canonical(definition.max)!==canonical([max]))throw new Error('Replacement accessor bounds differ.');
    } else if(Object.hasOwn(definition,'min')||Object.hasOwn(definition,'max'))throw new Error('Unexpected replacement accessor bounds.');
  };
  for(const skin of packet.skins)if(skin.changed)verifyStream(candidate.document.skins[skin.index].inverseBindMatrices,source.document.skins[skin.index].inverseBindMatrices,new Float32Array(skin.inverses.flat()),'MAT4',skin.inverses.length);
  for(const channel of packet.channels)if(channel.changed) {
    const sourceAnimation=source.document.animations[channel.animation],animation=candidate.document.animations[channel.animation];
    const old=sourceAnimation.samplers[sourceAnimation.channels[channel.channel].sampler],next=animation.samplers[animation.channels[channel.channel].sampler];
    verifyStream(next.input,old.input,channel.times,'SCALAR',channel.times.length);
    const type=source.document.accessors[old.output].type,size=type==='SCALAR'?1:type==='VEC3'?3:4;
    verifyStream(next.output,old.output,channel.values,type,channel.values.length/size);
  }
  for(const repair of packet.repairs) {
    const before=source.document.meshes[repair.mesh].primitives[repair.primitive],after=candidate.document.meshes[repair.mesh].primitives[repair.primitive];
    if(repair.index)verifyStream(after.indices,before.indices,repair.index,'SCALAR',repair.index.length);
    for(const [semantic,attribute] of Object.entries(repair.attributes)) {
      const values=semantic==='JOINTS_0'?Uint16Array.from(attribute.values):attribute.values;
      verifyStream(after.attributes[semantic],before.attributes[semantic],values,`VEC${attribute.size}`,values.length/attribute.size);
    }
  }
  for(const node of packet.nodes) {
    const definition=actual.nodes[node.index],before=expected.nodes[node.index];
    if(node.changed)for(const field of ['matrix','translation','rotation','scale'])restoreField(definition,before,field);
    if(node.tip) {
      const extras=definition.extras;
      if(canonical(extras?.assetDoctorRigTip)!==canonical({version:1,point:node.tip}))throw new Error('Terminal guide differs.');
      if(before.extras && typeof before.extras==='object' && Object.hasOwn(before.extras,'assetDoctorRigTip'))extras.assetDoctorRigTip=structuredClone(before.extras.assetDoctorRigTip);else delete extras.assetDoctorRigTip;
      if(!Object.hasOwn(before,'extras')&&Object.keys(extras).length===0)delete definition.extras;
    }
  }
  for(const skin of packet.skins)if(skin.changed)restoreField(actual.skins[skin.index],expected.skins[skin.index],'inverseBindMatrices');
  for(const channel of packet.channels)if(channel.changed)actual.animations[channel.animation].channels[channel.channel].sampler=expected.animations[channel.animation].channels[channel.channel].sampler;
  for(let i=0;i<(expected.animations?.length??0);i++)actual.animations[i].samplers=actual.animations[i].samplers.slice(0,expected.animations[i].samplers.length);
  for(const repair of packet.repairs) {
    const definition=actual.meshes[repair.mesh].primitives[repair.primitive],before=expected.meshes[repair.mesh].primitives[repair.primitive];
    if(repair.index)restoreField(definition,before,'indices');
    for(const semantic of Object.keys(repair.attributes))restoreField(definition.attributes,before.attributes,semantic);
  }
  for(let i=0;i<(expected.images?.length??0);i++)if(expected.images[i].uri?.startsWith('data:')) {
    const image=actual.images[i],view=actual.bufferViews[image.bufferView];
    const match=/^data:([^;,]+);base64,(.*)$/s.exec(expected.images[i].uri)!;
    const bytes=Uint8Array.from(atob(match[2]),character=>character.charCodeAt(0));
    if(image.mimeType!==match[1])throw new Error('Embedded image MIME differs.');
    close(candidate.binary.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength),bytes,'Embedded image bytes',0);
    for(const field of ['uri','bufferView','mimeType'])restoreField(image,expected.images[i],field);
  }
  actual.accessors=actual.accessors.slice(0,expected.accessors?.length??0);
  actual.bufferViews=actual.bufferViews.slice(0,expected.bufferViews?.length??0);
  if(!Object.hasOwn(expected,'accessors'))delete actual.accessors;
  if(!Object.hasOwn(expected,'bufferViews'))delete actual.bufferViews;
  actual.buffers[0].byteLength=expected.buffers[0].byteLength;
  cleanLegacyExtras(expected);cleanLegacyExtras(actual);
  if(canonical(actual)!==canonical(expected))throw new Error('An untouched source JSON field differs.');
}

function objectMap(root:THREE.Group,identities:RigIdentity[]) {
  const result=new Map<string,THREE.Object3D>();
  for(const identity of identities) {
    const id=key(identity),object=root.getObjectByProperty('uuid',identity.uuid);
    if(id && object) {if(result.has(id))throw new Error('Canonical node/primitive mapping is ambiguous.');result.set(id,object);}
  }return result;
}
function compareGeometry(a:THREE.BufferGeometry,b:THREE.BufferGeometry) {
  if(canonical(Object.keys(a.attributes).sort())!==canonical(Object.keys(b.attributes).sort()))throw new Error('Geometry attribute set differs.');
  const compare=(left:THREE.BufferAttribute|THREE.InterleavedBufferAttribute,right:THREE.BufferAttribute|THREE.InterleavedBufferAttribute,context:string)=>{
    if(!left || !right || left.itemSize!==right.itemSize || left.count!==right.count)throw new Error(`${context}: attribute shape differs.`);
    for(let vertex=0;vertex<left.count;vertex++)for(let component=0;component<left.itemSize;component++)close([left.getComponent(vertex,component)],[right.getComponent(vertex,component)],context,context==='index'?0:1e-6);
  };
  for(const name of Object.keys(a.attributes))compare(a.getAttribute(name),b.getAttribute(name),name);
  if(Boolean(a.index)!==Boolean(b.index))throw new Error('Index presence differs.');
  if(a.index&&b.index)compare(a.index,b.index,'index');
  if(canonical(Object.keys(a.morphAttributes).sort())!==canonical(Object.keys(b.morphAttributes).sort()) || a.morphTargetsRelative!==b.morphTargetsRelative)throw new Error('Morph target set differs.');
  for(const [name,list] of Object.entries(a.morphAttributes)) {
    const other=b.morphAttributes[name as keyof typeof b.morphAttributes]!;
    if(list.length!==other.length)throw new Error('Morph target count differs.');
    list.forEach((attribute,index)=>compare(attribute,other[index],`morph ${name}`));
  }
}

export async function verifyEditedRig(packet:RigExportPacket,output:ArrayBuffer,expectedRoot:THREE.Group,expectedClips:THREE.AnimationClip[],identities:RigIdentity[],resourceBaseUrl?:string):Promise<RigVerification> {
  const report:RigVerification={status:'REGRESSION',reasons:[],meshCount:0,clipCount:0,sampledVertices:0,phases:[0,.13,.33,.61,.87,1],sourcePreserved:false};
  const loader=new GLBLoaderService(resourceBaseUrl);let actualRoot:THREE.Group|undefined;
  try {
    verifyRigSourcePreservation(packet,output);report.sourcePreserved=true;
    const loaded=await loader.loadFromArrayBuffer(output,'edited-rig.glb');actualRoot=loaded.root;report.clipCount=loaded.animations.length;
    const actual=objectMap(actualRoot,rigIdentities(actualRoot)),expected=objectMap(expectedRoot,identities);
    if(canonical([...actual.keys()].sort())!==canonical([...expected.keys()].sort()))throw new Error('Canonical node/primitive set differs.');
    expectedRoot.traverse(node=>{node.matrixAutoUpdate=true;node.updateMatrix();});expectedRoot.updateMatrixWorld(true);actualRoot.updateMatrixWorld(true);
    const meshPairs:[THREE.Mesh,THREE.Mesh][]=[];
    for(const [id,left] of expected) {
      const right=actual.get(id)!;
      const rotation=right.quaternion.toArray();
      if(left.quaternion.dot(right.quaternion)<0)for(let i=0;i<rotation.length;i++)rotation[i]=-rotation[i];
      close(left.position.toArray(),right.position.toArray(),`${id} rest translation`);close(left.quaternion.toArray(),rotation,`${id} rest rotation`);close(left.scale.toArray(),right.scale.toArray(),`${id} rest scale`);
      if((left instanceof THREE.Bone)!==(right instanceof THREE.Bone))throw new Error('Joint classification differs.');
      if(left instanceof THREE.Mesh) {
        if(!(right instanceof THREE.Mesh))throw new Error('Mesh classification differs.');
        compareGeometry(left.geometry,right.geometry);meshPairs.push([left,right]);
        close(left.morphTargetInfluences??[],right.morphTargetInfluences??[],`${id} rest morph weights`);
      }
      if(left instanceof THREE.SkinnedMesh) {
        if(!(right instanceof THREE.SkinnedMesh))throw new Error('Skin classification differs.');
        const sourceBones=left.skeleton.bones.map(bone=>identities.find(identity=>identity.uuid===bone.uuid)?.node);
        const actualBones=right.skeleton.bones.map(bone=>getSourceAssociation(bone)?.nodes);
        if(canonical(sourceBones)!==canonical(actualBones))throw new Error('Joint order differs.');
        close(left.skeleton.boneInverses.flatMap(matrix=>matrix.toArray()),right.skeleton.boneInverses.flatMap(matrix=>matrix.toArray()),`${id} IBMs`);
      }
    }
    report.meshCount=meshPairs.length;
    const channels=mapChannels(actualRoot,loaded.animations,parseGlb(output).document);
    for(const channel of packet.channels) {
      const actualTrack=channels[channel.animation][channel.channel];
      close(channel.times,actualTrack.times,'Clip times',0);close(channel.values,actualTrack.values,'Clip values',1e-6);
      if((channel.interpolation==='CUBICSPLINE')!==isGltfCubic(actualTrack) || (channel.interpolation==='STEP' && actualTrack.getInterpolation()!==THREE.InterpolateDiscrete))throw new Error('Interpolation differs.');
    }
    const measure=()=>{
      expectedRoot.updateMatrixWorld(true);actualRoot!.updateMatrixWorld(true);
      for(const [left,right] of meshPairs) {
        if(left instanceof THREE.SkinnedMesh)left.skeleton.update();if(right instanceof THREE.SkinnedMesh)right.skeleton.update();
        const count=left.geometry.getAttribute('position').count;
        const a=new THREE.Vector3(),b=new THREE.Vector3();
        for(let vertex=0;vertex<count;vertex++) {
          left.getVertexPosition(vertex,a).applyMatrix4(left.matrixWorld);right.getVertexPosition(vertex,b).applyMatrix4(right.matrixWorld);
          close(a.toArray(),b.toArray(),'Actual animated vertex deformation',2e-4);report.sampledVertices++;
        }
      }
    };
    measure();
    if(expectedClips.length!==loaded.animations.length)throw new Error('Clip count differs.');
    for(let index=0;index<expectedClips.length;index++) {
      close([expectedClips[index].duration],[loaded.animations[index].duration],'Clip duration');
      const leftMixer=new THREE.AnimationMixer(expectedRoot),rightMixer=new THREE.AnimationMixer(actualRoot);
      const leftAction=leftMixer.clipAction(expectedClips[index]),rightAction=rightMixer.clipAction(loaded.animations[index]);
      for(const action of [leftAction,rightAction]){action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();}
      for(const phase of report.phases){leftMixer.setTime(phase*expectedClips[index].duration);rightMixer.setTime(phase*loaded.animations[index].duration);measure();}
      leftMixer.stopAllAction();rightMixer.stopAllAction();leftMixer.uncacheRoot(expectedRoot);rightMixer.uncacheRoot(actualRoot);
    }
    report.status='VERIFIED';
  } catch(error) {report.reasons.push(error instanceof Error?error.message:String(error));}
  finally {if(actualRoot)disposeModelResources(actualRoot);loader.dispose();}
  return report;
}
