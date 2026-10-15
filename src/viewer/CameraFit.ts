import * as THREE from 'three';

/** Distance from the box center that contains all eight corners in both FOVs.
 * direction points from target to camera; padding leaves a screen-space margin. */
export function cameraFitDistance(box:THREE.Box3,camera:THREE.PerspectiveCamera,direction:THREE.Vector3,padding=1.25){
 const center=box.getCenter(new THREE.Vector3());
 const rotation=new THREE.Matrix4().lookAt(direction,new THREE.Vector3(),camera.up);
 const right=new THREE.Vector3().setFromMatrixColumn(rotation,0),up=new THREE.Vector3().setFromMatrixColumn(rotation,1),back=new THREE.Vector3().setFromMatrixColumn(rotation,2);
 const vertical=Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()/2)),horizontal=vertical*Math.max(camera.aspect,1e-6);
 let distance=.2;
 for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
  const point=new THREE.Vector3(x,y,z).sub(center),depth=point.dot(back);
  distance=Math.max(distance,depth+Math.abs(point.dot(right))*padding/horizontal,depth+Math.abs(point.dot(up))*padding/vertical);
 }
 return distance;
}
