import * as THREE from 'three';

export type ShadingMode = 'hybrid' | 'smooth' | 'flat';

const STORAGE_KEY = 'asset-doctor.shading-mode';
const listeners = new Set<(mode: ShadingMode) => void>();

function isShadingMode(value: unknown): value is ShadingMode {
  return value === 'hybrid' || value === 'smooth' || value === 'flat';
}

function readInitialMode(): ShadingMode {
  if (typeof window === 'undefined') return 'hybrid';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isShadingMode(saved) ? saved : 'hybrid';
  } catch {
    return 'hybrid';
  }
}

let currentMode: ShadingMode = readInitialMode();

export function getShadingMode(): ShadingMode {
  return currentMode;
}

export function setShadingMode(mode: ShadingMode) {
  if (mode === currentMode) return;
  currentMode = mode;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // A presentation preference must never block the viewport if storage is unavailable.
    }
  }
  for (const listener of listeners) listener(mode);
}

export function subscribeShadingMode(listener: (mode: ShadingMode) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type FlatShadingMaterial = THREE.Material & { flatShading: boolean };

export function supportsFlatShading(material: THREE.Material): material is FlatShadingMaterial {
  return 'flatShading' in material && typeof (material as FlatShadingMaterial).flatShading === 'boolean';
}

/**
 * Returns a presentation-only clone when the requested mode needs to override
 * the material's shading flag. Hybrid deliberately returns null so callers keep
 * the exact authored/diagnostic material and authored normal splits.
 */
export function cloneMaterialForShading(
  material: THREE.Material,
  mode: ShadingMode
): THREE.Material | null {
  if (mode === 'hybrid' || !supportsFlatShading(material)) return null;
  const clone = material.clone() as FlatShadingMaterial;
  clone.flatShading = mode === 'flat';
  clone.needsUpdate = true;
  return clone;
}
