import {transferBuffers} from './GeometryPacket';

/** One CPU job per client; cancellation destroys the executing worker. */
export class ComputeWorkerClient {
 private worker:Worker|null=null;
 private cancelJob:(()=>void)|null=null;
 constructor(private readonly create:()=>Worker) {}
 request<T>(payload:unknown):Promise<T> {
  if(this.cancelJob)return Promise.reject(new Error('Compute worker is busy'));
  return new Promise((resolve,reject)=>{
   let worker:Worker;try {worker=this.worker ?? this.create();this.worker=worker;}catch(error){reject(error);return;}
   const finish=(error?:Error,result?:T)=>{clearTimeout(timer);worker.removeEventListener('message',message);worker.removeEventListener('error',failed);worker.removeEventListener('messageerror',failed);this.cancelJob=null;
    if(error){worker.terminate();if(this.worker===worker)this.worker=null;reject(error);}else resolve(result!);};
   const message=(event:MessageEvent)=>event.data.success?finish(undefined,event.data.result):finish(new Error(event.data.error));
   const failed=(event:Event)=>{event.preventDefault();finish(new Error('Compute worker failed; operation stopped safely'));};
   const timer=setTimeout(()=>finish(new Error('Compute worker timed out; operation stopped safely')),120000);
   this.cancelJob=()=>{const error=new Error('Compute cancelled');error.name='AbortError';finish(error);};
   worker.addEventListener('message',message);worker.addEventListener('error',failed);worker.addEventListener('messageerror',failed);
   try{worker.postMessage(payload,transferBuffers(payload));}catch(error){finish(error instanceof Error?error:new Error(String(error)));}
  });
 }
 dispose(){this.cancelJob?.();this.worker?.terminate();this.worker=null;}
}
