/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// WS2 Wave 2 Group 2 — the async, worker-backed matcher entry points for the
// DEFAULT Whisper-timing path (`extractSegmentAlignmentsAsync`,
// `alignScenestoTranscriptAsync`, both in `whisperService.ts`). This test
// environment has no global `Worker` (verified: `typeof Worker ===
// 'undefined'` under vitest/Node), so `hirschbergMatchClient.ts` takes its
// documented fallback branch — the same `alignQueryToSubject` call,
// synchronous, wrapped in a resolved Promise. That is sufficient to pin
// output equality: `extractSegmentAlignmentsAsync` and
// `alignScenestoTranscriptAsync` share `buildSegmentAlignmentInputs` and
// `applyNeighborAnchorOverride` with their sync counterparts, so the
// fallback path proves the migration changed nothing but which call ran.
//
// Originally a separate file (`syncMatchAsync.ts`/`.test.ts`) — folded into
// `whisperService.ts` at G2 completion Unit 1 so `extractSegmentAlignmentsAsync`
// can share `extractSegmentAlignments`' reference-identity memo (see that
// file's own header comment for why). This test file moved with it.

import { beforeEach, describe, expect, it } from 'vitest';
import type { TranscriptToken, VideoSegment } from '../types';
import type { SilenceInterval } from './silenceDetector';
import {
  __getExtractAlignmentsComputeCountForTests,
  __resetExtractAlignmentsCacheForTests,
  alignScenestoTranscript,
  alignScenestoTranscriptAsync,
  extractSegmentAlignments,
  extractSegmentAlignmentsAsync,
} from './whisperService';
import { MatchCancelledError } from './hirschbergMatchClient';

function seg(id: string, text: string, locked = false): VideoSegment {
  return { id, text, startTime: 0, duration: 1, transition: 'none', animation: 'none', order: 0, locked } as VideoSegment;
}

function token(text: string, startSec: number, endSec: number): TranscriptToken {
  return { text, startSec, endSec };
}

describe('extractSegmentAlignmentsAsync (worker migration, zero-output-change pin)', () => {
  beforeEach(() => {
    __resetExtractAlignmentsCacheForTests();
  });

  it('produces byte-identical AlignResult[] to the sync path on a multi-segment fixture', async () => {
    const segments = [
      seg('s0', 'the quick brown fox'),
      seg('s1', 'jumps over the lazy dog'),
      seg('s2', 'and runs into the forest'),
    ];
    const words = segments.flatMap(s => s.text.split(' '));
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.4, i * 0.4 + 0.35));

    const sync = extractSegmentAlignments(segments, tokens, 6);
    __resetExtractAlignmentsCacheForTests();
    const async_ = await extractSegmentAlignmentsAsync(segments, tokens, 6);

    expect(async_).toEqual(sync);
    expect(sync.every(r => r.matched)).toBe(true);
  });

  it('matches the sync path on the empty-input short-circuit', async () => {
    const segments = [seg('s0', 'hello world')];
    const sync = extractSegmentAlignments(segments, []);
    const async_ = await extractSegmentAlignmentsAsync(segments, []);
    expect(async_).toEqual(sync);
  });

  it('rejects with MatchCancelledError on an already-aborted signal, without running the aligner', async () => {
    const segments = [seg('s0', 'hello world')];
    const tokens = [token('hello', 0, 0.4), token('world', 0.4, 0.8)];
    const controller = new AbortController();
    controller.abort();
    await expect(extractSegmentAlignmentsAsync(segments, tokens, 1, undefined, controller.signal))
      .rejects.toBeInstanceOf(MatchCancelledError);
  });

  it('warms the memo: the async call populates it, and the FOLLOWING sync call on the same reference tuple hits it (old-bug proof: fails without the memo write)', async () => {
    const segments = [seg('s0', 'the quick brown fox'), seg('s1', 'jumps over the lazy dog')];
    const words = segments.flatMap(s => s.text.split(' '));
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.4, i * 0.4 + 0.35));

    const asyncResult = await extractSegmentAlignmentsAsync(segments, tokens, 4);
    expect(__getExtractAlignmentsComputeCountForTests()).toBe(1);

    const syncResult = extractSegmentAlignments(segments, tokens, 4);
    // Still 1: the sync call hit the memo the async call warmed, rather than
    // recomputing.
    expect(__getExtractAlignmentsComputeCountForTests()).toBe(1);
    expect(syncResult).toEqual(asyncResult);
  });
});

describe('alignScenestoTranscriptAsync (worker migration, zero-output-change pin)', () => {
  beforeEach(() => {
    __resetExtractAlignmentsCacheForTests();
  });

  it('produces byte-identical SegmentAlignment[] to the sync path, including the neighbor-anchor override step', async () => {
    const segments = [
      seg('s0', 'the quick brown fox'),
      seg('s1', 'jumps over the lazy dog'),
      seg('s2', 'and runs into the forest'),
    ];
    const words = segments.flatMap(s => s.text.split(' '));
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.4, i * 0.4 + 0.35));
    const silences: SilenceInterval[] = [{ startSec: 1.9, endSec: 2.3 }];

    const sync = alignScenestoTranscript(segments, tokens, silences, 6);
    __resetExtractAlignmentsCacheForTests();
    const async_ = await alignScenestoTranscriptAsync(segments, tokens, silences, 6);

    expect(async_).toEqual(sync);
    // Sanity: the neighbor-override step actually ran (t1 of s0/s1 equals
    // the next segment's t0, not each segment's own raw matched end) —
    // proves this isn't accidentally passing on a fixture too small for
    // Step 2 to matter.
    expect(sync[0]!.t1).toBe(sync[1]!.t0);
    expect(sync[1]!.t1).toBe(sync[2]!.t0);
  });

  it('respects a locked segment: t1 is not overridden, sync and async agree', async () => {
    const segments = [
      seg('s0', 'the quick brown fox', true),
      seg('s1', 'jumps over the lazy dog'),
    ];
    const words = segments.flatMap(s => s.text.split(' '));
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.4, i * 0.4 + 0.35));

    const sync = alignScenestoTranscript(segments, tokens, [], 4);
    __resetExtractAlignmentsCacheForTests();
    const async_ = await alignScenestoTranscriptAsync(segments, tokens, [], 4);
    expect(async_).toEqual(sync);
    expect(sync[0]!.t1).not.toBe(sync[1]!.t0);
  });

  it('matches the sync path on the empty-input short-circuit', async () => {
    const segments = [seg('s0', 'hello world')];
    const sync = alignScenestoTranscript(segments, []);
    const async_ = await alignScenestoTranscriptAsync(segments, []);
    expect(async_).toEqual(sync);
  });

  it('rejects with MatchCancelledError on an already-aborted signal', async () => {
    const segments = [seg('s0', 'hello world')];
    const tokens = [token('hello', 0, 0.4), token('world', 0.4, 0.8)];
    const controller = new AbortController();
    controller.abort();
    await expect(alignScenestoTranscriptAsync(segments, tokens, [], 1, undefined, controller.signal))
      .rejects.toBeInstanceOf(MatchCancelledError);
  });
});
