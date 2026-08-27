/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WS2 T1.3 — client for the primary OS-backed project store (`project_mirror.rs`'s
 * `project_store_*` commands, `app_local_data_dir()/projects/<id>/project.json`).
 *
 * Unlike `projectMirror.ts`'s mirror client (best-effort, never throws — the
 * mirror is a safety net), these calls are the PRIMARY write/read path once
 * `isTauri()` is true, so failures here must propagate: `projectStore.ts`'s
 * `saveProject`/`loadProjectDetailed` need the real error to build a
 * `SaveOutcome`/`LoadOutcome`, not a swallowed console warning. Only call these
 * behind an `isTauri()` check — outside Tauri there is no IPC bridge and
 * `invoke()` throws immediately.
 */

import { invoke } from '@tauri-apps/api/core';

/** `Ok(None)` on the Rust side (no such project) comes back as `null`. */
export function osStoreRead(id: string): Promise<string | null> {
  return invoke<string | null>('project_store_read', { id });
}

export function osStoreWrite(id: string, contents: string): Promise<void> {
  return invoke('project_store_write', { id, contents });
}

export function osStoreDelete(id: string): Promise<void> {
  return invoke('project_store_delete', { id });
}

/** Every project id currently present in the primary store. */
export function osStoreListIds(): Promise<string[]> {
  return invoke<string[]>('project_store_list_ids');
}
