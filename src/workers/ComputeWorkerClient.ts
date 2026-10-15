import {transferBuffers} from './GeometryPacket';
import {ByteBudget,binaryBytes,workerInputBudget} from '../performance/MemoryBudget';
import {systemLog} from '../platform/SystemLog';

/** One CPU job per client; cancellation destroys the executing worker. */
export class ComputeWorkerClient {
 private worker:Worker|null=null;
 private cancelJob:(()=>void)|null=null;
 constructor(private readonly create:()=>Worker,private readonly budget:ByteBudget=workerInputBudget) {}
 request<T>(payload:unknown,context:Record<string,unknown>={}):Promise<T> {
  const operation=systemLog.begin('compute',context);
  if(this.cancelJob){const error=new Error('Compute worker is busy');operation.end('failed',{error});return Promise.reject(error);}
  let release:()=>void;try{const bytes=binaryBytes(payload);release=this.budget.reserve(bytes);systemLog.record('debug','compute','input_reserved',{fileBytes:bytes},operation.id);}catch(error){operation.end('failed',{error});return Promise.reject(error);}
  return new Promise((resolve,reject)=>{
   let worker:Worker;try {worker=this.worker ?? this.create();this.worker=worker;}catch(error){release();operation.end('failed',{error});reject(error);return;}
   let settled=false;
   const finish=(error?:Error,result?:T)=>{if(settled)return;settled=true;release();clearTimeout(timer);worker.removeEventListener('message',message);worker.removeEventListener('error',failed);worker.removeEventListener('messageerror',failed);this.cancelJob=null;
    if(error){operation.end(error.name==='AbortError'?'cancelled':'failed',{error});worker.terminate();if(this.worker===worker)this.worker=null;reject(error);}else {operation.end('completed');resolve(result!);}};
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
