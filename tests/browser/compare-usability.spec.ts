import {test,expect,type Page} from '@playwright/test';
import {rigFixture} from '../rig-fixtures';
import {readFile} from 'node:fs/promises';

async function openCompare(page:Page){
 await page.goto('/');await page.getByRole('button',{name:'Compare',exact:true}).click();
 await page.locator('input[type=file][multiple]').setInputFiles(['A','B'].map(name=>({name:name+'.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(rigFixture().buffer)})));
 await expect(page.getByRole('button',{name:'Добавить 2/8',exact:true})).toBeVisible();
}
test('Internal model-card reorder never activates the file import curtain',async({page})=>{
 await openCompare(page);const cards=page.locator('[draggable=true]');
 await cards.first().evaluate(node=>{const dataTransfer=new DataTransfer();dataTransfer.setData('text/plain','0');dataTransfer.setData('application/x-asset-doctor-compare','0');node.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer}));});
 await expect(page.getByText(/Перетащите модели в мульти-обзор/)).not.toBeVisible();
 await cards.first().locator('span[title]').first().dragTo(cards.last().locator('span[title]').first());
 await expect(cards.first().locator('span[title]').first()).toHaveAttribute('title','B.glb');
 await expect(page.getByText(/Перетащите модели в мульти-обзор/)).not.toBeVisible();
});
test('Public Fox rigs remain visible in Lineup with model rotation and size changes',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Compare',exact:true}).click();
 const buffer=await readFile('tests/browser/fixtures/Fox.glb');
 await page.locator('input[type=file][multiple]').setInputFiles(['Fox-A','Fox-B'].map(name=>({name:name+'.glb',mimeType:'model/gltf-binary',buffer})));
 await expect(page.getByRole('button',{name:'Добавить 2/8',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'В линейку',exact:true}).click();await page.getByTitle('Toggle Skeletal Armature',{exact:true}).click();
 await page.evaluate(()=>{
  const container=document.getElementById('root')!,key=Object.keys(container).find(k=>k.startsWith('__reactContainer$'))!,attached=Reflect.get(container,key),queue=[attached?.stateNode?.current??attached];let manager:any;
  while(queue.length){const fiber=queue.pop();if(!fiber)continue;if(fiber.child)queue.push(fiber.child);if(fiber.sibling)queue.push(fiber.sibling);for(let hook=fiber.memoizedState;hook;hook=hook.next){const value=hook.memoizedState?.current;if(value?.renderer&&value.assets)manager=value;}}
  if(!manager)throw new Error('Actual Compare manager required');
  manager.setModelRotation(37);manager.setManualScale(manager.assets[0].id,1.25,true);manager.setPlaying(true);
  Reflect.set(window,'foxRigQA',manager);
 });
 await expect.poll(()=>page.evaluate(()=>{
  const manager=Reflect.get(window,'foxRigQA');
  if(!manager.lineup?.roots?.length)return Infinity;
  return Math.max(...manager.lineup.roots.map((entry:any)=>{
   const rig=entry.rigOverlay,positions=rig.points.geometry.attributes.position;
   if(!rig.group.visible||rig.bones.length<10)return Infinity;
   return Math.max(...rig.bones.map((bone:any,index:number)=>{const matrix=bone.matrixWorld.elements;return Math.hypot(matrix[12]-positions.getX(index),matrix[13]-positions.getY(index),matrix[14]-positions.getZ(index));}));
  }));
 })).toBeLessThan(1e-4);
 await page.waitForTimeout(180);await page.evaluate(()=>Reflect.get(window,'foxRigQA').setPlaying(false));
 await test.info().attach('fox-lineup-rig.png',{body:await page.screenshot(),contentType:'image/png'});
});
test('Application menu opens working settings and restores keyboard focus',async({page})=>{
 await openCompare(page);await page.getByRole('button',{name:'Application menu',exact:true}).click();
 await expect(page.getByRole('menuitem',{name:'Exit',exact:true})).toBeDisabled();
 await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitem',{name:'Settings',exact:true})).toBeFocused();
 await test.info().attach('application-menu.png',{body:await page.screenshot(),contentType:'image/png'});
 await page.getByRole('menuitem',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Settings',exact:true});await expect(dialog).toBeVisible();
 await dialog.getByLabel('Skeleton in Doctor and Compare').check();await expect(page.getByTitle('Toggle Skeletal Armature',{exact:true})).toHaveAttribute('aria-pressed','true');
 await dialog.getByLabel('Interface language').selectOption('ru');await expect(page.getByRole('dialog',{name:'Настройки',exact:true})).toBeVisible();
 await test.info().attach('settings-ru.png',{body:await page.screenshot(),contentType:'image/png'});
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.getByRole('button',{name:'Меню приложения',exact:true})).toBeFocused();
});
test('External file curtain clears on cancelled drag, window blur and completed import',async({page})=>{
 await openCompare(page);
 const curtain=page.getByText(/Перетащите модели в мульти-обзор/);
 const dragFiles=()=>page.locator('input[type=file][multiple]').evaluate(input=>{
  const dataTransfer=new DataTransfer();dataTransfer.items.add(new File(['placeholder'],'external.glb'));
  input.parentElement!.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer}));
 });
 await dragFiles();await expect(curtain).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('dragend')));await expect(curtain).not.toBeVisible();
 await dragFiles();await expect(curtain).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(curtain).not.toBeVisible();
 await dragFiles();await expect(curtain).toBeVisible();
 await page.locator('input[type=file][multiple]').evaluate((input,bytes)=>{
  const dataTransfer=new DataTransfer();dataTransfer.items.add(new File([new Uint8Array(bytes)],'C.glb',{type:'model/gltf-binary'}));
  input.parentElement!.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));
 },Array.from(new Uint8Array(rigFixture().buffer)));
 await expect(page.getByRole('button',{name:'Добавить 3/8',exact:true})).toBeVisible();await expect(curtain).not.toBeVisible();
});
test('Skeleton toggle controls actual animated Lineup and Grid overlays',async({page})=>{
 await openCompare(page);await page.getByRole('button',{name:'В линейку',exact:true}).click();await page.getByTitle('Toggle Skeletal Armature',{exact:true}).click();
 const state=()=>page.evaluate(()=>{
  const container=document.getElementById('root')!,key=Object.keys(container).find(k=>k.startsWith('__reactContainer$'))!,attached=Reflect.get(container,key),queue=[attached?.stateNode?.current??attached];let manager:any;
  while(queue.length){const fiber=queue.pop();if(!fiber)continue;if(fiber.child)queue.push(fiber.child);if(fiber.sibling)queue.push(fiber.sibling);for(let hook=fiber.memoizedState;hook;hook=hook.next){const value=hook.memoizedState?.current;if(value?.renderer&&value.assets)manager=value;}}
  if(!manager)throw new Error('Actual Compare manager required');
  const scenes=manager.lineup?[manager.lineup.scene]:manager.slots.map((slot:any)=>slot.scene);const groups:any[]=[];
  scenes.forEach((scene:any)=>scene.traverse((node:any)=>{if(node.name==='__ascope_internal_compare_rig')groups.push({visible:node.visible,points:node.children.find((child:any)=>child.isPoints)?.geometry.attributes.position.count});}));
  const entries=manager.lineup?manager.lineup.roots:manager.slots;
  const errors=entries.map((entry:any)=>{
   const rig=entry.rigOverlay,positions=rig.points.geometry.attributes.position;
   return Math.max(0,...rig.bones.map((bone:any,index:number)=>{const matrix=bone.matrixWorld.elements;return Math.hypot(matrix[12]-positions.getX(index),matrix[13]-positions.getY(index),matrix[14]-positions.getZ(index));}));
  });
  const coordinates=entries.flatMap((entry:any)=>Array.from(entry.rigOverlay.points.geometry.attributes.position.array));
  return {groups,errors,coordinates,memory:{...manager.renderer.info.memory}};
 });
 await expect.poll(async()=>(await state()).groups.filter((group:any)=>group.visible).length).toBe(2);
 await expect.poll(async()=>Math.max(...(await state()).errors)).toBeLessThan(1e-5);
 const initial=(await state()).coordinates;
 await page.getByTitle('Воспроизведение',{exact:true}).click();await page.waitForTimeout(160);await page.getByTitle('Пауза',{exact:true}).click();
 expect((await state()).coordinates).not.toEqual(initial);await expect.poll(async()=>Math.max(...(await state()).errors)).toBeLessThan(1e-5);
 await test.info().attach('lineup-rig.png',{body:await page.screenshot(),contentType:'image/png'});
 await page.getByRole('button',{name:'Сетка',exact:true}).click();await expect.poll(async()=>(await state()).groups.filter((group:any)=>group.visible).length).toBe(2);
 await page.getByTitle('Toggle Skeletal Armature',{exact:true}).click();await expect.poll(async()=>(await state()).groups.every((group:any)=>!group.visible)).toBe(true);
 await page.getByRole('button',{name:'В линейку',exact:true}).click();await expect.poll(async()=>(await state()).groups.every((group:any)=>!group.visible)).toBe(true);
 await page.getByTitle('Удалить из сравнения',{exact:true}).first().click();await page.getByTitle('Удалить из сравнения',{exact:true}).first().click();
 await expect.poll(async()=>(await state()).memory.geometries).toBe(0);
});
