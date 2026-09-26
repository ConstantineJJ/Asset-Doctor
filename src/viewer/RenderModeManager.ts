import * as THREE from 'three';
import type { RenderMode } from '../types';

/**
 * Presentation-only render modes.
 *
 * The authored materials registered for each mesh are never mutated. Diagnostic
 * analysis and export can therefore inspect the same material state regardless
 * of the currently selected viewport mode.
 */
export class RenderModeManager {
  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private temporaryMaterials = new Set<THREE.Material>();
  private currentMode: RenderMode = 'pbr';
  private uvCheckerTexture: THREE.CanvasTexture | null = null;
  private overlayGroup: THREE.Group;

  constructor(scene: THREE.Scene) {
    this.overlayGroup = new THREE.Group();
    this.overlayGroup.name = '__ascope_internal_render_overlays';
    scene.add(this.overlayGroup);
  }

  public registerMesh(mesh: THREE.Mesh) {
    if (!this.originalMaterials.has(mesh)) {
      this.originalMaterials.set(mesh, mesh.material);
    }
  }

  public getMode(): RenderMode {
    return this.currentMode;
  }

  /** Execute a synchronous read while authored materials are temporarily visible. */
  public withOriginalMaterials<T>(root: THREE.Object3D, callback: () => T): T {
    const current = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    root.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const mesh = object as THREE.Mesh;
      current.set(mesh, mesh.material);
      const original = this.originalMaterials.get(mesh);
      if (original) mesh.material = original;
    });
    try {
      return callback();
    } finally {
      for (const [mesh, material] of current) mesh.material = material;
    }
  }

  private getOrCreateUvCheckerTexture(): THREE.CanvasTexture {
    if (this.uvCheckerTexture) return this.uvCheckerTexture;

    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const tiles = 16;
    const tileSize = size / tiles;

    ctx.fillStyle = '#22252a';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < tiles; y++) {
      for (let x = 0; x < tiles; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#f3f4f6' : '#9ca3af';
        ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        ctx.strokeStyle = '#4b5563';
        ctx.lineWidth = 1;
        ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
        if (x % 2 === 0 && y % 2 === 0) {
          ctx.fillStyle = '#111827';
          ctx.font = 'bold 12px monospace';
          ctx.fillText(`${x},${y}`, x * tileSize + 4, y * tileSize + 16);
        }
      }
    }
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this.uvCheckerTexture = texture;
    return texture;
  }

  private track<T extends THREE.Material>(material: T): T {
    this.temporaryMaterials.add(material);
    return material;
  }

  private clearPresentationMaterials() {
    for (const material of this.temporaryMaterials) material.dispose();
    this.temporaryMaterials.clear();

    // Overlay meshes reuse source geometry. Dispose only overlay materials.
    this.overlayGroup.traverse((object) => {
      const renderable = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
      if (Array.isArray(renderable.material)) renderable.material.forEach((material) => material.dispose());
      else renderable.material?.dispose();
    });
    this.overlayGroup.clear();
  }

  private restoreOriginals(root: THREE.Object3D) {
    root.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const mesh = object as THREE.Mesh;
      const original = this.originalMaterials.get(mesh);
      if (original) mesh.material = original;
    });
  }

  private sourceMaterial(original: THREE.Material | THREE.Material[]) {
    const material = Array.isArray(original) ? original[0] : original;
    return material as THREE.MeshStandardMaterial | undefined;
  }

  private channelMaterial(
    texture: THREE.Texture | null | undefined,
    scalar: number,
    channel: 'g' | 'b'
  ): THREE.Material {
    if (!texture) {
      return this.track(new THREE.MeshBasicMaterial({
        color: new THREE.Color(scalar, scalar, scalar),
        side: THREE.DoubleSide,
      }));
    }

    return this.track(new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { sourceMap: { value: texture }, scalar: { value: scalar } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D sourceMap;
        uniform float scalar;
        varying vec2 vUv;
        void main() {
          vec4 texel = texture2D(sourceMap, vUv);
          float value = texel.${channel} * scalar;
          gl_FragColor = vec4(vec3(value), 1.0);
        }
      `,
    }));
  }

  public applyMode(mode: RenderMode, root: THREE.Object3D) {
    this.currentMode = mode;

    // Always return meshes to authored materials before constructing a new
    // presentation state. This also prevents Lineup clones from inheriting a
    // previous diagnostic MeshBasicMaterial as their "source" material.
    this.restoreOriginals(root);
    this.clearPresentationMaterials();

    if (mode === 'pbr') return;
    const uvTex = mode === 'uv-checker' ? this.getOrCreateUvCheckerTexture() : null;

    root.traverse((obj) => {
      if (obj.name?.startsWith('__ascope_internal_')) return;
      if (!(obj as THREE.Mesh).isMesh) return;

      const mesh = obj as THREE.Mesh;
      if (!this.originalMaterials.has(mesh)) this.originalMaterials.set(mesh, mesh.material);
      const original = this.originalMaterials.get(mesh)!;
      const source = this.sourceMaterial(original);
      mesh.frustumCulled = false;

      switch (mode) {
        case 'unlit':
          mesh.material = this.track(new THREE.MeshBasicMaterial({
            map: source?.map ?? null,
            color: source?.color ? source.color.clone() : new THREE.Color(0xffffff),
            side: THREE.DoubleSide,
          }));
          break;

        case 'wireframe':
          mesh.material = this.track(new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            wireframe: true,
            side: THREE.DoubleSide,
          }));
          break;

        case 'wireframe-overlay': {
          mesh.material = original;
          const wireMaterial = this.track(new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            wireframe: true,
            transparent: true,
            opacity: 0.35,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
            side: THREE.DoubleSide,
          }));
          let wireClone: THREE.Mesh;
          if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
            const skinned = mesh as THREE.SkinnedMesh;
            const clone = new THREE.SkinnedMesh(skinned.geometry, wireMaterial);
            clone.frustumCulled = false;
            if (skinned.skeleton) clone.bind(skinned.skeleton, skinned.bindMatrix);
            wireClone = clone;
          } else {
            wireClone = new THREE.Mesh(mesh.geometry, wireMaterial);
            wireClone.frustumCulled = false;
            wireClone.matrixAutoUpdate = false;
            wireClone.matrix.copy(mesh.matrixWorld);
          }
          this.overlayGroup.add(wireClone);
          break;
        }

        case 'base-color':
          mesh.material = this.track(new THREE.MeshBasicMaterial({
            map: source?.map ?? null,
            color: source?.color ? source.color.clone() : new THREE.Color(0xd1d5db),
            side: THREE.DoubleSide,
          }));
          break;

        case 'normals':
          mesh.material = this.track(new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }));
          break;

        case 'roughness':
          mesh.material = this.channelMaterial(source?.roughnessMap, source?.roughness ?? 0.5, 'g');
          break;

        case 'metallic':
          mesh.material = this.channelMaterial(source?.metalnessMap, source?.metalness ?? 0, 'b');
          break;

        case 'ao':
          mesh.material = this.channelMaterial(source?.aoMap, source?.aoMapIntensity ?? 1, 'r' as 'g');
          break;

        case 'emissive':
          mesh.material = this.track(new THREE.MeshBasicMaterial({
            color: source?.emissive ? source.emissive.clone() : new THREE.Color(0x000000),
            map: source?.emissiveMap ?? null,
            side: THREE.DoubleSide,
          }));
          break;

        case 'uv-checker':
          mesh.material = this.track(new THREE.MeshStandardMaterial({
            map: uvTex,
            roughness: 0.4,
            metalness: 0.1,
            side: THREE.DoubleSide,
          }));
          break;

        case 'topology-health': {
          mesh.material = this.track(new THREE.MeshStandardMaterial({
            color: 0x334155,
            roughness: 0.3,
            metalness: 0.2,
            flatShading: true,
            side: THREE.DoubleSide,
          }));
          const wireMaterial = this.track(new THREE.MeshBasicMaterial({
            color: 0x10b981,
            wireframe: true,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
          }));
          const wireClone = new THREE.Mesh(mesh.geometry, wireMaterial);
          wireClone.frustumCulled = false;
          wireClone.matrixAutoUpdate = false;
          wireClone.matrix.copy(mesh.matrixWorld);
          this.overlayGroup.add(wireClone);
          break;
        }

        case 'triangle-density':
          // Until a true area/density scalar field is implemented, this mode is
          // deliberately a plain triangle wireframe. UI names it accordingly.
          mesh.material = this.track(new THREE.MeshBasicMaterial({
            color: 0xf59e0b,
            wireframe: true,
            side: THREE.DoubleSide,
          }));
          break;
      }
    });
  }

  public resetAll(root: THREE.Object3D) {
    this.restoreOriginals(root);
    this.clearPresentationMaterials();
    this.originalMaterials.clear();
    this.currentMode = 'pbr';
  }

  public dispose() {
    this.clearPresentationMaterials();
    if (this.uvCheckerTexture) {
      this.uvCheckerTexture.dispose();
      this.uvCheckerTexture = null;
    }
    this.originalMaterials.clear();
  }
}