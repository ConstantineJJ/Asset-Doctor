import { readFileSync } from 'node:fs';
import {runBoundsTests} from '../src/viewer/BoundsTests';
import {runRigExportGuardTests} from '../src/rig/RigExportGuardTests';
import {runSystemLogTests} from '../src/platform/SystemLogTests';
import {runFloorTexturePoolTests} from '../src/viewer/FloorTexturePoolTests';
import {runShortcutTests} from '../src/platform/ShortcutTests';
import {runF08Tests} from '../src/performance/F08Tests';
import {runMemoryBudgetTests} from '../src/performance/MemoryBudgetTests';
import {runModelResourcesTests} from '../src/loaders/ModelResourcesTests';
import { runSyntheticTopologyTests } from '../src/analysis/SyntheticTopologyTests';
import { runRigEditTests } from '../src/rig/RigEditTests';
import { runRigExportTests } from '../src/rig/RigExportTests';
import { runRigVerificationTests } from '../src/rig/RigVerificationTests';
import { runRigStructureTests } from '../src/rig/RigStructureTests';
import { runRigRemovalTests } from '../src/rig/RigRemovalTests';
import {runRigFittingTests} from '../src/rig/RigFittingTests';
import { runFileIOTests } from '../src/platform/FileIOTests';
import { runDiagnosticCoreTests } from '../src/analysis/DiagnosticCoreTests';
import { runDiagnosticCoverageTests } from '../src/analysis/DiagnosticCoverageTests';
import {runDiagnosticReportTests} from '../src/diagnostics/DiagnosticReportTests';
import {runRigMemoryRegressionTests} from '../src/rig/RigMemoryRegressionTests';
import { runSourceFidelityTests } from '../src/analysis/SourceFidelityTests';
import { runCompareLayoutTests } from '../src/compare/CompareLayoutTests';
import { runCompareCloneTests } from '../src/compare/CompareCloneTests';
import { runComputeWorkerTests } from '../src/workers/ComputeWorkerTests';
import { runGltfSourceAuditTests } from '../src/loaders/GltfSourceAuditTests';
import { runGLBLoaderServiceTests } from '../src/loaders/GLBLoaderServiceTests';
import { runAuthoredMaterialStateTests } from '../src/viewer/AuthoredMaterialStateTests';
import { runShadingModeTests } from '../src/viewer/ShadingModeTests';
import { runAssetPresentationTests } from '../src/viewer/AssetPresentationTests';
import {
  runSurgicalHealIntegrationTests,
  runSurgicalHealTests,
} from '../src/heal/SurgicalHealTests';

async function main() {
  const results = [
    ...runBoundsTests(),
    ...(await runRigExportGuardTests()),
    ...runDiagnosticReportTests(),
    ...runRigMemoryRegressionTests(),
    ...(await runSystemLogTests()),
    ...(await runFloorTexturePoolTests()),
    ...runShortcutTests(),
    ...runF08Tests(),
    ...(await runMemoryBudgetTests()),
    ...runModelResourcesTests(),
    ...(await runRigEditTests()),
    ...(await runRigExportTests()),
    ...(await runRigVerificationTests()),
    ...(await runRigStructureTests()),
    ...(await runRigRemovalTests()),
    ...(await runRigFittingTests()),
    ...(await runFileIOTests()),
    ...runSyntheticTopologyTests(),
    ...runDiagnosticCoreTests(),
    ...runDiagnosticCoverageTests(),
    ...runSourceFidelityTests(),
    ...runCompareLayoutTests(),
    ...runCompareCloneTests(),
    ...(await runComputeWorkerTests()),
    ...runGltfSourceAuditTests(),
    ...(await runGLBLoaderServiceTests()),
    ...runAuthoredMaterialStateTests(),
    ...runShadingModeTests(),
    ...(await runAssetPresentationTests()),
    ...runSurgicalHealTests(),
    ...(await runSurgicalHealIntegrationTests(new Uint8Array(
      readFileSync('tests/browser/fixtures/two-scenes.glb')
    ).buffer)),
  ];

  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.passed ? '' : `: ${result.actual} (expected ${result.expected})`}`);
  }
  console.log(`${results.filter(result => result.passed).length}/${results.length} PASSED`);
  if (results.some(result => !result.passed)) process.exitCode = 1;
}

void main();
