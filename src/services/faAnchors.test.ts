/**
 * faAnchors.ts — R.1 anchor + R.0 run computation, R-O/R-P ruling coverage.
 *
 * Every fixture is hand-written (Hirschberg output, tokens, silences are all
 * constructed directly) — this module has no live caller yet (Slice D1 is
 * pure and unwired), so there is no real project to drive it from.
 *
 * SCOPE NOTE — R.7's `CONF_MIN` is deliberately NOT covered here. `CONF_MIN`
 * gates a run's boundary word on forced alignment's OWN per-word confidence,
 * which is FA OUTPUT — data this module has no access to, since it runs
 * strictly before any FA pass (`faAnchors.ts`'s own header comment, and R.1's
 * "computed before any FA pass" text). Wiring a fake confidence input just to
 * exercise `CONF_MIN` here would test behavior this module doesn't have.
 * `CONF_MIN` is defined in `syncConstants.ts` for its real (post-FA) consumer.
 */

import { describe, it, expect } from 'vitest';
import { computeFaAnchors } from './faAnchors';
import type { TokenAlignment, TokenAlignmentOp } from './whisperService';
import type { TranscriptToken } from '../types';
import type { SilenceInterval } from './silenceDetector';
import { MAX_RUN_SEC, RUN_SURVIVAL_MIN_RUN_LONG } from './syncConstants';

function tok(text: string, startSec: number, endSec: number): TranscriptToken {
  return { text, startSec, endSec };
}

function sil(startSec: number, endSec: number): SilenceInterval {
  return { startSec, endSec };
}

/** R-U (WS1 Session B) — an anchor-CANDIDATE token, built to the shape the
 *  zero-seam rejection rule requires: the token's own start (a token seam,
 *  for any token but the first) lies STRICTLY INSIDE its agreeing silence,
 *  rather than merely abutting that silence's edge. `sil(s - 0.1, s)` plus a
 *  token starting at `s - 0.05` is that shape; the anchor's `timeSec` is
 *  still the silence's `endSec` (`s`), so every pinned time below is
 *  unchanged by the rule.
 *
 *  A silence that only TOUCHES a seam at its edge spans nothing and is
 *  rejected — which is why the pre-R-U fixture form (`tok(w, s, …)` against
 *  `sil(s - 0.1, s)`) no longer produces an anchor. */
function candidateTok(text: string, silenceEndSec: number): TranscriptToken {
  return tok(text, silenceEndSec - 0.05, silenceEndSec + 0.5);
}

/** All-match alignment: query word `i` matches subject index `i`. */
function allMatchAlignment(n: number): TokenAlignment {
  const ops: TokenAlignmentOp[] = [];
  const matchedSubjectOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    ops.push({ type: 'match', qi: i, sj: i });
    matchedSubjectOf[i] = i;
  }
  return { ops, matchedSubjectOf, score: n };
}

/** Identity subject-index -> token-index mapping (one word per token) — what
 *  every pre-existing fixture in this file implicitly assumed before
 *  `subjectTokenIdx` became an explicit, required parameter. */
function identityMapping(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** Asserts I1/I2 (Model P, per R-E) directly: every run's `windowEnd` equals
 *  the next run's `windowStart`, with no numeric gap anywhere in the
 *  partition — a test that would still pass with a real gap does not count. */
function assertNoGaps(runs: ReturnType<typeof computeFaAnchors>['runs']): void {
  for (let i = 0; i < runs.length - 1; i++) {
    expect(runs[i]!.windowEnd, `gap between run ${i} and ${i + 1}`).toBe(runs[i + 1]!.windowStart);
  }
}

describe('computeFaAnchors', () => {
  it('zero anchors found: no candidate is admissible -> one run, corpus start to end', () => {
    // 5 matched words, all too short to pass R-O's MIN_ANCHOR_WORD_CHARS.
    const words = ['is', 'at', 'on', 'it', 'do'];
    const alignment = allMatchAlignment(words.length);
    const tokens = words.map((w, i) => tok(w, i + 1, i + 1.4));
    const silences = [sil(0.9, 1.0), sil(1.9, 2.0), sil(2.9, 3.0), sil(3.9, 4.0), sil(4.9, 5.0)];
    const audioDuration = 8;

    const { anchors, runs } = computeFaAnchors(alignment, tokens, silences, audioDuration, identityMapping(tokens.length));

    expect(anchors).toEqual([]);
    expect(runs).toEqual([
      { windowStart: 0, windowEnd: 8, startProvenance: 'corpus-start', endProvenance: 'corpus-end' },
    ]);
  });

  it('every admissible token becomes an anchor (no selection among candidates)', () => {
    const words = ['alpha', 'bravo', 'charlie', 'delta', 'hotel'];
    const alignment = allMatchAlignment(words.length);
    const starts = [1, 3, 5, 7, 9];
    const tokens = words.map((w, i) => candidateTok(w, starts[i]!));
    const silences = starts.map(s => sil(s - 0.1, s));
    const audioDuration = 12;

    const { anchors, runs } = computeFaAnchors(alignment, tokens, silences, audioDuration, identityMapping(tokens.length));

    // qi 0 is absent, and that is R-U working as specified rather than a gap
    // in the fixture: the FIRST token has no token seam before it, so no
    // silence can span one there, so it can never carry an R.1 anchor. The
    // corpus start is already a boundary (`'corpus-start'`, run 0 below) — it
    // does not need an anchor to also assert it. Every LATER admissible token
    // still becomes an anchor unconditionally, which is what R.1's "no
    // selection among candidates" text means.
    expect(anchors.map(a => a.qi)).toEqual([1, 2, 3, 4]);
    expect(anchors.map(a => a.timeSec)).toEqual([3, 5, 7, 9]);
    expect(runs.map(r => [r.windowStart, r.windowEnd])).toEqual([
      [0, 3], [3, 5], [5, 7], [7, 9], [9, 12],
    ]);
    assertNoGaps(runs);
  });

  it(`MIN_ANCHOR_RUN (${RUN_SURVIVAL_MIN_RUN_LONG}) boundary: a run of exactly 3 is rejected, exactly 4 is admitted`, () => {
    // qi 0-2: contiguous match run of 3 ("alpha","bravo","charlie") - too short.
    // qi 3: a 'sub' spacer breaks contiguity (a real text mismatch, not a candidate).
    // qi 4-7: contiguous match run of 4 ("delta","hotel","india","kilo") - admissible length.
    const ops: TokenAlignmentOp[] = [
      { type: 'match', qi: 0, sj: 0 },
      { type: 'match', qi: 1, sj: 1 },
      { type: 'match', qi: 2, sj: 2 },
      { type: 'sub', qi: 3, sj: 3 },
      { type: 'match', qi: 4, sj: 4 },
      { type: 'match', qi: 5, sj: 5 },
      { type: 'match', qi: 6, sj: 6 },
      { type: 'match', qi: 7, sj: 7 },
    ];
    const matchedSubjectOf = new Int32Array([0, 1, 2, -1, 4, 5, 6, 7]);
    const alignment: TokenAlignment = { ops, matchedSubjectOf, score: 7 };

    const words = ['alpha', 'bravo', 'charlie', 'MISMATCH', 'delta', 'hotel', 'india', 'kilo'];
    const starts = [1, 3, 5, 7, 9, 11, 13, 15];
    const tokens = words.map((w, i) => candidateTok(w, starts[i]!));
    const silences = starts.map(s => sil(s - 0.1, s));
    const audioDuration = 18;

    const { anchors } = computeFaAnchors(alignment, tokens, silences, audioDuration, identityMapping(tokens.length));

    expect(anchors.some(a => a.qi === 1)).toBe(false); // run of 3 - rejected
    expect(anchors.some(a => a.qi === 5)).toBe(true);  // run of 4 - admitted
  });

  it('MAX_RUN_SEC forces a split when no admissible anchor exists anywhere in a long span', () => {
    const alignment: TokenAlignment = { ops: [], matchedSubjectOf: new Int32Array(0), score: 0 };
    const tokens: TranscriptToken[] = [];
    const silences: SilenceInterval[] = [];
    const audioDuration = MAX_RUN_SEC * 2 + 5; // 65 - needs two forced splits

    const { anchors, runs } = computeFaAnchors(alignment, tokens, silences, audioDuration, identityMapping(tokens.length));

    expect(anchors).toEqual([]);
    expect(runs).toEqual([
      { windowStart: 0, windowEnd: MAX_RUN_SEC, startProvenance: 'corpus-start', endProvenance: 'forced-split-max-run' },
      { windowStart: MAX_RUN_SEC, windowEnd: MAX_RUN_SEC * 2, startProvenance: 'forced-split-max-run', endProvenance: 'forced-split-max-run' },
      { windowStart: MAX_RUN_SEC * 2, windowEnd: audioDuration, startProvenance: 'forced-split-max-run', endProvenance: 'corpus-end' },
    ]);
    assertNoGaps(runs);
  });

  it('R-O rejects a candidate shorter than MIN_ANCHOR_WORD_CHARS, in an otherwise-valid run', () => {
    // "on" (2 chars) sits in a run of 5, with its own agreeing silence -
    // isolates the length check as the sole cause of rejection.
    const words = ['on', 'alpha', 'bravo', 'charlie', 'delta'];
    const alignment = allMatchAlignment(words.length);
    const starts = [1, 3, 5, 7, 9];
    const tokens = words.map((w, i) => candidateTok(w, starts[i]!));
    const silences = starts.map(s => sil(s - 0.1, s));
    const audioDuration = 12;

    const { anchors } = computeFaAnchors(alignment, tokens, silences, audioDuration, identityMapping(tokens.length));

    expect(anchors.some(a => a.qi === 0)).toBe(false); // "on" - too short
    expect(anchors.some(a => a.qi === 1)).toBe(true);  // "alpha" - control, admitted
  });

  it('R-O rejects a glide-initial candidate, in an otherwise-valid run', () => {
    // "your" (4 chars, passes length) starts with 'y' - GLIDE_INITIAL_CHARS.
    const words = ['your', 'alpha', 'bravo', 'charlie', 'delta'];
    const alignment = allMatchAlignment(words.length);
    const starts = [1, 3, 5, 7, 9];
    const tokens = words.map((w, i) => candidateTok(w, starts[i]!));
    const silences = starts.map(s => sil(s - 0.1, s));
    const audioDuration = 12;

    const { anchors } = computeFaAnchors(alignment, tokens, silences, audioDuration, identityMapping(tokens.length));

    expect(anchors.some(a => a.qi === 0)).toBe(false); // "your" - glide-initial
    expect(anchors.some(a => a.qi === 1)).toBe(true);  // "alpha" - control, admitted
  });

  it('R-P selects the LONGEST detected silence inside the force-split window, not the first or last', () => {
    const alignment: TokenAlignment = { ops: [], matchedSubjectOf: new Int32Array(0), score: 0 };
    const tokens: TranscriptToken[] = [];
    // Three silences inside [0, MAX_RUN_SEC]: durations 1, 2.5, 0.8 - the
    // middle one is longest and must be the one chosen, not the earliest.
    const silences = [sil(5, 6), sil(10, 12.5), sil(20, 20.8)];
    const audioDuration = 32;

    const { runs } = computeFaAnchors(alignment, tokens, silences, audioDuration, identityMapping(tokens.length));

    expect(runs).toEqual([
      { windowStart: 0, windowEnd: 12.5, startProvenance: 'corpus-start', endProvenance: 'forced-split-silence' },
      { windowStart: 12.5, windowEnd: 32, startProvenance: 'forced-split-silence', endProvenance: 'corpus-end' },
    ]);
    assertNoGaps(runs);
  });

  it('R-P falls back to exactly MAX_RUN_SEC when the force-split window has no detected silence', () => {
    const alignment: TokenAlignment = { ops: [], matchedSubjectOf: new Int32Array(0), score: 0 };
    const tokens: TranscriptToken[] = [];
    const silences: SilenceInterval[] = [];
    const audioDuration = 45;

    const { runs } = computeFaAnchors(alignment, tokens, silences, audioDuration, identityMapping(tokens.length));

    expect(runs).toEqual([
      { windowStart: 0, windowEnd: MAX_RUN_SEC, startProvenance: 'corpus-start', endProvenance: 'forced-split-max-run' },
      { windowStart: MAX_RUN_SEC, windowEnd: 45, startProvenance: 'forced-split-max-run', endProvenance: 'corpus-end' },
    ]);
  });

  it('clamps the first run to audio start (0) and the last run to audioDuration exactly', () => {
    const words = ['alpha', 'bravo', 'charlie', 'delta'];
    const alignment = allMatchAlignment(words.length);
    const starts = [4, 5, 6, 7]; // single anchor lands wherever the agreeing silence is
    const tokens = words.map((w, i) => candidateTok(w, starts[i]!));
    const silences = [sil(4.9, 5)]; // only qi=1 ("bravo") agrees
    const audioDuration = 10;

    const { anchors, runs } = computeFaAnchors(alignment, tokens, silences, audioDuration, identityMapping(tokens.length));

    expect(anchors.map(a => a.qi)).toEqual([1]);
    expect(runs[0]!.windowStart).toBe(0);
    expect(runs[0]!.startProvenance).toBe('corpus-start');
    expect(runs[runs.length - 1]!.windowEnd).toBe(audioDuration);
    expect(runs[runs.length - 1]!.endProvenance).toBe('corpus-end');
  });

  it('R-E: no-gap property holds directly across mixed agreed-anchor and forced-split boundaries', () => {
    // Three 6-word blocks; only one word per block has an agreeing silence
    // (t=5, t=10, t=15 respectively) - the rest exist only as filler so the
    // agreement check (not run-length) is what isolates each anchor. After
    // the third anchor (t=15) there are no more candidates at all, so the
    // remaining 35s to audioDuration (50) must force-split once (no silence
    // there -> forced-split-max-run at 15+30=45) before reaching corpus-end.
    const blockWords = ['alpha', 'bravo', 'charlie', 'delta', 'hotel', 'india'];
    const words = [...blockWords, ...blockWords, ...blockWords];
    const alignment = allMatchAlignment(words.length);

    const starts = [
      1, 3, 5, 6, 8, 9,       // block 1 (qi 0-5): anchor at qi=2, t=5
      31, 33, 10, 34, 36, 38, // block 2 (qi 6-11): anchor at qi=8, t=10
      61, 63, 15, 64, 66, 68, // block 3 (qi 12-17): anchor at qi=14, t=15
    ];
    const tokens = words.map((w, i) => candidateTok(w, starts[i]!));
    const silences = [sil(4.9, 5), sil(9.9, 10), sil(14.9, 15)];
    const audioDuration = 50;

    const { anchors, runs } = computeFaAnchors(alignment, tokens, silences, audioDuration, identityMapping(tokens.length));

    expect(anchors.map(a => a.timeSec)).toEqual([5, 10, 15]);
    expect(runs.map(r => [r.windowStart, r.windowEnd, r.startProvenance, r.endProvenance])).toEqual([
      [0, 5, 'corpus-start', 'agreed-anchor'],
      [5, 10, 'agreed-anchor', 'agreed-anchor'],
      [10, 15, 'agreed-anchor', 'agreed-anchor'],
      [15, 45, 'agreed-anchor', 'forced-split-max-run'],
      [45, 50, 'forced-split-max-run', 'corpus-end'],
    ]);
    assertNoGaps(runs);
  });

  it('subject index space diverges from token index space: subjectTokenIdx is honored, not matchedSubjectOf used directly as a token index', () => {
    // Mirrors whisperService.ts's real shape: token 0 is a punctuation-only
    // Whisper token that canonicalizes to ZERO subject words (dropped by
    // `tokenWords`'s `word.length > 0` guard), so subject index 0 corresponds
    // to tokens[1], not tokens[0] — the subject space is shifted by one
    // relative to the token space for the rest of the array.
    const fillerToken = tok('...', 0, 0.5);
    const words = ['alpha', 'bravo', 'charlie', 'delta', 'hotel'];
    const starts = [1, 3, 5, 7, 9];
    const tokens = [fillerToken, ...words.map((w, i) => candidateTok(w, starts[i]!))];
    const silences = starts.map(s => sil(s - 0.1, s));
    const audioDuration = 12;

    // Query word i truly matches subject index i (0-4); subjectTokenIdx maps
    // that subject space onto tokens[1..5] — the real token each word came from.
    const alignment = allMatchAlignment(words.length);
    const subjectTokenIdx = [1, 2, 3, 4, 5];

    const { anchors } = computeFaAnchors(alignment, tokens, silences, audioDuration, subjectTokenIdx);

    // Correct: every anchor's tokenIdx is subjectTokenIdx[qi] (1-5), and its
    // timeSec is the REAL token's agreeing silence. Using matchedSubjectOf
    // directly as a token index (the pre-fix bug) would instead read
    // tokens[qi] — tokens[0] is the non-distinctive filler (drops qi=0
    // entirely) and every other anchor would resolve to the WRONG token's
    // startSec, producing different (wrong) timeSec values below.
    expect(anchors.map(a => a.qi)).toEqual([0, 1, 2, 3, 4]);
    expect(anchors.map(a => a.tokenIdx)).toEqual([1, 2, 3, 4, 5]);
    expect(anchors.map(a => a.timeSec)).toEqual(starts);
  });
});

// ===========================================================================
// R-U (WS1 Session B) — the ZERO-SEAM REJECTION RULE.
//
// Owner ruling R-U replaces R-R's unbuildable token-to-token-gap clause: a
// silence that spans no token seam is rejected as a boundary candidate
// regardless of proximity. It is a VETO on structurally impossible silences,
// not a SELECTOR among plausible ones — the R2 invariant applied as written
// (`CLAUDE.md` §4: "Timestamps may measure distance; they must never decide
// identity").
//
// SCOPE, stated so a later reader does not mistake it for an oversight: the
// veto applies to `findAgreeingSilence` (R.1 agreement) ONLY, not to R-P's
// `longestSilenceInWindow` (the R.4 forced split). Those answer different
// questions — "is this silence the boundary between these two words?" versus
// "where is the least-bad place to cut a run that has run too long?" — and
// only the first is an identity claim. Extending the veto to R-P would also
// move the production chunk plan away from the one Session B's Step 3
// measured, which is what every number in `docs/work-in-progress.md` §11's
// R-Y table describes.
// ===========================================================================

/** Whisper turbo emits a gapless partition (measured: 3451/3988 v6, 1635/1835
 *  173, 331/362 spanish adjacent pairs have a zero-width gap), so a token seam
 *  is a single instant: `tokens[i].startSec === tokens[i-1].endSec`. These
 *  fixtures use that shape rather than the isolated-token shape, because the
 *  rule under test is defined against it. */
function gaplessTokens(words: string[], bounds: number[]): TranscriptToken[] {
  return words.map((w, i) => tok(w, bounds[i]!, bounds[i + 1]!));
}

describe('computeFaAnchors — R-U zero-seam rejection rule', () => {
  // Four gapless tokens over [10, 14): seams at 11, 12, 13.
  const WORDS = ['alpha', 'bravo', 'charlie', 'delta'];
  const BOUNDS = [10, 11, 12, 13, 14];
  const AUDIO = 20;

  function anchorsFor(silences: SilenceInterval[]): ReturnType<typeof computeFaAnchors> {
    const tokens = gaplessTokens(WORDS, BOUNDS);
    return computeFaAnchors(allMatchAlignment(WORDS.length), tokens, silences, AUDIO, identityMapping(tokens.length));
  }

  it('REJECTS a silence spanning zero token seams (it lies wholly inside one token span)', () => {
    // [11.2, 11.8] sits entirely inside "bravo" [11, 12) — it separates
    // nothing. "charlie" starts at 12, only 0.2s from this silence's endSec,
    // so the OLD proximity-only test would have accepted it: this asserts the
    // veto, not the tolerance.
    const { anchors } = anchorsFor([sil(11.2, 11.8)]);
    expect(anchors).toEqual([]);
  });

  it('ACCEPTS a silence spanning exactly one token seam', () => {
    // [11.8, 12.1] straddles the "bravo"/"charlie" seam at 12. "charlie"'s
    // own onset (12) is 0.1s from endSec (12.1), inside ANCHOR_AGREEMENT_SEC.
    const { anchors } = anchorsFor([sil(11.8, 12.1)]);
    expect(anchors.map(a => a.tokenIdx)).toEqual([2]);
    expect(anchors.map(a => a.timeSec)).toEqual([12.1]);
  });

  it('ACCEPTS a silence spanning two or more token seams — that is the COMMON real case, not collateral', () => {
    // Measured on the real corpora (Session A.5 census): of 547/239/27
    // detected silences, 460/98/22 straddle two or more token spans. A rule
    // that rejected those would veto most of the corpus, which R-U does not.
    // [10.9, 12.1] swallows the seams at 11 AND 12.
    const { anchors } = anchorsFor([sil(10.9, 12.1)]);
    expect(anchors.map(a => a.tokenIdx)).toEqual([2]);
    expect(anchors.map(a => a.timeSec)).toEqual([12.1]);
  });

  it('ear-pass item 6: the false anchor at 173.12 is vetoed, and the real seam silence at 174.96 anchors instead', () => {
    // The real configuration, from scripts/fixtures/phase4-baseline-173-{words,
    // silences}.csv (docs/work-in-progress.md §11): Whisper token 464
    // "chemical" spans [172.57, 173.18], and detected silence [172.70, 173.12]
    // lies WHOLLY INSIDE it — zero seams. The next token's onset (173.18) is
    // 0.06s from that silence's endSec, well inside ANCHOR_AGREEMENT_SEC, so
    // proximity alone accepted it and `snapBoundaries` then committed
    // `vessel_damage_clue` at 172.91. The ear-correct boundary derives from
    // the NEXT silence, [174.52, 174.96], which does span a real seam.
    const words = ['chemical', 'residue', 'whatever', 'lastcrew', 'stored'];
    const bounds = [172.57, 173.18, 173.60, 174.10, 174.90, 175.40];
    const tokens = gaplessTokens(words, bounds);
    const alignment = allMatchAlignment(words.length);

    const falseAnchorSilence = sil(172.70, 173.12); // inside "chemical" — zero seams
    const realSeamSilence = sil(174.52, 174.96);    // straddles the seam at 174.90

    // Both present, exactly as the real audio has them.
    const { anchors } = computeFaAnchors(
      alignment, tokens, [falseAnchorSilence, realSeamSilence], 300, identityMapping(tokens.length),
    );

    expect(anchors.map(a => a.timeSec), 'the 173.12 false anchor must be gone').not.toContain(173.12);
    expect(anchors.map(a => a.timeSec)).toEqual([174.96]);

    // And the veto is what did it: the same silence at the same distance is
    // still accepted once a seam actually falls inside it.
    const widened = computeFaAnchors(
      alignment, tokens, [sil(172.70, 173.30), realSeamSilence], 300, identityMapping(tokens.length),
    );
    expect(widened.anchors.map(a => a.timeSec)).toEqual([173.30, 174.96]);
  });

  it('no surviving candidate anywhere: the run simply is not split there, and R-P force-splits instead', () => {
    // Every silence is zero-seam, so R.1 produces nothing. The FALLBACK is not
    // a substitute anchor and not an error — the enclosing run just stays
    // whole, and once it exceeds MAX_RUN_SEC the R.4/R-P forced split takes
    // over. R-P is deliberately NOT seam-vetoed (see this block's scope note),
    // so it still picks the longest silence in the window: [11.2, 11.8] is
    // 0.6s against [12.1, 12.4]'s 0.3s, so the split lands on 11.8.
    const tokens = gaplessTokens(WORDS, BOUNDS);
    const silences = [sil(11.2, 11.8), sil(12.1, 12.4)]; // both wholly inside one token
    const audioDuration = MAX_RUN_SEC + 5; // one forced split's worth, no more

    const { anchors, runs } = computeFaAnchors(
      allMatchAlignment(WORDS.length), tokens, silences, audioDuration, identityMapping(tokens.length),
    );

    expect(anchors).toEqual([]);
    expect(runs).toEqual([
      { windowStart: 0, windowEnd: 11.8, startProvenance: 'corpus-start', endProvenance: 'forced-split-silence' },
      { windowStart: 11.8, windowEnd: audioDuration, startProvenance: 'forced-split-silence', endProvenance: 'corpus-end' },
    ]);
  });

  it('the FIRST token can never anchor: there is no token seam before it', () => {
    // A silence covering the very start of the corpus spans no seam by
    // construction — seams begin at tokens[1]. The corpus start is already a
    // boundary (`'corpus-start'`), so nothing is lost.
    const { anchors } = anchorsFor([sil(9.5, 10.5)]); // contains no seam: seams start at 11
    expect(anchors).toEqual([]);
  });
});
