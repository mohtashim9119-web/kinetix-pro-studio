/**
 * plan-v3 Wave 1 item 10 — Whisper weight-integrity gate (frontend classify
 * + the native call site must remain a typed run-level failure).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  classifyWhisperFailure,
  WHISPER_MODEL_HASH_MISMATCH_PREFIX,
} from './whisperService';

describe('classifyWhisperFailure — whisper-side model-hash-mismatch', () => {
  it('maps the native prefix to model-hash-mismatch, never to a generic swallow', () => {
    expect(classifyWhisperFailure(
      new Error(`${WHISPER_MODEL_HASH_MISMATCH_PREFIX}model at x is 5 bytes`),
    )).toBe('model-hash-mismatch');
    expect(classifyWhisperFailure('whisper:already-running:proj')).toBe('already-running');
    expect(classifyWhisperFailure(new Error('sidecar crashed'))).toBe('inference-failed');
  });
});

describe('whisper.rs production call site', () => {
  it('whisper_transcribe verifies weights and returns the typed prefix on mismatch', () => {
    const src = readFileSync(
      resolve(import.meta.dirname, '../../src-tauri/src/whisper.rs'),
      'utf-8',
    );
    expect(src).toContain('verify_whisper_weights(&model)');
    expect(src).toContain('WHISPER_MODEL_HASH_MISMATCH_PREFIX');
    expect(src).toContain('hash-once-per-path');
    // Never auto-switch: no second model_path / fallback filename after a mismatch.
    const after = src.slice(src.indexOf('if let Err(e) = verify_whisper_weights(&model)'));
    const untilSpawn = after.slice(0, after.indexOf('whisper-cli'));
    expect(untilSpawn).not.toMatch(/MODEL_FILENAME\s*=/);
    expect(untilSpawn).toContain('return Err(e)');
  });
});
