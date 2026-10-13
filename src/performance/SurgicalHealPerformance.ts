import * as THREE from 'three';
import { SurgicalHealEngine } from '../heal/SurgicalHealEngine';
import { geometrySnapshotByteLength, type GeometrySnapshot } from '../heal/GeometrySnapshot';
import {
  estimateGeometryBytes,
  nowMs,
  performanceCore,
} from './PerformanceProfiler';

type RuntimePending =
  | {
      mutation: 'index-only';
      snapshot: GeometrySnapshot;
      replacementIndex: THREE.BufferAttribute;
    }
  | {
      mutation: 'geometry';
      snapshot: GeometrySnapshot;
      replacementGeometry: THREE.BufferGeometry;
    }
  | null;

type RuntimeUndo = {
  appliedSnapshot: GeometrySnapshot;
  restore:
    | { mutation: 'index-only'; previousIndex: THREE.BufferAttribute }
    | { mutation: 'geometry'; previousGeometry: THREE.BufferGeometry };
};

type RuntimeEngineStorage = {
  pending?: RuntimePending;
  undoStack?: RuntimeUndo[];
};

const verificationStarts = new WeakMap<SurgicalHealEngine, { operationId: string; startedAt: number }>();
let installed = false;

export function syncSurgicalHealMemory(engine: SurgicalHealEngine) {
  // TypeScript private fields are ordinary runtime properties here. This
  // instrumentation only reads their byte footprint; it never mutates repair state.
  const runtime = engine as unknown as RuntimeEngineStorage;
  const pending = runtime.pending ?? null;
  const undoStack = runtime.undoStack ?? [];

  let repairPreviewBytes = 0;
  if (pending) {
    repairPreviewBytes += geometrySnapshotByteLength(pending.snapshot);
    repairPreviewBytes += pending.mutation === 'index-only'
      ? pending.replacementIndex.array.byteLength
      : estimateGeometryBytes(pending.replacementGeometry);
  }

  let undoSnapshotsBytes = 0;
  for (const undo of undoStack) {
    undoSnapshotsBytes += geometrySnapshotByteLength(undo.appliedSnapshot);
    undoSnapshotsBytes += undo.restore.mutation === 'index-only'
      ? undo.restore.previousIndex.array.byteLength
      : estimateGeometryBytes(undo.restore.previousGeometry);
  }

  performanceCore.setMemory({ repairPreviewBytes, undoSnapshotsBytes });
}

/**
 * Performance-only decorator for SurgicalHealEngine. It does not alter repair
 * decisions, buffers, reports, or verification semantics; it observes method
 * boundaries and private runtime storage to measure F1/F4 costs.
 */
export function installSurgicalHealPerformanceInstrumentation() {
  if (installed) return;
  installed = true;

  const proto = SurgicalHealEngine.prototype as unknown as Record<string, (...args: any[]) => any>;
  const asEngine = (value: unknown) => value as SurgicalHealEngine;

  for(const method of ['applyPending','applyPendingAsync']) {
  const originalApplyPending = proto[method];
  proto[method] = function (...args: any[]) {
    const startedAt = nowMs();
    const result = originalApplyPending.apply(this, args);
    const engine = asEngine(this);
    const record=(result:any)=>{
    if (result?.success && result.report?.operationId) {
      verificationStarts.set(engine, {
        operationId: result.report.operationId,
        startedAt,
      });
    }
    syncSurgicalHealMemory(engine);
    return result;
    };
    return result instanceof Promise?result.then(record):record(result);
  };
  }

  const originalCompleteVerification = proto.completeVerification;
  proto.completeVerification = function (...args: any[]) {
    const operationId = args[0] as string;
    const result = originalCompleteVerification.apply(this, args);
    const engine = asEngine(this);
    const pending = verificationStarts.get(engine);
    if (pending?.operationId === operationId) {
      performanceCore.record('applyVerification', nowMs() - pending.startedAt);
      verificationStarts.delete(engine);
    }
    syncSurgicalHealMemory(engine);
    return result;
  };

  const originalUndoLast = proto.undoLast;
  proto.undoLast = function (...args: any[]) {
    const result = originalUndoLast.apply(this, args);
    syncSurgicalHealMemory(asEngine(this));
    return result;
  };

  const originalCancelPreview = proto.cancelPreview;
  proto.cancelPreview = function (...args: any[]) {
    const result = originalCancelPreview.apply(this, args);
    syncSurgicalHealMemory(asEngine(this));
    return result;
  };

  const originalClear = proto.clear;
  proto.clear = function (...args: any[]) {
    const engine = asEngine(this);
    verificationStarts.delete(engine);
    const result = originalClear.apply(this, args);
    syncSurgicalHealMemory(engine);
    return result;
  };
}
