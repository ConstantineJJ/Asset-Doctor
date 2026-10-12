import * as THREE from 'three';
import { cloneForCompare, disposeCompareClone } from './CompareClone';
import { captureAuthoredMaterials, getAuthoredMaterialSet } from '../viewer/AuthoredMaterialState';
import { captureSourceMetadata, getDocumentExtras, getSourceAudit, getTextureExtras } from '../loaders/AssetRuntimeMetadata';
import { auditGltfSource } from '../loaders/GltfSourceAudit';
import { analyzeSkeletonAndSkinning } from '../analysis/SkeletonAnalyzer';
import { analyzeTextures } from '../analysis/TextureAnalyzer';

export function runCompareCloneTests() {
  const results: {name:string;passed:boolean;actual?:unknown;expected?:unknown}[]=[];
  const root=new THREE.Group(), bone=new THREE.Bone(); bone.name='Joint'; root.add(bone);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(12),4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));
  const texture=new THREE.DataTexture(new Uint8Array([255,0,0,255]),1,1);
  const material=new THREE.MeshStandardMaterial({map:texture,color:0x336699,opacity:0.75,transparent:true,roughness:0.42,metalness:0.23});
  const mesh:THREE.SkinnedMesh<THREE.BufferGeometry,THREE.Material|THREE.Material[]>=new THREE.SkinnedMesh(geometry,[material,material]); root.add(mesh);
  root.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton([bone]));
  root.userData={author:'scene',__assetDoctorSourceAudit:{stale:true}};
  mesh.userData={__assetDoctorUserNote:'keep',__assetDoctorAuthoredMaterials:{images:['data:image/obsolete']}};
  material.userData={author:'material',__assetDoctorAuthoredMaterials:{stale:true}};
  texture.userData={author:'texture',__assetDoctorSourceAudit:{stale:true}};
  const audit=auditGltfSource(new TextEncoder().encode(JSON.stringify({asset:{version:'2.0'},scenes:[{}]})).buffer);
  audit.resourceErrors.push('missing source image');
  audit.rawSkinWeights={accessorCount:1,vertexCount:3,invalidSumVertices:1,zeroWeightVertices:0,unreadableAccessors:0};
  captureSourceMetadata(root,audit,{extras:{author:'document',__assetDoctorSourceAudit:{}},textures:[{extras:{author:'texture',__assetDoctorAuthoredMaterials:{}}}]},new Map([[texture,{textures:0}]]));
  captureAuthoredMaterials(root);
  const authored=getAuthoredMaterialSet(mesh) as THREE.MeshStandardMaterial[];
  results.push({name:'F05 source metadata is not serialized; exact legacy fields are removed without dropping author extras',
    passed:!JSON.stringify(root.toJSON()).includes('__assetDoctorSourceAudit') && !JSON.stringify(root.toJSON()).includes('__assetDoctorAuthoredMaterials') &&
      mesh.userData.__assetDoctorUserNote==='keep' && material.userData.author==='material' && texture.userData.author==='texture' && authored[0].isMaterial});
  mesh.material=new THREE.MeshBasicMaterial({color:0xffffff}); // Source currently displays a preview override.
  captureAuthoredMaterials(root);
  const clip=new THREE.AnimationClip('UUID motion',1,[new THREE.VectorKeyframeTrack(bone.uuid+'.position',[0,1],[0,0,0,0,2,0])]);
  const originalName=clip.tracks[0].name;
  const clone=cloneForCompare(root,[clip]);
  const clonedMesh=clone.root.children.find(o=>(o as THREE.Mesh).isMesh) as THREE.SkinnedMesh;
  const clonedMaterials=clonedMesh.material as THREE.MeshStandardMaterial[];
  results.push({name:'F05 Compare recovers real authored PBR materials under preview overrides, preserving texture identity and material aliases',
    passed:getAuthoredMaterialSet(mesh)===authored && clonedMaterials[0]===clonedMaterials[1] && clonedMaterials[0]!==authored[0] &&
      clonedMaterials[0].isMeshStandardMaterial && clonedMaterials[0].map===texture && clonedMaterials[0].color.equals(material.color) &&
      clonedMaterials[0].opacity===0.75 && clonedMaterials[0].transparent && clonedMaterials[0].roughness===0.42 && clonedMaterials[0].metalness===0.23});
  results.push({name:'F05 Compare transfers source diagnostics and raw author extras outside userData',
    passed:getSourceAudit(clone.root)===audit && getSourceAudit(clone.root)?.rawSkinWeights?.invalidSumVertices===1 &&
      JSON.stringify(getDocumentExtras(clone.root))===JSON.stringify({author:'document'}) && JSON.stringify(getTextureExtras(clonedMaterials[0].map!))===JSON.stringify({author:'texture'}) &&
      clonedMesh.userData.__assetDoctorUserNote==='keep' && !JSON.stringify(clone.root.toJSON()).includes('__assetDoctorAuthoredMaterials')});
  results.push({name:'F05 diagnostics still report source weight defects and failed resources on original and clone',
    passed:[root,clone.root].every(object=>analyzeSkeletonAndSkinning(object).invalidWeightSumVertices===1 &&
      analyzeTextures(object).some(texture=>texture.format==='UNRESOLVED' && texture.name.includes('missing source image')))});
  const mixer=new THREE.AnimationMixer(clone.root); mixer.clipAction(clone.animations[0]).play(); mixer.setTime(0.5);
  results.push({name:'F05 Compare owns skeleton/bones and remaps UUID tracks to visible clone without modifying source clips',
    passed:clonedMesh.skeleton!==mesh.skeleton && clonedMesh.skeleton.bones[0]!==bone && clonedMesh.skeleton.bones[0].position.y===1 &&
      bone.position.y===0 && clip.tracks[0].name===originalName && clone.animations[0].tracks[0].name!==originalName && clonedMesh.geometry===geometry});
  mixer.stopAllAction(); mixer.uncacheRoot(clone.root);
  let cloneDisposals=0,borrowedDisposals=0;
  clonedMaterials[0].addEventListener('dispose',()=>cloneDisposals++);
  for(const resource of [geometry,texture,material,authored[0]])resource.addEventListener('dispose',()=>borrowedDisposals++);
  disposeCompareClone(clone.root);
  results.push({name:'F05 Compare cleanup disposes shared clone material once and keeps source geometry/textures/materials alive',passed:cloneDisposals===1 && borrowedDisposals===0});
  results.push({name:'F05 raw document/texture extras retain legal arrays, strings, false, zero, null and empty objects',
    passed:[['tag',false,0],'tag',false,0,null,{}].every(extras=>{
      const object=new THREE.Group(),map=new THREE.Texture();
      captureSourceMetadata(object,undefined,{extras,textures:[{extras}]},new Map([[map,{textures:0}]]));
      const observed=getDocumentExtras(object),textureObserved=getTextureExtras(map);
      map.dispose();
      return JSON.stringify(observed)===JSON.stringify(extras) && JSON.stringify(textureObserved)===JSON.stringify(extras);
    })});
  geometry.dispose();texture.dispose();material.dispose();authored[0].dispose();(mesh.material as THREE.Material).dispose();mesh.skeleton.dispose();
  return results;
}
