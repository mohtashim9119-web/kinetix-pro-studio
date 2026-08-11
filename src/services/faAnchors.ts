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
// ASSUMPTION (undocumented upstream, stated explicitly since this module has
// no real caller yet to fix it in place): `alignment`'s subject sequence is
// one entry per `tokens[]` element — i.e. `alignment.matchedSubjectOf[qi]`,
// when >= 0, is a direct index into `tokens`. This matches R.1(a)'s own text
// ("the Hirschberg alignment maps `w` to a specific Whisper token") rather
// than `whisperService.ts`'s internal sub-token-word expansion bridge
// (`tokenWords`), which is a wiring detail for whoever calls this module.
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

/** R.1(c) + agreement test: the silence whose `endSec` is closest to
 *  `tokenStartSec`, within `ANCHOR_AGREEMENT_SEC` — or `undefined` if none
 *  agrees. I6: the anchor's time value is this silence's `endSec`, never
 *  `tokenStartSec` itself. */
function findAgreeingSilence(
  tokenStartSec: number,
  silences: readonly SilenceInterval[],
): SilenceInterval | undefined {
  let best: SilenceInterval | undefined;
  let bestDist = Infinity;
  for (const s of silences) {
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
): FaAnchor[] {
  const anchors: FaAnchor[] = [];
  for (const op of alignment.ops) {
    if (op.type !== 'match') continue;
    const tokenIdx = alignment.matchedSubjectOf[op.qi];
    if (tokenIdx === undefined || tokenIdx < 0) continue;
    const token = tokens[tokenIdx];
    if (!token) continue;
    if (!isDistinctive(token.text)) continue; // R-O
    if (contiguousMatchRunLength(alignment.ops, op.qi) < RUN_SURVIVAL_MIN_RUN_LONG) continue; // R.1(b)
    const silence = findAgreeingSilence(token.startSec, silences); // R.1(c) + I6
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
 */
export function computeFaAnchors(
  alignment: TokenAlignment,
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
): FaAnchorResult {
  const anchors = computeAnchors(alignment, tokens, silences);

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
