import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import {
  estimateObjectGeometryBytes,
  nowMs,
  performanceCore,
} from '../performance/PerformanceProfiler';
import { auditGltfSource, type GltfSourceAudit } from './GltfSourceAudit';
import { captureAuthoredMaterials } from '../viewer/AuthoredMaterialState';

export interface LoadedModelResult {
  fileName: string;
  fileSizeBytes?: number;
  root: THREE.Group;
  animations: THREE.AnimationClip[];
  sourceBuffer?: ArrayBuffer;
  sourceAudit?: GltfSourceAudit;
}

export class GLBLoaderService {
  private gltfLoader: GLTFLoader;
  private dracoLoader: DRACOLoader | null = null;
  private readonly loadingManager: THREE.LoadingManager;
  private activeResourceErrors: string[] = [];
  private loadSequence: Promise<void> = Promise.resolve();

  constructor() {
    this.loadingManager = new THREE.LoadingManager();
    this.loadingManager.onError = (url) => {
      if (!this.activeResourceErrors.includes(url)) this.activeResourceErrors.push(url);
    };
    this.gltfLoader = new GLTFLoader(this.loadingManager);

    // Draco is part of the application now. Vite serves the decoder directly
    // from Three's pinned package during development and copies the same files
    // into dist/draco for production/Tauri, so model loading needs no CDN/network.
    try {
      this.dracoLoader = new DRACOLoader(this.loadingManager);
      this.dracoLoader.setDecoderPath(new URL('draco/', window.location.href).href);
      this.gltfLoader.setDRACOLoader(this.dracoLoader);
    } catch (e) {
      console.warn('DRACOLoader initialization notice:', e);
    }
  }

  public loadFromFile(file: File): Promise<LoadedModelResult> {
    // LoadingManager and GLTFLoader are stateful. More importantly, two user
    // selections must never race so that a slower old file replaces the newer
    // choice. Serializing requests guarantees completion order == selection order.
    const task = this.loadSequence.then(() => this.loadFromFileNow(file));
    this.loadSequence = task.then(() => undefined, () => undefined);
    return task;
  }

  private async loadFromFileNow(file: File): Promise<LoadedModelResult> {
    const startedAt = nowMs();
    const arrayBuffer = await file.arrayBuffer();
    const sourceAudit = auditGltfSource(arrayBuffer);

    // A single browser File cannot resolve a normal .gltf package containing
    // sibling .bin/images. Failing loudly is safer than loading a partial model
    // and reporting "No textures" as if that were authored intent.
    if (/\.gltf$/i.test(file.name) && sourceAudit.externalUris.length > 0) {
      throw new Error(
        `External .gltf resources are not supported by single-file import yet: ${sourceAudit.externalUris.slice(0, 5).join(', ')}. Use a self-contained GLB.`
      );
    }

    const result = await this.loadFromArrayBuffer(arrayBuffer, file.name, file.size, sourceAudit);

    performanceCore.resetForAsset(
      arrayBuffer.byteLength,
      estimateObjectGeometryBytes(result.root)
    );
    performanceCore.record('initialLoad', nowMs() - startedAt);

    // GLTFLoader.parse does not mutate the source ArrayBuffer. Keep the original
    // buffer as the pristine export source instead of retaining an unnecessary
    // full-size copy beside it (important for multi-hundred-MB assets).
    return { ...result, sourceBuffer: arrayBuffer, sourceAudit };
  }

  public async loadFromArrayBuffer(
    buffer: ArrayBuffer,
    fileName: string = 'model.glb',
    fileSizeBytes?: number,
    sourceAudit: GltfSourceAudit = auditGltfSource(buffer)
  ): Promise<LoadedModelResult> {
    this.activeResourceErrors = [];
    return new Promise((resolve, reject) => {
      this.gltfLoader.parse(
        buffer,
        '',
        (gltf) => {
          const root = gltf.scene || new THREE.Group();
          if (!root.name) root.name = fileName.replace(/\.[^/.]+$/, '');

          // Snapshot authored material state before SceneManager applies any
          // viewport-only visibility/culling/presentation adjustments.
          captureAuthoredMaterials(root);
          root.userData.__assetDoctorSourceAudit = sourceAudit;
          sourceAudit.resourceErrors = [...this.activeResourceErrors];

          resolve({
            fileName,
            fileSizeBytes: fileSizeBytes ?? buffer.byteLength,
            root,
            animations: gltf.animations || [],
            sourceAudit,
          });
        },
        (error) => {
          sourceAudit.resourceErrors = [...this.activeResourceErrors];
          reject(new Error(`Failed to parse GLB/glTF model: ${error}`));
        }
      );
    });
  }

  public async loadFromUrl(url: string, fileName?: string): Promise<LoadedModelResult> {
    this.activeResourceErrors = [];
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          const name = fileName || url.split('/').pop() || 'model.glb';
          const root = gltf.scene || new THREE.Group();
          captureAuthoredMaterials(root);
          resolve({
            fileName: name,
            root,
            animations: gltf.animations || [],
          });
        },
        undefined,
        (err) => {
          reject(new Error(`Failed to load GLB from URL: ${err}`));
        }
      );
    });
  }

  public dispose() {
    if (this.dracoLoader) {
      this.dracoLoader.dispose();
      this.dracoLoader = null;
    }
  }
}