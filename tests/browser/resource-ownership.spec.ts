import {test,expect,type Page} from '@playwright/test';
import {rigFixture} from '../rig-fixtures';

function resourceFile(name:string) {
 const data=Buffer.concat([Buffer.from(new Float32Array([-1,0,0,1,0,0,0,2,0]).buffer),Buffer.from(new Float32Array([0,0,1,0,.5,1]).buffer)]);
 const primitive=(mode:number)=>({mode,attributes:{POSITION:0,TEXCOORD_0:1},material:0});
 const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[primitive(4),primitive(1),primitive(0)]}],
  buffers:[{byteLength:data.length,uri:'data:application/octet-stream;base64,'+data.toString('base64')}],bufferViews:[{buffer:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:24}],
  accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,0,0],max:[1,2,0]},{bufferView:1,componentType:5126,count:3,type:'VEC2'}],
  images:[{uri:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGNk+P//PwMDAwMTiABhAC0JAwH/z0fuAAAAAElFTkSuQmCC'}],textures:[{source:0},{source:0}],
  extensionsUsed:['KHR_materials_clearcoat','KHR_materials_transmission'],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}},extensions:{KHR_materials_clearcoat:{clearcoatFactor:1,clearcoatTexture:{index:1}},KHR_materials_transmission:{transmissionFactor:.2,transmissionTexture:{index:1}}}}]};
 return {name,mimeType:'model/gltf+json',buffer:Buffer.from(JSON.stringify(json))};
}
async function managers(page:Page) {
 await page.evaluate(()=>{
  const container=document.getElementById('root')!,key=Object.keys(container).find(k=>k.startsWith('__reactContainer$'))!,attached=Reflect.get(container,key),queue=[attached?.stateNode?.current??attached];let doctor:any,compare:any;
  while(queue.length){const fiber=queue.pop();if(!fiber)continue;if(fiber.child)queue.push(fiber.child);if(fiber.sibling)queue.push(fiber.sibling);for(let hook=fiber.memoizedState;hook;hook=hook.next){const value=hook.memoizedState?.current;if(!value?.renderer)continue;if(value.cameraController)doctor=value;else if(value.assets)compare=value;}}
  if(!doctor||!compare)throw new Error('Actual Doctor and Compare managers required');Reflect.set(window,'resourceQA',{doctor,compare});
 });
}
async function snapshot(page:Page) {
 return page.evaluate(()=>{
  const qa=Reflect.get(window,'resourceQA'),bitmap=Reflect.get(window,'bitmapQA');
  const counter=(m:any)=>({...m.renderer.info.memory,programs:m.renderer.info.programs.length});
  let dfg=false;qa.doctor.scene.traverse((node:any)=>{for(const material of Array.isArray(node.material)?node.material:[node.material])if(material && qa.doctor.renderer.properties.get(material).uniforms?.dfgLUT?.value?.name==='DFG_LUT')dfg=true;});
  return {doctor:counter(qa.doctor),compare:counter(qa.compare),materials:qa.doctor.renderModeManager.originalMaterials.size,dfg,contextLost:qa.doctor.renderer.getContext().isContextLost(),bitmap:{...bitmap}};
 });
}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  const counts={created:0,closed:0,duplicateClose:0};Reflect.set(window,'bitmapQA',counts);
  const create=window.createImageBitmap.bind(window);
  window.createImageBitmap=(...args:any[])=>Reflect.apply(create,window,args).then((bitmap:ImageBitmap)=>{
   counts.created++;const close=bitmap.close.bind(bitmap);let closed=false;
   bitmap.close=()=>{if(closed)counts.duplicateClose++;else counts.closed++;closed=true;close();};return bitmap;
  });
 });
 await page.goto('/');await managers(page);
});
test('F06 Doctor replacement releases Mesh/Line/Points, advanced textures and authored references',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const proof:any[]=[];
 for(let cycle=0;cycle<7;cycle++) {
  await page.locator('header input[type=file]').setInputFiles(resourceFile(`resources-${cycle}.gltf`));
  await expect(page.getByText(`resources-${cycle}.gltf`,{exact:true}).first()).toBeVisible();
  await page.waitForTimeout(140);const loaded=await snapshot(page);expect(loaded.doctor.geometries).toBeGreaterThan(0);expect(loaded.bitmap.created).toBeGreaterThan(cycle);expect(loaded.dfg).toBe(true);
  await page.evaluate(()=>Reflect.get(window,'resourceQA').doctor.disposeCurrentAsset());
  await page.waitForTimeout(100);const cleaned=await snapshot(page);proof.push({cycle,loaded,cleaned});
  expect(cleaned.materials).toBe(0);expect(cleaned.bitmap.closed).toBe(cleaned.bitmap.created);expect(cleaned.bitmap.duplicateClose).toBe(0);
  if(cycle>0)expect(cleaned.doctor).toEqual(proof[0].cleaned.doctor);
  expect(loaded.doctor.geometries).toBeGreaterThan(cleaned.doctor.geometries);
 }
 await page.evaluate(()=>Reflect.get(window,'resourceQA').doctor.dispose());
 await expect.poll(async()=>(await snapshot(page)).contextLost).toBe(true);
 const disposed=await snapshot(page);expect(disposed.doctor.geometries).toBe(0);expect(disposed.doctor.textures).toBe(1); // r186 library-owned DFG LUT counter survives renderer disposal.
 expect(errors).toEqual([]);await test.info().attach('doctor-resource-cycles.json',{body:JSON.stringify({proof,disposed},null,2),contentType:'application/json'});
});
test('F06 Compare Grid/Lineup rebuilds keep borrowed images alive and release after removal',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'Compare',exact:true}).click();const proof:any[]=[];
 for(let cycle=0;cycle<6;cycle++) {
  await page.locator('input[type=file][multiple]').setInputFiles([resourceFile(`A-${cycle}.gltf`),resourceFile(`B-${cycle}.gltf`)]);
  await expect(page.getByRole('button',{name:'Добавить 2/8',exact:true})).toBeVisible();await page.waitForTimeout(120);
  const loaded=await snapshot(page),alive=loaded.bitmap.created-loaded.bitmap.closed;expect(alive).toBe(2);
  for(let switchIndex=0;switchIndex<3;switchIndex++){
   await page.getByRole('button',{name:'В линейку',exact:true}).click();await page.waitForTimeout(60);
   expect((await snapshot(page)).bitmap.created-(await snapshot(page)).bitmap.closed).toBe(alive);
   await page.getByRole('button',{name:'Сетка',exact:true}).click();await page.waitForTimeout(60);
  }
  await page.getByTitle('Удалить из сравнения',{exact:true}).first().click();await page.getByTitle('Удалить из сравнения',{exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Добавить 0/8',exact:true})).toBeVisible();await page.waitForTimeout(100);
  const cleaned=await snapshot(page);proof.push({cycle,loaded,cleaned});expect(cleaned.bitmap.closed).toBe(cleaned.bitmap.created);expect(cleaned.bitmap.duplicateClose).toBe(0);
  if(cycle>0)expect(cleaned.compare).toEqual(proof[0].cleaned.compare);
 }
 expect(errors).toEqual([]);await test.info().attach('compare-resource-cycles.json',{body:JSON.stringify(proof,null,2),contentType:'application/json'});
});
test('F06 actual animated skeleton GPU bone textures release on repeated replacement',async({page})=>{
 const proof:any[]=[];
 for(let cycle=0;cycle<5;cycle++) {
  await page.locator('header input[type=file]').setInputFiles({name:`skeleton-${cycle}.glb`,mimeType:'model/gltf-binary',buffer:Buffer.from(rigFixture().buffer)});
  await expect(page.getByText(`skeleton-${cycle}.glb`,{exact:true}).first()).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>{
   let ready=false;Reflect.get(window,'resourceQA').doctor.currentAssetRoot?.traverse((node:any)=>{if(node.isSkinnedMesh && node.skeleton.boneTexture)ready=true;});return ready;
  })).toBe(true);
  const loaded=await snapshot(page);
  const released=await page.evaluate(()=>{
   const doctor=Reflect.get(window,'resourceQA').doctor,skeletons=new Set<any>();doctor.currentAssetRoot.traverse((node:any)=>{if(node.isSkinnedMesh)skeletons.add(node.skeleton);});let disposed=0;
   for(const skeleton of skeletons)skeleton.boneTexture.addEventListener('dispose',()=>disposed++);
   doctor.disposeCurrentAsset();return {expected:skeletons.size,disposed,allNull:[...skeletons].every(skeleton=>skeleton.boneTexture===null)};
  });
  await page.waitForTimeout(80);const cleaned=await snapshot(page);proof.push({cycle,loaded,released,cleaned});
  expect(released.expected).toBeGreaterThan(0);expect(released.disposed).toBe(released.expected);expect(released.allNull).toBe(true);
  expect(loaded.doctor.textures).toBeGreaterThan(cleaned.doctor.textures);if(cycle>0)expect(cleaned.doctor).toEqual(proof[0].cleaned.doctor);
 }
 await test.info().attach('skeleton-resource-cycles.json',{body:JSON.stringify(proof,null,2),contentType:'application/json'});
});
