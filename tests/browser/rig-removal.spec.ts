import { test, expect, type Page } from '@playwright/test';
import { rigFixture } from '../rig-fixtures';
import { rigViewerState } from './rig-runtime-probe';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Read actual authored graph, geometry and clips; never invoke an edit API. */
async function removalState(page: Page) {
  return page.evaluate(() => {
    const container = document.getElementById('root')!;
    const key = Object.keys(container).find(name => name.startsWith('__reactContainer$'))!;
    const attached = Reflect.get(container, key), fibers = [attached?.stateNode?.current ?? attached];
    while (fibers.length) {
      const fiber = fibers.pop(); if (!fiber) continue;
      if (fiber.child) fibers.push(fiber.child); if (fiber.sibling) fibers.push(fiber.sibling);
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const viewer = hook.memoizedState?.current;
        if (!viewer?.renderer || !viewer.currentAssetRoot) continue;
        viewer.currentAssetRoot.updateMatrixWorld(true);
        const graph: any[] = [], meshes: any[] = [];
        viewer.currentAssetRoot.traverse((node: any) => {
          graph.push({ uuid: node.uuid, name: node.name, type: node.type, bone: !!node.isBone, parent: node.parent?.uuid, children: node.children.map((child: any) => child.uuid), position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray() });
          if (!node.isMesh) return;
          if (node.isSkinnedMesh) node.skeleton.update();
          const positions = node.geometry.getAttribute('position'), vertices: number[] = [];
          for (let i = 0; i < positions.count; i++) vertices.push(...node.getVertexPosition(i, node.position.clone()).applyMatrix4(node.matrixWorld).toArray());
          meshes.push({ uuid: node.uuid, skinned: !!node.isSkinnedMesh, geometry: node.geometry.uuid, count: positions.count, vertices, joints: node.geometry.getAttribute('skinIndex') ? Array.from(node.geometry.getAttribute('skinIndex').array) : null, weights: node.geometry.getAttribute('skinWeight') ? Array.from(node.geometry.getAttribute('skinWeight').array) : null, bones: node.isSkinnedMesh ? node.skeleton.bones.map((bone: any) => bone.uuid) : null, inverses: node.isSkinnedMesh ? node.skeleton.boneInverses.map((matrix: any) => matrix.toArray()) : null, morphs: node.morphTargetInfluences?.slice() });
        });
        const clips: { name: string; duration: number; tracks: { name: string; times: number[]; values: number[] }[] }[] = viewer.rigSession.clips.map((clip: any) => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.map((track: any) => ({ name: track.name, times: Array.from(track.times), values: Array.from(track.values) })) }));
        return { graph, meshes, clips, revision: viewer.rigSession.revision, hasEdits: viewer.rigSession.hasEdits, canUndo: viewer.rigSession.canUndo, camera: [...viewer.camera.position.toArray(), ...viewer.camera.quaternion.toArray()] };
      }
    }
    throw new Error('Viewer not found');
  });
}
function authored(state: Awaited<ReturnType<typeof removalState>>) { return { graph: state.graph, meshes: state.meshes, clips: state.clips, hasEdits: state.hasEdits }; }
function sameVertices(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length); actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 5));
}
async function open(page: Page, morphWeights = false) {
  await page.goto('/');
  await page.locator('header input[type=file]').setInputFiles({ name: 'removal-ui.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(rigFixture({ morphWeights }).buffer) });
  await expect(page.getByText('removal-ui.glb', {exact:true})).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rescan', exact: true })).toBeEnabled();
  await rigViewerState(page, true); await page.getByRole('button', { name: 'Rig', exact: true }).click();
  await page.getByTestId('rig-mode-edit').click(); await page.getByTestId('rig-tool-select').click();
}
async function pick(page: Page, name: string, right = false) {
  const bone = (await rigViewerState(page)).bones.find(bone => bone.name === name)!; expect(bone).toBeTruthy();
  const canvasHit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', bone.screen as [number, number]);
  if (canvasHit) await page.mouse.click(...bone.screen as [number, number], { button: right ? 'right' : 'left' });
  else {
    expect(right, 'Context-menu regression requires an exposed real viewport joint').toBe(false);
    const hierarchy = page.locator('main > aside').first();
    await hierarchy.getByPlaceholder('Search hierarchy...').fill(name); await hierarchy.getByTitle(name, { exact: true }).click(); await hierarchy.getByPlaceholder('Search hierarchy...').fill('');
  }
  await expect.poll(async () => (await rigViewerState(page)).selected).toBe(bone.uuid); return bone;
}
async function counts(page: Page, joints: number, vertices: number, tracks: number, staticMeshes: number) {
  const dialog = page.getByTestId('rig-removal-dialog'); await expect(dialog).toBeVisible(); await expect(dialog).toHaveAttribute('role', 'dialog');
  for (const [name, value] of [['joints', joints], ['vertices', vertices], ['tracks', tracks], ['static', staticMeshes]] as const) await expect(page.getByTestId(`rig-removal-${name}`)).toContainText(new RegExp(`\\b${value}\\b`));
  await expect(page.getByTestId('rig-removal-confirm')).toBeEnabled(); await expect(page.getByTestId('rig-removal-cancel')).toBeEnabled();
}

/** Inject a real concurrent edit/buffer change, not a fabricated dialog result. */
async function changeDuringPreview(page: Page, action: 'rename' | 'invalid-weight') {
  await page.evaluate(action => {
    const container = document.getElementById('root')!, key = Object.keys(container).find(name => name.startsWith('__reactContainer$'))!;
    const attached = Reflect.get(container, key), fibers = [attached?.stateNode?.current ?? attached];
    while (fibers.length) {
      const fiber = fibers.pop(); if (!fiber) continue;
      if (fiber.child) fibers.push(fiber.child); if (fiber.sibling) fibers.push(fiber.sibling);
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const viewer = hook.memoizedState?.current; if (!viewer?.renderer || !viewer.currentAssetRoot) continue;
        if (action === 'rename') viewer.rigSession.renameClip(0, 'Concurrent authored edit');
        else viewer.currentAssetRoot.traverse((node: any) => { if (node.isSkinnedMesh) node.geometry.getAttribute('skinWeight').setX(0, NaN); });
        return;
      }
    }
    throw new Error('Viewer not found');
  }, action);
}

test('Weighted animated leaf deletion previews counts, Cancel preserves authored data, and Confirm has one exact Undo', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); const leaf = await pick(page, 'Leaf'), before = await removalState(page);
  const action = page.getByRole('button', { name: 'Delete Joint', exact: true }); await expect(action).toBeEnabled(); await action.click();
  await counts(page, 1, 1, 1, 0); await expect(page.getByTestId('rig-removal-dialog')).toContainText(/weight|influenc|animat/i);
  await test.info().attach('weighted-leaf-warning.png', { body: await page.screenshot(), contentType: 'image/png' });
  expect(authored(await removalState(page))).toEqual(authored(before)); expect((await removalState(page)).revision).toBe(before.revision);
  await page.getByTestId('rig-removal-cancel').click(); await expect(page.getByTestId('rig-removal-dialog')).not.toBeVisible();
  expect(authored(await removalState(page))).toEqual(authored(before)); expect((await rigViewerState(page)).selected).toBe(leaf.uuid);
  await action.click(); await page.getByTestId('rig-removal-confirm').click(); await expect(page.getByTestId('rig-removal-dialog')).not.toBeVisible();
  await expect.poll(async () => (await rigViewerState(page)).bones.length).toBe(3);
  const removed = await removalState(page); expect(removed.revision).toBe(before.revision + 1); expect(removed.graph.some(node => node.uuid === leaf.uuid)).toBe(false);
  sameVertices(removed.meshes[0].vertices, before.meshes[0].vertices); expect(removed.clips.flatMap(clip => clip.tracks).some(track => track.name.startsWith('Leaf.'))).toBe(false);
  await page.keyboard.press('Control+z'); await expect.poll(async () => (await rigViewerState(page)).bones.length).toBe(4);
  expect(authored(await removalState(page))).toEqual(authored(before)); expect(errors).toEqual([]);
});

test('Animated child chain confirmation removes the chain and empty animation clip while preserving surviving clips and Undo', async ({ page }) => {
  await open(page); await pick(page, 'Child'); const before = await removalState(page);
  await page.getByTestId('rig-delete-chain').click(); await counts(page, 2, 3, 2, 0);
  await page.getByTestId('rig-removal-confirm').click(); await expect.poll(async () => (await rigViewerState(page)).bones.length).toBe(2);
  const after = await removalState(page); expect(after.graph.filter(node => node.bone).map(node => node.name).sort()).toEqual(['Root', 'Side']);
  expect(after.clips.map(clip => clip.name)).toEqual(['LinearShared', 'CubicShared', 'UnrelatedShared']); sameVertices(after.meshes[0].vertices, before.meshes[0].vertices);
  await page.getByTestId('rig-editor').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await rigViewerState(page)).bones.length).toBe(4); expect(authored(await removalState(page))).toEqual(authored(before));
});

test('Root joint is deletable from its context menu after a transform-anchor warning and remains exactly undoable', async ({ page }) => {
  await open(page); const root = await pick(page, 'Root', true), before = await removalState(page);
  const action = page.getByRole('menuitem', { name: 'Delete joint', exact: true }); await expect(action).toBeEnabled(); await action.click();
  await counts(page, 1, 1, 2, 0); await expect(page.getByTestId('rig-removal-dialog')).toContainText(/coordinate frame|anchor|transform/i);
  await page.getByTestId('rig-removal-confirm').click(); await expect.poll(async () => (await rigViewerState(page)).bones.length).toBe(3);
  const after = await removalState(page), anchor = after.graph.find(node => node.uuid === root.uuid);
  expect(anchor).toBeTruthy(); expect(anchor!.bone).toBe(false); expect(anchor!.name).toBe('Root'); sameVertices(after.meshes[0].vertices, before.meshes[0].vertices);
  await page.keyboard.press('Control+z'); await expect.poll(async () => (await rigViewerState(page)).bones.length).toBe(4); expect(authored(await removalState(page))).toEqual(authored(before));
});

test('Root chain warning previews static conversion and Confirm keeps the same mesh UUID and morph shape with working Undo', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page, true); await pick(page, 'Root'); const before = await removalState(page);
  await page.getByTestId('rig-delete-chain').click(); await counts(page, 4, 4, 4, 1); await expect(page.getByTestId('rig-removal-dialog')).toContainText(/static|bak/i);
  await test.info().attach('root-chain-static-warning.png', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByTestId('rig-removal-cancel').click(); expect(authored(await removalState(page))).toEqual(authored(before));
  await page.getByTestId('rig-delete-chain').click(); await page.getByTestId('rig-removal-confirm').click();
  await expect.poll(async () => (await rigViewerState(page)).bones.length).toBe(0);
  const after = await removalState(page); expect(after.meshes).toHaveLength(1); expect(after.meshes[0].uuid).toBe(before.meshes[0].uuid); expect(after.meshes[0].skinned).toBe(false);
  expect(after.meshes[0].joints).toBeNull(); expect(after.meshes[0].weights).toBeNull(); expect(after.meshes[0].count).toBe(before.meshes[0].count); expect(after.meshes[0].morphs).toEqual(before.meshes[0].morphs);
  sameVertices(after.meshes[0].vertices, before.meshes[0].vertices); expect(after.clips.map(clip => clip.name)).toEqual(['LinearShared', 'CubicShared', 'UnrelatedShared', 'MorphWeights']);
  await test.info().attach('root-chain-static-mesh.png', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByTestId('rig-editor').getByRole('button', { name: 'Undo', exact: true }).click(); await expect.poll(async () => (await rigViewerState(page)).bones.length).toBe(4);
  expect(authored(await removalState(page))).toEqual(authored(before)); expect(errors).toEqual([]);
});

test('The custom warning initially focuses Cancel and keyboard navigation or Escape never author deletion or undo earlier edits', async ({ page }) => {
  await open(page); await page.getByLabel('Animation clip name', { exact: true }).fill('Before warning');
  await page.getByRole('button', { name: 'Rename Clip', exact: true }).click(); await pick(page, 'Leaf'); const before = await removalState(page);
  const action = page.getByRole('button', { name: 'Delete Joint', exact: true }); await action.click();
  await expect(page.getByTestId('rig-removal-cancel')).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page.getByTestId('rig-removal-dialog')).not.toBeVisible(); expect(authored(await removalState(page))).toEqual(authored(before));
  await action.click(); await expect(page.getByTestId('rig-removal-cancel')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByTestId('rig-removal-confirm')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByTestId('rig-removal-cancel')).toBeFocused();
  await page.keyboard.press('Control+z'); expect((await removalState(page)).revision).toBe(before.revision); expect(authored(await removalState(page))).toEqual(authored(before));
  await page.keyboard.press('Escape'); await expect(page.getByTestId('rig-removal-dialog')).not.toBeVisible(); expect(authored(await removalState(page))).toEqual(authored(before));
});

test('Confirm rejects a stale warning after a real concurrent authored revision without removing joints or losing that edit', async ({ page }) => {
  await open(page); await pick(page, 'Leaf'); await page.getByRole('button', { name: 'Delete Joint', exact: true }).click(); await counts(page, 1, 1, 1, 0);
  await changeDuringPreview(page, 'rename'); const changed = await removalState(page); expect(changed.clips[0].name).toBe('Concurrent authored edit');
  await page.getByTestId('rig-removal-confirm').click(); await expect(page.getByTestId('rig-removal-dialog')).not.toBeVisible();
  await expect(page.getByTestId('rig-toolbar').getByRole('alert')).toContainText(/model changed|new deletion warning/i);
  const after = await removalState(page); expect(authored(after)).toEqual(authored(changed)); expect(after.revision).toBe(changed.revision); expect(after.canUndo).toBe(changed.canUndo);
});

test('Confirm reports a real invalid-influence planning error and leaves graph clips and history atomic', async ({ page }) => {
  await open(page); await pick(page, 'Leaf'); await page.getByRole('button', { name: 'Delete Joint', exact: true }).click();
  await changeDuringPreview(page, 'invalid-weight'); const invalid = await removalState(page);
  await page.getByTestId('rig-removal-confirm').click(); await expect(page.getByTestId('rig-removal-dialog')).not.toBeVisible();
  await expect(page.getByTestId('rig-toolbar').getByRole('alert')).toContainText(/weight|influenc|invalid|finite/i);
  const after = await removalState(page); expect(authored(after)).toEqual(authored(invalid)); expect(after.revision).toBe(invalid.revision); expect(after.canUndo).toBe(invalid.canUndo);
});

test('An actual invalid live skin stream cannot publish VERIFIED export or Save after confirmed removal', async ({ page }) => {
  await open(page); await pick(page, 'Leaf'); await page.getByRole('button', { name: 'Delete Joint', exact: true }).click();
  await page.getByTestId('rig-removal-confirm').click(); await expect.poll(async () => (await rigViewerState(page)).bones.length).toBe(3);
  await changeDuringPreview(page, 'invalid-weight'); const invalid = await removalState(page);
  await page.getByRole('button', { name: 'Verify Edited GLB', exact: true }).click();
  await expect(page.getByTestId('rig-toolbar').getByRole('alert')).toContainText(/finite|weight|deformation|sample|verif|invalid/i, { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled();
  await expect(page.getByTestId('rig-export-status').filter({ hasText: 'VERIFIED' })).toHaveCount(0);
  const after = await removalState(page); expect(authored(after)).toEqual(authored(invalid)); expect(after.revision).toBe(invalid.revision);
});

test('Textured Khronos Fox Tail branch removal preserves embedded image hashes, material descriptors and surviving animation through verified reimport', async ({ page }) => {
  test.setTimeout(90000);
  const source = readFileSync('tests/browser/fixtures/Fox.glb');
  const documentOf = (buffer: Buffer) => JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString().trim());
  const imageHashes = (buffer: Buffer) => {
    const document = documentOf(buffer), start = 28 + buffer.readUInt32LE(12);
    return document.images.map((image: any) => {
      expect(typeof image.bufferView).toBe('number'); const view = document.bufferViews[image.bufferView];
      return createHash('sha256').update(buffer.subarray(start + (view.byteOffset ?? 0), start + (view.byteOffset ?? 0) + view.byteLength)).digest('hex');
    });
  };
  const originalDocument = documentOf(source), sourceHashes = imageHashes(source);
  expect(originalDocument.materials.length).toBeGreaterThan(0); expect(originalDocument.textures.length).toBeGreaterThan(0); expect(sourceHashes.length).toBeGreaterThan(0);
  const tailNames = ['b_Tail01_012', 'b_Tail02_013', 'b_Tail03_014'];
  const tailIndices = new Set(originalDocument.nodes.map((node: any, index: number) => tailNames.includes(node.name) ? index : -1).filter((index: number) => index >= 0));
  expect(tailIndices.size).toBe(3);
  const removedTracks = originalDocument.animations.reduce((sum: number, clip: any) => sum + clip.channels.filter((channel: any) => tailIndices.has(channel.target.node)).length, 0);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.locator('header input[type=file]').setInputFiles({ name: 'Fox-tail.glb', mimeType: 'model/gltf-binary', buffer: source });
  await expect(page.getByText('Fox-tail.glb', {exact:true})).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rescan', exact: true })).toBeEnabled(); await rigViewerState(page, true);
  await page.getByRole('button', { name: 'Rig', exact: true }).click(); await page.getByTestId('rig-mode-edit').click(); await page.getByTestId('rig-tool-select').click();
  const hierarchy = page.locator('main > aside').first(); await hierarchy.getByPlaceholder('Search hierarchy...').fill(tailNames[0]); await hierarchy.getByTitle(tailNames[0], { exact: true }).click(); await hierarchy.getByPlaceholder('Search hierarchy...').fill('');
  const before = await removalState(page), originalBones = (await rigViewerState(page)).bones;
  await page.getByTestId('rig-delete-chain').click(); await expect(page.getByTestId('rig-removal-joints')).toHaveText('3'); await expect(page.getByTestId('rig-removal-tracks')).toHaveText(String(removedTracks));
  await expect(page.getByTestId('rig-removal-dialog')).toContainText(/Weights transfer|Shape and motion can change/i);
  await page.getByTestId('rig-removal-confirm').click(); await expect.poll(async () => (await rigViewerState(page)).bones.length).toBe(originalBones.length - 3);
  const after = await removalState(page); expect(after.meshes[0].count).toBe(before.meshes[0].count); expect(after.clips.map(clip => clip.name)).toEqual(before.clips.map(clip => clip.name));
  expect(after.clips.map(clip => clip.duration)).toEqual(before.clips.map(clip => clip.duration));
  expect((await rigViewerState(page)).bones.some(bone => tailNames.includes(bone.name))).toBe(false);
  await page.getByTestId('rig-editor').getByRole('button', { name: 'Undo', exact: true }).click(); expect(authored(await removalState(page))).toEqual(authored(before));
  await page.getByTestId('rig-editor').getByRole('button', { name: 'Redo', exact: true }).click(); expect(authored(await removalState(page))).toEqual(authored(after));
  await page.getByRole('button', { name: 'Verify Edited GLB', exact: true }).click(); await expect(page.getByTestId('rig-export-status')).toContainText('VERIFIED', { timeout: 45000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save Changes', exact: true }).click()]);
  const chunks: Buffer[] = []; for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk)); const output = Buffer.concat(chunks), exported = documentOf(output);
  expect(exported.materials).toEqual(originalDocument.materials); expect(exported.textures).toEqual(originalDocument.textures); expect(exported.images.length).toBe(originalDocument.images.length); expect(imageHashes(output)).toEqual(sourceHashes);
  expect(exported.animations.map((clip: any) => clip.name)).toEqual(before.clips.map(clip => clip.name));
  expect(readFileSync('tests/browser/fixtures/Fox.glb')).toEqual(source);
  await test.info().attach('Fox-tail-removed.glb', { body: output, contentType: 'model/gltf-binary' });
  await page.locator('header input[type=file]').setInputFiles({ name: 'Fox-tail-reopened.glb', mimeType: 'model/gltf-binary', buffer: output });
  const discard = page.getByRole('button', { name: 'Discard and open', exact: true });
  await expect.poll(async () => await discard.isVisible() || await page.getByText('Fox-tail-reopened.glb', { exact: true }).first().isVisible()).toBe(true); if (await discard.isVisible()) await discard.click();
  await expect(page.getByText('Fox-tail-reopened.glb', { exact: true }).first()).toBeVisible();
  const reopened = await rigViewerState(page, true); expect(reopened.bones.some(bone => tailNames.includes(bone.name))).toBe(false); expect(reopened.bones.length).toBe(originalBones.length - 3); expect(reopened.durations).toEqual(before.clips.map(clip => clip.duration));
  await test.info().attach('Fox-tail-reimport.png', { body: await page.screenshot(), contentType: 'image/png' }); expect(errors).toEqual([]);
});

for (const width of [1440, 1920]) test(`Intrinsic rig toolbar leaves the right viewport ${width}px directly draggable without invisible overlay interception`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await open(page); await pick(page, 'Root');
  const toolbar = page.getByTestId('rig-toolbar'), box = (await toolbar.boundingBox())!, canvas = page.locator('canvas:visible').first(), viewport = (await canvas.boundingBox())!;
  const rightGap = viewport.x + viewport.width - (box.x + box.width); expect(rightGap).toBeGreaterThan(32);
  const point: [number, number] = [viewport.x + viewport.width - 14, box.y + Math.min(35, box.height / 2)];
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, point)).toBe('CANVAS');
  const before = await removalState(page);
  await page.mouse.move(...point); await page.mouse.down(); await page.mouse.move(point[0] - 35, point[1] + 35, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await removalState(page)).camera).not.toEqual(before.camera);
  expect((await removalState(page)).revision).toBe(before.revision); expect(authored(await removalState(page))).toEqual(authored(before));
});
