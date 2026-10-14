import * as THREE from 'three';
import { isGltfCubic } from '../animation/ClipEdits';
import { getSourceAssociation } from '../loaders/AssetRuntimeMetadata';
import type { HealOperationReport } from '../types';
import type { RigEditSession,NodeRest } from './RigEditSession';

export interface ChannelPacket {animation:number;channel:number;sourceAnimation:number;sourceChannel:number;times:Float32Array;values:Float32Array;interpolation:'LINEAR'|'STEP'|'CUBICSPLINE';size:number;changed:boolean}
export interface FloatStream {values:Float32Array;size:number}
export interface RigExportPacket {
  source:ArrayBuffer;
  nodes:{index:number;rest:NodeRest;changed:boolean;tip?:number[]}[];
  skins:{index:number;inverses:number[][];joints:number[];changed:boolean;anchor?:number|null}[];
  addedNodes:{index:number;name:string;rest:NodeRest;tip?:number[];source?:number}[];
  children:{index:number;children:number[]}[];
  sceneRoots?:number[];
  animationSources:number[];
  removedChannels:{animation:number;channel:number}[];
  staticMeshes:{node:number;mesh:number;primitive:number;attributes:Record<string,FloatStream>;morphs:Record<string,FloatStream[]>}[];
  jointIndices:{mesh:number;primitive:number;values:Uint8Array|Uint16Array}[];
  channels:ChannelPacket[];
  animationNames:{index:number;name:string;changed:boolean}[];
  repairs:{node:number;mesh:number;primitive:number;operations:string[];index?:Uint32Array;attributes:Record<string,{values:Float32Array;size:number}>}[];
}

export function parseGlb(source:ArrayBuffer):{document:any;binary:Uint8Array} {
  const view=new DataView(source);
  if(source.byteLength<20 || view.getUint32(0,true)!==0x46546c67 || view.getUint32(4,true)!==2 || view.getUint32(8,true)!==source.byteLength) throw new Error('Rig editing requires a valid self-contained GLB 2.0.');
  let offset=12,document:any,binary:Uint8Array|undefined;
  while(offset<source.byteLength) {
    if(offset+8>source.byteLength) throw new Error('Truncated GLB chunk.');
    const length=view.getUint32(offset,true),type=view.getUint32(offset+4,true);offset+=8;
    if(length%4 || offset+length>source.byteLength) throw new Error('Invalid GLB chunk range.');
    if(type===0x4e4f534a) {if(document)throw new Error('Duplicate GLB JSON chunk.');document=JSON.parse(new TextDecoder().decode(new Uint8Array(source,offset,length)).replace(/\0+$/g,''));}
    else if(type===0x004e4942) {if(binary)throw new Error('Duplicate GLB binary chunk.');binary=new Uint8Array(source,offset,length);}
    else throw new Error('Unknown GLB chunks cannot be preserved by rig export.');
    offset+=length;
  }
  if(!document || !binary || document.buffers?.length!==1 || document.buffers[0].uri || document.buffers[0].byteLength>binary.byteLength) throw new Error('Rig editing requires one embedded GLB buffer.');
  const external=(document.images??[]).some((image:any)=>image.uri && !image.uri.startsWith('data:'));
  if(external) throw new Error('External images are unsupported for verified rig export.');
  if((document.scenes??[]).length!==1) throw new Error('Multiple scenes require a separate source-preserving edit contract.');
  return {document,binary};
}

export function sourceNodeIndex(node:THREE.Object3D):number|undefined {
  for(let current:THREE.Object3D|null=node;current;current=current.parent) {
    const index=getSourceAssociation(current)?.nodes;if(index!==undefined)return index;
  }
  return undefined;
}

function equal(a:ArrayLike<number>,b:ArrayLike<number>,epsilon=0) {
  if(a.length!==b.length)return false;
  for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>epsilon)return false;
  return true;
}
function sameRest(a:NodeRest,b:NodeRest) {return equal(a.position,b.position)&&equal(a.quaternion,b.quaternion)&&equal(a.scale,b.scale);}
const properties:Record<string,string>={translation:'position',rotation:'quaternion',scale:'scale',weights:'morphTargetInfluences'};

/** Map source channels by canonical target/path, including morph fan-out. Never by track order. */
export function mapChannels(root:THREE.Group,clips:THREE.AnimationClip[],document:any,resolve:(name:string)=>THREE.Object3D|null=(name)=>THREE.PropertyBinding.findNode(root,name) as THREE.Object3D|null):THREE.KeyframeTrack[][] {
  if(clips.length!==(document.animations?.length??0)) throw new Error('Loaded animation count differs from the source.');
  return clips.map((clip,index)=>{
    const tracks=new Map<string,THREE.KeyframeTrack[]>();
    for(const track of clip.tracks) {
      const binding=THREE.PropertyBinding.parseTrackName(track.name);
      const target=resolve(binding.nodeName) as THREE.Object3D|null;
      const node=target && sourceNodeIndex(target);
      if(node===undefined || binding.objectName || binding.propertyIndex) throw new Error('Unresolved or nested animation target.');
      const key=`${node}:${binding.propertyName}`;const list=tracks.get(key)??[];list.push(track);tracks.set(key,list);
    }
    const used=new Set<string>();
    const result=(document.animations[index].channels??[]).map((channel:any)=>{
      const node=channel.target?.node,property=properties[channel.target?.path];
      if(node===undefined || !property) throw new Error('Source animation contains an unsupported/skipped channel.');
      const key=`${node}:${property}`;
      if(used.has(key)) throw new Error('Duplicate source animation target/path.');used.add(key);
      const matches=tracks.get(key);
      if(!matches?.length) throw new Error('Source animation channel has no loaded track.');
      if(matches.length>1 && property!=='morphTargetInfluences') throw new Error('Ambiguous source animation channel.');
      for(const match of matches) if(!equal(matches[0].times,match.times)||!equal(matches[0].values,match.values)||isGltfCubic(matches[0])!==isGltfCubic(match)||matches[0].getInterpolation()!==match.getInterpolation()) throw new Error('Morph animation fan-out no longer agrees.');
      return matches[0];
    });
    if([...tracks.keys()].some(key=>!used.has(key))) throw new Error('Loaded track has no source channel.');
    return result;
  });
}

function logicalFloats(attribute:THREE.BufferAttribute|THREE.InterleavedBufferAttribute) {
  const values=new Float32Array(attribute.count*attribute.itemSize);
  for(let i=0;i<attribute.count;i++)for(let component=0;component<attribute.itemSize;component++) values[i*attribute.itemSize+component]=attribute.getComponent(i,component);
  return {values,size:attribute.itemSize};
}

export function buildRigExportPacket(session:RigEditSession,source:ArrayBuffer,healReports:HealOperationReport[]=[],geometryResolver:(mesh:THREE.Mesh)=>THREE.BufferGeometry=mesh=>mesh.geometry):RigExportPacket {
  if(session.isGestureActive)throw new Error('Finish the joint drag before building an export.');
  const {document}=parseGlb(source),state=session.snapshot(),original=session.originalSnapshot();
  const generated=session.exportNodeIndices();
  const nodeIndex=(node:THREE.Object3D)=>generated.get(node.uuid)??getSourceAssociation(node)?.nodes;
  // Three.js renders four influences. Additional sets cannot receive honest deformation verification.
  for(const mesh of document.meshes??[]) for(const primitive of mesh.primitives??[]) if(Object.keys(primitive.attributes??{}).some(key=>/^(JOINTS|WEIGHTS)_[1-9]/.test(key))) throw new Error('Additional skin influence sets require an extended deformation verifier.');
  const originalChannels=mapChannels(session.root,original.clips,document,name=>session.originalObject(name)??null);
  const staticNodes=new Set<number>();
  session.root.traverse(node=>{
    if(node instanceof THREE.Mesh&&!(node instanceof THREE.SkinnedMesh)&&session.originalObject(node.uuid) instanceof THREE.SkinnedMesh) {
      const index=sourceNodeIndex(node);if(index===undefined)throw new Error('Static mesh has no canonical source node.');staticNodes.add(index);
    }
  });
  const bakedMeshIds=new Set([...staticNodes].map(index=>document.nodes[index].mesh).filter((index):index is number=>index!==undefined));
  for(const [index,node] of document.nodes.entries())if(bakedMeshIds.has(node.mesh)&&!staticNodes.has(index))throw new Error('A baked source mesh is also referenced by an untouched source node.');
  const removedChannels:RigExportPacket['removedChannels']=[],retainedChannelIndices:number[][]=[];
  for(const [animation,definition] of (document.animations??[]).entries()) {
    const retained:number[]=[];
    for(const [channel,value] of definition.channels.entries()) {
      const target=value.target;
      if(state.removedTargets.has(target?.node)||(staticNodes.has(target?.node)&&['translation','rotation','scale'].includes(target.path)))removedChannels.push({animation,channel});
      else retained.push(channel);
    }
    retainedChannelIndices.push(retained);
  }
  const animationSources=state.clipSources;
  const expectedSources=retainedChannelIndices.flatMap((channels,index)=>channels.length?[index]:[]);
  if(!equal(animationSources,expectedSources)||animationSources.length!==state.clips.length)throw new Error('Retained source animation identities differ.');
  const retainedDocument={...document,animations:animationSources.map(index=>({...document.animations[index],channels:retainedChannelIndices[index].map(channel=>document.animations[index].channels[channel])}))};
  const currentChannels=mapChannels(session.root,state.clips,retainedDocument);
  const nodes:RigExportPacket['nodes']=[],skins:RigExportPacket['skins']=[],repairs:RigExportPacket['repairs']=[],addedNodes:RigExportPacket['addedNodes']=[],children:RigExportPacket['children']=[],jointIndices:RigExportPacket['jointIndices']=[],staticMeshes:RigExportPacket['staticMeshes']=[];
  const seen=new Map<number,NodeRest>(),seenSkins=new Map<number,number[][]>();
  const jointOrders=new Map<number,number[]>(),primitiveJoints=new Map<string,Uint8Array|Uint16Array>(),primitiveStates=new Map<string,string>();
  session.root.traverse(node=>{
    const association=getSourceAssociation(node),rest=state.nodes.get(node.uuid),before=original.nodes.get(node.uuid);
    if(!rest)return;
    const index=nodeIndex(node);
    if(generated.has(node.uuid)) {
      const source=session.frameSourceFor(node.uuid);
      if(source!==undefined&&(document.nodes[source]?.mesh!==undefined||document.nodes[source]?.camera!==undefined))throw new Error('A removed joint with a node-level mesh/camera needs a dedicated attachment export contract.');
      addedNodes.push({index:index!,name:node.name,rest,tip:state.tips.get(node.uuid),source});
    }
    else if(!before)throw new Error('An active added node has no structural export identity.');
    else if(association?.nodes!==undefined) {
      const index=association.nodes,existing=seen.get(index);
      if(existing&&!sameRest(existing,rest))throw new Error('Instances of one source node have conflicting edited transforms.');
      if(!existing) {seen.set(index,rest);nodes.push({index,rest,changed:!sameRest(rest,before),tip:state.tips.get(node.uuid)});}
    } else if(!sameRest(rest,before)) throw new Error('An edited generated attachment has no source node.');
    if(index!==undefined) {
      const activeChildren=node.children.map(nodeIndex).filter((id):id is number=>id!==undefined);
      const oldChildren=generated.has(node.uuid)?[]:(document.nodes[index].children??[]);
      if(!equal(activeChildren,oldChildren))children.push({index,children:activeChildren});
    }
    if(node instanceof THREE.SkinnedMesh) {
      const meshNodeIndex=sourceNodeIndex(node),index=document.nodes?.[meshNodeIndex!]?.skin;
      if(index===undefined)throw new Error('Skinned mesh has no source skin.');
      const sourceSkin=document.skins[index],inverses=state.skins.get(node.skeleton)!,old=original.skins.get(node.skeleton)!;
      const originalJoints=original.joints.get(node.skeleton)!.map(id=>session.sourceNodeIndexFor(id)??-1);
      if(!equal(sourceSkin.joints,originalJoints))throw new Error('Source joint order differs from the baseline skin.');
      const joints=node.skeleton.bones.map(bone=>nodeIndex(bone)??-1);
      if(joints.some(index=>index<0))throw new Error('A joint has no source or added-node identity.');
      const existing=seenSkins.get(index);
      if(existing&&!equal(existing.flat(),inverses.flat(),1e-8))throw new Error('Instances of one source skin require conflicting IBMs.');
      if(jointOrders.has(index)&&!equal(jointOrders.get(index)!,joints))throw new Error('Instances of one source skin require conflicting joint orders.');
      const common=(candidate:THREE.Object3D)=>node.skeleton.bones.every(bone=>{for(let parent:THREE.Object3D|null=bone;parent;parent=parent.parent)if(parent===candidate)return true;return false;});
      let anchor: number|null|undefined;
      if(sourceSkin.skeleton!==undefined) {
        const candidate=[...state.objects.values()].find(object=>nodeIndex(object)===sourceSkin.skeleton||session.frameSourceFor(object.uuid)===sourceSkin.skeleton);
        if(candidate&&common(candidate))anchor=nodeIndex(candidate)??null;
        else {
          anchor=null;
          for(let parent:THREE.Object3D|null=node.skeleton.bones[0];parent;parent=parent.parent)if(common(parent)&&nodeIndex(parent)!==undefined){anchor=nodeIndex(parent)!;break;}
        }
      }
      if(!existing) {seenSkins.set(index,inverses);jointOrders.set(index,joints);skins.push({index,inverses,joints,anchor,changed:!equal(old.flat(),inverses.flat())||!equal(sourceSkin.joints,joints)||(anchor!==undefined&&anchor!==sourceSkin.skeleton)});}
    }
    if(!(node instanceof THREE.Mesh))return;
    const geometry=geometryResolver(node),wasSkinned=session.originalObject(node.uuid) instanceof THREE.SkinnedMesh,isStatic=wasSkinned&&!(node instanceof THREE.SkinnedMesh);
    if(association?.meshes!==undefined&&association.primitives!==undefined) {
      const key=`${association.meshes}:${association.primitives}`;
      const signature=JSON.stringify([isStatic,isStatic?['position','normal','tangent'].map(name=>geometry.getAttribute(name)&&Array.from(logicalFloats(geometry.getAttribute(name)).values)):geometry.getAttribute('skinIndex')&&Array.from(logicalFloats(geometry.getAttribute('skinIndex')).values),isStatic?Object.entries(geometry.morphAttributes).map(([name,attributes])=>[name,attributes.map(attribute=>Array.from(logicalFloats(attribute).values))]):null]);
      const prior=primitiveStates.get(key);if(prior!==undefined&&prior!==signature)throw new Error('Shared source primitive requires conflicting skin/static geometry.');primitiveStates.set(key,signature);
    }
    if(isStatic) {
      if(association?.meshes===undefined||association.primitives===undefined)throw new Error('Baked static geometry has no canonical primitive.');
      const primitive=document.meshes[association.meshes].primitives[association.primitives];
      if(primitive.extensions?.KHR_draco_mesh_compression)throw new Error('Compressed static baking requires a decoded source-attribute contract.');
      const attributes:Record<string,FloatStream>={},morphs:Record<string,FloatStream[]>={};
      for(const [name,semantic] of [['position','POSITION'],['normal','NORMAL'],['tangent','TANGENT']]) {
        const attribute=geometry.getAttribute(name);if(attribute)attributes[semantic]=logicalFloats(attribute);
        const targets=geometry.morphAttributes[name as keyof typeof geometry.morphAttributes];if(targets)morphs[semantic]=targets.map(logicalFloats);
      }
      if(Object.keys(morphs).length&&!geometry.morphTargetsRelative)throw new Error('Absolute morph targets require a source-relative static bake contract.');
      if(!attributes.POSITION||Object.values(morphs).some(targets=>targets.length!==(primitive.targets?.length??0)))throw new Error('Baked morph target layout differs from the source.');
      staticMeshes.push({node:sourceNodeIndex(node)!,mesh:association.meshes,primitive:association.primitives,attributes,morphs});
    }
    if(node instanceof THREE.SkinnedMesh&&original.geometries.get(node.uuid)!==node.geometry) {
      const oldGeometry=original.geometries.get(node.uuid),oldIndex=oldGeometry?.getAttribute('skinIndex'),currentIndex=node.geometry.getAttribute('skinIndex');
      if(oldIndex&&currentIndex) {
        const values=logicalFloats(currentIndex).values;
        const baseline=logicalFloats(oldIndex).values;
        if(!equal(values,baseline)) {
          if(association?.meshes===undefined||association.primitives===undefined)throw new Error('Changed joint indices have no canonical primitive.');
          const primitive=document.meshes[association.meshes].primitives[association.primitives],accessor=document.accessors[primitive.attributes.JOINTS_0];
          if(primitive.extensions?.KHR_draco_mesh_compression||![5121,5123].includes(accessor.componentType))throw new Error('Joint-index preservation requires an uncompressed UBYTE/USHORT source accessor.');
          const typed=accessor.componentType===5121?Uint8Array.from(values):Uint16Array.from(values);
          if(!equal(values,typed))throw new Error('Joint indices exceed their source component type.');
          const key=`${association.meshes}:${association.primitives}`,prior=primitiveJoints.get(key);
          if(prior&&!equal(prior,typed))throw new Error('Shared source primitive requires conflicting joint indices.');
          if(!prior){primitiveJoints.set(key,typed);jointIndices.push({mesh:association.meshes,primitive:association.primitives,values:typed});}
        }
      }
    }
    const reports=healReports.filter(report=>report.meshUuid===node.uuid && !report.undoneAt);
    if(!reports.length)return;
    if(reports.some(report=>report.status!=='VERIFIED'||report.pipeline!=='complete'))throw new Error('Combined export requires a current VERIFIED repair session.');
    if(association?.meshes===undefined || association.primitives===undefined)throw new Error('Repaired geometry has no canonical primitive.');
    const primitive=document.meshes[association.meshes].primitives[association.primitives];
    if(primitive.extensions?.KHR_draco_mesh_compression)throw new Error('Combined Draco geometry repair and rig export requires source-weight decoding; export the repair first and reimport.');
    const operations=reports.map(report=>report.operation);
    if(operations.some(operation=>['remove-unreferenced-vertices','merge-exact-duplicate-vertices'].includes(operation)))throw new Error('Combined vertex remapping and rig export requires source-aware attribute remapping; export the repair first and reimport.');
    if((primitive.mode??4)!==4)throw new Error('Combined repair of strip/fan primitives is unsupported; export the repair first and reimport.');
    const attributes:RigExportPacket['repairs'][number]['attributes']={};
    if(geometry!==node.geometry)throw new Error('Repair state is on presentation geometry. Return to Hybrid and reapply/verify the repair before combined export.');
    if(operations.includes('recalculate-normals'))attributes.NORMAL=logicalFloats(geometry.getAttribute('normal'));
    if(operations.includes('normalize-skin-weights') || operations.includes('consolidate-duplicate-skin-influences'))attributes.WEIGHTS_0=logicalFloats(geometry.getAttribute('skinWeight'));
    if(operations.includes('consolidate-duplicate-skin-influences'))attributes.JOINTS_0=logicalFloats(geometry.getAttribute('skinIndex'));
    repairs.push({node:sourceNodeIndex(node)!,mesh:association.meshes,primitive:association.primitives,operations,index:geometry.index?Uint32Array.from(geometry.index.array):undefined,attributes});
  });
  // Detached source records keep their metadata, but may not retain a second edge to a live child.
  for(const index of state.removedTargets) {
    const oldChildren=document.nodes[index]?.children??[],detachedChildren=oldChildren.filter((child:number)=>state.removedTargets.has(child));
    if(!equal(oldChildren,detachedChildren))children.push({index,children:detachedChildren});
  }
  const activeRoots=session.root.children.map(nodeIndex).filter((index):index is number=>index!==undefined);
  const originalRoots=document.scenes[0].nodes??[];
  const sceneRoots=equal(activeRoots,originalRoots)?undefined:activeRoots;
  const channels:ChannelPacket[]=currentChannels.flatMap((tracks,animation)=>tracks.map((track,channel)=>{
    const sourceAnimation=animationSources[animation],sourceChannel=retainedChannelIndices[sourceAnimation][channel];
    const before=originalChannels[sourceAnimation][sourceChannel],sampler=document.animations[sourceAnimation].samplers[document.animations[sourceAnimation].channels[sourceChannel].sampler];
    const interpolation=isGltfCubic(track)?'CUBICSPLINE':track.getInterpolation()===THREE.InterpolateDiscrete?'STEP':track.getInterpolation()===THREE.InterpolateLinear?'LINEAR':null;
    if(!interpolation || interpolation!==(sampler.interpolation??'LINEAR'))throw new Error('Animation interpolation cannot be preserved.');
    return {animation,channel,sourceAnimation,sourceChannel,times:Float32Array.from(track.times),values:Float32Array.from(track.values),interpolation,size:track.getValueSize()/(isGltfCubic(track)?3:1),changed:!equal(track.times,before.times)||!equal(track.values,before.values)};
  }));
  const animationNames=state.clips.map((clip,index)=>({index,name:clip.name,changed:clip.name!==original.clips[animationSources[index]].name}));
  return {source:source.slice(0),nodes,skins,addedNodes:addedNodes.sort((a,b)=>a.index-b.index),children,sceneRoots,jointIndices,channels,animationSources,removedChannels,staticMeshes,animationNames,repairs};
}

const legacyKeys=['__assetDoctorSourceAudit','__assetDoctorAuthoredMaterials','__assetDoctorCompareGrounded'];
export function cleanLegacyExtras(value:any):void {
  if(!value || typeof value!=='object')return;
  if(!Array.isArray(value) && value.extras && typeof value.extras==='object'&&!Array.isArray(value.extras))for(const key of legacyKeys)delete value.extras[key];
  for(const child of Object.values(value))cleanLegacyExtras(child);
}

/** Frames inherit the removed node's author metadata, while receiving a new non-joint identity. */
export function addedNodeDefinition(node:RigExportPacket['addedNodes'][number],document:any):any {
  const definition=node.source===undefined?{}:structuredClone(document.nodes[node.source]);
  if(!definition)throw new Error('Frozen frame source node is missing.');
  delete definition.children;delete definition.matrix;
  Object.assign(definition,{name:node.name,translation:node.rest.position,rotation:node.rest.quaternion,scale:node.rest.scale});
  if(node.tip) {
    if(Object.hasOwn(definition,'extras')&&(!definition.extras||typeof definition.extras!=='object'||Array.isArray(definition.extras)))throw new Error('Frozen frame author extras cannot accept a guide.');
    definition.extras={...definition.extras,assetDoctorRigTip:{version:1,point:node.tip}};
  }
  return definition;
}

/** Append new streams; all original binary ranges, untouched accessors and skins survive. */
export function patchRigGlb(packet:RigExportPacket):ArrayBuffer {
  const {document,binary}=parseGlb(packet.source);
  const originalLength=binary.byteLength,chunks:Uint8Array[]=[binary];let byteLength=originalLength;
  document.bufferViews??=[];document.accessors??=[];
  const append=(values:Float32Array|Uint32Array|Uint16Array|Uint8Array,type:string,count:number,oldAccessor?:number,bounds=false)=>{
    const source=oldAccessor===undefined?{}:document.accessors[oldAccessor];
    const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength),view=document.bufferViews.length;
    const oldView=source.bufferView===undefined?undefined:document.bufferViews[source.bufferView];
    if(Object.keys(oldView?.extensions??{}).some(key=>key!=='EXT_meshopt_compression'))throw new Error('Modified buffer view extensions require a dedicated preservation rule.');
    const authorView={...(oldView && Object.hasOwn(oldView,'name')?{name:oldView.name}:{}),...(oldView && Object.hasOwn(oldView,'extras')?{extras:structuredClone(oldView.extras)}:{})};
    document.bufferViews.push({...authorView,buffer:0,byteOffset:byteLength,byteLength:bytes.length});chunks.push(bytes);byteLength+=bytes.length;
    const definition={...structuredClone(source),bufferView:view,byteOffset:0,componentType:values instanceof Float32Array?5126:values instanceof Uint8Array?5121:values instanceof Uint16Array?5123:5125,type,count};
    delete definition.sparse;delete definition.normalized;delete definition.min;delete definition.max;
    // Extension descriptors for the source accessor may depend on its original layout.
    if(definition.extensions && Object.keys(definition.extensions).length)throw new Error('Modified accessor extensions require a dedicated preservation rule.');
    if(type==='SCALAR' && values.length) {let min=Infinity,max=-Infinity;for(const value of values){min=Math.min(min,value);max=Math.max(max,value);}definition.min=[min];definition.max=[max];}
    if(bounds) {
      if(type!=='VEC3'||!count||values.some(value=>!Number.isFinite(value)))throw new Error('Invalid baked position stream.');
      definition.min=[Infinity,Infinity,Infinity];definition.max=[-Infinity,-Infinity,-Infinity];
      for(let i=0;i<values.length;i++){const c=i%3;definition.min[c]=Math.min(definition.min[c],values[i]);definition.max[c]=Math.max(definition.max[c],values[i]);}
    }
    document.accessors.push(definition);return document.accessors.length-1;
  };
  for(const node of packet.addedNodes) {
    if(node.index!==document.nodes.length)throw new Error('Added node identities must be contiguous.');
    document.nodes.push(addedNodeDefinition(node,document));
  }
  for(const parent of packet.children) {
    if(parent.children.length)document.nodes[parent.index].children=parent.children.slice();
    else delete document.nodes[parent.index].children;
  }
  if(packet.sceneRoots) {
    if(packet.sceneRoots.length)document.scenes[0].nodes=packet.sceneRoots.slice();else delete document.scenes[0].nodes;
  }
  for(const node of packet.nodes) {
    const definition=document.nodes[node.index];if(!definition)throw new Error('Missing source node.');
    if(node.changed) {delete definition.matrix;definition.translation=node.rest.position;definition.rotation=node.rest.quaternion;definition.scale=node.rest.scale;}
    if(node.tip) {
      if(Object.hasOwn(definition,'extras') && (!definition.extras || typeof definition.extras!=='object'||Array.isArray(definition.extras)))throw new Error('Cannot preserve scalar/array/null extras while saving a guide.');
      const existing=definition.extras?.assetDoctorRigTip;
      if(existing && !(existing.version===1&&Array.isArray(existing.point)&&existing.point.length===3&&Object.keys(existing).every(key=>['version','point'].includes(key))))throw new Error('Terminal guide namespace is occupied.');
      definition.extras={...definition.extras,assetDoctorRigTip:{version:1,point:node.tip}};
    }
  }
  for(const skin of packet.skins) if(skin.changed) {
    const definition=document.skins[skin.index];definition.joints=skin.joints.slice();definition.inverseBindMatrices=append(new Float32Array(skin.inverses.flat()),'MAT4',skin.inverses.length,definition.inverseBindMatrices);
    if(skin.anchor===null)delete definition.skeleton;else if(skin.anchor!==undefined)definition.skeleton=skin.anchor;
  }
  for(const indices of packet.jointIndices) {
    const primitive=document.meshes[indices.mesh].primitives[indices.primitive];
    primitive.attributes.JOINTS_0=append(indices.values,'VEC4',indices.values.length/4,primitive.attributes.JOINTS_0);
  }
  for(const channel of packet.channels) if(channel.changed) {
    if(!channel.times.length || channel.times.some((time,index)=>!Number.isFinite(time)||time<0||(index>0&&time<=channel.times[index-1])) || channel.values.some(value=>!Number.isFinite(value)))throw new Error('Invalid serialized animation samples.');
    const animation=document.animations[channel.sourceAnimation],definition=animation.channels[channel.sourceChannel],old=animation.samplers[definition.sampler];
    const input=append(channel.times,'SCALAR',channel.times.length,old.input);
    const outputType=document.accessors[old.output].type;
    const valueComponents=outputType==='SCALAR'?1:outputType==='VEC3'?3:outputType==='VEC4'?4:0;
    if(!valueComponents || channel.values.length%valueComponents)throw new Error('Unsupported output accessor type.');
    const output=append(channel.values,outputType,channel.values.length/valueComponents,old.output);
    definition.sampler=animation.samplers.length;animation.samplers.push({...structuredClone(old),input,output,interpolation:channel.interpolation});
  }
  for(const animation of packet.animationNames)if(animation.changed)document.animations[packet.animationSources[animation.index]].name=animation.name;
  if(packet.animationSources.length) {
    const animations=document.animations;
    document.animations=packet.animationSources.map((source,index)=>({...animations[source],channels:packet.channels.filter(channel=>channel.animation===index).map(channel=>animations[source].channels[channel.sourceChannel])}));
  }else delete document.animations;
  const bakedPrimitives=new Set<string>();
  for(const bake of packet.staticMeshes) {
    delete document.nodes[bake.node].skin;
    const key=`${bake.mesh}:${bake.primitive}`;if(bakedPrimitives.has(key))continue;bakedPrimitives.add(key);
    const primitive=document.meshes[bake.mesh].primitives[bake.primitive];
    for(const semantic of Object.keys(primitive.attributes))if(/^(JOINTS|WEIGHTS)_\d+$/.test(semantic))delete primitive.attributes[semantic];
    for(const [semantic,stream] of Object.entries(bake.attributes))primitive.attributes[semantic]=append(stream.values,`VEC${stream.size}`,stream.values.length/stream.size,primitive.attributes[semantic],semantic==='POSITION');
    for(const [semantic,targets] of Object.entries(bake.morphs))targets.forEach((stream,index)=>{
      const target=primitive.targets[index];target[semantic]=append(stream.values,`VEC${stream.size}`,stream.values.length/stream.size,target[semantic],semantic==='POSITION');
    });
  }
  for(const repair of packet.repairs) {
    const primitive=document.meshes[repair.mesh].primitives[repair.primitive];
    if(repair.index)primitive.indices=append(repair.index,'SCALAR',repair.index.length,primitive.indices);
    for(const [semantic,attribute] of Object.entries(repair.attributes)) {
      const values=semantic==='JOINTS_0'?Uint16Array.from(attribute.values):attribute.values;
      primitive.attributes[semantic]=append(values,`VEC${attribute.size}`,values.length/attribute.size,primitive.attributes[semantic]);
    }
  }
  // Embed data URIs once as image bytes; no runtime material snapshot exists in extras.
  for(const image of document.images??[]) if(image.uri?.startsWith('data:')) {
    const match=/^data:([^;,]+);base64,(.*)$/s.exec(image.uri);if(!match)throw new Error('Unsupported image data URI.');
    const bytes=Uint8Array.from(atob(match[2]),character=>character.charCodeAt(0));
    const padding=(4-byteLength%4)%4;if(padding){chunks.push(new Uint8Array(padding));byteLength+=padding;}
    image.bufferView=document.bufferViews.length;image.mimeType=match[1];delete image.uri;
    document.bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:bytes.length});chunks.push(bytes);byteLength+=bytes.length;
    const tail=(4-byteLength%4)%4;if(tail){chunks.push(new Uint8Array(tail));byteLength+=tail;}
  }
  cleanLegacyExtras(document);document.buffers[0].byteLength=byteLength;
  const json=new TextEncoder().encode(JSON.stringify(document)),jsonLength=Math.ceil(json.length/4)*4,binLength=Math.ceil(byteLength/4)*4;
  const result=new ArrayBuffer(28+jsonLength+binLength),view=new DataView(result);
  [0x46546c67,2,result.byteLength,jsonLength,0x4e4f534a].forEach((value,index)=>view.setUint32(index*4,value,true));
  new Uint8Array(result,20,jsonLength).fill(32);new Uint8Array(result,20,json.length).set(json);
  view.setUint32(20+jsonLength,binLength,true);view.setUint32(24+jsonLength,0x004e4942,true);
  let offset=28+jsonLength;for(const bytes of chunks){new Uint8Array(result,offset,bytes.length).set(bytes);offset+=bytes.length;}
  return result;
}
