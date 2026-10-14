import {openJointDetails,closeJointDetails} from './rig-toolbar-probe';
import { test, expect, type Page } from '@playwright/test';
import { rigFixture } from '../rig-fixtures';
import { rigViewerState } from './rig-runtime-probe';
import { metadataFixture } from './runtime-metadata-fixture';

/** Read the actual viewer, without invoking selection, controls or rig edit APIs. */
async function usabilityState(page: Page, includeRingPoints = false) {
  return page.evaluate(includeRingPoints => {
    const container = document.getElementById('root')!;
    const key = Object.keys(container).find(name => name.startsWith('__reactContainer$'))!;
    const attached = Reflect.get(container, key);
    const fibers = [attached?.stateNode?.current ?? attached];
    while (fibers.length) {
      const fiber = fibers.pop(); if (!fiber) continue;
      if (fiber.child) fibers.push(fiber.child); if (fiber.sibling) fibers.push(fiber.sibling);
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const viewer = hook.memoizedState?.current;
        if (!viewer?.renderer || !viewer.currentAssetRoot) continue;
        const controls = viewer.rigGizmo?.controls;
        const canvas = viewer.renderer.domElement.getBoundingClientRect();
        viewer.currentAssetRoot.updateMatrixWorld(true);
        const project = (point: any): [number, number] => {
          point.project(viewer.camera);
          return [canvas.x + (point.x + 1) * canvas.width / 2, canvas.y + (1 - point.y) * canvas.height / 2];
        };
        const selected = viewer.currentAssetRoot.getObjectByProperty('uuid', viewer.selectedMeshUuid ?? '');
        const worlds: Record<string, number[]> = {};
        const documentWorlds: Record<string, number[]> = {};
        viewer.currentAssetRoot.traverse((node: any) => {
          if (!node.isBone) return;
          const point = node.getWorldPosition(node.position.clone()); worlds[node.name] = point.toArray();
          documentWorlds[node.name] = viewer.presentationWrapper ? viewer.presentationWrapper.worldToLocal(point).toArray() : point.toArray();
        });
        let overlapLength: number | null = null;
        const ringPoints: { axis: string; screen: [number, number] }[] = [];
        if (controls?.object) {
          controls.getHelper().updateMatrixWorld(true);
          controls._gizmo.gizmo[controls.mode].traverse((object: any) => {
            if (!object.isMesh || !object.visible || !['X', 'Y', 'Z'].includes(object.name)) return;
            const geometry = object.geometry;
            if (controls.mode === 'translate' && object.name === 'X' && selected && overlapLength === null) {
              geometry.computeBoundingBox();
              const center = geometry.boundingBox.getCenter(object.position.clone()).applyMatrix4(object.matrixWorld);
              overlapLength = selected.worldToLocal(center).length();
            }
            if (!includeRingPoints || controls.mode !== 'rotate') return;
            const positions = geometry.getAttribute('position');
            const stride = Math.max(1, Math.floor(positions.count / 24));
            for (let i = 0; i < positions.count; i += stride) {
              const point = object.position.clone().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
              const screen = project(point);
              if (screen[0] > canvas.x + 12 && screen[0] < canvas.right - 12 && screen[1] > canvas.y + 12 && screen[1] < canvas.bottom - 12) ringPoints.push({ axis: object.name, screen });
            }
          });
        }
        return {
          names: viewer.rigSession?.clips.map((clip: any) => clip.name) as string[],
          gizmoVisible: !!controls?.object && controls.getHelper().visible && controls.enabled,
          axis: controls?.axis as string | null,
          overlapLength: overlapLength as number | null,
          ringPoints,
          center: selected ? project(selected.getWorldPosition(selected.position.clone())) : null,
          worlds,
          documentWorlds,
          modelRotationY: viewer.modelRotationY as number,
          autoRotating: viewer.isAutoRotating as boolean,
          dragging: !!controls?.dragging,
        };
      }
    }
    throw new Error('Viewer not found');
  }, includeRingPoints);
}

async function openRig(page: Page, buffer: Buffer = Buffer.from(rigFixture().buffer)) {
  await page.goto('/');
  await page.locator('header input[type=file]').setInputFiles({ name: 'rig-usability.glb', mimeType: 'model/gltf-binary', buffer });
  await expect(page.getByRole('button', { name: 'Rescan', exact: true })).toBeEnabled();
  await rigViewerState(page, true);
  await page.getByRole('button', { name: 'Rig', exact: true }).click();
}

async function selectRoot(page: Page) {
  await page.getByTestId('rig-mode-edit').click();
  const state = await rigViewerState(page);
  const root = state.bones.find(bone => bone.name === 'Root')!;
  await page.mouse.click(...root.screen as [number, number]);
  await expect.poll(async () => (await rigViewerState(page)).selected).toBe(root.uuid);
  return root;
}

test('Right-side clip search selects the original clip identity without authoring an edit', async ({ page }) => {
  await openRig(page);
  const search = page.getByLabel('Search animation clips', { exact: true });
  await expect(search).toBeVisible();
  const searchBox = (await search.boundingBox())!, canvasBox = (await page.locator('canvas:visible').first().boundingBox())!;
  expect(searchBox.x).toBeGreaterThanOrEqual(canvasBox.x + canvasBox.width - 2);
  await expect(page.getByTestId('animation-clip-0')).toHaveAttribute('aria-pressed', 'true');
  await search.fill('cUbIc');
  await expect(page.getByTestId('animation-clip-2')).toBeVisible();
  await expect(page.getByTestId('animation-clip-0')).not.toBeVisible();
  await page.getByTestId('animation-clip-2').click();
  await expect(page.getByTestId('animation-clip-2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Animation clip name', { exact: true })).toHaveValue('CubicShared');
  await search.fill('');
  await expect(page.getByTestId('animation-clip-0')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('animation-clip-2')).toHaveAttribute('aria-pressed', 'true');
  expect((await rigViewerState(page)).revision).toBe(0);
});

test('Clip rename is undoable and survives verified GLB download and actual reimport', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openRig(page);
  await page.getByTestId('animation-clip-2').click();
  const name = page.getByLabel('Animation clip name', { exact: true });
  const renamed = 'Cubic Motion — Revised';
  await name.fill(renamed); await page.getByRole('button', { name: 'Rename Clip', exact: true }).click();
  await expect(page.getByTestId('animation-clip-2')).toContainText(renamed);
  expect((await usabilityState(page)).names).toEqual(['LinearShared', 'Step', renamed, 'UnrelatedShared']);
  const editor = page.getByTestId('rig-editor');
  await editor.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(name).toHaveValue('CubicShared');
  await editor.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(name).toHaveValue(renamed);
  await page.getByRole('button', { name: 'Verify Edited GLB', exact: true }).click();
  await expect(page.getByTestId('rig-export-status')).toContainText('VERIFIED', { timeout: 30000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save Edited GLB', exact: true }).click()]);
  const stream = await download.createReadStream(); expect(stream).toBeTruthy();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const output = Buffer.concat(chunks);
  const document = JSON.parse(output.subarray(20, 20 + output.readUInt32LE(12)).toString().trim());
  expect(document.animations.map((clip: any) => clip.name)).toEqual(['LinearShared', 'Step', renamed, 'UnrelatedShared']);
  await test.info().attach('renamed-clip.glb', { body: output, contentType: 'model/gltf-binary' });
  await page.locator('header input[type=file]').setInputFiles({ name: 'rig-renamed-reopened.glb', mimeType: 'model/gltf-binary', buffer: output });
  const discard = page.getByRole('button', { name: 'Discard and open', exact: true });
  await expect.poll(async () => await discard.isVisible() || await page.getByText('rig-renamed-reopened.glb', { exact: true }).first().isVisible()).toBe(true);
  if (await discard.isVisible()) await discard.click();
  await expect(page.getByText('rig-renamed-reopened.glb', { exact: true }).first()).toBeVisible();
  await page.getByTestId('animation-clip-2').click();
  await expect(page.getByLabel('Animation clip name', { exact: true })).toHaveValue(renamed);
  expect((await usabilityState(page)).names).toEqual(['LinearShared', 'Step', renamed, 'UnrelatedShared']);
  expect(errors).toEqual([]);
});

test('Ctrl+Z respects text input focus and performs rig Undo after focus leaves the input', async ({ page }) => {
  await openRig(page); const root = await selectRoot(page);
  await openJointDetails(page); await page.getByLabel('Joint position X', { exact: true }).fill('1.4');
  await page.getByRole('button', { name: 'Apply Position', exact: true }).click(); await closeJointDetails(page);
  const before = await rigViewerState(page); expect(before.revision).toBe(1);
  const name = page.getByLabel('Animation clip name', { exact: true });
  await name.click(); await name.press('Control+a'); await name.pressSequentially('Draft typing'); await name.press('Control+z');
  expect((await rigViewerState(page)).revision).toBe(before.revision);
  expect((await rigViewerState(page)).bones.find(bone => bone.uuid === root.uuid)!.position).toEqual([1.4, 2, 0]);
  const canvasDiagnostics = await page.evaluate(() => Array.from(document.querySelectorAll('canvas'), (canvas, index) => {
    const describe = (element: Element) => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { tag: element.tagName, class: element.className, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, display: style.display, visibility: style.visibility, overflow: style.overflow };
    };
    const parents = []; let parent = canvas.parentElement;
    for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) parents.push(describe(parent));
    return { index, ...describe(canvas), parents };
  }));
  await test.info().attach('canvases-after-native-input-undo.json', { body: JSON.stringify(canvasDiagnostics, null, 2), contentType: 'application/json' });
  // Leave the text field by ordinary keyboard navigation; no canvas index or
  // forced click should determine whether the global shortcut receives focus.
  await name.press('Shift+Tab');
  for (let attempt = 0; attempt < 8 && await page.evaluate(() => document.activeElement?.tagName !== 'BUTTON' || (document.activeElement as HTMLButtonElement).disabled); attempt++) await page.keyboard.press('Shift+Tab');
  await expect(page.locator('button:focus')).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await rigViewerState(page)).bones.find(bone => bone.uuid === root.uuid)!.position).toEqual(root.position);
  await expect(page.getByTestId('rig-editor').getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
});

test('Ctrl+Z undoes the most recent authored domain across interleaved Repair and Rig histories', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await openRig(page, metadataFixture());
  const original = (await rigViewerState(page)).bones[0];
  const repair = async () => {
    await page.getByRole('button', { name: 'Health', exact: true }).click();
    await page.getByRole('button', { name: 'Run safe queue', exact: true }).click();
    await expect(page.locator('header')).toContainText('2 tri');
    await expect(page.getByRole('button', { name: 'Run safe queue', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rescan', exact: true })).toBeEnabled();
    const repairOnlyExport = page.getByRole('button', { name: 'Build & Verify', exact: true });
    if ((await rigViewerState(page)).hasEdits) await expect(repairOnlyExport).toBeDisabled();
    else await expect(repairOnlyExport).toBeEnabled();
  };
  const edit = async (x: number) => {
    await page.getByRole('button', { name: 'Rig', exact: true }).click();
    await page.getByTestId('rig-mode-edit').click();
    const joint = (await rigViewerState(page)).bones.find(bone => bone.uuid === original.uuid)!;
    await page.mouse.click(...joint.screen as [number, number]);
    await expect.poll(async () => (await rigViewerState(page)).selected).toBe(original.uuid);
    await openJointDetails(page); await page.getByLabel('Joint position X', { exact: true }).fill(String(x));
    await page.getByRole('button', { name: 'Apply Position', exact: true }).click(); await closeJointDetails(page);
    await expect.poll(async () => (await rigViewerState(page)).bones.find(bone => bone.uuid === original.uuid)!.position[0]).toBe(x);
  };
  const undoShortcut = async () => {
    await page.locator('header').click({ position: { x: 8, y: 8 } });
    await page.keyboard.press('Control+z');
  };
  await repair(); await edit(original.position[0] + .2);
  await undoShortcut();
  await expect.poll(async () => (await rigViewerState(page)).bones.find(bone => bone.uuid === original.uuid)!.position).toEqual(original.position);
  await expect(page.locator('header')).toContainText('2 tri');
  await undoShortcut(); await expect(page.locator('header')).toContainText('3 tri');
  await edit(original.position[0] + .4); await repair();
  await undoShortcut(); await expect(page.locator('header')).toContainText('3 tri');
  expect((await rigViewerState(page)).bones.find(bone => bone.uuid === original.uuid)!.position[0]).toBe(original.position[0] + .4);
  await undoShortcut();
  await expect.poll(async () => (await rigViewerState(page)).bones.find(bone => bone.uuid === original.uuid)!.position).toEqual(original.position);
});

test('Select tool hides the gizmo and picks a joint at a point previously occupied by its Move handle', async ({ page }) => {
  await openRig(page); await selectRoot(page);
  await page.getByLabel('Rig coordinates', { exact: true }).selectOption('local');
  await page.getByTestId('rig-tool-translate').click();
  const side = (await rigViewerState(page)).bones.find(bone => bone.name === 'Side')!;
  await openJointDetails(page); await page.getByLabel('End child joint', { exact: true }).selectOption(side.uuid);
  await expect.poll(async () => (await usabilityState(page)).overlapLength).not.toBeNull();
  const length = (await usabilityState(page)).overlapLength!;
  expect(length).toBeGreaterThan(0);
  // Position the real child at the rendered X handle, through the public editor.
  await openJointDetails(page); await page.getByLabel('Bone length', { exact: true }).fill(String(length));
  await page.getByRole('button', { name: 'Apply Length', exact: true }).click(); await closeJointDetails(page);
  const before = await rigViewerState(page); const target = before.bones.find(bone => bone.uuid === side.uuid)!;
  await page.mouse.move(...target.screen as [number, number]);
  await expect.poll(async () => (await usabilityState(page)).axis).toBe('X');
  await page.getByTestId('rig-tool-select').click();
  await expect.poll(async () => (await usabilityState(page)).gizmoVisible).toBe(false);
  await page.mouse.click(...target.screen as [number, number]);
  await expect.poll(async () => (await rigViewerState(page)).selected).toBe(side.uuid);
  const after = await rigViewerState(page);
  expect(after.revision).toBe(before.revision);
  expect(after.bones.map(bone => [bone.uuid, bone.position, bone.quaternion])).toEqual(before.bones.map(bone => [bone.uuid, bone.position, bone.quaternion]));
});

test('A real local Twist drag rotates around the selected child direction and has one Undo step', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openRig(page); const root = await selectRoot(page);
  const side = (await rigViewerState(page)).bones.find(bone => bone.name === 'Side')!;
  // Side lies on local X, so a hard-coded Y twist cannot pass this regression.
  await openJointDetails(page); await page.getByLabel('End child joint', { exact: true }).selectOption(side.uuid);
  await page.getByLabel('Rig coordinates', { exact: true }).selectOption('local');
  await page.getByTestId('rig-tool-twist').click();
  await closeJointDetails(page);
  await expect.poll(async () => (await usabilityState(page, true)).ringPoints.length).toBeGreaterThan(0);
  const probe = await usabilityState(page, true);
  let start: [number, number] | undefined;
  for (const candidate of probe.ringPoints) {
    await page.mouse.move(...candidate.screen);
    if ((await usabilityState(page)).axis === candidate.axis) { start = candidate.screen; break; }
  }
  expect(start, 'A rendered longitudinal rotation ring must receive an actual mouse hover').toBeTruthy();
  const before = await rigViewerState(page); const beforeWorld = (await usabilityState(page)).worlds.Side;
  const [cx, cy] = probe.center!; const dx = start![0] - cx, dy = start![1] - cy;
  const angle = .4;
  const end: [number, number] = [cx + dx * Math.cos(angle) - dy * Math.sin(angle), cy + dx * Math.sin(angle) + dy * Math.cos(angle)];
  await page.mouse.move(...start!); await page.mouse.down(); await page.mouse.move(...end, { steps: 12 }); await page.mouse.up();
  await expect.poll(async () => (await rigViewerState(page)).revision).toBe(before.revision! + 1);
  const edited = (await rigViewerState(page)).bones.find(bone => bone.uuid === root.uuid)!;
  const [qx, qy, qz] = edited.quaternion; const magnitude = Math.hypot(qx, qy, qz);
  expect(magnitude).toBeGreaterThan(.01);
  expect(Math.abs(qx) / magnitude).toBeGreaterThan(.999);
  expect(Math.abs(qy)).toBeLessThan(.001); expect(Math.abs(qz)).toBeLessThan(.001);
  const afterWorld = (await usabilityState(page)).worlds.Side;
  afterWorld.forEach((value, i) => expect(value).toBeCloseTo(beforeWorld[i], 4));
  expect((await rigViewerState(page)).bones.find(bone => bone.uuid === side.uuid)!.position).toEqual(side.position);
  await page.getByTestId('rig-editor').getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await rigViewerState(page)).bones.find(bone => bone.uuid === root.uuid)!.quaternion).toEqual(root.quaternion);
  expect(errors).toEqual([]);
});

test('Turntable pauses throughout an actual Twist gesture without adding presentation rotation to authored rest', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openRig(page); const root = await selectRoot(page);
  const side = (await rigViewerState(page)).bones.find(bone => bone.name === 'Side')!;
  await openJointDetails(page); await page.getByLabel('End child joint', { exact: true }).selectOption(side.uuid);
  await page.getByLabel('Rig coordinates', { exact: true }).selectOption('local');
  await page.getByTestId('rig-tool-twist').click();
  await closeJointDetails(page);
  const before = await rigViewerState(page); const angleBefore = (await usabilityState(page)).modelRotationY;
  await page.getByTitle('Start turntable auto-rotation', { exact: true }).click();
  await expect.poll(async () => (await usabilityState(page)).modelRotationY).not.toBe(angleBefore);
  let start: [number, number] | undefined;
  for (let attempt = 0; attempt < 32; attempt++) {
    // Refresh the geometry projection while turntable motion is still active.
    const probe = await usabilityState(page, true);
    const candidate = probe.ringPoints[attempt % probe.ringPoints.length];
    if (!candidate) continue;
    await page.mouse.move(...candidate.screen);
    if ((await usabilityState(page)).axis === candidate.axis) { start = candidate.screen; break; }
  }
  expect(start, 'A moving rendered Twist ring must receive actual mouse hover').toBeTruthy();
  await page.mouse.down();
  const pressed = await usabilityState(page);
  expect(pressed.dragging).toBe(true); expect(pressed.autoRotating).toBe(true);
  await page.waitForTimeout(150);
  const held = await usabilityState(page);
  expect(held.dragging).toBe(true); expect(held.autoRotating).toBe(true);
  expect(held.modelRotationY).toBe(pressed.modelRotationY);
  expect(held.documentWorlds.Side).toEqual(pressed.documentWorlds.Side);
  const [cx, cy] = pressed.center!; const dx = start![0] - cx, dy = start![1] - cy;
  const angle = .4;
  await page.mouse.move(cx + dx * Math.cos(angle) - dy * Math.sin(angle), cy + dx * Math.sin(angle) + dy * Math.cos(angle), { steps: 12 });
  await page.mouse.up();
  await page.getByTitle('Pause turntable auto-rotation', { exact: true }).click();
  await expect.poll(async () => (await usabilityState(page)).autoRotating).toBe(false);
  await expect.poll(async () => (await rigViewerState(page)).revision).toBe(before.revision! + 1);
  const edited = (await rigViewerState(page)).bones.find(bone => bone.uuid === root.uuid)!;
  const [qx, qy, qz] = edited.quaternion; const magnitude = Math.hypot(qx, qy, qz);
  expect(magnitude).toBeGreaterThan(.01); expect(Math.abs(qx) / magnitude).toBeGreaterThan(.999);
  expect(Math.abs(qy)).toBeLessThan(.001); expect(Math.abs(qz)).toBeLessThan(.001);
  const after = await usabilityState(page);
  after.documentWorlds.Side.forEach((value, i) => expect(value).toBeCloseTo(pressed.documentWorlds.Side[i], 4));
  await page.getByTestId('rig-editor').getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await rigViewerState(page)).bones.map(bone => [bone.uuid, bone.position, bone.quaternion])).toEqual(before.bones.map(bone => [bone.uuid, bone.position, bone.quaternion]));
  expect(errors).toEqual([]);
});

test('Ctrl+Z does not undo the hidden Doctor asset while Compare is open',async({page})=>{
  await openRig(page);const root=await selectRoot(page);
  await openJointDetails(page); await page.getByLabel('Joint position X',{exact:true}).fill('1.4');await page.getByRole('button',{name:'Apply Position',exact:true}).click(); await closeJointDetails(page);
  const before=await rigViewerState(page);await page.getByRole('button',{name:'Compare',exact:true}).click();
  await expect(page.locator('[data-active-view="compare"]')).toBeVisible();await page.keyboard.press('Control+z');
  expect((await rigViewerState(page)).revision).toBe(before.revision);expect((await rigViewerState(page)).bones.find(bone=>bone.uuid===root.uuid)!.position).toEqual([1.4,2,0]);
  await page.getByTitle('Return to Asset Doctor',{exact:true}).click();await expect(page.locator('[data-active-view="doctor"]')).toBeVisible();
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await rigViewerState(page)).bones.find(bone=>bone.uuid===root.uuid)!.position).toEqual(root.position);
});

test('Version 2.0.2 is visible and model rotation controls occupy the top of the viewport above playback', async ({ page }) => {
  await openRig(page);
  await expect(page.getByText(/\b2\.0\.2\b/).first()).toBeVisible();
  const rotation = page.getByTestId('model-rotation-controls'); await expect(rotation).toBeVisible();
  const controls = (await rotation.boundingBox())!, viewport = (await page.locator('canvas:visible').first().boundingBox())!;
  const play = (await page.getByTitle('Play', { exact: true }).boundingBox())!;
  expect(controls.y).toBeGreaterThanOrEqual(viewport.y - 2);
  expect(controls.y).toBeLessThan(viewport.y + viewport.height * .35);
  expect(controls.x).toBeGreaterThanOrEqual(viewport.x - 2);
  expect(controls.x + controls.width).toBeLessThanOrEqual(viewport.x + viewport.width + 2);
  expect(controls.y + controls.height + 48).toBeLessThan(play.y);
});
