/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// plan-v3 Wave 1 item 6 — CTC-infeasible chunks: estimated-flag consumers
// and the ONE grouped finding for the run.
//
// ALL OPERATOR-FACING COPY LIVES IN ONE BLOCK (`INFEASIBLE_COPY`) FOR
// SIGN-OFF, same shape as SyncPausedDialog's `PAUSE_COPY`. Placeholder-
// quality wording, deliberately swappable without touching any other line.
//
// `HeadingOverlay.needsReview` is a different live field. This module reads
// ONLY `TranscriptToken.needsReview` (the FA word-token flag).
// ---------------------------------------------------------------------------

import type { TranscriptToken } from '../types';
import type { FaInfeasibleChunk } from './faBoundaryTypes';

export const INFEASIBLE_COPY = {
  /** Timeline / scene chip — the estimated flag's appearance. */
  estimatedFlag: 'Estimated',
  estimatedHint: 'Some words in this scene used placeholder timing — the aligner could not fit them in their audio window.',
  /**
   * The ONE grouped sync-log finding for the run. `count` is infeasible
   * chunks (not words). `spanStartSec`/`spanEndSec` are the min start and
   * max end of those chunks.
   */
  groupedFinding: (count: number, spanStartSec: number, spanEndSec: number, estimatedWordCount: number): string =>
    count === 1
      ? `1 alignment chunk (${spanStartSec.toFixed(2)}–${spanEndSec.toFixed(2)}s) could not be timed precisely — ${estimatedWordCount} word${estimatedWordCount === 1 ? '' : 's'} marked Estimated.`
      : `${count} alignment chunks (${spanStartSec.toFixed(2)}–${spanEndSec.toFixed(2)}s) could not be timed precisely — ${estimatedWordCount} words marked Estimated.`,
  fixHint: 'Review the Estimated scenes. Re-run Apply Sync after tightening those scene tags, or accept the placeholder timing.',
} as const;

/** First real consumer of FA word-token `needsReview`: words flagged for
 *  review whose span overlaps an infeasible chunk window. */
export function estimatedTokensInInfeasibleChunks(
  tokens: readonly TranscriptToken[],
  chunks: readonly FaInfeasibleChunk[],
): TranscriptToken[] {
  if (chunks.length === 0) return [];
  return tokens.filter((t) => {
    if (t.needsReview !== true) return false;
    return chunks.some((c) => t.startSec < c.endSec && t.endSec > c.startSec);
  });
}

export function infeasibleChunkSpan(
  chunks: readonly FaInfeasibleChunk[],
): { startSec: number; endSec: number } | undefined {
  if (chunks.length === 0) return undefined;
  let startSec = chunks[0]!.startSec;
  let endSec = chunks[0]!.endSec;
  for (const c of chunks) {
    if (c.startSec < startSec) startSec = c.startSec;
    if (c.endSec > endSec) endSec = c.endSec;
  }
  return { startSec, endSec };
}
