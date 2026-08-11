/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Type-only mirror of the Rust FA command surface (`src-tauri/src/fa.rs`,
// WS1 Task 5 boundary skeleton). No inference exists yet — `fa_align` always
// returns a typed not-implemented error. These declarations exist so the IPC
// boundary is visible from TS ahead of any real caller.
//
// NOT WIRED INTO ANYTHING: no `invoke()` call, no service wrapper, not
// imported by any component or hook. Kept in lockstep with `fa.rs`'s serde
// shapes by hand — there is no codegen for this boundary.
// ---------------------------------------------------------------------------

import type { Channel } from '@tauri-apps/api/core';
import type { FaLanguageCode } from './faTextNormalize';

/** Mirrors `fa.rs`'s `FaSegmentInput` (`#[serde(rename_all = "camelCase")]`). */
export interface FaSegmentInput {
  segmentId: string;
  text: string;
}

/** Mirrors `fa.rs`'s `FaEvent` (`#[serde(tag = "event", content = "data")]`).
 *  Tag values stay PascalCase, matching `WhisperEvent`'s own convention
 *  (`whisperService.ts`'s `WhisperEvent` type) — only the payload fields are
 *  camelCase. */
export type FaEvent =
  | { event: 'Progress'; data: { percent: number } }
  | { event: 'Done'; data: Record<string, never> }
  | { event: 'Error'; data: { message: string } };

/** Mirrors `fa.rs`'s `FaErrorKind` (`#[serde(rename_all = "camelCase")]`). */
export type FaErrorKind = 'notImplemented' | 'modelNotFound' | 'stateLockPoisoned';

/** Mirrors `fa.rs`'s `FaError` — the typed error `fa_align`/`fa_cancel`
 *  reject their promise with today, always `kind: 'notImplemented'` for
 *  `fa_align` since no inference engine exists yet. */
export interface FaError {
  kind: FaErrorKind;
  message: string;
}

/** Argument shape for the `fa_align` Tauri command (`fa.rs`'s `fa_align`).
 *  `audioPath` is a filesystem path (e.g. the same 16 kHz mono WAV
 *  `whisper.rs`'s `transcode_to_wav` already produces), not re-uploaded
 *  audio bytes — unlike `whisper_transcribe`'s `audio_b64`. */
export interface FaAlignArgs {
  audioPath: string;
  segments: FaSegmentInput[];
  language: FaLanguageCode;
  onEvent: Channel<FaEvent>;
}

/** `fa_cancel` (`fa.rs`'s `fa_cancel`) takes no arguments beyond Tauri's own
 *  managed `FaState` — mirrors `whisper_cancel`'s empty argument shape. */
export type FaCancelArgs = Record<string, never>;
