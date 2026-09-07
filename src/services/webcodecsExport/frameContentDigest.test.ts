import { describe, expect, it } from 'vitest';
import { FrameContentDigest, type FrameLike } from './frameContentDigest';

/** Stand-in for a VideoFrame: copyTo fills the destination with fixed pixels. */
function frame(fill: Uint8Array): FrameLike {
  return {
    allocationSize: () => fill.byteLength,
    copyTo: async (dest: Uint8Array) => {
      dest.set(fill);
      return [];
    },
  };
}

function px(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

async function digestOf(frames: Uint8Array[]): Promise<string> {
  const d = new FrameContentDigest();
  for (const f of frames) await d.add(frame(f));
  return d.digestHex();
}

describe('FrameContentDigest', () => {
  it('is stable across two independent folds of the same frames', async () => {
    const frames = [px(1, 2, 3, 4), px(5, 6, 7, 8), px(9, 10, 11, 12)];
    expect(await digestOf(frames)).toBe(await digestOf(frames));
  });

  it('moves when a single byte of one frame changes', async () => {
    const a = [px(1, 2, 3, 4), px(5, 6, 7, 8), px(9, 10, 11, 12)];
    const b = [px(1, 2, 3, 4), px(5, 6, 7, 9), px(9, 10, 11, 12)];
    expect(await digestOf(a)).not.toBe(await digestOf(b));
  });

  it('is order-sensitive — the same frames in a different order differ', async () => {
    const a = [px(1, 1, 1, 1), px(2, 2, 2, 2)];
    const b = [px(2, 2, 2, 2), px(1, 1, 1, 1)];
    expect(await digestOf(a)).not.toBe(await digestOf(b));
  });

  it('distinguishes a dropped frame from a full sequence', async () => {
    const full = [px(1, 1, 1, 1), px(2, 2, 2, 2), px(3, 3, 3, 3)];
    const dropped = [px(1, 1, 1, 1), px(3, 3, 3, 3)];
    expect(await digestOf(full)).not.toBe(await digestOf(dropped));
  });

  it('counts frames and starts from a fixed empty fold', async () => {
    const d = new FrameContentDigest();
    expect(d.frameCount).toBe(0);
    expect(d.digestHex()).toBe('0'.repeat(64));
    await d.add(frame(px(7, 7, 7, 7)));
    expect(d.frameCount).toBe(1);
    expect(d.digestHex()).not.toBe('0'.repeat(64));
  });

  it('reuses its buffer across equal-sized frames without leaking prior content', async () => {
    // Two frames of equal size: the second must not inherit the first's bytes.
    const viaShared = await digestOf([px(1, 2, 3, 4), px(0, 0, 0, 0)]);
    const viaFresh = await digestOf([px(9, 9, 9, 9), px(0, 0, 0, 0)]);
    expect(viaShared).not.toBe(viaFresh);
  });
});
