import {noMetrics,type MetricsSink} from '../performance/MetricsSink';
import {systemLog} from '../platform/SystemLog';
import * as THREE from 'three';
import { analyzeMeshTopology, type RawMeshData } from '../analysis/TopologyAnalyzer';
import type { TopologyPerformanceStats, TopologyStats } from '../types';
import { meshTopologyData } from '../analysis/MeshTopologyData';
import { documentMatrix } from '../viewer/AssetPresentation';
import { nowMs } from '../performance/PerformanceProfiler';

const WORKER_TASK_TIMEOUT_MS = 15000;
import {workerInputBudget} from '../performance/MemoryBudget';

export interface WorkerAnalysisOptions {
  signal?: AbortSignal;
  onMetrics?: (metrics: TopologyPerformanceStats) => void;
}

interface TopologyCacheEntry {
  geometry: THREE.BufferGeometry;
  positionArray: ArrayLike<number>;
  positionVersion: number;
  indexArray: ArrayLike<number> | null;
  indexVersion: number;
  matrixWorld: number[];
  stats: TopologyStats;
}

function abortError(): Error {
  const error = new Error('Topology analysis cancelled.');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function attributeVersion(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): number {
  return attribute instanceof THREE.InterleavedBufferAttribute
    ? attribute.data.version
    : attribute.version;
}

function arraysEqual(a: number[], b: THREE.Matrix4): boolean {
  const elements = b.elements;
  if (a.length !== elements.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== elements[i]) return false;
  }
  return true;
}

export class WorkerManager {
  private worker: Worker | null = null;
  private workerConstructionUnavailable = false;
  private disposed = false;
  private topologyCache = new WeakMap<THREE.Mesh, TopologyCacheEntry>();
  private activeAnalysisController: AbortController | null = null;

  constructor(private readonly metrics:MetricsSink=noMetrics) {
    this.createWorker();
  }

  private createWorker(): boolean {
    if (this.workerConstructionUnavailable || this.disposed) return false;
    try {
      this.worker = new Worker(new URL('./topology.worker.ts', import.meta.url), {
        type: 'module',
      });
      return true;
    } catch (e) {
      console.warn('Worker initialization fallback to async thread execution:', e);
      systemLog.record('warn','topology','worker_unavailable',{error:e});
      this.worker = null;
      this.workerConstructionUnavailable = true;
      return false;
    }
  }

  private restartWorker(): boolean {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    return this.createWorker();
  }

  private cacheHit(mesh: THREE.Mesh): TopologyStats | null {
    const cached = this.topologyCache.get(mesh);
    if (!cached) return null;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.index;
    if (
      cached.geometry !== geometry ||
      cached.positionArray !== position.array ||
      cached.positionVersion !== attributeVersion(position) ||
      cached.indexArray !== (index?.array ?? null) ||
      cached.indexVersion !== (index?.version ?? 0) ||
      !arraysEqual(cached.matrixWorld, documentMatrix(mesh))
    ) {
      return null;
    }
    return cached.stats;
  }

  private storeCache(mesh: THREE.Mesh, stats: TopologyStats) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.index;
    this.topologyCache.set(mesh, {
      geometry,
      positionArray: position.array,
      positionVersion: attributeVersion(position),
      indexArray: index?.array ?? null,
      indexVersion: index?.version ?? 0,
      matrixWorld: Array.from(documentMatrix(mesh).elements),
      stats,
    });
  }

  public clearCache() {
    this.topologyCache = new WeakMap<THREE.Mesh, TopologyCacheEntry>();
  }

  public cancelActiveAnalysis() {
    if (!this.activeAnalysisController) return;
    this.activeAnalysisController.abort();
    this.activeAnalysisController = null;
  }

  public async analyzeMeshes(
    root: THREE.Object3D,
    onProgress?: (completed: number, total: number) => void,
    options: WorkerAnalysisOptions = {}
  ): Promise<TopologyStats[]> {
    // A newer load / Rescan / post-repair pass owns the worker. Cancel the old
    // pass instead of letting it consume CPU and memory just to have App ignore
    // its stale result later.
    if (this.activeAnalysisController) {
      this.activeAnalysisController.abort();
      this.metrics.cancelAnalysisCycle?.();
    }
    const controller = new AbortController();
    this.activeAnalysisController = controller;
    const externalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', externalAbort, { once: true });
    const signal = controller.signal;

    if (options.signal?.aborted) controller.abort();
    if (signal.aborted) throw abortError();

    this.metrics.beginTopologyPhase?.(root.uuid);
    const topologyStageStart = nowMs();
    const operation=systemLog.begin('topology',{assetId:root.uuid,mode:this.worker?'worker':'fallback'});

    try {
      const meshes: THREE.Mesh[] = [];
      root.updateMatrixWorld(true);
      root.traverse((obj) => {
        if (obj.name?.startsWith('__ascope_internal_')) return;
        if (!(obj as THREE.Mesh).isMesh) return;
        const mesh = obj as THREE.Mesh;
        if (!mesh.geometry?.attributes.position) return;
        meshes.push(mesh);
      });

      const metrics: TopologyPerformanceStats = {
        meshCount: meshes.length,
        cacheHits: 0,
        cacheMisses: 0,
        extractionMs: 0,
        workerMs: 0,
        transferredBytes: 0,
      };
      const results: TopologyStats[] = [];
      if (meshes.length === 0) {
        options.onMetrics?.(metrics);
        this.metrics.setTopology?.(metrics);
        this.metrics.record('topologyWorker', nowMs() - topologyStageStart);
        this.metrics.completeAnalysisCycle?.(root.uuid);
        return results;
      }

      for (let i = 0; i < meshes.length; i++) {
        if (signal.aborted) throw abortError();
        const mesh = meshes[i];
        const cached = this.cacheHit(mesh);
        if (cached) {
          metrics.cacheHits++;
          results.push(cached);
          onProgress?.(i + 1, meshes.length);
          continue;
        }

        metrics.cacheMisses++;
        const releaseMemory=workerInputBudget.reserve(mesh.geometry.getAttribute('position').count*12+(mesh.geometry.index?.count??0)*4);
        try {
        const extractionStart = nowMs();
        let meshData = meshTopologyData(mesh);
        metrics.extractionMs += nowMs() - extractionStart;

        if (this.worker) {
          const transferBytes = meshData.positions.byteLength + (meshData.indices?.byteLength ?? 0);
          metrics.transferredBytes += transferBytes;
          const workerStart = nowMs();
          try {
            const stats = await this.sendToWorker(meshData, signal);
            metrics.workerMs += nowMs() - workerStart;
            results.push(stats);
            this.storeCache(mesh, stats);
          } catch (firstError) {
            metrics.workerMs += nowMs() - workerStart;
            if (isAbortError(firstError)) throw firstError;
            console.warn('Topology worker task failed; restarting worker once:', firstError);

            if (!this.restartWorker() || !this.worker) {
              throw new Error(
                'Topology worker failed and could not be restarted. Analysis stopped to keep the UI responsive.'
              );
            }

            // The first postMessage transfers (detaches) the temporary arrays. A
            // retry must re-extract from the live geometry instead of cloning all
            // meshes up front and retaining a second copy in memory.
            const retryExtractionStart = nowMs();
            meshData = meshTopologyData(mesh);
            metrics.extractionMs += nowMs() - retryExtractionStart;
            metrics.transferredBytes += meshData.positions.byteLength + (meshData.indices?.byteLength ?? 0);
            const retryStart = nowMs();
            try {
              const stats = await this.sendToWorker(meshData, signal);
              metrics.workerMs += nowMs() - retryStart;
              results.push(stats);
              this.storeCache(mesh, stats);
            } catch (retryError) {
              metrics.workerMs += nowMs() - retryStart;
              if (isAbortError(retryError)) throw retryError;
              console.warn('Topology worker retry failed; aborting this analysis pass:', retryError);
              if (this.worker) this.worker.terminate();
              this.worker = null;
              throw new Error(
                'Topology worker did not complete after retry. Analysis stopped instead of falling back to a blocking main-thread pass.'
              );
            }
          }
        } else {
          // Worker construction can be unavailable on some hosts. Preserve that
          // compatibility path, but yield before local analysis so UI state paints.
          await new Promise<void>((resolve) => setTimeout(resolve, 4));
          if (signal.aborted) throw abortError();
          const workerStart = nowMs();
          const stats = analyzeMeshTopology(meshData);
          metrics.workerMs += nowMs() - workerStart;
          results.push(stats);
          this.storeCache(mesh, stats);
        }

        } finally {releaseMemory();}
        onProgress?.(i + 1, meshes.length);
      }

      options.onMetrics?.(metrics);
      this.metrics.setTopology?.(metrics);
      this.metrics.record('topologyWorker', nowMs() - topologyStageStart);
      this.metrics.completeAnalysisCycle?.(root.uuid);
      return results;
    } catch (error) {
      operation.end(isAbortError(error)?'cancelled':'failed',{error});
      if (isAbortError(error)) this.metrics.cancelAnalysisCycle?.(root.uuid);
      throw error;
    } finally {
      operation.end('completed');
      options.signal?.removeEventListener('abort', externalAbort);
      if (this.activeAnalysisController === controller) this.activeAnalysisController = null;
    }
  }

  private sendToWorker(meshData: RawMeshData, signal?: AbortSignal): Promise<TopologyStats> {
    return new Promise((resolve, reject) => {
      if (!this.worker) return reject(new Error('Worker not available'));
      if (signal?.aborted) return reject(abortError());

      const taskId = `task_${Math.random().toString(36).slice(2, 9)}`;
      const worker = this.worker;
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);
        worker.removeEventListener('error', failed);
        worker.removeEventListener('messageerror', failed);
        signal?.removeEventListener('abort', aborted);
      };
      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const failed = () => finishReject(new Error('Topology worker task did not complete.'));
      const aborted = () => {
        // A worker executing a synchronous topology pass cannot service a cancel
        // message. Terminate it, then create a fresh worker for the newer run.
        if (this.worker === worker) {
          worker.terminate();
          this.worker = null;
          this.createWorker();
        }
        finishReject(abortError());
      };
      const timeout = setTimeout(failed, WORKER_TASK_TIMEOUT_MS);

      const handler = (e: MessageEvent) => {
        if (!e.data || e.data.taskId !== taskId || settled) return;
        settled = true;
        cleanup();
        if (e.data.success) resolve(e.data.stats);
        else reject(new Error(e.data.error || 'Worker task failed'));
      };

      worker.addEventListener('message', handler);
      worker.addEventListener('error', failed);
      worker.addEventListener('messageerror', failed);
      signal?.addEventListener('abort', aborted, { once: true });

      try {
        const transfer: Transferable[] = [meshData.positions.buffer as ArrayBuffer];
        if (meshData.indices) transfer.push(meshData.indices.buffer as ArrayBuffer);
        worker.postMessage({ taskId, meshData }, transfer);
      } catch (err) {
        finishReject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  public dispose() {
    this.disposed = true;
    this.cancelActiveAnalysis();
    this.clearCache();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
