import * as THREE from 'three';

/** Three r186 caches transmission targets per scene/camera without a scene
 * disposal API. Observe the public render callback/target API while the opaque
 * pass is bound, then release those targets when this private viewer scene ends.
 * Shadow passes use onBeforeShadow and remain owned by the lights themselves. */
export class SceneRenderResources {
  private targets=new Set<THREE.WebGLRenderTarget>();
  private probe:THREE.Mesh;
  constructor(scene:THREE.Scene){
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([],3));
    this.probe=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false}));
    this.probe.name='__ascope_internal_render_resources';
    this.probe.frustumCulled=false;
    // Zero vertices: this participates in callbacks, without issuing a draw.
    this.probe.onBeforeRender=renderer=>{
      const target=renderer.getRenderTarget();if(target)this.targets.add(target);
    };
    scene.add(this.probe);
  }
  dispose(){
    this.probe.removeFromParent();this.probe.geometry.dispose();
    (this.probe.material as THREE.Material).dispose();
    for(const target of this.targets)target.dispose();this.targets.clear();
  }
}
