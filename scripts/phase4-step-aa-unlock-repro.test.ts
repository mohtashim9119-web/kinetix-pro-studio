// Phase 4 Step AA (2026-08-07) — LIVE repro of K14, the in-editor lock defect.
//
// K14 is NOT K13. K13 is the Apply Sync clean-slate rebuild dropping the `locked`
// field (scripts/phase4-step-w-k13-repro.test.ts). K14 needs no resync at all: it
// fires inside the editor, on the lock toggle, and it moves segments the user
// never touched — including OTHER LOCKED ONES.
//
// Mechanism, in one line: `handleToggleLock` (src/App.tsx) runs
// `applyAnchorBasedTiming` over the WHOLE segments array, and that function
// re-derives every segment's startTime from its `anchorStart` — a field that
// `computeDragCascade` (src/App.tsx) never updates when a drag rewrites
// startTime/duration. So every drag leaves the anchor grid stale, and the next
// lock toggle anywhere snaps the whole timeline back onto it.
//
// It asserts the DEFECT, not the fix — same convention as the K13 repro. Every
// assertion below passes today and MUST START FAILING when decision 9's lock
// semantics land. If it starts failing, do not "repair" it: read it as the lock
// work having landed, and retire it with the defect.
//
// Run: npx vitest run scripts/phase4-step-aa-unlock-repro.test.ts
import { describe, it, expect } from 'vitest';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import type { VideoSegment } from '../src/types';

function seg(i: number, startTime: number, duration: number, anchorStart: number): VideoSegment {
  return {
    id: `s${i}`, order: i, text: `seg ${i}`,
    startTime, duration, anchorStart, anchorSource: 'whisper', locked: false,
  } as unknown as VideoSegment;
}

/**
 * Verbatim mirror of App.tsx's module-private `recomputeStartTimes`, which is
 * the tail of `computeDragCascade`. Reproduced rather than imported because it
 * is not exported; the two must stay identical — it is three lines and it is
 * quoted in the plan doc's Step AA.
 */
function recomputeStartTimes(segs: VideoSegment[]): VideoSegment[] {
  let acc = 0;
  return segs.map(s => {
    const t = acc;
    acc += s.duration;
    return { ...s, startTime: Number(t.toFixed(3)) };
  });
}

/** The drag+auto-lock half of `computeDragCascade`: dragged and absorbing
 *  neighbour both get `locked: true`, durations change, anchors do NOT. */
function dragAndAutoLock(
  segs: VideoSegment[], draggedId: string, newDur: number, absorberId: string, absorberDur: number,
): VideoSegment[] {
  return recomputeStartTimes(segs.map(s =>
    s.id === draggedId ? { ...s, duration: newDur, locked: true } :
    s.id === absorberId ? { ...s, duration: absorberDur, locked: true } : s,
  ));
}

describe('K14 — in-editor lock toggle re-times the whole timeline (LIVE, production code)', () => {
  const AUDIO = 60;

  /** 6 gapless 10s segments; anchors == startTimes, as they are right after a sync. */
  const synced = (): VideoSegment[] => [
    seg(0, 0, 10, 0), seg(1, 10, 10, 10), seg(2, 20, 10, 20),
    seg(3, 30, 10, 30), seg(4, 40, 10, 40), seg(5, 50, 10, 50),
  ];

  it('PART 1 — a drag desynchronises anchorStart from startTime, permanently', () => {
    const after = dragAndAutoLock(synced(), 's1', 13, 's2', 7);

    // What the user sees is correct and contiguous.
    expect(after[1]!.startTime + after[1]!.duration).toBeCloseTo(after[2]!.startTime, 6);

    // But s2 now starts at 23 while its anchor still says 20 — a 3s lie that
    // nothing in the drag path corrects, and that persists to localStorage.
    expect(after[2]!.startTime).toBeCloseTo(23, 6);
    expect(after[2]!.anchorStart).toBeCloseTo(20, 6);

    // And the drag auto-locked two segments the user never asked to lock —
    // decision 9 point 1 forbids exactly this.
    expect(after[1]!.locked).toBe(true);
    expect(after[2]!.locked).toBe(true);
  });

  it('PART 2 — unlocking one segment moves a DIFFERENT, still-locked segment', () => {
    // Two independent drags, far apart on the timeline.
    let cur = dragAndAutoLock(synced(), 's1', 13, 's2', 7);
    cur = dragAndAutoLock(cur, 's4', 14, 's5', 6);

    // The user unlocks s2. Nothing else is touched.
    const toggled = cur.map(s => (s.id === 's2' ? { ...s, locked: false } : s));
    const after = applyAnchorBasedTiming(toggled, AUDIO);

    // s2 itself jumps back 3s onto its stale anchor.
    expect(after[2]!.startTime - cur[2]!.startTime).toBeCloseTo(-3, 6);

    // THE DEFECT: s5 — three positions away, in a different edit, and STILL
    // LOCKED — jumps back 4s too. `locked` does not pin position; the locked
    // branch of applyAnchorBasedTiming writes `startTime = anchorStart`
    // unconditionally and only refuses to SHRINK the duration.
    expect(after[5]!.locked).toBe(true);
    expect(after[5]!.startTime - cur[5]!.startTime).toBeCloseTo(-4, 6);

    // Which leaves the timeline self-overlapping: s4 ends at 54, s5 starts at 50.
    expect(after[4]!.startTime + after[4]!.duration).toBeGreaterThan(after[5]!.startTime);

    // syncEngine.ts's own docstring — "Locked segments never shrink and never
    // move" — is therefore false as written. Pinned here so the fix must change it.
    expect(after[5]!.startTime).not.toBeCloseTo(cur[5]!.startTime, 6);
  });

  it('PART 3 — the backward monotonic clamp destructively rewrites anchorStart', () => {
    // An out-of-order anchor pair (s1 anchor 25 sits after s2 anchor 12) — the
    // shape a drag + toggle sequence can produce once the grid is stale.
    const segs = [seg(0, 0, 10, 0), seg(1, 10, 10, 25), seg(2, 20, 10, 12), seg(3, 30, 10, 30)];
    const after = applyAnchorBasedTiming(segs, 40);

    // s1's anchor is overwritten 25 -> 12 in the returned array. Anchors are the
    // only record of where the aligner actually placed a segment, so this is a
    // lossy write into the pipeline's own ground truth, committed to state.
    expect(after[1]!.anchorStart).toBeCloseTo(12, 6);
    expect(after[1]!.duration).toBeCloseTo(0.1, 6); // collapsed to MIN_SEGMENT_DURATION
  });
});
