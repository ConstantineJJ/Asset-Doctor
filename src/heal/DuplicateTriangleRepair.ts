import * as THREE from 'three';
import { documentMatrix } from '../viewer/AssetPresentation';
import { analyzeMeshTopology } from '../analysis/TopologyAnalyzer';
import { meshTopologyData } from '../analysis/MeshTopologyData';
import type { TopologyStats } from '../types';

export interface DuplicateTriangleRepairPlan {
  replacementIndex: THREE.BufferAttribute;
  duplicateCount: number;
  before: TopologyStats;
  after: TopologyStats;
}

export interface DuplicateTriangleRepairBlocked {
  reasonKey: string;
}

function orientedTriangleKey(a: number, b: number, c: number): string {
  const rotations = [
    [a, b, c],
    [b, c, a],
    [c, a, b],
  ];
  rotations.sort((left, right) =>
    left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
  );
  return rotations[0].join('_');
}

function makeIndexArray(
  source: Uint8Array | Uint16Array | Uint32Array,
  values: number[]
): Uint8Array | Uint16Array | Uint32Array {
  if (source instanceof Uint8Array) return new Uint8Array(values);
  if (source instanceof Uint16Array) return new Uint16Array(values);
  return new Uint32Array(values);
}

function materialAllowsDuplicateRemoval(material: THREE.Material | THREE.Material[]): boolean {
  if (Array.isArray(material)) return false;
  const candidate = material as THREE.Material & {
    opacity?: number;
    transparent?: boolean;
    blending?: THREE.Blending;
    depthWrite?: boolean;
    stencilWrite?: boolean;
  };

  return (
    candidate.transparent !== true &&
    (candidate.opacity ?? 1) === 1 &&
    (candidate.blending ?? THREE.NormalBlending) === THREE.NormalBlending &&
    candidate.depthWrite !== false &&
    candidate.stencilWrite !== true
  );
}

export function planRemoveExactDuplicateTriangles(
  mesh: THREE.Mesh
): DuplicateTriangleRepairPlan | DuplicateTriangleRepairBlocked {
  const geometry = mesh.geometry;
  const index = geometry?.index;
  const position = geometry?.getAttribute('position');

  if (!geometry || !index || !position) {
    return { reasonKey: 'heal.errors.duplicateTrianglesNeedsIndexedGeometry' };
  }

  if (
    geometry.groups.length > 0 ||
    geometry.drawRange.start !== 0 ||
    geometry.drawRange.count !== Infinity
  ) {
    return { reasonKey: 'heal.errors.duplicateTrianglesDrawLayoutUnsupported' };
  }

  if (!materialAllowsDuplicateRemoval(mesh.material)) {
    return { reasonKey: 'heal.errors.duplicateTrianglesMaterialUnsafe' };
  }

  const source = index.array;
  if (
    !(source instanceof Uint8Array) &&
    !(source instanceof Uint16Array) &&
    !(source instanceof Uint32Array)
  ) {
    return { reasonKey: 'heal.errors.duplicateTrianglesIndexStorageUnsupported' };
  }

  if (
    index.itemSize !== 1 ||
    index.normalized ||
    index.count % 3 !== 0 ||
    position.itemSize !== 3
  ) {
    return { reasonKey: 'heal.errors.invalidGeometry' };
  }

  for (let i = 0; i < index.count; i++) {
    const value = index.getX(i);
    if (!Number.isInteger(value) || value < 0 || value >= position.count) {
      return { reasonKey: 'heal.errors.invalidGeometry' };
    }
  }

  const triangleCount = Math.floor(index.count / 3);
  const seen = new Set<string>();
  const kept: number[] = [];
  let duplicateCount = 0;

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const base = triangle * 3;
    const a = index.getX(base);
    const b = index.getX(base + 1);
    const c = index.getX(base + 2);
    const key = orientedTriangleKey(a, b, c);

    if (seen.has(key)) {
      duplicateCount++;
      continue;
    }

    seen.add(key);
    kept.push(a, b, c);
  }

  if (duplicateCount === 0) {
    return { reasonKey: 'heal.errors.noExactDuplicateTriangles' };
  }

  let before: TopologyStats;
  try {
    before = analyzeMeshTopology(meshTopologyData(mesh));
  } catch {
    return { reasonKey: 'heal.errors.beforeUnavailable' };
  }

  const replacementIndex = new THREE.BufferAttribute(
    makeIndexArray(source, kept),
    1,
    index.normalized
  );

  const probeGeometry = geometry.clone();
  probeGeometry.setIndex(replacementIndex.clone());
  const probe = new THREE.Mesh(probeGeometry, mesh.material);
  probe.name = mesh.name;
  probe.uuid = mesh.uuid;
  probe.matrixWorld.copy(documentMatrix(mesh));

  let after: TopologyStats;
  try {
    after = analyzeMeshTopology(meshTopologyData(probe));
  } catch {
    probeGeometry.dispose();
    return { reasonKey: 'heal.errors.afterUnavailable' };
  }
  probeGeometry.dispose();

  const unsafe =
    before.triangleCount - after.triangleCount !== duplicateCount ||
    after.vertexCount !== before.vertexCount ||
    after.duplicateTriangles !== 0 ||
    after.degenerateTriangles > before.degenerateTriangles ||
    after.boundaryEdges > before.boundaryEdges ||
    after.nonManifoldEdges > before.nonManifoldEdges ||
    after.isolatedVertices !== before.isolatedVertices ||
    after.componentsCount > before.componentsCount ||
    after.tinyComponentsCount > before.tinyComponentsCount ||
    after.thinTriangles > before.thinTriangles ||
    after.potentialDuplicatePositions !== before.potentialDuplicatePositions;

  if (unsafe) {
    return { reasonKey: 'heal.errors.duplicateTrianglesChangesTopology' };
  }

  return {
    replacementIndex,
    duplicateCount,
    before,
    after,
  };
}
