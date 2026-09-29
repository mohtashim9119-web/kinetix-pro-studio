/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Amount-drop fix, Commit 2 — the HONEST-BOUNDARY guard and its tripwires.
//
// The defect: when a scene's TAIL words (here the amount "$11,000") were never
// found in the audio, `snapCoveredBoundaries` derived the cut from the scene's
// last MATCHED word ("account"), so it landed between "account" and the amount
// (5.07) instead of after the amount (6.84). The guard: a scene with an
// unmatched tail is cut by silence geometry against the NEXT scene's first
// word, and every such case is named (never silent, never blocking).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseProjectData, filterToCoveredSegments } from '../App';
import { applyAnchorBasedTiming } from './syncEngine';
import { alignScenestoTranscript, distributeSegmentTimes, filterMalformedTokens, type SegmentAlignment } from './whisperService';
import { snapCoveredBoundaries } from './snapBoundaries';
import {
  validateTailWords, validateNumericWords, validateEngineBoundaryDelta, computeBoundaryDeltas,
} from './syncContracts';
import { buildGroupedViolationEntry } from './syncLog';
import { attentionKindForEntry } from './syncLogUserView';
import { stampTimingFindings, describeStampedEngine } from './timingProvenance';
import type { TranscriptToken, VideoSegment, Project } from '../types';

const FIX = (n: string): string => resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'fixtures', n);
const DURATION = 32.69;
const silences = JSON.parse(readFileSync(FIX('amount-14seg-silences.json'), 'utf-8')).silences as Array<{ startSec: number; endSec: number }>;
const cloud = (JSON.parse(readFileSync(FIX('amount-14seg-cloud-tokens.json'), 'utf-8')) as { tokens: TranscriptToken[] }).tokens;

async function run(tokens: TranscriptToken[], stripTail = false) {
  const parsed = await parseProjectData(
    readFileSync(FIX('amount-14seg-script.txt'), 'utf-8'), readFileSync(FIX('amount-14seg-scene-details.txt'), 'utf-8'), [], DURATION,
  );
  const timed = applyAnchorBasedTiming(parsed, DURATION);
  const usable = filterMalformedTokens(tokens, DURATION, 'en').tokens;
  const alignments = alignScenestoTranscript(timed, usable, silences, DURATION, 'en');
  const aligned = applyAnchorBasedTiming(distributeSegmentTimes(timed, alignments), DURATION);
  const { kept, keptAlignments } = filterToCoveredSegments(aligned, alignments);
  const snapAlignments: SegmentAlignment[] = stripTail
    ? keptAlignments.map(a => { const { unmatchedTailWords: _t, ...rest } = a; return rest; })
    : keptAlignments;
  const snapped = snapCoveredBoundaries(kept, snapAlignments, usable, silences, DURATION);
  return { kept, keptAlignments, snapped };
}

// The engine "lost" the amount: drop the two cloud tokens that carry "$11,000."
const withoutAmount = cloud.filter(t => t.text !== '$11' && t.text !== ',000.');
const cut3 = (segs: VideoSegment[]): number => Number((segs[2]!.startTime + segs[2]!.duration).toFixed(3));

describe('scene tail words nothing claimed (a)', () => {
  it('reports the unmatched tail and the unmatched number on the alignment', async () => {
    const { keptAlignments } = await run(withoutAmount);
    expect(keptAlignments[2]!.matched).toBe(true);
    expect(keptAlignments[2]!.unmatchedTailWords).toEqual(['eleven', 'thousand', 'dollars']);
    expect(keptAlignments[2]!.unmatchedNumericTokens).toEqual(['$11,000.']);
  });

  it('the cut lands from silence geometry against the NEXT scene, not after the last matched word', async () => {
    const { snapped } = await run(withoutAmount);
    // silence [6.56,7.12] adjoins "You" (6.64) — its midpoint, after the spoken amount.
    expect(cut3(snapped)).toBeCloseTo(6.84, 2);
  });

  it('WITHOUT the guard the same input cuts at 5.07 (the defect this closes)', async () => {
    const { snapped } = await run(withoutAmount, true);
    expect(cut3(snapped)).toBeCloseTo(5.07, 2);
  });

  it('a fully matched scene carries no tail fields and is cut exactly as before', async () => {
    const { keptAlignments, snapped } = await run(cloud);
    for (const a of keptAlignments) {
      expect(a.unmatchedTailWords).toBeUndefined();
      expect(a.unmatchedNumericTokens).toBeUndefined();
    }
    expect(cut3(snapped)).toBeCloseTo(6.84, 2);
  });
});

describe('tripwires name it — stamped, warn-only (a)(b)', () => {
  it('tail-words-unmatched names the words and is stamped as a tail-unmatched finding', async () => {
    const { kept, keptAlignments } = await run(withoutAmount);
    const v = validateTailWords(kept, keptAlignments);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe('tail-words-unmatched');
    expect(v[0]!.severity).toBe('warning');
    expect(v[0]!.message).toContain('"eleven thousand dollars"');
    const entry = buildGroupedViolationEntry('run', v, 1)!;
    expect(entry.finding).toEqual({ kind: 'tail-unmatched', count: 1 });
    expect(attentionKindForEntry(entry)).toBe('estimated-timings');
  });

  it('numeric-word-unmatched fires immediately for a written amount that did not match', async () => {
    const { kept, keptAlignments } = await run(withoutAmount);
    const v = validateNumericWords(kept, keptAlignments);
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('"$11,000."');
    const entry = buildGroupedViolationEntry('run', v, 1)!;
    expect(entry.finding).toEqual({ kind: 'numeric-unmatched', count: 1 });
  });

  it('a clean run raises neither', async () => {
    const { kept, keptAlignments } = await run(cloud);
    expect(validateTailWords(kept, keptAlignments)).toEqual([]);
    expect(validateNumericWords(kept, keptAlignments)).toEqual([]);
  });

  it('several flagged scenes group into ONE entry with per-item detail', () => {
    const segs = [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }] as VideoSegment[];
    const aligns = [{ unmatchedTailWords: ['one'] }, { unmatchedTailWords: ['two', 'three'] }] as SegmentAlignment[];
    const entry = buildGroupedViolationEntry('run', validateTailWords(segs, aligns), 1)!;
    expect(entry.finding).toEqual({ kind: 'tail-unmatched', count: 2 });
    expect(entry.groupedItems).toHaveLength(2);
  });
});

describe('engine-switch boundary delta (c)', () => {
  const seg = (id: string, text: string, startTime: number): VideoSegment => ({ id, text, startTime, duration: 1 }) as VideoSegment;
  const before = [seg('a', 'one', 0), seg('b', 'two', 5.89), seg('c', 'three', 8.11)];

  it('names every cut that moved by more than 100ms, with old and new times', () => {
    const after = [seg('a2', 'one', 0), seg('b2', 'two', 6.84), seg('c2', 'three', 8.15)];
    const deltas = computeBoundaryDeltas(before, after);
    expect(deltas).toEqual([{ segmentIndex: 1, segmentId: 'b2', oldStartSec: 5.89, newStartSec: 6.84 }]);
    const v = validateEngineBoundaryDelta(deltas, 'whisper-cloud + fa-cloud', 'whisper + fa');
    expect(v[0]!.message).toContain('5.890s → 6.840s');
    expect(v[0]!.message).toContain('whisper-cloud + fa-cloud');
    expect(v[0]!.message).toContain('whisper + fa');
    const entry = buildGroupedViolationEntry('run', v, 1)!;
    expect(entry.finding).toEqual({ kind: 'boundary-delta', count: 1 });
    expect(attentionKindForEntry(entry)).toBeUndefined(); // details only
  });

  it('exactly 100ms is not a delta; a reworded or added scene is never compared', () => {
    expect(computeBoundaryDeltas(before, [seg('a', 'one', 0), seg('b', 'two', 5.99), seg('c', 'three', 8.11)])).toEqual([]);
    expect(computeBoundaryDeltas(before, [seg('a', 'one', 0), seg('n', 'brand new', 9), seg('c', 'three', 8.11)])).toEqual([]);
  });
});

describe('findings persist with the timing they qualify', () => {
  const f = [{ kind: 'tail-unmatched' as const, sceneIds: ['s3'], detail: 'x' }];
  const stamp = (engine: 'fa-cloud' | 'whisper-cloud') => ({ engine, model: 'm', modelVersion: 'v', schemaVersion: 1, completedAt: 1 });
  it('goes on the alignment stamp when there is one, else the transcription stamp', () => {
    const both = stampTimingFindings({ transcription: stamp('whisper-cloud'), alignment: stamp('fa-cloud') }, f)!;
    expect(both.alignment!.findings).toEqual(f);
    expect(both.transcription!.findings).toBeUndefined();
    const only = stampTimingFindings({ transcription: stamp('whisper-cloud') }, f)!;
    expect(only.transcription!.findings).toEqual(f);
  });
  it('is a no-op with no findings or no stamp', () => {
    const p: Project['timingProvenance'] = { transcription: stamp('whisper-cloud') };
    expect(stampTimingFindings(p, [])).toBe(p);
    expect(stampTimingFindings(undefined, f)).toBeUndefined();
  });
  it('names the engines behind a stamp', () => {
    expect(describeStampedEngine({ transcription: stamp('whisper-cloud'), alignment: stamp('fa-cloud') })).toBe('whisper-cloud + fa-cloud');
    expect(describeStampedEngine(undefined)).toBe('an earlier engine (not recorded)');
  });
});
