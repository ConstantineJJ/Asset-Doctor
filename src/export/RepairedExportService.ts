import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { analyzeGeometry } from '../analysis/GeometryAnalyzer';
import { analyzeMeshTopology } from '../analysis/TopologyAnalyzer';
import { meshTopologyData } from '../analysis/MeshTopologyData';
import { GLBLoaderService } from '../loaders/GLBLoaderService';
import { auditGltfSource } from '../loaders/GltfSourceAudit';
import { createAssetDoctorTestPatient } from '../loaders/SampleModels';
import type {
  ExportVerificationReport,
  HealOperationReport,
} from '../types';
import { copyGeometryData } from '../heal/GeometryRemap';
import { measureGeometryNormals } from '../analysis/NormalsMeasure';
import { measureSkinWeights } from '../analysis/SkinWeightMeasure';
import { estimateObjectGeometryBytes, nowMs } from '../performance/PerformanceProfiler';
import { saveBinaryFile } from '../platform/FileIO';

export type ExportSampleId = 'test-patient';

export type ExportSourceDescriptor =
  | { kind: 'buffer'; fileName: string; buffer: ArrayBuffer }
  | { kind: 'sample'; sampleId: ExportSampleId };

export interface RepairedExportRequest {
  source: ExportSourceDescriptor;
  currentRoot: THREE.Group;
  assetName: string;
  /** Active verified repair session. The last report is the most recent transaction. */
  healReports: HealOperationReport[];
}

export interface RepairedExportPerformance {
  exportMs: number;
  reopenVerificationMs: number;
  totalMs: number;
  pristineGeometryBytes: number;
  reopenedGeometryBytes: number;
}

export interface RepairedExportResult {
  fileName: string;
  buffer: ArrayBuffer;
  report: ExportVerificationReport;
  performance: RepairedExportPerformance;
}

interface FreshAsset {
  root: THREE.Group;
  animations: THREE.AnimationClip[];
}

function attributeVersion(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  return (attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
    ? (attribute as THREE.InterleavedBufferAttribute).data.version
    : (attribute as THREE.BufferAttribute).version;
}

function repairedMeshFingerprint(root: THREE.Object3D, reports: HealOperationReport[]) {
  const ids = new Set(reports.map((report) => report.meshUuid));
  const parts: string[] = [];
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh || !ids.has(object.uuid)) return;
    const mesh = object as THREE.Mesh;
    const geometry = mesh.geometry;
    const attrs = Object.entries(geometry.attributes)
      .map(([name, attr]) => `${name}:${attr.count}:${attr.itemSize}:${attributeVersion(attr)}`)
      .sort()
      .join(',');
    const morphs = Object.entries(geometry.morphAttributes)
      .map(([name, values]) => `${name}:${values.map((value) => `${value.count}:${value.itemSize}:${attributeVersion(value)}`).join('/')}`)
      .sort()
      .join(',');
    parts.push([
      mesh.uuid,
      geometry.uuid,
      geometry.index?.count ?? -1,
      geometry.index ? attributeVersion(geometry.index) : -1,
      attrs,
      morphs,
    ].join('|'));
  });
  return parts.sort().join('||');
}

export class RepairedExportService {
  public async exportAndVerify(request: RepairedExportRequest): Promise<RepairedExportResult> {
    const totalStart = nowMs();
    const { currentRoot, healReports, assetName } = request;
    const sessionBefore = repairedMeshFingerprint(currentRoot, healReports);
    const sourceAudit = request.source.kind === 'buffer'
      ? auditGltfSource(request.source.buffer)
      : undefined;

    if (healReports.length === 0) {
      throw new Error('export.errors.healNotVerified');
    }

    for (const report of healReports) {
      if (report.assetName !== assetName || report.undoneAt) {
        throw new Error('export.errors.reportAssetMismatch');
      }
      if (report.status !== 'VERIFIED' || report.pipeline !== 'complete' || !report.after) {
        throw new Error('export.errors.healNotVerified');
      }
    }

    const currentMeshes = this.collectMeshes(currentRoot);
    const latestReport = healReports[healReports.length - 1];
    const targetOrdinal = currentMeshes.findIndex((mesh) => mesh.uuid === latestReport.meshUuid);
    if (targetOrdinal < 0) {
      throw new Error('export.errors.targetMissing');
    }

    const latestByMesh = new Map<string, HealOperationReport>();
    for (const report of healReports) latestByMesh.set(report.meshUuid, report);

    const repairedOrdinals = new Set<number>();
    for (const [meshUuid, report] of latestByMesh) {
      const ordinal = currentMeshes.findIndex((mesh) => mesh.uuid === meshUuid);
      if (ordinal < 0) throw new Error('export.errors.targetMissing');
      repairedOrdinals.add(ordinal);

      const mesh = currentMeshes[ordinal];
      const stats = analyzeMeshTopology(meshTopologyData(mesh));
      const normals = measureGeometryNormals(mesh.geometry);
      const skin = measureSkinWeights(mesh);
      if (
        !report.after ||
        stats.triangleCount !== report.after.triangleCount ||
        stats.vertexCount !== report.after.vertexCount ||
        stats.degenerateTriangles !== report.after.degenerateTriangles ||
        stats.isolatedVertices !== report.after.isolatedVertices ||
        stats.potentialDuplicatePositions !== report.after.potentialDuplicatePositions ||
        stats.duplicateTriangles !== report.after.duplicateTriangles ||
        (report.after.invalidNormals !== undefined &&
          normals.invalidCount !== report.after.invalidNormals) ||
        (report.after.invalidSkinWeights !== undefined &&
          (!skin.supported || skin.invalidSumCount !== report.after.invalidSkinWeights)) ||
        (report.after.redundantSkinInfluenceVertices !== undefined &&
          (!skin.supported ||
            skin.redundantInfluenceVertexCount !== report.after.redundantSkinInfluenceVertices))
      ) {
        throw new Error('export.errors.geometryChanged');
      }
    }

    const currentTarget = currentMeshes[targetOrdinal];
    const currentTargetNormals = measureGeometryNormals(currentTarget.geometry);
    const fresh = await this.createFreshAsset(request.source);
    const pristineGeometryBytes = estimateObjectGeometryBytes(fresh.root);
    let reopened: FreshAsset | null = null;
    let reopenedGeometryBytes = 0;
    let exportMs = 0;
    let reopenVerificationMs = 0;

    try {
      const freshMeshes = this.collectMeshes(fresh.root);
      if (freshMeshes.length !== currentMeshes.length || targetOrdinal >= freshMeshes.length) {
        throw new Error('export.errors.structureMismatch');
      }

      for (let i = 0; i < currentMeshes.length; i++) {
        if (
          currentMeshes[i].name !== freshMeshes[i].name ||
          Boolean((currentMeshes[i] as THREE.SkinnedMesh).isSkinnedMesh) !==
            Boolean((freshMeshes[i] as THREE.SkinnedMesh).isSkinnedMesh)
        ) {
          throw new Error('export.errors.structureMismatch');
        }
      }

      for (const ordinal of repairedOrdinals) {
        this.applyRepairPatch(currentMeshes[ordinal], freshMeshes[ordinal], 'geometry');
      }

      const pristineSummary = analyzeGeometry(fresh.root, assetName);
      const currentSummary = analyzeGeometry(currentRoot, assetName);
      const exportedName = this.makeExportName(assetName);

      const exporter = new GLTFExporter();
      const exportStart = nowMs();
      const output = await exporter.parseAsync(fresh.root, {
        binary: true,
        onlyVisible: false,
        animations: fresh.animations,
      });
      exportMs = nowMs() - exportStart;
      if (!(output instanceof ArrayBuffer)) {
        throw new Error('export.errors.binaryExportFailed');
      }

      const reopenStart = nowMs();
      const verificationLoader = new GLBLoaderService();
      try {
        const loaded = await verificationLoader.loadFromArrayBuffer(
          output,
          exportedName,
          output.byteLength
        );
        reopened = { root: loaded.root, animations: loaded.animations };
      } finally {
        verificationLoader.dispose();
      }

      reopenedGeometryBytes = estimateObjectGeometryBytes(reopened.root);
      const reopenedMeshes = this.collectMeshes(reopened.root);
      const actualSummary = analyzeGeometry(reopened.root, exportedName, output.byteLength);
      const targetMesh = reopenedMeshes[targetOrdinal];
      const reasons: string[] = [];

      const expectedMeshSignature = this.meshSignature(freshMeshes);
      const actualMeshSignature = this.meshSignature(reopenedMeshes);
      const expectedMaterialSignature = this.materialSignature(fresh.root);
      const actualMaterialSignature = this.materialSignature(reopened.root);
      const expectedRigSignature = this.rigSignature(fresh.root);
      const actualRigSignature = this.rigSignature(reopened.root);
      const expectedAnimationSignature = this.animationSignature(fresh.animations);
      const actualAnimationSignature = this.animationSignature(reopened.animations);

      if (reopenedMeshes.length !== freshMeshes.length || !targetMesh) reasons.push('meshComposition');
      if (expectedMeshSignature !== actualMeshSignature) reasons.push('meshStructure');
      if (expectedMaterialSignature !== actualMaterialSignature) reasons.push('materialStructure');
      if (expectedRigSignature !== actualRigSignature) reasons.push('rigStructure');
      if (expectedAnimationSignature !== actualAnimationSignature) reasons.push('animationStructure');

      for (const ordinal of repairedOrdinals) {
        const expectedMesh = currentMeshes[ordinal];
        const actualMesh = reopenedMeshes[ordinal];
        if (!actualMesh ||
            this.repairGeometrySignature(expectedMesh) !== this.repairGeometrySignature(actualMesh)) {
          reasons.push('repairedGeometry');
          break;
        }
      }

      let targetTrianglesActual = -1;
      let targetDegeneratesActual = -1;
      let targetVerticesActual = -1;
      let targetUnreferencedActual = -1;
      let targetInvalidNormalsActual = -1;
      let targetDuplicatePositionsActual = -1;
      let targetDuplicateTrianglesActual = -1;
      let targetInvalidSkinWeightsActual = 0;
      let targetRedundantSkinInfluencesActual = 0;
      if (targetMesh) {
        const targetStats = analyzeMeshTopology(meshTopologyData(targetMesh));
        const targetNormals = measureGeometryNormals(targetMesh.geometry);
        targetTrianglesActual = targetStats.triangleCount;
        targetDegeneratesActual = targetStats.degenerateTriangles;
        targetVerticesActual = targetStats.vertexCount;
        targetUnreferencedActual = targetStats.isolatedVertices;
        targetInvalidNormalsActual = targetNormals.invalidCount;
        targetDuplicatePositionsActual = targetStats.potentialDuplicatePositions;
        targetDuplicateTrianglesActual = targetStats.duplicateTriangles;
        const targetSkin = measureSkinWeights(targetMesh);
        targetInvalidSkinWeightsActual = targetSkin.supported ? targetSkin.invalidSumCount : 0;
        targetRedundantSkinInfluencesActual = targetSkin.supported
          ? targetSkin.redundantInfluenceVertexCount
          : 0;
      }

      if (actualSummary.triangleCount !== currentSummary.triangleCount) reasons.push('triangleCount');
      if (targetTrianglesActual !== latestReport.after!.triangleCount) reasons.push('targetTriangles');
      if (targetDegeneratesActual !== latestReport.after!.degenerateTriangles) reasons.push('targetDegenerates');
      if (targetVerticesActual !== latestReport.after!.vertexCount) reasons.push('targetVertices');
      if (targetUnreferencedActual !== latestReport.after!.isolatedVertices) reasons.push('targetUnreferenced');
      if (
        latestReport.after!.invalidNormals !== undefined &&
        targetInvalidNormalsActual !== latestReport.after!.invalidNormals
      ) reasons.push('targetInvalidNormals');
      if (targetDuplicatePositionsActual !== latestReport.after!.potentialDuplicatePositions) {
        reasons.push('targetDuplicatePositions');
      }
      if (targetDuplicateTrianglesActual !== latestReport.after!.duplicateTriangles) {
        reasons.push('targetDuplicateTriangles');
      }
      if (
        latestReport.after!.invalidSkinWeights !== undefined &&
        targetInvalidSkinWeightsActual !== latestReport.after!.invalidSkinWeights
      ) {
        reasons.push('targetInvalidSkinWeights');
      }
      if (
        latestReport.after!.redundantSkinInfluenceVertices !== undefined &&
        targetRedundantSkinInfluencesActual !== latestReport.after!.redundantSkinInfluenceVertices
      ) {
        reasons.push('targetRedundantSkinInfluences');
      }

      if (actualSummary.meshCount !== pristineSummary.meshCount) reasons.push('meshCount');
      const pristineMaterialCount = this.materialSemanticCount(fresh.root);
      const actualMaterialCount = this.materialSemanticCount(reopened.root);
      if (actualMaterialCount !== pristineMaterialCount) reasons.push('materialCount');
      if (actualSummary.textureCount !== pristineSummary.textureCount) reasons.push('textureCount');
      if (actualSummary.skinnedMeshCount !== pristineSummary.skinnedMeshCount) reasons.push('skinnedMeshCount');
      if (actualSummary.boneCount !== pristineSummary.boneCount) reasons.push('boneCount');
      if (reopened.animations.length !== fresh.animations.length) reasons.push('clipCount');

      // Scene-vs-scene checks cannot detect semantics that GLTFLoader discarded
      // before Three.js ever created the scene. Compare the raw source glTF JSON
      // with the serialized output as an additional release-safety gate.
      if (sourceAudit) {
        const outputAudit = auditGltfSource(output);
        if (sourceAudit.semanticExtensions.length > 0) {
          reasons.push(`sourceExtensions:${sourceAudit.semanticExtensions.join(',')}`);
        }
        if (sourceAudit.materialCount !== outputAudit.materialCount) reasons.push('sourceMaterialDefinitions');
        if (sourceAudit.textureCount !== outputAudit.textureCount) reasons.push('sourceTextureDefinitions');
        if (sourceAudit.imageCount !== outputAudit.imageCount) reasons.push('sourceImageDefinitions');
        if (sourceAudit.animationCount !== outputAudit.animationCount) reasons.push('sourceAnimationDefinitions');
      }

      // Export is asynchronous. Undo/Heal may have happened while GLTFExporter or
      // reopen verification was awaiting. Never publish a result built from an
      // obsolete repair-session geometry state.
      if (sessionBefore !== repairedMeshFingerprint(currentRoot, healReports)) {
        throw new Error('export.errors.staleSession');
      }

      const report: ExportVerificationReport = {
        version: 1,
        createdAt: new Date().toISOString(),
        assetName,
        exportedName,
        healOperationId: latestReport.operationId,
        status: reasons.length === 0 ? 'VERIFIED' : 'REGRESSION',
        reasons: Array.from(new Set(reasons)),
        byteLength: output.byteLength,
        repairCount: healReports.length,
        repairedMeshCount: repairedOrdinals.size,
        triangleCountExpected: currentSummary.triangleCount,
        triangleCountActual: actualSummary.triangleCount,
        targetTrianglesExpected: latestReport.after!.triangleCount,
        targetTrianglesActual,
        targetDegeneratesExpected: latestReport.after!.degenerateTriangles,
        targetDegeneratesActual,
        targetVerticesExpected: latestReport.after!.vertexCount,
        targetVerticesActual,
        targetUnreferencedExpected: latestReport.after!.isolatedVertices,
        targetUnreferencedActual,
        targetInvalidNormalsExpected: latestReport.after!.invalidNormals ?? currentTargetNormals.invalidCount,
        targetInvalidNormalsActual,
        targetDuplicatePositionsExpected: latestReport.after!.potentialDuplicatePositions,
        targetDuplicatePositionsActual,
        targetDuplicateTrianglesExpected: latestReport.after!.duplicateTriangles,
        targetDuplicateTrianglesActual,
        targetInvalidSkinWeightsExpected: latestReport.after!.invalidSkinWeights ?? 0,
        targetInvalidSkinWeightsActual,
        targetRedundantSkinInfluencesExpected:
          latestReport.after!.redundantSkinInfluenceVertices ?? 0,
        targetRedundantSkinInfluencesActual,
        meshCountExpected: pristineSummary.meshCount,
        meshCountActual: actualSummary.meshCount,
        materialCountExpected: pristineMaterialCount,
        materialCountActual: actualMaterialCount,
        textureCountExpected: pristineSummary.textureCount,
        textureCountActual: actualSummary.textureCount,
        skinnedMeshCountExpected: pristineSummary.skinnedMeshCount,
        skinnedMeshCountActual: actualSummary.skinnedMeshCount,
        boneCountExpected: pristineSummary.boneCount,
        boneCountActual: actualSummary.boneCount,
        clipCountExpected: fresh.animations.length,
        clipCountActual: reopened.animations.length,
      };

      reopenVerificationMs = nowMs() - reopenStart;
      return {
        fileName: exportedName,
        buffer: output,
        report,
        performance: {
          exportMs,
          reopenVerificationMs,
          totalMs: nowMs() - totalStart,
          pristineGeometryBytes,
          reopenedGeometryBytes,
        },
      };
    } finally {
      this.disposeObject(fresh.root);
      if (reopened) this.disposeObject(reopened.root);
    }
  }

  public download(result: RepairedExportResult): Promise<boolean> {
    return saveBinaryFile(result.fileName, result.buffer);
  }

  private async createFreshAsset(source: ExportSourceDescriptor): Promise<FreshAsset> {
    if (source.kind === 'sample') {
      const sample = createAssetDoctorTestPatient();
      return { root: sample.root, animations: sample.animations };
    }

    const loader = new GLBLoaderService();
    try {
      const loaded = await loader.loadFromArrayBuffer(
        source.buffer,
        source.fileName,
        source.buffer.byteLength
      );
      return { root: loaded.root, animations: loaded.animations };
    } finally {
      loader.dispose();
    }
  }

  private collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    root.traverse((obj) => {
      if (obj.name?.startsWith('__ascope_internal_')) return;
      if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
    });
    return meshes;
  }

  private applyRepairPatch(
    current: THREE.Mesh,
    fresh: THREE.Mesh,
    patchKind: 'index-only' | 'geometry'
  ) {
    const currentPosition = current.geometry?.attributes?.position;
    const freshPosition = fresh.geometry?.attributes?.position;

    if (!currentPosition || !freshPosition ||
        (current as THREE.SkinnedMesh).isSkinnedMesh !== (fresh as THREE.SkinnedMesh).isSkinnedMesh) {
      throw new Error('export.errors.structureMismatch');
    }

    if (patchKind === 'index-only') {
      if (currentPosition.count !== freshPosition.count ||
          Boolean(current.geometry.index) !== Boolean(fresh.geometry.index)) {
        throw new Error('export.errors.structureMismatch');
      }

      if (current.geometry.index && fresh.geometry.index) {
        fresh.geometry.setIndex(current.geometry.index.clone());
        fresh.geometry.index!.needsUpdate = true;
        fresh.geometry.computeBoundingBox();
        fresh.geometry.computeBoundingSphere();
      }
      return;
    }

    if (Boolean(current.geometry.index) !== Boolean(fresh.geometry.index)) {
      throw new Error('export.errors.structureMismatch');
    }

    copyGeometryData(fresh.geometry, current.geometry);
  }

  private meshSignature(meshes: THREE.Mesh[]) {
    return JSON.stringify(meshes.map((mesh) => ({
      name: mesh.name,
      skinned: Boolean((mesh as THREE.SkinnedMesh).isSkinnedMesh),
      vertices: mesh.geometry?.attributes?.position?.count ?? 0,
      triangles: mesh.geometry?.index
        ? Math.floor(mesh.geometry.index.count / 3)
        : Math.floor((mesh.geometry?.attributes?.position?.count ?? 0) / 3),
    })));
  }

  private textureSemanticKey(texture: THREE.Texture | null | undefined) {
    if (!texture) return null;
    const image = texture.image as { width?: number; height?: number } | undefined;
    return [
      texture.name,
      image?.width ?? null,
      image?.height ?? null,
      texture.wrapS,
      texture.wrapT,
      texture.magFilter,
      texture.minFilter,
      texture.flipY,
      texture.colorSpace,
      texture.channel,
    ];
  }

  private materialSemanticKey(material: THREE.Material) {
    const candidate = material as THREE.MeshStandardMaterial;
    return JSON.stringify([
      material.name,
      material.type,
      material.transparent,
      material.opacity,
      material.side,
      candidate.color?.getHexString?.() ?? null,
      candidate.metalness ?? null,
      candidate.roughness ?? null,
      candidate.emissive?.getHexString?.() ?? null,
      this.textureSemanticKey(candidate.map),
      this.textureSemanticKey(candidate.normalMap),
      this.textureSemanticKey(candidate.roughnessMap),
      this.textureSemanticKey(candidate.metalnessMap),
      this.textureSemanticKey(candidate.aoMap),
      this.textureSemanticKey(candidate.emissiveMap),
    ]);
  }

  private materialSignature(root: THREE.Object3D) {
    const meshAssignments: Array<{ name: string; materials: string[] }> = [];
    root.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      const materialValue = mesh.material;
      const mats: THREE.Material[] = Array.isArray(materialValue) ? materialValue : [materialValue];
      meshAssignments.push({
        name: mesh.name,
        materials: mats.filter(Boolean).map((material) => this.materialSemanticKey(material)),
      });
    });
    return JSON.stringify(meshAssignments);
  }

  private materialSemanticCount(root: THREE.Object3D) {
    const unique = new Set<string>();
    root.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const materialValue = (obj as THREE.Mesh).material;
      const mats: THREE.Material[] = Array.isArray(materialValue) ? materialValue : [materialValue];
      mats.filter(Boolean).forEach((material) => unique.add(this.materialSemanticKey(material)));
    });
    return unique.size;
  }

  private rigSignature(root: THREE.Object3D) {
    const bones: string[] = [];
    let skinnedMeshes = 0;
    root.traverse((obj) => {
      if ((obj as THREE.Bone).isBone) bones.push(obj.name);
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes++;
    });
    return JSON.stringify({ skinnedMeshes, bones: bones.sort() });
  }

  private animationSignature(clips: THREE.AnimationClip[]) {
    return JSON.stringify(clips.map((clip) => ({
      name: clip.name,
      duration: Number(clip.duration.toFixed(6)),
      tracks: clip.tracks.length,
    })));
  }

  private repairGeometrySignature(mesh: THREE.Mesh) {
    const stats = analyzeMeshTopology(meshTopologyData(mesh));
    const normals = measureGeometryNormals(mesh.geometry);
    const skin = measureSkinWeights(mesh);
    const attributes = Object.entries(mesh.geometry.attributes)
      .map(([name, attribute]) => [
        name,
        attribute.itemSize,
        attribute.count,
        attribute.normalized,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

    const morphAttributes = Object.entries(mesh.geometry.morphAttributes)
      .map(([name, values]) => [
        name,
        values.map((attribute) => [attribute.itemSize, attribute.count, attribute.normalized]),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

    return JSON.stringify({
      triangleCount: stats.triangleCount,
      vertexCount: stats.vertexCount,
      degenerateTriangles: stats.degenerateTriangles,
      boundaryEdges: stats.boundaryEdges,
      nonManifoldEdges: stats.nonManifoldEdges,
      isolatedVertices: stats.isolatedVertices,
      componentsCount: stats.componentsCount,
      thinTriangles: stats.thinTriangles,
      tinyComponentsCount: stats.tinyComponentsCount,
      potentialDuplicatePositions: stats.potentialDuplicatePositions,
      duplicateTriangles: stats.duplicateTriangles,
      normalCount: normals.normalCount,
      invalidNormals: normals.invalidCount,
      missingNormals: normals.missing,
      invalidSkinWeights: skin.supported ? skin.invalidSumCount : null,
      zeroWeightVertices: skin.supported ? skin.zeroWeightCount : null,
      redundantSkinInfluenceVertices: skin.supported
        ? skin.redundantInfluenceVertexCount
        : null,
      attributes,
      morphAttributes,
    });
  }

  private makeExportName(assetName: string) {
    const base = assetName.replace(/\.(glb|gltf)$/i, '') || 'asset';
    return `${base}_repaired.glb`;
  }

  private disposeObject(root: THREE.Object3D) {
    const textures = new Set<THREE.Texture>();
    const materials = new Set<THREE.Material>();
    const geometries = new Set<THREE.BufferGeometry>();

    root.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of mats) {
        if (!material || materials.has(material)) continue;
        materials.add(material);
        const candidate = material as THREE.MeshStandardMaterial;
        for (const texture of [
          candidate.map,
          candidate.normalMap,
          candidate.roughnessMap,
          candidate.metalnessMap,
          candidate.aoMap,
          candidate.emissiveMap,
        ]) {
          if (texture) textures.add(texture);
        }
      }
    });

    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
  }
}
