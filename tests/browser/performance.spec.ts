import {test,expect} from '@playwright/test';
import {largeFixture} from './performance-fixture';

test('F02 500001-triangle Repair / Undo / Export preserves fidelity within 100 ms main-thread budget',async({page})=>{
 test.setTimeout(180000);page.on('dialog',d=>d.accept());await page.goto('/');
 await page.locator('header input[type=file]').setInputFiles({name:'control-500001.glb',mimeType:'model/gltf-binary',buffer:largeFixture()});
 await expect(page.getByRole('button',{name:'Run safe queue',exact:true})).toBeEnabled({timeout:60000});
 const begin=async()=>page.evaluate(()=>{
  Reflect.get(window,'budgetObserver')?.disconnect();Reflect.set(window,'budgetTasks',[]);
  const observer=new PerformanceObserver(list=>Reflect.get(window,'budgetTasks').push(...list.getEntries().map(e=>e.duration)));
  observer.observe({type:'longtask',buffered:false});Reflect.set(window,'budgetObserver',observer);
 });
 const finish=async(stage:string)=>{
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));
  const durations:number[]=await page.evaluate(()=>Reflect.get(window,'budgetTasks'));
  await test.info().attach(stage+'-long-tasks',{body:JSON.stringify(durations),contentType:'application/json'});
  expect(Math.max(0,...durations),stage+' maximum continuous blocking').toBeLessThanOrEqual(100);
 };
 await begin();await page.getByRole('button',{name:'Run safe queue',exact:true}).click();
 await expect(page.getByRole('button',{name:'Build & Verify',exact:true})).toBeEnabled({timeout:60000});await finish('repair');
 await expect(page.locator('header')).toContainText(/500\s?000 tri/);
 await begin();await page.getByRole('button',{name:/^Undo ·/}).click();
 await expect(page.getByRole('button',{name:'Run safe queue',exact:true})).toBeEnabled({timeout:60000});await finish('undo');
 await expect(page.locator('header')).toContainText(/500\s?001 tri/);
 await page.getByRole('button',{name:'Run safe queue',exact:true}).click();await expect(page.getByRole('button',{name:'Build & Verify',exact:true})).toBeEnabled({timeout:60000});
 await begin();await page.getByRole('button',{name:'Build & Verify',exact:true}).click();
 await expect(page.getByRole('button',{name:'Download GLB',exact:true})).toBeEnabled({timeout:60000});await finish('export');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download GLB',exact:true}).click();
 const stream=await(await download).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
 const output=Buffer.concat(chunks),json=JSON.parse(output.subarray(20,20+output.readUInt32LE(12)).toString().trim());
 expect(json.extras.ownerNote).toBe('Preserve document');expect(json.accessors[json.meshes[0].primitives[0].indices].count).toBe(1500000);
 await page.locator('header input[type=file]').setInputFiles({name:'control-reopened.glb',mimeType:'model/gltf-binary',buffer:output});
 await page.getByRole('button',{name:'Discard and open',exact:true}).click();await expect(page.getByText('control-reopened.glb',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Rescan',exact:true})).toBeEnabled({timeout:60000});await expect(page.locator('header')).toContainText(/500\s?000 tri/);
});
