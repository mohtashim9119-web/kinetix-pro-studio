/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// G4 Unit 1 — `detectSeamFitDefects` (R.11) never forwarded `languageCode` to
// its own `computeFaChunkPlan`/`computeRuns` calls, while every sibling gate
// on the same rule stage (`computeRunExtents`, R.13's own `computeRunContext`
// call, `alignScenestoTranscriptAsync`) received the project's real language.
// On an es/fr/de/pt project this meant R.11's `fit`/`fitDeviation`
// measurement canonicalized script text differently than the rest of the
// rule stage — a silent divergence, not a crash.
//
// OLD-BUG-FIRST: this suite spies on the real `computeFaChunkPlan`/
// `computeRuns` (not mocked away — the point is to observe what
// `detectSeamFitDefects` actually forwards) and asserts the `languageCode`
// argument each receives matches what was passed in. Before the fix, both
// spies would have recorded `undefined` regardless of what
// `detectSeamFitDefects` was called with — this suite fails against that
// pre-fix behavior and passes against the current signature.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as faChunkPlanModule from './faChunkPlan';
import { detectSeamFitDefects } from './faSeamFitGate';
import type { TranscriptToken, VideoSegment } from '../types';
import type { SilenceInterval } from './silenceDetector';

function seg(id: string, text: string, startTime: number, duration: number, order: number): VideoSegment {
  return { id, text, startTime, duration, transition: 'none', animation: 'none', order } as unknown as VideoSegment;
}

/** A minimal, well-formed fixture — not tuned to fire any R.11 finding
 *  (irrelevant here); this suite only cares what arguments
 *  `detectSeamFitDefects` forwards downstream, never what it returns. */
function buildFixture(): { segments: VideoSegment[]; tokens: TranscriptToken[]; silences: SilenceInterval[] } {
  const segments = [
    seg('s0', 'uno dos tres', 0, 5, 0),
    seg('s1', 'cuatro cinco seis', 5, 5, 1),
  ];
  const words = ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'];
  const tokens: TranscriptToken[] = words.map((w, i) => ({ text: w, startSec: i * 1.0, endSec: i * 1.0 + 0.5 }));
  const silences: SilenceInterval[] = [{ startSec: 4.5, endSec: 5.0 }];
  return { segments, tokens, silences };
}

describe('G4 Unit 1 — detectSeamFitDefects forwards languageCode to computeFaChunkPlan/computeRuns', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forwards a real, non-English languageCode to both downstream calls (OLD BUG: both used to receive undefined)', () => {
    const chunkPlanSpy = vi.spyOn(faChunkPlanModule, 'computeFaChunkPlan');
    const runsSpy = vi.spyOn(faChunkPlanModule, 'computeRuns');
    const { segments, tokens, silences } = buildFixture();

    detectSeamFitDefects(segments, segments, tokens, [], silences, 10, 'es');

    expect(chunkPlanSpy).toHaveBeenCalled();
    expect(chunkPlanSpy.mock.calls[0]![5]).toBe('es'); // computeFaChunkPlan(segments, tokens, silences, audioDuration, attribution, languageCode, ...)
    expect(runsSpy).toHaveBeenCalled();
    expect(runsSpy.mock.calls[0]![4]).toBe('es'); // computeRuns(segments, tokens, silences, audioDuration, languageCode)
  });

  it('an omitted languageCode still forwards undefined explicitly (English/language-unset projects: byte-for-byte unchanged)', () => {
    const chunkPlanSpy = vi.spyOn(faChunkPlanModule, 'computeFaChunkPlan');
    const runsSpy = vi.spyOn(faChunkPlanModule, 'computeRuns');
    const { segments, tokens, silences } = buildFixture();

    detectSeamFitDefects(segments, segments, tokens, [], silences, 10);

    expect(chunkPlanSpy.mock.calls[0]![5]).toBeUndefined();
    expect(runsSpy.mock.calls[0]![4]).toBeUndefined();
  });

  it.each(['es', 'fr', 'de', 'pt'] as const)(
    'forwards %s the same way it forwards es (all four non-English languages wired identically)',
    (lang) => {
      const chunkPlanSpy = vi.spyOn(faChunkPlanModule, 'computeFaChunkPlan');
      const runsSpy = vi.spyOn(faChunkPlanModule, 'computeRuns');
      const { segments, tokens, silences } = buildFixture();

      detectSeamFitDefects(segments, segments, tokens, [], silences, 10, lang);

      expect(chunkPlanSpy.mock.calls[0]![5]).toBe(lang);
      expect(runsSpy.mock.calls[0]![4]).toBe(lang);
    },
  );
});
