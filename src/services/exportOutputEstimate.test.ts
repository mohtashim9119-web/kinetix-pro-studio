import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EXPORT_BITRATE_KBPS,
  DEFAULT_EXPORT_BITRATE_BPS,
  MIN_EXPORT_BITRATE_KBPS,
  MAX_EXPORT_BITRATE_KBPS,
  EXPORT_BITRATE_STEP_KBPS,
  exportBitrateKbpsOptions,
  snapExportBitrateKbps,
  estimateExportOutputBytes,
  defaultBitrateMatchesDiskModel,
} from './exportOutputEstimate';
import {
  EXPORT_DISK_AAC_BYTES_PER_SECOND,
  EXPORT_DISK_VIDEO_BYTES_PER_SECOND,
  estimateExportDestinationDiskBytes,
} from './webcodecsExport/diskFull';

const D28 = 28 * 60; // 1680 s
const BASE = {
  fps: 30,
  resolution: '1080p' as const,
  aspectRatio: '16:9' as const,
  durationSeconds: D28,
  hasAudio: true,
};

describe('export bitrate selector grid', () => {
  it('is generated from min/max/step — not a hardcoded option table', () => {
    const opts = exportBitrateKbpsOptions();
    expect(opts[0]).toBe(MIN_EXPORT_BITRATE_KBPS);
    expect(opts[opts.length - 1]).toBe(MAX_EXPORT_BITRATE_KBPS);
    expect(opts.every((v) => (v - MIN_EXPORT_BITRATE_KBPS) % EXPORT_BITRATE_STEP_KBPS === 0 || v === MAX_EXPORT_BITRATE_KBPS)).toBe(true);
    expect(opts).toContain(1500);
    expect(opts).toContain(3000);
    expect(opts).toContain(DEFAULT_EXPORT_BITRATE_KBPS);
    expect(opts).not.toContain(1000);
    expect(opts).not.toContain(8500);
  });

  it('defaults to today\'s 1080p encoder target (8000 kbps = 8_000_000 bit/s)', () => {
    expect(DEFAULT_EXPORT_BITRATE_KBPS).toBe(8000);
    expect(DEFAULT_EXPORT_BITRATE_BPS).toBe(8_000_000);
    expect(defaultBitrateMatchesDiskModel()).toBe(true);
    expect(DEFAULT_EXPORT_BITRATE_BPS / 8).toBe(EXPORT_DISK_VIDEO_BYTES_PER_SECOND);
    expect(exportBitrateKbpsOptions()).toContain(DEFAULT_EXPORT_BITRATE_KBPS);
  });

  it('snaps onto the 500 kbps grid and clamps to [1500, 8000]', () => {
    expect(snapExportBitrateKbps(3000)).toBe(3000);
    expect(snapExportBitrateKbps(3100)).toBe(3000);
    expect(snapExportBitrateKbps(3250)).toBe(3500);
    expect(snapExportBitrateKbps(0)).toBe(1500);
    expect(snapExportBitrateKbps(99999)).toBe(8000);
    expect(snapExportBitrateKbps(Number.NaN)).toBe(DEFAULT_EXPORT_BITRATE_KBPS);
  });
});

describe('estimateExportOutputBytes — delegates to diskFull.ts', () => {
  it('matches estimateExportDestinationDiskBytes for video, audio, and required bytes', () => {
    const dest = estimateExportDestinationDiskBytes({
      bitrateKbps: 1500,
      durationSeconds: D28,
      hasAudio: true,
    });
    const badge = estimateExportOutputBytes({ ...BASE, bitrateKbps: 1500 });
    expect(badge.videoBytes).toBe(dest.videoBytes);
    expect(badge.audioBytes).toBe(dest.audioBytes);
    expect(badge.destinationRequiredBytes).toBe(dest.destinationRequiredBytes);
    expect(badge.estimatedFileBytes).toBe(dest.videoBytes + dest.audioBytes);
    expect(badge.audioBytes).toBe(EXPORT_DISK_AAC_BYTES_PER_SECOND * D28);
  });

  it('omits AAC when hasAudio is false', () => {
    const dest = estimateExportDestinationDiskBytes({
      bitrateKbps: 8000,
      durationSeconds: D28,
      hasAudio: false,
    });
    const e = estimateExportOutputBytes({ ...BASE, bitrateKbps: 8000, hasAudio: false });
    expect(e.audioBytes).toBe(0);
    expect(e.audioBytes).toBe(dest.audioBytes);
    expect(e.estimatedFileBytes).toBe(dest.videoBytes);
  });

  it('fps and resolution do not change the byte term at a fixed bitrate', () => {
    const a = estimateExportOutputBytes({ ...BASE, bitrateKbps: 3000, fps: 24, resolution: '720p' });
    const b = estimateExportOutputBytes({ ...BASE, bitrateKbps: 3000, fps: 60, resolution: '1080p' });
    expect(a.estimatedFileBytes).toBe(b.estimatedFileBytes);
    expect(a.videoBytes).toBe(b.videoBytes);
    expect(a.width).toBe(1280);
    expect(a.height).toBe(720);
    expect(b.width).toBe(1920);
    expect(b.height).toBe(1080);
    expect(a.frameCount).toBe(Math.round(D28 * 24));
    expect(b.frameCount).toBe(Math.round(D28 * 60));
  });

  it('at 8000 kbps the video term equals today\'s fixed 8 Mbps preflight', () => {
    const e = estimateExportOutputBytes({ ...BASE, bitrateKbps: DEFAULT_EXPORT_BITRATE_KBPS });
    expect(e.videoBytes).toBe(EXPORT_DISK_VIDEO_BYTES_PER_SECOND * D28);
  });
});

describe('estimateExportOutputBytes — 28-minute 1080p30 worked examples', () => {
  it('1500 kbps → 355,320,000 B', () => {
    const e = estimateExportOutputBytes({ ...BASE, bitrateKbps: 1500 });
    expect(e.videoBytes).toBe(315_000_000);
    expect(e.audioBytes).toBe(40_320_000);
    expect(e.estimatedFileBytes).toBe(355_320_000);
  });

  it('3000 kbps → 670,320,000 B', () => {
    const e = estimateExportOutputBytes({ ...BASE, bitrateKbps: 3000 });
    expect(e.videoBytes).toBe(630_000_000);
    expect(e.audioBytes).toBe(40_320_000);
    expect(e.estimatedFileBytes).toBe(670_320_000);
  });

  it('8000 kbps → 1,720,320,000 B (today\'s default, output-neutral)', () => {
    const e = estimateExportOutputBytes({ ...BASE, bitrateKbps: 8000 });
    expect(e.videoBytes).toBe(1_680_000_000);
    expect(e.audioBytes).toBe(40_320_000);
    expect(e.estimatedFileBytes).toBe(1_720_320_000);
  });
});
