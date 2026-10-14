import * as THREE from 'three';
import {documentMatrix} from '../viewer/AssetPresentation';
export type FitStatus='suggested'|'aligned'|'insufficient'|'axis-missing'|'outside';
export interface FitProposal {uuid:string;name:string;current:number[];target:number[];support:number;offset:number;length:number;status:FitStatus}
export interface RigFitResult {proposals:FitProposal[];vertices:number}
export interface FittingNode {uuid:string;parent:string|null;bone:boolean;position:number[]}
/** The same reference frames constrain both analysis and the receiving command boundary. */
export function fittingFrames(nodes:FittingNode[]) {
 const byId=new Map(nodes.map(node=>[node.uuid,node])),children=new Map<string,string[]>();
 for(const node of nodes)if(node.bone&&node.parent){const list=children.get(node.parent)??[];list.push(node.uuid);children.set(node.parent,list);}
 return new Map(nodes.filter(node=>node.bone).map(node=>{
  const current=new THREE.Vector3().fromArray(node.position),direct=children.get(node.uuid)??[];let parent=node.parent?byId.get(node.parent):undefined;
  while(parent&&!parent.bone)parent=parent.parent?byId.get(parent.parent):undefined;
  const direction=direct.length===1?new THREE.Vector3().fromArray(byId.get(direct[0])!.position).sub(current):parent?current.clone().sub(new THREE.Vector3().fromArray(parent.position)):new THREE.Vector3();
  const length=direction.length(),frame={current,axis:length>1e-10?direction.divideScalar(length):null,length};return [node.uuid,frame] as const;
 }));
}
/** A local influence-section assist, not anatomy recognition or whole-skeleton scaling. */
export function analyzeRigFitting(root:THREE.Group):RigFitResult {
 root.updateWorldMatrix(true,true);root.updateMatrixWorld(true);
 const bones:THREE.Bone[]=[],meshes:THREE.SkinnedMesh[]=[];
 root.traverse(node=>{if(node instanceof THREE.Bone)bones.push(node);if(node instanceof THREE.SkinnedMesh)meshes.push(node);});
 const nodes:FittingNode[]=[];root.traverse(node=>nodes.push({uuid:node.uuid,parent:node.parent?.uuid??null,bone:node instanceof THREE.Bone,position:new THREE.Vector3().setFromMatrixPosition(documentMatrix(node)).toArray()}));const frames=fittingFrames(nodes);
 const stats=new Map(bones.map(bone=>{
  const record={bone,...frames.get(bone.uuid)!,total:0,nearest:Infinity,count:0,weight:0,sum:new THREE.Vector3()};return [bone.uuid,record] as const;
 }));
 const entries=meshes.map(mesh=>{
  const geometry=mesh.geometry,joints=geometry.getAttribute('skinIndex'),weights=geometry.getAttribute('skinWeight'),positions=geometry.getAttribute('position');
  if(!positions||!joints||!weights||joints.itemSize!==4||weights.itemSize!==4||joints.count!==positions.count||weights.count!==positions.count)throw new Error('Fitting skin influence attributes are invalid.');
  if(mesh.skeleton.bones.some(bone=>!stats.has(bone.uuid)))throw new Error('Fitting joint is outside the asset.');
  const matrix=documentMatrix(mesh);if(!Number.isFinite(matrix.determinant())||Math.abs(matrix.determinant())<1e-10)throw new Error('Fitting requires nonsingular document transforms.');
  const used=geometry.index?new Set(geometry.index.array):null;
  if(used)for(const index of used)if(!Number.isInteger(index)||index<0||index>=positions.count)throw new Error('Fitting geometry indices are invalid.');
  mesh.skeleton.update();return {mesh,joints,weights,count:positions.count,matrix,used};
 });
 const bounds=new THREE.Box3(),point=new THREE.Vector3(),delta=new THREE.Vector3();let vertices=0;
 const pass=(second:boolean)=>{
  for(const entry of entries)for(let v=0;v<entry.count;v++) {
   if(entry.used&&!entry.used.has(v))continue;
   if(!second) {
    let sum=0;
    for(let c=0;c<4;c++){const slot=entry.joints.getComponent(v,c),weight=entry.weights.getComponent(v,c);if(!Number.isInteger(slot)||slot<0||slot>=entry.mesh.skeleton.bones.length||!Number.isFinite(weight)||weight<0)throw new Error('Fitting skin weights or influences are invalid.');sum+=weight;}
    if(Math.abs(sum-1)>1e-4)throw new Error('Fitting skin weights must have a unit sum.');
   }
   entry.mesh.getVertexPosition(v,point).applyMatrix4(entry.matrix);
   if(![point.x,point.y,point.z].every(Number.isFinite))throw new Error('Fitting geometry contains nonfinite positions.');
   if(!second){vertices++;bounds.expandByPoint(point);}
   for(let c=0;c<4;c++) {
    const bone=entry.mesh.skeleton.bones[entry.joints.getComponent(v,c)];let seen=false;
    for(let prior=0;prior<c;prior++)if(entry.mesh.skeleton.bones[entry.joints.getComponent(v,prior)]===bone)seen=true;
    if(seen)continue;
    let weight=0;for(let slot=0;slot<4;slot++)if(entry.mesh.skeleton.bones[entry.joints.getComponent(v,slot)]===bone)weight+=entry.weights.getComponent(v,slot);
    if(weight<1e-6)continue;
    const item=stats.get(bone.uuid)!;
    if(!second)item.total++;
    if(!item.axis)continue;
    const axial=Math.abs(delta.copy(point).sub(item.current).dot(item.axis));
    if(!second)item.nearest=Math.min(item.nearest,axial);
    else if(axial<=Math.max(item.length*.2,item.nearest+item.length*.08)) {item.count++;item.weight+=weight;item.sum.addScaledVector(point,weight);}
   }
  }
 };
 pass(false);pass(true);
 const diagonal=bounds.isEmpty()?0:bounds.getSize(new THREE.Vector3()).length();
 const proposals=[...stats.values()].map(item=>{
  let status:FitStatus='insufficient',target=item.current.clone();
  if(item.total>=6) {
   if(!item.axis)status='axis-missing';
   else if(item.nearest>item.length*.5)status='outside';
   else if(item.count>=6&&item.weight>1e-6) {
    delta.copy(item.sum).divideScalar(item.weight).sub(item.current);delta.addScaledVector(item.axis,-delta.dot(item.axis));target.add(delta);
    status=delta.length()>Math.max(1e-7,diagonal*1e-5,item.length*1e-5)?'suggested':'aligned';if(status==='aligned')target.copy(item.current);
   }
  }
  return {uuid:item.bone.uuid,name:item.bone.name,current:item.current.toArray(),target:target.toArray(),support:item.count,offset:target.distanceTo(item.current),length:item.length,status};
 });
 return {proposals,vertices};
}
