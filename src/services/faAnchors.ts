/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Forced-alignment anchor computation (R.0/R.1/R.4, `sync-pipeline-v2-plan.md`;
// R-O/R-P rulings, `docs/history.md` 2026-08-12).
//
// Pure, synchronous, no I/O: computes the R.1 anchor set and the R.0 "runs"
// between them, entirely from data that already exists before any forced-
// alignment pass runs — the Hirschberg alignment (`whisperService.ts`'s
// `alignQueryToSubject`), the Whisper token array, the detected-silence array,
// and the audio duration. NOT wired into Apply Sync or any live path (Slice
// D1) — this module has no caller yet.
//
// SCOPE NOTE on R.7's `CONF_MIN`: that gate rejects a run's FIRST/LAST word as
// a boundary when forced alignment's OWN per-word confidence (an FA OUTPUT)
// falls below the floor. This module runs strictly before any FA pass and has
// no FA-confidence input in its stated shape (Hirschberg output + tokens +
// silences + duration) — `CONF_MIN` is defined in `syncConstants.ts` for that
// later, post-FA consumer, but is not read here.
//
// VERIFIED (was an unverified assumption at D1 landing; corrected here before
// any real caller exists): `alignment.matchedSubjectOf[qi]` is NOT a direct
// index into `tokens`. `TokenAlignment.matchedSubjectOf` is defined as
// "query i -> subject index" (`whisperService.ts:146`) against whatever
// `subject: string[]` was passed to `alignQueryToSubject` — and the one real
// caller, `extractSegmentAlignments`, passes `subjectWords =
// tokenWords.map(t => t.word)` (`whisperService.ts:823-824`), not the raw
// token array. `tokenWords` expands EACH token into all the words it
// canonicalizes to (`whisperService.ts:793-805`, its own comment: "Whisper
// tokens may contain multiple words"), dropping any that canonicalize to zero
// words (`whisperService.ts:803`'s `word.length > 0` guard). So
// `tokenWords.length` routinely differs from `tokens.length` in both
// directions, and the two index spaces diverge on any token that isn't
// exactly one canonical word. The subject-index -> real-token-index mapping
// already exists as `tokenWords[i].tokenIdx` (`whisperService.ts:803`) — this
// module takes that mapping as an explicit `subjectTokenIdx` parameter rather
// than assuming identity.
// ---------------------------------------------------------------------------

import type { TranscriptToken } from '../types';
import type { TokenAlignment, TokenAlignmentOp } from './whisperService';
import type { SilenceInterval } from './silenceDetector';
import { canonicalize } from './textNormalize';
import {
  ANCHOR_AGREEMENT_SEC,
  MIN_ANCHOR_WORD_CHARS,
  GLIDE_INITIAL_CHARS,
  RUN_SURVIVAL_MIN_RUN_LONG,
  MAX_RUN_SEC,
} from './syncConstants';

/** One R.1 anchor: script (query) word `qi`, the Whisper token it agreed
 *  with, and the agreed time. */
export interface FaAnchor {
  qi: number;
  tokenIdx: number;
  /** I6: always a detected silence's `endSec` — never `token.startSec`. */
  timeSec: number;
}

/** Where a run's boundary came from — lets a downstream consumer tell a real
 *  (three-source-agreement) anchor apart from a forced split (R-P) without
 *  re-deriving it. */
export type RunBoundaryProvenance =
  | 'corpus-start'
  | 'corpus-end'
  | 'agreed-anchor'
  | 'forced-split-silence'
  | 'forced-split-max-run';

/** A run's raw (pre-R.2-padding) time window between two boundaries. */
export interface FaRun {
  windowStart: number;
  windowEnd: number;
  startProvenance: RunBoundaryProvenance;
  endProvenance: RunBoundaryProvenance;
}

export interface FaAnchorResult {
  anchors: FaAnchor[];
  runs: FaRun[];
}

/** R-O admissibility: exactly one canonical word, at least
 *  `MIN_ANCHOR_WORD_CHARS` characters, not glide-initial. Anything that
 *  doesn't canonicalize to exactly one word (punctuation-only token, a
 *  digit/contraction expansion) is rejected rather than guessed at — R-O's
 *  own stated bias toward rejection over a wrong anchor. */
function isDistinctive(tokenText: string): boolean {
  const words = canonicalize(tokenText);
  if (words.length !== 1) return false;
  const w = words[0]!;
  return w.length >= MIN_ANCHOR_WORD_CHARS && !GLIDE_INITIAL_CHARS.has(w[0]!);
}

/** R.1(b): the length of the contiguous run of `'match'` ops containing
 *  `qi`. Reuses `RUN_SURVIVAL_MIN_RUN_LONG` as `MIN_ANCHOR_RUN` per the plan's
 *  own instruction and the R-O/R-P ruling pass — no duplicate constant. */
function contiguousMatchRunLength(ops: readonly TokenAlignmentOp[], qi: number): number {
  if (ops[qi]?.type !== 'match') return 0;
  let len = 1;
  for (let i = qi - 1; i >= 0 && ops[i]!.type === 'match'; i--) len++;
  for (let i = qi + 1; i < ops.length && ops[i]!.type === 'match'; i++) len++;
  return len;
}

/** A seam exactly ON a silence's edge is not INSIDE it. This is a
 *  strict-inequality guard against float equality, not a tolerance: there is
 *  no distance below which a seam "counts as" spanned, so widening it would
 *  reintroduce exactly the proximity reasoning R-U removed. Deliberately NOT
 *  in `syncConstants.ts` — that file holds tuning constants, and this is not
 *  one. */
const SEAM_INTERIOR_EPSILON = 1e-9;

/** Every INTERIOR token seam, ascending: the instant between token `i-1` and
 *  token `i`, for `i >= 1`, taken as `tokens[i].startSec`.
 *
 *  Sorted defensively rather than assumed: `spansATokenSeam` binary-searches
 *  this array, and a single out-of-order token would silently make that search
 *  wrong instead of merely slow.
 *
 *  Note the consequence, which is intended: the FIRST token has no seam before
 *  it, so it can never carry an R.1 anchor. The corpus start is already a
 *  boundary (`'corpus-start'`); it does not need an anchor to also assert it. */
function tokenSeamTimes(tokens: readonly TranscriptToken[]): number[] {
  const seams: number[] = [];
  for (let i = 1; i < tokens.length; i++) seams.push(tokens[i]!.startSec);
  return seams.sort((a, b) => a - b);
}

/**
 * R-U (WS1 Session B) — the ZERO-SEAM REJECTION RULE, stated structurally.
 *
 * Does this silence span a token seam at all? That is a property of the
 * silence itself, measured against the token index space — not a comparison
 * against any timestamp. A silence lying wholly inside one token's own span
 * (the ear-pass item 6 shape: `[172.70, 173.12]` inside token 464
 * "chemical" `[172.57, 173.18]`) separates nothing, and therefore cannot mark
 * a boundary however close it happens to sit to one.
 *
 * This is the R2 invariant applied as written (`CLAUDE.md` §4 Sync/Whisper:
 * "Timestamps may measure distance; they must never decide identity"). The
 * predecessor of this function decided IDENTITY — "this silence is that
 * boundary" — from raw-timestamp proximity alone, which is the failure this
 * invariant names.
 */
function spansATokenSeam(silence: SilenceInterval, seamTimes: readonly number[]): boolean {
  // First seam strictly after the silence starts; the silence spans a seam
  // iff that seam also falls strictly before the silence ends.
  let lo = 0;
  let hi = seamTimes.length;
  const after = silence.startSec + SEAM_INTERIOR_EPSILON;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (seamTimes[mid]! > after) hi = mid;
    else lo = mid + 1;
  }
  const first = seamTimes[lo];
  return first !== undefined && first < silence.endSec - SEAM_INTERIOR_EPSILON;
}

/** R.1(c) + agreement test: the silence whose `endSec` is closest to
 *  `tokenStartSec`, within `ANCHOR_AGREEMENT_SEC` — or `undefined` if none
 *  agrees. I6: the anchor's time value is this silence's `endSec`, never
 *  `tokenStartSec` itself.
 *
 *  R-U: the structural veto runs FIRST, per candidate, so a silence that spans
 *  no token seam is out of the running before any distance is computed. What
 *  is left for `ANCHOR_AGREEMENT_SEC` is strictly a SELECTION job among
 *  structurally admissible survivors — how far to look, and which survivor to
 *  prefer — never the identity question of whether a silence IS this
 *  boundary. Nothing here decides identity by distance. */
function findAgreeingSilence(
  tokenStartSec: number,
  silences: readonly SilenceInterval[],
  seamTimes: readonly number[],
): SilenceInterval | undefined {
  let best: SilenceInterval | undefined;
  let bestDist = Infinity;
  for (const s of silences) {
    if (!spansATokenSeam(s, seamTimes)) continue; // R-U veto — structure, before distance
    const dist = Math.abs(tokenStartSec - s.endSec);
    if (dist <= ANCHOR_AGREEMENT_SEC && dist < bestDist) {
      best = s;
      bestDist = dist;
    }
  }
  return best;
}

/** Every R.1-admissible anchor, in `qi` order. Per R.1's own text, an
 *  admissible time IS an anchor unconditionally — there is no further
 *  selection step among competing candidates. */
function computeAnchors(
  alignment: TokenAlignment,
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  subjectTokenIdx: ArrayLike<number>,
): FaAnchor[] {
  const anchors: FaAnchor[] = [];
  const seamTimes = tokenSeamTimes(tokens); // R-U — computed once per run, not per candidate
  for (const op of alignment.ops) {
    if (op.type !== 'match') continue;
    const subjectIdx = alignment.matchedSubjectOf[op.qi];
    if (subjectIdx === undefined || subjectIdx < 0) continue;
    const tokenIdx = subjectTokenIdx[subjectIdx];
    if (tokenIdx === undefined || tokenIdx < 0) continue;
    const token = tokens[tokenIdx];
    if (!token) continue;
    if (!isDistinctive(token.text)) continue; // R-O
    if (contiguousMatchRunLength(alignment.ops, op.qi) < RUN_SURVIVAL_MIN_RUN_LONG) continue; // R.1(b)
    const silence = findAgreeingSilence(token.startSec, silences, seamTimes); // R.1(c) + I6 + R-U
    if (!silence) continue;
    anchors.push({ qi: op.qi, tokenIdx, timeSec: silence.endSec });
  }
  return anchors;
}

/** R-P: the longest detected silence fully inside `(windowStart, windowEnd]`,
 *  or `undefined` if none. Split point is that silence's `endSec` (I6-style —
 *  never a raw token timestamp), never its `startSec`. */
function longestSilenceInWindow(
  windowStart: number,
  windowEnd: number,
  silences: readonly SilenceInterval[],
): SilenceInterval | undefined {
  let longest: SilenceInterval | undefined;
  for (const s of silences) {
    if (s.startSec < windowStart || s.endSec > windowEnd) continue;
    if (!longest || s.endSec - s.startSec > longest.endSec - longest.startSec) longest = s;
  }
  return longest;
}

/**
 * Computes the R.1 anchor set and the R.0 runs between them.
 *
 * I1/I2 (Model P, per R-E): this function never produces a gap. Every run's
 * `windowEnd` equals the next run's `windowStart` exactly — a run boundary
 * belongs to both the run that ends there and the run that starts there, the
 * same "the preceding span simply holds longer" principle R-E applies to a
 * wildcard span, generalized to every boundary this module emits (agreed
 * anchor or forced split alike). Windows may overlap once a later stage
 * applies R.2's padding — this module emits only the raw, pre-padding bounds.
 *
 * I14 (Part F, `sync-pipeline-v2-plan.md`: "the aligner is exonerated, leave
 * it alone"): `alignment` is read only — never mutated, never re-scored.
 *
 * `subjectTokenIdx[sj]` must resolve `alignment.matchedSubjectOf`'s subject
 * space to a real index into `tokens` — e.g. `whisperService.ts`'s
 * `tokenWords.map(t => t.tokenIdx)` for the array actually passed as
 * `alignQueryToSubject`'s `subject` argument. See the header VERIFIED note:
 * the subject space is words, not tokens, and the two are not interchangeable.
 */
export function computeFaAnchors(
  alignment: TokenAlignment,
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
  subjectTokenIdx: ArrayLike<number>,
): FaAnchorResult {
  const anchors = computeAnchors(alignment, tokens, silences, subjectTokenIdx);

  interface Boundary {
    time: number;
    provenance: RunBoundaryProvenance;
  }
  const boundaries: Boundary[] = [
    { time: 0, provenance: 'corpus-start' },
    ...anchors.map((a): Boundary => ({ time: a.timeSec, provenance: 'agreed-anchor' })),
    { time: audioDuration, provenance: 'corpus-end' },
  ];

  const runs: FaRun[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    let start = boundaries[i]!;
    const end = boundaries[i + 1]!;

    // R.4/R-P: force-split repeatedly while the span to the next real
    // boundary exceeds MAX_RUN_SEC.
    while (end.time - start.time > MAX_RUN_SEC) {
      const windowEnd = start.time + MAX_RUN_SEC;
      const silence = longestSilenceInWindow(start.time, windowEnd, silences);
      const split: Boundary = silence
        ? { time: silence.endSec, provenance: 'forced-split-silence' }
        : { time: windowEnd, provenance: 'forced-split-max-run' };
      runs.push({
        windowStart: start.time,
        windowEnd: split.time,
        startProvenance: start.provenance,
        endProvenance: split.provenance,
      });
      start = split;
    }

    runs.push({
      windowStart: start.time,
      windowEnd: end.time,
      startProvenance: start.provenance,
      endProvenance: end.provenance,
    });
  }

  return { anchors, runs };
}
