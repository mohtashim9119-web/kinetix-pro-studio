/**
 * faBoundaryTypes.ts — `faWordSpansToTranscriptTokens` reshape (WS1 Task 5
 * Slice D9). This module has no live caller yet (type-only IPC mirror, per
 * its own header comment) — these are the only exercise its reshape
 * function gets today.
 */

import { describe, it, expect } from 'vitest';
import { faWordSpansToTranscriptTokens, type FaWordSpan } from './faBoundaryTypes';
import { CONF_MIN } from './syncConstants';

// `needsReview` defaults to the same `confidence < CONF_MIN` compare `fa.rs`'s
// `word_span_to_dto` performs, so existing call sites that don't care about
// it stay realistic without touching every call site (WS1 Task 5 Slice D19).
function word(
  text: string,
  startSec: number,
  endSec: number,
  confidence: number,
  wordIndex: number,
  needsReview: boolean = confidence < CONF_MIN,
): FaWordSpan {
  return { word: text, startSec, endSec, confidence, wordIndex, needsReview };
}

describe('faWordSpansToTranscriptTokens', () => {
  it('produces exactly the TranscriptToken shape extractSegmentAlignments consumes', () => {
    const tokens = faWordSpansToTranscriptTokens([word('hello', 0.1, 0.4, 0.95, 0)]);
    expect(tokens).toEqual([
      { startSec: 0.1, endSec: 0.4, text: 'hello', confidence: 0.95, wordIndex: 0, needsReview: false },
    ]);
  });

  it('preserves input ordering', () => {
    const tokens = faWordSpansToTranscriptTokens([
      word('deep', 0.0, 0.3, 0.99, 0),
      word('night', 0.3, 0.7, 0.98, 1),
      word('falls', 0.7, 1.1, 0.5, 2),
    ]);
    expect(tokens.map((t) => t.text)).toEqual(['deep', 'night', 'falls']);
    expect(tokens.map((t) => t.startSec)).toEqual([0.0, 0.3, 0.7]);
    expect(tokens.map((t) => t.endSec)).toEqual([0.3, 0.7, 1.1]);
  });

  it('carries confidence through unchanged, including a low-confidence value', () => {
    const tokens = faWordSpansToTranscriptTokens([
      word('sure', 0.0, 0.2, 0.9999, 0),
      word('mumble', 0.2, 0.5, 0.12, 1),
    ]);
    expect(tokens[0]?.confidence).toBe(0.9999);
    expect(tokens[1]?.confidence).toBe(0.12);
  });

  it('returns an empty array for empty input', () => {
    expect(faWordSpansToTranscriptTokens([])).toEqual([]);
  });

  // -- wordIndex (WS1 Task 5 Slice D18) ---------------------------------

  it('carries wordIndex through unchanged, as the join key back to the script', () => {
    const tokens = faWordSpansToTranscriptTokens([
      word('the', 0.0, 0.2, 0.9, 0),
      word('quick', 0.2, 0.5, 0.9, 1),
      word('brown', 0.5, 0.8, 0.9, 2),
      word('fox', 0.8, 1.0, 0.9, 3),
    ]);
    expect(tokens.map((t) => t.wordIndex)).toEqual([0, 1, 2, 3]);
  });

  it('does not require wordIndex to equal array position — it is carried, never re-derived', () => {
    // A two-chunk run's stitched output can start a later word's index well
    // past its own position in a SHORTER re-sliced array (e.g. a per-segment
    // slice of the full word list) — the reshape must pass the index
    // through verbatim, not recompute it from array position.
    const tokens = faWordSpansToTranscriptTokens([
      word('brown', 0.0, 0.3, 0.9, 42),
      word('fox', 0.3, 0.6, 0.9, 43),
    ]);
    expect(tokens.map((t) => t.wordIndex)).toEqual([42, 43]);
  });

  // -- needsReview (WS1 Task 5 Slice D19, R.7) --------------------------

  it('carries needsReview through unchanged, both true and false', () => {
    const tokens = faWordSpansToTranscriptTokens([
      word('confident', 0.0, 0.3, 0.9, 0, false),
      word('mumbled', 0.3, 0.6, 0.1, 1, true),
    ]);
    expect(tokens.map((t) => t.needsReview)).toEqual([false, true]);
  });

  it('does not re-derive needsReview from confidence — it is carried, never recomputed', () => {
    // A word marked needsReview=false despite a low confidence (or vice
    // versa) must still pass through as given — the reshape is a straight
    // carry, the actual CONF_MIN compare is Rust's `word_span_to_dto`'s job,
    // not this function's.
    const tokens = faWordSpansToTranscriptTokens([word('odd', 0.0, 0.2, 0.05, 0, false)]);
    expect(tokens[0]?.needsReview).toBe(false);
  });
});
