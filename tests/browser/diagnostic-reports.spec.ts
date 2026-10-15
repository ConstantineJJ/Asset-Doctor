import {test,expect,type Download,type Page} from '@playwright/test';
async function contents(download:Download){const chunks:Buffer[]=[];for await(const chunk of (await download.createReadStream())!)chunks.push(Buffer.from(chunk));return JSON.parse(Buffer.concat(chunks).toString());}
async function patient(page:Page){await page.goto('/');await page.locator('#btn-sample-models').click();await page.getByRole('menuitem',{name:/Asset Doctor Test Patient/}).click();await expect(page.getByRole('button',{name:'Rescan',exact:true})).toBeEnabled();await expect(page.getByText('Partial scan',{exact:true})).toHaveCount(0);}
test('Single and bulk diagnostic logs preserve finding evidence and current scan independently of visible cards',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await patient(page);
 const all=page.getByRole('button',{name:'Log all findings',exact:true});await expect(all).toBeEnabled();
 await page.getByRole('button',{name:/^\d+ Warnings$/i}).click();
 const individual=page.getByRole('button',{name:'Log this finding',exact:true}).first();const oneDownload=page.waitForEvent('download');await individual.click();const single=await contents(await oneDownload);
 expect(single.scope).toBe('single');expect(single.findings).toHaveLength(1);expect(single.findings[0].id).toBeTruthy();expect(single.findings[0].description).toBeTruthy();
 await page.getByRole('button',{name:/^\d+ Passed$/i}).click();
 const bulkDownload=page.waitForEvent('download');await all.click();const bulk=await contents(await bulkDownload);
 expect(bulk.scope).toBe('all');expect(bulk.scan.status).toBe('complete');expect(bulk.findings.length).toBeGreaterThan(1);expect(bulk.omittedFindings).toBe(0);expect(bulk.findings.some((item:{id:string})=>item.id===single.findings[0].id)).toBeTruthy();expect(bulk.asset).toEqual(single.asset);expect(bulk.findings.every((item:{severity:string;repairability:string})=>['ERROR','WARNING','UNKNOWN'].includes(item.severity)||item.repairability==='MANUAL')).toBeTruthy();
 await page.getByRole('button',{name:'System log',exact:true}).click();const log=page.getByRole('dialog',{name:'System log',exact:true});await expect(log.locator('pre').filter({hasText:'diagnostic_report'}).first()).toBeVisible();await expect(log.locator('pre').filter({hasText:'"scope":"analysis"'}).filter({hasText:'"event":"completed"'}).first()).toBeVisible();
 await page.getByRole('button',{name:'Close system log',exact:true}).click();
 await page.getByRole('button',{name:'Compare',exact:true}).click();await expect(all).toBeDisabled();expect(errors).toEqual([]);
});
test('System controls stay reachable at small and wide sizes and report hotkey is active',async({page})=>{
 await patient(page);await page.setViewportSize({width:1024,height:768});
 const log=page.getByRole('button',{name:'System log',exact:true}),all=page.getByRole('button',{name:'Log all findings',exact:true});await expect(log).toBeInViewport();await expect(all).toBeInViewport();
 await test.info().attach('diagnostics-small.png',{body:await page.screenshot(),contentType:'image/png'});
 await page.locator('body').click({position:{x:2,y:400}});const downloading=page.waitForEvent('download');await page.keyboard.press('F9');expect((await contents(await downloading)).scope).toBe('all');
 await page.keyboard.press('F8');await expect(page.getByRole('dialog',{name:'System log',exact:true})).toBeVisible();await test.info().attach('system-log-small.png',{body:await page.screenshot(),contentType:'image/png'});await page.getByRole('button',{name:'Close system log',exact:true}).click();
 await page.setViewportSize({width:3840,height:2160});await expect(all).toBeInViewport();await test.info().attach('diagnostics-wide.png',{body:await page.screenshot(),contentType:'image/png'});
});
