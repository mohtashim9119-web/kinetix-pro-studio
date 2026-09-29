/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Forced-alignment PRE-FLIGHT readiness check — TS side (WS1 Session M, Step 4).
//
// Combines the two halves of "can FA actually run for this project right now":
//   - the FRONTEND facts — runtime capability (`isFaCapable`) and language
//     RESOLUTION (`resolveFaLanguage` + the supported-set check), decided here
//     because the project object and those helpers live on this side; and
//   - the BACKEND facts — runtime library load and model presence — via the
//     `fa_preflight` Tauri command (`src-tauri/src/fa_preflight.rs`).
//
// It answers, before an Apply Sync commits to inference, the question the
// FA-fallback entry used to answer only AFTER the run: is high-precision sync
// going to work, and if not, exactly what is missing. `App.tsx` folds the result
// into one durable `fa-preflight` sync-log entry the user sees up front.
//
// NEVER THROWS. Like `runForcedAlignmentForSync`, every failure — a rejected
// IPC call, a missing runtime, an unresolved language — becomes a structured
// "not ready" result, not an exception. A pre-flight that crashed the sync it
// was meant to de-risk would be worse than no pre-flight.
// ---------------------------------------------------------------------------

import { invoke } from '@tauri-apps/api/core';
import { isFaCapable, isFaEnabledForProject, isFaGateOpenForProject, resolveFaLanguage } from './faGate';
import { readSyncEngineHost, type SyncEngineHost } from './syncEngineHost';
import { describeInvokeError } from './invokeError';
import { FA_SUPPORTED_LANGUAGES } from './forcedAlignmentRun';
import type { FaLanguageCode } from './faTextNormalize';
import type { Project } from '../types';

/** Mirrors `fa_preflight.rs`'s `FaPreflightReport` (serde camelCase). */
export interface FaPreflightReport {
  featureCompiled: boolean;
  runtimeOk: boolean;
  runtimeDetail: string;
  modelPresent: boolean;
  modelDetail: string;
  language: string;
}

/** The combined readiness verdict App.tsx logs and (optionally) acts on. */
export interface FaPreflightResult {
  /** True only when every gate is satisfied: capable, a supported language
   *  resolved, the model is present, and the runtime library loaded. When this
   *  is true, a subsequent `runForcedAlignmentForSync` should not fall back for
   *  a readiness reason. */
  ready: boolean;
  /** The language the gate resolved to (sticky choice, else `-l auto`
   *  detection), or undefined when the project has neither. */
  resolvedLanguage: string | undefined;
  /** Individual signals, each independently loggable. `undefined` where the
   *  check did not run (e.g. backend checks are skipped when not capable). */
  capable: boolean;
  languageSupported: boolean;
  featureCompiled?: boolean;
  runtimeOk?: boolean;
  runtimeDetail?: string;
  modelPresent?: boolean;
  modelDetail?: string;
  /** One-line human summary for the log message. */
  summary: string;
  /** The first BLOCKING cause's verbatim detail (runtime/model text or the
   *  language problem), or undefined when ready. */
  blockingDetail?: string;
  /** The action for the user when not ready, or undefined when ready. */
  fixHint?: string;
}

/**
 * Runs the FA readiness pre-flight for `project`. Assumes the caller only
 * invokes it when the FA gate is OPEN (capability + the per-project switch) —
 * it still re-checks capability defensively so a direct caller cannot get a
 * misleading "ready" out of a non-Tauri runtime.
 */
export async function runFaPreflight(
  project: Pick<Project, 'language' | 'detectedLanguage'> | null | undefined,
): Promise<FaPreflightResult> {
  const capable = isFaCapable();
  const resolvedLanguage = resolveFaLanguage(project);
  const languageSupported =
    resolvedLanguage !== undefined &&
    FA_SUPPORTED_LANGUAGES.includes(resolvedLanguage as FaLanguageCode);

  if (!capable) {
    return {
      ready: false,
      resolvedLanguage,
      capable,
      languageSupported,
      summary: 'FA pre-flight: not available — the desktop runtime (Tauri) is not present.',
      blockingDetail: 'forced alignment requires the desktop app; it cannot run in a plain browser.',
      fixHint: 'Run the desktop app (npm run tauri:dev / the built app) for high-precision sync.',
    };
  }

  if (!languageSupported) {
    const langText = resolvedLanguage === undefined ? 'none detected or set' : `"${resolvedLanguage}"`;
    return {
      ready: false,
      resolvedLanguage,
      capable,
      languageSupported,
      summary: `FA pre-flight: not ready — no forced-alignment model for the project language (${langText}).`,
      blockingDetail:
        resolvedLanguage === undefined
          ? 'no language is set and none was detected — transcribe the voiceover first, or set the language in Project Settings.'
          : `${langText} is outside the five FA-supported languages (${FA_SUPPORTED_LANGUAGES.join(', ')}).`,
      fixHint:
        'Set the project language to English, Spanish, French, Portuguese, or German in Project Settings, or leave high-precision sync off for this project.',
    };
  }

  // Language resolves and is supported — ask the backend about the model + the
  // native runtime.
  let report: FaPreflightReport;
  try {
    report = await invoke<FaPreflightReport>('fa_preflight', { language: resolvedLanguage });
  } catch (err) {
    const detail = describeInvokeError(err);
    return {
      ready: false,
      resolvedLanguage,
      capable,
      languageSupported,
      summary: 'FA pre-flight: could not be checked — the readiness probe was rejected.',
      blockingDetail: detail,
      fixHint: 'Re-run Build Timeline. If it keeps happening, restart the app.',
    };
  }

  const ready = report.featureCompiled && report.runtimeOk && report.modelPresent;
  if (ready) {
    return {
      ready: true,
      resolvedLanguage,
      capable,
      languageSupported,
      featureCompiled: report.featureCompiled,
      runtimeOk: report.runtimeOk,
      runtimeDetail: report.runtimeDetail,
      modelPresent: report.modelPresent,
      modelDetail: report.modelDetail,
      summary: `FA pre-flight: ready — runtime loaded and model present for "${resolvedLanguage}".`,
    };
  }

  // Not ready: name the FIRST blocking cause, in the order the real run would
  // hit it (feature → runtime → model).
  let blockingDetail: string;
  let fixHint: string;
  if (!report.featureCompiled) {
    blockingDetail = report.runtimeDetail;
    // G6 Step 0a — canonical honest copy for "not compiled", duplicated
    // (not imported) in syncLog.ts / SyncPausedDialog.tsx: those modules
    // deliberately stay dependency-light and must not pull this module's
    // `@tauri-apps/api` import into their runtime graph. Keep the wording
    // identical in all four spots (search "isn't compiled into this build").
    fixHint = "High-precision sync isn't compiled into this build — launch with tauri:dev:fa.";
  } else if (!report.runtimeOk) {
    blockingDetail = report.runtimeDetail;
    fixHint = 'The onnxruntime library could not load — re-provision it per src-tauri/onnxruntime/README.md.';
  } else {
    blockingDetail = report.modelDetail;
    fixHint = `Install the forced-alignment model for "${resolvedLanguage}" (see the searched paths above), then run Build Timeline again.`;
  }

  return {
    ready: false,
    resolvedLanguage,
    capable,
    languageSupported,
    featureCompiled: report.featureCompiled,
    runtimeOk: report.runtimeOk,
    runtimeDetail: report.runtimeDetail,
    modelPresent: report.modelPresent,
    modelDetail: report.modelDetail,
    summary: `FA pre-flight: not ready — ${!report.runtimeOk ? 'the alignment runtime did not load' : 'the alignment model is missing'} for "${resolvedLanguage}".`,
    blockingDetail,
    fixHint,
  };
}

// ---------------------------------------------------------------------------
// WS2 T4.1 Step 3 — the raw, per-language probe, for UI that needs the backend
// facts WITHOUT the project-shaped verdict `runFaPreflight` computes.
//
// WHY PROJECT SETTINGS' PACK DETECTOR CANNOT USE `isFaCapable()` ALONE.
// `faGate.ts`'s `isFaCapable()` is `isTauri()` and nothing more — it answers
// "is the IPC bridge present", which is necessary and nowhere near sufficient.
// `fa-inference` is NOT in `Cargo.toml`'s default feature set, so in a plain
// `tauri:dev`/`tauri:build` binary the bridge is present, `isFaCapable()`
// returns true, and `fa_align` returns `NotImplemented` for every run
// (`src-tauri/src/fa.rs`'s `#[cfg(not(feature = "fa-inference"))]` arm). A
// detector built on `isFaCapable()` would therefore report an installed pack
// as USABLE in the exact binary that ships today, which is a worse lie than
// reporting nothing.
//
// NO NEW PROBE WAS NEEDED, and no `not_implemented` round-trip either.
// `fa_preflight` already returns `featureCompiled` straight from a
// `#[cfg(feature = "fa-inference")]`, so it reports the BUILD FACT directly
// rather than inferring it from a failed alignment. It is cheap by
// construction (a path stat plus a dlopen + ort env init; it explicitly does
// NOT hash the ~1.2 GiB model) because it was designed to run before every FA
// sync. This is that same command, called with an explicit language instead of
// one resolved from a project.
// ---------------------------------------------------------------------------

/**
 * Runs the backend readiness probe for one language. Returns `null` — never
 * throws — when the runtime is not Tauri-capable at all or the IPC call is
 * rejected; callers render "unknown", which is honestly distinct from both
 * "ready" and "the pack is missing".
 */
export async function probeFaReadiness(language: string): Promise<FaPreflightReport | null> {
  if (!isFaCapable()) return null;
  try {
    return await invoke<FaPreflightReport>('fa_preflight', { language });
  } catch {
    return null;
  }
}

/**
 * G2 close-out FIX 1 — the "engine state" half of the honest-Apply-Sync
 * spine (`services/spine.ts`'s `SyncSpine.engineKey`). Two runs with
 * identical audio+script content can still owe a re-sync when the arm a
 * fresh run would actually take has changed since the last commit — the
 * toggle was flipped, or the FA pack finished downloading after a run that
 * had to fall back. `'whisper'` when the gate is closed (nothing else about
 * readiness matters in that case); `'fa:ready'` / `'fa:not-ready'` when open,
 * from the SAME pre-flight check Apply Sync itself runs before committing to
 * FA inference — never a second, independently-derived readiness answer.
 *
 * Deliberately NOT parameterized by a one-off `forceWhisperReason`
 * (`SyncPausedDialog`'s per-run "use Whisper timing" override) — that is an
 * explicit choice for THIS run only, not a change to the project's standing
 * configuration, and must not itself gate whether a LATER Apply Sync looks
 * "already synced".
 *
 * Kept as a plain `Promise<string>` (not a typed union) for spine
 * compatibility. As of G3 Unit 1 this is a thin wrapper over
 * `resolveSyncEngine` below — the actual toggle+pack+model decision now
 * lives in exactly one place, shared with Apply Sync gating and the
 * Settings Sync tab's "current engine" readout.
 */
export async function computeSyncEngineKey(
  project: Pick<Project, 'faHighPrecisionSync' | 'language' | 'detectedLanguage'> | null | undefined,
  host: SyncEngineHost = readSyncEngineHost(),
): Promise<string> {
  const resolution = await resolveSyncEngine(project, host);
  return resolution.key;
}

// ---------------------------------------------------------------------------
// G3 Unit 1 — the single engine resolver.
//
// Before this, "which engine will Apply Sync actually use" was answered by
// two independent call sites that both happened to agree: `App.tsx`'s
// Apply-Sync branch computed `isFaGateOpenForProject(...)` and then
// separately ran `runFaPreflight(...)`, while `computeSyncEngineKey` above
// (the spine's "already synced" comparison) chained the exact same two
// calls a second time. Nothing enforced that they stay in sync — they just
// always had, by construction, because both sites called the same two
// functions in the same order. This makes that chain a single function so
// there is exactly one place "toggle position + pack readiness + model
// status -> engine" is decided. Every consumer (Apply Sync gating,
// provenance stamps via the branch Apply Sync actually takes, and the
// Settings Sync tab's "current engine" readout) reads off it.
//
// Still NOT a user-facing engine picker — resolving "which engine WOULD
// run" is not the same as offering a choice. The Whisper/FA toggle
// (`Project.faHighPrecisionSync`, `faGate.ts`) remains the only standing
// choice a user makes; `forceWhisperReason` (`SyncPausedDialog`'s "use
// Whisper timing" answer) remains an explicit one-off override layered on
// top of THIS run only, at the call site — deliberately NOT folded in here,
// for the same reason `computeSyncEngineKey`'s doc comment above gives: a
// one-off override must not itself change what a LATER Apply Sync looks
// like it will do.
// ---------------------------------------------------------------------------

/** Wave 3 U2 — `'cloud'`: the sync gateway runs transcription and (when the
 *  per-project FA toggle is on) forced alignment. */
export type SyncEngine = 'whisper' | 'fa' | 'cloud';

/** The resolver's full verdict — toggle position + pack/model readiness,
 *  nothing else. Consumers that need only the eventual engine name or only
 *  the spine's string key can read `.engine` / `.key`; consumers that need
 *  to explain WHY (Settings, Sync Log) can read `.preflight`. */
export interface SyncEngineResolution {
  /** The engine a fresh Apply Sync would actually commit with, standing
   *  configuration only (no one-off override folded in). */
  engine: SyncEngine;
  /** Whether the per-project switch is on AND the app is FA-capable — the
   *  same two conditions `isFaGateOpenForProject` checks. */
  gateOpen: boolean;
  /** Whisper is always ready (it ships in every build). For `engine: 'fa'`,
   *  whether the pack/runtime/model checks actually passed — an open gate
   *  can still resolve to `ready: false` (a not-ready FA run falls back to
   *  Whisper tokens, see `App.tsx`'s `faCompleted` derivation), while the
   *  resolver keeps reporting `engine: 'fa'` — the DECISION was FA, the
   *  OUTCOME degrades. Callers that want "what will actually commit" should
   *  treat `ready: false` as Whisper-shaped. */
  ready: boolean;
  /** Full pre-flight detail when the gate was open (undefined when closed —
   *  there was nothing to check). */
  preflight: FaPreflightResult | undefined;
  /** The exact string `computeSyncEngineKey` has always returned, preserved
   *  byte-for-byte for spine compatibility: `'whisper'` | `'fa:ready'` |
   *  `'fa:not-ready'` — plus, Wave 3 U2, `'cloud:fa'` | `'cloud:whisper'`.
   *  Every cloud key differs from every local one, so switching host is a
   *  spine mismatch ("not synced"), never a silent hit. */
  key: string;
  /** Wave 3 U2 — where this run would execute. */
  host: SyncEngineHost;
}

/**
 * The one function that decides "which engine, and is it ready" from
 * standing project configuration. Never throws — `runFaPreflight` already
 * guarantees that, and the gate check is pure and total.
 */
export async function resolveSyncEngine(
  project: Pick<Project, 'faHighPrecisionSync' | 'language' | 'detectedLanguage'> | null | undefined,
  host: SyncEngineHost = readSyncEngineHost(),
): Promise<SyncEngineResolution> {
  if (host === 'cloud') {
    // Wave 3 U2 — CONFIG-ONLY by construction: no preflight, no ping, no
    // IPC. The FA toggle applies under Cloud exactly as under Local (operator
    // D3 — Session H's default-off ruling governs cloud FA too); only the
    // local-capability half of the gate is irrelevant, since the gateway,
    // not this build, runs the alignment. Reachability is a run-time outcome
    // (a pause), not standing configuration, so it never enters the key.
    const gateOpen = isFaEnabledForProject(project);
    return {
      engine: 'cloud',
      gateOpen,
      ready: true,
      preflight: undefined,
      key: gateOpen ? 'cloud:fa' : 'cloud:whisper',
      host,
    };
  }
  const gateOpen = isFaGateOpenForProject(project);
  if (!gateOpen) {
    return { engine: 'whisper', gateOpen, ready: true, preflight: undefined, key: 'whisper', host };
  }
  const preflight = await runFaPreflight(project);
  return {
    engine: 'fa',
    gateOpen,
    ready: preflight.ready,
    preflight,
    key: `fa:${preflight.ready ? 'ready' : 'not-ready'}`,
    host,
  };
}
