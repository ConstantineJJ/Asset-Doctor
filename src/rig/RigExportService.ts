import * as THREE from 'three';
import { ComputeWorkerClient } from '../workers/ComputeWorkerClient';
import { packRoot } from '../workers/GeometryPacket';
import { packClips } from '../animation/ClipPacket';
import { captureGeometry,geometryMatches } from '../heal/GeometrySnapshot';
import type { HealOperationReport } from '../types';
import { buildRigExportPacket } from './RigGlbPatch';
import { rigIdentities,type RigVerification } from './RigExportVerification';
import type { RigEditSession } from './RigEditSession';

export interface RigExportResult {fileName:string;buffer:ArrayBuffer;verification:RigVerification;revision:number;milliseconds:number;stillCurrent:()=>boolean}
export class RigExportService {
  private compute=new ComputeWorkerClient(()=>new Worker(new URL('../workers/rig-export.worker.ts',import.meta.url),{type:'module'}));
  cancelActive() {this.compute.dispose();}
  async export(session:RigEditSession,source:ArrayBuffer,fileName:string,reports:HealOperationReport[]=[],geometrySource:(mesh:THREE.Mesh)=>THREE.BufferGeometry=mesh=>mesh.geometry):Promise<RigExportResult> {
    const start=performance.now(),revision=session.revision,authored=session.snapshot();
    const patch=buildRigExportPacket(session,source,reports,geometrySource);
    await new Promise(resolve=>setTimeout(resolve,0));
    if(revision!==session.revision)throw new Error('Rig export was invalidated.');
    const root=packRoot(session.root,geometrySource);
    const override=(node:typeof root)=>{
      const rest=authored.nodes.get(node.uuid);
      if(rest)node.matrix=new THREE.Matrix4().compose(new THREE.Vector3().fromArray(rest.position),new THREE.Quaternion().fromArray(rest.quaternion),new THREE.Vector3().fromArray(rest.scale)).toArray();
      if(authored.morphs.has(node.uuid))node.morphInfluences=authored.morphs.get(node.uuid)!.slice();
      node.children.forEach(override);
    };override(root);
    const geometries:{mesh:THREE.Mesh;geometry:THREE.BufferGeometry;snapshot:ReturnType<typeof captureGeometry>}[]=[];
    const binds:{mesh:THREE.SkinnedMesh;matrix:number[];inverses:number[][]}[]=[];
    session.root.traverse(node=>{
      if(node instanceof THREE.Mesh&&!node.name.startsWith('__ascope_internal')){const geometry=geometrySource(node);geometries.push({mesh:node,geometry,snapshot:captureGeometry(geometry)});}
      if(node instanceof THREE.SkinnedMesh)binds.push({mesh:node,matrix:node.bindMatrix.toArray(),inverses:node.skeleton.boneInverses.map(matrix=>matrix.toArray())});
    });
    const clipSignature=JSON.stringify(packClips(session.clips),(_key,value)=>ArrayBuffer.isView(value)?Array.from(value as any):value);
    const result=await this.compute.request<{buffer:ArrayBuffer;verification:RigVerification}>({patch,root,clips:packClips(authored.clips),identities:rigIdentities(session.root,session.exportNodeIndices()),resourceBaseUrl:typeof window!=='undefined'?new URL('./',window.location.href).href:undefined});
    const stillCurrent=()=>{
      if(session.isGestureActive)return false;
      if(session.revision!==revision || geometries.some(({mesh,geometry,snapshot})=>geometrySource(mesh)!==geometry||!geometryMatches(geometry,snapshot)) || binds.some(({mesh,matrix,inverses})=>JSON.stringify([mesh.bindMatrix.toArray(),mesh.skeleton.boneInverses.map(matrix=>matrix.toArray())])!==JSON.stringify([matrix,inverses])) || JSON.stringify(packClips(session.clips),(_key,value)=>ArrayBuffer.isView(value)?Array.from(value as any):value)!==clipSignature)return false;
      if(session.mode==='edit')for(const [uuid,rest] of authored.nodes) {
          const node=session.root.getObjectByProperty('uuid',uuid);
          if(!node || JSON.stringify([node.position.toArray(),node.quaternion.toArray(),node.scale.toArray()])!==JSON.stringify([rest.position,rest.quaternion,rest.scale]))return false;
      }
      return true;
    };
    if(!stillCurrent())throw new Error('Rig/geometry/animation changed while verifying export.');
    return {...result,fileName:fileName.replace(/\.glb$/i,'')+'_rig-edited.glb',revision,milliseconds:performance.now()-start,stillCurrent};
  }
}
