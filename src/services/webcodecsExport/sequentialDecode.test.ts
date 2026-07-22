import { describe, it, expect } from 'vitest';
import { estimateFrameCount } from './sequentialDecode';

// estimateFrameCount is the one piece of new, decoder-free logic in
// sequentialDecode.ts — everything else in that file drives a real
// VideoDecoder, which this repo's vitest environment cannot provide (no
// jsdom/happy-dom WebCodecs implementation, and Node's own WebCodecs is not
// the target runtime). See sequentialDecode.ts's own doc comment for why
// this is a thin wrapper over findChunkRange (already exhaustively tested
// in videoDecoderPool.test.ts) rather than a re-implementation of keyframe
// lookup.

function chunk(timestamp: number, type: 'key' | 'delta' = 'delta'): EncodedVideoChunk {
  return { timestamp, type } as unknown as EncodedVideoChunk;
}

describe('estimateFrameCount', () => {
  const chunks = [
    chunk(0, 'key'),
    chunk(100_000, 'delta'),
    chunk(200_000, 'key'),
    chunk(300_000, 'delta'),
    chunk(400_000, 'key'),
    chunk(500_000, 'delta'),
  ];

  it('counts samples whose timestamp falls within [startSec, endSec)', () => {
    // 0s-0.3s => chunks at 0, 100ms, 200ms are in range; 300ms is excluded (endSec is exclusive)
    expect(estimateFrameCount(chunks, 0, 0.3)).toBe(3);
  });

  it('does not over-count the keyframe-preroll margin chunk findChunkRange includes past endSec', () => {
    // findChunkRange(0, 0.15) includes chunk index 2 (200ms) as reorder
    // margin past endSec=150ms, but that chunk's timestamp (200ms) is not
    // itself inside [0, 150ms) — it must not be counted as an expected frame.
    expect(estimateFrameCount(chunks, 0, 0.15)).toBe(2); // 0ms, 100ms only
  });

  it('excludes samples before startSec even when the keyframe backing the range precedes it', () => {
    // findChunkRange(0.25, 0.35) backs startIndex up to the keyframe at
    // 200ms (index 2), but 200ms itself is before startSec=250ms and must
    // not be counted.
    expect(estimateFrameCount(chunks, 0.25, 0.35)).toBe(1); // 300ms only
  });

  it('returns 0 for an empty chunk list', () => {
    expect(estimateFrameCount([], 0, 1)).toBe(0);
  });

  it('returns 0 when the range is entirely past the last chunk', () => {
    expect(estimateFrameCount(chunks, 10, 20)).toBe(0);
  });

  it('counts every sample when the range spans the whole asset', () => {
    expect(estimateFrameCount(chunks, 0, 10)).toBe(chunks.length);
  });
});
