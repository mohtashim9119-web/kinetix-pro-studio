/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 3 U1 — typed frontend for the cloud sync gateway.
//
// A thin wrapper over the Rust `cloud_gateway.rs` commands, the same
// `invoke`/`Channel` shape `modelDownload.ts` and `whisperService.ts` use.
// The WebView never sees the API key and never opens a connection to the
// gateway itself (the CSP does not allow it); everything here asks Rust.
//
// Every rejection is a `CloudError` — a tagged union mirrored from Rust's
// `CloudError` — so callers branch on `kind`, never on message text. This
// layer makes exactly one attempt; retry-once-then-pause lives one layer up
// (Wave 3 U4).
// ---------------------------------------------------------------------------

import { invoke, Channel } from '@tauri-apps/api/core';
import type { FaWordSpan } from './faBoundaryTypes';

export type CloudError =
  | { kind: 'notConfigured' }
  | { kind: 'unreachable'; detail: string }
  | { kind: 'timeout'; detail: string }
  | { kind: 'auth' }
  | { kind: 'tooLong'; detail: string }
  | { kind: 'rejected'; status: number; code: string; detail: string }
  | { kind: 'server'; status: number; detail: string }
  | { kind: 'jobFailed'; jobId: string; code: string; detail: string }
  | { kind: 'cancelled' }
  | { kind: 'encode'; detail: string }
  | { kind: 'io'; detail: string }
  | { kind: 'protocol'; detail: string };

const CLOUD_ERROR_KINDS: ReadonlySet<string> = new Set<CloudError['kind']>([
  'notConfigured', 'unreachable', 'timeout', 'auth', 'tooLong', 'rejected',
  'server', 'jobFailed', 'cancelled', 'encode', 'io', 'protocol',
]);

export function isCloudError(value: unknown): value is CloudError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    CLOUD_ERROR_KINDS.has((value as { kind: string }).kind)
  );
}

/** Anything a cloud call rejected with, as a `CloudError`. A non-typed
 *  rejection (an IPC-layer failure, a missing command) is a `protocol`
 *  error carrying its text, never silently dropped. */
export function toCloudError(value: unknown): CloudError {
  if (isCloudError(value)) return value;
  const detail = value instanceof Error ? value.message : typeof value === 'string' ? value : JSON.stringify(value);
  return { kind: 'protocol', detail: detail ?? 'unknown error' };
}

/** One human sentence per failure kind, for settings/status lines. */
export function describeCloudError(error: CloudError): string {
  switch (error.kind) {
    case 'notConfigured': return 'No cloud key is set on this computer.';
    case 'unreachable': return 'Could not reach the cloud sync server. Check your internet connection.';
    case 'timeout': return 'The cloud sync server did not answer in time.';
    case 'auth': return 'The cloud sync server did not accept this key.';
    case 'tooLong': return 'This audio is longer than the one-hour cloud limit.';
    case 'rejected': return `The cloud sync server refused the request (${error.code}): ${error.detail}`;
    case 'server': return `The cloud sync server had an error (HTTP ${error.status}).`;
    case 'jobFailed': return `The cloud job failed (${error.code}).`;
    case 'cancelled': return 'Cancelled.';
    case 'encode': return 'Could not prepare the audio for upload.';
    case 'io': return `A local file error stopped the cloud request: ${error.detail}`;
    case 'protocol': return `Unexpected answer from the cloud sync server: ${error.detail}`;
  }
}

export interface CloudKeyStatus {
  configured: boolean;
  gateway: string;
}

export interface CloudPing {
  member: string;
  schema: number;
  engines: { transcribe: string; align: string };
  limits: { maxAudioSec: number; maxUploadBytes: number };
  latencyMs: number;
}

export interface CloudUpload {
  /** False when the gateway already held this audio — no bytes were sent. */
  uploaded: boolean;
  durationSec: number;
  opusBytes: number;
}

export type CloudStage = 'transcribe' | 'align';

export interface CloudChunk {
  startSec: number;
  endSec: number;
  text: string;
}

export interface CloudJobRequest {
  stage: CloudStage;
  audioHash: string;
  /** `'auto'` or a code for transcribe; one of the FA pack codes for align. */
  language: string;
  chunks?: CloudChunk[];
}

export interface CloudProvenance {
  engine: 'whisper-cloud' | 'fa-cloud';
  model: string;
  modelVersion: string;
  language: string | null;
}

export interface CloudTranscribeResult {
  tokens: { startSec: number; endSec: number; text: string }[];
  detectedLanguage: string | null;
  provenance: CloudProvenance;
  createdAt: number;
}

export interface CloudAlignResult {
  words: FaWordSpan[];
  nChunks: number;
  nFallbackChunks: number;
  provenance: CloudProvenance;
  createdAt: number;
}

export type CloudJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface CloudJobView<R> {
  jobId: string;
  stage: CloudStage;
  status: CloudJobStatus;
  /** True when a result-cache hit answered without a GPU (no charge). */
  cached: boolean;
  audioDurationSec: number | null;
  workerSec: number | null;
  error: { code: string; detail: string } | null;
  result?: R;
}

export type CloudJobEvent =
  | { type: 'submitted'; jobId: string; cached: boolean }
  /** `queued` = waiting for a GPU (unbilled); `running` = on the GPU. */
  | { type: 'status'; jobId: string; status: CloudJobStatus; elapsedSec: number };

async function call<T>(command: string, args?: Parameters<typeof invoke>[1], options?: Parameters<typeof invoke>[2]): Promise<T> {
  try {
    return await invoke<T>(command, args, options);
  } catch (err) {
    throw toCloudError(err);
  }
}

export function cloudKeyStatus(): Promise<CloudKeyStatus> {
  return call('cloud_key_status');
}

export function cloudKeySet(key: string): Promise<CloudKeyStatus> {
  return call('cloud_key_set', { key });
}

export function cloudKeyClear(): Promise<CloudKeyStatus> {
  return call('cloud_key_clear');
}

export function cloudPing(): Promise<CloudPing> {
  return call('cloud_ping');
}

/**
 * Make sure the gateway holds this audio: encode it to Opus locally (once —
 * the local Opus cache is checked first, so a repeat sync never sends the
 * original bytes over IPC again) and upload it (once — Rust HEADs the
 * gateway first). `audioHash` is the spine's `computeAudioHash(file)`; Rust
 * re-hashes the bytes and refuses a mismatch.
 */
export async function prepareCloudAudio(file: Blob, audioHash: string): Promise<CloudUpload & { encoded: boolean }> {
  const cachedBytes = await call<number | null>('cloud_opus_cached', { audioHash });
  let encoded = false;
  if (cachedBytes === null) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await call<string>('cloud_stage_audio_raw', bytes, { headers: { 'audio-hash': audioHash } });
    await call<number>('cloud_encode_opus', { audioHash });
    encoded = true;
  }
  const upload = await call<CloudUpload>('cloud_upload_audio', { audioHash });
  return { ...upload, encoded };
}

const CANCEL_RETRY_MS = 200;

/**
 * Submit one stage and resolve with its finished view (result included).
 * Aborting `signal` cancels the job on the gateway — a job still waiting for
 * a GPU is never charged — and rejects with `{ kind: 'cancelled' }`.
 */
export async function runCloudJob<R>(
  request: CloudJobRequest,
  options: { onEvent?: (event: CloudJobEvent) => void; signal?: AbortSignal } = {},
): Promise<CloudJobView<R>> {
  const { onEvent, signal } = options;
  if (signal?.aborted) throw { kind: 'cancelled' } satisfies CloudError;
  const runId = crypto.randomUUID();
  const channel = new Channel<CloudJobEvent>();
  if (onEvent) channel.onmessage = onEvent;
  let settled = false;
  // The abort can land before Rust has registered the run id; keep asking
  // until Rust confirms it tripped the flag or the run settles on its own.
  const onAbort = (): void => {
    const attempt = (): void => {
      if (settled) return;
      invoke<boolean>('cloud_cancel_run', { runId })
        .then(found => { if (!found && !settled) setTimeout(attempt, CANCEL_RETRY_MS); })
        .catch(() => { if (!settled) setTimeout(attempt, CANCEL_RETRY_MS); });
    };
    attempt();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await call<CloudJobView<R>>('cloud_run_job', { runId, job: request, onEvent: channel });
  } finally {
    settled = true;
    signal?.removeEventListener('abort', onAbort);
  }
}
