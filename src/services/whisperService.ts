import { invoke, Channel } from '@tauri-apps/api/core';
import type { Asset, VideoSegment, TranscriptToken } from '../types';
import type { SilenceInterval } from './silenceDetector';
import { canonicalize, canonicalizeSceneDoc } from './textNormalize';
import {
  ALIGN_MATCH_SCORE, ALIGN_MISMATCH_SCORE, ALIGN_GAP_SCORE,
  LOW_CONFIDENCE_RATIO, MALFORMED_TOKEN_DURATION_TOLERANCE_SEC,
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

function pairScore(a: string, b: string): number {
  return a === b ? ALIGN_MATCH_SCORE : ALIGN_MISMATCH_SCORE;
}

function reversedSlice(arr: string[]): string[] {
  return arr.slice().reverse();
}

/**
 * Forward Needleman-Wunsch scoring — returns the LAST ROW of the global
 * alignment DP (charged gaps on both sides). O(m) space. Length m+1.
 */
function nwForwardRow(q: string[], s: string[]): Int32Array {
  const m = s.length;
  let prev = new Int32Array(m + 1);
  for (let j = 1; j <= m; j++) prev[j] = j * ALIGN_GAP_SCORE;
  let curr = new Int32Array(m + 1);
  for (let i = 1; i <= q.length; i++) {
    curr[0] = i * ALIGN_GAP_SCORE;
    const qi = q[i - 1]!;
    for (let j = 1; j <= m; j++) {
      const diag = prev[j - 1]! + pairScore(qi, s[j - 1]!);
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
function nwForwardRowFreeLead(q: string[], s: string[]): Int32Array {
  const m = s.length;
  let prev = new Int32Array(m + 1); // row 0 = all zeros: free leading subject gap
  let curr = new Int32Array(m + 1);
  for (let i = 1; i <= q.length; i++) {
    curr[0] = i * ALIGN_GAP_SCORE;  // query deletions are always charged
    const qi = q[i - 1]!;
    for (let j = 1; j <= m; j++) {
      const diag = prev[j - 1]! + pairScore(qi, s[j - 1]!);
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
function nwBackwardRowToFixedEnd(q: string[], s: string[], b: number): Int32Array {
  const n = q.length;
  let next = new Int32Array(b + 1); // row i = n
  for (let j = 0; j <= b; j++) next[j] = (b - j) * ALIGN_GAP_SCORE;
  let curr = new Int32Array(b + 1);
  for (let i = n - 1; i >= 0; i--) {
    curr[b] = (n - i) * ALIGN_GAP_SCORE;
    const qi = q[i]!;
    for (let j = b - 1; j >= 0; j--) {
      const diag = next[j + 1]! + pairScore(qi, s[j]!);
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
 * per query word to `ops`.
 */
function hirschbergGlobal(
  q: string[], qOff: number,
  s: string[], sOff: number,
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
    // the best subject position (leftmost on ties, for determinism).
    const x = q[0]!;
    let bestJ = 0;
    let bestSc = pairScore(x, s[0]!);
    for (let j = 1; j < m; j++) {
      const sc = pairScore(x, s[j]!);
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
  const scoreL = nwForwardRow(qL, s);
  const scoreR = nwForwardRow(reversedSlice(qR), reversedSlice(s));
  let sMid = 0;
  let best = -Infinity;
  for (let j = 0; j <= m; j++) {
    const v = scoreL[j]! + scoreR[m - j]!;
    if (v > best) { best = v; sMid = j; }
  }
  hirschbergGlobal(qL, qOff, s.slice(0, sMid), sOff, matchedSubjectOf, ops);
  hirschbergGlobal(qR, qOff + qMid, s.slice(sMid), sOff + sMid, matchedSubjectOf, ops);
}

/**
 * Semi-global (free-end-gap on the subject side) alignment of the full query
 * against the full subject. Finds the optimal subject infix [a, b) via two
 * linear-space scoring passes — a forward pass with a free leading subject gap
 * fixes the end b (last-row argmax) and its score, a backward pass to that
 * fixed end fixes the start a — then runs a standard global Hirschberg over
 * q × subject[a:b). The free leading/trailing subject gaps (skipped prefix/
 * suffix) cost nothing, exactly modelling the partial-coverage design.
 */
export function alignQueryToSubject(query: string[], subject: string[]): TokenAlignment {
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

  // End column b + optimal semi-global score (free leading subject gap).
  const lastRow = nwForwardRowFreeLead(query, subject);
  let b = 0;
  let score = lastRow[0]!;
  for (let j = 1; j <= m; j++) {
    if (lastRow[j]! > score) { score = lastRow[j]!; b = j; }
  }

  // Start column a (best start for the fixed end b). b === 0 ⇒ empty infix.
  let a = 0;
  if (b > 0) {
    const g0 = nwBackwardRowToFixedEnd(query, subject, b);
    let bestStart = g0[0]!;
    for (let j = 1; j <= b; j++) {
      if (g0[j]! > bestStart) { bestStart = g0[j]!; a = j; }
    }
  }

  hirschbergGlobal(query, 0, subject.slice(a, b), a, matchedSubjectOf, ops);
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

/**
 * Builds the scene-doc query, aligns it to the transcript with the Hirschberg
 * semi-global aligner, and reads per-segment results off the single global
 * alignment (doc §3.1.1). Exported as the seam WS1b threads coverage through;
 * `alignScenestoTranscript` consumes these AlignResults, then runs the unchanged
 * Step-2/silence/clamp stages and narrows the return to `{ t0, t1 }` for now.
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
  const tokenWords: Array<{ word: string; tokenIdx: number }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const words = normalize(tokens[i]!.text);
    for (const word of words) {
      if (word.length > 0) tokenWords.push({ word, tokenIdx: i });
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
    for (let qi = range.start; qi < range.end; qi++) {
      const sj = matchedSubjectOf[qi]!;
      if (sj >= 0) {
        matchedCount++;
        if (firstSub < 0) firstSub = sj;
        lastSub = sj;
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

    results.push({
      t0, t1, firstTokenIdx, lastTokenIdx, confidence, matched,
      matchedWords: matchedCount, totalWords,
      audioRegion: { startSec: t0, endSec: rawT1 },
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
  // usedSilences prevents the same silence interval from being claimed by two boundaries.
  const usedSilences = new Set<SilenceInterval>();
  for (let i = 0; i < results.length - 1; i++) {
    if (segments[i]?.locked || segments[i + 1]?.locked) continue;
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

    const candidates = silences.filter(
      s => s.endSec > searchStart && s.startSec < searchEnd && !usedSilences.has(s),
    );

    let gap: SilenceInterval | undefined;
    if (candidates.length > 0) {
      gap = candidates.reduce((best, s) => {
        const sCenter    = (s.startSec + s.endSec) / 2;
        const bestCenter = (best.startSec + best.endSec) / 2;
        return Math.abs(sCenter - spokenMid) < Math.abs(bestCenter - spokenMid) ? s : best;
      });
    }

    // Mark the chosen silence as used so later boundaries cannot claim it.
    if (gap) usedSilences.add(gap);

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
