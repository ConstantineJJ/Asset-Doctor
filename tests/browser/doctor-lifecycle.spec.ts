import {test,expect,type Page} from '@playwright/test';
import {rigFixture} from '../rig-fixtures';

async function open(page:Page) {
 await page.addInitScript(()=>{
  const original=window.requestAnimationFrame;
  window.requestAnimationFrame=callback=>original.call(window,time=>{Reflect.set(window,'qaFrameTime',time);callback(time);});
 });
 await page.goto('/');await page.locator('header input[type=file]').setInputFiles({name:'lifecycle.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(rigFixture().buffer)});
 await expect(page.getByText('lifecycle.glb',{exact:true}).first()).toBeVisible();
 await page.evaluate(()=>{
  const container=document.getElementById('root')!,key=Object.keys(container).find(k=>k.startsWith('__reactContainer$'))!,attached=Reflect.get(container,key),queue=[attached?.stateNode?.current??attached];let doctor:any,compare:any;
  while(queue.length){const fiber=queue.pop();if(!fiber)continue;if(fiber.child)queue.push(fiber.child);if(fiber.sibling)queue.push(fiber.sibling);for(let hook=fiber.memoizedState;hook;hook=hook.next){const value=hook.memoizedState?.current;if(!value?.renderer)continue;if(value.cameraController)doctor=value;else if(value.assets)compare=value;}}
  if(!doctor||!compare)throw new Error('Both actual managers are required');
  const counts={renders:0,draws:0,mixers:0,camera:0,clock:0,timeline:0,frames:{} as Record<string,number>,deltas:[] as number[]};
  const wrap=(host:any,key:string,observe:(args:any[])=>void)=>{const original=host[key];host[key]=function(...args:any[]){observe(args);return original.apply(this,args);};};
  wrap(doctor.renderer,'render',()=>{counts.renders++;const frame=String(Reflect.get(window,'qaFrameTime'));counts.frames[frame]=(counts.frames[frame]??0)+1;});
  const gl=doctor.renderer.getContext();for(const key of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'])wrap(gl,key,()=>counts.draws++);
  wrap(doctor.animationMixer,'update',args=>{counts.mixers++;counts.deltas.push(args[0]);});wrap(doctor.cameraController,'update',()=>counts.camera++);wrap(doctor.clock,'getDelta',()=>counts.clock++);
  wrap(doctor.callbacks,'onAnimationTimeUpdate',()=>counts.timeline++);
  Reflect.set(window,'lifecycleQA',{doctor,compare,counts});
 });
}
async function snapshot(page:Page) {
 return page.evaluate(()=>{
  const {doctor:d,compare:c,counts}=Reflect.get(window,'lifecycleQA'),root=d.currentAssetRoot;
  const transform=(node:any)=>({uuid:node.uuid,position:node.position.toArray(),quaternion:node.quaternion.toArray(),scale:node.scale.toArray()});const nodes:any[]=[];root.traverse((node:any)=>nodes.push(transform(node)));
  return {counts:structuredClone(counts),frame:d.animationFrameId,active:d.active,disposed:d.disposed,
   state:{root:root.uuid,nodes,wrapper:transform(d.presentationWrapper),camera:{position:d.camera.position.toArray(),quaternion:d.camera.quaternion.toArray(),target:d.cameraController.controls.target.toArray(),near:d.camera.near,far:d.camera.far},
    selected:d.selectedMeshUuid,revision:d.rigSession.revision,mode:d.rigSession.mode,playing:d.isPlayingAnimation,paused:d.activeAnimationAction?.paused,time:d.activeAnimationAction?.time,speed:d.animationSpeed,loop:d.animationLoop,autoRotate:d.isAutoRotating,rotation:d.modelRotationY,index:d.activeClipIndex},
   compare:{active:c.active,frame:c.renderer.info.render.frame,assets:c.assets.map((a:any)=>a.id),playing:c.playing,time:c.slots[0]?.mixer?.time??c.lineup?.roots[0]?.mixer?.time??0}};
 });
}
const counterDelta=(a:any,b:any)=>Object.fromEntries(['renders','draws','mixers','camera','clock','timeline'].map(key=>[key,b[key]-a[key]]));
const zero={renders:0,draws:0,mixers:0,camera:0,clock:0,timeline:0};
async function startDoctor(page:Page) {const play=page.locator('#btn-play-pause-animation');if(await play.getAttribute('title')==='Play')await play.click();await expect(play).toHaveAttribute('title','Pause');}
async function compareWithAssets(page:Page) {
 await page.getByRole('button',{name:'Compare',exact:true}).click();await expect(page.locator('[data-active-view=compare]')).toBeVisible();
 await page.locator('input[type=file][multiple]').setInputFiles(['A','B'].map(name=>({name:name+'.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(rigFixture().buffer)})));
 await expect(page.getByRole('button',{name:'Добавить 2/8',exact:true})).toBeVisible();
 await page.getByTitle('Воспроизведение',{exact:true}).click();
}
async function returnToDoctor(page:Page) {await page.getByTitle('Return to the current Doctor asset without replacing it',{exact:true}).click();await expect(page.locator('[data-active-view=doctor]')).toBeVisible();}

test('F04 hidden Doctor has zero actual draw calls and updates while animated Compare grid and lineup continue',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await open(page);
 await startDoctor(page);await page.getByTitle('Start turntable auto-rotation',{exact:true}).click();
 await expect.poll(async()=> (await snapshot(page)).counts.mixers).toBeGreaterThan(3);expect((await snapshot(page)).counts.draws).toBeGreaterThan(0);
 await compareWithAssets(page);const hidden=await snapshot(page);await page.waitForTimeout(650);const grid=await snapshot(page);
 expect(counterDelta(hidden.counts,grid.counts)).toEqual(zero);expect(grid.state).toEqual(hidden.state);expect(grid.frame).toBeNull();expect(grid.compare.frame).toBeGreaterThan(hidden.compare.frame);expect(grid.compare.time).toBeGreaterThan(hidden.compare.time);
 await page.getByRole('button',{name:'В линейку',exact:true}).click();const lineupStart=await snapshot(page);await page.waitForTimeout(650);const lineup=await snapshot(page);expect(counterDelta(lineupStart.counts,lineup.counts)).toEqual(zero);expect(lineup.state).toEqual(hidden.state);expect(lineup.compare.frame).toBeGreaterThan(lineupStart.compare.frame);
 await returnToDoctor(page);await expect.poll(async()=> (await snapshot(page)).counts.mixers).toBeGreaterThan(lineup.counts.mixers);
 const resumed=await snapshot(page);expect(resumed.state.root).toBe(hidden.state.root);expect(resumed.state.camera).toEqual(hidden.state.camera);expect(resumed.state.index).toBe(hidden.state.index);expect(resumed.state.playing).toBe(true);expect(resumed.state.autoRotate).toBe(true);expect(resumed.state.time-hidden.state.time).toBeLessThan(.3);expect(resumed.counts.deltas.slice(lineup.counts.deltas.length).every((delta:number)=>delta<.3)).toBe(true);expect(Math.max(...Object.values(resumed.counts.frames) as number[])).toBe(1);
 await test.info().attach('F04-playing.json',{body:JSON.stringify({hiddenDelta:counterDelta(hidden.counts,lineup.counts),hiddenTime:hidden.state.time,resumedTime:resumed.state.time,compareFrames:lineup.compare.frame-hidden.compare.frame,maxRendersPerFrame:Math.max(...Object.values(resumed.counts.frames) as number[])}),contentType:'application/json'});expect(errors).toEqual([]);
});

test('F04 repeated Compare visits preserve paused clip, selection, camera and authored rig edits',async({page})=>{
 await open(page);await page.getByLabel('Animation clip',{exact:true}).selectOption('2');await page.getByRole('button',{name:'0.5x',exact:true}).click();await page.getByTitle('Toggle Repeat / Loop',{exact:true}).click();await page.getByRole('button',{name:'Front',exact:true}).click();await startDoctor(page);await expect.poll(async()=> (await snapshot(page)).state.time??0).toBeGreaterThan(.05);await page.locator('#btn-play-pause-animation').click();
 const tree=page.locator('main > aside').first();await tree.getByPlaceholder('Search hierarchy...').fill('Root');await tree.getByTitle('Root',{exact:true}).click();await tree.getByPlaceholder('Search hierarchy...').fill('');
 const paused=await snapshot(page);expect(paused.state.playing).toBe(false);expect(paused.state.paused).toBe(true);expect(paused.state.index).toBe(2);expect(paused.state.speed).toBe(.5);expect(paused.state.loop).toBe(false);expect(paused.state.selected).not.toBeNull();
 await compareWithAssets(page);await page.keyboard.press(' ');await page.keyboard.press('f');expect((await snapshot(page)).state).toEqual(paused.state);const compareIds=(await snapshot(page)).compare.assets;
 for(let visit=0;visit<3;visit++){
  const before=await snapshot(page);await page.waitForTimeout(300);const after=await snapshot(page);expect(counterDelta(before.counts,after.counts)).toEqual(zero);expect(after.state).toEqual(paused.state);
  await returnToDoctor(page);await expect.poll(async()=> (await snapshot(page)).counts.renders).toBeGreaterThan(after.counts.renders);expect((await snapshot(page)).state).toEqual(paused.state);
  await page.getByRole('button',{name:'Compare',exact:true}).click();expect((await snapshot(page)).compare.assets).toEqual(compareIds);
 }
 await returnToDoctor(page);await page.getByRole('button',{name:'Rig',exact:true}).click();await page.getByTestId('rig-mode-edit').click();await page.getByLabel('Export clip duration').fill('8');await page.getByRole('button',{name:'Retime Selected Clip',exact:true}).click();
 const edited=await snapshot(page);expect(edited.state.revision).toBe(1);await page.getByRole('button',{name:'Compare',exact:true}).click();const held=await snapshot(page);await page.waitForTimeout(300);expect((await snapshot(page)).state).toEqual(held.state);await returnToDoctor(page);expect((await snapshot(page)).state).toEqual(edited.state);
 await page.getByRole('button',{name:'Verify Edited GLB',exact:true}).click();await expect(page.getByTestId('rig-export-status')).toContainText('VERIFIED');
 await test.info().attach('F04-paused.json',{body:JSON.stringify({visits:3,root:paused.state.root,pausedTime:paused.state.time,revision:edited.state.revision,compareAssets:compareIds,verified:true}),contentType:'application/json'});
});

test('F04 activity is idempotent, callback suspension stops the current tick, and disposal cannot restart a loop',async({page})=>{
 await open(page);await page.evaluate(()=>{const {doctor:d}=Reflect.get(window,'lifecycleQA');for(let i=0;i<10;i++)d.setActive(false);});
 const hidden=await snapshot(page);await page.waitForTimeout(250);expect(counterDelta(hidden.counts,(await snapshot(page)).counts)).toEqual(zero);
 await page.evaluate(()=>{const {doctor:d}=Reflect.get(window,'lifecycleQA');for(let i=0;i<10;i++)d.setActive(true);});await expect.poll(async()=> (await snapshot(page)).counts.renders).toBeGreaterThan(hidden.counts.renders);
 const single=await snapshot(page);expect(Math.max(...Object.values(single.counts.frames) as number[])).toBe(1);
 const stopped=await page.evaluate(async()=>{const {doctor:d,counts}=Reflect.get(window,'lifecycleQA'),callback=d.callbacks.onAnimationTimeUpdate;d.playAnimationClip(0);d.callbacks.onAnimationTimeUpdate=(...args:any[])=>{callback(...args);d.setActive(false);};const renders=counts.renders;await new Promise(resolve=>setTimeout(resolve,100));d.callbacks.onAnimationTimeUpdate=callback;return {renders,after:counts.renders,frame:d.animationFrameId};});expect(stopped.after).toBe(stopped.renders);expect(stopped.frame).toBeNull();
 const disposed=await page.evaluate(async()=>{const {doctor:d,counts}=Reflect.get(window,'lifecycleQA');d.dispose();d.setActive(true);d.dispose();const renders=counts.renders;await new Promise(resolve=>setTimeout(resolve,100));return {renders,after:counts.renders,frame:d.animationFrameId,connected:d.renderer.domElement.isConnected};});expect(disposed.after).toBe(disposed.renders);expect(disposed.frame).toBeNull();expect(disposed.connected).toBe(false);
});

test('F04 resize and importing a Doctor model behind Compare keep it suspended until a deliberate handoff',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page);await compareWithAssets(page);
 const original=await snapshot(page);await page.setViewportSize({width:1200,height:900});await page.waitForTimeout(200);const resized=await snapshot(page);expect(counterDelta(original.counts,resized.counts)).toEqual(zero);expect(resized.state).toEqual(original.state);
 await page.locator('header input[type=file]').setInputFiles({name:'hidden-import.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(rigFixture({anchorScale:[2,.75,1]}).buffer)});
 await expect.poll(async()=> (await snapshot(page)).state.root).not.toBe(original.state.root);const imported=await snapshot(page);await page.waitForTimeout(350);const held=await snapshot(page);expect(counterDelta(imported.counts,held.counts)).toEqual(zero);expect(held.state).toEqual(imported.state);expect(held.frame).toBeNull();
 await page.getByRole('button',{name:'Doctor · A',exact:true}).click();await expect(page.getByText('A.glb',{exact:true}).filter({visible:true}).first()).toBeVisible();await expect.poll(async()=> (await snapshot(page)).counts.renders).toBeGreaterThan(held.counts.renders);
 const handoff=await snapshot(page);expect(handoff.state.root).not.toBe(imported.state.root);expect(handoff.active).toBe(true);expect(Math.max(...Object.values(handoff.counts.frames) as number[])).toBe(1);
 await page.getByRole('button',{name:'Compare',exact:true}).click();expect((await snapshot(page)).compare.assets).toEqual(original.compare.assets);expect(errors).toEqual([]);
 await test.info().attach('F04-handoff.json',{body:JSON.stringify({hiddenImport:true,resizeDelta:counterDelta(original.counts,resized.counts),hiddenImportDelta:counterDelta(imported.counts,held.counts),comparePreserved:true,handoffActive:handoff.active}),contentType:'application/json'});
});
