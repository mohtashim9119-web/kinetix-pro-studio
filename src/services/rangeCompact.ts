/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compacts 1-based positions into human-readable ranges.
 * [7,8,9,10,23,78,79] -> "7–10, 23, 78–79". Runs of exactly 2 render as
 * two singles ("7, 8"). Handles unsorted/duplicate input defensively.
 */
export function compactRanges(numbers: number[]): string {
  const sorted = Array.from(new Set(numbers)).sort((a, b) => a - b);
  if (sorted.length === 0) return '';

  const parts: string[] = [];
  let runStart = sorted[0] as number;
  let runEnd = runStart;

  const flush = (): void => {
    const runLength = runEnd - runStart + 1;
    if (runLength >= 3) {
      parts.push(`${runStart}–${runEnd}`);
    } else {
      for (let n = runStart; n <= runEnd; n++) parts.push(String(n));
    }
  };

  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i] as number;
    if (n === runEnd + 1) {
      runEnd = n;
    } else {
      flush();
      runStart = n;
      runEnd = n;
    }
  }
  flush();

  return parts.join(', ');
}
