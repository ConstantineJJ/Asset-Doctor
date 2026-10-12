import { test,expect } from '@playwright/test';
import { authorExtras,metadataFixture,pixels } from './runtime-metadata-fixture';
import { metadataState } from './runtime-metadata-probe';

const internalKeys=['__assetDoctorSourceAudit','__assetDoctorAuthoredMaterials','__assetDoctorCompareGrounded'];
function internalPaths(value:any,path='$'): string[] {
  if(!value || typeof value!=='object')return [];
  return Object.entries(value).flatMap(([key,item])=>[...(internalKeys.includes(key)?[path+'.'+key]:[]),...internalPaths(item,path+'.'+key)]);
}
for(const legacy of [false,true]) test(`F05 ${legacy?'legacy':'clean'} textured skin roundtrip preserves author extras without runtime snapshots`,async({page})=>{
  page.on('dialog',dialog=>dialog.accept());
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await page.locator('header input[type=file]').setInputFiles({name:'metadata.glb',mimeType:'model/gltf-binary',buffer:metadataFixture(legacy)});
  await expect(page.getByRole('button',{name:'Run safe queue',exact:true})).toBeEnabled();
  const before=await metadataState(page);
  expect(before?.[0].meshes[0].materials[0].texture?.pixels).toEqual(pixels);
  expect(before?.[0].meshes[0].materials[0].isMaterial).toBe(true);
  await page.getByRole('button',{name:'Run safe queue',exact:true}).click();
  await expect(page.locator('header')).toContainText('2 tri');
  await page.getByRole('button',{name:/^Undo ·/}).click();await expect(page.locator('header')).toContainText('3 tri');
  await page.getByRole('button',{name:'Run safe queue',exact:true}).click();
  await expect(page.getByRole('button',{name:'Build & Verify',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Build & Verify',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download GLB',exact:true}).click();
  const stream=await(await downloadPromise).createReadStream();const chunks:Buffer[]=[];
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk));const buffer=Buffer.concat(chunks);
  await test.info().attach('exported.glb',{body:buffer,contentType:'model/gltf-binary'});
  const json=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)).toString().trim());
  expect(internalPaths(json)).toEqual([]);
  expect(JSON.stringify(json).includes('data:image')).toBe(false);
  expect(json.images).toHaveLength(1);
  expect(json.nodes.find((n:any)=>n.name==='AuthoredPivot').extras).toEqual({...authorExtras,name:'AuthoredPivot'});
  expect(json.materials[0].extras.materialTag).toBe('Material extras');
  expect(json.textures[0].extras.textureTag).toBe('Texture extras');
  expect(json.extras.documentTag).toBe('Document extras');
  expect(json.nodes.some((n:any)=>n.extras?.sceneTag==='Scene extras')).toBe(true);
  expect(json.nodes.some((n:any)=>n.extras?.meshNodeTag==='Mesh node extras')).toBe(true);
  expect(json.skins).toHaveLength(1);expect(json.animations).toHaveLength(1);
  await page.locator('header input[type=file]').setInputFiles({name:'metadata-reopened.glb',mimeType:'model/gltf-binary',buffer});
  await page.getByRole('button',{name:'Discard and open',exact:true}).click();
  await expect(page.getByText('metadata-reopened.glb',{exact:true})).toBeVisible();await expect(page.locator('header')).toContainText('2 tri');
  const reopened=await metadataState(page);
  expect(reopened?.[0].meshes[0].materials).toEqual(before?.[0].meshes[0].materials);
  const skin=reopened?.[0].meshes[0].skin,original=before?.[0].meshes[0].skin;
  expect(skin?.joints).toEqual(original?.joints);expect(skin?.weights).toEqual(original?.weights);expect(skin?.indices).toEqual(original?.indices);
  skin?.inverse.forEach((matrix:number[],i:number)=>matrix.forEach((v,j)=>expect(v).toBeCloseTo(original!.inverse[i][j],5)));
  expect(reopened?.[0].mixerOwnsRoot).toBe(true);
  await expect.poll(async()=>(await metadataState(page))?.[0].meshes[0].skin?.jointPosition).not.toEqual(skin?.jointPosition);
  expect(errors).toEqual([]);
});

test('F05 Compare Grid/Lineup clones retain PBR textures, extras and live skin animation across mode changes and removal',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  await page.getByRole('button',{name:'Compare',exact:true}).click();
  await page.locator('input[type=file][multiple]').setInputFiles([
    {name:'checker-a.glb',mimeType:'model/gltf-binary',buffer:metadataFixture(false,true)},
    {name:'checker-b.glb',mimeType:'model/gltf-binary',buffer:metadataFixture(true,true)},
  ]);
  await expect(page.getByRole('button',{name:'Добавить 2/8',exact:true})).toBeVisible();
  const grid=await metadataState(page,true);
  expect(grid).toHaveLength(2);
  for(const root of grid!)expect(root.meshes[0].materials[0].texture.pixels).toEqual(pixels);
  const renderMode=page.locator('header select').filter({has:page.locator('option[value="unlit"]')});
  await renderMode.selectOption('unlit');
  const shading=page.locator('select').filter({has:page.locator('option[value="flat"]')}).filter({visible:true});
  await shading.selectOption('flat');
  await page.getByRole('button',{name:'В линейку',exact:true}).click();
  const lineup=await metadataState(page,true);
  lineup?.forEach((root,i)=>{
    expect(root.uuid).not.toBe(root.sourceUuid);expect(root.mixerOwnsRoot).toBe(true);
    expect(root.pivotExtras).toEqual(grid?.[i].pivotExtras);
    expect(root.meshes[0].materials).toEqual(grid?.[i].meshes[0].materials);
  });
  await page.getByTitle('Анимация',{exact:true}).first().selectOption('1');
  expect((await metadataState(page,true))?.[0].clip).toBe('AlternateMotion');
  await page.getByTitle('Воспроизведение',{exact:true}).click();
  await expect.poll(async()=>(await metadataState(page,true))?.map(root=>root.meshes[0].skin?.jointPosition)).not.toEqual(lineup?.map(root=>root.meshes[0].skin?.jointPosition));
  await page.getByTitle('Пауза',{exact:true}).click();
  await renderMode.selectOption('base-color');
  await shading.selectOption('smooth');
  await renderMode.selectOption('pbr');await shading.selectOption('hybrid');
  await page.getByRole('button',{name:'Сетка',exact:true}).click();
  expect((await metadataState(page,true))?.[0].clip).toBe('AlternateMotion');
  expect((await metadataState(page,true))?.map(root=>root.meshes[0].materials)).toEqual(grid?.map(root=>root.meshes[0].materials));
  await page.getByRole('button',{name:'В линейку',exact:true}).click();
  await page.getByTitle('Удалить из сравнения',{exact:true}).last().click();
  await expect(page.getByRole('button',{name:'Добавить 1/8',exact:true})).toBeVisible();
  expect((await metadataState(page,true))?.[0].meshes[0].materials).toEqual(grid?.[0].meshes[0].materials);
  await page.getByRole('button',{name:'Doctor · A',exact:true}).click();
  await expect(page.getByText('checker-a.glb',{exact:true}).filter({visible:true})).toBeVisible();
  expect((await metadataState(page))?.[0].meshes[0].materials).toEqual(grid?.[0].meshes[0].materials);
  expect(errors).toEqual([]);
});

for(const extras of [false,['tag',null,0]])test(`F05 exports raw document/texture extras ${JSON.stringify(extras)}`,async({page})=>{
  page.on('dialog',dialog=>dialog.accept());await page.goto('/');
  await page.locator('header input[type=file]').setInputFiles({name:'raw-extras.glb',mimeType:'model/gltf-binary',buffer:metadataFixture(false,false,extras)});
  await expect(page.getByRole('button',{name:'Run safe queue',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Run safe queue',exact:true}).click();
  await expect(page.getByRole('button',{name:'Build & Verify',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Build & Verify',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download GLB',exact:true}).click();
  const stream=await(await download).createReadStream(),chunks:Buffer[]=[];
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk));const output=Buffer.concat(chunks);
  const json=JSON.parse(output.subarray(20,20+output.readUInt32LE(12)).toString().trim());
  expect(json.extras).toEqual(extras);expect(json.textures[0].extras).toEqual(extras);
});
