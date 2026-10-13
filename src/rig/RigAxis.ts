import * as THREE from 'three';

/** The longitudinal axis uses the selected branch; leaf guides add no deforming joint. */
export function boneAxis(bone:THREE.Bone,childUuid?:string,tip?:number[]) {
  const children=bone.children.filter((node):node is THREE.Bone=>node instanceof THREE.Bone);
  const child=children.find(node=>node.uuid===childUuid)??children[0];
  const point=child?child.position.clone():new THREE.Vector3().fromArray(tip??[0,.2,0]);
  if(!Number.isFinite(point.lengthSq())||point.lengthSq()<1e-12)throw new Error('The bone axis has zero length. Select another child or set a terminal guide.');
  return point.normalize();
}
