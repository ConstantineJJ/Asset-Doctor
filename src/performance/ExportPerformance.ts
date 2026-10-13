import { RepairedExportService } from '../export/RepairedExportService';
import { performanceCore } from './PerformanceProfiler';

let installed = false;

/** Observe verified export boundaries without changing serialization semantics. */
export function installExportPerformanceInstrumentation() {
  if (installed) return;
  installed = true;

  const proto = RepairedExportService.prototype as unknown as Record<string, (...args: any[]) => any>;
  for(const method of ['exportAndVerify','exportAndVerifyInWorker']) {
  const original = proto[method];

  proto[method] = async function (...args: any[]) {
    const result = await original.apply(this, args);
    const perf = result?.performance;
    if (perf) {
      performanceCore.record('export', perf.exportMs);
      performanceCore.record('reopenVerification', perf.reopenVerificationMs);
      performanceCore.setMemory({
        exportBufferBytes: result.buffer?.byteLength ?? 0,
        pristineExportGeometryBytes: perf.pristineGeometryBytes,
        reopenedVerificationGeometryBytes: perf.reopenedGeometryBytes,
      });
    }
    return result;
  };
  }
}
