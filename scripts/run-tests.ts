import { runSyntheticTopologyTests } from '../src/analysis/SyntheticTopologyTests';
import { runFileIOTests } from '../src/platform/FileIOTests';
import { runDiagnosticCoreTests } from '../src/analysis/DiagnosticCoreTests';
import { runDiagnosticCoverageTests } from '../src/analysis/DiagnosticCoverageTests';
import { runSourceFidelityTests } from '../src/analysis/SourceFidelityTests';
import { runCompareLayoutTests } from '../src/compare/CompareLayoutTests';
import { runGltfSourceAuditTests } from '../src/loaders/GltfSourceAuditTests';
import { runGLBLoaderServiceTests } from '../src/loaders/GLBLoaderServiceTests';
import { runAuthoredMaterialStateTests } from '../src/viewer/AuthoredMaterialStateTests';
import { runShadingModeTests } from '../src/viewer/ShadingModeTests';
import {
  runSurgicalHealIntegrationTests,
  runSurgicalHealTests,
} from '../src/heal/SurgicalHealTests';

async function main() {
  const results = [
    ...(await runFileIOTests()),
    ...runSyntheticTopologyTests(),
    ...runDiagnosticCoreTests(),
    ...runDiagnosticCoverageTests(),
    ...runSourceFidelityTests(),
    ...runCompareLayoutTests(),
    ...runGltfSourceAuditTests(),
    ...(await runGLBLoaderServiceTests()),
    ...runAuthoredMaterialStateTests(),
    ...runShadingModeTests(),
    ...runSurgicalHealTests(),
    ...(await runSurgicalHealIntegrationTests()),
  ];

  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.passed ? '' : `: ${result.actual} (expected ${result.expected})`}`);
  }
  console.log(`${results.filter(result => result.passed).length}/${results.length} PASSED`);
  if (results.some(result => !result.passed)) process.exitCode = 1;
}

void main();
