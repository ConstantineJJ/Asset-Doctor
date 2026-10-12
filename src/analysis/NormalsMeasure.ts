import * as THREE from 'three';
import { documentMatrix } from '../viewer/AssetPresentation';

export interface GeometryNormalMeasurement {
  vertexCount: number;
  normalCount: number;
  missing: boolean;
  malformed: boolean;
  invalidCount: number;
  sampleIndices: number[];
}

export function measureGeometryNormals(
  geometry: THREE.BufferGeometry,
  sampleLimit = 8
): GeometryNormalMeasurement {
  const position = geometry.getAttribute('position');
  const vertexCount = position?.count ?? 0;
  const normal = geometry.getAttribute('normal');

  if (!normal) {
    return {
      vertexCount,
      normalCount: 0,
      missing: true,
      malformed: false,
      invalidCount: vertexCount,
      sampleIndices: Array.from(
        { length: Math.min(vertexCount, sampleLimit) },
        (_, index) => index
      ),
    };
  }

  if (normal.itemSize < 3 || normal.count !== vertexCount) {
    return {
      vertexCount,
      normalCount: normal.count,
      missing: false,
      malformed: true,
      invalidCount: Math.max(vertexCount, normal.count),
      sampleIndices: Array.from(
        { length: Math.min(vertexCount, sampleLimit) },
        (_, index) => index
      ),
    };
  }

  let invalidCount = 0;
  const sampleIndices: number[] = [];

  for (let index = 0; index < normal.count; index++) {
    const x = normal.getX(index);
    const y = normal.getY(index);
    const z = normal.getZ(index);
    const lengthSq = x * x + y * y + z * z;

    // glTF normals are expected to be normalized. Use a conservative tolerance
    // so harmless floating-point drift does not create noisy findings.
    const valid =
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(z) &&
      lengthSq > 1e-10 &&
      Math.abs(Math.sqrt(lengthSq) - 1) <= 0.05;

    if (!valid) {
      invalidCount++;
      if (sampleIndices.length < sampleLimit) sampleIndices.push(index);
    }
  }

  return {
    vertexCount,
    normalCount: normal.count,
    missing: false,
    malformed: false,
    invalidCount,
    sampleIndices,
  };
}

export function vertexWorldPosition(
  mesh: THREE.Mesh,
  vertexIndex: number
): [number, number, number] {
  const position = mesh.geometry.getAttribute('position');
  if (!position || vertexIndex < 0 || vertexIndex >= position.count) {
    mesh.geometry.computeBoundingBox();
    const center = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
    center.applyMatrix4(documentMatrix(mesh));
    return [center.x, center.y, center.z];
  }

  const point = new THREE.Vector3(
    position.getX(vertexIndex),
    position.getY(vertexIndex),
    position.getZ(vertexIndex)
  );
  point.applyMatrix4(documentMatrix(mesh));
  return [point.x, point.y, point.z];
}
