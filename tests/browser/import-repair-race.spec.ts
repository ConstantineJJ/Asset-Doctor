import { test, expect } from '@playwright/test';

function delayedTriangleFile() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = {
    asset: { version: '2.0' }, scene: 0,
    scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Delayed triangle' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${Buffer.from(positions.buffer).toString('base64')}` }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
  };
  return { name: 'delayed-triangle.gltf', mimeType: 'model/gltf+json', buffer: Buffer.from(JSON.stringify(json)) };
}

test('repairs made while a file is importing require confirmation before replacing the asset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.addInitScript(() => {
    const arrayBuffer = File.prototype.arrayBuffer;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    Object.assign(window, { releaseRepairRaceImport: release, repairRaceImportPending: false });
    File.prototype.arrayBuffer = async function () {
      if (this.name === 'delayed-triangle.gltf') {
        Object.assign(window, { repairRaceImportPending: true });
        await barrier;
      }
      return arrayBuffer.call(this);
    };
  });

  await page.goto('/');
  await page.locator('#btn-sample-models').click();
  await page.getByRole('menuitem', { name: /Asset Doctor Test Patient/ }).click();
  await expect(page.getByRole('button', { name: 'Run safe queue', exact: true })).toBeEnabled();

  // Start a replacement while the current asset has no repairs, then repair it
  // before the file finishes reading. The original open-time check is obsolete.
  await page.locator('header input[type=file]').setInputFiles(delayedTriangleFile());
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'repairRaceImportPending'))).toBe(true);
  await page.getByRole('button', { name: 'Run safe queue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Build & Verify', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Run safe queue', exact: true })).toBeVisible();

  await page.evaluate(() => Reflect.get(window, 'releaseRepairRaceImport')());
  await expect(page.getByRole('button', { name: 'Discard and open', exact: true })).toBeVisible();
  await expect(page.getByText('Asset_Doctor_Test_Patient.glb', { exact: true })).toBeVisible();
  await expect(page.getByText('delayed-triangle.gltf', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Build & Verify', exact: true })).toBeEnabled();
  await expect(page.getByText('Asset_Doctor_Test_Patient.glb', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
