import {test,expect,type Page} from '@playwright/test';

async function load(page:Page){await page.goto('/');await page.locator('header input[type=file]').setInputFiles('tests/browser/fixtures/two-scenes.glb');await expect(page.getByRole('button',{name:'Rescan',exact:true})).toBeEnabled();}
async function installProbe(page:Page){await page.evaluate(()=>{
 const root=document.getElementById('root')!,attached=Reflect.get(root,Object.keys(root).find(key=>key.startsWith('__reactContainer$'))!),queue=[attached?.stateNode?.current??attached];
 while(queue.length){const fiber=queue.pop();if(!fiber)continue;if(fiber.child)queue.push(fiber.child);if(fiber.sibling)queue.push(fiber.sibling);
  for(let hook=fiber.memoizedState;hook;hook=hook.next){const manager=hook.memoizedState?.current;if(manager?.cameraController&&manager.currentAssetRoot){Reflect.set(window,'reviewViewer',manager);return;}}
 }throw new Error('Doctor unavailable');
});}

test('Review: portrait Doctor Frame and Focus contain every corner of the visible model',async({page})=>{
 await page.setViewportSize({width:1024,height:768});await load(page);await installProbe(page);
 const measurements=await page.evaluate(()=>{
  const manager=Reflect.get(window,'reviewViewer'),camera=manager.camera,root=manager.currentAssetRoot,controller=manager.cameraController;
  // The visible fixture mesh bounds are independent of camera fitting diagnostics.
  const mesh=root.children.find((node:any)=>node.isMesh),box=mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
  const corners=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(camera.position.clone().set(x,y,z));
  const result:Record<string,number>={};
  for(const [name,frame] of Object.entries({frame:()=>controller.frameObject(root),raw:()=>controller.frameRawBounds(root),focus:()=>controller.focusSelectedObject(mesh)})){
   frame();camera.updateMatrixWorld(true);result[name]=Math.max(...corners.map(point=>{const p=point.clone().project(camera);return Math.max(Math.abs(p.x),Math.abs(p.y));}));
  }return result;
 });
 await test.info().attach('review-framing.json',{body:JSON.stringify(measurements),contentType:'application/json'});
 for(const [method,maximum]of Object.entries(measurements))expect(maximum,method).toBeLessThanOrEqual(1);
 await page.evaluate(()=>{const viewer=Reflect.get(window,'reviewViewer');viewer.cameraController.frameObject(viewer.currentAssetRoot);});
 await test.info().attach('review-frame-small.png',{body:await page.screenshot(),contentType:'image/png'});
});

test('Review: Doctor import curtain ignores internal drags and clears on cancellation',async({page})=>{
 await load(page);const viewport=page.locator('[data-active-view=doctor]'),curtain=page.getByText('Drop GLB / GLTF Asset Here',{exact:true});
 const internal=await page.evaluateHandle(()=>{const data=new DataTransfer();data.setData('text/plain','model label');return data;});
 await viewport.dispatchEvent('dragover',{dataTransfer:internal});await expect(curtain).toHaveCount(0);
 const files=await page.evaluateHandle(()=>{const data=new DataTransfer();data.items.add(new File(['x'],'test.glb'));return data;});
 await viewport.dispatchEvent('dragover',{dataTransfer:files});await expect(curtain).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('dragend')));await expect(curtain).toHaveCount(0);
 await viewport.dispatchEvent('dragover',{dataTransfer:files});await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(curtain).toHaveCount(0);
 await viewport.dispatchEvent('dragover',{dataTransfer:files});await page.keyboard.press('Escape');await expect(curtain).toHaveCount(0);
});

test('Review: portrait Compare Grid and Lineup frame every model corner',async({page})=>{
 await page.setViewportSize({width:1024,height:768});await load(page);await page.getByRole('button',{name:'Compare',exact:true}).click();
 await page.locator('input[type=file][multiple]').setInputFiles('tests/browser/fixtures/two-scenes.glb');
 await expect(page.getByRole('button',{name:/Добавить 1\/8/})).toBeVisible();
 const measurements=await page.evaluate(()=>{
  const root=document.getElementById('root')!,attached=Reflect.get(root,Object.keys(root).find(key=>key.startsWith('__reactContainer$'))!),queue=[attached?.stateNode?.current??attached];let manager:any;
  while(queue.length){const fiber=queue.pop();if(!fiber)continue;if(fiber.child)queue.push(fiber.child);if(fiber.sibling)queue.push(fiber.sibling);for(let hook=fiber.memoizedState;hook;hook=hook.next){const value=hook.memoizedState?.current;if(value?.renderer&&value?.assets)manager=value;}}
  if(!manager)throw new Error('Compare unavailable');const result:Record<string,number>={};
  const measure=(bounds:any,camera:any)=>{camera.updateMatrixWorld(true);let maximum=0;for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const point=camera.position.clone().set(x,y,z).project(camera);maximum=Math.max(maximum,Math.abs(point.x),Math.abs(point.y));}return maximum;};
  manager.resetCameras();result.grid=measure(manager.slots[0].bounds,manager.slots[0].camera);
  manager.setViewMode('lineup');manager.resetCameras();result.lineup=measure(manager.lineup.bounds,manager.lineup.camera);return result;
 });
 await test.info().attach('review-compare-framing.json',{body:JSON.stringify(measurements),contentType:'application/json'});
 for(const [view,maximum]of Object.entries(measurements))expect(maximum,view).toBeLessThanOrEqual(1);
});
