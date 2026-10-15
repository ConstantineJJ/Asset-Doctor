import {test,expect} from '@playwright/test';
import {rigFixture} from '../rig-fixtures';

test('F07 oversized native selection leaves existing Compare models intact without reading bytes',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Compare',exact:true}).click();
 const buffer=Buffer.from(rigFixture().buffer);
 await page.locator('input[type=file][multiple]').setInputFiles({name:'kept.glb',mimeType:'model/gltf-binary',buffer});
 await expect(page.getByRole('button',{name:'Добавить 1/8',exact:true})).toBeVisible();
 await page.evaluate(()=>{
  Reflect.set(globalThis,'isTauri',true);Reflect.set(window,'oversizedReads',0);
  Reflect.set(window,'__TAURI_INTERNALS__',{invoke:async(command:string)=>{
   if(command==='startup_mark')return;
   if(command==='plugin:dialog|open')return ['C:/huge.glb'];
   if(command==='plugin:fs|stat')return {size:1024*1024*1024};
   if(command==='plugin:fs|read_file'){Reflect.set(window,'oversizedReads',Reflect.get(window,'oversizedReads')+1);throw new Error('Must not read');}
   throw new Error(command);
  }});
 });
 await page.getByRole('button',{name:'Добавить 1/8',exact:true}).click();
 await expect(page.getByText(/Operation exceeds the memory limit/)).toBeVisible();
 expect(await page.evaluate(()=>Reflect.get(window,'oversizedReads'))).toBe(0);
 await expect(page.getByRole('button',{name:'Добавить 1/8',exact:true})).toBeVisible();
 await expect(page.locator('span[title="kept.glb"]').first()).toBeVisible();
});

test('F07 eight Lineup cards keep their remove controls individually reachable',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Compare',exact:true}).click();
 const buffer=Buffer.from(rigFixture().buffer);
 await page.locator('input[type=file][multiple]').setInputFiles(Array.from({length:8},(_,i)=>({name:`slot-${i}.glb`,mimeType:'model/gltf-binary',buffer})));
 await expect(page.getByRole('button',{name:'Добавить 8/8',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'В линейку',exact:true}).click();
 await page.getByTitle('Удалить из сравнения',{exact:true}).first().click({timeout:2000});
 await expect(page.getByRole('button',{name:'Добавить 7/8',exact:true})).toBeVisible();
});

test('F07 native Compare reads only a free slot and ignores a concurrent external drop',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Compare',exact:true}).click();
 const buffer=Buffer.from(rigFixture().buffer);
 await page.locator('input[type=file][multiple]').setInputFiles(Array.from({length:7},(_,i)=>({name:`slot-${i}.glb`,mimeType:'model/gltf-binary',buffer})));
 await expect(page.getByRole('button',{name:'Добавить 7/8',exact:true})).toBeVisible();
 await page.evaluate(bytes=>{
  Reflect.set(globalThis,'isTauri',true);Reflect.set(window,'nativeReads',[]);
  Reflect.set(window,'__TAURI_INTERNALS__',{invoke:async(command:string,args:any)=>{
   if(command==='startup_mark')return;
   if(command==='plugin:dialog|open')return new Promise(resolve=>Reflect.set(window,'releaseNativePicker',()=>resolve(Array.from({length:5},(_,i)=>`C:/picked-${i}.glb`))));
   if(command==='plugin:fs|stat')return {size:bytes.length};
   if(command==='plugin:fs|read_file'){Reflect.get(window,'nativeReads').push(args.path);return new Uint8Array(bytes).buffer;}
   throw new Error('Unexpected native command: '+command);
  }});
 },Array.from(buffer));
 await page.getByRole('button',{name:'Добавить 7/8',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>typeof Reflect.get(window,'releaseNativePicker'))).toBe('function');
 await page.locator('input[type=file][multiple]').setInputFiles({name:'concurrent.glb',mimeType:'model/gltf-binary',buffer});
 await page.evaluate(()=>Reflect.get(window,'releaseNativePicker')());
 await expect(page.getByRole('button',{name:'Добавить 8/8',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>Reflect.get(window,'nativeReads'))).toEqual(['C:/picked-0.glb']);
 await expect(page.locator('span[title="concurrent.glb"]')).toHaveCount(0);
 await expect(page.getByText(/Пропущено файлов: 4/)).toBeVisible();
});
