/**
 * WS3 salvage-runtime round — Step 3(d): the selected `HARDWARE_LADDER` rung
 * is recorded on the diagnostics payload on every encoder build, so a seam
 * between two encoder sessions (a rotation, or a future software failover)
 * can be checked for byte-comparability instead of assumed
 * (`docs/ws3-export-recovery-architecture.md` §1a's caveat — "the two halves
 * are byte-comparable is not established, and no run has ever checked").
 *
 * Uses the same real-`runExport`-via-fake-`self` harness as
 * `sessionOutputFenceCallSite.test.ts` (see that file's header for the full
 * rationale), but drives a CLEAN run to `'done'` rather than a salvage, and
 * varies which `HARDWARE_LADDER` rung the fake `VideoEncoder` accepts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

/** `acceptedRungs` controls which `HARDWARE_LADDER` entries this fake
 *  `isConfigSupported` accepts, letting a test force a fall-through. */
function installFakeBrowserGlobals(acceptedRungs: readonly string[]): void {
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
  class FakeVideoEncoder {
    static async isConfigSupported(cfg: { hardwareAcceleration: string }): Promise<{ supported: boolean }> {
      return { supported: acceptedRungs.includes(cfg.hardwareAcceleration) };
    }
    state = 'unconfigured';
    encodeQueueSize = 0;
    output: (chunk: unknown) => void;
    constructor(opts: { output: (chunk: unknown) => void }) {
      this.output = opts.output;
    }
    configure(): void {
      this.state = 'configured';
    }
    encode(): void {
      // Synchronously "emit" — a clean-path run needs its chunk to actually
      // reach the append queue for `driveGlRun` to resolve `ok: true`.
      this.output({
        type: 'key',
        byteLength: 1,
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
});

async function runOneCleanExportAndCollectDoneDiagnostics(acceptedRungs: readonly string[]) {
  installFakeBrowserGlobals(acceptedRungs);
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

  const initMsg: ExportWorkerInitMessage = {
    type: 'init',
    runId: 'run_0',
    segments: [segment],
    assets: [asset],
    config,
    width: 64,
    height: 64,
    fps: 1,
    pieceIndex: 0,
    startIndex: 0,
  };
  self.onmessage!({ data: initMsg } as MessageEvent<ExportWorkerInboundMessage>);

  for (let i = 0; i < 20; i++) await Promise.resolve();

  const done = outbound.find((m) => m.type === 'done');
  if (!done || done.type !== 'done') throw new Error(`expected a 'done' message, got: ${JSON.stringify(outbound.map((m) => m.type))}`);
  return done.diagnostics;
}

describe('selectedHardwareRung on the diagnostics payload', () => {
  it("records 'prefer-hardware' when the first rung succeeds", async () => {
    const diagnostics = await runOneCleanExportAndCollectDoneDiagnostics(['prefer-hardware', 'no-preference', 'prefer-software']);
    expect(diagnostics.selectedHardwareRung).toBe('prefer-hardware');
  });

  it("falls through and records 'no-preference' when 'prefer-hardware' is unsupported", async () => {
    const diagnostics = await runOneCleanExportAndCollectDoneDiagnostics(['no-preference', 'prefer-software']);
    expect(diagnostics.selectedHardwareRung).toBe('no-preference');
  });

  it("falls through to 'prefer-software' when only the last rung is supported", async () => {
    const diagnostics = await runOneCleanExportAndCollectDoneDiagnostics(['prefer-software']);
    expect(diagnostics.selectedHardwareRung).toBe('prefer-software');
  });
});
