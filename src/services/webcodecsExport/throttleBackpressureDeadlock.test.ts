/**
 * WS3 Round 9 — Rung 5b non-deadlock proof: the new throttle sleep
 * (`computeThrottleDelayMs`, a plain `setTimeout`) composes with the
 * PRE-EXISTING 32 MB `AppendBackpressureGate` wait without deadlock, when
 * BOTH are genuinely elevated on the same frame.
 *
 * Real `exportWorker.ts`, real `runFrameLoopTick`, real
 * `AppendBackpressureGate` — same harness shape as
 * `hardwareRungDiagnostics.test.ts` / `hardwareFailoverLadder.test.ts`
 * (`import('./exportWorker')` against faked browser globals), extended with
 * a controllable `encodeQueueSize` and an oversized first chunk so the
 * append gate genuinely parks. `vi.useFakeTimers()` proves the throttle's
 * `setTimeout` does not itself need real wall-clock time to resolve, and
 * that resolving it does not, on its own, unblock the append gate (the gate
 * needs its own 'append-ack' message) — i.e. the two waits are independent,
 * not a hidden single resource.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, VideoSegment } from '../../types';
import type { ProjectEffectConfig } from '../gl/compositeParams';
import type { ExportWorkerOutboundMessage, ExportWorkerInboundMessage, ExportWorkerInitMessage } from './exportWorker';

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

const segments: VideoSegment[] = [
  { id: 's0', text: '', assetId: 'a0', startTime: 0, duration: 3, transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0 },
];
const asset: Asset = { id: 'a0', name: 'a0.png', url: 'blob:a0', type: 'image', file: new Blob() as unknown as File };
const config: ProjectEffectConfig = { globalTransition: TransitionType.NONE, globalTransitionDuration: 0 };

/** encodeQueueSize is fixed at 3 (above THROTTLE_SOFT_WATER=2, below the
 *  hard BACKPRESSURE_HIGH_WATER=4) — the throttle engages on EVERY frame,
 *  the hard wait never does, isolating the throttle's own contribution.
 *  Frame 0 emits one oversized (40 MB) chunk, well over
 *  APPEND_BACKPRESSURE_THRESHOLD_BYTES (32 MB), so the append gate parks
 *  before frame 1 can submit. */
function installFakeBrowserGlobals(): void {
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
  let frameCounter = 0;
  class FakeVideoEncoder {
    static async isConfigSupported(): Promise<{ supported: boolean }> {
      return { supported: true };
    }
    state = 'unconfigured';
    encodeQueueSize = 3;
    output: (chunk: unknown) => void;
    constructor(opts: { output: (chunk: unknown) => void }) {
      this.output = opts.output;
    }
    configure(): void {
      this.state = 'configured';
    }
    encode(): void {
      const isFirst = frameCounter === 0;
      frameCounter++;
      const byteLength = isFirst ? 40 * 1024 * 1024 : 1;
      this.output({
        type: isFirst ? 'key' : 'delta',
        byteLength,
        timestamp: 0,
        copyTo: (buf: ArrayBuffer) => {
          new Uint8Array(buf)[0] = 1;
        },
      });
    }
    flush(): Promise<void> {
      return Promise.resolve();
    }
    reset(): void {}
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
}

function uninstallFakeBrowserGlobals(): void {
  for (const key of ['self', 'OffscreenCanvas', 'VideoFrame', 'VideoEncoder', 'createImageBitmap']) {
    delete (globalThis as unknown as Record<string, unknown>)[key];
  }
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  uninstallFakeBrowserGlobals();
  vi.useRealTimers();
});

describe('Rung 5b — throttle composes with the 32 MB append gate without deadlock', () => {
  it('a frame that is BOTH throttled (elevated encodeQueueSize) AND parked on the append gate still completes once acked', async () => {
    installFakeBrowserGlobals();
    (globalThis as unknown as { self: unknown }).self = { onmessage: null, postMessage: undefined };
    await import('./exportWorker');
    const self = (globalThis as unknown as {
      self: {
        onmessage: ((ev: MessageEvent<ExportWorkerInboundMessage>) => void) | null;
        postMessage: (m: unknown) => void;
      };
    }).self;

    const outbound: ExportWorkerOutboundMessage[] = [];
    self.postMessage = (m: unknown) => outbound.push(m as ExportWorkerOutboundMessage);

    vi.useFakeTimers();

    const initMsg: ExportWorkerInitMessage = {
      type: 'init',
      runId: 'run_0',
      segments,
      assets: [asset],
      config,
      width: 64,
      height: 64,
      fps: 1,
      pieceIndex: 0,
      startIndex: 0,
    };
    self.onmessage!({ data: initMsg } as MessageEvent<ExportWorkerInboundMessage>);

    // Let frame 0 run: throttle (5ms, fake-timed) resolves, the oversized
    // chunk is submitted and parks the gate BEFORE frame 1's own throttle
    // sleep is even scheduled (the gate wait sits after the throttle sleep
    // in frame 1's own tick, so frame 1 must also clear ITS throttle first —
    // advancing fake timers drains every pending setTimeout, throttle or
    // otherwise, without a real wall-clock wait).
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 20; i++) await Promise.resolve();

    // Not done yet — frame 1 must be parked on the append gate (the only
    // thing NOT resolved by advancing timers, by construction: it waits on
    // a real 'append-ack' message).
    expect(outbound.some((m) => m.type === 'done')).toBe(false);
    expect(outbound.some((m) => m.type === 'error')).toBe(false);

    // Ack the oversized chunk — the only thing that can unblock the gate.
    self.onmessage!({ data: { type: 'append-ack', bytesAcked: 40 * 1024 * 1024 } } as MessageEvent<ExportWorkerInboundMessage>);

    await vi.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const done = outbound.find((m) => m.type === 'done');
    expect(done).toBeDefined();
  });
});
