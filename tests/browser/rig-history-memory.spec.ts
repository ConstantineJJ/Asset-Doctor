import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {rigFixture} from '../rig-fixtures';
import {rigViewerState} from './rig-runtime-probe';
import {openJointDetails,closeJointDetails} from './rig-toolbar-probe';

async function history(page:Page,limit?:number){return page.evaluate(limit=>{
 const container=document.getElementById('root')!,key=Object.keys(container).find(key=>key.startsWith('__reactContainer$'))!,attached=Reflect.get(container,key),fibers=[attached?.stateNode?.current??attached];
 while(fibers.length){const fiber=fibers.pop();if(!fiber)continue;if(fiber.child)fibers.push(fiber.child);if(fiber.sibling)fibers.push(fiber.sibling);for(let hook=fiber.memoizedState;hook;hook=hook.next){const viewer=hook.memoizedState?.current;if(viewer?.renderer&&viewer.currentAssetRoot){if(limit!==undefined)Reflect.set(viewer.rigSession,'historyLimitBytes',limit);return viewer.rigSession.getHistoryMemoryUsage();}}}throw Error('Viewer not found');
},limit);}
async function ring(page:Page){return page.evaluate(()=>{
 const container=document.getElementById('root')!,key=Object.keys(container).find(key=>key.startsWith('__reactContainer$'))!,attached=Reflect.get(container,key),fibers=[attached?.stateNode?.current??attached];
 while(fibers.length){const fiber=fibers.pop();if(!fiber)continue;if(fiber.child)fibers.push(fiber.child);if(fiber.sibling)fibers.push(fiber.sibling);for(let hook=fiber.memoizedState;hook;hook=hook.next){const viewer=hook.memoizedState?.current;if(!viewer?.renderer||!viewer.currentAssetRoot)continue;const controls=viewer.rigGizmo.controls,rect=viewer.renderer.domElement.getBoundingClientRect(),points:{axis:string;screen:[number,number]}[]=[];
 const project=(point:any):[number,number]=>{point.project(viewer.camera);return [rect.x+(point.x+1)*rect.width/2,rect.y+(1-point.y)*rect.height/2];};controls.getHelper().updateMatrixWorld(true);
 controls._gizmo.gizmo.rotate.traverse((object:any)=>{if(!object.isMesh||!object.visible||!['X','Y','Z'].includes(object.name))return;const positions=object.geometry.getAttribute('position');for(let i=0;i<positions.count;i+=Math.max(1,Math.floor(positions.count/24))){const screen=project(object.position.clone().fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld));if(screen[0]>rect.x+12&&screen[0]<rect.right-12&&screen[1]>rect.y+12&&screen[1]<rect.bottom-12)points.push({axis:object.name,screen});}});
 return {points,axis:controls.axis,center:project(controls.object.getWorldPosition(controls.object.position.clone()))};
 }}throw Error('Viewer not found');
});}
async function open(page:Page,useOwner=true){
 const file=useOwner?process.env.ASSET_DOCTOR_RIG_HISTORY_FILE:undefined,buffer=file?readFileSync(file):Buffer.from(rigFixture().buffer);
 await page.goto('/');await page.locator('header input[type=file]').setInputFiles({name:'history-rig.glb',mimeType:'model/gltf-binary',buffer});await expect(page.getByRole('button',{name:'Rescan',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Rig',exact:true}).click();await page.getByTestId('rig-mode-edit').click();const state=await rigViewerState(page),joint=state.bones.find(bone=>bone.name==='mixamorigRightHand')??state.bones[0];
 const tree=page.locator('main > aside').first();await tree.getByPlaceholder('Search hierarchy...').fill(joint.name);await tree.getByTitle(joint.name,{exact:true}).click();await tree.getByPlaceholder('Search hierarchy...').fill('');await openJointDetails(page);
 return {file,hash:createHash('sha256').update(buffer).digest('hex'),joint};
}
test('Forty joint rotations keep all Undo steps and verify an edited export without exhausting the history budget',async({page})=>{
 test.setTimeout(180000);const {file,hash,joint}=await open(page);
 for(let i=1;i<=40;i++){await page.getByLabel('Joint rotation Z',{exact:true}).fill(String(i));await page.getByRole('button',{name:'Apply Rotation',exact:true}).click();await expect(page.getByText(/exceeds the configured memory budget/)).toHaveCount(0);}
 const usage=await history(page);expect(usage.undoSteps).toBe(40);expect(usage.bytes).toBeLessThan(usage.limit);
 await test.info().attach('rig-history-memory.json',{body:JSON.stringify({source:file?'owner model':'synthetic fixture',sha256:hash,...usage}),contentType:'application/json'});
 for(let i=0;i<40;i++)await page.getByRole('button',{name:'Undo',exact:true}).click();
 const restored=(await rigViewerState(page)).bones.find(bone=>bone.uuid===joint.uuid)!;restored.quaternion.forEach((value:number,i:number)=>expect(value).toBeCloseTo(joint.quaternion[i],7));expect((await history(page)).undoSteps).toBe(0);
 for(let i=0;i<40;i++)await page.getByRole('button',{name:'Redo',exact:true}).click();
 await page.getByRole('button',{name:'Verify Edited GLB',exact:true}).click();await expect(page.getByTestId('rig-export-status')).toContainText('VERIFIED',{timeout:60000});
 if(file)expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
});
test('A real history-budget refusal stays atomic and appears in the system log with requested and maximum bytes',async({page})=>{
 const {joint}=await open(page,false);await history(page,1);await page.getByLabel('Joint rotation Z',{exact:true}).fill('25');await page.getByRole('button',{name:'Apply Rotation',exact:true}).click();await expect(page.getByText(/Rig Undo history exceeds/)).toBeVisible();
 const state=await rigViewerState(page);expect(state.bones.find(bone=>bone.uuid===joint.uuid)!.quaternion).toEqual(joint.quaternion);expect((await history(page)).undoSteps).toBe(0);
 await page.getByRole('button',{name:'System log',exact:true}).click();const entry=page.getByRole('dialog',{name:'System log',exact:true}).locator('pre').filter({hasText:'action_failed'}).last();await expect(entry).toBeVisible();const record=JSON.parse((await entry.textContent())!);expect(record.context.error.requestedBytes).toBeGreaterThan(1);expect(record.context.error.limitBytes).toBe(1);expect(record.context.undoSteps).toBe(0);
 await page.getByRole('button',{name:'Close system log',exact:true}).click();await closeJointDetails(page);await page.getByTestId('rig-tool-rotate').click();
 const probe=await ring(page);let start:[number,number]|undefined;
 for(const point of probe.points){await page.mouse.move(...point.screen);if((await ring(page)).axis===point.axis){start=point.screen;break;}}expect(start).toBeTruthy();
 const [cx,cy]=probe.center,dx=start![0]-cx,dy=start![1]-cy;
 await page.mouse.move(...start!);await page.mouse.down();await page.mouse.move(cx+dx*Math.cos(.4)-dy*Math.sin(.4),cy+dx*Math.sin(.4)+dy*Math.cos(.4),{steps:8});await page.mouse.up();
 expect((await history(page)).undoSteps).toBe(0);expect((await rigViewerState(page)).bones.find(bone=>bone.uuid===joint.uuid)!.quaternion).toEqual(joint.quaternion);
 await page.getByRole('button',{name:'System log',exact:true}).click();const failed=page.getByRole('dialog',{name:'System log',exact:true}).locator('pre').filter({hasText:'gizmo_failed'}).last();await expect(failed).toBeVisible();const gizmoRecord=JSON.parse((await failed.textContent())!);expect(gizmoRecord.context.tool).toBe('rotate');expect(gizmoRecord.context.error.limitBytes).toBe(1);expect(gizmoRecord.context.jointId).toBe(joint.uuid);
 await test.info().attach('rig-budget-log.png',{body:await page.screenshot(),contentType:'image/png'});
});
