import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {metadataFixture} from './runtime-metadata-fixture';
import {largeFixture} from './performance-fixture';

test('F02 export worker decodes bundled Draco offline and verifies repaired normals',async({page})=>{
 const errors:string[]=[],remote:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 const csp=JSON.parse(readFileSync('src-tauri/tauri.conf.json','utf8')).app.security.csp;
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname!=='localhost' && !['data:','blob:'].includes(url.protocol)){remote.push(request.url());await route.abort();return;}
  if(request.isNavigationRequest()){
   const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'content-security-policy':csp}});
  }else await route.continue();
 });
 const model=JSON.parse(readFileSync('tests/browser/fixtures/box-draco.gltf','utf8'));
 model.buffers[0].uri='data:application/octet-stream;base64,'+readFileSync('tests/browser/fixtures/box-draco.bin').toString('base64');
 delete model.meshes[0].primitives[0].attributes.NORMAL;
 delete model.meshes[0].primitives[0].extensions.KHR_draco_mesh_compression.attributes.NORMAL;
 await page.goto('/');await page.locator('header input[type=file]').setInputFiles({name:'draco-normals.gltf',mimeType:'model/gltf+json',buffer:Buffer.from(JSON.stringify(model))});
 await expect(page.getByRole('button',{name:'Run safe queue',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Run safe queue',exact:true}).click();
 await expect(page.getByRole('button',{name:'Build & Verify',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Build & Verify',exact:true}).click();
 await expect(page.getByRole('button',{name:'Download GLB',exact:true})).toBeEnabled();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download GLB',exact:true}).click();
 const stream=await(await download).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
 const buffer=Buffer.concat(chunks),json=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)).toString().trim());
 expect(json.meshes[0].primitives[0].attributes.NORMAL).toBeDefined();
 expect(json.accessors[json.meshes[0].primitives[0].indices].count).toBe(36);
 expect(remote).toEqual([]);expect(errors).toEqual([]);
});

test('F02 actual worker postcheck failure stays PARTIAL, disables Export and preserves Undo',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{
  const Original=window.Worker;let measures=0;
  window.Worker=class extends Original {
   healing:boolean;
   constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.healing=String(url).includes('heal-compute.worker');}
   postMessage(message:any,transfer:any) {
    if(this.healing && message.kind==='measure' && ++measures===2)queueMicrotask(()=>this.dispatchEvent(new ErrorEvent('error',{message:'Forced postcheck failure',cancelable:true})));
    else super.postMessage(message,transfer);
   }
  };
 });
 await page.goto('/');await page.locator('header input[type=file]').setInputFiles({name:'failure.glb',mimeType:'model/gltf-binary',buffer:metadataFixture()});
 await expect(page.getByRole('button',{name:'Run safe queue',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Run safe queue',exact:true}).click();
 await expect(page.getByText('PARTIAL',{exact:true}).first()).toBeVisible();await expect(page.locator('header')).toContainText('2 tri');
 await expect(page.locator('header').getByRole('button',{name:'Export',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:/^Undo ·/}).click();await expect(page.locator('header')).toContainText('3 tri');expect(errors).toEqual([]);
});

test('F02 replacing an asset during worker Preview cancels old plan and leaves new model unchanged',async({page})=>{
 test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.locator('header input[type=file]').setInputFiles({name:'large.glb',mimeType:'model/gltf-binary',buffer:largeFixture()});
 await expect(page.getByRole('button',{name:'Run safe queue',exact:true})).toBeEnabled({timeout:60000});await page.getByRole('button',{name:'Preview next',exact:true}).click();
 await page.locator('header input[type=file]').setInputFiles({name:'replacement.glb',mimeType:'model/gltf-binary',buffer:metadataFixture()});
 await expect(page.getByText('replacement.glb',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Run safe queue',exact:true})).toBeEnabled();
 await expect(page.locator('header')).toContainText('3 tri');await expect(page.getByRole('button',{name:/^Undo ·/})).toHaveCount(0);expect(errors).toEqual([]);
});

test('F02 replacing an asset during worker Export cannot publish or download an old VERIFIED result',async({page})=>{
 test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto('/');
 await page.locator('header input[type=file]').setInputFiles({name:'large.glb',mimeType:'model/gltf-binary',buffer:largeFixture()});
 await expect(page.getByRole('button',{name:'Run safe queue',exact:true})).toBeEnabled({timeout:60000});await page.getByRole('button',{name:'Run safe queue',exact:true}).click();
 await expect(page.getByRole('button',{name:'Build & Verify',exact:true})).toBeEnabled({timeout:60000});await page.getByRole('button',{name:'Build & Verify',exact:true}).click();
 await page.locator('header input[type=file]').setInputFiles({name:'replacement.glb',mimeType:'model/gltf-binary',buffer:metadataFixture()});
 await page.getByRole('button',{name:'Discard and open',exact:true}).click();
 await expect(page.getByText('replacement.glb',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Run safe queue',exact:true})).toBeEnabled();
 await expect(page.locator('header')).toContainText('3 tri');await expect(page.getByRole('button',{name:'Download GLB',exact:true})).toHaveCount(0);expect(errors).toEqual([]);
});
