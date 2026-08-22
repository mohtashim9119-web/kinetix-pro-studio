/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AE — R.14 / R.15 unit tests. Hand-written fixtures, no corpus,
// no DOM: one property per test, each one shaped from a MEASURED corpus row so
// a reader can trace it back (the row's tag is named in every case).
//
// THIS FILE IS THE STANDING HALF OF MUTATION GATE M17. The mutation matrix
// (documented in `scripts/phase4-fa-replay.test.ts`'s M17 entry) perturbs each
// conjunct and each guard of the two rules; what makes those mutations BITE
// rather than pass silently is the per-conjunct decline tests below, which is
// why each one exists as its own `it` rather than being folded into a single
// happy-path assertion.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import {
  detectAnchorTrustDefects, applyAnchorTrustCorrections,
  type AnchorTrustAlignment,
} from './faAnchorTrustGate';
import { CONF_MIN_FALLBACK, SILENCE_MIN_DETECTABLE_SEC, FA_FRAME_SEC } from './syncConstants';
import type { SilenceInterval } from './silenceDetector';
import type { TranscriptToken, VideoSegment } from '../types';

const seg = (id: string, startTime: number, duration: number, tag?: string): VideoSegment =>
  ({ id, tag, text: id, startTime, duration, transition: 'none', animation: 'none' }) as unknown as VideoSegment;

const tok = (text: string, startSec: number, endSec: number, confidence: number): TranscriptToken =>
  ({ text, startSec, endSec, confidence }) as unknown as TranscriptToken;

const sil = (startSec: number, endSec: number): SilenceInterval => ({ startSec, endSec });

const align = (firstTokenIdx: number, lastTokenIdx: number): AnchorTrustAlignment =>
  ({ firstTokenIdx, lastTokenIdx });

/**
 * The `403_vigilant_embers` shape, minimised: the outgoing segment's last word
 * is loud and certain, the incoming segment's first claimed word is one
 * aligner frame later at confidence ~1e-6, and the real seam is the silence
 * that starts just after it. Committed lands in the middle of the collapsed
 * word gap; ear-correct is the silence's midpoint.
 */
function placementFixture(): {
  committed: VideoSegment[]; alignments: AnchorTrustAlignment[];
  tokens: TranscriptToken[]; silences: SilenceInterval[];
} {
  return {
    committed: [seg('a', 0, 10.00, 'left'), seg('b', 10.00, 10.00, 'right')],
    alignments: [align(0, 1), align(2, 4)],
    tokens: [
      tok('cyclical', 9.20, 9.60, 0.999),
      tok('darkness', 9.60, 9.98, 0.999),   // left's last word, ends 9.98
      tok('and', 10.02, 10.08, 1e-6),        // right's first CLAIMED word — smear
      tok('the', 10.10, 10.20, 1e-6),
      tok('embers', 11.00, 11.40, 0.999),    // right's first RELIABLE word
    ],
    // The real seam. Midpoint 10.40.
    silences: [sil(10.10, 10.70)],
  };
}

/**
 * The `iron_bounce` shape, minimised: the outgoing segment's own last two
 * words are certain and start AFTER the committed boundary (ordinalDelta -2),
 * and the incoming segment's first word is certain too.
 */
function attributionFixture(): {
  committed: VideoSegment[]; alignments: AnchorTrustAlignment[];
  tokens: TranscriptToken[]; silences: SilenceInterval[];
} {
  return {
    committed: [seg('a', 0, 5.00, 'left'), seg('b', 5.00, 5.00, 'right')],
    alignments: [align(0, 2), align(3, 4)],
    tokens: [
      tok('chitin', 4.90, 5.10, 2e-7),
      tok('thick', 5.40, 5.60, 0.963),   // left's, starts AFTER committed 5.00
      tok('enough', 5.62, 5.80, 0.999),  // left's LAST, ends 5.80
      tok('to', 5.84, 5.90, 0.999),      // right's FIRST, starts 5.84
      tok('deflect', 5.94, 6.30, 0.999),
    ],
    silences: [],
  };
}

describe('R.14 — smeared-anchor placement', () => {
  it('fires on a collapsed word gap with an unreliable incoming anchor, and places at the next silence MIDPOINT', () => {
    const f = placementFixture();
    const out = detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences);
    expect(out).toHaveLength(1);
    expect(out[0]!.rule).toBe('R.14');
    expect(out[0]!.ordinalDelta).toBe(0);
    expect(out[0]!.correctedValue).toBeCloseTo(10.40, 9);
    expect(out[0]!.backingSilence).toEqual({ startSec: 10.10, endSec: 10.70 });
    // The word gap is recorded for the log reader, and it is NOT where the
    // corrected value goes — the measured refutation of a gap-confined
    // placement model (no v6 row's ear target lies inside its own word gap).
    expect(out[0]!.gapStartSec).toBeCloseTo(9.98, 9);
    expect(out[0]!.gapEndSec).toBeCloseTo(10.02, 9);
  });

  it('DECLINES when the incoming anchor is RELIABLE — that is R.15/wrong-landmark territory, not R.14\'s', () => {
    const f = placementFixture();
    f.tokens[2] = tok('and', 10.02, 10.08, CONF_MIN_FALLBACK);
    expect(detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences)).toEqual([]);
  });

  it('DECLINES when a word already sits on the wrong side of the cut (ordinalDelta != 0)', () => {
    // The `087_throwing_spear_poise` / `192_scout_listening` / `318_scout_on_ridge`
    // shape: ear-CORRECT controls that share R.14's confidence and gap
    // signature and are separated from it by this conjunct ALONE. Widening to
    // `ordinalDelta >= 0` turns all three into false positives (measured).
    const f = placementFixture();
    f.tokens[2] = tok('and', 9.99, 10.08, 1e-6); // now starts BEFORE the boundary
    expect(detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences)).toEqual([]);
  });

  it('DECLINES when the word gap is wide enough to hold a detectable silence', () => {
    // `abysmal_opinion` (173), an ear-CORRECT control: 0.500s gap, unreliable
    // incoming anchor, ordinalDelta 0. Only this conjunct declines it.
    const f = placementFixture();
    f.tokens[1] = tok('darkness', 9.60, 10.02 - SILENCE_MIN_DETECTABLE_SEC, 0.999);
    expect(detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences)).toEqual([]);
  });

  it('skips a silence the boundary is ALREADY sitting on the midpoint of, and takes the next one', () => {
    // `214_solitary_fire` / `447_scout_facing_dark`: both committed values ARE
    // a containing silence's exact midpoint, so that silence is used up and
    // the correction belongs to the following one. Selecting by silence START
    // instead of MIDPOINT gets `008_unknown_void` and `400_endless_dark`
    // wrong; selecting the containing silence gets these two wrong.
    const f = placementFixture();
    f.silences = [sil(9.80, 10.20), sil(10.60, 11.00)];
    const out = detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences);
    expect(out).toHaveLength(1);
    expect(out[0]!.correctedValue).toBeCloseTo(10.80, 9);
  });

  it('DECLINES a correction that would reach or pass the NEXT committed boundary', () => {
    // Measured on Spanish: without this guard `022_ship_trapped` lands exactly
    // on `023_scylla_six_sailors`'s own ear-verified boundary, producing a
    // zero-duration segment.
    const f = placementFixture();
    f.committed = [seg('a', 0, 10.00, 'left'), seg('b', 10.00, 0.30, 'right'), seg('c', 10.30, 5, 'next')];
    f.alignments = [align(0, 1), align(2, 3), align(4, 4)];
    const out = detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences);
    // Asserted by segment rather than on the whole array: appending a third
    // segment to reach a "next boundary" at all necessarily creates a second
    // seam, and this test is about the first one.
    expect(out.filter(x => x.segmentId === 'b')).toEqual([]);
  });

  it('DECLINES a correction that would land past the incoming segment\'s first RELIABLE word', () => {
    // The guard that costs `231_slowing_pace` and buys back a 3.30s unverified
    // move on v6 plus two on Spanish. Placing here would truncate the incoming
    // segment's own opening words — one defect traded for another.
    const f = placementFixture();
    f.tokens[4] = tok('embers', 10.30, 10.60, 0.999); // reliable onset now BEFORE the midpoint
    expect(detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences)).toEqual([]);
  });

  it('DECLINES when no silence lies after the boundary at all', () => {
    const f = placementFixture();
    expect(detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, [])).toEqual([]);
  });
});

describe('R.15 — tail attribution', () => {
  it('fires when the outgoing segment\'s own last word starts AFTER the cut, placing one aligner frame before the incoming word', () => {
    const f = attributionFixture();
    const out = detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences);
    expect(out).toHaveLength(1);
    expect(out[0]!.rule).toBe('R.15');
    expect(out[0]!.ordinalDelta).toBe(-2);
    expect(out[0]!.correctedValue).toBeCloseTo(5.84 - FA_FRAME_SEC, 9);
    expect(out[0]!.correctedValue).toBeGreaterThan(out[0]!.gapStartSec);
  });

  it('DECLINES when the incoming anchor is ALSO unreliable — the `vessel_damage_clue` refutation', () => {
    // Both anchors smear: the defect is not attribution, and R.15's placement
    // would have moved this row to 173.30 when its ear-verified value is
    // 174.74, a silence midpoint 1.4s past anything the word gap can reach.
    const f = attributionFixture();
    f.tokens[3] = tok('to', 5.84, 5.90, 1.37e-5);
    expect(detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences)).toEqual([]);
  });

  it('clamps so the correction can never cut into the outgoing segment\'s own last word', () => {
    const f = attributionFixture();
    // Gap narrower than one aligner frame.
    f.tokens[2] = tok('enough', 5.62, 5.83, 0.999);
    const out = detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences);
    expect(out).toHaveLength(1);
    expect(out[0]!.correctedValue).toBeCloseTo(5.83, 9);
  });
});

describe('R.14 and R.15 are mutually exclusive, and the gate is well-behaved at the edges', () => {
  it('no boundary can ever satisfy both rules — the ordinal and confidence conditions are complements', () => {
    for (const f of [placementFixture(), attributionFixture()]) {
      const out = detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences);
      expect(new Set(out.map(x => x.segmentId)).size).toBe(out.length);
      expect(out.filter(x => x.rule === 'R.14').length + out.filter(x => x.rule === 'R.15').length).toBe(out.length);
    }
  });

  it('never proposes a finding for segment 0 (no predecessor to absorb the delta)', () => {
    const f = placementFixture();
    const out = detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences);
    expect(out.every(x => x.segmentIndex >= 1)).toBe(true);
  });

  it('returns nothing when there are no tokens, or when the alignment array is not index-parallel', () => {
    const f = placementFixture();
    expect(detectAnchorTrustDefects(f.committed, f.alignments, [], f.silences)).toEqual([]);
    expect(detectAnchorTrustDefects(f.committed, [f.alignments[0]!], f.tokens, f.silences)).toEqual([]);
  });
});

describe('applyAnchorTrustCorrections — Model P', () => {
  it('preserves the gapless partition and Σ duration exactly, and never moves the corrected segment\'s own END', () => {
    const f = placementFixture();
    const out = detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences);
    const before = f.committed.reduce((a, s) => a + s.duration, 0);
    const applied = applyAnchorTrustCorrections(f.committed, out);
    expect(applied[1]!.startTime).toBeCloseTo(10.40, 9);
    expect(applied.reduce((a, s) => a + s.duration, 0)).toBeCloseTo(before, 9);
    expect(applied[0]!.startTime + applied[0]!.duration).toBeCloseTo(applied[1]!.startTime, 9);
    expect(applied[1]!.startTime + applied[1]!.duration)
      .toBeCloseTo(f.committed[1]!.startTime + f.committed[1]!.duration, 9);
  });

  it('is immutable and a no-op on an empty finding list', () => {
    const f = placementFixture();
    const snapshot = JSON.stringify(f.committed);
    applyAnchorTrustCorrections(f.committed, detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences));
    expect(JSON.stringify(f.committed)).toBe(snapshot);
    expect(applyAnchorTrustCorrections(f.committed, [])).toBe(f.committed);
  });

  it('declines a correction that would drive either duration non-positive, rather than committing a gap', () => {
    const f = placementFixture();
    const findings = detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences);
    const tiny = [seg('a', 0, 10.00, 'left'), seg('b', 10.00, 0.10, 'right')];
    const applied = applyAnchorTrustCorrections(tiny, findings);
    expect(applied[1]!.startTime).toBe(10.00);
    expect(applied.every(s => s.duration > 0)).toBe(true);
  });

  it('silently skips a finding whose segment was dropped upstream (tolerant-by-id)', () => {
    const f = placementFixture();
    const findings = detectAnchorTrustDefects(f.committed, f.alignments, f.tokens, f.silences);
    const dropped = [seg('a', 0, 10.00, 'left'), seg('z', 10.00, 10.00, 'other')];
    expect(applyAnchorTrustCorrections(dropped, findings)[1]!.startTime).toBe(10.00);
  });
});
