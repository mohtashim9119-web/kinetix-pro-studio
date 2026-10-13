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

import { DecodeStallError } from './sequentialDecode';
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
