import type {
  HealOperationReport,
  HealPreview,
  RepairQueueStatus,
} from '../types';
import type { RepairQueueCandidate } from './RepairQueue';

export type RepairQueueStopCode =
  | 'complete'
  | 'completeWithSkipped'
  | 'stoppedByUser'
  | 'assetChanged'
  | 'targetReturned'
  | 'applyFailed'
  | 'regressionStop'
  | 'partialStop'
  | 'guardStop';

export interface RepairQueueRunnerState {
  status: RepairQueueStatus;
  completed: number;
  skipped: number;
  remaining: number;
  currentOperation?: RepairQueueCandidate['operation'];
  currentMeshName?: string;
  stopCode?: RepairQueueStopCode;
}

export interface RepairQueueRunnerAdapter {
  getCandidates: () => RepairQueueCandidate[];
  preview: (candidate: RepairQueueCandidate) => HealPreview | null | Promise<HealPreview | null>;
  apply: (candidate: RepairQueueCandidate, preview: HealPreview) => Promise<HealOperationReport | null>;
  shouldStop: () => boolean;
  assetStillCurrent: () => boolean;
  yieldControl?: () => Promise<void>;
}

function terminal(
  status: RepairQueueStatus,
  completed: number,
  skipped: number,
  remaining: number,
  stopCode: RepairQueueStopCode,
  current?: RepairQueueCandidate
): RepairQueueRunnerState {
  return {
    status,
    completed,
    skipped,
    remaining,
    currentOperation: current?.operation,
    currentMeshName: current?.meshName,
    stopCode,
  };
}

/**
 * Deterministic Safe Repair Queue state machine.
 *
 * The runner never decides what is safe to repair. It only consumes registered
 * candidates, requires READY previews, re-reads diagnostics after every Apply,
 * stops on non-VERIFIED results, and refuses to run the same verified key twice.
 */
export async function runSafeRepairQueue(
  adapter: RepairQueueRunnerAdapter,
  onProgress?: (state: RepairQueueRunnerState) => void,
  maxPasses = 250
): Promise<RepairQueueRunnerState> {
  let completed = 0;
  let skipped = 0;
  const blockedKeys = new Set<string>();
  const completedKeys = new Set<string>();

  for (let pass = 0; pass < maxPasses; pass++) {
    await (adapter.yieldControl?.() ?? Promise.resolve());

    if (adapter.shouldStop()) {
      return terminal(
        'stopped',
        completed,
        skipped,
        adapter.getCandidates().length,
        'stoppedByUser'
      );
    }

    if (!adapter.assetStillCurrent()) {
      return terminal(
        'failed',
        completed,
        skipped,
        adapter.getCandidates().length,
        'assetChanged'
      );
    }

    const candidates = adapter
      .getCandidates()
      .filter((candidate) => !blockedKeys.has(candidate.key));

    if (candidates.length === 0) {
      return terminal(
        'completed',
        completed,
        skipped,
        0,
        skipped > 0 ? 'completeWithSkipped' : 'complete'
      );
    }

    let selected: RepairQueueCandidate | null = null;
    let selectedPreview: HealPreview | null = null;

    for (const candidate of candidates) {
      if (completedKeys.has(candidate.key)) {
        return terminal(
          'partial',
          completed,
          skipped,
          candidates.length,
          'targetReturned',
          candidate
        );
      }

      let preview:HealPreview|null;
      try {preview=await adapter.preview(candidate);}catch(error) {
        if(adapter.shouldStop() || !adapter.assetStillCurrent())return terminal('stopped',completed,skipped,candidates.length,adapter.assetStillCurrent()?'stoppedByUser':'assetChanged');
        throw error;
      }
      if(adapter.shouldStop() || !adapter.assetStillCurrent()) {
        return terminal('stopped',completed,skipped,candidates.length,adapter.assetStillCurrent()?'stoppedByUser':'assetChanged');
      }
      if (!preview || preview.status !== 'READY') {
        blockedKeys.add(candidate.key);
        skipped++;
        continue;
      }

      selected = candidate;
      selectedPreview = preview;
      break;
    }

    if (!selected || !selectedPreview) {
      return terminal(
        'completed',
        completed,
        skipped,
        0,
        skipped > 0 ? 'completeWithSkipped' : 'complete'
      );
    }

    onProgress?.({
      status: 'running',
      completed,
      skipped,
      remaining: candidates.length,
      currentOperation: selected.operation,
      currentMeshName: selected.meshName,
    });

    const report = await adapter.apply(selected, selectedPreview);
    if (!report) {
      return terminal(
        'failed',
        completed,
        skipped,
        candidates.length,
        'applyFailed',
        selected
      );
    }

    completedKeys.add(selected.key);

    if (report.status !== 'VERIFIED' || report.pipeline !== 'complete') {
      return terminal(
        report.status === 'REGRESSION'
          ? 'regression'
          : report.status === 'PARTIAL'
            ? 'partial'
            : 'failed',
        completed,
        skipped,
        adapter.getCandidates().length,
        report.status === 'REGRESSION' ? 'regressionStop' : 'partialStop',
        selected
      );
    }

    completed++;
    onProgress?.({
      status: 'running',
      completed,
      skipped,
      remaining: adapter.getCandidates().length,
    });
  }

  return terminal(
    'failed',
    completed,
    skipped,
    adapter.getCandidates().length,
    'guardStop'
  );
}
