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

// ---------------------------------------------------------------------------
// Wave 3 U4 — "use this computer for this run" (the G3 offline contract's
// per-run answer to a cloud pause). Scoped to ONE project and ONE voiceover
// content hash, so it follows that run from staging transcription through
// Apply Sync (U2's engine honesty would otherwise re-transcribe on the cloud
// the moment Apply Sync read the standing host) and cannot leak onto any
// other audio or project. NEVER written through `writeSyncEngineHost`.
//
// U4 hotfix — PERSISTED per project (localStorage, like `faSyncPauseStore`),
// not held in a React ref: the operator's click check reloaded after choosing
// local and the in-memory choice was gone, so the next staging run went back
// to the cloud. A recorded choice now survives a reload until the Apply Sync
// it was made for commits (`clearRunHostOverride`).
// ---------------------------------------------------------------------------

export interface RunHostOverride {
  projectId: string;
  audioHash: string;
  host: 'local';
  /** What the cloud run paused on, for the Sync Log line. */
  reason: string;
}

const RUN_HOST_OVERRIDE_PREFIX = 'kinetix:run-host-override:v1:';

export function saveRunHostOverride(override: RunHostOverride): void {
  try {
    globalThis.localStorage?.setItem(RUN_HOST_OVERRIDE_PREFIX + override.projectId, JSON.stringify(override));
  } catch {
    // Storage unavailable: the choice lasts for this page load only.
  }
}

/** This project's recorded one-run choice, or null (none / unreadable). */
export function readRunHostOverride(projectId: string): RunHostOverride | null {
  try {
    const raw = globalThis.localStorage?.getItem(RUN_HOST_OVERRIDE_PREFIX + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RunHostOverride>;
    if (
      parsed.projectId !== projectId || parsed.host !== 'local'
      || typeof parsed.audioHash !== 'string' || typeof parsed.reason !== 'string'
    ) {
      return null;
    }
    return parsed as RunHostOverride;
  } catch {
    return null;
  }
}

export function clearRunHostOverride(projectId: string): void {
  try {
    globalThis.localStorage?.removeItem(RUN_HOST_OVERRIDE_PREFIX + projectId);
  } catch {
    // nothing to clear
  }
}

/**
 * U4 hotfix — whether a stage event for `incoming` should (re)start staging.
 * A plain re-drop of the file already pending is a no-op (its run is in
 * flight or done). An EXPLICIT re-run — a pause dialog's "try the cloud
 * again" / "transcribe on this computer" — must restart it: routing those
 * answers through the plain path is exactly how both buttons became no-ops.
 */
export function shouldStartStaging(args: {
  pendingIdentity: string | undefined;
  incomingIdentity: string;
  rerun: boolean;
}): boolean {
  return args.rerun || args.pendingIdentity !== args.incomingIdentity;
}

/** The host a run for this project + audio should use. */
export function hostForRun(
  standing: SyncEngineHost,
  override: RunHostOverride | null,
  target: { projectId: string; audioHash: string | undefined },
): SyncEngineHost {
  if (
    override !== null
    && target.audioHash !== undefined
    && override.projectId === target.projectId
    && override.audioHash === target.audioHash
  ) {
    return override.host;
  }
  return standing;
}

/** Subscribe to changes made through `writeSyncEngineHost` in this window. */
export function onSyncEngineHostChange(listener: (host: SyncEngineHost) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
