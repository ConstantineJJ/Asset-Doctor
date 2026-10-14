import {unpackRoot} from './GeometryPacket';
import {analyzeRigFitting} from '../rig/RigFitting';
import {disposeModelResources} from '../loaders/ModelResources';
const scope=self as unknown as {onmessage:(event:MessageEvent)=>void;postMessage:(message:unknown)=>void};
scope.onmessage=({data})=>{
 let root:ReturnType<typeof unpackRoot>|undefined;
 try{root=unpackRoot(data.root);scope.postMessage({success:true,result:analyzeRigFitting(root)});}
 catch(error){scope.postMessage({success:false,error:error instanceof Error?error.message:String(error)});}
 finally{if(root)disposeModelResources(root);}
};
