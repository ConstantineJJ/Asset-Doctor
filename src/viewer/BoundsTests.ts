import * as THREE from 'three';
import {BoundsCalculator} from './BoundsCalculator';
import {cameraFitDistance} from './CameraFit';

export function runBoundsTests(){
 const results:{name:string;passed:boolean;expected?:unknown;actual?:unknown}[]=[];
 const root=new THREE.Group(),geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([10,0,0,20,2,4],3));
 const line=new THREE.Line(geometry,new THREE.LineBasicMaterial());line.position.x=5;root.add(line);
 const pointsGeometry=new THREE.BufferGeometry();pointsGeometry.setAttribute('position',new THREE.Float32BufferAttribute([-12,-4,-2,-10,1,1],3));
 root.add(new THREE.Points(pointsGeometry,new THREE.PointsMaterial()));
 const bounds=BoundsCalculator.computeAccurateWorldBounds(root).box;
 results.push({name:'Review: framing includes authored Line and Points geometry',passed:bounds.min.equals(new THREE.Vector3(-12,-4,-2))&&bounds.max.equals(new THREE.Vector3(25,2,4)),expected:[[-12,-4,-2],[25,2,4]],actual:[bounds.min.toArray(),bounds.max.toArray()]});
 const visible=new THREE.Group();visible.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial()));
 const hidden=new THREE.Group();hidden.visible=false;hidden.position.x=100;hidden.add(new THREE.Mesh(new THREE.BoxGeometry(10,10,10),new THREE.MeshBasicMaterial()));visible.add(hidden);
 const box=BoundsCalculator.computeAccurateWorldBounds(visible).box;
 results.push({name:'Review: hidden parent excludes visible descendants from framing',passed:box.min.equals(new THREE.Vector3(-.5,-.5,-.5))&&box.max.equals(new THREE.Vector3(.5,.5,.5)),expected:[[-.5,-.5,-.5],[.5,.5,.5]],actual:[box.min.toArray(),box.max.toArray()]});
 let maximum=0;
 const asymmetric=new THREE.Box3(new THREE.Vector3(-10,-1,-3),new THREE.Vector3(10,4,6)),center=asymmetric.getCenter(new THREE.Vector3());
 for(const aspect of [.25,1,4])for(const zoom of [1,2])for(const direction of [new THREE.Vector3(1,.75,1.25).normalize(),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)]){
  const camera=new THREE.PerspectiveCamera(45,aspect,.001,10000);camera.zoom=zoom;
  camera.position.copy(center).add(direction.clone().multiplyScalar(cameraFitDistance(asymmetric,camera,direction)));
  camera.lookAt(center);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  for(const x of [asymmetric.min.x,asymmetric.max.x])for(const y of [asymmetric.min.y,asymmetric.max.y])for(const z of [asymmetric.min.z,asymmetric.max.z]){const p=new THREE.Vector3(x,y,z).project(camera);maximum=Math.max(maximum,Math.abs(p.x),Math.abs(p.y));}
 }
 results.push({name:'Review: camera framing honors horizontal FOV, zoom and view direction',passed:Number.isFinite(maximum)&&maximum<=1,expected:'All corners in NDC [-1,1] for 18 views',actual:maximum});
 return results;
}
