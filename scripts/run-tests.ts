import { runSyntheticTopologyTests } from '../src/analysis/SyntheticTopologyTests';
import { runDiagnosticCoreTests } from '../src/analysis/DiagnosticCoreTests';
import { runDiagnosticCoverageTests } from '../src/analysis/DiagnosticCoverageTests';
import { runCompareLayoutTests } from '../src/compare/CompareLayoutTests';
import {
  runSurgicalHealIntegrationTests,
  runSurgicalHealTests,
} from '../src/heal/SurgicalHealTests';

async function main() {
  const results = [
    ...runSyntheticTopologyTests(),
    ...runDiagnosticCoreTests(),
    ...runDiagnosticCoverageTests(),
    ...runCompareLayoutTests(),
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
