/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Forced-alignment CHUNK PLAN (WS1 Task 5 Slice D11).
//
// D10 (`docs/ws1-sync-pipeline/measurements/d10-runtime-observations-
// 2026-08-13.md`) proved a whole-file FA pass is infeasible at production
// audio length (240s already peaks at 19.5GiB, accelerating; a 709s project
// extrapolates to 60-154GB). Windowing is mandatory. `faAnchors.ts`'s
// `computeFaAnchors` (unmodified, untouched by this module) already computes
// the R.0/R.1/R.4 run structure — maximal `MAX_RUN_SEC`-bounded audio windows
// bounded by three-source-agreement anchors or a force-split — but its
// returned `FaRun`/`Boundary` shape carries no `qi` (script-word index), so
// it cannot itself answer "what TEXT does chunk k get aligned against."
//
// STEP 0 DESIGN REVIEW RESOLUTION (this slice, owner-approved): chunk TEXT is
// derived from `project.segments`' own `startTime` — a segment belongs to
// exactly the run whose `[windowStart, windowEnd)` contains that segment's
// `startTime` — NOT from `qi`. This works uniformly for every run boundary
// provenance (agreed-anchor, corpus-start/end, AND forced-split alike, where
// no `qi` exists at all by construction) and needs no new heuristic: it
// reuses Model P (`project.segments` gaplessly and monotonically partitions
// `[0, audioDuration)` — `CLAUDE.md` §4) and `faAnchors.ts`'s own I1/I2
// guarantee that `runs[]` does the same, so every segment's `startTime` lands
// in exactly one run. R.0's own text licenses this directly: "a run is a
// maximal contiguous group of committed SEGMENTS" (`sync-pipeline-v2-plan.md`).
//
// `queryWords`/`subjectWords`/`subjectTokenIdx` construction below mirrors
// `whisperService.ts`'s `extractSegmentAlignments` (its own `tokenWords`
// expansion at lines ~799-805 and `queryWords`/segment-range construction at
// ~811-821) byte-for-byte in technique — NOT a call into that function
// (unmodified, untouched, scope-prohibited) — because `computeFaAnchors`
// needs the same `qi` space (`alignment.ops[].qi`) that construction produces
// for its OWN internal R.1 admissibility test (contiguous-match-run length,
// silence agreement). This module never reads `qi` back out for chunk text —
// only `computeFaAnchors`'s `runs[]` (time windows) is consumed downstream.
// ---------------------------------------------------------------------------

import type { TranscriptToken, VideoSegment } from '../types';
import type { SilenceInterval } from './silenceDetector';
import { alignQueryToSubject, normalize, normalizeSceneDoc } from './whisperService';
import { computeFaAnchors } from './faAnchors';

/** One forced-alignment chunk: an audio time window (raw, unpadded — R.2
 *  padding is out of scope for this slice) and the script text to align
 *  against it. `endSec - startSec <= MAX_RUN_SEC` for every chunk except a
 *  degenerate merge (see module doc comment on empty-run merging below). */
export interface FaChunk {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Builds the ordered chunk plan for a forced-alignment run: `computeFaAnchors`
 * (unmodified) supplies the audio-time windows, this function attributes each
 * window's TEXT via segment-`startTime` membership (see module doc comment).
 *
 * Preconditions (caller's responsibility, matching `App.tsx`'s existing
 * `__faDevAlign` guards): `segments.length > 0`, `tokens.length > 0`. Returns
 * `[]` only in the degenerate case where no segment has non-empty text.
 */
export function computeFaChunkPlan(
  segments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
): FaChunk[] {
  // Mirrors whisperService.ts's extractSegmentAlignments `tokenWords`
  // expansion: a Whisper token may canonicalize to multiple (or zero) words.
  const tokenWords: Array<{ word: string; tokenIdx: number }> = [];
  for (let i = 0; i < tokens.length; i++) {
    for (const word of normalize(tokens[i]!.text)) {
      if (word.length > 0) tokenWords.push({ word, tokenIdx: i });
    }
  }

  // Mirrors extractSegmentAlignments's `queryWords` construction — every
  // segment's scene-doc-normalized words, concatenated in segment order.
  const queryWords: string[] = [];
  for (const seg of segments) {
    const words = seg.text && seg.text.trim() ? normalizeSceneDoc(seg.text) : [];
    for (const w of words) if (w.length > 0) queryWords.push(w);
  }

  const subjectWords = tokenWords.map(t => t.word);
  const subjectTokenIdx = tokenWords.map(t => t.tokenIdx);
  const alignment = alignQueryToSubject(queryWords, subjectWords);

  const { runs } = computeFaAnchors(alignment, tokens, silences, audioDuration, subjectTokenIdx);
  if (runs.length === 0) return [];

  // Attribute each segment's raw text (unnormalized — Rust's own
  // `normalize_for_forced_alignment` handles that, same convention the
  // existing single-pass `FaSegmentInput.text` already uses) to exactly one
  // run, by a single forward two-pointer scan: both `segments` (Model P) and
  // `runs` (faAnchors' I1/I2) are gapless, monotonic partitions of
  // `[0, audioDuration)`, so `startTime` is non-decreasing across `segments`
  // and `windowEnd` is non-decreasing across `runs` — no per-segment search.
  const textsByRun: string[][] = runs.map(() => []);
  let runIdx = 0;
  for (const seg of segments) {
    if (!seg.text || !seg.text.trim()) continue;
    while (runIdx < runs.length - 1 && seg.startTime >= runs[runIdx]!.windowEnd) runIdx++;
    textsByRun[runIdx]!.push(seg.text);
  }

  // A run can end up with NO owning segment (e.g. one segment's own
  // `startTime` precedes a run that a later, force-split boundary carved out
  // of that same segment's span) — merge its audio window into an adjacent
  // chunk that DOES have text rather than ever sending Rust an empty-text
  // chunk (which `text_to_token_ids` would reject as `EmptyTokenization`).
  // Prefer extending the previous chunk forward; an empty run before any
  // chunk has been emitted instead defers its own `startSec` onto the next
  // chunk that does have text.
  const chunks: FaChunk[] = [];
  let pendingStart: number | undefined;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    const text = textsByRun[i]!.join(' ');
    if (text.length === 0) {
      if (chunks.length > 0) {
        chunks[chunks.length - 1]!.endSec = run.windowEnd;
      } else {
        pendingStart = pendingStart ?? run.windowStart;
      }
      continue;
    }
    chunks.push({ startSec: pendingStart ?? run.windowStart, endSec: run.windowEnd, text });
    pendingStart = undefined;
  }

  return chunks;
}
