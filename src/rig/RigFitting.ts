import * as THREE from 'three';
import {documentMatrix} from '../viewer/AssetPresentation';
import {FittingSurfaceFrame,surfaceAxisAngle} from './FittingSurfaceFrame';
import {clipSurface,clipInfluence,surfaceMoment,type WeightedPoint} from './FittingSurface';
export type FitStatus='suggested'|'aligned'|'insufficient'|'axis-missing'|'outside'|'uncertain';
export type FitReason='branch'|'coverage'|'large-shift'|'unstable-section'|'surface-axis';
export interface FitProposal {uuid:string;name:string;current:number[];target:number[];support:number;offset:number;length:number;status:FitStatus;reason?:FitReason}
export interface RigFitResult {proposals:FitProposal[];vertices:number}
export interface FittingNode {uuid:string;parent:string|null;bone:boolean;position:number[]}
export const fittingShiftLimit=.35;
/** The same reference frames constrain both analysis and the receiving command boundary. */
export function fittingFrames(nodes:FittingNode[]) {
 const byId=new Map(nodes.map(node=>[node.uuid,node])),children=new Map<string,string[]>();
 for(const node of nodes)if(node.bone&&node.parent){let parent=byId.get(node.parent);while(parent&&!parent.bone)parent=parent.parent?byId.get(parent.parent):undefined;if(parent){const list=children.get(parent.uuid)??[];list.push(node.uuid);children.set(parent.uuid,list);}}
 return new Map(nodes.filter(node=>node.bone).map(node=>{
  const current=new THREE.Vector3().fromArray(node.position),direct=children.get(node.uuid)??[];let parent=node.parent?byId.get(node.parent):undefined;
  while(parent&&!parent.bone)parent=parent.parent?byId.get(parent.parent):undefined;
  const direction=direct.length===1?new THREE.Vector3().fromArray(byId.get(direct[0])!.position).sub(current):parent?current.clone().sub(new THREE.Vector3().fromArray(parent.position)):new THREE.Vector3();
  const length=direction.length(),frame={current,axis:length>1e-10?direction.divideScalar(length):null,length,branch:direct.length>1};return [node.uuid,frame] as const;
 }));
}
/** Local surface fitting: never substitute tessellation density for geometric evidence. */
export function analyzeRigFitting(root:THREE.Group):RigFitResult {
 root.updateWorldMatrix(true,true);root.updateMatrixWorld(true);
 const nodes:FittingNode[]=[],meshes:THREE.SkinnedMesh[]=[];
 root.traverse(node=>{nodes.push({uuid:node.uuid,parent:node.parent?.uuid??null,bone:node instanceof THREE.Bone,position:new THREE.Vector3().setFromMatrixPosition(documentMatrix(node)).toArray()});if(node instanceof THREE.SkinnedMesh)meshes.push(node);});
 const frames=fittingFrames(nodes),stats=new Map([...frames].map(([uuid,frame])=>{
  const u=frame.axis?new THREE.Vector3(Math.abs(frame.axis.x)<.8?1:0,0,Math.abs(frame.axis.x)<.8?0:1).cross(frame.axis).normalize():new THREE.Vector3(),v=frame.axis?frame.axis.clone().cross(u):new THREE.Vector3();
  const record={...frame,u,v,surface:new FittingSurfaceFrame(frame.current),spanMin:Infinity,spanMax:-Infinity,total:0,nearest:Infinity,support:new Set<number>(),sections:[0,1,2].map(()=>({mass:0,sum:new THREE.Vector3()})),sides:[0,0,0,0]};return [uuid,record] as const;
 }));
 const bounds=new THREE.Box3(),delta=new THREE.Vector3();let vertices=0,base=0;
 const entries=meshes.map(mesh=>{
  const geometry=mesh.geometry,joints=geometry.getAttribute('skinIndex'),weights=geometry.getAttribute('skinWeight'),positions=geometry.getAttribute('position');
  if(!positions||!joints||!weights||joints.itemSize!==4||weights.itemSize!==4||joints.count!==positions.count||weights.count!==positions.count)throw new Error('Fitting skin influence attributes are invalid.');
  if(mesh.skeleton.bones.some(bone=>!stats.has(bone.uuid)))throw new Error('Fitting joint is outside the asset.');
  const matrix=documentMatrix(mesh);if(!Number.isFinite(matrix.determinant())||Math.abs(matrix.determinant())<1e-10)throw new Error('Fitting requires nonsingular document transforms.');
  const used=geometry.index?new Set(geometry.index.array):null;
  if(used)for(const index of used)if(!Number.isInteger(index)||index<0||index>=positions.count)throw new Error('Fitting geometry indices are invalid.');
  const triangleCount=geometry.index?.count??positions.count;if(triangleCount%3)throw new Error('Fitting requires triangle surface geometry.');
  mesh.skeleton.update();const rest=new Float64Array(positions.count*3),point=new THREE.Vector3();
  for(let index=0;index<positions.count;index++) {
   if(used&&!used.has(index))continue;let sum=0;
   for(let slot=0;slot<4;slot++){const joint=joints.getComponent(index,slot),weight=weights.getComponent(index,slot);if(!Number.isInteger(joint)||joint<0||joint>=mesh.skeleton.bones.length||!Number.isFinite(weight)||weight<0)throw new Error('Fitting skin weights or influences are invalid.');sum+=weight;}
   if(Math.abs(sum-1)>1e-4)throw new Error('Fitting skin weights must have a unit sum.');
   const totals=new Map<string,number>();for(let slot=0;slot<4;slot++){const id=mesh.skeleton.bones[joints.getComponent(index,slot)].uuid;totals.set(id,(totals.get(id)??0)+weights.getComponent(index,slot));}for(const [id,weight]of totals)if(weight>=.1)stats.get(id)!.total++;
   mesh.getVertexPosition(index,point).applyMatrix4(matrix);if(!point.toArray().every(Number.isFinite))throw new Error('Fitting geometry contains nonfinite positions.');point.toArray(rest,index*3);bounds.expandByPoint(point);vertices++;
  }
  const entry={mesh,joints,weights,rest,triangleCount,base};base+=positions.count;return entry;
 });
 // Geometry fixes the section direction and width across Apply and GLB roundtrips.
 for(const pass of [0,1,2]) {
  if(pass===1)for(const [uuid,item]of stats){
   if(!item.axis||item.branch)continue;
   item.axis=item.surface.axis(frames.get(uuid)!.axis!);
   if(item.axis){item.u.set(Math.abs(item.axis.x)<.8?1:0,0,Math.abs(item.axis.x)<.8?0:1).cross(item.axis).normalize();item.v.copy(item.axis).cross(item.u);}
  }
  for(const entry of entries)for(let t=0;t<entry.triangleCount;t+=3) {
  const indices=[0,1,2].map(slot=>entry.mesh.geometry.index?.getX(t+slot)??t+slot),points=indices.map(index=>new THREE.Vector3().fromArray(entry.rest,index*3));
  if(points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).lengthSq()<1e-30)continue;
  const influences=new Map<string,number[]>();
  indices.forEach((index,corner)=>{for(let slot=0;slot<4;slot++){const weight=entry.weights.getComponent(index,slot);if(!weight)continue;const id=entry.mesh.skeleton.bones[entry.joints.getComponent(index,slot)].uuid,list=influences.get(id)??[0,0,0];list[corner]+=weight;influences.set(id,list);}});
  for(const [uuid,weights]of influences) {
   const item=stats.get(uuid)!;if(!item.axis||item.branch||Math.max(...weights)<.1)continue;
   const original:WeightedPoint[]=points.map((point,i)=>({point,weight:weights[i]})),polygon=Math.min(...weights)<.1?clipInfluence(original,.1):original;
   if(polygon.length<3||surfaceMoment(polygon).mass<=0)continue;
   if(pass===0){item.surface.add(polygon);continue;}
   const axial=polygon.map(vertex=>delta.copy(vertex.point).sub(item.current).dot(item.axis!)),min=Math.min(...axial),max=Math.max(...axial);
   if(pass===1){item.spanMin=Math.min(item.spanMin,min);item.spanMax=Math.max(item.spanMax,max);item.nearest=Math.min(item.nearest,min<=0&&max>=0?0:Math.min(Math.abs(min),Math.abs(max)));continue;}
   if(item.nearest>item.length*.5)continue;
   const span=item.spanMax-item.spanMin,band=Math.max(span*.2,item.nearest+span*.08);
   for(let section=0;section<3;section++) {
    const centre=(section-1)*span*.15;
    if(max<centre-band||min>centre+band)continue;
    const clipped=clipSurface(clipSurface(polygon,item.axis,item.current,centre-band,true),item.axis,item.current,centre+band,false),moment=surfaceMoment(clipped);
    if(moment.mass<=0)continue;item.sections[section].mass+=moment.mass;item.sections[section].sum.add(moment.sum);
    if(section===1){indices.forEach((index,i)=>{if(weights[i]>=.1)item.support.add(entry.base+index);});for(let side=0;side<4;side++){const positive=side%2===0;item.sides[side]+=surfaceMoment(clipSurface(clipped,side<2?item.u:item.v,item.current,(positive?1:-1)*item.length*1e-4,positive)).mass;}}
   }
  }
 }
 }
 const diagonal=bounds.isEmpty()?0:bounds.getSize(new THREE.Vector3()).length();
 const proposals=[...stats].map(([uuid,item])=>{
  let status:FitStatus='insufficient',reason:FitReason|undefined,target=item.current.clone();const central=item.sections[1];
  if(item.total<6)status='insufficient';
  else if(item.branch){status='uncertain';reason='branch';}
  else if(!item.axis){status='uncertain';reason='surface-axis';}
  else if(item.nearest>item.length*.5&&Number.isFinite(item.nearest))status='outside';
  else if(item.support.size>=6&&central.mass>0) {
   delta.copy(central.sum).divideScalar(central.mass).sub(item.current);delta.addScaledVector(item.axis,-delta.dot(item.axis));
   const candidate=item.current.clone().add(delta);
   const stable=item.sections.every(section=>{if(section.mass<=0)return false;const centre=section.sum.clone().divideScalar(section.mass).sub(item.current);centre.addScaledVector(item.axis!,-centre.dot(item.axis!));return centre.distanceTo(delta)<=Math.min(item.length,item.spanMax-item.spanMin)*.1;});
   if(delta.length()<=Math.max(1e-7,diagonal*1e-5,item.length*1e-5))status='aligned';
   else if(Math.abs(item.axis.dot(frames.get(uuid)!.axis!))<Math.cos(surfaceAxisAngle)){status='uncertain';reason='surface-axis';}
   else if(delta.length()>item.length*fittingShiftLimit){status='uncertain';reason='large-shift';}
   else if(item.sides.some(mass=>mass<central.mass*.08)){status='uncertain';reason='coverage';}
   else if(!stable){status='uncertain';reason='unstable-section';}
   else {status='suggested';target=candidate;}
  }
  return {uuid,name:root.getObjectByProperty('uuid',uuid)!.name,current:item.current.toArray(),target:target.toArray(),support:item.support.size,offset:target.distanceTo(item.current),length:item.length,status,...(reason?{reason}:{})};
 });
 return {proposals,vertices};
}
