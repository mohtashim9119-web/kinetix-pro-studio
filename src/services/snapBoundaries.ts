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
// boundaries exactly whenever there is no cross-pair silence contention. Only
// the ARRAY it walks is different.
//
// SILENCE CLAIMING RULE (contention-aware assignment, 2026-07-30 fix): a
// silence is ASSIGNED, not claimed first-come-first-served. `alignScenestoTranscript`'s
// walk (and this function's own pre-fix version) resolved each boundary
// left-to-right, letting an EARLIER pair's search window claim any silence it
// could see — including one that overlapped only by reaching through the tail
// of its own window, past a short next segment, into what was really the
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
// ---------------------------------------------------------------------------

import type { VideoSegment, TranscriptToken } from '../types';
import type { SilenceInterval } from './silenceDetector';
import type { SegmentAlignment } from './whisperService';

/** The pipeline's uniform 3-decimal rounding (matches distributeSegmentTimes /
 *  applyAnchorBasedTiming / retileCoveredSegments). */
function round3(v: number): number {
  return Number(v.toFixed(3));
}

/** Shared floor with the rest of the timing pipeline — a boundary must never
 *  produce a zero/negative span, even on degenerate input. */
const MIN_SEGMENT_DURATION = 0.1;

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
    /** Every silence overlapping this pair's window, unfiltered — assignment
     *  (Pass 2) decides which pair actually gets to use each one. */
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

    const overlapping = silences.filter(s => s.endSec > searchStart && s.startSec < searchEnd);

    plans.push({ lastSpokenEnd, nextSpokenStart, spokenMid, spokenGapWidth, searchStart, searchEnd, overlapping });
  }

  // --- Pass 2 — assign each contested silence to exactly one pair ----------
  // A silence overlapped by no pair's window is simply unused, same as
  // before. A silence overlapped by exactly one pair goes to it, same as
  // before. A silence overlapped by MORE THAN ONE pair's window — the actual
  // starvation scenario — goes to whichever pair's spoken midpoint it sits
  // closest to, not to whichever pair happens to run first. Exact ties go to
  // the later pair (deterministic — `<=` lets a later, equally-close pair
  // overwrite an earlier one).
  const assignment: SilenceInterval[][] = plans.map(() => []);
  for (const s of silences) {
    const sCenter = (s.startSec + s.endSec) / 2;
    let bestPairIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      if (!plan) continue;
      if (!(s.endSec > plan.searchStart && s.startSec < plan.searchEnd)) continue;
      const dist = Math.abs(sCenter - plan.spokenMid);
      if (dist <= bestDist) {
        bestDist = dist;
        bestPairIdx = i;
      }
    }
    if (bestPairIdx >= 0) assignment[bestPairIdx]!.push(s);
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
    }

    // No-silence fallback: boundary = token midpoint. The midpoint inherently
    // lies within the spoken-word range; no clamp post-processing needed.

    const snapped = round3(boundary);
    curr.duration = round3(Math.max(MIN_SEGMENT_DURATION, snapped - curr.startTime));
    next.startTime = snapped;
    next.anchorStart = snapped;
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
