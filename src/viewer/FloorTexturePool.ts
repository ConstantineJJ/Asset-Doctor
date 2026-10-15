import * as THREE from 'three';
type Bitmap=Pick<ImageBitmap,'close'>;
type Decode=(url:string,signal:AbortSignal)=>Promise<Bitmap>;
interface Entry {texture:THREE.Texture;references:number;controller:AbortController;bitmap?:Bitmap;ready:Promise<void>}
export interface FloorTextureLease {texture:THREE.Texture;ready:Promise<void>;release:()=>void}
const decodeFloor:Decode=async(url,signal)=>{
 const response=await fetch(url,{signal});if(!response.ok)throw new Error(`Floor texture HTTP ${response.status}`);
 return createImageBitmap(await response.blob(),{imageOrientation:'flipY',premultiplyAlpha:'none'});
};
/** Share only active floor textures; last release cancels decoding and closes bitmaps. */
export class FloorTexturePool {
 private entries=new Map<string,Entry>();
 constructor(private readonly decode:Decode=decodeFloor){}
 get size(){return this.entries.size;}
 acquire(url:string,repeat:readonly[number,number]):FloorTextureLease{
  const key=`${url}:${repeat.join(',')}`;
  let entry=this.entries.get(key);
  if(!entry){
   const texture=new THREE.Texture();texture.colorSpace=THREE.SRGBColorSpace;texture.flipY=false;
   texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(...repeat);texture.anisotropy=4;
   entry={texture,references:0,controller:new AbortController(),ready:Promise.resolve()};
   const current=entry;
   entry.ready=this.decode(url,entry.controller.signal).then(bitmap=>{
    if(!current.references){bitmap.close();return;}
    current.bitmap=bitmap;current.texture.image=bitmap;current.texture.needsUpdate=true;
   });
   this.entries.set(key,entry);
  }
  entry.references++;const current=entry;let released=false;
  return {texture:entry.texture,ready:entry.ready,release:()=>{
   if(released)return;released=true;
   if(--current.references)return;
   if(this.entries.get(key)===current)this.entries.delete(key);
   current.controller.abort();current.texture.dispose();current.bitmap?.close();current.bitmap=undefined;current.texture.image=null;
  }};
 }
}
export const floorTextures=new FloorTexturePool();
