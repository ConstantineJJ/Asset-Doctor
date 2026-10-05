import * as THREE from 'three';
import type { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLBLoaderService, type LoadedModelResult } from './GLBLoaderService';

interface TestResult {
  name: string;
  passed: boolean;
  actual?: unknown;
  expected?: unknown;
}

const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

function triangleJson(uri?: string) {
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: positions.byteLength, ...(uri ? { uri } : {}) }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
  };
}

function jsonBuffer(json: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(json)).buffer;
}

function makeGlb(json: unknown, bin?: ArrayBuffer): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(jsonBytes.byteLength / 4) * 4;
  const binLength = bin ? Math.ceil(bin.byteLength / 4) * 4 : 0;
  const buffer = new ArrayBuffer(20 + jsonLength + (bin ? 8 + binLength : 0));
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  const jsonTarget = new Uint8Array(buffer, 20, jsonLength);
  jsonTarget.fill(0x20);
  jsonTarget.set(jsonBytes);
  if (bin) {
    view.setUint32(20 + jsonLength, binLength, true);
    view.setUint32(24 + jsonLength, 0x004e4942, true);
    new Uint8Array(buffer, 28 + jsonLength, binLength).set(new Uint8Array(bin));
  }
  return buffer;
}

function releaseModel(result: LoadedModelResult) {
  result.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

// Keep the real GLTFLoader, source audit and serialized asset. Only the network
// boundary is replaced: any escaped URL receives a valid triangle buffer, so a
// fixture cannot pass merely because Node/browser networking happened to fail.
function installFetchBoundary(requests: string[]): () => void {
  const previousFetch = globalThis.fetch;
  const previousProgressEvent = globalThis.ProgressEvent;
  globalThis.fetch = async (input, init) => {
    const uri = input instanceof Request ? input.url : String(input);
    if (/^data:/i.test(uri)) return previousFetch(input, init);
    requests.push(uri);
    return new Response(positions.buffer.slice(0), { status: 200 });
  };
  if (typeof previousProgressEvent === 'undefined') {
    globalThis.ProgressEvent = class extends Event {
      lengthComputable: boolean;
      loaded: number;
      total: number;

      constructor(type: string, init: ProgressEventInit = {}) {
        super(type);
        this.lengthComputable = init.lengthComputable ?? false;
        this.loaded = init.loaded ?? 0;
        this.total = init.total ?? 0;
      }
    } as typeof ProgressEvent;
  }
  return () => {
    globalThis.fetch = previousFetch;
    if (previousProgressEvent === undefined) delete (globalThis as any).ProgressEvent;
    else globalThis.ProgressEvent = previousProgressEvent;
  };
}

type ImportOutcome = { rejected: boolean; error: string; requests: string[]; vertices?: number };

async function importWithBoundary(buffer: ArrayBuffer, name: string, fromFile = true): Promise<ImportOutcome> {
  const requests: string[] = [];
  const restore = installFetchBoundary(requests);
  const service = new GLBLoaderService();
  try {
    const result = await (fromFile
      ? service.loadFromFile(new File([buffer], name))
      : service.loadFromArrayBuffer(buffer, name));
    let vertices = 0;
    result.root.traverse((object) => {
      if (object instanceof THREE.Mesh) vertices += object.geometry.getAttribute('position').count;
    });
    releaseModel(result);
    return { rejected: false, error: '', requests, vertices };
  } catch (error) {
    return { rejected: true, error: String(error), requests };
  } finally {
    service.dispose();
    restore();
  }
}

async function rejectsExternalResource(
  name: string,
  buffer: ArrayBuffer,
  fileName: string,
  uri: string,
  fromFile = true
): Promise<TestResult> {
  const outcome = await importWithBoundary(buffer, fileName, fromFile);
  return {
    name,
    passed: outcome.rejected && outcome.requests.length === 0 && outcome.error.includes(uri),
    actual: JSON.stringify(outcome),
    expected: `Reject mentioning ${uri} before any fetch`,
  };
}

// Browsers let GLTFLoader recover from a failed image by returning an untextured
// material. A controlled loader boundary reports that same manager error and
// then succeeds, without requiring a DOM/image decoder in this Node test runner.
async function resourceErrorOutcome(fromUrl: boolean) {
  const service = new GLBLoaderService();
  const boundary = service as unknown as { loadingManager: THREE.LoadingManager; gltfLoader: GLTFLoader };
  const failedUri = 'data:image/png;base64,broken-image';
  const root = new THREE.Group();
  const gltf = {
    scene: root, scenes: [root], animations: [], cameras: [],
    asset: { version: '2.0' }, parser: {} as GLTF['parser'], userData: {},
  } satisfies GLTF;
  const succeedAfterResourceError = (onLoad: (result: GLTF) => void) => {
    boundary.loadingManager.itemError(failedUri);
    onLoad(gltf);
  };
  boundary.gltfLoader.parse = (_data, _path, onLoad) => succeedAfterResourceError(onLoad);
  boundary.gltfLoader.load = (_url, onLoad) => succeedAfterResourceError(onLoad);
  try {
    await (fromUrl
      ? service.loadFromUrl('https://example.invalid/model.glb')
      : service.loadFromArrayBuffer(makeGlb({ asset: { version: '2.0' }, scenes: [{}], scene: 0 })));
    return { rejected: false, error: '', failedUri };
  } catch (error) {
    return { rejected: true, error: String(error), failedUri };
  } finally {
    service.dispose();
  }
}

export async function runGLBLoaderServiceTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  const selfContained = await importWithBoundary(makeGlb(triangleJson(), positions.buffer), 'triangle.glb');
  results.push({
    name: 'Single-file import loads a real self-contained GLB without network requests',
    passed: !selfContained.rejected && selfContained.vertices === 3 && selfContained.requests.length === 0,
    actual: JSON.stringify(selfContained), expected: 'Three imported vertices and no fetch',
  });

  const encodedPositions = btoa(String.fromCharCode(...new Uint8Array(positions.buffer)));
  const embedded = await importWithBoundary(
    jsonBuffer(triangleJson(`data:application/octet-stream;base64,${encodedPositions}`)), 'triangle.gltf'
  );
  results.push({
    name: 'Single-file import preserves embedded-data glTF support',
    passed: !embedded.rejected && embedded.vertices === 3,
    actual: JSON.stringify(embedded), expected: 'Three imported vertices from embedded data',
  });

  const remoteUri = 'https://example.invalid/triangle.bin';
  results.push(await rejectsExternalResource(
    'Single-file glTF import rejects remote buffers before fetching',
    jsonBuffer(triangleJson(remoteUri)), 'triangle.gltf', remoteUri
  ));
  results.push(await rejectsExternalResource(
    'Renaming glTF to GLB cannot bypass the single-file resource policy',
    jsonBuffer(triangleJson(remoteUri)), 'renamed.glb', remoteUri
  ));
  results.push(await rejectsExternalResource(
    'Single-file GLB import rejects remote buffers before fetching',
    makeGlb(triangleJson(remoteUri)), 'triangle.glb', remoteUri
  ));

  const nativeUri = 'file:///private/triangle.bin';
  results.push(await rejectsExternalResource(
    'Single-file GLB import rejects native file resources before fetching',
    makeGlb(triangleJson(nativeUri)), 'triangle.glb', nativeUri
  ));

  const imageUri = 'https://example.invalid/albedo.png';
  results.push(await rejectsExternalResource(
    'Single-file GLB import rejects external image references',
    makeGlb({ ...triangleJson(), images: [{ uri: imageUri }] }, positions.buffer), 'triangle.glb', imageUri
  ));
  results.push(await rejectsExternalResource(
    'Array-buffer GLB import enforces the same external resource policy',
    makeGlb(triangleJson(remoteUri)), 'triangle.glb', remoteUri, false
  ));

  for (const fromUrl of [false, true]) {
    const outcome = await resourceErrorOutcome(fromUrl);
    results.push({
      name: `${fromUrl ? 'URL' : 'Array-buffer'} import rejects a partial model after a resource loading error`,
      passed: outcome.rejected && outcome.error.includes(outcome.failedUri),
      actual: JSON.stringify(outcome), expected: 'Reject with the failed resource URI even if the parser succeeds',
    });
  }

  return results;
}
