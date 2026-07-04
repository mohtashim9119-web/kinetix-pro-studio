import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./videoDemuxer', () => ({
  getOrCreateDemux: vi.fn(),
}));

import { getOrCreateDemux } from './videoDemuxer';
import { VideoDecoderPool, findChunkRange } from './videoDecoderPool';

// --- findChunkRange (pure logic) ---------------------------------------------

describe('findChunkRange', () => {
  const chunks = [
    { timestamp: 0, type: 'key' },
    { timestamp: 100_000, type: 'delta' },
    { timestamp: 200_000, type: 'key' },
    { timestamp: 300_000, type: 'delta' },
    { timestamp: 400_000, type: 'key' },
  ] as unknown as EncodedVideoChunk[];

  it('backs the start index up to the nearest preceding keyframe', () => {
    const { startIndex } = findChunkRange(chunks, 0.25, 0.35);
    expect(startIndex).toBe(2); // keyframe at 200ms, the last key <= 250ms
  });

  it('starts at index 0 when the target precedes every chunk', () => {
    const { startIndex } = findChunkRange(chunks, 0, 0.05);
    expect(startIndex).toBe(0);
  });

  it('includes one chunk of margin past endSec', () => {
    const { endIndex } = findChunkRange(chunks, 0, 0.15); // endSec=150ms
    expect(endIndex).toBe(2); // first chunk beyond 150ms (200ms) included as margin
  });

  it('clamps endIndex to the last chunk when nothing exceeds endSec', () => {
    const { endIndex } = findChunkRange(chunks, 0, 10);
    expect(endIndex).toBe(chunks.length - 1);
  });

  it('returns an empty range for an empty chunk list', () => {
    expect(findChunkRange([], 0, 1)).toEqual({ startIndex: 0, endIndex: -1 });
  });
});

// --- VideoDecoderPool ---------------------------------------------------------

class MockVideoFrame {
  timestamp: number;
  closed = false;
  constructor(timestamp: number) {
    this.timestamp = timestamp;
  }
  close(): void {
    this.closed = true;
  }
}

class MockVideoDecoder {
  static instances: MockVideoDecoder[] = [];
  outputCb: (frame: MockVideoFrame) => void;
  errorCb: (e: Error) => void;
  configureCalls: unknown[] = [];
  decodeCalls: { timestamp: number }[] = [];
  closed = false;

  constructor(init: { output: (frame: MockVideoFrame) => void; error: (e: Error) => void }) {
    this.outputCb = init.output;
    this.errorCb = init.error;
    MockVideoDecoder.instances.push(this);
  }
  configure(config: unknown): void {
    this.configureCalls.push(config);
  }
  decode(chunk: { timestamp: number }): void {
    this.decodeCalls.push(chunk);
  }
  async flush(): Promise<void> {
    // Real VideoDecoder output-order == presentation order (Phase 0 spike
    // confirmed this on both Chromium and WKWebView); the fed chunks in
    // these tests are already presentation-ordered, so emitting output in
    // feed order is a faithful simplification.
    for (const chunk of this.decodeCalls) this.outputCb(new MockVideoFrame(chunk.timestamp));
  }
  close(): void {
    this.closed = true;
  }
}

function makeDemuxed(chunkTimestampsUs: number[]) {
  return {
    config: { codec: 'avc1.640020', codedWidth: 1280, codedHeight: 720, description: new Uint8Array() },
    chunks: chunkTimestampsUs.map((ts, i) => ({
      type: i === 0 ? 'key' : 'delta',
      timestamp: ts,
      duration: 33_333,
      data: new Uint8Array(),
    })),
    durationSec: (chunkTimestampsUs.at(-1) ?? 0) / 1e6 + 0.033,
  };
}

beforeEach(() => {
  MockVideoDecoder.instances = [];
  vi.stubGlobal('VideoDecoder', MockVideoDecoder);
  (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VideoDecoderPool', () => {
  it('returns null for a segment with no session', async () => {
    const pool = new VideoDecoderPool();
    expect(await pool.getFrameAt('nope', 0)).toBeNull();
  });

  it('decodes chunks and returns the frame at-or-before the requested time', async () => {
    const demuxed = makeDemuxed([0, 33_333, 66_667, 100_000]); // ~30fps, 0..100ms
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg1', 'blob:v1', 0, 0.1);

    const frame = await pool.getFrameAt('seg1', 0.05); // 50ms -> nearest at-or-before is 33.3ms
    expect(frame?.timestamp).toBe(33_333);
  });

  it('closes every buffered frame it supersedes, but keeps the currently displayed one open', async () => {
    const demuxed = makeDemuxed([0, 33_333, 66_667, 100_000]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg1', 'blob:v1', 0, 0.1);

    const frame1 = (await pool.getFrameAt('seg1', 0.05)) as unknown as MockVideoFrame;
    expect(frame1.closed).toBe(false);

    const frame2 = (await pool.getFrameAt('seg1', 0.08)) as unknown as MockVideoFrame;
    expect(frame1.closed).toBe(true); // superseded by frame2 — closed immediately
    expect(frame2.closed).toBe(false); // still the displayed frame
  });

  it('closes the displayed frame and the decoder on releaseSession', async () => {
    const demuxed = makeDemuxed([0, 33_333]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg1', 'blob:v1', 0, 0.05);
    const frame = (await pool.getFrameAt('seg1', 0.033)) as unknown as MockVideoFrame;
    const decoderInstance = MockVideoDecoder.instances[0]!;

    pool.releaseSession('seg1');

    expect(frame.closed).toBe(true);
    expect(decoderInstance.closed).toBe(true);
    expect(pool.hasSession('seg1')).toBe(false);
  });

  it('dispose releases every active session', async () => {
    const demuxed = makeDemuxed([0, 33_333]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg1', 'blob:v1', 0, 0.05);
    await pool.ensureSession('seg2', 'blob:v2', 0, 0.05);
    expect(pool.activeSegmentIds().sort()).toEqual(['seg1', 'seg2']);

    pool.dispose();

    expect(pool.activeSegmentIds()).toEqual([]);
    expect(MockVideoDecoder.instances.every((d) => d.closed)).toBe(true);
  });

  it('ensureSession is idempotent for an unchanged range — reuses the same decoder', async () => {
    const demuxed = makeDemuxed([0, 33_333]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg1', 'blob:v1', 0, 0.05);
    await pool.ensureSession('seg1', 'blob:v1', 0, 0.05);

    expect(MockVideoDecoder.instances).toHaveLength(1);
  });

  it('starting a new session for the same segmentId with a different range replaces (and closes) the old one', async () => {
    const demuxed = makeDemuxed([0, 33_333, 66_667]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg1', 'blob:v1', 0, 0.033);
    const firstDecoder = MockVideoDecoder.instances[0]!;

    await pool.ensureSession('seg1', 'blob:v1', 0, 0.066);

    expect(firstDecoder.closed).toBe(true);
    expect(MockVideoDecoder.instances).toHaveLength(2);
  });
});
