import { describe, it, expect } from 'vitest';
import { digestEncodedOutput, firstChunkMismatch } from './annexbChunkCompare';

function chunk(bytes: number[], timestamp: number, keyframe = false): { bytes: Uint8Array; timestamp: number; keyframe: boolean } {
  return { bytes: new Uint8Array(bytes), timestamp, keyframe };
}

describe('annexb chunk comparator', () => {
  it('identical chunk lists produce the same piece hash and no mismatch', async () => {
    const chunks = [chunk([1, 2, 3], 0, true), chunk([4, 5], 33_333)];
    const a = await digestEncodedOutput(chunks);
    const b = await digestEncodedOutput(chunks);
    expect(a.pieceSha256).toBe(b.pieceSha256);
    expect(a.chunkCount).toBe(2);
    expect(a.keyframeCount).toBe(1);
    expect(a.encodedBytes).toBe(5);
    expect(firstChunkMismatch(a.chunks, b.chunks)).toBeNull();
  });

  it('a one-frame content shift reports the first differing chunk index and timestamp', async () => {
    const base = [chunk([10, 20, 30], 0, true), chunk([40, 50, 60], 33_333), chunk([70, 80], 66_666)];
    const shifted = [chunk([10, 20, 30], 0, true), chunk([40, 51, 60], 33_333), chunk([70, 80], 66_666)];
    const a = await digestEncodedOutput(base);
    const b = await digestEncodedOutput(shifted);
    expect(a.pieceSha256).not.toBe(b.pieceSha256);
    expect(firstChunkMismatch(a.chunks, b.chunks)).toEqual({ index: 1, timestamp: 33_333 });
  });
});
