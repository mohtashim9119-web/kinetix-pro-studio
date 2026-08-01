/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Pipeline Contract Program (docs/sync-pipeline-contract-plan.md) — per-pair
// contract validators. Each is a PURE function: given a stage handoff's data,
// it returns the violations found, never mutates, never throws, never
// short-circuits the pipeline (§3 Step 3's "zero behavior change" rule —
// deleting every call site leaves the pipeline's output segments/timing
// byte-identical; additional log entries are the one sanctioned behavioral
// delta). This file starts with Contract 1→2 (Transcription → Normalization);
// later pairs add their own validateNtoM alongside it.
import type { TranscriptToken, VideoSegment } from '../types';
import type { TokenDrop, SegmentAlignment } from './whisperService';
import type { SilenceInterval } from './silenceDetector';
import type { WaveformSource } from './waveformPeaks';
import { computeBoundarySearchWindow, boundaryUsedFallback } from './snapBoundaries';
import { findQuietestRegion } from './boundaryQuality';
import {
  DROP_CLUSTERING_WINDOW_SEC,
  DROP_CLUSTERING_RATIO_THRESHOLD,
  DROP_CLUSTERING_MIN_DROPS,
  BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR,
  BOUNDARY_QUALITY_MIN_DISTANCE_SEC,
} from './syncConstants';

/** One contract violation — shared shape across every pair's validator (§3
 *  Step 3). `severity` and `detail` feed a SyncLogEntry at the wiring call
 *  site; `detail` is for the log only, never for control flow. */
export interface ContractViolation {
  contract: '1->2' | '2->3' | '3->4' | '4->5' | '5->6' | '6->7';
  rule: string;
  severity: 'warning' | 'error';
  /** User-facing description of what was found — no internal vocabulary
   *  (§4 c3 rubric: no `firstTokenIdx`/`Hirschberg`/etc. in prose; that
   *  belongs in `detail`). */
  message: string;
  /** User-facing description of what the user can do about it (§4: "every
   *  WARNING and every ERROR carries a user-facing fix hint"). */
  fixHint: string;
  detail?: Record<string, unknown>;
}

/**
 * Estimates a dropped token's position in seconds for bucketing purposes.
 * Three tiers, in order:
 *   1. The drop's own `startSec`, when it's a usable (finite, non-negative)
 *      timestamp — the common case (e.g. a `past-audio-end` or
 *      `empty-text` drop still carries a real, usable start time).
 *   2. The nearest OTHER drop (by raw pre-filter `index` proximity) whose
 *      own `startSec` is usable — a corrupted stretch tends to drop several
 *      adjacent raw-array tokens together, so a neighboring drop's real
 *      timestamp is a far better estimate than guessing from array position
 *      alone (a `non-finite`-reason drop has no usable `startSec` of its own).
 *   3. Last resort, when NO drop in the set has a usable timestamp: assume
 *      roughly uniform token density and place it proportionally by its raw
 *      index — the same graceful-degradation philosophy
 *      `filterMalformedTokens` itself uses when `audioDuration` is unusable
 *      (degrade the estimate rather than discarding the whole check).
 */
function estimateDropTimeSec(
  drops: readonly TokenDrop[],
  dropIdx: number,
  totalTokens: number,
  audioDuration: number,
): number {
  const own = drops[dropIdx]!;
  if (Number.isFinite(own.startSec) && own.startSec >= 0) return own.startSec;

  let bestDelta = Infinity;
  let bestSec: number | undefined;
  for (const d of drops) {
    if (!Number.isFinite(d.startSec) || d.startSec < 0) continue;
    const delta = Math.abs(d.index - own.index);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestSec = d.startSec;
    }
  }
  if (bestSec !== undefined) return bestSec;

  return totalTokens > 0 ? (own.index / totalTokens) * audioDuration : 0;
}

/**
 * Contract 1→2, Risk R1 (docs/sync-pipeline-contract-plan.md §5) — a dropped-
 * token COUNT was already logged (`buildMalformedTokenEntry`); its
 * DISTRIBUTION was not. Drops spread evenly across a long transcript are
 * noise; drops clustered in one stretch are a corrupted region that will
 * misplace a nearby boundary. Buckets every drop into a fixed
 * `DROP_CLUSTERING_WINDOW_SEC` window by estimated time and flags the
 * single worst-offending window when it holds more than
 * `DROP_CLUSTERING_RATIO_THRESHOLD` of all drops — skipped entirely below
 * `DROP_CLUSTERING_MIN_DROPS` (a tiny drop count clearing the ratio on pure
 * sample noise, e.g. 2 of 3, tells you nothing) or when `audioDuration`
 * isn't a usable positive finite number (no window boundary is meaningful
 * without it).
 */
export function analyzeDropDistribution(
  drops: TokenDrop[],
  totalTokens: number,
  audioDuration: number,
): ContractViolation[] {
  if (drops.length < DROP_CLUSTERING_MIN_DROPS) return [];
  if (!Number.isFinite(audioDuration) || audioDuration <= 0) return [];

  const windowCounts = new Map<number, number>();
  for (let i = 0; i < drops.length; i++) {
    const sec = estimateDropTimeSec(drops, i, totalTokens, audioDuration);
    const windowIndex = Math.max(0, Math.floor(sec / DROP_CLUSTERING_WINDOW_SEC));
    windowCounts.set(windowIndex, (windowCounts.get(windowIndex) ?? 0) + 1);
  }

  let worstWindowIndex = -1;
  let worstCount = 0;
  for (const [windowIndex, count] of windowCounts) {
    if (count > worstCount) {
      worstWindowIndex = windowIndex;
      worstCount = count;
    }
  }

  const totalDrops = drops.length;
  if (worstWindowIndex < 0 || worstCount / totalDrops <= DROP_CLUSTERING_RATIO_THRESHOLD) return [];

  const windowStart = worstWindowIndex * DROP_CLUSTERING_WINDOW_SEC;
  const windowEnd = windowStart + DROP_CLUSTERING_WINDOW_SEC;
  const percent = Math.round((worstCount / totalDrops) * 100);

  return [{
    contract: '1->2',
    rule: 'drop-clustering',
    severity: 'warning',
    message: `${worstCount} of ${totalDrops} unusable transcript timestamps (${percent}%) are clustered between ${windowStart}s and ${windowEnd}s of the audio.`,
    fixHint: `Check the audio between ${windowStart}s and ${windowEnd}s — that stretch may be corrupted, silent, or in an unsupported format. Try re-exporting or re-recording it.`,
    detail: { windowStart, windowEnd, dropsInWindow: worstCount, totalDrops },
  }];
}

/**
 * Contract 1→2, assumption 5 (docs/sync-pipeline-contract-plan.md §2) —
 * nothing checks that the filtered token array stays in ascending time
 * order. `fillsTokenGapWithinSpan` (snapBoundaries.ts) walks `j → j+1`
 * assuming ascending order; a single inversion silently breaks that walk's
 * assumption. Linear pass over the KEPT (post-`filterMalformedTokens`)
 * array; reports at most ONE violation per run, naming the first inversion
 * and the total count.
 */
export function validateTokenOrdering(tokens: readonly TranscriptToken[]): ContractViolation[] {
  let firstInversionIndex = -1;
  let inversionCount = 0;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i]!.startSec > tokens[i + 1]!.startSec) {
      if (firstInversionIndex === -1) firstInversionIndex = i;
      inversionCount++;
    }
  }
  if (inversionCount === 0) return [];

  return [{
    contract: '1->2',
    rule: 'token-ordering',
    severity: 'warning',
    message: `${inversionCount} transcript timestamp(s) were out of chronological order.`,
    fixHint: 'The transcription timestamps were out of order — try re-transcribing or re-exporting the audio.',
    detail: { firstInversionIndex, inversionCount },
  }];
}

/**
 * Contract 1→2 (Transcription → Normalization) validator. Runs both rules
 * above and returns the combined list — empty array is a clean pass. Pure,
 * no side effects, no logging; the caller decides what to do with the
 * result (App.tsx's Apply Sync path, useWhisper.ts's staging path).
 */
export function validate1to2(
  keptTokens: TranscriptToken[],
  drops: TokenDrop[],
  totalTokens: number,
  audioDuration: number,
): ContractViolation[] {
  return [
    ...analyzeDropDistribution(drops, totalTokens, audioDuration),
    ...validateTokenOrdering(keptTokens),
  ];
}

// ---------------------------------------------------------------------------
// Contract 5→6 (Boundary Snapping → Finalization) — boundary-quality checker
// (waveform-watcher program, Phase 1). Read-only measurement: nothing here
// ever moves a boundary or touches `snapCoveredBoundaries`'s output. It asks
// one question per adjacent covered pair — "did this boundary fall back to
// the plain spoken-edge midpoint, and if so, does the ACTUAL audio at that
// moment look like a real quiet gap or like ongoing speech?" — using the
// waveform peaks already built for the timeline's own display.
// ---------------------------------------------------------------------------

/** One pair's boundary-quality measurement — the full data set, whether or
 *  not it crossed the flagging ratio. `'report-all'` mode returns these
 *  directly (calibration); the default mode filters to `flagged` ones and
 *  maps them to `ContractViolation[]`. */
export interface BoundaryQualityMeasurement {
  /** Index into `segments` of the pair's FIRST (earlier) segment — the
   *  boundary sits between `segments[segmentIndex]` and
   *  `segments[segmentIndex + 1]`. */
  segmentIndex: number;
  boundaryTime: number;
  boundaryAmplitude: number;
  quietestTime: number | undefined;
  quietestAmplitude: number | undefined;
  windowStart: number;
  windowEnd: number;
  flagged: boolean;
}

function clampIndex(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Boundary-quality checker. `segments`/`alignments` are index-parallel — the
 * SAME contract `snapCoveredBoundaries` depends on (Contract 4→5, assumption
 * 3) — and `tokens`/`silences` must be the exact arrays that produced
 * `segments`' committed boundaries (the malformed-filtered token array and
 * the detected silences), or the recomputed search windows will not match
 * what `snapCoveredBoundaries` actually saw.
 *
 * Per adjacent pair (i, i+1), mirroring `snapCoveredBoundaries`'s own guard:
 * a pair with either segment locked, or missing/sentinel (`-1`) alignment
 * data, is skipped outright — there is no meaningful "fallback vs. silence"
 * question for a boundary that function never moved either.
 *
 * Only FALLBACK boundaries (`boundaryUsedFallback` — `snapBoundaries.ts`)
 * are measured: a boundary that landed in a real detected silence is
 * already acoustic ground truth and is not this checker's concern. For each
 * fallback pair, `findQuietestRegion` (`boundaryQuality.ts`) locates the
 * quietest `sustainedWindowSec`-wide span anywhere in the pair's own search
 * window; the committed boundary is flagged when its own waveform amplitude
 * exceeds that quietest span's mean amplitude by more than `k`×.
 *
 * Returns `[]` immediately when `waveformSource` is `null` — there is no
 * amplitude data to measure against, in either mode.
 *
 * `mode: 'report-all'` (calibration use — the dev console harness in
 * App.tsx) returns a `BoundaryQualityMeasurement` for EVERY fallback pair,
 * flagged or not, instead of filtering to violations, so a calibration
 * sweep can see the whole distribution.
 *
 * Pure; exported for direct unit testing.
 */
export function validateBoundaryQuality(
  segments: VideoSegment[],
  alignments: SegmentAlignment[],
  tokens: TranscriptToken[],
  silences: SilenceInterval[],
  waveformSource: WaveformSource | null,
  k: number,
  sustainedWindowSec: number,
  mode?: 'violations',
): ContractViolation[];
export function validateBoundaryQuality(
  segments: VideoSegment[],
  alignments: SegmentAlignment[],
  tokens: TranscriptToken[],
  silences: SilenceInterval[],
  waveformSource: WaveformSource | null,
  k: number,
  sustainedWindowSec: number,
  mode: 'report-all',
): BoundaryQualityMeasurement[];
export function validateBoundaryQuality(
  segments: VideoSegment[],
  alignments: SegmentAlignment[],
  tokens: TranscriptToken[],
  silences: SilenceInterval[],
  waveformSource: WaveformSource | null,
  k: number,
  sustainedWindowSec: number,
  mode: 'violations' | 'report-all' = 'violations',
): ContractViolation[] | BoundaryQualityMeasurement[] {
  if (!waveformSource) return [];

  const measurements: BoundaryQualityMeasurement[] = [];

  for (let i = 0; i < segments.length - 1; i++) {
    const curr = segments[i];
    const next = segments[i + 1];
    const currAlign = alignments[i];
    const nextAlign = alignments[i + 1];
    if (!curr || !next || curr.locked || next.locked || !currAlign || !nextAlign) continue;
    if (currAlign.firstTokenIdx < 0 || currAlign.lastTokenIdx < 0) continue;
    if (nextAlign.firstTokenIdx < 0 || nextAlign.lastTokenIdx < 0) continue;

    const lastSpokenEnd = tokens[currAlign.lastTokenIdx]?.endSec;
    const nextSpokenStart = tokens[nextAlign.firstTokenIdx]?.startSec;
    const currFirstSpokenStart = tokens[currAlign.firstTokenIdx]?.startSec;
    const nextLastSpokenEnd = tokens[nextAlign.lastTokenIdx]?.endSec;
    if (
      lastSpokenEnd === undefined || nextSpokenStart === undefined ||
      currFirstSpokenStart === undefined || nextLastSpokenEnd === undefined
    ) continue;

    const window = computeBoundarySearchWindow(
      lastSpokenEnd, nextSpokenStart, currFirstSpokenStart, nextLastSpokenEnd,
    );

    const usedFallback = boundaryUsedFallback(
      tokens, silences, window,
      currAlign.firstTokenIdx, currAlign.lastTokenIdx,
      nextAlign.firstTokenIdx, nextAlign.lastTokenIdx,
    );
    if (!usedFallback) continue;

    // The pair's actual committed boundary — contiguity (Contract 5→6
    // guarantee 3) means next.startTime IS curr.startTime + curr.duration.
    const boundaryTime = next.startTime;
    const boundaryCol = clampIndex(
      Math.round(boundaryTime * waveformSource.peaksPerSecond), 0, waveformSource.peaks.length - 1,
    );
    const boundaryAmplitude = waveformSource.peaks[boundaryCol] ?? 0;

    const quietest = findQuietestRegion(
      waveformSource.peaks, waveformSource.peaksPerSecond,
      window.searchStart, window.searchEnd, sustainedWindowSec,
    );

    const distance = quietest.found && quietest.time !== undefined
      ? Math.abs(boundaryTime - quietest.time)
      : undefined;

    const flagged = quietest.found && quietest.meanAmplitude !== undefined && distance !== undefined
      ? boundaryAmplitude >= BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR &&
        distance >= BOUNDARY_QUALITY_MIN_DISTANCE_SEC &&
        boundaryAmplitude > k * quietest.meanAmplitude
      : false;

    measurements.push({
      segmentIndex: i,
      boundaryTime,
      boundaryAmplitude,
      quietestTime: quietest.time,
      quietestAmplitude: quietest.meanAmplitude,
      windowStart: window.searchStart,
      windowEnd: window.searchEnd,
      flagged,
    });
  }

  if (mode === 'report-all') return measurements;

  return measurements.filter(m => m.flagged).map((m): ContractViolation => ({
    contract: '5->6',
    rule: 'loud-fallback-boundary',
    severity: 'warning',
    message: `The cut between segment ${m.segmentIndex + 1} and segment ${m.segmentIndex + 2} landed on audio that's still playing, not in a quiet gap.`,
    fixHint: `Check the cut between segment ${m.segmentIndex + 1} and segment ${m.segmentIndex + 2} on the timeline — nudge it toward the quieter moment nearby if it looks or sounds off.`,
    detail: {
      segmentIndex: m.segmentIndex,
      boundaryTime: m.boundaryTime,
      boundaryAmplitude: m.boundaryAmplitude,
      quietestTime: m.quietestTime,
      quietestAmplitude: m.quietestAmplitude,
      windowStart: m.windowStart,
      windowEnd: m.windowEnd,
    },
  }));
}
