import {test,expect} from '@playwright/test';
import {rigFixture} from '../rig-fixtures';
test('Owner floor tiles render offline in Doctor and Compare and release after switching',async({page})=>{
 const failures:string[]=[],tiles:string[]=[];
 page.on('pageerror',error=>failures.push(error.message));page.on('response',response=>{if(response.url().includes('/tiles/')){tiles.push(response.url());expect(response.ok()).toBeTruthy();}});
 await page.goto('/');await page.locator('header input[type=file]').setInputFiles({name:'rig.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(rigFixture().buffer)});
 await page.getByRole('button',{name:'Ground surface',exact:true}).click();
 await expect(page.getByRole('button',{name:'Forest floor',exact:true})).toBeVisible({timeout:2000});
 await page.getByRole('button',{name:'Forest floor',exact:true}).click();
 await expect.poll(()=>tiles.some(url=>url.endsWith('Forest_floor_2.png'))).toBeTruthy();
 await expect.poll(()=>page.evaluate(()=>{
  const root=document.getElementById('root')!,key=Object.keys(root).find(key=>key.startsWith('__reactContainer$'))!,attached=Reflect.get(root,key),queue=[attached?.stateNode?.current??attached];
  while(queue.length){const fiber=queue.pop();if(!fiber)continue;if(fiber.child)queue.push(fiber.child);if(fiber.sibling)queue.push(fiber.sibling);
   for(let hook=fiber.memoizedState;hook;hook=hook.next){const viewer=hook.memoizedState?.current;if(viewer?.renderer&&viewer.currentAssetRoot)return viewer.scene.getObjectByName('__ascope_internal_surface')?.material.map?.image?.width??0;}}
  return 0;
 })).toBe(2048);
 await test.info().attach('forest-floor.png',{body:await page.screenshot(),contentType:'image/png'});
 await page.getByRole('button',{name:'Compare',exact:true}).click();
 await page.locator('input[type=file][multiple]').setInputFiles({name:'compare.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(rigFixture().buffer)});
 await expect(page.getByRole('button',{name:'Добавить 1/8',exact:true})).toBeVisible();
 const ground=page.getByTitle('Выбор поверхности пола',{exact:true});await ground.selectOption('grass');
 await expect.poll(()=>tiles.some(url=>url.endsWith('T3D_Green_Grass.png'))).toBeTruthy();
 await ground.selectOption('grid');await expect(ground).toHaveValue('grid');
 expect(failures).toEqual([]);expect(tiles.every(url=>new URL(url).origin==='http://localhost:3000')).toBeTruthy();
});
