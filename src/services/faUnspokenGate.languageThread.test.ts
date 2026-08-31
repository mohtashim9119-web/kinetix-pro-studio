/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T3.1, Commit 1 test coverage (Phase 3, Step 1) — proves
// `detectUnspokenScriptSegmentsFromWhisper` (faUnspokenGate.ts:169, one of
// the six named call sites) threads its `languageCode` parameter through to
// BOTH `filterMalformedTokens` and `alignScenestoTranscript` unchanged. Those
// two functions are separately proven (whisperService.languageThread.test.ts)
// to thread that value into `canonicalize()` — this file closes the
// remaining link in the chain for this specific call site.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';

vi.mock('./whisperService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./whisperService')>();
  return {
    ...actual,
    filterMalformedTokens: vi.fn(actual.filterMalformedTokens),
    alignScenestoTranscript: vi.fn(actual.alignScenestoTranscript),
  };
});

import { detectUnspokenScriptSegmentsFromWhisper } from './faUnspokenGate';
import { filterMalformedTokens, alignScenestoTranscript } from './whisperService';
import type { VideoSegment, TranscriptToken } from '../types';

let nextId = 0;
function seg(text: string, startTime: number, duration: number): VideoSegment {
  return { id: `seg-${++nextId}`, text, startTime, duration, transition: 'none', animation: 'none' } as unknown as VideoSegment;
}

const tok = (text: string, startSec: number, endSec: number): TranscriptToken => ({ text, startSec, endSec });

describe('detectUnspokenScriptSegmentsFromWhisper — WS2 T3.1 language threading (faUnspokenGate.ts:169)', () => {
  it('passes a defined languageCode through to filterMalformedTokens and alignScenestoTranscript unchanged', () => {
    const segments = [seg('alpha bravo', 0, 2)];
    const whisperTokens = [tok('alpha', 0, 1), tok('bravo', 1, 2)];
    const faTokens = [tok('alpha', 0, 1), tok('bravo', 1, 2)];

    const filterMocked = vi.mocked(filterMalformedTokens);
    const alignMocked = vi.mocked(alignScenestoTranscript);
    filterMocked.mockClear();
    alignMocked.mockClear();

    detectUnspokenScriptSegmentsFromWhisper(segments, whisperTokens, faTokens, [], 2, 'es');

    expect(filterMocked).toHaveBeenCalled();
    expect(filterMocked.mock.calls[0]![2]).toBe('es');

    expect(alignMocked).toHaveBeenCalled();
    expect(alignMocked.mock.calls[0]![4]).toBe('es');
  });

  it('passes undefined through unchanged when no languageCode is given (pre-T3.1 default)', () => {
    const segments = [seg('alpha bravo', 0, 2)];
    const whisperTokens = [tok('alpha', 0, 1), tok('bravo', 1, 2)];
    const faTokens = [tok('alpha', 0, 1), tok('bravo', 1, 2)];

    const filterMocked = vi.mocked(filterMalformedTokens);
    const alignMocked = vi.mocked(alignScenestoTranscript);
    filterMocked.mockClear();
    alignMocked.mockClear();

    detectUnspokenScriptSegmentsFromWhisper(segments, whisperTokens, faTokens, [], 2);

    expect(filterMocked.mock.calls[0]![2]).toBeUndefined();
    expect(alignMocked.mock.calls[0]![4]).toBeUndefined();
  });
});
