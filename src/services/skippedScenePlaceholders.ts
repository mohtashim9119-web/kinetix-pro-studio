/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 1 hotfix, FIX 1 — SKIPPED-SCENE PLACEHOLDERS (FA arm).
//
// WHAT WAS WRONG. An R.10 skip (`faUnspokenGate.ts`) handed the scene to the
// drop path: `filterToCoveredSegments` removed it, `snapCoveredBoundaries`
// re-derived the boundary between its two SURVIVING neighbours, and the
// skipped scene's whole reserved gap was split between them. That boundary
// was then what R.14's ordering guard (`faAnchorTrustGate.ts`) read as "the
// next boundary" — so a silence that really sits inside the skipped scene's
// gap became a legal re-anchor target for the PRECEDING scene's own start.
// Operator log: "[SKIP] S3 skipped — scripted text never spoken" →
// "[RULE] R.14 moved scene 2 from 0.304s to 3.05s". Reproduced in
// `skippedScenePlaceholders.test.ts`.
//
// OPERATOR SPEC (binding):
//   a. a skipped scene KEEPS a proportional slot as an Estimated placeholder
//      — never deleted from the sequence;
//   b. a skip NEVER alters neighbouring scenes' timestamps; R.14 must not
//      absorb the reserved gap;
//   c. downstream scenes anchor to their own audio matches.
//
// HOW. `snapCoveredBoundaries` is NOT changed — it is the golden replay's
// stopping line (CLAUDE.md §5) and its survivor-pair arithmetic is exactly
// what still fixes every boundary between two SPOKEN scenes. This module
// runs AFTER the survivor layout and BEFORE R.14/R.15 in `App.tsx`, and
// re-inserts each skipped scene into the gap its neighbours' own words
// leave open:
//
//     reserved gap = [ left survivor's LAST spoken word end,
//                      right survivor's FIRST spoken word start ]
//
// The left survivor ends at its own last word; the right survivor starts at
// its own first word (spec c); the placeholder(s) take everything between,
// split among consecutive skipped scenes in proportion to their script
// length (spec a). No survivor's START moves unless it is the right
// neighbour of a placeholder — and that start is its own onset, not a value
// cascaded from anything (spec b/c).
//
// The placeholder's alignment entry is the R.10-gated one (-1 sentinels), so
// every index-parallel consumer downstream — R.14/R.15, the boundary-quality
// checker, the residual-ordering detector — skips the boundaries on either
// side of it by their existing sentinel guards. R.14's ordering guard now
// sees the placeholder's own start as `nextBoundary`, which is what stops
// the operator's cascade.
//
// ESTIMATED WORDS (spec a, item-6 pattern). The skipped scene's FA phantom
// tokens are re-timed across the slot in proportion to word length and
// flagged `needsReview: true` — the same flag `faInfeasibleFinding.ts`'s
// consumers read for CTC-infeasible chunks — so the persisted
// `faWordTimings` never carries a phantom timestamp as if it were measured.
//
// DEGENERATE GAPS. When two spoken neighbours run into each other (the
// reserved gap is narrower than one MIN_SEGMENT_DURATION per placeholder),
// the slot is widened to that minimum around the survivors' snapped
// boundary, clamped so neither neighbour drops below MIN_SEGMENT_DURATION.
// A group that cannot be given even that stays dropped and is reported in
// `unplaceable` — never silently.
// ---------------------------------------------------------------------------

import type { SegmentAlignment } from './whisperService';
import type { TranscriptToken, VideoSegment } from '../types';

const round3 = (v: number): number => Number(v.toFixed(3));

/** The ENGINE floor — `snapBoundaries.ts`'s own 0.1s copy, not App.tsx/
 *  Timeline.tsx's 0.3s display floor (see `syncConstants.ts`'s KNOWN
 *  DIVERGENCE note). A placeholder is a computed span like any other. */
const MIN_SEGMENT_DURATION = 0.1;

export interface SkippedScenePlaceholder {
  /** Index into the PRE-filter segments array (same space as
   *  `SkippedSegmentRecord.segmentIndex`). */
  segmentIndex: number;
  segmentId: string;
  segmentTag?: string;
  slotStartSec: number;
  slotEndSec: number;
  /** How many of this scene's FA words were re-timed and flagged Estimated. */
  estimatedWordCount: number;
}

export interface PlaceholderInsertion {
  /** The committed array with every placeable skipped scene re-inserted at
   *  its script position. Model P: gapless, Σ duration unchanged. */
  segments: VideoSegment[];
  /** Index-parallel with `segments`. Placeholders carry their gated
   *  alignment (matched: false, -1 sentinels). */
  alignments: SegmentAlignment[];
  placeholders: SkippedScenePlaceholder[];
  /** Skipped scenes that could not be given a slot (both neighbours already
   *  at MIN_SEGMENT_DURATION). Stay dropped, reported for the log. */
  unplaceable: number[];
}

/**
 * Re-inserts skipped scenes as Estimated placeholders. Pure — never mutates
 * its inputs.
 *
 * `committed`/`committedAlignments` are the survivor array after
 * `snapCoveredBoundaries` + `headExtendFirstSegment` (+ R.11–R.13), index-
 * parallel. `preFilterSegments` is `aligned.segments` (script order, every
 * scene). `coverage` is the POST-R.10-gate coverage array in pre-filter
 * index space — the placeholder's own alignment entry comes from it.
 * `tokens` is the SAME filtered token array `committedAlignments` index.
 */
export function insertSkippedScenePlaceholders(
  committed: readonly VideoSegment[],
  committedAlignments: readonly SegmentAlignment[],
  preFilterSegments: readonly VideoSegment[],
  skippedIndices: ReadonlySet<number>,
  coverage: readonly SegmentAlignment[],
  tokens: readonly TranscriptToken[],
  audioDuration: number,
): PlaceholderInsertion {
  const noop: PlaceholderInsertion = {
    segments: committed as VideoSegment[], alignments: committedAlignments as SegmentAlignment[],
    placeholders: [], unplaceable: [],
  };
  if (skippedIndices.size === 0 || committed.length !== committedAlignments.length) return noop;

  const committedPos = new Map<string, number>();
  committed.forEach((s, i) => committedPos.set(s.id, i));

  // Working copies — every write below goes to these, never to the inputs.
  const out: VideoSegment[] = committed.map(s => ({ ...s }));
  const outAlign: SegmentAlignment[] = [...committedAlignments];
  const placeholders: SkippedScenePlaceholder[] = [];
  const unplaceable: number[] = [];

  // Insertions are collected as (afterCommittedIndex, group) and spliced
  // from the back so committed indices stay valid while we work.
  interface Group { afterIdx: number; members: number[] }
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastSurvivorIdx = -1;
  for (let i = 0; i < preFilterSegments.length; i++) {
    const seg = preFilterSegments[i]!;
    if (skippedIndices.has(i)) {
      if (!current) { current = { afterIdx: lastSurvivorIdx, members: [] }; groups.push(current); }
      current.members.push(i);
      continue;
    }
    const pos = committedPos.get(seg.id);
    if (pos === undefined) continue; // dropped for a reason other than skip — leave it
    lastSurvivorIdx = pos;
    current = null;
  }

  for (let g = groups.length - 1; g >= 0; g--) {
    const { afterIdx, members } = groups[g]!;
    const left = afterIdx >= 0 ? out[afterIdx] : undefined;
    const right = afterIdx + 1 < out.length ? out[afterIdx + 1] : undefined;
    const leftAlign = afterIdx >= 0 ? outAlign[afterIdx] : undefined;
    const rightAlign = afterIdx + 1 < out.length ? outAlign[afterIdx + 1] : undefined;

    // A locked neighbour is authoritative (same contract as snapCoveredBoundaries).
    if (left?.locked || right?.locked) { unplaceable.push(...members); continue; }

    // The reserved gap: the neighbours' own spoken edges.
    const leftEnd = left ? round3(left.startTime + left.duration) : 0;
    const leftSpokenEnd = left
      ? (leftAlign && leftAlign.lastTokenIdx >= 0 ? tokens[leftAlign.lastTokenIdx]?.endSec : undefined) ?? leftEnd
      : 0;
    const rightSpokenStart = right
      ? (rightAlign && rightAlign.firstTokenIdx >= 0 ? tokens[rightAlign.firstTokenIdx]?.startSec : undefined) ?? right.startTime
      : audioDuration;

    // Hard bounds: neither neighbour may drop below MIN_SEGMENT_DURATION.
    const lo = left ? round3(left.startTime + MIN_SEGMENT_DURATION) : 0;
    const hi = right ? round3(right.startTime + right.duration - MIN_SEGMENT_DURATION) : audioDuration;
    const need = round3(members.length * MIN_SEGMENT_DURATION);
    if (hi - lo < need) { unplaceable.push(...members); continue; }

    let slotStart = round3(Math.max(lo, Math.min(leftSpokenEnd, hi)));
    let slotEnd = round3(Math.min(hi, Math.max(rightSpokenStart, lo)));
    if (slotEnd - slotStart < need) {
      // Degenerate: the neighbours' words run into each other. Widen around
      // the boundary the survivor layout already chose, inside the bounds.
      const centre = right ? right.startTime : (left ? leftEnd : audioDuration / 2);
      slotStart = round3(Math.max(lo, Math.min(centre - need / 2, hi - need)));
      slotEnd = round3(slotStart + need);
    }

    // Proportional split by script length (chars, floor 1 per scene).
    const weights = members.map(i => Math.max(1, (preFilterSegments[i]!.text ?? '').trim().length));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const span = slotEnd - slotStart;
    const inserted: VideoSegment[] = [];
    const insertedAlign: SegmentAlignment[] = [];
    let cursor = slotStart;
    members.forEach((i, k) => {
      const isLast = k === members.length - 1;
      const end = isLast ? slotEnd : round3(cursor + span * (weights[k]! / totalWeight));
      const src = preFilterSegments[i]!;
      inserted.push({
        ...src, startTime: cursor, duration: round3(end - cursor), anchorStart: cursor, anchorSource: 'estimate',
      });
      insertedAlign.push(coverage[i] ?? placeholderAlignment());
      placeholders.push({
        segmentIndex: i, segmentId: src.id, segmentTag: src.tag || undefined,
        slotStartSec: cursor, slotEndSec: end, estimatedWordCount: 0,
      });
      cursor = end;
    });

    // Neighbours: left ends at the slot's start, right begins at its end.
    if (left) out[afterIdx] = { ...left, duration: round3(slotStart - left.startTime) };
    if (right) {
      const rightEnd = round3(right.startTime + right.duration);
      out[afterIdx + 1] = { ...right, startTime: slotEnd, anchorStart: slotEnd, duration: round3(rightEnd - slotEnd) };
    }
    out.splice(afterIdx + 1, 0, ...inserted);
    outAlign.splice(afterIdx + 1, 0, ...insertedAlign);
  }

  // Report in script order regardless of the back-to-front splice order.
  placeholders.sort((a, b) => a.segmentIndex - b.segmentIndex);
  unplaceable.sort((a, b) => a - b);
  return { segments: out, alignments: outAlign, placeholders, unplaceable };
}

function placeholderAlignment(): SegmentAlignment {
  return {
    firstTokenIdx: -1, lastTokenIdx: -1, matched: false, confidence: 0, matchedWords: 0, totalWords: 0, longestRun: 0,
  } as SegmentAlignment;
}

/**
 * Re-times each placeholder scene's FA phantom tokens across its slot,
 * proportionally to word length, and flags them `needsReview: true`
 * (Estimated). Returns a NEW array for `Project.faWordTimings`; untouched
 * tokens are carried by reference.
 *
 * `preGateCoverage` is the coverage array BEFORE `applyUnspokenScriptGate`
 * reset the skipped scenes' token indices — the only place those indices
 * survive. Its indices address `filteredTokens`; `faWordTimings` may be the
 * unfiltered FA array, so the two are joined by token identity
 * (`filterMalformedTokens` keeps references) with `wordIndex` as the
 * fallback join key. Mutates each placeholder's `estimatedWordCount`.
 */
export function stampEstimatedWordTimings(
  faWordTimings: readonly TranscriptToken[],
  placeholders: SkippedScenePlaceholder[],
  preGateCoverage: readonly SegmentAlignment[],
  filteredTokens: readonly TranscriptToken[],
): TranscriptToken[] {
  if (placeholders.length === 0) return faWordTimings as TranscriptToken[];
  const replacement = new Map<TranscriptToken, TranscriptToken>();
  const replacementByWordIndex = new Map<number, TranscriptToken>();

  for (const p of placeholders) {
    const cov = preGateCoverage[p.segmentIndex];
    if (!cov || cov.firstTokenIdx < 0 || cov.lastTokenIdx < cov.firstTokenIdx) continue;
    const slice = filteredTokens.slice(cov.firstTokenIdx, cov.lastTokenIdx + 1);
    if (slice.length === 0) continue;
    const weights = slice.map(t => Math.max(1, t.text.length));
    const total = weights.reduce((a, b) => a + b, 0);
    const span = p.slotEndSec - p.slotStartSec;
    let cursor = p.slotStartSec;
    slice.forEach((t, k) => {
      const end = k === slice.length - 1 ? p.slotEndSec : round3(cursor + span * (weights[k]! / total));
      const retimed: TranscriptToken = { ...t, startSec: cursor, endSec: end, needsReview: true };
      replacement.set(t, retimed);
      if (typeof t.wordIndex === 'number') replacementByWordIndex.set(t.wordIndex, retimed);
      cursor = end;
    });
    p.estimatedWordCount = slice.length;
  }

  if (replacement.size === 0) return faWordTimings as TranscriptToken[];
  return faWordTimings.map(t =>
    replacement.get(t)
      ?? (typeof t.wordIndex === 'number' ? replacementByWordIndex.get(t.wordIndex) : undefined)
      ?? t,
  );
}
