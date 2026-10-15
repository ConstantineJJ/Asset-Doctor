import * as THREE from 'three';
import {assertMemoryBytes,geometryArrays,memoryLimits} from '../performance/MemoryBudget';

type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
interface AttributePacket {array:THREE.TypedArray;itemSize:number;normalized:boolean;stride?:number;offset?:number;version:number;name:string;usage:THREE.Usage;gpuType:THREE.AttributeGPUType;float16?:boolean}
export interface GeometryPacket {
 uuid:string;attributes:Record<string,AttributePacket>;morphs:Record<string,AttributePacket[]>;index:AttributePacket|null;
 relative:boolean;groups:THREE.BufferGeometry['groups'];drawRange:THREE.BufferGeometry['drawRange'];userData:Record<string,unknown>;
}

/** Copy before transfer: live viewer buffers must never be detached. */
export function packGeometry(geometry:THREE.BufferGeometry):GeometryPacket {
 const copies=new Map<THREE.TypedArray,THREE.TypedArray>();
 const pack=(attribute:Attribute):AttributePacket=>{
  let array=copies.get(attribute.array);if(!array){array=attribute.array.slice() as THREE.TypedArray;copies.set(attribute.array,array);}
  const interleaved=attribute as THREE.InterleavedBufferAttribute;
  return {array,itemSize:attribute.itemSize,normalized:attribute.normalized,stride:interleaved.data?.stride,offset:interleaved.offset,
   version:interleaved.data?.version ?? (attribute as THREE.BufferAttribute).version,name:attribute.name,
   usage:interleaved.data?.usage ?? (attribute as THREE.BufferAttribute).usage,gpuType:(attribute as THREE.BufferAttribute).gpuType,float16:attribute instanceof THREE.Float16BufferAttribute};
 };
 return {uuid:geometry.uuid,attributes:Object.fromEntries(Object.entries(geometry.attributes).map(([name,a])=>[name,pack(a)])),
  morphs:Object.fromEntries(Object.entries(geometry.morphAttributes).map(([name,attributes])=>[name,attributes.map(pack)])),
  index:geometry.index?pack(geometry.index):null,relative:geometry.morphTargetsRelative,groups:geometry.groups.map(group=>({...group})),
  drawRange:{...geometry.drawRange},userData:structuredClone(geometry.userData)};
}

export function unpackGeometry(packet:GeometryPacket):THREE.BufferGeometry {
 const buffers=new Map<THREE.TypedArray,THREE.InterleavedBuffer>();
 const unpack=(p:AttributePacket):Attribute=>{
  let attribute:Attribute;
  if(p.stride!==undefined) {
   let buffer=buffers.get(p.array);if(!buffer){buffer=new THREE.InterleavedBuffer(p.array,p.stride);buffer.version=p.version;buffer.setUsage(p.usage);buffers.set(p.array,buffer);}
   attribute=new THREE.InterleavedBufferAttribute(buffer,p.itemSize,p.offset!,p.normalized);
  } else {attribute=p.float16?new THREE.Float16BufferAttribute(p.array,p.itemSize,p.normalized):new THREE.BufferAttribute(p.array,p.itemSize,p.normalized);attribute.version=p.version;attribute.setUsage(p.usage);attribute.gpuType=p.gpuType;}
  attribute.name=p.name;return attribute;
 };
 const geometry=new THREE.BufferGeometry();geometry.uuid=packet.uuid;
 for(const [name,a] of Object.entries(packet.attributes))geometry.setAttribute(name,unpack(a));
 geometry.morphAttributes=Object.fromEntries(Object.entries(packet.morphs).map(([name,list])=>[name,list.map(unpack)]));
 geometry.setIndex(packet.index?unpack(packet.index) as THREE.BufferAttribute:null);geometry.morphTargetsRelative=packet.relative;
 geometry.groups=packet.groups.map(group=>({...group}));geometry.drawRange={...packet.drawRange};geometry.userData=packet.userData;
 return geometry;
}

interface NodePacket {uuid:string;name:string;type:'bone'|'mesh'|'skin'|'node';matrix:number[];visible:boolean;geometry?:GeometryPacket;instanced?:boolean;
 children:NodePacket[];bones?:string[];inverses?:number[][];bind?:number[];bindInverse?:number[];bindMode?:THREE.BindMode;morphInfluences?:number[];morphDictionary?:Record<string,number>}
export function assertRootPacketBudget(root:THREE.Object3D,geometrySource:(mesh:THREE.Mesh)=>THREE.BufferGeometry=mesh=>mesh.geometry,maxBytes:number=memoryLimits.packet){
 const sources=new Set<THREE.BufferGeometry>();let bytes=0;
 root.traverse(node=>{if(!(node as THREE.Mesh).isMesh)return;const geometry=geometrySource(node as THREE.Mesh);if(sources.has(geometry))return;sources.add(geometry);
  for(const array of new Set(geometryArrays(geometry)))bytes+=array.byteLength;
 });assertMemoryBytes(bytes,maxBytes);
}
export function packRoot(root:THREE.Object3D,geometrySource:(mesh:THREE.Mesh)=>THREE.BufferGeometry=mesh=>mesh.geometry,maxBytes:number=memoryLimits.packet):NodePacket {
 assertRootPacketBudget(root,geometrySource,maxBytes);
 const geometries=new Map<THREE.BufferGeometry,GeometryPacket>();root.updateWorldMatrix(true,true);
 const pack=(node:THREE.Object3D):NodePacket=>{
  const mesh=node as THREE.SkinnedMesh;
  let geometry:GeometryPacket|undefined;
  if(mesh.isMesh){const source=geometrySource(mesh);geometry=geometries.get(source);if(!geometry){geometry=packGeometry(source);geometries.set(source,geometry);}}
  return {uuid:node.uuid,name:node.name,type:mesh.isSkinnedMesh?'skin':mesh.isMesh?'mesh':(node as THREE.Bone).isBone?'bone':'node',
   matrix:node.matrix.toArray(),visible:node.visible,geometry,instanced:(node as THREE.InstancedMesh).isInstancedMesh,children:node.children.map(pack),
   bones:mesh.isSkinnedMesh?mesh.skeleton.bones.map(bone=>bone.uuid):undefined,inverses:mesh.isSkinnedMesh?mesh.skeleton.boneInverses.map(m=>m.toArray()):undefined,
   bind:mesh.isSkinnedMesh?mesh.bindMatrix.toArray():undefined,bindInverse:mesh.isSkinnedMesh?mesh.bindMatrixInverse.toArray():undefined,
   bindMode:mesh.isSkinnedMesh?mesh.bindMode:undefined,morphInfluences:mesh.morphTargetInfluences?.slice(),morphDictionary:mesh.morphTargetDictionary};
 };return pack(root);
}
export function unpackRoot(packet:NodePacket):THREE.Group {
 const nodes=new Map<string,THREE.Object3D>(),geometries=new Map<GeometryPacket,THREE.BufferGeometry>(),skins:{mesh:THREE.SkinnedMesh;packet:NodePacket}[]=[];
 const unpack=(p:NodePacket):THREE.Object3D=>{
  let geometry:THREE.BufferGeometry|undefined;if(p.geometry){geometry=geometries.get(p.geometry);if(!geometry){geometry=unpackGeometry(p.geometry);geometries.set(p.geometry,geometry);}}
  const node:THREE.Object3D=p.type==='bone'?new THREE.Bone():p.type==='skin'?new THREE.SkinnedMesh(geometry,new THREE.MeshStandardMaterial()):p.type==='mesh'?new THREE.Mesh(geometry,new THREE.MeshStandardMaterial()):new THREE.Group();
  node.uuid=p.uuid;node.name=p.name;node.visible=p.visible;node.matrix.fromArray(p.matrix);node.matrix.decompose(node.position,node.quaternion,node.scale);node.matrixAutoUpdate=false;
  if(p.instanced)Reflect.set(node,'isInstancedMesh',true);
  if((node as THREE.Mesh).isMesh){const mesh=node as THREE.Mesh;mesh.morphTargetInfluences=p.morphInfluences;mesh.morphTargetDictionary=p.morphDictionary;}
  nodes.set(p.uuid,node);p.children.forEach(child=>node.add(unpack(child)));if(p.type==='skin')skins.push({mesh:node as THREE.SkinnedMesh,packet:p});return node;
 };
 const root=unpack(packet) as THREE.Group;root.updateMatrixWorld(true);
 for(const {mesh,packet:p} of skins){const bones=p.bones!.map(uuid=>{const bone=nodes.get(uuid);if(!(bone as THREE.Bone)?.isBone)throw new Error('Worker skin joint is outside the asset');return bone as THREE.Bone;});
  mesh.bind(new THREE.Skeleton(bones,p.inverses!.map(values=>new THREE.Matrix4().fromArray(values))),new THREE.Matrix4().fromArray(p.bind!));
  mesh.bindMatrixInverse.fromArray(p.bindInverse!);mesh.bindMode=p.bindMode!;}
 return root;
}

export function transferBuffers(value:unknown):ArrayBuffer[] {
 const buffers=new Set<ArrayBuffer>(),seen=new Set<object>();
 const visit=(item:unknown)=>{if(item instanceof ArrayBuffer){buffers.add(item);return;}if(ArrayBuffer.isView(item)){buffers.add(item.buffer as ArrayBuffer);return;}
  if(!item || typeof item!=='object' || seen.has(item))return;seen.add(item);Object.values(item).forEach(visit);};visit(value);return [...buffers];
}
