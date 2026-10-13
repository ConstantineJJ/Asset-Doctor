import * as THREE from 'three';

/** Freeze a live preview before mixer caches restore their original bindings. */
export function capturePreviewPose(root:THREE.Group) {
  const pose:{node:THREE.Object3D;position:THREE.Vector3;quaternion:THREE.Quaternion;scale:THREE.Vector3;morphs?:number[]}[]=[];
  root.traverse(node=>pose.push({node,position:node.position.clone(),quaternion:node.quaternion.clone(),scale:node.scale.clone(),morphs:(node as THREE.Mesh).morphTargetInfluences?.slice()}));
  return ()=>{
    for(const item of pose){item.node.position.copy(item.position);item.node.quaternion.copy(item.quaternion);item.node.scale.copy(item.scale);if(item.morphs)(item.node as THREE.Mesh).morphTargetInfluences=item.morphs.slice();item.node.updateMatrix();}
    root.updateMatrixWorld(true);
  };
}
