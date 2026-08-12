/**
 * faBoundaryTypes.ts — `faWordSpansToTranscriptTokens` reshape (WS1 Task 5
 * Slice D9). This module has no live caller yet (type-only IPC mirror, per
 * its own header comment) — these are the only exercise its reshape
 * function gets today.
 */

import { describe, it, expect } from 'vitest';
import { faWordSpansToTranscriptTokens, type FaWordSpan } from './faBoundaryTypes';

function word(text: string, startSec: number, endSec: number, confidence: number): FaWordSpan {
  return { word: text, startSec, endSec, confidence };
}

describe('faWordSpansToTranscriptTokens', () => {
  it('produces exactly the TranscriptToken shape extractSegmentAlignments consumes', () => {
    const tokens = faWordSpansToTranscriptTokens([word('hello', 0.1, 0.4, 0.95)]);
    expect(tokens).toEqual([{ startSec: 0.1, endSec: 0.4, text: 'hello', confidence: 0.95 }]);
  });

  it('preserves input ordering', () => {
    const tokens = faWordSpansToTranscriptTokens([
      word('deep', 0.0, 0.3, 0.99),
      word('night', 0.3, 0.7, 0.98),
      word('falls', 0.7, 1.1, 0.5),
    ]);
    expect(tokens.map((t) => t.text)).toEqual(['deep', 'night', 'falls']);
    expect(tokens.map((t) => t.startSec)).toEqual([0.0, 0.3, 0.7]);
    expect(tokens.map((t) => t.endSec)).toEqual([0.3, 0.7, 1.1]);
  });

  it('carries confidence through unchanged, including a low-confidence value', () => {
    const tokens = faWordSpansToTranscriptTokens([
      word('sure', 0.0, 0.2, 0.9999),
      word('mumble', 0.2, 0.5, 0.12),
    ]);
    expect(tokens[0]?.confidence).toBe(0.9999);
    expect(tokens[1]?.confidence).toBe(0.12);
  });

  it('returns an empty array for empty input', () => {
    expect(faWordSpansToTranscriptTokens([])).toEqual([]);
  });
});
