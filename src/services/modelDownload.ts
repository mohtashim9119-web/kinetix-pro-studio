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

type ModelDownloadEvent =
  | { event: 'Progress'; data: { downloadedBytes: number; totalBytes: number } }
  | { event: 'Done'; data: null }
  | { event: 'Cancelled'; data: null }
  | { event: 'Error'; data: { message: string } };

export async function getWhisperModelStatus(): Promise<ModelDownloadStatus> {
  return invoke<ModelDownloadStatus>('whisper_model_status');
}

export function cancelWhisperModelDownload(): void {
  invoke('whisper_model_download_cancel').catch(() => {});
}

/**
 * Starts (or resumes) the whisper model download. Resolves once the model is
 * fully verified and in place; rejects with an `Error` on any failure
 * (network, disk, cancellation, checksum mismatch) — the caller decides
 * whether/how to offer a retry. A checksum mismatch's message is
 * intentionally undifferentiated from other failures here: `model_download.rs`
 * already deleted the corrupt `.part` file, so a retry is always the correct
 * next action regardless of which failure fired.
 */
export function downloadWhisperModel(
  onProgress: (downloadedBytes: number, totalBytes: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const channel = new Channel<ModelDownloadEvent>();
    channel.onmessage = (msg) => {
      if (msg.event === 'Progress') {
        onProgress(msg.data.downloadedBytes, msg.data.totalBytes);
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
