import * as THREE from 'three';
import {
  cloneGeometryForSmoothShading,
  cloneMaterialForShading,
} from './ShadingMode';

interface TestResult {
  name: string;
  passed: boolean;
  actual?: string;
  expected?: string;
}

const near = (value: number, expected: number, epsilon = 1e-4) => Math.abs(value - expected) <= epsilon;

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

  {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 0,
      0, 0, 1,
      1, 0, 0,
    ], 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ], 3));

    const clone = cloneGeometryForSmoothShading(geometry);
    const cloneNormals = clone?.getAttribute('normal');
    const sourceNormals = geometry.getAttribute('normal');
    const expected = Math.SQRT1_2;
    const smoothedAcrossSplit = Boolean(
      cloneNormals
      && near(cloneNormals.getY(0), expected)
      && near(cloneNormals.getZ(0), expected)
      && near(cloneNormals.getY(3), expected)
      && near(cloneNormals.getZ(3), expected)
    );
    const sourceUntouched = sourceNormals.getY(0) === 0
      && sourceNormals.getZ(0) === 1
      && sourceNormals.getY(3) === 1
      && sourceNormals.getZ(3) === 0;

    results.push({
      name: 'Smooth shading recomputes coincident split normals on a presentation geometry clone',
      passed: Boolean(clone && clone !== geometry && smoothedAcrossSplit && sourceUntouched),
      actual: cloneNormals
        ? `${cloneNormals.getY(0).toFixed(3)},${cloneNormals.getZ(0).toFixed(3)} / source ${sourceNormals.getY(0)},${sourceNormals.getZ(0)}`
        : 'no clone',
      expected: '0.707,0.707 / source 0,1',
    });

    clone?.dispose();
    geometry.dispose();
  }

  return results;
}
