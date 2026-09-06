/**
 * Fake-worker harness for `driveGlRun`.
 *
 * The sibling `exportPipelineWebCodecs.test.ts` mocks `isGlCompositableSegment`
 * to false and never executes this function. These tests inject a Worker
 * lookalike so the watchdog, phase-token handling, and terminal breakdown
 * can be asserted in node/vitest without a real module worker or GL.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, HeadingOverlay, TextOverlay, VideoSegment } from '../../types';
import {
  driveGlRun,
  WATCHDOG_MS,
  type ExportWorkerHandle,
  type WebCodecsFfmpeg,
} from './exportPipelineWebCodecs';
import type { ExportWorkerOutboundMessage } from './exportWorker';
import type { ProjectEffectConfig } from '../gl/compositeParams';

class FakeWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;
  inbound: unknown[] = [];

  postMessage(message: unknown): void {
    this.inbound.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: ExportWorkerOutboundMessage): void {
    this.onmessage?.({ data } as MessageEvent<ExportWorkerOutboundMessage>);
  }
}

function makeFfmpeg(overrides: Partial<WebCodecsFfmpeg> = {}): WebCodecsFfmpeg {
  return {
    writeFile: vi.fn(async () => undefined),
    writeFileRaw: vi.fn(async () => undefined),
    exec: vi.fn(async () => 0),
    readFile: vi.fn(async () => new Uint8Array()),
    deleteFile: vi.fn(async () => undefined),
    appendFileRaw: vi.fn(async () => undefined),
    saveSessionFile: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    countAnnexbFrames: vi.fn(async () => 0),
    concatAnnexbPieces: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as WebCodecsFfmpeg;
}

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

const asset: Asset = { id: 'a0', name: 'a0.mp4', url: 'blob:a0', type: 'video' };

const config: ProjectEffectConfig = {
  globalTransition: TransitionType.NONE,
  globalTransitionDuration: 0,
};

const textConfig = {
  fontConfigs: [] as { family: string; bytes: ArrayBuffer }[],
  globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  textLayers: [] as TextOverlay[],
  headings: [] as HeadingOverlay[],
};

function startDrive(fake: FakeWorker, ffmpeg: WebCodecsFfmpeg = makeFfmpeg()) {
  return driveGlRun(
    ffmpeg,
    'run_0',
    'piece_0.h264',
    [segment],
    [asset],
    config,
    1920,
    1080,
    30,
    30,
    () => undefined,
    textConfig,
    0,
    0,
    { createWorker: () => fake, now: () => Date.now() },
  );
}

function phase(
  name: string,
  seq: number,
): Extract<ExportWorkerOutboundMessage, { type: 'phase' }> {
  return {
    type: 'phase',
    phase: name,
    pieceIndex: 0,
    segmentIndex: 0,
    assetId: 'a0',
    framesEncoded: 0,
    seq,
  };
}

function doneMsg(
  phaseMs: Record<string, number>,
  frameCount = 3,
): Extract<ExportWorkerOutboundMessage, { type: 'done' }> {
  return {
    type: 'done',
    frameCount,
    phaseMs,
    instrumentationMs: 0.05,
    demuxSplit: [],
  };
}

function chunkMsg(timestamp = 0): Extract<ExportWorkerOutboundMessage, { type: 'chunk' }> {
  return {
    type: 'chunk',
    runId: 'run_0',
    bytes: new ArrayBuffer(8),
    chunkType: 'key',
    timestamp,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('driveGlRun fake-worker harness', () => {
  it('WATCHDOG_MS is unchanged at 30_000', () => {
    expect(WATCHDOG_MS).toBe(30_000);
  });

  it('receives phase messages in expected order and returns per-phase totals on done', async () => {
    const fake = new FakeWorker();
    const received: string[] = [];
    const original = fake.emit.bind(fake);
    fake.emit = (data) => {
      if (data.type === 'phase') received.push(data.phase);
      original(data);
    };

    const p = startDrive(fake);
    expect(fake.inbound[0]).toMatchObject({ type: 'init', pieceIndex: 0, startIndex: 0 });

    const order = ['gl-context', 'shader-compile', 'font-init', 'encoder-ladder', 'frame-loop'] as const;
    order.forEach((name, i) => fake.emit(phase(name, i + 1)));
    fake.emit(chunkMsg());
    fake.emit(
      doneMsg({
        'gl-context': 4,
        'shader-compile': 12,
        'font-init': 20,
        'encoder-ladder': 30,
        'frame-loop': 100,
      }),
    );

    const result = await p;
    expect(received).toEqual([...order]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.phaseMs['gl-context']).toBe(4);
    expect(result.phaseMs['shader-compile']).toBe(12);
    expect(result.phaseMs['font-init']).toBe(20);
    expect(result.phaseMs['encoder-ladder']).toBe(30);
    expect(result.phaseMs['frame-loop']).toBe(100);
    expect(result.frameCount).toBe(3);
    expect(fake.terminated).toBe(true);
  });

  it('fires the watchdog on a worker that goes silent', async () => {
    vi.useFakeTimers();
    const fake = new FakeWorker();
    const p = startDrive(fake);
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
    const result = await p;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('30s');
    expect(result.error.liveness?.lastPhase).toBe('init');
    expect(fake.terminated).toBe(true);
  });

  it('does not fire the watchdog on a normal chunk stream', async () => {
    vi.useFakeTimers();
    const fake = new FakeWorker();
    const p = startDrive(fake);
    fake.emit(chunkMsg(0));
    await vi.advanceTimersByTimeAsync(20_000);
    fake.emit(chunkMsg(1));
    await vi.advanceTimersByTimeAsync(20_000);
    fake.emit(doneMsg({ 'frame-loop': 40 }, 2));
    const result = await p;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frameCount).toBe(2);
  });

  it('does not treat phase tokens as watchdog resets (resetting set unchanged)', async () => {
    vi.useFakeTimers();
    const fake = new FakeWorker();
    const p = startDrive(fake);
    fake.emit(phase('gl-context', 1));
    fake.emit(phase('shader-compile', 2));
    fake.emit(phase('frame-loop', 3));
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
    const result = await p;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('30s');
    expect(result.error.liveness?.lastPhase).toBe('frame-loop');
  });
});
