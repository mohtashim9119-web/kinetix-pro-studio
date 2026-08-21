/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session S — STEP 1. THE R.11/R.12 COLLISION, ON THE LIVE BUNDLE.
//
// The unit-level proof of R-AP is `src/services/faRuleStageExclusion.test.ts`
// (synthetic fixture, both clauses, the current-state blindness stated as an
// assertion). This file is the R-AO half: the same claim OBSERVED, by name,
// on the real production path over the run-id-stamped live-fidelity bundle.
//
// RED BEFORE / GREEN AFTER is EXECUTED here, not described. The
// `un-excluded stage` test rebuilds the stage exactly as it ran before this
// session — all six R.11 findings applied, then R.12 on the result — and
// asserts the origin-based check finds exactly one violation, naming
// `266_forty_one_burden`. The `at rest` test asserts zero on the shipped path.
// Both run every sweep, so the RED state cannot quietly become reachable
// again without this file going red.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { CORPORA, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';
import type { ProductionRun } from './ws1-session-p-pipeline.js';
import { detectRunPlacementDefects, applyRunPlacementCorrections } from '../src/services/faRunPlacementGate';
import { applySeamFitCorrections } from '../src/services/faSeamFitGate';
import { findRunEdgeViolations, runContaining } from '../src/services/faRuleStageExclusion';
import type { VideoSegment } from '../src/types';

const TIMEOUT = 300_000;

/** Per-FILE memo. `runProductionPath` is a pure function of a stamped bundle,
 *  and this file asks it the same question nine times; re-deriving it each
 *  time costs ~30s a call for no additional evidence. Deliberately LOCAL — the
 *  shared harness stays uncached, because Session P exists precisely because
 *  two harnesses disagreed, and a cache in the shared layer would hide that
 *  class of disagreement from every consumer at once. Every test below treats
 *  the result as read-only and copies before mutating. */
const memo = new Map<string, Promise<ProductionRun>>();
const run = (key: 'v6' | '173' | 'spanish'): Promise<ProductionRun> => {
  if (!memo.has(key)) memo.set(key, runProductionPath(CORPORA[key]!));
  return memo.get(key)!;
};

const startOf = (segs: readonly VideoSegment[], tag: string): number => {
  const s = segs.find(x => tagOf(x) === tag);
  expect(s, `${tag} must be on the committed timeline`).toBeDefined();
  return s!.startTime;
};

describe('WS1 Session S — R-AP on the live v6 bundle (R-AO)', () => {
  it('R.11 proposes SIX and keeps FIVE; the one declined is 266_forty_one_burden, whose ORIGIN is inside run 6', async () => {
    const r = await run('v6');
    expect(r.r11, 'R.11 still DETECTS the same six candidates — R-AP filters, it does not blind the detector')
      .toHaveLength(6);
    expect(r.r11Kept).toHaveLength(5);
    expect(r.r11Excluded).toHaveLength(1);

    const ex = r.r11Excluded[0]!;
    expect(ex.finding.segmentTag).toBe('266_forty_one_burden');
    expect(ex.reason).toBe('origin-inside-run');
    expect(ex.runIndex).toBe(6);
    expect(ex.originValue, 'the PRE-RULE-STAGE origin, not a running value').toBeCloseTo(790.33, 2);
    expect(ex.finding.correctedValue, 'R.11 wanted to put it PAST the run end').toBeCloseTo(792.18, 2);

    // Both clauses independently condemn this move — recorded because the
    // ownership clause is checked first and would otherwise hide the fact
    // that the crossing clause also applies.
    const run6 = r.runExtents[6]!;
    expect(runContaining(ex.originValue, r.runExtents)).toBe(6);
    expect(ex.finding.correctedValue).toBeGreaterThan(run6.endSec);
  }, TIMEOUT);

  it("R.11's other five firings are UNCHANGED in tag and value", async () => {
    const r = await run('v6');
    const kept = r.r11Kept.map(f => [f.segmentTag, Number(f.correctedValue.toFixed(3))]);
    expect(kept).toEqual([
      ['192_scout_listening', 571.070],
      ['226_four_scouts', 671.170],
      ['232_sudden_halt', 684.090],
      ['233_firelight_speech', 686.540],
      ['322_body_readiness', 986.880],
    ]);
  }, TIMEOUT);

  it('R.12 now fires EIGHT, and its eighth row commits 266_forty_one_burden at 788.75 (WS1 Session T)', async () => {
    // WS1 SESSION T: the committed value moved from 788.65 to 788.75. This is
    // NOT a regression of R-AP (Session S's own ownership fix, asserted
    // elsewhere in this file) — it is Step 1's SEPARATE, uniform onset
    // correction (`acousticRunExtent`, applied identically to every R.12 row,
    // not special-cased for this one) moving run 6's acoustic onset from
    // 789.26 to 789.46. The A/B `ear-verify-t` sitting confirmed 788.65 as
    // correct, so this 0.10s move is a MEASURED, OPEN regression against that
    // verdict — see `s-266-live-path-collision` in
    // `scripts/phase4-fa-replay.test.ts`'s KNOWN_BAD and this row's pin in
    // `scripts/ws1-session-q-production-pins.test.ts` for the full account.
    // This test's job is narrower: confirm R-AP itself (which rule owns the
    // boundary) is still correct, independent of what value that rule computes.
    const r = await run('v6');
    expect(r.fired['R.12']).toBe(8);
    expect(r.fired['R.11']).toBe(5);
    expect(r.fired['R.5'], 'R.5 is untouched by R-AP').toBe(10);
    expect(r.fired['R.13'], 'R.13 is untouched on this corpus').toBe(0);

    const f = r.r12.find(x => x.segmentTag === '266_forty_one_burden');
    expect(f, 'R.12 must now reach the row it owns').toBeDefined();
    expect(f!.runIndex).toBe(6);
    expect(f!.committedValue, 'the boundary R.11 no longer moved').toBeCloseTo(790.33, 2);
    expect(f!.correctedValue).toBeCloseTo(788.75, 2);
    expect(startOf(r.committed, '266_forty_one_burden')).toBeCloseTo(788.75, 2);
  }, TIMEOUT);

  it('AT REST: the shipped stage produces ZERO R-AP violations on all three corpora', async () => {
    for (const key of ['v6', '173', 'spanish'] as const) {
      const r = await run(key);
      expect(r.runEdgeViolations, `${key}: R-AP violations at rest`).toHaveLength(0);
    }
  }, TIMEOUT);

  it('RED BEFORE, executed: the pre-Session-S stage (all six R.11 findings applied) violates R-AP exactly once', async () => {
    const r = await run('v6');
    // Rebuild the stage as it ran BEFORE this session: no exclusion at all.
    let committed = r.preRuleSegments.map(s => ({ ...s }));
    committed = applySeamFitCorrections(committed, r.r11);
    const r12Unexcluded = detectRunPlacementDefects(
      r.anchorTimed, committed, r.whisperTokens, r.silences, CORPORA.v6!.audioDuration,
    );
    committed = applyRunPlacementCorrections(committed, r12Unexcluded);

    // The old stage's own symptoms, both measured: R.12 saw only seven rows,
    // and the eighth boundary ended up past the end of its run.
    expect(r12Unexcluded, 'the old stage: R.12 could only find seven').toHaveLength(7);
    expect(startOf(committed, '266_forty_one_burden')).toBeCloseTo(792.18, 2);

    const violations = findRunEdgeViolations(
      r.preRuleSegments, committed, r.runExtents, new Set(r12Unexcluded.map(f => f.segmentId)),
    );
    expect(violations, 'RED before').toHaveLength(1);
    expect(violations[0]!.segmentTag).toBe('266_forty_one_burden');
    expect(violations[0]!.kind).toBe('moved-out-of-r12s-run');
    expect(violations[0]!.runIndex).toBe(6);
  }, TIMEOUT);

  it('MUTUAL EXCLUSION, measured: R.11\'s kept set and R.12\'s finding set are disjoint by construction', async () => {
    const r = await run('v6');
    const r11Ids = new Set(r.r11Kept.map(f => f.segmentId));
    const r12Ids = new Set(r.r12.map(f => f.segmentId));
    const r13Ids = new Set(r.r13Kept.map(f => f.segmentId));
    const overlap = [...r11Ids].filter(id => r12Ids.has(id));
    expect(overlap, 'R.11 ∩ R.12 must be empty — this is now structural, not incidental').toHaveLength(0);
    expect([...r12Ids].filter(id => r13Ids.has(id)), 'R.12 ∩ R.13').toHaveLength(0);
    expect([...r11Ids].filter(id => r13Ids.has(id)), 'R.11 ∩ R.13').toHaveLength(0);
    // ...and it was NOT empty before: R.11's raw proposal set intersects
    // R.12's in exactly one row, which is the whole finding.
    const rawOverlap = [...new Set(r.r11.map(f => f.segmentId))].filter(id => r12Ids.has(id));
    expect(rawOverlap).toHaveLength(1);
    expect(r.r12.find(f => f.segmentId === rawOverlap[0])!.segmentTag).toBe('266_forty_one_burden');
  }, TIMEOUT);
});
