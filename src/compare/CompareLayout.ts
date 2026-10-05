import type { CompareViewportRect } from './CompareTypes';

/**
 * CSS-space compare layout. Y=0 starts at the bottom because WebGL viewport /
 * scissor coordinates use a bottom-left origin.
 *
 * Accepted layouts:
 * 2 -> 1 + 1
 * 3 -> 2 + 1
 * 4 -> 2 + 2
 * 5 -> 3 + 2
 */
export function computeCompareLayout(
  count: number,
  width: number,
  height: number,
  soloIndex: number | null = null
): CompareViewportRect[] {
  const safeCount = Math.max(0, Math.min(8, Math.floor(count)));
  if (safeCount === 0 || width <= 0 || height <= 0) return [];

  if (soloIndex !== null && soloIndex >= 0 && soloIndex < safeCount) {
    return [{ index: soloIndex, x: 0, y: 0, width, height }];
  }

  if (safeCount === 1) {
    return [{ index: 0, x: 0, y: 0, width, height }];
  }

  const rows: number[][] =
    safeCount === 2
      ? [[0, 1]]
      : safeCount === 3
        ? [[0, 1], [2]]
        : safeCount === 4
          ? [[0, 1], [2, 3]]
          : safeCount === 5
            ? [[0, 1, 2], [3, 4]]
            : safeCount === 6
              ? [[0, 1, 2], [3, 4, 5]]
              : safeCount === 7
                ? [[0, 1, 2, 3], [4, 5, 6]]
                : [[0, 1, 2, 3], [4, 5, 6, 7]];

  const rowHeight = height / rows.length;
  const result: CompareViewportRect[] = [];

  rows.forEach((row, rowFromTop) => {
    const cellWidth = width / row.length;
    const y = height - (rowFromTop + 1) * rowHeight;
    row.forEach((index, column) => {
      result.push({
        index,
        x: column * cellWidth,
        y,
        width: cellWidth,
        height: rowHeight,
      });
    });
  });

  return result;
}
