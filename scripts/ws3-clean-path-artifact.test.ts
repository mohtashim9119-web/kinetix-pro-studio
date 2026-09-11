/**
 * WS3 Round 16 (STEP 1a) — REAL clean-path byte-neutrality artifact.
 *
 * Runs the real `exportProjectWebCodecs` orchestrator end to end — batching,
 * verify-after-append, checkpoint writes, concat, the post-concat picture-count
 * guard, mux — against a fake WORKER (the encoder is the only thing faked: it
 * replays a pre-encoded, byte-deterministic libx264 Annex-B stream one access
 * unit per frame, exactly the granularity the real worker posts) and a fake
 * ffmpeg whose every file operation is REAL disk I/O in a session directory
 * and whose `exec` spawns the REAL bundled ffmpeg sidecar binary with the
 * argv the pipeline hands it. The result is a real `export_final.mp4` written
 * by the real muxer, plus every intermediate, plus a SHA-256 of each — so two
 * commits can be compared on bytes, not on a call trace.
 *
 * Why this and not a live export: a full live export needs the Tauri IPC
 * bridge, WKWebView's `VideoEncoder`, and a GL context — none of which exist
 * headless. Everything from the encoder's output bytes onward IS the real
 * code, and that is the whole surface the durable-state work touched.
 *
 * SKIPPED unless `WS3_ARTIFACT_DIR` is set — it spawns a native binary and
 * writes ~40 MB to disk, which does not belong in `npm test`.
 *
 * Run:
 *   WS3_ARTIFACT_DIR=/path/out WS3_ARTIFACT_FIXTURES=/path/fixtures \
 *   WS3_FFMPEG_BIN=src-tauri/binaries/ffmpeg-x86_64-apple-darwin \
 *     npx vitest run scripts/ws3-clean-path-artifact.test.ts
 *
 * Fixtures (generated once with the SAME sidecar binary, byte-deterministic —
 * `-threads 1`, no B-frames, an AUD leading every access unit so the AU split
 * below needs no parser; recorded digests in the Round 16 ledger entry):
 *   ffmpeg -f lavfi -i testsrc2=size=320x180:rate=30:duration=183 \
 *     -c:v libx264 -preset ultrafast -threads 1 -bf 0 -g 30 -keyint_min 30 \
 *     -x264-params aud=1:repeat-headers=1:sliced-threads=0:threads=1 \
 *     -pix_fmt yuv420p -f h264 fixture.h264
 *   ffmpeg -f lavfi -i sine=frequency=440:sample_rate=16000:duration=183 \
 *     -ac 1 -c:a pcm_s16le fixture.wav
 *   fixture.aus.json = [[start,end], ...] — byte spans split at every
 *     4-byte-start-code AUD NAL (`00 00 00 01 09`), 5490 of them.
 *
 * This file deliberately imports NOTHING from the repo except the pipeline
 * entry point and the two message types, so the identical file runs
 * unchanged at `51e1f6b` and at the current head.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { TransitionType, AnimationType } from '../src/types';
import type { Asset, Project, VideoSegment } from '../src/types';
import type { ExportWorkerInboundMessage, ExportWorkerOutboundMessage } from '../src/services/webcodecsExport/exportWorker';

vi.mock('../src/services/plainSegment', () => ({
  isPlainVideoSegment: () => false,
  isPlainImageSegment: () => false,
}));
vi.mock('../src/services/webcodecsExport/glCompositable', () => ({
  isGlCompositableSegment: () => true,
  GL_TRANSITION_SLUGS: new Set<string>(),
}));

// eslint-disable-next-line import/first
import {
  exportProjectWebCodecs,
  type ExportWorkerHandle,
  type WebCodecsFfmpeg,
} from '../src/services/webcodecsExport/exportPipelineWebCodecs';

const OUT_DIR = process.env.WS3_ARTIFACT_DIR;
const FIXTURES = process.env.WS3_ARTIFACT_FIXTURES;
const FFMPEG_BIN = process.env.WS3_FFMPEG_BIN;

const FPS = 30;
/** Three 61 s segments, joined by NO transition: three legal piece boundaries,
 *  each piece 1830 frames — one rotation per piece at frame 1800, three
 *  pieces to concat. 5490 frames total = the fixture's AU count. */
const SEGMENT_SECONDS = 61;
/** Arm B (`WS3_ARTIFACT_SEGMENTS=2 WS3_ARTIFACT_SIZE=1280x720`) uses a 720p
 *  fixture whose ~30 KB access units match the field profile, so the 512 KiB
 *  byte trigger — not the 100-chunk count trigger — decides batch boundaries. */
const SEGMENTS = Number(process.env.WS3_ARTIFACT_SEGMENTS ?? 3);
const [WIDTH, HEIGHT] = (process.env.WS3_ARTIFACT_SIZE ?? '320x180').split('x').map(Number) as [number, number];
const FRAMES_PER_PIECE = SEGMENT_SECONDS * FPS;
const TOTAL_FRAMES = FRAMES_PER_PIECE * SEGMENTS;
const SESSION_CAP = 1800;
const SESSION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function sha256(p: string): string {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/** Picture count = AUD count. Valid for THIS fixture only (aud=1); stands in
 *  for the native access-unit scanner the real `countAnnexbFrames` runs. */
function countAuds(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i + 4 < bytes.length; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1 && bytes[i + 4] === 9) n++;
  }
  return n;
}

interface DiskFfmpeg {
  ffmpeg: WebCodecsFfmpeg;
  sessionDir: string;
  execTrace: string[][];
  calls: Record<string, number>;
  manifests: number;
}

function diskFfmpeg(sessionDir: string, ffmpegBin: string): DiskFfmpeg {
  fs.rmSync(sessionDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(sessionDir, 'deleted'), { recursive: true });
  const at = (p: string): string => path.join(sessionDir, p);
  const execTrace: string[][] = [];
  const calls: Record<string, number> = {};
  const count = (name: string): void => { calls[name] = (calls[name] ?? 0) + 1; };
  const state = { manifests: 0 };
  const ffmpeg = {
    sessionId: SESSION_ID,
    writeExportState: async (s: string) => { count('writeExportState'); state.manifests++; fs.writeFileSync(at('export_state.json'), s); },
    writeFile: async (p: string, d: Uint8Array) => { count('writeFile'); fs.writeFileSync(at(p), d); },
    writeFileRaw: async (p: string, d: Uint8Array) => { count('writeFileRaw'); fs.writeFileSync(at(p), d); },
    exec: async (args: string[]) => {
      count('exec');
      execTrace.push([...args]);
      // Mirrors `ffmpeg_exec` in ffmpeg.rs: argv verbatim, cwd = session dir.
      const r = spawnSync(ffmpegBin, args, { cwd: sessionDir, stdio: ['ignore', 'ignore', 'pipe'] });
      if (r.status !== 0) throw new Error(`ffmpeg exited with code ${r.status}: ${r.stderr?.toString().slice(-2000)}`);
      return 0;
    },
    readFile: async (p: string) => { count('readFile'); return new Uint8Array(fs.readFileSync(at(p))); },
    // Intermediates are MOVED aside rather than unlinked so they can be digested.
    deleteFile: async (p: string) => { count('deleteFile'); if (fs.existsSync(at(p))) fs.renameSync(at(p), at(path.join('deleted', p))); },
    appendFileRaw: async (p: string, d: Uint8Array) => { count('appendFileRaw'); fs.appendFileSync(at(p), d); },
    saveSessionFile: async (fileName: string, dest: string) => { count('saveSessionFile'); fs.copyFileSync(at(fileName), dest); },
    kill: async () => { count('kill'); },
    destroy: async () => { count('destroy'); },
    sessionFileSize: async (p: string) => { count('sessionFileSize'); return fs.statSync(at(p)).size; },
    countAnnexbFrames: async (p: string) => { count('countAnnexbFrames'); const pictures = countAuds(new Uint8Array(fs.readFileSync(at(p)))); return { pictures, vclNals: pictures }; },
    concatAnnexbPieces: async (parts: string[], out: string) => {
      count('concatAnnexbPieces');
      const fd = fs.openSync(at(out), 'w');
      for (const p of parts) fs.writeSync(fd, fs.readFileSync(at(p)));
      fs.closeSync(fd);
    },
    // Never legal on the clean path — throwing here is the proof.
    truncateAnnexb: async () => { throw new Error('truncateAnnexb reached on the clean path'); },
    truncateAnnexbToOffset: async () => { throw new Error('truncateAnnexbToOffset reached on the clean path'); },
    readSessionClaim: async () => null,
    sweepOrphanSessions: async () => ({ removed: [], pendingDelete: [], bytesReclaimed: 0 }),
  } as unknown as WebCodecsFfmpeg;
  return { ffmpeg, sessionDir, execTrace, calls, get manifests() { return state.manifests; } };
}

/** Replays the fixture's access units for the piece the init message describes. */
class ReplayWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  constructor(private readonly stream: Uint8Array, private readonly aus: [number, number][]) {}
  postMessage(message: unknown): void {
    const msg = message as ExportWorkerInboundMessage;
    if (msg.type !== 'init') return;
    void this.replay(msg);
  }
  terminate(): void { /* no-op */ }
  private emit(data: ExportWorkerOutboundMessage): void {
    this.onmessage?.({ data } as MessageEvent<ExportWorkerOutboundMessage>);
  }
  private async replay(init: Extract<ExportWorkerInboundMessage, { type: 'init' }>): Promise<void> {
    const pieceIndex = init.pieceIndex ?? 0;
    const base = init.frameGridBaseFrame ?? 0;
    const frames = Math.round(init.segments.reduce((s, seg) => s + seg.duration, 0) * init.fps);
    const sessions = Math.ceil(frames / SESSION_CAP);
    // Let the orchestrator's synchronous init work settle before the first message.
    await new Promise<void>((r) => setTimeout(r, 0));
    this.emit({ type: 'session-plan', pieceIndex, sessions, capFrames: SESSION_CAP, totalFrames: frames });
    for (let f = 0; f < frames; f++) {
      if (f > 0 && f % SESSION_CAP === 0) {
        await new Promise<void>((r) => setTimeout(r, 0));
        this.emit({ type: 'session-rotate', pieceIndex, sessionIndex: f / SESSION_CAP, sessions, frameIndex: f });
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      const [s, e] = this.aus[base + f]!;
      const bytes = this.stream.slice(s, e);
      this.emit({ type: 'chunk', runId: init.runId, bytes: bytes.buffer, chunkType: f % 30 === 0 ? 'key' : 'delta', timestamp: Math.round((f * 1e6) / init.fps) });
      if (f % 50 === 0) await new Promise<void>((r) => setTimeout(r, 0));
    }
    await new Promise<void>((r) => setTimeout(r, 0));
    this.emit({ type: 'run-done', runId: init.runId, frameCount: frames });
    // Diagnostics superset: fields unknown to an older commit are ignored there.
    const diagnostics = {
      phaseMs: {}, instrumentationMs: 0, demuxSplit: [], framesEncoded: frames, pieceIndex,
      lastPhase: 'encoder-flush', phaseLog: [], failure: null, demuxCacheSize: null, workerHeapBytes: null,
      decodedSourceFrames: 0, encodedChunkCount: frames, encodedKeyframeCount: Math.ceil(frames / 30), encodedChunkBytes: 0,
      encodedChunkCountAtFlushStart: frames,
      flushStartedAtMs: null, flushSettledAtMs: null, flushOutcome: 'not-observed', encodeQueueSizeAtFlushStart: null,
      encodeQueueSizeAtFlushExpiry: null, chunksReceivedDuringFlush: 0, lastChunkAtMs: null,
      encoderSessionIndex: sessions - 1, encoderSessions: sessions, appendPendingAtFailure: null,
      decodersCreated: 0, decodersOpen: 0, cursorsCreated: 0, openCursors: 0,
      peakOpenCursors: 0, openImageBitmaps: 0, frameContentDigest: null, frameContentDigestFrames: null,
      selectedHardwareRung: 'prefer-hardware', selectedCodec: 'avc1.640028',
      encoderSessionsOpened: sessions, encoderSessionsClosed: sessions,
    };
    this.emit({ type: 'done', frameCount: frames, diagnostics } as unknown as ExportWorkerOutboundMessage);
  }
}

function project(wav: Uint8Array): Project {
  const segments: VideoSegment[] = [];
  const assets: Asset[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    segments.push({
      id: `s${i}`, text: `segment ${i}`, assetId: `a${i}`, startTime: i * SEGMENT_SECONDS, duration: SEGMENT_SECONDS,
      transition: TransitionType.NONE, animation: AnimationType.NONE, order: i,
    });
    assets.push({ id: `a${i}`, name: `a${i}.mp4`, url: `blob:a${i}`, type: 'video' });
  }
  const voiceover = {
    id: 'vo', name: 'vo.wav', url: 'blob:vo', type: 'audio',
    file: { arrayBuffer: async () => wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) },
  } as unknown as Asset;
  return {
    id: 'proj-artifact', name: 'artifact', script: '', sceneDetails: '',
    segments, assets: [...assets, voiceover], voiceoverId: 'vo',
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  } as Project;
}

describe.skipIf(!OUT_DIR || !FIXTURES || !FFMPEG_BIN)('WS3 clean-path artifact', () => {
  it('exports a real MP4 through the real muxer and records every digest', async () => {
    const outDir = OUT_DIR!;
    fs.mkdirSync(outDir, { recursive: true });
    const stream = new Uint8Array(fs.readFileSync(path.join(FIXTURES!, 'fixture.h264')));
    const aus = JSON.parse(fs.readFileSync(path.join(FIXTURES!, 'fixture.aus.json'), 'utf8')) as [number, number][];
    const wav = new Uint8Array(fs.readFileSync(path.join(FIXTURES!, 'fixture.wav')));
    expect(aus.length).toBe(TOTAL_FRAMES);

    const disk = diskFfmpeg(path.join(outDir, 'session'), FFMPEG_BIN!);
    const savePath = path.join(outDir, 'export_final.mp4');
    const progress: string[] = [];
    const result = await exportProjectWebCodecs(
      project(wav), disk.ffmpeg,
      { width: WIDTH, height: HEIGHT, fps: FPS, savePath },
      (p) => { progress.push(p.type); },
      { createWorker: () => new ReplayWorker(stream, aus) },
    );
    if (!result.ok) throw new Error(`export failed: ${JSON.stringify(result.error).slice(0, 2000)}`);

    const digests: Record<string, string> = { 'export_final.mp4': sha256(savePath) };
    for (const f of ['video_all.h264', 'piece_0.h264', 'piece_1.h264', 'piece_2.h264', 'voiceover_audio', 'video_all.h264.premux.mp4']) {
      const p = path.join(disk.sessionDir, 'deleted', f);
      if (fs.existsSync(p)) digests[f] = sha256(p);
    }
    const report = {
      digests,
      inputDigests: {
        'fixture.h264': sha256(path.join(FIXTURES!, 'fixture.h264')),
        'fixture.wav': sha256(path.join(FIXTURES!, 'fixture.wav')),
      },
      sizes: Object.fromEntries(Object.keys(digests).map((f) => [f, fs.statSync(f === 'export_final.mp4' ? savePath : path.join(disk.sessionDir, 'deleted', f)).size])),
      calls: disk.calls,
      manifestsWritten: disk.manifests,
      execTrace: disk.execTrace,
      frames: TOTAL_FRAMES,
    };
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
    expect(digests['video_all.h264']).toBeDefined();
    expect(fs.statSync(savePath).size).toBeGreaterThan(0);
  }, 600_000);
});
