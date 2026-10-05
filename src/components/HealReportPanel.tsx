import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Trash2, X } from 'lucide-react';
import type { ExportVerificationReport, HealOperationReport, HealUndoState } from '../types';
import { healMetricKeys } from '../heal/HealVerification';
import { useI18n } from '../i18n';
import { getRepairOperation } from '../heal/framework/RepairRegistry';

interface Props {
  report: HealOperationReport | null;
  historical: boolean;
  busy: boolean;
  error: string | null;
  storageFailed: boolean;
  undoState: HealUndoState;
  onUndo: () => void;
  onDismiss: () => void;
  onClearHistory: () => void;
  exportReport: ExportVerificationReport | null;
  exportBusy: boolean;
  exportError: string | null;
  canExport: boolean;
  onBuildExport: () => void;
  onDownloadExport: () => void;
}

export function HealReportPanel({
  report,
  historical,
  busy,
  error,
  storageFailed,
  undoState,
  onUndo,
  onDismiss,
  onClearHistory,
  exportReport,
  exportBusy,
  exportError,
  canExport,
  onBuildExport,
  onDownloadExport,
}: Props) {
  const { t } = useI18n();
  const reportRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(historical);
  useEffect(() => {
    setCollapsed(historical);
    if (!historical) reportRef.current?.scrollIntoView({ block: 'nearest' });
  }, [report?.operationId, report?.status, report?.undoneAt, historical]);
  if (!report) return null;
  const operation = getRepairOperation(report.operation);
  const reportMetricKeys: Array<keyof typeof report.before> =
    report.operation === 'recalculate-normals'
      ? [...healMetricKeys, 'invalidNormals']
      : report.operation === 'normalize-skin-weights'
        ? [...healMetricKeys, 'invalidSkinWeights', 'zeroWeightVertices']
        : report.operation === 'consolidate-duplicate-skin-influences'
          ? [...healMetricKeys, 'invalidSkinWeights', 'zeroWeightVertices', 'redundantSkinInfluenceVertices']
          : [...healMetricKeys];
  const regressionDeltas = report.status === 'REGRESSION' && report.after
    ? reportMetricKeys.flatMap((key) => {
        const before = report.before[key];
        const after = report.after?.[key];
        if (typeof before !== 'number' || typeof after !== 'number' || before === after) return [];
        const delta = after - before;
        return [`${t(`heal.metrics.${String(key)}`)} ${delta > 0 ? '+' : ''}${delta}`];
      })
    : [];

  const color = report.status === 'REGRESSION' ? 'text-rose-300 border-rose-800'
    : report.status === 'VERIFIED' ? 'text-emerald-300 border-emerald-800' : 'text-amber-300 border-amber-800';
  return (
    <section ref={reportRef} aria-label={t('heal.lastOperation')} className={`bg-[#1c1e24] border rounded p-2.5 space-y-2 ${color}`}>
      <div className="flex justify-between gap-2 items-start">
        <button
          onClick={() => setCollapsed((value) => !value)}
          className="flex items-center gap-1 min-w-0 text-left cursor-pointer"
          title={collapsed ? t('heal.expand') : t('heal.collapse')}
        >
          {collapsed ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronUp className="w-3.5 h-3.5 shrink-0" />}
          <h3 className="text-[11px] font-semibold truncate">{t('heal.lastOperation')}</h3>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <strong role="status" className="text-[11px] font-mono">{report.status}</strong>
          {historical && (
            <button
              onClick={onClearHistory}
              className="p-0.5 text-gray-400 hover:text-rose-300 cursor-pointer"
              title={t('heal.clearHistory')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onDismiss}
            className="p-0.5 text-gray-400 hover:text-white cursor-pointer"
            title={t('heal.dismiss')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
      <div className="text-[10px] text-gray-300 break-words">
        {operation ? t(operation.labelKey) : report.operation} · {report.assetName} · {report.meshName}
      </div>
      <div className="text-[10px] text-gray-400 break-all">{report.appliedAt}</div>
      <p className="text-[11px]">{t(`heal.report.${report.status}`)}</p>
      {regressionDeltas.length > 0 && (
        <p className="text-[10px] font-mono text-rose-300">
          {t('heal.report.regressionSummary')}: {regressionDeltas.join(' · ')}
        </p>
      )}
      {historical && <p className="text-[11px] text-amber-300">{t('heal.report.historical')}</p>}
      {report.undoneAt && <p className="text-[11px] text-cyan-300">{t('heal.report.undone')}</p>}
      <p className="text-[10px] text-gray-400">
        {t(operation?.capabilities.exportPatch === 'geometry' ? 'heal.report.scopeGeometry' : 'heal.report.scopeIndex')}
      </p>
      <table className="w-full text-[10px] text-gray-300 tabular-nums">
        <caption className="text-left mb-1">{t('heal.report.measured')}</caption>
        <thead><tr>
          <th className="text-left">{t('heal.report.metric')}</th>
          <th>{t('heal.report.before')}</th><th>{t('heal.report.after')}</th><th>{t('heal.report.delta')}</th>
        </tr></thead>
        <tbody>{reportMetricKeys.map(key => {
          const before = report.before[key];
          const after = report.after?.[key];
          const delta =
            typeof before === 'number' && typeof after === 'number'
              ? after - before
              : null;
          return <tr key={String(key)} className="border-t border-gray-800">
            <th className="text-left font-normal py-0.5">{t(`heal.metrics.${String(key)}`)}</th>
            <td className="text-center">{before ?? t('heal.report.unavailable')}</td>
            <td className="text-center">{after ?? t('heal.report.unavailable')}</td>
            <td className="text-center">{delta === null ? '—' : delta > 0 ? `+${delta}` : delta}</td>
          </tr>;
        })}</tbody>
      </table>
      {report.reasons.map(reason => <p key={reason} className="text-[10px]">{t(`heal.reasons.${reason}`)}</p>)}
      <p className="text-[10px] text-gray-400">{t(`heal.report.pipeline_${report.pipeline}`)}</p>
      {storageFailed && <p role="alert" className="text-[11px] text-amber-300">{t('heal.report.storageFailed')}</p>}
      {error && <p role="alert" className="text-[11px] text-rose-300">{error}</p>}
      {undoState.available && <button onClick={onUndo} disabled={busy}
        className="px-2 py-1 border rounded text-[11px] disabled:opacity-40 cursor-pointer">
        {t('heal.undo')} · {undoState.meshName}
      </button>}

      {!historical && (
        <div className="pt-2 mt-1 border-t border-gray-800 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-cyan-300">
                {t('export.title')}
              </div>
              <div className="text-[9px] text-gray-400">
                {t('export.subtitle')}
              </div>
            </div>
            {!exportReport && (
              <button
                onClick={onBuildExport}
                disabled={!canExport || exportBusy || busy}
                className="px-2 py-1 rounded border border-cyan-800 bg-cyan-950/30 text-cyan-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-[10px]"
              >
                {exportBusy ? t('export.verifying') : t('export.build')}
              </button>
            )}
          </div>

          {exportReport && (
            <div className={`rounded border p-2 space-y-1.5 ${
              exportReport.status === 'VERIFIED'
                ? 'border-emerald-800/70 bg-emerald-950/10'
                : exportReport.status === 'REGRESSION' || exportReport.status === 'FAILED'
                  ? 'border-rose-800/70 bg-rose-950/10'
                  : 'border-amber-800/70 bg-amber-950/10'
            }`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-gray-200">
                  {exportReport.exportedName}
                </span>
                <strong className={`text-[10px] font-mono ${
                  exportReport.status === 'VERIFIED'
                    ? 'text-emerald-300'
                    : exportReport.status === 'REGRESSION' || exportReport.status === 'FAILED'
                      ? 'text-rose-300'
                      : 'text-amber-300'
                }`}>
                  {exportReport.status}
                </strong>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px] text-gray-400 tabular-nums">
                <span>{t('export.metrics.repairs')}</span>
                <span className="text-right text-gray-200">{exportReport.repairCount}</span>
                <span>{t('export.metrics.repairedMeshes')}</span>
                <span className="text-right text-gray-200">{exportReport.repairedMeshCount}</span>
                <span>{t('export.metrics.totalTriangles')}</span>
                <span className="text-right text-gray-200">
                  {exportReport.triangleCountExpected} → {exportReport.triangleCountActual}
                </span>
                <span>{t('export.metrics.targetTriangles')}</span>
                <span className="text-right text-gray-200">
                  {exportReport.targetTrianglesExpected} → {exportReport.targetTrianglesActual}
                </span>
                <span>{t('export.metrics.degenerates')}</span>
                <span className="text-right text-gray-200">
                  {exportReport.targetDegeneratesExpected} → {exportReport.targetDegeneratesActual}
                </span>
                <span>{t('export.metrics.targetVertices')}</span>
                <span className="text-right text-gray-200">
                  {exportReport.targetVerticesExpected} → {exportReport.targetVerticesActual}
                </span>
                <span>{t('export.metrics.unreferenced')}</span>
                <span className="text-right text-gray-200">
                  {exportReport.targetUnreferencedExpected} → {exportReport.targetUnreferencedActual}
                </span>
                <span>{t('export.metrics.invalidNormals')}</span>
                <span className="text-right text-gray-200">
                  {exportReport.targetInvalidNormalsExpected} → {exportReport.targetInvalidNormalsActual}
                </span>
                <span>{t('export.metrics.duplicatePositions')}</span>
                <span className="text-right text-gray-200">
                  {exportReport.targetDuplicatePositionsExpected} → {exportReport.targetDuplicatePositionsActual}
                </span>
                <span>{t('export.metrics.duplicateTriangles')}</span>
                <span className="text-right text-gray-200">
                  {exportReport.targetDuplicateTrianglesExpected} → {exportReport.targetDuplicateTrianglesActual}
                </span>
                <span>{t('export.metrics.invalidSkinWeights')}</span>
                <span className="text-right text-gray-200">
                  {exportReport.targetInvalidSkinWeightsExpected} → {exportReport.targetInvalidSkinWeightsActual}
                </span>
                <span>{t('export.metrics.redundantSkinInfluences')}</span>
                <span className="text-right text-gray-200">
                  {exportReport.targetRedundantSkinInfluencesExpected} → {exportReport.targetRedundantSkinInfluencesActual}
                </span>
                <span>{t('export.metrics.meshes')}</span>
                <span className="text-right text-gray-200">
                  {exportReport.meshCountExpected} → {exportReport.meshCountActual}
                </span>
                <span>{t('export.metrics.materials')}</span>
                <span className="text-right text-gray-200">
                  {exportReport.materialCountExpected} → {exportReport.materialCountActual}
                </span>
                <span>{t('export.metrics.textures')}</span>
                <span className="text-right text-gray-200">
                  {exportReport.textureCountExpected} → {exportReport.textureCountActual}
                </span>
                <span>{t('export.metrics.bones')}</span>
                <span className="text-right text-gray-200">
                  {exportReport.boneCountExpected} → {exportReport.boneCountActual}
                </span>
                <span>{t('export.metrics.animations')}</span>
                <span className="text-right text-gray-200">
                  {exportReport.clipCountExpected} → {exportReport.clipCountActual}
                </span>
              </div>

              {exportReport.reasons.length > 0 && (
                <div className="text-[9px] text-rose-300 break-words">
                  {exportReport.reasons.map((reason) => t(`export.reasons.${reason}`)).join(' · ')}
                </div>
              )}

              <div className="flex items-center gap-1.5 pt-1">
                {exportReport.status === 'VERIFIED' && (
                  <button
                    onClick={onDownloadExport}
                    disabled={exportBusy || busy}
                    className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-medium cursor-pointer text-[10px]"
                  >
                    {t('export.download')}
                  </button>
                )}
                <button
                  onClick={onBuildExport}
                  disabled={!canExport || exportBusy || busy}
                  className="px-2 py-1 rounded border border-[#3b414d] bg-[#22252c] text-gray-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-[10px]"
                >
                  {exportBusy ? t('export.verifying') : t('export.rebuild')}
                </button>
              </div>
            </div>
          )}

          {exportError && <p role="alert" className="text-[10px] text-rose-300">{exportError}</p>}
        </div>
      )}
        </>
      )}
    </section>
  );
}
