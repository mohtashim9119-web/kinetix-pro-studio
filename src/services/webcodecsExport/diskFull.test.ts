/**
 * WS3 Round 21 — the disk accounting model, the preflight decision, the
 * ENOSPC classifier and the diagnostic cap, in isolation.
 */
import { describe, it, expect } from 'vitest';
import {
  EXPORT_DISK_AAC_BYTES_PER_SECOND,
  EXPORT_DISK_HEADROOM_FLOOR_BYTES,
  EXPORT_DISK_HEADROOM_RATIO,
  EXPORT_DISK_VIDEO_BYTES_PER_SECOND,
  EXPORT_DISK_WAV_BYTES_PER_SECOND,
  applyHeadroom,
  capDiagnosticCause,
  decideDiskPreflight,
  diskFullExportError,
  diskFullExportErrorFrom,
  DiskFullError,
  estimateExportDiskBytes,
  groupVolumes,
  isDiskFullCause,
  isDiskFullError,
} from './diskFull';

// The machine-1 field failure (2026-09-12, build 9297de2).
const FIELD_FRAMES = 50_911;
const FIELD_FPS = 30;
const FIELD_ANNEXB = 1_694_429_224;
const FIELD_WAV = 1697 * 48_000 * 2 * 2; // 325,824,000

describe('disk accounting model (STEP 1)', () => {
  it('the constants carry their derivation: 8 Mbit/s ÷ 8, 192 kbit/s ÷ 8, PCM 48k stereo 16-bit', () => {
    expect(EXPORT_DISK_VIDEO_BYTES_PER_SECOND).toBe(8_000_000 / 8);
    expect(EXPORT_DISK_AAC_BYTES_PER_SECOND).toBe(192_000 / 8);
    expect(EXPORT_DISK_WAV_BYTES_PER_SECOND).toBe(48_000 * 2 * 2);
    expect(EXPORT_DISK_HEADROOM_RATIO).toBe(0.1);
    expect(EXPORT_DISK_HEADROOM_FLOOR_BYTES).toBe(64 * 1024 * 1024);
  });

  it('reproduces the machine-1 field numbers within 0.2 % on video and exactly on the WAV', () => {
    const e = estimateExportDiskBytes({
      fps: FIELD_FPS,
      pieces: [{ tier: 'gl', expectedFrames: FIELD_FRAMES }],
      voiceover: { bytes: null }, // size unknown → WAV rate
    });
    expect(e.durationSeconds).toBeCloseTo(1697.03, 2);
    // Model 1,697,033,333 vs field 1,694,429,224: the model is 0.15 % HIGH.
    expect(e.annexbBytes / FIELD_ANNEXB).toBeGreaterThan(1);
    expect(e.annexbBytes / FIELD_ANNEXB).toBeLessThan(1.002);
    expect(e.voiceoverBytes).toBe(Math.ceil(e.durationSeconds * EXPORT_DISK_WAV_BYTES_PER_SECOND));
    expect(Math.abs(e.voiceoverBytes - FIELD_WAV)).toBeLessThan(10_000); // 1697.03 vs 1697 s
    // Single piece with voiceover: 3A + W + AAC.
    expect(Math.abs(e.tempPeakBytes - (3 * e.annexbBytes + e.voiceoverBytes + e.aacBytes))).toBeLessThan(4); // per-term ceil
    expect(e.tempPeakBytes).toBeGreaterThan(5.4e9);
    expect(e.tempPeakBytes).toBeLessThan(5.5e9);
    // Amplification against the delivered file: ~3.1× (the field note's 3.3×
    // used a smaller premux reading; the code path is a stream copy).
    expect(e.amplification).toBeGreaterThan(3.0);
    expect(e.amplification).toBeLessThan(3.2);
    expect(e.destinationBytes).toBe(e.finalBytes);
  });

  it('two or more pieces add video_all.h264: 4A + W + AAC', () => {
    const one = estimateExportDiskBytes({ fps: 30, pieces: [{ tier: 'gl', expectedFrames: 3000 }], voiceover: { bytes: 1000 } });
    const two = estimateExportDiskBytes({
      fps: 30,
      pieces: [{ tier: 'gl', expectedFrames: 1500 }, { tier: 'gl', expectedFrames: 1500 }],
      voiceover: { bytes: 1000 },
    });
    expect(two.annexbBytes).toBe(one.annexbBytes);
    expect(two.tempPeakBytes - one.tempPeakBytes).toBe(one.annexbBytes);
  });

  it('no voiceover: no premux step, so one fewer copy of A coexists', () => {
    const withVo = estimateExportDiskBytes({ fps: 30, pieces: [{ tier: 'gl', expectedFrames: 3000 }], voiceover: { bytes: 0 } });
    const noVo = estimateExportDiskBytes({ fps: 30, pieces: [{ tier: 'gl', expectedFrames: 3000 }], voiceover: null });
    expect(withVo.tempPeakBytes - noVo.tempPeakBytes).toBe(withVo.annexbBytes + withVo.aacBytes);
    expect(noVo.aacBytes).toBe(0);
  });

  it('uses the voiceover asset\'s own byte size when known', () => {
    const e = estimateExportDiskBytes({ fps: 30, pieces: [{ tier: 'gl', expectedFrames: 300 }], voiceover: { bytes: 12_345 } });
    expect(e.voiceoverBytes).toBe(12_345);
  });

  it('a resumed session subtracts the bytes its pieces already hold', () => {
    const fresh = estimateExportDiskBytes({ fps: 30, pieces: [{ tier: 'gl', expectedFrames: 3000 }], voiceover: null });
    const resumed = estimateExportDiskBytes({ fps: 30, pieces: [{ tier: 'gl', expectedFrames: 3000 }], voiceover: null, resumedBytesOnDisk: 50_000_000 });
    expect(fresh.tempPeakBytes - resumed.tempPeakBytes).toBe(50_000_000);
  });

  it('headroom is ratio plus floor, and the floor dominates short exports', () => {
    expect(applyHeadroom(0)).toBe(EXPORT_DISK_HEADROOM_FLOOR_BYTES);
    expect(applyHeadroom(1_000_000_000)).toBe(1_100_000_000 + EXPORT_DISK_HEADROOM_FLOOR_BYTES);
    const short = estimateExportDiskBytes({ fps: 30, pieces: [{ tier: 'gl', expectedFrames: 30 }], voiceover: null });
    expect(short.tempRequiredBytes - short.tempPeakBytes).toBeGreaterThan(EXPORT_DISK_HEADROOM_FLOOR_BYTES);
  });

  it('a canvas piece adds its per-frame PNG transient during encode', () => {
    const e = estimateExportDiskBytes({ fps: 30, pieces: [{ tier: 'canvas', expectedFrames: 900 }], voiceover: null });
    expect(e.canvasTransientBytes).toBe(900 * 3 * 1024 * 1024);
    // 2.8 GB of PNGs for a 30 s canvas segment dwarfs the mux peak of a 30 s export.
    expect(e.tempPeakBytes).toBe(e.annexbBytes + e.canvasTransientBytes);
  });
});

describe('preflight decision (D1)', () => {
  const estimate = estimateExportDiskBytes({ fps: 30, pieces: [{ tier: 'gl', expectedFrames: 3000 }], voiceover: null });

  it('passes when every volume can hold its own summed requirement', () => {
    const r = decideDiskPreflight({
      estimate,
      temp: { path: '/fake-vol/s', probedPath: '/fake-vol/s', volumeKey: 'dev:1', availableBytes: estimate.tempRequiredBytes },
      destination: { path: '/Volumes/X/out.mp4', probedPath: '/Volumes/X', volumeKey: 'dev:2', availableBytes: estimate.destinationRequiredBytes },
    });
    expect(r.ok).toBe(true);
    expect(r.volumes).toHaveLength(2);
  });

  it('sums temp and destination when they are the same volume, and reports the shortfall', () => {
    const avail = estimate.tempRequiredBytes + 1; // enough for temp alone, not for both
    const r = decideDiskPreflight({
      estimate,
      temp: { path: '/fake-vol/s', probedPath: '/fake-vol/s', volumeKey: 'dev:1', availableBytes: avail },
      destination: { path: '/Users/me/out.mp4', probedPath: '/Users/me', volumeKey: 'dev:1', availableBytes: avail },
    });
    expect(r.ok).toBe(false);
    expect(r.shortfall).not.toBeNull();
    expect(r.shortfall!.requiredBytes).toBe(estimate.tempRequiredBytes + estimate.destinationRequiredBytes);
    expect(r.shortfall!.availableBytes).toBe(avail);
    expect(r.shortfall!.shortfallBytes).toBe(estimate.destinationRequiredBytes - 1);
    expect(r.shortfall!.paths).toEqual(['/fake-vol/s', '/Users/me/out.mp4']);
  });

  it('merges two device ids that report byte-identical free space (APFS shared container)', () => {
    const groups = groupVolumes([
      { reading: { path: 'a', probedPath: 'a', volumeKey: 'dev:1', availableBytes: 123_456_789 }, requiredBytes: 10 },
      { reading: { path: 'b', probedPath: 'b', volumeKey: 'dev:2', availableBytes: 123_456_789 }, requiredBytes: 20 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.requiredBytes).toBe(30);
  });

  it('fails on the destination volume alone when only it is short', () => {
    const r = decideDiskPreflight({
      estimate,
      temp: { path: '/fake-vol/s', probedPath: '/fake-vol/s', volumeKey: 'dev:1', availableBytes: 1e12 },
      destination: { path: 'E:\\out.mp4', probedPath: 'E:\\', volumeKey: 'prefix:E:', availableBytes: 1 },
    });
    expect(r.ok).toBe(false);
    expect(r.shortfall!.volumeKey).toBe('prefix:E:');
    expect(r.shortfall!.requiredBytes).toBe(estimate.destinationRequiredBytes);
  });
});

describe('ENOSPC classifier (D3)', () => {
  it('recognises every spelling the native side and ffmpeg can produce', () => {
    for (const cause of [
      '[disk-full] append_file_raw(piece_0.h264): write: No space left on device (os error 28)',
      'write_file(voiceover_audio): There is not enough space on the disk. (os error 112) [path=C:\\Temp\\x]',
      'write_file_raw(frame_00001.png): The disk is full. (os error 39)',
      'concat_annexb_pieces: write output: No space left on device',
      'ffmpeg exited with code -28: [aost#0:1/aac] No space left on device',
      'ffmpeg exited with code 228: Error writing trailer',
      'copy_session_file: write part: StorageFull',
      'QuotaExceeded',
      'ENOSPC: no space left on device, write',
    ]) {
      expect(isDiskFullCause(cause), cause).toBe(true);
    }
  });

  it('does not classify unrelated failures', () => {
    for (const cause of [
      'write_file(voiceover_audio): sync_all: Access is denied. (os error 5)',
      'ffmpeg exited with code 1: Invalid data found when processing input',
      'ffmpeg exited with code -22: Invalid argument',
      'Export worker produced no output for 30s — aborting (watchdog)',
      '',
    ]) {
      expect(isDiskFullCause(cause), cause).toBe(false);
    }
    expect(isDiskFullCause(null)).toBe(false);
    expect(isDiskFullError(new Error('cancelled'))).toBe(false);
    expect(isDiskFullError(new DiskFullError({ message: 'x', phase: 'append' }))).toBe(true);
    expect(isDiskFullError('[disk-full] x')).toBe(true);
  });
});

describe('diagnostic cap and the typed error (D3c)', () => {
  const spam = Array.from({ length: 300 }, (_, i) =>
    `frame=${i} fps=118 q=-1.0 size=${i * 33}kB time=00:00:${String(i % 60).padStart(2, '0')}.00 bitrate=8000.0kbits/s speed=3.9x`,
  ).join('\r');
  const raw = `ffmpeg exited with code -28: ${spam}\n[aost#0:1/aac] No space left on device\n[out#0/mp4] Error writing trailer: No space left on device\n[out#0/mp4] Error closing file: No space left on device`;

  it('drops the progress spam and keeps the last error-bearing lines under the byte cap', () => {
    const capped = capDiagnosticCause(raw);
    expect(capped).not.toContain('fps=118');
    expect(capped.startsWith('ffmpeg exited with code -28')).toBe(true);
    expect(capped).toContain('No space left on device');
    expect(capped).toContain('Error writing trailer');
    expect(capped.length).toBeLessThanOrEqual(1_503);
    expect(raw.length).toBeGreaterThan(4_000); // what the field blob carried
  });

  it('the operator-facing message is one sentence with free/required bytes; the cause is capped', () => {
    const err = diskFullExportError({
      phase: 'mux',
      requiredBytes: 5_450_000_000,
      availableBytes: 120_000_000,
      volumePath: 'C:\\Users\\m\\AppData\\Local\\Temp\\kinetix-export-d9b1d204',
      cause: raw,
    });
    expect(err.kind).toBe('disk_full');
    expect(err.message).toMatch(/^The export ran out of disk space on the volume holding .* \(mux\)\. Needs about 5\.08 GiB, 114 MiB free\.$/);
    expect(err.message.split('. ').length).toBeLessThanOrEqual(2);
    expect(err.cause!.length).toBeLessThanOrEqual(1_503);
    expect(err.diskFull).toEqual({
      phase: 'mux',
      requiredBytes: 5_450_000_000,
      availableBytes: 120_000_000,
      volumePath: 'C:\\Users\\m\\AppData\\Local\\Temp\\kinetix-export-d9b1d204',
    });
  });

  it('a mid-run ENOSPC with no modelled requirement still names the phase', () => {
    const err = diskFullExportErrorFrom(new Error('[disk-full] append_file_raw(piece_0.h264): write: No space left on device'), 'append');
    expect(err.kind).toBe('disk_full');
    expect(err.message).toBe('The export ran out of disk space (append).');
    expect(err.diskFull!.requiredBytes).toBeNull();
    expect(err.cause).toContain('append_file_raw');
  });
});
