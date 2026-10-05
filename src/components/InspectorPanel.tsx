import React, { useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Box,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  History,
  RefreshCw,
  Wrench,
  Database,
  ExternalLink,
  Eye,
  FileText,
  Focus,
  Gauge,
  HelpCircle,
  Image,
  Info,
  Layers,
  Sliders,
  Sparkles,
  Zap,
} from 'lucide-react';
import type {
  AssetSummary,
  DiagnosticProfileId,
  HealthIssue,
  HealthSeverity,
  HealOperationReport,
  HealPreview,
  ExportVerificationReport,
  HealUndoState,
  LightingConfig,
  MaterialInfo,
  ProgressiveAnalysisState,
  RepairQueueRunState,
  SceneNodeInfo,
  SkinInfluenceSummary,
  SkinningStats,
  TextureInfo,
} from '../types';
import { useI18n } from '../i18n';
import {
  categoryLabel,
  diagnosticElementLabel,
  diagnosticLayerLabel,
  localizeHealthIssue,
  repairabilityLabel,
  severityLabel,
} from '../health/HealthIssueLocalization';
import { getRepairOperationForIssue } from '../heal/framework/RepairRegistry';
import { buildRepairQueueCandidates } from '../heal/RepairQueue';
import { HealReportPanel } from './HealReportPanel';

interface InspectorPanelProps {
  summary: AssetSummary | null;
  healthIssues: HealthIssue[];
  progressiveState: ProgressiveAnalysisState;
  materials: MaterialInfo[];
  textures: TextureInfo[];
  selectedNode: SceneNodeInfo | null;
  skinningStats: SkinningStats | null;
  skinInfluenceSummary: SkinInfluenceSummary | null;
  skeletonVisible: boolean;
  skeletonXray: boolean;
  onSetSkeletonVisible: (visible: boolean) => void;
  onSetSkeletonXray: (enabled: boolean) => void;
  onResetPreviewPose: () => void;
  onIsolateSelectedSkinnedMesh: () => void;
  diagnosticProfileId: DiagnosticProfileId;
  onSetDiagnosticProfile: (profileId: DiagnosticProfileId) => void;
  lightingConfig: LightingConfig;
  onUpdateLighting: (config: Partial<LightingConfig>) => void;
  onFocusIssue: (issue: HealthIssue) => void;
  isIssueFocusActive: boolean;
  onRestoreIssueView: () => void;
  healPreview: HealPreview | null;
  healUndoState: HealUndoState;
  healReport: HealOperationReport | null;
  healHistorical: boolean;
  healBusy: boolean;
  healError: string | null;
  healStorageFailed: boolean;
  savedHealHistoryAvailable: boolean;
  onShowHealHistory: () => void;
  onDismissHealReport: () => void;
  onClearHealHistory: () => void;
  onRescan: () => void;
  repairQueueState: RepairQueueRunState;
  onPreviewRepairQueueNext: () => void;
  onRunRepairQueue: () => void;
  onStopRepairQueue: () => void;
  exportReport: ExportVerificationReport | null;
  exportBusy: boolean;
  exportError: string | null;
  canExport: boolean;
  onBuildExport: () => void;
  onDownloadExport: () => void;
  onPreviewHeal: (issue: HealthIssue) => void;
  onCancelHealPreview: () => void;
  onApplyHeal: () => void;
  onUndoHeal: () => void;
  onSelectMeshByUuid: (uuid: string) => void;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  summary,
  healthIssues,
  progressiveState,
  materials,
  textures,
  selectedNode,
  skinningStats,
  skinInfluenceSummary,
  skeletonVisible,
  skeletonXray,
  onSetSkeletonVisible,
  onSetSkeletonXray,
  onResetPreviewPose,
  onIsolateSelectedSkinnedMesh,
  lightingConfig,
  onUpdateLighting,
  onFocusIssue,
  isIssueFocusActive,
  onRestoreIssueView,
  healPreview,
  healUndoState, healReport, healHistorical, healBusy, healError, healStorageFailed,
  savedHealHistoryAvailable, onShowHealHistory, onDismissHealReport, onClearHealHistory, onRescan,
  repairQueueState, onPreviewRepairQueueNext, onRunRepairQueue, onStopRepairQueue,
  exportReport, exportBusy, exportError, canExport, onBuildExport, onDownloadExport,
  onPreviewHeal,
  onCancelHealPreview,
  onApplyHeal,
  onUndoHeal,
  onSelectMeshByUuid,
}) => {
  const { t, language } = useI18n();
  const localizedIssue = (issue: HealthIssue) => localizeHealthIssue(issue, language);

  const [activeTab, setActiveTab] = useState<
    'health' | 'summary' | 'materials' | 'skeleton' | 'performance'
  >('health');

  const [severityFilter, setSeverityFilter] = useState<HealthSeverity | 'ALL'>('ALL');
  const [locationIndexByIssue, setLocationIndexByIssue] = useState<Record<string, number>>({});
  const [issuePageIndex, setIssuePageIndex] = useState(0);

  // Technical Health deliberately excludes target/profile Fitness judgments.
  // A heavy but structurally valid model must not look "sick" merely because it is expensive.
  const technicalHealthIssues = healthIssues.filter((issue) => issue.layer !== 'Fitness');
  const fitnessIssues = healthIssues.filter((issue) => issue.layer === 'Fitness');

  const filteredIssues = technicalHealthIssues.filter((issue) => {
    if (severityFilter !== 'ALL' && issue.severity !== severityFilter) return false;
    return true;
  });
  const currentIssueIndex = filteredIssues.length > 0
    ? Math.min(issuePageIndex, filteredIssues.length - 1)
    : 0;
  const currentIssue = filteredIssues[currentIssueIndex] ?? null;
  const changeSeverityFilter = (next: HealthSeverity | 'ALL') => {
    setSeverityFilter(next);
    setIssuePageIndex(0);
  };

  const severityCounts = {
    ERROR: technicalHealthIssues.filter((i) => i.severity === 'ERROR').length,
    WARNING: technicalHealthIssues.filter((i) => i.severity === 'WARNING').length,
    INFO: technicalHealthIssues.filter((i) => i.severity === 'INFO').length,
    OK: technicalHealthIssues.filter((i) => i.severity === 'OK').length,
    NA: technicalHealthIssues.filter((i) => i.severity === 'N/A').length,
    UNKNOWN: technicalHealthIssues.filter((i) => i.severity === 'UNKNOWN').length,
  };

  const runtimeTextureMemory = textures.reduce(
    (total, texture) => total + (texture.uncompressedBytesEstimate || 0),
    0
  );

  const selectedBoneInfo =
    selectedNode?.type === 'Bone'
      ? skinningStats?.bones.find((bone) => bone.uuid === selectedNode.uuid) ?? null
      : null;

  const analysisStillRunning = Object.values(progressiveState).some(
    (status) => status === 'running' || status === 'pending'
  );
  const analysisHasError = Object.values(progressiveState).some((status) => status === 'error');

  const overallModelState = (() => {
    if (analysisHasError) {
      return {
        label: 'ANALYSIS INCOMPLETE',
        detail: 'One or more analysis stages failed',
        barClass: 'bg-violet-500',
        textClass: 'text-violet-300',
      };
    }
    if (analysisStillRunning) {
      return {
        label: 'ANALYZING',
        detail: 'Diagnostics are still being calculated',
        barClass: 'bg-cyan-500',
        textClass: 'text-cyan-300',
      };
    }
    if (severityCounts.ERROR > 0) {
      return {
        label: 'CRITICAL',
        detail: `${severityCounts.ERROR} error(s) · ${severityCounts.WARNING} warning(s)`,
        barClass: 'bg-rose-500',
        textClass: 'text-rose-300',
      };
    }
    if (severityCounts.WARNING > 0) {
      return {
        label: 'ATTENTION',
        detail: `${severityCounts.WARNING} warning(s) · ${severityCounts.INFO} info`,
        barClass: 'bg-amber-400',
        textClass: 'text-amber-300',
      };
    }
    if (severityCounts.UNKNOWN > 0) {
      return {
        label: 'UNKNOWN',
        detail: `${severityCounts.UNKNOWN} result(s) are unknown`,
        barClass: 'bg-violet-500',
        textClass: 'text-violet-300',
      };
    }
    return {
      label: 'HEALTHY',
      detail: `${severityCounts.OK} checks passed · ${severityCounts.INFO} info`,
      barClass: 'bg-emerald-500',
      textClass: 'text-emerald-300',
    };
  })();

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const getSeverityIcon = (severity: HealthSeverity) => {
    switch (severity) {
      case 'ERROR':
        return <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />;
      case 'WARNING':
        return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />;
      case 'INFO':
        return <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />;
      case 'OK':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />;
      case 'N/A':
        return <HelpCircle className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />;
      case 'UNKNOWN':
        return <HelpCircle className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />;
    }
  };

  const getSeverityBadgeClass = (severity: HealthSeverity) => {
    switch (severity) {
      case 'ERROR':
        return 'bg-rose-950/60 border-rose-800 text-rose-300';
      case 'WARNING':
        return 'bg-amber-950/60 border-amber-800 text-amber-300';
      case 'INFO':
        return 'bg-sky-950/60 border-sky-800 text-sky-300';
      case 'OK':
        return 'bg-emerald-950/60 border-emerald-800 text-emerald-300';
      case 'N/A':
        return 'bg-gray-900/60 border-gray-700 text-gray-300';
      case 'UNKNOWN':
        return 'bg-violet-950/60 border-violet-800 text-violet-300';
    }
  };

  const focusIssueLocation = (issue: HealthIssue, index?: number) => {
    const locations = issue.locations ?? [];
    if (locations.length === 0) {
      onFocusIssue(issue);
      return;
    }

    const resolvedIndex = Math.min(
      Math.max(index ?? locationIndexByIssue[issue.id] ?? 0, 0),
      locations.length - 1
    );
    const location = locations[resolvedIndex];

    setLocationIndexByIssue((prev) => ({ ...prev, [issue.id]: resolvedIndex }));
    onFocusIssue({
      ...issue,
      meshUuid: location.meshUuid,
      meshName: location.meshName,
      affectedElement: location.affectedElement,
      affectedIndices: location.affectedIndices,
      focusPosition: location.focusPosition,
    });
  };

  const issueAtCurrentLocation = (issue: HealthIssue): HealthIssue => {
    const locations = issue.locations ?? [];
    if (locations.length === 0) return issue;

    const index = Math.min(
      Math.max(locationIndexByIssue[issue.id] ?? 0, 0),
      locations.length - 1
    );
    const location = locations[index];

    return {
      ...issue,
      meshUuid: location.meshUuid,
      meshName: location.meshName,
      affectedElement: location.affectedElement,
      affectedIndices: location.affectedIndices,
      focusPosition: location.focusPosition,
    };
  };

  const moveIssueLocation = (issue: HealthIssue, direction: -1 | 1) => {
    const locations = issue.locations ?? [];
    if (locations.length < 2) return;
    const current = locationIndexByIssue[issue.id] ?? 0;
    const next = (current + direction + locations.length) % locations.length;
    focusIssueLocation(issue, next);
  };

  const issueLocationText = (issue: HealthIssue): string => {
    const current = issueAtCurrentLocation(issue);
    const subject =
      current.meshName ??
      current.boneName ??
      current.nodeName ??
      current.clipName ??
      t('inspector.assetWide');

    const element = current.affectedElement ? ` · ${diagnosticElementLabel(current.affectedElement, language)}` : '';
    const indices = current.affectedIndices?.length
      ? ` [${current.affectedIndices.slice(0, 8).join(', ')}${current.affectedIndices.length > 8 ? ', …' : ''}]`
      : '';
    return `${subject}${element}${indices}`;
  };

  const repairabilityClass = (repairability: HealthIssue['repairability']) => {
    switch (repairability) {
      case 'SAFE':
        return 'text-emerald-300 border-emerald-900/70 bg-emerald-950/20';
      case 'CONDITIONAL':
        return 'text-amber-300 border-amber-900/70 bg-amber-950/20';
      case 'MANUAL':
        return 'text-orange-300 border-orange-900/70 bg-orange-950/20';
      default:
        return 'text-gray-400 border-[#343845] bg-[#15171c]';
    }
  };

  const repairQueue = buildRepairQueueCandidates(healthIssues);

  return (
    <aside className="w-96 bg-[#16181d] border-l border-[#262932] flex flex-col h-full shrink-0 select-none text-xs text-gray-200">
      {/* Inspector Tabs */}
      <div className="h-10 px-2 border-b border-[#262932] grid grid-cols-5 gap-1 items-center bg-[#1a1c22]">
        <button
          onClick={() => setActiveTab('health')}
          className={`min-w-0 flex items-center justify-center gap-1 px-1.5 py-1.5 rounded text-xs font-medium transition cursor-pointer ${
            activeTab === 'health'
              ? 'bg-[#252830] text-cyan-400 border border-[#373b46]'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span className="truncate">{t('inspector.health')}</span>
          {severityCounts.ERROR > 0 && (
            <span className="px-1 py-0.2 rounded-full bg-rose-900/80 text-rose-300 text-[10px] font-mono">
              {severityCounts.ERROR}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('summary')}
          className={`min-w-0 flex items-center justify-center gap-1 px-1.5 py-1.5 rounded text-xs font-medium transition cursor-pointer ${
            activeTab === 'summary'
              ? 'bg-[#252830] text-cyan-400 border border-[#373b46]'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span className="truncate">{t('inspector.summary')}</span>
        </button>

        <button
          onClick={() => setActiveTab('materials')}
          className={`min-w-0 flex items-center justify-center gap-1 px-1.5 py-1.5 rounded text-xs font-medium transition cursor-pointer ${
            activeTab === 'materials'
              ? 'bg-[#252830] text-cyan-400 border border-[#373b46]'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Image className="w-3.5 h-3.5" />
          <span className="truncate">{t('inspector.materials')}</span>
        </button>

        <button
          onClick={() => setActiveTab('skeleton')}
          className={`min-w-0 flex items-center justify-center gap-1 px-1.5 py-1.5 rounded text-xs font-medium transition cursor-pointer ${
            activeTab === 'skeleton'
              ? 'bg-[#252830] text-cyan-400 border border-[#373b46]'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span className="truncate">{t('inspector.rig')}</span>
        </button>

        <button
          onClick={() => setActiveTab('performance')}
          className={`min-w-0 flex items-center justify-center gap-1 px-1.5 py-1.5 rounded text-xs font-medium transition cursor-pointer ${
            activeTab === 'performance'
              ? 'bg-[#252830] text-cyan-400 border border-[#373b46]'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Gauge className="w-3.5 h-3.5" />
          <span className="truncate">{t('inspector.performance')}</span>
        </button>
      </div>

      {/* TAB 1: ASSET HEALTH & DETERMINISTIC DIAGNOSTICS */}
      {activeTab === 'health' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
          {/* Health stays model-centric: report quality filters live below. */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={onRescan}
              disabled={progressiveState.topology === 'running' || healBusy}
              className="flex items-center gap-1 px-2 py-1 rounded border border-[#343944] bg-[#202329] text-gray-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              title={t('inspector.rescanTitle')}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${progressiveState.topology === 'running' ? 'animate-spin' : ''}`} />
              <span>{t('inspector.rescan')}</span>
            </button>

            {!healReport && savedHealHistoryAvailable && (
              <button
                onClick={onShowHealHistory}
                className="flex items-center gap-1 px-2 py-1 rounded border border-[#343944] bg-[#202329] text-gray-300 hover:text-white cursor-pointer"
              >
                <History className="w-3.5 h-3.5" />
                <span>{t('heal.history')}</span>
              </button>
            )}
          </div>

          {(repairQueue.length > 0 || repairQueueState.status !== 'idle') && (
            <div className="bg-[#1c1e24] border border-[#2d313a] rounded p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Wrench className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-300">
                      {t('heal.queue.title')}
                    </div>
                    <div className="text-[9px] text-gray-500">
                      {t('heal.queue.count', { count: repairQueue.length })}
                    </div>
                  </div>
                </div>
                <span className={`text-[9px] font-mono uppercase ${
                  repairQueueState.status === 'regression' || repairQueueState.status === 'failed'
                    ? 'text-rose-300'
                    : repairQueueState.status === 'partial' || repairQueueState.status === 'stopped'
                      ? 'text-amber-300'
                      : repairQueueState.status === 'completed'
                        ? 'text-emerald-300'
                        : 'text-cyan-300'
                }`}>
                  {t(`heal.queue.status.${repairQueueState.status}`)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-[9px] font-mono">
                <div className="rounded border border-[#2c3039] bg-[#17191e] px-1.5 py-1">
                  <span className="block text-gray-500">{t('heal.queue.completed')}</span>
                  <span className="text-emerald-300">{repairQueueState.completed}</span>
                </div>
                <div className="rounded border border-[#2c3039] bg-[#17191e] px-1.5 py-1">
                  <span className="block text-gray-500">{t('heal.queue.skipped')}</span>
                  <span className="text-amber-300">{repairQueueState.skipped}</span>
                </div>
                <div className="rounded border border-[#2c3039] bg-[#17191e] px-1.5 py-1">
                  <span className="block text-gray-500">{t('heal.queue.remaining')}</span>
                  <span className="text-cyan-300">
                    {repairQueueState.status === 'idle' ? repairQueue.length : repairQueueState.remaining}
                  </span>
                </div>
              </div>

              {repairQueueState.currentOperation && (
                <div className="text-[10px] text-gray-300 break-words">
                  {t('heal.queue.current')}: {repairQueueState.currentMeshName ?? '—'}
                </div>
              )}

              {repairQueueState.stopReason && (
                <div className={`text-[10px] ${
                  repairQueueState.status === 'regression' || repairQueueState.status === 'failed'
                    ? 'text-rose-300'
                    : 'text-amber-300'
                }`}>
                  {repairQueueState.stopReason}
                </div>
              )}

              {repairQueue.length > 0 && repairQueueState.status !== 'running' && (
                <div className="text-[10px] text-gray-400 truncate">
                  {getRepairOperationForIssue(repairQueue[0].issue)
                    ? t(getRepairOperationForIssue(repairQueue[0].issue)!.labelKey)
                    : localizedIssue(repairQueue[0].issue).title}
                  {repairQueue[0].meshName ? ` · ${repairQueue[0].meshName}` : ''}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                {repairQueueState.status === 'running' ? (
                  <button
                    onClick={onStopRepairQueue}
                    className="px-2 py-1 rounded border border-amber-800 bg-amber-950/30 text-amber-300 hover:text-white cursor-pointer text-[10px]"
                  >
                    {t('heal.queue.stop')}
                  </button>
                ) : (
                  <>
                    <button
                      disabled={healBusy || repairQueue.length === 0}
                      onClick={onPreviewRepairQueueNext}
                      className="px-2 py-1 rounded border border-cyan-800 bg-cyan-950/30 text-cyan-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-[10px]"
                    >
                      {t('heal.queue.previewNext')}
                    </button>
                    {healPreview?.status === 'READY' && (
                      <button
                        disabled={healBusy}
                        onClick={onApplyHeal}
                        className="px-2 py-1 rounded border border-emerald-800 bg-emerald-950/30 text-emerald-300 hover:text-white disabled:opacity-40 cursor-pointer text-[10px]"
                      >
                        {t('heal.queue.applyNext')}
                      </button>
                    )}
                    <button
                      disabled={healBusy || repairQueue.length === 0 || progressiveState.topology === 'running'}
                      onClick={onRunRepairQueue}
                      className="px-2 py-1 rounded border border-[#46505f] bg-[#242932] text-gray-200 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-[10px]"
                    >
                      {t('heal.queue.run')}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <HealReportPanel
            report={healReport}
            historical={healHistorical}
            busy={healBusy}
            error={healError}
            storageFailed={healStorageFailed}
            undoState={healUndoState}
            onUndo={onUndoHeal}
            onDismiss={onDismissHealReport}
            onClearHistory={onClearHealHistory}
            exportReport={exportReport}
            exportBusy={exportBusy}
            exportError={exportError}
            canExport={canExport}
            onBuildExport={onBuildExport}
            onDownloadExport={onDownloadExport}
          />
          {!healReport && healError && <p role="alert" className="text-xs text-rose-300">{healError}</p>}

          {/* Progressive Analysis Pipeline Tracker */}
          <div className="bg-[#1c1e24] border border-[#2d313a] rounded p-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-gray-300">
              <span className="uppercase tracking-wider">Analysis Pipeline</span>
              <span className="font-mono text-cyan-400">
                {progressiveState.topology === 'running' ? 'Active' : 'Complete'}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 pt-1 text-[10px] font-mono">
              <div className="flex items-center space-x-1 px-1.5 py-1 rounded bg-[#16181d] border border-[#272a32]">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    progressiveState.geometry === 'done' ? 'bg-emerald-400' : 'bg-amber-400 animate-ping'
                  }`}
                />
                <span className="text-gray-300 truncate">Geom</span>
              </div>
              <div className="flex items-center space-x-1 px-1.5 py-1 rounded bg-[#16181d] border border-[#272a32]">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    progressiveState.materials === 'done' ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                <span className="text-gray-300 truncate">Mat</span>
              </div>
              <div className="flex items-center space-x-1 px-1.5 py-1 rounded bg-[#16181d] border border-[#272a32]">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    progressiveState.skeleton === 'done' ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                <span className="text-gray-300 truncate">Rig</span>
              </div>
              <div className="flex items-center space-x-1 px-1.5 py-1 rounded bg-[#16181d] border border-[#272a32]">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    progressiveState.topology === 'done'
                      ? 'bg-emerald-400'
                      : progressiveState.topology === 'running'
                      ? 'bg-blue-400 animate-ping'
                      : 'bg-gray-400'
                  }`}
                />
                <span className="text-gray-300 truncate">Topology</span>
              </div>
            </div>

            <div className="pt-1.5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#111318] border border-[#292d35]">
                <div className={`h-full w-full transition-colors duration-300 ${overallModelState.barClass}`} />
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className={`text-[9px] font-bold tracking-wider ${overallModelState.textClass}`}>
                  MODEL STATE: {overallModelState.label}
                </span>
                <span className="text-[9px] text-gray-500 font-mono truncate">
                  {overallModelState.detail}
                </span>
              </div>
            </div>
          </div>

          {/* Severity Counters Bar */}
          <div className="grid grid-cols-4 gap-1.5">
            <button
              onClick={() => changeSeverityFilter(severityFilter === 'ERROR' ? 'ALL' : 'ERROR')}
              className={`p-2 rounded border flex flex-col items-center transition cursor-pointer ${
                severityFilter === 'ERROR'
                  ? 'bg-rose-950/70 border-rose-600 text-rose-200'
                  : 'bg-[#1e2026] border-[#2e313b] text-rose-400 hover:border-rose-800'
              }`}
            >
              <span className="text-base font-bold font-mono">{severityCounts.ERROR}</span>
              <span className="text-[10px] uppercase font-semibold">{t('inspector.errors')}</span>
            </button>

            <button
              onClick={() => changeSeverityFilter(severityFilter === 'WARNING' ? 'ALL' : 'WARNING')}
              className={`p-2 rounded border flex flex-col items-center transition cursor-pointer ${
                severityFilter === 'WARNING'
                  ? 'bg-amber-950/70 border-amber-600 text-amber-200'
                  : 'bg-[#1e2026] border-[#2e313b] text-amber-400 hover:border-amber-800'
              }`}
            >
              <span className="text-base font-bold font-mono">{severityCounts.WARNING}</span>
              <span className="text-[10px] uppercase font-semibold">{t('inspector.warnings')}</span>
            </button>

            <button
              onClick={() => changeSeverityFilter(severityFilter === 'INFO' ? 'ALL' : 'INFO')}
              className={`p-2 rounded border flex flex-col items-center transition cursor-pointer ${
                severityFilter === 'INFO'
                  ? 'bg-sky-950/70 border-sky-600 text-sky-200'
                  : 'bg-[#1e2026] border-[#2e313b] text-sky-400 hover:border-sky-800'
              }`}
            >
              <span className="text-base font-bold font-mono">{severityCounts.INFO}</span>
              <span className="text-[10px] uppercase font-semibold">{t('inspector.info')}</span>
            </button>

            <button
              onClick={() => changeSeverityFilter(severityFilter === 'OK' ? 'ALL' : 'OK')}
              className={`p-2 rounded border flex flex-col items-center transition cursor-pointer ${
                severityFilter === 'OK'
                  ? 'bg-emerald-950/70 border-emerald-600 text-emerald-200'
                  : 'bg-[#1e2026] border-[#2e313b] text-emerald-400 hover:border-emerald-800'
              }`}
            >
              <span className="text-base font-bold font-mono">{severityCounts.OK}</span>
              <span className="text-[10px] uppercase font-semibold">{t('inspector.passed')}</span>
            </button>
          </div>

          {/* Diagnostic Issues List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-gray-400 pt-1">
              <div className="flex items-center gap-2">
                <span>{filteredIssues.length} {t('inspector.diagnosticRules')}</span>
                {isIssueFocusActive && (
                  <button
                    onClick={onRestoreIssueView}
                    className="px-1.5 py-0.5 rounded border border-[#38404c] bg-[#20232a] text-gray-300 hover:text-white hover:border-cyan-700 cursor-pointer"
                  >
                    {t('inspector.backToView')}
                  </button>
                )}
              </div>
              {severityFilter !== 'ALL' && (
                <button
                  onClick={() => changeSeverityFilter('ALL')}
                  className="text-cyan-400 hover:underline cursor-pointer text-[10px]"
                >
                  {t('inspector.clearFilters')}
                </button>
              )}
            </div>

            {filteredIssues.length > 0 && (
              <div className="flex items-center justify-between rounded border border-[#303541] bg-[#191c22] px-2.5 py-2">
                <button
                  onClick={() => setIssuePageIndex((currentIssueIndex - 1 + filteredIssues.length) % filteredIssues.length)}
                  className="rounded border border-[#39404c] bg-[#22262e] p-1.5 text-gray-300 hover:border-cyan-800 hover:text-cyan-200"
                  title={t('inspector.previous')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="text-center">
                  <div className="text-[11px] font-semibold text-gray-200">{language === 'ru' ? 'Диагностическая карточка' : 'Diagnostic card'}</div>
                  <div className="font-mono text-[10px] text-gray-500">{currentIssueIndex + 1} / {filteredIssues.length}</div>
                </div>
                <button
                  onClick={() => setIssuePageIndex((currentIssueIndex + 1) % filteredIssues.length)}
                  className="rounded border border-[#39404c] bg-[#22262e] p-1.5 text-gray-300 hover:border-cyan-800 hover:text-cyan-200"
                  title={t('inspector.nextIssue')}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {currentIssue && [currentIssue].map((issue) => (
              <div
                key={issue.id}
                className="bg-[#1c1e24] border border-[#2c3039] rounded p-4 flex flex-col space-y-3 text-sm hover:border-[#3d4250] transition"
              >
                <div className="flex items-start justify-between space-x-2">
                  <div className="flex items-start space-x-2">
                    {getSeverityIcon(issue.severity)}
                    <div>
                      <div className="flex items-center space-x-1.5">
                        <span
                          className={`px-1.5 py-0.2 text-[9px] font-bold rounded border uppercase font-mono ${getSeverityBadgeClass(
                            issue.severity
                          )}`}
                        >
                          {severityLabel(issue.severity, language)}
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono">
                          [{categoryLabel(issue.category, language)}]
                        </span>
                        <span className="text-[9px] text-cyan-300/80 font-mono uppercase">
                          {diagnosticLayerLabel(issue.layer, language)}
                        </span>
                      </div>
                      <h4 className="mt-1 text-sm font-semibold leading-snug text-gray-100">{localizedIssue(issue).title}</h4>
                    </div>
                  </div>

                  {(issue.focusPosition || issue.meshUuid) && (
                    <button
                      onClick={() => focusIssueLocation(issue)}
                      className="px-2 py-1 rounded bg-[#272b34] hover:bg-[#323642] text-cyan-400 hover:text-cyan-300 font-medium text-[10px] flex items-center space-x-1 cursor-pointer shrink-0"
                      title={language === 'ru' ? 'Переместить камеру к найденной области' : 'Move viewport camera to affected coordinates'}
                    >
                      <Focus className="w-3 h-3" />
                      <span>{t('inspector.focus')}</span>
                    </button>
                  )}
                </div>

                <p className="pl-7 text-[13px] leading-relaxed text-gray-200">
                  {localizedIssue(issue).description}
                </p>

                {issue.technicalDetails && (
                  <div className="ml-6 p-1.5 rounded bg-[#15171c] border border-[#242730] font-mono text-[10px] text-gray-400">
                    {localizedIssue(issue).technicalDetails}
                  </div>
                )}

                {(issue.evidence ||
                  issue.suggestedAction ||
                  issue.repairability ||
                  issue.count !== undefined ||
                  issue.ratio ||
                  issue.meshName ||
                  issue.nodeName ||
                  issue.boneName ||
                  issue.clipName) && (
                  <div className="ml-7 space-y-2 border-t border-[#262932] pt-2 text-[11px]">
                    <div className="grid grid-cols-2 gap-1">
                      <div className="col-span-2 rounded border border-[#292d35] bg-[#17191e] px-1.5 py-1">
                        <span className="text-gray-500">{t('inspector.location')}:</span>{' '}
                        <span className="text-cyan-200">{issueLocationText(issue)}</span>
                      </div>
                      {issue.count !== undefined && (
                        <div className="rounded border border-[#292d35] bg-[#17191e] px-1.5 py-1">
                          <span className="text-gray-500 block">{t('inspector.count')}</span>
                          <span className="text-gray-200 font-mono">{issue.count.toLocaleString()}</span>
                        </div>
                      )}
                      {issue.ratio && (
                        <div className="rounded border border-[#292d35] bg-[#17191e] px-1.5 py-1">
                          <span className="text-gray-500 block">{t('inspector.ratio')}</span>
                          <span className="text-gray-200 font-mono">{issue.ratio}</span>
                        </div>
                      )}
                      <div className="rounded border border-[#292d35] bg-[#17191e] px-1.5 py-1">
                        <span className="text-gray-500 block">{t('inspector.severity')}</span>
                        <span className="text-gray-200 font-mono">{severityLabel(issue.severity, language)} · {diagnosticLayerLabel(issue.layer, language)}</span>
                      </div>
                      <div className={`rounded border px-1.5 py-1 ${repairabilityClass(issue.repairability)}`}>
                        <span className="opacity-70 block">{t('inspector.repairability')}</span>
                        <span className="font-mono font-semibold">{repairabilityLabel(issue.repairability, language)}</span>
                      </div>
                    </div>
                    {(issue.locations?.length ?? 0) > 1 && (
                      <div className="flex items-center gap-1.5 pt-1">
                        <button
                          onClick={() => moveIssueLocation(issue, -1)}
                          className="px-1.5 py-0.5 rounded bg-[#20232a] border border-[#343845] text-gray-300 hover:text-cyan-300 cursor-pointer"
                        >
                          ← {t('inspector.previous')}
                        </button>
                        <span className="font-mono text-gray-500">
                          {(locationIndexByIssue[issue.id] ?? 0) + 1}/{issue.locations!.length}
                        </span>
                        <button
                          onClick={() => moveIssueLocation(issue, 1)}
                          className="px-1.5 py-0.5 rounded bg-[#20232a] border border-[#343845] text-gray-300 hover:text-cyan-300 cursor-pointer"
                        >
                          {t('inspector.nextIssue')} →
                        </button>
                      </div>
                    )}
                    {issue.evidence && (
                      <div><span className="text-gray-500">{t('inspector.evidence')}:</span> <span className="text-gray-300">{localizedIssue(issue).evidence}</span></div>
                    )}
                    {issue.whyItMatters && localizedIssue(issue).whyItMatters !== localizedIssue(issue).description && (
                      <div><span className="text-gray-500">{t('inspector.why')}:</span> <span className="text-gray-300">{localizedIssue(issue).whyItMatters}</span></div>
                    )}
                    {issue.suggestedAction && (
                      <div><span className="text-gray-500">{t('inspector.next')}:</span> <span className="text-gray-300">{localizedIssue(issue).suggestedAction}</span></div>
                    )}
                    {issue.repairability === 'MANUAL' && (
                      <div className="mt-1.5 rounded border border-orange-900/70 bg-orange-950/20 p-1.5">
                        <div className="font-semibold uppercase tracking-wider text-orange-300 text-[9px]">
                          {t('inspector.manualRepairRecommended')}
                        </div>
                        <div className="text-orange-100/70 mt-0.5 leading-relaxed">
                          {t('inspector.manualRepairSafety')}
                        </div>
                      </div>
                    )}

                    {getRepairOperationForIssue(issue) && issueAtCurrentLocation(issue).meshUuid && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <button
                          disabled={healBusy}
                          onClick={() => onPreviewHeal(issueAtCurrentLocation(issue))}
                          className="px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-800 text-amber-300 hover:text-amber-100 hover:bg-amber-950/70 cursor-pointer"
                          title={t(getRepairOperationForIssue(issue)!.descriptionKey)}
                        >
                          {t('heal.previewFix')}
                        </button>
                      </div>
                    )}

                    {healPreview &&
                      healPreview.issueId === issue.id &&
                      healPreview.meshUuid === issueAtCurrentLocation(issue).meshUuid && (
                        <div className="mt-2 p-2 rounded border border-amber-900/70 bg-[#17181c] space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-amber-300 uppercase tracking-wider text-[9px]">
                              {t('heal.previewTitle')}
                            </span>
                            <span className={`font-mono text-[9px] ${
                              healPreview.status === 'READY' ? 'text-emerald-400' : 'text-rose-400'
                            }`}>
                              {healPreview.status}
                            </span>
                          </div>

                          {healPreview.status === 'READY' ? (
                            <>
                              <div className="grid grid-cols-2 gap-1 text-[10px]">
                                <div className="p-1 rounded bg-[#121418] border border-[#262932]">
                                  <span className="text-gray-500 block">
                                    {t(
                                      healPreview.metric === 'vertices'
                                        ? 'heal.metrics.vertexCount'
                                        : healPreview.metric === 'normals'
                                          ? 'heal.metrics.invalidNormals'
                                          : healPreview.metric === 'duplicates'
                                            ? 'heal.metrics.potentialDuplicatePositions'
                                            : healPreview.metric === 'duplicate-triangles'
                                              ? 'heal.metrics.duplicateTriangles'
                                              : healPreview.metric === 'weights'
                                                ? 'heal.metrics.invalidSkinWeights'
                                                : healPreview.metric === 'skin-influences'
                                                  ? 'heal.metrics.redundantSkinInfluenceVertices'
                                                  : 'heal.metrics.triangleCount'
                                    )}
                                  </span>
                                  <span className="font-mono text-gray-200">
                                    {healPreview.metricBefore} → {healPreview.metricAfter}
                                  </span>
                                </div>
                                <div className="p-1 rounded bg-[#121418] border border-[#262932]">
                                  <span className="text-gray-500 block">
                                    {t(
                                      healPreview.metric === 'normals' ||
                                      healPreview.metric === 'weights' ||
                                      healPreview.metric === 'skin-influences'
                                        ? 'heal.fix'
                                        : 'heal.remove'
                                    )}
                                  </span>
                                  <span className="font-mono text-amber-300">
                                    {healPreview.affectedCount}
                                  </span>
                                </div>
                                <div className="p-1 rounded bg-[#121418] border border-[#262932]">
                                  <span className="text-gray-500 block">{t('heal.boundaryEdges')}</span>
                                  <span className="font-mono text-gray-200">
                                    {healPreview.boundaryEdgesBefore} → {healPreview.boundaryEdgesAfter}
                                  </span>
                                </div>
                                <div className="p-1 rounded bg-[#121418] border border-[#262932]">
                                  <span className="text-gray-500 block">{t('heal.nonManifoldEdges')}</span>
                                  <span className="font-mono text-gray-200">
                                    {healPreview.nonManifoldEdgesBefore} → {healPreview.nonManifoldEdgesAfter}
                                  </span>
                                </div>
                              </div>
                              <div className="text-[9px] text-amber-200/80">
                                {t('heal.conditionalWarning')}
                              </div>
                              <div className="flex items-center gap-1.5 pt-1">
                                <button
                                  disabled={healBusy}
                                  onClick={onApplyHeal}
                                  className="px-2 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white font-medium cursor-pointer"
                                >
                                  {t('heal.apply')}
                                </button>
                                <button
                                  onClick={onCancelHealPreview}
                                  className="px-2 py-1 rounded bg-[#242730] border border-[#343845] text-gray-300 hover:text-white cursor-pointer"
                                >
                                  {t('heal.cancel')}
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="text-[10px] text-rose-300">
                                {healPreview.reasonKey ? t(healPreview.reasonKey) : healPreview.reason || t('heal.blocked')}
                              </div>
                              <button
                                onClick={onCancelHealPreview}
                                className="px-2 py-1 rounded bg-[#242730] border border-[#343845] text-gray-300 hover:text-white cursor-pointer"
                              >
                                {t('heal.closePreview')}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: SUMMARY & GEOMETRY METRICS */}
      {activeTab === 'summary' && summary && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
          {/* File Card */}
          <div className="bg-[#1c1e24] border border-[#2d313a] rounded p-2.5 space-y-2">
            <h4 className="font-semibold text-gray-200 uppercase tracking-wider text-[10px] text-cyan-400">
              File Details
            </h4>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-gray-400 block text-[10px]">Name:</span>
                <span className="font-medium truncate block" title={summary.fileName}>
                  {summary.fileName}
                </span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">File Size:</span>
                <span className="font-mono font-medium">{formatBytes(summary.fileSizeBytes)}</span>
              </div>
            </div>
          </div>

          {/* Scene Topology Counts */}
          <div className="bg-[#1c1e24] border border-[#2d313a] rounded p-2.5 space-y-2">
            <h4 className="font-semibold text-gray-200 uppercase tracking-wider text-[10px] text-cyan-400">
              Geometry Breakdown
            </h4>
            <div className="grid grid-cols-2 gap-y-2 text-[11px]">
              <div>
                <span className="text-gray-400 block text-[10px]">Triangles:</span>
                <span className="font-mono font-bold text-gray-100 text-sm">
                  {summary.triangleCount.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Vertices:</span>
                <span className="font-mono font-bold text-gray-100 text-sm">
                  {summary.vertexCount.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Indexed Vertices:</span>
                <span className="font-mono text-gray-300">
                  {summary.indexedVertexCount.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Mesh Primitives:</span>
                <span className="font-mono text-gray-300">{summary.primitiveCount}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Hierarchy Nodes:</span>
                <span className="font-mono text-gray-300">{summary.nodeCount}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Meshes:</span>
                <span className="font-mono text-gray-300">{summary.meshCount}</span>
              </div>
            </div>
          </div>

          {/* Bounding Box Information */}
          <div className="bg-[#1c1e24] border border-[#2d313a] rounded p-2.5 space-y-2">
            <h4 className="font-semibold text-gray-200 uppercase tracking-wider text-[10px] text-cyan-400">
              Dimensions & Bounding Box
            </h4>
            <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
              <div className="p-1.5 rounded bg-[#16181d] border border-[#272a32]">
                <span className="text-gray-400 block text-[9px] uppercase">Width (X)</span>
                <span className="text-gray-200 font-medium">
                  {summary.boundingBox.size[0].toFixed(3)} m
                </span>
              </div>
              <div className="p-1.5 rounded bg-[#16181d] border border-[#272a32]">
                <span className="text-gray-400 block text-[9px] uppercase">Height (Y)</span>
                <span className="text-gray-200 font-medium">
                  {summary.boundingBox.size[1].toFixed(3)} m
                </span>
              </div>
              <div className="p-1.5 rounded bg-[#16181d] border border-[#272a32]">
                <span className="text-gray-400 block text-[9px] uppercase">Depth (Z)</span>
                <span className="text-gray-200 font-medium">
                  {summary.boundingBox.size[2].toFixed(3)} m
                </span>
              </div>
            </div>
            <div className="text-[10px] font-mono text-gray-400 pt-1">
              Center: [{summary.boundingBox.center.map((c) => c.toFixed(2)).join(', ')}] | Diagonal:{' '}
              {summary.boundingBox.diagonal.toFixed(2)} m
            </div>
          </div>

          {/* Selected Mesh Stats if active */}
          {selectedNode && selectedNode.type === 'Mesh' && (
            <div className="bg-[#1c1e24] border border-blue-800/60 rounded p-2.5 space-y-2">
              <h4 className="font-semibold text-blue-400 uppercase tracking-wider text-[10px]">
                Selected Mesh: {selectedNode.name}
              </h4>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-gray-400 block text-[10px]">Triangles:</span>
                  <span className="font-mono font-medium">
                    {selectedNode.triangleCount.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px]">Vertices:</span>
                  <span className="font-mono font-medium">
                    {selectedNode.vertexCount.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MATERIALS & TEXTURES */}
      {activeTab === 'materials' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
          {/* Materials Section */}
          <div className="space-y-2">
            <h4 className="font-semibold text-gray-300 uppercase tracking-wider text-[10px] flex items-center justify-between">
              <span>Materials ({materials.length})</span>
            </h4>
            {materials.map((m) => (
              <div
                key={m.uuid}
                className="bg-[#1c1e24] border border-[#2c3039] rounded p-2.5 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span
                      className="w-4 h-4 rounded border border-[#3e4350] shrink-0"
                      style={{ backgroundColor: m.baseColorHex }}
                    />
                    <span className="font-semibold text-gray-100">{m.name}</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#16181d] text-gray-400">
                    {m.alphaMode}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono text-gray-300">
                  <div className="p-1 rounded bg-[#15171d] border border-[#252832]">
                    <span className="text-gray-400 block">Metal:</span>
                    <span>{m.metallic.toFixed(2)}</span>
                  </div>
                  <div className="p-1 rounded bg-[#15171d] border border-[#252832]">
                    <span className="text-gray-400 block">Rough:</span>
                    <span>{m.roughness.toFixed(2)}</span>
                  </div>
                  <div className="p-1 rounded bg-[#15171d] border border-[#252832]">
                    <span className="text-gray-400 block">Opacity:</span>
                    <span>{m.opacity.toFixed(2)}</span>
                  </div>
                </div>

                {/* Slots */}
                <div className="text-[10px] text-gray-400 space-y-0.5 pt-1 border-t border-[#262932]">
                  <div>Maps:</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(m.textureSlots).map(([slot, name]) => (
                      <span
                        key={slot}
                        className="px-1.5 py-0.5 rounded bg-[#242730] text-gray-300 font-mono text-[9px]"
                      >
                        {slot}: {name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Textures Section */}
          <div className="space-y-2 pt-2">
            <h4 className="font-semibold text-gray-300 uppercase tracking-wider text-[10px]">
              Textures ({textures.length})
            </h4>
            {textures.map((t) => (
              <div
                key={t.uuid}
                className="bg-[#1c1e24] border border-[#2c3039] rounded p-2 space-y-1 text-[11px]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-200">{t.name}</span>
                  <span
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                      t.width > 4096 || t.height > 4096
                        ? 'bg-rose-950 text-rose-300 border border-rose-800'
                        : 'bg-[#16181d] text-cyan-400'
                    }`}
                  >
                    {t.width} × {t.height}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono">
                  <span>Format: {t.format}</span>
                  <span>Est. VRAM: {formatBytes(t.uncompressedBytesEstimate)}</span>
                </div>
              </div>
            ))}
            {textures.length === 0 && (
              <div className="text-gray-400 text-center py-4">No embedded textures detected.</div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: SKELETON & RIGGING */}
      {activeTab === 'skeleton' && summary && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
          <div className="bg-[#1c1e24] border border-[#2d313a] rounded p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-semibold text-gray-200 uppercase tracking-wider text-[10px] text-cyan-400">
                Rigging Summary
              </h4>
              <span className="text-[9px] font-mono text-gray-500">SAFE PREVIEW TOOLS</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-gray-400 block text-[10px]">Skeletons:</span>
                <span className="font-mono font-bold text-gray-100">{summary.skeletonCount}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Bones:</span>
                <span className="font-mono font-bold text-gray-100">{summary.boneCount}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Skinned Meshes:</span>
                <span className="font-mono text-gray-300">{summary.skinnedMeshCount}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Animation Clips:</span>
                <span className="font-mono text-gray-300">{summary.clipCount}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-[#2b2f38]">
              <button
                onClick={() => onSetSkeletonVisible(!skeletonVisible)}
                className={`px-2 py-1 rounded border text-[10px] cursor-pointer ${
                  skeletonVisible
                    ? 'border-cyan-700 bg-cyan-950/30 text-cyan-300'
                    : 'border-[#343944] bg-[#202329] text-gray-300'
                }`}
              >
                Skeleton Overlay {skeletonVisible ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={() => onSetSkeletonXray(!skeletonXray)}
                className={`px-2 py-1 rounded border text-[10px] cursor-pointer ${
                  skeletonXray
                    ? 'border-violet-700 bg-violet-950/30 text-violet-300'
                    : 'border-[#343944] bg-[#202329] text-gray-300'
                }`}
              >
                X-Ray {skeletonXray ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={onResetPreviewPose}
                className="px-2 py-1 rounded border border-[#343944] bg-[#202329] text-gray-300 hover:text-white cursor-pointer text-[10px]"
              >
                Reset Bind Pose
              </button>
              <button
                disabled={selectedNode?.type !== 'SkinnedMesh'}
                onClick={onIsolateSelectedSkinnedMesh}
                className="px-2 py-1 rounded border border-[#343944] bg-[#202329] text-gray-300 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer text-[10px]"
              >
                Isolate Selected Skin
              </button>
            </div>
          </div>

          {selectedBoneInfo && (
            <div className="bg-[#1c1e24] border border-amber-900/60 rounded p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-semibold text-amber-300 uppercase tracking-wider text-[10px]">
                  Selected Bone
                </h4>
                <span className="font-mono text-[9px] text-gray-500">{selectedBoneInfo.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div><span className="text-gray-500 block">Parent</span><span className="text-gray-200">{selectedBoneInfo.parentName || '—'}</span></div>
                <div><span className="text-gray-500 block">Children</span><span className="text-gray-200">{selectedBoneInfo.childrenNames.length}</span></div>
              </div>
              {selectedBoneInfo.childrenNames.length > 0 && (
                <div className="text-[10px] text-gray-400 break-words">
                  Children: {selectedBoneInfo.childrenNames.join(', ')}
                </div>
              )}
              <div className="space-y-1 text-[9px] font-mono text-gray-400 border-t border-[#2b2f38] pt-2">
                <div>POS [{selectedBoneInfo.position.map((value) => value.toFixed(4)).join(', ')}]</div>
                <div>ROT [{selectedBoneInfo.rotation.map((value) => value.toFixed(4)).join(', ')}]</div>
                <div>SCL [{selectedBoneInfo.scale.map((value) => value.toFixed(4)).join(', ')}]</div>
              </div>
            </div>
          )}

          {skinInfluenceSummary && (
            <div className="bg-[#1c1e24] border border-[#2d313a] rounded p-2.5 space-y-2">
              <h4 className="font-semibold text-gray-300 uppercase tracking-wider text-[10px]">
                Skin Influence Summary
              </h4>
              <div className="text-[10px] text-gray-400">
                {skinInfluenceSummary.targetType}: <span className="text-gray-200">{skinInfluenceSummary.targetName}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div><span className="text-gray-500 block">Skinned Meshes</span><span>{skinInfluenceSummary.skinnedMeshCount}</span></div>
                <div><span className="text-gray-500 block">Vertices</span><span>{skinInfluenceSummary.vertexCount.toLocaleString()}</span></div>
                <div><span className="text-gray-500 block">Influenced</span><span>{skinInfluenceSummary.influencedVertices.toLocaleString()}</span></div>
                <div><span className="text-gray-500 block">Max Influences</span><span>{skinInfluenceSummary.maxInfluencesPerVertex}</span></div>
                <div><span className="text-gray-500 block">Avg Influences</span><span>{skinInfluenceSummary.averageInfluencesPerVertex.toFixed(2)}</span></div>
                {skinInfluenceSummary.averageWeight !== undefined && (
                  <div><span className="text-gray-500 block">Avg Bone Weight</span><span>{skinInfluenceSummary.averageWeight.toFixed(3)}</span></div>
                )}
              </div>
            </div>
          )}

          {summary.clips && summary.clips.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="font-semibold text-gray-300 uppercase tracking-wider text-[10px]">
                Clips & Root Motion
              </h4>
              {summary.clips.map((clip, clipIndex) => (
                <div
                  key={`${clipIndex}:${clip.name}`}
                  className="p-2 rounded bg-[#1c1e24] border border-[#2c3039] space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-100">{clip.name}</span>
                    <span className="text-gray-400 font-mono text-[10px]">
                      {clip.duration.toFixed(2)}s
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-[10px] font-mono">
                    <span
                      className={`px-1.5 py-0.5 rounded ${
                        clip.rootMotionDetected
                          ? 'bg-purple-950/70 border border-purple-800 text-purple-300'
                          : 'bg-[#16181d] text-gray-400'
                      }`}
                    >
                      {clip.rootMotionDetected
                        ? `ROOT TRANSLATION: ${clip.rootMotionTranslation}m`
                        : 'NO SIGNIFICANT ROOT MOTION'}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-[#16181d] text-gray-400">
                      TRACKS: {clip.trackCount}
                    </span>
                  </div>
                  <div className="text-[9px] text-gray-500 font-mono space-y-0.5">
                    <div>Root rotation delta: {clip.rootMotionRotation ?? 0}°</div>
                    {clip.rootMotionDelta && (
                      <div>
                        Translation vector: [{clip.rootMotionDelta.map((value) => value.toFixed(3)).join(', ')}]
                      </div>
                    )}
                    {clip.rootMotionTrackName && (
                      <div className="truncate" title={clip.rootMotionTrackName}>
                        Track: {clip.rootMotionTrackName}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: PERFORMANCE & LIGHTING */}
      {activeTab === 'performance' && summary && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
          {/* Runtime Cost — measurements live here, not in technical Health. */}
          <div className="bg-[#1c1e24] border border-[#2d313a] rounded p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-semibold text-gray-200 uppercase tracking-wider text-[10px] text-cyan-400">
                Runtime Cost
              </h4>
              <span className="text-[9px] text-gray-500 font-mono">MEASUREMENTS</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-gray-400 block text-[10px]">Triangles:</span>
                <span className="font-mono font-bold text-gray-100">
                  {summary.triangleCount.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Est. Draw Calls:</span>
                <span className="font-mono font-bold text-gray-100">
                  ~{summary.primitiveCount || summary.meshCount}
                </span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Materials:</span>
                <span className="font-mono text-gray-200">{summary.materialCount.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Texture Memory:</span>
                <span className="font-mono text-gray-200">{formatBytes(runtimeTextureMemory)}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Bones:</span>
                <span className="font-mono text-gray-200">{summary.boneCount.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Skinned Meshes:</span>
                <span className="font-mono text-gray-200">{summary.skinnedMeshCount.toLocaleString()}</span>
              </div>
            </div>
            <p className="text-[10px] leading-relaxed text-gray-500 border-t border-[#272b33] pt-2">
              These are runtime-cost measurements, not defects. Diagnostic Profiles may reinterpret the same values as target-fit warnings without changing the measurements.
            </p>
          </div>

          {fitnessIssues.length > 0 && (
            <div className="bg-[#1c1e24] border border-[#2d313a] rounded p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-semibold text-gray-200 uppercase tracking-wider text-[10px] text-cyan-400">
                  Profile Fit
                </h4>
                <span className="text-[9px] text-gray-500 font-mono">{fitnessIssues.length} RULE(S)</span>
              </div>
              <p className="text-[10px] leading-relaxed text-gray-500">
                Profile-dependent interpretation is kept separate from structural Health.
              </p>
              <div className="space-y-1.5">
                {fitnessIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="rounded border border-[#2c3039] bg-[#17191e] p-2 space-y-1"
                  >
                    <div className="flex items-start gap-2">
                      {getSeverityIcon(issue.severity)}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.2 text-[9px] font-bold rounded border uppercase font-mono ${getSeverityBadgeClass(
                              issue.severity
                            )}`}
                          >
                            {severityLabel(issue.severity, language)}
                          </span>
                          <span className="text-[9px] text-gray-500 font-mono uppercase">FITNESS</span>
                        </div>
                        <div className="mt-0.5 text-[11px] font-medium text-gray-200">{localizedIssue(issue).title}</div>
                      </div>
                    </div>
                    <p className="pl-6 text-[10px] leading-relaxed text-gray-400">{localizedIssue(issue).description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lighting Fine Tuning & Interactive Studio Controls */}
          <div className="bg-[#1c1e24] border border-[#2d313a] rounded p-2.5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-gray-200 uppercase tracking-wider text-[10px] text-cyan-400">
                {language === 'ru' ? 'Студийное освещение' : 'Studio Lighting Controls'}
              </h4>
              <button
                onClick={() => onUpdateLighting({ showLightBulb: !(lightingConfig.showLightBulb ?? true) })}
                className={`px-2 py-0.5 rounded text-[10px] font-medium border transition cursor-pointer flex items-center gap-1 ${
                  (lightingConfig.showLightBulb ?? true)
                    ? 'bg-amber-950/40 border-amber-600/70 text-amber-300'
                    : 'bg-[#15171d] border-[#343944] text-gray-400'
                }`}
                title={
                  language === 'ru'
                    ? 'Показать/скрыть 3D лампочку во вьюпорте (можно перетаскивать мышкой)'
                    : 'Toggle 3D light bulb gizmo in viewport (draggable with mouse)'
                }
              >
                <span>💡</span>
                <span>{(lightingConfig.showLightBulb ?? true) ? (language === 'ru' ? 'Лампочка: ВКЛ' : 'Bulb: ON') : (language === 'ru' ? 'Лампочка: ВЫКЛ' : 'Bulb: OFF')}</span>
              </button>
            </div>

            <div className="text-[10px] text-gray-400 leading-tight bg-[#15171d] p-1.5 rounded border border-[#262932]">
              {language === 'ru'
                ? '💡 Лампочку можно перетаскивать мышкой прямо во вьюпорте для живого изменения направления света!'
                : '💡 You can drag the glowing light bulb directly with the mouse inside the 3D viewport!'}
            </div>

            {/* Exposure */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-400">{language === 'ru' ? 'Экспозиция (Exposure):' : 'Exposure:'}</span>
                <span className="font-mono text-cyan-300">{lightingConfig.exposure.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="3.0"
                step="0.05"
                value={lightingConfig.exposure}
                onChange={(e) => onUpdateLighting({ exposure: Number(e.target.value) })}
                className="w-full h-1 accent-cyan-400 cursor-pointer"
              />
            </div>

            {/* Key Light Section */}
            <div className="border-t border-[#2a2d36] pt-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-gray-300">
                  {language === 'ru' ? 'Основной свет (Key Light)' : 'Key Light (Main)'}
                </span>
                <div className="flex items-center gap-1.5">
                  <label className="text-[9px] text-gray-400 flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={lightingConfig.castShadows ?? true}
                      onChange={(e) => onUpdateLighting({ castShadows: e.target.checked })}
                      className="accent-cyan-400 cursor-pointer w-3 h-3"
                    />
                    <span>{language === 'ru' ? 'Тени' : 'Shadows'}</span>
                  </label>
                  <input
                    type="color"
                    value={lightingConfig.keyColor || '#fffbf5'}
                    onChange={(e) => onUpdateLighting({ keyColor: e.target.value })}
                    className="w-5 h-5 rounded border border-[#3e4350] cursor-pointer bg-transparent"
                    title={language === 'ru' ? 'Цвет основного света' : 'Key light color'}
                  />
                </div>
              </div>

              {/* Color Presets */}
              <div className="flex items-center gap-1">
                {[
                  { name: 'Warm 2700K', color: '#ffdfad' },
                  { name: 'Daylight 6500K', color: '#ffffff' },
                  { name: 'Golden Hour', color: '#ff9d42' },
                  { name: 'Cool Sky', color: '#b8dcff' },
                  { name: 'Cyber Neon', color: '#00e5ff' },
                ].map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => onUpdateLighting({ keyColor: preset.color })}
                    className="w-4 h-4 rounded-full border border-[#3e4350] hover:scale-110 transition shrink-0"
                    style={{ backgroundColor: preset.color }}
                    title={preset.name}
                  />
                ))}
              </div>

              {/* Intensity Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-400">{language === 'ru' ? 'Интенсивность:' : 'Intensity:'}</span>
                  <span className="font-mono">{lightingConfig.keyIntensity.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="4.0"
                  step="0.05"
                  value={lightingConfig.keyIntensity}
                  onChange={(e) => onUpdateLighting({ keyIntensity: Number(e.target.value) })}
                  className="w-full h-1 accent-amber-400 cursor-pointer"
                />
              </div>

              {/* Key Light Position X, Y, Z */}
              <div className="space-y-1.5 bg-[#15171d] p-1.5 rounded border border-[#262932]">
                <div className="flex justify-between text-[9px] text-gray-400">
                  <span>{language === 'ru' ? 'Координаты лампочки:' : 'Light Position:'}</span>
                  <span className="font-mono text-cyan-400">
                    X: {lightingConfig.keyPosition?.[0]?.toFixed(1) ?? '5.0'} | Y: {lightingConfig.keyPosition?.[1]?.toFixed(1) ?? '8.0'} | Z: {lightingConfig.keyPosition?.[2]?.toFixed(1) ?? '5.0'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <div>
                    <span className="text-[8px] text-gray-500 block">X</span>
                    <input
                      type="range"
                      min="-20"
                      max="20"
                      step="0.5"
                      value={lightingConfig.keyPosition?.[0] ?? 5}
                      onChange={(e) => {
                        const cur = lightingConfig.keyPosition ?? [5, 8, 5];
                        onUpdateLighting({ keyPosition: [Number(e.target.value), cur[1], cur[2]] });
                      }}
                      className="w-full h-1 accent-red-400 cursor-pointer"
                    />
                  </div>
                  <div>
                    <span className="text-[8px] text-gray-500 block">Y (Высота)</span>
                    <input
                      type="range"
                      min="0.5"
                      max="25"
                      step="0.5"
                      value={lightingConfig.keyPosition?.[1] ?? 8}
                      onChange={(e) => {
                        const cur = lightingConfig.keyPosition ?? [5, 8, 5];
                        onUpdateLighting({ keyPosition: [cur[0], Number(e.target.value), cur[2]] });
                      }}
                      className="w-full h-1 accent-green-400 cursor-pointer"
                    />
                  </div>
                  <div>
                    <span className="text-[8px] text-gray-500 block">Z</span>
                    <input
                      type="range"
                      min="-20"
                      max="20"
                      step="0.5"
                      value={lightingConfig.keyPosition?.[2] ?? 5}
                      onChange={(e) => {
                        const cur = lightingConfig.keyPosition ?? [5, 8, 5];
                        onUpdateLighting({ keyPosition: [cur[0], cur[1], Number(e.target.value)] });
                      }}
                      className="w-full h-1 accent-blue-400 cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Fill Light */}
            <div className="border-t border-[#2a2d36] pt-2 space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-400">{language === 'ru' ? 'Заполняющий (Fill Light):' : 'Fill Light:'}</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono">{lightingConfig.fillIntensity.toFixed(2)}</span>
                  <input
                    type="color"
                    value={lightingConfig.fillColor || '#dce5ef'}
                    onChange={(e) => onUpdateLighting({ fillColor: e.target.value })}
                    className="w-4 h-4 rounded border border-[#3e4350] cursor-pointer bg-transparent"
                  />
                </div>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.5"
                step="0.05"
                value={lightingConfig.fillIntensity}
                onChange={(e) => onUpdateLighting({ fillIntensity: Number(e.target.value) })}
                className="w-full h-1 accent-blue-400 cursor-pointer"
              />
            </div>

            {/* Rim Light */}
            <div className="border-t border-[#2a2d36] pt-2 space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-400">{language === 'ru' ? 'Контурный (Rim Light):' : 'Rim Light:'}</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono">{lightingConfig.rimIntensity.toFixed(2)}</span>
                  <input
                    type="color"
                    value={lightingConfig.rimColor || '#ffffff'}
                    onChange={(e) => onUpdateLighting({ rimColor: e.target.value })}
                    className="w-4 h-4 rounded border border-[#3e4350] cursor-pointer bg-transparent"
                  />
                </div>
              </div>
              <input
                type="range"
                min="0.0"
                max="3.5"
                step="0.05"
                value={lightingConfig.rimIntensity}
                onChange={(e) => onUpdateLighting({ rimIntensity: Number(e.target.value) })}
                className="w-full h-1 accent-indigo-400 cursor-pointer"
              />
            </div>

            {/* Environment / Ambient */}
            <div className="border-t border-[#2a2d36] pt-2 space-y-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-400">{language === 'ru' ? 'Окружающий свет (Ambient):' : 'Ambient / Environment:'}</span>
                <span className="font-mono">{(lightingConfig.environmentIntensity ?? 0.5).toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.5"
                step="0.05"
                value={lightingConfig.environmentIntensity ?? 0.5}
                onChange={(e) => onUpdateLighting({ environmentIntensity: Number(e.target.value) })}
                className="w-full h-1 accent-cyan-500 cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
