import { invoke, Channel } from '@tauri-apps/api/core';
import type { Asset, VideoSegment, TranscriptToken } from '../types';
import type { SilenceInterval } from './silenceDetector';
import { canonicalize, canonicalizeSceneDoc } from './textNormalize';
import {
  ALIGN_MATCH_SCORE, ALIGN_MISMATCH_SCORE, ALIGN_GAP_SCORE,
  LOW_CONFIDENCE_RATIO, MALFORMED_TOKEN_DURATION_TOLERANCE_SEC,
  TEMPORAL_TOLERANCE_RATIO, TEMPORAL_TOLERANCE_MIN_SEC, TEMPORAL_TOLERANCE_MAX_SEC,
  TEMPORAL_BONUS_MAX, TEMPORAL_BONUS_CENTRAL_FRACTION,
  MAX_CONCAT_TOKENS, MAX_CONCAT_GAP_SEC,
  RUN_SURVIVAL_MAX_HOLE, RUN_SURVIVAL_MIN_RUN_SHORT, RUN_SURVIVAL_MIN_RUN_LONG,
  RUN_SURVIVAL_DENSITY_MIN_CONFIDENCE, RUN_SURVIVAL_DENSITY_MAX_MEDIAN_GAP,
} from './syncConstants';
export type { TranscriptToken };

type WhisperEvent =
  | { event: 'Progress'; data: { percent: number } }
  | { event: 'Done'; data: { tokens: TranscriptToken[] } }
  | { event: 'Error'; data: { message: string } };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 3 * 4096; // 12288 — multiple of 3, safe boundary
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Alignment tokenizer (architecture doc §3.2, R1)
// ---------------------------------------------------------------------------
// The number/contraction/symbol canonicalization that used to live inline here
// (the D16 helpers: cardinal/year readings, the CONTRACTIONS map, the terminal
// non-alnum strip) moved WHOLESALE into the shared ./textNormalize `canonicalize`
// pipeline as part of the two-normalizer unification (G4). This keeps only the
// public name `canonicalizeForAlignment` as a thin wrapper so existing callers
// (normalize, the aligner, the tests) are unaffected.

/**
 * Alignment tokenizer — the unified normalizer (architecture doc §3.2, R1).
 * A thin wrapper over the shared `canonicalize` pipeline in ./textNormalize, so
 * the timing path and the filename path (syncEngine.normalizeForMatch) can never
 * drift on the Unicode-hygiene layer again. Applied IDENTICALLY to both the
 * scene-doc side and the Whisper-token side, so a spelled-out number and its
 * digit form (and hyphenated compounds vs. their glued forms) collapse to the
 * same word sequence; anything not covered is a LOCAL diff cost in the
 * Hirschberg aligner below, never an asymmetric cascade.
 */
export function canonicalizeForAlignment(s: string): string[] {
  return canonicalize(s);
}

// ---------------------------------------------------------------------------
// Public helpers (also used by useWhisper)
// ---------------------------------------------------------------------------

/**
 * Word-level normalizer used by the aligner. Delegates to
 * canonicalizeForAlignment so numbers/contractions/symbols canonicalize
 * identically on the script and Whisper-token sides (D16).
 */
export function normalize(s: string): string[] {
  return canonicalizeForAlignment(s);
}

/**
 * Scene-doc-side word normalizer (WS4 Feature 1, decision 13a). Identical to
 * `normalize` except that stage directions are stripped first — see
 * textNormalize.ts's `stripStageDirections` for the grammar and for why this is
 * deliberately NOT applied to the transcript side.
 *
 * Empty-result guard: if stripping removes EVERYTHING, the original text is
 * used instead. A fully-parenthesized scene is far more likely to be a
 * legitimate spoken aside than an empty scene, and silently emptying it would
 * turn a normal segment into a zero-word "neutral" one — changing its
 * classification rather than just cleaning up its words (architecture doc
 * §3.8(b), final bullet).
 */
export function normalizeSceneDoc(s: string): string[] {
  const stripped = canonicalizeSceneDoc(s);
  return stripped.length > 0 ? stripped : normalize(s);
}

// --- Alignment instrumentation (__ALIGN_INSTRUMENT__) ------------------------
// Gated on globalThis.__ALIGN_INSTRUMENT__, dormant by default (mirrors the
// __WF_INSTRUMENT__ convention in SegmentWaveform.tsx / waveformDrawQueue.ts):
// zero effect on normal runs. When enabled it times the whole
// alignScenestoTranscript pass end-to-end and logs the query/subject sequence
// lengths + optimal score, so the Hirschberg aligner's linear-space and O(n·m)
// time cost can be verified on the 294-segment fixture (doc §3.1 note) without a
// separate profiling pass. Enable in the devtools console with
// `globalThis.__ALIGN_INSTRUMENT__ = true` before Apply Sync; results are logged
// once per pass and accumulated on globalThis.__alignRun.
interface AlignInstr {
  passes: number;
  totalMs: number[];
}
function alignInstrEnabled(): boolean {
  return (globalThis as unknown as { __ALIGN_INSTRUMENT__?: boolean }).__ALIGN_INSTRUMENT__ === true;
}
function alignInstr(): AlignInstr {
  const g = globalThis as unknown as { __alignRun?: AlignInstr };
  return (g.__alignRun ??= { passes: 0, totalMs: [] });
}
// -----------------------------------------------------------------------------

// ===========================================================================
// Hirschberg diff aligner (architecture doc §3.1, R7)
// ===========================================================================
// Replaces the greedy positional matcher (G3/B2 root cause). A single global
// alignment is computed between the scene-doc word sequence (query) and the
// transcript token-word sequence (subject) using the Needleman-Wunsch scoring
// recurrence with Hirschberg's linear-space (O(n+m)) divide-and-conquer
// traceback — the same optimal alignment as full-matrix NW, at no memory
// ceiling. Free end-gaps on the SUBJECT side only: leading transcript words
// before the first scene-doc match and trailing ones after the last match cost
// nothing (partial-coverage design — intro/outro audio is expected), while a
// scene-doc word with no transcript counterpart is a real, penalized deletion.
//
// Scoring constants live in ./syncConstants (match +1, mismatch −1, gap −1;
// starting values, tuned only by the WS5 R8 fixture pass). Monotonicity is
// inherent to the DP path, so the old maxStart cap, overshoot guard, and
// low-confidence cursor hold are all gone — the DP considers every position
// (fixes S5) and global optimization disambiguates repeated phrases (fixes S4).

/** One query-word's alignment op. Insertions (subject-only) are not emitted —
 *  only query words are classified, since per-segment extraction reads them. */
export interface TokenAlignmentOp {
  type: 'match' | 'sub' | 'del';
  qi: number;         // query (scene-doc) word index — always set
  sj: number;         // subject (transcript) word index for match/sub; -1 for del
}

export interface TokenAlignment {
  ops: TokenAlignmentOp[];         // one per query word, in query order
  matchedSubjectOf: Int32Array;    // query i -> subject index iff a true match (equal words), else -1
  score: number;                   // optimal semi-global alignment score
}

// Temporal-proximity scoring bonus (Part 2, token-stealing fix, WS6): an
// additive per-subject-position bonus, applied ONLY when the pair is a true
// textual match — a mismatch/substitution score is always exactly
// ALIGN_MISMATCH_SCORE, so the bonus can never turn a wrong word into a
// match, only rank competing correct-word matches (see computeTemporalBonus
// below). Every existing caller passes an all-zero bonus array (the default
// in alignQueryToSubject), so this is a pure extension — behavior is
// byte-identical to the pre-WS6 scorer whenever no bonus is supplied.
function pairScore(a: string, b: string, bonus: number): number {
  return a === b ? ALIGN_MATCH_SCORE + bonus : ALIGN_MISMATCH_SCORE;
}

function reversedSlice(arr: string[]): string[] {
  return arr.slice().reverse();
}

function reversedFloats(arr: Float64Array): Float64Array {
  return arr.slice().reverse();
}

/**
 * Forward Needleman-Wunsch scoring — returns the LAST ROW of the global
 * alignment DP (charged gaps on both sides). O(m) space. Length m+1.
 * `sBonus` runs parallel to `s` (per-subject-position temporal bonus, see
 * `pairScore`) — Float64Array, not Int32Array, since a bonus is fractional
 * (max +0.3) and would otherwise be truncated to 0 on every non-integer value.
 */
function nwForwardRow(q: string[], s: string[], sBonus: Float64Array): Float64Array {
  const m = s.length;
  let prev = new Float64Array(m + 1);
  for (let j = 1; j <= m; j++) prev[j] = j * ALIGN_GAP_SCORE;
  let curr = new Float64Array(m + 1);
  for (let i = 1; i <= q.length; i++) {
    curr[0] = i * ALIGN_GAP_SCORE;
    const qi = q[i - 1]!;
    for (let j = 1; j <= m; j++) {
      const diag = prev[j - 1]! + pairScore(qi, s[j - 1]!, sBonus[j - 1]!);
      const del = prev[j]! + ALIGN_GAP_SCORE;   // query word consumed, subject gap
      const ins = curr[j - 1]! + ALIGN_GAP_SCORE; // subject word consumed, query gap
      curr[j] = Math.max(diag, del, ins);
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev;
}

/**
 * Forward NW scoring with a FREE LEADING SUBJECT GAP (row 0 initialized to 0
 * instead of accumulating gap penalties). Returns the last row H[n][*]; its
 * argmax column is the optimal semi-global END column (free trailing subject
 * gap), and its max value is the optimal semi-global score. O(m) space.
 */
function nwForwardRowFreeLead(q: string[], s: string[], sBonus: Float64Array): Float64Array {
  const m = s.length;
  let prev = new Float64Array(m + 1); // row 0 = all zeros: free leading subject gap
  let curr = new Float64Array(m + 1);
  for (let i = 1; i <= q.length; i++) {
    curr[0] = i * ALIGN_GAP_SCORE;  // query deletions are always charged
    const qi = q[i - 1]!;
    for (let j = 1; j <= m; j++) {
      const diag = prev[j - 1]! + pairScore(qi, s[j - 1]!, sBonus[j - 1]!);
      const del = prev[j]! + ALIGN_GAP_SCORE;
      const ins = curr[j - 1]! + ALIGN_GAP_SCORE;
      curr[j] = Math.max(diag, del, ins);
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev;
}

/**
 * Backward NW scoring for a global alignment of q against s[0..b) that ends
 * EXACTLY at column b (all of q and all of the chosen infix consumed). Returns
 * G[0][*] over columns 0..b; its argmax is the optimal START column a for the
 * fixed end b. O(b) space.
 */
function nwBackwardRowToFixedEnd(q: string[], s: string[], b: number, sBonus: Float64Array): Float64Array {
  const n = q.length;
  let next = new Float64Array(b + 1); // row i = n
  for (let j = 0; j <= b; j++) next[j] = (b - j) * ALIGN_GAP_SCORE;
  let curr = new Float64Array(b + 1);
  for (let i = n - 1; i >= 0; i--) {
    curr[b] = (n - i) * ALIGN_GAP_SCORE;
    const qi = q[i]!;
    for (let j = b - 1; j >= 0; j--) {
      const diag = next[j + 1]! + pairScore(qi, s[j]!, sBonus[j]!);
      const del = next[j]! + ALIGN_GAP_SCORE;
      const ins = curr[j + 1]! + ALIGN_GAP_SCORE;
      curr[j] = Math.max(diag, del, ins);
    }
    const tmp = next; next = curr; curr = tmp;
  }
  return next;
}

/**
 * Standard GLOBAL Hirschberg (charged gaps) aligning q against s (a chosen
 * subject infix, absolute offset sOff). Recursive divide-and-conquer in O(n+m)
 * space; produces the same optimal alignment as full-matrix NW. Records true
 * matches into `matchedSubjectOf` (absolute subject indices) and appends one op
 * per query word to `ops`. `sBonus` runs parallel to `s`, sliced identically at
 * every recursive step.
 */
function hirschbergGlobal(
  q: string[], qOff: number,
  s: string[], sBonus: Float64Array, sOff: number,
  matchedSubjectOf: Int32Array,
  ops: TokenAlignmentOp[],
): void {
  const n = q.length;
  const m = s.length;
  if (n === 0) return; // subject words unmatched: nothing to classify for the query
  if (m === 0) {
    for (let i = 0; i < n; i++) ops.push({ type: 'del', qi: qOff + i, sj: -1 });
    return;
  }
  if (n === 1) {
    // One query word against a non-empty subject span: aligning always beats
    // deleting (align − delete = bestScore + 2 ≥ 1 for these scores), so pick
    // the best subject position (leftmost on ties, for determinism — the
    // temporal bonus, when present, breaks a real tie toward the temporally
    // closer occurrence instead of leaving it to array order).
    const x = q[0]!;
    let bestJ = 0;
    let bestSc = pairScore(x, s[0]!, sBonus[0]!);
    for (let j = 1; j < m; j++) {
      const sc = pairScore(x, s[j]!, sBonus[j]!);
      if (sc > bestSc) { bestSc = sc; bestJ = j; }
    }
    if (x === s[bestJ]) {
      matchedSubjectOf[qOff] = sOff + bestJ;
      ops.push({ type: 'match', qi: qOff, sj: sOff + bestJ });
    } else {
      ops.push({ type: 'sub', qi: qOff, sj: sOff + bestJ });
    }
    return;
  }
  const qMid = n >> 1;
  const qL = q.slice(0, qMid);
  const qR = q.slice(qMid);
  const scoreL = nwForwardRow(qL, s, sBonus);
  const scoreR = nwForwardRow(reversedSlice(qR), reversedSlice(s), reversedFloats(sBonus));
  let sMid = 0;
  let best = -Infinity;
  for (let j = 0; j <= m; j++) {
    const v = scoreL[j]! + scoreR[m - j]!;
    if (v > best) { best = v; sMid = j; }
  }
  hirschbergGlobal(qL, qOff, s.slice(0, sMid), sBonus.slice(0, sMid), sOff, matchedSubjectOf, ops);
  hirschbergGlobal(qR, qOff + qMid, s.slice(sMid), sBonus.slice(sMid), sOff + sMid, matchedSubjectOf, ops);
}

/**
 * Semi-global (free-end-gap on the subject side) alignment of the full query
 * against the full subject. Finds the optimal subject infix [a, b) via two
 * linear-space scoring passes — a forward pass with a free leading subject gap
 * fixes the end b (last-row argmax) and its score, a backward pass to that
 * fixed end fixes the start a — then runs a standard global Hirschberg over
 * q × subject[a:b). The free leading/trailing subject gaps (skipped prefix/
 * suffix) cost nothing, exactly modelling the partial-coverage design.
 *
 * `subjectBonus`, if supplied, is a per-subject-position additive score bonus
 * (Part 2, token-stealing fix, WS6) — same length as `subject`, applied only
 * to true textual matches (see `pairScore`). Omitted ⇒ an all-zero bonus, so
 * every pre-WS6 caller (and this function's own property/unit tests) gets the
 * exact original scores back.
 */
export function alignQueryToSubject(
  query: string[],
  subject: string[],
  subjectBonus?: ArrayLike<number>,
): TokenAlignment {
  // __ALIGN_INSTRUMENT__ (doc §3.1 note): time the Hirschberg pass and log the
  // sequence lengths + optimal score, so the linear-space / O(n·m) time claims
  // can be verified on the 294-segment fixture without a separate profiling pass.
  const _instrOn = alignInstrEnabled();
  const _t0 = _instrOn ? performance.now() : 0;

  const n = query.length;
  const m = subject.length;
  const matchedSubjectOf = new Int32Array(n).fill(-1);
  const ops: TokenAlignmentOp[] = [];

  if (n === 0) return { ops, matchedSubjectOf, score: 0 };
  if (m === 0) {
    for (let i = 0; i < n; i++) ops.push({ type: 'del', qi: i, sj: -1 });
    return { ops, matchedSubjectOf, score: n * ALIGN_GAP_SCORE };
  }

  const sBonus = subjectBonus ? Float64Array.from(subjectBonus) : new Float64Array(m);

  // End column b + optimal semi-global score (free leading subject gap).
  const lastRow = nwForwardRowFreeLead(query, subject, sBonus);
  let b = 0;
  let score = lastRow[0]!;
  for (let j = 1; j <= m; j++) {
    if (lastRow[j]! > score) { score = lastRow[j]!; b = j; }
  }

  // Start column a (best start for the fixed end b). b === 0 ⇒ empty infix.
  let a = 0;
  if (b > 0) {
    const g0 = nwBackwardRowToFixedEnd(query, subject, b, sBonus);
    let bestStart = g0[0]!;
    for (let j = 1; j <= b; j++) {
      if (g0[j]! > bestStart) { bestStart = g0[j]!; a = j; }
    }
  }

  hirschbergGlobal(query, 0, subject.slice(a, b), sBonus.slice(a, b), a, matchedSubjectOf, ops);
  // Recursion appends in increasing-qi order already; sort defensively.
  ops.sort((x, y) => x.qi - y.qi);

  if (_instrOn) {
    // eslint-disable-next-line no-console
    console.log(
      '[align-instr] Hirschberg align: queryWords=%d subjectWords=%d infix=[%d,%d) score=%d in %sms',
      n, m, a, b, score, (performance.now() - _t0).toFixed(2),
    );
  }
  return { ops, matchedSubjectOf, score };
}

/**
 * Per-segment alignment result read off the single global alignment (doc
 * §3.1.1, R11). The confidence/matched/audioRegion fields are new in the sync
 * rewrite: WS1a computes and carries them (the abort gate that consumes them is
 * WS1b). t0/t1/firstTokenIdx/lastTokenIdx retain their meaning for the
 * unchanged downstream Step-2/silence/clamp stages.
 */
export interface AlignResult {
  t0: number;
  t1: number;
  firstTokenIdx: number;          // token index of the first matched word, -1 if none
  lastTokenIdx: number;           // token index of the last matched word, -1 if none
  confidence: number;             // matched scene-doc words / total scene-doc words (0..1) — R11
  /** Bug C (consecutive-run survival requirement, 2026-08-02): NO LONGER
   *  `matchedCount > 0`. A segment must additionally have its matched words
   *  form at least one qualifying contiguous run — see `hasQualifyingRun`/
   *  `computeLongestRunWithHoles` and `longestRun` below. A segment can have
   *  `matchedWords > 0` and STILL be `matched === false` (scattered,
   *  non-contiguous matches too thin to trust) — this is a real, intended
   *  outcome, not a bug: see the Bug 2 doctrine reversal in
   *  syncConstants.ts's RUN_SURVIVAL_* header. */
  matched: boolean;
  matchedWords: number;           // WS1b: numerator for confidence + the bidirectional coverage metric (§3.3).
                                   // Bug C: preserved as the REAL count even when `matched` is false due to
                                   // an insufficient run — never zeroed, since computeCoverageSummary's
                                   // coverage numerators read this regardless of `matched` (see audit Q8).
  totalWords: number;             // WS1b: 0 for a zero-token (classification-neutral) segment (§3.1.1 point 4)
  /** Bug C — the longest qualifying-shape run (matched positions + bridged
   *  holes, see `computeLongestRunWithHoles`) found for this segment, always
   *  populated (0 when the segment has no true match at all). Purely
   *  informational at the type level — `matched` is the derived decision;
   *  this is what a caller (the sync log) can show the user to explain WHY a
   *  particular segment survived or was skipped. */
  longestRun: number;
  audioRegion?: { startSec: number; endSec: number }; // matched transcript time range, present iff matched
  /** Rescue observability (false-positive rescue fix, 2026-07-31) — which
   *  pass (Parts 1-3, WS6) recovered this segment, present iff the rescue ran
   *  AND its claim was accepted (survived the forward-ordering bound above).
   *  Undefined for a segment matched directly by the global pass (no rescue
   *  needed) AND for a segment whose rescue claim was rejected (the segment
   *  stays genuinely zero-matched in that case — see the bound's doc
   *  comment). Lets a caller (App.tsx's sync log) show a user which segments
   *  were recovered and by which mechanism, distinct from a normal match. */
  recoveredVia?: 'windowed' | 'global' | 'concat';
  /** Rescue observability — the recovered claim's own time range (the same
   *  values `audioRegion` would carry), present under the exact same
   *  condition as `recoveredVia`. Kept as a separate field rather than
   *  reusing `audioRegion` so a caller can tell "recovered" and "matched
   *  directly" apart without also checking `recoveredVia`. */
  recoveredRegion?: { startSec: number; endSec: number };
}

/**
 * WS1b: `alignScenestoTranscript`'s public return widens from `{t0,t1}` to
 * this full per-segment result (doc §3.1.1, §4) — same shape as `AlignResult`,
 * a distinct name because the per-segment result IS the alignment result;
 * nothing here is aligner-internal. Lets the orchestrator (App.tsx) compute
 * the bidirectional coverage metric (§3.3) and run the two-signal abort gate
 * (§3.4/R13) + middle-gap check (§3.5/R12) before committing.
 */
export type SegmentAlignment = AlignResult;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Temporal-proximity scoring bonus (Part 2, token-stealing fix, WS6): additive
 * bonus for a token at `tokenStartSec`, peaking at `TEMPORAL_BONUS_MAX` dead
 * center of the window and decaying linearly to 0 at the edge of the central
 * `TEMPORAL_BONUS_CENTRAL_FRACTION` band (0 beyond it). Applied only to a true
 * textual match by `pairScore` — this function has no notion of word identity,
 * so it can never turn a wrong word into a match.
 */
function temporalBonus(tokenStartSec: number, expectedCenter: number, halfWindow: number): number {
  if (halfWindow <= 0) return 0;
  const normalizedDistance = Math.abs(tokenStartSec - expectedCenter) / halfWindow;
  return Math.max(0, TEMPORAL_BONUS_MAX * (1 - normalizedDistance / TEMPORAL_BONUS_CENTRAL_FRACTION));
}

/**
 * Part 3 fallback: greedy, order-preserving EXACT-text matching of `queryWords`
 * against `windowed` (a segment's own bounded, temporally-scoped token-word
 * list). For each query word in order, takes the first not-yet-consumed
 * windowed word with identical text — a strict subsequence match, so it can
 * only ever find words that are genuinely, verbatim present in the window; it
 * cannot introduce a false positive the way a fuzzy/substitution match could.
 */
function findExactSequentialMatches(
  queryWords: string[],
  windowed: Array<{ word: string; globalIdx: number }>,
): Array<{ queryIdx: number; globalIdx: number }> {
  const out: Array<{ queryIdx: number; globalIdx: number }> = [];
  let cursor = 0;
  for (let qi = 0; qi < queryWords.length; qi++) {
    const word = queryWords[qi]!;
    for (let j = cursor; j < windowed.length; j++) {
      if (windowed[j]!.word === word) {
        out.push({ queryIdx: qi, globalIdx: windowed[j]!.globalIdx });
        cursor = j + 1;
        break;
      }
    }
  }
  return out;
}

/**
 * Sliding-window concatenation match (Pass 3 fallback, sub-word merge). For
 * each query word in order, walks the (already unclaimed) token-word list and
 * tries concatenating 1..`maxConcatTokens` consecutive entries — touching
 * within `maxConcatGapSec` of each other — to form the query word exactly.
 * Recovers Whisper's sub-word phoneme splits ("linen" -> "lin"+"en") that
 * `findExactSequentialMatches` structurally cannot: no single token equals
 * the full word, so a single-token exact match always fails on these.
 *
 * `unclaimed` must be in ascending `globalIdx` order (an index into the
 * caller's `tokenWords` array); `tokenWords`/`tokens` are only used to look
 * up each candidate's start/end timestamps for the touching-tolerance check.
 * Concatenation is exact-match only (lowercased, no separator — sub-word
 * fragments have no inter-word space) and only ever consumes tokens the
 * caller has already excluded as claimed — same "can only add, never steal"
 * guarantee as Pass 1/2. Returns matches in query order; a query word with no
 * match is simply omitted (partial recovery is acceptable).
 */
export function findConcatenatingMatches(
  queryWords: string[],
  unclaimed: Array<{ word: string; globalIdx: number }>,
  tokenWords: Array<{ word: string; tokenIdx: number; startSec: number }>,
  tokens: TranscriptToken[],
  options: { maxConcatTokens: number; maxConcatGapSec: number },
): Array<{ queryIdx: number; tokenStartIdx: number; tokenEndIdx: number }> {
  const { maxConcatTokens, maxConcatGapSec } = options;
  const out: Array<{ queryIdx: number; tokenStartIdx: number; tokenEndIdx: number }> = [];
  const used = new Set<number>();
  let searchFrom = 0;

  for (let qi = 0; qi < queryWords.length; qi++) {
    const queryWord = queryWords[qi]!.toLowerCase();
    let matchedHere = false;

    for (let start = searchFrom; start < unclaimed.length && !matchedHere; start++) {
      if (used.has(unclaimed[start]!.globalIdx)) continue;

      for (let span = 1; span <= maxConcatTokens && start + span - 1 < unclaimed.length; span++) {
        let ok = true;
        for (let k = 0; k < span; k++) {
          if (used.has(unclaimed[start + k]!.globalIdx)) { ok = false; break; }
        }
        if (!ok) break; // a claimed token blocks this AND every larger span from `start`

        for (let k = 1; k < span; k++) {
          const prevWord = tokenWords[unclaimed[start + k - 1]!.globalIdx]!;
          const currWord = tokenWords[unclaimed[start + k]!.globalIdx]!;
          const prevEnd = tokens[prevWord.tokenIdx]?.endSec ?? prevWord.startSec;
          const currStart = currWord.startSec;
          if (currStart - prevEnd > maxConcatGapSec) { ok = false; break; }
        }
        if (!ok) break; // gap too large — a larger span only widens the gap further

        const concatenated = unclaimed
          .slice(start, start + span)
          .map(u => u.word.toLowerCase())
          .join('');
        if (concatenated === queryWord) {
          out.push({
            queryIdx: qi,
            tokenStartIdx: unclaimed[start]!.globalIdx,
            tokenEndIdx: unclaimed[start + span - 1]!.globalIdx,
          });
          for (let k = 0; k < span; k++) used.add(unclaimed[start + k]!.globalIdx);
          searchFrom = start + span;
          matchedHere = true;
          break;
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Consecutive-run survival requirement (Bug C permanent fix, 2026-08-02)
// ---------------------------------------------------------------------------
// See syncConstants.ts's RUN_SURVIVAL_* header comment for the root-cause
// writeup. Summary: `matched` used to be `matchedCount > 0` — ANY single true
// word match kept a segment on the timeline, however isolated. A segment now
// additionally needs its matched words to form at least one qualifying
// CONTIGUOUS run — see `computeLongestRunWithHoles`/`hasQualifyingRun` below.

/** One query-word position's occupied transcript span, or `null` if that
 *  position has no true match. `start`/`end` are ABSOLUTE indices into the
 *  segment-independent `tokenWords` array (the same space `matchedSubjectOf`
 *  and the rescue passes' `globalIdx`/`tokenStartIdx`/`tokenEndIdx` live in) —
 *  a single-token match has `start === end`; a Pass-3 concatenated sub-word
 *  match spans `[tokenStartIdx, tokenEndIdx]`. */
export type OccEntry = { start: number; end: number } | null;

/**
 * Builds a segment's occupancy array from whichever source populated its
 * final match set — the global pass's `matchedSubjectOf` slice (single-token
 * spans), or a rescue's `localMatches`/`concatMatches` (single-token or
 * multi-token concatenated spans respectively). Indexed by segment-LOCAL
 * query position (0-based within the segment, not the global query array).
 */
export function buildOccArrayFromGlobalMatches(
  matchedSubjectOf: Int32Array,
  rangeStart: number,
  totalWords: number,
): OccEntry[] {
  const occ: OccEntry[] = new Array(totalWords).fill(null);
  for (let qi = 0; qi < totalWords; qi++) {
    const sj = matchedSubjectOf[rangeStart + qi]!;
    if (sj >= 0) occ[qi] = { start: sj, end: sj };
  }
  return occ;
}

/**
 * Computes the longest run of query-word positions that are either truly
 * matched or a "hole" (an unmatched position bridged by a run, up to
 * `maxHole` consecutive holes) — subject to the two structural rules (doc
 * comment in syncConstants.ts):
 *   1. A run must begin and end on a MATCHED position — it can never start
 *      or end on a hole.
 *   2. Between any two run-adjacent matched anchors (however many holes
 *      separate them, up to `maxHole`), the transcript-side spans must be
 *      CONTIGUOUS: the earlier anchor's `end` + 1 must equal the later
 *      anchor's `start`. This is what actually verifies the hole is a
 *      genuine paraphrase/deletion inside one continuous utterance — not
 *      two unrelated coincidental matches an accounting trick bridged. A
 *      substitution (a wrong word actually spoken in the gap) breaks this,
 *      because it occupies a transcript slot the pure "hole" arithmetic
 *      would otherwise skip over.
 *
 * Run length = the number of query-word positions spanned (matched
 * positions + holes inside), NOT the number of matched positions. Returns 0
 * when `occ` has no matched position at all. Pure; does not read totalWords
 * bands or thresholds — see `requiredRunLength`/`hasQualifyingRun` for those.
 */
export function computeLongestRunWithHoles(occ: OccEntry[], maxHole: number): number {
  let longest = 0;
  let runStartPos = -1;    // query position where the current run began
  let lastAnchorPos = -1;  // query position of the last matched anchor in the current run
  let lastAnchorEnd = -1;  // that anchor's occ.end (absolute transcript index)

  for (let pos = 0; pos < occ.length; pos++) {
    const entry = occ[pos];
    if (!entry) continue; // holes are only ever bridged FROM a matched anchor below

    if (lastAnchorPos < 0) {
      // First matched anchor seen (or first since the last run broke): starts a new run.
      runStartPos = pos;
    } else {
      const holeCount = pos - lastAnchorPos - 1;
      const contiguous = lastAnchorEnd + 1 === entry.start;
      if (holeCount > maxHole || !contiguous) {
        // Chain breaks here — close out the run ending at the previous anchor,
        // then start a fresh run at this position.
        const brokenLength = lastAnchorPos - runStartPos + 1;
        if (brokenLength > longest) longest = brokenLength;
        runStartPos = pos;
      }
    }
    lastAnchorPos = pos;
    lastAnchorEnd = entry.end;

    const currentLength = pos - runStartPos + 1;
    if (currentLength > longest) longest = currentLength;
  }

  return longest;
}

/**
 * The required longest-run length for a segment of `totalWords` scene-doc
 * words (syncConstants.ts's RUN_SURVIVAL_* header — threshold recalibration,
 * second pass, 2026-08-02). Three FLAT, length-independent bands (no ratio
 * scaling — the original ratio-scaled formula over-demanded on long,
 * mostly-intact segments; see the header for the production evidence):
 *   - 1-3 words: 1 (a single true match trivially qualifies a segment this
 *     short — folds the old `hasQualifyingRun` totalWords===1 special case
 *     into this same band formula instead of special-casing exactly one
 *     word count).
 *   - 4-10 words: RUN_SURVIVAL_MIN_RUN_SHORT (2).
 *   - 11+ words: RUN_SURVIVAL_MIN_RUN_LONG (4).
 */
export function requiredRunLength(totalWords: number): number {
  if (totalWords <= 3) return 1;
  if (totalWords <= 10) return RUN_SURVIVAL_MIN_RUN_SHORT;
  return RUN_SURVIVAL_MIN_RUN_LONG;
}

/**
 * Sorts `matchedSubjectIndices`, takes the median of the gaps between
 * consecutive indices, and reports whether that median sits at or under
 * RUN_SURVIVAL_DENSITY_MAX_MEDIAN_GAP — i.e. whether the matches are
 * tightly grouped rather than scattered across the transcript. Median (not
 * mean) so that one wildly distant outlier match can't single-handedly
 * launder an otherwise-scattered set into "clustered", and vice versa.
 *
 * For an EVEN number of gaps, this takes the arithmetic MEAN of the two
 * middle gaps (the standard even-count median), not the lower of the two —
 * documented here since the spec left the choice open; see this function's
 * own unit tests for a worked example.
 *
 * Degenerate inputs: 0 matched indices has no gaps to measure density from
 * at all, so it reports NOT clustered (`false`) — there is no positive
 * evidence to cluster on. Exactly 1 matched index also has no gaps, but a
 * single point cannot be "scattered" either — it reports clustered (`true`)
 * trivially. In practice `hasQualifyingRun` only ever calls this after its
 * own confidence gate has already passed, which requires `matchedCount >= 1`
 * for any totalWords a real segment can have, so the 0-index case is a
 * defensive default rather than a path production traffic hits.
 */
export function isLocallyClustered(matchedSubjectIndices: readonly number[]): boolean {
  if (matchedSubjectIndices.length === 0) return false;
  if (matchedSubjectIndices.length === 1) return true;
  const sorted = [...matchedSubjectIndices].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i]! - sorted[i - 1]!);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  return median <= RUN_SURVIVAL_DENSITY_MAX_MEDIAN_GAP;
}

/**
 * Whether a segment's match set survives the consecutive-run requirement —
 * either directly (`computeLongestRunWithHoles` clears `requiredRunLength`),
 * or via the density fallback (threshold recalibration, second pass,
 * 2026-08-02): the matches don't form one long-enough run, but are
 * collectively substantial (confidence at or above
 * RUN_SURVIVAL_DENSITY_MIN_CONFIDENCE) AND tightly grouped
 * (`isLocallyClustered`, using each matched position's occupancy `start` as
 * its transcript-index coordinate). The density check is skipped entirely
 * (short-circuited by the confidence gate) whenever confidence is too low to
 * ever pass it, so a zero-match or near-zero-match segment (the heading
 * shape) never reaches the clustering computation at all.
 *
 * Reused unchanged as the widened rescue's own firing gate
 * (`extractSegmentAlignments`) — a segment already qualifying via density
 * makes this return `true`, so the rescue block is skipped for it exactly
 * as it is for a segment that qualifies via a direct run: the rescue only
 * ever fires for a segment BOTH mechanisms reject.
 */
export function hasQualifyingRun(totalWords: number, matchedCount: number, occ: OccEntry[]): boolean {
  const longestRun = computeLongestRunWithHoles(occ, RUN_SURVIVAL_MAX_HOLE);
  if (longestRun >= requiredRunLength(totalWords)) return true;
  const confidence = matchedCount / totalWords;
  if (confidence < RUN_SURVIVAL_DENSITY_MIN_CONFIDENCE) return false;
  const matchedSubjectIndices: number[] = [];
  for (const entry of occ) if (entry !== null) matchedSubjectIndices.push(entry.start);
  return isLocallyClustered(matchedSubjectIndices);
}

/**
 * Builds the scene-doc query, aligns it to the transcript with the Hirschberg
 * semi-global aligner, and reads per-segment results off the single global
 * alignment (doc §3.1.1). Exported as the seam WS1b threads coverage through;
 * `alignScenestoTranscript` consumes these AlignResults, then runs the unchanged
 * Step-2/silence/clamp stages and narrows the return to `{ t0, t1 }` for now.
 *
 * --- Per-segment temporal-bounding rescue (Parts 1-3, token-stealing fix, WS6) ---
 * Root cause (verified via production instrumentation, since removed): pure
 * global Hirschberg alignment has no temporal awareness, so a segment whose
 * narration overflows its expected slot can consume the NEXT segment's real
 * transcript words as SUBSTITUTION candidates. A substitution never enters
 * `matchedSubjectOf` (only a true equal-word match does), so it costs the
 * overflowing segment nothing and never touches its own confidence — but it
 * can still force the DP's monotonic path such that the wronged neighbor ends
 * up with zero true matches of its own, even though its words are genuinely
 * present in the audio.
 *
 * The global alignment above is left completely unchanged — it is what every
 * pre-WS6 test locks in, including cases (repeated phrases disambiguated by
 * unique surrounding context, a shared word correctly resolved to the segment
 * that fully explains it) that a from-scratch per-segment independent aligner
 * cannot reproduce without perfect anchor data, because it has no equivalent
 * of the global DP's whole-document optimality. Per-segment bounding is
 * instead layered on top as a narrowly-scoped RESCUE:
 *   - it only ever runs for a segment the global pass gave ZERO true matches
 *     (`matchedCount === 0`, the exact symptom of the bug);
 *   - only when the segment has a real timing anchor (`anchorStart`) — with no
 *     anchor there is no trustworthy window to bound against, so the segment's
 *     global (unchanged) classification stands;
 *   - and it is only ever allowed to claim a transcript word no OTHER segment
 *     already truly matched in the global pass (`globallyClaimed` below) — it
 *     can add a match a segment is missing, never take one another segment
 *     legitimately has. This is what makes the rescue safe to layer on: it can
 *     only improve a zero-confidence outcome, never regress a working one.
 * Full write-up: docs/sync-system-rewrite-architecture.md, "Per-Segment
 * Temporal Bounding".
 *
 * The exact-text fallback (Part 3) is itself two passes: Pass 1 scans only
 * `windowed` (tokens inside the anchor-bounded window) — fast, and correct
 * whenever `anchorStart` is accurate. Pass 2 fires only when Pass 1 found
 * nothing (empty window, or a window that simply missed the real words) and
 * scans EVERY unclaimed transcript token, in document order, with no time
 * bound at all — needed because a drifted `anchorStart` can place a
 * segment's real audio position well outside its own rescue window (verified
 * live: a segment's anchor was 7.6s off, landing its real words past the far
 * edge of the window built around that anchor). Pass 2 is still
 * exact-text-only and still restricted to `globallyClaimed`-free tokens, so
 * it carries the same "can only add, never steal" guarantee as Pass 1 — it
 * just isn't temporally bounded.
 */
export function extractSegmentAlignments(
  segments: VideoSegment[],
  tokens: TranscriptToken[],
  audioDuration?: number,
): AlignResult[] {
  if (!tokens.length || !segments.length) {
    return segments.map(() => ({
      t0: 0, t1: 0, firstTokenIdx: -1, lastTokenIdx: -1,
      confidence: 0, matched: false, matchedWords: 0, totalWords: 0, longestRun: 0,
    }));
  }

  // Expand each token into all its words — Whisper tokens may contain multiple
  // words (e.g. " hello world") and every word must be individually matchable.
  // `startSec` is the OWNING TOKEN's start (a token's internal words have no
  // individually finer timestamp) — good enough for the rescue window check,
  // which only needs to place a word within a multi-second slot, not sub-token
  // precision.
  const tokenWords: Array<{ word: string; tokenIdx: number; startSec: number }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const words = normalize(tokens[i]!.text);
    for (const word of words) {
      if (word.length > 0) tokenWords.push({ word, tokenIdx: i, startSec: tokens[i]!.startSec });
    }
  }

  // Build the query (all segments' canonicalized words, in order) with each
  // segment's contiguous word range recorded for per-segment extraction (§3.1.1).
  // Zero-word segments (empty/whitespace text, or text that normalizes away) get
  // an empty range — classification-neutral; they never crash the aligner.
  const queryWords: string[] = [];
  const segRanges: Array<{ start: number; end: number }> = [];
  for (const seg of segments) {
    const start = queryWords.length;
    // WS4 Feature 1 — the scene-doc side is stripped of stage directions before
    // tokenizing (normalizeSceneDoc). `seg.text` itself is untouched: only this
    // ALIGNMENT VIEW of it changes, so the editor still shows what the author wrote.
    const words = seg?.text && seg.text.trim() ? normalizeSceneDoc(seg.text) : [];
    for (const w of words) if (w.length > 0) queryWords.push(w);
    segRanges.push({ start, end: queryWords.length });
  }

  const subjectWords = tokenWords.map(t => t.word);
  const matchedSubjectOf = alignQueryToSubject(queryWords, subjectWords).matchedSubjectOf;

  // Every transcript-word index any segment TRULY matched, system-wide — the
  // rescue below must never touch these (see the function-level doc comment).
  const globallyClaimed = new Set<number>();
  for (let qi = 0; qi < matchedSubjectOf.length; qi++) {
    const sj = matchedSubjectOf[qi]!;
    if (sj >= 0) globallyClaimed.add(sj);
  }

  // --- Rescue forward-ordering bound (false-positive rescue fix) -----------
  // Root cause of the production incident this closes: a segment whose text
  // never occurs in the audio (e.g. a heading) still passes the rescue's gate
  // (matchedCount===0 && anchorStart defined — true of every parsed segment,
  // since applyAnchorBasedTiming forces the first segment's anchor to 0).
  // Passes 2/3 below scan every unclaimed token with NO relation to the
  // segment's own position, so they can claim a later segment's genuine words
  // (left unclaimed because that segment's own true match consumed a
  // different, textually-equal occurrence, or because the word only ever
  // appears as a substitution/gap). That flips `matched` to true, defeats the
  // skip-unmatched classification, and the far-away token indices then flow
  // into distributeSegmentTimes/snapCoveredBoundaries as a real boundary —
  // confirmed in production as a ~206s phantom first segment that collapsed
  // its real successor. See docs/history.md for the full incident writeup.
  //
  // The fix: a rescue claim's EARLIEST token must sit strictly before the
  // first token any LATER segment truly matched in the (unchanged) global
  // pass — skipping over intervening segments with no true match of their
  // own, since those contribute no ordering information. This is exactly the
  // axis that separates the legitimate rescue uses (an anchor drifted, but
  // the claim still precedes the next segment's real speech — the "verified
  // live at 7.6s off" case and the 44s-drift WS6 test 10) from the false
  // positive (a claim landing AFTER a later segment's real speech, meaning it
  // almost certainly belongs to that later segment, not this one). Order, not
  // distance, is the correct signal — a distance/tolerance cap was considered
  // and rejected: WS6 test 10 legitimately recovers a word 44s from a 3s
  // slot, so no fixed or slot-scaled distance threshold could exclude the
  // false positive (which can be arbitrarily far) without also excluding that
  // legitimate case.
  //
  // Uses GLOBAL-pass true matches only (`firstGlobalMatchSubjectOf`, computed
  // once here, before any rescue runs) — not other segments' own rescue
  // outcomes. Rescues are resolved in segment order within the loop below, so
  // consulting a later segment's (not-yet-computed) rescue result would be
  // order-dependent and non-deterministic; the unchanged global pass is fixed
  // before any rescue runs and gives every segment's bound the same answer
  // regardless of processing order.
  const firstGlobalMatchSubjectOf: number[] = segRanges.map(range => {
    for (let qi = range.start; qi < range.end; qi++) {
      const sj = matchedSubjectOf[qi]!;
      if (sj >= 0) return sj;
    }
    return -1;
  });

  /** The startSec a rescue claim for segment `si` must stay strictly before —
   *  the first token the nearest LATER segment with a true global match
   *  actually matched. `undefined` when no later segment has one (nothing to
   *  be inconsistent with — e.g. the last segment in the project). */
  function computeForwardBoundStartSec(si: number): number | undefined {
    for (let sj = si + 1; sj < segRanges.length; sj++) {
      const subjectIdx = firstGlobalMatchSubjectOf[sj]!;
      if (subjectIdx >= 0) return tokenWords[subjectIdx]!.startSec;
    }
    return undefined;
  }

  /** Earliest (smallest) startSec among a set of claimed `tokenWords`
   *  indices — "the claimed matches' first token", read as first in TIME, not
   *  first in list order (Pass 1's Hirschberg output and Pass 2/3's document-
   *  order scans don't guarantee those coincide). */
  function earliestClaimStartSec(globalIdxs: readonly number[]): number {
    let min = Infinity;
    for (const idx of globalIdxs) {
      const s = tokenWords[idx]!.startSec;
      if (s < min) min = s;
    }
    return min;
  }

  // Row 8a (Contract 1→2, assumption 8): the caller's probed `audioDuration`
  // is the true audio length; the last token's endSec only approximates it
  // and misses trailing silence after the last spoken word. Fall back to the
  // token-derived approximation only when the caller has no probed value to
  // give (every existing direct caller of this function, incl. the
  // regression-locked syncTiming.test.ts suite) — this keeps the parameter
  // additive rather than forcing every one of those call sites to invent a
  // duration for a synthetic fixture that never had a real probe.
  const rescueWindowAudioEnd = audioDuration ?? (tokens[tokens.length - 1]?.endSec ?? 0);

  // Per-segment extraction from the single global alignment (doc §3.1.1, R11):
  //   t0 = startSec of the FIRST matched transcript word in the segment's range
  //   t1 = endSec of the LAST matched transcript word in the range
  //   confidence = matched words / total scene-doc words; matched = confidence > 0
  const results: AlignResult[] = [];
  for (let si = 0; si < segments.length; si++) {
    const range = segRanges[si]!;
    const totalWords = range.end - range.start;
    const prevAnchor = results[si - 1]?.t1 ?? 0;

    // Zero-token segment: classification-neutral (neither covered nor uncovered);
    // anchors at the previous boundary, exactly as the old empty-text path did.
    if (totalWords === 0) {
      results.push({
        t0: prevAnchor, t1: prevAnchor, firstTokenIdx: -1, lastTokenIdx: -1,
        confidence: 0, matched: false, matchedWords: 0, totalWords: 0, longestRun: 0,
      });
      continue;
    }

    let matchedCount = 0;
    let firstSub = -1;
    let lastSub = -1;
    // Rescue observability (false-positive rescue fix, 2026-07-31) — hoisted
    // above the rescue block so it survives to the final `results.push`
    // below; stays null for a segment matched directly by the global pass
    // (no rescue needed) and for a rejected rescue claim (see AlignResult's
    // doc comment).
    let recoveredVia: 'windowed' | 'global' | 'concat' | null = null;
    for (let qi = range.start; qi < range.end; qi++) {
      const sj = matchedSubjectOf[qi]!;
      if (sj >= 0) {
        matchedCount++;
        if (firstSub < 0) firstSub = sj;
        lastSub = sj;
      }
    }
    // Bug C (consecutive-run survival requirement) — the global pass's
    // occupancy array, built alongside matchedCount/firstSub/lastSub above.
    // `let`, not `const`: a successfully ADOPTED rescue below replaces it
    // wholesale with the rescue's own occupancy (see `shouldAdopt`).
    let occ: OccEntry[] = buildOccArrayFromGlobalMatches(matchedSubjectOf, range.start, totalWords);

    // --- Token-stealing rescue (Parts 1-3, WS6) --------------------------
    const seg = segments[si]!;
    // Bug C rescue-gate widening: the rescue used to fire only on a LITERAL
    // zero-match (`matchedCount === 0`). It now ALSO fires whenever the
    // global pass's own matches, however many, fail to form a qualifying
    // run — e.g. several scattered single-word coincidences with no two
    // adjacent. `wasZeroMatch` (captured BEFORE the rescue runs) is what
    // decides the adopt-or-discard rule below: a literal zero-match rescue
    // is adopted unconditionally (today's behavior, unchanged — it can only
    // improve from zero); a widened-gate rescue (real matches already
    // existed) is adopted ONLY if it actually produces a qualifying run,
    // else the attempt is discarded and the original global-pass match set
    // stands (see `shouldAdopt` below).
    //
    // Density-fallback interaction (threshold recalibration, second pass,
    // 2026-08-02): `hasQualifyingRun` below is the SAME function used for
    // `matched` at the end of this loop, so it now returns `true` for a
    // segment whose global-pass matches qualify via the density fallback
    // (substantial + clustered) even without one long-enough run. That means
    // a density-qualifying segment makes this gate's `!hasQualifyingRun(...)`
    // false, and the rescue block below is skipped entirely for it — exactly
    // as for a segment that already qualifies via a direct run. The rescue
    // only ever fires for a segment BOTH mechanisms reject; nothing here had
    // to change to get that, since the gate and `matched` share one function.
    const wasZeroMatch = matchedCount === 0;
    if (!hasQualifyingRun(totalWords, matchedCount, occ) && seg.anchorStart !== undefined) {
      // Forward-ordering bound (false-positive rescue fix) — see the
      // module-level comment by `computeForwardBoundStartSec` above.
      // `undefined` when no later segment has a true global match of its own.
      const forwardBoundStartSec = computeForwardBoundStartSec(si);
      const exceedsForwardBound = (globalIdxs: readonly number[]): boolean =>
        forwardBoundStartSec !== undefined && earliestClaimStartSec(globalIdxs) >= forwardBoundStartSec;
      const expectedStart = seg.anchorStart;
      const expectedEnd = segments[si + 1]?.anchorStart ?? rescueWindowAudioEnd;
      const rawDuration = Math.max(0, expectedEnd - expectedStart);
      const tolerance = clamp(TEMPORAL_TOLERANCE_RATIO * rawDuration, TEMPORAL_TOLERANCE_MIN_SEC, TEMPORAL_TOLERANCE_MAX_SEC);
      const windowStart = expectedStart - tolerance;
      const windowEnd = expectedEnd + tolerance;

      // Monotonic exclusivity (C3's intent, satisfied more precisely than a
      // time-based floor): the rescue must never re-consume a token another
      // segment's GLOBAL pass genuinely matched — `globallyClaimed`, checked
      // below — rather than a floor derived from the previous segment's own
      // committed t1. A literal `prevAnchor + gap` floor was tried and
      // rejected: in exactly the overflow scenario this rescue targets, the
      // previous (overflowing) segment's own true trailing match can itself
      // land AFTER the stolen tokens (that IS the bug), so a t1-based floor
      // re-excludes the very words rescue exists to recover. `globallyClaimed`
      // gives the same "don't double-claim" guarantee at the exact token
      // level instead of a coarser time cutoff, without that failure mode.
      const windowed: Array<{ word: string; globalIdx: number; startSec: number }> = [];
      for (let gi = 0; gi < tokenWords.length; gi++) {
        if (globallyClaimed.has(gi)) continue; // never take another segment's real match
        const tw = tokenWords[gi]!;
        if (tw.startSec >= windowStart && tw.startSec < windowEnd) {
          windowed.push({ word: tw.word, globalIdx: gi, startSec: tw.startSec });
        }
      }

      const segQueryWords = queryWords.slice(range.start, range.end);
      let localMatches: Array<{ queryIdx: number; globalIdx: number }> = [];
      // Which pass recovered `localMatches`/`concatMatches` below — kept
      // separate from the outer `recoveredVia` (AlignResult's field) so a
      // discarded rescue attempt (Bug C's widened-gate "no improvement" case)
      // never leaks provenance for a claim that was never adopted.
      let candidateRecoveredVia: 'windowed' | 'global' | 'concat' | null = null;

      // Pass 1 — bounded to the segment's expected time window (fast, and
      // correct whenever anchorStart is accurate): Hirschberg with a
      // temporal-proximity bonus, then a plain exact-text scan of the same
      // window if that finds nothing.
      if (windowed.length > 0) {
        const expectedCenter = (expectedStart + expectedEnd) / 2;
        const halfWindow = (windowEnd - windowStart) / 2;
        const subjectBonus = new Float64Array(windowed.length);
        for (let j = 0; j < windowed.length; j++) {
          subjectBonus[j] = temporalBonus(windowed[j]!.startSec, expectedCenter, halfWindow);
        }

        const localAlign = alignQueryToSubject(segQueryWords, windowed.map(w => w.word), subjectBonus);
        for (let lq = 0; lq < segQueryWords.length; lq++) {
          const lj = localAlign.matchedSubjectOf[lq]!;
          if (lj >= 0) localMatches.push({ queryIdx: lq, globalIdx: windowed[lj]!.globalIdx });
        }

        // Part 3 — bounded Hirschberg still found nothing (e.g. the window's
        // free words don't line up well enough to win any DP cell); fall back
        // to a plain exact-text scan of the same (already-filtered) window.
        if (localMatches.length === 0) {
          localMatches = findExactSequentialMatches(segQueryWords, windowed);
        }

        // Forward-ordering bound: Pass 1's window is anchored on THIS
        // segment's own (possibly stale) anchorStart/expectedEnd, not on any
        // later segment's real position, so it is not immune to the same
        // inversion Pass 2/3 exist to guard against — a wide tolerance window
        // (capped at 5s, but built from an already-drifted expectedEnd) can
        // still reach past a later segment's true match. Reject exactly like
        // Pass 2/3 rather than leaving Pass 1 unchecked.
        if (localMatches.length > 0 && exceedsForwardBound(localMatches.map(m => m.globalIdx))) {
          localMatches = [];
        }

        if (localMatches.length > 0) candidateRecoveredVia = 'windowed';
      }

      // Pass 2 (NEW) — the windowed pass found nothing, either because the
      // window itself was empty or because anchorStart has drifted far
      // enough that the segment's real words fall outside it entirely
      // (verified live: a segment's anchorStart was 7.6s off its actual
      // audio position, landing its real words well outside the rescue
      // window). Search EVERY unclaimed transcript token, in document order,
      // exact-text only — no temporal bound, no fuzzy matching — so it can
      // still only ever recover words genuinely present and not already
      // claimed by another segment's true match.
      if (localMatches.length === 0) {
        const allUnclaimed: Array<{ word: string; globalIdx: number }> = [];
        for (let gi = 0; gi < tokenWords.length; gi++) {
          if (globallyClaimed.has(gi)) continue; // never take another segment's real match
          allUnclaimed.push({ word: tokenWords[gi]!.word, globalIdx: gi });
        }
        const pass2Matches = findExactSequentialMatches(segQueryWords, allUnclaimed);
        // Forward-ordering bound (false-positive rescue fix): reject a claim
        // whose earliest token sits at/after the next true-matching segment's
        // own first word — see computeForwardBoundStartSec's doc comment
        // above. Pass 2 is the unbounded scan, so this is where the false
        // positive this fix targets is actually caught.
        if (pass2Matches.length > 0 && !exceedsForwardBound(pass2Matches.map(m => m.globalIdx))) {
          localMatches = pass2Matches;
          candidateRecoveredVia = 'global';
        }
      }

      // Pass 3 (NEW) — Pass 2's single-token exact match still found nothing.
      // Whisper sometimes splits one word across multiple touching-timestamp
      // sub-word tokens ("linen" -> "lin"+"en", "flax" -> "fl"+"ax"); no
      // individual unclaimed token equals the full word, so Pass 3 tries
      // concatenating up to MAX_CONCAT_TOKENS consecutive unclaimed tokens
      // (touching within MAX_CONCAT_GAP_SEC) to form each query word exactly.
      // Same document-order, unclaimed-only, exact-text scan as Pass 2 — just
      // with multi-token candidates — so it carries the same "can only add,
      // never steal" guarantee.
      let concatMatches: Array<{ queryIdx: number; tokenStartIdx: number; tokenEndIdx: number }> = [];
      if (localMatches.length === 0) {
        const allUnclaimed: Array<{ word: string; globalIdx: number }> = [];
        for (let gi = 0; gi < tokenWords.length; gi++) {
          if (globallyClaimed.has(gi)) continue; // never take another segment's real match
          allUnclaimed.push({ word: tokenWords[gi]!.word, globalIdx: gi });
        }
        const pass3Matches = findConcatenatingMatches(
          segQueryWords, allUnclaimed, tokenWords, tokens,
          { maxConcatTokens: MAX_CONCAT_TOKENS, maxConcatGapSec: MAX_CONCAT_GAP_SEC },
        );
        // Forward-ordering bound, same rule as Pass 2 — a concatenated span's
        // start index is itself a tokenWords globalIdx, so the same helper
        // applies unchanged.
        if (pass3Matches.length > 0 && !exceedsForwardBound(pass3Matches.map(m => m.tokenStartIdx))) {
          concatMatches = pass3Matches;
          candidateRecoveredVia = 'concat';
        }
      }

      // Adopt-or-discard (Bug C refinement, audit Q2b): build the candidate
      // occupancy/counts from whichever pass found something, then decide
      // whether to commit them. A literal zero-match rescue (`wasZeroMatch`)
      // adopts unconditionally — it can only improve on zero, exactly as
      // before this fix. A widened-gate rescue (the global pass already had
      // some real matches, just not a qualifying run) adopts ONLY if the
      // candidate itself produces a qualifying run — otherwise the rescue
      // attempt is discarded entirely and the original global-pass
      // occ/matchedCount/firstSub/lastSub (already sitting in those `let`s,
      // untouched below) stand as the final result. Forward-bound rejection
      // composes unchanged here: a rejected claim already left
      // localMatches/concatMatches empty, so this block never runs for it.
      if (localMatches.length > 0 || concatMatches.length > 0) {
        const candidateOcc: OccEntry[] = new Array(totalWords).fill(null);
        let candidateMatchedCount: number;
        let candidateFirstSub: number;
        let candidateLastSub: number;
        if (localMatches.length > 0) {
          localMatches.sort((a, b) => a.globalIdx - b.globalIdx);
          candidateMatchedCount = localMatches.length;
          candidateFirstSub = localMatches[0]!.globalIdx;
          candidateLastSub = localMatches[localMatches.length - 1]!.globalIdx;
          for (const m of localMatches) candidateOcc[m.queryIdx] = { start: m.globalIdx, end: m.globalIdx };
        } else {
          candidateMatchedCount = concatMatches.length;
          candidateFirstSub = concatMatches[0]!.tokenStartIdx;
          candidateLastSub = concatMatches[concatMatches.length - 1]!.tokenEndIdx;
          for (const m of concatMatches) candidateOcc[m.queryIdx] = { start: m.tokenStartIdx, end: m.tokenEndIdx };
        }

        const shouldAdopt = wasZeroMatch || hasQualifyingRun(totalWords, candidateMatchedCount, candidateOcc);
        if (shouldAdopt) {
          matchedCount = candidateMatchedCount;
          firstSub = candidateFirstSub;
          lastSub = candidateLastSub;
          occ = candidateOcc;
          recoveredVia = candidateRecoveredVia;
        }
      }
    }

    const confidence = matchedCount / totalWords;
    const longestRun = computeLongestRunWithHoles(occ, RUN_SURVIVAL_MAX_HOLE);
    // `matched` is `hasQualifyingRun`'s full decision — a direct qualifying
    // run OR the density fallback (threshold recalibration, second pass,
    // 2026-08-02; see syncConstants.ts's RUN_SURVIVAL_* header). No
    // totalWords===1 special case here anymore: `requiredRunLength` folds
    // that into its own 1-3-word band (required run of 1), so a single true
    // match on a 1-3-word segment already clears the plain run check.
    const matched = hasQualifyingRun(totalWords, matchedCount, occ);

    // Uncovered segment (no qualifying matched run): no audio region. WS1a does
    // not gate on this yet (WS1b wires the abort gate) — anchor at the previous
    // boundary as a placeholder so the unchanged downstream stages see no hole.
    // Bug C: matchedWords/confidence are the REAL counts, never zeroed here —
    // computeCoverageSummary's coverage numerators read matchedWords regardless
    // of `matched` (audit Q8), so zeroing it here would silently under-report
    // coverage for a segment that had real (if insufficiently contiguous) matches.
    if (!matched) {
      results.push({
        t0: prevAnchor, t1: prevAnchor, firstTokenIdx: -1, lastTokenIdx: -1,
        confidence, matched, matchedWords: matchedCount, totalWords, longestRun,
      });
      continue;
    }

    const firstTokenIdx = tokenWords[firstSub]!.tokenIdx;
    const lastTokenIdx = tokenWords[lastSub]!.tokenIdx;
    const t0 = tokens[firstTokenIdx]?.startSec ?? prevAnchor;
    const rawT1 = tokens[lastTokenIdx]?.endSec ?? t0 + 0.1;
    const t1 = Math.max(t0 + 0.05, rawT1);

    // Rescue observability (false-positive rescue fix, 2026-07-31) — logged
    // (DEV-gated, permanent, same convention as the rest of this file) only
    // for a segment the rescue actually recovered, now that t0/rawT1 are
    // available: the recovered time range and its distance from the
    // segment's own anchor estimate, so a legitimate small drift (a few
    // seconds) reads differently from a large one at a glance.
    if (recoveredVia !== null && import.meta.env.DEV) {
      const label = recoveredVia === 'global' ? 'GLOBAL fallback (outside window)'
        : recoveredVia === 'concat' ? 'CONCAT fallback (sub-word merge)'
        : 'fallback';
      const distance = t0 - (seg.anchorStart ?? t0);
      console.log(
        `[align-recover] seg=${si} recovered ${matchedCount}/${totalWords} via ${label} ` +
        `range=[${t0.toFixed(2)},${rawT1.toFixed(2)}] anchor=${(seg.anchorStart ?? 0).toFixed(2)} distance=${distance.toFixed(2)}s`,
      );
    }

    results.push({
      t0, t1, firstTokenIdx, lastTokenIdx, confidence, matched,
      matchedWords: matchedCount, totalWords, longestRun,
      audioRegion: { startSec: t0, endSec: rawT1 },
      ...(recoveredVia !== null
        ? { recoveredVia, recoveredRegion: { startSec: t0, endSec: rawT1 } }
        : {}),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Malformed-token filter (WS4 Feature 4, decision 14a)
// ---------------------------------------------------------------------------
//
// whisper.cpp occasionally emits a token whose timestamps are unusable — a
// negative start, an end past the end of the audio, a zero/inverted span, or a
// NaN from an unparseable timestamp string (whisper.rs's parse_timestamp
// returns 0.0 on a malformed field, but the JS-side parse and the IPC boundary
// can both still produce non-finite values). Every one of those propagates
// straight into a boundary: `t0`/`t1` come from `tokens[idx].startSec/endSec`,
// and the silence-snap search window is built from them. One bad token can
// therefore place a segment boundary at a nonsense time, or NaN a whole run.
//
// Filtering happens ONCE, BEFORE alignment, and the filtered array is what every
// downstream stage uses — the aligner, the snap, and App.tsx's own
// `snapCoveredBoundaries` call. That is load-bearing: `AlignResult`'s
// `firstTokenIdx`/`lastTokenIdx` are indices INTO this array, so handing a
// different (unfiltered) array to a later stage would silently read the wrong
// token. useWhisper's `alignFromCache` returns the filtered array for exactly
// this reason.

/** One dropped token, captured at the point `filterMalformedTokens` rejected
 *  it — the drop-distribution evidence Contract 1→2's `analyzeDropDistribution`
 *  validator (R1) buckets by time. `startSec`/`endSec`/`text` are the RAW
 *  pre-filter values, including whatever garbage (NaN, Infinity, negative)
 *  triggered the drop — a validator bucketing by time needs the real number,
 *  not a sanitized stand-in. */
export interface TokenDrop {
  /** Position in the RAW pre-filter `tokens` array. */
  index: number;
  reason: 'non-finite' | 'negative-start' | 'inverted-or-zero-duration' | 'past-audio-end' | 'empty-text';
  startSec: number;
  endSec: number;
  text: string;
}

/** What `filterMalformedTokens` produced — the surviving tokens plus the counts
 *  the sync log reports. `tokens` is the array every later stage must use. */
export interface MalformedTokenFilterResult {
  tokens: TranscriptToken[];
  /** How many tokens were dropped. 0 ⇒ nothing was wrong, no log entry. */
  skippedCount: number;
  /** Pre-filter token count — the denominator the log entry shows. */
  totalTokens: number;
  /** One record per dropped token, in RAW pre-filter order. */
  drops: TokenDrop[];
}

/**
 * Drops tokens whose timestamps or text make them unusable for alignment. Any
 * ONE of these disqualifies a token (doc decision 14a):
 *
 *   - `startSec` or `endSec` is NaN or Infinite               → 'non-finite'
 *   - `startSec < 0`                                          → 'negative-start'
 *   - `startSec >= endSec` (zero or negative duration)        → 'inverted-or-zero-duration'
 *   - `endSec > audioDuration + MALFORMED_TOKEN_DURATION_TOLERANCE_SEC`
 *                                                              → 'past-audio-end'
 *   - the text is empty / whitespace-only once normalized     → 'empty-text'
 *
 * The end-of-audio check is skipped entirely when `audioDuration` is not a
 * usable positive finite number — an unknown duration must not cause every
 * token to be discarded.
 *
 * Pure: returns a new array, never mutates the input. Single-pass (not
 * `.filter()`) so each rejection can be captured as a `TokenDrop` at the
 * point it's decided, in the same order tested above.
 */
export function filterMalformedTokens(
  tokens: TranscriptToken[],
  audioDuration: number,
): MalformedTokenFilterResult {
  const checkAgainstEnd = Number.isFinite(audioDuration) && audioDuration > 0;
  const maxEnd = audioDuration + MALFORMED_TOKEN_DURATION_TOLERANCE_SEC;

  const kept: TranscriptToken[] = [];
  const drops: TokenDrop[] = [];

  for (let index = 0; index < tokens.length; index++) {
    const t = tokens[index]!;
    const t0 = t?.startSec;
    const t1 = t?.endSec;
    const text = t?.text ?? '';
    const drop = (reason: TokenDrop['reason']): void => {
      drops.push({ index, reason, startSec: t0 ?? NaN, endSec: t1 ?? NaN, text });
    };

    if (!Number.isFinite(t0) || !Number.isFinite(t1)) {
      drop('non-finite');
      continue;
    }
    if (t0 < 0) {
      drop('negative-start');
      continue;
    }
    if (t0 >= t1) {
      drop('inverted-or-zero-duration');
      continue;
    }
    if (checkAgainstEnd && t1 > maxEnd) {
      drop('past-audio-end');
      continue;
    }
    // Text that normalizes to nothing (punctuation-only, whitespace-only) can
    // never match a scene-doc word, but its timestamps can still be picked as a
    // segment edge. Drop it here rather than letting it anchor a boundary.
    if (normalize(text).length === 0) {
      drop('empty-text');
      continue;
    }

    kept.push(t);
  }

  return {
    tokens: kept,
    skippedCount: tokens.length - kept.length,
    totalTokens: tokens.length,
    drops,
  };
}

export function alignScenestoTranscript(
  segments: VideoSegment[],
  tokens: TranscriptToken[],
  silences: SilenceInterval[] = [],
  audioDuration?: number,
): SegmentAlignment[] {
  const _instrOn = alignInstrEnabled();
  const _passT0 = _instrOn ? performance.now() : 0;

  if (!tokens.length || !segments.length) {
    return segments.map(() => ({
      t0: 0, t1: 0, firstTokenIdx: -1, lastTokenIdx: -1,
      confidence: 0, matched: false, matchedWords: 0, totalWords: 0, longestRun: 0,
    }));
  }

  // Hirschberg semi-global alignment + per-segment extraction (doc §3.1/§3.1.1).
  const results = extractSegmentAlignments(segments, tokens, audioDuration);

  // Step 2 — override t1 from neighbor anchors.
  // Each unlocked segment's right boundary is set to the next segment's t0 anchor
  // before the gap-fill runs. This breaks the bestEnd → lastTokenIdx → t1 chain so
  // that editing scene description text cannot shift a segment's duration via word count.
  // Locked segments are skipped: their t1 is immovable.
  const audioEnd = tokens[tokens.length - 1]?.endSec ?? 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (segments[i]?.locked) continue;
    results[i]!.t1 = results[i + 1]!.t0;
  }

  // Clamp last segment to actual audio end (skip if locked).
  if (results.length > 0 && !segments[results.length - 1]?.locked) {
    results[results.length - 1]!.t1 = audioEnd;
  }

  if (_instrOn) {
    const totalMs = performance.now() - _passT0;
    const store = alignInstr();
    store.passes += 1;
    store.totalMs.push(totalMs);
    // eslint-disable-next-line no-console
    console.log(
      '[align-instr] pass %d: Hirschberg total %sms over %d segments; tokens=%d',
      store.passes, totalMs.toFixed(1), segments.length, tokens.length,
    );
  }

  // WS1b: return the full per-segment result (not narrowed to {t0,t1}) — the
  // orchestrator (App.tsx) needs matched/confidence/matchedWords/totalWords
  // for the coverage metric (§3.3) and the abort gate (§3.4/R13, §3.5/R12).
  return results;
}

// ---------------------------------------------------------------------------
// Bidirectional coverage metric (architecture doc §3.3, R13) — WS1b
// ---------------------------------------------------------------------------

/**
 * Per-segment covered/neutral classification (doc §3.1.1 points 3-4). A
 * segment is "covered" when it has at least one matched word AND its match
 * fraction clears LOW_CONFIDENCE_RATIO. A zero-token segment is "neutral" —
 * excluded from the covered-run scan (§3.4 Signal 1) and the middle-gap scan
 * (§3.5/R12): it can neither break nor extend a run, and does not dilute the
 * coverage denominators (§3.3).
 */
export interface SegmentCoverageFlags {
  covered: boolean;
  neutral: boolean;
}

export function classifyCoverage(alignments: SegmentAlignment[]): SegmentCoverageFlags[] {
  return alignments.map(a => {
    const neutral = a.totalWords === 0;
    return {
      neutral,
      covered: !neutral && a.matched && a.confidence >= LOW_CONFIDENCE_RATIO,
    };
  });
}

/**
 * Total transcript word count, using the SAME tokenization
 * `extractSegmentAlignments` uses internally for the subject sequence
 * (normalize() per token, empty words filtered) — exposed so the orchestrator
 * can compute transcript coverage without re-deriving the aligner's subject
 * sequence itself.
 */
export function countTranscriptWords(tokens: TranscriptToken[]): number {
  let count = 0;
  for (const t of tokens) {
    for (const w of normalize(t.text)) if (w.length > 0) count++;
  }
  return count;
}

export interface CoverageSummary {
  /** Fraction of scene-doc words matched in the transcript — "does the audio
   *  say what the doc says?" (doc §3.3(b)). */
  sceneDocCoverage: number;
  /** Fraction of transcript words consumed by a match — "is the audio saying
   *  anything else?" (doc §3.3(b)). */
  transcriptCoverage: number;
  /** min(sceneDocCoverage, transcriptCoverage) — Signal 2 (noise floor)
   *  input (R13). */
  bidirectionalCoverage: number;
  /** Longest maximal run of consecutive covered segments — zero-token
   *  segments are skipped (transparent) rather than breaking the run. Signal 1
   *  (contiguous covered-run) input (R13). */
  longestCoveredRun: number;
}

export function computeCoverageSummary(
  alignments: SegmentAlignment[],
  totalTranscriptWords: number,
): CoverageSummary {
  let matchedWords = 0;
  let totalSceneDocWords = 0;
  let longestCoveredRun = 0;
  let currentRun = 0;
  for (const a of alignments) {
    if (a.totalWords === 0) continue; // zero-token: neutral (§3.1.1 point 4)
    matchedWords += a.matchedWords;
    totalSceneDocWords += a.totalWords;
    const covered = a.matched && a.confidence >= LOW_CONFIDENCE_RATIO;
    if (covered) {
      currentRun += 1;
      if (currentRun > longestCoveredRun) longestCoveredRun = currentRun;
    } else {
      currentRun = 0;
    }
  }
  const sceneDocCoverage = totalSceneDocWords > 0 ? matchedWords / totalSceneDocWords : 0;
  const transcriptCoverage = totalTranscriptWords > 0 ? matchedWords / totalTranscriptWords : 0;
  return {
    sceneDocCoverage,
    transcriptCoverage,
    bidirectionalCoverage: Math.min(sceneDocCoverage, transcriptCoverage),
    longestCoveredRun,
  };
}

/**
 * Applies time windows from `alignments` to `segments`, respecting
 * `segment.locked === true` (locked segments are left unchanged).
 */
export function distributeSegmentTimes(
  segments: VideoSegment[],
  alignments: Array<{ t0: number; t1: number }>,
): VideoSegment[] {
  const updated = segments.map((seg, i) => {
    if (seg.locked) return seg;
    const a = alignments[i];
    if (!a) return seg;
    const duration = Math.max(0.1, a.t1 - a.t0);
    return {
      ...seg,
      startTime: Number(a.t0.toFixed(3)),
      duration: Number(duration.toFixed(3)),
      anchorStart: Number(a.t0.toFixed(3)), // Whisper-derived anchor overwrites char-weight estimate
      anchorSource: 'whisper' as const,
    };
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Transcribes `audioAsset` using the bundled whisper-cli sidecar, streaming
 * progress via `onProgress` until the result (or an error) is returned.
 * Honouring `signal` aborts the job mid-flight.
 */
export async function transcribeWithProgress(
  audioAsset: Asset,
  durationSecs: number,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<TranscriptToken[]> {
  let buffer: ArrayBuffer;
  if (audioAsset.file) {
    // Prefer the raw File object — avoids blob URL fetch restrictions in WebView2 (Windows)
    buffer = await audioAsset.file.arrayBuffer();
  } else {
    // Fallback: fetch blob URL (works on macOS WebView, may fail on Windows)
    const response = await fetch(audioAsset.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.statusText}`);
    }
    buffer = await response.arrayBuffer();
  }
  const audiob64 = arrayBufferToBase64(buffer);

  return new Promise<TranscriptToken[]>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const channel = new Channel<WhisperEvent>();

    channel.onmessage = (msg) => {
      if (msg.event === 'Progress') {
        onProgress(msg.data.percent);
      } else if (msg.event === 'Done') {
        resolve(msg.data.tokens);
      } else if (msg.event === 'Error') {
        reject(new Error(msg.data.message));
      }
    };

    const onAbort = () => {
      invoke('whisper_cancel').catch(() => {});
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    invoke('whisper_transcribe', {
      audioB64: audiob64,
      durationSecs,
      onEvent: channel,
    }).catch((err: unknown) => {
      signal.removeEventListener('abort', onAbort);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
