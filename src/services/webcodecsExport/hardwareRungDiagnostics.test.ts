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
 *  `isConfigSupported` accepts, letting a test force a fall-through.
 *  `acceptedCodecs` does the same for `EXPORT_CODEC_LADDER` — WS3 Round 14,
 *  STEP 5 (H2). Every call is recorded in `configureCalls` so a test can
 *  assert not just the FINAL selection but that no re-descent happened. */
function installFakeBrowserGlobals(
  acceptedRungs: readonly string[],
  acceptedCodecs: readonly string[] = ['avc1.640028', 'avc1.42001f'],
  configureCalls: { codec: string; hardwareAcceleration: string }[] = [],
): void {
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
    static async isConfigSupported(cfg: { codec: string; hardwareAcceleration: string }): Promise<{ supported: boolean }> {
      return { supported: acceptedRungs.includes(cfg.hardwareAcceleration) && acceptedCodecs.includes(cfg.codec) };
    }
    state = 'unconfigured';
    encodeQueueSize = 0;
    output: (chunk: unknown) => void;
    constructor(opts: { output: (chunk: unknown) => void }) {
      this.output = opts.output;
    }
    configure(cfg: { codec: string; hardwareAcceleration: string }): void {
      configureCalls.push({ codec: cfg.codec, hardwareAcceleration: cfg.hardwareAcceleration });
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

async function runOneCleanExportAndCollectDoneDiagnostics(
  acceptedRungs: readonly string[],
  acceptedCodecs?: readonly string[],
  pinnedCodec?: string,
  configureCalls: { codec: string; hardwareAcceleration: string }[] = [],
) {
  installFakeBrowserGlobals(acceptedRungs, acceptedCodecs, configureCalls);
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
    ...(pinnedCodec !== undefined ? { pinnedCodec } : {}),
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

/**
 * WS3 Round 14, STEP 5 (H2) — the CODEC ladder, and the mid-piece pin.
 */
describe('selectedCodec on the diagnostics payload (STEP 5, H2)', () => {
  it('records the High-profile codec when it is supported (default, unpinned)', async () => {
    const diagnostics = await runOneCleanExportAndCollectDoneDiagnostics(
      ['prefer-hardware', 'no-preference', 'prefer-software'],
    );
    expect(diagnostics.selectedCodec).toBe('avc1.640028');
  });

  it('descends to the Baseline codec when High profile is unsupported at every hardwareAcceleration', async () => {
    const diagnostics = await runOneCleanExportAndCollectDoneDiagnostics(
      ['prefer-hardware', 'no-preference', 'prefer-software'],
      ['avc1.42001f'],
    );
    expect(diagnostics.selectedCodec).toBe('avc1.42001f');
  });

  it(
    'a pinned codec is used EXCLUSIVELY — no re-descent to a higher profile even when the fake would accept it, ' +
      'the destructive proof that mid-piece failover cannot change profile',
    async () => {
      const configureCalls: { codec: string; hardwareAcceleration: string }[] = [];
      const diagnostics = await runOneCleanExportAndCollectDoneDiagnostics(
        ['prefer-hardware', 'no-preference', 'prefer-software'],
        ['avc1.640028', 'avc1.42001f'], // both codecs would be accepted if tried
        'avc1.42001f', // but this piece is already pinned to Baseline
        configureCalls,
      );
      expect(diagnostics.selectedCodec).toBe('avc1.42001f');
      // Confinement, not just the final answer: every configure() attempt —
      // including every failed one on the way to the winning rung — used the
      // pinned codec. A single-entry ladder made a re-descent to High
      // impossible BY CONSTRUCTION, not by the fake happening not to offer it.
      expect(configureCalls.every((c) => c.codec === 'avc1.42001f')).toBe(true);
      expect(configureCalls.some((c) => c.codec === 'avc1.640028')).toBe(false);
    },
  );
});
