import {test,expect} from '@playwright/test';
import {rigFixture} from '../rig-fixtures';
import {readFile,writeFile,stat,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';

const corpora=[
 ['Burunduk_Run_Game_Loop_37clips.glb','Cloth5.glb','Weapon1.glb','Burunduk2_animated19_Q_5K.glb','cute+creature+3d+model.glb','Cloth_capushon_Q_554.glb','Burunduk_Run_Game_Loop_37clips.glb','Cloth_kimono_542.glb'],
 ['Burunduk_Run_Game_Loop_37clips.glb','Cloth5.glb','Weapon1.glb','Burunduk2_animated19_Q_5K.glb','cute+creature+3d+model.glb','Cloth_kimono_542.glb','Burunduk_Run_Game_Loop_37clips.glb','Cloth_capushon_Q_554.glb'],
];
const sizes:Record<string,number>={'Burunduk_Run_Game_Loop_37clips.glb':13016976,'Cloth5.glb':19681044,'Weapon1.glb':18478888,'Burunduk2_animated19_Q_5K.glb':25719772,'cute+creature+3d+model.glb':22203624,'Cloth_capushon_Q_554.glb':29858524,'Cloth_kimono_542.glb':16139988};

// Valid unreferenced BIN storage reproduces source retention independently of GPU size.
function sizedFixture(size:number){
 const original=Buffer.from(rigFixture().buffer),jsonLength=original.readUInt32LE(12);
 const json=JSON.parse(original.subarray(20,20+jsonLength).toString());
 const bin=original.subarray(28+jsonLength);
 json.buffers[0].byteLength=size-bin.byteLength;
 let jsonBytes=Buffer.from(JSON.stringify(json));
 const binarySize=size-28-Math.ceil(jsonBytes.length/4)*4;
 json.buffers[0].byteLength=binarySize;
 jsonBytes=Buffer.from(JSON.stringify(json));
 const paddedJson=Math.ceil(jsonBytes.length/4)*4,output=Buffer.alloc(28+paddedJson+binarySize);
 output.writeUInt32LE(0x46546c67,0);output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);
 output.writeUInt32LE(paddedJson,12);output.writeUInt32LE(0x4e4f534a,16);output.fill(32,20,20+paddedJson);jsonBytes.copy(output,20);
 output.writeUInt32LE(binarySize,20+paddedJson);output.writeUInt32LE(0x004e4942,24+paddedJson);bin.copy(output,28+paddedJson);
 return output;
}

for(const [index,names] of corpora.entries())test(`F07 Compare accepts eight mixed sources crossing the old cap at slot ${index===0?7:8}`,async({page,browser})=>{
 test.setTimeout(180000);
 const privateRoot=process.env.ASSET_DOCTOR_PRIVATE_COMPARE_DIR;
 const files:string[]=[],before:string[]=[];
 for(const [slot,name] of names.entries()){
  const file=privateRoot?path.join(privateRoot,name):test.info().outputPath(`${slot}-${name}`);
  if(!privateRoot)await writeFile(file,sizedFixture(sizes[name]));
  files.push(file);before.push(createHash('sha256').update(await readFile(file)).digest('hex'));
 }
 const sourceBytes=await Promise.all(files.map(async file=>(await stat(file)).size));
 expect(sourceBytes.slice(0,index===0?6:7).reduce((a,b)=>a+b,0)).toBeLessThanOrEqual(128*1024*1024);
 expect(sourceBytes.slice(0,index===0?7:8).reduce((a,b)=>a+b,0)).toBeGreaterThan(128*1024*1024);
 const system=await browser.newBrowserCDPSession(),pidFile=test.info().outputPath('owned-pids.json'),osFile=test.info().outputPath('process-memory.jsonl');
 await writeFile(pidFile,JSON.stringify((await system.send('SystemInfo.getProcessInfo')).processInfo.map(p=>p.id)));
 const sampler=process.platform==='win32'?spawn('pwsh',['-NoProfile','-File',path.resolve('scripts/sample-owned-memory.ps1'),'-PidFile',pidFile,'-OutputFile',osFile],{windowsHide:true,stdio:'ignore'}):null;
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto('/');await page.getByRole('button',{name:'Compare',exact:true}).click();
  await page.locator('input[type=file][multiple]').setInputFiles(files);
  await expect(page.getByRole('button',{name:'Добавить 8/8',exact:true})).toBeVisible({timeout:90000});
  await expect(page.getByText(/exceeds.*(?:limit|budget)/)).toHaveCount(0);
  await page.getByRole('button',{name:'В линейку',exact:true}).click();await page.waitForTimeout(400);
  await test.info().attach('mixed-eight-lineup.png',{body:await page.screenshot(),contentType:'image/png'});
  for(let slot=0;slot<8;slot++)await page.getByTitle('Удалить из сравнения',{exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Добавить 0/8',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
  for(const [i,file] of files.entries())expect(createHash('sha256').update(await readFile(file)).digest('hex')).toBe(before[i]);
 }finally{
  await unlink(pidFile);if(sampler)await new Promise<void>(resolve=>{sampler.once('exit',()=>resolve());setTimeout(resolve,3000);});
  const os=sampler?(await readFile(osFile,'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)):[];
  await test.info().attach('mixed-source-memory.json',{body:JSON.stringify({corpus:privateRoot?'owner models (read-only)':'synthetic padded rig sources',sourceBytes,total:sourceBytes.reduce((a,b)=>a+b,0),sha256:before,privatePeak:os.length?Math.max(...os.map(s=>s.privateBytes)):null,scope:'Sampled owned headless browser processes; not native WebView2 or VRAM',errors,os},null,2),contentType:'application/json'});
  await system.detach();
 }
});
