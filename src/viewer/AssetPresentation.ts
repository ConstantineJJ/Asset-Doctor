import * as THREE from 'three';

// Runtime ownership stays outside glTF userData/extras.
const wrappers = new WeakSet<THREE.Object3D>();

export function createPresentationWrapper(authoredRoot: THREE.Group): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.name = '__ascope_internal_presentation';
  wrappers.add(wrapper);
  wrapper.add(authoredRoot);
  return wrapper;
}

function presentationParent(object: THREE.Object3D): THREE.Object3D | null {
  for (let parent = object.parent; parent; parent = parent.parent) {
    if (wrappers.has(parent)) return parent;
  }
  return null;
}

/** Document coordinates include authored ancestors, excluding the viewer wrapper. */
export function documentMatrix(object: THREE.Object3D): THREE.Matrix4 {
  const wrapper = presentationParent(object);
  // Detached repair probes deliberately supply their own measured matrixWorld.
  if (!wrapper) return object.matrixWorld.clone();
  const chain: THREE.Object3D[] = [];
  for (let node: THREE.Object3D | null = object; node && node !== wrapper; node = node.parent) chain.push(node);
  const matrix = new THREE.Matrix4();
  for (const node of chain.reverse()) {
    if (node.matrixAutoUpdate) node.updateMatrix();
    matrix.multiply(node.matrix);
  }
  return matrix;
}

/** Same object/geometry bounds used by Box3, measured in document space. */
export function documentBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateWorldMatrix(true, false);
  // SkinnedMesh's updateMatrixWorld override refreshes its inverse bind matrix.
  root.updateMatrixWorld(true);
  if (!presentationParent(root)) return new THREE.Box3().setFromObject(root);
  const result = new THREE.Box3();
  root.traverse(node => {
    const bounded = node as THREE.Mesh & { boundingBox?: THREE.Box3 | null; computeBoundingBox?: () => void };
    if (!bounded.geometry) return;
    let box: THREE.Box3 | null | undefined;
    if (bounded.boundingBox !== undefined) {
      if (bounded.boundingBox === null) bounded.computeBoundingBox?.();
      box = bounded.boundingBox;
    } else {
      if (bounded.geometry.boundingBox === null) bounded.geometry.computeBoundingBox();
      box = bounded.geometry.boundingBox;
    }
    if (box) result.union(box.clone().applyMatrix4(documentMatrix(node)));
  });
  return result;
}

export function documentToViewer(root: THREE.Object3D, position: [number, number, number]): [number, number, number] {
  const wrapper = presentationParent(root);
  if (!wrapper) return position;
  wrapper.updateWorldMatrix(true, false);
  return new THREE.Vector3(...position).applyMatrix4(wrapper.matrixWorld).toArray() as [number, number, number];
}
