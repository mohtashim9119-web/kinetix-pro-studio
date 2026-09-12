/**
 * WS3 Round 21 — ENOSPC driven THROUGH the real `exportProjectWebCodecs`.
 *
 * Three rows, one per place a full disk can bite:
 *   PREFLIGHT  — refused before any worker is built or byte written (D1);
 *   APPEND     — settles immediately with the typed error, no bound fires,
 *                the recovery budget is untouched, nothing is truncated,
 *                no seal is offered (D3 a/b);
 *   MUX        — the field failure: typed error, the destination is never
 *                touched, no seal, the premux intermediate is still cleaned
 *                up (D3, D4).
 *
 * Same harness shape as `recoveryMatrix.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, Project, VideoSegment } from '../../types';
import type { ExportWorkerInboundMessage, ExportWorkerOutboundMessage } from './exportWorker';
import { NO_FLUSH_OBSERVATION, type ExportWorkerDiagnosticsPayload } from './exportWorkerDiagnostics';
import type { ForcedMp4SealOffer } from './muxOnly';
import type { ExportStateManifest } from './exportCheckpoint';

vi.mock('../plainSegment', () => ({ isPlainVideoSegment: () => false, isPlainImageSegment: () => false }));
vi.mock('./glCompositable', () => ({ isGlCompositableSegment: () => true, GL_TRANSITION_SLUGS: new Set<string>() }));

// eslint-disable-next-line import/first
import { exportProjectWebCodecs, type ExportWorkerHandle, type WebCodecsFfmpeg } from './exportPipelineWebCodecs';
// eslint-disable-next-line import/first
import { estimateExportDiskBytes } from './diskFull';

const FRAMES = 30;
const FPS = 30;
const SESSION_ID = 'kinetix-export-00000000-0000-4000-8000-000000000021';

class FakeWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  initMessages: Extract<ExportWorkerInboundMessage, { type: 'init' }>[] = [];
  terminated = 0;
  postMessage(m: unknown): void {
    const msg = m as ExportWorkerInboundMessage;
    if (msg.type === 'init') this.initMessages.push(msg);
  }
  terminate(): void {
    this.terminated++;
  }
  emit(data: ExportWorkerOutboundMessage): void {
    this.onmessage?.({ data } as MessageEvent<ExportWorkerOutboundMessage>);
  }
}

const segment: VideoSegment = {
  id: 's0', text: '', assetId: 'a0', startTime: 0, duration: 1,
  transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0,
};
const asset: Asset = { id: 'a0', name: 'a0.mp4', url: 'blob:a0', type: 'video' };
const voiceover: Asset = {
  id: 'vo', name: 'vo.wav', url: 'blob:vo', type: 'audio',
  file: new File([new Uint8Array(4096)], 'vo.wav'),
};
function project(withVoiceover = false): Project {
  return {
    id: 'proj-disk', name: 'T', script: '', sceneDetails: '',
    segments: [segment], assets: withVoiceover ? [asset, voiceover] : [asset],
    ...(withVoiceover ? { voiceoverId: 'vo' } : {}),
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  };
}

function diagnostics(o: Partial<ExportWorkerDiagnosticsPayload> = {}): ExportWorkerDiagnosticsPayload {
  return {
    phaseMs: {}, instrumentationMs: 0, demuxSplit: [], framesEncoded: FRAMES, pieceIndex: 0,
    lastPhase: 'encoder-flush', phaseLog: [], failure: null, demuxCacheSize: null, workerHeapBytes: null,
    decodedSourceFrames: 0, encodedChunkCount: FRAMES, encodedKeyframeCount: 1, encodedChunkBytes: 0,
    encodedChunkCountAtFlushStart: FRAMES,
    ...NO_FLUSH_OBSERVATION,
    encoderSessionIndex: 0, encoderSessions: 1, appendPendingAtFailure: null,
    decodersCreated: 0, decodersOpen: 0, cursorsCreated: 0, openCursors: 0,
    peakOpenCursors: 0, openImageBitmaps: 0, frameContentDigest: null, frameContentDigestFrames: null,
    ...o,
  };
}
function chunk(i: number, size: number): Extract<ExportWorkerOutboundMessage, { type: 'chunk' }> {
  const b = new Uint8Array(size); b[0] = i & 0xff;
  return { type: 'chunk', runId: 'run_0', bytes: b.buffer.slice(0) as ArrayBuffer, chunkType: i === 0 ? 'key' : 'delta', timestamp: i };
}
async function flush(ticks = 40): Promise<void> { for (let i = 0; i < ticks; i++) await Promise.resolve(); }

const ENOSPC_APPEND = '[disk-full] append_file_raw(piece_0.h264): write: No space left on device (os error 28)';
const ENOSPC_FFMPEG =
  '[disk-full] ffmpeg exited with code -28 (No space left on device): ' +
  '[aost#0:1/aac] No space left on device\n[out#0/mp4] Error writing trailer: No space left on device\n[out#0/mp4] Error closing file: No space left on device';

function harness(o: {
  appendThrows?: boolean;
  execThrowsOnCall?: number;
  freeBytes?: number | null;
} = {}) {
  const calls: string[] = [];
  const manifests: string[] = [];
  const landed = new Map<string, number>();
  let execCalls = 0;
  const ffmpeg = {
    sessionId: SESSION_ID,
    writeExportState: vi.fn(async (s: string) => { manifests.push(s); }),
    writeFile: vi.fn(async () => { calls.push('writeFile'); }),
    writeFileRaw: vi.fn(async () => undefined),
    exec: vi.fn(async () => {
      execCalls++;
      calls.push('exec');
      if (o.execThrowsOnCall !== undefined && execCalls === o.execThrowsOnCall) throw new Error(ENOSPC_FFMPEG);
      return 0;
    }),
    readFile: vi.fn(async () => new Uint8Array()),
    deleteFile: vi.fn(async (p: string) => { calls.push(`deleteFile:${p}`); }),
    appendFileRaw: vi.fn(async (p: string, data: Uint8Array) => {
      calls.push('appendFileRaw');
      if (o.appendThrows) throw new Error(ENOSPC_APPEND);
      landed.set(p, (landed.get(p) ?? 0) + data.byteLength);
    }),
    saveSessionFile: vi.fn(async () => { calls.push('saveSessionFile'); }),
    kill: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    sessionFileSize: vi.fn(async (p: string) => landed.get(p) ?? 1_700_000_000),
    countAnnexbFrames: vi.fn(async () => { calls.push('countAnnexbFrames'); return { pictures: FRAMES, vclNals: FRAMES }; }),
    concatAnnexbPieces: vi.fn(async () => undefined),
    truncateAnnexb: vi.fn(async () => { calls.push('truncateAnnexb'); return { pictures: FRAMES, vclNals: FRAMES, bytesRemoved: 0, keptBytes: 1 }; }),
    truncateAnnexbToOffset: vi.fn(async () => { calls.push('truncateAnnexbToOffset'); return { pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 }; }),
    ...(o.freeBytes === undefined
      ? {}
      : {
          volumeFreeSpace: vi.fn(async (dest: string | null) => {
            calls.push('volumeFreeSpace');
            const avail = o.freeBytes ?? 1e15;
            return [
              { path: `/fake-vol/${SESSION_ID}`, probedPath: `/fake-vol/${SESSION_ID}`, volumeKey: 'dev:1', availableBytes: avail },
              ...(dest ? [{ path: dest, probedPath: '/Users/me', volumeKey: 'dev:1', availableBytes: avail }] : []),
            ];
          }),
        }),
  } as unknown as WebCodecsFfmpeg & { volumeFreeSpace?: unknown };
  return { ffmpeg, calls, manifests };
}

function lastManifest(manifests: string[]): ExportStateManifest | null {
  return manifests.length ? (JSON.parse(manifests[manifests.length - 1]!) as ExportStateManifest) : null;
}

describe('disk-full wiring (Round 21)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('PREFLIGHT — refused before any worker is built or byte written, with required/available bytes and the volume', async () => {
    const h = harness({ freeBytes: 1_000 });
    let workers = 0;
    const consent = vi.fn(async (_o: ForcedMp4SealOffer) => true);
    const result = await exportProjectWebCodecs(
      project(true), h.ffmpeg,
      { width: 1920, height: 1080, fps: FPS, destinationPath: '/Users/me/out.mp4', requestForcedSealConsent: consent },
      () => undefined,
      { createWorker: () => { workers++; return new FakeWorker(); } },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('disk_full');
    expect(result.error.diskFull?.phase).toBe('preflight');
    const est = estimateExportDiskBytes({ fps: FPS, pieces: [{ tier: 'gl', expectedFrames: FRAMES }], voiceover: { bytes: 4096 } });
    // Temp and destination share `dev:1`, so the two requirements are summed.
    expect(result.error.diskFull?.requiredBytes).toBe(est.tempRequiredBytes + est.destinationRequiredBytes);
    expect(result.error.diskFull?.availableBytes).toBe(1_000);
    expect(result.error.diskFull?.volumePath).toBe(`/fake-vol/${SESSION_ID}`);
    expect(result.error.message).toMatch(/^The export ran out of disk space on the volume holding .*\(preflight\)\. Needs about .*, .* free\.$/);
    // NOTHING ran.
    expect(workers).toBe(0);
    expect(h.calls.filter((c) => c !== 'volumeFreeSpace')).toEqual([]);
    expect(h.manifests).toHaveLength(0);
    expect(consent).not.toHaveBeenCalled();
  });

  it('PREFLIGHT — a fake without volumeFreeSpace, or a healthy volume, runs unchanged', async () => {
    for (const h of [harness(), harness({ freeBytes: null })]) {
      const fake = new FakeWorker();
      const p = exportProjectWebCodecs(project(), h.ffmpeg, { width: 1920, height: 1080, fps: FPS }, () => undefined, { createWorker: () => fake });
      await flush();
      fake.emit(chunk(0, 8));
      fake.emit({ type: 'run-done', runId: 'run_0', frameCount: FRAMES });
      fake.emit({ type: 'done', frameCount: FRAMES, diagnostics: diagnostics() });
      await flush();
      const result = await p;
      expect(result.ok).toBe(true);
    }
  });

  it('APPEND — ENOSPC settles the run immediately: typed error, no bound, budget untouched, no truncate, no seal', async () => {
    const h = harness({ appendThrows: true });
    const consent = vi.fn(async (_o: ForcedMp4SealOffer) => true);
    const fake = new FakeWorker();
    const p = exportProjectWebCodecs(
      project(), h.ffmpeg,
      { width: 1920, height: 1080, fps: FPS, requestForcedSealConsent: consent },
      () => undefined, { createWorker: () => fake },
    );
    await flush();
    // One batch's worth (> APPEND_BATCH_BYTES = 512 KiB) so the append fires
    // on the chunk itself rather than on 'done' or the 1 s age timer.
    fake.emit(chunk(0, 600 * 1024));
    await flush();
    // Before Round 21 this promise stayed pending until the 30 s watchdog /
    // 45 s stall bound — the worker was never told 'done' here on purpose.
    const settled = await Promise.race([p.then(() => true), flush(200).then(() => false)]);
    expect(settled, 'the run must settle without waiting for a liveness bound').toBe(true);
    const result = await p;
    await new Promise((r) => setTimeout(r, 20));
    await flush();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('disk_full');
    expect(result.error.diskFull?.phase).toBe('append');
    expect(result.error.message).toBe('The export ran out of disk space (append).');
    expect(result.error.cause).toContain('append_file_raw(piece_0.h264)');
    expect(result.error.liveness?.failureVia).toBe('append-error');
    expect(fake.terminated).toBeGreaterThanOrEqual(1);
    // (a) the recovery budget is NOT charged.
    expect(fake.initMessages).toHaveLength(1);
    const m = lastManifest(h.manifests);
    expect(m).not.toBeNull();
    expect(m!.boundaryRewindsUsed ?? 0).toBe(0);
    expect(m!.hardwareFailoverUsed ?? false).toBe(false);
    expect(m!.checkpointResumeAttempts ?? 0).toBe(0);
    expect(m!.totalRecoveryAttempts ?? 0).toBe(0);
    // (b) no forced sealing, no truncate-to-last-keyframe.
    expect(consent).not.toHaveBeenCalled();
    expect(h.calls).not.toContain('truncateAnnexb');
    expect(h.calls).not.toContain('truncateAnnexbToOffset');
    expect(h.calls).not.toContain('countAnnexbFrames');
    expect(h.calls).not.toContain('exec');
    expect(h.calls).not.toContain('saveSessionFile');
  });

  it('MUX — the field failure: typed error, destination never touched, no seal, premux still cleaned up', async () => {
    // exec #1 = video premux (ok), exec #2 = audio mux (ENOSPC).
    const h = harness({ execThrowsOnCall: 2 });
    const consent = vi.fn(async (_o: ForcedMp4SealOffer) => true);
    const fake = new FakeWorker();
    const p = exportProjectWebCodecs(
      project(true), h.ffmpeg,
      { width: 1920, height: 1080, fps: FPS, savePath: '/Users/me/out.mp4', requestForcedSealConsent: consent },
      () => undefined, { createWorker: () => fake },
    );
    await flush();
    fake.emit(chunk(0, 8));
    fake.emit({ type: 'run-done', runId: 'run_0', frameCount: FRAMES });
    fake.emit({ type: 'done', frameCount: FRAMES, diagnostics: diagnostics() });
    await flush();
    const result = await p;
    // The manifest's first write waits on the async timeline hash.
    await new Promise((r) => setTimeout(r, 20));
    await flush();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('disk_full');
    expect(result.error.diskFull?.phase).toBe('mux');
    expect(result.error.liveness?.lastPhase).toBe('mux');
    // (c) one sentence + numbers on the message; the ffmpeg tail capped in cause.
    expect(result.error.message).toBe('The export ran out of disk space (mux).');
    expect(result.error.cause).toContain('No space left on device');
    expect(result.error.cause!.length).toBeLessThanOrEqual(1_503);
    // (D4) the destination is never touched by a mux failure.
    expect(h.calls).not.toContain('saveSessionFile');
    // (b) no seal, no truncate.
    expect(consent).not.toHaveBeenCalled();
    expect(h.calls).not.toContain('truncateAnnexb');
    // The premux intermediate is still deleted by muxOnly's `finally`.
    expect(h.calls).toContain('deleteFile:piece_0.h264.premux.mp4');
    // Budget untouched.
    const m = lastManifest(h.manifests);
    expect(m!.totalRecoveryAttempts ?? 0).toBe(0);
    expect(m!.boundaryRewindsUsed ?? 0).toBe(0);
  });
});
