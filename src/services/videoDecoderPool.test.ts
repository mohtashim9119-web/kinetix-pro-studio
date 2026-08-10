import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./videoDemuxer', () => ({
  getOrCreateDemux: vi.fn(),
}));

import { getOrCreateDemux } from './videoDemuxer';
import { VideoDecoderPool, findChunkRange } from './videoDecoderPool';

/** Builds a chunk list in DECODE order, timestamped by PRESENTATION time,
 *  reproducing the real inversion pattern `videoDemuxer.ts` produces for a
 *  B-frame source: within each GOP, the key frame decodes first (cts ==
 *  GOP base), a P-frame decodes second but displays LAST in the GOP (cts ==
 *  GOP base + (framesPerGop-1) frames — jumps ahead), and the B-frames that
 *  follow it in decode order display BEFORE it (cts strictly lower than the
 *  P-frame's own cts) — the actual inversion. Mirrors WS3 Stage 3's live
 *  instrumentation finding (119 inversions / 240 chunks on a real 10s clip). */
function makeReorderedChunks(numGops: number, framesPerGop: number, fps = 30): EncodedVideoChunk[] {
  const frameDurUs = Math.round(1e6 / fps);
  const chunks: { type: string; timestamp: number; duration: number; data: Uint8Array }[] = [];
  for (let g = 0; g < numGops; g++) {
    const gopBaseUs = g * framesPerGop * frameDurUs;
    chunks.push({ type: 'key', timestamp: gopBaseUs, duration: frameDurUs, data: new Uint8Array() });
    if (framesPerGop > 1) {
      chunks.push({ type: 'delta', timestamp: gopBaseUs + (framesPerGop - 1) * frameDurUs, duration: frameDurUs, data: new Uint8Array() });
      for (let i = 1; i < framesPerGop - 1; i++) {
        chunks.push({ type: 'delta', timestamp: gopBaseUs + i * frameDurUs, duration: frameDurUs, data: new Uint8Array() });
      }
    }
  }
  return chunks as unknown as EncodedVideoChunk[];
}

/** Otherwise-monotonic multi-GOP chunks with ONE early, non-keyframe sample's
 *  timestamp spiked far ahead — matching the live-instrumentation trace's
 *  exact shape (Part A/Stage 4: `firstInversionIndex: 2` on a real 10s clip).
 *  This is the fixture that actually discriminates the fix:
 *  `makeReorderedChunks`'s PER-GOP pattern
 *  above, verified by directly reverting the source and re-running, does
 *  NOT trip the pre-fix algorithm's early break for a target in the LAST
 *  GOP (each GOP's own spike stays below a large target until the scan is
 *  already inside the correct GOP) — an early spike large enough to exceed
 *  the target on its own does. */
function makeChunksWithEarlyInversion(numGops: number, framesPerGop: number, fps = 30): EncodedVideoChunk[] {
  const frameDurUs = Math.round(1e6 / fps);
  const totalChunks = numGops * framesPerGop;
  const chunks = Array.from({ length: totalChunks }, (_, i) => ({
    type: i % framesPerGop === 0 ? 'key' : 'delta',
    timestamp: i * frameDurUs,
    duration: frameDurUs,
    data: new Uint8Array(),
  }));
  if (chunks.length > 1) {
    chunks[1]!.timestamp = (totalChunks - 2) * frameDurUs; // spike near the very end
  }
  return chunks as unknown as EncodedVideoChunk[];
}

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

  // Non-regression check against a REALISTIC per-GOP B-frame reordering
  // pattern (`makeReorderedChunks`) — every GOP's own decode-order-ahead
  // P-frame is present, so this is genuine, expected reordering, not a
  // contrived edge case. Note: verified (by directly reverting the source
  // and re-running) that this specific fixture does NOT actually trip the
  // pre-fix bug for this target — each GOP's own reorder spike stays below
  // 9.6144s until the scan is already inside the correct (last) GOP, so the
  // old naive algorithm happens to still land correctly here. Kept as a
  // sanity check that the fix doesn't regress ordinary reordering; the
  // actually-discriminating regression is the test below.
  it('resolves the correct keyframe for a deep target on a realistically-reordered clip', () => {
    const chunks = makeReorderedChunks(5, 60, 30); // 5 GOPs x 2s = 10s clip
    const { startIndex } = findChunkRange(chunks, 9.6144, 10);
    // The last GOP starts at index 240 (4 * 60 frames * 33_333us/frame,
    // Math.round(1e6/30) — 7_999_920us, not an exact 8.0s given the integer
    // rounding) — the correct answer.
    expect(startIndex).toBe(240);
    expect(chunks[startIndex]!.timestamp).toBe(7_999_920);
    expect(chunks[startIndex]!.type).toBe('key');
  });

  it('does not regress on a target at the very start of a reordered clip', () => {
    const chunks = makeReorderedChunks(5, 60, 30);
    const { startIndex } = findChunkRange(chunks, 0, 2);
    expect(startIndex).toBe(0);
    expect(chunks[0]!.timestamp).toBe(0);
  });

  // WS3 Stage 3/4 regression, ACTUALLY discriminating (Part A): live
  // instrumentation on a real 10s clip recorded
  // `firstInversionIndex: 2` — a single early, non-keyframe sample whose
  // presentation timestamp spikes far ahead of its decode-order position.
  // Reproduces exactly that shape. Verified to fail against the pre-fix
  // source (resolves to index 0 / 0s — the "stale early frame" class of
  // symptom) and pass with the fix (keyframe-only scanning ignores the
  // non-keyframe spike entirely).
  it('resolves the correct keyframe for a deep target despite an early non-keyframe timestamp spike', () => {
    const chunks = makeChunksWithEarlyInversion(5, 60, 30); // 5 GOPs x 2s = 10s clip
    const { startIndex } = findChunkRange(chunks, 9.6144, 10);
    expect(startIndex).toBe(240);
    expect(chunks[startIndex]!.timestamp).toBe(7_999_920);
    expect(chunks[startIndex]!.type).toBe('key');
  });
});

// --- VideoDecoderPool ---------------------------------------------------------

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
  errorCb: (e: Error) => void;
  configureCalls: unknown[] = [];
  totalDecodedCount = 0; // cumulative across this instance's whole lifetime, never cleared
  resetCalls = 0;
  closed = false;
  /** True immediately after configure()/flush()/reset() — mirrors the real
   *  VideoDecoder's "a key frame is required after configure() or flush()"
   *  constraint (confirmed directly against a real Chromium decoder — see
   *  docs/webcodecs-architecture-plan.md's Phase 4+6/5 tracker entry). This
   *  used to be entirely unenforced here, which is exactly why the
   *  production windowed-decode-ahead model's old every-batch-flushes
   *  design could pass this whole suite while throwing on a real decoder —
   *  the actual gap this phase closes. */
  private needsKeyframeNext = true;

  constructor(init: { output: (frame: MockVideoFrame) => void; error: (e: Error) => void }) {
    this.outputCb = init.output;
    this.errorCb = init.error;
    MockVideoDecoder.instances.push(this);
  }
  configure(config: unknown): void {
    this.configureCalls.push(config);
    this.needsKeyframeNext = true;
  }
  decode(chunk: { timestamp: number; type: string }): void {
    if (this.needsKeyframeNext && chunk.type !== 'key') {
      throw new Error("Failed to execute 'decode' on 'VideoDecoder': A key frame is required after configure() or flush().");
    }
    this.needsKeyframeNext = false;
    this.totalDecodedCount++;
    // Real VideoDecoder output-order == presentation order (Phase 0 spike
    // confirmed this on both Chromium and WKWebView); the fed chunks in
    // these tests are already presentation-ordered, so emitting output
    // immediately is a faithful simplification. This emits on decode()
    // itself, not on flush() — the production windowed model (Phase 4+6/5)
    // no longer flushes routine continuation batches, so a mock that only
    // ever emitted via flush() could never produce output for one; a real
    // decoder's output callback is likewise not gated on flush() at all —
    // flush() is a completion barrier, not what produces output.
    this.outputCb(new MockVideoFrame(chunk.timestamp));
  }
  async flush(): Promise<void> {
    // Real flush() is a completion barrier (decode() above already produced
    // every output) — it also resets the keyframe requirement, mirroring
    // the real decoder demanding the next decode() after a settled flush()
    // be a keyframe.
    this.needsKeyframeNext = true;
  }
  /** Mirrors VideoDecoder.reset() — the real spec discards any pending
   *  decode queue and rejects an in-flight flush(); the decoder becomes
   *  "unconfigured" until the next configure() call, which
   *  videoDecoderPool.ts always makes immediately after resetting. */
  reset(): void {
    this.resetCalls++;
    this.needsKeyframeNext = true;
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

/** Builds a long, evenly-spaced chunk list with a keyframe every `gopSize`
 *  frames — used by the Phase 4+6 windowed-decode/scrub-reset tests below,
 *  which need a segment long enough to exceed WINDOW_AHEAD_SEC (1.5s) many
 *  times over and a real keyframe structure to seek against. */
const FRAME_DUR_US = Math.round(1e6 / 30); // ~33_333us, 30fps
function makeLongDemuxed(totalFrames: number, gopSize = 30) {
  return {
    config: { codec: 'avc1.640020', codedWidth: 1280, codedHeight: 720, description: new Uint8Array() },
    chunks: Array.from({ length: totalFrames }, (_, i) => ({
      type: i % gopSize === 0 ? 'key' : 'delta',
      timestamp: i * FRAME_DUR_US,
      duration: FRAME_DUR_US,
      data: new Uint8Array(),
    })),
    durationSec: (totalFrames * FRAME_DUR_US) / 1e6,
  };
}

beforeEach(() => {
  MockVideoDecoder.instances = [];
  MockVideoFrame.instances = [];
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

  // Behavior deliberately changed by the WS3 sliding-window fix (see that
  // describe block at the bottom of this file). A superseded frame is no
  // longer closed the instant the next getFrameAt call selects past it —
  // frames within RETAIN_BEHIND_SEC (0.5s) of the selection are retained so a
  // short backward nudge doesn't force a re-seek, which on a single-keyframe
  // clip means re-decoding from t=0. The invariant that still holds, and is
  // what this test now pins, is that a frame is closed exactly when it leaves
  // the buffer — never while still reachable, and never left open at teardown.
  it('retains a superseded frame while it is inside the retain-behind tail, and closes it once the tail slides past it', async () => {
    const demuxed = makeDemuxed([0, 33_333, 66_667, 100_000]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg1', 'blob:v1', 0, 0.1);

    const frame1 = (await pool.getFrameAt('seg1', 0.05)) as unknown as MockVideoFrame;
    expect(frame1.closed).toBe(false);

    const frame2 = (await pool.getFrameAt('seg1', 0.08)) as unknown as MockVideoFrame;
    // 33ms apart — well inside the 0.5s retain-behind tail, so frame1 stays
    // open and remains selectable by a backward nudge.
    expect(frame1.closed).toBe(false);
    expect(frame2.closed).toBe(false); // the displayed frame
    expect((await pool.getFrameAt('seg1', 0.05)) as unknown as MockVideoFrame).toBe(frame1);

    // Teardown still closes everything — no frame is leaked by being retained.
    pool.dispose();
    expect(frame1.closed).toBe(true);
    expect(frame2.closed).toBe(true);
  });

  it('closes the displayed frame on releaseSession and parks its decoder for reuse (Phase 4+6)', async () => {
    const demuxed = makeDemuxed([0, 33_333]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg1', 'blob:v1', 0, 0.05);
    const frame = (await pool.getFrameAt('seg1', 0.033)) as unknown as MockVideoFrame;
    const decoderInstance = MockVideoDecoder.instances[0]!;

    pool.releaseSession('seg1');

    expect(frame.closed).toBe(true);
    expect(pool.hasSession('seg1')).toBe(false);
    // Phase 4+6 decoder reuse: a released (non-errored) decoder is reset()
    // and parked in the per-asset idle pool for the next session that needs
    // the same asset, not closed outright — dispose() is what guarantees a
    // final close (see the "dispose" test below).
    expect(decoderInstance.closed).toBe(false);
    expect(decoderInstance.resetCalls).toBe(1);

    // Proves it's genuinely reusable: a new session for the same asset URL
    // picks up this exact instance instead of constructing another.
    await pool.ensureSession('seg2', 'blob:v1', 0, 0.05);
    expect(MockVideoDecoder.instances).toHaveLength(1);
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

  it('does not poison the session cache when startSession rejects — a later ensureSession call for the same segment retries fresh instead of reusing the failed promise', async () => {
    // Regression test for the cold-start black-screen bug: a genuinely cold
    // process can throw on the FIRST-ever handle.decoder.configure() call
    // (e.g. a hardware VideoDecoder/GPU-negotiation race with WebGL2 context
    // creation) — this simulates that with a decoder whose configure()
    // throws exactly once, then succeeds on every later call, mirroring how
    // a warm reopen (same process, GPU/media service already negotiated)
    // succeeds where a cold one didn't.
    const demuxed = makeDemuxed([0, 33_333]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    let configureAttempts = 0;
    class ThrowOnceVideoDecoder extends MockVideoDecoder {
      override configure(config: unknown): void {
        configureAttempts++;
        if (configureAttempts === 1) {
          throw new Error('cold-start configure() failure (simulated)');
        }
        super.configure(config);
      }
    }
    vi.stubGlobal('VideoDecoder', ThrowOnceVideoDecoder);

    const pool = new VideoDecoderPool();

    // First attempt: configure() throws — THIS call must surface the
    // rejection (callers still see the failure on the attempt that made it).
    await expect(pool.ensureSession('seg1', 'blob:v1', 0, 0.05)).rejects.toThrow(
      'cold-start configure() failure',
    );

    // getFrameAt for the now-failed segment must resolve cleanly to null —
    // not hang, and not reject with the stale configure() error. Pre-fix,
    // the poisoned session stayed cached (not closed), so getFrameAt's
    // unguarded `await session.ready` would itself reject here instead of
    // resolving null.
    await expect(pool.getFrameAt('seg1', 0)).resolves.toBeNull();

    // Second ensureSession call for the SAME segment/asset/range — the crux
    // of the fix. Pre-fix, the cache-hit branch would return the SAME
    // rejected promise (configure() never retried, configureAttempts stuck
    // at 1) forever. Post-fix, the failed session was evicted from the
    // cache, so this triggers a genuinely fresh startSession() attempt,
    // which succeeds this time.
    await expect(pool.ensureSession('seg1', 'blob:v1', 0, 0.05)).resolves.toBeUndefined();
    expect(configureAttempts).toBe(2);

    const frame = await pool.getFrameAt('seg1', 0.04);
    expect(frame?.timestamp).toBe(33_333);
  });

  it('starting a new session for the same segmentId with a different range replaces the old one, reusing its decoder (Phase 4+6 decoder reuse)', async () => {
    const demuxed = makeDemuxed([0, 33_333, 66_667]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg1', 'blob:v1', 0, 0.033);
    const firstDecoder = MockVideoDecoder.instances[0]!;

    await pool.ensureSession('seg1', 'blob:v1', 0, 0.066);

    // Phase 4+6: replacing a session for the same asset no longer closes
    // and reconstructs a fresh VideoDecoder — the old session's handle is
    // parked (reset(), not closed) in a per-asset idle pool, and the new
    // session for the SAME asset URL immediately reuses it (Section 4.2's
    // decoder-instance-reuse-by-asset-id requirement).
    expect(firstDecoder.closed).toBe(false);
    expect(firstDecoder.resetCalls).toBeGreaterThan(0);
    expect(MockVideoDecoder.instances).toHaveLength(1);
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
  resetCalls = 0;
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
  /** Mirrors VideoDecoder.reset() settling (not necessarily rejecting, for
   *  simplicity) any pending flush() — the real spec rejects it, and
   *  videoDecoderPool.ts always swallows a flush() rejection
   *  (`.catch(() => {})`), so resolving here is an equally faithful,
   *  simpler simulation for these tests' purposes. */
  reset(): void {
    this.resetCalls++;
    this.decodeCalls = [];
    const resolvers = this.flushResolvers;
    this.flushResolvers = [];
    for (const r of resolvers) r();
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

  // Originally written against the pre-Phase-4+6/5-redesign model, where
  // EVERY feedWindow() batch called flush() and a second call's waiter was
  // woken once that in-flight flush() settled. Rewritten for the redesign
  // (docs/webcodecs-architecture-plan.md): a routine (non-terminal) window
  // extension never calls flush() at all now (see feedWindow/fillWindow/
  // startFeedBatch's own doc comments), so this test no longer manufactures
  // a still-pending flush() — instead it proves the mechanism that actually
  // replaces it: a target beyond the current window's fed frontier still
  // gets the window pushed further (startFeedBatch's furthest-pending-
  // waiter extension), driven purely by real decoder `output` events
  // (ControllableVideoDecoder's manual emit()), never by flush() timing.
  it('a target beyond the current window still gets the window extended, without ever calling flush() for a routine continuation', async () => {
    const demuxed = makeLongDemuxed(180); // 6s @ 30fps — long enough that the first window doesn't cover it all
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    const readyPromise = pool.ensureSession('seg1', 'blob:v1', 0, 6);
    await Promise.resolve(); // let startSession issue its initial (non-terminal) feed batch

    const decoder = ControllableVideoDecoder.instances[0]!;
    // Satisfies ensureSession's own initial fillWindow (target=0) directly
    // via output — this first batch never reaches the session's true end
    // (6s of content remains), so under the redesign it never calls
    // flush() at all; resolveFlush() would settle nothing real for it.
    decoder.emit(0);
    decoder.emit(FRAME_DUR_US);
    await readyPromise;
    const chunksFedByFirstWindow = decoder.decodeCalls.length; // ~46 (~1.5s @ 30fps)

    // A target well beyond the first window's fed frontier (~1.5s), but
    // still within needsReset's "steady playback, not a scrub" tolerance —
    // this must extend the window further rather than reset.
    let resolved = false;
    const framePromise = pool.getFrameAt('seg1', 2.0).then((f) => {
      resolved = true;
      return f;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false); // nothing at/past 2.0s has been emitted yet
    // Proves the window was genuinely extended (real chunks fed beyond the
    // first window) purely from issuing the call above — no flush(), no
    // manual emit() needed to trigger it — the actual point of this test.
    expect(decoder.decodeCalls.length).toBeGreaterThan(chunksFedByFirstWindow);

    decoder.emit(61 * FRAME_DUR_US); // ~2.033s — strictly past the target, confirms nothing closer is still coming

    // Must NOT be hanging — this is the crux of the fix: extension happens
    // without either caller ever needing a flush() to settle.
    await vi.waitFor(() => expect(resolved).toBe(true));
    const frame = await framePromise;
    // getFrameAt picks the latest frame AT OR BEFORE the target — nothing
    // was ever emitted in (0.033s, 2.0s], so 0.033s is still the correct
    // answer; the 2.033s frame's role is only to confirm no closer match is
    // still coming (same "at or before" semantics the pre-existing tests
    // above already pin).
    expect(frame?.timestamp).toBe(FRAME_DUR_US);
    expect(decoder.resetCalls).toBe(0); // recovered by extending the window, not by a scrub-reset

    pool.dispose();
  });
});

// --- Phase 4+6/5 flush-strategy fix: real-decoder keyframe-after-flush() -----
//
// A real Chromium VideoDecoder was confirmed (independently of this pool's
// logic, via a bare configure()/decode()/flush() sequence in a live browser)
// to throw SYNCHRONOUSLY — "A key frame is required after configure() or
// flush()" — the moment decode() is called with a delta (non-key) chunk
// immediately after a flush() has settled. The pre-fix windowed model called
// flush() at the end of EVERY feedWindow() batch, then continued feeding
// from wherever feedCursor was left on the next window extension — almost
// never a keyframe — so every same-session window extension past the first
// hit this on a real decoder. MockVideoDecoder above did not previously
// enforce this constraint at all (that was the actual test-suite gap this
// finding exposed); it now does (see its own comment there), which is what
// makes the first test below a real regression test for the fix, not just
// documentation of it: it would fail immediately (a synchronous throw
// escaping getFrameAt) against the pre-fix feedWindow, and passes now
// because feedWindow no longer flushes between routine continuation
// batches.
describe('VideoDecoderPool — real-decoder keyframe-after-flush() constraint (Phase 4+6/5 fix)', () => {
  it('many same-session window extensions past the first batch never throw on a real-keyframe-enforcing decoder', async () => {
    const demuxed = makeLongDemuxed(180); // 6s @ 30fps, keyframe every 1s — only chunk 0 backs the first window
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg1', 'blob:v1', 0, 6);
    const decoder = MockVideoDecoder.instances[0]!;
    const decodedAfterFirstWindow = decoder.totalDecodedCount;
    expect(decodedAfterFirstWindow).toBeGreaterThan(0); // first window fed fine — starts at chunk 0, a keyframe

    // Every one of these forces a continuation feed past the previous
    // window's frontier — mid-GOP, not at a keyframe — exactly where the
    // pre-fix design called flush() and would have thrown on a real
    // decoder. MockVideoDecoder now enforces that same constraint, so this
    // loop completing without throwing IS the regression test.
    for (const target of [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5]) {
      const frame = await pool.getFrameAt('seg1', target);
      expect(frame).not.toBeNull();
    }

    // Confirms real, ongoing progress happened (not a frozen-on-first-frame
    // silent failure) — every extension actually decoded further chunks.
    expect(decoder.totalDecodedCount).toBeGreaterThan(decodedAfterFirstWindow);
    expect(decoder.resetCalls).toBe(0); // steady forward progress never needs a scrub-reset

    pool.dispose();
  });

  it('a genuinely unexpected decode() error still freezes on the last good frame instead of hanging or looping (secondary safety net)', async () => {
    // feedWindow's try/catch is no longer the primary defense against the
    // keyframe-after-flush case (the redesign above prevents that
    // structurally), but it stays as a last-resort net for a real decoder
    // throwing for an unrelated reason (driver fault, malformed chunk).
    const demuxed = makeLongDemuxed(180);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg1', 'blob:v1', 0, 6);
    const decoder = MockVideoDecoder.instances[0]!;

    const originalDecode = decoder.decode.bind(decoder);
    let thrown = false;
    decoder.decode = (chunk) => {
      if (!thrown) {
        thrown = true;
        throw new Error('simulated unrelated decoder fault');
      }
      originalDecode(chunk);
    };

    const frameAt2s = await pool.getFrameAt('seg1', 2.0);
    expect(frameAt2s).not.toBeNull();

    // A further, later target must resolve immediately (not retry forever)
    // — the busy-loop hazard feedWindow's catch block still guards against.
    const start = Date.now();
    const frameAt5s = await pool.getFrameAt('seg1', 5.0);
    expect(Date.now() - start).toBeLessThan(100); // resolves immediately — no retry loop
    expect(frameAt5s?.timestamp).toBe(frameAt2s?.timestamp); // frozen on the same last-good frame

    pool.dispose();
  });
});

// --- Phase 4+6: windowed decode-ahead, scrub-reset, LRU eviction, reuse -------
//
// docs/webcodecs-architecture-plan.md's combined scrubbing/seeking (Phase 4)
// + frame-cache/eviction-for-scale (Phase 6) rewrite. Uses MockVideoDecoder
// (synchronous flush) throughout, same as the base "VideoDecoderPool"
// describe block above — these tests care about how MANY chunks get fed and
// when a reset happens, not about interleaving with a still-pending flush()
// (that's the Phase 3 describe block's job, unaffected by this rewrite).

describe('VideoDecoderPool — windowed decode-ahead (Phase 6, Section 4.2)', () => {
  it('feeds only the decode-ahead window on ensureSession, not the whole segment, for a long segment', async () => {
    const demuxed = makeLongDemuxed(180); // 6s @ 30fps, keyframe every 1s
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg1', 'blob:v1', 0, 6);
    const decoder = MockVideoDecoder.instances[0]!;

    // WINDOW_AHEAD_SEC=1.5s -> only ~1.5s (≈45 frames) should be fed up
    // front, nowhere near the full 180-frame/6s segment (the Phase 1-3
    // whole-segment-up-front model this replaces would have fed all 180).
    expect(decoder.totalDecodedCount).toBeGreaterThan(0);
    expect(decoder.totalDecodedCount).toBeLessThan(90); // generous margin above 1.5s
  });

  it('extends the window forward as the requested target advances during steady playback, without ever resetting', async () => {
    const demuxed = makeLongDemuxed(180);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg1', 'blob:v1', 0, 6);
    const decoder = MockVideoDecoder.instances[0]!;
    const fedAfterInitialWindow = decoder.totalDecodedCount;

    // Steady forward ticks, each well within the previous tick's window —
    // the normal steady-playback case, not a scrub.
    await pool.getFrameAt('seg1', 1.0);
    await pool.getFrameAt('seg1', 2.0);
    await pool.getFrameAt('seg1', 3.0);

    expect(decoder.totalDecodedCount).toBeGreaterThan(fedAfterInitialWindow); // window kept extending
    expect(decoder.resetCalls).toBe(0); // steady forward progress never needs a scrub-reset
    expect(MockVideoDecoder.instances).toHaveLength(1); // same decoder throughout
  });

  it('resets to the nearest keyframe instead of decoding everything in between, on a large forward jump within the same segment', async () => {
    const demuxed = makeLongDemuxed(180); // 6s, keyframe every 1s (frames 0,30,60,90,120,150)
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg1', 'blob:v1', 0, 6); // initial window covers ~0-1.5s
    const decoder = MockVideoDecoder.instances[0]!;
    const fedBeforeJump = decoder.totalDecodedCount;

    // Jump straight to 5.0s — far beyond the fed-plus-lookahead frontier
    // (~1.5s fed + 1.5s lookahead = 3.0s), so this must be answered by a
    // reset-to-keyframe, not a long forward decode.
    const frame = await pool.getFrameAt('seg1', 5.0);

    expect(decoder.resetCalls).toBe(1);
    expect(frame?.timestamp).toBe(150 * FRAME_DUR_US); // the keyframe backing 5.0s (frame 150)

    const fedForTheJump = decoder.totalDecodedCount - fedBeforeJump;
    // Decoding "everything in between" (1.5s -> 6.5s) would be ~150 frames;
    // a keyframe-anchored reset only needs the new window's worth (~1 GOP).
    expect(fedForTheJump).toBeLessThan(60);
  });

  it('re-seeks correctly on a backward scrub within an already-advanced session, instead of returning a stale later frame', async () => {
    // Pre-Phase-4 bug this fixes: getFrameAt's per-call eviction closes
    // every buffered frame OLDER than the selection (a correct optimization
    // for forward-only playback) — but nothing previously re-seeked when a
    // later scrub asked for a time BEFORE everything remaining in the
    // buffer, so the old code's frames[0] fallback would silently return
    // whatever (later) frame happened to still be buffered.
    const demuxed = makeLongDemuxed(180); // 6s, keyframe every 1s
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg1', 'blob:v1', 0, 6);

    await pool.getFrameAt('seg1', 1.0);
    await pool.getFrameAt('seg1', 2.0);
    const frameAt3 = await pool.getFrameAt('seg1', 3.0);
    expect(frameAt3).not.toBeNull();

    const frameAt0_5 = await pool.getFrameAt('seg1', 0.5);
    expect(frameAt0_5).not.toBeNull();
    expect(frameAt0_5!.timestamp / 1e6).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(frameAt0_5!.timestamp / 1e6).toBeGreaterThan(0.4); // sane — the right neighborhood, not 3.0s's frame
  });

  it('does not share a single decoder between two segments of the same asset that are simultaneously active', async () => {
    const demuxed = makeDemuxed([0, 33_333]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('current', 'blob:shared', 0, 0.033);
    await pool.ensureSession('next', 'blob:shared', 0, 0.033); // same asset, 'current' still active

    // Both need their own decode cursor at once — a shared decoder here
    // would misattribute output between the two sessions.
    expect(MockVideoDecoder.instances).toHaveLength(2);
  });
});

describe('VideoDecoderPool — LRU eviction under a session/frame budget (Phase 6, Section 4.3)', () => {
  it('evicts the least-recently-used session once MAX_CACHED_SESSIONS is exceeded', async () => {
    const demuxed = makeDemuxed([0, 33_333]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('a', 'blob:a', 0, 0.033);
    await pool.ensureSession('b', 'blob:b', 0, 0.033);
    await pool.ensureSession('c', 'blob:c', 0, 0.033);
    expect(pool.activeSegmentIds().sort()).toEqual(['a', 'b', 'c']);

    // MAX_CACHED_SESSIONS=3 (Section 4.3's starting point) — a 4th session
    // forces eviction of 'a', the least-recently-touched.
    await pool.ensureSession('d', 'blob:d', 0, 0.033);

    expect(pool.hasSession('a')).toBe(false);
    expect(pool.activeSegmentIds().sort()).toEqual(['b', 'c', 'd']);
  });

  it('touching an older session (getFrameAt) protects it from being the next LRU victim', async () => {
    const demuxed = makeDemuxed([0, 33_333]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('a', 'blob:a', 0, 0.033);
    await pool.ensureSession('b', 'blob:b', 0, 0.033);
    await pool.getFrameAt('a', 0); // touches 'a' again — now more recent than 'b'
    await pool.ensureSession('c', 'blob:c', 0, 0.033);

    await pool.ensureSession('d', 'blob:d', 0, 0.033); // forces one eviction

    expect(pool.hasSession('b')).toBe(false); // 'b' is now the LRU, not 'a'
    expect(pool.hasSession('a')).toBe(true);
  });

  it('never evicts a protected segment even when it is the least-recently-used', async () => {
    const demuxed = makeDemuxed([0, 33_333]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('a', 'blob:a', 0, 0.033);
    pool.setProtectedIds(['a']); // e.g. 'a' is the current segment
    await pool.ensureSession('b', 'blob:b', 0, 0.033);
    await pool.ensureSession('c', 'blob:c', 0, 0.033);
    await pool.ensureSession('d', 'blob:d', 0, 0.033); // would evict 'a' as LRU if it weren't protected

    expect(pool.hasSession('a')).toBe(true);
    expect(pool.hasSession('b')).toBe(false); // 'b' is the LRU among the non-protected
    expect(pool.activeSegmentIds().sort()).toEqual(['a', 'c', 'd']);
  });

  it('shrinking the protected set frees budget immediately, without waiting for the next ensureSession/getFrameAt call', async () => {
    const demuxed = makeDemuxed([0, 33_333]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    // Protect all four up front (over the cap of 3) BEFORE creating them —
    // otherwise the 4th session would itself be the only unprotected
    // candidate the instant it's added and would be evicted immediately.
    pool.setProtectedIds(['a', 'b', 'c', 'd']);
    await pool.ensureSession('a', 'blob:a', 0, 0.033);
    await pool.ensureSession('b', 'blob:b', 0, 0.033);
    await pool.ensureSession('c', 'blob:c', 0, 0.033);
    await pool.ensureSession('d', 'blob:d', 0, 0.033);

    // Still over budget, but nothing evictable — every session survives.
    expect(pool.activeSegmentIds()).toHaveLength(4);

    // Now un-protect two of them — setProtectedIds itself triggers an
    // immediate budget check (no new ensureSession/getFrameAt call needed).
    pool.setProtectedIds(['c', 'd']);

    expect(pool.activeSegmentIds()).toHaveLength(3); // back down to MAX_CACHED_SESSIONS
    expect(pool.hasSession('c')).toBe(true);
    expect(pool.hasSession('d')).toBe(true);
  });

  it('never evicts a transition-protected segment even when it is the least-recently-used and not in protectedIds (item-4 B1)', async () => {
    const demuxed = makeDemuxed([0, 33_333]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('a', 'blob:a', 0, 0.033);
    pool.setTransitionProtectedIds(['a']); // e.g. 'a' is the outgoing segment mid-transition
    await pool.ensureSession('b', 'blob:b', 0, 0.033);
    await pool.ensureSession('c', 'blob:c', 0, 0.033);
    await pool.ensureSession('d', 'blob:d', 0, 0.033); // would evict 'a' as LRU if it weren't transition-protected

    expect(pool.hasSession('a')).toBe(true);
    expect(pool.hasSession('b')).toBe(false); // 'b' is the LRU among the non-protected
    expect(pool.activeSegmentIds().sort()).toEqual(['a', 'c', 'd']);
  });

  it('setTransitionProtectedIds fully replaces the previous set — an id dropped from a new call becomes evictable again (item-4 B1)', async () => {
    const demuxed = makeDemuxed([0, 33_333]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    // Transition-protect all four up front (over the cap of 3) BEFORE
    // creating them — same rationale as the protectedIds analogue above.
    pool.setTransitionProtectedIds(['a', 'b', 'c', 'd']);
    await pool.ensureSession('a', 'blob:a', 0, 0.033);
    await pool.ensureSession('b', 'blob:b', 0, 0.033);
    await pool.ensureSession('c', 'blob:c', 0, 0.033);
    await pool.ensureSession('d', 'blob:d', 0, 0.033);

    // Still over budget, but nothing evictable — every session survives.
    expect(pool.activeSegmentIds()).toHaveLength(4);

    // Re-asserting with a smaller set (full replace, not merge) drops 'a'
    // and 'b' from transition-protection — budget enforcement fires
    // immediately, same as setProtectedIds.
    pool.setTransitionProtectedIds(['c', 'd']);

    expect(pool.activeSegmentIds()).toHaveLength(3); // back down to MAX_CACHED_SESSIONS
    expect(pool.hasSession('c')).toBe(true);
    expect(pool.hasSession('d')).toBe(true);
  });

  it('an empty transitionProtectedIds set protects nothing — behaves identically to it never having been called (item-4 B1)', async () => {
    const demuxed = makeDemuxed([0, 33_333]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    pool.setTransitionProtectedIds([]); // explicit empty — should be a no-op for protection purposes
    await pool.ensureSession('a', 'blob:a', 0, 0.033);
    await pool.ensureSession('b', 'blob:b', 0, 0.033);
    await pool.ensureSession('c', 'blob:c', 0, 0.033);
    await pool.ensureSession('d', 'blob:d', 0, 0.033); // ordinary LRU eviction, nothing protected

    expect(pool.hasSession('a')).toBe(false);
    expect(pool.activeSegmentIds().sort()).toEqual(['b', 'c', 'd']);
  });

  it('closes every buffered VideoFrame — not just the displayed one — when a session is evicted via LRU', async () => {
    const demuxed = makeDemuxed([0, 33_333, 66_667, 100_000]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('a', 'blob:a', 0, 0.1);
    // Select the EARLIEST frame — every later decoded frame stays buffered
    // ahead of it (the decode-ahead window), untouched by normal per-call
    // eviction (which only ever closes frames OLDER than the selection).
    const selected = (await pool.getFrameAt('a', 0)) as unknown as MockVideoFrame;
    expect(selected.timestamp).toBe(0);
    const framesForA = MockVideoFrame.instances.filter((f) => !f.closed);
    expect(framesForA.length).toBeGreaterThan(1); // more than just the selected one survived the call

    await pool.ensureSession('b', 'blob:b', 0, 0.033);
    await pool.ensureSession('c', 'blob:c', 0, 0.033);
    await pool.ensureSession('d', 'blob:d', 0, 0.033); // evicts 'a' (LRU)

    expect(pool.hasSession('a')).toBe(false);
    for (const f of framesForA) expect(f.closed).toBe(true);
  });
});

/**
 * WS3 Batch B tail defect, THIRD then FOURTH pass.
 *
 * Third pass finding: getFrameAt was NOT re-entrant per session, and nothing
 * in the class enforced that. The module header stated the invariant callers
 * must uphold ("at most one getFrameAt call in flight per session"), and
 * useWebCodecsPreview.ts upheld it with a chase mutex — but that mutex was
 * per-CHASE, not per-session, and useGlPreview.ts owns two more chases
 * against the same pool. When two of them targeted one session concurrently
 * (the outgoing chase during the pre-boundary half of a centered transition
 * window, where the outgoing segment is still `currentSegment`), the preview
 * froze on the previous segment's frame, dropped boundary transitions, or
 * went black. At the time, the fix lived entirely upstream, in
 * useGlPreview.ts's canChaseTransitionFrame guard, which kept the callers
 * disjoint — the tests below originally CHARACTERIZED the hazard (pinned the
 * buggy outcome), with an explicit note that they should start FAILING, and
 * that failure would be the signal, if this class were ever made genuinely
 * re-entrant by serializing per session.
 *
 * WS3 baseline cleanup note: canChaseTransitionFrame and its guard were
 * removed from useGlPreview.ts — the owner's later manual testing (observation
 * 2, "removing all transitions changed nothing") falsified the theory that
 * this transition-chase collision was the cause of the reported preview
 * stall, so the speculative upstream guard was deleted along with the rest of
 * that theory's work. The concurrency itself (outgoing chase and the
 * current-segment pull targeting one session at once) is real and unchanged —
 * only the fix's location moved. This serialization layer is now the SOLE
 * protection against it, not a backstop behind the upstream guard.
 *
 * Fourth pass (restoration option 2): that serialization now exists —
 * getFrameAt itself enforces "at most one call in flight per session" (see
 * its own doc comment in videoDecoderPool.ts). The tests below are rewritten
 * to assert the CORRECT outcome directly, rather than pinning the bug — with
 * one honestly-reported caveat, verified empirically (not assumed) while
 * writing this pass:
 *
 * - The DIVERGENT-target test (below) is a genuine, reliably red-before/
 *   green-after regression test: run against the pre-serialization code it
 *   fails with the exact ~8.0s wrong-keyframe answer this pass's own
 *   investigation found; against the fix it passes. This is the strongest,
 *   most severe symptom (a caller answered over a second wrong) and it is
 *   fully closed.
 * - The CLOSE-target ("neither caller...closed") test passes against BOTH
 *   the pre- and post-serialization code with this file's synchronous
 *   `AsyncOutputDecoder` mock — it does NOT discriminate the fix, verified by
 *   running it against the pre-fix source directly. Root cause, traced
 *   during this pass: `getFrameAtInternal`'s post-`fillWindow` tail (select +
 *   evict-older + return) is fully synchronous with no `await` inside it, so
 *   two DIFFERENT calls' tails can never literally interleave statement-by-
 *   statement in JS's single-threaded model regardless of serialization —
 *   whichever call's `fillWindow` settles first runs its entire tail
 *   atomically before the other's tail can begin. The production symptom
 *   this test was meant to pin most likely depends on real, non-deterministic
 *   WebCodecs decode/paint timing (a caller not consuming its frame
 *   synchronously before a sibling's later, legitimate eviction reclaims it)
 *   that this synchronous mock cannot reproduce for two overlapping,
 *   non-reset-triggering targets. The test is kept because it still verifies
 *   a real, desirable post-fix invariant (no caller's frame is closed at the
 *   instant its own call settles) — just not as a red/green discriminator.
 *   See this comment block's own "WS3 baseline cleanup note" above (the
 *   "fourth pass" note) for why this serialization layer, not an upstream
 *   guard, is what's relied on now.
 */
describe('VideoDecoderPool — getFrameAt serialization per session (WS3 fourth pass, restoration)', () => {
  class AsyncOutputDecoder {
    static instances: AsyncOutputDecoder[] = [];
    outputCb: (frame: MockVideoFrame) => void;
    resetCalls = 0;
    private needsKey = true;
    private closed = false;
    private pending = new Set<ReturnType<typeof setTimeout>>();

    constructor(init: { output: (frame: MockVideoFrame) => void; error: (e: Error) => void }) {
      this.outputCb = init.output;
      AsyncOutputDecoder.instances.push(this);
    }
    configure(): void { this.needsKey = true; }
    decode(chunk: { timestamp: number; type: string }): void {
      if (this.closed) return;
      if (this.needsKey) {
        if (chunk.type !== 'key') throw new Error('A key frame is required after configure() or flush()');
        this.needsKey = false;
      }
      // Real decoders deliver output asynchronously — the synchronous mocks
      // used above cannot expose an interleaving hazard at all.
      const h = setTimeout(() => {
        this.pending.delete(h);
        if (!this.closed) this.outputCb(new MockVideoFrame(chunk.timestamp));
      }, 0);
      this.pending.add(h);
    }
    async flush(): Promise<void> {
      await new Promise((r) => setTimeout(r, 1));
      this.needsKey = true;
    }
    reset(): void {
      this.resetCalls++;
      for (const h of this.pending) clearTimeout(h);
      this.pending.clear();
      this.needsKey = true;
    }
    close(): void {
      this.closed = true;
      for (const h of this.pending) clearTimeout(h);
      this.pending.clear();
    }
  }

  beforeEach(() => {
    AsyncOutputDecoder.instances = [];
    MockVideoFrame.instances = [];
    vi.stubGlobal('VideoDecoder', AsyncOutputDecoder);
    // 10s @30fps, keyframe every 2s — the reported repro's shape (a long clip
    // hosting a short, slipped segment).
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeLongDemuxed(300, 60));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('two concurrent calls on ONE session: neither caller is ever handed an already-closed frame (invariant check — see this describe block\'s own doc comment: passes both before and after the fix with this synchronous mock, not a red/green discriminator)', async () => {
    const pool = new VideoDecoderPool();
    pool.setProtectedIds(['seg']);
    await pool.ensureSession('seg', 'blob:v', 6.6, 10, 6.6);
    await pool.getFrameAt('seg', 6.6); // warm, as steady playback would

    // Capture each frame's `.closed` state AT THE MOMENT its own call
    // settles, not after both have settled — a later call's forward eviction
    // legitimately closes an earlier, now-stale frame afterward (ordinary
    // playback lifecycle), which is not the bug. The bug was a caller
    // receiving a frame that was ALREADY closed by the time it got it.
    let aClosedAtSettle: boolean | undefined;
    let bClosedAtSettle: boolean | undefined;
    const pa = pool.getFrameAt('seg', 9.9).then((f) => {
      aClosedAtSettle = (f as unknown as MockVideoFrame | null)?.closed;
      return f;
    });
    const pb = pool.getFrameAt('seg', 9.95).then((f) => {
      bClosedAtSettle = (f as unknown as MockVideoFrame | null)?.closed;
      return f;
    });

    const [a, b] = (await Promise.all([pa, pb])) as unknown as [MockVideoFrame | null, MockVideoFrame | null];

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(aClosedAtSettle).toBe(false);
    expect(bClosedAtSettle).toBe(false);
  });

  it('two concurrent calls with DIVERGENT targets: each caller gets the frame for its OWN target, not the sibling reset\'s keyframe', async () => {
    const pool = new VideoDecoderPool();
    pool.setProtectedIds(['seg']);
    await pool.ensureSession('seg', 'blob:v', 6.6, 10, 6.6);
    await pool.getFrameAt('seg', 6.6);

    // 6.7 is the outgoing/current segment's real playhead; 9.9 is the other
    // chase running ahead. Pre-fix, the far target's needsReset discarded the
    // near call's buffer mid-flight and re-seeded at ITS keyframe (~8.0s),
    // answering the near caller more than a second wrong. Serialized, the
    // near call runs to full completion against its own target before the
    // far call's reset can ever happen.
    const [near, far] = (await Promise.all([
      pool.getFrameAt('seg', 6.7),
      pool.getFrameAt('seg', 9.9),
    ])) as unknown as [MockVideoFrame | null, MockVideoFrame | null];

    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    expect(near!.timestamp / 1e6).toBeGreaterThan(6.6);
    expect(near!.timestamp / 1e6).toBeLessThanOrEqual(6.7 + 1e-6);
    expect(far!.timestamp / 1e6).toBeGreaterThan(9.8);
    expect(far!.timestamp / 1e6).toBeLessThanOrEqual(9.9 + 1e-6);
  });

  it('sequential calls on the same session are correct — unaffected by the serialization change', async () => {
    const pool = new VideoDecoderPool();
    pool.setProtectedIds(['seg']);
    await pool.ensureSession('seg', 'blob:v', 6.6, 10, 6.6);
    await pool.getFrameAt('seg', 6.6);

    const near = (await pool.getFrameAt('seg', 6.7)) as unknown as MockVideoFrame;
    expect(near.timestamp / 1e6).toBeGreaterThan(6.6);
    expect(near.timestamp / 1e6).toBeLessThanOrEqual(6.7);

    const far = (await pool.getFrameAt('seg', 9.9)) as unknown as MockVideoFrame;
    expect(far.timestamp / 1e6).toBeGreaterThan(9.8);
    expect(far.timestamp / 1e6).toBeLessThanOrEqual(9.9);
  });

  it('two different sessions still decode concurrently — session B does not queue behind session A', async () => {
    // Switch to ControllableVideoDecoder for this test specifically — it
    // gives per-instance manual control over WHEN output arrives (unlike
    // AsyncOutputDecoder's automatic setTimeout(0) emission), which is what's
    // needed to leave session A's call permanently pending while proving
    // session B still settles.
    ControllableVideoDecoder.instances = [];
    vi.stubGlobal('VideoDecoder', ControllableVideoDecoder);
    const demuxed = makeDemuxed([0, 33_333, 66_667, 100_000]);
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    const readyA = pool.ensureSession('a', 'blob:a', 0, 0.1);
    const readyB = pool.ensureSession('b', 'blob:b', 0, 0.1);
    await Promise.resolve(); // let both startSession calls run up to (but not past) their own initial fillWindow wait

    const [decoderA, decoderB] = ControllableVideoDecoder.instances;
    expect(decoderA).toBeDefined();
    expect(decoderB).toBeDefined();

    // Issue a call on EACH session, but only ever feed output to session B's
    // decoder — session A's call is left permanently pending (never emits,
    // never resolves on its own). If the two sessions shared one
    // serialization queue (a global, not per-session, bug), session B would
    // be stuck behind session A's still-pending turn and this test would
    // hang until the default timeout.
    const framePromiseA = pool.getFrameAt('a', 0.02);
    let bResolved = false;
    const framePromiseB = pool.getFrameAt('b', 0.02).then((f) => {
      bResolved = true;
      return f;
    });

    decoderB!.emit(0);
    decoderB!.emit(33_333);
    const frameB = await framePromiseB;
    expect(bResolved).toBe(true);
    expect(frameB?.timestamp).toBe(0);

    // Clean up session A without ever giving it output — releaseSession
    // force-settles its still-pending internal waiters so framePromiseA
    // resolves (to null) instead of leaking a dangling promise past this test.
    pool.releaseSession('a');
    await framePromiseA;
    await Promise.all([readyA, readyB]);
    pool.dispose();
  });
});

/**
 * WS3 Stage 3/4 — end-to-end regression for the confirmed root cause
 * (Part A / "fourth pass" fix): `findChunkRange` resolving a deep target to
 * a stale, much-earlier frame on a B-frame-reordered chunk array. Live
 * instrumentation on a real 10s clip
 * recorded target 9.6144s resolving to 3.7916s (119 inversions / 240
 * chunks); this drives `VideoDecoderPool.getFrameAt` itself (not just the
 * pure `findChunkRange` function above) through the same shape of clip and
 * asserts the resolved frame lands near the requested target.
 */
describe('VideoDecoderPool — B-frame timestamp inversions no longer resolve to a stale frame (WS3 Stage 3/4)', () => {
  // Plain MockVideoDecoder emits synchronously in DECODE-call order, not
  // presentation order — accurate for the OTHER describe blocks' monotonic
  // fixtures, but NOT a faithful stand-in for a real decoder against a
  // deliberately-reordered chunk array: a real decoder buffers and reorders
  // output to presentation order. This mock approximates that by buffering
  // every decode() call and emitting the batch sorted by timestamp on
  // flush() — good enough to validate that `session.frames` ends up in the
  // ascending order `getFrameAtInternal`'s selection logic requires, for a
  // batch that reaches the session's true end (this test's scenario, where
  // `fullyFed` becomes true within the one initial batch and `feedWindow`'s
  // own redesign already guarantees a flush() there — see feedWindow's own
  // doc comment).
  class ReorderBufferVideoDecoder {
    static instances: ReorderBufferVideoDecoder[] = [];
    outputCb: (frame: MockVideoFrame) => void;
    private needsKey = true;
    private pending: { timestamp: number; type: string }[] = [];
    resetCalls = 0;
    closed = false;
    constructor(init: { output: (frame: MockVideoFrame) => void; error: (e: Error) => void }) {
      this.outputCb = init.output;
      ReorderBufferVideoDecoder.instances.push(this);
    }
    configure(): void { this.needsKey = true; }
    decode(chunk: { timestamp: number; type: string }): void {
      if (this.needsKey && chunk.type !== 'key') throw new Error('A key frame is required after configure() or flush().');
      this.needsKey = false;
      this.pending.push(chunk);
    }
    async flush(): Promise<void> {
      const batch = [...this.pending].sort((a, b) => a.timestamp - b.timestamp);
      this.pending = [];
      for (const c of batch) this.outputCb(new MockVideoFrame(c.timestamp));
      this.needsKey = true;
    }
    reset(): void { this.resetCalls++; this.pending = []; this.needsKey = true; }
    close(): void { this.closed = true; }
  }

  beforeEach(() => {
    ReorderBufferVideoDecoder.instances = [];
    vi.stubGlobal('VideoDecoder', ReorderBufferVideoDecoder);
  });

  it('getFrameAt near a clip\'s end resolves close to the requested target, not a stale early frame, despite chunk timestamp inversions', async () => {
    const demuxed = {
      config: { codec: 'avc1.640020', codedWidth: 1280, codedHeight: 720, description: new Uint8Array() },
      // The early-spike fixture, not the per-GOP one — see this file's own
      // comment on makeReorderedChunks' non-regression test above for why
      // that one doesn't actually discriminate the fix.
      chunks: makeChunksWithEarlyInversion(5, 60, 30), // 5 GOPs x 2s = 10s clip, matching the reported repro's shape
      durationSec: 10,
    };
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(demuxed);

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg', 'blob:v', 0, 10, 9.6144);
    const frame = (await pool.getFrameAt('seg', 9.6144)) as unknown as MockVideoFrame;

    expect(frame).not.toBeNull();
    // Pre-fix this resolved to ~3.79s (a stale frame from many GOPs
    // earlier) — the reported defect. Post-fix it must land within the
    // correct (last, ~[8.0, 10.0)) GOP — 7.9999 not an exact 8.0 given the
    // fixture's own integer-microsecond frame-duration rounding.
    expect(frame.timestamp / 1e6).toBeGreaterThanOrEqual(7.999);
    expect(frame.timestamp / 1e6).toBeLessThanOrEqual(9.6144 + 1e-6);
  });
});

// --- WS3 sparse-keyframe fix: sliding window instead of a prefix buffer -------
//
// The confirmed root cause of the WS3 preview stall. An owner scan of the
// real asset library found 6 of 7 clips
// carry exactly ONE keyframe, at t=0 — generated/stock media is routinely
// encoded this way, so this is the normal case, not an edge case. Reaching a
// target at 9.6s therefore means decoding ~230 frames forward from t=0. The
// pre-fix handleDecoderOutput DROPPED every frame that arrived once
// MAX_BUFFERED_FRAMES_PER_SESSION (90) was full, so the buffer filled with the
// run's own leading frames (0 -> 3.75s at 24fps) and every frame past that —
// including the target's own — was decoded and immediately discarded.
// getFrameAt then answered from what was left: a stale ~3.7s frame, with no
// error. 90 frames / 24fps = 3.75s matched the owner's observed working/failing
// boundary exactly.
describe('VideoDecoderPool — single-keyframe clips reach targets past the buffer cap (WS3 sliding window)', () => {
  const FPS_24_FRAME_DUR_US = Math.round(1e6 / 24); // 41_667us

  /** The real failing clip's shape: 240 frames @ 24fps = 10s, with a keyframe
   *  ONLY at index 0. Deliberately monotonic — this defect has nothing to do
   *  with B-frame ordering (that was the separate, already-fixed
   *  findChunkRange defect), so any inversion here would only muddy which
   *  mechanism a failure implicates. */
  function makeSingleKeyframeDemuxed(totalFrames = 240) {
    return {
      config: { codec: 'avc1.640020', codedWidth: 1280, codedHeight: 720, description: new Uint8Array() },
      chunks: Array.from({ length: totalFrames }, (_, i) => ({
        type: i === 0 ? 'key' : 'delta',
        timestamp: i * FPS_24_FRAME_DUR_US,
        duration: FPS_24_FRAME_DUR_US,
        data: new Uint8Array(),
      })),
      durationSec: (totalFrames * FPS_24_FRAME_DUR_US) / 1e6,
    };
  }

  const frameTs = (index: number) => index * FPS_24_FRAME_DUR_US;

  // THE red/green discriminator for this fix. Verified to fail against the
  // pre-fix source (returns frame 89 / ~3.708s — the last frame that fit under
  // the cap) and pass after it.
  it('resolves a target ~230 frames past the only keyframe, instead of the last frame that fit under the buffer cap', async () => {
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeSingleKeyframeDemuxed());

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg', 'blob:v', 0, 10, 9.6);
    const frame = await pool.getFrameAt('seg', 9.6);

    expect(frame).not.toBeNull();
    // Frame 230 (9.583s) is the latest at-or-before 9.6s. Pre-fix: frame 89
    // (3.708s), i.e. exactly MAX_BUFFERED_FRAMES_PER_SESSION frames in.
    expect(frame!.timestamp).toBe(frameTs(230));

    pool.dispose();
  });

  it('resolves a target at the very end of the clip', async () => {
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeSingleKeyframeDemuxed());

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg', 'blob:v', 0, 10, 9.9);
    const frame = await pool.getFrameAt('seg', 9.9);

    expect(frame).not.toBeNull();
    expect(frame!.timestamp).toBe(frameTs(237)); // 9.875s, the last frame at-or-before 9.9s

    pool.dispose();
  });

  it('a backward seek from a deep target re-seeks and returns the correct frame, not a stale later one', async () => {
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeSingleKeyframeDemuxed());

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg', 'blob:v', 0, 10, 9.6);
    const deep = await pool.getFrameAt('seg', 9.6);
    expect(deep!.timestamp).toBe(frameTs(230));

    const decoder = MockVideoDecoder.instances[0]!;
    const resetsBefore = decoder.resetCalls;

    // 4.0s is far below the retained tail (RETAIN_BEHIND_SEC = 0.5s), so this
    // must re-seed at the single keyframe and decode forward again. On this
    // encoding that is inherent, not a defect — what matters is that it
    // COMPLETES and is CORRECT rather than stalling or answering from stale
    // buffer.
    const back = await pool.getFrameAt('seg', 4.0);

    expect(decoder.resetCalls).toBeGreaterThan(resetsBefore);
    expect(back).not.toBeNull();
    expect(back!.timestamp).toBe(frameTs(95)); // 3.958s, latest at-or-before 4.0s

    pool.dispose();
  });

  it('a short backward nudge inside the retained tail is answered without a re-seek', async () => {
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeSingleKeyframeDemuxed());

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg', 'blob:v', 0, 10, 9.6);
    await pool.getFrameAt('seg', 9.6);

    const decoder = MockVideoDecoder.instances[0]!;
    const resetsBefore = decoder.resetCalls;

    // One frame back — must come out of the retain-behind tail. Without that
    // tail this would cost a full re-decode from t=0 on every frame-step.
    const nudged = await pool.getFrameAt('seg', 9.55);

    expect(decoder.resetCalls).toBe(resetsBefore);
    expect(nudged!.timestamp).toBe(frameTs(229)); // 9.542s

    pool.dispose();
  });

  // Guard, not a discriminator: this passes both before and after the fix
  // (pre-fix the buffer was bounded by dropping rather than sliding). Its job
  // is to prove the fix did not trade the stall for unbounded memory.
  it('holds a bounded number of live frames across a full forward walk of the clip', async () => {
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeSingleKeyframeDemuxed());

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg', 'blob:v', 0, 10, 0);

    let peakLive = 0;
    for (let target = 0.5; target <= 9.5; target += 0.5) {
      await pool.getFrameAt('seg', target);
      const live = MockVideoFrame.instances.filter((f) => !f.closed).length;
      peakLive = Math.max(peakLive, live);
    }

    // MAX_BUFFERED_FRAMES_PER_SESSION is 90 and not exported; the walk decodes
    // all 240 frames, so an unbounded buffer would sit far above this.
    expect(peakLive).toBeLessThanOrEqual(90);

    pool.dispose();
    expect(MockVideoFrame.instances.every((f) => f.closed)).toBe(true);
  });

  it('two sessions each reach their own deep target in parallel', async () => {
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeSingleKeyframeDemuxed());

    const pool = new VideoDecoderPool();
    await pool.ensureSession('segA', 'blob:a', 0, 10, 9.6);
    await pool.ensureSession('segB', 'blob:b', 0, 10, 8.0);

    const [a, b] = await Promise.all([pool.getFrameAt('segA', 9.6), pool.getFrameAt('segB', 8.0)]);

    expect(a!.timestamp).toBe(frameTs(230));
    expect(b!.timestamp).toBe(frameTs(191)); // frame 192 is 8.000064s — just past the target

    pool.dispose();
  });

  // findChunkRange used to additionally clamp endIndex to startIndex + 599
  // (the removed MAX_SESSION_FRAMES). On a single-keyframe clip startIndex is
  // always 0, so that clamp was the same defect at a different depth: targets
  // past ~25s at 24fps were simply unreachable.
  it('reaches a target past the old 600-chunk session-range clamp on a long single-keyframe clip', async () => {
    (getOrCreateDemux as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeSingleKeyframeDemuxed(1440)); // 60s @ 24fps

    const pool = new VideoDecoderPool();
    await pool.ensureSession('seg', 'blob:v', 0, 60, 50);
    const frame = await pool.getFrameAt('seg', 50);

    expect(frame).not.toBeNull();
    expect(frame!.timestamp).toBe(frameTs(1199)); // frame 1200 is 50.0004s — just past the target

    pool.dispose();
  });
});
