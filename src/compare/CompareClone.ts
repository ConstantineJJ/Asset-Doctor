import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { copyAuthoredMaterials } from '../viewer/AuthoredMaterialState';
import { copySourceMetadata } from '../loaders/AssetRuntimeMetadata';

/** Geometry/textures are borrowed; materials, bones and skeletons belong to the clone. */
export function cloneForCompare(source: THREE.Group, animations: THREE.AnimationClip[]) {
  const root=cloneSkeleton(source) as THREE.Group;
  copyAuthoredMaterials(source,root);
  copySourceMetadata(source,root);
  const originals:THREE.Object3D[]=[],clones:THREE.Object3D[]=[];
  source.traverse(node=>originals.push(node));root.traverse(node=>clones.push(node));
  const uuids=new Map(originals.map((node,i)=>[node.uuid,clones[i].uuid]));
  const clips=animations.map(clip=>{
    let changed=false;
    const tracks=clip.tracks.map(track=>{
      const name=THREE.PropertyBinding.parseTrackName(track.name).nodeName;
      const target=name && uuids.get(name);
      if(!target) return track;
      changed=true;
      const remapped=track.clone();remapped.name=target+track.name.slice(name.length);
      return remapped;
    });
    if(!changed) return clip;
    const remapped=new THREE.AnimationClip(clip.name,clip.duration,tracks,clip.blendMode);
    remapped.userData=JSON.parse(JSON.stringify(clip.userData));
    return remapped;
  });
  return {root,animations:clips};
}

export function disposeCompareClone(root: THREE.Object3D) {
  const materials=new Set<THREE.Material>(),skeletons=new Set<THREE.Skeleton>();
  root.traverse(object=>{
    const mesh=object as THREE.SkinnedMesh;
    if(!mesh.isMesh) return;
    (Array.isArray(mesh.material)?mesh.material:[mesh.material]).forEach(material=>materials.add(material));
    if(mesh.isSkinnedMesh) skeletons.add(mesh.skeleton);
  });
  materials.forEach(material=>material.dispose());skeletons.forEach(skeleton=>skeleton.dispose());
  // Never dispose borrowed geometry, textures or ImageBitmaps here.
}
