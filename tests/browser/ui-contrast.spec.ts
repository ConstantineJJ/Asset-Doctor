import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

function manyClips() {
  const source=readFileSync('tests/browser/fixtures/Fox.glb'),length=source.readUInt32LE(12);
  const document=JSON.parse(source.subarray(20,20+length).toString().trim()),clips=document.animations;
  document.animations=Array.from({length:36},(_,index)=>({...structuredClone(clips[index%clips.length]),name:`Клип ${index+1}: персонаж поднимает руки и поворачивается — Animation with a long descriptive name`}));
  const json=Buffer.from(JSON.stringify(document)),size=Math.ceil(json.length/4)*4,binary=source.subarray(20+length),output=Buffer.alloc(20+size+binary.length);
  source.copy(output,0,0,12);output.writeUInt32LE(output.length,8);output.writeUInt32LE(size,12);output.writeUInt32LE(0x4e4f534a,16);output.fill(32,20,20+size);json.copy(output,20);binary.copy(output,20+size);return output;
}
function contrast(color:string,background:string) {
  const luminance=(value:string)=>{
    const rgb=value.match(/[\d.]+/g)!.slice(0,3).map(Number).map(value=>{const channel=value/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;});
    return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
  };
  const a=luminance(color),b=luminance(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}

test('Selected, hovered and disabled controls retain text contrast and helper states',async({page})=>{
  await page.goto('/');
  const exportButton=page.locator('#btn-export-file');await expect(exportButton).toBeDisabled();
  const colors=async(locator:typeof exportButton)=>locator.evaluate(node=>{const style=getComputedStyle(node);return {color:style.color,background:style.backgroundColor};});
  const disabled=await colors(exportButton);expect(contrast(disabled.color,disabled.background)).toBeGreaterThanOrEqual(4.5);
  await page.locator('header input[type=file]').setInputFiles({name:'Fox36.glb',mimeType:'model/gltf-binary',buffer:manyClips()});
  await expect(page.getByRole('button',{name:'Rescan',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Rig',exact:true}).click();
  const selected=page.getByTestId('animation-clip-0');await selected.scrollIntoViewIfNeeded();
  for(const hovered of [false,true]) {
    if(hovered)await selected.hover();else await page.mouse.move(0,0);
    const actual=await colors(selected);expect(contrast(actual.color,actual.background)).toBeGreaterThanOrEqual(4.5);
  }
  const grid=page.getByTitle('Toggle Ground Grid',{exact:true});await expect(grid).toHaveAttribute('aria-pressed','true');const active=await colors(grid);
  await grid.click();await expect(grid).toHaveAttribute('aria-pressed','false');await page.mouse.move(0,0);expect((await colors(grid)).background).not.toBe(active.background);
  await test.info().attach('contrast.json',{body:JSON.stringify({disabled,selected:await colors(selected),gridOn:active,gridOff:await colors(grid)}),contentType:'application/json'});
});

for(const width of [1024,1440,3840])test(`Desktop UI ${width}px: 36 long clips, top rotation and reachable menu`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width,height:width===3840?2160:900});await page.goto('/');
  const icon=page.locator('header img[alt="Asset Doctor"]');
  await expect.poll(()=>icon.evaluate(image=>{const img=image as HTMLImageElement;return img.complete&&img.naturalWidth===128;})).toBe(true);
  await page.locator('header input[type=file]').setInputFiles({name:'Fox36.glb',mimeType:'model/gltf-binary',buffer:manyClips()});await expect(page.getByRole('button',{name:'Rescan',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Rig',exact:true}).click();await expect(page.getByLabel('Animation clip',{exact:true})).toHaveValue('0');
  const play=page.locator('#btn-play-pause-animation'),playRect=(await play.boundingBox())!;expect(playRect.x).toBeGreaterThanOrEqual(0);expect(playRect.x+playRect.width).toBeLessThanOrEqual(width);
  const rotation=page.getByTestId('model-rotation-controls'),rotationRect=(await rotation.boundingBox())!;expect(rotationRect.x+rotationRect.width).toBeLessThanOrEqual(width);expect(rotationRect.y+rotationRect.height).toBeLessThan(playRect.y-100);
  const search=page.getByLabel('Search animation clips');await search.fill('Клип 36:');await expect(page.getByTestId('animation-clip-35')).toBeVisible();await page.getByTestId('animation-clip-35').click();await expect(page.getByLabel('Animation clip',{exact:true})).toHaveValue('35');
  await search.fill('');await page.getByRole('button',{name:'Samples',exact:true}).click();const sample=page.getByRole('menuitem');await expect(sample).toBeVisible();
  const sampleRect=(await sample.boundingBox())!,point=[sampleRect.x+sampleRect.width/2,sampleRect.y+sampleRect.height/2];
  expect(await page.evaluate(([x,y])=>Boolean(document.elementFromPoint(x,y)?.closest('[role="menuitem"]')),point)).toBe(true);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Rig',exact:true}).click();
  await test.info().attach(`ui-${width}.png`,{body:await page.screenshot(),contentType:'image/png'});expect(errors).toEqual([]);
});
