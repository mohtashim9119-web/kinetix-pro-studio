#!/usr/bin/env node
/**
 * Durable failure record for a vitest (or cargo) suite run.
 *
 * A class of forensics that has now cost two WS3 rounds: a failing full-suite
 * run whose failing test names, files, durations, and arithmetic lived only
 * in a terminal buffer and were gone by the next session. This script is the
 * permanent, dependency-free fix.
 *
 * Usage:
 *   node scripts/ws3-record-test-run.mjs                  # vitest run
 *   node scripts/ws3-record-test-run.mjs -- src/foo.test.ts
 *   node scripts/ws3-record-test-run.mjs cargo            # cargo test
 *   node scripts/ws3-record-test-run.mjs cargo -- --features fa-inference
 *
 * Output (gitignored): `.ws3-test-failures/<utc>-<headsha>.json`
 * plus a copy at `.ws3-test-failures/latest.json`.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(REPO, '.ws3-test-failures');

function gitHead() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function writeRecord(record) {
  mkdirSync(OUT_DIR, { recursive: true });
  const name = `${record.startedAt.replace(/[:.]/g, '-')}-${record.headSha.slice(0, 12)}.json`;
  const dest = resolve(OUT_DIR, name);
  const latest = resolve(OUT_DIR, 'latest.json');
  const body = `${JSON.stringify(record, null, 2)}\n`;
  writeFileSync(dest, body);
  copyFileSync(dest, latest);
  return dest;
}

function runVitest(extraArgs) {
  const jsonPath = resolve(OUT_DIR, `_raw-${process.pid}.json`);
  mkdirSync(OUT_DIR, { recursive: true });
  const args = ['vitest', 'run', '--reporter=json', `--outputFile=${jsonPath}`, ...extraArgs];
  const startedAt = new Date().toISOString();
  const r = spawnSync('npx', args, { cwd: REPO, encoding: 'utf8', stdio: 'inherit' });
  const endedAt = new Date().toISOString();

  let raw = null;
  try {
    raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
    rmSync(jsonPath, { force: true });
  } catch {
    raw = null;
  }

  const tests = [];
  if (raw && Array.isArray(raw.testResults)) {
    for (const file of raw.testResults) {
      const filePath = file.name ?? file.assertionResults?.[0]?.ancestorTitles?.join(' ') ?? 'unknown';
      for (const t of file.assertionResults ?? []) {
        tests.push({
          status: t.status,
          title: [...(t.ancestorTitles ?? []), t.title].filter(Boolean).join(' > '),
          file: filePath,
          durationMs: t.duration ?? null,
        });
      }
    }
  }

  const failed = tests.filter((t) => t.status === 'failed' || t.status === 'fail');
  const passed = tests.filter((t) => t.status === 'passed' || t.status === 'pass');
  const skipped = tests.filter((t) => t.status === 'skipped' || t.status === 'pending');

  const record = {
    kind: 'vitest',
    startedAt,
    endedAt,
    headSha: gitHead(),
    exitCode: r.status,
    arithmetic: {
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      total: tests.length,
    },
    failing: failed.map((t) => ({
      name: t.title,
      file: t.file,
      durationMs: t.durationMs,
    })),
    allDurationsMs: tests.map((t) => ({ name: t.title, file: t.file, durationMs: t.durationMs, status: t.status })),
  };
  const dest = writeRecord(record);
  console.error(`ws3-record-test-run: wrote ${dest}`);
  console.error(`ws3-record-test-run: ${record.arithmetic.passed} passed / ${record.arithmetic.failed} failed / ${record.arithmetic.skipped} skipped`);
  return r.status ?? 1;
}

function runCargo(extraArgs) {
  const startedAt = new Date().toISOString();
  const r = spawnSync('cargo', ['test', ...extraArgs], {
    cwd: resolve(REPO, 'src-tauri'),
    encoding: 'utf8',
  });
  const endedAt = new Date().toISOString();
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');

  const failing = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^test (.*) \.\.\. FAILED/);
    if (m) failing.push({ name: m[1], file: null, durationMs: null });
  }
  const summary = out.match(/test result: .*?(\d+) passed; (\d+) failed; (\d+) ignored/);
  const record = {
    kind: 'cargo',
    startedAt,
    endedAt,
    headSha: gitHead(),
    exitCode: r.status,
    arithmetic: summary
      ? {
          passed: Number(summary[1]),
          failed: Number(summary[2]),
          skipped: Number(summary[3]),
          total: Number(summary[1]) + Number(summary[2]) + Number(summary[3]),
        }
      : { passed: null, failed: null, skipped: null, total: null },
    failing,
    args: extraArgs,
  };
  const dest = writeRecord(record);
  console.error(`ws3-record-test-run: wrote ${dest}`);
  return r.status ?? 1;
}

const argv = process.argv.slice(2);
if (argv[0] === 'cargo') {
  process.exit(runCargo(argv.slice(1)));
} else {
  const extra = argv[0] === '--' ? argv.slice(1) : argv;
  if (extra.length === 0) {
    console.error(
      'ws3-record-test-run: pass a vitest file/name filter, or `cargo`. Unfiltered vitest is coordinator-gated.',
    );
    process.exit(2);
  }
  process.exit(runVitest(extra));
}
