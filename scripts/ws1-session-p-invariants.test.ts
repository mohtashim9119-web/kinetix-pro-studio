/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session P — PRODUCTION INVARIANTS over the live-fidelity bundle.
//
// These are not measurements. Each one asserts a property the shipped pipeline
// must hold on real production inputs, and each was RED before Session P's
// fixes landed:
//
//  1. R.12's OWN INVARIANT (Step 5b) — "no committed segment boundary may lie
//     strictly inside an unscripted run" (`faRunPlacementGate.ts`'s header,
//     first line). R.12 shipped in Session H reporting nine corrections, but
//     those nine were measured on a PRE-FILTERED token array. Production hands
//     it the RAW array, in which the rule's placement gap is empty by
//     construction, so it declined every run and its own invariant failed in
//     production with zero findings reported. This test asserts the invariant
//     against the real thing, so "R.12 is idle" can never again be mistaken
//     for "R.12 has nothing to do".
//
//  2. STRICT MONOTONIC BOUNDARY ORDERING (Step 8) — across every committed
//     boundary, after every rule has applied. Four rules now move boundaries
//     (R.11, R.12, R.13, and the R.10 coverage skip); each is individually
//     Model-P-conserving, but nothing until now asserted that their COMPOSITION
//     cannot produce a duplicate or inverted boundary. The 230-233 chain is the
//     specific worry — R.11 fires on 232 and 233, adjacent segments, and R.12's
//     231 neighbour sits between them.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { normalize } from '../src/services/whisperService';
import { CORPORA, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';
import type { TranscriptToken } from '../src/types';

const substantive = (t: TranscriptToken | undefined): boolean =>
  t !== undefined && normalize(t.text).length > 0;

describe('WS1 Session P — production invariants (v6 live bundle)', () => {
  const TIMEOUT = 900_000;

  it('R.12 invariant: no committed boundary lies strictly inside an unscripted run', async () => {
    const r = await runProductionPath(CORPORA.v6!);

    // The run's ACOUSTIC extent — first to last SUBSTANTIVE token. A run's raw
    // token span begins on the punctuation token that represents the pause
    // BEFORE the utterance, so the raw `startSec` is not where the unscripted
    // speech actually starts. The invariant is about speech, so it is stated
    // over speech. (This is the same distinction the fix inside
    // `detectRunPlacementDefects` makes; asserting it here in the raw span
    // instead would assert something the rule does not claim.)
    const acoustic = r.r5runs.map(run => {
      let lo = run.tokenLo;
      while (lo <= run.tokenHi && !substantive(r.whisperTokens[lo])) lo++;
      let hi = run.tokenHi;
      while (hi >= run.tokenLo && !substantive(r.whisperTokens[hi])) hi--;
      const on = r.whisperTokens[lo];
      const off = r.whisperTokens[hi];
      return on && off && lo <= hi
        ? { startSec: on.startSec, endSec: off.endSec }
        : { startSec: run.startSec, endSec: run.endSec };
    });

    const violations = r.committed.flatMap((s, i) => {
      if (i === 0) return [];
      return acoustic
        .filter(run => s.startTime > run.startSec + 1e-9 && s.startTime < run.endSec - 1e-9)
        .map(run => `seg ${i} ${tagOf(s)} boundary ${s.startTime.toFixed(2)} inside run [${run.startSec.toFixed(2)}, ${run.endSec.toFixed(2)}]`);
    });

    expect(violations, 'R.12 exists to make this set empty').toEqual([]);
  }, TIMEOUT);

  it('strict monotonic ordering across every committed boundary', async () => {
    const r = await runProductionPath(CORPORA.v6!);
    const problems: string[] = [];

    for (let i = 1; i < r.committed.length; i++) {
      const prev = r.committed[i - 1]!;
      const cur = r.committed[i]!;
      if (!(cur.startTime > prev.startTime)) {
        problems.push(`seg ${i} ${tagOf(cur)} start ${cur.startTime} is not strictly after seg ${i - 1} ${tagOf(prev)} start ${prev.startTime}`);
      }
      // Model P: the partition stays gapless AND non-overlapping.
      const prevEnd = prev.startTime + prev.duration;
      if (Math.abs(prevEnd - cur.startTime) > 1e-6) {
        problems.push(`seg ${i - 1}->${i} gap/overlap: prev end ${prevEnd} != next start ${cur.startTime}`);
      }
      if (!(cur.duration > 0)) {
        problems.push(`seg ${i} ${tagOf(cur)} has non-positive duration ${cur.duration}`);
      }
    }
    if (r.committed[0] && !(r.committed[0].duration > 0)) {
      problems.push(`seg 0 has non-positive duration ${r.committed[0].duration}`);
    }

    expect(problems, 'rule composition must never produce a duplicate or inverted boundary').toEqual([]);
    expect(r.committed.length).toBe(447);
  }, TIMEOUT);
});
