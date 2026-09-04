/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AJ-0 — the live-export oracle, installed as a REPORTING check.
//
// `scripts/fixtures/session-aj0-oracle-{v6,173,spanish}.json` is extracted
// straight from the operator's own saved project files
// (`.work-phase4/session-aj0/live/`), which the operator has ear-verified in
// full except the five named `openDefect` rows. It is RAW PIPELINE OUTPUT —
// no boundary was ever manually dragged (confirmed by the operator; see
// `docs/work-in-progress.md` §9 AJ-0) — so a clean production run at HEAD is
// expected to reproduce it almost exactly, and Session AJ-0's own measurement
// found exactly three small (~10ms) `knownMicroDrift` rows plus the five
// `openDefect` rows as the only departures across 620 compared boundaries.
//
// THIS IS A REPORTING CHECK, NOT A GATE. It prints every departure (index,
// tag, oracle value, fresh value, delta) and asserts only the structural
// invariants a legitimate run must never violate — same segment count, same
// tag order. A future session may promote it to a hard gate (fail on ANY
// boundary outside the openDefect/knownMicroDrift allowlist) once someone has
// decided what to do about the two 10ms ledger-vs-export drifts this session
// left unexplained. See docs/work-in-progress.md §9 AJ-0 for that decision.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CORPORA, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface OracleBoundary {
  index: number;
  tag: string;
  startTime: number;
  duration: number;
  openDefect?: boolean;
  earTarget?: number;
  knownMicroDrift?: string;
}
interface Oracle {
  segmentCount: number;
  boundaries: OracleBoundary[];
}

function loadOracle(key: string): Oracle {
  return JSON.parse(readFileSync(resolve(REPO, `scripts/fixtures/session-aj0-oracle-${key}.json`), 'utf-8'));
}

describe.each(['v6', '173', 'spanish'] as const)('AJ-0 oracle diff (reporting only) — %s', (key) => {
  it('diffs the production path at HEAD against the ear-verified live export', async () => {
    const oracle = loadOracle(key);
    const r = await runProductionPath(CORPORA[key]!);

    expect(r.committed.length).toBe(oracle.segmentCount);
    expect(r.committed.map(tagOf)).toEqual(oracle.boundaries.map(b => b.tag));

    const rows: string[] = [];
    let exact = 0;
    let allowlisted = 0;
    let unexplained = 0;

    oracle.boundaries.forEach((b, i) => {
      const fresh = r.committed[i]!;
      const delta = fresh.startTime - b.startTime;
      if (Math.abs(delta) < 1e-9) {
        exact++;
        return;
      }
      if (b.openDefect || b.knownMicroDrift) {
        allowlisted++;
        rows.push(
          `  [allowlisted] ${b.tag}: oracle=${b.startTime} fresh=${fresh.startTime} delta=${delta.toFixed(3)}` +
          (b.earTarget !== undefined ? ` (ear target ${b.earTarget})` : '') +
          (b.knownMicroDrift ? ` — ${b.knownMicroDrift}` : ''),
        );
      } else {
        unexplained++;
        rows.push(`  [UNEXPLAINED] ${b.tag}: oracle=${b.startTime} fresh=${fresh.startTime} delta=${delta.toFixed(3)}`);
      }
    });

    // eslint-disable-next-line no-console
    console.log(
      `\nAJ-0 oracle diff — ${key}: ${oracle.boundaries.length} compared, ` +
      `${exact} exact, ${allowlisted} allowlisted (openDefect/knownMicroDrift), ` +
      `${unexplained} unexplained.\n${rows.join('\n')}`,
    );

    // Reporting check only (see header): the only hard assertions are the two
    // structural ones above (segment count, tag order). Every value delta —
    // allowlisted or not — is printed above for a human to read; this check
    // does not fail the suite on an unexplained delta, by design.
  }, 180_000); // vitest harness only — v6 runProductionPath can exceed 120s under full-suite CPU load
});
