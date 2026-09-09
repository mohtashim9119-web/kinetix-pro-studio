/**
 * WS3 salvage-runtime round — Step 2: closing probe P5 for real.
 *
 * `docs/ws3-export-recovery-architecture.md`'s own honest accounting (P5,
 * "the destructive-probe negative"): no fixture reached `runExport`'s real
 * output callback, because it lives inside a function that needs a worker
 * realm, `OffscreenCanvas`, WebGL2 and a real `VideoEncoder` — none of which
 * exist in plain Node/vitest. `SessionOutputFence` was therefore verified at
 * the CLASS level (`flushSalvage.test.ts`) and the RECOVERY level
 * (`runFinalFlushWithRecovery`, same file), never at the exact line inside
 * the encoder's `output` callback (`exportWorker.ts`, `if (!fence.accepts(
 * forSession)) return;`) that is the actual valve in production.
 *
 * This file closes that gap by driving the REAL `runExport` (private, reached
 * only via the module's own `self.onmessage` wiring — see the bottom of
 * `exportWorker.ts`) end to end, bridged to a REAL `driveGlRun` on the other
 * side, with every browser/WebCodecs primitive that is irreducibly
 * unavailable in Node stubbed by hand: `OffscreenCanvas`, `VideoFrame`,
 * `createImageBitmap`, and — the one that matters most — `VideoEncoder`
 * itself, whose `output` callback this test invokes DIRECTLY, exactly as a
 * real encoder would, both before and after a flush-timeout fences its
 * session. `GlCompositor`, `GLTextRenderer` and `acquireOffscreenGlContext`
 * are mocked (they touch real WebGL, no plausible Node stand-in), everything
 * else — `SessionOutputFence`, `runFinalFlushWithRecovery`,
 * `decideFlushTimeoutDisposition`, `ExportPhaseTracker`, `driveGlRun`'s
 * append-queue/watchdog machinery — is the REAL production code.
 *
 * `self` must exist BEFORE `exportWorker.ts` is first evaluated (the
 * `self.onmessage = ...` wiring at the bottom of that file runs at module
 * load, guarded by `typeof self !== 'undefined'` — false in plain Node, see
 * this round's final report). So every test here sets up the fake worker
 * realm and THEN dynamically `import()`s both modules — a static top-level
 * import would be hoisted above that setup and see no `self` at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, VideoSegment } from '../../types';
import type { ProjectEffectConfig } from '../gl/compositeParams';
import type { ExportWorkerOutboundMessage, ExportWorkerInboundMessage } from './exportWorker';
import type { ExportWorkerHandle, WebCodecsFfmpeg } from './exportPipelineWebCodecs';

vi.mock('../gl/glContext', () => ({
  acquireOffscreenGlContext: vi.fn(() => ({}) as unknown),
  GlContextLostError: class GlContextLostError extends Error {},
}));
vi.mock('../gl/glCompositor', () => ({
  GlCompositor: class FakeGlCompositor {
    uploadFrame(): void {}
    renderFrame(): void {}
    dispose(): void {}
  },
}));
vi.mock('./textRenderer', () => ({
  GLTextRenderer: class FakeGLTextRenderer {
    async init(): Promise<void> {}
    renderFrame(): void {}
    dispose(): void {}
  },
}));

const segment: VideoSegment = {
  id: 's0',
  text: '',
  assetId: 'a0',
  startTime: 0,
  duration: 1,
  transition: TransitionType.NONE,
  animation: AnimationType.NONE,
  order: 0,
};
const asset: Asset = { id: 'a0', name: 'a0.png', url: 'blob:a0', type: 'image', file: new Blob() as unknown as File };
const config: ProjectEffectConfig = { globalTransition: TransitionType.NONE, globalTransitionDuration: 0 };
const textConfig = {
  fontConfigs: [] as { family: string; bytes: ArrayBuffer }[],
  globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  textLayers: [] as import('../../types').TextOverlay[],
  headings: [] as import('../../types').HeadingOverlay[],
};

/** Captures the `output`/`error` callbacks `createEncoder` registers, and
 *  gives the test direct manual control over when a chunk "arrives" — a real
 *  encoder's output timing is exactly what a flush-timeout race depends on,
 *  so this is the one piece of realism a fake MUST preserve rather than
 *  auto-firing on `encode()`. */
function installFakeBrowserGlobals(): {
  capturedOutput: { fn: ((chunk: unknown) => void) | null };
  encodeQueueSize: { value: number };
} {
  class FakeOffscreenCanvas {
    constructor(public width: number, public height: number) {}
  }
  class FakeVideoFrame {
    timestamp: number;
    constructor(_source: unknown, opts: { timestamp: number; duration: number }) {
      this.timestamp = opts.timestamp;
    }
    close(): void {}
  }
  const capturedOutput: { fn: ((chunk: unknown) => void) | null } = { fn: null };
  const encodeQueueSize = { value: 0 };
  class FakeVideoEncoder {
    static async isConfigSupported(): Promise<{ supported: boolean }> {
      return { supported: true };
    }
    state = 'unconfigured';
    get encodeQueueSize(): number {
      return encodeQueueSize.value;
    }
    constructor(opts: { output: (chunk: unknown) => void; error: (e: unknown) => void }) {
      capturedOutput.fn = opts.output;
    }
    configure(): void {
      this.state = 'configured';
    }
    encode(): void {
      // Deliberately does NOT call `output` — see this function's own doc
      // comment. The test drives `capturedOutput.fn` by hand.
    }
    flush(): Promise<void> {
      // Always hangs: this is the failure this suite exists to exercise
      // (final-flush timeout -> salvage -> fence).
      return new Promise<void>(() => {});
    }
    reset(): void {
      this.state = 'unconfigured';
    }
    close(): void {
      this.state = 'closed';
    }
    addEventListener(): void {}
    removeEventListener(): void {}
  }

  (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = FakeOffscreenCanvas;
  (globalThis as unknown as { VideoFrame: unknown }).VideoFrame = FakeVideoFrame;
  (globalThis as unknown as { VideoEncoder: unknown }).VideoEncoder = FakeVideoEncoder;
  (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = vi.fn(async () => ({
    width: 4,
    height: 4,
    close: (): void => {},
  }));

  return { capturedOutput, encodeQueueSize };
}

function uninstallFakeBrowserGlobals(): void {
  for (const key of ['self', 'OffscreenCanvas', 'VideoFrame', 'VideoEncoder', 'createImageBitmap']) {
    delete (globalThis as unknown as Record<string, unknown>)[key];
  }
}

/**
 * The loopback bridge: `ExportWorkerHandle` on the `driveGlRun` (main-thread)
 * side, `globalThis.self` on the `exportWorker.ts` (worker) side — the SAME
 * object graph a real `postMessage` transport would connect, minus
 * serialization. Main -> worker forwards synchronously into the REAL
 * `self.onmessage` the module wired up at load (read off `globalThis.self`
 * at call time, not cached — the module itself resolves bare `self` the same
 * way); worker -> main forwards synchronously into whatever `driveGlRun` set
 * as `bridge.onmessage` (its real terminal/append-queue handling, untouched)
 * via `postMessageFromWorker`, which the caller wires onto
 * `globalThis.self.postMessage` AFTER the module has loaded (so it overrides
 * whatever inert default the module's own load-time code left there).
 */
function makeBridge(): { bridge: ExportWorkerHandle; postMessageFromWorker: (m: unknown) => void } {
  const bridge: ExportWorkerHandle = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(message: unknown): void {
      const self = (globalThis as unknown as { self: { onmessage: ((ev: MessageEvent<ExportWorkerInboundMessage>) => void) | null } }).self;
      self.onmessage?.({ data: message } as MessageEvent<ExportWorkerInboundMessage>);
    },
    terminate(): void {
      (bridge as unknown as { terminated: boolean }).terminated = true;
    },
  } as ExportWorkerHandle;
  const postMessageFromWorker = (message: unknown): void => {
    bridge.onmessage?.({ data: message as ExportWorkerOutboundMessage } as MessageEvent<ExportWorkerOutboundMessage>);
  };
  return { bridge, postMessageFromWorker };
}

function recordingFfmpeg(): { ffmpeg: WebCodecsFfmpeg; written: number[]; appendCalls: number } {
  const state = { appendCalls: 0 };
  const written: number[] = [];
  const ffmpeg = {
    writeFile: vi.fn(async () => undefined),
    writeFileRaw: vi.fn(async () => undefined),
    exec: vi.fn(async () => 0),
    readFile: vi.fn(async () => new Uint8Array()),
    deleteFile: vi.fn(async () => undefined),
    appendFileRaw: vi.fn(async (_p: string, data: Uint8Array) => {
      state.appendCalls++;
      for (const b of data) written.push(b);
    }),
    saveSessionFile: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    sessionFileSize: vi.fn(async () => 1_700_000_000),
    countAnnexbFrames: vi.fn(async () => ({ pictures: 0, vclNals: 0 })),
    concatAnnexbPieces: vi.fn(async () => undefined),
    truncateAnnexb: vi.fn(async () => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 })),
  } as unknown as WebCodecsFfmpeg;
  return {
    ffmpeg,
    written,
    get appendCalls() {
      return state.appendCalls;
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  uninstallFakeBrowserGlobals();
});

/** Drives one real run to the point where the final flush has hung and its
 *  session has been fenced, returning everything the test needs to poke at
 *  the live encoder callback and inspect what reached the (fake) ffmpeg. */
async function driveToFencedSalvage() {
  const { capturedOutput } = installFakeBrowserGlobals();
  (globalThis as unknown as { self: unknown }).self = { onmessage: null, postMessage: undefined };

  const { bridge, postMessageFromWorker } = makeBridge();
  const exportWorkerMod = await import('./exportWorker');
  const exportPipelineMod = await import('./exportPipelineWebCodecs');
  // `postOut` (exportWorker.ts) calls `self.postMessage(...)` — resolved off
  // `globalThis.self` at CALL time, so setting this after load still reaches
  // it. The module never sets `self.postMessage` itself (only `onmessage`),
  // so there is nothing to override here, only to fill in.
  (globalThis as unknown as { self: { postMessage: unknown } }).self.postMessage = postMessageFromWorker;
  void exportWorkerMod; // referenced only to force load order; all interaction is via `self`/`bridge`

  const { ffmpeg, written, } = recordingFfmpeg();
  const chunks: ExportWorkerOutboundMessage[] = [];
  const originalOnMessageSetter = Object.getOwnPropertyDescriptor(bridge, 'onmessage');
  void originalOnMessageSetter;

  const resultPromise = exportPipelineMod.driveGlRun(
    ffmpeg,
    'run_0',
    'piece_0.h264',
    [segment],
    [asset],
    config,
    64,
    64,
    1, // fps=1 -> exactly ONE frame for a 1s segment, no rotation, straight to final flush
    1,
    () => undefined,
    textConfig,
    0,
    0,
    { createWorker: () => bridge, now: () => Date.now() },
  );

  // Tap the bridge's onmessage AFTER driveGlRun has set its own handler, so
  // every message still reaches driveGlRun's real logic (appendFileRaw etc.)
  // and this test also gets to see it for its own assertions.
  const realOnMessage = bridge.onmessage;
  bridge.onmessage = (ev) => {
    chunks.push(ev.data);
    realOnMessage?.(ev);
  };

  // Let module evaluation + the async init chain (gl-context -> shader-compile
  // -> font-init -> encoder-ladder -> frame-loop -> encode -> flush-entry) run.
  for (let i = 0; i < 10; i++) await Promise.resolve();

  return { capturedOutput, resultPromise, ffmpeg, written, chunks };
}

function fakeChunk(tag: number): { type: 'delta'; byteLength: number; timestamp: number; copyTo: (buf: ArrayBuffer) => void } {
  return {
    type: 'delta',
    byteLength: 1,
    timestamp: tag,
    copyTo: (buf: ArrayBuffer) => {
      new Uint8Array(buf)[0] = tag;
    },
  };
}

describe('SessionOutputFence at its real call site inside runExport (P5, closed)', () => {
  it('a chunk emitted BEFORE the flush times out reaches appendFileRaw (positive control)', async () => {
    const { capturedOutput, chunks } = await driveToFencedSalvage();
    expect(capturedOutput.fn).not.toBeNull();
    capturedOutput.fn!(fakeChunk(0xaa));
    await Promise.resolve();
    await Promise.resolve();
    const chunkMsgs = chunks.filter((m) => m.type === 'chunk');
    expect(chunkMsgs.length).toBe(1);
  });

  it('a LATE chunk emitted from a fenced session after flush-timeout salvage does NOT reach appendFileRaw and does not alter the file bytes', async () => {
    const { capturedOutput, resultPromise, ffmpeg, written, chunks } = await driveToFencedSalvage();

    // Legitimate chunk for frame 0, BEFORE the timeout — this is what a real
    // encoder would have emitted for the one frame this run submits.
    capturedOutput.fn!(fakeChunk(0xaa));
    await Promise.resolve();
    await Promise.resolve();

    // Trip the worker-side FLUSH_BOUND_MS bound: the final flush's promise
    // never settles (see `flush()` above), so the armed timer rejects with
    // EncoderFlushTimeoutError, `runFinalFlushWithRecovery` fences session 0
    // and posts `run-done` + `salvage-done`.
    const { FLUSH_BOUND_MS } = await import('./exportWorker');
    await vi.advanceTimersByTimeAsync(FLUSH_BOUND_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(chunks.some((m) => m.type === 'salvage-done')).toBe(true);

    // THE LATE CHUNK — the same encoder instance, the same captured `output`
    // callback, invoked again after the fence has closed. If the fence check
    // at its real call site (`exportWorker.ts`, inside `buildEncoder`'s
    // `onOutput`) were removed, this WOULD post a second 'chunk' message and
    // WOULD reach `ffmpeg.appendFileRaw`, corrupting the tail of a file the
    // guard is about to be asked to trust.
    const appendCallsBeforeLateChunk = (ffmpeg.appendFileRaw as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    capturedOutput.fn!(fakeChunk(0xbb));
    await Promise.resolve();
    await Promise.resolve();

    const chunkMsgs = chunks.filter((m) => m.type === 'chunk');
    expect(chunkMsgs.length).toBe(1); // still just the one, legitimate chunk
    expect((ffmpeg.appendFileRaw as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(appendCallsBeforeLateChunk);

    const r = await resultPromise;
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.salvaged).toBe(true);
    // The file contains ONLY the legitimate chunk's byte (0xaa=170) — the
    // late chunk's byte (0xbb=187) never reached it.
    expect(written).toEqual([0xaa]);
  });
});
