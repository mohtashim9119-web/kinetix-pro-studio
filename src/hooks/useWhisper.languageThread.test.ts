/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T3.1, Commit 1 test coverage (Phase 3, Step 1) — proves
// `alignSegmentsFromCachedTranscript` (useWhisper.ts:115 — exported for this
// test the same way `fetchAndDetectSilences` already was, no behavior
// change) threads its `languageCode` parameter through to both
// `filterMalformedTokens` and `alignScenestoTranscriptAsync` unchanged. Those
// functions are separately proven (whisperService.languageThread.test.ts,
// whisperService.test.ts's async-twin pin tests) to thread that value into
// `canonicalize()`/the sync `alignScenestoTranscript` it delegates to — this
// file closes the remaining link in the chain for this specific call site.
//
// WS2 G2 item 2 (worker migration) repointed the internal call from the sync
// `alignScenestoTranscript` to the async, worker-backed
// `alignScenestoTranscriptAsync`. G2 completion Unit 1 folded that function
// (and `extractSegmentAlignmentsAsync`) into `whisperService.ts` itself
// (previously a separate `syncMatchAsync.ts`, deleted — see
// `whisperService.ts`'s own header comment for why: the async twin needs to
// share a memo with `extractSegmentAlignments` in the same file) — this test
// mocks it from `whisperService.ts` accordingly. It is a thin wrapper that
// immediately forwards to `extractSegmentAlignmentsAsync`/
// `alignQueryToSubjectAsync`, so mocking it here still tests exactly what
// this file's name promises: does `alignSegmentsFromCachedTranscript` thread
// `languageCode` to the matcher call, unchanged.
//
// `startTranscription` (useWhisper.ts:316, the other useWhisper.ts call
// site) is NOT covered here: its languageCode wiring lives inside a
// `useCallback` closure in the `useWhisper()` hook body, and this repo has no
// jsdom/@testing-library/react/react-test-renderer (confirmed absent from
// node_modules — same limitation useExport.test.ts's and usePlayback.test.ts's
// own headers document for those hooks' timer/tick behavior). Verified
// instead by direct code reading (useWhisper.ts:303-325: the identical
// `toAlignmentLanguageCode(language)` -> `filterMalformedTokens(...,
// languageCode)` -> `alignScenestoTranscriptAsync(..., languageCode, signal)`
// shape this file proves for `alignSegmentsFromCachedTranscript`) and by
// `tsc --noEmit`, which fails if the parameter is ever dropped or misordered.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/silenceDetector', () => ({
  detectSilences: vi.fn(async () => ({ status: 'ok' as const, silences: [] })),
  // WS2 G2 completion, Unit 2 — `alignSegmentsFromCachedTranscript` now
  // routes silence detection through this single-flight wrapper.
  detectSilencesSingleFlight: vi.fn(async () => ({ status: 'ok' as const, silences: [] })),
}));

vi.mock('../services/whisperService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/whisperService')>();
  return {
    ...actual,
    filterMalformedTokens: vi.fn(actual.filterMalformedTokens),
    alignScenestoTranscriptAsync: vi.fn(actual.alignScenestoTranscriptAsync),
  };
});

import { alignSegmentsFromCachedTranscript } from './useWhisper';
import { filterMalformedTokens, alignScenestoTranscriptAsync } from '../services/whisperService';
import type { Asset, VideoSegment, TranscriptToken } from '../types';

const audioAsset = (): Asset => ({
  id: 'voiceover-1',
  name: 'voiceover.mp3',
  url: 'blob:http://tauri.localhost/00000000-0000-0000-0000-000000000000',
  type: 'audio',
  file: new File(['fake-audio-bytes'], 'voiceover.mp3', { type: 'audio/mpeg' }),
});

const seg = (id: string, text: string, startTime: number, duration: number): VideoSegment =>
  ({ id, text, startTime, duration, transition: 'none', animation: 'none' }) as unknown as VideoSegment;

const tok = (text: string, startSec: number, endSec: number): TranscriptToken => ({ text, startSec, endSec });

describe('alignSegmentsFromCachedTranscript — WS2 T3.1 language threading (useWhisper.ts:115)', () => {
  beforeEach(() => {
    vi.mocked(filterMalformedTokens).mockClear();
    vi.mocked(alignScenestoTranscriptAsync).mockClear();
  });

  it('passes a defined languageCode through to filterMalformedTokens and alignScenestoTranscriptAsync unchanged', async () => {
    const segments = [seg('s1', 'alpha bravo', 0, 2)];
    const tokens = [tok('alpha', 0, 1), tok('bravo', 1, 2)];

    await alignSegmentsFromCachedTranscript(audioAsset(), segments, tokens, 2, 'whisper', 'es');

    const filterMocked = vi.mocked(filterMalformedTokens);
    const alignMocked = vi.mocked(alignScenestoTranscriptAsync);
    expect(filterMocked).toHaveBeenCalled();
    expect(filterMocked.mock.calls[0]![2]).toBe('es');
    expect(alignMocked).toHaveBeenCalled();
    expect(alignMocked.mock.calls[0]![4]).toBe('es');
  });

  it('passes undefined through unchanged when no languageCode is given (pre-T3.1 default)', async () => {
    const segments = [seg('s1', 'alpha bravo', 0, 2)];
    const tokens = [tok('alpha', 0, 1), tok('bravo', 1, 2)];

    await alignSegmentsFromCachedTranscript(audioAsset(), segments, tokens, 2, 'whisper');

    const filterMocked = vi.mocked(filterMalformedTokens);
    const alignMocked = vi.mocked(alignScenestoTranscriptAsync);
    expect(filterMocked.mock.calls[0]![2]).toBeUndefined();
    expect(alignMocked.mock.calls[0]![4]).toBeUndefined();
  });
});
