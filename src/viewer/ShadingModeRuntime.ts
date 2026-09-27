import * as THREE from 'three';
import type { RenderMode } from '../types';
import { RenderModeManager } from './RenderModeManager';
import {
  cloneMaterialForShading,
  getShadingMode,
  subscribeShadingMode,
  type ShadingMode,
} from './ShadingMode';

interface ManagerRuntimeState {
  roots: Set<THREE.Object3D>;
  lastRenderMode: RenderMode;
  shadingMaterials: Map<THREE.Object3D, Set<THREE.Material>>;
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
        shadingMaterials: new Map(),
      };
      managers.add(manager);
    }
    return manager.__assetDoctorShadingRuntime;
  };

  const disposeRootShading = (runtime: ManagerRuntimeState, root: THREE.Object3D) => {
    const materials = runtime.shadingMaterials.get(root);
    if (!materials) return;
    for (const material of materials) material.dispose();
    runtime.shadingMaterials.delete(root);
  };

  const disposeAllShading = (runtime: ManagerRuntimeState) => {
    for (const root of [...runtime.shadingMaterials.keys()]) disposeRootShading(runtime, root);
  };

  const applyPresentationShading = (
    runtime: ManagerRuntimeState,
    root: THREE.Object3D,
    shadingMode: ShadingMode
  ) => {
    disposeRootShading(runtime, root);
    if (shadingMode === 'hybrid') return;

    const clones = new Set<THREE.Material>();
    root.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh || object.name?.startsWith('__ascope_internal_')) return;
      const mesh = object as THREE.Mesh;
      const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      let changed = false;
      const next = source.map((material) => {
        const clone = cloneMaterialForShading(material, shadingMode);
        if (!clone) return material;
        clones.add(clone);
        changed = true;
        return clone;
      });
      if (changed) mesh.material = Array.isArray(mesh.material) ? next : next[0];
    });

    if (clones.size > 0) runtime.shadingMaterials.set(root, clones);
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
