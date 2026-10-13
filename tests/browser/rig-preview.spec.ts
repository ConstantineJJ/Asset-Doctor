import {test,expect} from '@playwright/test';
import {rigFixture} from '../rig-fixtures';
import {rigViewerState} from './rig-runtime-probe';

test('Pose rotations accumulate across joints, live gizmo follows animation, and rebuilt mixer finishes non-loop playback',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');
 await page.locator('header input[type=file]').setInputFiles({name:'pose.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(rigFixture().buffer)});await expect(page.getByRole('button',{name:'Rescan',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Rig',exact:true}).click();await page.getByTestId('rig-mode-pose').click();
 const select=async(name:string)=>{const hierarchy=page.locator('main > aside').first();await hierarchy.getByPlaceholder('Search hierarchy...').fill(name);await hierarchy.getByTitle(name,{exact:true}).click();await hierarchy.getByPlaceholder('Search hierarchy...').fill('');};
 await select('Root');await page.getByLabel('Joint rotation Z',{exact:true}).fill('30');await page.getByRole('button',{name:'Preview Rotation',exact:true}).click();
 const rootRotation=(await rigViewerState(page)).bones.find(bone=>bone.name==='Root')!.quaternion;
 await select('Child');await page.getByLabel('Joint rotation Z',{exact:true}).fill('20');await page.getByRole('button',{name:'Preview Rotation',exact:true}).click();
 const pose=await rigViewerState(page);expect(pose.bones.find(bone=>bone.name==='Root')!.quaternion).toEqual(rootRotation);expect(pose.bones.find(bone=>bone.name==='Child')!.quaternion[2]).toBeCloseTo(Math.sin(Math.PI/18),5);expect(pose.hasEdits).toBe(false);expect(pose.revision).toBe(0);
 await page.getByTitle('Play',{exact:true}).click();
 await expect.poll(async()=>{const state=await rigViewerState(page);return Math.max(...state.gizmoOrigin!.map((value:number,index:number)=>Math.abs(value-state.selectedWorld![index])));}).toBeLessThan(1e-6);
 await page.getByTitle('Stop & Reset',{exact:true}).click();expect((await rigViewerState(page)).bones.find(bone=>bone.name==='Root')!.quaternion).toEqual([0,0,0,1]);
 await page.getByLabel('Export clip duration').fill('.25');await page.getByRole('button',{name:'Retime Selected Clip',exact:true}).click();
 await page.getByTitle('Toggle Repeat / Loop',{exact:true}).click();await page.getByTitle('Play',{exact:true}).click();await expect(page.getByTitle('Play',{exact:true})).toBeVisible();
 await page.getByTestId('rig-mode-edit').click();expect((await rigViewerState(page)).bones.every(bone=>bone.quaternion[0]===0&&bone.quaternion[1]===0&&bone.quaternion[2]===0&&bone.quaternion[3]===1)).toBe(true);expect(errors).toEqual([]);
});
