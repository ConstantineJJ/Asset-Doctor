import * as THREE from 'three';
import {disposeModelResources} from '../loaders/ModelResources';

/** Presentation-only rig, attached to the actual animated Grid/Lineup root. */
export class CompareRigOverlay {
  readonly group=new THREE.Group();
  private bones:THREE.Bone[]=[];
  private points:THREE.Points;
  private world=new THREE.Vector3();
  constructor(private root:THREE.Object3D,scene:THREE.Scene,visible:boolean){
    this.group.name='__ascope_internal_compare_rig';
    root.traverse(node=>{if((node as THREE.Bone).isBone)this.bones.push(node as THREE.Bone);});
    const helper=new THREE.SkeletonHelper(root);
    const material=helper.material as THREE.LineBasicMaterial;
    material.depthTest=false;material.depthWrite=false;
    material.vertexColors=false;material.color.set(0x00ffff);
    material.toneMapped=false;helper.renderOrder=1000;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(this.bones.length*3),3));
    this.points=new THREE.Points(geometry,new THREE.PointsMaterial({color:0xbaff00,size:7,sizeAttenuation:false,depthTest:false,depthWrite:false,toneMapped:false}));
    this.points.frustumCulled=false;this.points.renderOrder=1001;
    this.group.add(helper,this.points);scene.add(this.group);this.setVisible(visible);
  }
  setVisible(visible:boolean){this.group.visible=visible&&this.bones.length>0;this.update();}
  update(){
    if(!this.group.visible)return;
    this.root.updateWorldMatrix(true,true);
    const positions=this.points.geometry.getAttribute('position');
    this.bones.forEach((bone,index)=>{bone.getWorldPosition(this.world);positions.setXYZ(index,this.world.x,this.world.y,this.world.z);});positions.needsUpdate=true;
  }
  dispose(){this.group.removeFromParent();disposeModelResources(this.group);this.group.clear();this.bones=[];}
}
