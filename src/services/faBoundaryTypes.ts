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
import type { TranscriptToken } from '../types';

/** Mirrors `fa.rs`'s `FaChunkInput` (`#[serde(rename_all = "camelCase")]`,
 *  WS1 Task 5 Slice D11). Replaces the pre-D11 `FaSegmentInput` (a single
 *  segment id/text pair implicitly aligned against the whole audio file) —
 *  `fa_align` now takes an ordered list of audio-time-windowed chunks, one
 *  forward pass per chunk, built by `src/services/faChunkPlan.ts`'s
 *  `computeFaChunkPlan`. */
export interface FaChunkInput {
  startSec: number;
  endSec: number;
  text: string;
}

/** Mirrors `fa.rs`'s `FaWordSpan` (`#[serde(rename_all = "camelCase")]`,
 *  WS1 Task 5 Slice D9) — one word-level forced-alignment result. `confidence`
 *  is already `exp(score)` on the Rust side (the IPC boundary's own unit
 *  conversion from a log-probability to a probability) — a probability in
 *  [0,1], directly comparable to `syncConstants.ts`'s `CONF_MIN`; nothing on
 *  the TS side needs to convert it further.
 *
 *  `wordIndex` (WS1 Task 5 Slice D18): the word's 0-based position in the
 *  full, chunk-stitched FA output — the join key back to the script's own
 *  word sequence. Always present (Rust always sets it, unlike `confidence`'s
 *  own optionality on `TranscriptToken`) — see `fa.rs`'s `FaWordSpan` doc
 *  comment for why time is not a safe substitute join key. */
export interface FaWordSpan {
  word: string;
  startSec: number;
  endSec: number;
  confidence: number;
  wordIndex: number;
}

/** Mirrors `fa.rs`'s `FaEvent` (`#[serde(tag = "event", content = "data")]`).
 *  Tag values stay PascalCase, matching `WhisperEvent`'s own convention
 *  (`whisperService.ts`'s `WhisperEvent` type) — only the payload fields are
 *  camelCase. */
export type FaEvent =
  | { event: 'Progress'; data: { index: number; total: number } }
  | { event: 'Done'; data: { words: FaWordSpan[] } }
  | { event: 'Error'; data: { message: string } };

/** Mirrors `fa.rs`'s `FaErrorKind` (`#[serde(rename_all = "camelCase")]`).
 *  Kept in sync by hand (no codegen for this boundary, see module doc
 *  comment) — `fa.rs`'s `every_fa_error_kind_variant_serializes_to_its_
 *  expected_camelcase_string` test asserts the Rust-side serialized strings
 *  so a future Rust variant fails loudly there, but that guard is
 *  one-directional: it cannot catch a TS-side rename or addition drifting
 *  away from Rust, only the reverse. */
export type FaErrorKind =
  | 'notImplemented'
  | 'modelNotFound'
  | 'stateLockPoisoned'
  | 'inferenceFailed'
  /** Only ever constructed by `fa_dev.rs`'s pre-use manifest check (WS1
   *  Task 5 Slice D10) — never returned by the production `fa_align`
   *  command. */
  | 'modelHashMismatch'
  /** `fa_cancel` flipped `FaState` to `Cancelled` while a chunked run was
   *  mid-loop (WS1 Task 5 Slice D11) — `fa_align` stops before the next
   *  chunk and rejects with this, never resolving with a partial word
   *  list. */
  | 'cancelled';

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
  chunks: FaChunkInput[];
  language: FaLanguageCode;
  onEvent: Channel<FaEvent>;
}

/** `fa_cancel` (`fa.rs`'s `fa_cancel`) takes no arguments beyond Tauri's own
 *  managed `FaState` — mirrors `whisper_cancel`'s empty argument shape. */
export type FaCancelArgs = Record<string, never>;

/**
 * Reshapes a `FaEvent`'s `Done` payload (`FaWordSpan[]`) into
 * `TranscriptToken[]` — exactly the shape `whisperService.ts`'s
 * `extractSegmentAlignments` already consumes (`startSec`/`endSec`/`text`,
 * now also carrying the optional `confidence` D9 added to `TranscriptToken`,
 * and `wordIndex`, D18's script-word join key). A straight 1:1 map: unlike a
 * Whisper token, an `FaWordSpan` is already exactly one word
 * (`fa_onnx.rs`'s `merge_char_spans_to_words`), so there is no
 * multi-word-per-token expansion to do here (contrast
 * `extractSegmentAlignments`'s own `tokenWords` expansion of Whisper's
 * possibly-multi-word tokens).
 *
 * NOT WIRED INTO ANYTHING — no `invoke()`, no hook, no component, no
 * capability gate (WS1 Task 5 Slice D9 scope: carrying confidence is this
 * slice, comparing it against `CONF_MIN` is the next). Tests are the only
 * caller today, same "established but unwired" pattern this module's other
 * declarations already use.
 */
export function faWordSpansToTranscriptTokens(words: FaWordSpan[]): TranscriptToken[] {
  return words.map((w) => ({
    startSec: w.startSec,
    endSec: w.endSec,
    text: w.word,
    confidence: w.confidence,
    wordIndex: w.wordIndex,
  }));
}
