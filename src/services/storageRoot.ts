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

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauriFfmpeg';

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

/** `sweepClassification` is `'never-reclaimable' | 'reclaimable'` — see `size_report`'s own doc comment (storage_root.rs) for which subtree gets which. */
export interface SizeReportRow {
  path: string;
  label: string;
  currentBytes: number;
  reclaimableBytes: number;
  sweepClassification: 'never-reclaimable' | 'reclaimable';
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
export async function relocateStorageRoot(newRoot: string): Promise<StorageRootRelocateReport> {
  assertTauri('relocateStorageRoot');
  return invoke<StorageRootRelocateReport>('storage_root_relocate', { newRoot });
}

export async function getSizeReport(): Promise<SizeReportRow[]> {
  assertTauri('getSizeReport');
  return invoke<SizeReportRow[]>('size_report');
}
