import type { SegmentAlignment } from './whisperService';

/**
 * Layer 2 permanent detector (WS2 Step 5, Bug 1). Independent of the trusted-
 * spine fix in whisperService.ts's `extractSegmentAlignments` — this re-checks
 * the ASSEMBLED anchor set for any ordering violation that survived the spine
 * gate, immediately upstream of App.tsx's single atomic `setProject` commit.
 *
 * Why `keptAlignments` (not the final committed `startTime`/`duration`
 * partition) is the right input: `distributeSegmentTimes`/`snapBoundaries`
 * always produce a monotonic, gapless partition BY CONSTRUCTION (Model P) —
 * checking the final committed times can never fire, rescue-related defect or
 * not. `keptAlignments[i].audioRegion` is each segment's own REAL matched
 * audio position, independent of that redistribution, so it is the only place
 * a genuine ordering inversion (segment i's real audio sitting before segment
 * i-1's) is still visible.
 *
 * Two DIRECTLY-qualifying (non-rescue) segments' `audioRegion`s can never be
 * inconsistent with each other — `matchedSubjectOf` is one monotonic
 * Hirschberg alignment, so any two genuine matches are already ordered by
 * construction (see whisperService.ts's "Trusted spine" comment). A violation
 * here is therefore only possible when a rescue was involved, which is
 * exactly the risk category the spine fix targets — this detector is the
 * permanent trip-wire for a future case its evidence-competition gets wrong.
 *
 * Detection and reporting ONLY: this function never mutates, repairs,
 * re-anchors, or blocks anything, and has no return value the caller could
 * mistake for a corrected timeline. The export guard (`timelinePartition.ts`)
 * remains the sole enforcement point.
 */
export interface ResidualOrderingViolation {
  /** Index into `keptAlignments` (and `kept`) of the LATER segment in the
   *  offending pair — the one whose real audio position sits before its
   *  predecessor's. */
  segmentIndex: number;
  /** Index of the EARLIER segment in the pair (always `segmentIndex - 1`). */
  neighborIndex: number;
  /** The offending segment's own real matched audio start time. */
  segmentStartSec: number;
  /** The neighbor's real matched audio start/end times. */
  neighborStartSec: number;
  neighborEndSec: number;
  /** Whether either side of the pair reached the timeline via a rescue
   *  (`recoveredVia` present) rather than a direct global-pass match — a
   *  rescue on either side is a necessary precondition for this violation to
   *  be possible at all (see the module comment). */
  segmentWasRescued: boolean;
  neighborWasRescued: boolean;
  /** Which rescue pass recovered the offending segment, if it was rescued. */
  segmentRecoveredVia?: 'windowed' | 'global' | 'concat';
  neighborRecoveredVia?: 'windowed' | 'global' | 'concat';
}

/**
 * Scans `keptAlignments` (the same index-parallel array `kept` uses, per
 * `filterToCoveredSegments`) for any adjacent pair whose real matched audio
 * positions are out of chronological order. Returns `[]` when the timeline is
 * clean — the overwhelmingly common case, and the only case that should ever
 * occur now that the trusted spine gates every rescue adoption.
 */
export function detectResidualOrderingViolations(
  keptAlignments: readonly SegmentAlignment[],
): ResidualOrderingViolation[] {
  const violations: ResidualOrderingViolation[] = [];
  for (let i = 1; i < keptAlignments.length; i++) {
    const prev = keptAlignments[i - 1]!;
    const curr = keptAlignments[i]!;
    if (!prev.audioRegion || !curr.audioRegion) continue; // defensive — both should always be set here
    if (curr.audioRegion.startSec < prev.audioRegion.startSec) {
      violations.push({
        segmentIndex: i,
        neighborIndex: i - 1,
        segmentStartSec: curr.audioRegion.startSec,
        neighborStartSec: prev.audioRegion.startSec,
        neighborEndSec: prev.audioRegion.endSec,
        segmentWasRescued: curr.recoveredVia !== undefined,
        neighborWasRescued: prev.recoveredVia !== undefined,
        segmentRecoveredVia: curr.recoveredVia,
        neighborRecoveredVia: prev.recoveredVia,
      });
    }
  }
  return violations;
}

/**
 * Formats `detectResidualOrderingViolations`'s output as one structured,
 * DEV-console diagnostic line per violation — mirroring the rest of this
 * codebase's `[align-recover]`-style instrumentation. Never throws, never
 * blocks; the caller logs and moves on. Spine-internal detail (which specific
 * neighbor the spine walked past, or why the competition resolved as it did)
 * is not reconstructed here — only what `SegmentAlignment` already carries —
 * so a violation's log line names the "what" precisely but leaves the spine's
 * own "why" for a follow-up investigation using this same input.
 */
export function logResidualOrderingViolations(violations: readonly ResidualOrderingViolation[]): void {
  for (const v of violations) {
    // eslint-disable-next-line no-console
    console.warn(
      '[residual-ordering] segment %d (audio %ss, %s) sits before segment %d (audio %s–%ss, %s) — ' +
      'timeline committed anyway (Model P redistribution masks this in the final startTime/duration); ' +
      'investigate the spine decision for segment %d.',
      v.segmentIndex, v.segmentStartSec.toFixed(3),
      v.segmentWasRescued ? `rescued via ${v.segmentRecoveredVia}` : 'direct match',
      v.neighborIndex, v.neighborStartSec.toFixed(3), v.neighborEndSec.toFixed(3),
      v.neighborWasRescued ? `rescued via ${v.neighborRecoveredVia}` : 'direct match',
      v.segmentIndex,
    );
  }
}
