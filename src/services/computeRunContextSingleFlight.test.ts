/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 Wave 2 Group 2 completion, Unit 2 — "Result: exactly ONE
// computeRunContext execution per sync (the original defect's true intent)."
//
// G2 item 1 deduped every call site that already shared a reference tuple,
// but left TWO distinct groups because `forcedAlignmentRun.ts`'s own
// `detectSilences` pass and the App.tsx post-FA block's `aligned.silences`
// (from `useWhisper.ts`'s `alignSegmentsFromCachedTranscript`) were two
// independently-detected, never-the-same-reference arrays for the SAME
// audio (G2 end-of-group report, sighting #2). Unit 2's
// `detectSilencesSingleFlight` (silenceDetector.ts) closes that gap by
// keying silence detection on the staged audio's content hash — this file
// composes the REAL production functions from BOTH groups, fed by the SAME
// single-flight silences, and proves `computeRunContext` now executes
// exactly once across the whole set (not just within either group alone,
// which G2 item 1 already proved).
//
// Real, unmodified production functions throughout — no hand-picked stage
// subset: `computeFaChunkPlan`/`computeUnscriptedRuns` (forcedAlignmentRun.ts's
// own pair), `computeRunExtents`/`detectSeamFitDefects`/
// `detectRunPlacementDefects`/`detectUtterancePlacementDefects` (the
// App.tsx post-FA block's own four calls).
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptToken, VideoSegment } from '../types';
import type { SilenceInterval } from './silenceDetector';
import { detectSilencesSingleFlight, __resetSilenceDetectionCacheForTests } from './silenceDetector';
import {
  __getRunContextComputeCountForTests,
  __resetRunContextCacheForTests,
  computeFaChunkPlan,
  computeRuns,
  computeUnscriptedRuns,
} from './faChunkPlan';
import { computeRunExtents } from './faRuleStageExclusion';
import { detectSeamFitDefects } from './faSeamFitGate';
import { detectRunPlacementDefects, detectUtterancePlacementDefects } from './faRunPlacementGate';

function seg(id: string, text: string, startTime: number, duration: number): VideoSegment {
  return { id, text, startTime, duration, transition: 'none', animation: 'none', order: 0 } as VideoSegment;
}

function token(text: string, startSec: number, endSec: number): TranscriptToken {
  return { text, startSec, endSec };
}

/** A minimal stand-in for the parts of AudioBuffer `detectSilences` reads —
 *  mirrors `silenceDetector.test.ts`'s own `fakeBuffer`. */
function fakeBuffer(samples: Float32Array): unknown {
  return {
    sampleRate: 1000,
    length: samples.length,
    numberOfChannels: 1,
    duration: samples.length / 1000,
    getChannelData: () => samples,
  };
}

function stubDecodeOk(): void {
  // A short, entirely-loud buffer — this test is about reference sharing,
  // not the specific silence intervals, so "no silence detected" (an empty
  // array) is a perfectly good, deterministic result.
  vi.stubGlobal('AudioContext', class {
    decodeAudioData = (): Promise<unknown> => Promise.resolve(fakeBuffer(new Float32Array(200).fill(0.5)));
    close = (): Promise<void> => Promise.resolve();
  });
}

function blob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3, 4])]);
}

describe('computeRunContext — exactly ONE execution per sync, real production call graph (WS2 G2 completion, Unit 2)', () => {
  beforeEach(() => {
    __resetRunContextCacheForTests();
    __resetSilenceDetectionCacheForTests();
    stubDecodeOk();
  });

  it('forcedAlignmentRun.ts\'s own pair AND the App.tsx post-FA block\'s four calls, fed by the SAME audioHash-keyed silences, collapse to ONE computeRunContext execution total (old-bug proof: without Unit 2\'s single-flight, the App.tsx-block group\'s silences reference differs from forcedAlignmentRun.ts\'s own, so this composition needs 2)', async () => {
    const segments = [
      seg('s0', 'kittens likes purple hats', 0, 2),
      seg('s1', 'dragons chase silver moons', 2, 2),
      seg('s2', 'wizards brew golden potions', 4, 2),
      seg('s3', 'falcons guard hidden castles', 6, 2),
    ];
    const words = segments.flatMap(s => s.text.split(' '));
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.5, i * 0.5 + 0.4));
    const audioDuration = 8;

    // Two independent call sites resolving the SAME staged audio's silences
    // — mirrors forcedAlignmentRun.ts's own `detectSilences(voiceoverBlob)`
    // and useWhisper.ts's `fetchAndDetectSilences`, both now keyed by the
    // SAME audioHash App.tsx computes once and threads to both.
    const audioHash = 'content-hash-of-this-voiceover';
    const silenceResultA = await detectSilencesSingleFlight(audioHash, blob());
    const silenceResultB = await detectSilencesSingleFlight(audioHash, blob());
    expect(silenceResultB).toBe(silenceResultA); // Unit 2's own guarantee.
    const silences: SilenceInterval[] = silenceResultA.status === 'ok' ? silenceResultA.silences : [];

    // Group 1 — forcedAlignmentRun.ts's runFaAttempt: computeFaChunkPlan then
    // computeUnscriptedRuns, same (segments, tokens, silences, audioDuration).
    computeFaChunkPlan(segments, tokens, silences, audioDuration);
    computeUnscriptedRuns(segments, tokens, silences, audioDuration);

    // Group 2 — App.tsx's post-FA block: computeRunExtents,
    // detectSeamFitDefects, detectRunPlacementDefects,
    // detectUtterancePlacementDefects, all on the SAME reference tuple
    // (committedSegments/faTokens args differ per function but never feed
    // computeRunContext's own cache key).
    computeRunExtents(segments, tokens, silences, audioDuration);
    detectSeamFitDefects(segments, segments, tokens, tokens, silences, audioDuration);
    detectRunPlacementDefects(segments, segments, tokens, silences, audioDuration);
    detectUtterancePlacementDefects(segments, segments, tokens, silences, audioDuration);

    // Bonus: computeRuns (faSeamFitGate.ts's own second call inside
    // detectSeamFitDefects already exercised this internally above; called
    // once more here directly to confirm it too hits the same cache).
    computeRuns(segments, tokens, silences, audioDuration);

    expect(__getRunContextComputeCountForTests()).toBe(1);
  });

  it('a genuine audio swap (different audioHash) between the two groups correctly forces a SECOND computeRunContext execution — the single-flight cache never merges two different audios', async () => {
    const segments = [seg('s0', 'kittens likes purple hats', 0, 2)];
    const words = segments[0]!.text.split(' ');
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.5, i * 0.5 + 0.4));
    const audioDuration = 2;

    const silenceResultA = await detectSilencesSingleFlight('audio-v1', blob());
    const silencesA: SilenceInterval[] = silenceResultA.status === 'ok' ? silenceResultA.silences : [];
    computeFaChunkPlan(segments, tokens, silencesA, audioDuration);

    // A real audio swap mid-flow (e.g. the user re-staged a different
    // voiceover) — a different audioHash must miss the silence cache AND,
    // downstream, computeRunContext's own cache (different `silences`
    // reference).
    const silenceResultB = await detectSilencesSingleFlight('audio-v2', blob());
    const silencesB: SilenceInterval[] = silenceResultB.status === 'ok' ? silenceResultB.silences : [];
    expect(silencesB).not.toBe(silencesA);
    computeUnscriptedRuns(segments, tokens, silencesB, audioDuration);

    expect(__getRunContextComputeCountForTests()).toBe(2);
  });
});
