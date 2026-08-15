/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Task 5, docs/work-in-progress.md §11 item 1 — the production
// forced-alignment caller's own FAIL-CLEAN contract: `runForcedAlignmentForSync`
// must resolve to `null` (never throw) on every failure a real
// gate-on-without-a-model session will hit — unsupported language, an empty
// chunk plan, a Tauri command rejection (the `ModelNotFound`/
// `InferenceFailed`/`ModelHashMismatch` shapes `fa.rs`/`fa_production.rs`
// actually return with no model present), and an `FaEvent::Error` sent over
// the channel instead of a rejected promise. This is the path most likely to
// be wrong and least likely to be noticed (per this session's own brief) —
// every branch below is exercised explicitly, not just the happy path.
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
}));

import { invoke } from '@tauri-apps/api/core';
import { computeFaChunkPlan } from './faChunkPlan';
import { runForcedAlignmentForSync } from './forcedAlignmentRun';
import type { Asset, TranscriptToken, VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

const mockInvoke = invoke as unknown as Mock;
const mockComputeFaChunkPlan = computeFaChunkPlan as unknown as Mock;

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
});

describe('runForcedAlignmentForSync — fail-clean fallback', () => {
  it('returns null for an unsupported language, without ever calling invoke', async () => {
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'zz');
    expect(result).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('returns null when project.language is undefined, without ever calling invoke', async () => {
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, undefined);
    expect(result).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('returns null when the chunk plan is empty, without ever calling invoke', async () => {
    mockComputeFaChunkPlan.mockReturnValue([]);
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('returns null when invoke rejects — the real shape of a gate-on-without-a-model run (ModelNotFound/InferenceFailed)', async () => {
    mockInvoke.mockRejectedValue({ kind: 'modelNotFound', message: 'no model.onnx found for language "en"' });
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('fa_align_production', expect.objectContaining({ language: 'en' }));
  });

  it('returns null when the channel delivers an Error event instead of Done', async () => {
    mockInvoke.mockImplementation(async (_cmd: string, args: { onEvent: FakeChannel<unknown> }) => {
      args.onEvent.onmessage({ event: 'Error', data: { message: 'inference failed' } });
    });
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result).toBeNull();
  });

  it('returns null when the run completes with zero words', async () => {
    mockInvoke.mockImplementation(async (_cmd: string, args: { onEvent: FakeChannel<unknown> }) => {
      args.onEvent.onmessage({ event: 'Done', data: { words: [] } });
    });
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result).toBeNull();
  });

  it('never throws even if invoke throws synchronously', async () => {
    mockInvoke.mockImplementation(() => {
      throw new Error('IPC bridge unavailable');
    });
    await expect(
      runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en'),
    ).resolves.toBeNull();
  });
});

describe('runForcedAlignmentForSync — success path', () => {
  it('reshapes a successful Done event into TranscriptToken[] via faWordSpansToTranscriptTokens', async () => {
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
    const result = await runForcedAlignmentForSync(makeAsset(), makeSegments(), whisperTokens, 1, 'en');
    expect(result).toEqual([
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
});
