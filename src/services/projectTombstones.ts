/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauriFfmpeg';

/** Dashboard registry — stripped in the same confirm as the tombstone write. */
const REGISTRY_KEY = 'kinetix:projects:v1';
const TOMBSTONE_KEY = 'kinetix:deleted-projects:v1';

const deletedThisSession = new Set<string>();

export function deletedProjectIds(): Set<string> {
  const ids = new Set<string>(deletedThisSession);
  try {
    const raw = localStorage.getItem(TOMBSTONE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) for (const id of parsed) if (typeof id === 'string') ids.add(id);
  } catch { /* session set still applies */ }
  return ids;
}

function persistLocal(ids: Iterable<string>): void {
  for (const id of ids) deletedThisSession.add(id);
  try {
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify([...deletedProjectIds()]));
  } catch { /* quota: session set still applies */ }
}

function stripDashboardRegistry(dead: Set<string>): void {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { id?: string }[];
    if (!Array.isArray(parsed)) return;
    const kept = parsed.filter(m => typeof m?.id === 'string' && !dead.has(m.id));
    if (kept.length === 0) localStorage.removeItem(REGISTRY_KEY);
    else localStorage.setItem(REGISTRY_KEY, JSON.stringify(kept));
  } catch { /* leave registry; loadAllMetas still filters */ }
}

/** Test-only: drop the in-memory set so a crash/relaunch can be simulated. */
export function __resetTombstonesForTests(): void {
  deletedThisSession.clear();
}

/**
 * Confirm-time death record. Writes dead ids to localStorage and (in Tauri)
 * the crash-safe `deleted-projects.json` BEFORE the UI list updates. One
 * native call per delete set. Also strips the dashboard registry in the same
 * turn so a reload cannot re-read those ids as live.
 */
export async function commitTombstones(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  persistLocal(ids);
  stripDashboardRegistry(new Set(ids));
  if (!isTauri()) return;
  try {
    await invoke<string[]>('project_tombstones_add', { ids: [...ids] });
  } catch (err) {
    console.error('[kinetix] tombstone file write failed; local death record still holds:', err);
  }
}

/** Merge the native file into localStorage so a new origin/session sees deaths. */
export async function hydrateTombstonesFromNative(): Promise<void> {
  if (!isTauri()) return;
  try {
    const ids = await invoke<string[]>('project_tombstones_list');
    if (Array.isArray(ids) && ids.length > 0) persistLocal(ids);
  } catch (err) {
    console.warn('[kinetix] could not hydrate tombstones from disk:', err);
  }
}
