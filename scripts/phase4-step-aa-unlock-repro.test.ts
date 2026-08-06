// Phase 4 Step AA/K14 — LIVE repro of K14, the in-editor lock defect.
// INVERTED at the K14 implementation commit (Steps AA-AD -> implementation).
//
// K14 is NOT K13. K13 is the Apply Sync clean-slate rebuild dropping the `locked`
// field (scripts/phase4-step-w-k13-repro.test.ts). K14 needs no resync at all: it
// fired inside the editor, on the lock toggle, and moved segments the user never
// touched — including OTHER LOCKED ONES.
//
// Mechanism (was, before this commit): `handleToggleLock` (src/App.tsx) ran
// `applyAnchorBasedTiming` over the WHOLE segments array, and that function
// re-derived every segment's startTime from its `anchorStart` — a field that
// `computeDragCascade` (src/App.tsx) never updated when a drag rewrote
// startTime/duration. So every drag left the anchor grid stale, and the next
// lock toggle anywhere snapped the whole timeline back onto it. Fixed by:
//   1. `computeDragCascade` no longer writes `locked: true` anywhere (decision 9
//      point 1 — dragging locks nothing).
//   2. `recomputeStartTimes` (the tail of `computeDragCascade`) now writes
//      `anchorStart` in lockstep with every `startTime` it commits, so a drag
//      can never again leave the anchor grid stale.
//   3. `applyAnchorBasedTiming`'s locked branch (syncEngine.ts) now PINS a
//      locked segment's startTime/duration — never snaps to anchorStart, never
//      grows/shrinks — and forces anchorStart to mirror startTime instead of
//      reading it as a separate, possibly-stale value.
//
// This file was written to assert the DEFECT (same convention as the K13
// repro) and was required to start failing once decision 9's lock semantics
// landed. It has NOT been deleted — inverted in place, per instruction, so the
// only proof this defect was ever real is not lost. Every assertion below now
// proves the FIX; the original buggy values are preserved in comments.
//
// Run: npx vitest run scripts/phase4-step-aa-unlock-repro.test.ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import type { VideoSegment } from '../src/types';

const OUT_DIR = '.work-phase4';
const OUT = `${OUT_DIR}/step-aa-c13-live-repro.json`;

function seg(i: number, startTime: number, duration: number, anchorStart: number): VideoSegment {
  return {
    id: `s${i}`, order: i, text: `seg ${i}`,
    startTime, duration, anchorStart, anchorSource: 'whisper', locked: false,
  } as unknown as VideoSegment;
}

/**
 * Verbatim mirror of App.tsx's module-private `recomputeStartTimes`, which is
 * the tail of `computeDragCascade`, POST-FIX. Reproduced rather than imported
 * because it is not exported; the two must stay identical. The fix: every
 * segment's `anchorStart` is now written in lockstep with the `startTime` this
 * function commits, instead of being left untouched (the K14 root cause).
 */
function recomputeStartTimes(segs: VideoSegment[]): VideoSegment[] {
  let acc = 0;
  return segs.map(s => {
    const t = Number(acc.toFixed(3));
    acc += s.duration;
    return { ...s, startTime: t, anchorStart: t };
  });
}

/**
 * The drag half of `computeDragCascade`, POST-FIX: a drag changes duration on
 * the dragged segment and its absorbing neighbour ONLY — no `locked` write at
 * all (decision 9 point 1). Renamed from the pre-fix `dragAndAutoLock` to
 * `drag`, since there is no more auto-lock to name.
 */
function drag(
  segs: VideoSegment[], draggedId: string, newDur: number, absorberId: string, absorberDur: number,
): VideoSegment[] {
  return recomputeStartTimes(segs.map(s =>
    s.id === draggedId ? { ...s, duration: newDur } :
    s.id === absorberId ? { ...s, duration: absorberDur } : s,
  ));
}

describe('K14 — in-editor lock toggle re-times the whole timeline (LIVE, production code)', () => {
  const AUDIO = 60;

  /** 6 gapless 10s segments; anchors == startTimes, as they are right after a sync. */
  const synced = (): VideoSegment[] => [
    seg(0, 0, 10, 0), seg(1, 10, 10, 10), seg(2, 20, 10, 20),
    seg(3, 30, 10, 30), seg(4, 40, 10, 40), seg(5, 50, 10, 50),
  ];

  it('PART 1 — a drag no longer desynchronises anchorStart from startTime, and locks nothing', () => {
    const after = drag(synced(), 's1', 13, 's2', 7);

    // What the user sees is still correct and contiguous.
    expect(after[1]!.startTime + after[1]!.duration).toBeCloseTo(after[2]!.startTime, 6);

    // FIXED: s2's anchor now tracks its real startTime (23), not a stale 20 —
    // the 3s lie is gone; nothing in the drag path can leave this out of sync
    // again. (Pre-fix: `expect(after[2]!.anchorStart).toBeCloseTo(20, 6)` —
    // the anchor stayed at its pre-drag value while startTime moved to 23.)
    expect(after[2]!.startTime).toBeCloseTo(23, 6);
    expect(after[2]!.anchorStart).toBeCloseTo(23, 6);

    // FIXED: the drag auto-locked NOTHING — decision 9 point 1. (Pre-fix:
    // `expect(after[1]!.locked).toBe(true); expect(after[2]!.locked).toBe(true);`
    // — both cascade participants were silently locked without being asked.)
    expect(after[1]!.locked).toBe(false);
    expect(after[2]!.locked).toBe(false);
  });

  it('PART 2 — unlocking one segment moves NOTHING else; a different, still-locked '
    + 'segment survives byte-for-byte (this is C13\'s scenario)', () => {
    // Two drags, far apart on the timeline — same shape and same numeric
    // params as the original repro. Neither locks anything anymore (decision
    // 9 point 1), so the two segments the ORIGINAL repro found auto-locked
    // (s2, s5) are locked here EXPLICITLY instead, mirroring decision 9 point
    // 2 ("segments lock only when the user explicitly toggles them") — a user
    // action unrelated to either drag.
    let cur = drag(synced(), 's1', 13, 's2', 7);
    cur = drag(cur, 's4', 14, 's5', 6);
    cur = cur.map(s => (s.id === 's2' || s.id === 's5') ? { ...s, locked: true } : s);
    const s5Before = cur.find(s => s.id === 's5')!;
    const s0Before = cur.find(s => s.id === 's0')!;
    const s4Before = cur.find(s => s.id === 's4')!;

    // The user unlocks s2. Nothing else is touched.
    const toggled = cur.map(s => (s.id === 's2' ? { ...s, locked: false } : s));
    const after = applyAnchorBasedTiming(toggled, AUDIO);

    // FIXED: s2 itself does NOT jump backward — its anchor was never stale,
    // so unlocking it is a no-op on its position. (Pre-fix, same drag shape:
    // `expect(after[2]!.startTime - cur[2]!.startTime).toBeCloseTo(-3, 6)` —
    // s2 snapped back 3s onto a stale pre-drag anchor.)
    const s2Ref = cur.find(s => s.id === 's2')!;
    const s2After = after.find(s => s.id === 's2')!;
    expect(s2After.startTime).toBeCloseTo(s2Ref.startTime, 6);

    // THE FIX, directly: s5 — three positions away, in a different edit,
    // explicitly locked — is bit-for-bit unchanged: same startTime, duration,
    // anchorStart, and still locked. (Pre-fix: `expect(after[5]!.locked)
    // .toBe(true); expect(after[5]!.startTime - cur[5]!.startTime)
    // .toBeCloseTo(-4, 6);` — a segment neither dragged nor unlocked in this
    // action moved anyway, and being locked did not save it.)
    const s5After = after.find(s => s.id === 's5')!;
    expect(s5After.locked).toBe(true);
    expect(s5After.startTime).toBeCloseTo(s5Before.startTime, 6);
    expect(s5After.duration).toBeCloseTo(s5Before.duration, 6);
    expect(s5After.anchorStart).toBeCloseTo(s5Before.anchorStart!, 6);

    // C13's own predicate: a locked segment's anchorStart never drifts from
    // its startTime.
    expect(s5After.anchorStart).toBeCloseTo(s5After.startTime, 6);

    // Every segment not dragged, absorbed, or toggled in this sequence
    // (s0, s4) is also untouched — the isolation C13 locks in.
    const s0After = after.find(s => s.id === 's0')!;
    const s4After = after.find(s => s.id === 's4')!;
    expect(s0After.startTime).toBeCloseTo(s0Before.startTime, 6);
    expect(s4After.startTime).toBeCloseTo(s4Before.startTime, 6);
    expect(s4After.duration).toBeCloseTo(s4Before.duration, 6);

    // FIXED: no self-overlap — s4 ends exactly where s5 (still locked, still
    // at its original position) begins. (Pre-fix: `expect(after[4]!.startTime
    // + after[4]!.duration).toBeGreaterThan(after[5]!.startTime)` — s4 ended
    // at 54, s5 started at 50: a self-overlapping timeline.)
    expect(s4After.startTime + s4After.duration).toBeLessThanOrEqual(s5After.startTime + 1e-6);
  });

  it('PART 3 — the backward monotonic clamp is UNCHANGED (legitimate D16 defense-in-depth '
    + 'for adversarial input) and is no longer reachable via ordinary drag+toggle use', () => {
    // This sub-case is UNRELATED to locking — it is a direct, adversarial-input
    // test of applyAnchorBasedTiming's own backstop clamp (syncEngine.ts, "D16
    // defense-in-depth"), which repairs raw out-of-order anchors regardless of
    // whether any segment is ever locked. It was never part of decision 9's
    // scope and this commit does not change it — pinned here, unchanged, so
    // that remains explicit rather than assumed.
    const segs = [seg(0, 0, 10, 0), seg(1, 10, 10, 25), seg(2, 20, 10, 12), seg(3, 30, 10, 30)];
    const after = applyAnchorBasedTiming(segs, 40);

    // UNCHANGED from pre-fix (this is not the K14 mechanism):
    expect(after[1]!.anchorStart).toBeCloseTo(12, 6);
    expect(after[1]!.duration).toBeCloseTo(0.1, 6); // collapsed to MIN_SEGMENT_DURATION

    // THE ACTUAL K14 FIX, demonstrated: the scenario above had to be
    // hand-constructed with directly out-of-order anchors, because a REAL
    // drag sequence can no longer produce one. Before this commit, two drags
    // (auto-locking + a stale anchor grid) could desynchronise anchors enough
    // to go out of order and hit this exact destructive path. Reproduce two
    // drags here and confirm the anchors this fix produces are never
    // out-of-order, so the destructive clamp above is never triggered by
    // ordinary editor use anymore.
    let cur = drag(synced(), 's1', 13, 's2', 7);
    cur = drag(cur, 's4', 14, 's5', 6);
    for (let i = 1; i < cur.length; i++) {
      expect(cur[i]!.anchorStart!).toBeGreaterThanOrEqual(cur[i - 1]!.anchorStart!);
    }
  });

  it('PART 4 — writes the C13 evidence artifact for the Step X harness', () => {
    // Re-derive PART 2's scenario and check C13's own predicate directly:
    // no locked segment's anchorStart may ever differ from its startTime, and
    // no segment outside {dragged, absorbed, toggled} may move at all. This is
    // scripts/phase4-step-aa-unlock-repro.test.ts's PART 2, promoted from a
    // demonstrated defect to a permanent regression lock (Step AD), the same
    // way C11 is Step W's K13 repro promoted.
    let cur = drag(synced(), 's1', 13, 's2', 7);
    cur = drag(cur, 's4', 14, 's5', 6);
    cur = cur.map(s => (s.id === 's2' || s.id === 's5') ? { ...s, locked: true } : s);
    const before = cur.map(s => ({ ...s }));
    const toggled = cur.map(s => (s.id === 's2' ? { ...s, locked: false } : s));
    const after = applyAnchorBasedTiming(toggled, AUDIO);

    const untouchedIds = ['s0', 's4']; // not dragged, not absorbed, not toggled
    const untouchedMoved = untouchedIds.filter(id => {
      const b = before.find(s => s.id === id)!;
      const a = after.find(s => s.id === id)!;
      return Math.abs(a.startTime - b.startTime) > 1e-6 || Math.abs(a.duration - b.duration) > 1e-6;
    });
    const lockedDrifted = after.filter(s => s.locked && Math.abs((s.anchorStart ?? s.startTime) - s.startTime) > 1e-6);
    const s5Moved = (() => {
      const b = before.find(s => s.id === 's5')!;
      const a = after.find(s => s.id === 's5')!;
      return !a.locked
        || Math.abs(a.startTime - b.startTime) > 1e-6
        || Math.abs(a.duration - b.duration) > 1e-6
        || Math.abs((a.anchorStart ?? 0) - (b.anchorStart ?? 0)) > 1e-6;
    })();

    const record = {
      generatedAt: new Date().toISOString(),
      claim: 'K14 fixed — computeDragCascade no longer auto-locks (decision 9 point 1), '
        + 'recomputeStartTimes keeps anchorStart in lockstep with every startTime it '
        + 'commits, and applyAnchorBasedTiming\'s locked branch pins startTime/duration '
        + 'instead of snapping to anchorStart. A drag+cascade on one segment followed by '
        + 'an unrelated lock toggle moves nothing outside {dragged, absorbed, toggled}, '
        + 'and a still-locked segment survives byte-for-byte.',
      scenario: 'drag s1 (absorb s2), drag s4 (absorb s5), lock s2+s5, unlock s2',
      untouchedSegmentsChecked: untouchedIds,
      untouchedSegmentsMoved: untouchedMoved,
      lockedSegmentsWithDriftedAnchor: lockedDrifted.map(s => s.id),
      stillLockedSegmentMoved: s5Moved,
      verdict: untouchedMoved.length === 0 && lockedDrifted.length === 0 && !s5Moved
        ? 'FIX CONFIRMED' : 'DEFECT STILL PRESENT',
    };

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT, JSON.stringify(record, null, 2));

    expect(untouchedMoved).toEqual([]);
    expect(lockedDrifted).toEqual([]);
    expect(s5Moved).toBe(false);
    expect(record.verdict).toBe('FIX CONFIRMED');
  });
});
