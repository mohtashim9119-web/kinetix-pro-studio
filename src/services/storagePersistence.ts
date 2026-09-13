/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WS3 item D — requests durability via `navigator.storage.persist()` at
 * startup and records what actually came back.
 *
 * WHY THIS MATTERS LESS NOW THAN IT WOULD HAVE BEFORE ITEM B. `persist()`
 * asks the browser to exempt this origin's storage from quota-pressure
 * eviction — historically the main defense IndexedDB assets had against the
 * exact class of loss this whole incident is about. After item B, asset
 * bytes are natively authoritative and IndexedDB is a cache: a refusal here
 * now costs a cache re-hydration (`repairAssetsFromNative.ts` heals it on
 * next open), not work. Still worth requesting and recording — persistence
 * also protects `localStorage` (the registry, last-opened-id) and reduces
 * how often the launch-time repair path has anything to do at all.
 *
 * NOBODY HAS MEASURED WHAT WEBVIEW2 ACTUALLY RETURNS. Edge/WebView2 is
 * closed source, and the commonly reported Chromium behavior for a profile
 * with no site engagement is to return `false` outright — but that is
 * folklore, not a measurement taken against this app. This module makes the
 * real answer a durable, log-file fact (via `log_storage_persistence`, the
 * SAME native diagnostic log item I's `ffmpeg_log_disk_preflight` writes to)
 * instead of something someone has to remember to check in DevTools.
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauriFfmpeg';

export interface StoragePersistenceResult {
  /** `false` when `navigator.storage?.persist` itself does not exist in this WebView. */
  supported: boolean;
  /** The browser's own answer. Always `false` when `supported` is `false`. */
  persisted: boolean;
  requestedAt: number;
  /** Set only if the API existed but the call itself threw. */
  error?: string;
}

let lastResult: StoragePersistenceResult | null = null;

/** The most recent result this session, for diagnostics surfacing. `null` before the first request completes. */
export function getStoragePersistenceResult(): StoragePersistenceResult | null {
  return lastResult;
}

/** Test-only reset. */
export function __resetStoragePersistenceForTests(): void {
  lastResult = null;
}

async function logToNative(result: StoragePersistenceResult): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('log_storage_persistence', { supported: result.supported, persisted: result.persisted });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[storagePersistence] native logging failed (non-fatal):', err);
  }
}

/**
 * Requests persistent storage and records the result. Never throws — a
 * refusal, a missing API, or the call itself throwing are all reported
 * (console + the native log), never surfaced as an unhandled rejection to
 * the caller. Safe to call from a fire-and-forget boot effect.
 */
export async function requestStoragePersistence(): Promise<StoragePersistenceResult> {
  const requestedAt = Date.now();
  const persistFn = typeof navigator !== 'undefined' ? navigator.storage?.persist : undefined;

  let result: StoragePersistenceResult;
  if (typeof persistFn !== 'function') {
    result = { supported: false, persisted: false, requestedAt };
    console.info('[storagePersistence] navigator.storage.persist() is not available in this WebView.');
  } else {
    try {
      const persisted = await persistFn.call(navigator.storage);
      result = { supported: true, persisted, requestedAt };
      console.info(`[storagePersistence] navigator.storage.persist() -> ${persisted}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { supported: true, persisted: false, requestedAt, error: message };
      console.warn('[storagePersistence] navigator.storage.persist() threw:', message);
    }
  }

  lastResult = result;
  await logToNative(result);
  return result;
}
