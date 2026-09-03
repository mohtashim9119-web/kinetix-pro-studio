/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Manage Models & Add-ons (WS2 Step 12, A3) — thin wrapper around the Rust
// `models.rs` commands (check_installed_models, import_local_model,
// delete_installed_model, get_available_disk_space). Whisper's DOWNLOAD path
// stays `modelDownload.ts` (bug 4, unchanged) — this file only adds the
// import/check/delete/disk-space surface `models.rs` is new for, plus
// `SUPPORTED_FA_LANGUAGES`/model-id helpers shared by `ManageModelsModal.tsx`.
// ---------------------------------------------------------------------------

import { invoke, Channel } from '@tauri-apps/api/core';
import { SUPPORTED_LANGUAGE_CODES } from '../constants';
import type { ModelDownloadEvent, ModelDownloadStatus, RetryNotice } from './modelDownload';

/** Mirrors `models.rs::FA_LANGUAGES` — every code `models.rs` will accept as
 *  a `"fa-<lang>"` model id. Filtered from the app's own supported-language
 *  list rather than hardcoded a second time. */
export const FA_MODEL_LANGUAGES: readonly string[] = SUPPORTED_LANGUAGE_CODES.filter((c) =>
  ['en', 'es', 'fr', 'de', 'pt'].includes(c),
);

export interface InstalledModelStatus {
  installed: boolean;
  bytes: number;
}

export interface InstalledModelsReport {
  whisper: InstalledModelStatus | null;
  fa: Record<string, InstalledModelStatus>;
}

export function checkInstalledModels(): Promise<InstalledModelsReport> {
  return invoke<InstalledModelsReport>('check_installed_models');
}

/** modelId is `"whisper"` or `"fa-<lang>"` — see `models.rs::ModelId::parse`. */
export function importLocalModel(modelId: string): Promise<{ cancelled: boolean }> {
  return invoke<{ cancelled: boolean }>('import_local_model', { modelId });
}

export function deleteInstalledModel(modelId: string): Promise<void> {
  return invoke<void>('delete_installed_model', { modelId });
}

/** Bytes free on the volume containing `app_local_data_dir`. */
export function getAvailableDiskSpace(): Promise<number> {
  return invoke<number>('get_available_disk_space');
}

export function faModelId(languageCode: string): string {
  return `fa-${languageCode}`;
}

// ---------------------------------------------------------------------------
// FA download (WS2 Step 13 Phase 3) — `models.rs::fa_model_download`, which
// calls the SAME resumable engine `model_download.rs::stream_download_verified`
// the whisper downloader uses. Event shape is `model_download.rs`'s existing
// `ModelDownloadEvent` (Progress/Done/Cancelled/Error) — reused verbatim, not
// duplicated, so this type mirrors `modelDownload.ts`'s own `ModelDownloadEvent`
// exactly rather than declaring a second one.
// ---------------------------------------------------------------------------

/** `models.rs::fa_model_download` emits `model_download.rs`'s own
 *  `ModelDownloadEvent`, so this path imports that type rather than declaring
 *  a second copy that could drift from it (the previous local duplicate did
 *  not carry `Retrying`). */
type FaModelDownloadEvent = ModelDownloadEvent;

/** `models.rs::fa_model_status` — the FA sibling of `whisper_model_status`.
 *  Reports resumable `.part` bytes so the row can offer "Resume 1.02 GiB"
 *  instead of a bare "Download" that silently resumes. `partialBytes` is
 *  already filtered to what the engine would actually accept as a resume
 *  point, so it never needs a second opinion here. */
export function faModelStatus(languageCode: string): Promise<ModelDownloadStatus> {
  return invoke<ModelDownloadStatus>('fa_model_status', { language: languageCode });
}

/** Starts (or resumes) the FA pack download for `languageCode`. Resolves once
 *  `fa_dev::verify_model_manifest` has confirmed the downloaded file against
 *  the committed manifest and the atomic rename has landed; rejects on any
 *  failure (network, disk, cancellation, manifest mismatch).
 *
 *  WS2 T4.3: transient stream failures are retried inside the engine (up to
 *  three attempts, resuming from the partial each time) before this rejects,
 *  with `onRetry` firing in between. The rejection message distinguishes
 *  retries-exhausted (partial kept, resumable) from verification-failed
 *  (partial deleted) from permanent, so show it rather than paraphrasing. */
export function downloadFaModel(
  languageCode: string,
  onProgress: (downloadedBytes: number, totalBytes: number) => void,
  onRetry?: (notice: RetryNotice) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const channel = new Channel<FaModelDownloadEvent>();
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

    invoke('fa_model_download', { language: languageCode, onEvent: channel }).catch((err: unknown) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

export function cancelFaModelDownload(languageCode: string): void {
  invoke('fa_model_download_cancel', { language: languageCode }).catch(() => {});
}
