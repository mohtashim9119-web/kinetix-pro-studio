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
