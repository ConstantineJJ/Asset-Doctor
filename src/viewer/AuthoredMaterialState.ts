import * as THREE from 'three';

const KEY = '__assetDoctorAuthoredMaterials';

function isMaterial(value: unknown): value is THREE.Material {
  return Boolean(value && typeof value === 'object' && (value as THREE.Material).isMaterial === true);
}

function isMaterialSet(value: unknown): value is THREE.Material | THREE.Material[] {
  if (Array.isArray(value)) return value.length > 0 && value.every(isMaterial);
  return isMaterial(value);
}

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

    // Object3D.clone()/SkeletonUtils.clone() deep-serializes userData. Material
    // objects stored there therefore become plain JSON snapshots on the clone.
    // They look populated but are not renderable THREE.Material instances. Treat
    // that stale metadata as absent and replace it with a fresh authored snapshot.
    if (getAuthoredMaterialSet(mesh)) return;
    mesh.userData[KEY] = cloneMaterialSet(mesh.material, clones);
  });
}

export function getAuthoredMaterialSet(mesh: THREE.Mesh): THREE.Material | THREE.Material[] | null {
  const value = mesh.userData[KEY];
  return isMaterialSet(value) ? value : null;
}

export function getAuthoredMaterials(mesh: THREE.Mesh): THREE.Material[] {
  const authored = getAuthoredMaterialSet(mesh) ?? mesh.material;
  return Array.isArray(authored) ? authored : [authored];
}

export function restoreAuthoredMaterials(mesh: THREE.Mesh) {
  const authored = getAuthoredMaterialSet(mesh);
  if (authored) mesh.material = authored;
}
