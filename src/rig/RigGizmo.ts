import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RigEditSession, type ChildPolicy } from './RigEditSession';

export interface RigGizmoSettings {tool:'translate'|'rotate';space:'local'|'world';target:'joint'|'end';childPolicy:ChildPolicy;endChildUuid?:string}

/** Viewer-owned controls never become authored children or GLB extras. */
export class RigGizmo {
  readonly controls:TransformControls;
  private proxy=new THREE.Object3D();
  private guide=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xffc857,depthTest:false}));
  private settings:RigGizmoSettings={tool:'translate',space:'local',target:'joint',childPolicy:'follow'};
  private session:RigEditSession|null=null;
  private selected:string|null=null;
  private target:THREE.Bone|null=null;
  private leaf:THREE.Bone|null=null;
  private dragWorldScale=new THREE.Vector3();
  private failure:Error|null=null;

  constructor(scene:THREE.Scene,camera:THREE.Camera,canvas:HTMLElement,private callbacks:{drag:(active:boolean)=>void;changed:()=>void;error:(message:string)=>void}) {
    this.controls=new TransformControls(camera,canvas);
    const helper=this.controls.getHelper(); helper.name='__ascope_internal_rig_gizmo';
    this.proxy.name='__ascope_internal_rig_proxy'; this.guide.name='__ascope_internal_rig_tip'; this.guide.renderOrder=1001;
    scene.add(helper,this.proxy,this.guide);
    this.controls.setSize(.8);
    this.controls.addEventListener('mouseDown',()=>{
      this.failure=null;
      this.target?.getWorldScale(this.dragWorldScale);
      if(this.session?.mode==='edit') this.session.beginGesture();
      this.callbacks.drag(true);
    });
    this.controls.addEventListener('objectChange',()=>this.change());
    this.controls.addEventListener('mouseUp',()=>{
      if(this.leaf && this.session?.mode==='edit') {
        this.session.cancelGesture();
        try {this.commitLeaf();} catch(error) {this.callbacks.error(error instanceof Error?error.message:String(error));}
      }
      if(this.session?.mode==='edit') this.session.finishGesture();
      this.callbacks.drag(false); this.refresh(); this.callbacks.changed();
    });
  }
  get active() {return this.controls.enabled && !!this.controls.object && (this.controls.dragging || this.controls.axis!==null);}
  configure(session:RigEditSession|null,uuid:string|null,settings:RigGizmoSettings) {
    if(this.controls.dragging) return;
    this.session=session; this.selected=uuid; this.settings=settings; this.refresh();
  }
  refresh() {
    if(this.controls.dragging) return;
    this.controls.detach(); this.guide.visible=false; this.target=null;this.leaf=null;
    const session=this.session,bone=session?.root.getObjectByProperty('uuid',this.selected??'');
    if(!session || !(bone instanceof THREE.Bone) || session.mode==='inspect') return;
    session.root.updateWorldMatrix(true,true);
    let target=bone;
    if(this.settings.target==='end' && session.mode==='edit') {
      const child=bone.children.find(node=>node instanceof THREE.Bone && (!this.settings.endChildUuid || node.uuid===this.settings.endChildUuid));
      if(child instanceof THREE.Bone) target=child;
      else if(bone.children.some(node=>node instanceof THREE.Bone)) return;
      else this.leaf=bone;
    }
    this.target=target;
    target.getWorldPosition(this.proxy.position); target.getWorldQuaternion(this.proxy.quaternion); this.proxy.scale.set(1,1,1);
    if(this.leaf) {
      this.proxy.position.copy(new THREE.Vector3().fromArray(session.getTerminalTip(bone.uuid)??[0,.2,0]).applyMatrix4(bone.matrixWorld));
      this.guide.geometry.dispose();
      this.guide.geometry=new THREE.BufferGeometry().setFromPoints([bone.getWorldPosition(new THREE.Vector3()),this.proxy.position.clone()]); this.guide.visible=true;
    }
    this.proxy.updateMatrixWorld(true);
    this.controls.setMode(session.mode==='pose'?'rotate':this.settings.target==='end'?'translate':this.settings.tool);
    this.controls.setSpace(this.settings.space); this.controls.enabled=true; this.controls.attach(this.proxy);
  }
  private change() {
    const session=this.session,target=this.target;
    if(!session || !target || this.failure) return;
    try {
      if(this.leaf) return; // A leaf guide is committed on mouse release below.
      const parent=target.parent?.matrixWorld??new THREE.Matrix4();
      if(Math.abs(parent.determinant())<1e-10) throw new Error('Singular parent transform.');
      const position=this.proxy.position.clone().applyMatrix4(parent.clone().invert());
      let quaternion=target.quaternion.clone();
      if(this.controls.mode==='rotate') {
        const world=new THREE.Matrix4().compose(target.getWorldPosition(new THREE.Vector3()),this.proxy.quaternion,this.dragWorldScale);
        const local=parent.clone().invert().multiply(world),scale=new THREE.Vector3();
        local.decompose(new THREE.Vector3(),quaternion,scale);
        const rebuilt=new THREE.Matrix4().compose(target.position,quaternion,scale);
        if(local.elements.some((value,i)=>Math.abs(value-rebuilt.elements[i])>1e-5) || scale.distanceTo(target.scale)>1e-5) throw new Error('This rotation requires shear or scale changes under the parent.');
      }
      if(session.mode==='pose') session.previewPoseRotation(target.uuid,quaternion.toArray());
      else session.previewJoint(target.uuid,this.controls.mode==='rotate'?{quaternion:quaternion.toArray()}:{position:position.toArray()},this.settings.childPolicy);
    } catch(error) {
      this.failure=error instanceof Error?error:new Error(String(error)); session.cancelGesture(); this.callbacks.error(this.failure.message);
    }
  }
  commitLeaf() {
    if(!this.leaf || !this.session || this.failure) return;
    this.session.setTerminalTip(this.leaf.uuid,this.proxy.position.clone().applyMatrix4(this.leaf.matrixWorld.clone().invert()).toArray());
  }
  dispose() {
    this.session?.cancelGesture(); this.controls.getHelper().removeFromParent();this.controls.dispose();this.proxy.removeFromParent();this.guide.removeFromParent();this.guide.geometry.dispose();(this.guide.material as THREE.Material).dispose();
  }
}
