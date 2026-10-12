import { test, expect, type Page } from '@playwright/test';

const dialogError = 'The repair queue was cancelled because confirmation could not be opened. No repairs were applied.';

async function prepare(page: Page) {
  await page.addInitScript(() => {
    const requests: { resolve: (confirmed: boolean) => void; reject: (error: Error) => void }[] = [];
    Object.assign(window, { repairConfirmRequests: requests });
    Object.defineProperty(window, 'confirm', { value: () => new Promise<boolean>((resolve, reject) => {
      requests.push({ resolve, reject });
    }) });
  });
  await page.goto('/');
  await page.locator('header input[type=file]').setInputFiles('tests/browser/fixtures/two-scenes.glb');
  await expect(page.getByRole('button', { name: 'Run safe queue', exact: true })).toBeEnabled();
}

async function decide(page: Page, outcome: 'confirm' | 'cancel' | 'error') {
  await page.evaluate(outcome => {
    const request = Reflect.get(window, 'repairConfirmRequests')[0];
    if (outcome === 'error') request.reject(new Error('native dialog ACL denied'));
    else request.resolve(outcome === 'confirm');
  }, outcome);
}

test('Safe Queue waits for explicit Confirm before any geometry mutation', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Run safe queue', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'repairConfirmRequests').length)).toBe(1);
  await expect(page.locator('header')).toContainText('3 tri');
  await expect(page.getByRole('button', { name: 'Build & Verify', exact: true })).toHaveCount(0);
  await decide(page, 'confirm');
  await expect(page.getByRole('button', { name: 'Build & Verify', exact: true })).toBeEnabled();
  await expect(page.locator('header')).toContainText('2 tri');
});

test('Safe Queue Cancel leaves geometry and Undo unchanged', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Run safe queue', exact: true }).click();
  await decide(page, 'cancel');
  await page.getByRole('button', { name: 'Rescan', exact: true }).click();
  await expect(page.locator('header')).toContainText('3 tri');
  await expect(page.getByRole('button', { name: /^Undo ·/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Build & Verify', exact: true })).toHaveCount(0);
});

test('Safe Queue Dialog Error fails closed with an explanation and no repair', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  await page.getByRole('button', { name: 'Run safe queue', exact: true }).click();
  await decide(page, 'error');
  await expect(page.getByText(dialogError, { exact: true })).toBeVisible();
  await expect(page.locator('header')).toContainText('3 tri');
  await expect(page.getByRole('button', { name: /^Undo ·/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Safe Queue has only one pending confirmation and ignores a stale asset approval', async ({ page }) => {
  await prepare(page);
  const run = page.getByRole('button', { name: 'Run safe queue', exact: true });
  await run.click();
  await run.click();
  expect(await page.evaluate(() => Reflect.get(window, 'repairConfirmRequests').length)).toBe(1);
  await page.locator('header input[type=file]').setInputFiles({
    name: 'replacement.glb', mimeType: 'model/gltf-binary',
    buffer: await import('node:fs').then(fs => fs.readFileSync('tests/browser/fixtures/two-scenes.glb')),
  });
  await expect(page.getByText('replacement.glb', { exact: true })).toBeVisible();
  await expect(run).toBeEnabled();
  await decide(page, 'confirm');
  await page.getByRole('button', { name: 'Rescan', exact: true }).click();
  await expect(page.locator('header')).toContainText('3 tri');
  await expect(page.getByRole('button', { name: /^Undo ·/ })).toHaveCount(0);
});
