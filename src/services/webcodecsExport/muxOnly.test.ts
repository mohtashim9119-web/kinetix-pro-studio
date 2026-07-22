import { describe, it, expect, vi } from 'vitest';
import { buildVideoRemuxArgs, buildAudioMuxArgs, muxOnly } from './muxOnly';
import type { FfmpegLike } from '../segmentEncoder';

// buildVideoRemuxArgs/buildAudioMuxArgs are the pure command-construction
// pieces of muxOnly.ts. Two real, empirically-found bugs are load-bearing
// here (see muxOnly.ts's own header for the full repro against a real
// VideoToolbox-encoded stream):
//   1. `-r <fps>` (not the plan's original `-framerate <fps>`) is what
//      actually fixes a stream-copied annexb file's duration/timing.
//   2. `-shortest` in the SAME command as the raw, still-unset-PTS video
//      stream silently drops the entire audio track — muxOnly.ts works
//      around this with a two-step mux (video-only remux first, THEN mix in
//      audio + -shortest against that already-timed intermediate).

describe('buildVideoRemuxArgs', () => {
  it('includes -r as an INPUT flag (before -i videoFile)', () => {
    const args = buildVideoRemuxArgs('run_0.h264', 'export_final.mp4', 30);
    const rIdx = args.indexOf('-r');
    const iIdx = args.indexOf('-i');
    expect(rIdx).toBeGreaterThanOrEqual(0);
    expect(args[rIdx + 1]).toBe('30');
    expect(rIdx).toBeLessThan(iIdx);
    expect(args[iIdx + 1]).toBe('run_0.h264');
  });

  it('never uses -framerate — proven insufficient for VideoToolbox-encoded annexb', () => {
    expect(buildVideoRemuxArgs('run_0.h264', 'export_final.mp4', 30)).not.toContain('-framerate');
  });

  it('builds the exact command shape (stream-copy, no -shortest, no audio flags here)', () => {
    expect(buildVideoRemuxArgs('run_0.h264', 'export_final.mp4', 30)).toEqual([
      '-r', '30',
      '-i', 'run_0.h264',
      '-c:v', 'copy',
      '-colorspace', 'bt709',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-movflags', '+faststart',
      '-y',
      'export_final.mp4',
    ]);
    expect(buildVideoRemuxArgs('run_0.h264', 'export_final.mp4', 30)).not.toContain('-shortest');
  });

  it('tags bt709 color metadata (Step 6 amendment Part A — the container-level fix for a browser-encoded, un-tagged bitstream)', () => {
    const args = buildVideoRemuxArgs('run_0.h264', 'export_final.mp4', 30);
    expect(args[args.indexOf('-colorspace') + 1]).toBe('bt709');
    expect(args[args.indexOf('-color_primaries') + 1]).toBe('bt709');
    expect(args[args.indexOf('-color_trc') + 1]).toBe('bt709');
  });
});

describe('buildAudioMuxArgs', () => {
  it('builds the exact with-audio command shape, always including -shortest and -c:a aac', () => {
    expect(buildAudioMuxArgs('run_0.h264.premux.mp4', 'voiceover_audio', 'export_final.mp4')).toEqual([
      '-i', 'run_0.h264.premux.mp4',
      '-i', 'voiceover_audio',
      '-c:v', 'copy',
      '-colorspace', 'bt709',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-movflags', '+faststart',
      '-y',
      'export_final.mp4',
    ]);
  });

  it('never re-encodes video (always -c:v copy) and never copies audio (always aac, per exportPipeline.ts parity)', () => {
    const args = buildAudioMuxArgs('premux.mp4', 'voiceover_audio', 'export_final.mp4');
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
  });

  it('tags bt709 color metadata (Step 6 amendment Part A)', () => {
    const args = buildAudioMuxArgs('premux.mp4', 'voiceover_audio', 'export_final.mp4');
    expect(args[args.indexOf('-colorspace') + 1]).toBe('bt709');
    expect(args[args.indexOf('-color_primaries') + 1]).toBe('bt709');
    expect(args[args.indexOf('-color_trc') + 1]).toBe('bt709');
  });
});

describe('muxOnly', () => {
  function fakeFfmpeg(execImpl: (args: string[]) => Promise<number>, deleteImpl?: (path: string) => Promise<void>): FfmpegLike {
    return {
      writeFile: vi.fn(),
      exec: vi.fn(execImpl),
      readFile: vi.fn(),
      deleteFile: vi.fn(deleteImpl ?? (async () => undefined)),
    };
  }

  it('no-audio case: issues exactly ONE ffmpeg.exec call, the video-remux args, straight to outputFile', async () => {
    const execSpy = vi.fn(async (_args: string[]) => 0);
    const ffmpeg = fakeFfmpeg(execSpy);
    await expect(muxOnly(ffmpeg, 'sess-1', 'run_0.h264', null, 'export_final.mp4', 30)).resolves.toBeUndefined();
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(execSpy).toHaveBeenCalledWith(buildVideoRemuxArgs('run_0.h264', 'export_final.mp4', 30));
    expect(ffmpeg.deleteFile).not.toHaveBeenCalled();
  });

  it('with-audio case: issues TWO ffmpeg.exec calls (premux, then audio-mux) and cleans up the intermediate', async () => {
    const calls: string[][] = [];
    const execSpy = vi.fn(async (args: string[]) => {
      calls.push(args);
      return 0;
    });
    const ffmpeg = fakeFfmpeg(execSpy);
    await expect(muxOnly(ffmpeg, 'sess-1', 'run_0.h264', 'voiceover_audio', 'export_final.mp4', 30)).resolves.toBeUndefined();

    expect(execSpy).toHaveBeenCalledTimes(2);
    const premuxFile = 'run_0.h264.premux.mp4';
    expect(calls[0]).toEqual(buildVideoRemuxArgs('run_0.h264', premuxFile, 30));
    expect(calls[1]).toEqual(buildAudioMuxArgs(premuxFile, 'voiceover_audio', 'export_final.mp4'));
    expect(ffmpeg.deleteFile).toHaveBeenCalledWith(premuxFile);
  });

  it('with-audio case: a premux-step failure never runs the audio-mux step and never deletes anything', async () => {
    const execSpy = vi.fn(async () => {
      throw new Error('premux exploded');
    });
    const ffmpeg = fakeFfmpeg(execSpy);
    await expect(muxOnly(ffmpeg, 'sess-9', 'run_0.h264', 'voiceover_audio', 'export_final.mp4', 30)).rejects.toThrow(/premux exploded/);
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(ffmpeg.deleteFile).not.toHaveBeenCalled();
  });

  it('with-audio case: an audio-mux-step failure still cleans up the intermediate, and throws a typed error including the session id', async () => {
    let call = 0;
    const execSpy = vi.fn(async () => {
      call++;
      if (call === 2) throw new Error('audio mux exploded');
      return 0;
    });
    const ffmpeg = fakeFfmpeg(execSpy);
    await expect(muxOnly(ffmpeg, 'sess-42', 'run_0.h264', 'voiceover_audio', 'export_final.mp4', 30)).rejects.toThrow(/sess-42/);
    expect(execSpy).toHaveBeenCalledTimes(2);
    expect(ffmpeg.deleteFile).toHaveBeenCalledWith('run_0.h264.premux.mp4');
  });

  it('propagates a wrapped Error (not the raw ffmpeg rejection) on no-audio failure, including the session id', async () => {
    const ffmpeg = fakeFfmpeg(async () => {
      throw new Error('ffmpeg exited with code 1');
    });
    await expect(muxOnly(ffmpeg, 'sess-7', 'run_0.h264', null, 'export_final.mp4', 30)).rejects.toThrow(/sess-7/);
    await expect(muxOnly(ffmpeg, 'sess-7', 'run_0.h264', null, 'export_final.mp4', 30)).rejects.toThrow(/ffmpeg exited with code 1/);
  });
});
