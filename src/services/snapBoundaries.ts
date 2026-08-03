/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Covered-only boundary snap (middle-gap position-offset fix)
// ---------------------------------------------------------------------------
//
// WHY THIS EXISTS
//
// `alignScenestoTranscript`'s silence-snap step (whisperService.ts) runs on the
// FULL segment array, before the R4-1 skip-unmatched filter. For a boundary
// between a covered segment and an UNMATCHED one, the snap reads
// `tokens[curr.lastTokenIdx].endSec` / `tokens[next.firstTokenIdx].startSec` —
// but an unmatched segment's token indices are the -1 sentinel, so both lookups
// return `undefined` and fall back to the aligner's PLACEHOLDER anchors
// (`prevAnchor`, not a real spoken-word edge). That places the boundary using
// numbers that describe nothing in the audio, and the covered segment on the
// other side of it keeps that corrupted boundary after filtering.
//
// Measured: the same covered scene landed at 7.71s in a document whose
// neighbour was matched, and at 7.84s once two unmatched scenes were inserted
// next to it — a 0.13s drift caused purely by the presence of segments that
// never reach the timeline.
//
// THE FIX: re-run the snap AFTER `filterToCoveredSegments`, on the covered-only
// array. Every pair then has two matched segments, so every `lastTokenIdx` /
// `firstTokenIdx` is real (>= 0) and every boundary is computed from actual
// spoken-word edges. A segment that is skipped can no longer influence the
// position of one that is kept.
//
// This function SUBSUMES `retileCoveredSegments` (App.tsx) on the Whisper path:
// it sets each survivor's duration from the re-snapped boundary rather than
// re-deriving it from the next survivor's stale startTime. `retileCoveredSegments`
// remains the fallback for callers with no tokens/silences to snap against.
//
// The boundary math below is a faithful port of the reference implementation in
// `alignScenestoTranscript` — same search window, same closest-centre silence
// pick among a pair's own candidates, same monotonic check — so that on an
// all-covered project (nothing skipped) this function reproduces the aligner's
// boundaries exactly. Only the ARRAY it walks is different.
//
// PARITY UPDATE (2026-08-02): the "exactly" above used to carry a caveat —
// "whenever there is no cross-pair silence contention" — because
// `alignScenestoTranscript`'s own gap-fill still claimed silences first-come-
// first-served. That gap-fill has since been ported to use the SAME candidacy
// predicates (`fillsTokenGapWithinSpan`, `isBreathSilence`,
// `isBoundarySilenceCandidate`, all defined here) and the SAME
// contention-aware assignment this file uses (see whisperService.ts's
// gap-fill loop), so parity now holds under contention too — the fixture at
// `syncTiming.test.ts`'s "parity: a contested silence resolves identically…"
// test pins it. Two differences remain BY DESIGN, both defense-in-depth this
// function carries that the aligner's simpler full-array pass does not: the
// degenerate-pair guard below (an inverted pair beyond
// `DEGENERATE_PAIR_INVERSION_THRESHOLD_SEC` writes no boundary here, but
// still writes one there), and the monotonic-fallback re-check a few lines
// down (a still-backwards fallback midpoint clamps to `prevBoundary` here;
// the aligner's own monotonic check has no second-level re-check). Neither
// is reachable by ordinary, uncorrupted alignment data, so this does not
// threaten the parity claim above for any real project.
//
// SILENCE CLAIMING RULE (contention-aware assignment, 2026-07-30 fix; ported
// into `alignScenestoTranscript`'s own gap-fill 2026-08-02 — see the PARITY
// UPDATE note above): a silence is ASSIGNED, not claimed first-come-first-
// served. `alignScenestoTranscript`'s walk (and this function's own pre-fix
// version) used to resolve each boundary left-to-right, letting an EARLIER
// pair's search window claim any silence it could see — including one that
// overlapped only by reaching through the tail of its own window, past a
// short next segment, into what was really the
// FOLLOWING pair's own trailing pause. That pair, left with zero unused
// candidates, fell back to the token midpoint — which, if the earlier pair's
// stolen silence sat close enough to it, produced a duration at or near the
// MIN_SEGMENT_DURATION floor. Confirmed on a real 294-segment project via live
// [diag-align]/[diag-snap] instrumentation: token attribution was correct
// throughout — this was purely a claiming-order defect.
//
// The fix computes every pair's search window FIRST (Pass 1, from a snapshot
// of the original segment positions — the original per-pair loop read
// `curr.startTime`/`curr.duration` as `??` fallbacks while earlier iterations
// had already mutated them, which is only safe if every window is derived
// before any boundary is written), then assigns every silence to exactly the
// ONE pair whose spoken midpoint it sits closest to, among every pair whose
// window overlaps it (Pass 2). A silence overlapped by no window is unused,
// same as before. Only then does the left-to-right walk (Pass 3) run, reusing
// each pair's already-decided candidate list — the closest-centre pick among
// a pair's own candidates, the token-midpoint fallback when a pair has none,
// and the monotonic safety-net check are otherwise unchanged.
//
// INTRA-SEGMENT SILENCE REJECTION (2026-08-01 fix): overlapping a pair's search
// WINDOW is necessary but not sufficient for a silence to be a boundary
// candidate. The window can extend backwards past the current segment's own
// trailing spoken words — a near-zero spoken gap forces the fixed 1.0s radius,
// and `searchStart` is clamped only to `currFirstSpokenStart`, which sits
// before ANY mid-segment pause. A breath INSIDE the current segment's own
// speech therefore overlaps the window and can win the closest-centre pick,
// placing the boundary before that segment finished speaking and handing its
// trailing words to the next one. Confirmed live via the [snap-diag] pair log:
// a pair with lastSpokenEnd 18.87 chose the silence [18.32, 18.70] — entirely
// inside its own speech — producing boundary 18.51 and moving a whole trailing
// phrase downstream.
//
// The rule: a genuine boundary silence SPANS the gap between the two segments'
// speech. A silence that ENDS before `lastSpokenEnd` is separated from the
// boundary by the current segment's own speech, and a silence that STARTS after
// `nextSpokenStart` is separated from it by the next segment's — both are
// intra-segment pauses, not boundary pauses, and neither is a candidate at all.
//
// Both spoken edges were originally relaxed by BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC
// (syncConstants.ts) before that comparison, on the theory that Whisper word
// timestamps carry only ~±0.3s of error. REGRESSION FIX (2026-08-03): a real
// 173/174-segment production project, bisected against the pre-regression
// build (commit 0c83a06, which had no SPAN test at all — pure window
// overlap), showed trailing-word timestamps routinely blur into the
// following pause by considerably more than 0.3s — so this timestamp-distance
// test was rejecting genuine boundary silences wholesale (every such pair fell
// back to the token midpoint, clamped against the blurred spoken edge). The
// SPAN/tolerance condition has been REMOVED from `isBoundarySilenceCandidate`
// (see that function's own doc comment) rather than re-tuned, because no
// fixed tolerance can both forgive ordinary blur and still catch a genuine
// breath from edge-distance alone. The reliable breath rejection below —
// `fillsTokenGapWithinSpan` / `isBreathSilence`, ALIGNMENT evidence, not a
// timestamp guess — is unaffected by this removal and still runs ahead of the
// (now pure-window) candidacy test.
//
// TOKEN-GAP DISCRIMINATION (2026-08-01 fix): the tolerance above is a
// TIMESTAMP heuristic — it corrects Whisper's timestamp error using Whisper's
// own timestamps. Inside its 0.30s band that is circular, and two opposite
// situations become genuinely indistinguishable to it:
//
//   (a) a mid-sentence BREATH — the silence fills the gap between two
//       consecutive tokens that BOTH belong to the current segment's matched
//       span. It is that segment's own pause and can never be a boundary.
//   (b) a real boundary pause MISLABELLED — the silence lies INSIDE one
//       stretched token's span, because Whisper smeared that word across the
//       pause after it. Here the silence is right and the token edge is wrong.
//
// Confirmed in production as case (a): silence [18.32, 18.70] fits exactly
// between "are" (ends 18.32) and "the" (starts 18.70) — one segment's own two
// words — yet intruded only 0.17s past that segment's last word, so the
// tolerance forgave it, placed the boundary at 18.51 and split the trailing
// phrase "the worst" away from its own sentence.
//
// `fillsTokenGapWithinSpan` below settles it with INDEPENDENT evidence: the
// Hirschberg text alignment decides which segment owns each word, and it does
// so without consulting a timestamp at all. The principle it encodes is that
// each segment owns its full spoken text, breaths included — a pause BETWEEN
// two of a segment's own words is that segment's property, never a boundary.
// So case (a) is rejected outright, however shallow its intrusion, while case
// (b) has no gap to fill (the silence is token-INTERIOR) and this rule stays
// silent on it — `isBoundarySilenceCandidate`'s window test (no longer a
// tolerance test — see the REGRESSION FIX note above) simply accepts it.
//
// COVERAGE-COMPOSITE BREATH DISCRIMINATION (2026-08-01, iteration 3): the
// token-gap test above is a faithful predicate for the ONE shape it targets —
// a silence sitting cleanly between two tokens — but live Whisper output
// routinely produces a shape it structurally cannot see: a breath filled
// with several MICRO-tokens, or flanked by tokens stretched across its edges,
// so no clean two-token gap exists to fit. `isBreathSilence` below is the
// third predicate, a second and independent piece of evidence for that gap:
// not containment, and not a bare coverage ratio either (a first draft of
// exactly that collided two production fixtures at the identical ratio —
// full derivation in syncConstants.ts, next to the two constants it
// introduces). It counts how many of a segment's own INTERIOR tokens (tokens
// with real matched speech on both sides of them, inside the same span) the
// silence substantially overlaps: two or more, at high overall coverage, is
// multiple sandwiched speech fragments — a breath. A short span (its first
// and last token being the only two tokens it has) can never manufacture an
// interior token at all, so it is structurally immune to this branch
// regardless of how much of the silence its two edge tokens individually
// cover — see syncConstants.ts for why that immunity had to be structural,
// not threshold-tuned. Its other branch — coverage at or under
// `BREATH_MAX_SPEECH_COVERAGE_RATIO` — independently closes the
// merged-interval residual the token-gap test leaves open (see below).
//
// ORDER IS DELIBERATE: the token-gap test runs FIRST and short-circuits (an
// alignment fact must not be forgivable by a timestamp guess), the
// coverage-composite test SECOND (independent alignment-adjacent evidence
// for the shapes token-gap cannot see), and the plain window-overlap test
// (`isBoundarySilenceCandidate`) LAST.
//
// The three predicates are separate functions on purpose — they draw on
// different evidence, and `isBoundarySilenceCandidate` stays a pure-scalar
// signature that unit-tests with hand-written numbers. They are COMPOSED in
// exactly ONE place (Pass 1's filter): Pass 2 consumes Pass 1's stored result
// rather than re-deriving candidacy, so the window test and the assignment
// test can never drift apart.
//
// Margins (syncTiming.test.ts): the rule fires at EXACT equality on the three
// breath fixtures, and misses by 0.5-0.76s on the fixtures it must not touch
// (the 14-segment token-interior regression clears it by 0.62s; the middle-gap
// project's real boundary pause sits between tokens of two DIFFERENT spans,
// which is what structurally separates it from a breath).
//
// RESIDUAL OF THE TOKEN-GAP TEST ALONE, CLOSED AT THE COMPOSED-FILTER LEVEL
// (2026-08-01, iteration 3): `fillsTokenGapWithinSpan`'s own test is
// CONTAINMENT, so a silence that starts in a token gap but runs PAST the
// segment's last word still cannot fire it (no following token exists inside
// the span) — that limitation is unchanged, and still directly unit-tested
// below. It is the merged breath+quiet-word+pause interval, pinned by its own
// fixture. Both natural closures at THAT function were evaluated and
// rejected — a centre-based span test breaks the 14-segment regression
// outright, and a centre-in-gap test clears the ±0.15s no-clamp fixture by
// only 0.025s. What actually closes it is the composed Pass 1 filter no
// longer depending on that one function alone: the fixture's silence
// computes to a 0.293 speech-coverage ratio, just under `isBreathSilence`'s
// `BREATH_MAX_SPEECH_COVERAGE_RATIO` (0.3) floor, so the new predicate
// rejects it on that independent branch. See syncConstants.ts for the full
// derivation.
// ---------------------------------------------------------------------------

import type { VideoSegment, TranscriptToken } from '../types';
import type { SilenceInterval } from './silenceDetector';
import type { SegmentAlignment } from './whisperService';
import {
  TEMPORAL_TOLERANCE_MAX_SEC,
  TOKEN_GAP_EPSILON_SEC,
  BREATH_MAX_SPEECH_COVERAGE_RATIO,
  BREATH_TOKEN_OVERLAP_FLOOR_SEC,
} from './syncConstants';

/** The pipeline's uniform 3-decimal rounding (matches distributeSegmentTimes /
 *  applyAnchorBasedTiming / retileCoveredSegments). */
function round3(v: number): number {
  return Number(v.toFixed(3));
}

/** Shared floor with the rest of the timing pipeline — a boundary must never
 *  produce a zero/negative span, even on degenerate input. */
const MIN_SEGMENT_DURATION = 0.1;

/**
 * Degenerate-pair guard threshold (defense-in-depth, rescue false-positive
 * fix). A pair's spoken edges being MILDLY inverted (curr's last matched word
 * ends slightly after next's first matched word starts) is normal, expected
 * Whisper timing noise — confirmed by an existing, deliberate fixture
 * (`alignScenestoTranscript`'s own "no-silence fallback with inverted bounds"
 * test, ~0.4s) that this function's identical pre-existing plain-midpoint
 * fallback must keep handling exactly as before. What is NOT normal is an
 * inversion of hundreds of seconds — the exact shape a false-positive rescue
 * claim (whisperService.ts) produces, where `lastTokenIdx` points far
 * downstream of the next segment's `firstTokenIdx`. `TEMPORAL_TOLERANCE_MAX_SEC`
 * (5.0s) is already this codebase's designated ceiling on plausible
 * legitimate timing slop (the rescue's own window tolerance never exceeds
 * it) — reused here rather than inventing a second, uncoordinated constant.
 * An inversion at or under it gets the existing plain-midpoint fallback
 * unchanged; anything past it is treated as corrupted alignment data, not a
 * timing boundary to compute.
 */
const DEGENERATE_PAIR_INVERSION_THRESHOLD_SEC = TEMPORAL_TOLERANCE_MAX_SEC;

/**
 * Is `silence` eligible to BE the boundary for a pair, i.e. does it overlap
 * the pair's search window (close enough to the pair's spoken midpoint to be
 * considered at all)?
 *
 * REGRESSION FIX (2026-08-03): this predicate used to ALSO require the
 * silence to span the gap between the two segments' own speech — an "edge
 * beyond `lastSpokenEnd`/`nextSpokenStart` by more than
 * `BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC` (0.3s) is a same-segment breath,
 * reject" test, on the theory that Whisper's word-boundary timestamps carry
 * only ~±0.3s of error. Verified against a real 173/174-segment production
 * project (bisected against the pre-regression build, commit 0c83a06): real
 * trailing-word timestamps routinely blur INTO the following pause by
 * considerably more than 0.3s — comfortably past this tolerance — so this
 * condition was rejecting genuine inter-segment silences wholesale, and every
 * such boundary fell back to the token midpoint (clamped hard against the
 * blurred spoken edge, i.e. "clamps to speech end"). 0c83a06, which had no
 * SPAN condition at all — pure window overlap — produced clean, correct
 * boundaries on the same project and audio.
 *
 * The SPAN condition is deleted rather than re-tuned: this predicate is a
 * TIMESTAMP heuristic, and no fixed tolerance here can both (a) forgive
 * ordinary trailing-word blur and (b) still catch a genuine breath purely
 * from how close it sits to a spoken edge — the two are not reliably
 * separable on timestamp distance alone (see the file header's TOKEN-GAP
 * DISCRIMINATION section). The actual, reliable breath rejection is
 * `fillsTokenGapWithinSpan` / `isBreathSilence` below — ALIGNMENT evidence,
 * not a timestamp guess — and both are composed ahead of this predicate in
 * Pass 1's filter regardless of this change; removing this predicate's own
 * SPAN test does not weaken that defense (the pair-4 word-theft regression
 * fixture, boundary ~18.87s, is rejected by `fillsTokenGapWithinSpan` alone —
 * confirmed by inspection: its silence fits exactly between two of the
 * segment's own tokens, independent of any distance-from-edge test here).
 *
 * This is now the single home for the WINDOW predicate alone. It is called
 * from Pass 1 only, composed with `fillsTokenGapWithinSpan` and
 * `isBreathSilence` below; Pass 2 assigns out of Pass 1's stored result
 * rather than re-deriving overlap itself, so the three can never disagree
 * about what a candidate is.
 *
 * Pure; exported for direct unit testing.
 */
export function isBoundarySilenceCandidate(
  silence: SilenceInterval,
  searchStart: number,
  searchEnd: number,
): boolean {
  return silence.endSec > searchStart && silence.startSec < searchEnd;
}

/** `computeBoundarySearchWindow`'s return shape — the derived midpoint/gap
 *  plus the search bounds a pair's boundary silence must overlap. */
export interface BoundarySearchWindow {
  spokenMid: number;
  spokenGapWidth: number;
  searchStart: number;
  searchEnd: number;
}

/**
 * Derives a pair's boundary search window from its four spoken-word edges.
 * Pure extraction (boundary-quality checker, waveform-watcher program Phase
 * 1) of the arithmetic `snapCoveredBoundaries`'s Pass 1 has always used
 * inline — the two call sites (this function's caller here, and
 * `validateBoundaryQuality` in syncContracts.ts, which recomputes the same
 * window post-hoc to check what silence candidates a fallback boundary had
 * available) must derive an IDENTICAL window from the same four inputs, so
 * the arithmetic lives in exactly one place.
 *
 * `lastSpokenEnd`/`nextSpokenStart` are the pair's own adjacent spoken edges
 * (curr's last matched word end, next's first matched word start).
 * `currFirstSpokenStart`/`nextLastSpokenEnd` are the outer bounds the window
 * may never cross — curr's own first spoken word and next's own last spoken
 * word — without them a near-zero spoken gap's widened radius could reach
 * past a short neighbour and steal a silence belonging to a different pair.
 *
 * Pure; exported for direct unit testing.
 */
export function computeBoundarySearchWindow(
  lastSpokenEnd: number,
  nextSpokenStart: number,
  currFirstSpokenStart: number,
  nextLastSpokenEnd: number,
): BoundarySearchWindow {
  const spokenMid = (lastSpokenEnd + nextSpokenStart) / 2;
  const spokenGapWidth = nextSpokenStart - lastSpokenEnd;
  // Whisper compresses adjacent words to the same timestamp sometimes
  // (spokenGap near 0); its boundary timestamp is then unreliable, so widen
  // the search — but only to 1.0s, or neighbouring boundaries lose their
  // silences.
  const searchRadius = spokenGapWidth < 0.1
    ? 1.0
    : Math.max(0.5, spokenGapWidth / 2 + 0.4);
  const searchStart = Math.max(spokenMid - searchRadius, currFirstSpokenStart);
  const searchEnd = Math.min(spokenMid + searchRadius, nextLastSpokenEnd);
  return { spokenMid, spokenGapWidth, searchStart, searchEnd };
}

/**
 * Re-runs the EXISTING candidacy predicates (`fillsTokenGapWithinSpan`,
 * `isBreathSilence`, `isBoundarySilenceCandidate`) against a pair's search
 * window to answer one question: did this pair have ANY assignable silence
 * candidate, or was `snapCoveredBoundaries` always going to fall back to the
 * plain spoken-edge midpoint for it?
 *
 * This is a boundary-quality DIAGNOSTIC (waveform-watcher program Phase 1),
 * not a re-implementation of `snapCoveredBoundaries`'s own decision — it
 * deliberately stops at Pass 1's candidacy filter and does not replay Pass
 * 2's contention-aware assignment. A pair with one candidate that Pass 2
 * ultimately hands to a *different*, better-fitting neighbour will read here
 * as "did not use the fallback" even though its actual committed boundary
 * came from the plain midpoint. That is an accepted precision trade-off for
 * a measurement-only pass; it never touches `snapCoveredBoundaries` itself,
 * whose signature and return type this file does not change.
 *
 * Pure; exported for direct unit testing.
 */
export function boundaryUsedFallback(
  tokens: TranscriptToken[],
  silences: SilenceInterval[],
  window: Pick<BoundarySearchWindow, 'searchStart' | 'searchEnd'>,
  currFirstTokenIdx: number,
  currLastTokenIdx: number,
  nextFirstTokenIdx: number,
  nextLastTokenIdx: number,
): boolean {
  const hasCandidate = silences.some(s =>
    !fillsTokenGapWithinSpan(s, tokens, currFirstTokenIdx, currLastTokenIdx) &&
    !fillsTokenGapWithinSpan(s, tokens, nextFirstTokenIdx, nextLastTokenIdx) &&
    !isBreathSilence(s, tokens, currFirstTokenIdx, currLastTokenIdx) &&
    !isBreathSilence(s, tokens, nextFirstTokenIdx, nextLastTokenIdx) &&
    isBoundarySilenceCandidate(s, window.searchStart, window.searchEnd),
  );
  return !hasCandidate;
}

/**
 * Does `silence` fit entirely inside the gap between two CONSECUTIVE tokens of
 * ONE segment's matched span — i.e. is it a within-speech breath rather than a
 * boundary pause?
 *
 * This is the ALIGNMENT-evidence half of candidacy, independent of every
 * timestamp heuristic around it (see the file header). The Hirschberg text
 * match decided which segment owns each word without consulting a timestamp;
 * when it says two consecutive words are both one segment's, a pause between
 * them is that segment's too. A breath, never a boundary — so this outranks
 * `isBoundarySilenceCandidate`'s plain window test rather than being
 * moderated by it, and it is tested first.
 *
 * The span is an index RANGE, not a set of matched indices: tokens strictly
 * inside `[firstTokenIdx, lastTokenIdx]` that the segment did NOT textually
 * match (Hirschberg insertions — a Whisper hallucination mid-segment, say) are
 * deliberately included. They still occupy audio time inside this segment's
 * speech, so a silence in the gap beside one is still this segment's breath.
 *
 * CONTAINMENT, not majority-overlap. A silence extending past the span's last
 * token cannot fire this: the second condition needs a token of the span
 * starting at or after the silence ends, and any such token would push
 * `lastSpokenEnd` past the silence too. That merged breath+word+pause interval
 * is a deliberate residual — see the file header, and the fixture pinning it.
 * Strict containment within `[firstSpokenStart, lastSpokenEnd]` is IMPLIED by
 * having a span token on either side, so it is not separately checked.
 *
 * Returns false for a sentinel (-1) or single-token span — neither has an
 * internal gap to fill. The sentinel guard also makes this safe to reuse on
 * the aligner's full-array path (whisperService.ts), where unmatched segments
 * really do carry -1 indices.
 *
 * `TOKEN_GAP_EPSILON_SEC` absorbs analysis-frame quantization only; see its
 * doc comment for why it must stay far below the detector's minimum silence
 * duration (that margin is what makes this immune to overlapping tokens).
 *
 * Pure; exported for direct unit testing.
 */
export function fillsTokenGapWithinSpan(
  silence: SilenceInterval,
  tokens: TranscriptToken[],
  firstTokenIdx: number,
  lastTokenIdx: number,
): boolean {
  if (firstTokenIdx < 0 || lastTokenIdx <= firstTokenIdx) return false;

  for (let j = firstTokenIdx; j < lastTokenIdx; j++) {
    const a = tokens[j];
    const b = tokens[j + 1];
    if (!a || !b) continue;
    if (
      a.endSec <= silence.startSec + TOKEN_GAP_EPSILON_SEC &&
      b.startSec >= silence.endSec - TOKEN_GAP_EPSILON_SEC
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Coverage-composite breath discrimination (iteration 3 — see this file's
 * header and syncConstants.ts for the two prior iterations this replaces).
 *
 * Does `silence` belong to ONE side's own speech, and look like a breath
 * rather than a boundary pause? Two independent branches, either sufficient:
 *
 *  1. MOSTLY EMPTY — the silence's total span-token coverage is at or under
 *     `BREATH_MAX_SPEECH_COVERAGE_RATIO`. Predominantly true silence, not
 *     speech with a pause carved out of it.
 *
 *  2. MULTI-FRAGMENT — coverage is high (>= 0.9) AND at least two of the
 *     span's INTERIOR tokens (tokens strictly between `firstTokenIdx` and
 *     `lastTokenIdx` — real matched speech on both sides of them, inside the
 *     same span) are individually overlapped by at least
 *     `BREATH_TOKEN_OVERLAP_FLOOR_SEC`. Multiple sandwiched speech fragments
 *     inside one pause is what a breath between several of a segment's own
 *     words looks like; a single stretched word does not produce it, and a
 *     short span (its first and last token being its only two tokens) can
 *     never produce it AT ALL — a two-token span has no interior token to
 *     count, so it is structurally immune to this branch no matter how much
 *     of the silence its two edge tokens individually cover. This is why
 *     edge tokens (`j === firstTokenIdx` or `j === lastTokenIdx`) still
 *     contribute to the coverage RATIO below like any other span token, but
 *     never to the interior count — see syncConstants.ts for the fixture
 *     that this exact restriction exists to protect.
 *
 * Both branches require the silence to sit mostly WITHIN the tested span's
 * own extent first (`> 0.5` overlap fraction) — a silence that barely
 * touches this side's speech is not evidence about this side at all, however
 * it later resolves on the OTHER side's own call.
 *
 * Returns false for a sentinel (-1) or single-token span, mirroring
 * `fillsTokenGapWithinSpan`'s own guard: a single token has no interior to
 * weigh, so this predicate has no basis to call it a breath either way.
 *
 * INDEX-BASED SEAM EXEMPTION — NEXT-SIDE ONLY (V6 production autopsy,
 * 2026-08-03; curr-side disabled 2026-08-03 after a second real project
 * exposed a false positive — see CURR-SIDE DISABLED below). The
 * MULTI-FRAGMENT branch above assumes a silence with high coverage and 2+
 * "significant" interior tokens must be internal fragmentation of ONE span's
 * own speech. A real 447-segment production project falsified that
 * assumption at 8 real boundaries (5 independently confirmed by hand —
 * segments 96, 162, 316, 338, 352 — plus 3 more of the identical shape found
 * by an exhaustive sweep of the same project: segments 34, 405, 412) via a
 * mechanism the coverage math has no way to see: Whisper's timestamp for a
 * span's FIRST token can smear backward across the true silence boundary —
 * the model assigns the *preceding* pause's own onset to the next word's
 * start rather than to when it is actually articulated (measured 100-900ms
 * of smear across the 8 cases). When that happens, `firstTok`'s timestamp —
 * which every distance in the coverage/ratio computation above is measured
 * relative to — is not evidence about this span's own speech at all. It is
 * evidence about the PRECEDING span's smear. No amount of tightening the
 * coverage ratio or the interior-token floor can fix this, because the
 * corruption is in the TIMESTAMP the ratio is computed FROM, not in the
 * ratio's threshold. (A 9th segment, 60, was originally miscounted as part of
 * this same set — see CURR-SIDE DISABLED below for why it wasn't.)
 *
 * Token INDICES, unlike token TIMESTAMPS, are never smeared — the Hirschberg
 * alignment pass that assigns `firstTokenIdx`/`lastTokenIdx` to each segment
 * is a pure text match with no timestamp involved, so an index is exactly as
 * reliable at the seam as anywhere else in the array. This exemption
 * therefore re-poses the multi-fragment override's question in INDEX terms
 * instead of timestamp terms: does this silence sit at or after the point in
 * the token array where the PRECEDING segment's own genuine last match
 * (`otherSideLastTokenIdx`) ends? If so, the silence cannot — by index
 * position, independent of whatever timestamp `firstTok` happens to carry —
 * be interior to the preceding segment's territory, so it is a genuine
 * inter-segment seam, not this span's own breath, regardless of how the
 * (potentially smeared) coverage ratio above scored it.
 *
 * `otherSideLastTokenIdx` is the last matched token of the span IMMEDIATELY
 * PRECEDING the one under test. This exemption touches ONLY the
 * multi-fragment branch — the MOSTLY-EMPTY branch is not interior-token
 * coverage evidence and is unaffected. `otherSideLastTokenIdx` defaults to
 * -1 (exemption never fires) so every pre-existing caller that has no
 * predecessor data in scope — this file's own `boundaryUsedFallback`
 * diagnostic among them — is unchanged.
 *
 * CURR-SIDE DISABLED (2026-08-03, confirmed on a second real 173-segment
 * production project): `snapCoveredBoundaries` calls this predicate on BOTH
 * sides of every pair — the NEXT segment's own span (testing whether a
 * silence is that segment's leading-edge breath) AND the CURR segment's own
 * span (testing whether it's curr's trailing breath). For the NEXT-side
 * call, `otherSideLastTokenIdx` = curr's own `lastTokenIdx` — genuinely
 * adjacent to the silence under test, so "does the silence start after this
 * ends" is real seam evidence. For a CURR-side call, the only symmetric
 * choice is the PRECEDING segment's `lastTokenIdx` (segment i-1, TWO
 * segments back from the silence being tested) — a token with NO temporal
 * relationship to the silence at all. That condition is satisfied almost
 * trivially whenever curr has any predecessor, so applying the exemption
 * there silently strips multi-fragment breath protection from the entire
 * CURR side. Confirmed concretely: segment "They're the worst" (the exact
 * production case that originally motivated the multi-fragment override) has
 * its own 0.38s internal breath silence wrongly exempted this way, landing
 * the boundary at 18.51s — the pre-fix breath centre the override exists to
 * prevent — instead of the correct 18.87s. A second real instance was found
 * retroactively inside the ORIGINAL 447-segment project too: segment 60's
 * apparent "fix" (previously miscounted among the 9 above) was this same
 * curr-side false positive stealing a 1.32s trailing breath from "...puts his
 * hand flat on your shoulder.", not a genuine seam fix — it happened to also
 * land inside a detected silence, which is what made it look like an
 * improvement. Every real call site in this file now passes -1 for the
 * CURR-side call, permanently disabling the exemption there; the NEXT-side
 * call is unaffected. Do not re-enable the curr-side exemption by threading a
 * predecessor index into it without a fundamentally different anchor — the
 * "segment two back" anchor is not fixable by tuning, the same way the
 * timestamp-only leading-edge exemption before this rewrite was not fixable
 * by tuning.
 *
 * Pure; exported for direct unit testing.
 */
export function isBreathSilence(
  silence: SilenceInterval,
  tokens: TranscriptToken[],
  firstTokenIdx: number,
  lastTokenIdx: number,
  // Index of the immediately PRECEDING span's own last matched token (see
  // doc comment above) — meaningful ONLY for a NEXT-side call, where it is
  // curr's own lastTokenIdx (genuinely adjacent to the silence under test).
  // Real call sites always pass -1 for a CURR-side call — see CURR-SIDE
  // DISABLED above. -1 (default) disables the exemption entirely.
  otherSideLastTokenIdx: number = -1,
): boolean {
  if (firstTokenIdx < 0 || lastTokenIdx <= firstTokenIdx) return false;

  const firstTok = tokens[firstTokenIdx];
  const lastTok = tokens[lastTokenIdx];
  if (!firstTok || !lastTok) return false;

  const silenceDur = silence.endSec - silence.startSec;

  const extentOverlap = Math.max(
    0,
    Math.min(silence.endSec, lastTok.endSec) - Math.max(silence.startSec, firstTok.startSec),
  );
  if (extentOverlap / silenceDur <= 0.5) return false;

  let covered = 0;
  let significantInteriorCount = 0;
  for (let j = firstTokenIdx; j <= lastTokenIdx; j++) {
    const tok = tokens[j];
    if (!tok) continue;
    // Rounded to absorb float noise from subtracting two decimal timestamps
    // (e.g. 18.55 - 18.46 computes to 0.08999999999999986 in IEEE754, not
    // 0.09) — real token/silence timestamps carry nowhere near this much
    // precision, so this loses nothing while keeping the floor comparison
    // below exact at the values it was calibrated against.
    const overlap = round3(Math.max(0, Math.min(silence.endSec, tok.endSec) - Math.max(silence.startSec, tok.startSec)));
    covered += overlap;
    if (j > firstTokenIdx && j < lastTokenIdx && overlap >= BREATH_TOKEN_OVERLAP_FLOOR_SEC) {
      significantInteriorCount++;
    }
  }

  const ratio = covered / silenceDur;
  if (ratio <= BREATH_MAX_SPEECH_COVERAGE_RATIO) return true;
  if (!(ratio >= 0.9 && significantInteriorCount >= 2)) return false;

  // Index-based seam exemption (see doc comment above). If the preceding
  // span's own genuine last match ends at or before this silence starts, the
  // silence sits at/after that seam BY INDEX POSITION — it cannot be this
  // span's own interior breath, whatever `firstTok`'s (possibly smeared)
  // timestamp suggested above.
  if (otherSideLastTokenIdx >= 0) {
    const seamAnchor = tokens[otherSideLastTokenIdx];
    if (seamAnchor && silence.startSec >= seamAnchor.endSec - TOKEN_GAP_EPSILON_SEC) {
      return false;
    }
  }

  return true;
}

/**
 * Re-snaps the boundaries BETWEEN covered segments and derives each one's
 * duration from the result.
 *
 * `kept` and `keptAlignments` are index-parallel — `keptAlignments[i]` is the
 * alignment for `kept[i]` (both come out of `filterToCoveredSegments`, which
 * collects them in one pass).
 *
 * Per adjacent pair (i, i+1):
 *  - `lastSpokenEnd`   = end of segment i's LAST matched transcript word
 *  - `nextSpokenStart` = start of segment i+1's FIRST matched transcript word
 *  - search a window centred on their midpoint for an unused detected silence;
 *    the boundary is the chosen silence's midpoint, or the two spoken edges'
 *    midpoint when no silence overlaps the window. A boundary that came from a
 *    real silence is never clamped — the silence is acoustic ground truth and
 *    outranks Whisper's ~300ms-error word timestamps; the no-silence fallback
 *    is simply the token midpoint, which inherently lies within the spoken-word
 *    range and needs no clamp post-processing
 *  - write it to both sides: `kept[i].duration` ends there, `kept[i+1].startTime`
 *    and `anchorStart` begin there
 *
 * The last survivor extends to `audioDuration` — the audio is the source of
 * truth for total length.
 *
 * LOCKED segments are authoritative and are never moved or shrunk: a pair with
 * a locked segment on either side is left exactly as the caller supplied it,
 * and a locked last segment keeps its duration. This mirrors the lock handling
 * in `alignScenestoTranscript` and `applyAnchorBasedTiming`.
 *
 * Pure — no I/O, no mutation of the input array (segments are copied).
 */
export function snapCoveredBoundaries(
  kept: VideoSegment[],
  keptAlignments: SegmentAlignment[],
  tokens: TranscriptToken[],
  silences: SilenceInterval[],
  audioDuration: number,
): VideoSegment[] {
  if (kept.length === 0) return kept;

  const out: VideoSegment[] = kept.map(s => ({ ...s }));

  // --- Pass 1 — compute every pair's search window up front ----------------
  // From `kept` (the pristine, pre-mutation snapshot the caller passed in),
  // never from `out` — an earlier pair's boundary write must not leak into a
  // later pair's own window math. `null` marks a pair this function has never
  // moved (locked on either side, or missing alignment data) — it carries no
  // window and is never a candidate for any silence in Pass 2.
  interface PairPlan {
    lastSpokenEnd: number;
    nextSpokenStart: number;
    spokenMid: number;
    spokenGapWidth: number;
    searchStart: number;
    searchEnd: number;
    /** Every silence eligible to be THIS pair's boundary — not filling a gap
     *  between two tokens of either segment's own matched span
     *  (`fillsTokenGapWithinSpan`, alignment evidence), AND in the window AND
     *  spanning the gap between the two segments' speech
     *  (`isBoundarySilenceCandidate`, timestamp evidence). Still unfiltered
     *  with respect to CONTENTION: assignment (Pass 2) reads this list to
     *  decide which pair actually gets to use each one. */
    overlapping: SilenceInterval[];
  }

  const plans: Array<PairPlan | null> = [];
  for (let i = 0; i < out.length - 1; i++) {
    const curr = out[i]!;
    const next = out[i + 1]!;
    const currAlign = keptAlignments[i];
    const nextAlign = keptAlignments[i + 1];

    // Locked segments never move or shrink — leave this boundary untouched.
    // Defensive: a caller that passes mismatched array lengths gets a no-op
    // for the affected pair rather than a boundary derived from `undefined`.
    if (curr.locked || next.locked || !currAlign || !nextAlign) {
      plans.push(null);
      continue;
    }

    // The pristine snapshot for this pair's fallback reads.
    const currOrig = kept[i]!;
    const nextOrig = kept[i + 1]!;

    // Every segment here is MATCHED, so these token lookups resolve to real
    // spoken-word edges. The `??` fallbacks exist only so a malformed token
    // index can't produce NaN — they are not the -1-sentinel path this
    // function was written to eliminate.
    const lastSpokenEnd = tokens[currAlign.lastTokenIdx]?.endSec ?? (currOrig.startTime + currOrig.duration);
    const nextSpokenStart = tokens[nextAlign.firstTokenIdx]?.startSec ?? nextOrig.startTime;
    // Outer bounds this boundary may never cross — curr's own first spoken word
    // and next's own last spoken word. Without them, the wide radius used for a
    // near-zero spoken gap can reach past a short next segment entirely and
    // steal the silence belonging to the FOLLOWING boundary.
    const currFirstSpokenStart = tokens[currAlign.firstTokenIdx]?.startSec ?? currOrig.startTime;
    const nextLastSpokenEnd = tokens[nextAlign.lastTokenIdx]?.endSec ?? (nextOrig.startTime + nextOrig.duration);

    const { spokenMid, spokenGapWidth, searchStart, searchEnd } = computeBoundarySearchWindow(
      lastSpokenEnd, nextSpokenStart, currFirstSpokenStart, nextLastSpokenEnd,
    );

    // Token-gap (alignment evidence) FIRST and short-circuiting, then
    // coverage-composite (independent alignment-adjacent evidence for the
    // shapes token-gap cannot see), then the window/span/tolerance test
    // (timestamp evidence) LAST. A silence filling a gap between two tokens
    // of EITHER segment's own span, or scoring as that segment's own breath
    // under the coverage-composite test, is out regardless of how shallow its
    // intrusion is — an alignment fact must not be forgivable by a timestamp
    // tolerance.
    // Index-based seam exemption input — NEXT-SIDE ONLY (see isBreathSilence's
    // CURR-SIDE DISABLED doc comment). next's own span is tested against
    // curr's own lastTokenIdx — genuinely adjacent to the silence, real seam
    // evidence. curr's own span is deliberately passed -1: the only
    // symmetric choice (the segment BEFORE curr) has no temporal relationship
    // to this silence and was confirmed on real data to steal curr's own
    // trailing breath.
    const currOtherSideLastTokenIdx = -1;
    const nextOtherSideLastTokenIdx = currAlign.lastTokenIdx;

    const overlapping = silences.filter(s =>
      !fillsTokenGapWithinSpan(s, tokens, currAlign.firstTokenIdx, currAlign.lastTokenIdx) &&
      !fillsTokenGapWithinSpan(s, tokens, nextAlign.firstTokenIdx, nextAlign.lastTokenIdx) &&
      !isBreathSilence(s, tokens, currAlign.firstTokenIdx, currAlign.lastTokenIdx, currOtherSideLastTokenIdx) &&
      !isBreathSilence(s, tokens, nextAlign.firstTokenIdx, nextAlign.lastTokenIdx, nextOtherSideLastTokenIdx) &&
      isBoundarySilenceCandidate(s, searchStart, searchEnd),
    );

    plans.push({ lastSpokenEnd, nextSpokenStart, spokenMid, spokenGapWidth, searchStart, searchEnd, overlapping });
  }

  // --- Pass 2 — assign each contested silence to exactly one pair ----------
  // A silence overlapped by no pair's window is simply unused, same as
  // before. A silence overlapped by exactly one pair goes to it, same as
  // before. A silence overlapped by MORE THAN ONE pair's window — the actual
  // starvation scenario — goes to whichever pair's spoken midpoint it sits
  // closest to, not to whichever pair happens to run first. Exact ties go to
  // the later pair (deterministic — `<=` lets a later, equally-close pair
  // overwrite an earlier one, and `plans` is walked in ascending order).
  //
  // Contention is read out of each plan's OWN candidate list (Pass 1's
  // `isBoundarySilenceCandidate` result) rather than re-tested here — one
  // predicate, one evaluation, no possibility of the window test and the
  // assignment test disagreeing about what a candidate is.
  const bestPairForSilence = new Map<SilenceInterval, { pairIdx: number; dist: number }>();
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    if (!plan) continue;
    for (const s of plan.overlapping) {
      const dist = Math.abs((s.startSec + s.endSec) / 2 - plan.spokenMid);
      const best = bestPairForSilence.get(s);
      if (best === undefined || dist <= best.dist) {
        bestPairForSilence.set(s, { pairIdx: i, dist });
      }
    }
  }

  // Materialize per-pair candidate lists in the caller's silence order, which
  // is what the closest-centre reduce in Pass 3 walks.
  const assignment: SilenceInterval[][] = plans.map(() => []);
  for (const s of silences) {
    const best = bestPairForSilence.get(s);
    if (best !== undefined) assignment[best.pairIdx]!.push(s);
  }

  // --- Pass 3 — resolve boundaries left-to-right ----------------------------
  // Unchanged from before except for where the candidate list comes from:
  // closest-centre pick among THIS pair's assigned silences, token-midpoint
  // fallback when it has none, and the monotonic safety-net check.
  let prevBoundary: number | undefined;
  for (let i = 0; i < out.length - 1; i++) {
    const curr = out[i]!;
    const next = out[i + 1]!;
    const plan = plans[i];
    if (!plan) continue;

    const { lastSpokenEnd, nextSpokenStart, spokenMid } = plan;

    // Degenerate-pair guard (defense-in-depth for the rescue false-positive
    // fix): a pair whose spoken edges are inverted by MORE than
    // DEGENERATE_PAIR_INVERSION_THRESHOLD_SEC has no meaningful boundary to
    // compute — this is the exact shape a false-positive rescue claim
    // (whisperService.ts) produces: `curr`'s `lastTokenIdx` points hundreds
    // of seconds downstream of `next`'s `firstTokenIdx`. Forcing a boundary
    // anyway via `(lastSpokenEnd + nextSpokenStart) / 2` is precisely the
    // step that turned that false positive into a multi-minute phantom
    // duration in production (docs/history.md) — it overwrote
    // applyAnchorBasedTiming's already-correct, already-repaired timing with
    // one derived from the same corrupted indices. A MILD inversion (a few
    // hundred ms — Whisper words spoken close together/overlapping) is
    // normal and must still fall through to the existing plain-midpoint
    // fallback below unchanged (see the threshold constant's doc comment).
    // Skip this pair's write entirely for the large case instead: leave both
    // segments' current startTime/duration (upstream's repair, or an earlier
    // pair's write) exactly as the caller supplied them. `prevBoundary` is
    // deliberately NOT updated for a skipped pair — it must keep describing
    // the last boundary this function actually WROTE, so a later pair's
    // monotonic check still compares against real committed ground truth
    // rather than a value that was never written.
    if (lastSpokenEnd - nextSpokenStart > DEGENERATE_PAIR_INVERSION_THRESHOLD_SEC) {
      if (import.meta.env.DEV) {
        console.warn(
          '[snap] degenerate pair skipped — pair (%d,%d): curr=%s last spoken word ends at %ss, next=%s first spoken word starts at %ss (inverted)',
          i, i + 1, curr.id, lastSpokenEnd.toFixed(3), next.id, nextSpokenStart.toFixed(3),
        );
      }
      continue;
    }

    const candidates = assignment[i]!;

    let gap: SilenceInterval | undefined;
    if (candidates.length > 0) {
      gap = candidates.reduce((best, s) => {
        const sCenter = (s.startSec + s.endSec) / 2;
        const bestCenter = (best.startSec + best.endSec) / 2;
        return Math.abs(sCenter - spokenMid) < Math.abs(bestCenter - spokenMid) ? s : best;
      });
    }

    let boundary = gap
      ? (gap.startSec + gap.endSec) / 2
      : (lastSpokenEnd + nextSpokenStart) / 2;

    // Monotonic sanity check: a boundary must not go backwards past the
    // previous one. If it does, the chosen silence belongs to an earlier
    // boundary — fall back to the token midpoint. Applies to BOTH the
    // silence-centre and the token-midpoint boundary.
    if (prevBoundary !== undefined && boundary < prevBoundary) {
      boundary = (lastSpokenEnd + nextSpokenStart) / 2;

      // Re-check (2026-08-02 fix, closes the deferred bug noted in
      // project-state.md): the fallback midpoint above is this pair's OWN
      // spoken edges, which carry no guarantee of sitting after a
      // still-earlier COMMITTED boundary — corrupted/overlapping upstream
      // alignment data (the same shape the degenerate-pair guard above
      // exists for, just under its 5s threshold) can leave the substituted
      // midpoint backwards too. The pre-fix code trusted the substitution
      // unconditionally and could commit a backwards boundary silently.
      // Clamping to prevBoundary instead collapses this pair to the
      // MIN_SEGMENT_DURATION floor below — exactly what the pre-fix code
      // would have produced by committing the backwards value and letting
      // the `Math.max(MIN_SEGMENT_DURATION, ...)` duration floor absorb it —
      // but the written boundary itself is now always monotonic, never
      // backwards.
      if (boundary < prevBoundary) {
        if (import.meta.env.DEV) {
          console.warn(
            '[snap] monotonic fallback still backwards — pair (%d,%d): curr=%s next=%s fallback midpoint=%ss < prevBoundary=%ss; clamping to prevBoundary',
            i, i + 1, curr.id, next.id, boundary.toFixed(3), prevBoundary.toFixed(3),
          );
        }
        boundary = prevBoundary;
      }
    }

    // No-silence fallback: boundary = token midpoint. The midpoint inherently
    // lies within the spoken-word range; no clamp post-processing needed.

    const snapped = round3(boundary);

    curr.duration = round3(Math.max(MIN_SEGMENT_DURATION, snapped - curr.startTime));
    next.startTime = snapped;
    next.anchorStart = snapped;

    // Maintain contiguity: if the floor extended curr past snapped, push next's start
    // so startTime[i] + duration[i] === startTime[i+1] always holds.
    const contiguousStart = round3(curr.startTime + curr.duration);
    if (contiguousStart > next.startTime) {
      next.startTime = contiguousStart;
      next.anchorStart = contiguousStart;
    }
    prevBoundary = boundary;
  }

  // Last survivor runs to the end of the audio (unless locked — locked
  // durations are preserved).
  const last = out[out.length - 1]!;
  if (!last.locked) {
    last.duration = round3(Math.max(MIN_SEGMENT_DURATION, audioDuration - last.startTime));
  }

  return out;
}
