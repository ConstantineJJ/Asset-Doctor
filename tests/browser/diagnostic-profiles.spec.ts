import {test,expect,type Page,type Download} from '@playwright/test';
import {viewerState} from './viewer-probe';

async function report(download:Download){const chunks:Buffer[]=[];for await(const chunk of (await download.createReadStream())!)chunks.push(Buffer.from(chunk));return JSON.parse(Buffer.concat(chunks).toString());}
async function patient(page:Page){await page.goto('/');await page.locator('#btn-sample-models').click();await page.getByRole('menuitem',{name:/Asset Doctor Test Patient/}).click();await expect(page.getByRole('button',{name:'Rescan',exact:true})).toBeEnabled();}
async function inspect(page:Page){return page.evaluate(()=>{
 const root=document.getElementById('root')!,attached=Reflect.get(root,Object.keys(root).find(key=>key.startsWith('__reactContainer$'))!),queue=[attached?.stateNode?.current??attached];
 while(queue.length){const fiber=queue.pop();if(!fiber)continue;if(fiber.child)queue.push(fiber.child);if(fiber.sibling)queue.push(fiber.sibling);
  const props=fiber.memoizedProps;if(props?.diagnosticProfileId&&Array.isArray(props.healthIssues))return {profile:props.diagnosticProfileId,technical:props.healthIssues.filter((issue:any)=>issue.layer!=='Fitness'),fitness:props.healthIssues.filter((issue:any)=>issue.layer==='Fitness'),summary:props.summary,stages:props.progressiveState};
 }throw new Error('Inspector unavailable');
});}

test('F09 profiles reinterpret cached Fitness, preserve Health and exported scan identity',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{const post=Worker.prototype.postMessage;Reflect.set(window,'profileWorkerPosts',0);Reflect.set(Worker.prototype,'postMessage',function(this:Worker,...args:unknown[]){Reflect.set(window,'profileWorkerPosts',Reflect.get(window,'profileWorkerPosts')+1);return Reflect.apply(post,this,args);});});
 await page.goto('/');await page.locator('header input[type=file]').setInputFiles('tests/browser/fixtures/two-scenes.glb');
 await expect(page.getByRole('button',{name:'Rescan',exact:true})).toBeEnabled();
 const selector=page.getByRole('combobox',{name:'Diagnostic profile',exact:true});await expect(selector).toHaveValue('general',{timeout:3000});
 const before=await inspect(page),sourceBefore=await viewerState(page),posts=await page.evaluate(()=>Reflect.get(window,'profileWorkerPosts'));
 const firstDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Log all findings',exact:true}).click();const first=await report(await firstDownload);
 await selector.selectOption('mobile-game-character');await expect(page.getByText('Active profile: Mobile game character',{exact:true})).toBeVisible();
 const mobile=await inspect(page);expect(mobile.technical).toEqual(before.technical);expect(mobile.summary).toEqual(before.summary);expect(mobile.stages).toEqual(before.stages);
 expect(mobile.fitness.some((issue:any)=>issue.id==='fitness-rig-expected-missing')).toBeTruthy();expect(mobile.fitness.every((issue:any)=>issue.profileId==='mobile-game-character')).toBeTruthy();
 await page.getByRole('button',{name:/View profile fit/}).click();await expect(page.getByRole('heading',{name:'Profile fit',exact:true})).toBeVisible();
 const singleDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Log this finding',exact:true}).first().click();const single=await report(await singleDownload);
 expect(single.scope).toBe('single');expect(single.scan.profile).toBe('mobile-game-character');expect(single.findings).toHaveLength(1);expect(single.findings[0].layer).toBe('Fitness');
 const secondDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Log all findings',exact:true}).click();const second=await report(await secondDownload);
 expect(second.scan.profile).toBe('mobile-game-character');expect(second.asset).toEqual(first.asset);expect(second.scan.revision).toBe(first.scan.revision);
 await selector.selectOption('general');expect((await inspect(page)).fitness).toEqual(before.fitness);expect(await viewerState(page)).toEqual(sourceBefore);expect(await page.evaluate(()=>Reflect.get(window,'profileWorkerPosts'))).toBe(posts);expect(errors).toEqual([]);
});

async function controlledTopology(page:Page,fail:boolean){
 await page.goto('/');await page.evaluate(fail=>{
  const container=document.getElementById('root')!,attached=Reflect.get(container,Object.keys(container).find(key=>key.startsWith('__reactContainer$'))!),queue=[attached?.stateNode?.current??attached];
  while(queue.length){const fiber=queue.pop();if(!fiber)continue;if(fiber.child)queue.push(fiber.child);if(fiber.sibling)queue.push(fiber.sibling);
   for(let hook=fiber.memoizedState;hook;hook=hook.next){const manager=hook.memoizedState?.current;if(typeof manager?.analyzeMeshes!=='function')continue;
    const original=manager.analyzeMeshes.bind(manager),control={calls:0,release:null as null|(()=>void)};Reflect.set(window,'profileTopology',control);
    manager.analyzeMeshes=async(...args:any[])=>{control.calls++;if(fail)throw new Error('Controlled F09 topology failure');const result=await original(...args);await new Promise<void>(resolve=>{control.release=resolve;});return result;};return;
   }
  }throw new Error('Topology manager unavailable');
 },fail);
 await page.locator('#btn-sample-models').click();await page.getByRole('menuitem',{name:/Asset Doctor Test Patient/}).click();
 await expect(page.getByRole('combobox',{name:'Diagnostic profile',exact:true})).toBeVisible();
 await expect.poll(async()=> (await inspect(page)).stages.topology).toBe(fail?'error':'running');
 if(!fail)await expect.poll(()=>page.evaluate(()=>Boolean(Reflect.get(window,'profileTopology').release))).toBeTruthy();
}

test('F09 preserves UNKNOWN topology after failure and keeps the scan partial in reports',async({page})=>{
 await controlledTopology(page,true);const before=await inspect(page);expect(before.technical.some((issue:any)=>issue.id==='topology-analysis-unknown')).toBeTruthy();
 for(const id of ['visualization','mobile-game-character','general']){
  await page.getByRole('combobox',{name:'Diagnostic profile',exact:true}).selectOption(id);
  await expect.poll(async()=> (await inspect(page)).profile).toBe(id);expect((await inspect(page)).technical).toEqual(before.technical);
 }
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Log all findings',exact:true}).click();const output=await report(await downloading);
 expect(output.scan.status).toBe('partial');expect(output.scan.stages.topology).toBe('error');expect(output.findings.some((issue:any)=>issue.id==='topology-analysis-unknown')).toBeTruthy();
 expect(await page.evaluate(()=>Reflect.get(window,'profileTopology').calls)).toBe(1);
});

test('F09 keeps the latest profile when in-flight topology completes',async({page})=>{
 await controlledTopology(page,false);const selector=page.getByRole('combobox',{name:'Diagnostic profile',exact:true}),before=await inspect(page);
 await selector.selectOption('mobile-game-character');await selector.selectOption('visualization');
 expect((await inspect(page)).technical).toEqual(before.technical);
 await page.evaluate(()=>Reflect.get(window,'profileTopology').release());await expect.poll(async()=> (await inspect(page)).stages.topology).toBe('done');
 const after=await inspect(page);expect(after.profile).toBe('visualization');expect(after.fitness.every((issue:any)=>issue.profileId==='visualization')).toBeTruthy();
 expect(await page.evaluate(()=>Reflect.get(window,'profileTopology').calls)).toBe(1);
});

test('F09 seven localized profiles stay reachable in a compact Inspector and at 4K',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('asset-doctor.language','ru'));
 await page.goto('/');await page.locator('header input[type=file]').setInputFiles('tests/browser/fixtures/two-scenes.glb');
 const selector=page.getByRole('combobox',{name:'Профиль диагностики',exact:true});await expect(selector).toBeVisible();
 await expect.poll(async()=> (await inspect(page)).stages.topology).toBe('done');
 await page.setViewportSize({width:1024,height:768});await expect(selector).toBeInViewport();await expect(selector.locator('option')).toHaveCount(7);
 await selector.selectOption('mobile-game-character');await expect(page.getByText('Активный профиль: Мобильный персонаж',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:/Пригодность: замечаний/}).click();await expect(page.getByRole('heading',{name:'Пригодность для профиля',exact:true})).toBeVisible();
 await test.info().attach('profiles-ru-small.png',{body:await page.screenshot(),contentType:'image/png'});
 await page.setViewportSize({width:3840,height:2160});await expect(selector).toBeInViewport();await test.info().attach('profiles-ru-wide.png',{body:await page.screenshot(),contentType:'image/png'});
 for(const option of await selector.locator('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value))){await selector.selectOption(option);await expect.poll(async()=> (await inspect(page)).profile).toBe(option);}
});
