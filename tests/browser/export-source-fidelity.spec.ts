import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

const fixturePath = 'tests/browser/fixtures/two-scenes.glb';
const multiSceneMessage = 'Repaired export is not supported for documents with multiple scenes. The original file and current model are unchanged. Export a single-scene GLB from your authoring tool first.';
const orphanMessage = 'Repaired export is not supported when source nodes exist outside the scene hierarchy. The original file and current model are unchanged.';

function sourceVariant(json: any): Buffer {
  const source = readFileSync(fixturePath);
  const oldJsonLength = source.readUInt32LE(12);
  const binaryChunk = source.subarray(20 + oldJsonLength);
  const encoded = Buffer.from(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const result = Buffer.alloc(20 + jsonLength + binaryChunk.length);
  source.copy(result, 0, 0, 12);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonLength, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  result.fill(32, 20, 20 + jsonLength);
  encoded.copy(result, 20);
  binaryChunk.copy(result, 20 + jsonLength);
  return result;
}

function sourceJson() {
  const source = readFileSync(fixturePath);
  return JSON.parse(source.subarray(20, 20 + source.readUInt32LE(12)).toString().trim());
}

async function repair(page: Page, name: string, buffer: Buffer) {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.locator('header input[type=file]').setInputFiles({ name, mimeType: 'model/gltf-binary', buffer });
  await expect(page.getByRole('button', { name: 'Run safe queue', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Run safe queue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Build & Verify', exact: true })).toBeEnabled();
}

test('multi-scene repaired export is blocked without changing the current geometry or source', async ({ page }) => {
  const source = readFileSync(fixturePath);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await repair(page, 'two-scenes.glb', source);
  await expect(page.locator('header')).toContainText('2 tri');
  await page.getByRole('button', { name: 'Build & Verify', exact: true }).click();
  await expect(page.getByText(multiSceneMessage, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download GLB', exact: true })).toHaveCount(0);
  await expect(page.locator('header')).toContainText('2 tri');
  await page.getByRole('button', { name: 'Rescan', exact: true }).click();
  await page.getByRole('button', { name: /^Undo ·/ }).click();
  await expect(page.locator('header')).toContainText('3 tri');
  expect(readFileSync(fixturePath)).toEqual(source);
  expect(errors).toEqual([]);
});

test('single-scene documents with unreachable source nodes cannot silently lose them', async ({ page }) => {
  const json = sourceJson();
  json.scenes = [json.scenes[0]];
  await repair(page, 'orphan-node.glb', sourceVariant(json));
  await page.getByRole('button', { name: 'Build & Verify', exact: true }).click();
  await expect(page.getByText(orphanMessage, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download GLB', exact: true })).toHaveCount(0);
  await expect(page.locator('header')).toContainText('2 tri');
});

test('supported single-scene repaired export preserves important non-mesh nodes and reopens', async ({ page }) => {
  const json = sourceJson();
  json.scenes = [{ name: 'Primary', nodes: [0, 1] }];
  json.meshes = [json.meshes[0]];
  json.nodes = [json.nodes[0], { name: 'CriticalAnchor', children: [2] }, { name: 'CalibrationMarker', translation: [2, 3, 4] }];
  await repair(page, 'single-scene.glb', sourceVariant(json));
  await page.getByRole('button', { name: 'Build & Verify', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download GLB', exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = Buffer.concat(chunks);
  const output = JSON.parse(exported.subarray(20, 20 + exported.readUInt32LE(12)).toString().trim());
  expect(output.scenes).toHaveLength(1);
  const anchor = output.nodes.find((node: any) => node.name === 'CriticalAnchor');
  expect(anchor.children.map((index: number) => output.nodes[index].name)).toEqual(['CalibrationMarker']);
  const marker = output.nodes.find((node: any) => node.name === 'CalibrationMarker');
  expect(marker.matrix.slice(12, 15)).toEqual([2, 3, 4]);
  await page.locator('header input[type=file]').setInputFiles({ name: 'single-scene-repaired.glb', mimeType: 'model/gltf-binary', buffer: exported });
  await page.getByRole('button', { name: 'Discard and open', exact: true }).click();
  await expect(page.getByText('single-scene-repaired.glb', { exact: true })).toBeVisible();
  await expect(page.locator('header')).toContainText('2 tri');
  await expect(page.getByRole('button', { name: 'Rescan', exact: true })).toBeEnabled();
});
