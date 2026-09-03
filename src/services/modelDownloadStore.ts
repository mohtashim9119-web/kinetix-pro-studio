/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Model-download state that OUTLIVES the component (WS2 T4.4, Defect B).
 *
 * WHY THIS IS NOT COMPONENT STATE. A download is a background transfer owned
 * by the Rust side; the modal is one of several windows onto it, not its
 * owner. Before this module, `ModelsSection` held the transfer's whole
 * observable state in `useState`, so closing the dialog destroyed it: the
 * transfer kept running (nothing cancelled it), but a reopened dialog
 * re-derived the row from disk and offered "Resume" for a pack that was
 * already downloading. Clicking that started a SECOND writer on the same
 * `.part` — which is Defect A's root cause, so the two defects are one
 * mechanism seen from two ends.
 *
 * `ModelsSection` is also mounted in three independent places (App Settings
 * inline, the Manage Models modal, the Project Settings FA detector). A
 * module-level store is what makes those three views of one transfer rather
 * than three transfers.
 *
 * THIS IS A MIRROR, NOT THE SOURCE OF TRUTH. The transfer lives in Rust and
 * the authoritative "is one running" answer is Rust's own single-flight
 * registry (`model_download.rs::try_acquire_in_flight`). This store exists so
 * the UI can SHOW a running transfer; it is deliberately not the only thing
 * stopping a second one, because a UI-only guard cannot survive a reload and
 * cannot see a download this window did not start.
 *
 * Per owner ruling A2/Q2: state is keyed by model id and globally readable,
 * so a download started from any surface is visible from every other one.
 * Per owner ruling A1/Q1: nothing here survives an app restart — a quit
 * cancels in-flight transfers and leaves the `.part` on disk for a later
 * Resume.
 */

import type { RetryNotice } from './modelDownload';

/** A row with no record is idle. */
export interface DownloadRecord {
  phase: 'downloading' | 'error';
  downloadedBytes: number;
  totalBytes: number;
  /** Set while the Rust engine is between attempts of its bounded retry. */
  retry?: RetryNotice;
  /** Set only on `phase: 'error'`. */
  message?: string;
}

/** What `startDownload` needs from a caller: the transport, already bound to
 *  its model. Passing it in keeps this module free of `invoke`/`Channel` and
 *  therefore directly testable without a Tauri bridge. */
export type DownloadRunner = (
  onProgress: (downloadedBytes: number, totalBytes: number) => void,
  onRetry: (notice: RetryNotice) => void,
) => Promise<void>;

const records = new Map<string, DownloadRecord>();
const listeners = new Set<() => void>();
const settledListeners = new Set<(modelId: string) => void>();
let version = 0;

function emit(): void {
  version += 1;
  listeners.forEach((l) => l());
}

function set(modelId: string, record: DownloadRecord | undefined): void {
  if (record === undefined) records.delete(modelId);
  else records.set(modelId, record);
  emit();
}

export function subscribeDownloads(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot for `useSyncExternalStore` — a number, so it is referentially
 *  stable by construction and cannot cause the infinite-render loop a fresh
 *  object snapshot would. */
export function getDownloadsVersion(): number {
  return version;
}

export function getDownloadRecord(modelId: string): DownloadRecord | undefined {
  return records.get(modelId);
}

/** True while a transfer this app started is running for `modelId`. The row
 *  must offer neither Download nor Resume in that state — both would ask Rust
 *  to open a second writer on the same `.part`. */
export function isDownloadInFlight(modelId: string): boolean {
  return records.get(modelId)?.phase === 'downloading';
}

/** Fires once per transfer as it settles (completed, cancelled, or failed),
 *  so a mounted section can re-read the installed-models report even when it
 *  was unmounted for the whole transfer and mounted again at the end. */
export function subscribeDownloadSettled(listener: (modelId: string) => void): () => void {
  settledListeners.add(listener);
  return () => {
    settledListeners.delete(listener);
  };
}

function settle(modelId: string): void {
  settledListeners.forEach((l) => l(modelId));
}

/** Drops a stuck error row so the pack can be offered again. */
export function clearDownloadRecord(modelId: string): void {
  if (records.has(modelId)) set(modelId, undefined);
}

/**
 * Starts a transfer and owns its state until it settles.
 *
 * Returns `false` — and starts nothing — if one is already in flight for this
 * model. That is the UI half of single-flight; the Rust half
 * (`try_acquire_in_flight`) is the one that actually holds, and this one only
 * spares the user an error banner for a mistake it can see coming.
 */
export function startDownload(
  modelId: string,
  run: DownloadRunner,
  initialBytes = 0,
): boolean {
  if (isDownloadInFlight(modelId)) return false;

  set(modelId, { phase: 'downloading', downloadedBytes: initialBytes, totalBytes: 0 });

  run(
    (downloadedBytes, totalBytes) => {
      // A Progress event means bytes moved, so any "reconnecting" notice is
      // stale by definition and is dropped here rather than timed out.
      if (records.get(modelId)?.phase !== 'downloading') return;
      set(modelId, { phase: 'downloading', downloadedBytes, totalBytes });
    },
    (retry) => {
      const current = records.get(modelId);
      if (current?.phase !== 'downloading') return;
      set(modelId, { ...current, retry });
    },
  )
    .then(() => {
      set(modelId, undefined);
      settle(modelId);
    })
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') {
        set(modelId, undefined);
        settle(modelId);
        return;
      }
      // The error is kept in the store rather than in the component, so it is
      // still on screen if the failure happened while the dialog was closed —
      // the "Wi-Fi dropped and the row told me nothing" case.
      set(modelId, {
        phase: 'error',
        downloadedBytes: 0,
        totalBytes: 0,
        message: err instanceof Error ? err.message : String(err),
      });
      settle(modelId);
    });

  return true;
}

/** Test-only: drop everything. Never called from app code — a real reset is
 *  an app restart, which discards this module with the page. */
export function __resetDownloadStoreForTests(): void {
  records.clear();
  settledListeners.clear();
  emit();
}
