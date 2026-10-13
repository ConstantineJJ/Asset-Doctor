import * as THREE from 'three';
import {SurgicalHealEngine} from '../heal/SurgicalHealEngine';
import {healMetrics} from '../heal/HealVerification';
import {analyzeMeshTopology} from '../analysis/TopologyAnalyzer';
import {meshTopologyData} from '../analysis/MeshTopologyData';
import {packGeometry,unpackRoot,transferBuffers} from './GeometryPacket';
const scope=self as unknown as {onmessage:(event:MessageEvent)=>void;postMessage:(message:unknown,transfer?:ArrayBuffer[])=>void};

scope.onmessage=({data})=>{
 try {
  const root=unpackRoot(data.root),mesh=root.getObjectByProperty('uuid',data.meshUuid) as THREE.Mesh;
  if(!mesh?.isMesh)throw new Error('Repair target missing');
  let result:unknown;
  if(data.kind==='measure')result=healMetrics(analyzeMeshTopology(meshTopologyData(mesh)),mesh.geometry,mesh);
  else {
   const engine=new SurgicalHealEngine();
   const preview=(() => {
    switch(data.operation) {
     case 'remove-degenerate-triangles':return engine.previewRemoveDegenerateTriangles(root,mesh.uuid);
     case 'remove-unreferenced-vertices':return engine.previewRemoveUnreferencedVertices(root,mesh.uuid);
     case 'recalculate-normals':return engine.previewRecalculateNormals(root,mesh.uuid,data.issueId);
     case 'merge-exact-duplicate-vertices':return engine.previewMergeExactDuplicateVertices(root,mesh.uuid);
     case 'normalize-skin-weights':return engine.previewNormalizeSkinWeights(root,mesh.uuid);
     case 'remove-exact-duplicate-triangles':return engine.previewRemoveExactDuplicateTriangles(root,mesh.uuid);
     case 'consolidate-duplicate-skin-influences':return engine.previewConsolidateDuplicateSkinInfluences(root,mesh.uuid);
     default:throw new Error('Unknown repair operation');
    }
   })();
   const pending=engine.getComputedPlan();
   const replacement=pending?.mutation==='index-only'?new THREE.BufferGeometry().setIndex(pending.replacementIndex):pending?.replacementGeometry;
   result={preview,plan:pending&&replacement?{mutation:pending.mutation,geometryUuid:pending.geometryUuid,snapshot:pending.snapshot,replacement:packGeometry(replacement)}:null};
  }
  scope.postMessage({success:true,result},transferBuffers(result));
 }catch(error){scope.postMessage({success:false,error:String(error instanceof Error?error.message:error)});}
};
