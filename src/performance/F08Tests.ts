import * as THREE from 'three';
import {estimateObjectGeometryBytes} from './PerformanceProfiler';
import {SurgicalHealEngine} from '../heal/SurgicalHealEngine';
import {AssetSession} from '../session/AssetSession';
import {ExportCoordinator} from '../export/ExportCoordinator';

export function runF08Tests(){
 const results:{name:string;passed:boolean;actual?:unknown;expected?:unknown}[]=[];
 const storage=new ArrayBuffer(4096),root=new THREE.Group();
 const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(storage,0,9),3));
 const other=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(storage,128,6),3));
 root.add(new THREE.Mesh(geometry),new THREE.Mesh(other),new THREE.LineSegments(other),new THREE.Points(other));
 const actual=estimateObjectGeometryBytes(root);
 results.push({name:'F08 live geometry counts shared backing storage once across Mesh Line Points and subarrays',passed:actual===4096,actual,expected:4096});
 const lineRoot=new THREE.Group();lineRoot.add(new THREE.Line(other));
 results.push({name:'F08 non-mesh geometry is included in retained memory',passed:estimateObjectGeometryBytes(lineRoot)===4096});
 const samplesA:unknown[]=[],samplesB:unknown[]=[];
 const sink=(samples:unknown[])=>({record:()=>{},setMemory:(memory:unknown)=>samples.push(memory)});
 const first=new SurgicalHealEngine(undefined,sink(samplesA)),second=new SurgicalHealEngine(undefined,sink(samplesB));
 first.cancelPreview();
 results.push({name:'F08 Heal emits only to its explicit metrics sink',passed:samplesA.length===1&&samplesB.length===0});
 first.clear();second.clear();geometry.dispose();other.dispose();
 const session=new AssetSession<object,ArrayBuffer>(),old=session.beginLoad();session.beginLoad();
 results.push({name:'F08 session invalidates older loads without replacing the displayed asset',passed:session.loadRevision!==old&&session.root===null});
 session.replace(root,storage);session.clear();
 results.push({name:'F08 session disposal drops borrowed source and root references',passed:session.root===null&&session.source===null});
 const coordinator=new ExportCoordinator<object>(),oldExport=coordinator.begin();coordinator.invalidate();const current=coordinator.begin(),result={};
 const refused=!coordinator.publish(oldExport,{}),oldFinish=coordinator.finish(oldExport);
 results.push({name:'F08 stale export cannot publish or unlock a newer export/save operation',passed:refused&&!oldFinish&&coordinator.busy&&coordinator.publish(current,result)&&coordinator.finish(current)&&coordinator.result===result&&!coordinator.busy});
 return results;
}
