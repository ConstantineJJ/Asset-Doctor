import {test,expect} from '@playwright/test';
import {rigFixture} from '../rig-fixtures';
import {rigViewerState} from './rig-runtime-probe';

function attachmentFixture() {
 const source=Buffer.from(rigFixture().buffer),length=source.readUInt32LE(12),document=JSON.parse(source.subarray(20,20+length).toString().trim());
 const attachment=document.nodes.length;document.nodes.push({name:'AuthoredAttachment',translation:[1,0,0],extras:{author:'keep'}});document.nodes[1].children.push(attachment);
 const json=Buffer.from(JSON.stringify(document)),jsonLength=Math.ceil(json.length/4)*4,binary=source.subarray(20+length),output=Buffer.alloc(20+jsonLength+binary.length);
 source.copy(output,0,0,12);output.writeUInt32LE(output.length,8);output.writeUInt32LE(jsonLength,12);output.writeUInt32LE(0x4e4f534a,16);output.fill(32,20,20+jsonLength);json.copy(output,20);binary.copy(output,20+jsonLength);return output;
}

test('Rejected Hold drag restores the actual joint and gizmo together without history or reselection',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');
 await page.locator('header input[type=file]').setInputFiles({name:'attachment.glb',mimeType:'model/gltf-binary',buffer:attachmentFixture()});await expect(page.getByRole('button',{name:'Rescan',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Rig',exact:true}).click();await page.getByTestId('rig-mode-edit').click();
 const original=await rigViewerState(page),joint=original.bones.find(bone=>bone.name==='Root')!;await page.mouse.click(...joint.screen as [number,number]);
 await page.getByLabel('Rig children policy').selectOption('hold');await page.waitForTimeout(100);
 const before=await rigViewerState(page),handle=before.handles.find(handle=>handle.axis==='X')!;
 await page.mouse.move(...handle.screen as [number,number]);await page.mouse.down();await page.mouse.move(handle.screen[0]+40,handle.screen[1],{steps:5});await page.mouse.up();
 await expect(page.getByRole('alert')).toContainText('non-joint attachment');
 await expect.poll(async()=>{const state=await rigViewerState(page);return state.gizmoOrigin?.map((value:number,index:number)=>Math.abs(value-state.selectedWorld![index]));}).toEqual([0,0,0]);
 const after=await rigViewerState(page);expect(after.bones.find(bone=>bone.uuid===joint.uuid)?.position).toEqual(joint.position);expect(after.revision).toBe(0);await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();expect(errors).toEqual([]);
});

test('Rig export blocks gizmo interaction and replacement cannot publish an old VERIFIED result',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const Original=window.Worker;
  window.Worker=class extends Original {
   constructor(url:string|URL,options?:WorkerOptions) {
    super(url,options);if(String(url).includes('rig-export.worker'))this.addEventListener('message',event=>{
     if(!(event as any).released){(window as any).__rigMessageHeld=true;event.stopImmediatePropagation();setTimeout(()=>{(window as any).__rigMessageReleased=true;const released=new MessageEvent('message',{data:event.data});(released as any).released=true;this.dispatchEvent(released);},1500);}
    });
   }
  };
 });
 await page.goto('/');await page.locator('header input[type=file]').setInputFiles({name:'old-rig.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(rigFixture().buffer)});await expect(page.getByRole('button',{name:'Rescan',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Rig',exact:true}).click();await page.getByTestId('rig-mode-edit').click();await page.getByLabel('Export clip duration').fill('8');await page.getByRole('button',{name:'Retime Selected Clip',exact:true}).click();
 await page.getByRole('button',{name:'Verify Edited GLB',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__rigMessageHeld)).toBe(true);expect((await rigViewerState(page)).gizmoEnabled).toBe(false);
 await page.locator('header input[type=file]').setInputFiles({name:'new-rig.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(rigFixture().buffer)});await page.getByRole('button',{name:'Discard and open',exact:true}).click();await expect(page.getByText('new-rig.glb',{exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).__rigMessageReleased)).toBe(true);
 await expect(page.getByRole('button',{name:'Save Changes',exact:true})).toBeDisabled();await expect(page.getByTestId('rig-export-status').filter({hasText:'VERIFIED'})).toHaveCount(0);expect((await rigViewerState(page)).durations).toEqual([4,4,4,4]);expect(errors).toEqual([]);
});
