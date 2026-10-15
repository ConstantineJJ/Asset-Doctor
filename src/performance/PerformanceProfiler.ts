import * as THREE from 'three';
import type {
  PerformanceCoreProfile,
  PerformanceMemoryStats,
  PerformanceStageId,
  PerformanceTimingSample,
  TopologyPerformanceStats,
} from '../types';

export interface BrowserMemoryInfo {
  usedJSHeapSize?: number;
  jsHeapSizeLimit?: number;
}

export function createEmptyPerformanceProfile(): PerformanceCoreProfile {
  return {
    timings: {},
    topology: {
      meshCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
      extractionMs: 0,
      workerMs: 0,
      transferredBytes: 0,
    },
    memory: {
      sourceGlbBytes: 0,
      liveGeometryBytes: 0,
      undoSnapshotsBytes: 0,
      repairPreviewBytes: 0,
      exportBufferBytes: 0,
      pristineExportGeometryBytes: 0,
      reopenedVerificationGeometryBytes: 0,
    },
    cancelledAnalyses: 0,
  };
}

export function addTimingSample(
  profile: PerformanceCoreProfile,
  stage: PerformanceStageId,
  durationMs: number
): PerformanceCoreProfile {
  if (!Number.isFinite(durationMs) || durationMs < 0) return profile;
  const previous = profile.timings[stage];
  const next: PerformanceTimingSample = previous
    ? {
        lastMs: durationMs,
        bestMs: Math.min(previous.bestMs, durationMs),
        worstMs: Math.max(previous.worstMs, durationMs),
        averageMs: (previous.averageMs * previous.samples + durationMs) / (previous.samples + 1),
        samples: previous.samples + 1,
      }
    : {
        lastMs: durationMs,
        bestMs: durationMs,
        worstMs: durationMs,
        averageMs: durationMs,
        samples: 1,
      };

  return {
    ...profile,
    timings: { ...profile.timings, [stage]: next },
  };
}

export function replaceTopologyPerformance(
  profile: PerformanceCoreProfile,
  topology: TopologyPerformanceStats
): PerformanceCoreProfile {
  return { ...profile, topology };
}

export function updateMemoryStats(
  profile: PerformanceCoreProfile,
  memory: Partial<PerformanceMemoryStats>
): PerformanceCoreProfile {
  return {
    ...profile,
    memory: { ...profile.memory, ...memory },
  };
}

export function estimateGeometryBytes(geometry: THREE.BufferGeometry,seen=new Set<ArrayBufferLike>()): number {
  let bytes = 0;
  const addAttribute = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
    const array = attribute.array;
    if (!seen.has(array.buffer)) {
      seen.add(array.buffer);
      bytes += array.buffer.byteLength;
    }
  };

  Object.values(geometry.attributes).forEach(addAttribute);
  Object.values(geometry.morphAttributes).forEach((attributes) => attributes.forEach(addAttribute));
  if (geometry.index) addAttribute(geometry.index);
  return bytes;
}

export function estimateObjectGeometryBytes(root: THREE.Object3D | null): number {
  if (!root) return 0;
  const seen = new Set<ArrayBufferLike>();
  let bytes = 0;
  root.traverse((object) => {
    const drawable=object as THREE.Mesh|THREE.Line|THREE.Points;
    if(!('geometry' in drawable)||!drawable.geometry?.isBufferGeometry)return;
    bytes += estimateGeometryBytes(drawable.geometry,seen);
  });
  return bytes;
}

export function readBrowserHeap(): BrowserMemoryInfo {
  const perf = performance as Performance & { memory?: BrowserMemoryInfo };
  return {
    usedJSHeapSize: perf.memory?.usedJSHeapSize,
    jsHeapSizeLimit: perf.memory?.jsHeapSizeLimit,
  };
}

export function nowMs(): number {
  return performance.now();
}

type Listener = () => void;

interface PendingAnalysisCycle {
  rootUuid: string;
  startedAt: number;
  seenBefore: boolean;
}

/**
 * F1/F4 measurement store. It deliberately records observations only; it never
 * changes Health/Fitness verdicts. A stable immutable snapshot is exposed for UI
 * and for `window.__ASSET_DOCTOR_PERF__` during heavy-asset profiling.
 */
class PerformanceCoreStore {
  private profile = createEmptyPerformanceProfile();
  private listeners = new Set<Listener>();
  private pendingAnalysis: PendingAnalysisCycle | null = null;
  private completedRoots = new Set<string>();

  public getSnapshot = (): PerformanceCoreProfile => this.profile;

  public subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(profile: PerformanceCoreProfile) {
    this.profile = profile;
    const heap = readBrowserHeap();
    if (heap.usedJSHeapSize !== undefined || heap.jsHeapSizeLimit !== undefined) {
      this.profile = updateMemoryStats(this.profile, {
        jsHeapUsedBytes: heap.usedJSHeapSize,
        jsHeapLimitBytes: heap.jsHeapSizeLimit,
      });
    }
    if (typeof window !== 'undefined') {
      (window as Window & { __ASSET_DOCTOR_PERF__?: PerformanceCoreProfile }).__ASSET_DOCTOR_PERF__ = this.profile;
    }
    this.listeners.forEach((listener) => listener());
  }

  public resetForAsset(sourceGlbBytes = 0, liveGeometryBytes = 0) {
    this.pendingAnalysis = null;
    this.completedRoots.clear();
    this.profile = createEmptyPerformanceProfile();
    this.profile = updateMemoryStats(this.profile, { sourceGlbBytes, liveGeometryBytes });
    this.publish(this.profile);
  }

  public record(stage: PerformanceStageId, durationMs: number) {
    this.publish(addTimingSample(this.profile, stage, durationMs));
  }

  public setTopology(metrics: TopologyPerformanceStats) {
    this.publish(replaceTopologyPerformance(this.profile, metrics));
  }

  public setMemory(memory: Partial<PerformanceMemoryStats>) {
    this.publish(updateMemoryStats(this.profile, memory));
  }

  public incrementCancelledAnalyses() {
    this.publish({ ...this.profile, cancelledAnalyses: this.profile.cancelledAnalyses + 1 });
  }

  /** Called by GeometryAnalyzer. It is only committed as a real pipeline cycle if WorkerManager follows. */
  public noteGeometryPassStart(rootUuid: string) {
    this.pendingAnalysis = {
      rootUuid,
      startedAt: nowMs(),
      seenBefore: this.completedRoots.has(rootUuid),
    };
  }

  /** Called immediately before the heavy worker stage begins. */
  public beginTopologyPhase(rootUuid: string) {
    const cycle = this.pendingAnalysis;
    if (!cycle || cycle.rootUuid !== rootUuid) return;
    if (!cycle.seenBefore) {
      this.record('firstDiagnosticPass', nowMs() - cycle.startedAt);
    }
  }

  /** Called after a complete worker result has been accepted for the same root. */
  public completeAnalysisCycle(rootUuid: string) {
    const cycle = this.pendingAnalysis;
    if (!cycle || cycle.rootUuid !== rootUuid) return;
    if (cycle.seenBefore) {
      this.record('rescan', nowMs() - cycle.startedAt);
    }
    this.completedRoots.add(rootUuid);
    this.pendingAnalysis = null;
  }

  public cancelAnalysisCycle(rootUuid?: string) {
    if (!this.pendingAnalysis) return;
    if (rootUuid && this.pendingAnalysis.rootUuid !== rootUuid) return;
    this.pendingAnalysis = null;
    this.incrementCancelledAnalyses();
  }
}

export const performanceCore = new PerformanceCoreStore();

if (typeof window !== 'undefined') {
  (window as Window & { __ASSET_DOCTOR_PERF__?: PerformanceCoreProfile }).__ASSET_DOCTOR_PERF__ =
    performanceCore.getSnapshot();
}
