/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Task 5, docs/work-in-progress.md §11 item 1 — the production
// forced-alignment caller's own FAIL-CLEAN contract: `runForcedAlignmentForSync`
// must resolve (never throw) on every failure a real gate-on-without-a-model
// session will hit — unsupported language, an empty chunk plan, a Tauri command
// rejection (the `ModelNotFound`/`InferenceFailed`/`ModelHashMismatch` shapes
// `fa.rs`/`fa_production.rs` actually return with no model present), and an
// `FaEvent::Error` sent over the channel instead of a rejected promise. This is
// the path most likely to be wrong and least likely to be noticed (per that
// session's brief) — every branch below is exercised explicitly, not just the
// happy path.
//
// WS1 SESSION J WIDENED WHAT IS ASSERTED. The contract used to be satisfied by
// returning `null`, and these tests asserted exactly that. But `null` is the
// same answer for all five failure paths, which is how a run that silently fell
// back to Whisper timing became indistinguishable from a clean FA run in the
// persisted log. The contract now additionally requires the result to NAME the
// path that fired, so each test below asserts the reason, not just the absence
// of tokens. "Never throws" is unchanged and still asserted.
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

describe('runForcedAlignmentForSync — fail-clean fallback, and the reason it names', () => {
  it('falls back on an unsupported language, naming it, without ever calling invoke', async () => {
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'zz');
    expect(result).toEqual({ status: 'fallback', reason: 'unsupported-language', detail: 'zz' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('falls back when project.language is undefined, without ever calling invoke', async () => {
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, undefined);
    expect(result).toEqual({ status: 'fallback', reason: 'unsupported-language', detail: 'undefined' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('falls back when the chunk plan is empty, without ever calling invoke', async () => {
    mockComputeFaChunkPlan.mockReturnValue([]);
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result).toEqual({ status: 'fallback', reason: 'empty-chunk-plan' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('falls back when invoke rejects — the real shape of a gate-on-without-a-model run (ModelNotFound/InferenceFailed)', async () => {
    mockInvoke.mockRejectedValue({ kind: 'modelNotFound', message: 'no model.onnx found for language "en"' });
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result).toMatchObject({ status: 'fallback', reason: 'inference-error' });
    expect(mockInvoke).toHaveBeenCalledWith('fa_align_production', expect.objectContaining({ language: 'en' }));
  });

  it('carries the backend message through as `detail`, so the log can say WHICH inference error', async () => {
    // The whole reason 'inference-error' is one member rather than three: no
    // model / hash mismatch / runtime failure all arrive here, and only this
    // string tells them apart. Dropping it would put the fallback back to being
    // unattributable, which is the defect this contract change exists to fix.
    mockInvoke.mockImplementation(async (_cmd: string, args: { onEvent: FakeChannel<unknown> }) => {
      args.onEvent.onmessage({ event: 'Error', data: { message: 'model hash mismatch for "en"' } });
    });
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result).toEqual({
      status: 'fallback',
      reason: 'inference-error',
      detail: 'model hash mismatch for "en"',
    });
  });

  it('falls back when the run completes with zero words, distinctly from an inference error', async () => {
    mockInvoke.mockImplementation(async (_cmd: string, args: { onEvent: FakeChannel<unknown> }) => {
      args.onEvent.onmessage({ event: 'Done', data: { words: [] } });
    });
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result).toEqual({ status: 'fallback', reason: 'zero-words' });
  });

  it('never throws even if invoke throws synchronously', async () => {
    mockInvoke.mockImplementation(() => {
      throw new Error('IPC bridge unavailable');
    });
    await expect(
      runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en'),
    ).resolves.toMatchObject({ status: 'fallback', reason: 'inference-error' });
  });

  it('never reports a fallback as a success — no failure path can yield status "ok"', async () => {
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
      expect(result.status).toBe('fallback');
    }
  });
});

describe('runForcedAlignmentForSync — success path', () => {
  function resolveWithTwoWords(): void {
    mockInvoke.mockImplementation(async (_cmd: string, args: { onEvent: FakeChannel<unknown> }) => {
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
    mockInvoke.mockImplementation(async (_cmd: string, args: { onEvent: FakeChannel<unknown> }) => {
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
