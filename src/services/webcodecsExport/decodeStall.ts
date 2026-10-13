/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The typed failure for a bounded decode stall in the export frame loop.
 *
 * `sequentialDecode.ts` knows only the asset URL and how long it waited;
 * `spotPlayback.ts` adds the spot's asset id and its ladder attempts. Neither
 * knows which timeline segment the playhead was in. The worker does, so it
 * wraps either signal here into one error that names the segment index, the
 * asset id, the await that expired, how long it waited, and how many decoders
 * were open — the line the operator reads instead of "no output for 30s".
 */

import { DecodeStallError, emitDecoderEvent, noteDecodeStall } from './sequentialDecode';
import { DemuxStallError } from '../videoDemuxer';
import { SpotDecodeStalledError } from './spotPlayback';
import type { ExportFailureVia } from './exportWorkerDiagnostics';

export type DecodeStallLayer = 'segment' | 'spot';

export class DecodeStalledFailure extends Error {
  readonly layer: DecodeStallLayer;
  readonly segmentIndex: number;
  readonly assetId: string;
  readonly waitedMs: number;
  readonly awaitName: string;
  readonly openDecoders: number;
  constructor(input: {
    layer: DecodeStallLayer;
    segmentIndex: number;
    assetId: string;
    waitedMs: number;
    awaitName: string;
    openDecoders: number;
    detail: string;
  }) {
    const token = input.layer === 'spot' ? 'spot_decode_stalled' : 'segment_decode_stalled';
    super(
      `${token}: segment ${input.segmentIndex} asset "${input.assetId}" — ${input.awaitName} ` +
        `produced no frame for ${Math.round(input.waitedMs)}ms (open decoders: ${input.openDecoders}). ${input.detail}`,
    );
    this.name = 'DecodeStalledFailure';
    this.layer = input.layer;
    this.segmentIndex = input.segmentIndex;
    this.assetId = input.assetId;
    this.waitedMs = input.waitedMs;
    this.awaitName = input.awaitName;
    this.openDecoders = input.openDecoders;
  }
}

/** Wraps a stall signal (`DecodeStallError` / `SpotDecodeStalledError`) with
 *  the worker's context. Returns null for anything else, so the caller's
 *  existing classification stays in charge of every other error. */
export function decodeStallFailureFrom(
  err: unknown,
  ctx: { layer: DecodeStallLayer; segmentIndex: number; assetId: string | null; openDecoders: number },
): DecodeStalledFailure | null {
  if (err instanceof DecodeStalledFailure) return err;
  if (err instanceof SpotDecodeStalledError) {
    return new DecodeStalledFailure({
      layer: 'spot',
      segmentIndex: ctx.segmentIndex,
      assetId: err.assetId,
      waitedMs: err.waitedMs,
      awaitName: err.awaitName,
      openDecoders: ctx.openDecoders,
      detail: `${err.message} (attempts: ${err.attempts})`,
    });
  }
  const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
  if (cause instanceof DemuxStallError) {
    return new DecodeStalledFailure({
      layer: ctx.layer,
      segmentIndex: ctx.segmentIndex,
      assetId: ctx.assetId ?? cause.url,
      waitedMs: 0,
      awaitName: 'demux-parse',
      openDecoders: ctx.openDecoders,
      detail: cause.message,
    });
  }
  if (err instanceof DecodeStallError) {
    return new DecodeStalledFailure({
      layer: ctx.layer,
      segmentIndex: ctx.segmentIndex,
      assetId: ctx.assetId ?? err.assetUrl,
      waitedMs: err.waitedMs,
      awaitName: err.awaitName,
      openDecoders: ctx.openDecoders,
      detail: err.message,
    });
  }
  return null;
}

export function decodeStallVia(f: DecodeStalledFailure): ExportFailureVia {
  return f.layer === 'spot' ? 'spot-decode-stalled' : 'decode-stalled';
}

/** The one naming line for a bounded stall: retained in the decoder
 *  diagnostics, forwarded to the native log, counted as "inside the decoder"
 *  (the decoder existed and went silent — a demux that never finished is
 *  counted "before the decoder" by sequentialDecode itself). */
export function recordDecodeStall(f: DecodeStalledFailure): void {
  // A demux stall was already counted "before the decoder" where it happened.
  if (f.awaitName !== 'demux-parse') noteDecodeStall('inside-decoder', f.message);
  emitDecoderEvent(f.message);
}
