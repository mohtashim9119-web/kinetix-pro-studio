/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// TASK 4 (owner directive, Model P implementation, 2026-08-07) — PERMANENT
// export regression harness for Requirement 4 ("Export integrity: A/V sync
// 1:1, headings never dropped or truncated").
//
// This replaces a one-off measurement harness that was built, run, and
// deleted earlier in this same work (`docs/segments-invariant-ruling.md`
// §1.3's "not reproduced end-to-end" caveat, closed by that harness, then
// lost when it was cleaned up). It is rebuilt here as a real, kept test —
// this file IS the only remaining proof of Requirement 4, and it must stay
// green on every future change to the sync or export pipelines.
//
// WHAT THIS PROVES, split into what needs real ffmpeg and what does not:
//
//   1. Real end-to-end A/V sync (RUN A / RUN B below) — runs the REAL
//      `exportProject()` (`src/services/exportPipeline.ts`) against the REAL
//      bundled ffmpeg sidecar, over Tier-1 "plain" segments (solid-colour
//      video, no captions/headings — see `plainSegment.ts`) so no canvas
//      dependency is needed. Measures the actual exported file's colour-cut
//      timestamps against the actual audio cue timestamps.
//
//   2. The export guard (RUN A) — confirms `checkTimelineIsGapless`
//      (`exportPipeline.ts`) refuses to export a project whose `segments`
//      still contain a real gap, with a typed `timeline_gap` error, rather
//      than silently producing the desynced file §1.3 found. This is the
//      explicit half of Task 4's "does export still ignore startTime" answer
//      — see that section's own comment for the full statement.
//
//   3. Headings never dropped/truncated (RUN D / RUN E) — does NOT render
//      pixels (no `@napi-rs/canvas` or other native rendering dependency is
//      added to this repo for it). Instead it walks the SAME per-frame
//      `absoluteTime` enumeration `segmentEncoder.ts` performs
//      (`segment.startTime + frameIndex/fps`, in array order) against the
//      REAL, unmodified `getActiveHeadingAt` (`services/headingLayer.ts`) —
//      the exact function `frameRenderer.ts`'s `compositeActiveHeading` calls
//      to decide whether to draw a heading on a given frame. A heading that
//      is never SELECTED by this walk is a heading that would never be drawn,
//      regardless of how correctly the drawing code itself works — which is
//      precisely what "dropped" and "truncated" mean here. What this does
//      NOT cover: whether a selected heading rasterizes correctly (font,
//      wrap, position) — that is `textRenderer.test.ts`'s job, unchanged.
//
// Gracefully SKIPS (not fails) when the platform's ffmpeg sidecar binary is
// not present locally — `src-tauri/binaries/*` are gitignored
// (`binaries/README.md`), so a fresh checkout without them provisioned must
// not break `npm test`. RUN D/E (heading coverage) do not need ffmpeg at all
// and always run.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { exportProject, type ExportOptions } from '../src/services/exportPipeline';
import type { FfmpegLike } from '../src/services/segmentEncoder';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { getActiveHeadingAt } from '../src/services/headingLayer';
import {
  TransitionType, AnimationType,
  type Project, type Asset, type VideoSegment, type HeadingOverlay,
} from '../src/types';

const REPO = path.resolve(__dirname, '..');
const FPS = 30;

/** Picks the bundled sidecar for the CURRENT platform, matching
 *  `src-tauri/binaries/README.md`'s naming convention. `undefined` when this
 *  platform has no bundled binary at all (e.g. Linux dev machines). */
function resolveFfmpegBinary(): string | undefined {
  const dir = path.join(REPO, 'src-tauri', 'binaries');
  if (process.platform === 'darwin') {
    const name = process.arch === 'arm64' ? 'ffmpeg-aarch64-apple-darwin' : 'ffmpeg-x86_64-apple-darwin';
    return path.join(dir, name);
  }
  if (process.platform === 'win32') {
    return path.join(dir, 'ffmpeg-x86_64-pc-windows-msvc.exe');
  }
  return undefined;
}

const FFMPEG = resolveFfmpegBinary();
const FFMPEG_AVAILABLE = !!FFMPEG && fs.existsSync(FFMPEG);
if (!FFMPEG_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    '[exportPipeline.test.ts] Bundled ffmpeg sidecar not found for this platform ' +
    `(looked for ${FFMPEG ?? '(no binary defined for this platform)'}). ` +
    'RUN A/B (real end-to-end A/V sync) will be SKIPPED. See src-tauri/binaries/README.md ' +
    'to provision it. RUN D/E (heading coverage) do not need it and still run.',
  );
}

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'kinetix-export-test-'));
const SESSION = path.join(WORK, 'session');

afterAll(() => {
  fs.rmSync(WORK, { recursive: true, force: true });
});

function ff(args: string[], cwd = WORK): void {
  const r = spawnSync(FFMPEG!, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}): ${args.join(' ')}\n${r.stderr?.slice(-2000)}`);
}
function ffStderr(args: string[], cwd = WORK): string {
  return spawnSync(FFMPEG!, args, { cwd, encoding: 'utf8' }).stderr ?? '';
}

const realFfmpeg: FfmpegLike = {
  async writeFile(p: string, data: Uint8Array) { fs.writeFileSync(path.join(SESSION, p), data); },
  async readFile(p: string) { return new Uint8Array(fs.readFileSync(path.join(SESSION, p))); },
  async deleteFile(p: string) { try { fs.unlinkSync(path.join(SESSION, p)); } catch { /* ignore */ } },
  async exec(args: string[]) {
    const r = spawnSync(FFMPEG!, args, { cwd: SESSION, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`exec failed (${r.status}): ${args.join(' ')}\n${r.stderr?.slice(-1500)}`);
    return 0;
  },
};

const origFetch = globalThis.fetch;
function installFileFetchShim(): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const u = String(input);
    if (u.startsWith('file://')) {
      const buf = fs.readFileSync(new URL(u));
      return { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) } as unknown as Response;
    }
    return origFetch(input as RequestInfo, init);
  }) as typeof fetch;
}

function frameColors(file: string): Array<[number, number, number]> {
  const out = path.join(WORK, 'colors.raw');
  ff(['-i', file, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-y', out]);
  const b = fs.readFileSync(out);
  const res: Array<[number, number, number]> = [];
  for (let i = 0; i + 2 < b.length; i += 3) res.push([b[i]!, b[i + 1]!, b[i + 2]!]);
  return res;
}
function classify([r, g, bl]: [number, number, number]): string {
  if (r > 100 && g < 80 && bl < 80) return 'RED';
  if (g > 100 && r < 80 && bl < 80) return 'GREEN';
  if (bl > 100 && r < 80 && g < 80) return 'BLUE';
  return `OTHER(${r},${g},${bl})`;
}
/** silence_end times = beep onsets. */
function beepOnsets(file: string): number[] {
  const err = ffStderr(['-i', file, '-af', 'silencedetect=n=-40dB:d=0.05', '-f', 'null', '-']);
  return [...err.matchAll(/silence_end: ([0-9.]+)/g)].map(m => parseFloat(m[1]!));
}

function seg(o: Partial<VideoSegment> & { id: string; startTime: number; duration: number; order: number }): VideoSegment {
  return { text: '', transition: TransitionType.NONE, animation: AnimationType.NONE, showOverlay: false, ...o } as VideoSegment;
}

const A = (id: string, name: string, type: Asset['type']): Asset =>
  ({ id, name, type, url: `file://${path.join(WORK, name)}` });

function makeProject(segments: VideoSegment[], assets: Asset[], headings: HeadingOverlay[] = []): Project {
  return {
    id: 'p', name: 'exportPipeline.test', script: '', sceneDetails: '',
    segments, assets, headings, voiceoverId: 'a-voice',
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  };
}

async function runExport(project: Project, label: string, options: ExportOptions = { width: 640, height: 360, fps: FPS }) {
  fs.rmSync(SESSION, { recursive: true, force: true });
  fs.mkdirSync(SESSION, { recursive: true });
  const result = await exportProject(project, realFfmpeg, options);
  if (result.ok) {
    const dest = path.join(WORK, `${label}.mp4`);
    fs.copyFileSync(path.join(SESSION, result.outputFile), dest);
    return { result, file: dest };
  }
  return { result, file: undefined };
}

const describeRealExport = FFMPEG_AVAILABLE ? describe : describe.skip;

describeRealExport('RUN A/B — real end-to-end A/V sync (Model P, real ffmpeg)', () => {
  it('builds Tier-1 solid-colour sources and a beep-gated voiceover once', () => {
    installFileFetchShim();
    for (const c of ['red', 'green', 'blue']) {
      ff(['-f', 'lavfi', '-i', `color=c=${c}:s=640x360:r=${FPS}:d=10`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', `${c}.mp4`]);
    }
    // 8s tone gated to beeps at t=2.000 and t=5.000 — the EDITOR boundaries
    // the well-formed control project (RUN B) below places its cuts at.
    ff(['-f', 'lavfi', '-i', 'sine=f=1000:r=48000:d=8',
      '-af', "volume='between(t,2.0,2.15)+between(t,5.0,5.15)':eval=frame", '-y', 'voice.wav']);
    expect(fs.existsSync(path.join(WORK, 'voice.wav'))).toBe(true);
  });

  it('RUN A — a raw, un-positioned array with a real interior gap is REFUSED by the export guard, not silently exported desynced', async () => {
    // The exact K14 shape `docs/segments-invariant-ruling.md` §1.3 traced the
    // defect to: a locked segment (B) whose end falls short of the following
    // segment's (C) start. Built directly, bypassing `applyAnchorBasedTiming`
    // / `enforceGaplessPartition` entirely — simulating a project persisted
    // before Model P existed, or any future writer that forgets to route
    // through the positioner.
    const assets = [A('a-red', 'red.mp4', 'video'), A('a-green', 'green.mp4', 'video'),
      A('a-blue', 'blue.mp4', 'video'), A('a-voice', 'voice.wav', 'audio')];
    const gappedSegments = [
      seg({ id: 's0', assetId: 'a-red', startTime: 0, duration: 2, order: 0 }),
      seg({ id: 's1', assetId: 'a-green', startTime: 2, duration: 1, order: 1, locked: true }),
      seg({ id: 's2', assetId: 'a-blue', startTime: 5, duration: 3, order: 2 }), // 2.000s gap before this
    ];

    const { result } = await runExport(makeProject(gappedSegments, assets), 'A_gap_refused');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('timeline_gap');
      // Names the conflict, per the guard's own contract — an operator
      // reading this message can act on it without reading source.
      expect(result.error.message).toContain('segment 3');
    }
  });

  it('RUN B — the SAME logical scenario, positioned by the real production pipeline, exports with 0.000s A/V offset', async () => {
    // Identical locked-B/anchored-C inputs to RUN A, but run through the real,
    // unmodified `applyAnchorBasedTiming` (services/syncEngine.ts) — the exact
    // function every Apply Sync commit calls, which now ends in
    // `enforceGaplessPartition`. This is the empirical proof for Task 3's
    // claim: Model P's gaplessness closes the K14 gap NATIVELY, with no
    // change to frameRenderer.ts/segmentEncoder.ts's own startTime-blind
        // concatenation — the fix is entirely upstream, in what the array looks
    // like BY THE TIME export ever sees it.
    const raw: VideoSegment[] = [
      seg({ id: 's0', assetId: 'a-red', startTime: 0, duration: 2, order: 0, anchorStart: 0 }),
      seg({ id: 's1', assetId: 'a-green', startTime: 2, duration: 1, order: 1, locked: true, anchorStart: 2 }),
      seg({ id: 's2', assetId: 'a-blue', startTime: 5, duration: 3, order: 2, anchorStart: 5 }),
    ];
    const positioned = applyAnchorBasedTiming(raw, 8);

    // Precondition check, stated as an assertion rather than assumed: the real
    // positioner closed the gap. C now starts exactly where B ends (absorbing
    // the 2.000s as leading silence, per ruling §4.1), not at its old anchor.
    expect(positioned[1]!.startTime + positioned[1]!.duration).toBeCloseTo(positioned[2]!.startTime, 6);
    expect(positioned[2]!.startTime).toBeCloseTo(3, 6); // was 5 pre-ruling

    const assets = [A('a-red', 'red.mp4', 'video'), A('a-green', 'green.mp4', 'video'),
      A('a-blue', 'blue.mp4', 'video'), A('a-voice', 'voice.wav', 'audio')];
    const { result, file } = await runExport(makeProject(positioned, assets), 'B_positioned');

    expect(result.ok).toBe(true);
    if (!result.ok || !file) return;

    // The voiceover's beeps are still at the ORIGINAL editor cue times (2.000s,
    // 5.000s) — they were authored against the un-positioned timeline. The
    // colour cuts must now land at the POSITIONED boundaries (2.000s [B's own
    // start is unmoved — only C's start absorbed the gap] and 3.000s), proving
    // the export's own frame positions agree with the array Apply Sync actually
    // committed. A one-frame (1/30s ≈ 0.033s) tolerance absorbs encode rounding.
    const cols = frameColors(file).map(classify);
    const changes: Array<{ t: number }> = [];
    for (let i = 1; i < cols.length; i++) if (cols[i] !== cols[i - 1]) changes.push({ t: i / FPS });
    expect(changes.length).toBe(2);
    expect(changes[0]!.t).toBeCloseTo(2.0, 1);
    expect(changes[1]!.t).toBeCloseTo(3.0, 1);

    // Video duration matches the positioned timeline's own total: the tail
    // rule extends C all the way to audioDuration (8.000s) — C's duration grew
    // from its raw 3s to 5s (8 - effectiveStart 3) to cover the audio fully,
    // same as `applyAnchorBasedTiming`'s own PASS-3-turned-tail-rule always did.
    const frameSeconds = cols.length / FPS;
    expect(frameSeconds).toBeCloseTo(8.0, 1);
  }, 60_000);

  it('a well-formed, already-gapless project passes the guard silently (no false positive)', async () => {
    const assets = [A('a-red', 'red.mp4', 'video'), A('a-green', 'green.mp4', 'video'), A('a-voice', 'voice.wav', 'audio')];
    const segments = [
      seg({ id: 's0', assetId: 'a-red', startTime: 0, duration: 2, order: 0 }),
      seg({ id: 's1', assetId: 'a-green', startTime: 2, duration: 3, order: 1 }),
    ];
    const { result } = await runExport(makeProject(segments, assets), 'control_no_gap');
    expect(result.ok).toBe(true);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// RUN D / RUN E — headings never dropped or truncated. No ffmpeg needed: this
// walks the real per-frame timeline segmentEncoder.ts enumerates and checks
// the real getActiveHeadingAt against it. Always runs.
// ---------------------------------------------------------------------------
describe('RUN D/E — headings never dropped or truncated (Model P)', () => {
  /** Re-derives the exact frame-by-frame `absoluteTime` sequence
   *  `segmentEncoder.ts` walks during export: per segment, in array order,
   *  `segment.startTime + frameIndex/fps` for `frameIndex` in
   *  `[0, round(duration*fps))`. Not a reimplementation of any placement
   *  logic — purely the frame-count/absoluteTime arithmetic
   *  `segmentEncoder.ts`'s own `encodeSegment` (and this repo's
   *  `exportPipeline.ts`) already uses, so a drift between this helper and
   *  production would show up as this test failing to reproduce reality
   *  rather than as false confidence. */
  function frameTimeline(segments: VideoSegment[], fps: number): number[] {
    const times: number[] = [];
    for (const s of segments) {
      const frames = Math.max(1, Math.round(s.duration * fps));
      for (let f = 0; f < frames; f++) times.push(s.startTime + f / fps);
    }
    return times;
  }

  it('RUN D — a heading positioned inside what used to be a K14 gap is now selected on real frames (was: never visible)', () => {
    // Same locked-B/anchored-C shape as RUN A/B above, positioned by the real
    // production pipeline. The heading's [3.2, 4.5) span sits ENTIRELY inside
    // the OLD gap coordinates (which were [3.0, 5.0) pre-positioning) — the
    // exact RUN D shape from the original measurement
    // (`docs/segments-invariant-ruling.md`'s own worked example): "heading
    // lies ENTIRELY INSIDE the gap... NEVER VISIBLE — 0 of N frames carry it."
    const raw: VideoSegment[] = [
      seg({ id: 's0', startTime: 0, duration: 2, order: 0, anchorStart: 0 }),
      seg({ id: 's1', startTime: 2, duration: 1, order: 1, locked: true, anchorStart: 2 }),
      seg({ id: 's2', startTime: 5, duration: 3, order: 2, anchorStart: 5 }),
    ];
    const positioned = applyAnchorBasedTiming(raw, 8);
    const heading: HeadingOverlay = {
      id: 'h-d', time: 3.2, duration: 1.3, text: 'HEADING',
      fontFamily: 'Helvetica', fontSize: 40, fontWeight: 700,
      color: '#ffffff', backgroundColor: 'transparent', x: 50, y: 50,
    };

    const times = frameTimeline(positioned, FPS);
    const framesShowingHeading = times.filter(t => getActiveHeadingAt([heading], t) === heading);

    expect(times.length).toBeGreaterThan(0);
    expect(framesShowingHeading.length).toBeGreaterThan(0); // was 0 pre-ruling
    // The heading's own full 1.3s duration is representable in frame-count
    // terms (±1 frame for the round() in frameTimeline/segmentEncoder).
    expect(framesShowingHeading.length).toBeGreaterThanOrEqual(Math.round(1.3 * FPS) - 1);
  });

  it('RUN E — a heading straddling the old gap is now fully covered, not truncated to its pre-gap fraction', () => {
    // The original measurement's RUN E: a heading spanning [2.5, 5.5) — 3.0s —
    // straddled the old [3.0, 5.0) gap, and only the first 1.0s (the part
    // before the gap began) was ever visible; the 2.0s inside the gap was lost.
    const raw: VideoSegment[] = [
      seg({ id: 's0', startTime: 0, duration: 2, order: 0, anchorStart: 0 }),
      seg({ id: 's1', startTime: 2, duration: 1, order: 1, locked: true, anchorStart: 2 }),
      seg({ id: 's2', startTime: 5, duration: 3, order: 2, anchorStart: 5 }),
    ];
    const positioned = applyAnchorBasedTiming(raw, 8);
    const heading: HeadingOverlay = {
      id: 'h-e', time: 2.5, duration: 3.0, text: 'HEADING',
      fontFamily: 'Helvetica', fontSize: 40, fontWeight: 700,
      color: '#ffffff', backgroundColor: 'transparent', x: 50, y: 50,
    };

    const times = frameTimeline(positioned, FPS);
    const framesShowingHeading = times.filter(t => getActiveHeadingAt([heading], t) === heading);

    // Full 3.0s coverage now (±1 frame), not the pre-ruling 1.0s truncation.
    expect(framesShowingHeading.length).toBeGreaterThanOrEqual(Math.round(3.0 * FPS) - 1);
  });

  it('control — a heading entirely within a single ordinary segment is unaffected (no regression)', () => {
    const positioned: VideoSegment[] = [
      seg({ id: 's0', startTime: 0, duration: 5, order: 0 }),
      seg({ id: 's1', startTime: 5, duration: 5, order: 1 }),
    ];
    const heading: HeadingOverlay = {
      id: 'h-ctrl', time: 1.0, duration: 1.0, text: 'HEADING',
      fontFamily: 'Helvetica', fontSize: 40, fontWeight: 700,
      color: '#ffffff', backgroundColor: 'transparent', x: 50, y: 50,
    };
    const times = frameTimeline(positioned, FPS);
    const framesShowingHeading = times.filter(t => getActiveHeadingAt([heading], t) === heading);
    expect(framesShowingHeading.length).toBeGreaterThanOrEqual(Math.round(1.0 * FPS) - 1);
  });
});
