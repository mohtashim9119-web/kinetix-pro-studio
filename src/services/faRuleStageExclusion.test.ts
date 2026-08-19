/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// R-AP — THE RUN-EDGE EXCLUSION INVARIANT (WS1 Session S).
//
// The centrepiece of this file is `the R.11-FIRST ordering`: the case that
// motivated the invariant and the case a current-state check provably cannot
// see. It is written as a paired assertion — the current-state answer is
// asserted to be BLIND (0 findings), and the origin-based answer is asserted
// to CATCH it — so a future refactor that quietly reverts to a current-state
// test fails on the blindness assertion rather than passing vacuously.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  computeRunExtents, runContaining, runEdgeCrossed,
  excludeRunEdgeViolations, findRunEdgeViolations, describeRunEdgeViolation,
} from './faRuleStageExclusion';
import type { RunExtent } from './faRuleStageExclusion';
import { detectRunPlacementDefects, applyRunPlacementCorrections } from './faRunPlacementGate';
import { computeUnscriptedRuns } from './faChunkPlan';
import type { TranscriptToken, VideoSegment } from '../types';
import type { SilenceInterval } from './silenceDetector';

const seg = (id: string, text: string, startTime: number, duration: number): VideoSegment =>
  ({ id, text, startTime, duration, transition: 'none', animation: 'none' }) as unknown as VideoSegment;
const tok = (text: string, startSec: number, endSec: number): TranscriptToken => ({ text, startSec, endSec });

/** The same shape `faRunPlacementGate.test.ts` uses: three scripted segments
 *  with a four-token unscripted recitation at [3.00, 4.60] between the first
 *  and second, and a real silence in the pre-run gap at [2.20, 2.80]. */
function baseFixture(): {
  parsed: VideoSegment[]; tokens: TranscriptToken[]; silences: SilenceInterval[]; audioDuration: number;
} {
  return {
    parsed: [
      seg('seg0', 'alpha bravo charlie delta', 0, 3.5),
      seg('seg1', 'echo foxtrot golf hotel', 3.5, 3.5),
      seg('seg2', 'india juliett kilo lima', 7.0, 3.0),
    ],
    tokens: [
      tok('alpha', 0.10, 0.50), tok('bravo', 0.60, 1.00),
      tok('charlie', 1.10, 1.50), tok('delta', 1.60, 2.00),
      tok('level', 3.00, 3.30), tok('nine', 3.40, 3.70),
      tok('recitation', 3.80, 4.20), tok('here', 4.30, 4.60),
      tok('echo', 5.00, 5.40), tok('foxtrot', 5.50, 5.90),
      tok('golf', 6.00, 6.40), tok('hotel', 6.50, 6.90),
      tok('india', 7.50, 7.90), tok('juliett', 8.00, 8.40),
      tok('kilo', 8.50, 8.90), tok('lima', 9.00, 9.40),
    ],
    silences: [{ startSec: 2.20, endSec: 2.80 }, { startSec: 4.70, endSec: 4.95 }],
    audioDuration: 10.0,
  };
}

const committedFrom = (parsed: readonly VideoSegment[]): VideoSegment[] => parsed.map(s => ({ ...s }));

/** Model P boundary move, the same arithmetic `applySeamFitCorrections` and
 *  `applyRunPlacementCorrections` share: segment i's start moves, i-1's
 *  duration absorbs the delta, i's own end does not move. */
function moveBoundary(segs: readonly VideoSegment[], id: string, to: number): VideoSegment[] {
  const out = segs.map(s => ({ ...s }));
  const i = out.findIndex(s => s.id === id);
  if (i <= 0) return out;
  const delta = to - out[i]!.startTime;
  out[i - 1] = { ...out[i - 1]!, duration: out[i - 1]!.duration + delta };
  out[i] = { ...out[i]!, startTime: to, duration: out[i]!.duration - delta };
  return out;
}

const EXTENTS: RunExtent[] = [{ runIndex: 0, startSec: 10, endSec: 20 }, { runIndex: 1, startSec: 30, endSec: 40 }];

describe('R-AP — geometry', () => {
  it('runContaining is STRICT: a boundary exactly on either edge is OUTSIDE the run', () => {
    expect(runContaining(15, EXTENTS)).toBe(0);
    expect(runContaining(35, EXTENTS)).toBe(1);
    expect(runContaining(10, EXTENTS)).toBe(-1);
    expect(runContaining(20, EXTENTS)).toBe(-1);
    expect(runContaining(25, EXTENTS)).toBe(-1);
  });

  it('runEdgeCrossed is direction-agnostic and strict at the endpoints', () => {
    expect(runEdgeCrossed(5, 15, EXTENTS)).toBe(0);    // forwards over the start edge
    expect(runEdgeCrossed(15, 5, EXTENTS)).toBe(0);    // backwards over the same edge
    expect(runEdgeCrossed(15, 25, EXTENTS)).toBe(0);   // over the end edge
    expect(runEdgeCrossed(5, 35, EXTENTS)).toBe(0);    // over several — reports the first
    expect(runEdgeCrossed(21, 29, EXTENTS)).toBe(-1);  // wholly between two runs
    expect(runEdgeCrossed(12, 18, EXTENTS)).toBe(-1);  // wholly INSIDE one — no edge between
    expect(runEdgeCrossed(20, 25, EXTENTS)).toBe(-1);  // starts ON an edge, does not cross it
    expect(runEdgeCrossed(7, 7, EXTENTS)).toBe(-1);
  });

  it('computeRunExtents reads the ACOUSTIC extent, not the raw token span', () => {
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    // A leading punctuation token makes the RAW run start at the end of the
    // previous word; the acoustic extent must ignore it. (The same defect
    // Session P found in production — see `acousticRunExtent`'s own header.)
    const withPunct = [...tokens];
    withPunct.splice(4, 0, tok('.', 2.00, 3.00));
    const runs = computeUnscriptedRuns(parsed, withPunct, silences, audioDuration);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.startSec, 'the RAW span is pinned to the punctuation token').toBeCloseTo(2.00, 5);
    const extents = computeRunExtents(parsed, withPunct, silences, audioDuration);
    expect(extents[0]!.startSec, 'the ACOUSTIC extent is the first spoken word').toBeCloseTo(3.00, 5);
  });
});

describe('R-AP — excludeRunEdgeViolations', () => {
  const originById = new Map([['a', 15], ['b', 25], ['c', 5], ['d', 12]]);

  it('clause (1): a proposal whose ORIGIN is inside a run is declined, even when the target is also inside', () => {
    const v = excludeRunEdgeViolations([{ segmentId: 'a', correctedValue: 18 }], originById, EXTENTS);
    expect(v.kept).toHaveLength(0);
    expect(v.excluded[0]!.reason).toBe('origin-inside-run');
    expect(v.excluded[0]!.runIndex).toBe(0);
    expect(v.excluded[0]!.originValue).toBe(15);
  });

  it('clause (2): a proposal that crosses an edge from OUTSIDE is declined', () => {
    const v = excludeRunEdgeViolations([{ segmentId: 'b', correctedValue: 35 }], originById, EXTENTS);
    expect(v.kept).toHaveLength(0);
    expect(v.excluded[0]!.reason).toBe('crosses-run-edge');
    expect(v.excluded[0]!.runIndex).toBe(1);
  });

  it('a move that touches no run at all is kept', () => {
    const v = excludeRunEdgeViolations([{ segmentId: 'b', correctedValue: 27 }], originById, EXTENTS);
    expect(v.kept).toHaveLength(1);
    expect(v.excluded).toHaveLength(0);
  });

  it('a proposal for a segment ABSENT from the origin array is kept — it is already a no-op downstream', () => {
    const v = excludeRunEdgeViolations([{ segmentId: 'gone', correctedValue: 15 }], originById, EXTENTS);
    expect(v.kept).toHaveLength(1);
  });

  it('with no runs at all, nothing is ever excluded', () => {
    const v = excludeRunEdgeViolations(
      [{ segmentId: 'a', correctedValue: 999 }, { segmentId: 'c', correctedValue: -3 }], originById, [],
    );
    expect(v.kept).toHaveLength(2);
  });
});

describe('R-AP — the R.11-FIRST ordering (the defect this invariant exists for)', () => {
  // Reproduces `266_forty_one_burden` in miniature: the committed boundary
  // sits INSIDE the run (3.50, run [3.00, 4.60]); a rule that is not R.12
  // proposes moving it to 4.80, PAST the run's end.
  const R11_TARGET = 4.80;

  it('the fixture really does put the committed boundary inside a real run', () => {
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    const extents = computeRunExtents(parsed, tokens, silences, audioDuration);
    expect(extents).toHaveLength(1);
    expect(runContaining(3.50, extents)).toBe(0);
    expect(runEdgeCrossed(3.50, R11_TARGET, extents)).toBe(0);
  });

  it('a CURRENT-STATE check is BLIND to it: once R.11 has moved the boundary, R.12 correctly finds nothing', () => {
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    const afterR11 = moveBoundary(committedFrom(parsed), 'seg1', R11_TARGET);

    // R.12's own detector, run on the array as it now stands. This assertion
    // is the point: the answer is not a bug in R.12 — 4.80 genuinely is not
    // inside the run. The boundary is simply already wrong.
    const findings = detectRunPlacementDefects(parsed, afterR11, tokens, silences, audioDuration);
    expect(findings, 'a current-state test cannot see the collision — this is why R-AP is pair-based')
      .toHaveLength(0);

    // ...and the damage is real and measurable on the PAIR.
    const extents = computeRunExtents(parsed, tokens, silences, audioDuration);
    const violations = findRunEdgeViolations(committedFrom(parsed), afterR11, extents, new Set());
    expect(violations, 'RED before: the origin-based check DOES see it').toHaveLength(1);
    expect(violations[0]!.segmentId).toBe('seg1');
    expect(violations[0]!.kind).toBe('moved-out-of-r12s-run');
    expect(violations[0]!.originValue).toBeCloseTo(3.50, 5);
    expect(violations[0]!.finalValue).toBeCloseTo(4.80, 5);
    expect(describeRunEdgeViolation(violations[0]!)).toContain('ORIGIN was inside');
  });

  it('GREEN after: R-AP declines R.11, R.12 then reaches the row and corrects it to the pre-run silence', () => {
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    const origin = committedFrom(parsed);
    const extents = computeRunExtents(parsed, tokens, silences, audioDuration);
    const originById = new Map(origin.map(s => [s.id, s.startTime]));

    // The stage, in production order, with R-AP applied to the non-R.12 rule.
    const r11Verdict = excludeRunEdgeViolations([{ segmentId: 'seg1', correctedValue: R11_TARGET }], originById, extents);
    expect(r11Verdict.kept, 'R.11 must decline a boundary R.12 owns').toHaveLength(0);
    expect(r11Verdict.excluded[0]!.reason).toBe('origin-inside-run');

    let committed = origin.map(s => ({ ...s }));
    for (const f of r11Verdict.kept) committed = moveBoundary(committed, f.segmentId, f.correctedValue);

    const r12 = detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration);
    expect(r12, 'R.12 now reaches the row it owns').toHaveLength(1);
    expect(r12[0]!.segmentId).toBe('seg1');
    expect(r12[0]!.correctedValue).toBeCloseTo(2.50, 5);
    committed = applyRunPlacementCorrections(committed, r12);

    // The whole-stage assertion is clean.
    expect(
      findRunEdgeViolations(origin, committed, extents, new Set(r12.map(f => f.segmentId))),
      'GREEN after',
    ).toHaveLength(0);
  });

  it('the assertion exempts R.12 BY NAME — the same move is a violation when nobody claims it', () => {
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    const origin = committedFrom(parsed);
    const extents = computeRunExtents(parsed, tokens, silences, audioDuration);
    const r12 = detectRunPlacementDefects(parsed, origin, tokens, silences, audioDuration);
    const corrected = applyRunPlacementCorrections(origin, r12);

    expect(findRunEdgeViolations(origin, corrected, extents, new Set(r12.map(f => f.segmentId)))).toHaveLength(0);
    // ...and without the exemption the identical arrays are a violation, which
    // is what makes the exemption load-bearing rather than decorative.
    expect(findRunEdgeViolations(origin, corrected, extents, new Set())).toHaveLength(1);
  });
});
