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
import type { TranscriptToken } from '../types';
import type { TokenDrop } from './whisperService';
import {
  DROP_CLUSTERING_WINDOW_SEC,
  DROP_CLUSTERING_RATIO_THRESHOLD,
  DROP_CLUSTERING_MIN_DROPS,
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
