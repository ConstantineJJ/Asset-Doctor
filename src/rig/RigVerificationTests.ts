import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rigFixture } from '../../tests/rig-fixtures';
import { GLBLoaderService } from '../loaders/GLBLoaderService';
import { packRoot,unpackRoot } from '../workers/GeometryPacket';
import { packClips,unpackClips } from '../animation/ClipPacket';
import { RigEditSession } from './RigEditSession';
import { buildRigExportPacket,patchRigGlb,parseGlb } from './RigGlbPatch';
import { rigIdentities,verifyEditedRig,verifyRigSourcePreservation } from './RigExportVerification';
import { disposeModelResources } from '../loaders/ModelResources';

function encode(document:any,binary:Uint8Array) {
  const json=new TextEncoder().encode(JSON.stringify(document)),length=Math.ceil(json.length/4)*4;
  const buffer=new ArrayBuffer(28+length+binary.length),view=new DataView(buffer);
  [0x46546c67,2,buffer.byteLength,length,0x4e4f534a].forEach((value,index)=>view.setUint32(index*4,value,true));
  new Uint8Array(buffer,20,length).fill(32);new Uint8Array(buffer,20,json.length).set(json);
  view.setUint32(20+length,binary.length,true);view.setUint32(24+length,0x004e4942,true);new Uint8Array(buffer,28+length).set(binary);return buffer;
}

export async function runRigVerificationTests() {
  const results:{name:string;passed:boolean;actual?:string;expected?:string}[]=[];
  for(const scenario of ['linear/step/cubic worker deformation','morph worker deformation','renamed clips','corrupted clip name','corrupted original source bytes','corrupted edited skin IBM','corrupted replacement skin weights','removed active stream metadata','corrupted authored rest']) {
    const loader=new GLBLoaderService();let root:THREE.Group|undefined,expected:THREE.Group|undefined;
    try {
      const fixture=rigFixture({morphWeights:scenario.includes('morph')});
      const loaded=await loader.loadFromArrayBuffer(fixture.buffer,'rig.glb');root=loaded.root;
      const session=new RigEditSession(root,loaded.animations);session.enterEdit();
      session.commitJoint(root.getObjectByName('Root')!.uuid,{position:[1.4,2.1,.2],quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.2).toArray()});session.setClipDuration(2,7);
      if(scenario.includes('clip'))session.renameClip(2,'Удар / Strike');
      const packet=buildRigExportPacket(session,fixture.buffer);
      if(scenario==='corrupted replacement skin weights') {
        let mesh:THREE.SkinnedMesh|undefined;root.traverse(node=>{if(node instanceof THREE.SkinnedMesh)mesh=node;});
        packet.repairs.push({node:5,mesh:0,primitive:0,operations:['normalize-skin-weights'],attributes:{WEIGHTS_0:{values:Float32Array.from(mesh!.geometry.getAttribute('skinWeight').array),size:4}}});
      }
      let output=patchRigGlb(packet);
      expected=unpackRoot(structuredClone(packRoot(root)));
      const clips=unpackClips(structuredClone(packClips(session.clips)));
      assert.equal((clips[2].tracks[0] as any).createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline,true);
      if(scenario==='corrupted original source bytes') {
        parseGlb(output).binary[0]^=1;
        assert.throws(()=>verifyRigSourcePreservation(packet,output));
      } else {
        if(scenario==='corrupted replacement skin weights') {
          const baseline=await verifyEditedRig(packet,output,expected,clips,rigIdentities(root));assert.equal(baseline.status,'VERIFIED',baseline.reasons.join('; '));
          const {document,binary}=parseGlb(output),accessor=document.accessors[document.meshes[0].primitives[0].attributes.WEIGHTS_0],view=document.bufferViews[accessor.bufferView],values=new Float32Array(binary.buffer,binary.byteOffset+view.byteOffset,accessor.count*4);
          for(let i=0;i<values.length;i++)values[i]*=2;
        }
        if(scenario==='removed active stream metadata') {
          const {document,binary}=parseGlb(output),accessor=document.accessors[document.skins[0].inverseBindMatrices];
          delete accessor.name;output=encode(document,binary);
        }
        if(scenario==='corrupted authored rest') {
          const {document,binary}=parseGlb(output);document.nodes[1].translation[0]+=.01;output=encode(document,binary);
        }
        if(scenario==='corrupted clip name') {
          const {document,binary}=parseGlb(output);document.animations[2].name='Lost name';output=encode(document,binary);
        }
        if(scenario==='corrupted edited skin IBM') {
          const {document,binary}=parseGlb(output),accessor=document.accessors[document.skins[0].inverseBindMatrices],view=document.bufferViews[accessor.bufferView];
          new DataView(binary.buffer,binary.byteOffset+view.byteOffset+(accessor.byteOffset??0)).setFloat32(0,42,true);
        }
        const verification=await verifyEditedRig(packet,output,expected,clips,rigIdentities(root));
        if(scenario.startsWith('corrupted') || scenario==='removed active stream metadata') {
          assert.equal(verification.status,'REGRESSION');assert.ok(verification.reasons.some(reason=>/Serialized replacement bytes|Active accessor author metadata|Serialized authored rest|Animation name/.test(reason)));
        }
        else {
          assert.equal(verification.status,'VERIFIED',verification.reasons.join('; '));
          let vertices=0;root.traverse(node=>{if(node instanceof THREE.Mesh)vertices+=node.geometry.getAttribute('position').count;});
          assert.equal(verification.sampledVertices,vertices*(1+verification.phases.length*session.clips.length));
          assert.equal(verification.sourcePreserved,true);
        }
      }
      results.push({name:`Rig ${scenario}`,passed:true});
    } catch(error) {results.push({name:`Rig ${scenario}`,passed:false,actual:String(error)});}
    finally {if(root)disposeModelResources(root);if(expected)disposeModelResources(expected);loader.dispose();}
  }
  return results;
}
