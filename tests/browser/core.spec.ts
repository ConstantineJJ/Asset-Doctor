import { test, expect } from '@playwright/test';

function triangleFile(name: string) {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = {
    asset: { version: '2.0' }, scene: 0,
    scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: name.replace('.gltf', '') }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${Buffer.from(positions.buffer).toString('base64')}` }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
  };
  return { name, mimeType: 'model/gltf+json', buffer: Buffer.from(JSON.stringify(json)) };
}

test('verification and unconfirmed browser downloads both protect the repair session', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/');
  await page.locator('#btn-sample-models').click();
  await page.getByRole('menuitem', { name: /Asset Doctor Test Patient/ }).click();
  await expect(page.getByRole('button', { name: 'Rescan', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Run safe queue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Build & Verify', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Build & Verify', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download GLB', exact: true })).toBeVisible();
  await page.locator('#btn-sample-models').click();
  await page.getByRole('menuitem', { name: /Asset Doctor Test Patient/ }).click();
  await expect(page.getByText('Discard and open', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download GLB', exact: true }).click();
  expect((await download).suggestedFilename()).toContain('_repaired.glb');
  await page.locator('#btn-sample-models').click();
  await page.getByRole('menuitem', { name: /Asset Doctor Test Patient/ }).click();
  await expect(page.getByText('Discard and open', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a pending file import cannot replace a more recently selected sample', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const arrayBuffer = File.prototype.arrayBuffer;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    Object.assign(window, { releaseImport: release, pendingImport: false });
    File.prototype.arrayBuffer = async function () {
      if (this.name === 'slow.gltf') {
        Object.assign(window, { pendingImport: true });
        await barrier;
      }
      return arrayBuffer.call(this);
    };
  });
  await page.goto('/');
  await page.evaluate(() => {
    Object.assign(window, { stalePublished: false });
    new MutationObserver(() => {
      if (document.body.textContent?.includes('slow.gltf')) Object.assign(window, { stalePublished: true });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.locator('header input[type=file]').setInputFiles(triangleFile('slow.gltf'));
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'pendingImport'))).toBe(true);
  await page.locator('#btn-sample-models').click();
  await page.getByRole('menuitem', { name: /Asset Doctor Test Patient/ }).click();
  await expect(page.getByRole('button', { name: 'Rescan', exact: true })).toBeEnabled();
  await page.evaluate(() => Reflect.get(window, 'releaseImport')());
  // A second file is a deterministic drain barrier for the serialized loader.
  await page.locator('header input[type=file]').setInputFiles(triangleFile('newest.gltf'));
  await expect(page.getByText('newest.gltf', { exact: true })).toBeVisible();
  await expect(page.getByText('slow.gltf', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, 'stalePublished'))).toBe(false);
  expect(errors).toEqual([]);
});

test('Compare imports eight models and keeps its session across Doctor handoff', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await page.locator('input[type=file][multiple]').setInputFiles(
    Array.from({ length: 8 }, (_, index) => triangleFile(`triangle-${index}.gltf`))
  );
  await expect(page.getByRole('button', { name: 'Добавить 8/8', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'В линейку', exact: true }).click();
  await expect(page.locator('canvas').last()).toBeVisible();
  await page.getByRole('button', { name: 'Doctor · A', exact: true }).click();
  await expect(page.getByText('triangle-0.gltf', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Добавить 8/8', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
