import * as THREE from 'three';
import { GLBLoaderService } from '../loaders/GLBLoaderService';
import { getSourceAssociation } from '../loaders/AssetRuntimeMetadata';
import { disposeModelResources } from '../loaders/ModelResources';
import { isGltfCubic } from '../animation/ClipEdits';
import { addedNodeDefinition,mapChannels,parseGlb,cleanLegacyExtras,sourceNodeIndex,type RigExportPacket } from './RigGlbPatch';

export interface RigVerification {status:'VERIFIED'|'REGRESSION';reasons:string[];meshCount:number;clipCount:number;sampledVertices:number;phases:number[];sourcePreserved:boolean}
export interface RigIdentity {uuid:string;node?:number;mesh?:number;primitive?:number;ancestor?:number}
export function rigIdentities(root:THREE.Group,created=new Map<string,number>()):RigIdentity[] {
  const identities:RigIdentity[]=[];
  const ancestor=(node:THREE.Object3D)=>{for(let parent:THREE.Object3D|null=node;parent;parent=parent.parent){const index=created.get(parent.uuid)??getSourceAssociation(parent)?.nodes;if(index!==undefined)return index;}return undefined;};
  root.traverse(node=>{
    const association=getSourceAssociation(node);
    if(created.has(node.uuid))identities.push({uuid:node.uuid,node:created.get(node.uuid),ancestor:created.get(node.uuid)});
    else if(association)identities.push({uuid:node.uuid,node:association.nodes,mesh:association.meshes,primitive:association.primitives,ancestor:ancestor(node)});
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
  const verifyStream=(index:number,oldIndex:number|undefined,values:Float32Array|Uint32Array|Uint16Array|Uint8Array,type:string,count:number,bounds=false)=>{
    const definition=candidate.document.accessors[index],old=oldIndex===undefined?{}:source.document.accessors[oldIndex],view=candidate.document.bufferViews[definition?.bufferView];
    const componentType=values instanceof Float32Array?5126:values instanceof Uint8Array?5121:values instanceof Uint16Array?5123:5125;
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
    } else if(bounds) {
      const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      for(let i=0;i<values.length;i++){const c=i%3;min[c]=Math.min(min[c],values[i]);max[c]=Math.max(max[c],values[i]);}
      if(type!=='VEC3'||canonical(definition.min)!==canonical(min)||canonical(definition.max)!==canonical(max))throw new Error('Baked position bounds differ.');
    } else if(Object.hasOwn(definition,'min')||Object.hasOwn(definition,'max'))throw new Error('Unexpected replacement accessor bounds.');
  };
  if(actual.nodes.length!==expected.nodes.length+packet.addedNodes.length)throw new Error('Added node count differs.');
  for(const node of packet.addedNodes) {
    const definition=addedNodeDefinition(node,expected);
    const child=packet.children.find(parent=>parent.index===node.index);
    if(child?.children.length)Object.assign(definition,{children:child.children});
    if(canonical(actual.nodes[node.index])!==canonical(definition))throw new Error('Added joint definition differs.');
  }
  for(const parent of packet.children) {
    const definition=actual.nodes[parent.index];
    if(parent.children.length?canonical(definition?.children)!==canonical(parent.children):Object.hasOwn(definition,'children'))throw new Error('Serialized joint hierarchy differs.');
    if(parent.index<expected.nodes.length)restoreField(actual.nodes[parent.index],expected.nodes[parent.index],'children');
  }
  if(packet.sceneRoots) {
    if(canonical(actual.scenes[0].nodes??[])!==canonical(packet.sceneRoots))throw new Error('Serialized scene root identities differ.');
    restoreField(actual.scenes[0],expected.scenes[0],'nodes');
  }
  actual.nodes=actual.nodes.slice(0,expected.nodes.length);
  for(const indices of packet.jointIndices) {
    const before=expected.meshes[indices.mesh].primitives[indices.primitive],after=actual.meshes[indices.mesh].primitives[indices.primitive];
    verifyStream(after.attributes.JOINTS_0,before.attributes.JOINTS_0,indices.values,'VEC4',indices.values.length/4);
    restoreField(after.attributes,before.attributes,'JOINTS_0');
  }
  for(const skin of packet.skins)if(skin.changed)verifyStream(candidate.document.skins[skin.index].inverseBindMatrices,source.document.skins[skin.index].inverseBindMatrices,new Float32Array(skin.inverses.flat()),'MAT4',skin.inverses.length);
  const originalAnimations=source.document.animations??[],retained=new Set<string>(),removed=new Set<string>();
  for(const entry of packet.removedChannels) {
    const key=`${entry.animation}:${entry.channel}`;
    if(!originalAnimations[entry.animation]?.channels?.[entry.channel]||removed.has(key))throw new Error('Removed source channel identities differ.');removed.add(key);
  }
  if(canonical(packet.animationSources)!==canonical([...new Set(packet.animationSources)].sort((a,b)=>a-b))||(actual.animations?.length??0)!==packet.animationSources.length)throw new Error('Source animation subset differs.');
  for(const [index,sourceIndex] of packet.animationSources.entries()) {
    const before=originalAnimations[sourceIndex],animation=actual.animations[index];
    if(!before||!animation)throw new Error('Missing retained source animation.');
    const channels=packet.channels.filter(channel=>channel.animation===index);
    if(animation.channels.length!==channels.length||!channels.length)throw new Error('Retained animation channel count differs.');
    for(const [channelIndex,channel] of channels.entries()) {
      const key=`${channel.sourceAnimation}:${channel.sourceChannel}`;
      if(channel.channel!==channelIndex||channel.sourceAnimation!==sourceIndex||retained.has(key)||removed.has(key)||!before.channels[channel.sourceChannel])throw new Error('Retained source channel mapping differs.');retained.add(key);
      const definition=animation.channels[channelIndex],oldDefinition=before.channels[channel.sourceChannel];
      if(channel.changed) {
        const old=before.samplers[oldDefinition.sampler],next=animation.samplers[definition.sampler];
        if(!next||definition.sampler<before.samplers.length||next.interpolation!==channel.interpolation)throw new Error('Replacement animation sampler differs.');
        verifyStream(next.input,old.input,channel.times,'SCALAR',channel.times.length);
        const type=source.document.accessors[old.output].type,size=type==='SCALAR'?1:type==='VEC3'?3:4;
        verifyStream(next.output,old.output,channel.values,type,channel.values.length/size);
        const metadata=structuredClone(next);for(const field of ['input','output','interpolation'])restoreField(metadata,old,field);
        if(canonical(metadata)!==canonical(old))throw new Error('Animation sampler author metadata differs.');
        definition.sampler=oldDefinition.sampler;
      }
      if(canonical(definition)!==canonical(oldDefinition))throw new Error('Retained animation channel author data differs.');
    }
    const renamed=packet.animationNames.find(name=>name.index===index);
    if(renamed?.changed) {
      if(animation.name!==renamed.name)throw new Error('Animation name differs.');restoreField(animation,before,'name');
    }
    animation.channels=structuredClone(before.channels);animation.samplers=animation.samplers.slice(0,before.samplers.length);
    if(canonical(animation)!==canonical(before))throw new Error('Retained animation author data differs.');
  }
  for(const [animation,definition] of originalAnimations.entries())for(let channel=0;channel<definition.channels.length;channel++)if(!retained.has(`${animation}:${channel}`)&&!removed.has(`${animation}:${channel}`))throw new Error('Source animation channel was silently lost.');
  if(Object.hasOwn(expected,'animations'))actual.animations=structuredClone(expected.animations);else delete actual.animations;
  for(const bake of packet.staticMeshes) {
    if(Object.hasOwn(candidate.document.nodes[bake.node],'skin'))throw new Error('Baked mesh still has a skin.');
    restoreField(actual.nodes[bake.node],expected.nodes[bake.node],'skin');
    const before=expected.meshes[bake.mesh].primitives[bake.primitive],after=actual.meshes[bake.mesh].primitives[bake.primitive],candidatePrimitive=candidate.document.meshes[bake.mesh].primitives[bake.primitive];
    if(Object.keys(candidatePrimitive.attributes).some(semantic=>/^(JOINTS|WEIGHTS)_\d+$/.test(semantic)))throw new Error('Baked mesh retains joint attributes.');
    for(const semantic of Object.keys(before.attributes))if(/^(JOINTS|WEIGHTS)_\d+$/.test(semantic))restoreField(after.attributes,before.attributes,semantic);
    for(const [semantic,stream] of Object.entries(bake.attributes)) {
      verifyStream(candidatePrimitive.attributes[semantic],before.attributes[semantic],stream.values,`VEC${stream.size}`,stream.values.length/stream.size,semantic==='POSITION');restoreField(after.attributes,before.attributes,semantic);
    }
    for(const [semantic,targets] of Object.entries(bake.morphs))targets.forEach((stream,index)=>{
      verifyStream(candidatePrimitive.targets?.[index]?.[semantic],before.targets?.[index]?.[semantic],stream.values,`VEC${stream.size}`,stream.values.length/stream.size,semantic==='POSITION');restoreField(after.targets[index],before.targets[index],semantic);
    });
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
    if(node.changed) {
      if(Object.hasOwn(definition,'matrix') || canonical([definition.translation,definition.rotation,definition.scale])!==canonical([node.rest.position,node.rest.quaternion,node.rest.scale]))throw new Error('Serialized authored rest differs.');
      for(const field of ['matrix','translation','rotation','scale'])restoreField(definition,before,field);
    }
    if(node.tip) {
      const extras=definition.extras;
      if(canonical(extras?.assetDoctorRigTip)!==canonical({version:1,point:node.tip}))throw new Error('Terminal guide differs.');
      if(before.extras && typeof before.extras==='object' && Object.hasOwn(before.extras,'assetDoctorRigTip'))extras.assetDoctorRigTip=structuredClone(before.extras.assetDoctorRigTip);else delete extras.assetDoctorRigTip;
      if(!Object.hasOwn(before,'extras')&&Object.keys(extras).length===0)delete definition.extras;
    }
  }
  for(const skin of packet.skins)if(skin.changed) {
    if(canonical(actual.skins[skin.index].joints)!==canonical(skin.joints))throw new Error('Serialized skin joint order differs.');
    restoreField(actual.skins[skin.index],expected.skins[skin.index],'inverseBindMatrices');
    restoreField(actual.skins[skin.index],expected.skins[skin.index],'joints');
    if(skin.anchor!==undefined) {
      const anchor=candidate.document.skins[skin.index].skeleton;
      if(skin.anchor===null?Object.hasOwn(candidate.document.skins[skin.index],'skeleton'):anchor!==skin.anchor)throw new Error('Serialized skin skeleton anchor differs.');
      restoreField(actual.skins[skin.index],expected.skins[skin.index],'skeleton');
    }
  }
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
    const parentKey=(node:THREE.Object3D,map:Map<string,THREE.Object3D>)=>[...map].find(([,parent])=>parent===node.parent)?.[0]??null;
    for(const [id,left] of expected) {
      const right=actual.get(id)!;
      if(parentKey(left,expected)!==parentKey(right,actual))throw new Error('Joint/node parent differs.');
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
    const diagonal=new THREE.Box3().setFromObject(expectedRoot).getSize(new THREE.Vector3()).length();
    const deformationTolerance=Math.max(1e-6,diagonal*2e-5);
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
          if(a.distanceTo(b)>deformationTolerance || ![a.x,a.y,a.z,b.x,b.y,b.z].every(Number.isFinite))throw new Error('Actual animated vertex deformation differs beyond the model-scale tolerance.');
          report.sampledVertices++;
        }
      }
    };
    measure();
    if(expectedClips.length!==loaded.animations.length)throw new Error('Clip count differs.');
    for(let index=0;index<expectedClips.length;index++) {
      if(expectedClips[index].name!==loaded.animations[index].name)throw new Error('Animation name differs after reimport.');
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
