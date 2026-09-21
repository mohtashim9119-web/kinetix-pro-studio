/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 1 hotfix, FIX 1 — an R.10 skip must not cascade into R.14.
//
// Operator smoke log, verbatim shape:
//   "[SKIP] S3 / Clip 3 skipped — scripted text never spoken"
//   "[RULE] R.14 moved scene 2 from 0.304s to 3.05s (+2.746s)"
//
// MECHANISM, as reproduced below with a hand-built fixture:
//   1. `filterToCoveredSegments` DROPS the R.10 scene (S3) from the array.
//   2. `snapCoveredBoundaries` then re-derives the S2|S4 boundary over the
//      now-adjacent survivors — S3's whole reserved gap is split between S2
//      and S4 (neighbour stretched).
//   3. R.14's ORDERING GUARD (`corrected < nextBoundary`) reads that
//      stretched S2|S4 boundary as "the next boundary", so the silence that
//      really sits in S3's reserved gap is now free for R.14 to re-anchor
//      S2's own START to (downstream shifted: S1 grows to 3.05s, S2 loses
//      its first 2.7s of speech).
//   Had S3 kept its slot, R.14's guard would have declined the move (its
//   corrected value would not precede S3's start), and neither neighbour
//   would have absorbed anything.
//
// Operator spec (binding), asserted one clause per `it`:
//   a. the skipped scene KEEPS a proportional slot as an Estimated placeholder;
//   b. a skip NEVER alters neighbouring scenes' timestamps (S2 stays where the
//      S1|S2 snap put it), and R.14 must not absorb the reserved gap;
//   c. downstream scenes anchor to their OWN audio matches.
//
// STAGE ORDER MIRRORS `App.tsx`'s FA arm exactly: R.10 gate →
// `filterToCoveredSegments` → `snapCoveredBoundaries` → `headExtendFirstSegment`
// → placeholders → R.14/R.15 (R.11–R.13 need a chunk plan and are disjoint
// from this shape; they run on the survivor array unchanged, see App.tsx).
// The Model P partition invariant (`gaplessInvariant.test.ts`, plan-v3 item
// 11) is re-asserted here on the placeholder-carrying array.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { filterToCoveredSegments, buildSkipLogEntries } from '../App';
import { snapCoveredBoundaries } from './snapBoundaries';
import { headExtendFirstSegment } from './syncEngine';
import { applyUnspokenScriptGate, R10_SKIP_REASON } from './faUnspokenGate';
import type { UnspokenScriptFinding } from './faUnspokenGate';
import { detectAnchorTrustDefects, applyAnchorTrustCorrections } from './faAnchorTrustGate';
import { insertSkippedScenePlaceholders, stampEstimatedWordTimings } from './skippedScenePlaceholders';
import { findPartitionViolations } from './timelinePartition';
import type { SegmentAlignment } from './whisperService';
import type { SilenceInterval } from './silenceDetector';
import type { TranscriptToken, VideoSegment } from '../types';

const AUDIO_DURATION = 9.0;

const seg = (id: string, text: string, startTime: number, duration: number): VideoSegment =>
  ({ id, tag: id, text, startTime, duration, anchorStart: startTime, transition: 'none', animation: 'none' }) as unknown as VideoSegment;

const tok = (text: string, startSec: number, endSec: number, confidence: number, wordIndex: number): TranscriptToken =>
  ({ text, startSec, endSec, confidence, wordIndex });

const sil = (startSec: number, endSec: number): SilenceInterval => ({ startSec, endSec });

const align = (firstTokenIdx: number, lastTokenIdx: number, totalWords: number): SegmentAlignment => ({
  firstTokenIdx, lastTokenIdx, matched: true, confidence: 1, matchedWords: totalWords, totalWords, longestRun: totalWords,
  audioRegion: { startSec: 0, endSec: 0 },
} as unknown as SegmentAlignment);

/**
 * Five scripted scenes; S3 is on-screen-only text the voice never reads.
 * FA (a CTC objective, no drop path) still had to place S3's four words —
 * it crammed them into 3.20–3.28s at confidence 1e-4, between S2's real
 * last word (ends 2.90) and S4's real first word (starts 5.00).
 *
 * The R.14 trigger on S1|S2 is deliberate and matches the operator's log:
 * S2's every word is sub-reliability smear (conf 0.03 < CONF_MIN_FALLBACK)
 * and its first word starts 10 ms after S1's last, so R.14's three
 * conjuncts hold; the first silence whose midpoint follows the S1|S2 cut
 * is A (2.90–3.20, midpoint 3.05) — the silence INSIDE S3's reserved gap.
 */
function fixture() {
  const tokens: TranscriptToken[] = [
    // S1 — spoken, certain.
    tok('Opening', 0.00, 0.12, 0.9, 0), tok('title', 0.12, 0.22, 0.9, 1), tok('card', 0.22, 0.30, 0.9, 2),
    // S2 — spoken, but every posterior collapsed (the R.14 shape).
    tok('we', 0.31, 0.60, 0.03, 3), tok('begin', 0.60, 1.20, 0.03, 4), tok('our', 1.20, 1.80, 0.03, 5),
    tok('story', 1.80, 2.40, 0.03, 6), tok('now', 2.40, 2.90, 0.03, 7),
    // S3 — NEVER spoken. FA phantoms.
    tok('never', 3.20, 3.22, 1e-4, 8), tok('spoken', 3.22, 3.24, 1e-4, 9),
    tok('phantom', 3.24, 3.26, 1e-4, 10), tok('text', 3.26, 3.28, 1e-4, 11),
    // S4 — spoken, certain.
    tok('the', 5.00, 5.20, 0.9, 12), tok('story', 5.20, 5.50, 0.9, 13),
    tok('continues', 5.50, 6.00, 0.9, 14), tok('here', 6.00, 6.30, 0.9, 15),
    // S5 — spoken, certain.
    tok('and', 6.80, 7.00, 0.9, 16), tok('finally', 7.00, 7.40, 0.9, 17),
    tok('we', 7.40, 7.60, 0.9, 18), tok('end', 7.60, 8.00, 0.9, 19),
  ];
  // A sits in S3's reserved gap (S2's speech ends 2.90); B is the long
  // pause before S4; C is the real S4|S5 seam.
  const silences: SilenceInterval[] = [sil(2.90, 3.20), sil(3.30, 4.90), sil(6.30, 6.80)];
  // `aligned.segments` — the aligner's own pre-skip layout.
  const segments: VideoSegment[] = [
    seg('s1', 'Opening title card', 0.00, 0.30),
    seg('s2', 'we begin our story now', 0.30, 2.90),
    seg('s3', 'never spoken phantom text', 3.20, 1.80),
    seg('s4', 'the story continues here', 5.00, 1.80),
    seg('s5', 'and finally we end', 6.80, 2.20),
  ];
  // The FA-arm text-matcher coverage — every scene "matches" by construction.
  const coverage: SegmentAlignment[] = [align(0, 2, 3), align(3, 7, 5), align(8, 11, 4), align(12, 15, 4), align(16, 19, 4)];
  const unspoken: UnspokenScriptFinding[] = [
    { segmentIndex: 2, segmentId: 's3', segmentTag: 's3', maxWordConfidence: 1e-4, faWordCount: 4 },
  ];
  return { tokens, silences, segments, coverage, unspoken };
}

/** App.tsx's FA-arm stage order, up to and including R.14/R.15. */
function runPipeline(f: ReturnType<typeof fixture>, opts: { skipS3: boolean }) {
  const coverageAfterR10 = opts.skipS3 ? applyUnspokenScriptGate(f.coverage, f.unspoken) : f.coverage;
  const { kept, skipped, keptAlignments } = filterToCoveredSegments(
    f.segments, coverageAfterR10, new Set(opts.skipS3 ? f.unspoken.map(u => u.segmentIndex) : []),
  );
  let committed = snapCoveredBoundaries(kept, keptAlignments, f.tokens, f.silences, AUDIO_DURATION);
  committed = headExtendFirstSegment(committed);
  // FIX 1 — placeholders go in AFTER the survivor layout and BEFORE R.14.
  const skippedIndices = new Set(skipped.map(r => r.segmentIndex));
  const insertion = insertSkippedScenePlaceholders(
    committed, keptAlignments, f.segments, skippedIndices, coverageAfterR10, f.tokens, AUDIO_DURATION,
  );
  committed = insertion.segments;
  const alignments: SegmentAlignment[] = insertion.alignments;
  const preR14 = committed.map(s => ({ ...s }));
  const findings = detectAnchorTrustDefects(committed, alignments, f.tokens, f.silences);
  committed = applyAnchorTrustCorrections(committed, findings);
  const faWordTimings = stampEstimatedWordTimings(f.tokens, insertion.placeholders, f.coverage, f.tokens);
  return { committed, preR14, skipped, findings, alignments, insertion, faWordTimings };
}

const byId = (arr: readonly VideoSegment[], id: string) => arr.find(s => s.id === id);
const endOf = (s: VideoSegment) => Number((s.startTime + s.duration).toFixed(3));

describe('FIX 1 — R.10 skip keeps its slot and cannot cascade into R.14', () => {
  it('the R.10 skip finding itself is unchanged: S3 is skipped with the R.10 reason', () => {
    const run = runPipeline(fixture(), { skipS3: true });
    expect(run.skipped).toHaveLength(1);
    expect(run.skipped[0]!.segmentIndex).toBe(2);
    expect(run.skipped[0]!.reason).toBe(R10_SKIP_REASON);
  });

  it('(a) the skipped scene stays in the sequence as a placeholder with estimated bounds', () => {
    const run = runPipeline(fixture(), { skipS3: true });
    expect(run.committed.map(s => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    const s3 = byId(run.committed, 's3')!;
    // Its slot is the reserved gap between S2's last spoken word (2.90) and
    // S4's first spoken word (5.00) — the audio no real scene's words occupy.
    expect(s3.startTime).toBe(2.9);
    expect(endOf(s3)).toBe(5.0);
    expect(s3.anchorSource).toBe('estimate');
  });

  it('(b) neighbour timestamps are byte-identical with and without the skip; R.14 does not absorb the reserved gap', () => {
    const withSkip = runPipeline(fixture(), { skipS3: true });
    const control = runPipeline(fixture(), { skipS3: false });
    // S1 and S2 START exactly where they start when S3 is kept.
    expect(byId(withSkip.committed, 's1')!.startTime).toBe(byId(control.committed, 's1')!.startTime);
    expect(byId(withSkip.committed, 's2')!.startTime).toBe(byId(control.committed, 's2')!.startTime);
    expect(byId(withSkip.committed, 's2')!.startTime).toBe(0.305);
    // S2 ends at its own last spoken word — it absorbed nothing of S3's gap.
    expect(endOf(byId(withSkip.committed, 's2')!)).toBe(2.9);
    // R.14 fired on nothing: with S3's slot reserved, silence A (3.05) is
    // not before "the next boundary", so the ordering guard declines.
    expect(withSkip.findings).toEqual([]);
    // And the pre-R.14 array already had S2 where it belongs.
    expect(byId(withSkip.preR14, 's2')!.startTime).toBe(0.305);
  });

  it('(c) downstream scenes anchor to their own audio matches, not to the skip', () => {
    const withSkip = runPipeline(fixture(), { skipS3: true });
    const control = runPipeline(fixture(), { skipS3: false });
    // S4 starts at its own first spoken word — nothing cascaded from S2/S3.
    expect(byId(withSkip.committed, 's4')!.startTime).toBe(5.0);
    // S5's boundary is the S4|S5 seam (silence C midpoint) in BOTH runs.
    expect(byId(withSkip.committed, 's5')!.startTime).toBe(6.55);
    expect(byId(withSkip.committed, 's5')!.startTime).toBe(byId(control.committed, 's5')!.startTime);
  });

  it('item 11 — the placeholder-carrying array is still a Model P gapless partition of the audio', () => {
    const run = runPipeline(fixture(), { skipS3: true });
    expect(findPartitionViolations(run.committed)).toEqual([]);
    expect(run.committed[0]!.startTime).toBe(0);
    expect(endOf(run.committed[run.committed.length - 1]!)).toBe(AUDIO_DURATION);
    for (const s of run.committed) expect(s.duration).toBeGreaterThan(0);
  });

  it('(a) the skipped scene\'s words are re-timed across its slot and flagged Estimated (needsReview)', () => {
    const run = runPipeline(fixture(), { skipS3: true });
    expect(run.insertion.placeholders).toEqual([
      expect.objectContaining({ segmentIndex: 2, segmentId: 's3', slotStartSec: 2.9, slotEndSec: 5.0, estimatedWordCount: 4 }),
    ]);
    expect(run.insertion.unplaceable).toEqual([]);
    const s3Words = run.faWordTimings.filter(t => t.wordIndex! >= 8 && t.wordIndex! <= 11);
    expect(s3Words).toHaveLength(4);
    for (const w of s3Words) expect(w.needsReview).toBe(true);
    expect(s3Words[0]!.startSec).toBe(2.9);
    expect(s3Words[3]!.endSec).toBe(5.0);
    for (let i = 1; i < s3Words.length; i++) expect(s3Words[i]!.startSec).toBe(s3Words[i - 1]!.endSec);
    // Every other word is carried through untouched, by reference.
    const others = run.faWordTimings.filter(t => t.wordIndex! < 8 || t.wordIndex! > 11);
    expect(others.every(t => t.needsReview === undefined)).toBe(true);
    expect(others.length).toBe(16);
    // And the rule-stage token array itself was never mutated.
    expect(fixture().tokens[8]!.startSec).toBe(3.2);
  });

  it('the placeholder\'s alignment is the -1 sentinel, so index-parallel consumers skip its boundaries', () => {
    const run = runPipeline(fixture(), { skipS3: true });
    expect(run.alignments).toHaveLength(run.committed.length);
    expect(run.alignments[2]!.matched).toBe(false);
    expect(run.alignments[2]!.firstTokenIdx).toBe(-1);
    expect(run.alignments[2]!.lastTokenIdx).toBe(-1);
    // Survivors keep their own alignments in the new index space.
    expect(run.alignments[1]!.lastTokenIdx).toBe(7);
    expect(run.alignments[3]!.firstTokenIdx).toBe(12);
  });
});

describe('insertSkippedScenePlaceholders — shapes beyond the operator\'s', () => {
  it('a skipped FIRST scene takes [0, right\'s first word); the survivor starts at its own onset', () => {
    const f = fixture();
    const unspoken = [{ segmentIndex: 0, segmentId: 's1', maxWordConfidence: 1e-4, faWordCount: 3 }];
    const cov = applyUnspokenScriptGate(f.coverage, unspoken);
    const { kept, keptAlignments } = filterToCoveredSegments(f.segments, cov, new Set([0]));
    const snapped = headExtendFirstSegment(snapCoveredBoundaries(kept, keptAlignments, f.tokens, f.silences, AUDIO_DURATION));
    const ins = insertSkippedScenePlaceholders(snapped, keptAlignments, f.segments, new Set([0]), cov, f.tokens, AUDIO_DURATION);
    expect(ins.segments.map(s => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(ins.segments[0]!.startTime).toBe(0);
    expect(endOf(ins.segments[0]!)).toBe(0.31);
    expect(ins.segments[1]!.startTime).toBe(0.31);
    expect(findPartitionViolations(ins.segments)).toEqual([]);
  });

  it('a skipped LAST scene takes [left\'s last word, audioDuration]', () => {
    const f = fixture();
    const unspoken = [{ segmentIndex: 4, segmentId: 's5', maxWordConfidence: 1e-4, faWordCount: 4 }];
    const cov = applyUnspokenScriptGate(f.coverage, unspoken);
    const { kept, keptAlignments } = filterToCoveredSegments(f.segments, cov, new Set([4]));
    const snapped = headExtendFirstSegment(snapCoveredBoundaries(kept, keptAlignments, f.tokens, f.silences, AUDIO_DURATION));
    const ins = insertSkippedScenePlaceholders(snapped, keptAlignments, f.segments, new Set([4]), cov, f.tokens, AUDIO_DURATION);
    expect(ins.segments.map(s => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    const s5 = ins.segments[4]!;
    expect(s5.startTime).toBe(6.3);
    expect(endOf(s5)).toBe(AUDIO_DURATION);
    expect(endOf(ins.segments[3]!)).toBe(6.3);
    expect(findPartitionViolations(ins.segments)).toEqual([]);
  });

  it('two CONSECUTIVE skipped scenes split the reserved gap in proportion to script length', () => {
    const f = fixture();
    // Make S3 and S4 both unspoken; S4's text is twice S3's length.
    f.segments[3] = seg('s4', 'x'.repeat(50), 5.0, 1.8);
    f.segments[2] = seg('s3', 'y'.repeat(25), 3.2, 1.8);
    const skippedSet = new Set([2, 3]);
    const cov = applyUnspokenScriptGate(f.coverage, [
      { segmentIndex: 2, segmentId: 's3', maxWordConfidence: 1e-4, faWordCount: 4 },
      { segmentIndex: 3, segmentId: 's4', maxWordConfidence: 1e-4, faWordCount: 4 },
    ]);
    const { kept, keptAlignments } = filterToCoveredSegments(f.segments, cov, skippedSet);
    const snapped = headExtendFirstSegment(snapCoveredBoundaries(kept, keptAlignments, f.tokens, f.silences, AUDIO_DURATION));
    const ins = insertSkippedScenePlaceholders(snapped, keptAlignments, f.segments, skippedSet, cov, f.tokens, AUDIO_DURATION);
    expect(ins.segments.map(s => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    // Reserved gap: S2's last word (2.90) → S5's first word (6.80) = 3.90s.
    const s3 = ins.segments[2]!, s4 = ins.segments[3]!;
    expect(s3.startTime).toBe(2.9);
    expect(endOf(s4)).toBe(6.8);
    expect(s3.duration).toBe(1.3);
    expect(s4.duration).toBe(2.6);
    expect(ins.segments[4]!.startTime).toBe(6.8);
    expect(findPartitionViolations(ins.segments)).toEqual([]);
  });

  it('a degenerate gap (neighbours\' words touch) still yields a MIN-width slot, never a drop', () => {
    const f = fixture();
    // Move S4's first word right up against S2's last word.
    f.tokens[12] = tok('the', 2.9, 3.1, 0.9, 12);
    const unspoken = [{ segmentIndex: 2, segmentId: 's3', maxWordConfidence: 1e-4, faWordCount: 4 }];
    const cov = applyUnspokenScriptGate(f.coverage, unspoken);
    const { kept, keptAlignments } = filterToCoveredSegments(f.segments, cov, new Set([2]));
    const snapped = headExtendFirstSegment(snapCoveredBoundaries(kept, keptAlignments, f.tokens, f.silences, AUDIO_DURATION));
    const ins = insertSkippedScenePlaceholders(snapped, keptAlignments, f.segments, new Set([2]), cov, f.tokens, AUDIO_DURATION);
    expect(ins.unplaceable).toEqual([]);
    const s3 = ins.segments[2]!;
    expect(s3.id).toBe('s3');
    expect(s3.duration).toBe(0.1);
    expect(findPartitionViolations(ins.segments)).toEqual([]);
  });

  it('never mutates its inputs', () => {
    const f = fixture();
    const cov = applyUnspokenScriptGate(f.coverage, f.unspoken);
    const { kept, keptAlignments } = filterToCoveredSegments(f.segments, cov, new Set([2]));
    const snapped = headExtendFirstSegment(snapCoveredBoundaries(kept, keptAlignments, f.tokens, f.silences, AUDIO_DURATION));
    const frozen = JSON.stringify({ snapped, keptAlignments, segments: f.segments, tokens: f.tokens });
    insertSkippedScenePlaceholders(snapped, keptAlignments, f.segments, new Set([2]), cov, f.tokens, AUDIO_DURATION);
    expect(JSON.stringify({ snapped, keptAlignments, segments: f.segments, tokens: f.tokens })).toBe(frozen);
  });

  it('the [SKIP] entry keeps the R.10 finding, names the slot, and links to the placeholder — not an absorbing clip', () => {
    const run = runPipeline(fixture(), { skipS3: true });
    const byIndex = new Map(run.insertion.placeholders.map(p => [p.segmentIndex, p]));
    const [entry] = buildSkipLogEntries('run', run.skipped, 0, undefined, byIndex);
    expect(entry!.type).toBe('skip');
    expect(entry!.reason).toBe(R10_SKIP_REASON);
    expect(entry!.message).toContain('S3 skipped — scripted text never spoken.');
    expect(entry!.message).toContain('Kept as an Estimated placeholder 2.900s → 2.100s → 5.000s; neighbours untouched (4 words marked Estimated).');
    expect(entry!.message).not.toContain('Absorbed');
    expect(entry!.message).not.toContain('Clip');
    expect(entry!.segmentId).toBe('s3');
    expect(entry!.absorbedByDisplayIndex).toBeUndefined();
    expect(entry!.ruleDetail).toEqual(expect.objectContaining({ spanStartSec: 2.9, spanEndSec: 5.0 }));
  });
});
