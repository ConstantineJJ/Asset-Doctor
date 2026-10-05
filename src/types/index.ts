export type HealthSeverity = 'OK' | 'INFO' | 'WARNING' | 'ERROR' | 'N/A' | 'UNKNOWN';

export type DiagnosticLayer = 'Integrity' | 'Health' | 'Fitness';

export type Repairability = 'NONE' | 'SAFE' | 'CONDITIONAL' | 'MANUAL';

export type DiagnosticProfileId =
  | 'general'
  | 'desktop-game-character'
  | 'mobile-game-character'
  | 'static-prop'
  | 'animated-character'
  | 'mechanical-asset'
  | 'visualization';

export interface DiagnosticProfile {
  id: DiagnosticProfileId;
  label: string;
  description: string;
  triangleWarning: number;
  drawCallWarning: number;
  textureDimensionWarning: number;
  maxBoneInfluencesWarning: number;
  expectsRig?: boolean;
  expectsAnimations?: boolean;
}

export type HealthCategory =
  | 'Geometry'
  | 'Topology'
  | 'Normals'
  | 'UV'
  | 'Materials'
  | 'Textures'
  | 'Skeleton'
  | 'Skinning'
  | 'Animations'
  | 'Transforms'
  | 'Performance';

export interface HealthIssue {
  id: string;
  category: HealthCategory;
  severity: HealthSeverity;
  title: string;
  description: string;

  /** Diagnostic Core v1: Integrity → Health → Fitness. */
  layer?: DiagnosticLayer;

  /** Concrete observation that caused this finding. */
  evidence?: string;

  /** Why the observation can matter technically. */
  whyItMatters?: string;

  /** Conservative next step. This is guidance, not an automatic repair. */
  suggestedAction?: string;

  /** How safely Asset Doctor could eventually repair this finding. */
  repairability?: Repairability;

  /** Profile used to interpret target-dependent findings. */
  profileId?: DiagnosticProfileId;

  /** True when severity depends on intended use rather than structural validity. */
  profileDependent?: boolean;

  meshName?: string;
  meshUuid?: string;
  nodeName?: string;
  boneName?: string;
  clipName?: string;
  count?: number;
  /** Human-readable numerator / denominator context when a reliable denominator exists. */
  ratio?: string;
  affectedIndices?: number[];
  affectedElement?: 'triangle' | 'edge' | 'vertex' | 'component';
  focusPosition?: [number, number, number];
  locations?: DiagnosticLocation[];
  technicalDetails?: string;
}

export type AnalysisStageStatus = 'pending' | 'running' | 'done' | 'error';

export interface ProgressiveAnalysisState {
  geometry: AnalysisStageStatus;
  materials: AnalysisStageStatus;
  textures: AnalysisStageStatus;
  skeleton: AnalysisStageStatus;
  animations: AnalysisStageStatus;
  transforms: AnalysisStageStatus;
  performance: AnalysisStageStatus;
  topology: AnalysisStageStatus;
}

export type PerformanceStageId =
  | 'initialLoad'
  | 'firstDiagnosticPass'
  | 'topologyWorker'
  | 'rescan'
  | 'repairPreview'
  | 'applyVerification'
  | 'export'
  | 'reopenVerification';

export interface PerformanceTimingSample {
  lastMs: number;
  bestMs: number;
  worstMs: number;
  averageMs: number;
  samples: number;
}

export interface TopologyPerformanceStats {
  meshCount: number;
  cacheHits: number;
  cacheMisses: number;
  extractionMs: number;
  workerMs: number;
  transferredBytes: number;
}

export interface PerformanceMemoryStats {
  sourceGlbBytes: number;
  liveGeometryBytes: number;
  undoSnapshotsBytes: number;
  repairPreviewBytes: number;
  exportBufferBytes: number;
  pristineExportGeometryBytes: number;
  reopenedVerificationGeometryBytes: number;
  jsHeapUsedBytes?: number;
  jsHeapLimitBytes?: number;
}

export interface PerformanceCoreProfile {
  timings: Partial<Record<PerformanceStageId, PerformanceTimingSample>>;
  topology: TopologyPerformanceStats;
  memory: PerformanceMemoryStats;
  cancelledAnalyses: number;
}

export interface SceneNodeInfo {
  uuid: string;
  name: string;
  type: 'Group' | 'Mesh' | 'SkinnedMesh' | 'Bone' | 'Light' | 'Camera' | 'Scene' | 'Object3D';
  visible: boolean;
  triangleCount: number;
  vertexCount: number;
  materialNames?: string[];
  children: SceneNodeInfo[];
  parentId?: string;
}

export interface SkinningStats {
  skinnedMeshCount: number;
  skeletonCount: number;
  totalBones: number;
  rootBoneNames: string[];
  maxInfluencesPerVertex: number;
  zeroWeightVertices: number;
  invalidWeightSumVertices: number;
  unusedBonesCount: number;
  redundantInfluenceVertices: number;
  bones: BoneInfo[];
  invalidWeightLocations?: DiagnosticLocation[];
  zeroWeightLocations?: DiagnosticLocation[];
  redundantInfluenceLocations?: DiagnosticLocation[];
}

export interface BoundingBoxInfo {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  center: [number, number, number];
  diagonal: number;
}

export interface MaterialInfo {
  uuid: string;
  name: string;
  type: string;
  baseColorHex: string;
  metallic: number;
  roughness: number;
  opacity: number;
  alphaMode: string;
  doubleSided: boolean;
  emissiveHex: string;
  textureSlots: {
    map?: string;
    normalMap?: string;
    roughnessMap?: string;
    metalnessMap?: string;
    aoMap?: string;
    emissiveMap?: string;
  };
}

export interface TextureInfo {
  uuid: string;
  name: string;
  width: number;
  height: number;
  format: string;
  colorSpace: string;
  uncompressedBytesEstimate: number;
  materialsUsed: string[];
}

export interface BoneInfo {
  uuid: string;
  name: string;
  parentName?: string;
  childrenNames: string[];
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface SkinInfluenceSummary {
  targetUuid: string;
  targetName: string;
  targetType: 'Bone' | 'SkinnedMesh';
  skinnedMeshCount: number;
  vertexCount: number;
  influencedVertices: number;
  zeroWeightVertices: number;
  averageInfluencesPerVertex: number;
  maxInfluencesPerVertex: number;
  averageWeight?: number;
  maxWeight?: number;
}

export interface AnimationClipInfo {
  name: string;
  duration: number;
  trackCount: number;
  rootMotionTranslation?: number;
  rootMotionRotation?: number;
  rootMotionDetected?: boolean;
  rootMotionDelta?: [number, number, number];
  rootMotionTrackName?: string;
}

export interface AssetSummary {
  fileName: string;
  fileSizeBytes?: number;
  nodeCount: number;
  meshCount: number;
  primitiveCount: number;
  vertexCount: number;
  indexedVertexCount: number;
  triangleCount: number;
  lineCount: number;
  pointCount: number;
  materialCount: number;
  textureCount: number;
  skeletonCount: number;
  boneCount: number;
  skinnedMeshCount: number;
  clipCount: number;
  clips: AnimationClipInfo[];
  boundingBox: BoundingBoxInfo;
}

export type TopologyLocalizationKind =
  | 'degenerate'
  | 'boundary'
  | 'nonManifold'
  | 'isolated'
  | 'tinyComponent'
  | 'thinTriangle'
  | 'duplicatePosition'
  | 'duplicateTriangle';

export interface TopologyLocalizationSample {
  focusPoint: [number, number, number];
  affectedIndices?: number[];
  element: 'triangle' | 'edge' | 'vertex' | 'component';
}

export interface DiagnosticLocation {
  meshUuid: string;
  meshName: string;
  affectedElement: 'triangle' | 'edge' | 'vertex' | 'component';
  affectedIndices?: number[];
  focusPosition: [number, number, number];
}

export interface TopologyStats {
  meshUuid: string;
  meshName: string;
  degenerateTriangles: number;
  degenerateIndices: number[];
  boundaryEdges: number;
  nonManifoldEdges: number;
  isolatedVertices: number;
  componentsCount: number;
  tinyComponentsCount: number;
  thinTriangles: number;
  potentialDuplicatePositions: number;
  duplicateTriangles: number;
  minTriangleArea: number;
  maxTriangleArea: number;
  avgTriangleArea: number;
  denseTrianglesCount: number;
  triangleCount: number;
  vertexCount: number;
  sampleFocusPoints?: Array<[number, number, number]>;
  localization?: Partial<Record<TopologyLocalizationKind, TopologyLocalizationSample>>;
  localizationSamples?: Partial<Record<TopologyLocalizationKind, TopologyLocalizationSample[]>>;
}

export type HealOperationKind =
  | 'remove-degenerate-triangles'
  | 'remove-unreferenced-vertices'
  | 'recalculate-normals'
  | 'merge-exact-duplicate-vertices'
  | 'normalize-skin-weights'
  | 'remove-exact-duplicate-triangles'
  | 'consolidate-duplicate-skin-influences';

export interface HealPreview {
  reasonKey?: string;
  operationId: string;
  operation: HealOperationKind;
  issueId: string;
  meshUuid: string;
  meshName: string;
  status: 'READY' | 'BLOCKED';
  risk: 'CONDITIONAL';
  reason?: string;
  trianglesBefore: number;
  trianglesAfter: number;
  affectedTriangles: number;
  affectedCount: number;
  metric:
    | 'triangles'
    | 'vertices'
    | 'normals'
    | 'duplicates'
    | 'duplicate-triangles'
    | 'weights'
    | 'skin-influences';
  metricBefore: number;
  metricAfter: number;
  verticesBefore?: number;
  verticesAfter?: number;
  affectedVertices?: number;
  boundaryEdgesBefore: number;
  boundaryEdgesAfter: number;
  nonManifoldEdgesBefore: number;
  nonManifoldEdgesAfter: number;
}

export interface HealApplyResult {
  success: boolean;
  reasonKey?: string;
  report?: HealOperationReport;
  operation?: HealOperationKind;
  meshUuid?: string;
  meshName?: string;
  affectedTriangles?: number;
  affectedCount?: number;
  affectedVertices?: number;
  trianglesBefore?: number;
  trianglesAfter?: number;
  reason?: string;
}

export type HealVerificationStatus = 'VERIFIED' | 'PARTIAL' | 'REGRESSION';
export type HealMetrics = Pick<TopologyStats,
  'triangleCount' | 'vertexCount' | 'degenerateTriangles' | 'boundaryEdges' |
  'nonManifoldEdges' | 'isolatedVertices' | 'componentsCount' | 'thinTriangles' |
  'tinyComponentsCount' | 'potentialDuplicatePositions' | 'duplicateTriangles'> & {
    normalCount?: number;
    invalidNormals?: number;
    missingNormals?: number;
    invalidSkinWeights?: number;
    zeroWeightVertices?: number;
    redundantSkinInfluenceVertices?: number;
    /** Deterministic fingerprint used to prove repairs did not retarget skin indices. */
    skinIndexSignature?: string;
  };

/** Serializable audit evidence, never a persisted undo buffer or proof about a newly loaded asset. */
export interface HealOperationReport {
  version: 2;
  operationId: string;
  operation: HealOperationKind;
  assetName: string;
  meshUuid: string;
  meshName: string;
  appliedAt: string;
  undoneAt?: string;
  status: HealVerificationStatus;
  targetStatus: HealVerificationStatus;
  pipeline: 'pending' | 'complete' | 'failed';
  expectedRemoved: number;
  before: HealMetrics;
  after: HealMetrics | null;
  reasons: string[];
}

export type RepairQueueStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'stopped'
  | 'blocked'
  | 'partial'
  | 'regression'
  | 'failed';

export interface RepairQueueRunState {
  status: RepairQueueStatus;
  completed: number;
  skipped: number;
  remaining: number;
  currentOperation?: HealOperationKind;
  currentMeshName?: string;
  stopReason?: string;
}

export interface HealUndoState {
  available: boolean;
  operation?: HealOperationKind;
  meshName?: string;
  affectedTriangles?: number;
  affectedCount?: number;
  affectedVertices?: number;
}

export type ExportVerificationStatus = 'VERIFIED' | 'PARTIAL' | 'REGRESSION' | 'FAILED';

export interface ExportVerificationReport {
  version: 1;
  createdAt: string;
  assetName: string;
  exportedName: string;
  healOperationId: string;
  status: ExportVerificationStatus;
  reasons: string[];
  byteLength: number;
  repairCount: number;
  repairedMeshCount: number;
  triangleCountExpected: number;
  triangleCountActual: number;
  targetTrianglesExpected: number;
  targetTrianglesActual: number;
  targetDegeneratesExpected: number;
  targetDegeneratesActual: number;
  targetVerticesExpected: number;
  targetVerticesActual: number;
  targetUnreferencedExpected: number;
  targetUnreferencedActual: number;
  targetInvalidNormalsExpected: number;
  targetInvalidNormalsActual: number;
  targetDuplicatePositionsExpected: number;
  targetDuplicatePositionsActual: number;
  targetDuplicateTrianglesExpected: number;
  targetDuplicateTrianglesActual: number;
  targetInvalidSkinWeightsExpected: number;
  targetInvalidSkinWeightsActual: number;
  targetRedundantSkinInfluencesExpected: number;
  targetRedundantSkinInfluencesActual: number;
  meshCountExpected: number;
  meshCountActual: number;
  materialCountExpected: number;
  materialCountActual: number;
  textureCountExpected: number;
  textureCountActual: number;
  skinnedMeshCountExpected: number;
  skinnedMeshCountActual: number;
  boneCountExpected: number;
  boneCountActual: number;
  clipCountExpected: number;
  clipCountActual: number;
}

export type RenderMode =
  | 'pbr'
  | 'unlit'
  | 'wireframe'
  | 'wireframe-overlay'
  | 'base-color'
  | 'normals'
  | 'roughness'
  | 'metallic'
  | 'ao'
  | 'emissive'
  | 'uv-checker'
  | 'topology-health'
  | 'triangle-density';

export type LightingPreset =
  | 'neutral-studio'
  | 'soft-studio'
  | 'hard-studio'
  | 'outdoor'
  | 'sunset'
  | 'top-light'
  | 'rim-light'
  | 'dark-studio';

export type SurfaceType =
  | 'none'
  | 'grid'
  | 'grass'
  | 'road'
  | 'sand'
  | 'tile'
  | 'wood'
  | 'cobblestone'
  | 'countryside'
  | 'factory'
  | 'moon';

export interface LightingConfig {
  preset: LightingPreset;
  exposure: number;
  environmentIntensity?: number;
  ambientIntensity?: number;
  keyIntensity: number;
  fillIntensity: number;
  rimIntensity: number;
  keyColor?: string;
  fillColor?: string;
  rimColor?: string;
  keyPosition?: [number, number, number];
  castShadows?: boolean;
  showLightBulb?: boolean;
}
