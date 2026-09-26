import { auditGltfSource } from './GltfSourceAudit';

interface TestResult {
  name: string;
  passed: boolean;
  actual?: unknown;
  expected?: unknown;
}

function makeGlb(json: unknown, bin: Uint8Array) {
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(JSON.stringify(json));
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const binLength = Math.ceil(bin.byteLength / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  const jsonTarget = new Uint8Array(buffer, 20, jsonLength);
  jsonTarget.fill(0x20);
  jsonTarget.set(jsonBytes);
  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, binLength, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  new Uint8Array(buffer, binHeader + 8, binLength).set(bin);
  return buffer;
}

export function runGltfSourceAuditTests(): TestResult[] {
  const results: TestResult[] = [];

  const weights = new Float32Array([
    0.6, 0.2, 0, 0,
    0.8, 0.4, 0, 0,
    0, 0, 0, 0,
    1, 0, 0, 0,
  ]);
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_materials_variants', 'KHR_draco_mesh_compression'],
    buffers: [{ byteLength: weights.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: weights.byteLength }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 4,
      type: 'VEC4',
    }],
    meshes: [{ primitives: [{ attributes: { WEIGHTS_0: 0 } }] }],
    materials: [{ name: 'A' }, { name: 'B' }],
    textures: [{ source: 0 }],
    images: [{ bufferView: 0, mimeType: 'image/png' }],
    animations: [{ channels: [], samplers: [] }],
  };
  const audit = auditGltfSource(makeGlb(json, new Uint8Array(weights.buffer)));
  results.push({
    name: 'Source audit sees semantic extensions before export',
    passed: audit.semanticExtensions.length === 1 && audit.semanticExtensions[0] === 'KHR_materials_variants',
    actual: audit.semanticExtensions,
    expected: ['KHR_materials_variants'],
  });
  results.push({
    name: 'Source audit sees skin-weight defects before GLTFLoader normalization',
    passed: audit.rawSkinWeights?.invalidSumVertices === 2 && audit.rawSkinWeights.zeroWeightVertices === 1,
    actual: audit.rawSkinWeights,
    expected: { invalidSumVertices: 2, zeroWeightVertices: 1 },
  });
  results.push({
    name: 'Source audit records raw semantic definition counts',
    passed: audit.materialCount === 2 && audit.textureCount === 1 && audit.imageCount === 1 && audit.animationCount === 1,
    actual: [audit.materialCount, audit.textureCount, audit.imageCount, audit.animationCount],
    expected: [2, 1, 1, 1],
  });

  const gltf = new TextEncoder().encode(JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ uri: 'mesh.bin', byteLength: 12 }],
    images: [{ uri: 'albedo.png' }],
  })).buffer;
  const external = auditGltfSource(gltf);
  results.push({
    name: 'Source audit detects external glTF package dependencies',
    passed: external.externalUris.join('|') === 'mesh.bin|albedo.png',
    actual: external.externalUris,
    expected: ['mesh.bin', 'albedo.png'],
  });

  return results;
}
