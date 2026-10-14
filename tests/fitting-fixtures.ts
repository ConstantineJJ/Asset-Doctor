import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';
import * as THREE from 'three';
import {RigEditSession} from '../src/rig/RigEditSession';
import {largeFixture} from './browser/performance-fixture';

/** Two independently offset joints and closed influence sections, not a global scale problem. */
export function fittingFixture() {
  const root=new THREE.Group(),base=new THREE.Bone();base.name='Root';root.add(base);
  const middle=new THREE.Bone(),other=new THREE.Bone();middle.name='Middle';other.name='Other';middle.position.set(.3,1,.15);other.position.set(2.2,1,.1);base.add(middle,other);
  for(const parent of [middle,other]){const tip=new THREE.Bone();tip.name=parent.name+'Tip';tip.position.set(0,1,0);parent.add(tip);}
  const positions:number[]=[],indices:number[]=[],weights:number[]=[];
  for(const [slot,x] of [[1,0],[2,2]])for(const y of [.8,1,1.2])for(let i=0;i<12;i++) {
    const angle=i*Math.PI/6;positions.push(x+.5*Math.cos(angle),y,.5*Math.sin(angle));indices.push(slot,0,0,0);weights.push(1,0,0,0);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshStandardMaterial());root.add(mesh);root.updateMatrixWorld(true);
  const bones=[base,middle,other,...middle.children,...other.children] as THREE.Bone[];
  mesh.bind(new THREE.Skeleton(bones,bones.map(bone=>bone.matrixWorld.clone().invert())),new THREE.Matrix4());
  const clips=[new THREE.AnimationClip('Motion',2,[new THREE.VectorKeyframeTrack('Middle.position',[0,2],[.3,1,.15,.3,1.2,.15]),new THREE.VectorKeyframeTrack('Other.position',[0,2],[2.2,1,.1,2.2,1.1,.1])])];
  const session=new RigEditSession(root,clips);session.enterEdit();return {root,session,mesh,middle,other,base};
}


/** Serialize an actual asymmetric skinned model; the app imports a real GLB. */
export async function fittingGlb(nonuniform=false) {
 const previous=Reflect.get(globalThis,'FileReader');
 class Reader {
  result:ArrayBuffer|string|null=null;onloadend:(()=>void)|null=null;onerror:(()=>void)|null=null;
  readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();},()=>this.onerror?.());}
  readAsDataURL(blob:Blob){void blob.arrayBuffer().then(value=>{this.result=`data:${blob.type};base64,${Buffer.from(value).toString('base64')}`;this.onloadend?.();},()=>this.onerror?.());}
 }
 if(!previous)Reflect.set(globalThis,'FileReader',Reader);
 try{
  const {root,session,mesh}=fittingFixture();root.name='FitModel';root.userData={author:'Fitting fixture',keep:{value:1}};
  if(nonuniform){root.scale.set(1.5,.75,2);root.rotation.y=.2;root.updateMatrixWorld(true);mesh.skeleton.boneInverses=mesh.skeleton.bones.map(bone=>bone.matrixWorld.clone().invert());mesh.bind(mesh.skeleton,mesh.matrixWorld.clone());}
  return await new GLTFExporter().parseAsync(root,{binary:true,animations:session.clips}) as ArrayBuffer;
 }
 finally{if(!previous)Reflect.deleteProperty(globalThis,'FileReader');}
}
export function largeFittingGlb() {
 const original=largeFixture(),jsonLength=original.readUInt32LE(12),document=JSON.parse(original.subarray(20,20+jsonLength).toString().trim()),chunks:Buffer[]=[original.subarray(28+jsonLength)];
 let offset=chunks[0].length;const count=document.accessors[0].count;
 const append=(array:THREE.TypedArray,type:string,componentType:number,items:number)=>{
  const view=document.bufferViews.length;document.bufferViews.push({buffer:0,byteOffset:offset,byteLength:array.byteLength});chunks.push(Buffer.from(array.buffer,array.byteOffset,array.byteLength));offset+=array.byteLength;
  document.accessors.push({bufferView:view,type,componentType,count:items});return document.accessors.length-1;
 };
 const joints=new Uint16Array(count*4),weights=new Float32Array(count*4);for(let i=0;i<count;i++){joints[i*4]=1;weights[i*4]=1;}
 const attributes=document.meshes[0].primitives[0].attributes;attributes.JOINTS_0=append(joints,'VEC4',5123,count);attributes.WEIGHTS_0=append(weights,'VEC4',5126,count);
 const inverses=new Float32Array([...new THREE.Matrix4().elements,...new THREE.Matrix4().makeTranslation(-.3,-.5,0).elements,...new THREE.Matrix4().makeTranslation(-.3,-.7,0).elements]);
 document.nodes[0].skin=0;document.nodes.push({name:'Base',children:[2]},{name:'Middle',translation:[.3,.5,0],children:[3]},{name:'Tip',translation:[0,.2,0]});document.scenes[0].nodes.push(1);
 document.skins=[{joints:[1,2,3],skeleton:1,inverseBindMatrices:append(inverses,'MAT4',5126,3)}];document.buffers[0].byteLength=offset;
 const text=Buffer.from(JSON.stringify(document)),padded=Math.ceil(text.length/4)*4,output=Buffer.alloc(28+padded+offset);[0x46546c67,2,output.length,padded,0x4e4f534a].forEach((value,i)=>output.writeUInt32LE(value,i*4));output.fill(32,20,20+padded);text.copy(output,20);output.writeUInt32LE(offset,20+padded);output.writeUInt32LE(0x004e4942,24+padded);let start=28+padded;for(const chunk of chunks){chunk.copy(output,start);start+=chunk.length;}return output;
}
