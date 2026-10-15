import type { HealthIssue, HealOperationKind } from '../../types';
import type { SurgicalHealEngine } from '../SurgicalHealEngine';
import type { RepairOperationDefinition } from './RepairOperation';
import * as THREE from 'three';
import {nowMs} from '../../performance/PerformanceProfiler';

const removeDegenerateTriangles: RepairOperationDefinition = {
  kind: 'remove-degenerate-triangles',
  issueIds: ['topo-degenerate-triangles'],
  risk: 'CONDITIONAL',
  labelKey: 'repair.operations.removeDegenerateTriangles.label',
  descriptionKey: 'repair.operations.removeDegenerateTriangles.description',
  capabilities: {
    preview: true,
    apply: true,
    undo: true,
    verify: true,
    exportPatch: 'index-only',
  },
  preview: (engine, root, issue) => {
    if (!issue.meshUuid) return null;
    return engine.previewRemoveDegenerateTriangles(root, issue.meshUuid);
  },
};

const removeUnreferencedVertices: RepairOperationDefinition = {
  kind: 'remove-unreferenced-vertices',
  issueIds: ['topo-isolated-vertices'],
  risk: 'CONDITIONAL',
  labelKey: 'repair.operations.removeUnreferencedVertices.label',
  descriptionKey: 'repair.operations.removeUnreferencedVertices.description',
  capabilities: {
    preview: true,
    apply: true,
    undo: true,
    verify: true,
    exportPatch: 'geometry',
  },
  preview: (engine, root, issue) => {
    if (!issue.meshUuid) return null;
    return engine.previewRemoveUnreferencedVertices(root, issue.meshUuid);
  },
};

const recalculateNormals: RepairOperationDefinition = {
  kind: 'recalculate-normals',
  issueIds: ['normals-missing', 'normals-zero'],
  risk: 'CONDITIONAL',
  labelKey: 'repair.operations.recalculateNormals.label',
  descriptionKey: 'repair.operations.recalculateNormals.description',
  capabilities: {
    preview: true,
    apply: true,
    undo: true,
    verify: true,
    exportPatch: 'geometry',
  },
  preview: (engine, root, issue) => {
    if (!issue.meshUuid) return null;
    if (issue.id !== 'normals-missing' && issue.id !== 'normals-zero') return null;
    return engine.previewRecalculateNormals(root, issue.meshUuid, issue.id);
  },
};

const mergeExactDuplicateVertices: RepairOperationDefinition = {
  kind: 'merge-exact-duplicate-vertices',
  issueIds: ['topo-duplicate-positions'],
  risk: 'CONDITIONAL',
  labelKey: 'repair.operations.mergeExactDuplicateVertices.label',
  descriptionKey: 'repair.operations.mergeExactDuplicateVertices.description',
  capabilities: {
    preview: true,
    apply: true,
    undo: true,
    verify: true,
    exportPatch: 'geometry',
  },
  preview: (engine, root, issue) => {
    if (!issue.meshUuid) return null;
    return engine.previewMergeExactDuplicateVertices(root, issue.meshUuid);
  },
};

const normalizeSkinWeights: RepairOperationDefinition = {
  kind: 'normalize-skin-weights',
  issueIds: ['skin-invalid-sum'],
  risk: 'CONDITIONAL',
  labelKey: 'repair.operations.normalizeSkinWeights.label',
  descriptionKey: 'repair.operations.normalizeSkinWeights.description',
  capabilities: {
    preview: true,
    apply: true,
    undo: true,
    verify: true,
    exportPatch: 'geometry',
  },
  preview: (engine, root, issue) => {
    if (!issue.meshUuid) return null;
    return engine.previewNormalizeSkinWeights(root, issue.meshUuid);
  },
};

const removeExactDuplicateTriangles: RepairOperationDefinition = {
  kind: 'remove-exact-duplicate-triangles',
  issueIds: ['topo-exact-duplicate-triangles'],
  risk: 'CONDITIONAL',
  labelKey: 'repair.operations.removeExactDuplicateTriangles.label',
  descriptionKey: 'repair.operations.removeExactDuplicateTriangles.description',
  capabilities: {
    preview: true,
    apply: true,
    undo: true,
    verify: true,
    exportPatch: 'index-only',
  },
  preview: (engine, root, issue) => {
    if (!issue.meshUuid) return null;
    return engine.previewRemoveExactDuplicateTriangles(root, issue.meshUuid);
  },
};

const consolidateDuplicateSkinInfluences: RepairOperationDefinition = {
  kind: 'consolidate-duplicate-skin-influences',
  issueIds: ['skin-redundant-influences'],
  risk: 'CONDITIONAL',
  labelKey: 'repair.operations.consolidateDuplicateSkinInfluences.label',
  descriptionKey: 'repair.operations.consolidateDuplicateSkinInfluences.description',
  capabilities: {
    preview: true,
    apply: true,
    undo: true,
    verify: true,
    exportPatch: 'geometry',
  },
  preview: (engine, root, issue) => {
    if (!issue.meshUuid) return null;
    return engine.previewConsolidateDuplicateSkinInfluences(root, issue.meshUuid);
  },
};

const OPERATIONS: readonly RepairOperationDefinition[] = [
  removeDegenerateTriangles,
  removeUnreferencedVertices,
  recalculateNormals,
  mergeExactDuplicateVertices,
  normalizeSkinWeights,
  removeExactDuplicateTriangles,
  consolidateDuplicateSkinInfluences,
];

const BY_KIND = new Map<HealOperationKind, RepairOperationDefinition>(
  OPERATIONS.map((operation) => [operation.kind, operation])
);

const BY_ISSUE = new Map<string, RepairOperationDefinition>();
for (const operation of OPERATIONS) {
  for (const issueId of operation.issueIds) {
    if (BY_ISSUE.has(issueId)) {
      throw new Error(`Duplicate repair registration for diagnostic issue: ${issueId}`);
    }
    BY_ISSUE.set(issueId, operation);
  }
}

export function listRepairOperations(): readonly RepairOperationDefinition[] {
  return OPERATIONS;
}

export function getRepairOperation(kind: HealOperationKind): RepairOperationDefinition | null {
  return BY_KIND.get(kind) ?? null;
}

export function getRepairOperationForIssue(
  issue: Pick<HealthIssue, 'id'>
): RepairOperationDefinition | null {
  return BY_ISSUE.get(issue.id) ?? null;
}

export function previewRepairIssue(
  engine: SurgicalHealEngine,
  root: THREE.Object3D,
  issue: HealthIssue
) {
  const operation = getRepairOperationForIssue(issue);
  if (!operation || !operation.capabilities.preview) return null;

  const startedAt = nowMs();
  const preview = operation.preview(engine, root, issue);
  engine.recordPreview(nowMs()-startedAt);
  return preview;
}

export async function previewRepairIssueAsync(engine:SurgicalHealEngine,root:THREE.Object3D,issue:HealthIssue) {
  const operation=getRepairOperationForIssue(issue);
  if(!operation?.capabilities.preview || !issue.meshUuid)return null;
  const startedAt=nowMs();
  const preview=await engine.previewInWorker(root,issue.meshUuid,operation.kind,issue.id);
  engine.recordPreview(nowMs()-startedAt);
  return preview;
}
