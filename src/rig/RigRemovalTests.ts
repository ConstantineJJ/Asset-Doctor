import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rigFixture } from '../../tests/rig-fixtures';
import { GLBLoaderService } from '../loaders/GLBLoaderService';
import { RigEditSession } from './RigEditSession';
import { buildRigExportPacket, parseGlb, patchRigGlb } from './RigGlbPatch';
import { rigIdentities, verifyEditedRig } from './RigExportVerification';
import { packRoot, unpackRoot } from '../workers/GeometryPacket';
import { packClips, unpackClips } from '../animation/ClipPacket';
import { disposeModelResources } from '../loaders/ModelResources';
import { captureSourceMetadata, getSourceAssociation, getSourceAudit, getSourceDocument, type SourceAssociation } from '../loaders/AssetRuntimeMetadata';

interface TestResult { name: string; passed: boolean; actual?: unknown; expected?: unknown }
interface RemovalSummary { removedJointCount: number; affectedVertices: number; removedTrackCount: number; staticMeshCount: number; retainedTransformCount: number; warnings: string[] }
type RemovalSession = RigEditSession & {
  deletionSummary(uuid: string, scope: 'joint' | 'chain'): RemovalSummary;
  removeJoints(uuid: string, scope: 'joint' | 'chain'): void;
};
function close(actual: ArrayLike<number>, expected: ArrayLike<number>, epsilon = 3e-5) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) <= epsilon, `component ${i}: ${actual[i]} != ${expected[i]}`);
}
function bytes(array: ArrayBufferView) { return Array.from(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)); }
function bone(root: THREE.Group, name: string) { const found = root.getObjectByName(name); assert.ok(found instanceof THREE.Bone, `Missing ${name}`); return found; }
function mesh(root: THREE.Group): THREE.Mesh {
  let found: THREE.Mesh | undefined; root.traverse(node => { if (node instanceof THREE.Mesh) found = node; }); assert.ok(found); return found;
}
function capture(root: THREE.Group, session: RigEditSession) {
  root.updateMatrixWorld(true); const graph: unknown[] = [];
  root.traverse(node => {
    const object = { uuid: node.uuid, name: node.name, type: node.type, parent: node.parent?.uuid, children: node.children.map(child => child.uuid), position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(), world: node.matrixWorld.toArray() };
    if (!(node instanceof THREE.Mesh)) { graph.push(object); return; }
    graph.push({ ...object, geometry: node.geometry.uuid, attributes: Object.fromEntries(Object.entries(node.geometry.attributes).map(([name, attribute]) => [name, bytes((attribute as THREE.BufferAttribute).array)])), index: node.geometry.index && bytes(node.geometry.index.array), morphs: Object.fromEntries(Object.entries(node.geometry.morphAttributes).map(([name, list]) => [name, (list as THREE.BufferAttribute[]).map(attribute => bytes(attribute.array))])), relative: node.geometry.morphTargetsRelative, influences: node.morphTargetInfluences?.slice(), bones: node instanceof THREE.SkinnedMesh ? node.skeleton.bones.map(joint => joint.uuid) : null, inverses: node instanceof THREE.SkinnedMesh ? node.skeleton.boneInverses.map(matrix => matrix.toArray()) : null });
  });
  return { graph, clips: session.clips.map(clip => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.map(track => ({ name: track.name, times: bytes(track.times), values: bytes(track.values), cubic: !!(track as any).createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline })) })) };
}
function worldVertices(root: THREE.Group) {
  root.updateMatrixWorld(true); const object = mesh(root); if (object instanceof THREE.SkinnedMesh) object.skeleton.update();
  const position = object.geometry.getAttribute('position'), result: number[] = [];
  for (let i = 0; i < position.count; i++) result.push(...object.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(object.matrixWorld).toArray());
  return result;
}
function worldPose(root: THREE.Group, clip: THREE.AnimationClip, name: string, time: number) {
  const mixer = new THREE.AnimationMixer(root); const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play(); mixer.setTime(time); root.updateMatrixWorld(true);
  const result = root.getObjectByName(name)!.matrixWorld.toArray(); mixer.stopAllAction(); mixer.uncacheRoot(root); root.updateMatrixWorld(true); return result;
}
function encode(document: any, binary: Uint8Array) {
  const json = new TextEncoder().encode(JSON.stringify(document)), length = Math.ceil(json.length / 4) * 4, binLength = Math.ceil(binary.length / 4) * 4, buffer = new ArrayBuffer(28 + length + binLength), view = new DataView(buffer);
  [0x46546c67, 2, buffer.byteLength, length, 0x4e4f534a].forEach((value, index) => view.setUint32(index * 4, value, true));
  new Uint8Array(buffer, 20, length).fill(32); new Uint8Array(buffer, 20, json.length).set(json); view.setUint32(20 + length, binLength, true); view.setUint32(24 + length, 0x004e4942, true); new Uint8Array(buffer, 28 + length, binary.length).set(binary); return buffer;
}
async function withRig(source: ArrayBuffer, run: (root: THREE.Group, session: RemovalSession) => void | Promise<void>) {
  const loader = new GLBLoaderService(); let root: THREE.Group | undefined;
  try { const loaded = await loader.loadFromArrayBuffer(source, 'removal.glb'); root = loaded.root; await run(root, new RigEditSession(root, loaded.animations) as RemovalSession); }
  finally {
    root?.traverse(node => { if (!(node instanceof THREE.Mesh)) return; node.geometry.dispose(); (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => material.dispose()); });
    loader.dispose();
  }
}
function rejectedPreflight(root: THREE.Group, session: RemovalSession, uuid: string, scope: 'joint' | 'chain', reason: RegExp) {
  session.enterEdit(); session.renameClip(0, 'Preflight history marker'); session.undo();
  const before = capture(root, session), history = [session.revision, session.canUndo, session.canRedo, session.hasEdits];
  const document = JSON.stringify(getSourceDocument(root));
  assert.throws(() => session.deletionSummary(uuid, scope), reason);
  assert.deepEqual(capture(root, session), before); assert.deepEqual([session.revision, session.canUndo, session.canRedo, session.hasEdits], history);
  assert.throws(() => session.removeJoints(uuid, scope), reason);
  assert.deepEqual(capture(root, session), before); assert.deepEqual([session.revision, session.canUndo, session.canRedo, session.hasEdits], history);
  assert.equal(JSON.stringify(getSourceDocument(root)), document);
  session.redo(); assert.equal(session.clips[0].name, 'Preflight history marker', 'Rejected preflight must retain the actual redo entry');
}

export async function runRigRemovalTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  async function test(name: string, run: () => void | Promise<void>) {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, actual: String(error), expected: 'Previewed joint removal contract holds' }); }
  }

  await test('Weighted animated leaf removal previews consequences then transfers influence to the surviving ancestor with exact Undo', () => withRig(rigFixture().buffer, (root, session) => {
    session.enterEdit(); const leaf = bone(root, 'Leaf'), parent = bone(root, 'Child'), original = capture(root, session), vertices = worldVertices(root), object = mesh(root) as THREE.SkinnedMesh;
    const summary = session.deletionSummary(leaf.uuid, 'joint');
    assert.equal(summary.removedJointCount, 1); assert.equal(summary.affectedVertices, 1); assert.equal(summary.removedTrackCount, 1); assert.equal(summary.staticMeshCount, 0); assert.ok(summary.warnings.length);
    assert.deepEqual(capture(root, session), original); assert.equal(session.revision, 0);
    session.removeJoints(leaf.uuid, 'joint');
    assert.equal(root.getObjectByProperty('uuid', leaf.uuid), undefined); assert.deepEqual(object.skeleton.bones.map(joint => joint.name), ['Root', 'Side', 'Child']);
    const joints = object.geometry.getAttribute('skinIndex'), weights = object.geometry.getAttribute('skinWeight');
    assert.equal(object.skeleton.bones[joints.getX(0)], parent); assert.equal(weights.getX(0), 1);
    assert.ok(!session.clips.some(clip => clip.tracks.some(track => track.name.startsWith('Leaf.'))));
    close(worldVertices(root), vertices); assert.equal(session.revision, 1);
    const removed = capture(root, session); session.undo(); assert.equal(root.getObjectByProperty('uuid', leaf.uuid), leaf); assert.deepEqual(capture(root, session), original);
    session.redo(); assert.deepEqual(capture(root, session), removed); session.reset(); assert.deepEqual(capture(root, session), original);
  }));

  await test('Animated child chain removal drops only its tracks and empty clips while preserving surviving clip names and duration', () => withRig(rigFixture().buffer, (root, session) => {
    session.enterEdit(); const child = bone(root, 'Child'), leaf = bone(root, 'Leaf'), original = capture(root, session), vertices = worldVertices(root);
    const summary = session.deletionSummary(child.uuid, 'chain');
    assert.equal(summary.removedJointCount, 2); assert.equal(summary.affectedVertices, 3); assert.equal(summary.removedTrackCount, 2); assert.equal(summary.staticMeshCount, 0);
    assert.deepEqual(capture(root, session), original);
    session.removeJoints(child.uuid, 'chain');
    assert.equal(root.getObjectByProperty('uuid', child.uuid), undefined); assert.equal(root.getObjectByProperty('uuid', leaf.uuid), undefined);
    assert.deepEqual((mesh(root) as THREE.SkinnedMesh).skeleton.bones.map(joint => joint.name), ['Root', 'Side']);
    assert.deepEqual(session.clips.map(clip => clip.name), ['LinearShared', 'CubicShared', 'UnrelatedShared']); assert.deepEqual(session.clips.map(clip => clip.duration), [4, 4, 4]);
    assert.ok(!session.clips.some(clip => clip.tracks.some(track => /^(Child|Leaf)\./.test(track.name))));
    assert.deepEqual(capture(root, session).clips.at(-1), original.clips.at(-1)); close(worldVertices(root), vertices);
    session.undo(); assert.deepEqual(capture(root, session), original);
  }));

  await test('Root-only removal retains a non-joint transform anchor and exact STEP and cubic child motion under the authored rest transform', () => {
    const { document, binary } = parseGlb(rigFixture().buffer); document.animations[2].channels[0].target.node = 2;
    return withRig(encode(document, binary), (root, session) => {
      session.enterEdit(); const removed = bone(root, 'Root'), child = bone(root, 'Child'), side = bone(root, 'Side');
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), .3);
      session.commitJoint(removed.uuid, { position: [1.3, 2.1, .2], quaternion: rotation.toArray() });
      root.updateMatrixWorld(true); const childWorld = child.matrixWorld.toArray(), sideWorld = side.matrixWorld.toArray(), original = capture(root, session), vertices = worldVertices(root);
      const originalChild = session.clips[2].tracks.find(track => track.name === 'Child.position')!;
      const childValues = bytes(originalChild.values), childTimes = bytes(originalChild.times);
      const phases = [.13, .33, .61, .87];
      const expected = session.clips.slice(1, 3).map(clip => {
        const frozenRoot = new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.filter(track => !track.name.startsWith('Root.')).map(track => track.clone()));
        return phases.map(phase => worldPose(root, frozenRoot, 'Child', phase * 4));
      });
      const summary = session.deletionSummary(removed.uuid, 'joint'); assert.equal(summary.retainedTransformCount, 1); assert.ok(summary.warnings.some(warning => /anchor|transform/i.test(warning)));
      session.removeJoints(removed.uuid, 'joint');
      const anchor = root.getObjectByProperty('uuid', removed.uuid); assert.ok(anchor); assert.ok(!(anchor instanceof THREE.Bone)); assert.equal(anchor.name, removed.name);
      assert.equal(child.parent, anchor); assert.equal(side.parent, anchor);
      root.updateMatrixWorld(true); close(child.matrixWorld.toArray(), childWorld); close(side.matrixWorld.toArray(), sideWorld); close(worldVertices(root), vertices);
      assert.ok(!session.clips.some(clip => clip.tracks.some(track => track.name.startsWith('Root.'))));
      const step = session.clips.find(clip => clip.name === 'Step')!, cubic = session.clips.find(clip => clip.name === 'CubicShared')!;
      assert.equal(step.tracks[0].getInterpolation(), THREE.InterpolateDiscrete);
      const childTrack = cubic.tracks.find(track => track.name === 'Child.position')!;
      assert.equal((childTrack as any).createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline, true);
      assert.deepEqual(bytes(childTrack.values), childValues); assert.deepEqual(bytes(childTrack.times), childTimes);
      [step, cubic].forEach((clip, index) => phases.forEach((phase, i) => close(worldPose(root, clip, 'Child', phase * 4), expected[index][i])));
      session.undo(); assert.deepEqual(capture(root, session), original);
    });
  });

  await test('Removing the complete root chain creates a same-UUID static Mesh with baked rest and retained morph animation, and Undo restores the original skin', () => withRig(rigFixture({ morphWeights: true }).buffer, (root, session) => {
    session.enterEdit(); const removed = bone(root, 'Root'), originalMesh = mesh(root); assert.ok(originalMesh instanceof THREE.SkinnedMesh);
    const original = capture(root, session), vertices = worldVertices(root), uuid = originalMesh.uuid;
    const summary = session.deletionSummary(removed.uuid, 'chain');
    assert.equal(summary.removedJointCount, 4); assert.equal(summary.affectedVertices, 4); assert.equal(summary.removedTrackCount, 4); assert.equal(summary.staticMeshCount, 1); assert.ok(summary.warnings.some(warning => /static|bak|skin|deform/i.test(warning)));
    assert.deepEqual(capture(root, session), original);
    session.removeJoints(removed.uuid, 'chain');
    const staticMesh = root.getObjectByProperty('uuid', uuid); assert.ok(staticMesh instanceof THREE.Mesh); assert.ok(!(staticMesh instanceof THREE.SkinnedMesh));
    let joints = 0, skins = 0; root.traverse(node => { if (node instanceof THREE.Bone) joints++; if (node instanceof THREE.SkinnedMesh) skins++; });
    assert.equal(joints, 0); assert.equal(skins, 0); assert.equal(staticMesh.geometry.getAttribute('position').count, originalMesh.geometry.getAttribute('position').count);
    assert.equal(staticMesh.geometry.getAttribute('skinIndex'), undefined); assert.equal(staticMesh.geometry.getAttribute('skinWeight'), undefined);
    assert.equal(staticMesh.geometry.morphAttributes.position.length, 1); assert.deepEqual(staticMesh.morphTargetInfluences, originalMesh.morphTargetInfluences); close(worldVertices(root), vertices);
    assert.deepEqual(session.clips.map(clip => clip.name), ['LinearShared', 'CubicShared', 'UnrelatedShared', 'MorphWeights']);
    assert.ok(session.clips.at(-1)!.tracks.some(track => track.name === 'SkinMesh.morphTargetInfluences'));
    const removedState = capture(root, session); session.undo(); assert.equal(root.getObjectByProperty('uuid', uuid), originalMesh); assert.deepEqual(capture(root, session), original);
    session.redo(); assert.deepEqual(capture(root, session), removedState); session.reset(); assert.deepEqual(capture(root, session), original);
  }));

  await test('Removal rejects wrong modes active gestures and invalid targets without changing graph skin clips or history', () => withRig(rigFixture().buffer, (root, session) => {
    const uuid = bone(root, 'Root').uuid;
    const unchanged = (action: () => void) => {
      const before = capture(root, session), history = [session.revision, session.canUndo, session.canRedo, session.hasEdits];
      assert.throws(action); assert.deepEqual(capture(root, session), before); assert.deepEqual([session.revision, session.canUndo, session.canRedo, session.hasEdits], history);
    };
    unchanged(() => session.removeJoints(uuid, 'joint')); session.enterPose(); unchanged(() => session.removeJoints(uuid, 'chain'));
    session.enterEdit(); unchanged(() => session.removeJoints('missing-joint', 'chain')); unchanged(() => session.removeJoints(root.getObjectByName('Anchor')!.uuid, 'joint'));
    session.beginGesture(); unchanged(() => session.removeJoints(uuid, 'chain')); session.cancelGesture();
  }));

  await test('An invalid influence rejects a removal plan atomically before any authored mutation', () => withRig(rigFixture().buffer, (root, session) => {
    session.enterEdit(); const leaf = bone(root, 'Leaf'), object = mesh(root) as THREE.SkinnedMesh;
    object.geometry.getAttribute('skinWeight').setX(0, NaN);
    const before = capture(root, session), history = [session.revision, session.canUndo, session.canRedo, session.hasEdits];
    assert.throws(() => session.removeJoints(leaf.uuid, 'joint'));
    assert.deepEqual(capture(root, session), before); assert.deepEqual([session.revision, session.canUndo, session.canRedo, session.hasEdits], history);
  }));

  await test('Root removal preserves a direct authored attachment and its nonuniform world transform through the retained anchor', () => {
    const { document, binary } = parseGlb(rigFixture({ rootScale: [2, 1, .75] }).buffer); const index = document.nodes.length;
    document.nodes.push({ name: 'AuthorAttachment', translation: [.2, .3, -.1], rotation: [0, 0, Math.sin(.15), Math.cos(.15)], extras: { author: 'keep attachment' } }); document.nodes[1].children.push(index);
    return withRig(encode(document, binary), (root, session) => {
      session.enterEdit(); const removed = bone(root, 'Root'), attachment = root.getObjectByName('AuthorAttachment')!; root.updateMatrixWorld(true);
      const world = attachment.matrixWorld.toArray(), original = capture(root, session);
      session.removeJoints(removed.uuid, 'joint'); const anchor = root.getObjectByProperty('uuid', removed.uuid)!;
      assert.ok(!(anchor instanceof THREE.Bone)); assert.equal(attachment.parent, anchor); root.updateMatrixWorld(true); close(attachment.matrixWorld.toArray(), world);
      assert.equal(root.getObjectByProperty('uuid', attachment.uuid), attachment); session.undo(); assert.deepEqual(capture(root, session), original);
    });
  });

  await test('Additional declared skin influence sets reject preview and removal before rewriting supported four-slot geometry', () => {
    const { document, binary } = parseGlb(rigFixture().buffer), extension = new Uint8Array(binary.length + 4 * 4 * 4); extension.set(binary);
    const attributes = document.meshes[0].primitives[0].attributes, view = document.bufferViews.length, accessor = document.accessors.length;
    document.bufferViews.push({ buffer: 0, byteOffset: binary.length, byteLength: 64 });
    document.accessors.push({ bufferView: view, componentType: 5126, type: 'VEC4', count: 4 });
    attributes.JOINTS_1 = attributes.JOINTS_0; attributes.WEIGHTS_1 = accessor; document.buffers[0].byteLength = extension.length;
    return withRig(encode(document, extension), (root, session) => {
      assert.equal(getSourceAudit(root)?.rawSkinWeights?.invalidSumVertices, 0);
      rejectedPreflight(root, session, bone(root, 'Leaf').uuid, 'joint', /additional|compressed/i);
    });
  });

  await test('Post-decode compressed primitive provenance rejects raw-index removal without claiming a Draco decoder run', () => withRig(rigFixture().buffer, (root, session) => {
    // This unit covers the canonical metadata boundary after geometry decoding.
    // Decoder execution remains covered by browser/offline decoder regressions.
    const document = structuredClone(getSourceDocument(root)!);
    document.meshes[0].primitives[0].extensions = { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } } };
    const associations = new Map<THREE.Object3D | THREE.Material | THREE.Texture, SourceAssociation>();
    root.traverse(node => { const association = getSourceAssociation(node); if (association) associations.set(node, association); });
    captureSourceMetadata(root, getSourceAudit(root), document, associations);
    rejectedPreflight(root, session, bone(root, 'Leaf').uuid, 'joint', /compressed|additional/i);
  }));

  for (const defect of ['zero', 'invalid-sum', 'sparse-unreadable'] as const) await test(`Original ${defect} skin weights reject preview even when real GLTFLoader exposes finite normalized runtime weights`, () => {
    const { document, binary } = parseGlb(rigFixture().buffer), attributes = document.meshes[0].primitives[0].attributes;
    const accessor = document.accessors[attributes.WEIGHTS_0], bufferView = document.bufferViews[accessor.bufferView];
    if (defect === 'sparse-unreadable') accessor.sparse = { count: 1, indices: { bufferView: document.accessors[attributes.JOINTS_0].bufferView, componentType: 5123 }, values: { bufferView: accessor.bufferView } };
    else {
      const weights = new DataView(binary.buffer, binary.byteOffset), offset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      for (let component = 0; component < 4; component++) weights.setFloat32(offset + component * 4, defect === 'invalid-sum' && component === 0 ? 2 : 0, true);
    }
    return withRig(encode(document, binary), (root, session) => {
      const audit = getSourceAudit(root)?.rawSkinWeights; assert.ok(audit);
      assert.ok(defect === 'zero' ? audit.zeroWeightVertices > 0 : defect === 'invalid-sum' ? audit.invalidSumVertices > 0 : audit.unreadableAccessors > 0);
      const runtime = (mesh(root) as THREE.SkinnedMesh).geometry.getAttribute('skinWeight');
      assert.equal(runtime.getX(0), 1); assert.equal(runtime.getY(0), 0); assert.equal(runtime.getZ(0), 0); assert.equal(runtime.getW(0), 0);
      rejectedPreflight(root, session, bone(root, 'Leaf').uuid, 'joint', /original skin weights|repair|reimport/i);
    });
  });

  await test('Whole-skin static baking rejects an untouched unreachable source node that shares its mesh record', () => {
    const { document, binary } = parseGlb(rigFixture().buffer);
    document.nodes.push({ name: 'UnreachableAuthorMesh', mesh: 0, translation: [20, 0, 0], extras: { author: 'retain raw instance' } });
    return withRig(encode(document, binary), (root, session) => {
      assert.equal(root.getObjectByName('UnreachableAuthorMesh'), undefined); assert.equal(getSourceAudit(root)?.unreachableNodeCount, 1);
      session.enterEdit(); assert.equal(session.deletionSummary(bone(root, 'Leaf').uuid, 'joint').staticMeshCount, 0, 'Unchanged mesh geometry does not need the static-instance restriction');
      rejectedPreflight(root, session, bone(root, 'Root').uuid, 'chain', /another source mesh instance|instance-preserving|static baking/i);
    });
  });

  for (const payload of ['mesh', 'camera'] as const) await test(`A removed Bone with a source node-level ${payload} payload rejects preview before losing its authored attachment`, () => {
    const { document, binary } = parseGlb(rigFixture().buffer);
    if (payload === 'mesh') {
      const primitive = document.meshes[0].primitives[0];
      document.nodes[4].mesh = document.meshes.length;
      document.meshes.push({ name: 'AuthorBonePayload', primitives: [{ attributes: { POSITION: primitive.attributes.POSITION }, indices: primitive.indices }], extras: { author: 'rigid attachment' } });
    }
    else { document.cameras = [{ name: 'AuthorJointCamera', type: 'perspective', perspective: { yfov: .8, znear: .1, zfar: 100 } }]; document.nodes[4].camera = 0; }
    return withRig(encode(document, binary), (root, session) => {
      assert.ok(bone(root, 'Side').children.some(child => payload === 'mesh' ? child instanceof THREE.Mesh : child instanceof THREE.Camera));
      rejectedPreflight(root, session, bone(root, 'Side').uuid, 'joint', /node-level mesh or camera|source-aware removal/i);
    });
  });

  for (const kind of ['leaf', 'child-chain', 'root-single', 'root-static'] as const) await test(`Removal ${kind} exports and reimports with full rest/six-phase verification and surviving source clip identities`, () => {
    const source = rigFixture({ morphWeights: kind === 'root-static', ...(kind === 'root-single' ? { rootScale: [2, 1, .75] as [number, number, number] } : {}) }).buffer;
    const original = parseGlb(source), originalBytes = bytes(new Uint8Array(source));
    return withRig(source, async (root, session) => {
      session.enterEdit(); const target = bone(root, kind === 'leaf' ? 'Leaf' : kind === 'child-chain' ? 'Child' : 'Root');
      session.removeJoints(target.uuid, kind === 'child-chain' || kind === 'root-static' ? 'chain' : 'joint');
      const vertices = worldVertices(root), packet = buildRigExportPacket(session, source), output = patchRigGlb(packet), candidate = parseGlb(output);
      assert.deepEqual(bytes(new Uint8Array(source)), originalBytes); assert.deepEqual(candidate.binary.slice(0, original.binary.length), original.binary);
      assert.deepEqual(candidate.document.animations.map((clip: any) => clip.name), session.clips.map(clip => clip.name));
      assert.deepEqual(candidate.document.animations.find((clip: any) => clip.name === 'UnrelatedShared'), original.document.animations[3]);
      if (kind === 'root-static') {
        assert.equal(Object.hasOwn(candidate.document.nodes[5], 'skin'), false);
        assert.equal(Object.hasOwn(candidate.document.meshes[0].primitives[0].attributes, 'JOINTS_0'), false);
        assert.equal(Object.hasOwn(candidate.document.meshes[0].primitives[0].attributes, 'WEIGHTS_0'), false);
        assert.equal(candidate.document.skins.length, original.document.skins.length, 'Unused original skin records must remain present');
      }
      const loader = new GLBLoaderService(); let fresh: THREE.Group | undefined;
      try {
        const loaded = await loader.loadFromArrayBuffer(output, 'removed-reimport.glb'); fresh = loaded.root;
        assert.deepEqual(loaded.animations.map(clip => clip.name), session.clips.map(clip => clip.name)); close(worldVertices(fresh), vertices);
        if (kind === 'root-single') {
          const anchor = fresh.getObjectByName('Root')!; assert.ok(anchor); assert.ok(!(anchor instanceof THREE.Bone));
          const frameIndex = session.exportNodeIndices().get(target.uuid); assert.ok(frameIndex !== undefined && frameIndex >= original.document.nodes.length);
          assert.ok(packet.addedNodes.some(node => node.index === frameIndex)); assert.equal(getSourceAssociation(anchor)?.nodes, frameIndex);
          assert.deepEqual(candidate.document.nodes[frameIndex].extras, original.document.nodes[1].extras);
          assert.deepEqual(candidate.document.nodes[1].extras, original.document.nodes[1].extras);
          assert.ok(!candidate.document.nodes[1].children?.length, 'Original frozen-frame source record must be detached');
        }
        if (kind === 'root-static') assert.ok(!(mesh(fresh) instanceof THREE.SkinnedMesh));
        const expected = unpackRoot(structuredClone(packRoot(root))), clips = unpackClips(structuredClone(packClips(session.clips)));
        try {
          const verification = await verifyEditedRig(packet, output, expected, clips, rigIdentities(root, session.exportNodeIndices()));
          assert.equal(verification.status, 'VERIFIED', verification.reasons.join('; ')); assert.equal(verification.sourcePreserved, true);
          assert.deepEqual(verification.phases, [0, .13, .33, .61, .87, 1]); assert.equal(verification.sampledVertices, 4 * (1 + 6 * session.clips.length));
        } finally { disposeModelResources(expected); }
      } finally { if (fresh) disposeModelResources(fresh); loader.dispose(); }
    });
  });
  return results;
}
