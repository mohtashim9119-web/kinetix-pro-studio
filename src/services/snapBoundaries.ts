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
// pick, same `usedSilences` exclusivity, same monotonic check, same
// fallback-only R4 clamps —
// so that on an all-covered project (nothing skipped) this function reproduces
// the aligner's boundaries exactly. Only the ARRAY it walks is different.
// ---------------------------------------------------------------------------

import type { VideoSegment, TranscriptToken } from '../types';
import type { SilenceInterval } from './silenceDetector';
import type { SegmentAlignment } from './whisperService';
import { SNAP_TOLERANCE_SEC } from './syncConstants';

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
 *    midpoint when no silence overlaps the window
 *  - when NO silence was found, clamp that fallback midpoint into
 *    [lastSpokenEnd - SNAP_TOLERANCE_SEC, nextSpokenStart + SNAP_TOLERANCE_SEC]
 *    (doc §3.6, R4). A boundary that came from a real silence is NOT clamped —
 *    the silence is acoustic ground truth and outranks Whisper's ~300ms-error
 *    word timestamps, which were otherwise dragging boundaries back out of the
 *    silence they were meant to split
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

  // Silence exclusivity is per-call: a silence claimed by one boundary can't be
  // claimed by another. Reset on every call (never module state).
  const usedSilences = new Set<SilenceInterval>();
  let prevBoundary: number | undefined;

  for (let i = 0; i < out.length - 1; i++) {
    const curr = out[i]!;
    const next = out[i + 1]!;
    const currAlign = keptAlignments[i];
    const nextAlign = keptAlignments[i + 1];

    // Locked segments never move or shrink — leave this boundary untouched.
    if (curr.locked || next.locked) continue;
    // Defensive: a caller that passes mismatched array lengths gets a no-op for
    // the affected pair rather than a boundary derived from `undefined`.
    if (!currAlign || !nextAlign) continue;

    // Every segment here is MATCHED, so these token lookups resolve to real
    // spoken-word edges. The `??` fallbacks exist only so a malformed token
    // index can't produce NaN — they are not the -1-sentinel path this function
    // was written to eliminate.
    const lastSpokenEnd = tokens[currAlign.lastTokenIdx]?.endSec ?? (curr.startTime + curr.duration);
    const nextSpokenStart = tokens[nextAlign.firstTokenIdx]?.startSec ?? next.startTime;
    // Outer bounds this boundary may never cross — curr's own first spoken word
    // and next's own last spoken word. Without them, the wide radius used for a
    // near-zero spoken gap can reach past a short next segment entirely and
    // steal the silence belonging to the FOLLOWING boundary.
    const currFirstSpokenStart = tokens[currAlign.firstTokenIdx]?.startSec ?? curr.startTime;
    const nextLastSpokenEnd = tokens[nextAlign.lastTokenIdx]?.endSec ?? (next.startTime + next.duration);

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

    const candidates = silences.filter(
      s => s.endSec > searchStart && s.startSec < searchEnd && !usedSilences.has(s),
    );

    let gap: SilenceInterval | undefined;
    if (candidates.length > 0) {
      gap = candidates.reduce((best, s) => {
        const sCenter = (s.startSec + s.endSec) / 2;
        const bestCenter = (best.startSec + best.endSec) / 2;
        return Math.abs(sCenter - spokenMid) < Math.abs(bestCenter - spokenMid) ? s : best;
      });
    }

    if (gap) usedSilences.add(gap);

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

    // R4 clamps (doc §3.6) — FALLBACK CASE ONLY, mirroring the reference
    // implementation in `alignScenestoTranscript`. A detected silence is
    // acoustic ground truth and outranks Whisper's ~300ms-error word
    // timestamps, so its centre is never clamped against them; clamping it was
    // pulling boundaries back out of the very silence they were meant to split
    // (measured: silence 6.56-7.12, centre 6.84, clamped to 6.55 — before the
    // silence starts). The clamps still bound the no-silence token-midpoint
    // estimate: backward first, then forward; if the two tolerance windows
    // don't overlap (segments too close for a clean boundary), the honest
    // answer is their midpoint.
    if (!gap) {
      const backwardBound = lastSpokenEnd - SNAP_TOLERANCE_SEC;
      const forwardBound = nextSpokenStart + SNAP_TOLERANCE_SEC;
      boundary = Math.max(boundary, backwardBound);
      boundary = Math.min(boundary, forwardBound);
      if (backwardBound > forwardBound) {
        boundary = (backwardBound + forwardBound) / 2;
      }
    }

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
