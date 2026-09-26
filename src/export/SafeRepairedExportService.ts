import * as THREE from 'three';
import { auditGltfSource } from '../loaders/GltfSourceAudit';
import type { HealOperationReport } from '../types';
import {
  RepairedExportService,
  type RepairedExportRequest,
  type RepairedExportResult,
} from './RepairedExportService';

function repairedMeshFingerprint(root: THREE.Object3D, reports: HealOperationReport[]) {
  const ids = new Set(reports.map((report) => report.meshUuid));
  const parts: string[] = [];
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh || !ids.has(object.uuid)) return;
    const mesh = object as THREE.Mesh;
    const geometry = mesh.geometry;
    const attrs = Object.entries(geometry.attributes)
      .map(([name, attr]) => `${name}:${attr.count}:${attr.itemSize}:${attr.version}`)
      .sort()
      .join(',');
    const morphs = Object.entries(geometry.morphAttributes)
      .map(([name, values]) => `${name}:${values.map((value) => `${value.count}:${value.itemSize}:${value.version}`).join('/')}`)
      .sort()
      .join(',');
    parts.push([
      mesh.uuid,
      geometry.uuid,
      geometry.index?.count ?? -1,
      geometry.index?.version ?? -1,
      attrs,
      morphs,
    ].join('|'));
  });
  return parts.sort().join('||');
}

function addReason(result: RepairedExportResult, reason: string) {
  if (!result.report.reasons.includes(reason)) result.report.reasons.push(reason);
  result.report.status = 'REGRESSION';
}

/**
 * Release-safety wrapper around repaired export.
 *
 * It adds two guarantees not provided by scene-vs-scene verification alone:
 * 1) source glTF capabilities that were lost by GLTFLoader/GLTFExporter cannot
 *    silently receive VERIFIED;
 * 2) Undo or another repair during an async export invalidates the result.
 */
export class SafeRepairedExportService extends RepairedExportService {
  public override async exportAndVerify(request: RepairedExportRequest): Promise<RepairedExportResult> {
    const sessionBefore = repairedMeshFingerprint(request.currentRoot, request.healReports);
    const sourceAudit = request.source.kind === 'buffer'
      ? auditGltfSource(request.source.buffer)
      : undefined;

    const result = await super.exportAndVerify(request);

    if (sessionBefore !== repairedMeshFingerprint(request.currentRoot, request.healReports)) {
      throw new Error('export.errors.staleSession');
    }

    if (!sourceAudit) return result;
    const outputAudit = auditGltfSource(result.buffer);

    // Compression-only extensions may disappear when the asset is reserialized
    // without changing model semantics. All other source extensions are treated
    // conservatively until Asset Doctor has an explicit preservation contract.
    if (sourceAudit.semanticExtensions.length > 0) {
      addReason(result, `sourceExtensions:${sourceAudit.semanticExtensions.join(',')}`);
    }

    if (sourceAudit.materialCount !== outputAudit.materialCount) {
      addReason(result, 'sourceMaterialDefinitions');
    }
    if (sourceAudit.textureCount !== outputAudit.textureCount) {
      addReason(result, 'sourceTextureDefinitions');
    }
    if (sourceAudit.imageCount !== outputAudit.imageCount) {
      addReason(result, 'sourceImageDefinitions');
    }
    if (sourceAudit.animationCount !== outputAudit.animationCount) {
      addReason(result, 'sourceAnimationDefinitions');
    }

    return result;
  }
}
