/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Per-step wall times for media/zip/bulk add. A sink is session-scoped and
 *  optional — production paths always mark; tests capture the buffer. */

export interface IngestStep {
  name: string;
  ms: number;
  bytes?: number;
}

let sink: IngestStep[] | null = null;

export function beginIngestTrace(): IngestStep[] {
  sink = [];
  return sink;
}

export function endIngestTrace(): IngestStep[] {
  const out = sink ?? [];
  sink = null;
  return out;
}

export function ingestTrace(): readonly IngestStep[] {
  return sink ?? [];
}

export function markIngest(name: string, ms: number, bytes?: number): void {
  sink?.push({ name, ms, bytes });
}

export async function timedIngest<T>(
  name: string,
  fn: () => Promise<T>,
  bytes?: number,
): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    markIngest(name, performance.now() - t0, bytes);
  }
}

export function summarizeIngest(steps: readonly IngestStep[]): string {
  if (steps.length === 0) return 'ingest: (no steps)';
  const ranked = [...steps].sort((a, b) => b.ms - a.ms);
  const total = steps.reduce((n, s) => n + s.ms, 0);
  const lines = ranked.map(s => {
    const mb = s.bytes !== undefined ? ` ${(s.bytes / (1024 * 1024)).toFixed(1)}MiB` : '';
    return `  ${s.ms.toFixed(1)}ms  ${s.name}${mb}`;
  });
  return `ingest ${total.toFixed(1)}ms total (slowest first)\n${lines.join('\n')}`;
}
