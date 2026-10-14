import * as THREE from 'three';
import {disposeModelResources,retainModelResources,retainModelGeometry,collectModelResources} from './ModelResources';
import {captureAuthoredMaterials} from '../viewer/AuthoredMaterialState';
import {cloneForCompare,disposeCompareClone} from '../compare/CompareClone';

export function runModelResourcesTests() {
  const results:{name:string;passed:boolean;actual?:unknown;expected?:unknown}[]=[];
  const counts=new Map<object,number>();
  const watch=<T extends THREE.BufferGeometry|THREE.Material|THREE.Texture>(resource:T)=>{
    counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)!+1));return resource;
  };
  const root=new THREE.Group(),geometry=watch(new THREE.BoxGeometry()),material=watch(new THREE.MeshPhysicalMaterial());
  const map=watch(new THREE.Texture()),extra=watch(new THREE.Texture());
  material.map=map;material.clearcoatMap=extra;material.transmissionMap=extra;
  const shader=watch(new THREE.ShaderMaterial({uniforms:{nested:{value:{layers:[map,extra]}}}}));
  root.add(new THREE.Mesh(geometry,material),new THREE.Line(geometry,shader),new THREE.Points(geometry,shader));
  disposeModelResources(root);disposeModelResources(root);
  results.push({name:'F06 Mesh/Line/Points, physical slots and nested shader textures dispose exactly once',passed:[geometry,material,shader,map,extra].every(value=>counts.get(value)===1),actual:[...counts.values()],expected:[1,1,1,1,1]});

  const skinnedRoot=new THREE.Group(),bone=new THREE.Bone(),skin=new THREE.SkinnedMesh(watch(new THREE.BoxGeometry()),watch(new THREE.MeshBasicMaterial()));
  skinnedRoot.add(bone,skin);skin.bind(new THREE.Skeleton([bone]));skin.skeleton.computeBoneTexture();const boneTexture=watch(skin.skeleton.boneTexture!);
  disposeModelResources(skinnedRoot);
  results.push({name:'F06 imported skeleton releases its renderer bone texture',passed:counts.get(boneTexture)===1 && skin.skeleton.boneTexture===null});

  const source=new THREE.Group(),lineGeometry=watch(new THREE.BufferGeometry()),lineMaterial=watch(new THREE.LineBasicMaterial());
  source.add(new THREE.Line(lineGeometry,lineMaterial));captureAuthoredMaterials(source);
  const clone=cloneForCompare(source,[]),line=clone.root.children[0] as THREE.Line;
  const ownsMaterial=line.material!==lineMaterial;
  const clonedLineMaterial=watch(line.material as THREE.Material);
  disposeCompareClone(clone.root);
  results.push({name:'F06 Compare owns Line materials and borrows source geometry',passed:ownsMaterial && counts.get(clonedLineMaterial)===1 && counts.get(lineMaterial)===0 && counts.get(lineGeometry)===0});
  disposeModelResources(source);
  const previousBitmap=globalThis.ImageBitmap;
  class Bitmap {closed=0;close(){this.closed++;}}
  Object.defineProperty(globalThis,'ImageBitmap',{configurable:true,writable:true,value:Bitmap});
  try {
    const image=new Bitmap(),a=watch(new THREE.Texture(image)),b=watch(new THREE.Texture(image));
    const sharedGeometry=watch(new THREE.BoxGeometry()),owner=new THREE.Group();
    const ownerMaterial=watch(new THREE.MeshPhysicalMaterial({map:a,clearcoatMap:b}));
    owner.add(new THREE.Mesh(sharedGeometry,ownerMaterial));retainModelResources(owner);
    const borrower=cloneForCompare(owner,[]);
    disposeModelResources(owner);
    const alive=image.closed===0 && counts.get(a)===0 && counts.get(b)===0 && counts.get(sharedGeometry)===0;
    disposeCompareClone(borrower.root);disposeCompareClone(borrower.root);
    results.push({name:'F06 source may release before Compare; shared textures/bitmap close only after final owner',passed:alive && image.closed===1 && [a,b,sharedGeometry,ownerMaterial].every(value=>counts.get(value)===1)});
  } finally {
    if(previousBitmap===undefined)Reflect.deleteProperty(globalThis,'ImageBitmap');else globalThis.ImageBitmap=previousBitmap;
  }
  const historyRoot=new THREE.Group(),history=watch(new THREE.BoxGeometry()),other=new THREE.Group(),otherGeometry=watch(new THREE.BoxGeometry()),otherMaterial=watch(new THREE.MeshBasicMaterial());
  other.add(new THREE.Points(otherGeometry,otherMaterial));retainModelResources(historyRoot,[other]);retainModelGeometry(historyRoot,history);
  disposeModelResources(historyRoot);
  results.push({name:'F06 detached Undo geometry and non-selected GLTF scenes belong to the import lease',passed:[history,otherGeometry,otherMaterial].every(value=>counts.get(value)===1)});
  const texture=watch(new THREE.Texture()),uniformRoot=new THREE.Group(),cyclic:any={texture};cyclic.self=cyclic;
  uniformRoot.add(new THREE.Points(watch(new THREE.BufferGeometry()),watch(new THREE.ShaderMaterial({uniforms:{cyclic:{value:cyclic},array:new THREE.Uniform([texture])}}))));
  const inventory=collectModelResources(uniformRoot);disposeModelResources(uniformRoot);
  results.push({name:'F06 cyclic nested shader uniform textures are inventoried and released once',passed:inventory.textures.size===1 && counts.get(texture)===1});
  return results;
}
