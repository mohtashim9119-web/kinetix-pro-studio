/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 1 hotfix, FIX 2 — Whisper weight gate: a MISSING model must be a typed
// run-level failure on every path that actually needs the model, and the
// path that does NOT need it must be shown not to.
//
// Operator smoke: renamed ggml-large-v3-turbo.bin; a "Whisper transcript"
// sync still reported success. Two mechanisms, both proven here:
//
//   FRESH-AUDIO PATH (needs the model). `whisper_transcribe` (whisper.rs)
//   resolves the file through `model_path`, whose not-found `Err` was an
//   UNTYPED string ("<file> not found. Use the model download panel…") that
//   `classifyWhisperFailure` could only read as 'inference-failed'. The
//   run did halt — but as a generic error, not as the model-not-found /
//   model-hash-mismatch family the gate is supposed to produce. Also:
//   `model_path` falls through FIVE locations (storage root → app-local →
//   bundle resources → <exe>/models → dev checkout `src-tauri/models/`), so
//   on a dev build a rename in the storage root is silently masked by the
//   dev-checkout copy. Reported, not changed here (operator decision).
//
//   CACHED-TRANSCRIPT PATH (does not need the model). Apply Sync with
//   `cachedTokensReady` runs `alignSegmentsFromCachedTranscript`, which is
//   pure over the cached tokens + Web Audio silence scan and never invokes
//   `whisper_transcribe`. By design (CLAUDE.md §5: transcription cache keyed
//   by file identity). Proven structurally below; NOT turned into a halt.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  classifyWhisperFailure,
  WHISPER_MODEL_HASH_MISMATCH_PREFIX,
} from './whisperService';

const WHISPER_RS = readFileSync(resolve(import.meta.dirname, '../../src-tauri/src/whisper.rs'), 'utf-8');
const USE_WHISPER_TS = readFileSync(resolve(import.meta.dirname, '../hooks/useWhisper.ts'), 'utf-8');
const WHISPER_SERVICE_TS = readFileSync(resolve(import.meta.dirname, './whisperService.ts'), 'utf-8');

/** The body of a top-level `fn`/`function` by its opening line marker. */
function bodyOf(src: string, marker: string, endMarker: string): string {
  const start = src.indexOf(marker);
  expect(start, `marker not found: ${marker}`).toBeGreaterThan(-1);
  const end = src.indexOf(endMarker, start + marker.length);
  expect(end, `end marker not found after ${marker}: ${endMarker}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('FIX 2 — fresh-audio path: a missing model is a TYPED model-not-found failure', () => {
  it('classifyWhisperFailure maps the native model-not-found prefix to its own kind, never to inference-failed', () => {
    expect(classifyWhisperFailure(
      new Error('whisper:model-not-found:ggml-large-v3-turbo.bin not found. Use the model download panel in Settings'),
    )).toBe('model-not-found');
    // The hash gate's own kind is unchanged.
    expect(classifyWhisperFailure(new Error(`${WHISPER_MODEL_HASH_MISMATCH_PREFIX}model at x is 5 bytes`)))
      .toBe('model-hash-mismatch');
    expect(classifyWhisperFailure(new Error('sidecar crashed'))).toBe('inference-failed');
  });

  it("whisper.rs's model_path returns the typed not-found prefix — the one place a rename is first noticed", () => {
    const modelPath = bodyOf(WHISPER_RS, 'fn model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {', '\n// ----');
    expect(WHISPER_RS).toContain('pub(crate) const WHISPER_MODEL_NOT_FOUND_PREFIX: &str = "whisper:model-not-found:";');
    expect(modelPath).toContain('WHISPER_MODEL_NOT_FOUND_PREFIX');
    // Never auto-switch: the only filename model_path ever resolves is the pinned one.
    expect(modelPath.match(/MODEL_FILENAME/g)!.length).toBeGreaterThan(0);
    expect(modelPath).not.toMatch(/ggml-[a-z0-9.-]+\.bin/);
  });

  it('whisper_transcribe still cannot proceed past a missing or mismatched model to a spawn', () => {
    const cmd = bodyOf(WHISPER_RS, 'let model = model_path(&app)?;', 'whisper-cli');
    expect(cmd).toContain('verify_whisper_weights(&model)');
    expect(cmd).toContain('return Err(e)');
  });

  it('useWhisper surfaces model-not-found as its own sentence, not the raw dev-checkout curl hint', () => {
    expect(USE_WHISPER_TS).toContain("kind === 'model-not-found'");
  });
});

describe('FIX 2 — cached-transcript path: Apply Sync with cached tokens never needs the model (by design)', () => {
  it('alignSegmentsFromCachedTranscript makes no native call at all — no invoke, no whisper_transcribe', () => {
    const body = bodyOf(USE_WHISPER_TS, 'export async function alignSegmentsFromCachedTranscript(', '\nexport ');
    expect(body).not.toContain('invoke');
    expect(body).not.toContain('whisper_transcribe');
    expect(body).not.toContain('transcribeWithProgress');
  });

  it('the ONLY caller of whisper_transcribe is the fresh-audio transcribeWithProgress path', () => {
    const calls = WHISPER_SERVICE_TS.match(/invoke\(\s*'whisper_transcribe'/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(WHISPER_SERVICE_TS.indexOf("invoke('whisper_transcribe'"))
      .toBeGreaterThan(WHISPER_SERVICE_TS.indexOf('export async function transcribeWithProgress('));
    expect(USE_WHISPER_TS).not.toContain("invoke('whisper_transcribe'");
  });
});
