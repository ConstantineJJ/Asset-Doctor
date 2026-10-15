import {test,expect,type Page} from '@playwright/test';
import {rigFixture} from '../rig-fixtures';

async function settings(page:Page){await page.getByRole('button',{name:'Application menu',exact:true}).click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();}
test('Custom hotkeys reject conflicts, operate once and survive reload',async({page})=>{
 await page.goto('/');await settings(page);
 const assign=page.getByRole('button',{name:'Assign Wireframe',exact:true});
 await expect(assign).toBeVisible({timeout:2000});await assign.click();await assign.press('f');
 await expect(page.getByRole('alert')).toContainText('Frame all');
 await assign.press('h');await expect(assign).toContainText('H');
 await page.getByRole('button',{name:'Close settings',exact:true}).click();
 await page.locator('body').click({position:{x:2,y:2}});await page.keyboard.press('h');
 await expect(page.locator('#select-render-mode')).toHaveValue('wireframe');
 await page.reload();await page.keyboard.press('h');await expect(page.locator('#select-render-mode')).toHaveValue('wireframe');
});
test('Space in settings never starts hidden playback; Compare owns its playback shortcut',async({page})=>{
 await page.goto('/');await page.locator('header input[type=file]').setInputFiles({name:'rig.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(rigFixture().buffer)});
 await expect(page.getByTitle('Pause',{exact:true})).toBeVisible();await page.getByTitle('Pause',{exact:true}).click();await settings(page);
 const play=page.getByRole('button',{name:'Assign Play / Pause',exact:true});await play.click();await play.press('Space');
 await page.getByRole('button',{name:'Close settings',exact:true}).click();await expect(page.getByTitle('Play',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Compare',exact:true}).click();
 await page.locator('input[type=file][multiple]').setInputFiles({name:'compare.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(rigFixture().buffer)});
 await expect(page.getByRole('button',{name:'Добавить 1/8',exact:true})).toBeVisible();
 await page.locator('canvas:visible').first().click({position:{x:50,y:250}});await page.keyboard.press('Space');
 await expect(page.getByTitle('Пауза',{exact:true})).toBeVisible();
});
