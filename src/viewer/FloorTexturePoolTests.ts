import {FloorTexturePool} from './FloorTexturePool';
export async function runFloorTexturePoolTests(){
 const results:{name:string;passed:boolean;actual?:unknown;expected?:unknown}[]=[];
 let finish!:(bitmap:{close:()=>void})=>void,closes=0,disposals=0;
 const pool=new FloorTexturePool(()=>new Promise(resolve=>{finish=resolve;}));
 const first=pool.acquire('shared',[1,1]),second=pool.acquire('shared',[1,1]);
 first.texture.addEventListener('dispose',()=>disposals++);first.release();
 finish({close:()=>closes++});await second.ready;
 const shared=first.texture===second.texture&&disposals===0&&closes===0&&pool.size===1;
 second.release();second.release();
 results.push({name:'Floor image leases share active textures and dispose/close once after the last consumer',passed:shared&&disposals===1&&closes===1&&Number(pool.size)===0});
 let complete!:(bitmap:{close:()=>void})=>void,signal:AbortSignal|undefined,lateClosed=0;
 const pending=new FloorTexturePool((_url,abort)=>{signal=abort;return new Promise(resolve=>{complete=resolve;});}),lease=pending.acquire('pending',[1,1]);
 lease.release();complete({close:()=>lateClosed++});await lease.ready;
 results.push({name:'Switching floors during decode aborts abandoned work and closes a late bitmap without retaining a texture',passed:signal?.aborted===true&&lateClosed===1&&pending.size===0&&lease.texture.image===null});
 return results;
}
