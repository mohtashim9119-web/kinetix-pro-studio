/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauriFfmpeg';

/**
 * Whether a regular file already exists at `path` (native `file_exists`).
 * Outside the desktop app — or if the check itself fails — it answers `false`
 * (the pre-existing behaviour), never "true", so a failing check cannot make
 * every candidate name look taken.
 */
export async function fileExists(path: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>('file_exists', { path });
  } catch (err) {
    console.warn('[bulk-export] file_exists failed for', path, err);
    return false;
  }
}
