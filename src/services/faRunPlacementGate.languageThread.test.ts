/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T3.1, Commit 1 test coverage (Phase 3, Step 1) — proves
// `detectUtterancePlacementDefects` (faRunPlacementGate.ts:693, one of the
// six named call sites) threads its `languageCode` parameter through to
// `alignScenestoTranscript` unchanged. `alignScenestoTranscript` itself is
// separately proven (whisperService.languageThread.test.ts) to thread that
// value into `canonicalize()` on both the scene-doc and token sides — this
// file closes the remaining link in the chain for this specific call site.
//
// The fixture is a trimmed copy of faRunPlacementGate.test.ts's own
// `baseFixture()` (R.12), reused because it's already proven (that file's
// first test) to produce a real non-empty `computeUnscriptedRuns` result —
// required to reach the `alignScenestoTranscript` call at all (the function
// early-returns on `runs.length === 0`).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';

vi.mock('./whisperService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./whisperService')>();
  return { ...actual, alignScenestoTranscript: vi.fn(actual.alignScenestoTranscript) };
});

import { detectUtterancePlacementDefects } from './faRunPlacementGate';
import { alignScenestoTranscript } from './whisperService';
import type { VideoSegment, TranscriptToken } from '../types';
import type { SilenceInterval } from './silenceDetector';

const seg = (id: string, text: string, startTime: number, duration: number): VideoSegment =>
  ({ id, text, startTime, duration, transition: 'none', animation: 'none' }) as unknown as VideoSegment;

const tok = (text: string, startSec: number, endSec: number): TranscriptToken => ({ text, startSec, endSec });

function fixture(): {
  parsed: VideoSegment[]; committed: VideoSegment[]; tokens: TranscriptToken[];
  silences: SilenceInterval[]; audioDuration: number;
} {
  const parsed = [
    seg('seg0', 'alpha bravo charlie delta', 0, 3.5),
    seg('seg1', 'echo foxtrot golf hotel', 3.5, 3.5),
    seg('seg2', 'india juliett kilo lima', 7.0, 3.0),
  ];
  const tokens = [
    tok('alpha', 0.10, 0.50), tok('bravo', 0.60, 1.00),
    tok('charlie', 1.10, 1.50), tok('delta', 1.60, 2.00),
    tok('level', 3.00, 3.30), tok('nine', 3.40, 3.70),
    tok('recitation', 3.80, 4.20), tok('here', 4.30, 4.60),
    tok('echo', 5.00, 5.40), tok('foxtrot', 5.50, 5.90),
    tok('golf', 6.00, 6.40), tok('hotel', 6.50, 6.90),
    tok('india', 7.50, 7.90), tok('juliett', 8.00, 8.40),
    tok('kilo', 8.50, 8.90), tok('lima', 9.00, 9.40),
  ];
  return {
    parsed,
    committed: parsed.map(s => ({ ...s })),
    tokens,
    silences: [{ startSec: 2.20, endSec: 2.80 }, { startSec: 4.70, endSec: 4.95 }],
    audioDuration: 10.0,
  };
}

describe('detectUtterancePlacementDefects — WS2 T3.1 language threading (faRunPlacementGate.ts:693)', () => {
  it('passes a defined languageCode through to alignScenestoTranscript unchanged', () => {
    const { parsed, committed, tokens, silences, audioDuration } = fixture();
    const mocked = vi.mocked(alignScenestoTranscript);
    mocked.mockClear();

    detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration, 'es');

    expect(mocked).toHaveBeenCalled();
    const lastCall = mocked.mock.calls[mocked.mock.calls.length - 1]!;
    expect(lastCall[4]).toBe('es');
  });

  it('passes undefined through unchanged when no languageCode is given (pre-T3.1 default)', () => {
    const { parsed, committed, tokens, silences, audioDuration } = fixture();
    const mocked = vi.mocked(alignScenestoTranscript);
    mocked.mockClear();

    detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration);

    expect(mocked).toHaveBeenCalled();
    const lastCall = mocked.mock.calls[mocked.mock.calls.length - 1]!;
    expect(lastCall[4]).toBeUndefined();
  });
});
