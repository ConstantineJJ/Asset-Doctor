import * as THREE from 'three';
import {ComputeWorkerClient} from '../workers/ComputeWorkerClient';
import {packRoot} from '../workers/GeometryPacket';
import {captureGeometry,geometryMatches} from '../heal/GeometrySnapshot';
import type {RigEditSession} from './RigEditSession';
import {fittingFrames,type FittingNode,type RigFitResult} from './RigFitting';

export interface FittingReview extends RigFitResult {revision:number;stillCurrent:()=>boolean}
export class RigFittingService {
 private generation=0;
 constructor(private compute:Pick<ComputeWorkerClient,'request'|'dispose'>=new ComputeWorkerClient(()=>new Worker(new URL('../workers/rig-fitting.worker.ts',import.meta.url),{type:'module'}))){}
 cancel(){this.generation++;this.compute.dispose();}
 async analyze(session:RigEditSession,geometrySource:(mesh:THREE.Mesh)=>THREE.BufferGeometry=mesh=>mesh.geometry):Promise<FittingReview> {
  if(session.mode!=='edit'||session.isGestureActive)throw new Error('Enter Edit Skeleton and finish the drag before fitting.');
  const generation=++this.generation,revision=session.revision,rest=session.fittingRest();let activeNodes=0;
  session.root.traverse(node=>{
   activeNodes++;const children=rest.children.get(node.uuid);
   if(rest.objects.get(node.uuid)!==node||!children||children.length!==node.children.length||children.some((id,i)=>id!==node.children[i].uuid))throw new Error('Fitting hierarchy differs from authored rest. Restore or reimport the model.');
   const transform=rest.nodes.get(node.uuid)!;
   const equal=(a:number[],b:number[])=>a.length===b.length&&a.every((value,i)=>Number.isFinite(value)&&Math.abs(value-b[i])<=1e-10);
   if(!equal(node.position.toArray(),transform.position)||!equal(node.quaternion.toArray(),transform.quaternion)||!equal(node.scale.toArray(),transform.scale))throw new Error('Fitting transforms differ from authored rest. Restore or reimport the model.');
   if(!node.matrixAutoUpdate&&!equal(node.matrix.toArray(),new THREE.Matrix4().compose(new THREE.Vector3().fromArray(transform.position),new THREE.Quaternion().fromArray(transform.quaternion),new THREE.Vector3().fromArray(transform.scale)).toArray()))throw new Error('Fitting local matrix differs from authored rest. Restore or reimport the model.');
   const morph=rest.morphs.get(node.uuid);if(morph&&!equal((node as THREE.Mesh).morphTargetInfluences??[],morph))throw new Error('Fitting morph defaults differ from authored rest. Restore or reimport the model.');
   if(node instanceof THREE.SkinnedMesh) {
    const joints=rest.joints.get(node.skeleton),inverses=rest.skins.get(node.skeleton);
    if(!joints||!inverses||joints.length!==node.skeleton.bones.length||joints.some((id,i)=>rest.objects.get(id)!==node.skeleton.bones[i])||JSON.stringify(inverses)!==JSON.stringify(node.skeleton.boneInverses.map(matrix=>matrix.toArray())))throw new Error('Fitting binding differs from authored rest. Restore or reimport the model.');
   }
  });
  if(activeNodes!==rest.objects.size)throw new Error('Fitting hierarchy differs from authored rest. Restore or reimport the model.');
  const packet=packRoot(session.root,geometrySource);
  const override=(node:typeof packet)=>{
   const transform=rest.nodes.get(node.uuid);if(transform)node.matrix=new THREE.Matrix4().compose(new THREE.Vector3().fromArray(transform.position),new THREE.Quaternion().fromArray(transform.quaternion),new THREE.Vector3().fromArray(transform.scale)).toArray();
   if(rest.morphs.has(node.uuid))node.morphInfluences=rest.morphs.get(node.uuid)!.slice();
   const object=session.root.getObjectByProperty('uuid',node.uuid);if(object instanceof THREE.SkinnedMesh)node.inverses=rest.skins.get(object.skeleton)!.map(matrix=>matrix.slice());
   node.children.forEach(override);
  };override(packet);
  const frameNodes:FittingNode[]=[];
  const reference=(node:typeof packet,parent:THREE.Matrix4,parentId:string|null)=>{const matrix=parent.clone().multiply(new THREE.Matrix4().fromArray(node.matrix));frameNodes.push({uuid:node.uuid,parent:parentId,bone:node.type==='bone',position:new THREE.Vector3().setFromMatrixPosition(matrix).toArray()});node.children.forEach(child=>reference(child,matrix,node.uuid));};reference(packet,new THREE.Matrix4(),null);
  const frames=fittingFrames(frameNodes);
  const hierarchy:{node:THREE.Object3D;parent:THREE.Object3D|null;children:THREE.Object3D[];local:string}[]=[];
  const local=(node:THREE.Object3D)=>JSON.stringify([node.uuid,node.name,node.position.toArray(),node.quaternion.toArray(),node.scale.toArray(),node.matrixAutoUpdate,node.matrixAutoUpdate?null:node.matrix.toArray()]);
  session.root.traverse(node=>hierarchy.push({node,parent:node.parent,children:node.children.slice(),local:local(node)}));
  const bindings:{mesh:THREE.SkinnedMesh;skeleton:THREE.Skeleton;bones:THREE.Bone[];state:string}[]=[];
  const binding=(mesh:THREE.SkinnedMesh)=>JSON.stringify([mesh.bindMode,mesh.bindMatrix.toArray(),mesh.skeleton.boneInverses.map(matrix=>matrix.toArray())]);
  session.root.traverse(node=>{if(node instanceof THREE.SkinnedMesh)bindings.push({mesh:node,skeleton:node.skeleton,bones:node.skeleton.bones.slice(),state:binding(node)});});
  const meshes:{mesh:THREE.Mesh;geometry:THREE.BufferGeometry;snapshot:ReturnType<typeof captureGeometry>}[]=[];
  session.root.traverse(node=>{if(node instanceof THREE.Mesh){const geometry=geometrySource(node);meshes.push({mesh:node,geometry,snapshot:captureGeometry(geometry)});}});
  // bindMatrixInverse/matrixWorld are derived presentation state; compare authored binding inputs.
  const stillCurrent=()=>generation===this.generation&&session.revision===revision&&session.mode==='edit'&&!session.isGestureActive
   &&hierarchy.every(item=>item.node.parent===item.parent&&item.node.children.length===item.children.length&&item.children.every((child,i)=>child===item.node.children[i])&&local(item.node)===item.local)
   &&bindings.every(item=>item.mesh.skeleton===item.skeleton&&item.bones.length===item.skeleton.bones.length&&item.bones.every((bone,i)=>bone===item.skeleton.bones[i])&&binding(item.mesh)===item.state)
   &&meshes.every(({mesh,geometry,snapshot})=>geometrySource(mesh)===geometry&&geometryMatches(geometry,snapshot));
  const result=await this.compute.request<RigFitResult>({root:packet});
  if(!stillCurrent())throw new Error('Fitting analysis is stale. Analyze the current model again.');
  if(!result||!Array.isArray(result.proposals)||!Number.isInteger(result.vertices)||result.vertices<0)throw new Error('Fitting worker returned invalid proposals.');
  // Worker data is checked before it can become an authored command.
  const ids=new Set<string>();
  for(const proposal of result.proposals) {
   const bone=session.root.getObjectByProperty('uuid',proposal.uuid);
   if(!(bone instanceof THREE.Bone)||ids.has(proposal.uuid)||![proposal.current,proposal.target].every(point=>point.length===3&&point.every(Number.isFinite))||!Number.isInteger(proposal.support)||proposal.support<0||!Number.isFinite(proposal.offset)||proposal.offset<0||!Number.isFinite(proposal.length)||proposal.length<0||!['suggested','aligned','insufficient','axis-missing','outside'].includes(proposal.status))throw new Error('Fitting worker returned invalid proposals.');
   ids.add(proposal.uuid);
   const frame=frames.get(proposal.uuid)!;if(!frame||proposal.name!==bone.name)throw new Error('Fitting worker returned a mismatched joint.');
   const current=new THREE.Vector3().fromArray(proposal.current),target=new THREE.Vector3().fromArray(proposal.target),delta=target.clone().sub(current),tolerance=Math.max(1e-7,frame.length*1e-6,frame.current.length()*1e-9);
   if(current.distanceTo(frame.current)>tolerance||Math.abs(proposal.length-frame.length)>tolerance||Math.abs(proposal.offset-delta.length())>tolerance||proposal.support>result.vertices)throw new Error('Fitting worker returned inconsistent reference data.');
   if(proposal.status==='suggested'&&(!frame.axis||proposal.support<6||proposal.offset<=tolerance||Math.abs(delta.dot(frame.axis))>tolerance)||proposal.status!=='suggested'&&(proposal.offset>tolerance||delta.length()>tolerance))throw new Error('Fitting worker returned a non-lateral command.');
  }
  let boneCount=0;session.root.traverse(node=>{if(node instanceof THREE.Bone)boneCount++;});if(ids.size!==boneCount)throw new Error('Fitting worker omitted an active joint.');
  return {...result,revision,stillCurrent};
 }
}
