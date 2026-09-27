import * as THREE from 'three';

export type ShadingMode = 'hybrid' | 'smooth' | 'flat';

const STORAGE_KEY = 'asset-doctor.shading-mode';
const listeners = new Set<(mode: ShadingMode) => void>();
const MAX_EXACT_SMOOTH_VERTICES = 750_000;
const floatBits = new Float32Array(1);
const uintBits = new Uint32Array(floatBits.buffer);

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

function bitsOf(value: number): number {
  // Treat +0 and -0 as the same position. glTF positions are float32, so using
  // their float32 representation also gives us a compact exact-position hash.
  floatBits[0] = value === 0 ? 0 : value;
  return uintBits[0];
}

function hashPosition(x: number, y: number, z: number): number {
  let hash = 2166136261;
  hash = Math.imul(hash ^ bitsOf(x), 16777619);
  hash = Math.imul(hash ^ bitsOf(y), 16777619);
  hash = Math.imul(hash ^ bitsOf(z), 16777619);
  return hash >>> 0;
}

interface PositionGroups {
  ids: Int32Array;
  count: number;
}

function buildExactPositionGroups(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute
): PositionGroups {
  const ids = new Int32Array(position.count);
  const buckets = new Map<number, number | number[]>();
  const representativeX: number[] = [];
  const representativeY: number[] = [];
  const representativeZ: number[] = [];

  const matches = (group: number, x: number, y: number, z: number) =>
    representativeX[group] === x && representativeY[group] === y && representativeZ[group] === z;

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const hash = hashPosition(x, y, z);
    const existing = buckets.get(hash);
    let group = -1;

    if (typeof existing === 'number') {
      if (matches(existing, x, y, z)) group = existing;
    } else if (existing) {
      for (const candidate of existing) {
        if (matches(candidate, x, y, z)) {
          group = candidate;
          break;
        }
      }
    }

    if (group < 0) {
      group = representativeX.length;
      representativeX.push(x);
      representativeY.push(y);
      representativeZ.push(z);
      if (existing === undefined) buckets.set(hash, group);
      else if (typeof existing === 'number') buckets.set(hash, [existing, group]);
      else existing.push(group);
    }

    ids[i] = group;
  }

  return { ids, count: representativeX.length };
}

/**
 * Builds a presentation-only geometry with forced smooth normals. Unlike
 * BufferGeometry.computeVertexNormals(), the normal accumulator groups vertices
 * by identical position, so authored hard-edge/split-normal duplicates can be
 * smoothed without welding topology, UV seams, skin weights, or any source data.
 *
 * Very large meshes intentionally take the cheaper indexed fallback to keep a
 * viewer toggle from turning into a multi-million-entry hash allocation.
 */
export function cloneGeometryForSmoothShading(geometry: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const sourcePosition = geometry.getAttribute('position');
  if (!sourcePosition || sourcePosition.itemSize < 3 || sourcePosition.count < 3) return null;

  const clone = geometry.clone();
  const position = clone.getAttribute('position');
  if (!position) return clone;

  if (position.count > MAX_EXACT_SMOOTH_VERTICES) {
    if (clone.index) clone.computeVertexNormals();
    return clone;
  }

  const groups = buildExactPositionGroups(position);
  const accumulated = new Float64Array(groups.count * 3);
  const index = clone.index;
  const cornerCount = index ? index.count : position.count;
  const triangleCornerCount = cornerCount - (cornerCount % 3);

  const addFaceNormal = (vertexIndex: number, nx: number, ny: number, nz: number) => {
    const offset = groups.ids[vertexIndex] * 3;
    accumulated[offset] += nx;
    accumulated[offset + 1] += ny;
    accumulated[offset + 2] += nz;
  };

  for (let corner = 0; corner < triangleCornerCount; corner += 3) {
    const a = index ? index.getX(corner) : corner;
    const b = index ? index.getX(corner + 1) : corner + 1;
    const c = index ? index.getX(corner + 2) : corner + 2;

    const ax = position.getX(a);
    const ay = position.getY(a);
    const az = position.getZ(a);
    const abx = position.getX(b) - ax;
    const aby = position.getY(b) - ay;
    const abz = position.getZ(b) - az;
    const acx = position.getX(c) - ax;
    const acy = position.getY(c) - ay;
    const acz = position.getZ(c) - az;

    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    if (nx === 0 && ny === 0 && nz === 0) continue;

    addFaceNormal(a, nx, ny, nz);
    addFaceNormal(b, nx, ny, nz);
    addFaceNormal(c, nx, ny, nz);
  }

  const sourceNormal = geometry.getAttribute('normal');
  const normals = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const groupOffset = groups.ids[i] * 3;
    let nx = accumulated[groupOffset];
    let ny = accumulated[groupOffset + 1];
    let nz = accumulated[groupOffset + 2];
    let length = Math.hypot(nx, ny, nz);

    if (length <= Number.EPSILON && sourceNormal && i < sourceNormal.count) {
      nx = sourceNormal.getX(i);
      ny = sourceNormal.getY(i);
      nz = sourceNormal.getZ(i);
      length = Math.hypot(nx, ny, nz);
    }

    if (length <= Number.EPSILON) {
      nz = 1;
      length = 1;
    }

    const offset = i * 3;
    normals[offset] = nx / length;
    normals[offset + 1] = ny / length;
    normals[offset + 2] = nz / length;
  }

  clone.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return clone;
}
