/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// R.10 — SCRIPTED TEXT NEVER SPOKEN.
//
// BOTH SIDES (ruling R-AO): SINGLE-SIDED, BECAUSE the outcome is a DROP, not a
// boundary move — an absence has no two edges to constrain. What would be the
// "other side" is the surviving neighbour's boundary, and that is deliberately
// NOT this rule's: `snapCoveredBoundaries` re-derives it from the survivor's
// own spoken edges after the drop, which is the whole reason the drop is safe.
// Both halves of that claim are tested — the drop itself and the survivor's
// re-derived boundary — in `faUnspokenGate.test.ts`.
//
// The mirror image of R.5. R.5 covers real audio the script does not account
// for (absorbed by excising it from the chunk window). This covers the
// opposite: script words with no matching audio at all — an on-screen-only
// title, a planted test string never voiced.
//
// WHY FORCED ALIGNMENT CANNOT DO THIS ITSELF. A CTC objective is REQUIRED to
// place every target token somewhere. There is no drop path: unspoken scripted
// words are carved out of whichever real speech happens to be adjacent, at
// near-zero acoustic confidence, and they steal that speech's own onset. So the
// fix is a drop/skip gate LAYERED ON FA's OUTPUT, never a change to the
// alignment computation — which is also why this module runs AFTER inference and
// touches neither `faChunkPlan.ts` nor the qi contract.
//
// THE SIGNAL, MEASURED (WS1 Sessions C, D and E; 649 boundaries, three corpora):
//
//     matched === false                              (1) Whisper REFUSED it
//   ∧ max(faWord.confidence) < R10_MAX_WORD_CONF     (2) FA had no acoustic support
//   ∧ faWordCount >= R10_MIN_WORD_COUNT              (3) not a single-word segment
//
// 2/2 true positives, 0 false positives, an 850x separation gap. Each conjunct
// alone over-fires: (1) alone fires 8 times, (2) alone 8 times.
//
// (1) IS THE LOAD-BEARING ONE, and it is what makes this rule conservative
// rather than clever: R.10's firing set is a SUBSET of the segments the
// Whisper path — the shipped default, FA gate off — already drops. R.10 can
// therefore never remove a scene that ships today; it removes a DIVERGENCE that
// appears only when FA is on. That subset property is also the whole
// locked-segment answer: any lock R.10 costs a user is a lock the default
// pipeline already costs them for the identical segment.
//
// `alignConfidence` IS DELIBERATELY NOT USED. It is TEXT-match confidence
// (did every script word find a token?) and is blind to this failure by
// construction — every never-spoken segment scores a perfect text match against
// the tokens FA was forced to invent for it. Ruling R-Z reopened the signal on
// two `alignConfidence` figures (0.769 / 0.778) that measurement showed do not
// exist; the fix was to delete the conjunct, not re-threshold it.
//
// WHAT A DETECTED SEGMENT BECOMES. It is dropped, by being handed to the
// EXISTING skip path (`App.tsx`'s `filterToCoveredSegments`): the following
// survivor's start is re-derived by `snapCoveredBoundaries` from its own spoken
// edges, so the preceding neighbour simply absorbs the span. Model P stays a
// gapless partition and Sigma stays audioDuration — measured, not assumed. A
// drop at index 0 is head-extended back to 0 by `headExtendFirstSegment`, which
// is exactly what ear-pass item 10 asks for.
// ---------------------------------------------------------------------------

import { filterMalformedTokens, alignScenestoTranscript } from './whisperService';
import { R10_MAX_WORD_CONF, R10_MIN_WORD_COUNT } from './syncConstants';
import type { SegmentAlignment } from './whisperService';
import type { SilenceInterval } from './silenceDetector';
import type { TranscriptToken, VideoSegment } from '../types';

/** The skip reason an R.10 drop carries into the sync log. Distinct from the
 *  plain 'no audio match' so a user reading the log can tell "the audio never
 *  said this" from "the aligner could not find it". */
export const R10_SKIP_REASON = 'scripted text never spoken';

/** One segment R.10 refuses to commit, with the two numbers that decided it. */
export interface UnspokenScriptFinding {
  /** Index into the PRE-filter segments array — the same indexing
   *  `SkippedSegmentRecord.segmentIndex` uses, so a finding and a skip record
   *  name the same scene. */
  segmentIndex: number;
  segmentId: string;
  segmentTag?: string;
  /** The loudest FA word inside the segment's span. Below `R10_MAX_WORD_CONF`
   *  by definition; recorded so a log reader sees how far below. */
  maxWordConfidence: number;
  faWordCount: number;
}

/**
 * R.10's detector. Pure — no React, no DOM, no IPC.
 *
 * `faTokens` must be the FORCED-ALIGNMENT tokens (`faWordSpansToTranscriptTokens`
 * output), which carry a real per-word `confidence`. A Whisper token has none,
 * and a token without one is treated as UNUSABLE EVIDENCE, never as zero — a
 * segment whose words carry no confidence at all can never fire. That is the
 * difference between this gate declining to act and this gate deleting a
 * corpus, and it is asserted in the tests.
 *
 * `alignments` must be the WHISPER-token alignment, index-parallel to
 * `segments` — NOT the FA-token one. Under FA tokens every segment matches by
 * construction (that is the defect), so conjunct (1) read off the FA alignment
 * would be constant-false and the rule would never fire.
 */
export function detectUnspokenScriptSegments(
  segments: readonly VideoSegment[],
  alignments: readonly SegmentAlignment[],
  faTokens: readonly TranscriptToken[],
): UnspokenScriptFinding[] {
  const findings: UnspokenScriptFinding[] = [];
  for (let i = 0; i < segments.length; i++) {
    // (1) Whisper refused it. Checked first: it is the cheapest term and the
    //     one that keeps the firing set inside the default path's own drops.
    if (alignments[i]?.matched !== false) continue;

    const seg = segments[i]!;
    const segStart = seg.startTime;
    const segEnd = seg.startTime + seg.duration;

    let count = 0;
    let maxConfidence = Number.NEGATIVE_INFINITY;
    for (const tok of faTokens) {
      if (tok.startSec < segStart - 1e-9 || tok.endSec > segEnd + 1e-9) continue;
      // No confidence means no evidence — the token is not counted at all,
      // so it can neither raise nor lower the verdict.
      if (typeof tok.confidence !== 'number' || !Number.isFinite(tok.confidence)) continue;
      count++;
      if (tok.confidence > maxConfidence) maxConfidence = tok.confidence;
    }

    // (3) not a single-word segment
    if (count < R10_MIN_WORD_COUNT) continue;
    // (2) FA had no acoustic support anywhere in the span
    if (maxConfidence >= R10_MAX_WORD_CONF) continue;

    findings.push({
      segmentIndex: i,
      segmentId: seg.id,
      segmentTag: seg.tag || undefined,
      maxWordConfidence: maxConfidence,
      faWordCount: count,
    });
  }
  return findings;
}

/**
 * The convenience form the orchestrator calls: derives the Whisper alignment
 * itself, mirroring `useWhisper.ts`'s `alignFromCache` exactly
 * (`filterMalformedTokens` first, once, then `alignScenestoTranscript` against
 * the filtered array with the same silences and duration), so conjunct (1) is
 * the same `matched` the Whisper path would itself have computed for these
 * segments.
 *
 * `alignScenestoTranscript` rather than the cheaper `extractSegmentAlignments`
 * on purpose: it includes the per-segment rescue passes, so a segment the
 * rescue recovers is `matched: true` and can never fire. Measured to agree with
 * `extractSegmentAlignments` on all 649 committed boundaries — the safer of two
 * identical answers.
 */
export function detectUnspokenScriptSegmentsFromWhisper(
  segments: readonly VideoSegment[],
  whisperTokens: readonly TranscriptToken[],
  faTokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
): UnspokenScriptFinding[] {
  if (segments.length === 0 || faTokens.length === 0 || whisperTokens.length === 0) return [];
  const usable = filterMalformedTokens([...whisperTokens], audioDuration).tokens;
  if (usable.length === 0) return [];
  const alignments = alignScenestoTranscript([...segments], usable, [...silences], audioDuration);
  return detectUnspokenScriptSegments(segments, alignments, faTokens);
}

/**
 * Applies the findings to the coverage array by forcing `matched: false`, which
 * is the ONLY thing this rule does to the pipeline — everything after it is the
 * skip path that already exists and is already exercised on every Whisper run.
 *
 * Immutable: returns a new array (or the same reference when there is nothing
 * to do), never mutates its input — `history.ts` stores whole-project snapshots
 * and every writer upstream of it has to be immutable (CLAUDE.md).
 *
 * The flagged entry's `firstTokenIdx`/`lastTokenIdx` are reset to the -1
 * sentinel and `audioRegion` is cleared, so nothing downstream can read token
 * indices belonging to a segment that is no longer on the timeline.
 * `matchedWords`/`confidence` are left as measured — they are what the sync log
 * displays, and blanking them would hide why the segment was dropped.
 */
export function applyUnspokenScriptGate(
  coverage: readonly SegmentAlignment[],
  findings: readonly UnspokenScriptFinding[],
): SegmentAlignment[] {
  if (findings.length === 0) return coverage as SegmentAlignment[];
  const flagged = new Set(findings.map(f => f.segmentIndex));
  return coverage.map((a, i) => {
    if (!flagged.has(i)) return a;
    const { audioRegion: _audioRegion, recoveredRegion: _recoveredRegion, recoveredVia: _recoveredVia, ...rest } = a;
    return { ...rest, matched: false, firstTokenIdx: -1, lastTokenIdx: -1 };
  });
}
