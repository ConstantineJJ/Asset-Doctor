import * as THREE from 'three';
import { analyzeMaterials } from './MaterialAnalyzer';
import { analyzeTextures } from './TextureAnalyzer';
import { captureAuthoredMaterials } from '../viewer/AuthoredMaterialState';

interface TestResult {
  name: string;
  passed: boolean;
  actual?: unknown;
  expected?: unknown;
}

export function runSourceFidelityTests(): TestResult[] {
  const results: TestResult[] = [];

  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0xabcdef,
    opacity: 0.02,
    transparent: true,
    side: THREE.FrontSide,
  });
  material.name = 'AuthoredTransparent';
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  root.add(mesh);
  captureAuthoredMaterials(root);

  // Simulate the exact kind of viewport presentation mutation that Astra found.
  material.opacity = 1;
  material.transparent = false;
  material.side = THREE.DoubleSide;
  material.depthWrite = true;

  const materials = analyzeMaterials(root);
  results.push({
    name: 'Material diagnostics read authored state instead of viewport mutation',
    passed:
      materials.length === 1 &&
      materials[0].opacity === 0.02 &&
      materials[0].alphaMode === 'BLEND' &&
      materials[0].doubleSided === false,
    actual: materials[0],
    expected: { opacity: 0.02, alphaMode: 'BLEND', doubleSided: false },
  });

  const maskRoot = new THREE.Group();
  const mask = new THREE.MeshStandardMaterial({ alphaTest: 0.5, transparent: false });
  maskRoot.add(new THREE.Mesh(new THREE.BufferGeometry(), mask));
  captureAuthoredMaterials(maskRoot);
  const maskInfo = analyzeMaterials(maskRoot)[0];
  results.push({
    name: 'Material diagnostics distinguish MASK from OPAQUE',
    passed: maskInfo?.alphaMode === 'MASK',
    actual: maskInfo?.alphaMode,
    expected: 'MASK',
  });

  const textureRoot = new THREE.Group();
  const dataTexture = new THREE.Texture();
  dataTexture.name = 'LinearDataMap';
  dataTexture.colorSpace = THREE.NoColorSpace;
  Object.defineProperty(dataTexture, 'image', {
    value: { width: 256, height: 128 },
    configurable: true,
  });
  const textured = new THREE.MeshStandardMaterial({ roughnessMap: dataTexture });
  textureRoot.add(new THREE.Mesh(new THREE.BufferGeometry(), textured));
  captureAuthoredMaterials(textureRoot);
  const textureInfo = analyzeTextures(textureRoot)[0];
  results.push({
    name: 'Texture diagnostics preserve empty data color space instead of assuming sRGB',
    passed: textureInfo?.colorSpace === 'none/data',
    actual: textureInfo?.colorSpace,
    expected: 'none/data',
  });

  mesh.geometry.dispose();
  material.dispose();
  mask.dispose();
  dataTexture.dispose();
  textured.dispose();

  return results;
}
