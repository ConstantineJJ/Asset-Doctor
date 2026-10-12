import * as THREE from 'three';
import { createPresentationWrapper, documentBounds, documentMatrix, documentToViewer } from './AssetPresentation';
import { analyzeTransforms } from '../analysis/TransformAnalyzer';
import { meshTopologyData } from '../analysis/MeshTopologyData';
import { BoundsCalculator } from './BoundsCalculator';
import { WorkerManager } from '../workers/WorkerManager';

export async function runAssetPresentationTests() {
  const results: {name: string; passed: boolean; actual?: unknown; expected?: unknown}[] = [];
  const root = new THREE.Group();
  root.position.set(120, 9, -4);
  root.rotation.set(0.2, 0.3, -0.1);
  root.scale.set(1.5, 0.75, 2);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshBasicMaterial());
  root.add(mesh);
  root.updateMatrixWorld(true);
  const transform = root.matrix.toArray();
  const baselineIssues = analyzeTransforms(root);
  const baselineBounds = documentBounds(root);
  const baselineData = meshTopologyData(mesh).worldMatrix;
  const wrapper = createPresentationWrapper(root);
  wrapper.rotation.y = 1.2;
  wrapper.position.set(-100, -baselineBounds.min.y, 22);
  wrapper.scale.setScalar(3);
  wrapper.updateMatrixWorld(true);
  results.push({ name:'F03 presentation placement preserves authored TRS and real transform findings',
    passed: JSON.stringify(root.matrix.toArray()) === JSON.stringify(transform) &&
      baselineIssues.some(x => x.id === 'transform-root-rotation') &&
      baselineIssues.some(x => x.id === 'transform-root-scale') &&
      baselineIssues.some(x => x.id === 'transform-far-origin') &&
      JSON.stringify(analyzeTransforms(root)) === JSON.stringify(baselineIssues) });
  results.push({ name:'F03 document bounds and topology locations exclude presentation rotation, offset and scale',
    passed: documentBounds(root).equals(baselineBounds) &&
      JSON.stringify(meshTopologyData(mesh).worldMatrix) === JSON.stringify(baselineData) });
  const docPoint: [number,number,number] = [120,9,-4];
  results.push({ name:'F03 document issue focus maps back into the displayed wrapper space',
    passed: new THREE.Vector3(...documentToViewer(root,docPoint)).distanceTo(new THREE.Vector3(...docPoint).applyMatrix4(wrapper.matrixWorld)) < 1e-9 });
  root.matrixAutoUpdate = false;
  root.matrix.makeTranslation(11,12,13);
  results.push({ name:'F03 authored manual matrices remain respected',
    passed: documentMatrix(root).equals(root.matrix) });
  root.removeFromParent();
  mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();

  const skinRoot = new THREE.Group();
  const bone = new THREE.Bone(); bone.name = 'Joint'; skinRoot.add(bone);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(12),4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));
  const skinned = new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial()); skinRoot.add(skinned);
  skinRoot.updateMatrixWorld(true); skinned.bind(new THREE.Skeleton([bone]));
  const skinPresentation = createPresentationWrapper(skinRoot);
  skinPresentation.position.set(10,7,4); skinPresentation.rotation.y = 0.7;
  const skinBounds = documentBounds(skinRoot);
  results.push({ name:'F03 skinned document bounds exclude the wrapper even before a render',
    passed: skinBounds.min.distanceTo(new THREE.Vector3(0,0,0)) < 1e-7 &&
      skinBounds.max.distanceTo(new THREE.Vector3(1,1,0)) < 1e-7, actual:skinBounds.max.toArray(),expected:[1,1,0] });
  const mixer = new THREE.AnimationMixer(skinRoot);
  const clip = new THREE.AnimationClip('Motion',1,[new THREE.VectorKeyframeTrack('Joint.position',[0,1],[0,0,0,0,2,0])]);
  mixer.clipAction(clip).play(); mixer.setTime(0.5);
  skinRoot.updateMatrixWorld(true);
  skinned.computeBoundingBox();
  const animatedBounds = documentBounds(skinRoot);
  const worldBounds = BoundsCalculator.computeAccurateWorldBounds(skinRoot);
  const posedVertex = skinned.getVertexPosition(0,new THREE.Vector3()).applyMatrix4(skinned.matrixWorld);
  results.push({ name:'F03 authored AnimationMixer deforms skin while viewer bounds follow the wrapper',
    passed: bone.position.y === 1 && Math.abs(animatedBounds.min.y - 1) < 1e-7 &&
      Math.abs(animatedBounds.max.y - 2) < 1e-7 && worldBounds.box.distanceToPoint(posedVertex) < 1e-7,
    actual: [bone.position.y,animatedBounds.min.toArray(),animatedBounds.max.toArray(),worldBounds.box.min.toArray(),worldBounds.box.max.toArray(),posedVertex.toArray()],
    expected: 'joint y=1; document y=[1,2]; viewer bounds contain posed vertex' });
  mixer.stopAllAction(); mixer.uncacheRoot(skinRoot);
  geometry.dispose(); (skinned.material as THREE.Material).dispose(); skinned.skeleton.dispose();

  const cacheRoot = new THREE.Group();
  const cacheMesh = new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()); cacheRoot.add(cacheMesh);
  const cacheWrapper = createPresentationWrapper(cacheRoot);
  const worker = new WorkerManager();
  let hits = 0, misses = 0;
  await worker.analyzeMeshes(cacheRoot);
  cacheWrapper.rotation.y = 1; cacheWrapper.scale.setScalar(2); cacheWrapper.position.y = 10;
  await worker.analyzeMeshes(cacheRoot,undefined,{onMetrics: metrics => {hits=metrics.cacheHits; misses=metrics.cacheMisses;}});
  results.push({name:'F03 presentation-only changes reuse topology data in document space',passed:hits===1 && misses===0});
  cacheRoot.scale.setScalar(2);
  await worker.analyzeMeshes(cacheRoot,undefined,{onMetrics: metrics => {hits=metrics.cacheHits; misses=metrics.cacheMisses;}});
  results.push({name:'F03 actual authored matrix changes still invalidate topology cache',passed:hits===0 && misses===1});
  worker.dispose(); cacheMesh.geometry.dispose(); (cacheMesh.material as THREE.Material).dispose();
  return results;
}
