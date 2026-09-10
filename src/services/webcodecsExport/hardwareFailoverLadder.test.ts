/**
 * WS3 Round 9 — Rung 5a (hardware->software failover), the LADDER half.
 *
 * `ExportWorkerInitMessage.forceSoftwareEncoder` must make `createEncoder`
 * build against `SOFTWARE_ONLY_LADDER` (`['prefer-software']`) instead of
 * `HARDWARE_LADDER`, for EVERY session the run builds — not just skip
 * straight to whichever rung the fake `isConfigSupported` happens to accept
 * first. The destructive case this file exists to catch: a fake that
 * accepts ALL THREE rungs, with `forceSoftwareEncoder` set — a build that
 * still picks `'prefer-hardware'` there would prove the flag is wired to
 * nothing.
 *
 * Uses the same real-`import('./exportWorker')`-via-faked-`self` harness as
 * `hardwareRungDiagnostics.test.ts` (see that file's header for the full
 * rationale); this file duplicates the minimal pieces rather than importing
 * them, since nothing in that file is exported and it belongs to a prior
 * round.
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

const segment: VideoSegment = {
  id: 's0', text: '', assetId: 'a0', startTime: 0, duration: 1,
  transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0,
};
const asset: Asset = { id: 'a0', name: 'a0.png', url: 'blob:a0', type: 'image', file: new Blob() as unknown as File };
const config: ProjectEffectConfig = { globalTransition: TransitionType.NONE, globalTransitionDuration: 0 };

/** Every rung is accepted — the case that isolates the ladder-selection
 *  from the fall-through logic already covered by `hardwareRungDiagnostics.test.ts`. */
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
  class FakeVideoEncoder {
    static async isConfigSupported(): Promise<{ supported: boolean }> {
      return { supported: true };
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

async function runOneCleanExportAndCollectDoneDiagnostics(forceSoftwareEncoder?: boolean) {
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
    forceSoftwareEncoder,
  };
  self.onmessage!({ data: initMsg } as MessageEvent<ExportWorkerInboundMessage>);

  for (let i = 0; i < 20; i++) await Promise.resolve();

  const done = outbound.find((m) => m.type === 'done');
  if (!done || done.type !== 'done') throw new Error(`expected a 'done' message, got: ${JSON.stringify(outbound.map((m) => m.type))}`);
  return done.diagnostics;
}

describe('Rung 5a — forceSoftwareEncoder restricts the build ladder', () => {
  it('clean path (forceSoftwareEncoder unset) still picks prefer-hardware when every rung is accepted — output neutrality', async () => {
    const diagnostics = await runOneCleanExportAndCollectDoneDiagnostics(undefined);
    expect(diagnostics.selectedHardwareRung).toBe('prefer-hardware');
  });

  it('forceSoftwareEncoder=true picks prefer-software EVEN THOUGH prefer-hardware is also accepted', async () => {
    const diagnostics = await runOneCleanExportAndCollectDoneDiagnostics(true);
    expect(diagnostics.selectedHardwareRung).toBe('prefer-software');
  });
});
