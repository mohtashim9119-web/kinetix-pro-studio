/**
 * Durable vitest failure record.
 *
 * A failing suite run writes failing test names, file paths, durations, and
 * the run's arithmetic to a gitignored path under the repo, keyed by timestamp
 * and HEAD SHA. This is the permanent fix for a class of bug that has now
 * cost two rounds of forensics (unrecoverable test identities after a red
 * npm test with no surviving terminal output).
 *
 * Output: `.ws3-test-failures/<ISO-timestamp>-<sha>.json` (and `latest.json`).
 * Read: `cat .ws3-test-failures/latest.json` or `npm run test:record`.
 * Success writes nothing. Never throws — a reporter bug must not fail a run.
 */

import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(REPO, '.ws3-test-failures');

interface FailureRow {
  name: string;
  file: string;
  durationMs: number | null;
  errors: string[];
}

function gitHead(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function collectTests(node: unknown, file: string, rows: {
  passed: number;
  failed: number;
  skipped: number;
  failures: FailureRow[];
}): void {
  if (node === null || typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  const children = rec.children;
  if (children && typeof children === 'object' && 'allTests' in children) {
    const allTests = (children as { allTests?: () => unknown[] }).allTests;
    if (typeof allTests === 'function') {
      for (const test of allTests()) {
        collectTests(test, file, rows);
      }
      return;
    }
  }
  const resultFn = rec.result;
  const result = typeof resultFn === 'function'
    ? resultFn.call(node) as Record<string, unknown> | undefined
    : rec.result as Record<string, unknown> | undefined;
  const state = typeof result?.state === 'string' ? result.state : typeof rec.ok === 'function'
    ? ((rec.ok as () => boolean)() ? 'passed' : 'failed')
    : null;
  if (state === 'passed') rows.passed += 1;
  else if (state === 'skipped' || state === 'pending') rows.skipped += 1;
  else if (state === 'failed') {
    rows.failed += 1;
    const errors = Array.isArray(result?.errors)
      ? (result.errors as Array<{ message?: string }>).map((e) => e.message ?? String(e))
      : [];
    rows.failures.push({
      name: String(rec.fullName ?? rec.name ?? 'unknown'),
      file,
      durationMs: typeof result?.duration === 'number' ? result.duration : null,
      errors,
    });
  }
}

class DurableFailureRecordReporter {
  onTestRunEnd(testModules: readonly unknown[], unhandledErrors: readonly unknown[]): void {
    try {
      const rows = { passed: 0, failed: 0, skipped: 0, failures: [] as FailureRow[] };
      for (const mod of testModules) {
        const file = typeof mod === 'object' && mod !== null && 'moduleId' in mod
          ? String((mod as { moduleId: string }).moduleId)
          : 'unknown';
        collectTests(mod, file, rows);
      }
      if (rows.failed === 0 && unhandledErrors.length === 0) {
        return;
      }
      mkdirSync(OUT_DIR, { recursive: true });
      const sha = gitHead();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const payload = {
        recordedAt: new Date().toISOString(),
        headSha: sha,
        arithmetic: {
          passed: rows.passed,
          failed: rows.failed,
          skipped: rows.skipped,
          unhandledErrors: unhandledErrors.length,
          executed: rows.passed + rows.failed + rows.skipped,
        },
        failures: rows.failures,
        unhandledErrors: unhandledErrors.map((e) => (e instanceof Error ? e.message : String(e))),
      };
      const dest = resolve(OUT_DIR, `${stamp}-${sha.slice(0, 12)}.json`);
      writeFileSync(dest, `${JSON.stringify(payload, null, 2)}\n`);
      copyFileSync(dest, resolve(OUT_DIR, 'latest.json'));
    } catch {
      // never fail the suite
    }
  }
}

export default DurableFailureRecordReporter;
