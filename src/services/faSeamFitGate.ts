/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// R.11 — CHUNK-FIT BOUNDARY CORRECTION.
//
// THE MECHANISM (WS1 Session F root cause, ear-pass item 7 + the two OV3
// triage defects — `152_frozen_brush_mice`, `abysmal_opinion`,
// `226_four_scouts`, all the SAME defect class found through different
// symptoms). A forced-alignment chunk's window carries attributed script
// text that does not FIT its audio — measured as `fit = scriptWordCount /
// tokenOnsetCount`, extreme in either direction (text surplus, fit > 1;
// audio surplus, fit < 1). A CTC objective must place every target token
// SOMEWHERE, so FA crushes word timings into implausible positions inside
// the too-small (or too-large) window. The committed boundary near that
// chunk's edge then lands on one of two garbage values: FA's own
// back-to-back word-seam midpoint spanning no real silence at all (item 7),
// or the midpoint of the WRONG nearby real silence (`abysmal_opinion`) —
// while the chunk's OWN edge sits at an already-correct location the whole
// time: an R.1 three-source-agreement anchor (`faAnchors.ts`, UNCHANGED,
// I6's own invariant that an agreed anchor's time is always a detected
// silence's `endSec`).
//
// WHY THIS RUNS HERE, NOT IN `faChunkPlan.ts`/`faAnchors.ts`. Both are
// available BEFORE inference (the chunk plan; the run/anchor structure with
// its provenance), which makes them tempting — but the actual DEFECT is not
// visible until the committed boundary exists: detection needs to compare
// the COMMITTED value against the chunk-edge silence's midpoint, and that
// committed value is FA's own inference OUTPUT, produced downstream of both
// modules. This mirrors R.10's own finding (`faUnspokenGate.ts`'s header)
// that the signal's availability point, not convenience, decides the
// surface. Like R.10, this module reads FA's own per-word confidence (the
// third conjunct below) — its detection is therefore only meaningful AFTER
// inference, on the chunk plan, the run provenance, the real detected
// silences, FA's own word output, and the final committed segment array —
// so it runs AFTER `headExtendFirstSegment` produces the fully-timed array,
// as a correction pass over already-committed FA output. `faChunkPlan.ts`,
// `faAnchors.ts` and `snapBoundaries.ts` are all read (their real output is
// required input) but never modified and never re-invoked with different
// arguments.
//
// THE SIGNAL IS SUSPICION, NOT GUILT (stated plainly — R11_MIN_FIT_DEVIATION's
// own doc comment in `syncConstants.ts` has the measurement). This is
// unlike R.10's 850x-separated structural zero: R.11's threshold sits with
// an unverified candidate only 0.0016 below it. Every correction this module
// makes beyond the three ear-verified register members (`152_frozen_brush_
// mice`, `abysmal_opinion`, `226_four_scouts`) is real, structurally
// well-evidenced, and UNVERIFIED — flagged in the finding's own shape so a
// caller can log it distinctly, exactly as WS1 Session D's OV3 triage
// treated new fit-suspicious candidates before an owner ear pass confirmed
// or rejected them.
//
// MODEL P (gapless partition). Nudging segment i's startTime without also
// adjusting segment i-1's duration would open a gap or overlap. Corrections
// are applied left to right against a mutable working copy so two adjacent
// R.11 corrections compose correctly (the second reads the first's already-
// adjusted duration, never the stale pre-correction one).
//
// THE THIRD CONJUNCT (added after fit-deviation alone was measured to
// false-fire on v6 `125_night_circle`, a boundary R.5 already fixed
// correctly). Fit-deviation says a chunk's TEXT does not fit its AUDIO; it
// says nothing about whether the SPECIFIC span between the wrongly-
// committed value and the proposed correction is itself acoustically
// empty. `125_night_circle`'s committed value already sat on a genuine,
// separate, high-confidence silence — extreme chunk fit elsewhere in the
// same chunk did not make THAT boundary wrong. Requiring every FA word
// inside `[min(committed,corrected), max(committed,corrected)]` to carry no
// real acoustic support (`R11_MAX_SPAN_WORD_CONF`, `syncConstants.ts`)
// mirrors R.10's own evidentiary shape and is what actually separates the
// three known defects from R.5's already-correct output.
// ---------------------------------------------------------------------------

import { computeFaChunkPlan, computeRuns } from './faChunkPlan';
import type { FaChunk } from './faChunkPlan';
import type { FaRun } from './faAnchors';
import { R11_MIN_FIT_DEVIATION, R11_MIN_CORRECTION_SEC, R11_MAX_SPAN_WORD_CONF } from './syncConstants';
import type { SilenceInterval } from './silenceDetector';
import type { TranscriptToken, VideoSegment } from '../types';

/** One boundary R.11 proposes to correct, with the evidence that produced
 *  it. `segmentIndex`/`segmentId` name the segment whose OWN `startTime` is
 *  the boundary in question (the shared edge with its predecessor, per
 *  Model P) — the same convention `UnspokenScriptFinding` uses. */
export interface SeamFitFinding {
  segmentIndex: number;
  segmentId: string;
  segmentTag?: string;
  chunkIndex: number;
  chunkStartSec: number;
  chunkEndSec: number;
  /** scriptWordCount / tokenOnsetCount for the containing chunk. */
  fit: number;
  /** max(fit, 1/fit) — always >= 1, growing with extremity in EITHER
   *  direction; what `R11_MIN_FIT_DEVIATION` gates. */
  fitDeviation: number;
  /** Which edge of the chunk the corrected value is anchored to. */
  edge: 'start' | 'end';
  committedValue: number;
  correctedValue: number;
  delta: number;
  /** Loudest FA word confidence inside the correction span — below
   *  `R11_MAX_SPAN_WORD_CONF` by definition; recorded so a log reader sees
   *  how far below. */
  spanMaxConfidence: number;
}

function scriptWordCount(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * R.11's detector. Pure — no React, no DOM, no IPC.
 *
 * `segments` must be the COMPLETE, pre-skip-filter array in the exact order
 * `computeFaChunkPlan`/`computeRuns` were originally given (mirrors
 * `App.tsx`'s `anchorTimed` — the same array `runForcedAlignmentForSync`
 * receives) — index-based word attribution requires it, the same
 * requirement `scripts/phase4-fa-replay.test.ts`'s `loadAnchorPathInputs`
 * documents for the identical reason. `tokens` are Whisper tokens (fit's
 * own denominator is Whisper token onsets, not FA's); `silences` are the
 * real detected silences a chunk edge's agreed anchor was chosen from.
 * `faTokens` are the FORCED-ALIGNMENT word tokens (`faWordSpansToTranscript
 * Tokens` output, real per-word `confidence`) — the third conjunct's own
 * evidence; a token without a numeric `confidence` is treated as UNUSABLE
 * EVIDENCE, never as zero, the same rule `faUnspokenGate.ts` follows and for
 * the same reason (a missing-confidence harness bug must never look like a
 * confirmed-empty span).
 */
export function detectSeamFitDefects(
  segments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  faTokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
): SeamFitFinding[] {
  if (segments.length === 0 || tokens.length === 0) return [];

  const chunks: FaChunk[] = computeFaChunkPlan(segments, tokens, silences, audioDuration);
  const runs: FaRun[] = computeRuns(segments, tokens, silences, audioDuration);
  if (chunks.length === 0) return [];

  // Word-index attribution: chunk text is a contiguous partition of the
  // concatenated RAW script-token stream (same technique faChunkPlan.ts's
  // own index-attribution branch uses internally), so walking each
  // segment's own raw word count maps every segment onto the chunk whose
  // text contains its FIRST script word. TIME containment is unreliable
  // here — it is precisely the mechanism under detection that FA's output
  // timestamp can land outside its own chunk's nominal window.
  const segWordCounts = segments.map(s => scriptWordCount(s.text ?? ''));
  const chunkWordCounts = chunks.map(c => scriptWordCount(c.text));
  const wordToChunk: number[] = [];
  chunkWordCounts.forEach((n, ci) => { for (let i = 0; i < n; i++) wordToChunk.push(ci); });
  const segFirstChunk: number[] = [];
  const segWordStart: number[] = [];
  let cursor = 0;
  for (const n of segWordCounts) {
    segWordStart.push(cursor);
    segFirstChunk.push(n > 0 ? (wordToChunk[cursor] ?? -1) : -1);
    cursor += n;
  }
  const chunkWordStart: number[] = [];
  { let c = 0; for (const n of chunkWordCounts) { chunkWordStart.push(c); c += n; } }

  const chunkBoundaries = new Map<number, number[]>();
  for (let i = 0; i < segments.length; i++) {
    const ci = segFirstChunk[i];
    if (ci === undefined || ci === -1) continue;
    if (!chunkBoundaries.has(ci)) chunkBoundaries.set(ci, []);
    chunkBoundaries.get(ci)!.push(i);
  }

  const fitByChunk = chunks.map((c, ci) => {
    const words = chunkWordCounts[ci]!;
    const onsets = tokens.filter(t => t.startSec >= c.startSec - 1e-9 && t.startSec < c.endSec - 1e-9).length;
    const fit = onsets > 0 ? words / onsets : Number.POSITIVE_INFINITY;
    const fitDeviation = onsets > 0 ? Math.max(fit, 1 / fit) : Number.POSITIVE_INFINITY;
    return { fit, fitDeviation };
  });

  const findings: SeamFitFinding[] = [];

  for (const [ci, segIdxs] of chunkBoundaries) {
    const { fit, fitDeviation } = fitByChunk[ci]!;
    if (!(fitDeviation > R11_MIN_FIT_DEVIATION)) continue; // NaN-safe: also excludes Infinity===Infinity false positives correctly (Infinity > finite threshold is true, intended)
    const chunk = chunks[ci]!;
    const chunkStartWord = chunkWordStart[ci]!;
    const chunkEndWord = chunkStartWord + chunkWordCounts[ci]!;

    // A boundary is only tested against an edge it is actually WORD-ALIGNED
    // to — not merely "first/last in this chunk's segIdxs list". A single-
    // boundary chunk (segIdxs.length===1) does NOT mean that one boundary
    // is meaningfully both "chunk-start" and "chunk-end": item 7's own
    // chunk 79 has exactly one attributed boundary (152_frozen_brush_mice),
    // but its first word sits WELL INSIDE the chunk's word range (the
    // preceding segment's tail occupies the chunk's earlier words), so it
    // is chunk-END-aligned only — testing it against the START edge
    // produces a meaningless answer (measured: 448.02, an unrelated earlier
    // silence). Alignment is checked via cumulative word offsets, the same
    // index space `faChunkPlan.ts` itself cuts chunks in — never by
    // position in segIdxs.
    const first = segIdxs[0]!;
    const last = segIdxs[segIdxs.length - 1]!;
    const candidates: Array<{ segIdx: number; edge: 'start' | 'end' }> = [];
    if (segWordStart[first] === chunkStartWord) candidates.push({ segIdx: first, edge: 'start' });
    if (segWordStart[last]! + segWordCounts[last]! >= chunkEndWord) candidates.push({ segIdx: last, edge: 'end' });

    for (const { segIdx, edge } of candidates) {
      // A boundary at pre-filter index 0 is never a candidate:
      // `headExtendFirstSegment` unconditionally forces the FINAL first
      // committed segment's start to 0, so no correction here could ever
      // survive to be observed, and applying one would be dead code
      // exercising nothing.
      if (segIdx === 0) continue;

      const edgeTime = edge === 'start' ? chunk.startSec : chunk.endSec;
      const run = runs.find(r => Math.abs((edge === 'start' ? r.windowStart : r.windowEnd) - edgeTime) < 1e-6);
      const agreedAnchor = edge === 'start' ? run?.startProvenance === 'agreed-anchor' : run?.endProvenance === 'agreed-anchor';
      if (!agreedAnchor) continue; // no real silence to correct toward — decline, per R.4/R-P's own forced-split-vs-anchor distinction.

      // I6 (faAnchors.ts, unmodified): an agreed anchor's time is ALWAYS a
      // detected silence's endSec, never a token start — so this lookup is
      // guaranteed to find a match whenever agreedAnchor is true.
      const backingSilence = silences.find(s => Math.abs(s.endSec - edgeTime) < 1e-6);
      if (!backingSilence) continue; // defensive — see I6 above; never expected to fire.

      const correctedValue = (backingSilence.startSec + backingSilence.endSec) / 2;
      const committedValue = segments[segIdx]!.startTime;
      const delta = correctedValue - committedValue;
      if (Math.abs(delta) <= R11_MIN_CORRECTION_SEC) continue; // already correct — no-op.

      // Third conjunct: every FA word inside the correction span must carry
      // no real acoustic support. A token without a numeric confidence is
      // unusable evidence and excluded from the max (never counted as
      // zero) — see this function's own doc comment. No usable evidence at
      // all inside the span declines rather than vacuously passing: a
      // segment R.11 corrects must have POSITIVE evidence the span is
      // empty, not merely an absence of contrary evidence.
      const spanLo = Math.min(committedValue, correctedValue);
      const spanHi = Math.max(committedValue, correctedValue);
      let spanMaxConf: number | undefined;
      for (const tok of faTokens) {
        if (tok.startSec < spanLo - 1e-9 || tok.startSec > spanHi + 1e-9) continue;
        if (typeof tok.confidence !== 'number' || !Number.isFinite(tok.confidence)) continue;
        if (spanMaxConf === undefined || tok.confidence > spanMaxConf) spanMaxConf = tok.confidence;
      }
      if (spanMaxConf === undefined || spanMaxConf >= R11_MAX_SPAN_WORD_CONF) continue;

      findings.push({
        segmentIndex: segIdx,
        segmentId: segments[segIdx]!.id,
        segmentTag: (segments[segIdx] as unknown as { tag?: string }).tag,
        chunkIndex: ci,
        chunkStartSec: chunk.startSec,
        chunkEndSec: chunk.endSec,
        fit,
        fitDeviation,
        edge,
        committedValue,
        correctedValue,
        delta,
        spanMaxConfidence: spanMaxConf,
      });
    }
  }

  // Stable order: ascending segment index, so `applySeamFitCorrections`
  // composes left to right deterministically when two findings share a
  // neighbour.
  findings.sort((a, b) => a.segmentIndex - b.segmentIndex);
  return findings;
}

/**
 * Applies findings to the FINAL, fully-timed committed segment array (post
 * `headExtendFirstSegment`) by ID — a finding whose segment was dropped
 * upstream (R.10, the coverage skip filter) or reordered simply has no
 * match and is silently skipped, exactly as `applyUnspokenScriptGate`'s own
 * tolerant-by-id pattern does.
 *
 * Model P: correcting `segments[i].startTime` moves the shared boundary
 * with `segments[i-1]`, so `segments[i-1].duration` is adjusted by the same
 * delta in the opposite direction — Σ duration and the gapless partition
 * are preserved exactly. A correction whose predecessor's duration would go
 * non-positive is declined (defensive; not expected on any committed
 * corpus — a two-second-plus correction eating an entire neighbour would
 * itself be evidence of a chunk-plan problem R.11 cannot safely paper over).
 *
 * Immutable: returns a new array, never mutates its input (CLAUDE.md).
 */
export function applySeamFitCorrections(
  finalSegments: readonly VideoSegment[],
  findings: readonly SeamFitFinding[],
): VideoSegment[] {
  if (findings.length === 0) return finalSegments as VideoSegment[];

  const byId = new Map(findings.map(f => [f.segmentId, f]));
  const out = finalSegments.map(s => ({ ...s }));

  for (let i = 0; i < out.length; i++) {
    if (i === 0) continue; // no predecessor to absorb the delta; also excluded at detection time.
    const finding = byId.get(out[i]!.id);
    if (!finding) continue;

    const delta = finding.correctedValue - out[i]!.startTime;
    const prevDuration = out[i - 1]!.duration + delta;
    const ownDuration = out[i]!.duration - delta;
    if (!(prevDuration > 0) || !(ownDuration > 0)) continue; // decline rather than produce a non-positive duration.

    // Only the SHARED boundary with i-1 moves — segment i's own END (its
    // boundary with i+1) must stay fixed, so its duration absorbs delta in
    // the OPPOSITE direction from i-1's. Moving i's startTime without this
    // would silently open a gap/overlap at the i/i+1 boundary.
    out[i - 1] = { ...out[i - 1]!, duration: prevDuration };
    out[i] = { ...out[i]!, startTime: finding.correctedValue, duration: ownDuration };
  }

  return out;
}
