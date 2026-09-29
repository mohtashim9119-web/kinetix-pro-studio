/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CloudError } from './cloudGateway';

// ---------------------------------------------------------------------------
// Wave 3 U6 — the one-hour audio cap, client layer (layer 1 of 3).
//
// The other two layers live in `cloud/`: the gateway refuses an oversize
// body from Content-Length (413 → `tooLong`) and a longer-than-cap probe, and
// the Modal worker's own timeout bounds GPU time. This file is the only
// place the client learns the limits, and its values MIRROR
// `cloud/sync_core.py` (one TS + one Python constant, equality pinned by
// `cloudAudioLimit.test.ts` and `cloud/test_sync_core.py`).
// ---------------------------------------------------------------------------

/** One hour of 16 kHz mono libopus CBR 16 kbps, measured
 *  (docs/architecture/cloud-asr-plan.md). CBR makes size a duration proxy. */
export const OPUS_HOUR_BYTES = 7_477_405;
export const MAX_AUDIO_SEC = 3600;
/** ffprobe reports a few ms past the encoded length; the gateway allows 1 s. */
export const AUDIO_DURATION_TOLERANCE_SEC = 1;
/** The gateway's byte rail: the nominal hour plus a 2% margin. */
export const MAX_UPLOAD_BYTES = OPUS_HOUR_BYTES + Math.floor(OPUS_HOUR_BYTES / 50);

/** Seconds of 16 kbps Opus a body of this size holds. */
export function estimateOpusSec(bytes: number): number {
  return (bytes / OPUS_HOUR_BYTES) * 3600;
}

/** The one refusal sentence. Rounds the length UP to a tenth of an hour so
 *  it never understates (the epsilon absorbs float noise on exact values). */
export function tooLongMessage(durationSec: number): string {
  const hours = Math.ceil((durationSec / 3600) * 10 - 1e-3) / 10;
  return `This voiceover is about ${hours} hours — the cloud sync supports up to 1 hour. Split it or use Local.`;
}

function tooLong(estimatedSec: number, detail = tooLongMessage(estimatedSec)): CloudError {
  return { kind: 'tooLong', detail, estimatedSec };
}

/**
 * The precise check, from a probed duration (the voiceover's own container
 * metadata — nothing is encoded to learn it). `null` = allowed. The gateway's
 * 1 s probe tolerance is honoured so an honest one-hour file is never refused
 * here and then accepted there.
 */
export function checkAudioDuration(durationSec: number | undefined): CloudError | null {
  if (durationSec === undefined || !Number.isFinite(durationSec)) return null;
  return durationSec > MAX_AUDIO_SEC + AUDIO_DURATION_TOLERANCE_SEC ? tooLong(durationSec) : null;
}

/**
 * The byte check on the encoded Opus, before it is uploaded. CBR makes bytes
 * a duration proxy, but only a loose one (the 2% margin is ~72 s), so a file
 * inside the margin is allowed and the gateway's probe decides. Over the
 * margin the gateway would 413 it anyway: refuse here, free. When the real
 * duration is known and honest the message says so rather than claiming a
 * length the audio does not have.
 */
export function checkOpusBytes(bytes: number, knownDurationSec?: number): CloudError | null {
  if (bytes <= MAX_UPLOAD_BYTES) return null;
  const known = knownDurationSec !== undefined && Number.isFinite(knownDurationSec);
  if (known) {
    const mb = (MAX_UPLOAD_BYTES / 1_000_000).toFixed(1);
    return tooLong(knownDurationSec, `The prepared audio is larger than the cloud sync upload limit (${mb} MB). Split the voiceover or use Local.`);
  }
  return tooLong(estimateOpusSec(bytes));
}
