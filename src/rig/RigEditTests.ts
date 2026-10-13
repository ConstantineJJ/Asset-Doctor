import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLBLoaderService } from '../loaders/GLBLoaderService';
import { rigFixture, type RigFixtureOptions } from '../../tests/rig-fixtures';
import { RigEditSession } from './RigEditSession';
import { getSourceAssociation, getSourceDocument } from '../loaders/AssetRuntimeMetadata';

interface TestResult { name: string; passed: boolean; actual?: unknown; expected?: unknown }

function close(actual: ArrayLike<number>, expected: ArrayLike<number>, epsilon = 2e-5) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) <= epsilon, `component ${i}: ${actual[i]} != ${expected[i]}`);
}

function bytes(array: ArrayBufferView) { return Array.from(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)); }
function bone(root: THREE.Group, name: string) {
  const result = root.getObjectByName(name);
  assert.ok(result instanceof THREE.Bone, `Missing bone ${name}`);
  return result;
}
function mesh(root: THREE.Group) {
  let result: THREE.SkinnedMesh | undefined;
  root.traverse(object => { if (object instanceof THREE.SkinnedMesh) result = object; });
  assert.ok(result, 'Missing skinned mesh'); return result;
}
function track(clips: THREE.AnimationClip[], clip: string, target: string, property = 'position') {
  const result = clips.find(item => item.name === clip)?.tracks.find(item => item.name === `${target}.${property}`);
  assert.ok(result, `Missing ${clip}: ${target}.${property}`); return result;
}
function cubic(track: THREE.KeyframeTrack) {
  assert.equal((track as any).createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline, true, 'Must retain real GLTFLoader cubic factory');
}
function interpolate(track: THREE.KeyframeTrack, time: number): number[] {
  return Array.from((track as any).createInterpolant().evaluate(time) as ArrayLike<number>);
}

function worldVertices(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const skin = mesh(root); skin.skeleton.update();
  const position = skin.geometry.getAttribute('position');
  const vertices: number[] = [];
  for (let index = 0; index < position.count; index++) {
    const point = new THREE.Vector3().fromBufferAttribute(position, index);
    skin.applyBoneTransform(index, point).applyMatrix4(skin.matrixWorld);
    vertices.push(...point.toArray());
  }
  return vertices;
}

function capture(root: THREE.Group, clips: THREE.AnimationClip[]) {
  root.updateMatrixWorld(true);
  const transforms: unknown[] = [];
  root.traverse(object => transforms.push([object.uuid, object.position.toArray(), object.quaternion.toArray(), object.scale.toArray(), object.matrixWorld.toArray()]));
  const skin = mesh(root);
  return {
    transforms,
    bind: skin.bindMatrix.toArray(), bindInverse: skin.bindMatrixInverse.toArray(),
    inverses: skin.skeleton.boneInverses.map(matrix => matrix.toArray()),
    position: bytes(skin.geometry.getAttribute('position').array),
    weights: bytes(skin.geometry.getAttribute('skinWeight').array),
    joints: bytes(skin.geometry.getAttribute('skinIndex').array),
    clips: clips.map(clip => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.map(item => ({ name: item.name, times: bytes(item.times), values: bytes(item.values), cubic: !!(item as any).createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline })) })),
  };
}

function sample(root: THREE.Group, clip: THREE.AnimationClip, name: string, time: number) {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  mixer.setTime(time); root.updateMatrixWorld(true);
  const target = root.getObjectByName(name)!;
  const result = { position: target.position.toArray(), quaternion: target.quaternion.toArray() };
  mixer.stopAllAction(); mixer.uncacheRoot(root); root.updateMatrixWorld(true);
  return result;
}

async function withRig(options: RigFixtureOptions, run: (root: THREE.Group, session: RigEditSession, clips: THREE.AnimationClip[], fixture: ReturnType<typeof rigFixture>) => void) {
  const fixture = rigFixture(options);
  const loader = new GLBLoaderService();
  try {
    const loaded = await loader.loadFromArrayBuffer(fixture.buffer, 'rig-regression.glb');
    try { run(loaded.root, new RigEditSession(loaded.root, loaded.animations), loaded.animations, fixture); }
    finally {
      loaded.root.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
        }
      });
    }
  } finally { loader.dispose(); }
}

export async function runRigEditTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  async function test(name: string, run: Parameters<typeof withRig>[1], options: RigFixtureOptions = {}) {
    try { await withRig(options, run); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, actual: String(error), expected: 'Rig edit contract holds' }); }
  }

  await test('Rig fixture has child-first joints, valid bind shape, and genuine cubic clips', (root, _session, clips, fixture) => {
    const skin = mesh(root);
    assert.deepEqual(skin.skeleton.bones.map(item => item.name), ['Leaf', 'Root', 'Side', 'Child']);
    const expected: number[] = [];
    const positions = skin.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) expected.push(...new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(skin.matrixWorld).toArray());
    close(worldVertices(root), expected);
    cubic(track(clips, 'CubicShared', 'Leaf'));
    cubic(track(clips, 'CubicShared', 'Root', 'quaternion'));
    assert.equal(track(clips, 'LinearShared', 'Root').values, track(clips, 'LinearShared', 'Unrelated').values, 'Fixture must exercise aliased output accessors');
    assert.equal(track(clips, 'LinearShared', 'Root').times, track(clips, 'CubicShared', 'Leaf').times, 'Fixture must exercise aliased input accessors');
    assert.equal(fixture.document.skins[0].extras.skinAuthor, 'keep-me');
  });

  await test('Enter Edit and restoreRest use explicit authored joint TRS under a non-joint anchor', (root, session, clips) => {
    const rest = capture(root, clips);
    const mixer = new THREE.AnimationMixer(root); mixer.clipAction(clips[0]).play(); mixer.setTime(2);
    session.enterEdit();
    close(bone(root, 'Root').position.toArray(), [1, 2, 0]);
    close(bone(root, 'Leaf').position.toArray(), [0, 1, 0]);
    mixer.stopAllAction(); mixer.uncacheRoot(root);
    session.restoreRest(); assert.deepEqual(capture(root, session.clips), rest);
  });

  await test('Parent edits preserve actual world skin and raw buffers with child-first skin ordering', (root, session, clips) => {
    const before = capture(root, clips); const vertices = worldVertices(root);
    session.enterEdit();
    session.commitJoint(bone(root, 'Root').uuid, { position: [1.4, 2.5, -.2], quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), .35).toArray() });
    close(worldVertices(root), vertices);
    const after = capture(root, session.clips);
    assert.deepEqual(after.position, before.position); assert.deepEqual(after.weights, before.weights); assert.deepEqual(after.joints, before.joints);
    assert.deepEqual(after.bind, before.bind); assert.deepEqual(after.bindInverse, before.bindInverse);
    assert.notDeepEqual(after.inverses, before.inverses);
    assert.equal(session.hasEdits, true); assert.equal(session.revision, 1);
  });

  await test('Hold children preserves document-world origins and rotations across multiple chains', (root, session) => {
    root.updateMatrixWorld(true);
    const children = ['Child', 'Leaf', 'Side'].map(name => bone(root, name));
    const worlds = children.map(child => child.matrixWorld.toArray()); const vertices = worldVertices(root);
    session.enterEdit(); session.commitJoint(bone(root, 'Root').uuid, { position: [2, 2.4, 1], quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .4).toArray() }, 'hold');
    root.updateMatrixWorld(true); children.forEach((child, i) => close(child.matrixWorld.toArray(), worlds[i]));
    close(worldVertices(root), vertices);
  });

  await test('Unsafe compensation and nonfinite joint changes reject atomically', (root, session, clips) => {
    session.enterEdit(); const before = capture(root, clips);
    assert.throws(() => session.commitJoint(bone(root, 'Root').uuid, { position: [NaN, 2, 0] }));
    assert.throws(() => session.commitJoint(bone(root, 'Root').uuid, { quaternion: [0, 0, 0, 0] }));
    assert.throws(() => session.commitJoint('missing-joint', { position: [0, 0, 0] }));
    assert.deepEqual(capture(root, session.clips), before); assert.equal(session.revision, 0); assert.equal(session.hasEdits, false);
  });

  await test('Hold children rejects nonuniform-parent rotations requiring scale/shear changes atomically', (root, session, clips) => {
    session.enterEdit(); const before = capture(root, clips);
    assert.throws(() => session.commitJoint(bone(root, 'Root').uuid, { quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), .6).toArray() }, 'hold'));
    assert.deepEqual(capture(root, session.clips), before); assert.equal(session.revision, 0);
  }, { rootScale: [2, 1, .75] });

  await test('Singular document-world compensation rejects atomically', (root, session, clips) => {
    session.enterEdit();
    root.getObjectByName('Anchor')!.scale.x = 0;
    const before = capture(root, session.clips);
    assert.throws(() => session.commitJoint(bone(root, 'Root').uuid, { position: [2, 2, 0] }));
    assert.deepEqual(capture(root, session.clips), before); assert.equal(session.revision, 0);
  });

  await test('Parent length moves the selected actual child origin while terminal tips remain non-deforming', (root, session) => {
    session.enterEdit(); const vertices = worldVertices(root); const boneCount = mesh(root).skeleton.bones.length;
    session.setBoneLength(bone(root, 'Root').uuid, bone(root, 'Child').uuid, 3.5);
    close(bone(root, 'Child').position.toArray(), [0, 3.5, 0]); close(bone(root, 'Leaf').position.toArray(), [0, 1, 0]);
    close(worldVertices(root), vertices);
    session.setTerminalTip(bone(root, 'Leaf').uuid, [0, 2.2, .1]);
    assert.equal(mesh(root).skeleton.bones.length, boneCount); close(worldVertices(root), vertices);
    assert.throws(() => session.setBoneLength(bone(root, 'Root').uuid, bone(root, 'Leaf').uuid, 3));
    assert.throws(() => session.setBoneLength(bone(root, 'Root').uuid, bone(root, 'Child').uuid, 0));
  });

  await test('Translation rebasing detaches shared sampler arrays from unrelated channels and clips', (root, session, clips) => {
    const source = capture(root, clips).clips;
    const unrelated = track(clips, 'LinearShared', 'Unrelated');
    const unrelatedBytes = bytes(unrelated.values);
    session.enterEdit(); session.commitJoint(bone(root, 'Root').uuid, { position: [1.5, 1.75, .2] });
    close(track(session.clips, 'LinearShared', 'Root').values, [1.5, 1.75, .2, 2.5, 2.75, .2, 1.5, 1.75, .2]);
    assert.deepEqual(bytes(track(session.clips, 'LinearShared', 'Unrelated').values), unrelatedBytes);
    assert.deepEqual(capture(root, clips).clips, source, 'Pristine source clips must remain exact');
    assert.deepEqual(bytes(track(session.clips, 'UnrelatedShared', 'Unrelated').values), unrelatedBytes);
    assert.equal(track(session.clips, 'Step', 'Child').getInterpolation(), THREE.InterpolateDiscrete);
  });

  await test('Cubic translation rebasing shifts only key values and preserves actual phase motion', (root, session, clips) => {
    const original = track(clips, 'CubicShared', 'Leaf'); const sourceValues = Array.from(original.values);
    const phases = [.13, .37, .68, .91];
    const poses = phases.map(phase => sample(root, clips[2], 'Leaf', phase * 4).position);
    session.enterEdit(); session.commitJoint(bone(root, 'Leaf').uuid, { position: [.3, 1.2, -.1] });
    const edited = track(session.clips, 'CubicShared', 'Leaf'); cubic(edited);
    for (let i = 0; i < sourceValues.length; i++) close([edited.values[i]], [sourceValues[i] + (Math.floor(i / 3) % 3 === 1 ? [.3, .2, -.1][i % 3] : 0)]);
    phases.forEach((phase, i) => close(sample(root, session.clips[2], 'Leaf', phase * 4).position, poses[i].map((v, axis) => v + [.3, .2, -.1][axis])));
    assert.deepEqual(bytes(track(session.clips, 'CubicShared', 'Unrelated').values), bytes(original.values));
  });

  await test('Cubic quaternion rebasing preserves real interpolation under the new rest rotation', (root, session, clips) => {
    const delta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .4);
    const phases = [.19, .43, .77];
    const poses = phases.map(phase => sample(root, clips[2], 'Root', phase * 4).quaternion);
    session.enterEdit(); session.commitJoint(bone(root, 'Root').uuid, { quaternion: delta.toArray() });
    cubic(track(session.clips, 'CubicShared', 'Root', 'quaternion'));
    phases.forEach((phase, i) => close(sample(root, session.clips[2], 'Root', phase * 4).quaternion, delta.clone().multiply(new THREE.Quaternion().fromArray(poses[i])).toArray()));
  });

  await test('Cubic duration retiming scales derivatives and retains real normalized-phase motion', (root, session, clips) => {
    const before = capture(root, clips).clips;
    const phases = [.07, .21, .48, .73, .94];
    const original = phases.map(phase => ['Leaf', 'Root'].map(name => sample(root, clips[2], name, phase * 4)));
    session.setClipDuration(2, 8);
    const updated = session.clips[2]; assert.equal(updated.duration, 8);
    for (let index = 0; index < clips[2].tracks.length; index++) {
      const old = clips[2].tracks[index]; const next = updated.tracks[index]; cubic(next);
      close(next.times, Array.from(old.times, time => time * 2));
      const size = old.name.endsWith('quaternion') ? 4 : 3;
      close(next.values, Array.from(old.values, (value, i) => value * (Math.floor(i / size) % 3 === 1 ? 1 : .5)));
    }
    phases.forEach((phase, i) => ['Leaf', 'Root'].forEach((name, j) => {
      const pose = sample(root, updated, name, phase * 8); close(pose.position, original[i][j].position); close(pose.quaternion, original[i][j].quaternion);
    }));
    assert.deepEqual(capture(root, clips).clips, before, 'Source/shared input accessors must remain exact');
    assert.deepEqual(capture(root, session.clips).clips[3], before[3]);
  });

  await test('Linear, STEP, and morph duration changes preserve normalized-phase interpolation', (root, session, clips) => {
    for (const index of [0, 1, 4]) {
      const before = clips[index].tracks.map(item => interpolate(item, 1.3));
      session.setClipDuration(index, 10);
      session.clips[index].tracks.forEach((item: THREE.KeyframeTrack, i: number) => close(interpolate(item, 3.25), before[i]));
    }
    assert.equal(track(session.clips, 'Step', 'Child').getInterpolation(), THREE.InterpolateDiscrete);
    assert.throws(() => session.setClipDuration(0, 0)); assert.throws(() => session.setClipDuration(0, Infinity));
  }, { morphWeights: true });

  await test('Pose previews do not author rest, compensations, animation values, or history', (root, session, clips) => {
    const original = capture(root, clips);
    const vertices = worldVertices(root);
    session.enterPose(); session.previewPoseRotation(bone(root, 'Root').uuid, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), .5).toArray());
    assert.notDeepEqual(worldVertices(root), vertices);
    assert.equal(session.hasEdits, false); assert.equal(session.revision, 0);
    session.restoreRest(); assert.deepEqual(capture(root, session.clips), original);
  });

  await test('Unrepresentable duration changes preserve clips and history atomically', (root, session) => {
    const before=capture(root,session.clips);
    for(const seconds of [0,-1,NaN,Infinity,1e300,1e-300]) assert.throws(()=>session.setClipDuration(2,seconds));
    assert.deepEqual(capture(root,session.clips),before); assert.equal(session.revision,0);
  });

  await test('Hold rejects ordinary attachments before authoring non-joint changes', (root,session) => {
    const attachment=new THREE.Group(); attachment.position.x=1; bone(root,'Root').add(attachment);
    session.enterEdit(); const before=capture(root,session.clips);
    assert.throws(()=>session.commitJoint(bone(root,'Root').uuid,{quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.4).toArray()},'hold'));
    assert.deepEqual(capture(root,session.clips),before); assert.equal(session.revision,0);
  });

  await test('Terminal guides preserve arbitrary extras and reject namespace collisions', (root,session) => {
    const definition=getSourceDocument(root)!.nodes[getSourceAssociation(bone(root,'Leaf'))!.nodes!];
    session.enterEdit();
    for(const extras of [null,42,'author',[1,2],{assetDoctorRigTip:{author:'owned'}}]) {
      definition.extras=extras;
      assert.throws(()=>session.setTerminalTip(bone(root,'Leaf').uuid,[0,2,0]));
      assert.deepEqual(definition.extras,extras); assert.equal(session.revision,0);
    }
  });

  await test('Undo redo and reset exactly restore authored rest, compensated skin, and all sampler bytes', (root, session, clips) => {
    const baseline = capture(root, clips);
    session.enterEdit(); session.commitJoint(bone(root, 'Root').uuid, { position: [1.4, 2.2, 0] });
    const first = capture(root, session.clips);
    session.setClipDuration(2, 7); const second = capture(root, session.clips);
    session.undo(); assert.deepEqual(capture(root, session.clips), first);
    session.undo(); assert.deepEqual(capture(root, session.clips), baseline); assert.equal(session.hasEdits, false);
    session.redo(); assert.deepEqual(capture(root, session.clips), first);
    session.redo(); assert.deepEqual(capture(root, session.clips), second);
    session.restoreRest(); close(bone(root, 'Root').position.toArray(), [1.4, 2.2, 0]);
    session.reset(); assert.deepEqual(capture(root, session.clips), baseline); assert.equal(session.hasEdits, false);
  });
  await test('A multi-frame gizmo gesture authors one history entry and cancellation restores exact state', (root,session) => {
    session.enterEdit();const before=capture(root,session.clips),uuid=bone(root,'Root').uuid;
    session.beginGesture();
    for(const x of [1.1,1.2,1.3,1.4]) session.previewJoint(uuid,{position:[x,2,0]},'follow');
    assert.equal(session.revision,0);assert.equal(session.canUndo,false);
    session.finishGesture();assert.equal(session.revision,1);assert.equal(session.canUndo,true);
    session.undo();assert.deepEqual(capture(root,session.clips),before);
    session.beginGesture();session.previewJoint(uuid,{position:[1.8,2,0]},'follow');session.cancelGesture();
    assert.deepEqual(capture(root,session.clips),before);assert.equal(session.revision,2);
  });
  return results;
}
