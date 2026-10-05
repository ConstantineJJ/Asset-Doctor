import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  estimateObjectGeometryBytes,
  nowMs,
  performanceCore,
} from '../performance/PerformanceProfiler';
import { auditGltfSource, type GltfSourceAudit } from './GltfSourceAudit';
import { captureAuthoredMaterials } from '../viewer/AuthoredMaterialState';
import { disposeModelResources } from './ModelResources';

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
  private ktx2Loader: KTX2Loader | null = null;
  private ktx2SupportDetected = false;
  private readonly loadingManager: THREE.LoadingManager;
  private activeResourceErrors: string[] = [];
  private loadSequence: Promise<void> = Promise.resolve();

  constructor() {
    this.loadingManager = new THREE.LoadingManager();
    this.loadingManager.onError = (url) => {
      if (!this.activeResourceErrors.includes(url)) this.activeResourceErrors.push(url);
    };
    this.gltfLoader = new GLTFLoader(this.loadingManager);

    // Meshopt is a bundled JS/WASM-free decoder module from the pinned Three.js
    // package. It has no CDN dependency and is safe for the future Tauri shell.
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);

    // Draco is part of the application now. Vite serves the decoder directly
    // from Three's pinned package during development and copies the same files
    // into dist/draco for production/Tauri, so model loading needs no CDN/network.
    try {
      this.dracoLoader = new DRACOLoader(this.loadingManager);
      const decoderPath = typeof window !== 'undefined'
        ? new URL('draco/', window.location.href).href
        : './draco/';
      this.dracoLoader.setDecoderPath(decoderPath);
      this.gltfLoader.setDRACOLoader(this.dracoLoader);
    } catch (e) {
      console.warn('DRACOLoader initialization notice:', e);
    }

    // KTX2/BasisU uses the same offline policy. GPU format support must be
    // detected against a renderer before a KTX2 texture is decoded; callers may
    // provide their real renderer via configureRenderer(). If they do not (for
    // example export verification), a tiny temporary renderer is used lazily.
    try {
      this.ktx2Loader = new KTX2Loader(this.loadingManager);
      const transcoderPath = typeof window !== 'undefined'
        ? new URL('basis/', window.location.href).href
        : './basis/';
      this.ktx2Loader.setTranscoderPath(transcoderPath);
      this.gltfLoader.setKTX2Loader(this.ktx2Loader);
    } catch (e) {
      console.warn('KTX2Loader initialization notice:', e);
    }
  }

  public configureRenderer(renderer: THREE.WebGLRenderer) {
    if (!this.ktx2Loader || this.ktx2SupportDetected) return;
    this.ktx2Loader.detectSupport(renderer);
    this.ktx2SupportDetected = true;
  }

  private ensureKtx2Support(sourceAudit: GltfSourceAudit) {
    if (!sourceAudit.extensionsUsed.includes('KHR_texture_basisu')) return;
    if (!this.ktx2Loader) {
      throw new Error('KTX2/BasisU texture support is unavailable in this build.');
    }
    if (this.ktx2SupportDetected) return;
    if (typeof document === 'undefined') {
      throw new Error('KTX2/BasisU decoding requires WebGL renderer capability detection.');
    }

    // Export verification and other non-viewport loader instances may not own a
    // renderer. Detect support once using a minimal temporary context; the KTX2
    // worker configuration does not retain this renderer afterwards.
    const probe = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
    try {
      this.configureRenderer(probe);
    } finally {
      probe.dispose();
      probe.forceContextLoss();
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
    // Check source content for every entry point, including GLB and renamed
    // files. A selected file never authorizes network or sibling-file access.
    if (sourceAudit.externalUris.length > 0) {
      throw new Error(
        `External model resources are not supported by single-file import: ${sourceAudit.externalUris.slice(0, 5).join(', ')}. Use a self-contained GLB/glTF.`
      );
    }
    this.activeResourceErrors = [];
    this.ensureKtx2Support(sourceAudit);
    return new Promise((resolve, reject) => {
      this.gltfLoader.parse(
        buffer,
        '',
        (gltf) => {
          if (this.activeResourceErrors.length > 0) {
            sourceAudit.resourceErrors = [...this.activeResourceErrors];
            disposeModelResources(gltf.scene);
            reject(new Error(`Model resources failed to load: ${this.activeResourceErrors.join(', ')}`));
            return;
          }
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
          if (this.activeResourceErrors.length > 0) {
            disposeModelResources(gltf.scene);
            reject(new Error(`Model resources failed to load: ${this.activeResourceErrors.join(', ')}`));
            return;
          }
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
    if (this.ktx2Loader) {
      this.ktx2Loader.dispose();
      this.ktx2Loader = null;
    }
  }
}
