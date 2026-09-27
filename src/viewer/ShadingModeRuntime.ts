import * as THREE from 'three';
import type { RenderMode } from '../types';
import { RenderModeManager } from './RenderModeManager';
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

interface ManagerRuntimeState {
  roots: Set<THREE.Object3D>;
  lastRenderMode: RenderMode;
  shading: Map<THREE.Object3D, RootShadingState>;
}

type PatchedRenderModeManager = RenderModeManager & {
  __assetDoctorShadingRuntime?: ManagerRuntimeState;
};

const proto = RenderModeManager.prototype as typeof RenderModeManager.prototype & {
  __assetDoctorShadingPatched?: boolean;
};

if (!proto.__assetDoctorShadingPatched) {
  proto.__assetDoctorShadingPatched = true;

  const managers = new Set<PatchedRenderModeManager>();
  const originalApplyMode = RenderModeManager.prototype.applyMode;
  const originalResetAll = RenderModeManager.prototype.resetAll;
  const originalDispose = RenderModeManager.prototype.dispose;

  const getRuntime = (manager: PatchedRenderModeManager): ManagerRuntimeState => {
    if (!manager.__assetDoctorShadingRuntime) {
      manager.__assetDoctorShadingRuntime = {
        roots: new Set(),
        lastRenderMode: 'pbr',
        shading: new Map(),
      };
      managers.add(manager);
    }
    return manager.__assetDoctorShadingRuntime;
  };

  const disposeRootShading = (runtime: ManagerRuntimeState, root: THREE.Object3D) => {
    const state = runtime.shading.get(root);
    if (!state) return;

    // Restore the exact render-mode presentation that was underneath the shading
    // override before disposing our temporary resources. This keeps same-mode
    // applyMode calls from cloning or displaying already-disposed materials.
    for (const [mesh, material] of state.materialSources) mesh.material = material;
    for (const [mesh, geometry] of state.geometrySources) mesh.geometry = geometry;
    for (const material of state.materials) material.dispose();
    for (const geometry of state.geometries) geometry.dispose();
    runtime.shading.delete(root);
  };

  const disposeAllShading = (runtime: ManagerRuntimeState) => {
    for (const root of [...runtime.shading.keys()]) disposeRootShading(runtime, root);
  };

  const applyPresentationShading = (
    runtime: ManagerRuntimeState,
    root: THREE.Object3D,
    shadingMode: ShadingMode
  ) => {
    disposeRootShading(runtime, root);
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

    if (state.materials.size > 0 || state.geometries.size > 0) runtime.shading.set(root, state);
  };

  RenderModeManager.prototype.applyMode = function patchedApplyMode(mode, root) {
    const manager = this as PatchedRenderModeManager;
    const runtime = getRuntime(manager);
    if (runtime.lastRenderMode !== mode) disposeAllShading(runtime);
    else disposeRootShading(runtime, root);

    runtime.lastRenderMode = mode;
    runtime.roots.add(root);
    originalApplyMode.call(this, mode, root);
    applyPresentationShading(runtime, root, getShadingMode());
  };

  RenderModeManager.prototype.resetAll = function patchedResetAll(root) {
    const manager = this as PatchedRenderModeManager;
    const runtime = manager.__assetDoctorShadingRuntime;
    if (runtime) {
      disposeRootShading(runtime, root);
      runtime.roots.delete(root);
    }
    return originalResetAll.call(this, root);
  };

  RenderModeManager.prototype.dispose = function patchedDispose() {
    const manager = this as PatchedRenderModeManager;
    const runtime = manager.__assetDoctorShadingRuntime;
    if (runtime) {
      disposeAllShading(runtime);
      runtime.roots.clear();
      managers.delete(manager);
      delete manager.__assetDoctorShadingRuntime;
    }
    return originalDispose.call(this);
  };

  subscribeShadingMode((shadingMode) => {
    for (const manager of managers) {
      const runtime = manager.__assetDoctorShadingRuntime;
      if (!runtime || runtime.roots.size === 0) continue;

      const roots = [...runtime.roots];
      disposeAllShading(runtime);

      // Rebuild the underlying render-mode presentation first, then apply the
      // shading override. This is required for Lineup because one manager owns
      // several roots and diagnostic modes may themselves allocate materials.
      for (const root of roots) originalResetAll.call(manager, root);
      for (const root of roots) {
        originalApplyMode.call(manager, runtime.lastRenderMode, root);
        applyPresentationShading(runtime, root, shadingMode);
      }
    }
  });
}
