/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WS3 items C+H — client for the configurable storage root
 * (`storage_root.rs`) and the size report (Step 7) built on it.
 *
 * Three named exports, one each for Cursor's three waiting consumers (WS3
 * item G's naming discipline applied here too — one module, no fourth
 * copy):
 *
 *   - The storage-relocation view's byte props -> `getStorageRootStatus`.
 *   - The size report / reclaim UI              -> `getSizeReport`.
 *   - The relocation action itself               -> `relocateStorageRoot`.
 *
 * Outside Tauri, every function throws — there is no native storage root to
 * ask (same posture `nativeAssetStore.ts`'s read functions have; callers on
 * a UI surface that only exists in the desktop app can rely on `isTauri()`
 * already being true by the time these are reachable).
 */

import { invoke, Channel } from '@tauri-apps/api/core';
import { isTauri } from './tauriFfmpeg';

/** D18 fix (WS3 Round 29) — mirrors `RelocationEvent` (storage_root.rs). `Verifying` (D-verify-feedback fix) fires once per subtree, right before its post-copy digest check starts. */
export type RelocationEvent =
  | { event: 'Progress'; data: { bytesDone: number; bytesTotal: number } }
  | { event: 'Verifying' }
  | { event: 'Done' };

export interface StorageRootStatus {
  currentRoot: string;
  defaultRoot: string;
  isDefault: boolean;
  /** Best-effort recursive size of the managed subtrees (assets/projects/cache/backups). `null` on a walk error. */
  managedBytes: number | null;
}

export interface StorageRootRelocateReport {
  from: string;
  to: string;
  /** Subtrees actually moved (only ones that existed at `from`). */
  moved: string[];
  bytesMoved: number;
  /** Old-copy cleanup failures after the verified new root became authoritative. */
  cleanupWarnings: string[];
}

/**
 * `sweepClassification` — see `size_report`'s own doc comment (storage_root.rs)
 * for which subtree gets which. `'stale-root'` (D-stale-root fix, WS3 Round 29)
 * is deliberately distinct from `'reclaimable'`: the generic "Free up cached
 * data" button (`storage_root_reclaim`) does NOT clean it up — only the
 * dedicated `cleanupAllStaleRoots` does — so it must never be folded into a
 * `totalReclaimable` sum that button's visibility is gated on.
 */
export interface SizeReportRow {
  path: string;
  label: string;
  currentBytes: number;
  reclaimableBytes: number;
  sweepClassification: 'never-reclaimable' | 'reclaimable' | 'stale-root';
}

function assertTauri(fn: string): void {
  if (!isTauri()) throw new Error(`${fn}: no native storage root outside Tauri`);
}

export async function getStorageRootStatus(): Promise<StorageRootStatus> {
  assertTauri('getStorageRootStatus');
  return invoke<StorageRootStatus>('storage_root_status');
}

/**
 * Relocates the storage root to `newRoot`. Throws on any refusal (not
 * writable, not enough free space, a relocation-verification mismatch) —
 * the caller must surface the message, never retry silently: a partial
 * relocation is never assumed safe to repeat blind.
 */
export async function relocateStorageRoot(
  newRoot: string,
  onEvent?: (event: RelocationEvent) => void,
): Promise<StorageRootRelocateReport> {
  assertTauri('relocateStorageRoot');
  const channel = new Channel<RelocationEvent>();
  if (onEvent) channel.onmessage = onEvent;
  return invoke<StorageRootRelocateReport>('storage_root_relocate', { newRoot, onEvent: channel });
}

/**
 * D15 fix (WS3 Round 29) — signals the in-flight `relocateStorageRoot` call
 * to abort at its next per-file/subtree check. Cooperative: the pending
 * `relocateStorageRoot` promise still rejects (with the sentinel message
 * `RELOCATION_CANCELLED_MESSAGE`) rather than resolving early — this only
 * sets the flag it polls.
 */
export const RELOCATION_CANCELLED_MESSAGE = 'relocation cancelled by operator';

export async function cancelStorageRootRelocation(): Promise<void> {
  assertTauri('cancelStorageRootRelocation');
  return invoke('storage_root_relocate_cancel');
}

export async function getSizeReport(): Promise<SizeReportRow[]> {
  assertTauri('getSizeReport');
  return invoke<SizeReportRow[]>('size_report');
}

/**
 * Resume/no-auto-delete fix (WS3 Round 29, operator decision) — relocation
 * no longer auto-deletes ANY leftover copy (a completed move's old
 * location, or a failed/cancelled move's abandoned target). These
 * accumulate across as many hops as the operator makes without cleaning up
 * in between — moving A -> B -> C leaves BOTH A and B listed. This is the
 * single action that cleans up EVERY one of them at once, on the
 * operator's own schedule ("one cleanup deletes everything" — an explicit
 * operator decision against a per-location button). Returns bytes actually
 * reclaimed.
 */
export async function cleanupAllStaleRoots(): Promise<number> {
  assertTauri('cleanupAllStaleRoots');
  return invoke<number>('storage_root_cleanup_all_stale_roots');
}
