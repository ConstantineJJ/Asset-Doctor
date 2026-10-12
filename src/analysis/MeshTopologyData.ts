import * as THREE from 'three';
import type { RawMeshData } from './TopologyAnalyzer';
import { documentMatrix } from '../viewer/AssetPresentation';

/** Use mesh-local positions AND scale for both diagnosis and repair verification. */
export function meshTopologyData(mesh: THREE.Mesh): RawMeshData {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  const positions = new Float32Array(position.count * 3);
  const box = new THREE.Box3();
  const point = new THREE.Vector3();

  // Avoid allocating a temporary [x,y,z] array for every vertex. On multi-million
  // triangle assets that tiny allocation pattern becomes measurable GC pressure.
  for (let i = 0, offset = 0; i < position.count; i++, offset += 3) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;
    point.set(x, y, z);
    box.expandByPoint(point);
  }

  const index = geometry.index;
  const indices = index ? new Uint32Array(index.count) : null;
  if (index && indices) {
    for (let i = 0; i < index.count; i++) indices[i] = index.getX(i);
  }

  return {
    uuid: mesh.uuid,
    name: mesh.name || `Mesh_${mesh.id}`,
    positions,
    indices,
    boundingBoxDiagonal: box.isEmpty() ? 0 : box.getSize(point).length(),
    worldMatrix: Array.from(documentMatrix(mesh).elements),
  };
}
