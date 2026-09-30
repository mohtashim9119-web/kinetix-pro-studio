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
//
// Wave 3 U4 — retry once, then pause (plan-v3 Wave 3 item 4). A TRANSIENT
// failure (unreachable, timeout, gateway 5xx, a lost/crashed worker) retries
// the whole cache-first run exactly once after a short, cancellable wait:
// the lookup answers for anything that finished meanwhile, the gateway's
// HEAD skips a re-upload, and the gateway re-attaches a resubmit to a job
// still in flight — so a retry never re-bills work already done. A second
// failure, or any failure a retry cannot change (auth, too long, a refusal,
// a worker error, the job-time cap), goes straight to the caller, which
// PAUSES and asks. Never a silent loop, never a silent switch to local.
// ---------------------------------------------------------------------------

import type { Asset, TimingProvenance, TranscriptToken } from '../types';
import {
  lookupCloudCache,
  prepareCloudAudio,
  releaseCloudJob,
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
import { checkAudioDuration } from './cloudAudioLimit';
import { recordCancelReceipt, trackStoppingRun } from './cloudCancelReceipts';

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
export function prepareCloudAudioOnce(
  file: Blob,
  audioHash: string,
  options: { durationSec?: number } = {},
): Promise<CloudUpload & { encoded: boolean }> {
  const existing = inFlightAudio.get(audioHash);
  if (existing) return existing;
  const attempt = prepareCloudAudio(file, audioHash, options).finally(() => {
    inFlightAudio.delete(audioHash);
  });
  inFlightAudio.set(audioHash, attempt);
  return attempt;
}

/**
 * Wave 3 U7.5 — STAGE AUDIO ONLY. Encode this voiceover to Opus and put it in
 * the gateway's audio cache, and NOTHING else: no cache lookup, no job, no GPU,
 * no meter line, no held container. Bulk Projects calls it the moment a
 * voiceover lands in a row so each later job finds its audio already there
 * (`lookupCloudCache` -> `audioPresent`) and skips the upload.
 *
 * Before this unit the encode + upload only ran as step one of a job attempt
 * (`attemptStageCacheFirst`), so there was no way to position audio without
 * also submitting work. Same single-flight and free refusals (one-hour cap,
 * Opus size) as every other upload.
 */
export function stageCloudAudioOnly(
  file: Blob,
  audioHash: string,
  options: { durationSec?: number } = {},
): Promise<CloudUpload & { encoded: boolean }> {
  return prepareCloudAudioOnce(file, audioHash, options);
}

/** Test-only. */
export function __resetCloudAudioInFlightForTests(): void {
  inFlightAudio.clear();
}

async function assetBlob(asset: Asset): Promise<Blob> {
  return asset.file ?? (await (await fetch(asset.url)).blob());
}

/** Wave 3 U7 — GPU seconds this window's cloud jobs have worked, summed at
 *  the one place a job's view arrives. The bulk queue reads it before/after
 *  each project to price the batch. */
let workerSecTotal = 0;
export function cloudWorkerSecTotal(): number {
  return workerSecTotal;
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
  /** Wave 3 U4 — the first attempt failed transiently and this is the
   *  result of the one retry. */
  retried: boolean;
  /** Wave 3 U4.5 — the job that produced it (absent on a lookup hit). */
  jobId?: string;
  /** Wave 3 U4.5 — a held transcription's container ran it (no boot). */
  handedOff?: boolean;
  /** Wave 3 U7 — GPU seconds the job worked (absent on a lookup hit); the
   *  bulk queue's batch cost adds these up. */
  workerSec?: number;
}

// ---------------------------------------------------------------------------
// Wave 3 U4.5 — held transcriptions (one boot per sync). A staging
// transcription on the cloud asks the gateway to keep its GPU container for
// up to `HELD_TRANSCRIPTION_TTL_MS` after the transcript is written. The
// alignment for the same audio takes it (`takeHeldTranscription`) and names
// it on submit, so it runs in that container; anything that decides there is
// nothing to align RELEASES it at once — the GPU waits for the client's
// planning seconds, never for files. A stale entry is harmless: the gateway
// just spawns normally for a hold that already closed.
// ---------------------------------------------------------------------------

/** Mirrors `cloud/sync_core.py`'s HOLD_FOR_PLAN_SEC, minus a margin. */
export const HELD_TRANSCRIPTION_TTL_MS = 25_000;

/**
 * The language key a cloud transcribe is stored under. Peek, adopt and the
 * batch job must share this — a second normalization is a cache miss.
 */
export function cloudTranscribeLanguage(language: string | undefined): string {
  return language ?? 'auto';
}

/** Warn when the client sits this long between transcribe-done and align-submit. */
export const STAGE_GAP_WARN_MS = 10_000;

export interface StageGap {
  audioHash: string;
  gapMs: number;
  warned: boolean;
}

const stageGaps: StageGap[] = [];

export function noteStageGap(audioHash: string, transcribeDoneAt: number, alignSubmittedAt: number = Date.now()): StageGap {
  const gapMs = Math.max(0, alignSubmittedAt - transcribeDoneAt);
  const warned = gapMs > STAGE_GAP_WARN_MS;
  const gap = { audioHash, gapMs, warned };
  stageGaps.push(gap);
  if (warned) {
    console.warn(`[cloud] ${gapMs}ms between transcribe done and align submit for ${audioHash.slice(0, 8)} — the hold window is 30s`);
  }
  return gap;
}

export function recentStageGaps(): readonly StageGap[] {
  return stageGaps;
}

export function __resetStageGapsForTests(): void {
  stageGaps.length = 0;
}

const heldTranscriptions = new Map<string, { jobId: string; at: number }>();

function rememberHeld(audioHash: string, jobId: string): void {
  heldTranscriptions.set(audioHash, { jobId, at: Date.now() });
}

/** Wave 3 U7 — a bulk queue hands the container it kept from the previous
 *  project to this audio (only when this audio holds nothing of its own). */
export function adoptHeldContainer(audioHash: string, jobId: string): void {
  if (!heldTranscriptions.has(audioHash)) rememberHeld(audioHash, jobId);
}

/** Wave 3 U7 — audios whose alignment should keep its container for the
 *  next queued project. Consumed by `alignViaCloud`. */
const holdAfterAlign = new Set<string>();
const heldAligns = new Map<string, { jobId: string; at: number }>();

export function requestHoldAfterAlign(audioHash: string): void {
  holdAfterAlign.add(audioHash);
}

/** The container this audio's alignment kept for the queue, if any (fresh). */
export function takeHeldAlign(audioHash: string): string | undefined {
  holdAfterAlign.delete(audioHash);
  const held = heldAligns.get(audioHash);
  heldAligns.delete(audioHash);
  if (!held || Date.now() - held.at > HELD_TRANSCRIPTION_TTL_MS) return undefined;
  return held.jobId;
}

/** The live held transcription for this audio, removed from the registry. */
export function takeHeldTranscription(audioHash: string): string | undefined {
  const held = heldTranscriptions.get(audioHash);
  heldTranscriptions.delete(audioHash);
  if (!held || Date.now() - held.at > HELD_TRANSCRIPTION_TTL_MS) return undefined;
  return held.jobId;
}

export function hasHeldTranscription(audioHash: string): boolean {
  const held = heldTranscriptions.get(audioHash);
  return held !== undefined && Date.now() - held.at <= HELD_TRANSCRIPTION_TTL_MS;
}

/** Let this audio's held container exit now. Never throws: a failed release
 *  only means the hold runs out on its own (bounded, and metered).
 *  A stale local entry is still released: the server hold outlives the
 *  client's 25s TTL and otherwise idles out the full 30s window. */
export function releaseHeldTranscription(audioHash: string): void {
  const held = heldTranscriptions.get(audioHash);
  heldTranscriptions.delete(audioHash);
  if (held) void releaseCloudJob(held.jobId).catch(() => {});
}

/** Test-only. */
export function __resetHeldTranscriptionsForTests(): void {
  heldTranscriptions.clear();
}

// ---------------------------------------------------------------------------
// Wave 3 U4.5 — honest phase, per audio: what the cloud is doing for it RIGHT
// NOW, from the gateway's own job states. Read by the reveal overlay.
// ---------------------------------------------------------------------------

export type CloudPhase = 'waiting-gpu' | 'transcribing' | 'aligning';

const phaseListeners = new Map<string, Set<(phase: CloudPhase) => void>>();

export function onCloudPhase(audioHash: string, listener: (phase: CloudPhase) => void): () => void {
  let set = phaseListeners.get(audioHash);
  if (!set) { set = new Set(); phaseListeners.set(audioHash, set); }
  set.add(listener);
  return () => { set!.delete(listener); };
}

function reportPhase(audioHash: string, phase: CloudPhase): void {
  for (const listener of phaseListeners.get(audioHash) ?? []) listener(phase);
}

/** A job event as the phase it means: queued = waiting for a GPU (unbilled). */
export function phaseForEvent(stage: 'transcribe' | 'align', event: CloudJobEvent): CloudPhase | undefined {
  if (event.type === 'submitted') return event.cached ? undefined : 'waiting-gpu';
  if (event.type === 'cancelled') return undefined;
  if (event.status === 'queued') return 'waiting-gpu';
  if (event.status === 'running') return stage === 'transcribe' ? 'transcribing' : 'aligning';
  return undefined;
}

/** Wave 3 U4 — failures a second attempt can plausibly fix. Everything
 *  else is deterministic for the same request (retrying would only
 *  re-bill or re-refuse). */
const RETRYABLE_JOB_CODES: ReadonlySet<string> = new Set(['worker-lost', 'worker-crashed']);

export function isRetryableCloudError(error: CloudError): boolean {
  switch (error.kind) {
    case 'unreachable':
    case 'timeout':
    case 'server':
      return true;
    case 'jobFailed':
      return RETRYABLE_JOB_CODES.has(error.code);
    default:
      return false;
  }
}

/** Wave 3 U4 — the pause reason a cloud failure (already past its one
 *  retry, where retryable) presents as. One mapping for every cloud stage. */
export type CloudPauseReason = 'offline' | 'cloud-auth' | 'inference-failed';

export function cloudPauseReason(error: CloudError): CloudPauseReason {
  if (error.kind === 'unreachable' || error.kind === 'timeout') return 'offline';
  if (error.kind === 'auth' || error.kind === 'notConfigured') return 'cloud-auth';
  return 'inference-failed';
}

/** The one retry's wait: long enough for a network blip or a gateway
 *  container restart, short enough not to feel like a hang. */
export const CLOUD_RETRY_DELAY_MS = 3000;
let retryDelayMs = CLOUD_RETRY_DELAY_MS;

/** Test-only: the retry's wait, so unit tests don't sleep. */
export function __setCloudRetryDelayForTests(ms: number): void {
  retryDelayMs = ms;
}

function cancellableDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject({ kind: 'cancelled' } satisfies CloudError); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = (): void => { clearTimeout(timer); reject({ kind: 'cancelled' } satisfies CloudError); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
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
  options: {
    signal?: AbortSignal;
    onEvent?: (event: CloudJobEvent) => void;
    /** Wave 3 U4 — told once, before the retry's wait, with the first failure. */
    onRetry?: (error: CloudError) => void;
    /** Wave 3 U6 — the voiceover's probed length. Over the one-hour cap the
     *  run is refused before anything is asked of the network. */
    audioDurationSec?: number;
  } = {},
): Promise<CloudStageRun<R>> {
  try {
    return await attemptStageCacheFirst<R>(request, audio, options);
  } catch (err) {
    const first = toCloudError(err);
    if (!isRetryableCloudError(first)) throw first;
    console.warn(`[cloud] ${request.stage} failed (${first.kind}) — retrying once in ${retryDelayMs / 1000}s:`, first);
    options.onRetry?.(first);
    await cancellableDelay(retryDelayMs, options.signal);
    const run = await attemptStageCacheFirst<R>(request, audio, options);
    return { ...run, retried: true };
  }
}

async function attemptStageCacheFirst<R>(
  request: CloudJobRequest,
  audio: () => Promise<Blob>,
  options: { signal?: AbortSignal; onEvent?: (event: CloudJobEvent) => void; audioDurationSec?: number },
): Promise<CloudStageRun<R>> {
  const { signal, onEvent, audioDurationSec } = options;
  const cancelled: CloudError = { kind: 'cancelled' };
  if (signal?.aborted) throw cancelled;
  // Wave 3 U6 — before even the (free) lookup: nothing over an hour can be
  // cached, and a refusal must cost no network, no encode, no upload.
  const overLong = checkAudioDuration(audioDurationSec);
  if (overLong) throw overLong;
  const lookup = await lookupCloudCache<R>(request);
  if (lookup.cached) return { result: lookup.result, cached: true, uploaded: false, encoded: false, retried: false };
  if (signal?.aborted) throw cancelled;

  let uploaded = false;
  let encoded = false;
  const prepare = async (): Promise<void> => {
    const prep = await prepareCloudAudioOnce(await audio(), request.audioHash, { durationSec: audioDurationSec });
    uploaded ||= prep.uploaded;
    encoded ||= prep.encoded;
    if (signal?.aborted) throw cancelled;
  };
  if (!lookup.audioPresent) await prepare();
  let view;
  try {
    view = await runJobWithReceipt<R>(request, signal, onEvent);
  } catch (err) {
    if (!isAudioMissing(err)) throw err;
    await prepare();
    view = await runJobWithReceipt<R>(request, signal, onEvent);
  }
  workerSecTotal += view.workerSec ?? 0;
  return {
    result: view.result!, cached: view.cached, uploaded, encoded, retried: false,
    jobId: view.jobId, handedOff: view.handedOff === true, workerSec: view.workerSec ?? undefined,
  };
}

/** Wave 3 U5 — a job run whose cancel, if any, leaves a receipt: the
 *  gateway's own answer on whether the job started and what it billed. */
function runJobWithReceipt<R>(
  request: CloudJobRequest,
  signal: AbortSignal | undefined,
  onEvent: ((event: CloudJobEvent) => void) | undefined,
): ReturnType<typeof runCloudJob<R>> {
  const run = runCloudJob<R>(request, {
    signal,
    onEvent: event => {
      if (event.type === 'cancelled') {
        recordCancelReceipt({
          stage: request.stage,
          jobId: event.jobId,
          confirmed: event.confirmed,
          started: event.started,
          workerSec: event.workerSec,
          estimatedUsd: event.estimatedUsd,
          at: Date.now(),
        });
        return;
      }
      onEvent?.(event);
    },
  });
  if (signal) {
    const onAbort = (): void => trackStoppingRun(run);
    signal.addEventListener('abort', onAbort, { once: true });
    void run.then(
      () => signal.removeEventListener('abort', onAbort),
      () => signal.removeEventListener('abort', onAbort),
    );
  }
  return run;
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
  if (event.type === 'cancelled') return 0;
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
  /** Wave 3 U7 — cloud only: ran in a container handed over by the queue. */
  handedOff?: boolean;
  /** Wave 3 U7 — cloud only: GPU seconds worked (absent on a cache hit). */
  workerSec?: number;
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
  /** Wave 3 U4.5 — keep the container for this audio's alignment. */
  hold?: boolean;
  /** Wave 3 U7 — run in the container the previous queued project kept. */
  holdJobId?: string;
}): Promise<HostTranscribeResult> {
  const { asset, audioHash, durationSecs, language, onProgress, signal, hold, holdJobId } = args;
  if (signal.aborted) throw abortError();
  try {
    onProgress(1);
    const run = await runStageCacheFirst<CloudTranscribeResult>(
      {
        stage: 'transcribe', audioHash, language: cloudTranscribeLanguage(language),
        ...(hold ? { hold: true } : {}), ...(holdJobId ? { holdJobId } : {}),
      },
      () => assetBlob(asset),
      {
        signal,
        audioDurationSec: durationSecs,
        onEvent: e => {
          onProgress(cloudProgressPercent(e, durationSecs));
          const phase = phaseForEvent('transcribe', e);
          if (phase) reportPhase(audioHash, phase);
        },
      },
    );
    logStageRun('transcript', run);
    // A cache hit has no container to hold; a computed one does.
    if (hold && !run.cached && run.jobId) rememberHeld(audioHash, run.jobId);
    const result = run.result;
    const provenance = result.provenance as GatewayProvenance;
    return {
      tokens: result.tokens,
      detectedLanguage: language === undefined ? (result.detectedLanguage ?? undefined) : undefined,
      stamp: ({ language: lang, completedAt }) => stampCloudProvenance(provenance, { language: lang, completedAt }),
      host: 'cloud',
      cached: run.cached,
      handedOff: run.handedOff === true,
      workerSec: run.workerSec,
    };
  } catch (err) {
    if (err instanceof DOMException) throw err;
    const cloud = toCloudError(err);
    if (cloud.kind === 'cancelled') throw abortError();
    throw new CloudStageError(cloud, cloud.kind === 'tooLong' && cloud.estimatedSec !== undefined ? cloud.detail : `Cloud transcription failed: ${describeForStaging(cloud)}`);
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
  /** Wave 3 U4.5 — cloud only; ignored locally. */
  hold?: boolean;
  /** Wave 3 U7 — cloud only: the container the previous queued project kept. */
  holdJobId?: string;
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
  | {
      status: 'ok'; words: FaWordSpan[]; nFallbackChunks: number; provenance: GatewayProvenance; cached: boolean;
      /** Wave 3 U4.5 — ran in the held transcription's container. */
      handedOff: boolean;
      /** Wave 3 U7 — GPU seconds worked (absent on a cache hit). */
      workerSec?: number;
    }
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
  // Wave 3 U4.5 — hand this to the held transcription's container, if any.
  const pendingHold = heldTranscriptions.get(args.audioHash);
  if (pendingHold) noteStageGap(args.audioHash, pendingHold.at);
  const holdJobId = takeHeldTranscription(args.audioHash);
  // Wave 3 U7 — a queued project with another behind it keeps the container.
  const holdNext = holdAfterAlign.delete(args.audioHash);
  try {
    const run = await runStageCacheFirst<CloudAlignResult>(
      {
        stage: 'align',
        audioHash: args.audioHash,
        language: args.language,
        chunks: args.chunks.map(c => ({ startSec: c.startSec, endSec: c.endSec, text: c.text })),
        ...(holdJobId ? { holdJobId } : {}),
        ...(holdNext ? { hold: true } : {}),
      },
      async () => args.voiceoverBlob,
      {
        signal: args.signal,
        onEvent: e => {
          const phase = phaseForEvent('align', e);
          if (phase) reportPhase(args.audioHash, phase);
        },
      },
    );
    logStageRun('alignment', run);
    // Answered from the cache: the held container has nothing to do.
    if (holdJobId && run.cached) void releaseCloudJob(holdJobId).catch(() => {});
    if (holdNext && !run.cached && run.jobId) heldAligns.set(args.audioHash, { jobId: run.jobId, at: Date.now() });
    const result = run.result;
    return {
      status: 'ok',
      words: result.words,
      nFallbackChunks: result.nFallbackChunks,
      provenance: result.provenance as GatewayProvenance,
      cached: run.cached,
      handedOff: run.handedOff === true,
      workerSec: run.workerSec,
    };
  } catch (err) {
    if (holdJobId) void releaseCloudJob(holdJobId).catch(() => {});
    const error = toCloudError(err);
    if (error.kind === 'cancelled') return { status: 'cancelled' };
    return { status: 'failed', error };
  }
}
