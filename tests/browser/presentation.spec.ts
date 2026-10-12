import { test, expect } from '@playwright/test';
import { presentationFixture } from './presentation-fixtures';
import { installViewerProbe, viewerState } from './viewer-probe';

test('Doctor rotation, turntable, framing and Rescan preserve authored transforms and diagnostics', async ({ page }) => {
  await installViewerProbe(page);
  await page.goto('/');
  await page.locator('header input[type=file]').setInputFiles('tests/browser/fixtures/two-scenes.glb');
  await expect(page.getByRole('button', { name:'Run safe queue', exact:true })).toBeEnabled();
  const before = await viewerState(page);
  expect(before).not.toBeNull();
  await page.getByTitle('+90°', {exact:true}).click();
  await page.getByRole('button', {name:'Frame Model (Fit to view)',exact:true}).click();
  await page.getByRole('button', {name:'Rescan',exact:true}).click();
  await expect(page.getByRole('button', {name:'Run safe queue',exact:true})).toBeEnabled();
  const rotated = await viewerState(page);
  expect(rotated?.roots).toEqual(before?.roots);
  expect(rotated?.issues).toEqual(before?.issues);
  await page.getByTitle('Start turntable auto-rotation', {exact:true}).click();
  await expect.poll(async () => (await viewerState(page))?.wrapper?.quaternion).not.toEqual(rotated?.wrapper?.quaternion);
  await page.getByTitle('Pause turntable auto-rotation', {exact:true}).click();
  await page.getByRole('button', {name:'Rescan',exact:true}).click();
  await expect(page.getByRole('button', {name:'Run safe queue',exact:true})).toBeEnabled();
  expect((await viewerState(page))?.roots).toEqual(before?.roots);
  expect((await viewerState(page))?.issues).toEqual(before?.issues);
});

test('Compare Grid / Lineup scaling, rotation and mode switches preserve authored roots', async ({page}) => {
  await installViewerProbe(page); await page.goto('/');
  await page.getByRole('button',{name:'Compare',exact:true}).click();
  await page.locator('input[type=file][multiple]').setInputFiles([
    {name:'authored.gltf.glb',mimeType:'model/gltf-binary',buffer:presentationFixture()},
    {name:'animated.glb',mimeType:'model/gltf-binary',buffer:presentationFixture(true)},
  ]);
  await expect(page.getByRole('button',{name:'Добавить 2/8',exact:true})).toBeVisible();
  const before = await viewerState(page,true);
  expect(before?.roots.every(r=>r.position.every(v=>v===0) && r.scale.every(v=>v===1))).toBe(true);
  await page.getByRole('button',{name:'В линейку',exact:true}).click();
  await page.getByRole('button',{name:'Реал. масштаб',exact:true}).click();
  // The existing narrow Compare toolbar can be covered by slot chips; use its keyboard path.
  await page.getByTitle('Увеличить масштаб выбранной модели',{exact:true}).focus();
  await page.getByTitle('Увеличить масштаб выбранной модели',{exact:true}).press('Enter');
  await page.getByTitle('Повернуть на +45°',{exact:true}).focus();
  await page.getByTitle('Повернуть на +45°',{exact:true}).press('Enter');
  await page.getByTitle('Сбросить камеры сравнения',{exact:true}).focus();
  await page.getByTitle('Сбросить камеры сравнения',{exact:true}).press('Enter');
  const lineup = await viewerState(page,true);
  expect(lineup?.roots).toEqual(before?.roots); expect(lineup?.children).toEqual(before?.children);
  expect(lineup?.mixerOwnsAuthoredRoot).toBe(true);
  await page.getByRole('button',{name:'Сетка',exact:true}).click();
  const grid = await viewerState(page,true);
  expect(grid?.roots).toEqual(before?.roots); expect(grid?.children).toEqual(before?.children);
  await page.getByRole('button',{name:'Doctor · A',exact:true}).click();
  await expect(page.getByText('authored.gltf.glb',{exact:true}).filter({visible:true})).toBeVisible();
  const doctor = await viewerState(page);
  expect(doctor?.roots[0]).toEqual(before?.roots[0]); expect(doctor?.children[0]).toEqual(before?.children[0]);
});

for (const skinned of [false,true]) {
  test(`F03 ${skinned?'animated skin':'authored TRS'} Repair / Undo / GLB export and reimport ignore viewer transforms`,async ({page})=> {
    await installViewerProbe(page); page.on('dialog',dialog=>dialog.accept());
    const errors: string[] = []; page.on('pageerror',e=>errors.push(e.message));
    await page.goto('/');
    const source = presentationFixture(skinned);
    await page.locator('header input[type=file]').setInputFiles({name:'authored.glb',mimeType:'model/gltf-binary',buffer:source});
    await expect(page.getByRole('button',{name:'Run safe queue',exact:true})).toBeEnabled();
    const before = await viewerState(page);
    expect(before?.issues.some(issue=>issue.id==='transform-suspicious-combinations')).toBe(true);
    await page.getByTitle('+90°',{exact:true}).click();
    await page.getByRole('button',{name:'Rescan',exact:true}).click();
    await expect(page.getByRole('button',{name:'Run safe queue',exact:true})).toBeEnabled();
    expect((await viewerState(page))?.issues).toEqual(before?.issues);
    if (skinned) {
      expect(before?.skins).toHaveLength(1); expect(before?.mixerOwnsAuthoredRoot).toBe(true);
      await expect.poll(async()=> (await viewerState(page))?.skins[0]?.jointPosition).not.toEqual(before?.skins[0]?.jointPosition);
    }
    await page.getByRole('button',{name:'Run safe queue',exact:true}).click();
    await expect(page.locator('header')).toContainText('2 tri');
    await page.getByRole('button',{name:/^Undo ·/}).click();
    await expect(page.locator('header')).toContainText('3 tri');
    expect((await viewerState(page))?.roots).toEqual(before?.roots);
    await page.getByRole('button',{name:'Run safe queue',exact:true}).click();
    await expect(page.getByRole('button',{name:'Build & Verify',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Build & Verify',exact:true}).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button',{name:'Download GLB',exact:true}).click();
    const stream = await (await downloadPromise).createReadStream();
    const chunks: Buffer[] = []; for await(const chunk of stream!) chunks.push(Buffer.from(chunk));
    const output = Buffer.concat(chunks);
    const json = JSON.parse(output.subarray(20,20+output.readUInt32LE(12)).toString().trim());
    const pivot = json.nodes.find((n:any)=>n.name==='AuthoredPivot');
    await test.info().attach('repaired.glb',{body:output,contentType:'model/gltf-binary'});
    expect(pivot.translation ?? pivot.matrix?.slice(12,15)).toEqual([3,5,7]);
    expect(json.nodes.some((n:any)=>n.name==='__ascope_internal_presentation')).toBe(false);
    if(skinned) {expect(json.skins).toHaveLength(1);expect(json.animations).toHaveLength(1);}
    await page.locator('header input[type=file]').setInputFiles({name:'reopened.glb',mimeType:'model/gltf-binary',buffer:output});
    await page.getByRole('button',{name:'Discard and open',exact:true}).click();
    await expect(page.getByText('reopened.glb',{exact:true})).toBeVisible();
    await expect(page.locator('header')).toContainText('2 tri');
    const reopened = await viewerState(page);
    expect(reopened?.pivots).toHaveLength(1);
    reopened?.pivots.forEach((node,i)=> {
      expect(node.position).toEqual(before?.pivots[i].position);
      node.quaternion.forEach((v,j)=>expect(v).toBeCloseTo(before!.pivots[i].quaternion[j],5));
      node.scale.forEach((v,j)=>expect(v).toBeCloseTo(before!.pivots[i].scale[j],5));
    });
    if(skinned) {
      expect(reopened?.skins[0].joints).toEqual(before?.skins[0].joints);
      expect(reopened?.skins[0].weights).toEqual(before?.skins[0].weights);
      expect(reopened?.skins[0].indices).toEqual(before?.skins[0].indices);
      expect(reopened?.mixerOwnsAuthoredRoot).toBe(true);
      await expect.poll(async()=> (await viewerState(page))?.skins[0]?.jointPosition).not.toEqual(reopened?.skins[0].jointPosition);
    }
    expect(errors).toEqual([]);
  });
}
