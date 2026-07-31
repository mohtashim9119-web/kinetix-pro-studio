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
} from './syncConstants';
// Gap-fill candidacy predicates (2026-08-02 port) — snapBoundaries.ts remains
// their canonical home (see that file's header for the full derivation of
// each). Type-only the other direction (snapBoundaries.ts imports
// `SegmentAlignment` from this file as `import type`), so this is not a
// runtime circular dependency.
import { fillsTokenGapWithinSpan, isBreathSilence, isBoundarySilenceCandidate } from './snapBoundaries';

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

function parseTimestamp(ts: string): number {
  const normalized = ts.trim().replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length !== 3) return 0;
  const h = parseFloat(parts[0] ?? '0');
  const m = parseFloat(parts[1] ?? '0');
  const s = parseFloat(parts[2] ?? '0');
  return h * 3600 + m * 60 + s;
}

// ---------------------------------------------------------------------------
// Alignment tokenizer (architecture doc §3.2, R1)
// ---------------------------------------------------------------------------
// The number/contraction/symbol canonicalization that used to live inline here
// (the D16 helpers: cardinal/year readings, the CONTRACTIONS map, the terminal
// non-alnum strip) moved WHOLESALE into the shared ./textNormalize `canonicalize`
// pipeline as part of the two-normalizer unification (G4). This keeps only the
// public name `canonicalizeForAlignment` as a thin wrapper so existing callers
// (normalize/textMateriallyChanged, the aligner, the tests) are unaffected.

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
 * Word-level normalizer used by the aligner (and textMateriallyChanged).
 * Delegates to canonicalizeForAlignment so numbers/contractions/symbols
 * canonicalize identically on the script and Whisper-token sides (D16).
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

/**
 * True if two strings differ once normalized to the same word-level
 * representation the aligner matches against (see `normalize`). Used to
 * decide whether a carried-forward 'whisper' anchor is still trustworthy
 * after a re-sync changes a segment's underlying text.
 */
export function textMateriallyChanged(a: string, b: string): boolean {
  return normalize(a).join(' ') !== normalize(b).join(' ');
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
  matched: boolean;               // at least one matched transcript word (confidence > 0)
  matchedWords: number;           // WS1b: numerator for confidence + the bidirectional coverage metric (§3.3)
  totalWords: number;             // WS1b: 0 for a zero-token (classification-neutral) segment (§3.1.1 point 4)
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
): AlignResult[] {
  if (!tokens.length || !segments.length) {
    return segments.map(() => ({
      t0: 0, t1: 0, firstTokenIdx: -1, lastTokenIdx: -1,
      confidence: 0, matched: false, matchedWords: 0, totalWords: 0,
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

  const audioDuration = tokens[tokens.length - 1]?.endSec ?? 0;

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
        confidence: 0, matched: false, matchedWords: 0, totalWords: 0,
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

    // --- Token-stealing rescue (Parts 1-3, WS6) --------------------------
    const seg = segments[si]!;
    if (matchedCount === 0 && seg.anchorStart !== undefined) {
      // Forward-ordering bound (false-positive rescue fix) — see the
      // module-level comment by `computeForwardBoundStartSec` above.
      // `undefined` when no later segment has a true global match of its own.
      const forwardBoundStartSec = computeForwardBoundStartSec(si);
      const exceedsForwardBound = (globalIdxs: readonly number[]): boolean =>
        forwardBoundStartSec !== undefined && earliestClaimStartSec(globalIdxs) >= forwardBoundStartSec;
      const expectedStart = seg.anchorStart;
      const expectedEnd = segments[si + 1]?.anchorStart ?? audioDuration;
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

        if (localMatches.length > 0) recoveredVia = 'windowed';
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
          recoveredVia = 'global';
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
          recoveredVia = 'concat';
        }
      }

      if (localMatches.length > 0) {
        localMatches.sort((a, b) => a.globalIdx - b.globalIdx);
        matchedCount = localMatches.length;
        firstSub = localMatches[0]!.globalIdx;
        lastSub = localMatches[localMatches.length - 1]!.globalIdx;
      } else if (concatMatches.length > 0) {
        matchedCount = concatMatches.length;
        firstSub = concatMatches[0]!.tokenStartIdx;
        lastSub = concatMatches[concatMatches.length - 1]!.tokenEndIdx;
      }
    }

    const confidence = matchedCount / totalWords;
    const matched = matchedCount > 0;

    // Uncovered segment (no matched transcript word): no audio region. WS1a does
    // not gate on this yet (WS1b wires the abort gate) — anchor at the previous
    // boundary as a placeholder so the unchanged downstream stages see no hole.
    if (!matched) {
      results.push({
        t0: prevAnchor, t1: prevAnchor, firstTokenIdx: -1, lastTokenIdx: -1,
        confidence, matched, matchedWords: 0, totalWords,
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
      matchedWords: matchedCount, totalWords,
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

/** What `filterMalformedTokens` produced — the surviving tokens plus the counts
 *  the sync log reports. `tokens` is the array every later stage must use. */
export interface MalformedTokenFilterResult {
  tokens: TranscriptToken[];
  /** How many tokens were dropped. 0 ⇒ nothing was wrong, no log entry. */
  skippedCount: number;
  /** Pre-filter token count — the denominator the log entry shows. */
  totalTokens: number;
}

/**
 * Drops tokens whose timestamps or text make them unusable for alignment. Any
 * ONE of these disqualifies a token (doc decision 14a):
 *
 *   - `startSec` or `endSec` is NaN or Infinite
 *   - `startSec < 0`
 *   - `endSec > audioDuration + MALFORMED_TOKEN_DURATION_TOLERANCE_SEC`
 *   - `startSec >= endSec` (zero or negative duration)
 *   - the text is empty / whitespace-only once normalized
 *
 * The end-of-audio check is skipped entirely when `audioDuration` is not a
 * usable positive finite number — an unknown duration must not cause every
 * token to be discarded.
 *
 * Pure: returns a new array, never mutates the input.
 */
export function filterMalformedTokens(
  tokens: TranscriptToken[],
  audioDuration: number,
): MalformedTokenFilterResult {
  const checkAgainstEnd = Number.isFinite(audioDuration) && audioDuration > 0;
  const maxEnd = audioDuration + MALFORMED_TOKEN_DURATION_TOLERANCE_SEC;

  const kept = tokens.filter(t => {
    const t0 = t?.startSec;
    const t1 = t?.endSec;
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return false;
    if (t0 < 0) return false;
    if (t0 >= t1) return false;
    if (checkAgainstEnd && t1 > maxEnd) return false;
    // Text that normalizes to nothing (punctuation-only, whitespace-only) can
    // never match a scene-doc word, but its timestamps can still be picked as a
    // segment edge. Drop it here rather than letting it anchor a boundary.
    if (normalize(t?.text ?? '').length === 0) return false;
    return true;
  });

  return {
    tokens: kept,
    skippedCount: tokens.length - kept.length,
    totalTokens: tokens.length,
  };
}

export function alignScenestoTranscript(
  segments: VideoSegment[],
  tokens: TranscriptToken[],
  silences: SilenceInterval[] = [],
): SegmentAlignment[] {
  const _instrOn = alignInstrEnabled();
  const _passT0 = _instrOn ? performance.now() : 0;

  if (!tokens.length || !segments.length) {
    return segments.map(() => ({
      t0: 0, t1: 0, firstTokenIdx: -1, lastTokenIdx: -1,
      confidence: 0, matched: false, matchedWords: 0, totalWords: 0,
    }));
  }

  // Hirschberg semi-global alignment + per-segment extraction (doc §3.1/§3.1.1).
  const results = extractSegmentAlignments(segments, tokens);

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

  // Gap-fill — place boundaries in real audio silence.
  // Reads actual Whisper token timestamps to find the midpoint of the silence gap
  // between adjacent segments and moves both boundaries to that midpoint.
  // Pairs where either side is locked are skipped entirely.
  //
  // CANDIDACY + CLAIMING (2026-08-02 port from snapBoundaries.ts): this loop
  // used to test only bare window overlap and claim silences first-come-
  // first-served (usedSilences). snapBoundaries.ts's covered-only re-snap has
  // since grown two fixes this full-array pass lacked: intra-segment/breath
  // rejection (fillsTokenGapWithinSpan + isBreathSilence, composed with the
  // existing window/tolerance test isBoundarySilenceCandidate) and
  // contention-aware assignment (a silence overlapped by more than one pair's
  // window goes to whichever pair's spoken midpoint it's actually closer to,
  // not to whichever pair runs first). Both are ported below verbatim;
  // snapBoundaries.ts remains their canonical home — see that file's header
  // for the full derivation of each predicate. EVERYTHING ELSE below (window
  // math, closest-centre selection, the token-midpoint fallback, the
  // monotonic check, and the t0/t1 writes) is UNCHANGED.
  //
  // SENTINEL (-1) SEGMENTS: unlike snapBoundaries.ts, which only ever sees
  // covered (matched) segments, this pass runs on the FULL segment array and
  // can hand an unmatched/heading-only segment's -1 firstTokenIdx/lastTokenIdx
  // straight to the two new predicates. Both already guard on it
  // (`firstTokenIdx < 0`) and simply return false — a sentinel side can never
  // be flagged as its own breath, so a pair with one falls straight through to
  // the (also ported) window/tolerance candidacy test, using the same `??`
  // fallback values (curr.t1/next.t0/etc.) this loop already relied on for a
  // sentinel side before this port.
  interface GapFillPairPlan {
    lastSpokenEnd: number;
    nextSpokenStart: number;
    spokenMid: number;
    overlapping: SilenceInterval[];
  }

  // --- Pass 1 — compute every pair's search window + candidate silences ----
  const gapFillPlans: Array<GapFillPairPlan | null> = [];
  for (let i = 0; i < results.length - 1; i++) {
    if (segments[i]?.locked || segments[i + 1]?.locked) {
      gapFillPlans.push(null);
      continue;
    }
    const curr = results[i]!;
    const next = results[i + 1]!;

    // Sentinel -1 indices (empty/heading-only segments) return undefined → fallback to curr.t1/next.t0.
    const lastSpokenEnd   = tokens[curr.lastTokenIdx]?.endSec   ?? curr.t1;
    const nextSpokenStart = tokens[next.firstTokenIdx]?.startSec ?? next.t0;
    // curr's own first word and next's own last word — outer bounds this boundary's
    // search may never cross. Without this clamp, the wide radius used below for a
    // near-zero spokenGapWidth can reach past a short next segment entirely and steal
    // the silence that belongs to the FOLLOWING boundary, collapsing that segment to ~0.
    const currFirstSpokenStart = tokens[curr.firstTokenIdx]?.startSec ?? curr.t0;
    const nextLastSpokenEnd    = tokens[next.lastTokenIdx]?.endSec   ?? next.t1;

    // Find silences overlapping a window centered on the spoken-gap midpoint.
    // Whisper word-boundary timestamps are inaccurate by ~300ms, so a silence can extend
    // past nextSpokenStart or start before lastSpokenEnd — a containment check fails those.
    // Instead we look for overlap with a generous search window and pick the closest center.
    const spokenMid = (lastSpokenEnd + nextSpokenStart) / 2;
    const spokenGapWidth = nextSpokenStart - lastSpokenEnd;
    // When Whisper compresses adjacent words to the same timestamp (spokenGap near 0),
    // its boundary timestamp is unreliable. Use a 1.0s radius (not larger — avoids stealing
    // silences that belong to neighbouring boundaries).
    const searchRadius = spokenGapWidth < 0.1
      ? 1.0
      : Math.max(0.5, spokenGapWidth / 2 + 0.4);
    const searchStart = Math.max(spokenMid - searchRadius, currFirstSpokenStart);
    const searchEnd   = Math.min(spokenMid + searchRadius, nextLastSpokenEnd);

    // Candidacy: token-gap + breath discrimination FIRST (alignment evidence,
    // short-circuiting), the window/span/tolerance test LAST — same order and
    // same predicates as snapBoundaries.ts's Pass 1.
    const overlapping = silences.filter(s =>
      !fillsTokenGapWithinSpan(s, tokens, curr.firstTokenIdx, curr.lastTokenIdx) &&
      !fillsTokenGapWithinSpan(s, tokens, next.firstTokenIdx, next.lastTokenIdx) &&
      !isBreathSilence(s, tokens, curr.firstTokenIdx, curr.lastTokenIdx) &&
      !isBreathSilence(s, tokens, next.firstTokenIdx, next.lastTokenIdx) &&
      isBoundarySilenceCandidate(s, searchStart, searchEnd, lastSpokenEnd, nextSpokenStart),
    );

    gapFillPlans.push({ lastSpokenEnd, nextSpokenStart, spokenMid, overlapping });
  }

  // --- Pass 2 — assign each contested silence to exactly one pair ----------
  // A silence overlapped by more than one pair's window goes to whichever
  // pair's spoken midpoint it sits closest to (ties -> later pair), not to
  // whichever pair happens to run first — same rule as snapBoundaries.ts's
  // Pass 2. A silence overlapped by no pair, or by exactly one, resolves the
  // same as the old usedSilences scheme.
  const bestPairForSilence = new Map<SilenceInterval, { pairIdx: number; dist: number }>();
  for (let i = 0; i < gapFillPlans.length; i++) {
    const plan = gapFillPlans[i];
    if (!plan) continue;
    for (const s of plan.overlapping) {
      const dist = Math.abs((s.startSec + s.endSec) / 2 - plan.spokenMid);
      const best = bestPairForSilence.get(s);
      if (best === undefined || dist <= best.dist) {
        bestPairForSilence.set(s, { pairIdx: i, dist });
      }
    }
  }
  const gapFillAssignment: SilenceInterval[][] = gapFillPlans.map(() => []);
  for (const s of silences) {
    const best = bestPairForSilence.get(s);
    if (best !== undefined) gapFillAssignment[best.pairIdx]!.push(s);
  }

  // --- Pass 3 — resolve boundaries left-to-right ----------------------------
  // Unchanged from before except for where the candidate list comes from:
  // closest-centre pick among THIS pair's assigned silences, token-midpoint
  // fallback when it has none, and the monotonic safety-net check.
  for (let i = 0; i < results.length - 1; i++) {
    if (segments[i]?.locked || segments[i + 1]?.locked) continue;
    const curr = results[i]!;
    const next = results[i + 1]!;
    const plan = gapFillPlans[i]!;
    const { lastSpokenEnd, nextSpokenStart, spokenMid } = plan;

    const candidates = gapFillAssignment[i]!;
    let gap: SilenceInterval | undefined;
    if (candidates.length > 0) {
      gap = candidates.reduce((best, s) => {
        const sCenter    = (s.startSec + s.endSec) / 2;
        const bestCenter = (best.startSec + best.endSec) / 2;
        return Math.abs(sCenter - spokenMid) < Math.abs(bestCenter - spokenMid) ? s : best;
      });
    }

    // Split the silence 50/50: if a real gap was detected, use its midpoint;
    // otherwise fall back to the midpoint of the token-boundary estimate.
    let boundary = gap
      ? (gap.startSec + gap.endSec) / 2
      : (lastSpokenEnd + nextSpokenStart) / 2;

    // Monotonic sanity check: a boundary must not go backwards past the previous one.
    // If it does, the chosen silence belongs to an earlier boundary — fall back.
    // This applies to BOTH the silence-centre and the token-midpoint boundary.
    if (i > 0 && boundary < results[i - 1]!.t1) {
      boundary = (lastSpokenEnd + nextSpokenStart) / 2;
    }

    // No-silence fallback: boundary = token midpoint. The midpoint inherently
    // lies within the spoken-word range; no clamp post-processing needed.

    curr.t1 = boundary;
    next.t0 = boundary;
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
  _totalDuration: number,
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
