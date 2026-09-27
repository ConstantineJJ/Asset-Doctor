import * as THREE from 'three';
import { cloneMaterialForShading } from './ShadingMode';

interface TestResult {
  name: string;
  passed: boolean;
  actual?: string;
  expected?: string;
}

export function runShadingModeTests(): TestResult[] {
  const results: TestResult[] = [];

  {
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    source.flatShading = false;
    const clone = cloneMaterialForShading(source, 'flat') as THREE.MeshStandardMaterial | null;
    results.push({
      name: 'Flat shading uses a presentation clone and leaves authored material unchanged',
      passed: Boolean(clone && clone !== source && clone.flatShading && !source.flatShading),
      actual: `${Boolean(clone && clone.flatShading)}/${source.flatShading}`,
      expected: 'true/false',
    });
    clone?.dispose();
    source.dispose();
  }

  {
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    source.flatShading = true;
    const clone = cloneMaterialForShading(source, 'smooth') as THREE.MeshStandardMaterial | null;
    results.push({
      name: 'Smooth shading disables flatShading only on the presentation clone',
      passed: Boolean(clone && clone !== source && !clone.flatShading && source.flatShading),
      actual: `${Boolean(clone && clone.flatShading)}/${source.flatShading}`,
      expected: 'false/true',
    });
    clone?.dispose();
    source.dispose();
  }

  {
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const clone = cloneMaterialForShading(source, 'hybrid');
    results.push({
      name: 'Hybrid shading preserves authored material state without cloning',
      passed: clone === null,
      actual: clone === null ? 'null' : 'clone',
      expected: 'null',
    });
    source.dispose();
  }

  return results;
}
