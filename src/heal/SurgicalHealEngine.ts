import * as THREE from 'three';
import {noMetrics,type MetricsSink} from '../performance/MetricsSink';
import {nowMs} from '../performance/PerformanceProfiler';
import {binaryBytes,geometryArrays,memoryLimits} from '../performance/MemoryBudget';
import {disposeUnownedGeometry} from '../loaders/ModelResources';
import { documentMatrix } from '../viewer/AssetPresentation';
import type { HealApplyResult, HealMetrics, HealOperationKind, HealOperationReport, HealPreview, HealUndoState } from '../types';
import { ComputeWorkerClient } from '../workers/ComputeWorkerClient';
import { packRoot, unpackGeometry, type GeometryPacket } from '../workers/GeometryPacket';
import { analyzeMeshTopology } from '../analysis/TopologyAnalyzer';
import { meshTopologyData } from '../analysis/MeshTopologyData';
import { captureAttribute, captureGeometry, geometryMatches, type GeometrySnapshot } from './GeometrySnapshot';
import { healMetrics, verifyHealOperation } from './HealVerification';
import {
  geometryDataEquivalent,
  planMergeExactDuplicateVertices,
  planRemoveUnreferencedVertices,
} from './GeometryRemap';
import { planRecalculateNormals } from './NormalsRepair';
import {
  planNormalizeSkinWeights,
  planConsolidateDuplicateSkinInfluences,
} from './SkinWeightRepair';
import { planRemoveExactDuplicateTriangles } from './DuplicateTriangleRepair';

type SupportedIndexArray = Uint8Array | Uint16Array | Uint32Array;

export type PendingHeal =
  | {
      mutation: 'index-only';
      preview: HealPreview;
      geometryUuid: string;
      replacementIndex: THREE.BufferAttribute;
      snapshot: GeometrySnapshot;
    }
  | {
      mutation: 'geometry';
      preview: HealPreview;
      geometryUuid: string;
      replacementGeometry: THREE.BufferGeometry;
      snapshot: GeometrySnapshot;
    };

type UndoRestore =
  | { mutation: 'index-only'; previousIndex: THREE.BufferAttribute }
  | { mutation: 'geometry'; previousGeometry: THREE.BufferGeometry };

interface UndoHeal {
  operation: HealPreview['operation'];
  meshUuid: string;
  meshName: string;
  geometryUuid: string;
  restore: UndoRestore;
  affectedTriangles: number;
  affectedVertices: number;
  affectedCount: number;
  appliedSnapshot: GeometrySnapshot;
  report: HealOperationReport;
}

/**
 * Surgical Heal v0.2: independently measured postconditions and guarded Undo.
 *
 * Intentionally narrow:
 * - in-memory only
 * - indexed geometry only
 * - no geometry groups
 * - no shared geometry
 * - no custom draw ranges
 *
 * The first operation removes deterministically degenerate triangles by rewriting
 * only the geometry index buffer. Vertex attributes, skinning, UVs and materials
 * are left untouched.
 */
export class SurgicalHealEngine {
  constructor(private readonly historyLimitBytes:number=memoryLimits.history,private readonly metrics:MetricsSink=noMetrics){}
  private verificationStart:{operationId:string;startedAt:number}|null=null;
  private pending: PendingHeal | null = null;
  private undoStack: UndoHeal[] = [];
  private lastOperation: HealOperationReport | null = null;
  private generation = 0;
  private readonly compute = new ComputeWorkerClient(() => new Worker(new URL('../workers/heal-compute.worker.ts',import.meta.url),{type:'module'}));

  /** Only the compute worker reads this plan; the UI never receives mutable plan resources. */
  public getComputedPlan() { return this.pending; }

  /** Immutable accounting, with no observer access to private runtime storage. */
  public getMemoryUsage(){
    const retained=(entry:UndoHeal)=>[entry.appliedSnapshot,entry.restore.mutation==='index-only'?entry.restore.previousIndex.array:geometryArrays(entry.restore.previousGeometry)];
    return {
      repairPreviewBytes:this.pending?binaryBytes([this.pending.snapshot,this.pending.mutation==='index-only'?this.pending.replacementIndex.array:geometryArrays(this.pending.replacementGeometry)]):0,
      undoSnapshotsBytes:binaryBytes(this.undoStack.map(retained)),
    };
  }
  private publishMemory(){this.metrics.setMemory(this.getMemoryUsage());}
  public recordPreview(durationMs:number){this.metrics.record('repairPreview',durationMs);this.publishMemory();}
  private observeApply(result:HealApplyResult,startedAt:number){
    if(result.success&&result.report)this.verificationStart={operationId:result.report.operationId,startedAt};
    this.publishMemory();return result;
  }

  public async previewInWorker(root:THREE.Object3D,meshUuid:string,operation:HealOperationKind,issueId:string):Promise<HealPreview> {
    this.cancelPreview();
    const generation=this.generation;
    const result=await this.compute.request<{preview:HealPreview;plan:null|{mutation:PendingHeal['mutation'];geometryUuid:string;snapshot:GeometrySnapshot;replacement:GeometryPacket}}>({kind:'preview',root:packRoot(root),meshUuid,operation,issueId});
    if(generation!==this.generation) throw new Error('Stale repair preview');
    if(result.plan) {
      const mesh=root.getObjectByProperty('uuid',meshUuid) as THREE.Mesh|undefined;
      if(!mesh?.isMesh || !geometryMatches(mesh.geometry,result.plan.snapshot)) throw new Error('Geometry changed during preview');
      const replacement=unpackGeometry(result.plan.replacement);
      const base={preview:result.preview,geometryUuid:result.plan.geometryUuid,snapshot:result.plan.snapshot};
      this.pending=result.plan.mutation==='index-only'
        ? {mutation:'index-only',...base,replacementIndex:replacement.index!}
        : {mutation:'geometry',...base,replacementGeometry:replacement};
    }
    return result.preview;
  }

  public getLastOperation(): HealOperationReport | null {
    return this.lastOperation ? structuredClone(this.lastOperation) : null;
  }

  public getActiveReports(): HealOperationReport[] {
    return this.undoStack
      .filter((entry) => !entry.report.undoneAt)
      .map((entry) => structuredClone(entry.report));
  }

  public getActiveVerifiedReports(): HealOperationReport[] {
    return this.getActiveReports().filter(
      (report) => report.status === 'VERIFIED' && report.pipeline === 'complete'
    );
  }

  public validateCurrentVerifiedSession(
    root: THREE.Object3D
  ): { ok: boolean; reasonKey?: string; reports: HealOperationReport[] } {
    const reports = this.getActiveReports();
    if (reports.length === 0) {
      return { ok: false, reasonKey: 'export.errors.healNotVerified', reports: [] };
    }

    if (reports.some(
      (report) => report.status !== 'VERIFIED' || report.pipeline !== 'complete' || report.undoneAt
    )) {
      return { ok: false, reasonKey: 'export.errors.healNotVerified', reports };
    }

    // Only the latest transaction for a mesh can match the current final
    // geometry. Earlier reports on the same mesh remain audit evidence.
    const latestByMesh = new Map<string, UndoHeal>();
    for (const entry of this.undoStack) {
      if (!entry.report.undoneAt) latestByMesh.set(entry.meshUuid, entry);
    }

    for (const entry of latestByMesh.values()) {
      const obj = root.getObjectByProperty('uuid', entry.meshUuid);
      if (!obj || !(obj as THREE.Mesh).isMesh) {
        return { ok: false, reasonKey: 'export.errors.targetMissing', reports };
      }

      const mesh = obj as THREE.Mesh;
      if (
        mesh.geometry.uuid !== entry.geometryUuid ||
        !geometryMatches(mesh.geometry, entry.appliedSnapshot)
      ) {
        return { ok: false, reasonKey: 'export.errors.geometryChanged', reports };
      }
    }

    return { ok: true, reports };
  }

  public completeVerification(operationId: string, pipelineComplete: boolean) {
    const report = this.lastOperation;
    if (!report || report.operationId !== operationId || report.undoneAt) return;
    report.pipeline = pipelineComplete ? 'complete' : 'failed';
    report.status = report.targetStatus === 'REGRESSION' ? 'REGRESSION'
      : pipelineComplete ? report.targetStatus : 'PARTIAL';
    if(this.verificationStart?.operationId===operationId){this.metrics.record('applyVerification',nowMs()-this.verificationStart.startedAt);this.verificationStart=null;}
    this.publishMemory();
  }

  public validateCurrentVerifiedState(
    root: THREE.Object3D,
    report: HealOperationReport | null
  ): { ok: boolean; reasonKey?: string } {
    if (!report || report.undoneAt || report.status !== 'VERIFIED' || report.pipeline !== 'complete') {
      return { ok: false, reasonKey: 'export.errors.healNotVerified' };
    }

    if (!this.lastOperation || this.lastOperation.operationId !== report.operationId) {
      return { ok: false, reasonKey: 'export.errors.historicalReport' };
    }

    const undo = [...this.undoStack].reverse().find((entry) => entry.report.operationId === report.operationId);
    if (!undo) {
      return { ok: false, reasonKey: 'export.errors.historicalReport' };
    }

    const obj = root.getObjectByProperty('uuid', report.meshUuid);
    if (!obj || !(obj as THREE.Mesh).isMesh) {
      return { ok: false, reasonKey: 'export.errors.targetMissing' };
    }

    const mesh = obj as THREE.Mesh;
    if (mesh.geometry.uuid !== undo.geometryUuid || !geometryMatches(mesh.geometry, undo.appliedSnapshot)) {
      return { ok: false, reasonKey: 'export.errors.geometryChanged' };
    }

    return { ok: true };
  }

  public clear() {
    this.generation++;
    this.compute.dispose();
    this.disposePending();
    for (const entry of this.undoStack) {
      if (entry.restore.mutation === 'geometry') {
        disposeUnownedGeometry(entry.restore.previousGeometry);
      }
    }
    this.undoStack = [];
    this.lastOperation = null;
    this.verificationStart=null;
    this.publishMemory();
  }

  public cancelPreview() {
    this.generation++;
    this.compute.dispose();
    this.disposePending();
    this.publishMemory();
  }

  private disposePending() {
    if (this.pending?.mutation === 'geometry') {
      this.pending.replacementGeometry.dispose();
    }
    this.pending = null;
  }

  public getUndoState(): HealUndoState {
    const last = this.undoStack[this.undoStack.length - 1];
    if (!last) return { available: false };

    return {
      available: true,
      operation: last.operation,
      meshName: last.meshName,
      affectedTriangles: last.affectedTriangles,
      affectedVertices: last.affectedVertices,
      affectedCount: last.affectedCount,
    };
  }

  public previewRemoveDegenerateTriangles(root: THREE.Object3D, meshUuid: string): HealPreview {
    this.disposePending();

    const obj = root.getObjectByProperty('uuid', meshUuid);
    if (!obj || !(obj as THREE.Mesh).isMesh) {
      return this.blocked(meshUuid, 'Unknown mesh', 'Target mesh is no longer available.');
    }

    const mesh = obj as THREE.Mesh;
    const geometry = mesh.geometry;
    const index = geometry?.index;
    const position = geometry?.attributes?.position;

    if (!geometry || !position) {
      return this.blocked(mesh.uuid, mesh.name || `Mesh_${mesh.id}`, 'Mesh has no position geometry.');
    }

    if (!index) {
      return this.blocked(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        'Surgical Heal v0.1 only repairs indexed geometry. Non-indexed geometry remains diagnostic-only.'
      );
    }

    if (geometry.groups.length > 0) {
      return this.blocked(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        'Geometry uses material groups. Automatic index rewriting is blocked until group-preserving repair is implemented.'
      );
    }

    if (geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) {
      return this.blocked(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        'Geometry uses a custom draw range. Automatic repair is blocked to avoid changing rendered semantics.'
      );
    }

    let sharedUsers = 0;
    root.traverse((candidate) => {
      if ((candidate as THREE.Mesh).isMesh && (candidate as THREE.Mesh).geometry === geometry) {
        sharedUsers++;
      }
    });
    if (sharedUsers > 1) {
      return this.blocked(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        `Geometry is shared by ${sharedUsers} meshes. Repair is blocked to avoid modifying multiple objects at once.`
      );
    }

    const sourceArray = index.array;
    if (
      !(sourceArray instanceof Uint8Array) &&
      !(sourceArray instanceof Uint16Array) &&
      !(sourceArray instanceof Uint32Array)
    ) {
      return this.blocked(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        'Unsupported index buffer type.'
      );
    }

    if (index.itemSize !== 1 || index.normalized || index.count % 3 !== 0 || position.itemSize !== 3 ||
        Array.from(index.array).some(value => value >= position.count) ||
        Array.from({ length: position.count }, (_, i) => [position.getX(i), position.getY(i), position.getZ(i)])
          .some(point => point.some(value => !Number.isFinite(value)))) {
      return { ...this.blocked(mesh.uuid, mesh.name, ''), reasonKey: 'heal.errors.invalidGeometry' };
    }

    // Match the analyzer's base-position domain, including when morph targets extend bounds.
    const localBox = new THREE.Box3();
    const point = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) localBox.expandByPoint(point.fromBufferAttribute(position, i));
    const localDiagonal = localBox.getSize(point).length();
    const areaEpsilon = Math.max(1e-9, Math.pow(Math.max(localDiagonal, 1e-9) * 1e-6, 2));

    const triangleCount = Math.floor(index.count / 3);
    const degenerate = new Set<number>();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const cross = new THREE.Vector3();

    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const base = triangle * 3;
      const ia = index.getX(base);
      const ib = index.getX(base + 1);
      const ic = index.getX(base + 2);

      a.fromBufferAttribute(position as THREE.BufferAttribute, ia);
      b.fromBufferAttribute(position as THREE.BufferAttribute, ib);
      c.fromBufferAttribute(position as THREE.BufferAttribute, ic);

      ab.subVectors(b, a);
      ac.subVectors(c, a);
      cross.crossVectors(ab, ac);
      const area = 0.5 * cross.length();

      if (area <= areaEpsilon) {
        degenerate.add(triangle);
      }
    }

    const keptIndices: number[] = [];
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      if (degenerate.has(triangle)) continue;
      const base = triangle * 3;
      keptIndices.push(index.getX(base), index.getX(base + 1), index.getX(base + 2));
    }

    const beforeEdges = this.countEdgeState(index);
    const replacementArray = this.makeIndexArray(sourceArray, keptIndices);
    const replacement = new THREE.BufferAttribute(replacementArray, 1, index.normalized);
    const afterEdges = this.countEdgeState(replacement);

    const preview: HealPreview = {
      operationId: THREE.MathUtils.generateUUID(),
      operation: 'remove-degenerate-triangles',
      issueId: 'topo-degenerate-triangles',
      meshUuid: mesh.uuid,
      meshName: mesh.name || `Mesh_${mesh.id}`,
      status: degenerate.size > 0 ? 'READY' : 'BLOCKED',
      risk: 'CONDITIONAL',
      reason: degenerate.size > 0 ? undefined : 'No degenerate triangles were found during repair-time validation.',
      trianglesBefore: triangleCount,
      trianglesAfter: triangleCount - degenerate.size,
      affectedTriangles: degenerate.size,
      affectedCount: degenerate.size,
      metric: 'triangles',
      metricBefore: triangleCount,
      metricAfter: triangleCount - degenerate.size,
      verticesBefore: position.count,
      verticesAfter: position.count,
      affectedVertices: 0,
      boundaryEdgesBefore: beforeEdges.boundary,
      boundaryEdgesAfter: afterEdges.boundary,
      nonManifoldEdgesBefore: beforeEdges.nonManifold,
      nonManifoldEdgesAfter: afterEdges.nonManifold,
    };

    if (preview.status === 'READY') {
      this.disposePending();
      this.pending = {
        mutation: 'index-only',
        preview,
        geometryUuid: geometry.uuid,
        replacementIndex: replacement,
        snapshot: captureGeometry(geometry),
      };
    }

    return preview;
  }

  public previewRemoveUnreferencedVertices(root: THREE.Object3D, meshUuid: string): HealPreview {
    this.disposePending();

    const obj = root.getObjectByProperty('uuid', meshUuid);
    if (!obj || !(obj as THREE.Mesh).isMesh || (obj as THREE.InstancedMesh).isInstancedMesh) {
      return this.blockedUnreferenced(meshUuid, 'Unknown mesh', 'Unknown or unsupported mesh');
    }

    const mesh = obj as THREE.Mesh;
    const geometry = mesh.geometry;

    let sharedUsers = 0;
    root.traverse((candidate) => {
      if ((candidate as THREE.Mesh).isMesh && (candidate as THREE.Mesh).geometry === geometry) {
        sharedUsers++;
      }
    });
    if (sharedUsers !== 1) {
      return this.blockedUnreferenced(mesh.uuid, mesh.name || `Mesh_${mesh.id}`, 'heal.errors.sharedGeometry');
    }

    const planned = planRemoveUnreferencedVertices(geometry);
    if ('reasonKey' in planned) {
      return this.blockedUnreferenced(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        planned.reasonKey
      );
    }

    let before;
    try {
      before = analyzeMeshTopology(meshTopologyData(mesh));
    } catch {
      planned.replacement.dispose();
      return this.blockedUnreferenced(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        'heal.errors.beforeUnavailable'
      );
    }

    const preview: HealPreview = {
      operationId: THREE.MathUtils.generateUUID(),
      operation: 'remove-unreferenced-vertices',
      issueId: 'topo-isolated-vertices',
      meshUuid: mesh.uuid,
      meshName: mesh.name || `Mesh_${mesh.id}`,
      status: 'READY',
      risk: 'CONDITIONAL',
      trianglesBefore: before.triangleCount,
      trianglesAfter: before.triangleCount,
      affectedTriangles: 0,
      affectedCount: planned.removedVertices,
      metric: 'vertices',
      metricBefore: planned.verticesBefore,
      metricAfter: planned.verticesAfter,
      verticesBefore: planned.verticesBefore,
      verticesAfter: planned.verticesAfter,
      affectedVertices: planned.removedVertices,
      boundaryEdgesBefore: before.boundaryEdges,
      boundaryEdgesAfter: before.boundaryEdges,
      nonManifoldEdgesBefore: before.nonManifoldEdges,
      nonManifoldEdgesAfter: before.nonManifoldEdges,
    };

    this.pending = {
      mutation: 'geometry',
      preview,
      geometryUuid: geometry.uuid,
      replacementGeometry: planned.replacement,
      snapshot: captureGeometry(geometry),
    };

    return preview;
  }

  public previewRecalculateNormals(
    root: THREE.Object3D,
    meshUuid: string,
    issueId: 'normals-missing' | 'normals-zero'
  ): HealPreview {
    this.disposePending();

    const obj = root.getObjectByProperty('uuid', meshUuid);
    if (!obj || !(obj as THREE.Mesh).isMesh || (obj as THREE.InstancedMesh).isInstancedMesh) {
      return this.blockedNormals(meshUuid, 'Unknown mesh', issueId, 'heal.errors.targetMissing');
    }

    const mesh = obj as THREE.Mesh;
    const geometry = mesh.geometry;

    let sharedUsers = 0;
    root.traverse((candidate) => {
      if ((candidate as THREE.Mesh).isMesh && (candidate as THREE.Mesh).geometry === geometry) {
        sharedUsers++;
      }
    });
    if (sharedUsers !== 1) {
      return this.blockedNormals(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        issueId,
        'heal.errors.sharedGeometry'
      );
    }

    const planned = planRecalculateNormals(geometry);
    if ('reasonKey' in planned) {
      return this.blockedNormals(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        issueId,
        planned.reasonKey
      );
    }

    let before;
    try {
      before = analyzeMeshTopology(meshTopologyData(mesh));
    } catch {
      planned.replacement.dispose();
      return this.blockedNormals(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        issueId,
        'heal.errors.beforeUnavailable'
      );
    }

    const preview: HealPreview = {
      operationId: THREE.MathUtils.generateUUID(),
      operation: 'recalculate-normals',
      issueId,
      meshUuid: mesh.uuid,
      meshName: mesh.name || `Mesh_${mesh.id}`,
      status: 'READY',
      risk: 'CONDITIONAL',
      trianglesBefore: before.triangleCount,
      trianglesAfter: before.triangleCount,
      affectedTriangles: 0,
      affectedCount: planned.invalidBefore,
      metric: 'normals',
      metricBefore: planned.invalidBefore,
      metricAfter: planned.invalidAfter,
      verticesBefore: before.vertexCount,
      verticesAfter: before.vertexCount,
      affectedVertices: planned.invalidBefore,
      boundaryEdgesBefore: before.boundaryEdges,
      boundaryEdgesAfter: before.boundaryEdges,
      nonManifoldEdgesBefore: before.nonManifoldEdges,
      nonManifoldEdgesAfter: before.nonManifoldEdges,
    };

    this.pending = {
      mutation: 'geometry',
      preview,
      geometryUuid: geometry.uuid,
      replacementGeometry: planned.replacement,
      snapshot: captureGeometry(geometry),
    };

    return preview;
  }

  public previewMergeExactDuplicateVertices(
    root: THREE.Object3D,
    meshUuid: string
  ): HealPreview {
    this.disposePending();

    const obj = root.getObjectByProperty('uuid', meshUuid);
    if (!obj || !(obj as THREE.Mesh).isMesh || (obj as THREE.InstancedMesh).isInstancedMesh) {
      return this.blockedDuplicates(meshUuid, 'Unknown mesh', 'heal.errors.targetMissing');
    }

    const mesh = obj as THREE.Mesh;
    const geometry = mesh.geometry;

    let sharedUsers = 0;
    root.traverse((candidate) => {
      if ((candidate as THREE.Mesh).isMesh && (candidate as THREE.Mesh).geometry === geometry) {
        sharedUsers++;
      }
    });
    if (sharedUsers !== 1) {
      return this.blockedDuplicates(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        'heal.errors.sharedGeometry'
      );
    }

    let before;
    try {
      before = analyzeMeshTopology(meshTopologyData(mesh));
    } catch {
      return this.blockedDuplicates(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        'heal.errors.beforeUnavailable'
      );
    }

    if (before.isolatedVertices > 0) {
      return this.blockedDuplicates(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        'heal.errors.cleanupUnreferencedFirst'
      );
    }

    const planned = planMergeExactDuplicateVertices(geometry);
    if ('reasonKey' in planned) {
      return this.blockedDuplicates(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        planned.reasonKey
      );
    }

    const probe = new THREE.Mesh(planned.replacement);
    probe.name = mesh.name;
    probe.uuid = mesh.uuid;
    probe.matrixWorld.copy(documentMatrix(mesh));

    let after;
    try {
      after = analyzeMeshTopology(meshTopologyData(probe));
    } catch {
      planned.replacement.dispose();
      return this.blockedDuplicates(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        'heal.errors.afterUnavailable'
      );
    }

    const regresses =
      after.triangleCount !== before.triangleCount ||
      after.isolatedVertices !== before.isolatedVertices ||
      after.degenerateTriangles > before.degenerateTriangles ||
      after.boundaryEdges > before.boundaryEdges ||
      after.nonManifoldEdges > before.nonManifoldEdges ||
      after.componentsCount > before.componentsCount ||
      after.thinTriangles > before.thinTriangles ||
      after.tinyComponentsCount > before.tinyComponentsCount;

    if (regresses) {
      planned.replacement.dispose();
      return this.blockedDuplicates(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        'heal.errors.duplicateMergeChangesTopology'
      );
    }

    const preview: HealPreview = {
      operationId: THREE.MathUtils.generateUUID(),
      operation: 'merge-exact-duplicate-vertices',
      issueId: 'topo-duplicate-positions',
      meshUuid: mesh.uuid,
      meshName: mesh.name || `Mesh_${mesh.id}`,
      status: 'READY',
      risk: 'CONDITIONAL',
      trianglesBefore: before.triangleCount,
      trianglesAfter: after.triangleCount,
      affectedTriangles: 0,
      affectedCount: planned.removedVertices,
      metric: 'duplicates',
      metricBefore: before.potentialDuplicatePositions,
      metricAfter: after.potentialDuplicatePositions,
      verticesBefore: planned.verticesBefore,
      verticesAfter: planned.verticesAfter,
      affectedVertices: planned.removedVertices,
      boundaryEdgesBefore: before.boundaryEdges,
      boundaryEdgesAfter: after.boundaryEdges,
      nonManifoldEdgesBefore: before.nonManifoldEdges,
      nonManifoldEdgesAfter: after.nonManifoldEdges,
    };

    this.pending = {
      mutation: 'geometry',
      preview,
      geometryUuid: geometry.uuid,
      replacementGeometry: planned.replacement,
      snapshot: captureGeometry(geometry),
    };

    return preview;
  }

  public previewNormalizeSkinWeights(
    root: THREE.Object3D,
    meshUuid: string
  ): HealPreview {
    this.disposePending();

    const obj = root.getObjectByProperty('uuid', meshUuid);
    if (
      !obj ||
      !(obj as THREE.Mesh).isMesh ||
      !(obj as THREE.SkinnedMesh).isSkinnedMesh ||
      (obj as THREE.InstancedMesh).isInstancedMesh
    ) {
      return this.blockedWeights(meshUuid, 'Unknown mesh', 'heal.errors.skinWeightsNeedsSkinnedMesh');
    }

    const mesh = obj as THREE.SkinnedMesh;
    const geometry = mesh.geometry;

    let sharedUsers = 0;
    root.traverse((candidate) => {
      if ((candidate as THREE.Mesh).isMesh && (candidate as THREE.Mesh).geometry === geometry) {
        sharedUsers++;
      }
    });
    if (sharedUsers !== 1) {
      return this.blockedWeights(
        mesh.uuid,
        mesh.name || `SkinnedMesh_${mesh.id}`,
        'heal.errors.sharedGeometry'
      );
    }

    const planned = planNormalizeSkinWeights(mesh);
    if ('reasonKey' in planned) {
      return this.blockedWeights(
        mesh.uuid,
        mesh.name || `SkinnedMesh_${mesh.id}`,
        planned.reasonKey
      );
    }

    let before;
    try {
      before = analyzeMeshTopology(meshTopologyData(mesh));
    } catch {
      planned.replacement.dispose();
      return this.blockedWeights(
        mesh.uuid,
        mesh.name || `SkinnedMesh_${mesh.id}`,
        'heal.errors.beforeUnavailable'
      );
    }

    const preview: HealPreview = {
      operationId: THREE.MathUtils.generateUUID(),
      operation: 'normalize-skin-weights',
      issueId: 'skin-invalid-sum',
      meshUuid: mesh.uuid,
      meshName: mesh.name || `SkinnedMesh_${mesh.id}`,
      status: 'READY',
      risk: 'CONDITIONAL',
      trianglesBefore: before.triangleCount,
      trianglesAfter: before.triangleCount,
      affectedTriangles: 0,
      affectedCount: planned.invalidBefore,
      metric: 'weights',
      metricBefore: planned.invalidBefore,
      metricAfter: planned.invalidAfter,
      verticesBefore: before.vertexCount,
      verticesAfter: before.vertexCount,
      affectedVertices: planned.invalidBefore,
      boundaryEdgesBefore: before.boundaryEdges,
      boundaryEdgesAfter: before.boundaryEdges,
      nonManifoldEdgesBefore: before.nonManifoldEdges,
      nonManifoldEdgesAfter: before.nonManifoldEdges,
    };

    this.pending = {
      mutation: 'geometry',
      preview,
      geometryUuid: geometry.uuid,
      replacementGeometry: planned.replacement,
      snapshot: captureGeometry(geometry),
    };

    return preview;
  }

  public previewRemoveExactDuplicateTriangles(
    root: THREE.Object3D,
    meshUuid: string
  ): HealPreview {
    this.disposePending();

    const obj = root.getObjectByProperty('uuid', meshUuid);
    if (!obj || !(obj as THREE.Mesh).isMesh || (obj as THREE.InstancedMesh).isInstancedMesh) {
      return this.blockedDuplicateTriangles(meshUuid, 'Unknown mesh', 'heal.errors.targetMissing');
    }

    const mesh = obj as THREE.Mesh;
    const geometry = mesh.geometry;

    let sharedUsers = 0;
    root.traverse((candidate) => {
      if ((candidate as THREE.Mesh).isMesh && (candidate as THREE.Mesh).geometry === geometry) {
        sharedUsers++;
      }
    });
    if (sharedUsers !== 1) {
      return this.blockedDuplicateTriangles(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        'heal.errors.sharedGeometry'
      );
    }

    const planned = planRemoveExactDuplicateTriangles(mesh);
    if ('reasonKey' in planned) {
      return this.blockedDuplicateTriangles(
        mesh.uuid,
        mesh.name || `Mesh_${mesh.id}`,
        planned.reasonKey
      );
    }

    const preview: HealPreview = {
      operationId: THREE.MathUtils.generateUUID(),
      operation: 'remove-exact-duplicate-triangles',
      issueId: 'topo-exact-duplicate-triangles',
      meshUuid: mesh.uuid,
      meshName: mesh.name || `Mesh_${mesh.id}`,
      status: 'READY',
      risk: 'CONDITIONAL',
      trianglesBefore: planned.before.triangleCount,
      trianglesAfter: planned.after.triangleCount,
      affectedTriangles: planned.duplicateCount,
      affectedCount: planned.duplicateCount,
      metric: 'duplicate-triangles',
      metricBefore: planned.before.duplicateTriangles,
      metricAfter: planned.after.duplicateTriangles,
      verticesBefore: planned.before.vertexCount,
      verticesAfter: planned.after.vertexCount,
      affectedVertices: 0,
      boundaryEdgesBefore: planned.before.boundaryEdges,
      boundaryEdgesAfter: planned.after.boundaryEdges,
      nonManifoldEdgesBefore: planned.before.nonManifoldEdges,
      nonManifoldEdgesAfter: planned.after.nonManifoldEdges,
    };

    this.pending = {
      mutation: 'index-only',
      preview,
      geometryUuid: geometry.uuid,
      replacementIndex: planned.replacementIndex,
      snapshot: captureGeometry(geometry),
    };

    return preview;
  }

  public previewConsolidateDuplicateSkinInfluences(
    root: THREE.Object3D,
    meshUuid: string
  ): HealPreview {
    this.disposePending();

    const obj = root.getObjectByProperty('uuid', meshUuid);
    if (
      !obj ||
      !(obj as THREE.Mesh).isMesh ||
      !(obj as THREE.SkinnedMesh).isSkinnedMesh ||
      (obj as THREE.InstancedMesh).isInstancedMesh
    ) {
      return this.blockedSkinInfluences(
        meshUuid,
        'Unknown mesh',
        'heal.errors.skinWeightsNeedsSkinnedMesh'
      );
    }

    const mesh = obj as THREE.SkinnedMesh;
    const geometry = mesh.geometry;

    let sharedUsers = 0;
    root.traverse((candidate) => {
      if ((candidate as THREE.Mesh).isMesh && (candidate as THREE.Mesh).geometry === geometry) {
        sharedUsers++;
      }
    });
    if (sharedUsers !== 1) {
      return this.blockedSkinInfluences(
        mesh.uuid,
        mesh.name || `SkinnedMesh_${mesh.id}`,
        'heal.errors.sharedGeometry'
      );
    }

    const planned = planConsolidateDuplicateSkinInfluences(mesh);
    if ('reasonKey' in planned) {
      return this.blockedSkinInfluences(
        mesh.uuid,
        mesh.name || `SkinnedMesh_${mesh.id}`,
        planned.reasonKey
      );
    }

    let before;
    try {
      before = analyzeMeshTopology(meshTopologyData(mesh));
    } catch {
      planned.replacement.dispose();
      return this.blockedSkinInfluences(
        mesh.uuid,
        mesh.name || `SkinnedMesh_${mesh.id}`,
        'heal.errors.beforeUnavailable'
      );
    }

    const preview: HealPreview = {
      operationId: THREE.MathUtils.generateUUID(),
      operation: 'consolidate-duplicate-skin-influences',
      issueId: 'skin-redundant-influences',
      meshUuid: mesh.uuid,
      meshName: mesh.name || `SkinnedMesh_${mesh.id}`,
      status: 'READY',
      risk: 'CONDITIONAL',
      trianglesBefore: before.triangleCount,
      trianglesAfter: before.triangleCount,
      affectedTriangles: 0,
      affectedCount: planned.redundantBefore,
      metric: 'skin-influences',
      metricBefore: planned.redundantBefore,
      metricAfter: planned.redundantAfter,
      verticesBefore: before.vertexCount,
      verticesAfter: before.vertexCount,
      affectedVertices: planned.redundantBefore,
      boundaryEdgesBefore: before.boundaryEdges,
      boundaryEdgesAfter: before.boundaryEdges,
      nonManifoldEdgesBefore: before.nonManifoldEdges,
      nonManifoldEdgesAfter: before.nonManifoldEdges,
    };

    this.pending = {
      mutation: 'geometry',
      preview,
      geometryUuid: geometry.uuid,
      replacementGeometry: planned.replacement,
      snapshot: captureGeometry(geometry),
    };

    return preview;
  }

  public applyPending(root: THREE.Object3D, assetName = ''): HealApplyResult {
    const startedAt=nowMs();
    const steps=this.applySteps(root,assetName);
    let step=steps.next();
    while(!step.done) {
      if(!step.value){step=steps.next(null);continue;}
      let metrics:HealMetrics|null=null;
      try {metrics=healMetrics(analyzeMeshTopology(meshTopologyData(step.value)),step.value.geometry,step.value);}catch { /* Preserve the existing before/PARTIAL error paths. */ }
      step=steps.next(metrics);
    }
    return this.observeApply(step.value,startedAt);
  }

  public async applyPendingAsync(root:THREE.Object3D,assetName:string):Promise<HealApplyResult> {
    const startedAt=nowMs();
    const generation=this.generation,steps=this.applySteps(root,assetName);
    let step=steps.next();
    while(!step.done) {
      if(!step.value) {
        await new Promise<void>(resolve=>setTimeout(resolve,0));
        if(generation!==this.generation)return steps.return({success:false,reason:'Repair cancelled because the asset changed.'}).value as HealApplyResult;
        step=steps.next(null);continue;
      }
      const mesh=step.value,snapshot=captureGeometry(mesh.geometry);
      let metrics:HealMetrics|null=null;
      try {metrics=await this.compute.request<HealMetrics>({kind:'measure',root:packRoot(root),meshUuid:mesh.uuid});}catch { /* Before failure cancels; after failure retains Undo and remains PARTIAL. */ }
      if(generation!==this.generation) return steps.return({success:false,reason:'Repair cancelled because the asset changed.'}).value as HealApplyResult;
      if(!geometryMatches(mesh.geometry,snapshot)) metrics=null;
      step=steps.next(metrics);
    }
    return this.observeApply(step.value,startedAt);
  }

  private *applySteps(root:THREE.Object3D,assetName:string):Generator<THREE.Mesh|null,HealApplyResult,HealMetrics|null> {
    const pending = this.pending;
    if (!pending) {
      return { success: false, reason: 'No Surgical Heal preview is pending.' };
    }

    const obj = root.getObjectByProperty('uuid', pending.preview.meshUuid);
    if (!obj || !(obj as THREE.Mesh).isMesh || (obj as THREE.InstancedMesh).isInstancedMesh) {
      this.disposePending();
      return { success: false, reason: 'Target mesh is no longer available.' };
    }

    const mesh = obj as THREE.Mesh;
    const geometry = mesh.geometry;
    if (
      geometry.uuid !== pending.geometryUuid ||
      (pending.mutation === 'index-only' && !geometry.index)
    ) {
      this.disposePending();
      return { success: false, reason: 'Geometry changed after preview. Preview must be regenerated.' };
    }

    if (!geometryMatches(geometry, pending.snapshot)) {
      this.disposePending();
      return { success: false, reasonKey: 'heal.errors.stalePreview' };
    }

    let sharedUsers = 0;
    root.traverse(candidate => {
      if ((candidate as THREE.Mesh).isMesh && (candidate as THREE.Mesh).geometry === geometry) sharedUsers++;
    });
    if (sharedUsers !== 1) {
      this.disposePending();
      return { success: false, reasonKey: 'heal.errors.sharedGeometry' };
    }

    const retained=binaryBytes(this.undoStack.map(entry=>[entry.appliedSnapshot.entries.map(item=>item.bytes),entry.restore.mutation==='index-only'?entry.restore.previousIndex.array:geometryArrays(entry.restore.previousGeometry)]));
    const projected=pending.mutation==='index-only'
      ? pending.snapshot.entries.reduce((sum,entry)=>sum+entry.bytes.byteLength,0)+pending.replacementIndex.array.byteLength
      : Object.values(pending.replacementGeometry.attributes).concat(Object.values(pending.replacementGeometry.morphAttributes).flat()).reduce((sum,attribute)=>sum+attribute.array.byteLength,0)+(pending.replacementGeometry.index?.array.byteLength??0)+binaryBytes(geometryArrays(geometry));
    if(retained+projected>this.historyLimitBytes){
      this.disposePending();return {success:false,reason:'Undo memory limit reached. Save the model and reopen it before making more changes.'};
    }
    const before=yield mesh;
    if(!before) {
      this.disposePending();
      return { success: false, reasonKey: 'heal.errors.beforeUnavailable' };
    }

    let restore: UndoRestore|undefined;
    let restoreRecorded=false;
    try {
    let buffersMatch = false;

    if (pending.mutation === 'index-only') {
      const expectedSnapshot = {
        ...pending.snapshot,
        entries: [
          ...pending.snapshot.entries.slice(0, -1),
          captureAttribute(pending.replacementIndex),
        ],
      };
      restore = { mutation: 'index-only', previousIndex: geometry.index!.clone() };
      geometry.setIndex(pending.replacementIndex.clone());
      geometry.index!.needsUpdate = true;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      buffersMatch = geometryMatches(geometry, expectedSnapshot);
    } else {
      // Ownership of the current geometry moves to Undo. Apply a clone of the
      // deterministic replacement so post-apply verification is independent of
      // the preview object itself.
      restore = { mutation: 'geometry', previousGeometry: geometry };
      const plannedGeometry = pending.replacementGeometry;
      const appliedGeometryCandidate = plannedGeometry.clone();
      mesh.geometry = appliedGeometryCandidate;
      buffersMatch = geometryDataEquivalent(appliedGeometryCandidate, plannedGeometry);
      plannedGeometry.dispose();
    }

    const appliedGeometry = mesh.geometry;
    const appliedSnapshot = captureGeometry(appliedGeometry);
    // Paint the actual mutation before extracting the independent worker postcheck.
    yield null;

    const after=yield mesh;
    buffersMatch = buffersMatch && geometryMatches(mesh.geometry,appliedSnapshot);

    const verified = verifyHealOperation(
      pending.preview.operation,
      before,
      after,
      pending.preview.affectedCount,
      buffersMatch
    );

    const report: HealOperationReport = {
      version: 2,
      operationId: pending.preview.operationId,
      operation: pending.preview.operation,
      assetName,
      meshUuid: mesh.uuid,
      meshName: pending.preview.meshName,
      appliedAt: new Date().toISOString(),
      expectedRemoved: pending.preview.affectedCount,
      before,
      after,
      targetStatus: verified.status,
      status: verified.status === 'REGRESSION' ? 'REGRESSION' : 'PARTIAL',
      pipeline: 'pending',
      reasons: verified.reasons,
    };

    this.lastOperation = report;
    this.undoStack.push({
      operation: pending.preview.operation,
      meshUuid: mesh.uuid,
      meshName: pending.preview.meshName,
      geometryUuid: appliedGeometry.uuid,
      restore,
      affectedTriangles: pending.preview.affectedTriangles,
      affectedVertices: pending.preview.affectedVertices ?? 0,
      affectedCount: pending.preview.affectedCount,
      appliedSnapshot,
      report,
    });
    restoreRecorded=true;

    const result: HealApplyResult = {
      success: true,
      report: this.getLastOperation()!,
      operation: pending.preview.operation,
      meshUuid: mesh.uuid,
      meshName: pending.preview.meshName,
      affectedTriangles: pending.preview.affectedTriangles,
      affectedVertices: pending.preview.affectedVertices,
      affectedCount: pending.preview.affectedCount,
      trianglesBefore: pending.preview.trianglesBefore,
      trianglesAfter: after?.triangleCount,
    };

    // For geometry mutation the replacement is now owned by the scene.
    this.pending = null;
    return result;
    } finally {
      // A replaced asset must not retain the old geometry while postcheck was awaiting.
      if(restore?.mutation==='geometry' && !restoreRecorded) disposeUnownedGeometry(restore.previousGeometry);
    }
  }

  public undoLast(root: THREE.Object3D): HealApplyResult {
    const undo = this.undoStack[this.undoStack.length - 1];
    if (!undo) {
      return { success: false, reason: 'No Surgical Heal operation is available to undo.' };
    }

    const obj = root.getObjectByProperty('uuid', undo.meshUuid);
    if (!obj || !(obj as THREE.Mesh).isMesh) {
      return { success: false, reason: 'Undo target mesh is no longer available.' };
    }

    const mesh = obj as THREE.Mesh;
    if (mesh.geometry.uuid !== undo.geometryUuid) {
      return { success: false, reason: 'Undo target geometry has changed.' };
    }

    let sharedUsers = 0;
    root.traverse(candidate => {
      if ((candidate as THREE.Mesh).isMesh && (candidate as THREE.Mesh).geometry === mesh.geometry) sharedUsers++;
    });
    if (sharedUsers !== 1 || !geometryMatches(mesh.geometry, undo.appliedSnapshot)) {
      return { success: false, reasonKey: 'heal.errors.staleUndo' };
    }

    const trianglesBeforeUndo = mesh.geometry.index
      ? Math.floor(mesh.geometry.index.count / 3)
      : Math.floor((mesh.geometry.getAttribute('position')?.count ?? 0) / 3);

    if (undo.restore.mutation === 'index-only') {
      mesh.geometry.setIndex(undo.restore.previousIndex.clone());
      mesh.geometry.index!.needsUpdate = true;
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    } else {
      const repairedGeometry = mesh.geometry;
      mesh.geometry = undo.restore.previousGeometry;
      disposeUnownedGeometry(repairedGeometry);
    }

    this.undoStack.pop();
    this.disposePending();
    undo.report.undoneAt = new Date().toISOString();
    this.lastOperation = undo.report;
    this.verificationStart=null;
    this.publishMemory();

    return {
      success: true,
      report: this.getLastOperation()!,
      operation: undo.operation,
      meshUuid: mesh.uuid,
      meshName: undo.meshName,
      affectedTriangles: undo.affectedTriangles,
      affectedVertices: undo.affectedVertices,
      affectedCount: undo.affectedCount,
      trianglesBefore: trianglesBeforeUndo,
      trianglesAfter: mesh.geometry.index
        ? Math.floor(mesh.geometry.index.count / 3)
        : Math.floor((mesh.geometry.getAttribute('position')?.count ?? 0) / 3),
    };
  }

  private blocked(meshUuid: string, meshName: string, reason: string): HealPreview {
    return {
      operationId: `heal_blocked_${meshUuid}`,
      operation: 'remove-degenerate-triangles',
      issueId: 'topo-degenerate-triangles',
      meshUuid,
      meshName,
      status: 'BLOCKED',
      risk: 'CONDITIONAL',
      reason,
      trianglesBefore: 0,
      trianglesAfter: 0,
      affectedTriangles: 0,
      affectedCount: 0,
      metric: 'triangles',
      metricBefore: 0,
      metricAfter: 0,
      verticesBefore: 0,
      verticesAfter: 0,
      affectedVertices: 0,
      boundaryEdgesBefore: 0,
      boundaryEdgesAfter: 0,
      nonManifoldEdgesBefore: 0,
      nonManifoldEdgesAfter: 0,
    };
  }

  private blockedUnreferenced(
    meshUuid: string,
    meshName: string,
    reasonKeyOrReason: string
  ): HealPreview {
    const isKey = reasonKeyOrReason.startsWith('heal.');
    return {
      operationId: `heal_blocked_unreferenced_${meshUuid}`,
      operation: 'remove-unreferenced-vertices',
      issueId: 'topo-isolated-vertices',
      meshUuid,
      meshName,
      status: 'BLOCKED',
      risk: 'CONDITIONAL',
      reasonKey: isKey ? reasonKeyOrReason : undefined,
      reason: isKey ? undefined : reasonKeyOrReason,
      trianglesBefore: 0,
      trianglesAfter: 0,
      affectedTriangles: 0,
      affectedCount: 0,
      metric: 'vertices',
      metricBefore: 0,
      metricAfter: 0,
      verticesBefore: 0,
      verticesAfter: 0,
      affectedVertices: 0,
      boundaryEdgesBefore: 0,
      boundaryEdgesAfter: 0,
      nonManifoldEdgesBefore: 0,
      nonManifoldEdgesAfter: 0,
    };
  }

  private blockedNormals(
    meshUuid: string,
    meshName: string,
    issueId: 'normals-missing' | 'normals-zero',
    reasonKeyOrReason: string
  ): HealPreview {
    const isKey = reasonKeyOrReason.startsWith('heal.');
    return {
      operationId: `heal_blocked_normals_${meshUuid}`,
      operation: 'recalculate-normals',
      issueId,
      meshUuid,
      meshName,
      status: 'BLOCKED',
      risk: 'CONDITIONAL',
      reasonKey: isKey ? reasonKeyOrReason : undefined,
      reason: isKey ? undefined : reasonKeyOrReason,
      trianglesBefore: 0,
      trianglesAfter: 0,
      affectedTriangles: 0,
      affectedCount: 0,
      metric: 'normals',
      metricBefore: 0,
      metricAfter: 0,
      verticesBefore: 0,
      verticesAfter: 0,
      affectedVertices: 0,
      boundaryEdgesBefore: 0,
      boundaryEdgesAfter: 0,
      nonManifoldEdgesBefore: 0,
      nonManifoldEdgesAfter: 0,
    };
  }

  private blockedDuplicates(
    meshUuid: string,
    meshName: string,
    reasonKeyOrReason: string
  ): HealPreview {
    const isKey = reasonKeyOrReason.startsWith('heal.');
    return {
      operationId: `heal_blocked_duplicates_${meshUuid}`,
      operation: 'merge-exact-duplicate-vertices',
      issueId: 'topo-duplicate-positions',
      meshUuid,
      meshName,
      status: 'BLOCKED',
      risk: 'CONDITIONAL',
      reasonKey: isKey ? reasonKeyOrReason : undefined,
      reason: isKey ? undefined : reasonKeyOrReason,
      trianglesBefore: 0,
      trianglesAfter: 0,
      affectedTriangles: 0,
      affectedCount: 0,
      metric: 'duplicates',
      metricBefore: 0,
      metricAfter: 0,
      verticesBefore: 0,
      verticesAfter: 0,
      affectedVertices: 0,
      boundaryEdgesBefore: 0,
      boundaryEdgesAfter: 0,
      nonManifoldEdgesBefore: 0,
      nonManifoldEdgesAfter: 0,
    };
  }

  private blockedDuplicateTriangles(
    meshUuid: string,
    meshName: string,
    reasonKeyOrReason: string
  ): HealPreview {
    const isKey = reasonKeyOrReason.startsWith('heal.');
    return {
      operationId: `heal_blocked_duplicate_triangles_${meshUuid}`,
      operation: 'remove-exact-duplicate-triangles',
      issueId: 'topo-exact-duplicate-triangles',
      meshUuid,
      meshName,
      status: 'BLOCKED',
      risk: 'CONDITIONAL',
      reasonKey: isKey ? reasonKeyOrReason : undefined,
      reason: isKey ? undefined : reasonKeyOrReason,
      trianglesBefore: 0,
      trianglesAfter: 0,
      affectedTriangles: 0,
      affectedCount: 0,
      metric: 'triangles',
      metricBefore: 0,
      metricAfter: 0,
      verticesBefore: 0,
      verticesAfter: 0,
      affectedVertices: 0,
      boundaryEdgesBefore: 0,
      boundaryEdgesAfter: 0,
      nonManifoldEdgesBefore: 0,
      nonManifoldEdgesAfter: 0,
    };
  }

  private blockedSkinInfluences(
    meshUuid: string,
    meshName: string,
    reasonKeyOrReason: string
  ): HealPreview {
    const isKey = reasonKeyOrReason.startsWith('heal.');
    return {
      operationId: `heal_blocked_skin_influences_${meshUuid}`,
      operation: 'consolidate-duplicate-skin-influences',
      issueId: 'skin-redundant-influences',
      meshUuid,
      meshName,
      status: 'BLOCKED',
      risk: 'CONDITIONAL',
      reasonKey: isKey ? reasonKeyOrReason : undefined,
      reason: isKey ? undefined : reasonKeyOrReason,
      trianglesBefore: 0,
      trianglesAfter: 0,
      affectedTriangles: 0,
      affectedCount: 0,
      metric: 'skin-influences',
      metricBefore: 0,
      metricAfter: 0,
      verticesBefore: 0,
      verticesAfter: 0,
      affectedVertices: 0,
      boundaryEdgesBefore: 0,
      boundaryEdgesAfter: 0,
      nonManifoldEdgesBefore: 0,
      nonManifoldEdgesAfter: 0,
    };
  }

  private blockedWeights(
    meshUuid: string,
    meshName: string,
    reasonKeyOrReason: string
  ): HealPreview {
    const isKey = reasonKeyOrReason.startsWith('heal.');
    return {
      operationId: `heal_blocked_weights_${meshUuid}`,
      operation: 'normalize-skin-weights',
      issueId: 'skin-invalid-sum',
      meshUuid,
      meshName,
      status: 'BLOCKED',
      risk: 'CONDITIONAL',
      reasonKey: isKey ? reasonKeyOrReason : undefined,
      reason: isKey ? undefined : reasonKeyOrReason,
      trianglesBefore: 0,
      trianglesAfter: 0,
      affectedTriangles: 0,
      affectedCount: 0,
      metric: 'weights',
      metricBefore: 0,
      metricAfter: 0,
      verticesBefore: 0,
      verticesAfter: 0,
      affectedVertices: 0,
      boundaryEdgesBefore: 0,
      boundaryEdgesAfter: 0,
      nonManifoldEdgesBefore: 0,
      nonManifoldEdgesAfter: 0,
    };
  }

  private makeIndexArray(source: SupportedIndexArray, values: number[]): SupportedIndexArray {
    if (source instanceof Uint32Array) return new Uint32Array(values);
    if (source instanceof Uint16Array) return new Uint16Array(values);
    return new Uint8Array(values);
  }

  private countEdgeState(index: THREE.BufferAttribute): { boundary: number; nonManifold: number } {
    const counts = new Map<string, number>();
    const triangles = Math.floor(index.count / 3);

    const addEdge = (u: number, v: number) => {
      const min = Math.min(u, v);
      const max = Math.max(u, v);
      const key = `${min}_${max}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    };

    for (let triangle = 0; triangle < triangles; triangle++) {
      const base = triangle * 3;
      const a = index.getX(base);
      const b = index.getX(base + 1);
      const c = index.getX(base + 2);
      addEdge(a, b);
      addEdge(b, c);
      addEdge(c, a);
    }

    let boundary = 0;
    let nonManifold = 0;
    for (const count of counts.values()) {
      if (count === 1) boundary++;
      if (count > 2) nonManifold++;
    }

    return { boundary, nonManifold };
  }
}
