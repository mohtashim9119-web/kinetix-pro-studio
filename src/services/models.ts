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

type FaModelDownloadEvent =
  | { event: 'Progress'; data: { downloadedBytes: number; totalBytes: number } }
  | { event: 'Done'; data: null }
  | { event: 'Cancelled'; data: null }
  | { event: 'Error'; data: { message: string } };

/** Starts (or resumes) the FA pack download for `languageCode`. Resolves once
 *  `fa_dev::verify_model_manifest` has confirmed the downloaded file against
 *  the committed manifest and the atomic rename has landed; rejects on any
 *  failure (network, disk, cancellation, manifest mismatch) — the manifest
 *  check already deleted a corrupt `.part` before rejecting, so a retry is
 *  always the correct next action. */
export function downloadFaModel(
  languageCode: string,
  onProgress: (downloadedBytes: number, totalBytes: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const channel = new Channel<FaModelDownloadEvent>();
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

    invoke('fa_model_download', { language: languageCode, onEvent: channel }).catch((err: unknown) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

export function cancelFaModelDownload(languageCode: string): void {
  invoke('fa_model_download_cancel', { language: languageCode }).catch(() => {});
}
