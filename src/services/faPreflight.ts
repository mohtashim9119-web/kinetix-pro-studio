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
import { isFaCapable, resolveFaLanguage } from './faGate';
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
      fixHint: 'Re-run Apply Sync. If it keeps happening, restart the app.',
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
    fixHint = 'This build was compiled without forced alignment. Use a tauri:dev:fa / fa-inference build.';
  } else if (!report.runtimeOk) {
    blockingDetail = report.runtimeDetail;
    fixHint = 'The onnxruntime library could not load — re-provision it per src-tauri/onnxruntime/README.md.';
  } else {
    blockingDetail = report.modelDetail;
    fixHint = `Install the forced-alignment model for "${resolvedLanguage}" (see the searched paths above), then run Apply Sync again.`;
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
