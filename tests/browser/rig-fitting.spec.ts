import {test,expect,type Page} from '@playwright/test';
import {fittingGlb,largeFittingGlb} from '../fitting-fixtures';
import {rigViewerState} from './rig-runtime-probe';
import {openJointDetails,closeJointDetails} from './rig-toolbar-probe';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

async function open(page:Page,buffer?:Buffer,name='fitting.glb') {
 await page.goto('/');await page.locator('header input[type=file]').setInputFiles({name,mimeType:'model/gltf-binary',buffer:buffer??Buffer.from(await fittingGlb())});
 await expect(page.getByText(name,{exact:true}).first()).toBeVisible();await page.getByRole('button',{name:'Rig',exact:true}).click();await page.getByTestId('rig-mode-edit').click();
}
async function fitState(page:Page) {
 return page.evaluate(()=>{
  const container=document.getElementById('root')!,key=Object.keys(container).find(name=>name.startsWith('__reactContainer$'))!,attached=Reflect.get(container,key),fibers=[attached?.stateNode?.current??attached];
  while(fibers.length){const fiber=fibers.pop();if(!fiber)continue;if(fiber.child)fibers.push(fiber.child);if(fiber.sibling)fibers.push(fiber.sibling);
   for(let hook=fiber.memoizedState;hook;hook=hook.next){const viewer=hook.memoizedState?.current;if(!viewer?.renderer||!viewer.currentAssetRoot)continue;
    viewer.currentAssetRoot.updateMatrixWorld(true);const meshes:any[]=[],names:string[]=[];
    viewer.currentAssetRoot.traverse((node:any)=>{names.push(node.name);if(!node.isSkinnedMesh)return;node.skeleton.update();const shape:number[]=[];for(let i=0;i<node.geometry.getAttribute('position').count;i++)shape.push(...node.getVertexPosition(i,node.position.clone()).applyMatrix4(node.matrixWorld).toArray());meshes.push({uuid:node.uuid,shape,positions:Array.from(node.geometry.getAttribute('position').array),weights:Array.from(node.geometry.getAttribute('skinWeight').array),joints:Array.from(node.geometry.getAttribute('skinIndex').array)});});
    const overlay=viewer.scene.getObjectByName('__ascope_internal_rig_fitting');return {revision:viewer.rigSession.revision,hasEdits:viewer.rigSession.hasEdits,canUndo:viewer.rigSession.canUndo,meshes,names,markerColor:overlay?.children[0]?.material.color.getHex()??null,markerSize:overlay?.children[0]?.material.size??null,markerCount:overlay?.children[0]?.geometry.getAttribute('position').count??0,overlayInAsset:names.includes('__ascope_internal_rig_fitting')};
   }
  }throw new Error('Viewer not found');
 });
}
async function analyze(page:Page){await page.getByTestId('fit-analyze').click();await expect(page.getByTestId('fit-summary')).toBeVisible();}
async function expectAligned(page:Page,names:string[]) {const bones=(await rigViewerState(page)).bones;for(const name of names)await expect(page.getByTestId('fit-row-'+bones.find(b=>b.name===name)!.uuid)).toContainText('Near section centre');}
const close=(a:number[],b:number[])=>{expect(a).toHaveLength(b.length);a.forEach((value,i)=>expect(value).toBeCloseTo(b[i],4));};

test('Worker proposals and bright lime markers never mutate the source model; discard leaves no Undo entry',async({page})=>{
 await open(page);const before=await fitState(page),bones=(await rigViewerState(page)).bones;await analyze(page);
 await expect(page.getByTestId('fit-summary')).toContainText('Proposals: 2');await expect(page.getByTestId('fit-apply')).toBeDisabled();
 const preview=await fitState(page);expect(preview.markerCount).toBe(2);expect(preview.markerColor).toBe(0xbaff00);expect(preview.markerSize).toBe(16);expect(preview.overlayInAsset).toBe(false);expect(preview.meshes).toEqual(before.meshes);expect(preview.revision).toBe(0);expect((await rigViewerState(page)).bones).toEqual(bones);
 await test.info().attach('fitting-preview.png',{body:await page.screenshot(),contentType:'image/png'});await page.getByTestId('fit-cancel').click();await expect(page.getByTestId('fit-summary')).not.toBeVisible();expect(await fitState(page)).toEqual(before);
});

test('Rig inspector uses the extra width, cyan available rows and one visible red Save Changes action',async({page})=>{
 await page.setViewportSize({width:2560,height:1440});await open(page);await analyze(page);
 const inspector=page.getByTestId('inspector');expect((await inspector.boundingBox())!.width).toBe(544);
 await expect(page.getByRole('button',{name:/Skeleton X-Ray/})).toHaveCount(0);
 const toggle=page.getByTitle('Toggle Skeletal Armature',{exact:true});await expect(toggle).toHaveAttribute('aria-pressed','true');await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','false');await toggle.click();
 const available=page.getByRole('checkbox',{name:'Fit Middle',exact:true});await expect(available.locator('..').locator('..')).toHaveClass(/border-cyan-400/);
 await page.getByTestId('fit-select-all').click();await page.getByTestId('fit-apply').click();await expect(page.getByTestId('fit-applied')).toContainText('Applied joints: 2');
 const save=page.getByRole('button',{name:'Save Changes',exact:true});await expect(save).toBeEnabled();expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(48);await page.mouse.move(0,0);await expect.poll(()=>save.evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(197, 22, 47)');
 await test.info().attach('wide-rig-inspector.png',{body:await page.screenshot(),contentType:'image/png'});
 await page.setViewportSize({width:1366,height:768});expect((await inspector.boundingBox())!.width).toBe(384);
 await page.locator('header input[type=file]').setInputFiles({name:'replacement-fit.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(await fittingGlb())});await page.getByRole('button',{name:'Discard and open',exact:true}).click();await expect(page.getByText('replacement-fit.glb',{exact:true}).first()).toBeVisible();await expect(page.getByTestId('fit-applied')).toHaveCount(0);
});

test('Selected local fitting applies in one Undo step, preserves rest and data, then exports and reimports VERIFIED GLB',async({page})=>{
 await open(page);const before=await fitState(page),original=(await rigViewerState(page)).bones;await analyze(page);
 await page.getByTestId('fit-select-all').click();await expect(page.getByTestId('fit-apply')).toHaveText('Apply Selected (2)');await page.getByTestId('fit-clear-selection').click();await expect(page.getByTestId('fit-apply')).toBeDisabled();await page.getByTestId('fit-select-all').click();await page.getByTestId('fit-apply').click();
 await expect(page.getByTestId('fit-summary')).not.toBeVisible();const fitted=await fitState(page);expect(fitted.revision).toBe(1);expect(fitted.markerCount).toBe(0);close(fitted.meshes[0].shape,before.meshes[0].shape);expect(fitted.meshes[0].weights).toEqual(before.meshes[0].weights);expect(fitted.meshes[0].positions).toEqual(before.meshes[0].positions);
 const middle=(await rigViewerState(page)).bones.find(bone=>bone.name==='Middle')!;close(middle.position,[0,1,0]);
 await page.keyboard.press('Control+z');expect((await rigViewerState(page)).bones.map(bone=>[bone.name,bone.position,bone.quaternion])).toEqual(original.map(bone=>[bone.name,bone.position,bone.quaternion]));expect((await fitState(page)).canUndo).toBe(false);
 await page.getByTestId('rig-editor').getByRole('button',{name:'Redo',exact:true}).click();await analyze(page);await expect(page.getByTestId('fit-summary')).toContainText('Proposals: 0');await expectAligned(page,['Middle','Other']);await page.getByTestId('fit-cancel').click();
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Save Changes',exact:true}).click()]);const chunks:Buffer[]=[];for await(const chunk of (await download.createReadStream())!)chunks.push(Buffer.from(chunk));const output=Buffer.concat(chunks);
 await expect(page.getByTestId('rig-export-status')).toContainText('VERIFIED');const document=JSON.parse(output.subarray(20,20+output.readUInt32LE(12)).toString().trim());expect(document.nodes.some((node:any)=>node.name==='__ascope_internal_rig_fitting')).toBe(false);expect(document.nodes.find((node:any)=>node.name==='FitModel').extras).toEqual({author:'Fitting fixture',keep:{value:1}});
 await test.info().attach('fitted.glb',{body:output,contentType:'model/gltf-binary'});
 await page.locator('header input[type=file]').setInputFiles({name:'fitted-reopen.glb',mimeType:'model/gltf-binary',buffer:output});await page.getByRole('button',{name:'Discard and open',exact:true}).click();await expect(page.getByText('fitted-reopen.glb',{exact:true}).first()).toBeVisible();await page.getByRole('button',{name:'Rig',exact:true}).click();await page.getByTestId('rig-mode-edit').click();close((await fitState(page)).meshes[0].shape,before.meshes[0].shape);close((await rigViewerState(page)).bones.find(bone=>bone.name==='Middle')!.position,[0,1,0]);await analyze(page);await expect(page.getByTestId('fit-summary')).toContainText('Proposals: 0');await expectAligned(page,['Middle','Other']);
});

test('Partial acceptance holds other joints in place and existing manual gizmo fields remain independently undoable',async({page})=>{
 await open(page);const original=(await rigViewerState(page)).bones;await analyze(page);await page.getByRole('checkbox',{name:'Fit Middle',exact:true}).check();await page.getByTestId('fit-apply').click();
 let state=await rigViewerState(page);expect(state.bones.find(bone=>bone.name==='Other')!.position).toEqual(original.find(bone=>bone.name==='Other')!.position);const middle=state.bones.find(bone=>bone.name==='Middle')!;
 const tree=page.locator('main > aside').first();await tree.getByPlaceholder('Search hierarchy...').fill('Middle');await tree.getByTitle('Middle',{exact:true}).click();await tree.getByPlaceholder('Search hierarchy...').fill('');await openJointDetails(page);await page.getByLabel('Joint position X',{exact:true}).fill('0.1');await page.getByRole('button',{name:'Apply Position',exact:true}).click();await closeJointDetails(page);
 expect((await rigViewerState(page)).revision).toBe(2);await page.keyboard.press('Control+z');close((await rigViewerState(page)).bones.find(bone=>bone.uuid===middle.uuid)!.position,[0,1,0]);await page.keyboard.press('Control+z');expect((await rigViewerState(page)).bones.find(bone=>bone.name==='Middle')!.position).toEqual(original.find(bone=>bone.name==='Middle')!.position);
});

test('A real fitting Worker load error stops safely and creates no authored edit',async({page})=>{
 await page.route('**/*rig-fitting.worker*',route=>route.abort());await open(page);const before=await fitState(page);await page.getByTestId('fit-analyze').click();await expect(page.getByTestId('rig-fitting').getByRole('alert')).toContainText(/worker|compute|stopped/i);expect(await fitState(page)).toEqual(before);await expect(page.getByTestId('fit-summary')).not.toBeVisible();
});
test('Cancelling an actual in-flight Worker and replacing its model cannot publish stale proposals',async({page})=>{
 let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),seen=new Promise<void>(resolve=>started=resolve);
 await page.route('**/*rig-fitting.worker*',async route=>{started();await gate;try{await route.continue();}catch{/* The worker was intentionally terminated. */}});
 await open(page);await page.getByTestId('fit-analyze').click();await seen;await page.getByTestId('fit-cancel').click();await expect(page.getByTestId('fit-summary')).not.toBeVisible();expect((await fitState(page)).hasEdits).toBe(false);release();await page.unroute('**/*rig-fitting.worker*');
 await analyze(page);await page.getByTestId('fit-cancel').click();expect((await fitState(page)).markerCount).toBe(0);
 let releaseReplacement!:()=>void,startReplacement!:()=>void;const replacementGate=new Promise<void>(resolve=>releaseReplacement=resolve),replacementStarted=new Promise<void>(resolve=>startReplacement=resolve);
 await page.route('**/*rig-fitting.worker*',async route=>{startReplacement();await replacementGate;try{await route.continue();}catch{/* Asset replacement terminates this worker. */}});
 await page.getByTestId('fit-analyze').click();await replacementStarted;
 await page.locator('header input[type=file]').setInputFiles({name:'new-fit.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(await fittingGlb())});await expect(page.getByText('new-fit.glb',{exact:true}).first()).toBeVisible();releaseReplacement();await page.unroute('**/*rig-fitting.worker*');await expect(page.getByTestId('fit-summary')).not.toBeVisible();expect((await fitState(page)).revision).toBe(0);expect((await fitState(page)).markerCount).toBe(0);
});

test('Byte edits without needsUpdate invalidate actual fitting proposals before Apply',async({page})=>{
 await open(page);await analyze(page);await page.getByRole('checkbox',{name:'Fit Middle',exact:true}).check();
 await page.evaluate(()=>{const container=document.getElementById('root')!,key=Object.keys(container).find(name=>name.startsWith('__reactContainer$'))!,attached=Reflect.get(container,key),queue=[attached?.stateNode?.current??attached];while(queue.length){const fiber=queue.pop();if(fiber?.child)queue.push(fiber.child);if(fiber?.sibling)queue.push(fiber.sibling);for(let hook=fiber?.memoizedState;hook;hook=hook.next){const viewer=hook.memoizedState?.current;if(!viewer?.renderer||!viewer.currentAssetRoot)continue;viewer.currentAssetRoot.traverse((node:any)=>{if(node.isSkinnedMesh)node.geometry.getAttribute('position').setX(0,10);});return;}}throw new Error('Viewer not found');});
 const altered=await fitState(page);await page.getByTestId('fit-apply').click();await expect(page.getByTestId('rig-fitting').getByRole('alert')).toContainText(/stale|again/i);expect(await fitState(page)).toEqual({...altered,markerColor:null,markerSize:null,markerCount:0});
});

test('Textured Fox fitting preserves images materials clips and independently verified animation after reimport',async({page})=>{
 test.setTimeout(90000);const source=readFileSync('tests/browser/fixtures/Fox.glb');const doc=(buffer:Buffer)=>JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)).toString().trim());
 const images=(buffer:Buffer)=>{const json=doc(buffer),start=28+buffer.readUInt32LE(12);return json.images.map((image:any)=>{const view=json.bufferViews[image.bufferView];return createHash('sha256').update(buffer.subarray(start+(view.byteOffset??0),start+(view.byteOffset??0)+view.byteLength)).digest('hex');});};
 await open(page,source,'Fox-fitting.glb');const before=await fitState(page),durations=(await rigViewerState(page)).durations;await analyze(page);const checkboxes=page.getByRole('checkbox',{name:/^Fit /});let accepted=0;
 for(let i=0;i<await checkboxes.count();i++)if(await checkboxes.nth(i).isEnabled()){await checkboxes.nth(i).check();accepted++;if(accepted===3)break;}
 expect(accepted).toBeGreaterThan(0);await test.info().attach('Fox-fitting-proposals.png',{body:await page.screenshot(),contentType:'image/png'});await page.getByTestId('fit-apply').click();const after=await fitState(page);close(after.meshes[0].shape,before.meshes[0].shape);expect(after.meshes[0].weights).toEqual(before.meshes[0].weights);expect((await rigViewerState(page)).durations).toEqual(durations);
 await page.getByRole('button',{name:'Verify Edited GLB',exact:true}).click();await expect(page.getByTestId('rig-export-status')).toContainText('VERIFIED',{timeout:45000});const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Save Changes',exact:true}).click()]);const chunks:Buffer[]=[];for await(const chunk of (await download.createReadStream())!)chunks.push(Buffer.from(chunk));const output=Buffer.concat(chunks);expect(doc(output).materials).toEqual(doc(source).materials);expect(doc(output).textures).toEqual(doc(source).textures);expect(images(output)).toEqual(images(source));expect(doc(output).animations.map((clip:any)=>clip.name)).toEqual(doc(source).animations.map((clip:any)=>clip.name));await test.info().attach('Fox-fitted.glb',{body:output,contentType:'model/gltf-binary'});
 await page.locator('header input[type=file]').setInputFiles({name:'Fox-fitted-reopen.glb',mimeType:'model/gltf-binary',buffer:output});await page.getByRole('button',{name:'Discard and open',exact:true}).click();await expect(page.getByText('Fox-fitted-reopen.glb',{exact:true}).first()).toBeVisible();await page.getByRole('button',{name:'Rig',exact:true}).click();await page.getByTestId('rig-mode-edit').click();close((await fitState(page)).meshes[0].shape,before.meshes[0].shape);await test.info().attach('Fox-fitting-reimport.png',{body:await page.screenshot(),contentType:'image/png'});
});
test('Fitting analysis of 500001 triangles runs through the real Worker within the 100ms continuous main-thread budget',async({page})=>{
 test.setTimeout(180000);await open(page,largeFittingGlb(),'large-fitting.glb');await page.getByRole('button',{name:'Health',exact:true}).click();await expect(page.getByRole('button',{name:'Run safe queue',exact:true})).toBeEnabled({timeout:60000});await page.getByRole('button',{name:'Rig',exact:true}).click();
 await page.evaluate(()=>{Reflect.set(window,'fittingTasks',[]);const observer=new PerformanceObserver(list=>Reflect.get(window,'fittingTasks').push(...list.getEntries().map(entry=>entry.duration)));observer.observe({type:'longtask',buffered:false});Reflect.set(window,'fittingObserver',observer);});
  const start=await page.evaluate(()=>performance.now());await analyze(page);const elapsed=await page.evaluate(()=>performance.now())-start;
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));const times:number[]=await page.evaluate(()=>{Reflect.get(window,'fittingObserver').disconnect();return Reflect.get(window,'fittingTasks');});await test.info().attach('fitting-long-tasks',{body:JSON.stringify(times),contentType:'application/json'});await test.info().attach('fitting-measurement.json',{body:JSON.stringify({triangles:500001,vertices:251001,analysisAndPreviewElapsedMs:elapsed,longTasks:times,thresholdMs:100}),contentType:'application/json'});expect(Math.max(0,...times)).toBeLessThanOrEqual(100);await expect(page.getByTestId('fit-summary')).toContainText(/251[\s,]001/);expect((await rigViewerState(page)).hasEdits).toBe(false);expect((await rigViewerState(page)).revision).toBe(0);
});
