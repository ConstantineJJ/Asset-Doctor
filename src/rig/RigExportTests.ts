import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLBLoaderService, type LoadedModelResult } from '../loaders/GLBLoaderService';
import { getSourceAssociation } from '../loaders/AssetRuntimeMetadata';
import { rigFixture } from '../../tests/rig-fixtures';
import { RigEditSession } from './RigEditSession';
import { buildRigExportPacket, patchRigGlb } from './RigGlbPatch';

interface TestResult { name: string; passed: boolean; actual?: unknown; expected?: unknown }
type GltfDocument = Record<string, any>;
const legacyKeys = ['__assetDoctorSourceAudit', '__assetDoctorAuthoredMaterials', '__assetDoctorCompareGrounded'];

function decode(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(8, true), buffer.byteLength);
  const jsonLength = view.getUint32(12, true);
  const document: GltfDocument = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)).trim());
  const binLength = view.getUint32(20 + jsonLength, true);
  const binary = new Uint8Array(buffer.slice(28 + jsonLength, 28 + jsonLength + binLength));
  return { document, binary };
}
function encode(document: GltfDocument, binary: Uint8Array) {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const binLength = Math.ceil(binary.length / 4) * 4;
  const buffer = new ArrayBuffer(28 + jsonLength + binLength); const view = new DataView(buffer);
  [0x46546c67, 2, buffer.byteLength, jsonLength, 0x4e4f534a].forEach((value, i) => view.setUint32(i * 4, value, true));
  new Uint8Array(buffer, 20, jsonLength).fill(32); new Uint8Array(buffer, 20, json.length).set(json);
  view.setUint32(20 + jsonLength, binLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
  new Uint8Array(buffer, 28 + jsonLength, binary.length).set(binary); return buffer;
}
function sourceFixture(change?: (document: GltfDocument) => void) {
  const decoded = decode(rigFixture({ morphWeights: true }).buffer);
  decoded.document.materials = [{ name: 'AuthorMaterial', pbrMetallicRoughness: { baseColorFactor: [.25, .5, .75, .8], metallicFactor: .3, roughnessFactor: .6 }, alphaMode: 'BLEND', doubleSided: true, extras: { artist: 'original', nested: ['keep', 3] } }];
  decoded.document.meshes[0].primitives[0].material = 0;
  change?.(decoded.document); return encode(decoded.document, decoded.binary);
}
function values(buffer: ArrayBuffer, accessorIndex: number): number[] {
  const { document, binary } = decode(buffer); const accessor = document.accessors[accessorIndex];
  assert.equal(accessor.componentType, 5126);
  const size: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 };
  const bufferView = document.bufferViews[accessor.bufferView];
  const view = new DataView(binary.buffer, binary.byteOffset);
  return Array.from({ length: accessor.count * size[accessor.type] }, (_, i) => view.getFloat32((bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * 4, true));
}
function sampler(buffer: ArrayBuffer, animation: number, node: number, path: string) {
  const { document } = decode(buffer); const clip = document.animations[animation];
  const channel = clip.channels.find((entry: any) => entry.target.node === node && entry.target.path === path);
  assert.ok(channel, `Missing source channel ${animation}/${node}/${path}`);
  const definition = clip.samplers[channel.sampler];
  return { definition, times: values(buffer, definition.input), values: values(buffer, definition.output) };
}
function close(actual: ArrayLike<number>, expected: ArrayLike<number>, epsilon = 3e-5) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) <= epsilon, `component ${i}: ${actual[i]} != ${expected[i]}`);
}
function sourceNode(root: THREE.Group, index: number) {
  let result: THREE.Object3D | undefined;
  root.traverse(node => { if (getSourceAssociation(node)?.nodes === index) result = node; });
  assert.ok(result, `Missing canonical source node ${index}`); return result;
}
function sourceTrack(root: THREE.Group, clip: THREE.AnimationClip, node: number, property: string) {
  const found = clip.tracks.find(track => {
    const path = THREE.PropertyBinding.parseTrackName(track.name);
    const target = THREE.PropertyBinding.findNode(root, path.nodeName) as THREE.Object3D | null;
    return target && getSourceAssociation(target)?.nodes === node && path.propertyName === property;
  });
  assert.ok(found, `Missing runtime channel ${node}/${property}`); return found;
}
function skin(root: THREE.Group) {
  let found: THREE.SkinnedMesh | undefined;
  root.traverse(node => { if (node instanceof THREE.SkinnedMesh) found = node; });
  assert.ok(found); return found;
}
function worldVertices(root: THREE.Group) {
  root.updateMatrixWorld(true); const mesh = skin(root); mesh.skeleton.update();
  const position = mesh.geometry.getAttribute('position'); const result: number[] = [];
  for (let i = 0; i < position.count; i++) result.push(...mesh.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(position, i)).applyMatrix4(mesh.matrixWorld).toArray());
  return result;
}
function sample(root: THREE.Group, clip: THREE.AnimationClip, node: number, time: number) {
  const mixer = new THREE.AnimationMixer(root); const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play(); mixer.setTime(time);
  const target = sourceNode(root, node); const result = [...target.position.toArray(), ...target.quaternion.toArray()];
  mixer.stopAllAction(); mixer.uncacheRoot(root); return result;
}
function dispose(loaded: LoadedModelResult) {
  loaded.root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose(); (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => material.dispose());
  });
}
async function withRig(source: ArrayBuffer, run: (loaded: LoadedModelResult, session: RigEditSession, reload: (buffer: ArrayBuffer) => Promise<LoadedModelResult>) => Promise<void> | void, reverseTracks = false) {
  const loader = new GLBLoaderService(); const models: LoadedModelResult[] = [];
  const reload = async (buffer: ArrayBuffer) => { const loaded = await loader.loadFromArrayBuffer(buffer, 'rig-export.glb'); models.push(loaded); return loaded; };
  try {
    const loaded = await reload(source);
    if (reverseTracks) loaded.animations.forEach(clip => clip.tracks.reverse());
    await run(loaded, new RigEditSession(loaded.root, loaded.animations), reload);
  } finally { models.forEach(dispose); loader.dispose(); }
}

export async function runRigExportTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  async function test(name: string, run: () => Promise<void>) {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, actual: String(error), expected: 'Source-preserving rig export contract holds' }); }
  }

  await test('Rig GLB export reimports authored joint TRS and compensation with child-first skin identities', async () => {
    const source = sourceFixture(); const original = decode(source).document;
    await withRig(source, async ({ root }, session, reload) => {
      const vertices = worldVertices(root); const bind = skin(root).bindMatrix.toArray();
      session.enterEdit(); session.commitJoint(sourceNode(root, 1).uuid, { position: [1.4, 2.5, -.2], quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), .35).toArray() });
      const expected = session.snapshot();
      const output = patchRigGlb(buildRigExportPacket(session, source)); const document = decode(output).document;
      const loaded = await reload(output);
      assert.deepEqual(document.skins[0].joints, original.skins[0].joints);
      assert.equal(document.skins[0].skeleton, original.skins[0].skeleton);
      assert.equal(document.skins[0].name, original.skins[0].name); assert.deepEqual(document.skins[0].extras, original.skins[0].extras);
      for (const index of [1, 2, 3, 4]) {
        const rest = expected.nodes.get(sourceNode(root, index).uuid)!;
        close(sourceNode(loaded.root, index).position.toArray(), rest.position);
        close(sourceNode(loaded.root, index).quaternion.toArray(), rest.quaternion);
        close(sourceNode(loaded.root, index).scale.toArray(), rest.scale);
        assert.equal(document.nodes[index].name, original.nodes[index].name); assert.deepEqual(document.nodes[index].extras, original.nodes[index].extras);
      }
      close(values(output, document.skins[0].inverseBindMatrices), [...expected.skins.values()][0].flat());
      close(worldVertices(loaded.root), vertices); close(skin(loaded.root).bindMatrix.toArray(), bind);
      assert.deepEqual(skin(loaded.root).skeleton.bones.map(node => getSourceAssociation(node)?.nodes), [3, 1, 4, 2]);
    });
  });

  await test('Rig GLB export appends data while keeping source binary, accessor/view metadata, materials and extras exact', async () => {
    const source = sourceFixture(); const bytes = new Uint8Array(source).slice(); const original = decode(source);
    await withRig(source, ({ root }, session) => {
      root.userData.__assetDoctorSourceAudit = { runtimeOnly: true };
      skin(root).userData.__assetDoctorCompareGrounded = true;
      skin(root).geometry.userData.__assetDoctorAuthoredMaterials = ['runtimeOnly'];
      session.enterEdit(); session.commitJoint(sourceNode(root, 3).uuid, { position: [.3, 1.2, -.1] }); session.setClipDuration(2, 8);
      const output = patchRigGlb(buildRigExportPacket(session, source)); const actual = decode(output);
      assert.deepEqual(actual.binary.slice(0, original.binary.length), original.binary);
      assert.deepEqual(actual.document.accessors.slice(0, original.document.accessors.length), original.document.accessors);
      assert.deepEqual(actual.document.bufferViews.slice(0, original.document.bufferViews.length), original.document.bufferViews);
      assert.deepEqual(actual.document.materials, original.document.materials); assert.deepEqual(actual.document.extras, original.document.extras);
      assert.deepEqual(actual.document.meshes, original.document.meshes); assert.deepEqual(actual.document.scenes, original.document.scenes);
      assert.deepEqual(new Uint8Array(source), bytes);
      const json = JSON.stringify(actual.document); legacyKeys.forEach(key => assert.ok(!json.includes(key), `${key} leaked to serialized author data`));
    });
  });

  await test('Changed joint channels detach shared samplers and accessors without changing unrelated channels or clips', async () => {
    const source = sourceFixture(); const original = decode(source).document;
    await withRig(source, async ({ root }, session, reload) => {
      session.enterEdit(); session.commitJoint(sourceNode(root, 1).uuid, { position: [1.5, 1.75, .2] });
      const output = patchRigGlb(buildRigExportPacket(session, source)); const document = decode(output).document;
      const changed = sampler(output, 0, 1, 'translation'); const unrelated = sampler(output, 0, 6, 'translation');
      close(changed.values, [1.5, 1.75, .2, 2.5, 2.75, .2, 1.5, 1.75, .2]);
      assert.notEqual(changed.definition.output, unrelated.definition.output);
      assert.deepEqual(unrelated, sampler(source, 0, 6, 'translation'));
      assert.deepEqual(document.animations[3], original.animations[3]);
      assert.deepEqual(sampler(output, 3, 6, 'translation'), sampler(source, 3, 6, 'translation'));
      const sourceAccessor = original.accessors[sampler(source, 0, 1, 'translation').definition.output];
      assert.deepEqual(document.accessors[changed.definition.output].extras, sourceAccessor.extras);
      const loaded = await reload(output);
      close(sourceTrack(loaded.root, loaded.animations[0], 1, 'position').values, changed.values);
      close(sourceTrack(loaded.root, loaded.animations[0], 6, 'position').values, unrelated.values);
    });
  });

  await test('Rewritten animation and inverse-bind streams retain active accessor and bufferView author labels', async () => {
    const source = sourceFixture(); const original = decode(source).document;
    await withRig(source, ({ root }, session) => {
      session.enterEdit(); session.commitJoint(sourceNode(root, 3).uuid, { position: [.3, 1.2, -.1] });
      const output = patchRigGlb(buildRigExportPacket(session, source)); const document = decode(output).document;
      const previousSampler = sampler(source, 2, 3, 'translation').definition;
      const updatedSampler = sampler(output, 2, 3, 'translation').definition;
      for (const [previousIndex, updatedIndex] of [[previousSampler.input, updatedSampler.input], [previousSampler.output, updatedSampler.output], [original.skins[0].inverseBindMatrices, document.skins[0].inverseBindMatrices]]) {
        const previousAccessor = original.accessors[previousIndex]; const updatedAccessor = document.accessors[updatedIndex];
        assert.equal(updatedAccessor.name, previousAccessor.name); assert.deepEqual(updatedAccessor.extras, previousAccessor.extras);
        const previousView = original.bufferViews[previousAccessor.bufferView]; const updatedView = document.bufferViews[updatedAccessor.bufferView];
        assert.equal(updatedView.name, previousView.name, 'Active rewritten bufferView lost its authored name');
        assert.deepEqual(updatedView.extras, previousView.extras, 'Active rewritten bufferView lost authored extras');
      }
    });
  });

  await test('STEP and genuine cubic time/derivative serialization preserves reimported phase motion', async () => {
    const source = sourceFixture(); const original = decode(source).document;
    await withRig(source, async ({ root }, session, reload) => {
      session.enterEdit(); session.commitJoint(sourceNode(root, 3).uuid, { position: [.3, 1.2, -.1] });
      session.setClipDuration(1, 10); session.setClipDuration(2, 8);
      const phases = [.09, .31, .57, .87];
      const expected = phases.map(phase => [sample(root, session.clips[2], 3, phase * 8), sample(root, session.clips[2], 1, phase * 8)]);
      const output = patchRigGlb(buildRigExportPacket(session, source)); const document = decode(output).document;
      const step = sampler(output, 1, 2, 'translation'); assert.equal(step.definition.interpolation, 'STEP'); close(step.times, [0, 5, 10]);
      for (const [node, path, property, size] of [[3, 'translation', 'position', 3], [6, 'translation', 'position', 3], [1, 'rotation', 'quaternion', 4]] as const) {
        const serialized = sampler(output, 2, node, path); const initial = sampler(source, 2, node, path);
        assert.equal(serialized.definition.interpolation, 'CUBICSPLINE'); close(serialized.times, [0, 4, 8]);
        close(serialized.values, sourceTrack(root, session.clips[2], node, property).values);
        for (let i = 0; i < initial.values.length; i++) if (Math.floor(i / size) % 3 !== 1) close([serialized.values[i]], [initial.values[i] / 2]);
      }
      assert.deepEqual(document.animations[3], original.animations[3]);
      const loaded = await reload(output);
      for (const property of ['position', 'quaternion']) {
        const actual = sourceTrack(loaded.root, loaded.animations[2], property === 'position' ? 3 : 1, property);
        assert.equal((actual as any).createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline, true);
      }
      phases.forEach((phase, i) => { close(sample(loaded.root, loaded.animations[2], 3, phase * 8), expected[i][0]); close(sample(loaded.root, loaded.animations[2], 1, phase * 8), expected[i][1]); });
    });
  });

  await test('Export channel identity uses canonical node/path with unnamed targets, duplicate clip names and reordered runtime tracks', async () => {
    const source = sourceFixture(document => {
      [1, 2, 3, 4, 6, 7].forEach(index => delete document.nodes[index].name);
      document.animations[0].name = 'Repeated'; document.animations[2].name = 'Repeated';
      document.animations[2].channels.reverse();
    });
    const original = decode(source).document;
    await withRig(source, async ({ root }, session, reload) => {
      session.enterEdit(); session.commitJoint(sourceNode(root, 3).uuid, { position: [.4, 1.1, -.2] }); session.setClipDuration(2, 6);
      const output = patchRigGlb(buildRigExportPacket(session, source)); const document = decode(output).document;
      assert.deepEqual(document.animations[0], original.animations[0]);
      assert.deepEqual(document.animations[3], original.animations[3]);
      close(sampler(output, 2, 3, 'translation').values, sourceTrack(root, session.clips[2], 3, 'position').values);
      close(sampler(output, 2, 1, 'rotation').values, sourceTrack(root, session.clips[2], 1, 'quaternion').values);
      close(sampler(output, 2, 6, 'translation').values, sourceTrack(root, session.clips[2], 6, 'position').values);
      [1, 2, 3, 4, 6, 7].forEach(index => assert.equal(Object.hasOwn(document.nodes[index], 'name'), false));
      const loaded = await reload(output);
      close(sourceNode(loaded.root, 3).position.toArray(), [.4, 1.1, -.2]);
      close(sourceTrack(loaded.root, loaded.animations[2], 3, 'position').values, sourceTrack(root, session.clips[2], 3, 'position').values);
    }, true);
  });

  await test('Rig export during pose preview serializes authored rest and compensated inverse binds', async () => {
    const source = sourceFixture();
    await withRig(source, async ({ root }, session, reload) => {
      session.enterEdit(); session.commitJoint(sourceNode(root, 1).uuid, { position: [1.6, 2.1, 0] });
      const authored = session.snapshot(); const vertices = worldVertices(root);
      session.enterPose(); session.previewPoseRotation(sourceNode(root, 1).uuid, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .7).toArray());
      const output = patchRigGlb(buildRigExportPacket(session, source)); const loaded = await reload(output);
      const rest = authored.nodes.get(sourceNode(root, 1).uuid)!;
      close(sourceNode(loaded.root, 1).position.toArray(), rest.position); close(sourceNode(loaded.root, 1).quaternion.toArray(), rest.quaternion);
      close(worldVertices(loaded.root), vertices);
    });
  });

  await test('Scalar or colliding authored extras reject terminal-guide authoring without source loss', async () => {
    for (const extras of [17, 'author-value', null, [1, 2], { assetDoctorRigTip: { author: 'collision' } }]) {
      const source = sourceFixture(document => { document.nodes[3].extras = extras; }); const before = new Uint8Array(source).slice();
      await withRig(source, ({ root }, session) => {
        session.enterEdit(); assert.throws(() => session.setTerminalTip(sourceNode(root, 3).uuid, [0, 2, 0]));
        assert.equal(session.hasEdits, false);
        const output = patchRigGlb(buildRigExportPacket(session, source));
        assert.deepEqual(decode(output).document.nodes[3].extras, extras); assert.deepEqual(new Uint8Array(source), before);
      });
    }
  });

  await test('A source channel skipped by GLTFLoader for missing target.node rejects export rather than shifting identities', async () => {
    const source = sourceFixture(document => { document.animations[2].channels.unshift({ sampler: 0, target: { path: 'translation' } }); });
    const original = new Uint8Array(source).slice();
    await withRig(source, ({ root }, session) => {
      assert.equal(session.clips[2].tracks.length, 3, 'Real GLTFLoader must skip the missing-node channel');
      session.enterEdit(); session.commitJoint(sourceNode(root, 3).uuid, { position: [.4, 1.1, 0] });
      assert.throws(() => patchRigGlb(buildRigExportPacket(session, source)), /channel|target|node|mapping|unsupported/i);
      assert.deepEqual(new Uint8Array(source), original);
    });
  });
  await test('Unrelated edits preserve extended imported terminal-guide author metadata',async()=>{
    const tip={version:1,point:[0,2,0],author:'keep'};
    const source=sourceFixture(document=>{document.nodes[3].extras={assetDoctorRigTip:tip,other:'keep-too'};});
    await withRig(source,({root},session)=>{
      session.enterEdit();session.commitJoint(sourceNode(root,1).uuid,{position:[1.2,2,0]});
      const output=patchRigGlb(buildRigExportPacket(session,source));
      assert.deepEqual(decode(output).document.nodes[3].extras,{assetDoctorRigTip:tip,other:'keep-too'});
      assert.throws(()=>session.setTerminalTip(sourceNode(root,3).uuid,[0,3,0]));
    });
  });
  await test('Active gestures refuse export and history changes before the revision advances',async()=>{
    const source=sourceFixture();
    await withRig(source,({root},session)=>{
      session.enterEdit();session.commitJoint(sourceNode(root,1).uuid,{position:[1.2,2,0]});
      const revision=session.revision;
      session.beginGesture();session.previewJoint(sourceNode(root,1).uuid,{position:[1.5,2,0]},'follow');
      assert.equal(session.revision,revision);assert.equal(session.isGestureActive,true);
      assert.throws(()=>buildRigExportPacket(session,source));assert.throws(()=>session.undo());assert.throws(()=>session.setClipDuration(0,8));
      session.cancelGesture();assert.equal(session.isGestureActive,false);assert.doesNotThrow(()=>buildRigExportPacket(session,source));
    });
  });
  return results;
}
