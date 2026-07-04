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

// --- Phase 3: getFrameAt early-coverage resolution -----------------------------
//
// docs/webcodecs-architecture-plan.md's audio-sync hardening phase. Every test
// above awaits `ensureSession` fully before calling `getFrameAt`, so the mock
// decoder's `flush()` (which emits every frame synchronously) has always
// already completed by the time a frame is requested — that path is unchanged
// by the Phase 3 fix and continues to pass unmodified above.
//
// The tests below simulate the case those tests can't reach: a decode still
// in flight (flush() not yet resolved) when getFrameAt is called — exactly
// what a rapid, short-segment (~1.09-1.3s) boundary crossing produces if the
// decode-ahead session for the next segment hasn't finished by the time
// playback reaches it. `ControllableVideoDecoder` lets a test drive `output`
// events and `flush()` resolution independently and by hand.

class ControllableVideoDecoder {
  static instances: ControllableVideoDecoder[] = [];
  outputCb: (frame: MockVideoFrame) => void;
  errorCb: (e: Error) => void;
  decodeCalls: { timestamp: number }[] = [];
  closed = false;
  private flushResolvers: Array<() => void> = [];

  constructor(init: { output: (frame: MockVideoFrame) => void; error: (e: Error) => void }) {
    this.outputCb = init.output;
    this.errorCb = init.error;
    ControllableVideoDecoder.instances.push(this);
  }
  configure(): void {}
  decode(chunk: { timestamp: number }): void {
    this.decodeCalls.push(chunk);
  }
  flush(): Promise<void> {
    return new Promise((resolve) => this.flushResolvers.push(resolve));
  }
  close(): void {
    this.closed = true;
  }
  /** Test-only: emit one decoded frame at `timestampUs`, as the real decoder's
   *  output callback would as decode progresses (before flush() settles). */
  emit(timestampUs: number): void {
    this.outputCb(new MockVideoFrame(timestampUs));
  }
  /** Test-only: settle flush() — simulates the session finishing decode. */
  resolveFlush(): void {
    const resolvers = this.flushResolvers;
    this.flushResolvers = [];
    for (const r of resolvers) r();
  }
}

describe('VideoDecoderPool — getFrameAt resolves without waiting for the full session (Phase 3)', () => {
  beforeEach(() => {
    ControllableVideoDecoder.instances = [];
    vi.stubGlobal('VideoDecoder', ControllableVideoDecoder);
  });

  it('resolves as soon as a frame past the target has been emitted, without flush() ever completing', async () => {
    const demuxed = makeDemuxed([0, 33_333, 66_667, 100_000]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    const readyPromise = pool.ensureSession('seg1', 'blob:v1', 0, 0.1);
    await Promise.resolve(); // let startSession run up to (but not past) flush()

    const decoder = ControllableVideoDecoder.instances[0]!;
    // Only the first two of four expected frames have arrived so far — the
    // rest of this (would-be) very short segment's decode is still pending.
    decoder.emit(0);
    decoder.emit(33_333);

    // Target 0.02s is fully answerable from what's already buffered (33ms >
    // 20ms confirms 0ms is the correct "latest at-or-before" pick) — this
    // must resolve without decoder.flush() ever settling. If it doesn't,
    // this test hangs and fails on the default timeout, which is exactly
    // the pre-fix "freeze for the whole remaining decode" behavior.
    const frame = await pool.getFrameAt('seg1', 0.02);
    expect(frame?.timestamp).toBe(0);

    // Clean up — let the session finish so nothing is left dangling.
    decoder.resolveFlush();
    await readyPromise;
  });

  it('still waits for more frames (or session settlement) when the target is beyond everything buffered so far', async () => {
    const demuxed = makeDemuxed([0, 33_333, 66_667, 100_000]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    const readyPromise = pool.ensureSession('seg1', 'blob:v1', 0, 0.1);
    await Promise.resolve();

    const decoder = ControllableVideoDecoder.instances[0]!;
    decoder.emit(0);

    let resolved = false;
    const framePromise = pool.getFrameAt('seg1', 0.09).then((f) => {
      resolved = true;
      return f;
    });

    // Give microtasks a chance to run — must NOT have resolved yet, since no
    // frame past 0.09s (90ms) has arrived and the session hasn't settled.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Now let the rest of the frames arrive and the session finish — this is
    // what unblocks the still-pending request.
    decoder.emit(66_667);
    decoder.emit(100_000);
    decoder.resolveFlush();

    const frame = await framePromise;
    expect(resolved).toBe(true);
    expect(frame?.timestamp).toBe(66_667);
    await readyPromise;
  });

  it('releaseSession settles any pending getFrameAt call instead of leaving it hanging (fast boundary crossing evicts a still-decoding "next" session)', async () => {
    const demuxed = makeDemuxed([0, 33_333, 66_667, 100_000]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    pool.ensureSession('seg1', 'blob:v1', 0, 0.1);
    await Promise.resolve();

    // No frames have arrived at all yet — this segment never even became
    // "current" long enough to buffer anything before playback moved past it.
    const framePromise = pool.getFrameAt('seg1', 0.09);
    pool.releaseSession('seg1');

    const frame = await framePromise;
    expect(frame).toBeNull();
  });

  it('a frame emitted exactly at the target does not resolve until a strictly-later frame confirms no closer match is still coming', async () => {
    const demuxed = makeDemuxed([0, 33_333, 66_667]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    const readyPromise = pool.ensureSession('seg1', 'blob:v1', 0, 0.1);
    await Promise.resolve();

    const decoder = ControllableVideoDecoder.instances[0]!;
    decoder.emit(33_333); // exactly the target, in seconds: 0.033333...

    let resolved = false;
    const framePromise = pool.getFrameAt('seg1', 33_333 / 1e6).then((f) => {
      resolved = true;
      return f;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    decoder.emit(66_667); // strictly past the target — now the answer is certain
    const frame = await framePromise;
    expect(resolved).toBe(true);
    expect(frame?.timestamp).toBe(33_333);

    decoder.resolveFlush();
    await readyPromise;
  });
});
