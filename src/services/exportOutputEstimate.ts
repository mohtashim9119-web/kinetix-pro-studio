/**
 * Export-modal / relocation size badge — pure, no Tauri, no DOM.
 *
 * Byte arithmetic lives in `diskFull.ts` (`estimateExportDestinationDiskBytes`).
 * This module snaps the bitrate selector and records fps/resolution metadata
 * the badge displays; it does not re-derive the destination formula.
 */

import type { ResolutionTier } from '../types';
import { resolveDimensions, type AspectRatio } from './resolutionConfig';
import {
  estimateExportDestinationDiskBytes,
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
   * Destination-volume requirement from `estimateExportDestinationDiskBytes`
   * (10 % + 64 MiB headroom). Modal disables Export when free space is below this.
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
  const dest = estimateExportDestinationDiskBytes({
    bitrateKbps,
    durationSeconds,
    hasAudio: input.hasAudio,
  });
  const dims = resolveDimensions(input.aspectRatio, input.resolution);
  return {
    bitrateKbps,
    fps,
    resolution: input.resolution,
    width: dims.width,
    height: dims.height,
    durationSeconds,
    frameCount: Math.round(durationSeconds * fps),
    videoBytes: dest.videoBytes,
    audioBytes: dest.audioBytes,
    estimatedFileBytes: dest.videoBytes + dest.audioBytes,
    destinationRequiredBytes: dest.destinationRequiredBytes,
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
