import * as THREE from 'three';

type Renderable=THREE.Mesh|THREE.Line|THREE.Points;
const authoredMaterials = new WeakMap<Renderable,THREE.Material | THREE.Material[]>();
const isRenderable=(object:THREE.Object3D):object is Renderable=>Boolean((object as THREE.Mesh).isMesh||(object as THREE.Line).isLine||(object as THREE.Points).isPoints);

function cloneMaterialSet(material: THREE.Material | THREE.Material[], clones: Map<THREE.Material, THREE.Material>) {
  const cloneOne = (source: THREE.Material) => {
    let clone = clones.get(source);
    if (!clone) {
      clone = source.clone();
      clones.set(source, clone);
    }
    return clone;
  };
  return Array.isArray(material) ? material.map(cloneOne) : cloneOne(material);
}

export function captureAuthoredMaterials(root: THREE.Object3D) {
  const clones = new Map<THREE.Material, THREE.Material>();
  root.traverse((object) => {
    if (!isRenderable(object)) return;
    const mesh = object;

    if (authoredMaterials.has(mesh)) return;
    authoredMaterials.set(mesh,cloneMaterialSet(mesh.material,clones));
  });
}

export function getAuthoredMaterialSet(mesh: Renderable): THREE.Material | THREE.Material[] | null {
  return authoredMaterials.get(mesh) ?? null;
}

export function getAuthoredMaterials(mesh: Renderable): THREE.Material[] {
  const authored = getAuthoredMaterialSet(mesh) ?? mesh.material;
  return Array.isArray(authored) ? authored : [authored];
}

export function restoreAuthoredMaterials(mesh: Renderable) {
  const authored = getAuthoredMaterialSet(mesh);
  if (authored) mesh.material = authored;
}

/** Copy real authored snapshots explicitly, even if the source displays Unlit/Flat. */
export function copyAuthoredMaterials(source: THREE.Object3D, clone: THREE.Object3D) {
  const originals: THREE.Object3D[] = [], targets: THREE.Object3D[] = [];
  source.traverse(object=>originals.push(object)); clone.traverse(object=>targets.push(object));
  if (originals.length !== targets.length) throw new Error('Clone hierarchy differs from its source');
  const materials = new Map<THREE.Material,THREE.Material>();
  originals.forEach((object,index)=>{
    if (!isRenderable(object)) return;
    const target=targets[index];
    if (!isRenderable(target)) throw new Error('Clone mesh hierarchy differs from its source');
    const sourceMesh=object;
    const authored=cloneMaterialSet(getAuthoredMaterialSet(sourceMesh) ?? sourceMesh.material,materials);
    authoredMaterials.set(target,authored); target.material=authored;
  });
}
