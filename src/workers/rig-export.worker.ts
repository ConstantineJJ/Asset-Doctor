import * as THREE from 'three';
import { unpackRoot,transferBuffers } from './GeometryPacket';
import { unpackClips } from '../animation/ClipPacket';
import { patchRigGlb } from '../rig/RigGlbPatch';
import { verifyEditedRig } from '../rig/RigExportVerification';
import { disposeModelResources } from '../loaders/ModelResources';

const scope=self as unknown as {onmessage:(event:MessageEvent)=>void;postMessage:(message:unknown,transfer?:ArrayBuffer[])=>void};
scope.onmessage=async({data})=>{
  let root:THREE.Group|undefined;
  try {
    root=unpackRoot(data.root);
    const buffer=patchRigGlb(data.patch);
    const verification=await verifyEditedRig(data.patch,buffer,root,unpackClips(data.clips),data.identities,data.resourceBaseUrl);
    const result={buffer,verification};scope.postMessage({success:true,result},transferBuffers(result));
  } catch(error) {scope.postMessage({success:false,error:error instanceof Error?error.message:String(error)});}
  finally {if(root)disposeModelResources(root);}
};
