import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/videoDemuxer', () => ({
  getOrCreateDemux: vi.fn(),
}));

import { getOrCreateDemux } from '../services/videoDemuxer';
import { VideoDecoderPool } from '../services/videoDecoderPool';
import {
  isWebCodecsPreviewEnabled,
  releaseAllPreviewSessions,
} from './useWebCodecsPreview';
import { estimateFrameBytes } from '../services/previewBufferBudget';

class MockVideoFrame {
  static instances: MockVideoFrame[] = [];
  timestamp: number;
  closed = false;
  constructor(timestamp: number) {
    this.timestamp = timestamp;
    MockVideoFrame.instances.push(this);
  }
  close(): void {
    this.closed = true;
  }
}

class MockVideoDecoder {
  static instances: MockVideoDecoder[] = [];
  outputCb: (frame: MockVideoFrame) => void;
  constructor(init: { output: (frame: MockVideoFrame) => void; error: (e: Error) => void }) {
    this.outputCb = init.output;
    MockVideoDecoder.instances.push(this);
  }
  configure(): void {}
  decode(chunk: { timestamp: number; type: string }): void {
    this.outputCb(new MockVideoFrame(chunk.timestamp));
  }
  async flush(): Promise<void> {}
  reset(): void {}
  close(): void {}
}

function make1080p120Demuxed(totalFrames = 600) {
  const frameDurUs = Math.round(1e6 / 120);
  return {
    config: {
      codec: 'avc1.640020',
      codedWidth: 1920,
      codedHeight: 1080,
      description: new Uint8Array(),
    },
    chunks: Array.from({ length: totalFrames }, (_, i) => ({
      type: i === 0 ? 'key' : 'delta',
      timestamp: i * frameDurUs,
      duration: frameDurUs,
      data: new Uint8Array(),
    })),
    durationSec: (totalFrames * frameDurUs) / 1e6,
  };
}

describe('isWebCodecsPreviewEnabled', () => {
  it('is true only when capability is on and export is not running', () => {
    expect(isWebCodecsPreviewEnabled(true, false)).toBe(true);
    expect(isWebCodecsPreviewEnabled(true, true)).toBe(false);
    expect(isWebCodecsPreviewEnabled(false, false)).toBe(false);
    expect(isWebCodecsPreviewEnabled(false, true)).toBe(false);
  });
});

describe('useWebCodecsPreview export release (pool harness)', () => {
  beforeEach(() => {
    MockVideoFrame.instances = [];
    MockVideoDecoder.instances = [];
    vi.stubGlobal('VideoFrame', MockVideoFrame);
    vi.stubGlobal('VideoDecoder', MockVideoDecoder);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(make1080p120Demuxed());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function warmPool(): Promise<VideoDecoderPool> {
    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg', 'blob:v', 0, 5, 0);
    await pool.getFrameAt('seg', 0);
    expect(pool.activeSegmentIds()).toContain('seg');
    expect(pool.getBufferedBytes()).toBeGreaterThan(0);
    return pool;
  }

  it('releaseAllPreviewSessions drops every live session on export start', async () => {
    const pool = await warmPool();
    const bytesBefore = pool.getBufferedBytes();
    const peakLive = MockVideoFrame.instances.filter((f) => !f.closed).length;
    expect(bytesBefore).toBeGreaterThan(0);

    releaseAllPreviewSessions(pool);

    expect(pool.activeSegmentIds()).toEqual([]);
    expect(pool.getBufferedBytes()).toBe(0);
    expect(MockVideoFrame.instances.every((f) => f.closed)).toBe(true);
    expect(peakLive).toBeGreaterThan(0);
    pool.dispose();
  });

  it('releaseAllPreviewSessions on export failure/cancel clears buffered bytes', async () => {
    const pool = await warmPool();
    const bytesBefore = pool.getBufferedBytes();

    releaseAllPreviewSessions(pool);

    expect(bytesBefore).toBeGreaterThan(0);
    expect(pool.getBufferedBytes()).toBe(0);
    pool.dispose();
  });

  it('re-warm after export end restores a live session without leaking prior frames', async () => {
    const pool = await warmPool();
    releaseAllPreviewSessions(pool);
    const closedCount = MockVideoFrame.instances.filter((f) => f.closed).length;

    await pool.ensureSession('seg', 'blob:v', 0, 5, 0);
    await pool.getFrameAt('seg', 0);

    expect(pool.activeSegmentIds()).toContain('seg');
    expect(pool.getBufferedBytes()).toBeGreaterThan(0);
    expect(MockVideoFrame.instances.filter((f) => !f.closed).length).toBeGreaterThan(0);
    expect(MockVideoFrame.instances.filter((f) => f.closed).length).toBe(closedCount);

    pool.dispose();
    expect(MockVideoFrame.instances.every((f) => f.closed)).toBe(true);
  });

  it('measures ~712 MiB released for one warm 1080p120 session', async () => {
    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg', 'blob:v', 0, 5, 0);
    let peakBytes = 0;
    for (let target = 0; target <= 2.0; target += 1 / 120) {
      await pool.getFrameAt('seg', target);
      peakBytes = Math.max(peakBytes, pool.getBufferedBytes());
    }
    const frameBytes = estimateFrameBytes(1920, 1080);
    expect(peakBytes % frameBytes).toBe(0);
    // Full 2.0 s window = 240 frames; displayedFrame may add one live slot.
    expect(peakBytes).toBeGreaterThanOrEqual(746_496_000);
    expect(peakBytes).toBeLessThanOrEqual(746_496_000 + frameBytes);

    const bytesReleased = peakBytes;
    releaseAllPreviewSessions(pool);

    expect(bytesReleased).toBeGreaterThanOrEqual(746_496_000);
    expect(bytesReleased).toBeLessThanOrEqual(746_496_000 + frameBytes);
    expect(pool.getBufferedBytes()).toBe(0);
    pool.dispose();
  });

  it('destructive probe: skipping the export gate leaves buffered bytes live', async () => {
    const pool = await warmPool();
    const bytesBefore = pool.getBufferedBytes();
    expect(isWebCodecsPreviewEnabled(true, true)).toBe(false);
    // Simulate the bug: export running but release NOT called.
    if (isWebCodecsPreviewEnabled(true, true)) {
      releaseAllPreviewSessions(pool);
    }
    expect(pool.getBufferedBytes()).toBe(bytesBefore);
    expect(pool.activeSegmentIds()).toContain('seg');
    pool.dispose();
  });
});
