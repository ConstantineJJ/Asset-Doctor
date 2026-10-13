import * as THREE from 'three';
import {RepairedExportService} from '../export/RepairedExportService';
import {disposeModelResources} from '../loaders/ModelResources';
import {unpackRoot,transferBuffers} from './GeometryPacket';

const scope=self as unknown as {onmessage:(event:MessageEvent)=>void;postMessage:(message:unknown,transfer?:ArrayBuffer[])=>void};
scope.onmessage=async({data})=>{
 let currentRoot:THREE.Group|undefined;
 try {
  currentRoot=unpackRoot(data.root);
  // This graph supplies actual geometry/skin measurements only. The export core
  // loads and checks pristine authored materials/textures itself, then reopens
  // the output independently. Avoid a redundant source load and image decode.
  const result=await new RepairedExportService(data.resourceBaseUrl,true).exportAndVerify({source:data.source,currentRoot,assetName:data.assetName,healReports:data.healReports});
  scope.postMessage({success:true,result},transferBuffers(result));
 }catch(error){scope.postMessage({success:false,error:String(error instanceof Error?error.message:error)});}
 finally {
  if(currentRoot)disposeModelResources(currentRoot);
 }
};
