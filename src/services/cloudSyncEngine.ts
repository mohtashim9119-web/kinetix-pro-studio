/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 3 U2 — the cloud engine behind `resolveSyncEngine`.
//
// Two stages, each plugged into the SAME seam its local engine uses, and each
// returning the SAME shape so nothing downstream (Hirschberg, rescue, the FA
// mappers, the spine) learns that a different engine ran:
//
//   - transcription → `transcribeForHost` (the staging seam
//     `useWhisper.startTranscription` calls; `whisperService.ts`'s
//     `transcribeWithProgress` is the local arm), returning tokens + the
//     provenance of the engine that actually ran.
//   - alignment → `alignViaCloud`, called by `runForcedAlignmentForSync`
//     with the chunk plan it already built, returning `FaWordSpan[]`.
//
// Audio is prepared once per content hash (`prepareCloudAudioOnce`,
// single-flight): whichever stage needs it first encodes, and a concurrent
// caller awaits the SAME promise instead of encoding twice.
//
// Wave 3 U3 — cache first (`runStageCacheFirst`). Every stage asks the
// gateway "already computed?" before touching the audio: a hit returns the
// result with nothing encoded, uploaded, spawned, or billed; a miss on audio
// the gateway already holds skips the encode and upload too. Only a miss on
// audio the gateway lacks prepares it. (U2's unconditional encode + upload
// at voiceover-add is gone for the same reason: it spent the encode before
// anyone had asked whether the result was already cached.)
// ---------------------------------------------------------------------------

import type { Asset, TimingProvenance, TranscriptToken } from '../types';
import {
  lookupCloudCache,
  prepareCloudAudio,
  runCloudJob,
  toCloudError,
  type CloudAlignResult,
  type CloudChunk,
  type CloudError,
  type CloudJobEvent,
  type CloudJobRequest,
  type CloudTranscribeResult,
  type CloudUpload,
} from './cloudGateway';
import type { FaWordSpan } from './faBoundaryTypes';
import type { SyncEngineHost } from './syncEngineHost';
import { stampCloudProvenance, stampWhisperProvenance, type GatewayProvenance } from './timingProvenance';
import { transcribeWithProgress } from './whisperService';

// ---------------------------------------------------------------------------
// Audio preparation, single-flight by content hash.
// ---------------------------------------------------------------------------

const inFlightAudio = new Map<string, Promise<CloudUpload & { encoded: boolean }>>();

/**
 * Encode + upload this audio, at most once concurrently per hash. A failed
 * attempt is forgotten so the next caller retries rather than inheriting a
 * stale rejection; a successful one is forgotten too — the Rust-side Opus
 * cache and the gateway's HEAD make every later call cheap anyway.
 */
export function prepareCloudAudioOnce(file: Blob, audioHash: string): Promise<CloudUpload & { encoded: boolean }> {
  const existing = inFlightAudio.get(audioHash);
  if (existing) return existing;
  const attempt = prepareCloudAudio(file, audioHash).finally(() => {
    inFlightAudio.delete(audioHash);
  });
  inFlightAudio.set(audioHash, attempt);
  return attempt;
}

/** Test-only. */
export function __resetCloudAudioInFlightForTests(): void {
  inFlightAudio.clear();
}

async function assetBlob(asset: Asset): Promise<Blob> {
  return asset.file ?? (await (await fetch(asset.url)).blob());
}

/** What one cache-first stage run actually did — for logs and the billing
 *  reconciliation, never for branching on correctness. */
export interface CloudStageRun<R> {
  result: R;
  /** Answered from the gateway's result cache: no GPU, no charge. */
  cached: boolean;
  /** This run sent audio bytes to the gateway. */
  uploaded: boolean;
  /** This run encoded Opus locally (false on a local Opus-cache hit). */
  encoded: boolean;
}

function isAudioMissing(err: unknown): boolean {
  const e = toCloudError(err);
  return e.kind === 'rejected' && e.code === 'audio-missing';
}

/**
 * Wave 3 U3 — lookup, then (only on a miss) prepare the audio, then submit.
 * `audio` is only called when bytes must actually be sent. If retention
 * drops the audio between the lookup and the submit, the one typed refusal
 * (`audio-missing`) re-prepares and resubmits once.
 */
export async function runStageCacheFirst<R>(
  request: CloudJobRequest,
  audio: () => Promise<Blob>,
  options: { signal?: AbortSignal; onEvent?: (event: CloudJobEvent) => void } = {},
): Promise<CloudStageRun<R>> {
  const { signal, onEvent } = options;
  const cancelled: CloudError = { kind: 'cancelled' };
  if (signal?.aborted) throw cancelled;
  const lookup = await lookupCloudCache<R>(request);
  if (lookup.cached) return { result: lookup.result, cached: true, uploaded: false, encoded: false };
  if (signal?.aborted) throw cancelled;

  let uploaded = false;
  let encoded = false;
  const prepare = async (): Promise<void> => {
    const prep = await prepareCloudAudioOnce(await audio(), request.audioHash);
    uploaded ||= prep.uploaded;
    encoded ||= prep.encoded;
    if (signal?.aborted) throw cancelled;
  };
  if (!lookup.audioPresent) await prepare();
  let view;
  try {
    view = await runCloudJob<R>(request, { signal, onEvent });
  } catch (err) {
    if (!isAudioMissing(err)) throw err;
    await prepare();
    view = await runCloudJob<R>(request, { signal, onEvent });
  }
  return { result: view.result!, cached: view.cached, uploaded, encoded };
}

// ---------------------------------------------------------------------------
// Progress. The gateway reports phases, not percentages; the bar advances on
// an ETA from the measured warm throughput (~33x realtime on T4, plus a
// cold-start allowance) and never claims 100% before the result is in hand.
// ---------------------------------------------------------------------------

const MEASURED_TRANSCRIBE_RTF = 33;
const COLD_START_ALLOWANCE_SEC = 30;

export function cloudProgressPercent(event: CloudJobEvent, audioDurationSec: number): number {
  if (event.type === 'submitted') return event.cached ? 95 : 5;
  if (event.status === 'queued') return 5;
  if (event.status !== 'running') return 95;
  const expected = audioDurationSec / MEASURED_TRANSCRIBE_RTF + COLD_START_ALLOWANCE_SEC;
  return Math.min(95, Math.max(10, Math.round(10 + (85 * event.elapsedSec) / expected)));
}

// ---------------------------------------------------------------------------
// Transcription.
// ---------------------------------------------------------------------------

export interface HostTranscribeResult {
  tokens: TranscriptToken[];
  detectedLanguage?: string;
  /** Stamps this run's transcription provenance for the caller's final
   *  language and commit time — the engine, model and revision are fixed
   *  by whichever arm actually ran. */
  stamp: (args: { language?: string; completedAt: number }) => TimingProvenance;
  host: SyncEngineHost;
  /** Wave 3 U3 — cloud only: served from the gateway's transcript cache. */
  cached?: boolean;
}

/** A cloud failure surfaced through the staging path's existing Error
 *  channel, keeping the typed error for callers that want it. */
export class CloudStageError extends Error {
  constructor(readonly cloud: CloudError, message: string) {
    super(message);
    this.name = 'CloudStageError';
  }
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

export async function transcribeViaCloud(args: {
  asset: Asset;
  audioHash: string;
  durationSecs: number;
  language: string | undefined;
  onProgress: (percent: number) => void;
  signal: AbortSignal;
}): Promise<HostTranscribeResult> {
  const { asset, audioHash, durationSecs, language, onProgress, signal } = args;
  if (signal.aborted) throw abortError();
  try {
    onProgress(1);
    const run = await runStageCacheFirst<CloudTranscribeResult>(
      { stage: 'transcribe', audioHash, language: language ?? 'auto' },
      () => assetBlob(asset),
      { signal, onEvent: e => onProgress(cloudProgressPercent(e, durationSecs)) },
    );
    logStageRun('transcript', run);
    const result = run.result;
    const provenance = result.provenance as GatewayProvenance;
    return {
      tokens: result.tokens,
      detectedLanguage: language === undefined ? (result.detectedLanguage ?? undefined) : undefined,
      stamp: ({ language: lang, completedAt }) => stampCloudProvenance(provenance, { language: lang, completedAt }),
      host: 'cloud',
      cached: run.cached,
    };
  } catch (err) {
    if (err instanceof DOMException) throw err;
    const cloud = toCloudError(err);
    if (cloud.kind === 'cancelled') throw abortError();
    throw new CloudStageError(cloud, `Cloud transcription failed: ${describeForStaging(cloud)}`);
  }
}

function logStageRun(what: 'transcript' | 'alignment', run: CloudStageRun<unknown>): void {
  if (run.cached) {
    console.info(`[cloud] ${what} served from the cloud cache — nothing encoded, uploaded, or charged.`);
  } else {
    console.info(`[cloud] ${what} computed on the cloud (encoded=${run.encoded}, uploaded=${run.uploaded}).`);
  }
}

function describeForStaging(error: CloudError): string {
  switch (error.kind) {
    case 'notConfigured': return 'no cloud key is set (App Settings → Sync Engine → Cloud sync).';
    case 'unreachable': return 'the sync server could not be reached — check your connection.';
    case 'auth': return 'the sync server did not accept this computer\'s key.';
    case 'tooLong': return 'the voiceover is longer than the one-hour cloud limit.';
    case 'jobFailed': return `the cloud job failed (${error.code}).`;
    case 'timeout': return 'the sync server did not answer in time.';
    case 'rejected': return `the sync server refused the request (${error.code}).`;
    case 'server': return `the sync server had an error (HTTP ${error.status}).`;
    case 'encode': return 'the audio could not be prepared for upload.';
    default: return error.kind;
  }
}

/**
 * The staging-time transcription seam, routed by host. Local is the
 * unchanged whisper.cpp path; cloud requires the content hash (the gateway's
 * cache key) and the asset's bytes.
 */
export async function transcribeForHost(args: {
  host: SyncEngineHost;
  asset: Asset;
  durationSecs: number;
  language: string | undefined;
  onProgress: (percent: number) => void;
  signal: AbortSignal;
  jobKey?: string;
  audioHash?: string;
}): Promise<HostTranscribeResult> {
  if (args.host === 'cloud') {
    if (!args.audioHash) {
      throw new CloudStageError(
        { kind: 'protocol', detail: 'no audio hash' },
        'Cloud transcription failed: the voiceover could not be identified (no content hash).',
      );
    }
    return transcribeViaCloud({ ...args, audioHash: args.audioHash });
  }
  const { tokens, detectedLanguage } = await transcribeWithProgress(
    args.asset, args.durationSecs, args.language, args.onProgress, args.signal, args.jobKey,
  );
  return {
    tokens,
    detectedLanguage,
    stamp: ({ language, completedAt }) => stampWhisperProvenance({ language, completedAt }),
    host: 'local',
  };
}

// ---------------------------------------------------------------------------
// Alignment.
// ---------------------------------------------------------------------------

export type CloudAlignOutcome =
  | { status: 'ok'; words: FaWordSpan[]; nFallbackChunks: number; provenance: GatewayProvenance; cached: boolean }
  | { status: 'cancelled' }
  | { status: 'failed'; error: CloudError };

/** Never throws — every outcome is typed, matching `runForcedAlignmentForSync`'s
 *  own "never throws" contract that calls it. */
export async function alignViaCloud(args: {
  voiceoverBlob: Blob;
  audioHash: string;
  chunks: readonly CloudChunk[];
  language: string;
  signal?: AbortSignal;
}): Promise<CloudAlignOutcome> {
  try {
    const run = await runStageCacheFirst<CloudAlignResult>(
      {
        stage: 'align',
        audioHash: args.audioHash,
        language: args.language,
        chunks: args.chunks.map(c => ({ startSec: c.startSec, endSec: c.endSec, text: c.text })),
      },
      async () => args.voiceoverBlob,
      { signal: args.signal },
    );
    logStageRun('alignment', run);
    const result = run.result;
    return {
      status: 'ok',
      words: result.words,
      nFallbackChunks: result.nFallbackChunks,
      provenance: result.provenance as GatewayProvenance,
      cached: run.cached,
    };
  } catch (err) {
    const error = toCloudError(err);
    if (error.kind === 'cancelled') return { status: 'cancelled' };
    return { status: 'failed', error };
  }
}
