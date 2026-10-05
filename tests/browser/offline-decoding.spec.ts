import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test('bundled Draco decodes without external network under the desktop CSP', async ({ page }) => {
  const errors: string[] = [];
  const remoteRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => { errors.push(dialog.message()); return dialog.dismiss(); });
  const csp = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).app.security.csp;
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== 'localhost' && url.protocol !== 'data:' && url.protocol !== 'blob:') {
      remoteRequests.push(request.url());
      await route.abort();
      return;
    }
    if (request.isNavigationRequest() && process.env.ASSET_DOCTOR_TEST_BUILD === '1') {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
    } else await route.continue();
  });
  await page.goto('/');
  const model = JSON.parse(readFileSync('tests/browser/fixtures/box-draco.gltf', 'utf8'));
  const binary = readFileSync('tests/browser/fixtures/box-draco.bin');
  model.buffers[0].uri = `data:application/octet-stream;base64,${binary.toString('base64')}`;
  await page.locator('header input[type=file]').setInputFiles({
    name: 'offline-draco.gltf', mimeType: 'model/gltf+json', buffer: Buffer.from(JSON.stringify(model)),
  });
  await expect(page.getByText('offline-draco.gltf', { exact: true })).toBeVisible();
  await expect(page.locator('header')).toContainText('12 tri');
  await expect(page.getByRole('button', { name: 'Rescan', exact: true })).toBeEnabled();
  expect(remoteRequests).toEqual([]);
  expect(errors).toEqual([]);
});
