/**
 * No unbounded decode wait in PREVIEW either: a pool session whose decoder
 * goes silent (configure + decode accepted, no output, no error — the Windows
 * spot-decode stall shape) stops waiting within DECODE_STALL_BOUND_MS, names
 * the segment and asset in one typed line, and frees the stuck decoder.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./videoDemuxer', () => ({
  getOrCreateDemux: vi.fn(),
}));

import { getOrCreateDemux } from './videoDemuxer';
import { VideoDecoderPool, PreviewDecodeStallError, PREVIEW_DECODE_STALL_BOUND_MS } from './videoDecoderPool';

class SilentDecoder {
  static instances: SilentDecoder[] = [];
  closed = false;
  constructor(_init: unknown) {
    SilentDecoder.instances.push(this);
  }
  configure(): void {}
  decode(): void {}
  flush(): Promise<void> {
    return new Promise(() => {});
  }
  reset(): void {}
  close(): void {
    this.closed = true;
  }
}

const FRAME_US = Math.round(1e6 / 24);

beforeEach(() => {
  vi.useFakeTimers();
  SilentDecoder.instances = [];
  vi.stubGlobal('VideoDecoder', SilentDecoder);
  vi.mocked(getOrCreateDemux).mockResolvedValue({
    config: { codec: 'avc1.640020', codedWidth: 1440, codedHeight: 816, description: new Uint8Array() },
    chunks: Array.from({ length: 84 }, (_, i) => ({
      type: i % 48 === 0 ? 'key' : 'delta',
      timestamp: i * FRAME_US,
      duration: FRAME_US,
      data: new Uint8Array(),
    })) as unknown as EncodedVideoChunk[],
    durationSec: 3.5,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('preview decode stall bound', () => {
  it('uses the export bound (4000 ms)', () => {
    expect(PREVIEW_DECODE_STALL_BOUND_MS).toBe(4000);
  });

  it('a silent decoder settles getFrameAt within the bound, logs one typed line naming segment + asset, and frees the decoder', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = new VideoDecoderPool();
    // Production calls ensureSession fire-and-forget (useWebCodecsPreview);
    // its seeding wait is bounded too and rejects typed.
    const ready = pool.ensureSession('seg-7', 'asset://avatar-02.mp4', 0, 3.5).then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(0);
    const settled = pool.getFrameAt('seg-7', 1.0);
    let done = false;
    void settled.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(PREVIEW_DECODE_STALL_BOUND_MS - 100);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await settled).toBeNull();
    expect(await ready).toBeInstanceOf(PreviewDecodeStallError);

    const lines = warn.mock.calls.map((c) => String(c[0]));
    const line = lines.find((l) => l.includes('preview_decode_stalled'));
    expect(line).toBeDefined();
    expect(line).toContain('segment seg-7');
    expect(line).toContain('asset://avatar-02.mp4');
    expect(SilentDecoder.instances[0]!.closed).toBe(true);
    expect(pool.hasSession('seg-7')).toBe(false);
  });

  it('the typed error carries segment id, asset url and the wait', () => {
    const e = new PreviewDecodeStallError('seg-7', 'asset://a.mp4', 4001);
    expect(e.segmentId).toBe('seg-7');
    expect(e.assetUrl).toBe('asset://a.mp4');
    expect(e.waitedMs).toBe(4001);
    expect(e.message).toContain('preview_decode_stalled');
  });
});
