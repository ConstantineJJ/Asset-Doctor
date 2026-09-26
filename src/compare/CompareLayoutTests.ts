import { computeCompareLayout } from './CompareLayout';

export interface CompareLayoutTestResult {
  name: string;
  description: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export function runCompareLayoutTests(): CompareLayoutTestResult[] {
  const results: CompareLayoutTestResult[] = [];

  const test = (name: string, expected: string, check: () => { passed: boolean; actual: string }) => {
    const outcome = check();
    results.push({
      name,
      description: name,
      expected,
      actual: outcome.actual,
      passed: outcome.passed,
    });
  };

  test('Compare layout uses 3+2 for five assets', 'top row=3, bottom row=2', () => {
    const layout = computeCompareLayout(5, 1200, 800);
    const top = layout.filter((cell) => cell.y >= 400);
    const bottom = layout.filter((cell) => cell.y < 400);
    const passed =
      layout.length === 5 &&
      top.length === 3 &&
      bottom.length === 2 &&
      top.every((cell) => Math.abs(cell.width - 400) < 1e-6) &&
      bottom.every((cell) => Math.abs(cell.width - 600) < 1e-6);
    return { passed, actual: `top=${top.length}, bottom=${bottom.length}` };
  });

  test('Compare layout uses 2+1 for three assets', 'top row=2, bottom row=1', () => {
    const layout = computeCompareLayout(3, 900, 600);
    const top = layout.filter((cell) => cell.y >= 300);
    const bottom = layout.filter((cell) => cell.y < 300);
    const passed =
      layout.length === 3 &&
      top.length === 2 &&
      bottom.length === 1 &&
      Math.abs(bottom[0].width - 900) < 1e-6;
    return { passed, actual: `top=${top.length}, bottom=${bottom.length}, bottomWidth=${bottom[0]?.width}` };
  });

  test('Compare solo layout expands exactly one selected asset', 'one full-size rect with selected index', () => {
    const layout = computeCompareLayout(5, 1000, 700, 3);
    const cell = layout[0];
    const passed =
      layout.length === 1 &&
      cell.index === 3 &&
      cell.x === 0 &&
      cell.y === 0 &&
      cell.width === 1000 &&
      cell.height === 700;
    return { passed, actual: JSON.stringify(cell) };
  });

  test('Compare layout clamps unsupported asset counts to five', '5 cells maximum', () => {
    const layout = computeCompareLayout(99, 1000, 700);
    return { passed: layout.length === 5, actual: `${layout.length} cells` };
  });

  return results;
}
