import {test,expect} from '@playwright/test';
import {metadataFixture} from './runtime-metadata-fixture';
import {rigViewerState} from './rig-runtime-probe';

test('Rig inspector lightning shows X-Ray joints in one click and picks the real bone without editing it',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.locator('header input[type=file]').setInputFiles({name:'rig-inspector.glb',mimeType:'model/gltf-binary',buffer:metadataFixture()});
 await expect(page.getByRole('button',{name:'Rescan',exact:true})).toBeEnabled();
 const before=await rigViewerState(page,true);
 await page.getByTitle('Toggle Skeletal Armature',{exact:true}).click();
 const visible=await rigViewerState(page);
 expect(visible.xray).toBe(true);expect(visible.jointCount).toBe(visible.bones.length);expect(visible.jointsVisible).toBe(true);
 await page.mouse.click(visible.bones[0].screen[0],visible.bones[0].screen[1]);
 await expect.poll(async()=>(await rigViewerState(page)).selected).toBe(visible.bones[0].uuid);
 await page.getByRole('button',{name:'Rig',exact:true}).click();
 await expect(page.getByText('Selected Bone',{exact:true})).toBeVisible();
 expect((await rigViewerState(page)).bones.map(({position,quaternion})=>({position,quaternion})))
  .toEqual(before.bones.map(({position,quaternion})=>({position,quaternion})));
 await page.getByTitle('Toggle Skeletal Armature',{exact:true}).click();
 const hidden=await rigViewerState(page);expect(hidden.skeletonVisible).toBe(false);expect(hidden.jointsVisible).toBe(false);
 expect(errors).toEqual([]);
});
