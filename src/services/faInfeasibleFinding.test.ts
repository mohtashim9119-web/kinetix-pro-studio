/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  estimatedTokensInInfeasibleChunks,
  infeasibleChunkSpan,
  INFEASIBLE_COPY,
} from './faInfeasibleFinding';
import type { TranscriptToken } from '../types';

const tok = (
  text: string,
  startSec: number,
  endSec: number,
  needsReview?: boolean,
): TranscriptToken => ({ text, startSec, endSec, needsReview });

describe('FA word-token needsReview consumers (plan-v3 item 6)', () => {
  const chunks = [
    { chunkIndex: 4, startSec: 18.08, endSec: 18.70, wordCount: 13 },
    { chunkIndex: 52, startSec: 405.58, endSec: 406.98, wordCount: 12 },
  ];

  it('reads TranscriptToken.needsReview — not HeadingOverlay.needsReview — and only inside infeasible windows', () => {
    const tokens = [
      tok('because', 18.10, 18.20, true),
      tok('later', 20.00, 20.20, true),
      tok('ok', 18.30, 18.40, false),
      tok('far', 405.60, 405.80, true),
    ];
    const estimated = estimatedTokensInInfeasibleChunks(tokens, chunks);
    expect(estimated.map((t) => t.text)).toEqual(['because', 'far']);
  });

  it('span covers every affected chunk, not each chunk separately', () => {
    const span = infeasibleChunkSpan(chunks);
    expect(span).toEqual({ startSec: 18.08, endSec: 406.98 });
  });

  it('INFEASIBLE_COPY is the single swappable block', () => {
    expect(INFEASIBLE_COPY.estimatedFlag).toBe('Estimated');
    expect(INFEASIBLE_COPY.groupedFinding(2, 18.08, 406.98, 4)).toContain('2 alignment chunks');
  });
});
