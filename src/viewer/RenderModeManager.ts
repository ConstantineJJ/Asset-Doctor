import * as THREE from 'three';
import type { RenderMode } from '../types';
import { getAuthoredMaterialSet } from './AuthoredMaterialState';
import {
  cloneGeometryForSmoothShading,
  cloneMaterialForShading,
  getShadingMode,
  subscribeShadingMode,
  type ShadingMode,
} from './ShadingMode';

interface RootShadingState {
  materials: Set<THREE.Material>;
  materialSources: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  geometries: Set<THREE.BufferGeometry>;
  geometrySources: Map<THREE.Mesh, THREE.BufferGeometry>;
}

/**
 * Presentation-only render modes and shading overrides.
 *
 * The authored materials registered for each mesh are never mutated. Hybrid,
 * Smooth and Flat are applied as temporary viewport resources so diagnostics,
 * Heal and export keep the authored asset state intact.
 */
export class RenderModeManager {
  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private temporaryMaterials = new Set<THREE.Material>();
  private appliedRoots = new Set<THREE.Object3D>();
  private shading = new Map<THREE.Object3D, RootShadingState>();
  private currentMode: RenderMode = 'pbr';
  private uvCheckerTexture: THREE.CanvasTexture | null = null;
  private overlayGroup: THREE.Group;
  private unsubscribeShadingMode: (() => void) | null = null;

  constructor(scene: THREE.Scene) {
    this.overlayGroup = new THREE.Group();
    this.overlayGroup.name = '__ascope_internal_render_overlays';
    scene.add(this.overlayGroup);
    this.unsubscribeShadingMode = subscribeShadingMode((mode) => this.handleShadingModeChange(mode));
  }

  public registerMesh(mesh: THREE.Mesh) {
    if (this.originalMaterials.has(mesh)) return;
    const authored = getAuthoredMaterialSet(mesh) ?? mesh.material;
    this.originalMaterials.set(mesh, authored);
    mesh.material = authored;
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
      const original = this.originalMaterials.get(mesh) ?? getAuthoredMaterialSet(mesh);
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
    this.overlayGroup.traverse((object) => {
      const renderable = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
      if (Array.isArray(renderable.material)) renderable.material.forEach((material) => material.dispose());
      else renderable.material?.dispose();
    });
    this.overlayGroup.clear();
  }

  private disposeRootShading(root: THREE.Object3D) {
    const state = this.shading.get(root);
    if (!state) return;

    // Restore the render-mode presentation underneath the shading override
    // before disposing temporary resources. This prevents meshes from retaining
    // already-disposed materials or geometry during same-mode rebuilds.
    for (const [mesh, material] of state.materialSources) mesh.material = material;
    for (const [mesh, geometry] of state.geometrySources) mesh.geometry = geometry;
    for (const material of state.materials) material.dispose();
    for (const geometry of state.geometries) geometry.dispose();
    this.shading.delete(root);
  }

  private disposeAllShading() {
    for (const root of [...this.shading.keys()]) this.disposeRootShading(root);
  }

  private applyPresentationShading(root: THREE.Object3D, shadingMode: ShadingMode) {
    this.disposeRootShading(root);
    if (shadingMode === 'hybrid') return;

    const state: RootShadingState = {
      materials: new Set(),
      materialSources: new Map(),
      geometries: new Set(),
      geometrySources: new Map(),
    };
    const smoothGeometryBySource = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();

    root.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh || object.name?.startsWith('__ascope_internal_')) return;
      const mesh = object as THREE.Mesh;
      const materialSource = mesh.material;
      const sourceMaterials = Array.isArray(materialSource) ? materialSource : [materialSource];
      let changed = false;
      const nextMaterials = sourceMaterials.map((material) => {
        const clone = cloneMaterialForShading(material, shadingMode);
        if (!clone) return material;
        state.materials.add(clone);
        changed = true;
        return clone;
      });

      if (!changed) return;

      state.materialSources.set(mesh, materialSource);
      mesh.material = Array.isArray(materialSource) ? nextMaterials : nextMaterials[0];

      if (shadingMode === 'smooth') {
        const geometrySource = mesh.geometry;
        let smoothGeometry = smoothGeometryBySource.get(geometrySource);
        if (!smoothGeometry) {
          smoothGeometry = cloneGeometryForSmoothShading(geometrySource) ?? undefined;
          if (smoothGeometry) {
            smoothGeometryBySource.set(geometrySource, smoothGeometry);
            state.geometries.add(smoothGeometry);
          }
        }
        if (smoothGeometry) {
          state.geometrySources.set(mesh, geometrySource);
          mesh.geometry = smoothGeometry;
        }
      }
    });

    if (state.materials.size > 0 || state.geometries.size > 0) this.shading.set(root, state);
  }

  private handleShadingModeChange(shadingMode: ShadingMode) {
    if (this.appliedRoots.size === 0) return;

    const roots = [...this.appliedRoots];
    this.disposeAllShading();
    this.restoreAllOriginals();
    this.clearPresentationMaterials();
    this.appliedRoots.clear();

    // Rebuild the current render-mode presentation first, then layer the new
    // shading mode on top. One manager may own several Lineup roots.
    for (const root of roots) this.applyMode(this.currentMode, root, shadingMode);
  }

  private restoreOriginals(root: THREE.Object3D) {
    root.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const mesh = object as THREE.Mesh;
      const original = this.originalMaterials.get(mesh) ?? getAuthoredMaterialSet(mesh);
      if (original) mesh.material = original;
    });
  }

  private restoreAllOriginals() {
    for (const [mesh, original] of this.originalMaterials) mesh.material = original;
  }

  private sourceMaterial(original: THREE.Material | THREE.Material[]) {
    const material = Array.isArray(original) ? original[0] : original;
    return material as THREE.MeshStandardMaterial | undefined;
  }

  private channelMaterial(
    texture: THREE.Texture | null | undefined,
    scalar: number,
    channel: 'r' | 'g' | 'b'
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

  public applyMode(mode: RenderMode, root: THREE.Object3D, shadingMode = getShadingMode()) {
    const modeChanged = mode !== this.currentMode;
    if (modeChanged) {
      // Remove shading first so underlying temporary render-mode resources are
      // restored before those resources are disposed.
      this.disposeAllShading();
      this.restoreAllOriginals();
      this.clearPresentationMaterials();
      this.appliedRoots.clear();
      this.currentMode = mode;
    }

    // Same root + same mode is already in the correct presentation state.
    if (!modeChanged && this.appliedRoots.has(root)) return;

    this.restoreOriginals(root);
    this.appliedRoots.add(root);

    if (mode !== 'pbr') {
      const uvTex = mode === 'uv-checker' ? this.getOrCreateUvCheckerTexture() : null;
      root.traverse((obj) => {
        if (obj.name?.startsWith('__ascope_internal_')) return;
        if (!(obj as THREE.Mesh).isMesh) return;

        const mesh = obj as THREE.Mesh;
        if (!this.originalMaterials.has(mesh)) this.registerMesh(mesh);
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
            mesh.material = this.channelMaterial(source?.aoMap, source?.aoMapIntensity ?? 1, 'r');
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
            // A real scalar density heatmap is not implemented yet. This mode is
            // intentionally a triangle wireframe and is labelled as such in UI.
            mesh.material = this.track(new THREE.MeshBasicMaterial({
              color: 0xf59e0b,
              wireframe: true,
              side: THREE.DoubleSide,
            }));
            break;
        }
      });
    }

    this.applyPresentationShading(root, shadingMode);
  }

  public resetAll(root: THREE.Object3D) {
    this.disposeRootShading(root);
    this.restoreOriginals(root);
    this.appliedRoots.delete(root);
    // Do not dispose shared Lineup presentation state until all roots have been
    // restored or the manager itself is disposed.
    if (this.appliedRoots.size === 0) {
      this.clearPresentationMaterials();
      this.currentMode = 'pbr';
    }
  }

  public dispose() {
    this.unsubscribeShadingMode?.();
    this.unsubscribeShadingMode = null;
    this.disposeAllShading();
    this.restoreAllOriginals();
    this.clearPresentationMaterials();
    this.appliedRoots.clear();
    if (this.uvCheckerTexture) {
      this.uvCheckerTexture.dispose();
      this.uvCheckerTexture = null;
    }
    this.originalMaterials.clear();
    this.overlayGroup.removeFromParent();
  }
}
