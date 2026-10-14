import {test,expect,type Page} from '@playwright/test';
import {rigFixture} from '../rig-fixtures';
import {rigViewerState} from './rig-runtime-probe';
import {openJointDetails,closeJointDetails} from './rig-toolbar-probe';

function safeLeaf() {
  const fixture=rigFixture(),buffer=Buffer.from(fixture.buffer),json=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)).toString().trim());
  const accessor=json.accessors[json.meshes[0].primitives[0].attributes.WEIGHTS_0],view=json.bufferViews[accessor.bufferView];
  const offset=28+buffer.readUInt32LE(12)+(view.byteOffset??0)+(accessor.byteOffset??0);
  buffer.writeFloatLE(0,offset+12*4);buffer.writeFloatLE(1,offset+13*4);return buffer;
}
async function open(page:Page,buffer=Buffer.from(rigFixture().buffer)) {
  await page.goto('/');await page.locator('header input[type=file]').setInputFiles({name:'joint-edit.glb',mimeType:'model/gltf-binary',buffer});
  await expect(page.getByRole('button',{name:'Rescan',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Rig',exact:true}).click();await page.getByTestId('rig-mode-edit').click();
  await page.getByTestId('rig-tool-select').click();
}
async function clickJoint(page:Page,name:string,right=false) {
  const joint=(await rigViewerState(page)).bones.find(bone=>bone.name===name)!;expect(joint).toBeTruthy();
  await page.mouse.click(...joint.screen as [number,number],{button:right?'right':'left'});
  await expect.poll(async()=>(await rigViewerState(page)).selected).toBe(joint.uuid);return joint;
}
async function exportAndReopen(page:Page) {
  await page.getByRole('button',{name:'Verify Edited GLB',exact:true}).click();await expect(page.getByTestId('rig-export-status')).toContainText('VERIFIED',{timeout:30000});
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Save Changes',exact:true}).click()]);
  const chunks:Buffer[]=[];for await(const chunk of (await download.createReadStream())!)chunks.push(Buffer.from(chunk));const output=Buffer.concat(chunks);
  await test.info().attach('joint-edited.glb',{body:output,contentType:'model/gltf-binary'});
  await page.locator('header input[type=file]').setInputFiles({name:'joint-reimport.glb',mimeType:'model/gltf-binary',buffer:output});
  const discard=page.getByRole('button',{name:'Discard and open',exact:true});
  await expect.poll(async()=>await discard.isVisible()||await page.getByText('joint-reimport.glb',{exact:true}).first().isVisible()).toBe(true);
  if(await discard.isVisible())await discard.click();await expect(page.getByText('joint-reimport.glb',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Rig',exact:true}).click();return output;
}

test('RMB Add and Delete are real structural edits with exact keyboard Undo and verified reimport',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await open(page);const original=await rigViewerState(page);
  await clickJoint(page,'Root',true);await expect(page.getByRole('menu',{name:'Joint actions'})).toBeVisible();
  await expect(page.getByRole('menuitem',{name:'Delete joint',exact:true})).toBeEnabled();await page.getByRole('menuitem',{name:'Delete joint',exact:true}).click();await expect(page.getByTestId('rig-removal-dialog')).toBeVisible();await page.getByTestId('rig-removal-cancel').click();
  await clickJoint(page,'Root',true);
  await page.getByRole('menuitem',{name:'Add child joint',exact:true}).click();await expect.poll(async()=>(await rigViewerState(page)).jointCount).toBe(5);
  const added=(await rigViewerState(page)).bones.find(bone=>bone.name==='Joint_1')!;expect(added).toBeTruthy();
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await rigViewerState(page)).jointCount).toBe(4);
  await page.getByRole('button',{name:'Redo',exact:true}).click();expect((await rigViewerState(page)).bones.find(bone=>bone.name==='Joint_1')!.uuid).toBe(added.uuid);
  await clickJoint(page,'Joint_1',true);await page.getByRole('menuitem',{name:'Delete joint',exact:true}).click();await expect(page.getByTestId('rig-removal-dialog')).toBeVisible();await page.getByTestId('rig-removal-confirm').click();await expect.poll(async()=>(await rigViewerState(page)).jointCount).toBe(4);
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await rigViewerState(page)).jointCount).toBe(5);
  await exportAndReopen(page);const reopened=await rigViewerState(page);expect(reopened.bones.map(bone=>bone.name)).toContain('Joint_1');expect(reopened.durations).toEqual(original.durations);expect(errors).toEqual([]);
});

test('Safe source-leaf deletion preserves animation, supports history in Smooth, and exports remapped indices',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await open(page,safeLeaf());const initial=await rigViewerState(page);
  const leaf=await clickJoint(page,'Side');await expect(page.getByRole('button',{name:'Delete Joint',exact:true})).toBeEnabled();
  await page.getByLabel('Shading mode').selectOption('smooth');await page.getByRole('button',{name:'Delete Joint',exact:true}).click();
  await expect(page.getByRole('alert').first()).toContainText('Hybrid');expect((await rigViewerState(page)).bones).toHaveLength(4);
  await page.getByLabel('Shading mode').selectOption('hybrid');await page.getByRole('button',{name:'Delete Joint',exact:true}).click();await expect(page.getByTestId('rig-removal-dialog')).toBeVisible();await page.getByTestId('rig-removal-confirm').click();await expect.poll(async()=>(await rigViewerState(page)).jointCount).toBe(3);
  await page.getByLabel('Shading mode').selectOption('smooth');await page.keyboard.press('Control+z');await expect.poll(async()=>(await rigViewerState(page)).jointCount).toBe(4);
  expect((await rigViewerState(page)).bones.find(bone=>bone.name==='Side')!.uuid).toBe(leaf.uuid);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect.poll(async()=>(await rigViewerState(page)).jointCount).toBe(3);
  await exportAndReopen(page);const reopened=await rigViewerState(page);expect(reopened.bones.map(bone=>bone.name)).not.toContain('Side');expect(reopened.durations).toEqual(initial.durations);expect(errors).toEqual([]);
});

test('RMB drag remains camera pan and Escape closes the joint menu without an edit',async({page})=>{
  await open(page);const root=(await rigViewerState(page)).bones.find(bone=>bone.name==='Root')!;
  await page.mouse.move(...root.screen as [number,number]);await page.mouse.down({button:'right'});await page.mouse.move(root.screen[0]+35,root.screen[1]+20,{steps:5});await page.mouse.up({button:'right'});
  await expect(page.getByRole('menu',{name:'Joint actions'})).not.toBeVisible();expect((await rigViewerState(page)).revision).toBe(0);
  await clickJoint(page,'Root',true);await expect(page.getByRole('menu',{name:'Joint actions'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('menu',{name:'Joint actions'})).not.toBeVisible();expect((await rigViewerState(page)).revision).toBe(0);
});

for(const width of [1024,1440,3840])test(`Top tools ${width}px: four buttons, one ground menu, semantics and free animation sidebar`,async({page})=>{
  await page.setViewportSize({width,height:width===3840?2160:900});await open(page);const toolbar=page.getByTestId('rig-toolbar'),canvas=(await page.locator('canvas:visible').first().boundingBox())!;
  await expect(page.getByRole('group',{name:'Rig tools'}).getByRole('button')).toHaveCount(4);await expect(page.getByLabel('Rig tool',{exact:true})).toHaveCount(0);
  for(const tool of ['select','translate','rotate','twist'])await expect(page.getByTestId(`rig-tool-${tool}`)).toBeVisible();
  const box=(await toolbar.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(canvas.x);expect(box.x+box.width).toBeLessThanOrEqual(canvas.x+canvas.width);expect(box.y).toBeLessThan(canvas.y+canvas.height*.35);
  const turntable=(await page.getByTestId('model-rotation-controls').boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(turntable.y+turntable.height+4);
  for(const id of ['rig-mode-inspect','rig-mode-edit','rig-tool-select','rig-tool-translate','rig-tool-rotate','rig-tool-twist']) {
    const button=page.getByTestId(id),rect=(await button.boundingBox())!;
    expect(await page.evaluate(([x,y,id])=>document.elementFromPoint(x,y)?.closest('button')?.getAttribute('data-testid')===id,[rect.x+rect.width/2,rect.y+rect.height/2,id] as [number,number,string])).toBe(true);
  }
  expect((await page.getByLabel('Animation clip name',{exact:true}).boundingBox())!.x).toBeGreaterThanOrEqual(canvas.x+canvas.width-1);
  await expect(page.locator('#select-surface')).toHaveCount(0);await page.getByRole('button',{name:'Ground surface',exact:true}).click();
  await page.getByRole('button',{name:/Factory Floor/}).click();await expect(page.getByRole('button',{name:'Ground surface',exact:true})).toContainText('Factory Floor');
  const colors=await Promise.all(['rig-tool-select','rig-tool-translate'].map(id=>page.getByTestId(id).evaluate(node=>getComputedStyle(node).borderColor)));
  expect(colors[0]).not.toBe(colors[1]);await clickJoint(page,'Root');await openJointDetails(page);await closeJointDetails(page);
  await test.info().attach(`toolbar-${width}.png`,{body:await page.screenshot(),contentType:'image/png'});
});
