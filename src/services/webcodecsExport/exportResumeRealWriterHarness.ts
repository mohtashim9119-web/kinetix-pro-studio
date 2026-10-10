/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared harness for the "real checkpoint writer" resume tests. What is REAL
// here: the orchestrator, the checkpoint writer, the manifest serialisation
// and validation, discovery, and the fence's byte logic (the JS twin of the
// native repair, over real Annex-B bytes in memory). What is FAKE: the
// process boundary (ffmpeg IPC, the worker thread) and the encoders. The
// manifests in these tests are NEVER hand-written — they are whatever the real
// writer put through `writeExportState`, which is the gap the G2 test left
// open.

import { vi } from 'vitest';
import type { ExportWorkerInboundMessage, ExportWorkerOutboundMessage } from './exportWorker';
import { NO_FLUSH_OBSERVATION, type ExportWorkerDiagnosticsPayload } from './exportWorkerDiagnostics';
import {
  buildSyntheticSingleSliceWithParamSets,
  countAnnexbAccessUnits,
  scanAnnexbNals,
  truncateAnnexbToLastCompleteAu,
} from './annexbFrameCount';
import type { ExportWorkerHandle, WebCodecsFfmpeg } from './exportPipelineWebCodecs';
import type { ResumeDiscoveryIo, ResumeSessionHandle } from './exportResumeDiscovery';

export const FPS = 30;
export const SESSION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/** One GL/canvas piece of `frames` pictures, shaped like real encoder output. */
export function makeStream(frames: number): { stream: Uint8Array; au: (i: number) => Uint8Array } {
  const stream = buildSyntheticSingleSliceWithParamSets(frames);
  const nals = scanAnnexbNals(stream);
  const starts: number[] = [];
  for (let i = 0; i < nals.length; i++) {
    if (nals[i]!.nalType !== 1 && nals[i]!.nalType !== 5) continue;
    let j = i - 1;
    while (j >= 0 && nals[j]!.nalType !== 1 && nals[j]!.nalType !== 5) j--;
    starts.push(nals[j + 1]!.start);
  }
  if (starts.length !== frames) throw new Error(`fixture has ${starts.length} access units, expected ${frames}`);
  return { stream, au: (i) => stream.subarray(starts[i]!, starts[i + 1] ?? stream.length) };
}

export interface ByteFfmpeg {
  ffmpeg: WebCodecsFfmpeg;
  files: Map<string, Uint8Array>;
  /** Every manifest the REAL writer serialised, oldest first. */
  manifests: string[];
  /** The newest manifest as it would be on disk (what a re-entered session reads). */
  manifestOnDisk(): string | null;
  /** The last `concatAnnexbPieces` call: which parts, and how many pictures it produced. */
  lastConcat(): { parts: string[]; pictures: number } | null;
  /** Native `ffmpeg_destroy_session` rule: forced → gone; unforced + manifest → retained. */
  destroyed(): boolean;
}

/**
 * A byte-real fake ffmpeg. `exec` writes a synthetic `framesPerPiece`-picture
 * Annex-B file for any `.h264` output (what the canvas/plain remux produces).
 */
export function byteFfmpeg(opts: { seed?: Record<string, Uint8Array>; framesPerPiece?: number } = {}): ByteFfmpeg {
  const files = new Map<string, Uint8Array>(Object.entries(opts.seed ?? {}));
  const manifests: string[] = [];
  let wasDestroyed = false;
  let lastConcat: { parts: string[]; pictures: number } | null = null;
  const read = (p: string): Uint8Array => files.get(p) ?? new Uint8Array();
  const piece = opts.framesPerPiece !== undefined ? makeStream(opts.framesPerPiece).stream : null;
  const ffmpeg = {
    sessionId: SESSION_ID,
    writeExportState: vi.fn(async (s: string) => { manifests.push(s); }),
    writeFile: vi.fn(async (p: string, d: Uint8Array) => { files.set(p, d); }),
    writeFileRaw: vi.fn(async () => undefined),
    exec: vi.fn(async (args: string[]) => {
      const out = args[args.length - 1]!;
      if (piece && out.endsWith('.h264')) files.set(out, piece.slice());
      return 0;
    }),
    readFile: vi.fn(async (p: string) => read(p)),
    deleteFile: vi.fn(async (p: string) => { files.delete(p); }),
    appendFileRaw: vi.fn(async (p: string, d: Uint8Array) => {
      const prev = read(p);
      const next = new Uint8Array(prev.length + d.length);
      next.set(prev, 0);
      next.set(d, prev.length);
      files.set(p, next);
    }),
    saveSessionFile: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    destroy: vi.fn(async (o?: { force?: boolean }) => {
      if (!o?.force && manifests.length > 0) return { disposition: 'refused_manifest' };
      wasDestroyed = true;
      files.clear();
      return { disposition: 'destroyed' };
    }),
    sessionFileSize: vi.fn(async (p: string) => read(p).length),
    countAnnexbFrames: vi.fn(async (p: string) => countAnnexbAccessUnits(read(p))),
    concatAnnexbPieces: vi.fn(async (parts: string[], out: string) => {
      const total = parts.reduce((n, p) => n + read(p).length, 0);
      const buf = new Uint8Array(total);
      let at = 0;
      for (const p of parts) { buf.set(read(p), at); at += read(p).length; }
      files.set(out, buf);
      lastConcat = { parts: [...parts], pictures: countAnnexbAccessUnits(buf).pictures };
    }),
    truncateAnnexb: vi.fn(async (p: string) => ({ pictures: countAnnexbAccessUnits(read(p)).pictures, vclNals: 0, bytesRemoved: 0, keptBytes: read(p).length })),
    truncateAnnexbToOffset: vi.fn(async (p: string, off: number) => {
      const prev = read(p);
      files.set(p, prev.slice(0, off));
      return { ...countAnnexbAccessUnits(prev.slice(0, off)), bytesRemoved: prev.length - off, keptBytes: off };
    }),
  } as unknown as WebCodecsFfmpeg;
  return {
    ffmpeg, files, manifests,
    manifestOnDisk: () => manifests[manifests.length - 1] ?? null,
    lastConcat: () => lastConcat,
    destroyed: () => wasDestroyed,
  };
}

/** What a re-entered session looks like to discovery — over the SAME bytes. */
export function discoveryIoFor(fake: ByteFfmpeg): ResumeDiscoveryIo {
  const read = (p: string): Uint8Array => fake.files.get(p) ?? new Uint8Array();
  const handle: ResumeSessionHandle = {
    sessionId: SESSION_ID,
    readExportState: async () => new TextEncoder().encode(fake.manifestOnDisk() ?? ''),
    sessionFileSize: async (p) => {
      if (!fake.files.has(p)) throw new Error(`no such file ${p}`);
      return read(p).length;
    },
    // Mirrors `prepare_checkpoint_resume_inner` (ffmpeg.rs): at EOF count, else
    // conservative whole-AU repair; refuse if that fell below the checkpoint;
    // exact cut; recount.
    prepareCheckpointResume: async (p, cp) => {
      const bytes = read(p);
      const inferredKept = bytes.length === cp.byteOffset ? bytes.length : truncateAnnexbToLastCompleteAu(bytes).bytes.length;
      if (inferredKept < cp.byteOffset) {
        throw new Error(`canonical AU repair kept ${inferredKept} bytes, before checkpoint offset ${cp.byteOffset}`);
      }
      const kept = bytes.slice(0, cp.byteOffset);
      fake.files.set(p, kept);
      const counted = countAnnexbAccessUnits(kept);
      return { pictures: counted.pictures, vclNals: counted.vclNals, bytesRemoved: bytes.length - kept.length, keptBytes: kept.length };
    },
    truncateAnnexbToOffset: async (p, off) => {
      const prev = read(p);
      fake.files.set(p, prev.slice(0, off));
      return { ...countAnnexbAccessUnits(prev.slice(0, off)), bytesRemoved: prev.length - off, keptBytes: off };
    },
    clearResumeFence: async () => undefined,
    destroy: async () => undefined,
  };
  return {
    listResumableSessionIds: async () => (fake.manifestOnDisk() ? [SESSION_ID] : []),
    reenter: async () => handle,
  };
}

export class FakeWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  initMessages: Extract<ExportWorkerInboundMessage, { type: 'init' }>[] = [];
  postMessage(message: unknown): void {
    const msg = message as ExportWorkerInboundMessage;
    if (msg.type === 'init') this.initMessages.push(msg);
  }
  terminate(): void { /* no-op */ }
  emit(data: ExportWorkerOutboundMessage): void {
    this.onmessage?.({ data } as MessageEvent<ExportWorkerOutboundMessage>);
  }
}

export function diagnostics(frames: number, sessions: number): ExportWorkerDiagnosticsPayload {
  return {
    phaseMs: {}, instrumentationMs: 0, demuxSplit: [], framesEncoded: frames, pieceIndex: 0,
    lastPhase: 'encoder-flush', phaseLog: [], failure: null, demuxCacheSize: null, workerHeapBytes: null,
    decodedSourceFrames: 0, encodedChunkCount: frames, encodedKeyframeCount: 1, encodedChunkBytes: 0,
    encodedChunkCountAtFlushStart: frames,
    ...NO_FLUSH_OBSERVATION,
    encoderSessionIndex: 0, encoderSessions: sessions, appendPendingAtFailure: null,
    decodersCreated: 0, decodersOpen: 0, cursorsCreated: 0, openCursors: 0,
    peakOpenCursors: 0, openImageBitmaps: 0, frameContentDigest: null, frameContentDigestFrames: null,
  };
}

/** Microtasks + one macrotask (the timeline hash settles on a macrotask). */
export async function flush(ticks = 40): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

export interface Rotation { sessionIndex: number; frameIndex: number }

/** Feeds the worker's side of a GL run for frames `[fromFrame, toFrame)`. Does NOT finish the run. */
export async function feedFrames(
  fake: FakeWorker,
  au: (i: number) => Uint8Array,
  fromFrame: number,
  toFrame: number,
  rotations: readonly Rotation[],
  totalFrames: number,
  sessions: number,
  pieceIndex = 0,
): Promise<void> {
  fake.emit({ type: 'session-plan', pieceIndex, sessions, capFrames: 300, totalFrames });
  for (let frame = fromFrame; frame < toFrame; frame++) {
    const rotation = rotations.find((r) => r.frameIndex === frame);
    if (rotation) {
      await flush();
      fake.emit({ type: 'session-rotate', pieceIndex, sessionIndex: rotation.sessionIndex, sessions, frameIndex: frame });
      await flush();
    }
    const b = au(frame);
    const copy = new Uint8Array(b.length);
    copy.set(b);
    fake.emit({ type: 'chunk', runId: `run_${pieceIndex}`, bytes: copy.buffer, chunkType: frame === 0 ? 'key' : 'delta', timestamp: frame });
  }
  await flush();
}

export async function finishRun(fake: FakeWorker, totalFrames: number, sessions: number, pieceIndex = 0): Promise<void> {
  fake.emit({ type: 'run-done', runId: `run_${pieceIndex}`, frameCount: totalFrames });
  fake.emit({ type: 'done', frameCount: totalFrames, diagnostics: { ...diagnostics(totalFrames, sessions), pieceIndex } });
  await flush();
}
