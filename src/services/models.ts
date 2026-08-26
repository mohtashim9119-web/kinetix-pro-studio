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

import { invoke } from '@tauri-apps/api/core';
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
