import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { SurgicalHealEngine } from './SurgicalHealEngine';
import { healMetrics, verifyHeal } from './HealVerification';
import { readHealReport, saveHealReport } from './HealReportStorage';
import { analyzeMeshTopology } from '../analysis/TopologyAnalyzer';
import { meshTopologyData } from '../analysis/MeshTopologyData';
import {
  getRepairOperationForIssue,
  listRepairOperations,
  previewRepairIssue,
} from './framework/RepairRegistry';
import type { HealthIssue, HealPreview } from '../types';
import { createAssetDoctorTestPatient } from '../loaders/SampleModels';
import { measureGeometryNormals } from '../analysis/NormalsMeasure';
import { measureSkinWeights } from '../analysis/SkinWeightMeasure';
import { buildRepairQueueCandidates, type RepairQueueCandidate } from './RepairQueue';
import { runSafeRepairQueue } from './SafeRepairQueueRunner';
import { RepairedExportService } from '../export/RepairedExportService';
import { GLBLoaderService } from '../loaders/GLBLoaderService';

export interface SurgicalHealTestResult {
  name: string;
  description: string;
  expected: string;
  actual: string;
  passed: boolean;
}

function makeDegenerateFixture() {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,

        2, 0, 0,
        3, 0, 0,
        4, 0, 0,
      ],
      3
    )
  );
  geometry.setIndex([0, 1, 2, 3, 4, 5]);

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = 'DegenerateFixture';
  root.add(mesh);

  return { root, mesh };
}

function makeUnreferencedFixture() {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    7, 7, 7,
    8, 8, 8,
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    1, 0, 0,
    1, 0, 0,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    0, 1,
    0.25, 0.25,
    0.75, 0.75,
  ], 2));
  const interleavedColorData = new THREE.InterleavedBuffer(new Float32Array([
    1, 0, 0, 99,
    0, 1, 0, 99,
    0, 0, 1, 99,
    1, 1, 0, 99,
    1, 0, 1, 99,
  ]), 4);
  geometry.setAttribute('color', new THREE.InterleavedBufferAttribute(interleavedColorData, 3, 0));

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([
    0, 1, 0, 0,
    0, 1, 0, 0,
    0, 1, 0, 0,
    2, 0, 0, 0,
    2, 0, 0, 0,
  ], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([
    0.5, 0.5, 0, 0,
    0.6, 0.4, 0, 0,
    0.7, 0.3, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
  ], 4));

  geometry.morphAttributes.position = [
    new THREE.Float32BufferAttribute([
      0, 0, 0,
      0.1, 0, 0,
      0, 0.1, 0,
      3, 3, 3,
      4, 4, 4,
    ], 3),
  ];
  geometry.morphTargetsRelative = true;
  geometry.setIndex([0, 1, 2]);
  geometry.addGroup(0, 3, 0);
  geometry.setDrawRange(0, 3);

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = 'UnreferencedFixture';
  root.add(mesh);

  return { root, mesh };
}

function makeNormalsFixture(missing = false) {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ], 3));
  geometry.setIndex([0, 1, 2]);

  if (!missing) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
      0, 0, 0,
      0, 0, 0,
      0, 0, 0,
    ], 3));
  }

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = missing ? 'MissingNormalsFixture' : 'ZeroNormalsFixture';
  root.add(mesh);
  return { root, mesh };
}

function makeExactDuplicateFixture() {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, 0, 0,
     0, 0, 0,
     0, 1, 0,
     0, 0, 0,
     1, 1, 0,
     0, 1, 0,
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,
    0.5, 0,
    0.5, 1,
    0.5, 0,
    1, 1,
    0.5, 1,
  ], 2));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = 'ExactDuplicateFixture';
  root.add(mesh);
  return { root, mesh };
}

function makeSkinWeightFixture(includeZeroWeight = false) {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ], 3));
  geometry.setIndex([0, 1, 2]);
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([
    0, 1, 0, 0,
    0, 1, 0, 0,
    0, 1, 0, 0,
  ], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([
    0.60, 0.20, 0, 0,
    0.90, 0.30, 0, 0,
    ...(includeZeroWeight ? [0, 0, 0, 0] : [0.75, 0.25, 0, 0]),
  ], 4));

  const rootBone = new THREE.Bone();
  rootBone.name = 'WeightRoot';
  const childBone = new THREE.Bone();
  childBone.name = 'WeightChild';
  childBone.position.y = 1;
  rootBone.add(childBone);

  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = 'SkinWeightFixture';
  mesh.add(rootBone);
  mesh.bind(new THREE.Skeleton([rootBone, childBone]));
  root.add(mesh);
  root.updateMatrixWorld(true);

  return { root, mesh };
}

function makeDuplicateTriangleFixture() {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ], 3));
  geometry.setIndex([
    0, 2, 1,
    0, 1, 3,
    1, 2, 3,
    2, 0, 3,
    0, 2, 1,
  ]);

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = 'DuplicateTriangleFixture';
  root.add(mesh);
  root.updateMatrixWorld(true);
  return { root, mesh };
}

function makeDuplicateSkinInfluenceFixture() {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ], 3));
  geometry.setIndex([0, 1, 2]);
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([
    0, 0, 1, 0,
    0, 1, 1, 0,
    0, 1, 0, 0,
  ], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([
    0.25, 0.25, 0.50, 0,
    0.50, 0.25, 0.25, 0,
    0.75, 0.25, 0, 0,
  ], 4));

  const rootBone = new THREE.Bone();
  rootBone.name = 'InfluenceRoot';
  const childBone = new THREE.Bone();
  childBone.name = 'InfluenceChild';
  childBone.position.y = 1;
  rootBone.add(childBone);

  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = 'DuplicateSkinInfluenceFixture';
  mesh.add(rootBone);
  mesh.bind(new THREE.Skeleton([rootBone, childBone]));
  root.add(mesh);
  root.updateMatrixWorld(true);
  return { root, mesh };
}

function makeChainedRepairFixture() {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    2, 0, 0,
    3, 0, 0,
    4, 0, 0,
    9, 9, 9,
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 0,
    0, 0, 0,
    0, 0, 0,
    0, 0, 0,
    0, 0, 0,
    0, 0, 0,
    0, 0, 0,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    0, 1,
    0, 0,
    0.5, 0,
    1, 0,
    0.5, 0.5,
  ], 2));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = 'ChainedRepairFixture';
  root.add(mesh);
  root.updateMatrixWorld(true);
  return { root, mesh };
}

function disposeObjectForTest(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export function runSurgicalHealTests(): SurgicalHealTestResult[] {
  const results: SurgicalHealTestResult[] = [];

  {
    const { root, mesh } = makeDegenerateFixture();
    const engine = new SurgicalHealEngine();
    const preview = engine.previewRemoveDegenerateTriangles(root, mesh.uuid);

    results.push({
      name: 'Surgical Heal Preview Test',
      description: 'Preview must detect the degenerate face without mutating the mesh.',
      expected: 'READY, 2 → 1 triangles, source still 2 triangles',
      actual: `${preview.status}, ${preview.trianglesBefore} → ${preview.trianglesAfter}, source=${(mesh.geometry.index?.count ?? 0) / 3}`,
      passed:
        preview.status === 'READY' &&
        preview.affectedTriangles === 1 &&
        preview.trianglesBefore === 2 &&
        preview.trianglesAfter === 1 &&
        mesh.geometry.index?.count === 6,
    });

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  {
    const { root, mesh } = makeDegenerateFixture();
    const engine = new SurgicalHealEngine();
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid);
    const applied = engine.applyPending(root);
    const afterApply = (mesh.geometry.index?.count ?? 0) / 3;
    const undone = engine.undoLast(root);
    const afterUndo = (mesh.geometry.index?.count ?? 0) / 3;

    results.push({
      name: 'Surgical Heal Apply + Undo Test',
      description: 'Apply changes only the index buffer and Undo restores the exact triangle count.',
      expected: 'apply=1 triangle, undo=2 triangles',
      actual: `apply=${afterApply}, undo=${afterUndo}, success=${applied.success && undone.success}`,
      passed: applied.success && undone.success && afterApply === 1 && afterUndo === 2,
    });

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  {
    const { root, mesh } = makeDegenerateFixture();
    mesh.geometry.addGroup(0, 6, 0);

    const engine = new SurgicalHealEngine();
    const preview = engine.previewRemoveDegenerateTriangles(root, mesh.uuid);

    results.push({
      name: 'Surgical Heal Safety Gate Test',
      description: 'v0.1 must refuse grouped geometry instead of risking material-group corruption.',
      expected: 'BLOCKED with source geometry unchanged',
      actual: `${preview.status}, triangles=${(mesh.geometry.index?.count ?? 0) / 3}`,
      passed: preview.status === 'BLOCKED' && mesh.geometry.index?.count === 6,
    });

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  const test = (name: string, check: () => boolean) => {
    let passed = false;
    let actual = 'Contract not satisfied';
    try { passed = check(); actual = passed ? 'Contract satisfied' : actual; }
    catch (error) { actual = String(error); }
    results.push({ name, description: name, expected: 'Contract satisfied', actual, passed });
  };
  const fixtureTest = (name: string, check: (fixture: ReturnType<typeof makeDegenerateFixture>, engine: SurgicalHealEngine) => boolean) => {
    test(name, () => {
      const fixture = makeDegenerateFixture();
      try { return check(fixture, new SurgicalHealEngine()); }
      finally { fixture.mesh.geometry.dispose(); (fixture.mesh.material as THREE.Material).dispose(); }
    });
  };

  fixtureTest('Measured report survives vanished issue and Undo', ({ root, mesh }, engine) => {
    const original = Array.from(mesh.geometry.index!.array);
    const positions = mesh.geometry.attributes.position;
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid);
    const result = engine.applyPending(root, 'Test asset');
    const pending = engine.getLastOperation()!;
    engine.completeVerification(pending.operationId, true);
    const report = engine.getLastOperation()!;
    const undo = engine.undoLast(root);
    return result.success && pending.status === 'PARTIAL' && report.status === 'VERIFIED' &&
      report.before.triangleCount === 2 && report.after?.triangleCount === 1 &&
      report.before.degenerateTriangles === 1 && report.after.degenerateTriangles === 0 &&
      report.after.isolatedVertices === 3 && report.reasons.includes('retainedVertices') &&
      positions === mesh.geometry.attributes.position && undo.success &&
      Array.from(mesh.geometry.index!.array).every((value, i) => value === original[i]) &&
      Boolean(engine.getLastOperation()?.undoneAt);
  });

  for (const [label, change] of [
    ['same-size index edit', (mesh: THREE.Mesh) => mesh.geometry.index!.setX(0, 1)],
    ['position edit', (mesh: THREE.Mesh) => mesh.geometry.attributes.position.setX(0, 8)],
    ['new material groups', (mesh: THREE.Mesh) => mesh.geometry.addGroup(0, 6, 0)],
    ['new draw range', (mesh: THREE.Mesh) => mesh.geometry.setDrawRange(0, 3)],
    ['new UV attribute', (mesh: THREE.Mesh) => mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2))],
    ['new morph attribute', (mesh: THREE.Mesh) => { mesh.geometry.morphAttributes.position = [mesh.geometry.attributes.position.clone()]; }],
  ] as const) {
    fixtureTest(`Stale Preview blocks ${label}`, ({ root, mesh }, engine) => {
      engine.previewRemoveDegenerateTriangles(root, mesh.uuid);
      change(mesh);
      return !engine.applyPending(root).success && mesh.geometry.index!.count === 6 && !engine.getUndoState().available;
    });
  }

  fixtureTest('New geometry sharing blocks Apply', ({ root, mesh }, engine) => {
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid);
    root.add(new THREE.Mesh(mesh.geometry, mesh.material));
    return !engine.applyPending(root).success && mesh.geometry.index!.count === 6;
  });
  fixtureTest('Stale Undo preserves later edits', ({ root, mesh }, engine) => {
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid);
    engine.applyPending(root);
    mesh.geometry.index!.setX(0, 2);
    return !engine.undoLast(root).success && mesh.geometry.index!.getX(0) === 2 && engine.getUndoState().available;
  });
  fixtureTest('Undo refuses newly shared geometry', ({ root, mesh }, engine) => {
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid); engine.applyPending(root);
    root.add(new THREE.Mesh(mesh.geometry, mesh.material));
    return !engine.undoLast(root).success && mesh.geometry.index!.count === 3;
  });
  fixtureTest('Failed refresh remains PARTIAL with Undo', ({ root, mesh }, engine) => {
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid); engine.applyPending(root);
    engine.completeVerification(engine.getLastOperation()!.operationId, false);
    return engine.getLastOperation()?.status === 'PARTIAL' && engine.getUndoState().available;
  });
  fixtureTest('Regression from new boundary takes precedence over failed refresh', ({ root, mesh }, engine) => {
    // A collinear face shares two edges with valid faces; removing it exposes extra boundaries.
    mesh.geometry.setIndex([0, 1, 2, 1, 3, 2, 0, 1, 3]);
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid); engine.applyPending(root);
    engine.completeVerification(engine.getLastOperation()!.operationId, false);
    const report = engine.getLastOperation()!;
    return report.status === 'REGRESSION' && report.reasons.includes('boundaryEdges') && engine.undoLast(root).success;
  });
  fixtureTest('Classifier distinguishes residual defects, missing evidence and unexpected changes', ({ mesh }, _engine) => {
    const before = healMetrics(analyzeMeshTopology(meshTopologyData(mesh)));
    return verifyHeal(before, { ...before, triangleCount: 1 }, 1, true).status === 'PARTIAL' &&
      verifyHeal(before, null, 1, true).status === 'PARTIAL' &&
      verifyHeal(before, null, 1, false).status === 'REGRESSION' &&
      verifyHeal(before, { ...before, triangleCount: 1, degenerateTriangles: 0 }, 1, false).status === 'REGRESSION';
  });
  fixtureTest('Tampered Apply is measured rather than trusted', ({ root, mesh }, engine) => {
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid);
    const setIndex = mesh.geometry.setIndex.bind(mesh.geometry);
    mesh.geometry.setIndex = () => setIndex([0, 1, 2, 3, 4, 5]);
    engine.applyPending(root);
    return engine.getLastOperation()?.status === 'REGRESSION' && engine.getLastOperation()?.after?.triangleCount === 2;
  });
  fixtureTest('Report storage roundtrip, corruption and denied storage', ({ root, mesh }, engine) => {
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid); engine.applyPending(root);
    let value = '';
    const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
    const saved = saveHealReport(engine.getLastOperation()!, storage);
    const read = readHealReport(storage);
    value = '{bad json';
    const corrupted = readHealReport(storage);
    const denied = { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('denied'); } };
    return saved && read?.status === 'PARTIAL' && read.meshUuid === mesh.uuid && corrupted === null &&
      readHealReport(denied) === null && !saveHealReport(engine.getLastOperation()!, denied);
  });
  fixtureTest('Asset switch clears Undo and rejects old verification completion', ({ root, mesh }, engine) => {
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid); engine.applyPending(root);
    const id = engine.getLastOperation()!.operationId;
    engine.clear(); engine.completeVerification(id, true);
    return engine.getLastOperation() === null && !engine.getUndoState().available;
  });
  fixtureTest('Report returned to UI is an independent snapshot', ({ root, mesh }, engine) => {
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid); engine.applyPending(root);
    const report = engine.getLastOperation()!;
    report.before.triangleCount = 999;
    return engine.getLastOperation()?.before.triangleCount === 2;
  });
  fixtureTest('Unavailable post-measurement retains Undo and cannot become VERIFIED', ({ root, mesh }, engine) => {
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid);
    const setIndex = mesh.geometry.setIndex.bind(mesh.geometry);
    const matrix = mesh.matrixWorld;
    mesh.geometry.setIndex = index => {
      const result = setIndex(index);
      Object.defineProperty(mesh, 'matrixWorld', { configurable: true, get() { throw Error('measurement unavailable'); } });
      return result;
    };
    const applied = engine.applyPending(root);
    engine.completeVerification(engine.getLastOperation()!.operationId, true);
    Object.defineProperty(mesh, 'matrixWorld', { configurable: true, value: matrix, writable: true });
    mesh.geometry.setIndex = setIndex;
    return applied.success && engine.getLastOperation()?.after === null &&
      engine.getLastOperation()?.status === 'PARTIAL' && engine.undoLast(root).success;
  });
  fixtureTest('Before measurement failure makes no changes', ({ root, mesh }, engine) => {
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid);
    Object.defineProperty(mesh, 'matrixWorld', { get() { throw Error('before unavailable'); } });
    return !engine.applyPending(root).success && mesh.geometry.index!.count === 6 && engine.getLastOperation() === null;
  });
  fixtureTest('Removing all triangles reports empty-mesh REGRESSION', ({ root, mesh }, engine) => {
    mesh.geometry.setIndex([3, 4, 5]);
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid); engine.applyPending(root);
    return engine.getLastOperation()?.status === 'REGRESSION' && engine.getLastOperation()?.reasons.includes('emptyMesh') === true;
  });
  fixtureTest('Repeated Apply cannot mutate twice', ({ root, mesh }, engine) => {
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid); engine.applyPending(root);
    return !engine.applyPending(root).success && mesh.geometry.index!.count === 3;
  });
  fixtureTest('Morph bounds do not change base-topology repair threshold', ({ root, mesh }, engine) => {
    const morph = mesh.geometry.attributes.position.clone();
    morph.setX(0, 1e12);
    mesh.geometry.morphAttributes.position = [morph];
    const preview = engine.previewRemoveDegenerateTriangles(root, mesh.uuid);
    engine.applyPending(root);
    return preview.affectedTriangles === 1 && engine.getLastOperation()?.targetStatus === 'VERIFIED' &&
      mesh.geometry.morphAttributes.position[0] === morph;
  });
  for (const [label, mutate] of [
    ['invalid index', (mesh: THREE.Mesh) => mesh.geometry.index!.setX(0, 999)],
    ['non-finite position', (mesh: THREE.Mesh) => mesh.geometry.attributes.position.setX(0, NaN)],
    ['incomplete triangle', (mesh: THREE.Mesh) => mesh.geometry.setIndex([0, 1, 2, 3])],
    ['non-indexed geometry', (mesh: THREE.Mesh) => mesh.geometry.setIndex(null)],
  ] as const) {
    fixtureTest(`Invalid input blocks ${label}`, ({ root, mesh }, engine) => {
      mutate(mesh);
      return engine.previewRemoveDegenerateTriangles(root, mesh.uuid).status === 'BLOCKED' && !engine.applyPending(root).success;
    });
  }
  fixtureTest('Verified live Heal state is exportable and later geometry edits are rejected', ({ root, mesh }, engine) => {
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid);
    engine.applyPending(root, 'ExportFixture.glb');
    const id = engine.getLastOperation()!.operationId;
    engine.completeVerification(id, true);
    const verified = engine.getLastOperation()!;
    const beforeEdit = engine.validateCurrentVerifiedState(root, verified).ok;
    mesh.geometry.index!.setX(0, mesh.geometry.index!.getX(0) === 0 ? 1 : 0);
    const afterEdit = engine.validateCurrentVerifiedState(root, verified);
    return beforeEdit && !afterEdit.ok && afterEdit.reasonKey === 'export.errors.geometryChanged';
  });

  fixtureTest('Historical or undone Heal report cannot authorize export', ({ root, mesh }, engine) => {
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid);
    engine.applyPending(root, 'ExportFixture.glb');
    const id = engine.getLastOperation()!.operationId;
    engine.completeVerification(id, true);
    const report = engine.getLastOperation()!;

    const historicalEngine = new SurgicalHealEngine();
    const historicalBlocked = historicalEngine.validateCurrentVerifiedState(root, report).reasonKey === 'export.errors.historicalReport';

    engine.undoLast(root);
    const undone = engine.getLastOperation()!;
    const undoneBlocked = engine.validateCurrentVerifiedState(root, undone).reasonKey === 'export.errors.healNotVerified';

    return historicalBlocked && undoneBlocked;
  });

  fixtureTest('Repair registry resolves and previews the current operation without UI issue hardcoding', ({ root, mesh }, engine) => {
    const issue = {
      id: 'topo-degenerate-triangles',
      category: 'Topology',
      severity: 'WARNING',
      title: 'Degenerate triangles',
      description: 'Synthetic repair registry fixture',
      meshUuid: mesh.uuid,
      meshName: mesh.name,
    } as HealthIssue;

    const operation = getRepairOperationForIssue(issue);
    const preview = previewRepairIssue(engine, root, issue);

    return operation?.kind === 'remove-degenerate-triangles' &&
      operation.capabilities.preview &&
      operation.capabilities.apply &&
      operation.capabilities.undo &&
      operation.capabilities.verify &&
      operation.capabilities.exportPatch === 'index-only' &&
      preview?.status === 'READY' &&
      preview.affectedTriangles === 1;
  });

  test('Safe Repair Queue is deterministic and excludes manual-only diagnostics', () => {
    const issue = (
      id: string,
      category: HealthIssue['category'],
      severity: HealthIssue['severity'],
      meshUuid: string
    ): HealthIssue => ({
      id,
      category,
      severity,
      title: id,
      description: id,
      meshUuid,
      meshName: meshUuid,
    });

    const queue = buildRepairQueueCandidates([
      issue('topo-duplicate-positions', 'Topology', 'INFO', 'mesh-e'),
      issue('skin-zero-weight', 'Skinning', 'ERROR', 'manual-only'),
      issue('skin-invalid-sum', 'Skinning', 'WARNING', 'mesh-d'),
      issue('topo-exact-duplicate-triangles', 'Topology', 'INFO', 'mesh-f'),
      issue('skin-redundant-influences', 'Skinning', 'INFO', 'mesh-g'),
      issue('normals-zero', 'Normals', 'WARNING', 'mesh-c'),
      issue('topo-isolated-vertices', 'Topology', 'WARNING', 'mesh-b'),
      issue('topo-degenerate-triangles', 'Topology', 'WARNING', 'mesh-a'),
      // Multiple locations on the same mesh must collapse into one operation.
      {
        ...issue('topo-degenerate-triangles', 'Topology', 'WARNING', 'mesh-a'),
        locations: [
          {
            meshUuid: 'mesh-a',
            meshName: 'mesh-a',
            affectedElement: 'triangle',
            affectedIndices: [1],
            focusPosition: [0, 0, 0],
          },
          {
            meshUuid: 'mesh-a',
            meshName: 'mesh-a',
            affectedElement: 'triangle',
            affectedIndices: [2],
            focusPosition: [1, 0, 0],
          },
        ],
      },
    ]);

    return queue.length === 7 &&
      queue.map((candidate) => candidate.operation).join('|') === [
        'remove-degenerate-triangles',
        'remove-unreferenced-vertices',
        'recalculate-normals',
        'normalize-skin-weights',
        'merge-exact-duplicate-vertices',
        'remove-exact-duplicate-triangles',
        'consolidate-duplicate-skin-influences',
      ].join('|') &&
      queue.every((candidate) => candidate.meshUuid !== 'manual-only');
  });

  test('Verified multi-repair session survives sequential repairs and last Undo', () => {
    const first = makeDegenerateFixture();
    const second = makeDegenerateFixture();
    const root = new THREE.Group();
    first.mesh.name = 'QueueMeshA';
    second.mesh.name = 'QueueMeshB';
    root.add(first.mesh);
    root.add(second.mesh);

    const engine = new SurgicalHealEngine();
    try {
      engine.previewRemoveDegenerateTriangles(root, first.mesh.uuid);
      const firstApply = engine.applyPending(root, 'QueueSession.glb');
      if (!firstApply.report) return false;
      engine.completeVerification(firstApply.report.operationId, true);

      engine.previewRemoveDegenerateTriangles(root, second.mesh.uuid);
      const secondApply = engine.applyPending(root, 'QueueSession.glb');
      if (!secondApply.report) return false;
      engine.completeVerification(secondApply.report.operationId, true);

      const two = engine.validateCurrentVerifiedSession(root);
      const undo = engine.undoLast(root);
      const one = engine.validateCurrentVerifiedSession(root);

      return two.ok &&
        two.reports.length === 2 &&
        engine.getActiveReports().length === 1 &&
        undo.success &&
        one.ok &&
        one.reports.length === 1 &&
        one.reports[0].meshUuid === first.mesh.uuid;
    } finally {
      first.mesh.geometry.dispose();
      second.mesh.geometry.dispose();
      (first.mesh.material as THREE.Material).dispose();
      (second.mesh.material as THREE.Material).dispose();
    }
  });

  test('Repair registry ignores diagnostics that have no registered Surgical Heal operation', () => {
    const issue = {
      id: 'topo-non-manifold-edges',
      category: 'Topology',
      severity: 'WARNING',
      title: 'Non-manifold edges',
      description: 'Synthetic unregistered repair fixture',
    } as HealthIssue;

    return getRepairOperationForIssue(issue) === null &&
      listRepairOperations().length === 7;
  });

  test('Remove Unreferenced Vertices compacts every supported vertex-domain attribute and Undo restores the original geometry', () => {
    const { root, mesh } = makeUnreferencedFixture();
    const engine = new SurgicalHealEngine();
    const originalGeometry = mesh.geometry;
    try {
      const preview = engine.previewRemoveUnreferencedVertices(root, mesh.uuid);
      const applied = engine.applyPending(root, 'UnreferencedFixture.glb');
      const pending = engine.getLastOperation()!;
      engine.completeVerification(pending.operationId, true);
      const report = engine.getLastOperation()!;

      const compacted = mesh.geometry;
      const compactedOk =
        preview.status === 'READY' &&
        preview.operation === 'remove-unreferenced-vertices' &&
        preview.metric === 'vertices' &&
        preview.metricBefore === 5 &&
        preview.metricAfter === 3 &&
        preview.affectedVertices === 2 &&
        applied.success &&
        compacted !== originalGeometry &&
        compacted.attributes.position.count === 3 &&
        compacted.attributes.normal.count === 3 &&
        compacted.attributes.uv.count === 3 &&
        compacted.attributes.color.count === 3 &&
        compacted.attributes.skinIndex.count === 3 &&
        compacted.attributes.skinWeight.count === 3 &&
        compacted.morphAttributes.position?.[0]?.count === 3 &&
        compacted.attributes.uv.getX(1) === 1 &&
        compacted.attributes.color.getZ(2) === 1 &&
        compacted.attributes.skinIndex.getY(0) === 1 &&
        Math.abs(compacted.morphAttributes.position![0].getX(1) - 0.1) < 1e-6 &&
        compacted.groups.length === 1 &&
        compacted.groups[0].start === 0 &&
        compacted.groups[0].count === 3 &&
        compacted.drawRange.start === 0 &&
        compacted.drawRange.count === 3 &&
        Array.from(compacted.index!.array).join(',') === '0,1,2' &&
        report.status === 'VERIFIED' &&
        report.after?.vertexCount === 3 &&
        report.after?.isolatedVertices === 0 &&
        report.after?.triangleCount === 1;

      const undone = engine.undoLast(root);
      const undoOk =
        undone.success &&
        mesh.geometry === originalGeometry &&
        mesh.geometry.attributes.position.count === 5 &&
        mesh.geometry.morphAttributes.position?.[0]?.count === 5 &&
        mesh.geometry.index?.count === 3;

      return compactedOk && undoOk;
    } finally {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });

  test('Remove Unreferenced Vertices registry entry is geometry-patch capable', () => {
    const { root, mesh } = makeUnreferencedFixture();
    const engine = new SurgicalHealEngine();
    try {
      const issue = {
        id: 'topo-isolated-vertices',
        category: 'Topology',
        severity: 'WARNING',
        title: 'Isolated vertices',
        description: 'Synthetic vertex cleanup fixture',
        meshUuid: mesh.uuid,
        meshName: mesh.name,
      } as HealthIssue;

      const operation = getRepairOperationForIssue(issue);
      const preview = previewRepairIssue(engine, root, issue);
      return operation?.kind === 'remove-unreferenced-vertices' &&
        operation.capabilities.exportPatch === 'geometry' &&
        preview?.status === 'READY' &&
        preview.affectedCount === 2;
    } finally {
      engine.cancelPreview();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });

  test('Remove Unreferenced Vertices blocks unsupported vertex metadata and mismatched attributes', () => {
    const first = makeUnreferencedFixture();
    const second = makeUnreferencedFixture();
    const engineA = new SurgicalHealEngine();
    const engineB = new SurgicalHealEngine();
    try {
      first.mesh.geometry.userData.vertexMap = [0, 1, 2];
      const metadataBlocked = engineA.previewRemoveUnreferencedVertices(first.root, first.mesh.uuid);

      second.mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute([
        1, 0, 0,
        0, 1, 0,
      ], 3));
      const layoutBlocked = engineB.previewRemoveUnreferencedVertices(second.root, second.mesh.uuid);

      return metadataBlocked.status === 'BLOCKED' &&
        metadataBlocked.reasonKey === 'heal.errors.vertexMetadataUnsupported' &&
        layoutBlocked.status === 'BLOCKED' &&
        layoutBlocked.reasonKey === 'heal.errors.vertexAttributeUnsupported';
    } finally {
      first.mesh.geometry.dispose();
      second.mesh.geometry.dispose();
      (first.mesh.material as THREE.Material).dispose();
      (second.mesh.material as THREE.Material).dispose();
    }
  });

  test('Unreferenced vertex Heal report survives storage roundtrip', () => {
    const { root, mesh } = makeUnreferencedFixture();
    const engine = new SurgicalHealEngine();
    try {
      engine.previewRemoveUnreferencedVertices(root, mesh.uuid);
      engine.applyPending(root, 'VertexCleanup.glb');
      const id = engine.getLastOperation()!.operationId;
      engine.completeVerification(id, true);
      const report = engine.getLastOperation()!;
      let value = '';
      const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
      return report.status === 'VERIFIED' &&
        saveHealReport(report, storage) &&
        readHealReport(storage)?.operation === 'remove-unreferenced-vertices';
    } finally {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });

  test('Recalculate Normals repairs zero normals, verifies topology preservation, and Undo restores the original stream', () => {
    const { root, mesh } = makeNormalsFixture(false);
    const engine = new SurgicalHealEngine();
    const originalGeometry = mesh.geometry;
    try {
      const preview = engine.previewRecalculateNormals(root, mesh.uuid, 'normals-zero');
      const applied = engine.applyPending(root, 'NormalsFixture.glb');
      const id = engine.getLastOperation()!.operationId;
      engine.completeVerification(id, true);
      const report = engine.getLastOperation()!;
      const repairedMeasurement = measureGeometryNormals(mesh.geometry);

      const repaired =
        preview.status === 'READY' &&
        preview.operation === 'recalculate-normals' &&
        preview.metric === 'normals' &&
        preview.metricBefore === 3 &&
        preview.metricAfter === 0 &&
        applied.success &&
        report.status === 'VERIFIED' &&
        report.before.invalidNormals === 3 &&
        report.after?.invalidNormals === 0 &&
        report.before.triangleCount === report.after?.triangleCount &&
        repairedMeasurement.invalidCount === 0;

      const undo = engine.undoLast(root);
      const restoredMeasurement = measureGeometryNormals(mesh.geometry);
      return repaired &&
        undo.success &&
        mesh.geometry === originalGeometry &&
        restoredMeasurement.invalidCount === 3;
    } finally {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });

  test('Recalculate Normals supports missing normals and blocks stale tangent or morph-normal bases', () => {
    const missing = makeNormalsFixture(true);
    const tangent = makeNormalsFixture(false);
    const morph = makeNormalsFixture(false);
    const a = new SurgicalHealEngine();
    const b = new SurgicalHealEngine();
    const d = new SurgicalHealEngine();

    try {
      const missingPreview = a.previewRecalculateNormals(missing.root, missing.mesh.uuid, 'normals-missing');

      tangent.mesh.geometry.setAttribute('tangent', new THREE.Float32BufferAttribute([
        1, 0, 0, 1,
        1, 0, 0, 1,
        1, 0, 0, 1,
      ], 4));
      const tangentPreview = b.previewRecalculateNormals(tangent.root, tangent.mesh.uuid, 'normals-zero');

      morph.mesh.geometry.morphAttributes.normal = [
        new THREE.Float32BufferAttribute([
          0, 0, 1,
          0, 0, 1,
          0, 0, 1,
        ], 3),
      ];
      const morphPreview = d.previewRecalculateNormals(morph.root, morph.mesh.uuid, 'normals-zero');

      return missingPreview.status === 'READY' &&
        missingPreview.affectedCount === 3 &&
        tangentPreview.status === 'BLOCKED' &&
        tangentPreview.reasonKey === 'heal.errors.normalsTangentsUnsupported' &&
        morphPreview.status === 'BLOCKED' &&
        morphPreview.reasonKey === 'heal.errors.morphNormalsUnsupported';
    } finally {
      a.cancelPreview();
      b.cancelPreview();
      d.cancelPreview();
      for (const fixture of [missing, tangent, morph]) {
        fixture.mesh.geometry.dispose();
        (fixture.mesh.material as THREE.Material).dispose();
      }
    }
  });

  test('Exact Duplicate Vertices welds only identical attribute tuples and verifies non-regression', () => {
    const { root, mesh } = makeExactDuplicateFixture();
    const engine = new SurgicalHealEngine();
    const originalGeometry = mesh.geometry;

    try {
      const before = analyzeMeshTopology(meshTopologyData(mesh));
      const preview = engine.previewMergeExactDuplicateVertices(root, mesh.uuid);
      const applied = engine.applyPending(root, 'DuplicateFixture.glb');
      const id = engine.getLastOperation()!.operationId;
      engine.completeVerification(id, true);
      const report = engine.getLastOperation()!;
      const after = analyzeMeshTopology(meshTopologyData(mesh));

      const welded =
        preview.status === 'READY' &&
        preview.operation === 'merge-exact-duplicate-vertices' &&
        preview.affectedCount === 2 &&
        preview.verticesBefore === 6 &&
        preview.verticesAfter === 4 &&
        applied.success &&
        report.status === 'VERIFIED' &&
        before.triangleCount === after.triangleCount &&
        after.vertexCount === 4 &&
        after.boundaryEdges < before.boundaryEdges &&
        after.componentsCount <= before.componentsCount &&
        after.nonManifoldEdges <= before.nonManifoldEdges;

      const undo = engine.undoLast(root);
      return welded &&
        undo.success &&
        mesh.geometry === originalGeometry &&
        mesh.geometry.getAttribute('position').count === 6;
    } finally {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });

  test('Exact Duplicate Vertices refuses attribute seams and unresolved unreferenced vertices', () => {
    const seam = makeExactDuplicateFixture();
    const loose = makeExactDuplicateFixture();
    const a = new SurgicalHealEngine();
    const b = new SurgicalHealEngine();

    try {
      // Break UV equality for one duplicate pair. One exact pair may remain, but
      // the resulting topology change must still satisfy all safety gates.
      seam.mesh.geometry.getAttribute('uv').setX(3, 0.55);
      seam.mesh.geometry.getAttribute('uv').setY(5, 0.95);
      seam.mesh.geometry.getAttribute('uv').needsUpdate = true;
      const seamPreview = a.previewMergeExactDuplicateVertices(seam.root, seam.mesh.uuid);

      // Add an unreferenced vertex so cleanup order is explicit.
      const oldPosition = loose.mesh.geometry.getAttribute('position');
      const expanded = new Float32Array((oldPosition.count + 1) * 3);
      expanded.set(oldPosition.array as ArrayLike<number>);
      expanded.set([9, 9, 9], oldPosition.count * 3);
      loose.mesh.geometry.setAttribute('position', new THREE.BufferAttribute(expanded, 3));
      // Other attributes now intentionally mismatch count; isolated cleanup should
      // be requested before duplicate merge can even consider attribute remap.
      const loosePreview = b.previewMergeExactDuplicateVertices(loose.root, loose.mesh.uuid);

      return seamPreview.status === 'BLOCKED' &&
        loosePreview.status === 'BLOCKED';
    } finally {
      a.cancelPreview();
      b.cancelPreview();
      for (const fixture of [seam, loose]) {
        fixture.mesh.geometry.dispose();
        (fixture.mesh.material as THREE.Material).dispose();
      }
    }
  });

  test('Normalize Skin Weights repairs non-zero sums, preserves indices/topology, and Undo restores original weights', () => {
    const { root, mesh } = makeSkinWeightFixture(false);
    const engine = new SurgicalHealEngine();
    const originalGeometry = mesh.geometry;
    try {
      const before = measureSkinWeights(mesh);
      const preview = engine.previewNormalizeSkinWeights(root, mesh.uuid);
      const applied = engine.applyPending(root, 'SkinWeightFixture.glb');
      const operationId = engine.getLastOperation()!.operationId;
      engine.completeVerification(operationId, true);
      const report = engine.getLastOperation()!;
      const after = measureSkinWeights(mesh);

      const normalized =
        before.supported &&
        before.invalidSumCount === 2 &&
        before.zeroWeightCount === 0 &&
        preview.status === 'READY' &&
        preview.operation === 'normalize-skin-weights' &&
        preview.metric === 'weights' &&
        preview.metricBefore === 2 &&
        preview.metricAfter === 0 &&
        applied.success &&
        report.status === 'VERIFIED' &&
        report.before.invalidSkinWeights === 2 &&
        report.after?.invalidSkinWeights === 0 &&
        report.after?.zeroWeightVertices === 0 &&
        after.supported &&
        after.invalidSumCount === 0 &&
        mesh.geometry.index?.count === 3 &&
        mesh.geometry.getAttribute('skinIndex').getX(0) === 0 &&
        mesh.geometry.getAttribute('skinIndex').getY(0) === 1;

      const undo = engine.undoLast(root);
      const restored = measureSkinWeights(mesh);
      return normalized &&
        undo.success &&
        mesh.geometry === originalGeometry &&
        restored.supported &&
        restored.invalidSumCount === 2;
    } finally {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });

  test('Normalize Skin Weights never guesses zero-weight influences', () => {
    const { root, mesh } = makeSkinWeightFixture(true);
    const engine = new SurgicalHealEngine();
    try {
      const before = measureSkinWeights(mesh);
      const preview = engine.previewNormalizeSkinWeights(root, mesh.uuid);
      engine.applyPending(root, 'SkinWeightZeroControl.glb');
      const operationId = engine.getLastOperation()!.operationId;
      engine.completeVerification(operationId, true);
      const report = engine.getLastOperation()!;
      const after = measureSkinWeights(mesh);

      return before.invalidSumCount === 2 &&
        before.zeroWeightCount === 1 &&
        preview.status === 'READY' &&
        report.status === 'VERIFIED' &&
        after.invalidSumCount === 0 &&
        after.zeroWeightCount === 1 &&
        mesh.geometry.getAttribute('skinWeight').getX(2) === 0 &&
        mesh.geometry.getAttribute('skinWeight').getY(2) === 0;
    } finally {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });

  test('Normalize Skin Weights is registered as a geometry repair', () => {
    const { root, mesh } = makeSkinWeightFixture(false);
    const engine = new SurgicalHealEngine();
    try {
      const issue = {
        id: 'skin-invalid-sum',
        category: 'Skinning',
        severity: 'WARNING',
        title: 'Unnormalized bone weights',
        description: 'Synthetic skin-weight fixture',
        meshUuid: mesh.uuid,
        meshName: mesh.name,
      } as HealthIssue;
      const operation = getRepairOperationForIssue(issue);
      const preview = previewRepairIssue(engine, root, issue);
      return operation?.kind === 'normalize-skin-weights' &&
        operation.capabilities.exportPatch === 'geometry' &&
        preview?.status === 'READY' &&
        preview.affectedCount === 2;
    } finally {
      engine.cancelPreview();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });

  test('Asset Doctor Test Patient exposes deterministic repairable and manual-review findings', () => {
    const sample = createAssetDoctorTestPatient();
    const meshes: THREE.Mesh[] = [];
    sample.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
    });

    try {
      const repairTarget = meshes.find((mesh) => mesh.name === 'Repair_Target_Degenerate_And_Loose_Vertices');
      const nonManifold = meshes.find((mesh) => mesh.name === 'Manual_Control_NonManifold_Edge');
      const zeroNormals = meshes.find((mesh) => mesh.name === 'Repair_Target_Zero_Normals');
      const missingNormals = meshes.find((mesh) => mesh.name === 'Repair_Target_Missing_Normals');
      const exactDuplicates = meshes.find((mesh) => mesh.name === 'Repair_Target_Exact_Duplicate_Vertices');
      const rig = meshes.find((mesh) => mesh.name === 'Rig_Control_SkinnedMesh') as THREE.SkinnedMesh | undefined;

      if (!repairTarget || !nonManifold || !zeroNormals || !missingNormals || !exactDuplicates || !rig) return false;

      const repairStats = analyzeMeshTopology(meshTopologyData(repairTarget));
      const nonManifoldStats = analyzeMeshTopology(meshTopologyData(nonManifold));
      const duplicateStats = analyzeMeshTopology(meshTopologyData(exactDuplicates));
      const rigWeights = measureSkinWeights(rig);
      const normals = zeroNormals.geometry.getAttribute('normal');
      let allNormalsZero = true;
      for (let i = 0; i < normals.count; i++) {
        if (normals.getX(i) !== 0 || normals.getY(i) !== 0 || normals.getZ(i) !== 0) {
          allNormalsZero = false;
          break;
        }
      }

      return sample.id === 'test-patient' &&
        meshes.length === 6 &&
        repairStats.degenerateTriangles === 1 &&
        repairStats.isolatedVertices === 2 &&
        repairStats.thinTriangles >= 1 &&
        nonManifoldStats.nonManifoldEdges === 1 &&
        allNormalsZero &&
        !missingNormals.geometry.getAttribute('normal') &&
        duplicateStats.potentialDuplicatePositions >= 2 &&
        rig.isSkinnedMesh === true &&
        rigWeights.supported &&
        rigWeights.invalidSumCount === 2 &&
        rigWeights.zeroWeightCount === 0 &&
        rig.skeleton.bones.some((bone) => bone.name === 'UnusedLocator') &&
        sample.animations.length === 1 &&
        sample.animations[0].name === 'Diagnostic_Bone_Sway';
    } finally {
      const materials = new Set<THREE.Material>();
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((material) => materials.add(material));
      }
      materials.forEach((material) => material.dispose());
    }
  });

  test('Remove Exact Duplicate Triangles removes only guarded same-winding duplicates and Undo restores them', () => {
    const { root, mesh } = makeDuplicateTriangleFixture();
    const engine = new SurgicalHealEngine();
    const before = analyzeMeshTopology(meshTopologyData(mesh));
    const preview = engine.previewRemoveExactDuplicateTriangles(root, mesh.uuid);
    const applied = engine.applyPending(root, 'DuplicateTriangleFixture.glb');
    const after = analyzeMeshTopology(meshTopologyData(mesh));
    const report = engine.getLastOperation();
    const undone = engine.undoLast(root);
    const restored = analyzeMeshTopology(meshTopologyData(mesh));

    return (
      before.duplicateTriangles === 1 &&
      preview.status === 'READY' &&
      preview.affectedTriangles === 1 &&
      preview.trianglesBefore === 5 &&
      preview.trianglesAfter === 4 &&
      applied.success &&
      after.duplicateTriangles === 0 &&
      after.triangleCount === 4 &&
      report?.targetStatus === 'VERIFIED' &&
      undone.success &&
      restored.duplicateTriangles === 1 &&
      restored.triangleCount === 5
    );
  });

  test('Duplicate triangle repair is registered as guarded index-only surgery', () => {
    const { root, mesh } = makeDuplicateTriangleFixture();
    const engine = new SurgicalHealEngine();
    const issue: HealthIssue = {
      id: 'topo-exact-duplicate-triangles',
      category: 'Topology',
      severity: 'INFO',
      title: 'Exact duplicate triangles',
      description: 'fixture',
      meshUuid: mesh.uuid,
      meshName: mesh.name,
    };
    const operation = getRepairOperationForIssue(issue);
    const preview = previewRepairIssue(engine, root, issue);
    return (
      operation?.kind === 'remove-exact-duplicate-triangles' &&
      operation.capabilities.exportPatch === 'index-only' &&
      preview?.status === 'READY'
    );
  });

  test('Consolidate Duplicate Skin Influences preserves total weighting and Undo restores slots', () => {
    const { root, mesh } = makeDuplicateSkinInfluenceFixture();
    const engine = new SurgicalHealEngine();
    const before = measureSkinWeights(mesh);
    const preview = engine.previewConsolidateDuplicateSkinInfluences(root, mesh.uuid);
    const applied = engine.applyPending(root, 'DuplicateSkinInfluenceFixture.glb');
    const after = measureSkinWeights(mesh);
    const report = engine.getLastOperation();
    const undone = engine.undoLast(root);
    const restored = measureSkinWeights(mesh);

    return (
      before.supported &&
      before.redundantInfluenceVertexCount === 2 &&
      before.invalidSumCount === 0 &&
      preview.status === 'READY' &&
      preview.affectedCount === 2 &&
      applied.success &&
      after.supported &&
      after.redundantInfluenceVertexCount === 0 &&
      after.invalidSumCount === 0 &&
      after.zeroWeightCount === before.zeroWeightCount &&
      report?.targetStatus === 'VERIFIED' &&
      undone.success &&
      restored.redundantInfluenceVertexCount === 2
    );
  });

  test('Duplicate skin influence repair is registered as geometry surgery', () => {
    const { root, mesh } = makeDuplicateSkinInfluenceFixture();
    const engine = new SurgicalHealEngine();
    const issue: HealthIssue = {
      id: 'skin-redundant-influences',
      category: 'Skinning',
      severity: 'INFO',
      title: 'Redundant skin influences',
      description: 'fixture',
      meshUuid: mesh.uuid,
      meshName: mesh.name,
    };
    const operation = getRepairOperationForIssue(issue);
    const preview = previewRepairIssue(engine, root, issue);
    return (
      operation?.kind === 'consolidate-duplicate-skin-influences' &&
      operation.capabilities.exportPatch === 'geometry' &&
      preview?.status === 'READY'
    );
  });

  test('E1 skin-weight normalization preserves bone indices exactly', () => {
    const { root, mesh } = makeSkinWeightFixture(false);
    const engine = new SurgicalHealEngine();
    try {
      const preview = engine.previewNormalizeSkinWeights(root, mesh.uuid);
      if (preview.status !== 'READY') return false;
      const applied = engine.applyPending(root, 'E1_SkinInvariant.glb');
      const report = engine.getLastOperation();
      return Boolean(
        applied.success &&
        report?.targetStatus === 'VERIFIED' &&
        report.before.skinIndexSignature &&
        report.before.skinIndexSignature === report.after?.skinIndexSignature
      );
    } finally {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });

  test('E2 several repairs on one mesh remain independently undoable', () => {
    const { root, mesh } = makeChainedRepairFixture();
    const engine = new SurgicalHealEngine();
    try {
      const firstPreview = engine.previewRemoveDegenerateTriangles(root, mesh.uuid);
      const first = firstPreview.status === 'READY'
        ? engine.applyPending(root, 'E2_Chained.glb')
        : { success: false };
      if (!first.success || !first.report) return false;
      engine.completeVerification(first.report.operationId, true);

      const secondPreview = engine.previewRemoveUnreferencedVertices(root, mesh.uuid);
      const second = secondPreview.status === 'READY'
        ? engine.applyPending(root, 'E2_Chained.glb')
        : { success: false };
      if (!second.success || !second.report) return false;
      engine.completeVerification(second.report.operationId, true);

      const thirdPreview = engine.previewRecalculateNormals(root, mesh.uuid, 'normals-zero');
      const third = thirdPreview.status === 'READY'
        ? engine.applyPending(root, 'E2_Chained.glb')
        : { success: false };
      if (!third.success || !third.report) return false;
      engine.completeVerification(third.report.operationId, true);

      const afterThree = engine.validateCurrentVerifiedSession(root);
      const normalsAfterThree = measureGeometryNormals(mesh.geometry);

      const undo = engine.undoLast(root);
      const afterUndo = engine.validateCurrentVerifiedSession(root);
      const normalsAfterUndo = measureGeometryNormals(mesh.geometry);
      const topologyAfterUndo = analyzeMeshTopology(meshTopologyData(mesh));

      return (
        afterThree.ok &&
        afterThree.reports.length === 3 &&
        normalsAfterThree.invalidCount === 0 &&
        undo.success &&
        afterUndo.ok &&
        afterUndo.reports.length === 2 &&
        topologyAfterUndo.degenerateTriangles === 0 &&
        topologyAfterUndo.isolatedVertices === 0 &&
        normalsAfterUndo.invalidCount === 3
      );
    } finally {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });

  fixtureTest('Topology extraction respects interleaved attributes and local scale', ({ root, mesh }, engine) => {
    const data = new THREE.InterleavedBuffer(new Float32Array([
      0,0,0,99, 1,0,0,99, 0,1,0,99, 2,0,0,99, 3,0,0,99, 4,0,0,99,
    ]), 4);
    mesh.geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(data, 3, 0));
    root.scale.setScalar(1e8);
    const before = analyzeMeshTopology(meshTopologyData(mesh));
    engine.previewRemoveDegenerateTriangles(root, mesh.uuid); engine.applyPending(root);
    return before.vertexCount === 6 && before.degenerateTriangles === 1 && engine.getLastOperation()?.after?.degenerateTriangles === 0;
  });
  return results;
}


function queueCandidate(key: string, meshName = key): RepairQueueCandidate {
  const [operation, meshUuid] = key.split(':') as [RepairQueueCandidate['operation'], string];
  return {
    key,
    operation,
    meshUuid,
    meshName,
    issue: {
      id: 'queue-test',
      category: 'Topology',
      severity: 'WARNING',
      title: key,
      description: key,
      meshUuid,
      meshName,
    },
  };
}

function queuePreview(candidate: RepairQueueCandidate, status: 'READY' | 'BLOCKED' = 'READY') {
  return {
    operationId: `preview_${candidate.key}`,
    operation: candidate.operation,
    issueId: candidate.issue.id,
    meshUuid: candidate.meshUuid,
    meshName: candidate.meshName,
    status,
    risk: 'CONDITIONAL' as const,
    trianglesBefore: 1,
    trianglesAfter: status === 'READY' ? 0 : 1,
    affectedTriangles: status === 'READY' ? 1 : 0,
    affectedCount: status === 'READY' ? 1 : 0,
    metric: 'triangles' as const,
    metricBefore: 1,
    metricAfter: status === 'READY' ? 0 : 1,
    boundaryEdgesBefore: 0,
    boundaryEdgesAfter: 0,
    nonManifoldEdgesBefore: 0,
    nonManifoldEdgesAfter: 0,
  };
}

function queueReport(candidate: RepairQueueCandidate, status: 'VERIFIED' | 'PARTIAL' | 'REGRESSION') {
  const metrics = {
    triangleCount: status === 'VERIFIED' ? 0 : 1,
    vertexCount: 3,
    degenerateTriangles: status === 'VERIFIED' ? 0 : 1,
    boundaryEdges: 0,
    nonManifoldEdges: 0,
    isolatedVertices: 0,
    componentsCount: 1,
    thinTriangles: 0,
    tinyComponentsCount: 0,
    potentialDuplicatePositions: 0,
    duplicateTriangles: 0,
  };
  return {
    version: 2 as const,
    operationId: `report_${candidate.key}`,
    operation: candidate.operation,
    assetName: 'Queue Test',
    meshUuid: candidate.meshUuid,
    meshName: candidate.meshName,
    appliedAt: new Date(0).toISOString(),
    status,
    targetStatus: status,
    pipeline: 'complete' as const,
    expectedRemoved: 1,
    before: { ...metrics, triangleCount: 1, degenerateTriangles: 1 },
    after: metrics,
    reasons: status === 'VERIFIED' ? [] : ['synthetic'],
  };
}

function installFileReaderPolyfillForTests(): () => void {
  if (typeof globalThis.FileReader !== 'undefined') return () => {};

  const globalWithFileReader = globalThis as any;
  const previous = globalWithFileReader.FileReader;

  class TestFileReader {
    result: string | ArrayBuffer | null = null;
    onloadend: ((event?: unknown) => void) | null = null;
    onerror: ((event?: unknown) => void) | null = null;

    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer()
        .then((buffer) => {
          this.result = buffer;
          queueMicrotask(() => this.onloadend?.());
        })
        .catch(() => this.onerror?.());
    }

    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer()
        .then((buffer) => {
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
          }
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
          queueMicrotask(() => this.onloadend?.());
        })
        .catch(() => this.onerror?.());
    }
  }

  globalWithFileReader.FileReader = TestFileReader;

  return () => {
    if (previous === undefined) {
      delete globalWithFileReader.FileReader;
    } else {
      globalWithFileReader.FileReader = previous;
    }
  };
}

export async function runSurgicalHealIntegrationTests(fidelityFixture: ArrayBuffer): Promise<SurgicalHealTestResult[]> {
  const results: SurgicalHealTestResult[] = [];

  const pushQueueCase = async (
    name: string,
    expected: string,
    makeAdapter: () => Parameters<typeof runSafeRepairQueue>[0],
    predicate: (outcome: Awaited<ReturnType<typeof runSafeRepairQueue>>) => boolean
  ) => {
    const outcome = await runSafeRepairQueue(makeAdapter());
    results.push({
      name,
      description: 'Safe Repair Queue v1 state-machine hardening.',
      expected,
      actual: `${outcome.status} / ${outcome.stopCode ?? 'none'} / done=${outcome.completed} / skipped=${outcome.skipped}`,
      passed: predicate(outcome),
    });
  };

  await pushQueueCase(
    'E3 queue handles a clean asset',
    'completed / complete',
    () => ({
      getCandidates: () => [],
      preview: () => null,
      apply: async () => null,
      shouldStop: () => false,
      assetStillCurrent: () => true,
    }),
    (outcome) => outcome.status === 'completed' && outcome.stopCode === 'complete'
  );

  await pushQueueCase(
    'E3 queue completes one safe candidate',
    'completed / complete / done=1',
    () => {
      const candidate = queueCandidate('remove-degenerate-triangles:one');
      let candidates = [candidate];
      return {
        getCandidates: () => candidates,
        preview: (value) => queuePreview(value),
        apply: async (value) => {
          candidates = [];
          return queueReport(value, 'VERIFIED');
        },
        shouldStop: () => false,
        assetStillCurrent: () => true,
      };
    },
    (outcome) =>
      outcome.status === 'completed' &&
      outcome.stopCode === 'complete' &&
      outcome.completed === 1
  );

  await pushQueueCase(
    'E3 queue resolves dependent candidates after each rescan',
    'completed / done=2',
    () => {
      const first = queueCandidate('remove-degenerate-triangles:first');
      const second = queueCandidate('remove-unreferenced-vertices:first');
      let candidates = [first];
      let applied = 0;
      return {
        getCandidates: () => candidates,
        preview: (value) => queuePreview(value),
        apply: async (value) => {
          applied++;
          candidates = applied === 1 ? [second] : [];
          return queueReport(value, 'VERIFIED');
        },
        shouldStop: () => false,
        assetStillCurrent: () => true,
      };
    },
    (outcome) => outcome.status === 'completed' && outcome.completed === 2
  );

  await pushQueueCase(
    'E3 queue skips blocked candidates without applying them',
    'completedWithSkipped / skipped=1',
    () => {
      const blocked = queueCandidate('remove-degenerate-triangles:blocked');
      return {
        getCandidates: () => [blocked],
        preview: (value) => queuePreview(value, 'BLOCKED'),
        apply: async () => null,
        shouldStop: () => false,
        assetStillCurrent: () => true,
      };
    },
    (outcome) =>
      outcome.status === 'completed' &&
      outcome.stopCode === 'completeWithSkipped' &&
      outcome.skipped === 1
  );

  await pushQueueCase(
    'E3 queue stops immediately on REGRESSION',
    'regression / regressionStop',
    () => {
      const candidate = queueCandidate('remove-degenerate-triangles:regression');
      return {
        getCandidates: () => [candidate],
        preview: (value) => queuePreview(value),
        apply: async (value) => queueReport(value, 'REGRESSION'),
        shouldStop: () => false,
        assetStillCurrent: () => true,
      };
    },
    (outcome) => outcome.status === 'regression' && outcome.stopCode === 'regressionStop'
  );

  await pushQueueCase(
    'E3 queue honors user Stop before another transaction',
    'stopped / stoppedByUser',
    () => ({
      getCandidates: () => [queueCandidate('remove-degenerate-triangles:stop')],
      preview: (value) => queuePreview(value),
      apply: async (value) => queueReport(value, 'VERIFIED'),
      shouldStop: () => true,
      assetStillCurrent: () => true,
    }),
    (outcome) => outcome.status === 'stopped' && outcome.stopCode === 'stoppedByUser'
  );

  await pushQueueCase(
    'E3 queue stops when the asset is replaced',
    'failed / assetChanged',
    () => ({
      getCandidates: () => [queueCandidate('remove-degenerate-triangles:asset')],
      preview: (value) => queuePreview(value),
      apply: async (value) => queueReport(value, 'VERIFIED'),
      shouldStop: () => false,
      assetStillCurrent: () => false,
    }),
    (outcome) => outcome.status === 'failed' && outcome.stopCode === 'assetChanged'
  );

  await pushQueueCase(
    'E3 queue refuses a VERIFIED candidate that returns after rescan',
    'partial / targetReturned',
    () => {
      const candidate = queueCandidate('remove-degenerate-triangles:repeat');
      return {
        getCandidates: () => [candidate],
        preview: (value) => queuePreview(value),
        apply: async (value) => queueReport(value, 'VERIFIED'),
        shouldStop: () => false,
        assetStillCurrent: () => true,
      };
    },
    (outcome) =>
      outcome.status === 'partial' &&
      outcome.stopCode === 'targetReturned' &&
      outcome.completed === 1
  );

  // F01: inject a serializer that loses a non-mesh node. Matching triangle and
  // material counts must not certify the incomplete scene hierarchy.
  {
    const rewriteJson = (buffer: ArrayBuffer, json: any): ArrayBuffer => {
      const original = new Uint8Array(buffer);
      const oldLength = new DataView(buffer).getUint32(12, true);
      const binaryChunk = original.subarray(20 + oldLength);
      const encoded = new TextEncoder().encode(JSON.stringify(json));
      const length = Math.ceil(encoded.length / 4) * 4;
      const result = new ArrayBuffer(20 + length + binaryChunk.length);
      const bytes = new Uint8Array(result);
      bytes.set(original.subarray(0, 12));
      const view = new DataView(result);
      view.setUint32(8, result.byteLength, true);
      view.setUint32(12, length, true);
      view.setUint32(16, 0x4e4f534a, true);
      bytes.fill(32, 20, 20 + length);
      bytes.set(encoded, 20);
      bytes.set(binaryChunk, 20 + length);
      return result;
    };
    const readJson = (buffer: ArrayBuffer) => JSON.parse(new TextDecoder().decode(
      new Uint8Array(buffer, 20, new DataView(buffer).getUint32(12, true))
    ).trim());
    const restoreFileReader = installFileReaderPolyfillForTests();
    const loader = new GLBLoaderService();
    const engine = new SurgicalHealEngine();
    const originalParse = GLTFExporter.prototype.parseAsync;
    let root: THREE.Group | null = null;
    try {
      const json = readJson(fidelityFixture);
      json.scenes = [{ nodes: [0, 1] }];
      json.nodes = [json.nodes[0], { name: 'CriticalAnchor' }];
      json.meshes = [json.meshes[0]];
      const source = rewriteJson(fidelityFixture, json);
      const loaded = await loader.loadFromArrayBuffer(source, 'single-scene.glb');
      root = loaded.root;
      const mesh = root.children.find((node) => (node as THREE.Mesh).isMesh)!;
      const preview = engine.previewRemoveDegenerateTriangles(root, mesh.uuid);
      if (preview.status !== 'READY') throw new Error('F01 fixture preview not READY');
      const applied = engine.applyPending(root, 'single-scene.glb');
      if (!applied.success || !applied.report) throw new Error('F01 fixture apply failed');
      engine.completeVerification(applied.report.operationId, true);
      GLTFExporter.prototype.parseAsync = async function (...args) {
        const output = await originalParse.apply(this, args) as ArrayBuffer;
        const document = readJson(output);
        const removed = document.nodes.findIndex((node: any) => node.name === 'CriticalAnchor');
        if (removed < 0) throw new Error('F01 serializer injection target missing');
        document.nodes.splice(removed, 1);
        const remap = (ids: number[]) => ids.filter(index => index !== removed)
          .map(index => index > removed ? index - 1 : index);
        for (const node of document.nodes) if (node.children) node.children = remap(node.children);
        for (const scene of document.scenes) scene.nodes = remap(scene.nodes);
        return rewriteJson(output, document);
      };
      const exported = await new RepairedExportService().exportAndVerify({
        source: { kind: 'buffer', fileName: 'single-scene.glb', buffer: source },
        currentRoot: root, assetName: 'single-scene.glb', healReports: engine.getActiveReports(),
      });
      results.push({
        name: 'F01 lost non-mesh node prevents VERIFIED despite unchanged mesh counts',
        description: 'A fresh reopen must verify the complete node hierarchy.',
        expected: 'REGRESSION with nodeStructure and unchanged mesh counts',
        actual: `${exported.report.status}; ${exported.report.reasons.join(',')}`,
        passed: exported.report.status === 'REGRESSION' && exported.report.reasons.includes('nodeStructure') &&
          exported.report.meshCountExpected === exported.report.meshCountActual,
      });
    } catch (error) {
      results.push({ name: 'F01 lost non-mesh node prevents VERIFIED despite unchanged mesh counts',
        description: 'Serialization-loss regression', expected: 'REGRESSION with nodeStructure',
        actual: String(error), passed: false });
    } finally {
      GLTFExporter.prototype.parseAsync = originalParse;
      engine.clear();
      if (root) disposeObjectForTest(root);
      loader.dispose();
      restoreFileReader();
    }
  }

  // E2 export/reopen integration: repair multiple meshes plus two dependent
  // operations on the same mesh, export from a pristine source, reopen it, and
  // perform fresh measurements on the serialized result.
  {
    const restoreFileReader = installFileReaderPolyfillForTests();
    const sample = createAssetDoctorTestPatient();
    const engine = new SurgicalHealEngine();
    const service = new RepairedExportService();
    let reopenedRoot: THREE.Group | null = null;
    const loader = new GLBLoaderService();

    try {
      const meshes: THREE.Mesh[] = [];
      sample.root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
      });

      const topologyMesh = meshes.find(
        (mesh) => mesh.name === 'Repair_Target_Degenerate_And_Loose_Vertices'
      );
      const normalsMesh = meshes.find((mesh) => mesh.name === 'Repair_Target_Zero_Normals');
      const rigMesh = meshes.find((mesh) => mesh.name === 'Rig_Control_SkinnedMesh') as
        | THREE.SkinnedMesh
        | undefined;

      if (!topologyMesh || !normalsMesh || !rigMesh) {
        throw new Error('integration fixture meshes missing');
      }

      const applyVerified = (preview: HealPreview) => {
        if (preview.status !== 'READY') throw new Error('preview not READY');
        const applied = engine.applyPending(sample.root, sample.name);
        if (!applied.success || !applied.report) throw new Error('apply failed');
        engine.completeVerification(applied.report.operationId, true);
      };

      applyVerified(engine.previewRemoveDegenerateTriangles(sample.root, topologyMesh.uuid));
      applyVerified(engine.previewRemoveUnreferencedVertices(sample.root, topologyMesh.uuid));
      applyVerified(engine.previewRecalculateNormals(sample.root, normalsMesh.uuid, 'normals-zero'));
      applyVerified(engine.previewNormalizeSkinWeights(sample.root, rigMesh.uuid));

      const preflight = engine.validateCurrentVerifiedSession(sample.root);
      if (!preflight.ok) throw new Error(preflight.reasonKey ?? 'preflight failed');

      const exported = await service.exportAndVerify({
        source: { kind: 'sample', sampleId: 'test-patient' },
        currentRoot: sample.root,
        assetName: sample.name,
        healReports: preflight.reports,
      });

      const reopened = await loader.loadFromArrayBuffer(
        exported.buffer.slice(0),
        exported.fileName,
        exported.buffer.byteLength
      );
      reopenedRoot = reopened.root;

      const reopenedMeshes: THREE.Mesh[] = [];
      reopened.root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) reopenedMeshes.push(obj as THREE.Mesh);
      });

      const reopenedTopology = reopenedMeshes.find(
        (mesh) => mesh.name === 'Repair_Target_Degenerate_And_Loose_Vertices'
      );
      const reopenedNormals = reopenedMeshes.find(
        (mesh) => mesh.name === 'Repair_Target_Zero_Normals'
      );
      const reopenedRig = reopenedMeshes.find(
        (mesh) => mesh.name === 'Rig_Control_SkinnedMesh'
      ) as THREE.SkinnedMesh | undefined;

      const topologyStats = reopenedTopology
        ? analyzeMeshTopology(meshTopologyData(reopenedTopology))
        : null;
      const normalStats = reopenedNormals
        ? measureGeometryNormals(reopenedNormals.geometry)
        : null;
      const skinStats = reopenedRig ? measureSkinWeights(reopenedRig) : null;

      results.push({
        name: 'E2 multi-repair export, reopen, and fresh rescan verification',
        description: 'Several repairs on one/multiple meshes must survive verified GLB serialization and fresh post-import measurements.',
        expected: 'VERIFIED; 4 repairs on 3 meshes; reopened targets remain repaired',
        actual:
          `${exported.report.status}; reasons=${exported.report.reasons.join(',') || 'none'}; repairs=${exported.report.repairCount}; meshes=${exported.report.repairedMeshCount}; ` +
          `deg=${topologyStats?.degenerateTriangles ?? -1}; loose=${topologyStats?.isolatedVertices ?? -1}; ` +
          `normals=${normalStats?.invalidCount ?? -1}; weights=${skinStats?.invalidSumCount ?? -1}`,
        passed:
          exported.report.status === 'VERIFIED' &&
          exported.report.repairCount === 4 &&
          exported.report.repairedMeshCount === 3 &&
          topologyStats?.degenerateTriangles === 0 &&
          topologyStats.isolatedVertices === 0 &&
          normalStats?.invalidCount === 0 &&
          skinStats?.supported === true &&
          skinStats.invalidSumCount === 0,
      });
    } catch (error) {
      results.push({
        name: 'E2 multi-repair export, reopen, and fresh rescan verification',
        description: 'Several repairs on one/multiple meshes must survive verified GLB serialization and fresh post-import measurements.',
        expected: 'VERIFIED; 4 repairs on 3 meshes; reopened targets remain repaired',
        actual: error instanceof Error ? error.message : String(error),
        passed: false,
      });
    } finally {
      loader.dispose();
      if (reopenedRoot) disposeObjectForTest(reopenedRoot);
      disposeObjectForTest(sample.root);
      restoreFileReader();
    }
  }

  return results;
}
