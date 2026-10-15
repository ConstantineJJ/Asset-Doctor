import {test,expect} from '@playwright/test';
test('System log captures a bounded sanitized error, exports and respects pause across reload',async({page})=>{
 await page.goto('/');const trigger=page.getByRole('button',{name:'System log',exact:true});await expect(trigger).toBeVisible({timeout:2000});
 await page.evaluate(()=>window.dispatchEvent(new ErrorEvent('error',{error:new Error('Controlled log marker D:\\Private\\secret\\model.glb Bearer abcdefghijklmnop')})));
 await trigger.click();const panel=page.getByRole('dialog',{name:'System log',exact:true});await expect(panel.locator('pre').filter({hasText:'Controlled log marker'}).first()).toBeVisible();
 const downloading=page.waitForEvent('download');await panel.getByRole('button',{name:'Save system log',exact:true}).click();
 const stream=await(await downloading).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));const text=Buffer.concat(chunks).toString();
 expect(text).toContain('Controlled log marker');expect(text).not.toContain('D:\\Private');expect(text).not.toContain('abcdefghijklmnop');
 expect(text.trim().split('\n').every(line=>typeof JSON.parse(line)==='object')).toBeTruthy();
 await panel.getByRole('checkbox',{name:'Record system log',exact:true}).uncheck();await page.reload();await page.getByRole('button',{name:'System log',exact:true}).click();
 await expect(page.getByRole('checkbox',{name:'Record system log',exact:true})).not.toBeChecked();
});
