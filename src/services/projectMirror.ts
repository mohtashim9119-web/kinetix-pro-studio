/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WS1 Session O — client for the durable project mirror (`project_mirror.rs`).
 *
 * THE PROBLEM IT SOLVES, measured on this machine during Session O's
 * forensics: project JSON lives in `localStorage`, which WebKit scopes by
 * ORIGIN. `tauri dev` (and `tauri dev -f fa-inference`, which is byte-identical
 * in config — only a Cargo feature differs) serves the frontend from
 * `http://localhost:3000`; a bundled build serves it from `tauri://localhost`.
 * Two origins, two disjoint stores. The forensic snapshot found 8 projects
 * under the dev origin and 4 entirely different ones under the release origin,
 * with no overlap and no way for either to see the other.
 *
 * `app_local_data_dir()` is keyed by BUNDLE IDENTIFIER instead, so it is the
 * same directory in every config — the same property `fa.rs` already relies on
 * for `fa-models/`. This module mirrors saves there and adopts on boot.
 *
 * CONTRACT: every function here is best-effort and never throws. The mirror is
 * a safety net, not the primary store — a mirror failure must never fail, block,
 * or delay a local save. Outside Tauri (plain `npm run dev`) every call is an
 * immediate no-op.
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauriFfmpeg';

/** Raw shape returned by `project_mirror_read_all`. */
export interface MirrorSnapshot {
  /** The `ProjectMeta[]` registry JSON text, or null if the mirror has none. */
  registry: string | null;
  /** `[project id, StoredProject JSON text]` for every mirrored project. */
  projects: [string, string][];
}

/**
 * Reads the whole mirror. Returns null outside Tauri, or when the mirror
 * cannot be read at all (a first run, where the directory does not exist yet,
 * returns an EMPTY snapshot rather than null).
 */
export async function readMirror(): Promise<MirrorSnapshot | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<MirrorSnapshot>('project_mirror_read_all');
  } catch (err) {
    console.warn('[projectMirror] read failed — continuing with local storage only:', err);
    return null;
  }
}

/**
 * Mirrors one project's stored JSON, and optionally the registry alongside it.
 * Fire-and-forget: callers do not await this, and it resolves rather than
 * rejects on failure.
 */
export async function writeMirroredProject(
  id: string,
  contents: string,
  registry?: string,
): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('project_mirror_write_project', { id, contents, registry: registry ?? null });
  } catch (err) {
    console.warn(`[projectMirror] write failed for ${id} (local save unaffected):`, err);
  }
}

/** Removes a project from the mirror. Its backups are retained by design. */
export async function deleteMirroredProject(id: string, registry?: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('project_mirror_delete_project', { id, registry: registry ?? null });
  } catch (err) {
    console.warn(`[projectMirror] delete failed for ${id}:`, err);
  }
}
