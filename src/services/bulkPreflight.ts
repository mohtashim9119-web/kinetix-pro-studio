/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Cheap local checks before any GPU job is submitted. A wrong-shape file
// (no scenes, unreadable or empty audio, over the hour cap) must stop here.

import { MAX_AUDIO_SEC, tooLongMessage } from './cloudAudioLimit';
import { CLOUD_USD_PER_WORKER_SEC } from './cloudQueueJob';
import { formatUsd } from './syncQueue';
import { classifyVoiceoverReadCause, voiceoverReadSkipReason } from './voiceoverReadCause';

const MEASURED_TRANSCRIBE_RTF = 33;

export interface BulkPreflightInput {
  durationSec?: number;
  sceneText?: string;
  audioError?: string;
  parseError?: string;
}

export type BulkPreflight =
  | { ok: true; durationSec: number; sceneCount: number; estimatedUsd: number; summary: string }
  | { ok: false; reason: string };

export function countScenes(sceneText: string): number {
  return sceneText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0).length;
}

export function estimateCloudUsd(durationSec: number): number {
  const workerSec = durationSec / MEASURED_TRANSCRIBE_RTF;
  return workerSec * CLOUD_USD_PER_WORKER_SEC;
}

export function bulkPreflight(input: BulkPreflightInput): BulkPreflight {
  if (input.audioError) {
    const kind = classifyVoiceoverReadCause(input.audioError);
    return { ok: false, reason: voiceoverReadSkipReason(kind, input.audioError) };
  }
  if (input.parseError) return { ok: false, reason: input.parseError };
  const durationSec = input.durationSec ?? 0;
  if (!(durationSec > 0)) {
    return { ok: false, reason: voiceoverReadSkipReason('decode-failed') };
  }
  if (durationSec > MAX_AUDIO_SEC) return { ok: false, reason: tooLongMessage(durationSec) };
  const sceneCount = countScenes(input.sceneText ?? '');
  if (sceneCount < 1) return { ok: false, reason: 'The scene doc has no scenes — fix the file before spending cloud GPU.' };
  const estimatedUsd = estimateCloudUsd(durationSec);
  const mins = Math.max(1, Math.round(durationSec / 60));
  return {
    ok: true,
    durationSec,
    sceneCount,
    estimatedUsd,
    summary: `${mins} min audio · ${sceneCount} scenes · about ${formatUsd(estimatedUsd)}`,
  };
}
