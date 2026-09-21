/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * syncMatchAsync.ts — async, worker-backed entry points for the DEFAULT
 * Whisper-timing matcher (WS2 Wave 2 Group 2, item 2).
 *
 * `computeRunContext`'s async twin (`computeRunContextAsync`) lives in
 * `faChunkPlan.ts` itself and only runs when FA is on (off by default,
 * `FA_PROJECT_DEFAULT_ON`). `extractSegmentAlignments` (`whisperService.ts`)
 * is the OTHER full-length `alignQueryToSubject` call site the freeze-risk
 * finding (`docs/ws1-sync-pipeline/final-shape-mapping-2026-09-18.md` §M3.6)
 * names, and it runs on EVERY sync via `alignScenestoTranscript` ->
 * `useWhisper.ts`'s `alignSegmentsFromCachedTranscript` — the actual default
 * path most projects hit. Both call sites needed a worker-backed entry point
 * for "the app stays responsive during a 1000-scene match" to hold in
 * general, not just for FA-opted-in projects (operator ruling, G2 "worker
 * scope" question).
 *
 * This file is deliberately separate from `whisperService.ts`: it depends on
 * both `whisperService.ts` (the sync functions + types) and
 * `hirschbergMatchClient.ts` (the worker wrapper, which itself imports
 * `alignQueryToSubject` FROM `whisperService.ts`) — putting the async twins
 * inside `whisperService.ts` would create a two-file import cycle
 * (`whisperService.ts` -> `hirschbergMatchClient.ts` -> `whisperService.ts`).
 * This file sits one level above both, so the dependency graph stays a DAG.
 */

import type { AlignmentLanguageCode, SegmentAlignment } from './whisperService';
import type { TranscriptToken, VideoSegment } from '../types';
import type { SilenceInterval } from './silenceDetector';
import { applyNeighborAnchorOverride, buildSegmentAlignmentInputs, extractSegmentAlignments } from './whisperService';
import { alignQueryToSubjectAsync } from './hirschbergMatchClient';

/**
 * Async, worker-backed twin of `extractSegmentAlignments`. Builds the exact
 * same `queryWords`/`subjectWords` via `buildSegmentAlignmentInputs`, runs
 * the Hirschberg pass off the main thread, then delegates every remaining
 * line of `extractSegmentAlignments` (unchanged) via its
 * `precomputedMatchedSubjectOf` parameter — so the two entry points cannot
 * diverge in anything but which `alignQueryToSubject` call ran.
 *
 * `signal`, aborted before dispatch or mid-flight, rejects with
 * `MatchCancelledError` (from `hirschbergMatchClient.ts`) — the caller must
 * treat that as this run's own cancelled outcome, not as "zero alignments."
 */
export async function extractSegmentAlignmentsAsync(
  segments: VideoSegment[],
  tokens: TranscriptToken[],
  audioDuration?: number,
  languageCode?: AlignmentLanguageCode,
  signal?: AbortSignal,
): Promise<SegmentAlignment[]> {
  if (!tokens.length || !segments.length) {
    return extractSegmentAlignments(segments, tokens, audioDuration, languageCode);
  }
  const { queryWords, subjectWords } = buildSegmentAlignmentInputs(segments, tokens, languageCode);
  const alignment = await alignQueryToSubjectAsync(queryWords, subjectWords, undefined, signal);
  return extractSegmentAlignments(segments, tokens, audioDuration, languageCode, alignment.matchedSubjectOf);
}

/**
 * Async, worker-backed twin of `alignScenestoTranscript` — the function
 * `useWhisper.ts`'s `alignSegmentsFromCachedTranscript` calls on every sync.
 * Mirrors `alignScenestoTranscript`'s own body exactly (empty-input
 * short-circuit, then `extractSegmentAlignments` + `applyNeighborAnchorOverride`),
 * substituting `extractSegmentAlignmentsAsync` for the sync call — no other
 * logic differs, so output is byte-identical for the same inputs.
 *
 * `silences` is accepted, unused, for signature parity with
 * `alignScenestoTranscript` (which itself does not read it either — see that
 * function's own signature).
 */
export async function alignScenestoTranscriptAsync(
  segments: VideoSegment[],
  tokens: TranscriptToken[],
  silences: SilenceInterval[] = [],
  audioDuration?: number,
  languageCode?: AlignmentLanguageCode,
  signal?: AbortSignal,
): Promise<SegmentAlignment[]> {
  if (!tokens.length || !segments.length) {
    return segments.map(() => ({
      t0: 0, t1: 0, firstTokenIdx: -1, lastTokenIdx: -1,
      confidence: 0, matched: false, matchedWords: 0, totalWords: 0, longestRun: 0,
    }));
  }

  const results = await extractSegmentAlignmentsAsync(segments, tokens, audioDuration, languageCode, signal);
  return applyNeighborAnchorOverride(results, segments, tokens);
}
