/**
 * WS3 STEP 6 — the destination disk-space estimate, verbatim per the owner's
 * formula. The 28-minute (1680 s) 1080p30 triplet is the owner-specified
 * exact check: get any of these three numbers wrong and this fails loudly
 * rather than silently under- or over-estimating a real save.
 */
import { describe, it, expect } from 'vitest';
import { EXPORT_DISK_VIDEO_BYTES_PER_SECOND } from './diskFull';
import { estimateExportDestinationDiskBytes } from './exportDestinationDiskEstimate';

const DURATION_SECONDS = 28 * 60; // 1680 s

describe('estimateExportDestinationDiskBytes — the owner-specified formula, verbatim', () => {
  it.each([
    [1500, 355_320_000],
    [3000, 670_320_000],
    [8000, 1_720_320_000],
  ])('bitrate %i kbps: videoBytes + audioBytes = %i B exactly, at 1680 s with audio', (bitrateKbps, expectedCombined) => {
    const e = estimateExportDestinationDiskBytes({
      bitrateKbps,
      durationSeconds: DURATION_SECONDS,
      hasAudio: true,
    });
    expect(e.videoBytes + e.audioBytes).toBe(expectedCombined);
  });

  it('at 8000 kbps, the video term equals EXPORT_DISK_VIDEO_BYTES_PER_SECOND × D exactly', () => {
    const e = estimateExportDestinationDiskBytes({
      bitrateKbps: 8000,
      durationSeconds: DURATION_SECONDS,
      hasAudio: true,
    });
    expect(e.videoBytes).toBe(EXPORT_DISK_VIDEO_BYTES_PER_SECOND * DURATION_SECONDS);
    expect(e.videoBytes).toBe(1_680_000_000);
  });

  it('audioBytes is exactly 0 with no audio track — not merely falsy', () => {
    const e = estimateExportDestinationDiskBytes({
      bitrateKbps: 3000,
      durationSeconds: DURATION_SECONDS,
      hasAudio: false,
    });
    expect(e.audioBytes).toBe(0);
    expect(e.videoBytes).toBe(630_000_000);
  });

  it('destinationRequiredBytes applies the 1.10 headroom then the 64 MiB floor, in that order', () => {
    const e = estimateExportDestinationDiskBytes({
      bitrateKbps: 1500,
      durationSeconds: DURATION_SECONDS,
      hasAudio: true,
    });
    // 355,320,000 × 1.10 is 390,852,000 in exact decimal, but IEEE-754
    // double arithmetic (0.1 has no exact binary representation) lands at
    // 390,852,000.00000006 — `applyHeadroom`'s `Math.ceil` rounds that UP to
    // 390,852,001, +64 MiB (67,108,864) = 457,960,865. This is `applyHeadroom`'s
    // own existing, frozen behavior (reused verbatim here, not re-derived) —
    // asserted exactly so a future change to it is caught here too.
    expect(e.destinationRequiredBytes).toBe(457_960_865);
  });
});
