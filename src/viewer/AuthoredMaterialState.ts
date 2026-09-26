import * as THREE from 'three';

const KEY = '__assetDoctorAuthoredMaterials';

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
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    if (mesh.userData[KEY]) return;
    mesh.userData[KEY] = cloneMaterialSet(mesh.material, clones);
  });
}

export function getAuthoredMaterialSet(mesh: THREE.Mesh): THREE.Material | THREE.Material[] | null {
  const value = mesh.userData[KEY];
  if (!value) return null;
  return value as THREE.Material | THREE.Material[];
}

export function getAuthoredMaterials(mesh: THREE.Mesh): THREE.Material[] {
  const authored = getAuthoredMaterialSet(mesh) ?? mesh.material;
  return Array.isArray(authored) ? authored : [authored];
}

export function restoreAuthoredMaterials(mesh: THREE.Mesh) {
  const authored = getAuthoredMaterialSet(mesh);
  if (authored) mesh.material = authored;
}
