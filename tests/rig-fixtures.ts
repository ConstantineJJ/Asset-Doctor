import * as THREE from 'three';

export interface RigFixtureOptions {
  anchorScale?: [number, number, number];
  rootScale?: [number, number, number];
  morphWeights?: boolean;
}

/** Texture-free GLB; every animation is decoded by the installed GLTFLoader. */
export function rigFixture(options: RigFixtureOptions = {}) {
  const json: any = {
    asset: { version: '2.0', generator: 'Asset Doctor rig regression fixture' },
    extras: { author: 'fixture', nested: { retained: true } },
    scene: 0, scenes: [{ name: 'RigScene', nodes: [0] }],
    nodes: [
      { name: 'Anchor', translation: [5, -2, 1], rotation: [0, Math.sin(.25), 0, Math.cos(.25)], scale: options.anchorScale ?? [1.2, 1.2, 1.2], children: [1, 5, 6, 7], extras: { role: 'non-joint-anchor' } },
      { name: 'Root', translation: [1, 2, 0], ...(options.rootScale ? { scale: options.rootScale } : {}), children: [2, 4], extras: { authorJoint: 1 } },
      { name: 'Child', translation: [0, 2, 0], children: [3], extras: { authorJoint: 2 } },
      { name: 'Leaf', translation: [0, 1, 0], extras: { authorJoint: 3 } },
      { name: 'Side', translation: [2, 0, 0], extras: { authorJoint: 4 } },
      { name: 'SkinMesh', translation: [-1, .5, .25], mesh: 0, skin: 0, extras: { preserved: 'mesh' } },
      { name: 'Unrelated', translation: [1, 2, 0], extras: { preserved: 'unrelated-target' } },
      { name: 'OtherUnrelated', translation: [0, 1, 0], extras: { preserved: 'second-unrelated-target' } },
    ],
    skins: [], meshes: [], animations: [], accessors: [], bufferViews: [], buffers: [],
  };
  const chunks: Uint8Array[] = [];
  let byteOffset = 0;
  function append(data: Float32Array | Uint16Array, type: string, count: number, name: string, min?: number[], max?: number[]) {
    const aligned = Math.ceil(byteOffset / 4) * 4;
    if (aligned !== byteOffset) chunks.push(new Uint8Array(aligned - byteOffset));
    byteOffset = aligned;
    const bufferView = json.bufferViews.length;
    json.bufferViews.push({ name: `${name}View`, buffer: 0, byteOffset, byteLength: data.byteLength, extras: { bufferAuthor: name } });
    chunks.push(new Uint8Array(data.buffer)); byteOffset += data.byteLength;
    const accessor = json.accessors.length;
    json.accessors.push({ name, bufferView, componentType: data instanceof Uint16Array ? 5123 : 5126, type, count, extras: { accessorAuthor: name }, ...(min ? { min, max } : {}) });
    return accessor;
  }
  const position = append(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, .5]), 'VEC3', 4, 'Positions', [0, 0, 0], [1, 1, .5]);
  // Skin indices intentionally disagree with hierarchy/preorder: Leaf, Root, Side, Child.
  const joints = append(new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 0, 2, 3, 0, 0]), 'VEC4', 4, 'JointIndices');
  const weights = append(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, .25, .75, 0, 0]), 'VEC4', 4, 'JointWeights');
  const indices = append(new Uint16Array([0, 1, 2, 1, 3, 2]), 'SCALAR', 6, 'Triangles');

  // glTF bind shape is Wjoint^-1 * Wmesh, calculated from the authored document.
  const objects = json.nodes.map((node: any) => {
    const object = new THREE.Object3D();
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  json.nodes.forEach((node: any, index: number) => node.children?.forEach((child: number) => objects[index].add(objects[child])));
  objects[0].updateMatrixWorld(true);
  const skinOrder = [3, 1, 4, 2];
  const inverseBind = new Float32Array(skinOrder.flatMap(index => objects[index].matrixWorld.clone().invert().multiply(objects[5].matrixWorld).toArray()));
  json.skins.push({ name: 'AuthoredSkin', skeleton: 1, joints: skinOrder, inverseBindMatrices: append(inverseBind, 'MAT4', 4, 'AuthoredInverseBind'), extras: { skinAuthor: 'keep-me' } });
  const primitive: any = { attributes: { POSITION: position, JOINTS_0: joints, WEIGHTS_0: weights }, indices };
  const mesh: any = { name: 'AuthoredGeometry', primitives: [primitive], extras: { meshAuthor: true } };
  if (options.morphWeights) {
    primitive.targets = [{ POSITION: append(new Float32Array([0, 0, .2, 0, 0, .2, 0, 0, .2, 0, 0, .2]), 'VEC3', 4, 'MorphPositions', [0, 0, .2], [0, 0, .2]) }];
    mesh.weights = [.2]; mesh.extras.targetNames = ['Inflate'];
  }
  json.meshes.push(mesh);

  const times = append(new Float32Array([0, 2, 4]), 'SCALAR', 3, 'SharedTimes', [0], [4]);
  const linear = append(new Float32Array([1, 2, 0, 2, 3, 0, 1, 2, 0]), 'VEC3', 3, 'SharedLinearTranslation');
  const step = append(new Float32Array([0, 2, 0, 0, 3, 0, 0, 2, 0]), 'VEC3', 3, 'StepTranslation');
  // Cubic triplets are [incoming derivative, value, outgoing derivative].
  const cubic = append(new Float32Array([
    0, 0, 0, 0, 1, 0, .5, .3, 0,
    .1, -.2, 0, .6, 1.4, 0, -.4, .2, 0,
    -.3, -.1, 0, 0, 1, 0, 0, 0, 0,
  ]), 'VEC3', 9, 'SharedCubicTranslation');
  const rotations = append(new Float32Array([
    0, 0, 0, 0, 0, 0, 0, 1, 0, 0, .1, 0,
    0, 0, .1, 0, 0, 0, Math.sin(.2), Math.cos(.2), 0, 0, -.1, 0,
    0, 0, -.1, 0, 0, 0, 0, 1, 0, 0, 0, 0,
  ]), 'VEC4', 9, 'CubicQuaternion');
  const animation = (name: string, samplers: any[], channels: any[]) => ({ name, samplers, channels, extras: { clipAuthor: name } });
  const channel = (sampler: number, node: number, path = 'translation') => ({ sampler, target: { node, path } });
  json.animations.push(
    animation('LinearShared', [{ input: times, output: linear, interpolation: 'LINEAR' }], [channel(0, 1), channel(0, 6)]),
    animation('Step', [{ input: times, output: step, interpolation: 'STEP' }], [channel(0, 2)]),
    animation('CubicShared', [{ input: times, output: cubic, interpolation: 'CUBICSPLINE' }, { input: times, output: rotations, interpolation: 'CUBICSPLINE' }], [channel(0, 3), channel(0, 6), channel(1, 1, 'rotation')]),
    animation('UnrelatedShared', [{ input: times, output: linear, interpolation: 'LINEAR' }, { input: times, output: cubic, interpolation: 'CUBICSPLINE' }], [channel(0, 6), channel(1, 7)]),
  );
  if (options.morphWeights) {
    const output = append(new Float32Array([.2, .7, .2]), 'SCALAR', 3, 'MorphWeightAnimation');
    json.animations.push(animation('MorphWeights', [{ input: times, output, interpolation: 'LINEAR' }], [channel(0, 5, 'weights')]));
  }

  json.buffers = [{ byteLength: byteOffset }];
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const binLength = Math.ceil(byteOffset / 4) * 4;
  const buffer = new ArrayBuffer(28 + jsonLength + binLength);
  const view = new DataView(buffer);
  [0x46546c67, 2, buffer.byteLength, jsonLength, 0x4e4f534a].forEach((value, i) => view.setUint32(i * 4, value, true));
  new Uint8Array(buffer, 20, jsonLength).fill(32);
  new Uint8Array(buffer, 20, jsonBytes.length).set(jsonBytes);
  view.setUint32(20 + jsonLength, binLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
  let destination = 28 + jsonLength;
  for (const chunk of chunks) { new Uint8Array(buffer, destination, chunk.length).set(chunk); destination += chunk.length; }
  return { buffer, document: json };
}
