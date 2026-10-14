/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Shows an exported file in Finder / Explorer (selected in its folder).
// No-op outside Tauri (`npm run dev` has no IPC bridge).

import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { isTauri } from './tauriFfmpeg';

export async function revealExportedFile(path: string): Promise<void> {
  if (!isTauri()) return;
  await revealItemInDir(path);
}
