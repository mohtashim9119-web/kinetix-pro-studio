/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Task 5, docs/archive/history/work-in-progress.md §11 item 1 — the production
// forced-alignment caller's own contract: `runForcedAlignmentForSync` must
// resolve (never throw) on every failure a real gate-on-without-a-model
// session will hit — unsupported language, an empty chunk plan, a Tauri command
// rejection (the `ModelNotFound`/`InferenceFailed`/`ModelHashMismatch` shapes
// `fa.rs`/`fa_production.rs` actually return with no model present), and an
// `FaEvent::Error` sent over the channel instead of a rejected promise. This is
// the path most likely to be wrong and least likely to be noticed (per that
// session's brief) — every branch below is exercised explicitly, not just the
// happy path.
//
// PLAN-V3 WAVE 1 ITEM 3 (D24) REMOVED THE `'fallback'` ARM. Every failure
// this module used to resolve as `{status:'fallback', reason}` (a SILENT
// Whisper substitution the caller could not tell apart from success without
// reading the log) now resolves `{status:'paused', reason, resumable:true}`
// instead — the run holds, nothing commits, and the caller must ask the
// user (`SyncPausedDialog`). "Never throws" is unchanged; what changed is
// that there is no more branch a caller can silently treat as ok. Item 5
// added `signal`-driven cancellation on top of the same never-throws
// contract: an aborted run resolves `{status:'cancelled'}`, never as a
// failure.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// A minimal stand-in for @tauri-apps/api/core's real Channel — just enough
// surface (an assignable `onmessage`) for `runForcedAlignmentForSync` to use.
// Defined INSIDE the factory (not referenced from an outer const) because
// `vi.mock` factories are hoisted above the rest of the module, including
// any top-level variable this one would otherwise close over.
class FakeChannel<T> {
  onmessage: (message: T) => void = () => {};
}

vi.mock('@tauri-apps/api/core', () => {
  class FakeChannelInner<T> {
    onmessage: (message: T) => void = () => {};
  }
  return {
    Channel: FakeChannelInner,
    invoke: vi.fn(),
  };
});
vi.mock('./silenceDetector', () => ({
  detectSilences: vi.fn(async () => ({ status: 'ok', silences: [] })),
}));
vi.mock('./faChunkPlan', () => ({
  computeFaChunkPlan: vi.fn(() => [{ startSec: 0, endSec: 1, text: 'hello world' }]),
  // WS1 Session J — the success result now also carries R.5's excised
  // unscripted runs, read from the same module. Mocked here so this suite stays
  // a unit test of the CALLER; `faChunkPlan`'s own behaviour is covered by
  // `faChunkPlan.test.ts` and by the FA replay gate against real corpora.
  computeUnscriptedRuns: vi.fn(() => []),
}));

import { invoke } from '@tauri-apps/api/core';
import { computeFaChunkPlan, computeUnscriptedRuns } from './faChunkPlan';
import { runForcedAlignmentForSync } from './forcedAlignmentRun';
import type { Asset, TranscriptToken, VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

const mockInvoke = invoke as unknown as Mock;
const mockComputeFaChunkPlan = computeFaChunkPlan as unknown as Mock;
const mockComputeUnscriptedRuns = computeUnscriptedRuns as unknown as Mock;

// `runForcedAlignmentForSync` now makes TWO invoke calls in sequence:
// 'fa_stage_audio_raw' (stages the raw audio bytes, returns a path string)
// then 'fa_align_production' (the actual alignment, driven by `onEvent`).
// This wires the staging call to always succeed with a fixed fake path and
// delegates only the alignment call to `alignImpl` — so every test below can
// keep asserting against the alignment call's behavior exactly as before the
// staging call existed.
const FAKE_STAGED_INPUT_PATH = '/fake-staging-dir/kinetix-fa-production-inputs/deadbeef.wav';
function mockStageThenAlign(
  alignImpl: (args: { onEvent: FakeChannel<unknown> }) => void | Promise<void>,
): void {
  mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
    if (cmd === 'fa_stage_audio_raw') {
      return FAKE_STAGED_INPUT_PATH;
    }
    return alignImpl(args as { onEvent: FakeChannel<unknown> });
  });
}

function makeAsset(): Asset {
  return {
    id: 'vo1',
    name: 'voiceover.wav',
    url: 'blob:voiceover',
    type: 'audio',
    file: new File([new Uint8Array([1, 2, 3, 4])], 'voiceover.wav', { type: 'audio/wav' }),
  };
}

function makeSegments(): VideoSegment[] {
  return [{
    id: 's1',
    text: 'hello world',
    startTime: 0,
    duration: 1,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: 0,
  }];
}

const whisperTokens: TranscriptToken[] = [
  { text: 'hello', startSec: 0, endSec: 0.4 },
  { text: 'world', startSec: 0.4, endSec: 1 },
];

beforeEach(() => {
  mockInvoke.mockReset();
  mockComputeFaChunkPlan.mockReset();
  mockComputeFaChunkPlan.mockReturnValue([{ startSec: 0, endSec: 1, text: 'hello world' }]);
  mockComputeUnscriptedRuns.mockReset();
  mockComputeUnscriptedRuns.mockReturnValue([]);
});

describe('runForcedAlignmentForSync — pauses (never falls back), and names why', () => {
  it('pauses on an unsupported language, naming it, without ever calling invoke', async () => {
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'zz');
    expect(result).toEqual({ status: 'paused', reason: 'unsupported-language', detail: 'zz', resumable: true });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('pauses when project.language is undefined, without ever calling invoke', async () => {
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, undefined);
    expect(result).toEqual({ status: 'paused', reason: 'unsupported-language', detail: 'undefined', resumable: true });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('pauses when the chunk plan is empty, without ever calling invoke', async () => {
    mockComputeFaChunkPlan.mockReturnValue([]);
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result).toEqual({ status: 'paused', reason: 'empty-chunk-plan', resumable: true });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('pauses with reason model-not-found when invoke rejects with that typed kind — the real shape of a gate-on-without-a-model run', async () => {
    // The model lookup that can fail this way lives in fa_align_production
    // (resolve_wav_and_align), not in fa_stage_audio_raw (which only writes
    // a file) — so staging succeeds and the alignment call is the one that
    // rejects, exactly as it would against a real gate-on-without-a-model run.
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'fa_stage_audio_raw') return FAKE_STAGED_INPUT_PATH;
      throw { kind: 'modelNotFound', message: 'no model.onnx found for language "en"' };
    });
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    // The typed `kind` on the rejected FaError is what makes this
    // 'model-not-found' rather than the generic 'inference-failed' catch-all
    // — the exact "split the catch-all at the IPC boundary" fix plan-v3
    // item 3 asks for at this site (M3.1 site 4).
    expect(result).toMatchObject({ status: 'paused', reason: 'model-not-found' });
    expect(mockInvoke).toHaveBeenCalledWith('fa_align_production', expect.objectContaining({ language: 'en' }));
  });

  it('pauses with reason already-running when invoke rejects with that typed kind', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'fa_stage_audio_raw') return FAKE_STAGED_INPUT_PATH;
      throw { kind: 'alreadyRunning', message: 'a run is already in flight for this key' };
    });
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result).toMatchObject({ status: 'paused', reason: 'already-running' });
  });

  it('pauses with reason audio-stage-failed when fa_stage_audio_raw itself rejects — distinct from an inference failure', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'fa_stage_audio_raw') throw 'disk full';
      throw new Error('should not reach fa_align_production');
    });
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result).toEqual({ status: 'paused', reason: 'audio-stage-failed', detail: 'disk full', resumable: true });
  });

  it('carries the backend message through as `detail`, so the log can say WHICH failure — defaults to inference-failed when the channel Error carries no typed kind', async () => {
    // FaEvent::Error is message-only (no `kind` field) — this is the one
    // path that genuinely cannot be split further without guessing at
    // backend prose, matching the old 'inference-error' catch-all's own
    // documented reasoning.
    mockStageThenAlign((args) => {
      args.onEvent.onmessage({ event: 'Error', data: { message: 'model hash mismatch for "en"' } });
    });
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result).toEqual({
      status: 'paused',
      reason: 'inference-failed',
      detail: 'model hash mismatch for "en"',
      resumable: true,
    });
  });

  it('pauses when the run completes with zero words, distinctly from an inference failure', async () => {
    mockStageThenAlign((args) => {
      args.onEvent.onmessage({ event: 'Done', data: { words: [] } });
    });
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result).toEqual({ status: 'paused', reason: 'zero-words', resumable: true });
  });

  it('never throws even if invoke throws synchronously', async () => {
    mockInvoke.mockImplementation(() => {
      throw new Error('IPC bridge unavailable');
    });
    await expect(
      runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en'),
    ).resolves.toMatchObject({ status: 'paused' });
  });

  it('never reports a paused run as a success — no failure path can yield status "ok"', async () => {
    // The property that makes the discriminated result worth having: a caller
    // that branches on `status === 'ok'` cannot be handed tokens from a failed
    // run, whichever path failed.
    const failures: Array<() => void> = [
      () => { mockComputeFaChunkPlan.mockReturnValue([]); },
      () => { mockInvoke.mockRejectedValue(new Error('boom')); },
      () => {
        mockInvoke.mockImplementation(async (_c: string, a: { onEvent: FakeChannel<unknown> }) => {
          a.onEvent.onmessage({ event: 'Done', data: { words: [] } });
        });
      },
    ];
    for (const setUp of failures) {
      mockInvoke.mockReset();
      mockComputeFaChunkPlan.mockReturnValue([{ startSec: 0, endSec: 1, text: 'hello world' }]);
      setUp();
      const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
      expect(result.status).toBe('paused');
    }
  });
});

describe('runForcedAlignmentForSync — cancellation (plan-v3 item 5)', () => {
  it('resolves cancelled immediately when the signal is already aborted, without calling invoke', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en', controller.signal);
    expect(result).toEqual({ status: 'cancelled' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('invokes fa_cancel and resolves cancelled — never as a paused failure — when aborted mid-alignment', async () => {
    const controller = new AbortController();
    let capturedOnEvent: FakeChannel<unknown> | undefined;
    mockInvoke.mockImplementation(async (cmd: string, args?: { onEvent: FakeChannel<unknown> }) => {
      if (cmd === 'fa_stage_audio_raw') return FAKE_STAGED_INPUT_PATH;
      if (cmd === 'fa_cancel') return undefined;
      if (cmd === 'fa_align_production') {
        capturedOnEvent = args!.onEvent;
        // Never resolves on its own — only the abort settles the outer promise.
        return new Promise(() => {});
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const resultPromise = runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en', controller.signal);
    // Let the real awaits between here and fa_align_production actually
    // being called settle (detectSilences, voiceoverBlob.arrayBuffer(),
    // fa_stage_audio_raw) — these are real Promise/Blob machinery, not just
    // one microtask tick, so poll rather than assume a fixed tick count.
    for (let i = 0; i < 50 && !capturedOnEvent; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(capturedOnEvent).toBeDefined();
    controller.abort();
    const result = await resultPromise;

    expect(result).toEqual({ status: 'cancelled' });
    expect(mockInvoke).toHaveBeenCalledWith('fa_cancel', {});
  });

  it('never falls into a paused-failure result once cancelled, even if a later Error event also arrives', async () => {
    const controller = new AbortController();
    mockInvoke.mockImplementation(async (cmd: string, args?: { onEvent: FakeChannel<unknown> }) => {
      if (cmd === 'fa_stage_audio_raw') return FAKE_STAGED_INPUT_PATH;
      if (cmd === 'fa_cancel') return undefined;
      if (cmd === 'fa_align_production') {
        controller.abort();
        // A real fa_align_production, once cancelled, rejects with
        // FaErrorKind::Cancelled rather than sending an Error event — this
        // asserts the SAME outcome even if a caller's channel handler saw
        // something else first, since classifyFaError treats a `{kind:
        // 'cancelled'}` rejection as cancelled regardless of source.
        args!.onEvent.onmessage({ event: 'Error', data: { message: 'should not win' } });
        return Promise.reject({ kind: 'cancelled', message: 'cancelled' });
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en', controller.signal);
    // The abort listener rejects the outer promise FIRST (abort() dispatches
    // synchronously, before the mock's own onmessage call below it runs), so
    // this is 'cancelled' outright, not merely "not paused".
    expect(result).toEqual({ status: 'cancelled' });
  });
});

describe('runForcedAlignmentForSync — success path', () => {
  function resolveWithTwoWords(): void {
    mockStageThenAlign((args) => {
      args.onEvent.onmessage({
        event: 'Done',
        data: {
          words: [
            { word: 'hello', startSec: 0, endSec: 0.4, confidence: 0.9, needsReview: false, wordIndex: 0 },
            { word: 'world', startSec: 0.4, endSec: 1, confidence: 0.05, needsReview: true, wordIndex: 1 },
          ],
        },
      });
    });
  }

  it('reshapes a successful Done event into TranscriptToken[] via faWordSpansToTranscriptTokens', async () => {
    resolveWithTwoWords();
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.tokens).toEqual([
      { startSec: 0, endSec: 0.4, text: 'hello', confidence: 0.9, wordIndex: 0, needsReview: false },
      { startSec: 0.4, endSec: 1, text: 'world', confidence: 0.05, wordIndex: 1, needsReview: true },
    ]);
  });

  it('passes the anchor-timed segments and raw whisper tokens straight through to computeFaChunkPlan', async () => {
    mockStageThenAlign((args) => {
      args.onEvent.onmessage({ event: 'Done', data: { words: [] } });
    });
    const segments = makeSegments();
    await runForcedAlignmentForSync(makeAsset(), segments, whisperTokens, 1, 'en');
    expect(mockComputeFaChunkPlan).toHaveBeenCalledWith(segments, whisperTokens, [], 1);
  });

  it('derives R.5 excisions from the IDENTICAL four arguments the chunk plan was built from', async () => {
    // The provenance requirement, asserted rather than commented: logging R.5's
    // excisions against a different silence array (App.tsx runs its own
    // detection pass) would report spans R.5 never acted on. Same arguments is
    // what makes the logged span the one the plan actually excised.
    resolveWithTwoWords();
    const segments = makeSegments();
    await runForcedAlignmentForSync(makeAsset(), segments, whisperTokens, 1, 'en');
    expect(mockComputeUnscriptedRuns).toHaveBeenCalledWith(segments, whisperTokens, [], 1);
    expect(mockComputeUnscriptedRuns.mock.calls[0]).toEqual(mockComputeFaChunkPlan.mock.calls[0]);
  });

  it('returns the excised runs on the result so the caller can log them', async () => {
    resolveWithTwoWords();
    const runs = [{ tokenLo: 3, tokenHi: 9, startSec: 12.5, endSec: 15.75, qiSplit: 40 }];
    mockComputeUnscriptedRuns.mockReturnValue(runs);
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result.status === 'ok' && result.unscriptedRuns).toEqual(runs);
  });

  it('a Done payload with infeasible chunks is degraded, never a clean ok', async () => {
    mockStageThenAlign((args) => {
      args.onEvent.onmessage({
        event: 'Done',
        data: {
          words: [
            { word: 'because', startSec: 18.08, endSec: 18.12, confidence: 0, needsReview: true, wordIndex: 0 },
            { word: 'the', startSec: 18.12, endSec: 18.20, confidence: 0, needsReview: true, wordIndex: 1 },
          ],
          nFallbackChunks: 1,
          infeasibleChunks: [{ chunkIndex: 4, startSec: 18.08, endSec: 18.70, wordCount: 2 }],
        },
      });
    });
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result.status).toBe('degraded');
    expect(result.status === 'degraded' && result.reason).toBe('ctc-infeasible-chunk');
    expect(result.status === 'degraded' && result.nFallbackChunks).toBe(1);
    expect(result.status === 'degraded' && result.infeasibleChunks).toHaveLength(1);
    expect(result.status === 'ok').toBe(false);
  });

  it('reports a silence-detection failure on the SUCCESS result rather than swallowing it', async () => {
    // A chunk plan built against zero silences still produces real FA tokens,
    // so this is not a fallback — but it is a real degradation that was
    // console-only before, and the run it degrades is one the acceptance pass
    // would otherwise record as clean.
    const { detectSilences } = await import('./silenceDetector');
    (detectSilences as unknown as Mock).mockResolvedValueOnce({ status: 'error', errorMessage: 'ffmpeg not found' });
    resolveWithTwoWords();
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.silenceError).toBe('ffmpeg not found');
    expect(mockComputeFaChunkPlan).toHaveBeenCalledWith(makeSegments(), whisperTokens, [], 1);
  });
});
