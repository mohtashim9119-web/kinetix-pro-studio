/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 3 U2 — where sync runs: this computer (`local`) or the cloud gateway
// (`cloud`). APP-LEVEL, not per project (operator D3): one standing choice
// for every project on this machine, with the per-project FA toggle
// applying under both.
//
// Read synchronously from localStorage and NEVER from the network — it feeds
// `resolveSyncEngine`, which also runs inside the spine's "already synced"
// comparison. Whether the gateway is reachable is a run-time question
// answered when a run starts, never part of the standing configuration.
//
// Default stays `local` until Wave 3 U10 (operator D3): the team opts in
// with one persisted choice. A per-run "use Local this once" (U4) never
// writes here.
// ---------------------------------------------------------------------------

export type SyncEngineHost = 'local' | 'cloud';

export const SYNC_ENGINE_HOST_KEY = 'kinetix.syncEngineHost';
export const DEFAULT_SYNC_ENGINE_HOST: SyncEngineHost = 'local';

const listeners = new Set<(host: SyncEngineHost) => void>();

export function readSyncEngineHost(): SyncEngineHost {
  try {
    const raw = globalThis.localStorage?.getItem(SYNC_ENGINE_HOST_KEY);
    return raw === 'cloud' || raw === 'local' ? raw : DEFAULT_SYNC_ENGINE_HOST;
  } catch {
    return DEFAULT_SYNC_ENGINE_HOST;
  }
}

export function writeSyncEngineHost(host: SyncEngineHost): void {
  try {
    globalThis.localStorage?.setItem(SYNC_ENGINE_HOST_KEY, host);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
  for (const listener of listeners) listener(host);
}

/** Subscribe to changes made through `writeSyncEngineHost` in this window. */
export function onSyncEngineHostChange(listener: (host: SyncEngineHost) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
