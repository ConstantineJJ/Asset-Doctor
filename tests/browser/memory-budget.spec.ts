import {test,expect} from '@playwright/test';
import {largeFixture} from './performance-fixture';
import {spawn} from 'node:child_process';
import {writeFile,readFile,unlink} from 'node:fs/promises';
import path from 'node:path';

test('F07 measures owned browser process peaks and binary allocations across heavy operations',async({page,browser})=>{
 test.setTimeout(180000);page.on('dialog',dialog=>dialog.accept());
 const cdp=await page.context().newCDPSession(page),system=await browser.newBrowserCDPSession();
 const pidFile=test.info().outputPath('owned-pids.json'),osFile=test.info().outputPath('process-memory.jsonl');
 const initial=await system.send('SystemInfo.getProcessInfo');
 await writeFile(pidFile,JSON.stringify(initial.processInfo.map(process=>process.id)));
 const sampler=process.platform==='win32'?spawn('pwsh',['-NoProfile','-File',path.resolve('scripts/sample-owned-memory.ps1'),'-PidFile',pidFile,'-OutputFile',osFile],{windowsHide:true,stdio:'ignore'}):null;
 const samples:any[]=[],stages:any[]=[];let active=true,currentStage='idle';
 const observe=(async()=>{while(active){
  try{const heap=await cdp.send('Runtime.getHeapUsage');samples.push({stage:currentStage,timestamp:Date.now(),...heap});
   const processes=await system.send('SystemInfo.getProcessInfo');await writeFile(pidFile,JSON.stringify(processes.processInfo.map(process=>process.id)));
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,40));
 }})();
 const stage=async(name:string,action:()=>Promise<void>)=>{currentStage=name;const started=Date.now();await action();stages.push({name,started,ended:Date.now(),profile:await page.evaluate(()=>Reflect.get(window,'__ASSET_DOCTOR_PERF__')?.memory)});};
 try{
  await page.goto('/');await page.waitForTimeout(500);
  const buffer=largeFixture();
  await stage('import',async()=>{await page.locator('header input[type=file]').setInputFiles({name:'memory-control.glb',mimeType:'model/gltf-binary',buffer});await expect(page.getByRole('button',{name:'Run safe queue',exact:true})).toBeEnabled({timeout:60000});});
  await stage('repair',async()=>{await page.getByRole('button',{name:'Run safe queue',exact:true}).click();await expect(page.getByRole('button',{name:'Build & Verify',exact:true})).toBeEnabled({timeout:60000});});
  await stage('undo',async()=>{await page.getByRole('button',{name:/^Undo ·/}).click();await expect(page.getByRole('button',{name:'Run safe queue',exact:true})).toBeEnabled({timeout:60000});});
  await page.getByRole('button',{name:'Run safe queue',exact:true}).click();await expect(page.getByRole('button',{name:'Build & Verify',exact:true})).toBeEnabled({timeout:60000});
  await stage('export',async()=>{await page.getByRole('button',{name:'Build & Verify',exact:true}).click();await expect(page.getByRole('button',{name:'Download GLB',exact:true})).toBeEnabled({timeout:60000});});
  await page.getByRole('button',{name:'Compare',exact:true}).click();
  const heavyFiles=Array.from({length:8},(_,i)=>test.info().outputPath(`heavy-${i}.glb`));
  await Promise.all(heavyFiles.map(file=>writeFile(file,buffer)));
  await stage('compare-eight',async()=>{await page.locator('input[type=file][multiple]').setInputFiles(heavyFiles);await expect(page.getByRole('button',{name:'Добавить 8/8',exact:true})).toBeVisible({timeout:60000});await page.waitForTimeout(200);});
  await stage('lineup-eight',async()=>{await page.getByRole('button',{name:'В линейку',exact:true}).click();await page.waitForTimeout(300);});
  await test.info().attach('eight-models-lineup.png',{body:await page.screenshot(),contentType:'image/png'});
  await stage('remove-eight',async()=>{for(let i=0;i<8;i++)await page.getByTitle('Удалить из сравнения',{exact:true}).first().click();await expect(page.getByRole('button',{name:'Добавить 0/8',exact:true})).toBeVisible();await page.waitForTimeout(300);});
  expect(samples.length).toBeGreaterThan(5);
 }finally{
  active=false;await Promise.race([observe,new Promise(resolve=>setTimeout(resolve,1000))]);await unlink(pidFile);
  if(sampler)await new Promise<void>(resolve=>{sampler.once('exit',()=>resolve());setTimeout(resolve,3000);});
  const os=process.platform==='win32'?(await readFile(osFile,'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)):[];
  const summary=stages.map(stage=>({...stage,heapPeak:Math.max(0,...samples.filter(sample=>sample.timestamp>=stage.started&&sample.timestamp<=stage.ended).map(sample=>sample.usedSize)),backingPeak:Math.max(0,...samples.filter(sample=>sample.timestamp>=stage.started&&sample.timestamp<=stage.ended).map(sample=>sample.backingStorageSize)),privatePeak:os.length?Math.max(0,...os.filter(sample=>sample.timestamp>=stage.started&&sample.timestamp<=stage.ended).map(sample=>sample.privateBytes)):null}));
  await test.info().attach('memory-peaks.json',{body:JSON.stringify({platform:process.platform,source:'CDP main-page heap/backing storage; sampled owned browser process private bytes (not native WebView2 or VRAM)',summary,samples,os},null,2),contentType:'application/json'});
  await Promise.allSettled([cdp.detach(),system.detach()]);
 }
});
