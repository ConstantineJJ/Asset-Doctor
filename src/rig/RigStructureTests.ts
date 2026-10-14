import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rigFixture } from '../../tests/rig-fixtures';
import { GLBLoaderService } from '../loaders/GLBLoaderService';
import { getSourceAssociation } from '../loaders/AssetRuntimeMetadata';
import { RigEditSession } from './RigEditSession';
import { buildRigExportPacket, parseGlb, patchRigGlb } from './RigGlbPatch';
import { rigIdentities, verifyEditedRig, verifyRigSourcePreservation } from './RigExportVerification';
import { packRoot, unpackRoot } from '../workers/GeometryPacket';
import { packClips, unpackClips } from '../animation/ClipPacket';
import { disposeModelResources } from '../loaders/ModelResources';

interface TestResult { name: string; passed: boolean; actual?: unknown; expected?: unknown }
type StructureSession = RigEditSession & {
  addJoint(parentUuid: string): string;
  deletionBlockReason(uuid: string): string | null;
  deleteJoint(uuid: string): void;
  exportNodeIndices(): Map<string, number>;
};

function close(actual: ArrayLike<number>, expected: ArrayLike<number>, epsilon = 3e-5) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) <= epsilon, `component ${i}: ${actual[i]} != ${expected[i]}`);
}
function bytes(array: ArrayBufferView) { return Array.from(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)); }
function meshes(root: THREE.Group): THREE.SkinnedMesh[] {
  const result: THREE.SkinnedMesh[] = []; root.traverse(node => { if (node instanceof THREE.SkinnedMesh) result.push(node); }); return result;
}
function bone(root: THREE.Group, name: string) {
  const node = root.getObjectByName(name); assert.ok(node instanceof THREE.Bone, `Missing bone ${name}`); return node;
}
function vertices(root: THREE.Group) {
  root.updateMatrixWorld(true);
  return meshes(root).map(mesh => {
    mesh.skeleton.update(); const position = mesh.geometry.getAttribute('position'); const result: number[] = [];
    for (let i = 0; i < position.count; i++) result.push(...mesh.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(position, i)).applyMatrix4(mesh.matrixWorld).toArray());
    return result;
  });
}
function capture(root: THREE.Group, session: RigEditSession) {
  root.updateMatrixWorld(true);
  const graph: unknown[] = [];
  root.traverse(node => graph.push({ uuid: node.uuid, name: node.name, type: node.type, parent: node.parent?.uuid, children: node.children.map(child => child.uuid), position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(), world: node.matrixWorld.toArray() }));
  return {
    graph,
    meshes: meshes(root).map(mesh => {
      mesh.skeleton.update();
      assert.ok(mesh.skeleton.boneMatrices, 'Active skeleton requires a current bone matrix buffer');
      return { uuid: mesh.uuid, geometry: mesh.geometry.uuid, positions: bytes(mesh.geometry.getAttribute('position').array), indices: mesh.geometry.index && bytes(mesh.geometry.index.array), joints: bytes(mesh.geometry.getAttribute('skinIndex').array), weights: bytes(mesh.geometry.getAttribute('skinWeight').array), bones: mesh.skeleton.bones.map(joint => joint.uuid), ibms: mesh.skeleton.boneInverses.map(matrix => matrix.toArray()), matrices: bytes(mesh.skeleton.boneMatrices), bind: mesh.bindMatrix.toArray(), bindInverse: mesh.bindMatrixInverse.toArray() };
    }),
    clips: session.clips.map(clip => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.map(track => ({ name: track.name, times: bytes(track.times), values: bytes(track.values) })) })),
  };
}
function assertBlocked(root: THREE.Group, session: StructureSession, uuid: string, reason?: RegExp) {
  const before = capture(root, session); const revision = session.revision; const edited = session.hasEdits;
  const explanation = session.deletionBlockReason(uuid);
  assert.equal(typeof explanation, 'string'); assert.ok(explanation!.trim().length > 0, 'Blocked deletion needs an explicit reason');
  if (reason) assert.match(explanation!, reason);
  assert.throws(() => session.deleteJoint(uuid));
  assert.deepEqual(capture(root, session), before); assert.equal(session.revision, revision); assert.equal(session.hasEdits, edited);
}

function encode(document: any, binary: Uint8Array) {
  const json = new TextEncoder().encode(JSON.stringify(document)), jsonLength = Math.ceil(json.length / 4) * 4, binLength = Math.ceil(binary.length / 4) * 4;
  const buffer = new ArrayBuffer(28 + jsonLength + binLength), view = new DataView(buffer);
  [0x46546c67, 2, buffer.byteLength, jsonLength, 0x4e4f534a].forEach((value, i) => view.setUint32(i * 4, value, true));
  new Uint8Array(buffer, 20, jsonLength).fill(32); new Uint8Array(buffer, 20, json.length).set(json);
  view.setUint32(20 + jsonLength, binLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true); new Uint8Array(buffer, 28 + jsonLength, binary.length).set(binary);
  return buffer;
}

/** Side is a source leaf at skin slot 2. Slot 3 still deforms two vertices. */
function unweightedSideFixture(change?: (document: any) => void, unsignedByte = false) {
  const { document, binary: originalBinary } = parseGlb(rigFixture().buffer); const binary = originalBinary.slice();
  const attributes = document.meshes[0].primitives[0].attributes;
  const accessor = document.accessors[attributes.WEIGHTS_0], bufferView = document.bufferViews[accessor.bufferView];
  const view = new DataView(binary.buffer, binary.byteOffset);
  const offset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  view.setFloat32(offset + 12 * 4, 0, true); view.setFloat32(offset + 13 * 4, 1, true);
  if (unsignedByte) {
    const jointAccessor = document.accessors[attributes.JOINTS_0], jointView = document.bufferViews[jointAccessor.bufferView];
    const start = (jointView.byteOffset ?? 0) + (jointAccessor.byteOffset ?? 0);
    const old = Array.from({ length: 16 }, (_, i) => view.getUint16(start + i * 2, true));
    old.forEach((value, i) => view.setUint8(start + i, value)); jointAccessor.componentType = 5121; jointView.byteLength = 16;
  }
  change?.(document); return encode(document, binary);
}

async function withSource(source: ArrayBuffer, run: (root: THREE.Group, session: StructureSession, reload: (buffer: ArrayBuffer) => Promise<THREE.Group>) => void | Promise<void>, stripSideTracks = false) {
  const loader = new GLBLoaderService(); const roots: THREE.Group[] = [];
  const reload = async (buffer: ArrayBuffer) => { const loaded = await loader.loadFromArrayBuffer(buffer, 'rig-structure.glb'); roots.push(loaded.root); return loaded; };
  try {
    const loaded = await reload(source);
    if (stripSideTracks) loaded.animations.forEach(clip => { clip.tracks = clip.tracks.filter(track => track.name !== 'Side.position'); });
    const session = new RigEditSession(loaded.root, loaded.animations) as StructureSession;
    await run(loaded.root, session, async buffer => (await reload(buffer)).root);
  } finally {
    roots.forEach(root => meshes(root).forEach(mesh => { mesh.geometry.dispose(); (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.dispose()); }));
    loader.dispose();
  }
}

function multipleSkins(conflicting = false, shared = true) {
  const root = new THREE.Group(), parent = new THREE.Bone(), candidate = new THREE.Bone(), first = new THREE.Bone(), second = new THREE.Bone();
  parent.name = 'Root'; candidate.name = 'SafeLeaf'; first.name = 'First'; second.name = 'Second';
  candidate.position.set(0, 1, 0); first.position.set(1, 0, 0); second.position.set(0, 2, 0);
  parent.add(candidate, first, second); root.add(parent); root.updateMatrixWorld(true);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const order = [parent, candidate, first, second];
  const a = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial()), b = new THREE.SkinnedMesh(shared ? geometry : geometry.clone(), new THREE.MeshBasicMaterial());
  a.name = 'SkinA'; b.name = 'SkinB'; root.add(a, b);
  a.bind(new THREE.Skeleton(order), new THREE.Matrix4());
  b.bind(new THREE.Skeleton(conflicting ? [parent, first, second, candidate] : order), new THREE.Matrix4());
  root.updateMatrixWorld(true);
  return { root, parent, candidate, a, b, session: new RigEditSession(root, []) as StructureSession };
}

export async function runRigStructureTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  async function test(name: string, run: () => void | Promise<void>) {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, actual: String(error), expected: 'Structural rig edit contract holds' }); }
  }

  await test('Add creates a real child Bone at the end of skin order without altering existing geometry or deformation', () => withSource(rigFixture().buffer, (root, session) => {
    session.enterEdit(); const parent = bone(root, 'Root'), before = capture(root, session), beforeVertices = vertices(root), mesh = meshes(root)[0], originalGeometry = mesh.geometry;
    const uuid = session.addJoint(parent.uuid), added = root.getObjectByProperty('uuid', uuid);
    assert.ok(added instanceof THREE.Bone); assert.equal(added.parent, parent); assert.equal(parent.children.at(-1), added);
    assert.deepEqual(mesh.skeleton.bones.slice(0, 4).map(joint => joint.uuid), before.meshes[0].bones);
    assert.equal(mesh.skeleton.bones.at(-1), added); assert.equal(mesh.skeleton.boneInverses.length, 5); assert.ok(mesh.skeleton.boneMatrices); assert.equal(mesh.skeleton.boneMatrices.length, 80);
    assert.equal(mesh.geometry, originalGeometry); const after = capture(root, session);
    assert.deepEqual(after.meshes[0].joints, before.meshes[0].joints); assert.deepEqual(after.meshes[0].weights, before.meshes[0].weights); assert.deepEqual(after.meshes[0].positions, before.meshes[0].positions);
    close(vertices(root)[0], beforeVertices[0]); assert.equal(session.revision, 1); assert.equal(session.hasEdits, true);
  }));

  await test('Add appends the same child to every skin containing its parent', () => {
    const { root, parent, a, b, session } = multipleSkins(false, false); session.enterEdit(); const before = vertices(root);
    const uuid = session.addJoint(parent.uuid), added = root.getObjectByProperty('uuid', uuid);
    assert.ok(added instanceof THREE.Bone); assert.equal(a.skeleton.bones.at(-1), added); assert.equal(b.skeleton.bones.at(-1), added);
    assert.equal(a.skeleton.boneInverses.length, 5); assert.equal(b.skeleton.boneInverses.length, 5);
    vertices(root).forEach((points, i) => close(points, before[i]));
  });

  await test('Structural changes reject Inspect Pose active gestures and invalid parents without mutation', () => withSource(unweightedSideFixture(), (root, session) => {
    const parent = bone(root, 'Root'), leaf = bone(root, 'Side');
    for (const mode of ['inspect', 'pose'] as const) {
      if (mode === 'pose') session.enterPose(); const before = capture(root, session);
      assert.throws(() => session.addJoint(parent.uuid)); assert.throws(() => session.deleteJoint(leaf.uuid)); assert.deepEqual(capture(root, session), before);
    }
    session.enterEdit(); const before = capture(root, session);
    assert.throws(() => session.addJoint('missing')); assert.throws(() => session.addJoint(root.getObjectByName('Anchor')!.uuid));
    session.beginGesture(); assert.throws(() => session.addJoint(parent.uuid)); assert.throws(() => session.deleteJoint(leaf.uuid)); session.cancelGesture();
    assert.deepEqual(capture(root, session), before); assert.equal(session.revision, 0); assert.equal(session.hasEdits, false);
  }));

  await test('Weighted animated original joints and skeleton roots reject deletion with an explicit atomic reason', () => withSource(rigFixture().buffer, (root, session) => {
    session.enterEdit(); assertBlocked(root, session, bone(root, 'Leaf').uuid, /weight|animat/i); assertBlocked(root, session, bone(root, 'Root').uuid);
  }));

  await test('An unweighted source leaf with an animation channel is blocked even if its runtime track was filtered out', () => {
    const source = unweightedSideFixture(document => document.animations[0].channels.push({ sampler: 0, target: { node: 4, path: 'translation' } }));
    return withSource(source, (root, session) => { session.enterEdit(); assert.ok(!session.clips.some(clip => clip.tracks.some(track => track.name === 'Side.position'))); assertBlocked(root, session, bone(root, 'Side').uuid, /animat|channel/i); }, true);
  });

  await test('A direct authored non-joint attachment prevents deleting an otherwise safe leaf', () => {
    const source = unweightedSideFixture(document => { const index = document.nodes.length; document.nodes.push({ name: 'AuthorAttachment', extras: { keep: true }, translation: [.1, 0, 0] }); document.nodes[4].children = [index]; });
    return withSource(source, (root, session) => { session.enterEdit(); assertBlocked(root, session, bone(root, 'Side').uuid, /attach|child/i); });
  });

  await test('Deleting a safe source leaf remaps high skin indices without changing weights or actual world skin', () => withSource(unweightedSideFixture(), (root, session) => {
    session.enterEdit(); const leaf = bone(root, 'Side'), mesh = meshes(root)[0], originalGeometry = mesh.geometry, before = capture(root, session), beforeVertices = vertices(root);
    assert.equal(session.deletionBlockReason(leaf.uuid), null); session.deleteJoint(leaf.uuid);
    assert.equal(root.getObjectByProperty('uuid', leaf.uuid), undefined); assert.equal(leaf.parent, null);
    assert.deepEqual(mesh.skeleton.bones.map(joint => joint.name), ['Leaf', 'Root', 'Child']);
    assert.deepEqual(Array.from(mesh.geometry.getAttribute('skinIndex').array), [0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0]);
    assert.deepEqual(bytes(mesh.geometry.getAttribute('skinWeight').array), before.meshes[0].weights); assert.deepEqual(bytes(mesh.geometry.getAttribute('position').array), before.meshes[0].positions);
    close(vertices(root)[0], beforeVertices[0]); const deleted = capture(root, session);
    session.undo(); assert.equal(mesh.geometry, originalGeometry); assert.equal(root.getObjectByProperty('uuid', leaf.uuid), leaf); assert.deepEqual(capture(root, session), before);
    session.redo(); assert.deepEqual(capture(root, session), deleted); session.reset(); assert.equal(mesh.geometry, originalGeometry); assert.deepEqual(capture(root, session), before);
  }));

  await test('Added joint UUID graph and skin state survive exact Add Delete Undo Redo and Reset history', () => withSource(rigFixture().buffer, (root, session) => {
    session.enterEdit(); const baseline = capture(root, session), uuid = session.addJoint(bone(root, 'Root').uuid), added = root.getObjectByProperty('uuid', uuid)!;
    const afterAdd = capture(root, session); assert.equal(session.deletionBlockReason(uuid), null); session.deleteJoint(uuid);
    assert.equal(added.parent, null); assert.equal(session.hasEdits, false); assert.deepEqual(capture(root, session), baseline);
    session.undo(); assert.equal(root.getObjectByProperty('uuid', uuid), added); assert.deepEqual(capture(root, session), afterAdd);
    session.undo(); assert.deepEqual(capture(root, session), baseline); session.redo(); assert.equal(root.getObjectByProperty('uuid', uuid), added); assert.deepEqual(capture(root, session), afterAdd);
    session.redo(); assert.deepEqual(capture(root, session), baseline); session.undo(); session.reset(); assert.deepEqual(capture(root, session), baseline);
  }));

  await test('Detached deleted bones cannot be parents or edited joints and do not poison active-joint compensation', () => withSource(rigFixture().buffer, (root, session) => {
    session.enterEdit(); const parent = bone(root, 'Root'), uuid = session.addJoint(parent.uuid), detached = root.getObjectByProperty('uuid', uuid)!; session.deleteJoint(uuid);
    assert.throws(() => session.addJoint(uuid)); assert.throws(() => session.commitJoint(uuid, { position: [1, 2, 3] }));
    assert.throws(()=>session.setBoneLength(uuid,null,.5));assert.throws(()=>session.setTerminalTip(uuid,[0,.5,0]));
    session.enterPose();assert.throws(()=>session.previewPoseRotation(uuid,[0,0,0,1]));session.enterEdit();
    detached.position.set(123, 456, 789); detached.scale.set(0, 0, 0);
    const before = vertices(root); session.commitJoint(parent.uuid, { position: [1.2, 2, 0] });
    close(vertices(root)[0], before[0]); assert.deepEqual(detached.position.toArray(), [123, 456, 789]); assert.deepEqual(detached.scale.toArray(), [0, 0, 0]);
  }));

  await test('Last remaining joint and source non-joint anchor cannot be deleted', () => withSource(rigFixture().buffer, (root, session) => {
    session.enterEdit(); assertBlocked(root, session, root.getObjectByName('Anchor')!.uuid);
    const only = new THREE.Bone(), group = new THREE.Group(); group.add(only); const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)); geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0], 4)); geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([0, 0, 0, 0], 4));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial()); group.add(mesh); group.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton([only]), new THREE.Matrix4());
    const single = new RigEditSession(group, []) as StructureSession; single.enterEdit(); assertBlocked(group, single, only.uuid, /root|last|only|anchor/i);
  }));

  await test('Same-remap shared geometry deletes once for both skins and Undo restores the exact shared source reference', () => {
    const { root, candidate, a, b, session } = multipleSkins(); session.enterEdit(); const before = capture(root, session), geometry = a.geometry, beforeVertices = vertices(root);
    assert.equal(a.geometry, b.geometry); assert.equal(session.deletionBlockReason(candidate.uuid), null); session.deleteJoint(candidate.uuid);
    assert.equal(a.skeleton.bones.length, 3); assert.equal(b.skeleton.bones.length, 3);
    for (const mesh of [a, b]) assert.deepEqual(Array.from(mesh.geometry.getAttribute('skinIndex').array), [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    vertices(root).forEach((points, i) => close(points, beforeVertices[i])); session.undo(); assert.equal(a.geometry, geometry); assert.equal(b.geometry, geometry); assert.deepEqual(capture(root, session), before);
  });

  await test('Conflicting remaps of shared geometry reject deletion atomically', () => {
    const { root, candidate, session } = multipleSkins(true); session.enterEdit(); assertBlocked(root, session, candidate.uuid, /shar|conflict|remap/i);
  });

  await test('A positive influence in any other skin blocks deletion even when the first skin is unweighted', () => {
    const { root, candidate, b, session } = multipleSkins(false, false);
    b.geometry.getAttribute('skinIndex').setX(0, 1);
    // Capture the actual authored state after setting up the second mesh's influence.
    const authored = new RigEditSession(root, []) as StructureSession; authored.enterEdit(); assertBlocked(root, authored, candidate.uuid, /weight|influenc/i);
  });

  await test('A positive raw source influence that normalizes to Float32 zero still blocks original joint deletion', () => {
    const source = unweightedSideFixture(), { document, binary } = parseGlb(source);
    const accessor = document.accessors[document.meshes[0].primitives[0].attributes.WEIGHTS_0], bufferView = document.bufferViews[accessor.bufferView];
    const offset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + 12 * 4;
    const raw = new DataView(binary.buffer, binary.byteOffset);
    raw.setFloat32(offset, 2 ** -149, true); raw.setFloat32(offset + 4, 2, true);
    assert.equal(raw.getFloat32(offset, true), 2 ** -149);
    return withSource(source, (root, session) => {
      session.enterEdit(); const side = bone(root, 'Side'), weights = meshes(root)[0].geometry.getAttribute('skinWeight');
      assert.equal(weights.getComponent(3, 0), 0, 'Real GLTFLoader must reproduce normalization underflow');
      assert.equal(weights.getComponent(3, 1), 1);
      assertBlocked(root, session, side.uuid, /weight|source|raw|normal|valid/i);
      // Newly added zero-influence joints carry no hidden original source weight.
      const added = session.addJoint(bone(root, 'Root').uuid);
      assert.equal(session.deletionBlockReason(added), null); session.deleteJoint(added);
      assert.equal(root.getObjectByProperty('uuid', added), undefined);
    });
  });

  await test('Export and real reimport append a new authored Bone and skin entry without changing old source streams', () => {
    const source = rigFixture().buffer, original = parseGlb(source), originalBytes = bytes(new Uint8Array(source));
    return withSource(source, async (root, session, reload) => {
      session.enterEdit(); const parent = bone(root, 'Root'), uuid = session.addJoint(parent.uuid); session.commitJoint(uuid, { position: [.1, .8, .2], quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), .3).toArray() });
      const added = root.getObjectByProperty('uuid', uuid)!; const index = session.exportNodeIndices().get(uuid); assert.equal(index, original.document.nodes.length);
      const beforeVertices = vertices(root), output = patchRigGlb(buildRigExportPacket(session, source)), exported = parseGlb(output), fresh = await reload(output);
      assert.deepEqual(exported.document.skins[0].joints, [...original.document.skins[0].joints, index]); assert.deepEqual(exported.document.nodes[1].children, [...original.document.nodes[1].children, index]);
      assert.equal(exported.document.skins[0].skeleton, original.document.skins[0].skeleton); assert.deepEqual(exported.binary.slice(0, original.binary.length), original.binary);
      assert.deepEqual(exported.document.animations, original.document.animations); assert.deepEqual(bytes(new Uint8Array(source)), originalBytes);
      const reimported = meshes(fresh)[0].skeleton.bones.at(-1)!; assert.equal(getSourceAssociation(reimported)?.nodes, index); assert.equal(reimported.parent?.name, parent.name); assert.equal(reimported.name, added.name);
      close(reimported.position.toArray(), added.position.toArray()); close(reimported.quaternion.toArray(), added.quaternion.toArray());
      assert.equal(meshes(fresh)[0].skeleton.bones.length, 5); close(vertices(fresh)[0], beforeVertices[0]);
    });
  });

  for (const unsignedByte of [false, true]) await test(`Delete Export Reimport preserves ${unsignedByte ? 'UBYTE' : 'USHORT'} source joint type and remaps deformation without shifting canonical nodes`, () => {
    const source = unweightedSideFixture(undefined, unsignedByte), original = parseGlb(source), originalBytes = bytes(new Uint8Array(source));
    return withSource(source, async (root, session, reload) => {
      session.enterEdit(); const before = vertices(root), deletedIndex = getSourceAssociation(bone(root, 'Side'))!.nodes!; session.deleteJoint(bone(root, 'Side').uuid);
      const output = patchRigGlb(buildRigExportPacket(session, source)), exported = parseGlb(output), fresh = await reload(output);
      assert.deepEqual(exported.document.skins[0].joints, [3, 1, 2]); assert.ok(!exported.document.nodes[1].children.includes(deletedIndex));
      assert.deepEqual(exported.document.nodes[deletedIndex], original.document.nodes[deletedIndex], 'Unused source node remains intact for unknown metadata/extension preservation');
      assert.deepEqual(exported.document.animations, original.document.animations); assert.deepEqual(exported.binary.slice(0, original.binary.length), original.binary); assert.deepEqual(bytes(new Uint8Array(source)), originalBytes);
      const primitive = exported.document.meshes[0].primitives[0], accessor = exported.document.accessors[primitive.attributes.JOINTS_0]; assert.equal(accessor.componentType, unsignedByte ? 5121 : 5123);
      assert.equal(primitive.attributes.WEIGHTS_0, original.document.meshes[0].primitives[0].attributes.WEIGHTS_0);
      assert.equal(fresh.getObjectByName('Side'), undefined); assert.deepEqual(meshes(fresh)[0].skeleton.bones.map(joint => getSourceAssociation(joint)?.nodes), [3, 1, 2]);
      assert.deepEqual(Array.from(meshes(fresh)[0].geometry.getAttribute('skinIndex').array), [0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0]); close(vertices(fresh)[0], before[0]);
    });
  });

  await test('Ordinary rig history retains external Heal geometry replaced after session construction', () => withSource(rigFixture().buffer, (root, session) => {
    const mesh = meshes(root)[0], original = mesh.geometry, healed = original.clone();
    healed.setIndex([0, 1, 2]); mesh.geometry = healed;
    const assertRetained = () => { assert.equal(mesh.geometry, healed); assert.deepEqual(Array.from(mesh.geometry.index!.array), [0, 1, 2]); };
    session.restoreRest(); assertRetained(); session.enterEdit(); assertRetained();
    session.renameClip(0, 'After external Heal'); assertRetained();
    session.addJoint(bone(root, 'Root').uuid); assertRetained();
    session.commitJoint(bone(root, 'Root').uuid, { position: [1.3, 2, 0] }); assertRetained();
    assert.equal(session.hasJointIndexEdits, false);
    session.undo(); assertRetained(); session.undo(); assertRetained(); session.undo(); assertRetained();
    session.redo(); assertRetained(); session.reset(); assertRetained();
    assert.notEqual(mesh.geometry, original);
  }));

  await test('Authored geometry resolver prevents ordinary rig actions from swapping a Smooth presented clone', () => withSource(rigFixture().buffer, (root, _session) => {
    const mesh = meshes(root)[0], author = mesh.geometry, presented = author.clone();
    presented.userData.presentation = 'Smooth';
    presented.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    mesh.geometry = presented; let writes = 0;
    const session = new RigEditSession(root, _session.clips, () => author, () => { writes++; }) as StructureSession;
    const normals = bytes(presented.getAttribute('normal').array);
    const assertPresented = () => { assert.equal(mesh.geometry, presented); assert.equal(presented.userData.presentation, 'Smooth'); assert.deepEqual(bytes(presented.getAttribute('normal').array), normals); assert.equal(writes, 0); };
    session.restoreRest(); session.enterEdit(); assertPresented();
    session.renameClip(0, 'Smooth edit'); assertPresented(); session.addJoint(bone(root, 'Root').uuid); assertPresented();
    session.commitJoint(bone(root, 'Root').uuid, { position: [1.2, 2, 0] }); assertPresented();
    session.undo(); assertPresented(); session.undo(); assertPresented(); session.undo(); assertPresented(); session.reset(); assertPresented();
  }));

  await test('Undo deletion releases geometry ownership; later Heal survives rest/history and conflicting structural Redo rejects atomically',()=>withSource(unweightedSideFixture(),(root,session)=>{
    session.enterEdit();session.deleteJoint(bone(root,'Side').uuid);session.undo();
    const mesh=meshes(root)[0],healed=mesh.geometry.clone();healed.setIndex([0,1,2]);mesh.geometry=healed;
    const before=capture(root,session),revision=session.revision;
    assert.throws(()=>session.redo(),/conflicts with later geometry/);
    assert.deepEqual(capture(root,session),before);assert.equal(session.revision,revision);assert.equal(session.canRedo,true);
    session.restoreRest();assert.equal(mesh.geometry,healed);
    session.renameClip(0,'Independent repair');session.undo();assert.equal(mesh.geometry,healed);
    const added=session.addJoint(bone(root,'Root').uuid);session.undo();assert.equal(mesh.geometry,healed);assert.equal(root.getObjectByProperty('uuid',added),undefined);
    session.reset();assert.equal(mesh.geometry,healed);
  }));

  await test('Sequential safe deletions restore each exact joint-index delta through Undo Redo and reset',()=>{
    const parsed=parseGlb(unweightedSideFixture()),binary=parsed.binary.slice();
    for(const clip of parsed.document.animations)clip.channels=clip.channels.filter((channel:any)=>channel.target.node!==3);
    const accessor=parsed.document.accessors[parsed.document.meshes[0].primitives[0].attributes.JOINTS_0],view=parsed.document.bufferViews[accessor.bufferView];
    new DataView(binary.buffer,binary.byteOffset).setUint16((view.byteOffset??0)+(accessor.byteOffset??0),1,true);
    return withSource(encode(parsed.document,binary),(root,session)=>{
      session.enterEdit();const mesh=meshes(root)[0],baseline=mesh.geometry,side=bone(root,'Side'),leaf=bone(root,'Leaf');
      session.deleteJoint(side.uuid);const first=mesh.geometry;
      session.deleteJoint(leaf.uuid);const second=mesh.geometry;assert.notEqual(first,second);
      const packet=buildRigExportPacket(session,encode(parsed.document,binary)),output=patchRigGlb(packet),{document:exported,binary:exportedBinary}=parseGlb(output);
      assert.equal(Object.hasOwn(exported.nodes[2],'children'),false,'glTF children must be omitted when the last child is deleted');
      verifyRigSourcePreservation(packet,output);exported.nodes[2].children=[];
      assert.throws(()=>verifyRigSourcePreservation(packet,encode(exported,exportedBinary)),/hierarchy/);
      session.undo();assert.equal(mesh.geometry,first);assert.ok(root.getObjectByProperty('uuid',leaf.uuid));
      session.undo();assert.equal(mesh.geometry,baseline);assert.ok(root.getObjectByProperty('uuid',side.uuid));
      session.redo();assert.equal(mesh.geometry,first);session.redo();assert.equal(mesh.geometry,second);
      session.reset();assert.equal(mesh.geometry,baseline);assert.equal(mesh.skeleton.bones.length,4);
    });
  });

  await test('Structural Delete history updates the author layer through its setter and preserves Smooth presentation state', () => withSource(unweightedSideFixture(), (root, existing) => {
    const mesh = meshes(root)[0], originalAuthor = mesh.geometry, presented = originalAuthor.clone();
    presented.userData.presentation = 'Smooth';
    presented.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    mesh.geometry = presented; let author = originalAuthor; const writes: THREE.BufferGeometry[] = [];
    const session = new RigEditSession(root, existing.clips, () => author, (target, geometry) => {
      assert.equal(target, mesh); author = geometry; writes.push(geometry);
      // The presentation layer keeps its clone and forwards the changed skin stream.
      presented.setAttribute('skinIndex', geometry.getAttribute('skinIndex').clone());
    }) as StructureSession;
    const normals = bytes(presented.getAttribute('normal').array), weights = bytes(originalAuthor.getAttribute('skinWeight').array);
    const assertPresented = () => { assert.equal(mesh.geometry, presented); assert.equal(presented.userData.presentation, 'Smooth'); assert.deepEqual(bytes(presented.getAttribute('normal').array), normals); assert.deepEqual(bytes(author.getAttribute('skinWeight').array), weights); };
    session.enterEdit(); assert.equal(writes.length, 0); session.deleteJoint(bone(root, 'Side').uuid);
    const deletedAuthor = author; assert.notEqual(author, originalAuthor); assert.equal(writes.at(-1), author); assert.equal(session.hasJointIndexEdits, true); assertPresented();
    assert.deepEqual(Array.from(author.getAttribute('skinIndex').array), [0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0]);
    session.undo(); assert.equal(author, originalAuthor); assert.equal(writes.at(-1), originalAuthor); assert.equal(session.hasJointIndexEdits, false); assertPresented();
    session.redo(); assert.equal(author, deletedAuthor); assert.equal(writes.at(-1), deletedAuthor); assert.equal(session.hasJointIndexEdits, true); assertPresented();
    session.reset(); assert.equal(author, originalAuthor); assert.equal(writes.at(-1), originalAuthor); assert.equal(session.hasJointIndexEdits, false); assertPresented();
  }));

  for (const kind of ['added', 'deleted'] as const) await test(`Full structural verifier validates ${kind} joints at rest and six real animation phases and detects serialized corruption`, () => {
    const source = kind === 'added' ? rigFixture().buffer : unweightedSideFixture();
    return withSource(source, async (root, session) => {
      session.enterEdit(); let generated: string | undefined;
      if (kind === 'added') {
        generated = session.addJoint(bone(root, 'Root').uuid);
        session.commitJoint(generated, { position: [.15, .65, -.1], quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), .25).toArray() });
      } else session.deleteJoint(bone(root, 'Side').uuid);
      session.setClipDuration(2, 7);
      const packet = buildRigExportPacket(session, source), output = patchRigGlb(packet);
      const identities = rigIdentities(root, session.exportNodeIndices());
      if (generated) assert.equal(identities.find(identity => identity.uuid === generated)?.node, parseGlb(source).document.nodes.length);
      const verify = async (buffer: ArrayBuffer, includeGenerated = true) => {
        const expected = unpackRoot(structuredClone(packRoot(root))), clips = unpackClips(structuredClone(packClips(session.clips)));
        try { return await verifyEditedRig(packet, buffer, expected, clips, includeGenerated ? identities : rigIdentities(root)); }
        finally { disposeModelResources(expected); }
      };
      const baseline = await verify(output);
      assert.equal(baseline.status, 'VERIFIED', baseline.reasons.join('; ')); assert.equal(baseline.sourcePreserved, true);
      assert.deepEqual(baseline.phases, [0, .13, .33, .61, .87, 1]); assert.equal(baseline.meshCount, 1); assert.equal(baseline.clipCount, 4);
      assert.equal(baseline.sampledVertices, 4 * (1 + 6 * session.clips.length));
      if (generated) {
        const withoutGenerated = await verify(output, false); assert.equal(withoutGenerated.status, 'REGRESSION', 'Generated identities must participate in the verifier');
        const { document, binary } = parseGlb(output); const index = session.exportNodeIndices().get(generated)!;
        document.nodes[index].translation[0] += .1;
        assert.equal((await verify(encode(document, binary))).status, 'REGRESSION', 'Corrupt added joint rest must be rejected');
      }
      {
        const { document, binary } = parseGlb(output);
        if (generated) document.nodes[1].children = document.nodes[1].children.filter((index: number) => index !== session.exportNodeIndices().get(generated!));
        else document.nodes[1].children.push(4);
        const report = await verify(encode(document, binary)); assert.equal(report.status, 'REGRESSION', 'Corrupt child membership must be rejected'); assert.ok(report.reasons.length);
      }
      {
        const { document, binary } = parseGlb(output); [document.skins[0].joints[0], document.skins[0].joints[1]] = [document.skins[0].joints[1], document.skins[0].joints[0]];
        const report = await verify(encode(document, binary)); assert.equal(report.status, 'REGRESSION', 'Corrupt skin joint order must be rejected'); assert.ok(report.reasons.length);
      }
      if (kind === 'deleted') {
        const { document, binary } = parseGlb(output); const accessor = document.accessors[document.meshes[0].primitives[0].attributes.JOINTS_0], view = document.bufferViews[accessor.bufferView];
        assert.equal(accessor.componentType, 5123);
        new DataView(binary.buffer, binary.byteOffset).setUint16((view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), 2, true);
        const report = await verify(output); assert.equal(report.status, 'REGRESSION', 'Corrupt active remapped JOINTS bytes must be rejected'); assert.ok(report.reasons.length);
      }
    });
  });
  return results;
}
