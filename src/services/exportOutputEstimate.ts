/**
 * Export-modal size estimator — pure, no Tauri, no DOM.
 *
 * WHY THIS FILE EXISTS. The export modal needs a live file-size badge and a
 * free-space gate that agree with the Round 21 disk preflight
 * (`diskFull.ts`'s destination term) once that preflight takes bitrate as
 * an input. A variable bitrate invalidates the preflight's fixed 8 Mbps
 * assumption; this module is the shared arithmetic for "how big will the
 * delivered MP4 be?" so the modal and the preflight cannot drift.
 *
 * TODAY'S 1080p DEFAULT. `encoderSessionPlan.ts` has no bitrate field — it
 * only plans VideoEncoder session cuts in frame-index space. The live 1080p
 * encoder target is `exportWorker.ts`'s `EXPORT_BITRATE = 8_000_000` bit/s
 * (8000 kbps), which is also `diskFull.ts`'s
 * `EXPORT_DISK_VIDEO_BYTES_PER_SECOND = 1_000_000` (= 8_000_000 / 8). The
 * selector defaults to `DEFAULT_EXPORT_BITRATE_KBPS` so this change alters
 * no encoded output by itself.
 *
 * FORMULA (destination / delivered-file term — what the badge shows):
 *
 *   videoBytes = bitrateKbps × 1000 / 8 × durationSeconds
 *              = bitrateKbps × 125 × durationSeconds
 *
 *   audioBytes = hasAudio ? EXPORT_DISK_AAC_BYTES_PER_SECOND × durationSeconds
 *                         : 0
 *              (AAC 192 kbit/s = 24,000 B/s; same constant as diskFull.ts)
 *
 *   estimatedFileBytes = ceil(videoBytes + audioBytes)
 *
 *   destinationRequiredBytes = applyHeadroom(estimatedFileBytes)
 *                            = ceil(estimatedFileBytes × 1.10) + 64 MiB
 *
 * fps and resolution are accepted as inputs because the badge is specified
 * from bitrate, fps, resolution and duration. At a fixed target bitrate they
 * do not change the video-byte term — the encoder's `bitrate` is a
 * rate-control target, not per-pixel, matching `diskFull.ts`'s own comment
 * that Annex-B bytes/s are resolution-independent. They are still recorded
 * on the result (pixel size, frame count) so a future per-pixel model can
 * land without changing the call sites.
 *
 * Worked examples (28-minute 1080p30, hasAudio=true, durationSeconds=1680):
 *
 *   1500 kbps → video 315,000,000 + AAC 40,320,000 = 355,320,000 B
 *   3000 kbps → video 630,000,000 + AAC 40,320,000 = 670,320,000 B
 *   8000 kbps → video 1,680,000,000 + AAC 40,320,000 = 1,720,320,000 B
 *               (video term = 1_000_000 B/s × 1680 — today's preflight)
 */

import type { ResolutionTier } from '../types';
import { resolveDimensions, type AspectRatio } from './resolutionConfig';
import {
  applyHeadroom,
  EXPORT_DISK_AAC_BYTES_PER_SECOND,
  EXPORT_DISK_VIDEO_BYTES_PER_SECOND,
} from './webcodecsExport/diskFull';

/** `exportWorker.ts` EXPORT_BITRATE = 8_000_000 bit/s, expressed in kbps. */
export const DEFAULT_EXPORT_BITRATE_KBPS = 8_000;

export const MIN_EXPORT_BITRATE_KBPS = 1_500;
export const MAX_EXPORT_BITRATE_KBPS = 8_000;
export const EXPORT_BITRATE_STEP_KBPS = 500;

/** Bits-per-second form of the selector default — equals EXPORT_BITRATE. */
export const DEFAULT_EXPORT_BITRATE_BPS = DEFAULT_EXPORT_BITRATE_KBPS * 1_000;

export interface ExportSizeEstimateInput {
  bitrateKbps: number;
  fps: number;
  resolution: ResolutionTier;
  aspectRatio: AspectRatio;
  durationSeconds: number;
  hasAudio: boolean;
}

export interface ExportSizeEstimate {
  bitrateKbps: number;
  fps: number;
  resolution: ResolutionTier;
  width: number;
  height: number;
  durationSeconds: number;
  frameCount: number;
  videoBytes: number;
  audioBytes: number;
  /** Delivered MP4 size — the live badge. */
  estimatedFileBytes: number;
  /**
   * What the destination-volume preflight must require: estimated file
   * plus the same 10 % + 64 MiB headroom `diskFull.ts` applies to
   * `destinationBytes`. Modal disables Export when free space is below this.
   */
  destinationRequiredBytes: number;
}

/**
 * Inclusive list of legal bitrate selector values. Generated from
 * min/max/step so the dropdown is not a hardcoded table of every option.
 */
export function exportBitrateKbpsOptions(
  minKbps: number = MIN_EXPORT_BITRATE_KBPS,
  maxKbps: number = MAX_EXPORT_BITRATE_KBPS,
  stepKbps: number = EXPORT_BITRATE_STEP_KBPS,
): number[] {
  if (!(stepKbps > 0) || !(maxKbps >= minKbps)) return [];
  const out: number[] = [];
  for (let v = minKbps; v <= maxKbps; v += stepKbps) out.push(v);
  if (out[out.length - 1] !== maxKbps) out.push(maxKbps);
  return out;
}

/**
 * Snap a candidate onto the selector grid. Values outside [min, max] clamp;
 * in-range values round to the nearest step.
 */
export function snapExportBitrateKbps(
  kbps: number,
  minKbps: number = MIN_EXPORT_BITRATE_KBPS,
  maxKbps: number = MAX_EXPORT_BITRATE_KBPS,
  stepKbps: number = EXPORT_BITRATE_STEP_KBPS,
): number {
  if (!Number.isFinite(kbps)) return DEFAULT_EXPORT_BITRATE_KBPS;
  const clamped = Math.min(maxKbps, Math.max(minKbps, kbps));
  const snapped = minKbps + Math.round((clamped - minKbps) / stepKbps) * stepKbps;
  return Math.min(maxKbps, Math.max(minKbps, snapped));
}

export function estimateExportOutputBytes(input: ExportSizeEstimateInput): ExportSizeEstimate {
  const durationSeconds = Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
    ? input.durationSeconds
    : 0;
  const fps = Number.isFinite(input.fps) && input.fps > 0 ? input.fps : 30;
  const bitrateKbps = snapExportBitrateKbps(input.bitrateKbps);
  const videoBytes = Math.ceil(bitrateKbps * 125 * durationSeconds);
  const audioBytes = input.hasAudio
    ? Math.ceil(durationSeconds * EXPORT_DISK_AAC_BYTES_PER_SECOND)
    : 0;
  const estimatedFileBytes = videoBytes + audioBytes;
  const dims = resolveDimensions(input.aspectRatio, input.resolution);
  return {
    bitrateKbps,
    fps,
    resolution: input.resolution,
    width: dims.width,
    height: dims.height,
    durationSeconds,
    frameCount: Math.round(durationSeconds * fps),
    videoBytes,
    audioBytes,
    estimatedFileBytes,
    destinationRequiredBytes: applyHeadroom(estimatedFileBytes),
  };
}

/**
 * Pin: at the selector default, the video term equals today's fixed-rate
 * preflight (`EXPORT_DISK_VIDEO_BYTES_PER_SECOND × D`). If this ever fails,
 * either this estimator or the 8 Mbps encoder target moved without the other.
 */
export function defaultBitrateMatchesDiskModel(): boolean {
  return DEFAULT_EXPORT_BITRATE_BPS / 8 === EXPORT_DISK_VIDEO_BYTES_PER_SECOND;
}
