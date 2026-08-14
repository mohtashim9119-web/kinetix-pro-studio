/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Forced-alignment production capability gate (WS1 Task 5 Slice D17, owner
 * ruling D2). Follows `useExport.ts:36-96`'s WebCodecs-export precedent
 * exactly: a memoized runtime capability probe AND a persisted user toggle,
 * combined into one accessor — either being false is byte-identical to
 * today (no FA call anywhere in the Apply-Sync path).
 *
 * NOTHING RUNS BEHIND THIS GATE YET. No `fa_align` invocation, no IPC, no
 * audio handling is wired to `isFaGateOpen()` this slice — it exists so a
 * later slice has a real off-by-default switch to check, per the
 * capability-gate ruling recorded in `docs/work-in-progress.md` §4's
 * capability-gate row ("Capability gate — dev-only is a phase, not the
 * endpoint" section of `task5-slice-ledger.md`, the original source,
 * was deleted 2026-08-14, `9cf5867`; retrieve: `git show
 * 251be64:docs/ws1-sync-pipeline/task5-slice-ledger.md`).
 *
 * Capability probe: unlike WebCodecs export (a set of browser APIs), FA
 * runs through a Tauri backend command (`fa_align`) — the same reason
 * `npm run dev` alone can never run Whisper or ffmpeg (CLAUDE.md §2). The
 * probe reuses `tauriFfmpeg.ts`'s own `isTauri()` check rather than
 * reimplementing it, since "is the Tauri IPC bridge present" is exactly and
 * only what FA additionally requires beyond a plain browser runtime.
 */

import { isTauri } from './tauriFfmpeg';
import { readUiState, patchUiState } from './uiStateStore';

const FA_GATE_TOGGLE_KEY = 'faHighPrecisionSyncEnabled';

let cachedFaCapability: boolean | null = null;

/**
 * Capability probe: true only when the Tauri IPC bridge is present, i.e.
 * `fa_align`/`fa_align_dev` are reachable at all. Memoized — matches
 * `isWebCodecsExportCapable()`'s own memoization rationale (runtime
 * capability can't change mid-session).
 */
export function isFaCapable(): boolean {
  if (cachedFaCapability !== null) return cachedFaCapability;
  cachedFaCapability = isTauri();
  return cachedFaCapability;
}

/** Test-only: clears the memoized capability result. */
export function __resetFaCapabilityForTests(): void {
  cachedFaCapability = null;
}

/**
 * Persisted user toggle — DEFAULTS OFF (owner ruling D2), unlike WebCodecs
 * export's default-on. An explicit prior choice (stored true or false) is
 * always respected. Persisted via the existing `uiStateStore` — no new
 * storage mechanism.
 */
export function isFaToggleOn(): boolean {
  try {
    const stored = readUiState()[FA_GATE_TOGGLE_KEY];
    return typeof stored === 'boolean' ? stored : false;
  } catch { return false; }
}

export function setFaToggle(enabled: boolean): void {
  patchUiState({ [FA_GATE_TOGGLE_KEY]: enabled });
}

/** The gate itself — capability AND user toggle both required. */
export function isFaGateOpen(): boolean {
  return isFaCapable() && isFaToggleOn();
}
