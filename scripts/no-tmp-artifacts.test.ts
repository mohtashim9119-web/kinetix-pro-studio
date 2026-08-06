// Step Y (2026-08-07) — the K8 tripwire.
//
// WHY THIS FILE EXISTS. Four separate times, this programme has lost measurement
// artifacts because a harness kept them under /tmp, which macOS purges:
//   1. the original word-onset investigation's harness (the ~190ms figure) —
//      confirmed unrecoverable, docs/audit-verification-2026-08-03.md §C.7;
//   2. the Phase 3 Blocker-2 forced-alignment driver script;
//   3. /tmp/phase3/ holding BOTH English listening batches' private answer keys
//      (found at Step Q);
//   4. /tmp/phase3/'s raw transcripts and silence arrays, which broke the Step M
//      golden-baseline replay harness outright (found at Step X).
//
// Each time the response was a note in a document. A note does not fail. This
// does. It runs on every `npx vitest run`, so a new /tmp artifact dependency
// fails at the moment someone writes it — not weeks later when the file is gone
// and the context is too.
//
// WHERE ARTIFACTS BELONG: .work-phase4/ (working artifacts), .listening-clips/
// and .answer-keys/ (blinded batches). All gitignored, all inside the repo, all
// durable. `scripts/phase4-restore-replay-inputs.py` is the worked example.
//
// TWO RULES, deliberately different in strength:
//
//   RULE 1 — hard zero, no allowlist. Any *.test.ts under scripts/ or src/ runs
//   on every suite invocation. Those must not depend on /tmp at all. Enforced
//   against code only; comments may still discuss /tmp (this file does).
//
//   RULE 2 — a pinned ceiling per file. The legacy scripts/*.py measurement
//   tools were point-in-time runs whose /tmp paths are part of the historical
//   record; rewriting them buys nothing. Their occurrence counts are frozen
//   below. Adding one, or introducing /tmp in a new .py, fails. Removing one is
//   always fine — the numbers are ceilings, not equalities.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Frozen ceilings for the legacy Python measurement tools. Each entry is a
 * point-in-time script already run and reported; its /tmp paths are part of the
 * record of how that measurement was invoked. A NEW entry here needs a
 * deliberate decision, not a silent bump.
 */
const PY_TMP_CEILING: Record<string, number> = {
  // argparse help strings / docstrings naming where a prior run's inputs lived.
  'measure-forced-alignment.py': 1,
  'phase4-handoff-app-silence.py': 1, // Step Y note recording what was lost; its usage example now points at .work-phase4/
  'phase4-step-q-spanish-clips.py': 1,
  'phase4-step-w-trust.py': 1,
  'phase3-step-i-l-audit.py': 5,
  'phase4-restore-replay-inputs.py': 1,
  // A genuinely ephemeral HuggingFace download cache — re-downloadable by
  // definition, nothing is *lost* when it is purged.
  'measure-forced-alignment-hf.py': 1,
  // Phase 3 reference-validity + batch-2 clip exporters. Superseded for artifact
  // storage by .listening-clips/ + .answer-keys/ (Step Q); left as the record of
  // how those already-scored batches were produced.
  'phase3-reference-validity-step-a-sweep.py': 4,
  'phase3-reference-validity-step-b-phoneme.py': 1,
  'phase3-reference-validity-step-c-clips.py': 2,
  'phase3-step-h-fresh-batch-clips.py': 3,
};

const TMP_RE = /\/tmp\//g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Strips // line comments and block comments so a comment may still discuss /tmp. */
function stripTsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => {
      const i = line.indexOf('//');
      // Crude but sufficient here: no test file in this repo has a '//' inside a
      // string literal on a line that also matters for this scan. If that ever
      // changes, this over-strips and the rule gets *weaker*, never wrong-positive.
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

describe('K8 tripwire — no test may depend on /tmp for its artifacts', () => {
  it('RULE 1: no *.test.ts under scripts/ or src/ references /tmp in code', () => {
    const files = [
      ...walk(resolve(REPO, 'scripts')),
      ...walk(resolve(REPO, 'src')),
    ].filter(f => f.endsWith('.test.ts') || f.endsWith('.test.tsx'));

    expect(files.length).toBeGreaterThan(0); // the scan itself must not be vacuous

    const offenders: string[] = [];
    for (const f of files) {
      if (f === resolve(REPO, 'scripts/no-tmp-artifacts.test.ts')) continue; // this file
      const code = stripTsComments(readFileSync(f, 'utf-8'));
      const hits = code.match(TMP_RE);
      if (hits) offenders.push(`${relative(REPO, f)} (${hits.length} occurrence(s))`);
    }

    expect(
      offenders,
      'A test that runs on every `npx vitest run` references /tmp in code. macOS purges /tmp; ' +
      'this has broken this repo\'s harnesses four times (K8). Put the artifact under ' +
      '.work-phase4/ (gitignored, durable) and regenerate it from a committed source — see ' +
      'scripts/phase4-restore-replay-inputs.py and scripts/phase4-handoff-replay-sync.test.ts ' +
      'for the worked example.\nOffenders:\n' + offenders.join('\n'),
    ).toEqual([]);
  });

  it('RULE 2: no scripts/*.py gains a new /tmp path beyond its frozen ceiling', () => {
    const pyFiles = readdirSync(resolve(REPO, 'scripts')).filter(f => f.endsWith('.py'));
    expect(pyFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const name of pyFiles) {
      const count = (readFileSync(resolve(REPO, 'scripts', name), 'utf-8').match(TMP_RE) ?? []).length;
      const ceiling = PY_TMP_CEILING[name] ?? 0;
      if (count > ceiling) {
        violations.push(
          `${name}: ${count} /tmp path(s), ceiling ${ceiling}` +
          (ceiling === 0 ? ' (this file is not allowed any)' : ''),
        );
      }
    }

    expect(
      violations,
      'A scripts/*.py file gained a /tmp path. Artifacts a later session must re-read belong ' +
      'under .work-phase4/ / .listening-clips/ / .answer-keys/ — all gitignored, all durable, ' +
      'all inside the repo. If the path is genuinely throwaway scratch that nothing re-reads, ' +
      'raise that file\'s ceiling in PY_TMP_CEILING with a one-line reason.\nViolations:\n' +
      violations.join('\n'),
    ).toEqual([]);
  });
});
