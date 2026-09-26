import * as THREE from 'three';
import {
  captureAuthoredMaterials,
  getAuthoredMaterialSet,
} from './AuthoredMaterialState';

interface TestResult {
  name: string;
  passed: boolean;
  actual?: string;
  expected?: string;
}

export function runAuthoredMaterialStateTests(): TestResult[] {
  const results: TestResult[] = [];

  {
    const sourceMaterial = new THREE.MeshStandardMaterial({
      color: 0x336699,
      roughness: 0.42,
      metalness: 0.23,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sourceMaterial);
    const root = new THREE.Group();
    root.add(mesh);

    captureAuthoredMaterials(root);
    const authored = getAuthoredMaterialSet(mesh);
    results.push({
      name: 'Authored material capture stores real THREE.Material instances',
      passed: Boolean(authored && !Array.isArray(authored) && authored.isMaterial),
      actual: authored ? String(!Array.isArray(authored) && authored.isMaterial) : 'null',
      expected: 'true',
    });

    mesh.geometry.dispose();
    sourceMaterial.dispose();
    if (authored && !Array.isArray(authored)) authored.dispose();
  }

  {
    const sourceMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sourceMaterial);
    const root = new THREE.Group();
    root.add(mesh);

    // Object3D/SkeletonUtils clone userData through JSON-style serialization.
    // Reproduce the stale snapshot that broke Compare Lineup PBR/Unlit/Base Color.
    mesh.userData.__assetDoctorAuthoredMaterials = JSON.parse(JSON.stringify(sourceMaterial));

    const staleLookup = getAuthoredMaterialSet(mesh);
    captureAuthoredMaterials(root);
    const repairedLookup = getAuthoredMaterialSet(mesh);

    results.push({
      name: 'Serialized authored material metadata is rejected and recaptured',
      passed:
        staleLookup === null &&
        Boolean(repairedLookup && !Array.isArray(repairedLookup) && repairedLookup.isMaterial),
      actual: `${staleLookup === null}/${Boolean(repairedLookup && !Array.isArray(repairedLookup) && repairedLookup.isMaterial)}`,
      expected: 'true/true',
    });

    mesh.geometry.dispose();
    sourceMaterial.dispose();
    if (repairedLookup && !Array.isArray(repairedLookup)) repairedLookup.dispose();
  }

  return results;
}
