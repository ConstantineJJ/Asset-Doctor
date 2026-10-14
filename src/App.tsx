import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { TopToolbar } from './components/TopToolbar';
import { SceneTreePanel } from './components/SceneTreePanel';
import { Viewport } from './components/Viewport';
import { InspectorPanel } from './components/InspectorPanel';
import { AnimationTimeline } from './components/AnimationTimeline';
import { RigEditorPanel } from './components/RigEditorPanel';
import {RigJointMenu} from './components/RigJointMenu';
import {RigRemovalDialog} from './components/RigRemovalDialog';
import {RigFittingPanel} from './components/RigFittingPanel';
import {RigFittingService,type FittingReview} from './rig/RigFittingService';
import type {RemovalScope,RemovalSummary} from './rig/RigRemoval';
import {jointDeleteMessage} from './rig/RigMessages';
import type { RigEditSession,RigMode } from './rig/RigEditSession';
import type { RigGizmoSettings } from './rig/RigGizmo';
import { RigExportService,type RigExportResult } from './rig/RigExportService';
import { buildRigExportPacket } from './rig/RigGlbPatch';
import { TopologyTestModal } from './components/TopologyTestModal';
import { SceneManager } from './viewer/SceneManager';
import { GLBLoaderService } from './loaders/GLBLoaderService';
import { createAssetDoctorTestPatient } from './loaders/SampleModels';
import { WorkerManager } from './workers/WorkerManager';
import { HealthEngine } from './health/HealthEngine';
import { useI18n } from './i18n';
import { clearHealReport, readHealReport, saveHealReport } from './heal/HealReportStorage';
import { SurgicalHealEngine } from './heal/SurgicalHealEngine';
import { previewRepairIssueAsync } from './heal/framework/RepairRegistry';
import { buildRepairQueueCandidates } from './heal/RepairQueue';
import { runSafeRepairQueue } from './heal/SafeRepairQueueRunner';
import {
  RepairedExportService,
  type ExportSourceDescriptor,
  type RepairedExportResult,
} from './export/RepairedExportService';
import { analyzeGeometry } from './analysis/GeometryAnalyzer';
import { analyzeIntegrity } from './analysis/IntegrityAnalyzer';
import { analyzeMaterials } from './analysis/MaterialAnalyzer';
import { analyzeTextures } from './analysis/TextureAnalyzer';
import { analyzeSkeleton } from './analysis/SkeletonAnalyzer';
import { analyzeAnimations } from './analysis/AnimationAnalyzer';
import { analyzeAnimationDiagnostics } from './analysis/AnimationDiagnostics';
import { analyzeTransforms } from './analysis/TransformAnalyzer';
import { analyzePerformance } from './analysis/PerformanceAnalyzer';
import { analyzeNormalsAndUv } from './analysis/NormalsAndUvAnalyzer';
import { inspectSkinInfluence } from './analysis/RigInspection';
import { confirmRepairQueue, isDesktop, pickModelFiles, protectDesktopClose,saveBinaryFile } from './platform/FileIO';
import { disposeModelResources } from './loaders/ModelResources';
import type {
  AnimationClipInfo,
  AssetSummary,
  DiagnosticProfileId,
  HealthIssue,
  HealOperationReport,
  HealPreview,
  HealUndoState,
  ExportVerificationReport,
  LightingConfig,
  LightingPreset,
  MaterialInfo,
  ProgressiveAnalysisState,
  RepairQueueRunState,
  RenderMode,
  SceneNodeInfo,
  SkinInfluenceSummary,
  SkinningStats,
  SurfaceType,
  TextureInfo,
  TopologyStats,
} from './types';

type PendingAssetSwitch =
  | { kind: 'file'; file: File }
  | { kind: 'sample'; sampleId: string };

export function App() {
  const { t, language } = useI18n();
  // Scene & Service instances
  const sceneManagerRef = useRef<SceneManager | null>(null);
  const loaderServiceRef = useRef<GLBLoaderService | null>(null);
  const workerManagerRef = useRef<WorkerManager | null>(null);
  const currentAssetRootRef = useRef<THREE.Group | null>(null);
  const currentAnimationClipsRef = useRef<THREE.AnimationClip[]>([]);
  const healEngineRef = useRef<SurgicalHealEngine | null>(null);
  const exportServiceRef = useRef<RepairedExportService | null>(null);
  const currentExportSourceRef = useRef<ExportSourceDescriptor | null>(null);
  const exportResultRef = useRef<RepairedExportResult | null>(null);
  const loadRequestRef = useRef(0);
  const exportRequestRef = useRef(0);
  const exportBusyRef = useRef(false);
  const pickingFileRef = useRef(false);
  const unsavedRepairsRef = useRef(false);
  const rigSessionRef=useRef<RigEditSession|null>(null);
  const rigPublishedRevisionRef=useRef(0);
  const undoOrderRef=useRef<('rig'|'heal')[]>([]);
  const rigUndoingRef=useRef(false);
  const knownHealActionsRef=useRef(new Set<string>());
  const removeUndoDomain=(domain:'rig'|'heal')=>{const index=undoOrderRef.current.lastIndexOf(domain);if(index>=0)undoOrderRef.current.splice(index,1);};
  const rigExportServiceRef=useRef<RigExportService|null>(null);
  if(!rigExportServiceRef.current)rigExportServiceRef.current=new RigExportService();
  const rigExportResultRef=useRef<RigExportResult|null>(null);
  const [rigExportResult,setRigExportResult]=useState<RigExportResult|null>(null);
  const [savedRigExport,setSavedRigExport]=useState<RigExportResult|null>(null);
  const assetDetailsRef=useRef<{name:string;size?:number}>({name:''});
  const [,setRigVersion]=useState(0);
  const [rigError,setRigError]=useState<string|null>(null);
  const [rigDragging,setRigDragging]=useState(false);
  const [rigSettings,setRigSettings]=useState<RigGizmoSettings>({tool:'translate',space:'local',target:'joint',childPolicy:'follow'});
  const [rigContext,setRigContext]=useState<{uuid:string;x:number;y:number}|null>(null);
  const closeRigContext=useCallback(()=>setRigContext(null),[]);
  type RemovalRequest={session:RigEditSession;root:THREE.Group;revision:number;uuid:string;name:string;scope:RemovalScope;summary:RemovalSummary};
  const [pendingRigRemoval,setPendingRigRemoval]=useState<RemovalRequest|null>(null);
  const pendingRigRemovalRef=useRef<RemovalRequest|null>(null);
  const cancelRigRemoval=useCallback(()=>{pendingRigRemovalRef.current=null;setPendingRigRemoval(null);},[]);
  const rigFittingServiceRef=useRef<RigFittingService|null>(null);
  if(!rigFittingServiceRef.current)rigFittingServiceRef.current=new RigFittingService();
  const [fittingReview,setFittingReview]=useState<FittingReview|null>(null),fittingReviewRef=useRef<FittingReview|null>(null);
  const [fittingSelection,setFittingSelection]=useState<Set<string>>(new Set());
  const [fittingBusy,setFittingBusy]=useState(false),fittingBusyRef=useRef(false),fittingRequestRef=useRef(0);
  const [fittingError,setFittingError]=useState<string|null>(null);
  const [appliedFit,setAppliedFit]=useState<{rootUuid:string;revision:number;count:number}|null>(null);
  const discardFitting=useCallback(()=>{
    fittingRequestRef.current++;rigFittingServiceRef.current?.cancel();fittingBusyRef.current=false;setFittingBusy(false);
    fittingReviewRef.current=null;setFittingReview(null);setFittingSelection(new Set());setFittingError(null);sceneManagerRef.current?.setRigFittingPreview([]);
  },[]);
  useEffect(()=>()=>rigFittingServiceRef.current?.cancel(),[]);
  const [savedExport, setSavedExport] = useState<RepairedExportResult | null>(null);
  if (!healEngineRef.current) {
    healEngineRef.current = new SurgicalHealEngine();
  }
  if (!exportServiceRef.current) {
    exportServiceRef.current = new RepairedExportService();
  }

  // App States
  const [isLoading, setIsLoading] = useState(false);
  const [fileName, setFileName] = useState<string>('');
  const [fileSizeBytes, setFileSizeBytes] = useState<number | undefined>(undefined);
  const [pendingAssetSwitch, setPendingAssetSwitch] = useState<PendingAssetSwitch | null>(null);

  // Analysis & Diagnostic States
  const [summary, setSummary] = useState<AssetSummary | null>(null);
  const [treeRoot, setTreeRoot] = useState<SceneNodeInfo | null>(null);
  const [materials, setMaterials] = useState<MaterialInfo[]>([]);
  const [textures, setTextures] = useState<TextureInfo[]>([]);
  const [healthIssues, setHealthIssues] = useState<HealthIssue[]>([]);
  const healthIssuesRef = useRef<HealthIssue[]>([]);
  const [diagnosticProfileId, setDiagnosticProfileId] = useState<DiagnosticProfileId>('general');
  const diagnosticProfileIdRef = useRef<DiagnosticProfileId>('general');
  const analysisRunIdRef = useRef(0);
  const analysisSnapshotRef = useRef<{
    summary: AssetSummary;
    materials: MaterialInfo[];
    textures: TextureInfo[];
    skeleton: ReturnType<typeof analyzeSkeleton>;
    animations: AnimationClipInfo[];
    integrity: HealthIssue[];
    animationDiagnostics: HealthIssue[];
    transforms: HealthIssue[];
    normalsAndUv: HealthIssue[];
    topology: TopologyStats[];
    totalTracks: number;
  } | null>(null);

  const [progressiveState, setProgressiveState] = useState<ProgressiveAnalysisState>({
    geometry: 'pending',
    materials: 'pending',
    textures: 'pending',
    skeleton: 'pending',
    animations: 'pending',
    transforms: 'pending',
    performance: 'pending',
    topology: 'pending',
  });

  // Viewer Config States
  const [renderMode, setRenderMode] = useState<RenderMode>('pbr');
  const [lightingPreset, setLightingPreset] = useState<LightingPreset>('neutral-studio');
  const [lightingConfig, setLightingConfig] = useState<LightingConfig>({
    preset: 'neutral-studio',
    exposure: 1.0,
    ambientIntensity: 0.4,
    keyIntensity: 1.6,
    fillIntensity: 0.6,
    rimIntensity: 1.0,
    keyColor: '#fffbf5',
    fillColor: '#dce5ef',
    rimColor: '#ffffff',
    keyPosition: [5, 8, 5],
    castShadows: true,
    showLightBulb: true,
  });
  const [surface, setSurface] = useState<SurfaceType>('grid');
  const [modelRotation, setModelRotation] = useState<number>(0);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const [autoRotateSpeed, setAutoRotateSpeed] = useState<number>(1.0);
  const [isTreeCollapsed, setIsTreeCollapsed] = useState<boolean>(false);
  const [toggles, setToggles] = useState({
    grid: true,
    axes: true,
    bbox: false,
    skeleton: false,
    origin: true,
  });
  const [explodedAmount, setExplodedAmount] = useState(0);

  // Selection & Tree States
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<SceneNodeInfo | null>(null);
  const [skinningStats, setSkinningStats] = useState<SkinningStats | null>(null);
  const [skinInfluenceSummary, setSkinInfluenceSummary] = useState<SkinInfluenceSummary | null>(null);
  const [skeletonXray, setSkeletonXray] = useState(false);

  // Animation States
  const [animationClips, setAnimationClips] = useState<AnimationClipInfo[]>([]);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [isPlayingAnimation, setIsPlayingAnimation] = useState(false);
  const [animationTime, setAnimationTime] = useState(0);
  const [animationDuration, setAnimationDuration] = useState(0);
  const [animationSpeed, setAnimationSpeed] = useState(1.0);
  const [isLoopingAnimation, setIsLoopingAnimation] = useState(true);
  const [showRootMotion, setShowRootMotion] = useState(false);

  // FPS & Metrics
  const [fps, setFps] = useState(60);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [isIssueFocusActive, setIsIssueFocusActive] = useState(false);
  const [healPreview, setHealPreview] = useState<HealPreview | null>(null);
  const [healUndoState, setHealUndoState] = useState<HealUndoState>({ available: false });

  const [savedHealReport, setSavedHealReport] = useState<HealOperationReport | null>(() => readHealReport());
  const [healReport, setHealReport] = useState<HealOperationReport | null>(null);
  const [healHistorical, setHealHistorical] = useState(false);
  const [healBusy, setHealBusy] = useState(false);
  const healBusyRef = useRef(false);
  const [healError, setHealError] = useState<string | null>(null);
  const [healStorageFailed, setHealStorageFailed] = useState(false);
  const [exportReport, setExportReport] = useState<ExportVerificationReport | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [activeRepairReports, setActiveRepairReports] = useState<HealOperationReport[]>([]);
  const [repairQueueState, setRepairQueueState] = useState<RepairQueueRunState>({
    status: 'idle',
    completed: 0,
    skipped: 0,
    remaining: 0,
  });
  const repairQueueStopRef = useRef(false);
  // React state updates are asynchronous. This ref is the synchronous mutex that
  // prevents a fast double-click from starting two queue runners against the
  // same SurgicalHealEngine preview/apply state.
  const repairQueueRunningRef = useRef(false);
  const repairQueueConfirmingRef = useRef(false);

  // Initialize Loader & Worker Services
  useEffect(() => {
    loaderServiceRef.current = new GLBLoaderService();
    workerManagerRef.current = new WorkerManager();

    return () => {
      loadRequestRef.current++;
      exportRequestRef.current++;
      loaderServiceRef.current?.dispose();
      loaderServiceRef.current = null;
      workerManagerRef.current?.dispose();
      workerManagerRef.current = null;
      healEngineRef.current?.clear();
      exportServiceRef.current?.cancelActive();
      rigExportServiceRef.current?.cancelActive();rigExportResultRef.current=null;
    };
  }, []);

  // Build Scene Hierarchy Tree
  const buildSceneTree = (object: THREE.Object3D): SceneNodeInfo => {
    let type: SceneNodeInfo['type'] = 'Object3D';
    let triangleCount = 0;
    let vertexCount = 0;

    if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
      type = 'SkinnedMesh';
    } else if ((object as THREE.Mesh).isMesh) {
      type = 'Mesh';
    } else if ((object as THREE.Bone).isBone) {
      type = 'Bone';
    } else if ((object as THREE.Group).isGroup) {
      type = 'Group';
    }

    if ((object as THREE.Mesh).isMesh && (object as THREE.Mesh).geometry) {
      const geom = (object as THREE.Mesh).geometry;
      if (geom.index) {
        triangleCount = geom.index.count / 3;
      } else if (geom.attributes.position) {
        triangleCount = geom.attributes.position.count / 3;
      }
      if (geom.attributes.position) {
        vertexCount = geom.attributes.position.count;
      }
    }

    const validChildren = object.children
      .filter((child) => !child.name?.startsWith('__ascope_internal_'))
      .map((child) => buildSceneTree(child));

    return {
      uuid: object.uuid,
      name: object.name || `${type}_${object.id}`,
      type,
      visible: object.visible,
      triangleCount: Math.round(triangleCount),
      vertexCount,
      children: validChildren,
    };
  };

  // Find node by uuid in tree
  const findNodeInTree = (node: SceneNodeInfo | null, uuid: string): SceneNodeInfo | null => {
    if (!node) return null;
    if (node.uuid === uuid) return node;
    for (const child of node.children) {
      const found = findNodeInTree(child, uuid);
      if (found) return found;
    }
    return null;
  };

  const rebuildDiagnosticReport = useCallback(
    (profileId: DiagnosticProfileId, topologyOverride?: TopologyStats[]) => {
      const snapshot = analysisSnapshotRef.current;
      if (!snapshot) return;

      const topology = topologyOverride ?? snapshot.topology;
      const performance = analyzePerformance(
        snapshot.summary,
        snapshot.textures,
        snapshot.totalTracks,
        profileId
      );

      const issues = HealthEngine.aggregate({
        summary: snapshot.summary,
        profileId,
        materials: snapshot.materials,
        textures: snapshot.textures,
        skeleton: snapshot.skeleton,
        animations: snapshot.animations,
        integrity: snapshot.integrity,
        animationDiagnostics: snapshot.animationDiagnostics,
        transforms: snapshot.transforms,
        performance,
        normalsAndUv: snapshot.normalsAndUv,
        topology,
      });

      healthIssuesRef.current = issues;
      setHealthIssues(issues);
    },
    []
  );

  // Profile changes reinterpret Fitness without rerunning expensive topology analysis
  // and without changing the viewport mount callback identity.
  useEffect(() => {
    diagnosticProfileIdRef.current = diagnosticProfileId;
    rebuildDiagnosticReport(diagnosticProfileId);
  }, [diagnosticProfileId, rebuildDiagnosticReport]);

  // Analysis Pipeline Execution
  const runAnalysisPipeline = useCallback(
    async (
      root: THREE.Group,
      clips: THREE.AnimationClip[],
      assetName: string,
      sizeBytes?: number
    ) => {
      const runId = ++analysisRunIdRef.current;
      const yieldAnalysisPhase = async () => {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        return runId === analysisRunIdRef.current;
      };

      setProgressiveState({
        geometry: 'running',
        materials: 'running',
        textures: 'running',
        skeleton: 'running',
        animations: 'running',
        transforms: 'running',
        performance: 'running',
        topology: 'running',
      });

      // 1. Synchronous analysis
      const geomSummary = analyzeGeometry(root, assetName, sizeBytes);
      const mats = analyzeMaterials(root);
      const texs = analyzeTextures(root);
      const skel = analyzeSkeleton(root);
      setSkinningStats(skel);
      const anims = analyzeAnimations(clips, skel.rootBoneNames);
      geomSummary.clipCount=clips.length;
      geomSummary.clips=anims;
      const integrity = analyzeIntegrity(root);
      // Keep each complete diagnostic pass, but give the desktop event loop a
      // turn between buffer scans. A replacement asset invalidates this run.
      if (!await yieldAnalysisPhase()) return false;
      const animationDiagnostics = analyzeAnimationDiagnostics(clips, root);
      const xforms = analyzeTransforms(root);
      const totalTracks = clips.reduce((acc, c) => acc + c.tracks.length, 0);
      const normalsUv = analyzeNormalsAndUv(root);
      if (!await yieldAnalysisPhase()) return false;

      analysisSnapshotRef.current = {
        summary: geomSummary,
        materials: mats,
        textures: texs,
        skeleton: skel,
        animations: anims,
        integrity,
        animationDiagnostics,
        transforms: xforms,
        normalsAndUv: normalsUv,
        topology: [],
        totalTracks,
      };

      setSummary(geomSummary);
      setMaterials(mats);
      setTextures(texs);
      setAnimationClips(anims);

      // Progressive state update for fast passes
      setProgressiveState((prev) => ({
        ...prev,
        geometry: 'done',
        materials: 'done',
        textures: 'done',
        skeleton: 'done',
        animations: 'done',
        transforms: 'done',
        performance: 'done',
      }));

      // Initial Diagnostic Core calculation (without topology yet).
      rebuildDiagnosticReport(diagnosticProfileIdRef.current, []);
      if (!await yieldAnalysisPhase()) return false;

      // 2. Heavy Topology Analysis in Worker
      if (workerManagerRef.current) {
        try {
          const topologyResults: TopologyStats[] = await workerManagerRef.current.analyzeMeshes(
            root
          );

          // A slower previous asset must never overwrite diagnostics for a newer load.
          if (runId !== analysisRunIdRef.current) return false;

          setProgressiveState((prev) => ({ ...prev, topology: 'done' }));

          // Preserve expensive topology results, then reinterpret the full report
          // through the currently selected Diagnostic Profile.
          if (analysisSnapshotRef.current) {
            analysisSnapshotRef.current.topology = topologyResults;
          }
          rebuildDiagnosticReport(diagnosticProfileIdRef.current, topologyResults);
          return true;
        } catch (err) {
          if (runId !== analysisRunIdRef.current) return false;
          console.warn('Topology worker error:', err);
          setProgressiveState((prev) => ({ ...prev, topology: 'error' }));
          rebuildDiagnosticReport(diagnosticProfileIdRef.current);
          const topologyFailure: HealthIssue = {
            id: 'topology-analysis-unknown',
            category: 'Topology',
            severity: 'UNKNOWN',
            layer: 'Health',
            title: 'Topology analysis unavailable',
            description: 'The background topology pass did not complete, so topology health cannot be determined reliably for this asset.',
            evidence: err instanceof Error ? err.message : String(err),
            whyItMatters: 'Asset Doctor should not infer topology health from incomplete data.',
            suggestedAction: 'Retry analysis or inspect the worker error before making topology-related repair decisions.',
            repairability: 'NONE',
          };
          const nextIssues = [
            ...healthIssuesRef.current.filter((issue) => issue.id !== 'topology-analysis-unknown'),
            topologyFailure,
          ];
          healthIssuesRef.current = nextIssues;
          setHealthIssues(nextIssues);
        }
      }
      return false;
    },
    [rebuildDiagnosticReport]
  );

  // Load an Asset (from procedural sample or loaded File)
  const loadAsset = useCallback(
    async (
      root: THREE.Group,
      clips: THREE.AnimationClip[],
      assetName: string,
      sizeBytes?: number,
      exportSource?: ExportSourceDescriptor
    ) => {
      setIsLoading(true);
      assetDetailsRef.current={name:assetName,size:sizeBytes};
      currentAssetRootRef.current = root;
      currentAnimationClipsRef.current = clips;
      currentExportSourceRef.current = exportSource ?? null;
      unsavedRepairsRef.current = false;
      exportResultRef.current = null;
      exportRequestRef.current++;
      setSavedExport(null);
      setExportReport(null);
      setExportError(null);
      healEngineRef.current?.clear();
      exportServiceRef.current?.cancelActive();
      rigExportServiceRef.current?.cancelActive();rigExportResultRef.current=null;setRigExportResult(null);setSavedRigExport(null);
      setActiveRepairReports([]);
      repairQueueStopRef.current = true;
      repairQueueRunningRef.current = false;
      setRepairQueueState({ status: 'idle', completed: 0, skipped: 0, remaining: 0 });
      healthIssuesRef.current = [];
      setHealReport(null);
      setHealHistorical(false);
      setHealError(null);
      setHealPreview(null);
      setHealUndoState({ available: false });
      setFileName(assetName);
      discardFitting();
      setFileSizeBytes(sizeBytes);
      setExplodedAmount(0);
      setSelectedUuid(null);
      setSelectedNode(null);
      setIsIssueFocusActive(false);
      setShowRootMotion(false);

      if (sceneManagerRef.current) {
        sceneManagerRef.current.setRootMotionVisible(false);
        sceneManagerRef.current.setAsset(root, clips);
        rigSessionRef.current=sceneManagerRef.current.rigSession;
        rigPublishedRevisionRef.current=rigSessionRef.current?.revision??0;
        undoOrderRef.current=[];knownHealActionsRef.current.clear();
        currentAnimationClipsRef.current=rigSessionRef.current?.clips??clips;
        setRigError(null);setRigVersion(value=>value+1);
      }

      // Build hierarchy
      const tree = buildSceneTree(root);
      setTreeRoot(tree);

      // Setup animation playback if present
      if (clips.length > 0) {
        setActiveClipIndex(0);
        setAnimationDuration(clips[0].duration);
        setIsPlayingAnimation(true);
      } else {
        setIsPlayingAnimation(false);
        setAnimationTime(0);
        setAnimationDuration(0);
      }

      setIsLoading(false);

      // Trigger progressive background analysis
      await runAnalysisPipeline(root, clips, assetName, sizeBytes);
    },
    [runAnalysisPipeline,discardFitting]
  );

  // Mount an empty viewport. Built-in specimens remain available from Examples.
  const publishRigChange=useCallback(()=>{
    const session=rigSessionRef.current,root=currentAssetRootRef.current;
    if(!session || !root) return;
    setTreeRoot(buildSceneTree(root));setRigVersion(value=>value+1);
    if(rigPublishedRevisionRef.current===session.revision)return;
    discardFitting();
    rigPublishedRevisionRef.current=session.revision;
    if(rigUndoingRef.current)removeUndoDomain('rig');else undoOrderRef.current.push('rig');
    currentAnimationClipsRef.current=session.clips;
    exportRequestRef.current++;exportResultRef.current=null;exportServiceRef.current?.cancelActive();
    setSavedExport(null);setExportReport(null);setExportError(null);
    rigExportServiceRef.current?.cancelActive();rigExportResultRef.current=null;setRigExportResult(null);setSavedRigExport(null);
    unsavedRepairsRef.current=session.hasEdits || (healEngineRef.current?.getActiveReports().length??0)>0;
    setAnimationClips(analyzeAnimations(session.clips,analyzeSkeleton(root).rootBoneNames));
    setActiveClipIndex(index=>Math.min(index,Math.max(0,session.clips.length-1)));
    void runAnalysisPipeline(root,session.clips,assetDetailsRef.current.name,assetDetailsRef.current.size);
  },[runAnalysisPipeline,discardFitting]);
  const handleCanvasMount = useCallback(
    (container: HTMLElement) => {
      if (!sceneManagerRef.current) {
        const mgr = new SceneManager(container, {
          onRigChanged:publishRigChange,
          onRigError:setRigError,
          onRigDrag:(active)=>{setRigDragging(active);if(active)discardFitting();},
          onRigContextMenu:setRigContext,
          onMeshSelected: (uuid) => {
            setSelectedUuid(uuid);
          },
          onAnimationTimeUpdate: (time, duration) => {
            setAnimationTime(time);
            setAnimationDuration(duration);
          },
          onAnimationPlaybackStateChange: (playing) => {
            setIsPlayingAnimation(playing);
          },
          onLightingChange: (updatedConfig) => {
            setLightingConfig((prev) => ({ ...prev, ...updatedConfig }));
          },
          onModelRotationChange: (deg) => {
            setModelRotation(deg);
          },
        });
        sceneManagerRef.current = mgr;
        loaderServiceRef.current?.configureRenderer(mgr.renderer);

        // FPS polling
        const fpsInterval = setInterval(() => {
          if (sceneManagerRef.current) {
            setFps(sceneManagerRef.current.fps);
          }
        }, 500);

        return () => {
          clearInterval(fpsInterval);
          if (sceneManagerRef.current === mgr) {
            mgr.dispose();
            sceneManagerRef.current = null;
          }
        };
      }
    },
    []
  );

  // Update selectedNode state when selectedUuid changes
  useEffect(() => {
    if (selectedUuid && treeRoot) {
      setSelectedNode(findNodeInTree(treeRoot, selectedUuid));
    } else {
      setSelectedNode(null);
    }

    const root = currentAssetRootRef.current;
    setSkinInfluenceSummary(root ? inspectSkinInfluence(root, selectedUuid) : null);
  }, [selectedUuid, treeRoot]);

  // File Handlers
  const openFileNow = async (file: File) => {
    if (!loaderServiceRef.current) return;
    const request = ++loadRequestRef.current;
    const repairRevision = exportRequestRef.current;
    try {
      setIsLoading(true);
      const result = await loaderServiceRef.current.loadFromFile(file);
      if (request !== loadRequestRef.current) {
        disposeModelResources(result.root);
        return;
      }
      if (unsavedRepairsRef.current && repairRevision !== exportRequestRef.current) {
        disposeModelResources(result.root);
        setIsLoading(false);
        setPendingAssetSwitch({ kind: 'file', file });
        return;
      }
      await loadAsset(
        result.root,
        result.animations,
        result.fileName,
        result.fileSizeBytes,
        result.sourceBuffer
          ? { kind: 'buffer', fileName: result.fileName, buffer: result.sourceBuffer }
          : undefined
      );
    } catch (err) {
      if (request !== loadRequestRef.current) return;
      alert(`Error loading 3D file: ${err instanceof Error ? err.message : String(err)}`);
      setIsLoading(false);
    }
  };

  const selectSampleNow = async (sampleId: string) => {
    if (sampleId !== 'test-patient') return;
    loadRequestRef.current++;
    const sample = createAssetDoctorTestPatient();
    await loadAsset(
      sample.root,
      sample.animations,
      'Asset_Doctor_Test_Patient.glb',
      1024 * 180,
      { kind: 'sample', sampleId: 'test-patient' }
    );
  };

  // Viewport Controls Handlers
  const handleSetRenderMode = (mode: RenderMode) => {
    setRenderMode(mode);
    sceneManagerRef.current?.setRenderMode(mode);
  };

  const handleSetLightingPreset = (preset: LightingPreset) => {
    setLightingPreset(preset);
    sceneManagerRef.current?.setLightingPreset(preset);
  };

  const handleSetSurface = (nextSurface: SurfaceType) => {
    setSurface(nextSurface);
    sceneManagerRef.current?.setSurface(nextSurface);
  };

  const handleSetModelRotation = (deg: number) => {
    setModelRotation(deg);
    sceneManagerRef.current?.setModelRotation(deg);
  };

  const handleToggleAutoRotate = () => {
    const next = !autoRotate;
    setAutoRotate(next);
    sceneManagerRef.current?.setAutoRotate(next, autoRotateSpeed);
  };

  const handleSetAutoRotateSpeed = (speed: number) => {
    setAutoRotateSpeed(speed);
    sceneManagerRef.current?.setAutoRotate(autoRotate, speed);
  };

  const handleToggleTreeCollapse = () => {
    setIsTreeCollapsed((prev) => !prev);
    requestAnimationFrame(() => {
      sceneManagerRef.current?.resize();
    });
  };

  useEffect(() => {
    sceneManagerRef.current?.resize();
    const t1 = setTimeout(() => sceneManagerRef.current?.resize(), 40);
    const t2 = setTimeout(() => sceneManagerRef.current?.resize(), 220);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isTreeCollapsed]);

  const handleUpdateLighting = (config: Partial<LightingConfig>) => {
    setLightingConfig((prev) => ({ ...prev, ...config }));
    sceneManagerRef.current?.updateLightingConfig(config);
  };

  const handleToggleHelper = (helper: 'grid' | 'axes' | 'bbox' | 'skeleton' | 'origin') => {
    if (!sceneManagerRef.current) return;
    setToggles((prev) => {
      const next = { ...prev, [helper]: !prev[helper] };
      if (helper === 'grid') sceneManagerRef.current?.toggleGrid(next.grid);
      if (helper === 'axes') sceneManagerRef.current?.toggleAxes(next.axes);
      if (helper === 'bbox') sceneManagerRef.current?.toggleBbox(next.bbox);
      if (helper === 'skeleton') {
        sceneManagerRef.current?.toggleSkeleton(next.skeleton);
        setSkeletonXray(next.skeleton);
      }
      if (helper === 'origin') sceneManagerRef.current?.toggleOrigin(next.origin);
      return next;
    });
  };

  const handleSetExplodedAmount = (amount: number) => {
    setExplodedAmount(amount);
    sceneManagerRef.current?.setExplodedAmount(amount);
  };

  const handleSetSkeletonVisible = (visible: boolean) => {
    setToggles((prev) => ({ ...prev, skeleton: visible }));
    setSkeletonXray(visible);
    sceneManagerRef.current?.toggleSkeleton(visible);
  };

  const handleSetSkeletonXray = (enabled: boolean) => {
    setSkeletonXray(enabled);
    if (enabled) {
      setToggles((prev) => ({ ...prev, skeleton: true }));
      sceneManagerRef.current?.toggleSkeleton(true);
    }
    sceneManagerRef.current?.setSkeletonXray(enabled);
  };

  const handleResetPreviewPose = () => {
    sceneManagerRef.current?.resetPreviewPose();
    setIsPlayingAnimation(false);
    setAnimationTime(0);
  };

  const handleIsolateSelectedSkinnedMesh = () => {
    if (!selectedNode || selectedNode.type !== 'SkinnedMesh') return;
    handleIsolateNode(selectedNode.uuid);
  };

  // Camera Handlers
  const handleFrameAll = () => {
    if (currentAssetRootRef.current && sceneManagerRef.current) {
      sceneManagerRef.current.cameraController.frameObject(currentAssetRootRef.current);
    }
  };

  const handleFocusSelected = () => {
    sceneManagerRef.current?.focusSelected();
  };

  const handleFrameRawBounds = () => {
    sceneManagerRef.current?.frameRawBounds();
  };

  const handleResetCamera = (preset: 'perspective' | 'front' | 'top' | 'right') => {
    sceneManagerRef.current?.cameraController.setViewPreset(preset);
  };

  // Scene Tree Handlers
  const handleSelectNode = (uuid: string) => {
    sceneManagerRef.current?.cancelIssueInspection();
    setIsIssueFocusActive(false);
    setSelectedUuid(uuid);
    sceneManagerRef.current?.selectObject(uuid);
  };

  const handleToggleVisibility = (uuid: string) => {
    sceneManagerRef.current?.toggleObjectVisibility(uuid);
    if (currentAssetRootRef.current) {
      setTreeRoot(buildSceneTree(currentAssetRootRef.current));
    }
  };

  const handleIsolateNode = (uuid: string) => {
    sceneManagerRef.current?.isolateObject(uuid);
    if (currentAssetRootRef.current) {
      setTreeRoot(buildSceneTree(currentAssetRootRef.current));
    }
  };

  const handleShowAll = () => {
    sceneManagerRef.current?.showAllObjects();
    if (currentAssetRootRef.current) {
      setTreeRoot(buildSceneTree(currentAssetRootRef.current));
    }
  };

  const handleFocusNode = (uuid: string) => {
    handleSelectNode(uuid);
    sceneManagerRef.current?.focusSelected();
  };

  // Health Issue Focus Handler
  const handleFocusIssue = (issue: HealthIssue) => {
    if (!sceneManagerRef.current) return;

    if (issue.meshUuid) {
      setSelectedUuid(issue.meshUuid);
    }
    sceneManagerRef.current.localizeIssue(issue);
    setIsIssueFocusActive(true);
  };

  const handleRestoreIssueView = () => {
    sceneManagerRef.current?.restoreIssueView();
    setIsIssueFocusActive(false);
  };

  // Surgical Heal v0.2
  const refreshAfterHeal = async () => {
    const root = currentAssetRootRef.current;
    if (!root) return;

    sceneManagerRef.current?.cancelIssueInspection();
    setIsIssueFocusActive(false);
    sceneManagerRef.current?.selectObject(null);
    setSelectedUuid(null);
    setSelectedNode(null);
    setTreeRoot(buildSceneTree(root));

    return await runAnalysisPipeline(
      root,
      currentAnimationClipsRef.current,
      fileName,
      fileSizeBytes
    );
  };

  const handlePreviewHeal = async (issue: HealthIssue) => {
    const root = currentAssetRootRef.current;
    const engine = healEngineRef.current;
    if (!root || !engine || healBusyRef.current) return;

    healBusyRef.current=true;setHealBusy(true);
    try {
    const preview = await previewRepairIssueAsync(engine, root, issue);
    if(root!==currentAssetRootRef.current)return;
    if (!preview) return;

    setHealPreview(preview);

    if (preview.status === 'READY') {
      handleFocusIssue(issue);
    }
    } catch(error) {
      if(root===currentAssetRootRef.current && (error as Error)?.name!=='AbortError')setHealError(t('heal.errors.operationFailed'));
    } finally {healBusyRef.current=false;setHealBusy(false);}
  };

  const handleCancelHealPreview = () => {
    healEngineRef.current?.cancelPreview();
    setHealPreview(null);
  };

  const publishHealReport = (engine: SurgicalHealEngine) => {
    const report = engine.getLastOperation();
    if (!report) return;
    discardFitting();
    setHealReport(report);
    setSavedHealReport(report);
    setHealHistorical(false);
    const activeReports = engine.getActiveReports();
    for(const active of activeReports)if(!knownHealActionsRef.current.has(active.operationId)){knownHealActionsRef.current.add(active.operationId);undoOrderRef.current.push('heal');}
    if(report.undoneAt&&knownHealActionsRef.current.delete(report.operationId))removeUndoDomain('heal');
    unsavedRepairsRef.current = activeReports.length > 0 || Boolean(rigSessionRef.current?.hasEdits);
    setActiveRepairReports(activeReports);
    setHealStorageFailed(!saveHealReport(report));
  };

  const performHeal = async (undo: boolean): Promise<HealOperationReport | null> => {
    if(fittingBusyRef.current)return null;
    const root = currentAssetRootRef.current;
    const engine = healEngineRef.current;
    if (!root || !engine || healBusyRef.current) return null;
    if(!undo&&rigSessionRef.current?.hasJointIndexEdits) {
      setHealError(language==='ru'?'Сначала сохраните и заново откройте GLB после удаления сустава.':'Export and reimport the GLB after joint deletion before applying repairs.');return null;
    }
    healBusyRef.current = true;
    setHealBusy(true);
    setHealError(null);
    exportResultRef.current = null;
    exportServiceRef.current?.cancelActive();
    rigExportServiceRef.current?.cancelActive();rigExportResultRef.current=null;setRigExportResult(null);setSavedRigExport(null);
    exportRequestRef.current++;
    setSavedExport(null);
    setExportReport(null);
    setExportError(null);
    try {
      const result = undo ? engine.undoLast(root) : await engine.applyPendingAsync(root, fileName);
      if(currentAssetRootRef.current!==root)return null;
      if (!result.success) {
        const reason = result.reasonKey ? t(result.reasonKey) : result.reason ?? t('heal.blocked');
        if (undo) setHealError(reason);
        else setHealPreview(previous => previous ? { ...previous, status: 'BLOCKED', reason, reasonKey: result.reasonKey } : null);
        return null;
      }

      setHealPreview(null);
      setHealUndoState(engine.getUndoState());
      publishHealReport(engine);

      await new Promise<void>(resolve=>setTimeout(resolve,0));
      if(currentAssetRootRef.current!==root)return null;
      let complete = false;
      try {
        complete = (await refreshAfterHeal()) === true;
      } catch {
        // Preserve measured evidence and Undo if the broader pipeline fails.
      }

      // An old analysis completion must never certify or overwrite a newer asset/report.
      if (currentAssetRootRef.current !== root) return null;

      if (!undo && result.report) engine.completeVerification(result.report.operationId, complete);
      if (undo && !complete) setHealError(t('heal.errors.undoAnalysis'));
      publishHealReport(engine);
      return engine.getLastOperation();
    } catch {
      if (currentAssetRootRef.current === root) setHealError(t('heal.errors.operationFailed'));
      return null;
    } finally {
      healBusyRef.current = false;
      setHealBusy(false);
    }
  };

  const handleApplyHeal = () => { void performHeal(false); };
  const handleUndoHeal = () => {
    repairQueueStopRef.current = true;
    void performHeal(true);
  };

  const handleShowHealHistory = () => {
    if (!savedHealReport) return;
    setHealReport(savedHealReport);
    setHealHistorical(true);
    setHealError(null);
  };

  const handleDismissHealReport = () => {
    setHealReport(null);
    setHealHistorical(false);
    setHealError(null);
  };

  const handleClearHealHistory = () => {
    const cleared = clearHealReport();
    setHealStorageFailed(!cleared);
    setSavedHealReport(null);
    if (healHistorical) {
      setHealReport(null);
      setHealHistorical(false);
    }
  };

  const handleRescan = async () => {
    const root = currentAssetRootRef.current;
    if (!root || isLoading || healBusyRef.current || repairQueueState.status === 'running') return;
    setHealError(null);
    await runAnalysisPipeline(root, currentAnimationClipsRef.current, fileName, fileSizeBytes);
    setTreeRoot(buildSceneTree(root));
  };

  const handlePreviewNextRepairQueue = async () => {
    const root = currentAssetRootRef.current;
    const engine = healEngineRef.current;
    if (!root || !engine || healBusyRef.current || repairQueueState.status === 'running') return;

    healBusyRef.current=true;setHealBusy(true);
    try {
    const candidates = buildRepairQueueCandidates(healthIssuesRef.current);
    for (const candidate of candidates) {
      const preview = await previewRepairIssueAsync(engine, root, candidate.issue);
      if(root!==currentAssetRootRef.current)return;
      if (!preview) continue;
      setHealPreview(preview);
      if (preview.status === 'READY') {
        handleFocusIssue(candidate.issue);
        return;
      }
    }
    } catch(error) {
      if(root===currentAssetRootRef.current && (error as Error)?.name!=='AbortError')setHealError(t('heal.errors.operationFailed'));
    } finally {healBusyRef.current=false;setHealBusy(false);}
  };

  const handleStopRepairQueue = () => {
    if (!repairQueueRunningRef.current && repairQueueState.status !== 'running') return;
    repairQueueStopRef.current = true;
    if(!healBusyRef.current)healEngineRef.current?.cancelPreview();
    setRepairQueueState((previous) => ({
      ...previous,
      stopReason: t('heal.queue.stopRequested'),
    }));
  };

  const handleRunSafeRepairQueue = async () => {
    const root = currentAssetRootRef.current;
    const engine = healEngineRef.current;
    if (
      !root ||
      !engine ||
      healBusyRef.current ||
      fittingBusyRef.current ||
      repairQueueConfirmingRef.current ||
      repairQueueRunningRef.current ||
      repairQueueState.status === 'running'
    ) return;

    const initialCandidates = buildRepairQueueCandidates(healthIssuesRef.current);
    if (initialCandidates.length === 0) {
      setRepairQueueState({
        status: 'completed',
        completed: 0,
        skipped: 0,
        remaining: 0,
        stopReason: t('heal.queue.noCandidates'),
      });
      return;
    }

    const analysisRevision = analysisRunIdRef.current;
    const repairRevision = exportRequestRef.current;
    repairQueueConfirmingRef.current = true;
    let confirmed = false;
    try {
      confirmed = await confirmRepairQueue(t('heal.queue.confirm', { count: initialCandidates.length }));
    } catch {
      if (currentAssetRootRef.current === root && analysisRunIdRef.current === analysisRevision &&
          exportRequestRef.current === repairRevision) {
        setRepairQueueState({ status: 'failed', completed: 0, skipped: 0,
          remaining: initialCandidates.length, stopReason: t('heal.queue.confirmFailed') });
      }
      return;
    } finally {
      repairQueueConfirmingRef.current = false;
    }

    // A native dialog awaits asynchronously. Approval of an old asset/analysis
    // must not authorize the current session, and two clicks must not open two dialogs.
    if (confirmed !== true || currentAssetRootRef.current !== root ||
        analysisRunIdRef.current !== analysisRevision || exportRequestRef.current !== repairRevision ||
        repairQueueRunningRef.current || healBusyRef.current) return;
    repairQueueRunningRef.current = true;
    repairQueueStopRef.current = false;

    setRepairQueueState({
      status: 'running',
      completed: 0,
      skipped: 0,
      remaining: initialCandidates.length,
    });

    const stopReasonFor = (code: string | undefined) => {
      switch (code) {
        case 'complete': return t('heal.queue.complete');
        case 'completeWithSkipped': return t('heal.queue.completeWithSkipped');
        case 'stoppedByUser': return t('heal.queue.stoppedByUser');
        case 'assetChanged': return t('heal.queue.assetChanged');
        case 'targetReturned': return t('heal.queue.targetReturned');
        case 'applyFailed': return t('heal.queue.applyFailed');
        case 'regressionStop': return t('heal.queue.regressionStop');
        case 'partialStop': return t('heal.queue.partialStop');
        case 'guardStop': return t('heal.queue.guardStop');
        default: return undefined;
      }
    };

    try {
      const outcome = await runSafeRepairQueue(
        {
          getCandidates: () => buildRepairQueueCandidates(healthIssuesRef.current),
          preview: (candidate) => previewRepairIssueAsync(engine, root, candidate.issue),
          apply: async (_candidate, preview) => {
            setHealPreview(preview);
            return await performHeal(false);
          },
          shouldStop: () => repairQueueStopRef.current,
          assetStillCurrent: () => currentAssetRootRef.current === root,
          yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
        },
        (progress) => {
          setRepairQueueState({
            status: progress.status,
            completed: progress.completed,
            skipped: progress.skipped,
            remaining: progress.remaining,
            currentOperation: progress.currentOperation,
            currentMeshName: progress.currentMeshName,
          });
        }
      );

      setRepairQueueState({
        status: outcome.status,
        completed: outcome.completed,
        skipped: outcome.skipped,
        remaining: outcome.remaining,
        currentOperation: outcome.currentOperation,
        currentMeshName: outcome.currentMeshName,
        stopReason: stopReasonFor(outcome.stopCode),
      });
    } finally {
      repairQueueRunningRef.current = false;
    }
  };

  // Export Repaired Copy v0.1
  const handleBuildRepairedExport = async (): Promise<RepairedExportResult | null> => {
    if(rigSessionRef.current?.hasEdits) {await handleRigExport(false);return null;}
    const root = currentAssetRootRef.current;
    const source = currentExportSourceRef.current;
    const engine = healEngineRef.current;
    const service = exportServiceRef.current;
    if (!root || !source || !engine || !service || exportBusyRef.current || healBusyRef.current || repairQueueRunningRef.current) {
      setExportError(t('export.errors.unavailable'));
      return null;
    }

    const preflight = engine.validateCurrentVerifiedSession(root);
    if (!preflight.ok || preflight.reports.length === 0) {
      setExportError(t(preflight.reasonKey ?? 'export.errors.unavailable'));
      return null;
    }

    setExportBusy(true);
    exportBusyRef.current = true;
    const request = ++exportRequestRef.current;
    setExportError(null);
    exportResultRef.current = null;
    setExportReport(null);

    try {
      const result = await service.exportAndVerifyInWorker({
        source,
        currentRoot: root,
        assetName: fileName,
        healReports: preflight.reports,
      });

      if (request !== exportRequestRef.current || root !== currentAssetRootRef.current) return null;

      exportResultRef.current = result;
      setExportReport(result.report);

      if (result.report.status !== 'VERIFIED') {
        setExportError(t('export.errors.verificationFailed'));
        return null;
      }
      return result;
    } catch (error) {
      if (request !== exportRequestRef.current) return null;
      const key = error instanceof Error ? error.message : 'export.errors.failed';
      setExportError(t(key.startsWith('export.') ? key : 'export.errors.failed'));
      return null;
    } finally {
      exportBusyRef.current = false;
      setExportBusy(false);
    }
  };

  const saveRepairedExport = async (result: RepairedExportResult): Promise<boolean> => {
    const service = exportServiceRef.current;
    if (!service || exportBusyRef.current || exportResultRef.current !== result) return false;
    exportBusyRef.current = true;
    setExportBusy(true);
    setExportError(null);
    try {
      const saved = await service.download(result,()=>exportResultRef.current===result);
      // A save dialog can stay open while Undo or another asset invalidates it.
      if (!saved || exportResultRef.current !== result) return false;
      unsavedRepairsRef.current = false;
      setSavedExport(result);
      return true;
    } catch (error) {
      setExportError(`${t('export.errors.saveFailed')}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      exportBusyRef.current = false;
      setExportBusy(false);
    }
  };

  const handleDownloadRepairedExport = async () => {
    const result = exportResultRef.current;
    if (!result || result.report.status !== 'VERIFIED') return;
    await saveRepairedExport(result);
  };

  const handleToolbarExport = async () => {
    if(rigSessionRef.current?.hasEdits) {await handleRigExport(true);return;}
    const service = exportServiceRef.current;
    if (!service || exportBusy) return;

    const cached = exportResultRef.current;
    if (cached?.report.status === 'VERIFIED') {
      await saveRepairedExport(cached);
      return;
    }

    const result = await handleBuildRepairedExport();
    if (result?.report.status === 'VERIFIED') {
      await saveRepairedExport(result);
    }
  };

  const handleRigExport=async(save:boolean):Promise<boolean>=>{
    const session=rigSessionRef.current,source=currentExportSourceRef.current,root=currentAssetRootRef.current;
    if(!session || !root || source?.kind!=='buffer' || exportBusyRef.current || healBusyRef.current || repairQueueRunningRef.current || rigDragging||fittingBusyRef.current)return false;
    exportBusyRef.current=true;setExportBusy(true);setRigError(null);
    const request=++exportRequestRef.current,revision=session.revision;
    const current=()=>request===exportRequestRef.current && root===currentAssetRootRef.current && session===rigSessionRef.current && session.revision===revision;
    try {
      const engine=healEngineRef.current!,reports=engine.getActiveReports();
      if(reports.length&&!engine.validateCurrentVerifiedSession(root).ok)throw new Error('Repair session is no longer verified.');
      let result=rigExportResultRef.current;
      if(result&&!result.stillCurrent())result=null;
      if(!result || result.revision!==revision) {
        result=await rigExportServiceRef.current!.export(session,source.buffer,fileName,reports,mesh=>sceneManagerRef.current!.renderModeManager.authoredGeometry(mesh));
        if(!current())return false;
        rigExportResultRef.current=result;setRigExportResult(result);
      }
      if(result.verification.status!=='VERIFIED') {setRigError(result.verification.reasons.join('; '));return false;}
      if(!save)return true;
      if(!(await saveBinaryFile(result.fileName,result.buffer,()=>current()&&rigExportResultRef.current===result&&result!.stillCurrent())))return false;
      if(!current())return false;
      setSavedRigExport(result);unsavedRepairsRef.current=false;return true;
    } catch(error) {if(current())setRigError(error instanceof Error?error.message:String(error));return false;}
    finally {exportBusyRef.current=false;setExportBusy(false);}
  };

  const canExportRepaired = Boolean(
    !rigSessionRef.current?.hasEdits &&
    !healBusy && repairQueueState.status !== 'running' &&
    activeRepairReports.length > 0 &&
    activeRepairReports.every(
      (report) => report.status === 'VERIFIED' && report.pipeline === 'complete' && !report.undoneAt
    ) &&
    currentExportSourceRef.current
  );
  const hasUnsavedRepairs = Boolean(
    (activeRepairReports.length > 0 || rigSessionRef.current?.hasEdits) &&
    (!savedExport || savedExport !== exportResultRef.current) &&
    (!savedRigExport || savedRigExport!==rigExportResultRef.current)
  );
  unsavedRepairsRef.current = hasUnsavedRepairs;
  useEffect(()=>{sceneManagerRef.current?.setRigInteractionBlocked(healBusy||exportBusy||fittingBusy||repairQueueState.status==='running'||Boolean(pendingRigRemoval));},[healBusy,exportBusy,fittingBusy,repairQueueState.status,pendingRigRemoval]);
  useEffect(()=>{sceneManagerRef.current?.setRigFittingPreview(fittingReview?.proposals.filter(proposal=>proposal.status==='suggested'&&(!fittingSelection.size||fittingSelection.has(proposal.uuid)))??[]);},[fittingReview,fittingSelection]);

  const runAssetSwitch = async (pending: PendingAssetSwitch) => {
    if (pending.kind === 'file') await openFileNow(pending.file);
    else await selectSampleNow(pending.sampleId);
  };

  const requestOpenFile = (file: File) => {
    if (unsavedRepairsRef.current) {
      loadRequestRef.current++;
      setIsLoading(false);
      setPendingAssetSwitch({ kind: 'file', file });
      return;
    }
    void openFileNow(file);
  };

  const handlePickFile = async () => {
    if (pickingFileRef.current) return;
    pickingFileRef.current = true;
    try {
      const [file] = await pickModelFiles();
      if (file) requestOpenFile(file);
    } catch (error) {
      alert(`${language === 'ru' ? 'Не удалось открыть файл' : 'Could not open file'}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      pickingFileRef.current = false;
    }
  };

  const requestSelectSample = (sampleId: string) => {
    if (unsavedRepairsRef.current) {
      loadRequestRef.current++;
      setIsLoading(false);
      setPendingAssetSwitch({ kind: 'sample', sampleId });
      return;
    }
    void selectSampleNow(sampleId);
  };

  const handleDiscardAndSwitch = async () => {
    const pending = pendingAssetSwitch;
    if (!pending) return;
    setPendingAssetSwitch(null);
    await runAssetSwitch(pending);
  };

  const handleExportAndSwitch = async () => {
    const pending = pendingAssetSwitch;
    const service = exportServiceRef.current;
    if (!pending || !service || !(canExportRepaired||rigSessionRef.current?.hasEdits) || exportBusy) return;
    if(rigSessionRef.current?.hasEdits) {
      if(!await handleRigExport(true))return;
      setPendingAssetSwitch(null);await runAssetSwitch(pending);return;
    }

    const result = await handleBuildRepairedExport();
    if (!result || result.report.status !== 'VERIFIED') return;
    if (!(await saveRepairedExport(result))) return;
    setPendingAssetSwitch(null);
    await runAssetSwitch(pending);
  };

  // Browser close/reload cannot offer our three-button modal, but it can still
  // prevent silent loss and hand the final decision back to the user.
  useEffect(() => {
    if (!hasUnsavedRepairs) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedRepairs]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void protectDesktopClose(
      () => unsavedRepairsRef.current,
      language === 'ru' ? 'Есть несохранённые изменения. Закрыть окно и потерять их?' : 'There are unsaved changes. Close the window and discard them?'
    ).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    }).catch((error) => console.error('Could not register desktop close protection:', error));
    return () => { disposed = true; unlisten?.(); };
  }, [language]);

  // Animation Handlers
  const handleSelectClip = (idx: number) => {
    if (!Number.isInteger(idx) || idx < 0 || idx >= animationClips.length) return;
    const manager = sceneManagerRef.current;
    if (!manager || rigDragging || healBusyRef.current || exportBusyRef.current || !manager.selectAnimationClip(idx)) return;

    setActiveClipIndex(idx);
    setAnimationTime(0);
    setAnimationDuration(animationClips[idx]?.duration ?? 0);
    setIsPlayingAnimation(rigSessionRef.current?.mode!=='edit');
  };

  const handleTogglePlayAnimation = () => {
    if(rigSessionRef.current?.mode==='edit' || rigDragging) return;
    const next = !isPlayingAnimation;
    setIsPlayingAnimation(next);
    sceneManagerRef.current?.toggleAnimationPlay(next);
  };

  const handleStopAnimation = () => {
    setIsPlayingAnimation(false);
    sceneManagerRef.current?.stopAnimation();
    setAnimationTime(0);
  };

  const handleSeekAnimation = (normalized: number) => {
    if(rigSessionRef.current?.mode==='edit' || rigDragging) return;
    const clamped = Math.min(1, Math.max(0, normalized));
    setAnimationTime(clamped * animationDuration);
    sceneManagerRef.current?.seekAnimation(clamped);
  };

  const handleStepFrame = (forward: boolean) => {
    setIsPlayingAnimation(false);
    sceneManagerRef.current?.stepAnimationFrame(forward ? 1 / 30 : -1 / 30);
  };

  const handleSetSpeed = (s: number) => {
    setAnimationSpeed(s);
    sceneManagerRef.current?.setAnimationSpeed(s);
  };

  const handleToggleLoop = () => {
    const next = !isLoopingAnimation;
    setIsLoopingAnimation(next);
    sceneManagerRef.current?.setAnimationLoop(next);
  };

  const handleToggleRootMotion = () => {
    const next = !showRootMotion;
    setShowRootMotion(next);
    sceneManagerRef.current?.setRootMotionVisible(next);
  };

  const handleRigAction=(action:(session:RigEditSession)=>void,undo=false)=>{
    const session=rigSessionRef.current;
    if(!session||pendingRigRemovalRef.current||fittingBusyRef.current||rigDragging||healBusyRef.current||exportBusyRef.current||repairQueueRunningRef.current)return;
    setRigContext(null);setRigError(null);sceneManagerRef.current?.detachRigMixer();rigUndoingRef.current=undo;
    try {action(session);sceneManagerRef.current?.refreshRigStructure();sceneManagerRef.current?.syncRigClips();publishRigChange();}
    catch(error){sceneManagerRef.current?.syncRigClips();setRigError(jointDeleteMessage(error instanceof Error?error.message:String(error),language));}
    finally {rigUndoingRef.current=false;}
  };
  const handleUndoRig=()=>handleRigAction(session=>session.undo(),true);
  const handleAnalyzeFitting=async()=>{
    const session=rigSessionRef.current,root=currentAssetRootRef.current,manager=sceneManagerRef.current;
    if(!session||!root||!manager||fittingBusyRef.current||pendingRigRemovalRef.current||rigDragging||healBusyRef.current||exportBusyRef.current||repairQueueRunningRef.current)return;
    if(currentExportSourceRef.current?.kind!=='buffer'||!/\.glb$/i.test(fileName)){setFittingError(language==='ru'?'Откройте самодостаточный GLB.':'Open a self-contained GLB.');return;}
    if(healEngineRef.current?.getActiveReports().length){setFittingError(language==='ru'?'Сначала сохраните и заново откройте проверенный ремонт.':'Save and reimport verified repairs before fitting.');return;}
    discardFitting();const request=++fittingRequestRef.current;fittingBusyRef.current=true;setFittingBusy(true);
    try {
      const review=await rigFittingServiceRef.current!.analyze(session,mesh=>manager.renderModeManager.authoredGeometry(mesh));
      if(request!==fittingRequestRef.current||session!==rigSessionRef.current||root!==currentAssetRootRef.current)return;
      fittingReviewRef.current=review;setFittingReview(review);
    }catch(error){if(request===fittingRequestRef.current)setFittingError(error instanceof Error?error.message:String(error));}
    finally{if(request===fittingRequestRef.current){fittingBusyRef.current=false;setFittingBusy(false);}}
  };
  const handleApplyFitting=()=>{
    const review=fittingReviewRef.current;
    if(!review||!review.stillCurrent()){discardFitting();setFittingError(language==='ru'?'Предложения устарели. Выполните анализ снова.':'Proposals are stale. Analyze again.');return;}
    const positions=review.proposals.filter(proposal=>proposal.status==='suggested'&&fittingSelection.has(proposal.uuid)).map(proposal=>({uuid:proposal.uuid,position:proposal.target}));
    if(!positions.length)return;
    const session=rigSessionRef.current!,revision=session.revision;
    handleRigAction(session=>session.applyFittingPositions(positions));
    if(session.revision>revision)setAppliedFit({rootUuid:session.root.uuid,revision:session.revision,count:positions.length});
  };
  const handleRigMode=(mode:RigMode)=>{
    if(fittingBusyRef.current)return;
    discardFitting();
    setRigError(null);setRigContext(null);
    try {
      const source=currentExportSourceRef.current,session=rigSessionRef.current;
      if(mode==='edit'&&session&&source?.kind==='buffer')buildRigExportPacket(session,source.buffer,healEngineRef.current?.getActiveReports(),mesh=>sceneManagerRef.current!.renderModeManager.authoredGeometry(mesh));
      sceneManagerRef.current?.setRigMode(mode);setRigVersion(value=>value+1);if(mode!=='inspect')handleSetSkeletonVisible(true);
    }catch(error){setRigError(error instanceof Error?error.message:String(error));}
  };
  const handleAddJoint=(uuid=selectedUuid)=>{
    setRigContext(null);if(!uuid)return;
    handleRigAction(session=>{const added=session.addJoint(uuid);sceneManagerRef.current?.selectObject(added);});
  };
  const validateRemovalContext=()=>{
      if(healEngineRef.current?.getActiveReports().length)throw new Error('Export and reimport verified repairs before deleting a joint.');
      const manager=sceneManagerRef.current!,root=currentAssetRootRef.current!;
      let presentationGeometry=false;root.traverse(node=>{if(node instanceof THREE.Mesh&&manager.renderModeManager.authoredGeometry(node)!==node.geometry)presentationGeometry=true;});
      if(presentationGeometry)throw new Error('Return to Hybrid shading before deleting a joint.');
  };
  const handleDeleteJoint=(uuid=selectedUuid,scope:RemovalScope='joint')=>{
    setRigContext(null);const session=rigSessionRef.current,root=currentAssetRootRef.current;
    if(!uuid||!session||!root||pendingRigRemovalRef.current||fittingBusyRef.current||rigDragging||healBusyRef.current||exportBusyRef.current||repairQueueRunningRef.current)return;
    try {
      validateRemovalContext();
      if(session.mode!=='edit')throw new Error('Enter Edit Skeleton before changing joints.');
      const request:RemovalRequest={session,root,revision:session.revision,uuid,name:root.getObjectByProperty('uuid',uuid)?.name??'',scope,summary:session.deletionSummary(uuid,scope)};
      pendingRigRemovalRef.current=request;setPendingRigRemoval(request);setRigError(null);
    }catch(error){setRigError(jointDeleteMessage(error instanceof Error?error.message:String(error),language));}
  };
  const confirmRigRemoval=()=>{
    const request=pendingRigRemovalRef.current;cancelRigRemoval();if(!request)return;
    if(request.session!==rigSessionRef.current||request.root!==currentAssetRootRef.current||request.revision!==request.session.revision||request.session.mode!=='edit'||request.session.isGestureActive||healBusyRef.current||exportBusyRef.current||repairQueueRunningRef.current){
      setRigError(language==='ru'?'Модель изменилась. Повторно выберите удаление и проверьте предупреждение.':'The model changed. Review a new deletion warning.');return;
    }
    handleRigAction(session=>{
      validateRemovalContext();
      session.removeJoints(request.uuid,request.scope);sceneManagerRef.current?.selectObject(null);
    });
  };

  // Ctrl+Z uses model histories; text fields retain their native text Undo.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if(pendingRigRemovalRef.current)return;
      if(e.defaultPrevented||e.isComposing||e.target instanceof HTMLElement&&(e.target.isContentEditable||e.target.closest('input,textarea,select')))return;
      if(e.ctrlKey&&!e.altKey&&!e.shiftKey&&(e.code==='KeyZ'||e.key.toLowerCase()==='z')) {
        e.preventDefault();
        if(e.repeat||rigDragging||healBusyRef.current||exportBusyRef.current||repairQueueRunningRef.current||pendingAssetSwitch||isTestModalOpen||document.querySelector('[data-active-view="compare"]'))return;
        const session=rigSessionRef.current,heal=healEngineRef.current;
        while(undoOrderRef.current.length){
          const domain=undoOrderRef.current.at(-1)!;
          if(domain==='rig'&&session?.canUndo){handleUndoRig();return;}
          if(domain==='heal'&&heal?.getUndoState().available){handleUndoHeal();return;}
          undoOrderRef.current.pop();
        }
        if(session?.canUndo)handleUndoRig();else if(heal?.getUndoState().available)handleUndoHeal();
        return;
      }
      if(e.ctrlKey||e.metaKey||e.altKey)return;
      if (e.key === 'f' || e.key === 'F') {
        handleFrameAll();
      } else if (e.key === ' ') {
        e.preventDefault();
        handleTogglePlayAnimation();
      } else if (e.key === 'z' || e.key === 'Z') {
        handleSetRenderMode(renderMode === 'wireframe' ? 'pbr' : 'wireframe');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const selectedDeleteReason=useMemo(()=>{
    const session=rigSessionRef.current;
    if(!session||!selectedUuid)return null;
    if(healEngineRef.current?.getActiveReports().length)return 'Export and reimport verified repairs before deleting a joint.';
    return null;
  },[selectedUuid,rigSessionRef.current,rigSessionRef.current?.revision,healReport]);
  const rigBusy=healBusy||exportBusy||fittingBusy||rigDragging||repairQueueState.status==='running'||Boolean(pendingRigRemoval);
  const rigEditorProps={session:rigSessionRef.current,selectedUuid,settings:rigSettings,activeClipIndex,busy:rigBusy,enabled:currentExportSourceRef.current?.kind==='buffer'&&/\.glb$/i.test(fileName),error:rigError,exportResult:rigExportResult,
    onVerifyExport:()=>void handleRigExport(false),onSaveExport:()=>void handleRigExport(true),onMode:handleRigMode,onAction:handleRigAction,onUndo:handleUndoRig,
    onAddJoint:()=>handleAddJoint(),onDeleteJoint:()=>handleDeleteJoint(),onDeleteChain:()=>handleDeleteJoint(selectedUuid,'chain'),deleteReason:jointDeleteMessage(selectedDeleteReason,language),
    onPreview:(uuid:string,quaternion:number[])=>{setRigError(null);try{sceneManagerRef.current?.previewRigRotation(uuid,quaternion);}catch(error){setRigError(error instanceof Error?error.message:String(error));}},
    onSettings:(settings:RigGizmoSettings)=>{setRigSettings(settings);sceneManagerRef.current?.setRigGizmoSettings(settings);}
  };
  const contextBone=rigContext&&rigSessionRef.current?.root.getObjectByProperty('uuid',rigContext.uuid);
  const contextReason=rigSessionRef.current?.mode!=='edit'?'Enter Edit Skeleton before changing joints.':selectedDeleteReason;
  return (
    <div className="asset-doctor-ui flex flex-col h-screen w-screen bg-[#131518] text-gray-100 overflow-hidden font-sans select-none">
      {pendingRigRemoval&&<RigRemovalDialog name={pendingRigRemoval.name} scope={pendingRigRemoval.scope} summary={pendingRigRemoval.summary} onCancel={cancelRigRemoval} onConfirm={confirmRigRemoval}/>}
      {rigContext&&contextBone&&<RigJointMenu joint={{...rigContext,name:contextBone.name}} reason={jointDeleteMessage(contextReason,language)} busy={rigBusy||rigSessionRef.current?.mode!=='edit'} onClose={closeRigContext} onAdd={()=>handleAddJoint(rigContext.uuid)} onDelete={()=>handleDeleteJoint(rigContext.uuid)} onDeleteChain={()=>handleDeleteJoint(rigContext.uuid,'chain')} />}
      {/* Top Application Toolbar */}
      <TopToolbar
        onPickFile={isDesktop() ? handlePickFile : undefined}
        onOpenFile={requestOpenFile}
        onExport={handleToolbarExport}
        canExport={!fittingBusy&&(canExportRepaired || Boolean(rigSessionRef.current?.hasEdits&&!rigDragging&&!healBusy&&repairQueueState.status!=='running'))}
        exportBusy={exportBusy}
        onSelectSample={requestSelectSample}
        renderMode={renderMode}
        onSetRenderMode={handleSetRenderMode}
        lightingPreset={lightingPreset}
        onSetLightingPreset={handleSetLightingPreset}
        isTreeCollapsed={isTreeCollapsed}
        onToggleTreeCollapse={handleToggleTreeCollapse}
        autoRotate={autoRotate}
        onToggleAutoRotate={handleToggleAutoRotate}
        onFrameAll={handleFrameAll}
        onFocusSelected={handleFocusSelected}
        onFrameRawBounds={handleFrameRawBounds}
        onResetCamera={handleResetCamera}
        toggles={toggles}
        onToggleHelper={handleToggleHelper}
        explodedAmount={explodedAmount}
        onSetExplodedAmount={handleSetExplodedAmount}
        onOpenUnitTests={() => setIsTestModalOpen(true)}
        triangleCount={summary?.triangleCount || 0}
        fps={fps}
        isAnalyzing={progressiveState.topology === 'running'}
      />

      {/* Main Studio Body */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Left: Scene Tree Hierarchy */}
        <SceneTreePanel
          treeRoot={treeRoot}
          selectedUuid={selectedUuid}
          onSelectNode={handleSelectNode}
          onToggleVisibility={handleToggleVisibility}
          onIsolateNode={handleIsolateNode}
          onShowAll={handleShowAll}
          onFocusNode={handleFocusNode}
          isCollapsed={isTreeCollapsed}
          onTogglePanelCollapse={handleToggleTreeCollapse}
        />

        {/* Center: 3D Viewport with Drag & Drop */}
        <Viewport
          rigToolbar={<RigEditorPanel {...rigEditorProps} variant="tools" />}
          onCanvasMount={handleCanvasMount}
          onFileDrop={requestOpenFile}
          isLoading={isLoading}
          fileName={fileName}
          renderMode={renderMode}
          triangleCount={summary?.triangleCount || 0}
          modelHeight={summary?.boundingBox.size[1] || 0}
          surface={surface}
          onSetSurface={handleSetSurface}
          modelRotation={modelRotation}
          onSetModelRotation={handleSetModelRotation}
          autoRotate={autoRotate}
          onToggleAutoRotate={handleToggleAutoRotate}
          autoRotateSpeed={autoRotateSpeed}
          onSetAutoRotateSpeed={handleSetAutoRotateSpeed}
          isLightBulbVisible={lightingConfig.showLightBulb ?? true}
          onToggleLightBulb={() =>
            handleUpdateLighting({ showLightBulb: !(lightingConfig.showLightBulb ?? true) })
          }
        />

        {/* Right: Technical Inspector & Diagnostic Panel */}
        <InspectorPanel
          animationClips={animationClips} activeClipIndex={activeClipIndex} onSelectClip={handleSelectClip} animationBusy={healBusy||exportBusy||rigDragging||repairQueueState.status==='running'} clipSourceKey={rigSessionRef.current?.root.uuid??fileName}
          rigEditor={<>{rigSessionRef.current?.hasSkeleton&&<RigFittingPanel appliedCount={appliedFit?.rootUuid===rigSessionRef.current?.root.uuid&&appliedFit.revision===rigSessionRef.current?.revision?appliedFit.count:undefined} onSelectAll={selected=>setFittingSelection(new Set(selected?fittingReview?.proposals.filter(p=>p.status==='suggested').map(p=>p.uuid):[]))} review={fittingReview} selected={fittingSelection} activeUuid={selectedUuid} busy={fittingBusy} blocked={!rigEditorProps.enabled||healBusy||exportBusy||rigDragging||Boolean(pendingRigRemoval)||repairQueueState.status==='running'} edit={rigSessionRef.current?.mode==='edit'} error={fittingError} onAnalyze={()=>void handleAnalyzeFitting()} onCancel={discardFitting} onApply={handleApplyFitting} onPick={uuid=>sceneManagerRef.current?.selectObject(uuid)} onToggle={(uuid,checked)=>setFittingSelection(previous=>{const next=new Set(previous);if(checked)next.add(uuid);else next.delete(uuid);return next;})}/>}<RigEditorPanel {...rigEditorProps} /></>}
          summary={summary}
          healthIssues={healthIssues}
          progressiveState={progressiveState}
          materials={materials}
          textures={textures}
          selectedNode={selectedNode}
          skinningStats={skinningStats}
          skinInfluenceSummary={skinInfluenceSummary}
          skeletonVisible={toggles.skeleton}
          skeletonXray={skeletonXray}
          onSetSkeletonVisible={handleSetSkeletonVisible}
          onSetSkeletonXray={handleSetSkeletonXray}
          onResetPreviewPose={handleResetPreviewPose}
          onIsolateSelectedSkinnedMesh={handleIsolateSelectedSkinnedMesh}
          diagnosticProfileId={diagnosticProfileId}
          onSetDiagnosticProfile={setDiagnosticProfileId}
          lightingConfig={lightingConfig}
          onUpdateLighting={handleUpdateLighting}
          onFocusIssue={handleFocusIssue}
          isIssueFocusActive={isIssueFocusActive}
          onRestoreIssueView={handleRestoreIssueView}
          healPreview={healPreview}
          healUndoState={healUndoState}
          healReport={healReport}
          healHistorical={healHistorical}
          healBusy={healBusy||fittingBusy}
          healError={healError}
          healStorageFailed={healStorageFailed}
          savedHealHistoryAvailable={Boolean(savedHealReport)}
          onShowHealHistory={handleShowHealHistory}
          onDismissHealReport={handleDismissHealReport}
          onClearHealHistory={handleClearHealHistory}
          onRescan={handleRescan}
          repairQueueState={repairQueueState}
          onPreviewRepairQueueNext={handlePreviewNextRepairQueue}
          onRunRepairQueue={handleRunSafeRepairQueue}
          onStopRepairQueue={handleStopRepairQueue}
          exportReport={exportReport}
          exportBusy={exportBusy}
          exportError={exportError}
          canExport={canExportRepaired}
          onBuildExport={handleBuildRepairedExport}
          onDownloadExport={handleDownloadRepairedExport}
          onPreviewHeal={handlePreviewHeal}
          onCancelHealPreview={handleCancelHealPreview}
          onApplyHeal={handleApplyHeal}
          onUndoHeal={handleUndoHeal}
          onSelectMeshByUuid={handleSelectNode}
        />
      </main>

      {/* Bottom: Animation Timeline Scrubber (Rendered when clips exist) */}
      <AnimationTimeline
        clips={animationClips}
        activeClipIndex={activeClipIndex}
        onSelectClip={handleSelectClip}
        isPlaying={isPlayingAnimation}
        onTogglePlay={handleTogglePlayAnimation}
        onStop={handleStopAnimation}
        currentTime={animationTime}
        duration={animationDuration}
        onSeek={handleSeekAnimation}
        onStepFrame={handleStepFrame}
        speed={animationSpeed}
        onSetSpeed={handleSetSpeed}
        isLooping={isLoopingAnimation}
        onToggleLoop={handleToggleLoop}
        showRootMotion={showRootMotion}
        onToggleRootMotion={handleToggleRootMotion}
      />

      {/* Topology Unit Test Verification Modal */}
      <TopologyTestModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
      />

      {pendingAssetSwitch && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-amber-800/70 bg-[#1a1d23] p-4 shadow-2xl">
            <div className="text-sm font-semibold text-amber-200">
              {language === 'ru' ? 'Есть неэкспортированные исправления' : 'Unsaved repaired changes'}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-gray-300">
              {language === 'ru'
                ? 'Текущий Heal-сеанс содержит изменения, которые ещё не сохранены как проверенная repaired copy. Перед открытием другой модели выберите, что с ними сделать.'
                : 'The current Heal session contains changes that have not been saved as a verified repaired copy. Choose what to do before opening another asset.'}
            </p>
            {!canExportRepaired && (
              <p className="mt-2 text-[10px] leading-relaxed text-amber-400/80">
                {language === 'ru'
                  ? 'Экспорт пока недоступен: текущий repair-сеанс должен быть полностью VERIFIED. Можно отменить переход или отбросить изменения.'
                  : 'Export is not available yet: the current repair session must be fully VERIFIED. You can cancel the switch or discard the changes.'}
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setPendingAssetSwitch(null)}
                disabled={exportBusy}
                className="rounded border border-[#3a404c] bg-[#232730] px-3 py-2 text-xs text-gray-300 hover:bg-[#2c313b] disabled:opacity-50"
              >
                {language === 'ru' ? 'Отмена' : 'Cancel'}
              </button>
              <button
                onClick={() => { void handleDiscardAndSwitch(); }}
                data-tone="danger"
                disabled={exportBusy}
                className="rounded border border-rose-800/70 bg-rose-950/35 px-3 py-2 text-xs text-rose-200 hover:bg-rose-950/55 disabled:opacity-50"
              >
                {language === 'ru' ? 'Отбросить и открыть' : 'Discard and open'}
              </button>
              <button
                onClick={() => { void handleExportAndSwitch(); }}
                disabled={!(canExportRepaired||rigSessionRef.current?.hasEdits) || exportBusy}
                className="rounded border border-cyan-700 bg-cyan-950/45 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-950/65 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {exportBusy
                  ? (language === 'ru' ? 'Экспорт…' : 'Exporting…')
                  : isDesktop()
                    ? (language === 'ru' ? 'Экспортировать и открыть' : 'Export and open')
                    : (language === 'ru' ? 'Скачать копию' : 'Download copy')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
