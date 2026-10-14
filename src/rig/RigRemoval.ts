import * as THREE from 'three';
import {documentMatrix} from '../viewer/AssetPresentation';
import {isGltfCubic} from '../animation/ClipEdits';

export type RemovalScope='joint'|'chain';
export interface RemovalSummary {removedJointCount:number;affectedVertices:number;removedTrackCount:number;staticMeshCount:number;retainedTransformCount:number;warnings:string[]}
export function removalBones(root:THREE.Group,uuid:string,scope:RemovalScope) {
  const selected=root.getObjectByProperty('uuid',uuid);
  if(!(selected instanceof THREE.Bone)||!['joint','chain'].includes(scope))throw new Error('Select an active joint.');
  const removed=new Set<THREE.Bone>([selected]);
  if(scope==='chain')selected.traverse(node=>{if(node instanceof THREE.Bone)removed.add(node);});
  return removed;
}
/** Plan per skin; even zero-weight slots must refer to a valid surviving joint. */
export function removalSlots(skin:THREE.Skeleton,removed:Set<THREE.Bone>) {
  const kept=skin.bones.filter(bone=>!removed.has(bone));
  const slots=skin.bones.map(bone=>{
    if(!removed.has(bone))return kept.indexOf(bone);
    for(let ancestor=bone.parent;ancestor;ancestor=ancestor.parent)if(ancestor instanceof THREE.Bone&&kept.includes(ancestor))return kept.indexOf(ancestor);
    return kept.length?0:-1;
  });return {kept,slots};
}
export function remapInfluences(mesh:THREE.SkinnedMesh,geometry:THREE.BufferGeometry,slots:number[]) {
  const joints=geometry.getAttribute('skinIndex'),weights=geometry.getAttribute('skinWeight');
  if(!joints||!weights||joints.count!==weights.count||joints.itemSize!==4||weights.itemSize!==4)throw new Error('Skin influence attributes are invalid.');
  const values=new Uint16Array(joints.count*4);
  for(let v=0;v<joints.count;v++)for(let c=0;c<4;c++) {
    const slot=joints.getComponent(v,c),weight=weights.getComponent(v,c);
    if(!Number.isInteger(slot)||slot<0||slot>=mesh.skeleton.bones.length||!Number.isFinite(weight)||weight<0)throw new Error('Skin influence attributes are invalid.');
    values[v*4+c]=Math.max(0,slots[slot]);
  }return values;
}
/** Three's skin-normal shader uses the linear blended skin matrix, not inverse-transpose. */
export function bakeRestSkin(mesh:THREE.SkinnedMesh,geometry:THREE.BufferGeometry) {
  const result=geometry.clone(),joints=geometry.getAttribute('skinIndex'),weights=geometry.getAttribute('skinWeight');
  const inverse=documentMatrix(mesh);if(Math.abs(inverse.determinant())<1e-10)throw new Error('Singular mesh transform cannot be baked.');inverse.invert();
  const matrices=mesh.skeleton.bones.map((bone,i)=>documentMatrix(bone).multiply(mesh.skeleton.boneInverses[i]));
  const position=geometry.getAttribute('position'),normals=geometry.getAttribute('normal');
  const transforms:THREE.Matrix4[]=[],normalLengths:number[]=[];
  for(let v=0;v<position.count;v++) {
    const sum=new THREE.Matrix4();sum.elements.fill(0);
    for(let c=0;c<4;c++){const matrix=matrices[joints.getComponent(v,c)],weight=weights.getComponent(v,c);for(let i=0;i<16;i++)sum.elements[i]+=matrix.elements[i]*weight;}
    const transform=inverse.clone().multiply(sum).multiply(mesh.bindMatrix);transforms.push(transform);
    const n=normals?new THREE.Vector3().fromBufferAttribute(normals,v).applyMatrix3(new THREE.Matrix3().setFromMatrix4(transform)).length():1;
    normalLengths.push(n>1e-12?n:1);
  }
  const transformAttribute=(attribute:THREE.BufferAttribute|THREE.InterleavedBufferAttribute,semantic:string,morph:boolean)=>{
    const values=new Float32Array(attribute.count*attribute.itemSize);
    for(let v=0;v<attribute.count;v++) {
      const point=new THREE.Vector3().fromBufferAttribute(attribute,v),matrix=transforms[v],linear=new THREE.Matrix3().setFromMatrix4(matrix);
      if(semantic==='position'&&(!morph||!geometry.morphTargetsRelative))point.applyMatrix4(matrix);else point.applyMatrix3(linear);
      if(semantic==='normal')point.divideScalar(normalLengths[v]);
      if(semantic==='tangent'&&!morph)point.normalize();
      point.toArray(values,v*attribute.itemSize);if(attribute.itemSize===4)values[v*4+3]=attribute.getW(v);
    }
    if(values.some(value=>!Number.isFinite(value)))throw new Error('Static skin bake produced nonfinite values.');
    return new THREE.Float32BufferAttribute(values,attribute.itemSize);
  };
  for(const semantic of ['position','normal','tangent']) {
    const attribute=geometry.getAttribute(semantic);if(attribute)result.setAttribute(semantic,transformAttribute(attribute,semantic,false));
    const morphs=geometry.morphAttributes[semantic as keyof typeof geometry.morphAttributes];
    if(morphs)result.morphAttributes[semantic as keyof typeof result.morphAttributes]=morphs.map(attribute=>transformAttribute(attribute,semantic,true));
  }
  result.deleteAttribute('skinIndex');result.deleteAttribute('skinWeight');result.computeBoundingBox();result.computeBoundingSphere();return result;
}
/** Hold the original endpoint when deleting the track that supplied a clip's duration. */
export function holdClipDuration(clip:THREE.AnimationClip) {
  const last=Math.max(...clip.tracks.map(track=>track.times[track.times.length-1]??0));
  if(last>=clip.duration)return;
  const track=clip.tracks[0],cubic=isGltfCubic(track),size=track.getValueSize()/(cubic?3:1),values=Array.from(track.values);
  if(cubic){const start=values.length-size*3;values.fill(0,start+size*2);values.push(...Array(size).fill(0),...values.slice(start+size,start+size*2),...Array(size).fill(0));}
  else values.push(...values.slice(-size));
  track.times=Float32Array.from([...track.times,clip.duration]);track.values=Float32Array.from(values);
}
