/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// plan-v3 Wave 1 item 8 — timing-set provenance.
//
// A committed timing set (Whisper tokens or FA word timings) carries the
// engine that ACTUALLY produced it. Legacy projects loaded from a v4 (or
// older) envelope get `'unknown'` — never a guess from `faHighPrecisionSync`,
// `anchorSource`, or which token array happens to be present.
//
// Cloud engine names are Wave 3. This module only stamps `whisper` | `fa` |
// `unknown`.
// ---------------------------------------------------------------------------

import type {
  Project,
  TimingDegradedKind,
  TimingEngine,
  TimingProvenance,
} from '../types';

/** Provenance-record schema — independent of `projectStore`'s envelope. */
export const TIMING_PROVENANCE_SCHEMA_VERSION = 1;

/** Whisper model id as shipped (`whisper.rs` `MODEL_FILENAME` minus `.bin`). */
export const WHISPER_MODEL_ID = 'ggml-large-v3-turbo';

/**
 * Digest pin for the shipped Whisper weights. Part AL of
 * `sync-pipeline-v2-plan.md` records SIZE only (1,624,555,275). The digest
 * lives in shipped code at `src-tauri/src/model_download.rs` `MODEL_SHA256`
 * (measured 2026-08-26, cross-checked against Hugging Face `lfs.oid`).
 * Copied here so a TS stamp does not invent a second pin.
 */
export const WHISPER_MODEL_VERSION =
  '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69';

/** FA ONNX packs — model id shape from M3.4 (`fa-<lang>`). */
export function faModelId(language: string | undefined): string {
  const code = (language ?? '').trim().toLowerCase();
  return code.length > 0 ? `fa-${code}` : 'fa-unknown';
}

/**
 * HF revision pins from `scripts/fixtures/fa-onnx-manifest.json` (frozen
 * fixture, not Part AL). Used as `modelVersion` for a clean FA stamp.
 */
const FA_MODEL_REVISIONS: Record<string, string> = {
  de: '4b8a02957378d0f2da2ef74091156b032c485a89',
  en: '569a6236e92bd5f7652a0420bfe9bb94c5664080',
  es: '96d7e9b4e4a78af515a3c6d3cee7c0826045d276',
  fr: '7c79e105a6525d38e1e69f640b974b4a679723cc',
  pt: '634ac655299bcdc46c83bc01da9bab52d2987e4f',
};

export function faModelVersion(language: string | undefined): string {
  const code = (language ?? '').trim().toLowerCase();
  return FA_MODEL_REVISIONS[code] ?? 'unknown';
}

const UNKNOWN = 'unknown';

/** The only honest stamp for a timing set written before provenance existed. */
export function unknownTimingProvenance(completedAt = 0): TimingProvenance {
  return {
    engine: UNKNOWN,
    model: UNKNOWN,
    modelVersion: UNKNOWN,
    schemaVersion: TIMING_PROVENANCE_SCHEMA_VERSION,
    completedAt,
  };
}

export function describeTimingEngine(engine: TimingEngine | undefined): string {
  if (engine === UNKNOWN || engine === undefined) {
    return 'Engine not recorded (synced before engine tracking)';
  }
  return engine;
}

export function stampWhisperProvenance(args: {
  language?: string;
  completedAt: number;
  degraded?: TimingProvenance['degraded'];
}): TimingProvenance {
  return {
    engine: 'whisper',
    model: WHISPER_MODEL_ID,
    modelVersion: WHISPER_MODEL_VERSION,
    schemaVersion: TIMING_PROVENANCE_SCHEMA_VERSION,
    language: args.language,
    completedAt: args.completedAt,
    ...(args.degraded ? { degraded: args.degraded } : {}),
  };
}

export function stampFaProvenance(args: {
  language?: string;
  completedAt: number;
  degraded?: TimingProvenance['degraded'];
}): TimingProvenance {
  return {
    engine: 'fa',
    model: faModelId(args.language),
    modelVersion: faModelVersion(args.language),
    schemaVersion: TIMING_PROVENANCE_SCHEMA_VERSION,
    language: args.language,
    completedAt: args.completedAt,
    ...(args.degraded ? { degraded: args.degraded } : {}),
  };
}

/**
 * v4→v5 load-path migration. Labels existing timing arrays `'unknown'`.
 * Never inspects `faHighPrecisionSync` / `anchorSource` / token shape to
 * guess an engine. Leaves an already-stamped record untouched.
 */
export function migrateLegacyTimingProvenance(project: Project): Project {
  const existing = project.timingProvenance;
  const transcription = existing?.transcription
    ?? (hasTokens(project.transcriptTokens) ? unknownTimingProvenance() : undefined);
  const alignment = existing?.alignment
    ?? (hasTokens(project.faWordTimings) ? unknownTimingProvenance() : undefined);
  if (!transcription && !alignment) {
    if (existing === undefined) return project;
    return { ...project, timingProvenance: existing };
  }
  return {
    ...project,
    timingProvenance: { transcription, alignment },
  };
}

function hasTokens(tokens: Project['transcriptTokens']): boolean {
  return (tokens?.length ?? 0) > 0;
}

export function whisperDegradedKind(
  reason: 'gate-closed' | 'user-chose-whisper' | 'ctc-infeasible-chunk' | 'silence-detect-failed',
): TimingDegradedKind {
  if (reason === 'ctc-infeasible-chunk') return 'fa-chunk-infeasible';
  if (reason === 'silence-detect-failed') return 'silence-detect-failed';
  return reason;
}
