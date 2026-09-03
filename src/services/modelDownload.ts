/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// In-app whisper model acquisition (bug 4 fix, WS2 Step 3 A4) — thin wrapper
// around the Rust `model_download.rs` commands, mirroring the
// `invoke`/`Channel` pattern `whisperService.ts`'s `transcribeWithProgress`
// already uses for `whisper_transcribe`.
// ---------------------------------------------------------------------------

import { invoke, Channel } from '@tauri-apps/api/core';

export const WHISPER_MODEL_FILENAME = 'ggml-large-v3-turbo.bin';

export interface ModelDownloadStatus {
  present: boolean;
  partialBytes: number;
  totalBytes: number;
}

/** Mirrors `model_download.rs::ModelDownloadEvent`. `Retrying` is new in WS2
 *  T4.3: the engine now retries a transient stream failure up to
 *  `maxAttempts` times, resuming from `downloadedBytes` each time, and says so
 *  rather than letting the bar sit frozen through the backoff. */
export type ModelDownloadEvent =
  | { event: 'Progress'; data: { downloadedBytes: number; totalBytes: number } }
  | {
      event: 'Retrying';
      data: {
        attempt: number;
        maxAttempts: number;
        reason: string;
        downloadedBytes: number;
        totalBytes: number;
      };
    }
  | { event: 'Done'; data: null }
  | { event: 'Cancelled'; data: null }
  | { event: 'Error'; data: { message: string } };

export interface RetryNotice {
  attempt: number;
  maxAttempts: number;
  reason: string;
}

export async function getWhisperModelStatus(): Promise<ModelDownloadStatus> {
  return invoke<ModelDownloadStatus>('whisper_model_status');
}

export function cancelWhisperModelDownload(): void {
  invoke('whisper_model_download_cancel').catch(() => {});
}

/**
 * Starts (or resumes) the whisper model download. Resolves once the model is
 * fully verified and in place; rejects with an `Error` on any failure
 * (network, disk, cancellation, checksum mismatch).
 *
 * WS2 T4.3: transient stream failures are now retried inside the Rust engine
 * before this rejects, so a rejection means the engine gave up — `onRetry`
 * fires for each attempt in between. The rejection message now states which
 * of the three outcomes occurred (retries exhausted with the partial kept and
 * resumable / verification failed with the partial deleted / permanent), so
 * unlike before it is NOT safe to paraphrase as a generic "try again" — show
 * the message.
 */
export function downloadWhisperModel(
  onProgress: (downloadedBytes: number, totalBytes: number) => void,
  onRetry?: (notice: RetryNotice) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const channel = new Channel<ModelDownloadEvent>();
    channel.onmessage = (msg) => {
      if (msg.event === 'Progress') {
        onProgress(msg.data.downloadedBytes, msg.data.totalBytes);
      } else if (msg.event === 'Retrying') {
        onProgress(msg.data.downloadedBytes, msg.data.totalBytes);
        onRetry?.({
          attempt: msg.data.attempt,
          maxAttempts: msg.data.maxAttempts,
          reason: msg.data.reason,
        });
      } else if (msg.event === 'Done') {
        resolve();
      } else if (msg.event === 'Cancelled') {
        reject(new DOMException('Aborted', 'AbortError'));
      } else if (msg.event === 'Error') {
        reject(new Error(msg.data.message));
      }
    };

    invoke('whisper_model_download', { onEvent: channel }).catch((err: unknown) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

/** Whether a whisper.rs error message names the model as the missing file —
 * used to offer a "Download model" action instead of a plain error banner. */
export function isModelMissingError(message: string): boolean {
  return message.includes(WHISPER_MODEL_FILENAME) && message.includes('not found');
}
