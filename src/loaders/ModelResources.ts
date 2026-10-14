import * as THREE from 'three';
import {getAuthoredMaterialSet} from '../viewer/AuthoredMaterialState';

type Resource=THREE.BufferGeometry|THREE.Material|THREE.Texture|THREE.Skeleton|ImageBitmap;
export interface ModelResourceInventory {
  geometries:Set<THREE.BufferGeometry>;
  materials:Set<THREE.Material>;
  textures:Set<THREE.Texture>;
  skeletons:Set<THREE.Skeleton>;
  bitmaps:Set<ImageBitmap>;
}
// Weak keys never keep discarded roots/resources alive. A lease retains only
// resources (including detached Undo geometry), not the scene hierarchy.
const leases=new WeakMap<THREE.Object3D,Set<Resource>>();
const references=new WeakMap<Resource,number>();
const releasedRoots=new WeakSet<THREE.Object3D>();
const releasedResources=new WeakSet<Resource>();

export function collectModelResources(root:THREE.Object3D):ModelResourceInventory {
  const inventory:ModelResourceInventory={geometries:new Set(),materials:new Set(),textures:new Set(),skeletons:new Set(),bitmaps:new Set()};
  const visited=new WeakSet<object>();
  const bitmap=(value:unknown)=>{
    if(typeof ImageBitmap!=='undefined' && value instanceof ImageBitmap)inventory.bitmaps.add(value);
    else if(Array.isArray(value))value.forEach(bitmap);
  };
  const textures=(value:unknown):void=>{
    if(!value || typeof value!=='object' || visited.has(value))return;
    visited.add(value);
    if((value as THREE.Texture).isTexture) {
      const texture=value as THREE.Texture;inventory.textures.add(texture);bitmap(texture.source.data);return;
    }
    // Uniform records/arrays may contain textures, cycles and typed data. Do not
    // walk userData, scene graphs, typed arrays or arbitrary class instances.
    if(value instanceof THREE.Uniform)textures(value.value);
    else if(Array.isArray(value))value.forEach(textures);
    else if(Object.getPrototypeOf(value)===Object.prototype || Object.getPrototypeOf(value)===null)Object.values(value).forEach(textures);
  };
  const materials=(value:THREE.Material|THREE.Material[])=>{
    for(const material of Array.isArray(value)?value:[value]) {
      if(!material || inventory.materials.has(material))continue;
      inventory.materials.add(material);
      for(const [key,value] of Object.entries(material))if(key!=='userData')textures(value);
    }
  };
  root.traverse(object=>{
    const renderable=object as THREE.Mesh|THREE.Line|THREE.Points;
    if(!(renderable as THREE.Mesh).isMesh && !(renderable as THREE.Line).isLine && !(renderable as THREE.Points).isPoints)return;
    if(renderable.geometry)inventory.geometries.add(renderable.geometry);
    materials(renderable.material);
    const authored=getAuthoredMaterialSet(renderable);if(authored)materials(authored);
    if((object as THREE.SkinnedMesh).isSkinnedMesh)inventory.skeletons.add((object as THREE.SkinnedMesh).skeleton);
  });
  return inventory;
}
function resources(inventory:ModelResourceInventory):Resource[] {
  return [...inventory.geometries,...inventory.materials,...inventory.textures,...inventory.skeletons,...inventory.bitmaps];
}
function add(root:THREE.Object3D,items:Iterable<Resource>) {
  if(releasedRoots.has(root))throw new Error('Cannot retain an already released model');
  let lease=leases.get(root);if(!lease){lease=new Set();leases.set(root,lease);}
  for(const resource of items) {
    if(lease.has(resource) || releasedResources.has(resource))continue;
    lease.add(resource);references.set(resource,(references.get(resource)??0)+1);
  }
}
/** Register before publication or borrowing; repeat calls do not acquire twice. */
export function retainModelResources(root:THREE.Object3D,relatedRoots:THREE.Object3D[]=[]){
  if(leases.has(root))return;
  add(root,resources(collectModelResources(root)));
  for(const related of relatedRoots)add(root,resources(collectModelResources(related)));
}
/** Rig history owns detached/new streams until the enclosing model is released. */
export function retainModelGeometry(root:THREE.Object3D,geometry:THREE.BufferGeometry){
  retainModelResources(root);add(root,[geometry]);
}
export function retainModelVariant(root:THREE.Object3D,variant:THREE.Object3D){
  retainModelResources(root);add(root,resources(collectModelResources(variant)));
}
/** A history cleanup must not invalidate a stream still borrowed by a model. */
export function disposeUnownedGeometry(geometry:THREE.BufferGeometry){
  if(!references.has(geometry) && !releasedResources.has(geometry)){
    releasedResources.add(geometry);geometry.dispose();
  }
}

/** Release imported, unpublished, viewer, Compare and verification roots alike. */
export function disposeModelResources(root:THREE.Object3D) {
  if(releasedRoots.has(root))return;
  // Capture current authored streams and any late-created resources as well as
  // the import snapshot. Presentation managers must restore their overrides first.
  add(root,resources(collectModelResources(root)));
  const lease=leases.get(root)!;
  releasedRoots.add(root);leases.delete(root);
  const final:Resource[]=[];
  for(const resource of lease) {
    const count=(references.get(resource)??1)-1;
    if(count>0)references.set(resource,count);
    else {references.delete(resource);if(!releasedResources.has(resource)){releasedResources.add(resource);final.push(resource);}}
  }
  // GPU releases precede decoded-image close. Skeleton.dispose owns boneTexture.
  for(const resource of final)if('dispose' in resource)resource.dispose();
  for(const resource of final)if(typeof ImageBitmap!=='undefined' && resource instanceof ImageBitmap)resource.close();
  lease.clear();
}
