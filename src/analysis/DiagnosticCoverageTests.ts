import * as THREE from 'three';
import type { DiagnosticCoreTestResult } from './DiagnosticCoreTests';
import { analyzeIntegrity } from './IntegrityAnalyzer';
import { analyzeAnimationDiagnostics } from './AnimationDiagnostics';
import { measureRootMotion } from './AnimationAnalyzer';
import { analyzeNormalsAndUv } from './NormalsAndUvAnalyzer';
import { analyzeTransforms } from './TransformAnalyzer';

export function runDiagnosticCoverageTests(): DiagnosticCoreTestResult[] {
  const results: DiagnosticCoreTestResult[] = [];

  {
    const root=new THREE.Group();root.name='Root';
    const cubic=(values:number[])=>{const track=new THREE.VectorKeyframeTrack('Root.position',[0,1],values);const factory=()=>{throw new Error('Diagnostic inspection must not evaluate animation');};(factory as any).isInterpolantFactoryMethodGLTFCubicSpline=true;(track as any).createInterpolant=factory;return track;};
    const moving=new THREE.AnimationClip('Cubic travel',1,[cubic([100,0,0,0,0,0,100,0,0,100,0,0,20,0,0,100,0,0])]);
    const motion=measureRootMotion(moving,['Root']),issues=analyzeAnimationDiagnostics([moving],root);
    results.push({name:'Review cubic root displacement reads values, not tangents',description:'Cubic key blocks contain in tangent, value, out tangent; actual authored translation is 20.',expected:'20 units and one position jump',actual:JSON.stringify({motion,jump:issues.find(i=>i.id==='animation-extreme-position-jumps')}),passed:motion.translation===20&&motion.detected&&issues.some(i=>i.id==='animation-extreme-position-jumps'&&i.count===1)});
    const curved=new THREE.AnimationClip('Cubic curve',1,[cubic([1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1,0,0])]);
    results.push({name:'Review cubic equal keys with active tangents are not static',description:'Equal key values with nonzero Hermite tangents move between keys.',expected:'No static channel finding',actual:JSON.stringify(analyzeAnimationDiagnostics([curved],root).map(i=>i.id)),passed:!analyzeAnimationDiagnostics([curved],root).some(i=>i.id==='animation-static-channels')});
    const still=new THREE.AnimationClip('Cubic still',1,[cubic([100,0,0,5,0,0,0,0,0,0,0,0,5,0,0,-200,0,0])]);
    results.push({name:'Review cubic unused endpoint tangents do not imply movement',description:'First incoming and last outgoing tangents are unused by the evaluated interval.',expected:'One static channel finding',actual:JSON.stringify(analyzeAnimationDiagnostics([still],root).map(i=>i.id)),passed:analyzeAnimationDiagnostics([still],root).some(i=>i.id==='animation-static-channels'&&i.count===1)});
    const slow=curved.clone();slow.name='Slow curve';slow.duration=1000;slow.tracks[0].times[1]=1000;for(let i=0;i<slow.tracks[0].values.length;i++)slow.tracks[0].values[i]*=1e-8;
    results.push({name:'Review cubic static threshold accounts for interval duration',description:'Small derivatives can produce measurable movement over long intervals.',expected:'No static channel finding',actual:JSON.stringify(analyzeAnimationDiagnostics([slow],root).map(i=>i.id)),passed:!analyzeAnimationDiagnostics([slow],root).some(i=>i.id==='animation-static-channels')});
    const rotation=new THREE.QuaternionKeyframeTrack('Root.quaternion',[0,1],[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,Math.SQRT1_2,0,Math.SQRT1_2,0,0,0,0]);
    (rotation as any).createInterpolant=(moving.tracks[0] as any).createInterpolant;
    const rotationMotion=measureRootMotion(new THREE.AnimationClip('Cubic turn',1,[rotation]),['Root']);
    results.push({name:'Review cubic root rotation reads key quaternions',description:'Zero tangent quaternions must not be measured as authored orientations.',expected:'90 degrees',actual:String(rotationMotion.rotation),passed:Math.abs(rotationMotion.rotation-90)<.01});
  }

  {
    const root = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
    );
    geometry.setIndex([0, 1, 7]);
    root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));

    const issues = analyzeIntegrity(root);
    const finding = issues.find((issue) => issue.id === 'integrity-invalid-indices');

    results.push({
      name: 'Integrity Invalid Index Test',
      description: 'Out-of-range mesh indices must be reported as Integrity errors.',
      expected: 'integrity-invalid-indices / ERROR / Integrity',
      actual: finding ? `${finding.id} / ${finding.severity} / ${finding.layer}` : 'missing',
      passed: finding?.severity === 'ERROR' && finding.layer === 'Integrity',
    });
  }

  {
    const root = new THREE.Group();
    const target = new THREE.Object3D();
    target.name = 'Existing';
    root.add(target);

    const clip = new THREE.AnimationClip('BrokenTargets', 1, [
      new THREE.VectorKeyframeTrack('Missing.position', [0, 1], [0, 0, 0, 1, 0, 0]),
    ]);

    const issues = analyzeAnimationDiagnostics([clip], root);
    const finding = issues.find((issue) => issue.id === 'animation-invalid-targets');

    results.push({
      name: 'Animation Target Integrity Test',
      description: 'Animation tracks pointing to missing nodes must be Integrity errors.',
      expected: 'animation-invalid-targets / ERROR / Integrity',
      actual: finding ? `${finding.id} / ${finding.severity} / ${finding.layer}` : 'missing',
      passed: finding?.severity === 'ERROR' && finding.layer === 'Integrity',
    });
  }

  {
    const root = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
    );
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3)
    );
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2));
    geometry.setIndex([0, 1, 2]);
    root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));

    const issues = analyzeNormalsAndUv(root);
    const finding = issues.find((issue) => issue.id === 'uv-zero-area-triangles');

    results.push({
      name: 'Zero Area UV Triangle Test',
      description: 'Collapsed UV0 triangles must be reported without attempting UV regeneration.',
      expected: 'uv-zero-area-triangles / WARNING',
      actual: finding ? `${finding.id} / ${finding.severity}` : 'missing',
      passed: finding?.severity === 'WARNING' && finding.repairability === 'MANUAL',
    });
  }

  {
    const clip = new THREE.AnimationClip('WalkForward', 1, [
      new THREE.VectorKeyframeTrack('Root.position', [0, 1], [0, 0, 0, 1.25, 0, -0.5]),
      new THREE.QuaternionKeyframeTrack(
        'Root.quaternion',
        [0, 1],
        [0, 0, 0, 1, 0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)]
      ),
    ]);

    const measurement = measureRootMotion(clip, ['Root']);

    results.push({
      name: 'Root Motion Vector Measurement Test',
      description: 'Root motion must preserve its measured translation vector and source track for viewport visualization.',
      expected: 'detected=true, translation≈1.346, delta=[1.25,0,-0.5], track=Root.position',
      actual: `detected=${measurement.detected}, translation=${measurement.translation}, delta=[${measurement.delta.join(',')}], track=${measurement.translationTrackName ?? 'missing'}`,
      passed:
        measurement.detected === true &&
        Math.abs(measurement.translation - Math.sqrt(1.25 * 1.25 + 0.5 * 0.5)) < 0.002 &&
        Math.abs(measurement.delta[0] - 1.25) < 1e-6 &&
        Math.abs(measurement.delta[1]) < 1e-6 &&
        Math.abs(measurement.delta[2] + 0.5) < 1e-6 &&
        measurement.translationTrackName === 'Root.position',
    });
  }

  {
    const clip = new THREE.AnimationClip('HandOnly', 1, [
      new THREE.VectorKeyframeTrack('Hand.position', [0, 1], [0, 0, 0, 2, 0, 0]),
    ]);
    const measurement = measureRootMotion(clip, ['Root']);

    results.push({
      name: 'Non Root Motion Rejection Test',
      description: 'Large translation on a non-root channel must not be mislabeled as root motion.',
      expected: 'detected=false, translation=0',
      actual: `detected=${measurement.detected}, translation=${measurement.translation}`,
      passed: measurement.detected === false && measurement.translation === 0,
    });
  }

  {
    const root = new THREE.Group();
    root.rotation.y = Math.PI / 2;
    const child = new THREE.Object3D();
    child.name = 'ScaledRotated';
    child.scale.set(2, 1, 1);
    child.rotation.z = Math.PI / 4;
    root.add(child);

    const issues = analyzeTransforms(root);
    const rootRotation = issues.find((issue) => issue.id === 'transform-root-rotation');
    const combination = issues.find((issue) => issue.id === 'transform-suspicious-combinations');

    results.push({
      name: 'Transform Context Test',
      description: 'Unusual root rotation and non-uniform-scale+rotation combinations should be informational diagnostics.',
      expected: 'root rotation INFO + suspicious combination INFO',
      actual: `root=${rootRotation?.severity ?? 'missing'}, combination=${combination?.severity ?? 'missing'}`,
      passed: rootRotation?.severity === 'INFO' && combination?.severity === 'INFO',
    });
  }

  return results;
}
