/**
 * Phase 3 tests (2026-08-08): the lock-conflict block, the anchor-scroll
 * decision, gesture coalescing, and (added in the 2026-08-08 cleanup run,
 * Stage 4) the full undo/redo anchor action — degradation included.
 *
 * All are pure modules precisely so they can be asserted at exact values and
 * exact millisecond boundaries, rather than through a rendered timeline and a
 * sleeping test.
 */

import { describe, expect, it } from 'vitest';
import { findLockConflict, lockConflictMessage } from './historyLockPolicy';
import { resolveOffscreenScrollLeft, resolveHistoryAnchorAction } from './timelineLayout';
import {
  SLIDER_RELEASE_GRACE_MS,
  TEXT_IDLE_MS,
  coalesceWrite,
  isExpired,
  notePointerUp,
  type OpenGesture,
} from './historyCoalesce';
import { AnimationType, TransitionType, type VideoSegment } from '../types';

function seg(
  id: string, startTime: number, duration: number, extra: Partial<VideoSegment> = {},
): VideoSegment {
  return {
    id, text: `t-${id}`, startTime, duration,
    transition: TransitionType.NONE, animation: AnimationType.NONE,
    order: 0, anchorStart: startTime, ...extra,
  };
}

// ---------------------------------------------------------------------------
// PART 1 — lock conflict
// ---------------------------------------------------------------------------

describe('PART 1 — lock conflict blocks a traversal', () => {
  it('no locks means no conflict, however much moved', () => {
    const current = [seg('A', 0, 5), seg('B', 5, 5)];
    const target = [seg('A', 0, 9), seg('B', 9, 1)];
    expect(findLockConflict(current, target)).toBeNull();
  });

  it('a locked segment that does NOT move is not a conflict', () => {
    const current = [seg('A', 0, 5), seg('B', 5, 5, { locked: true })];
    const target = [seg('A', 0, 5), seg('B', 5, 5, { locked: true })];
    expect(findLockConflict(current, target)).toBeNull();
  });

  it('a locked segment whose startTime would move IS a conflict', () => {
    const current = [seg('A', 0, 5), seg('B', 5, 5, { locked: true })];
    const target = [seg('A', 0, 3), seg('B', 3, 5, { locked: true })];
    const c = findLockConflict(current, target)!;
    expect(c.segmentId).toBe('B');
    expect(c.index).toBe(1);
    expect(c.count).toBe(1);
  });

  it('a locked segment whose duration would move IS a conflict', () => {
    const current = [seg('A', 0, 5, { locked: true })];
    const target = [seg('A', 0, 7, { locked: true })];
    expect(findLockConflict(current, target)!.segmentId).toBe('A');
  });

  it('LOCKED-IN-CURRENT is the test, not locked-in-the-entry', () => {
    // A lock is a statement about the timeline as it stands NOW. It also makes the
    // check symmetric under redo: the same pair of states blocks both ways.
    const lockedNow = [seg('A', 0, 5, { locked: true })];
    const unlockedThen = [seg('A', 0, 8)];
    expect(findLockConflict(lockedNow, unlockedThen)).not.toBeNull();
    // And the mirror: locked only in the stored entry does NOT block.
    expect(findLockConflict([seg('A', 0, 5)], [seg('A', 0, 8, { locked: true })])).toBeNull();
  });

  it('reports the FIRST offender but counts them all', () => {
    const current = [
      seg('A', 0, 5, { locked: true }), seg('B', 5, 5), seg('C', 10, 5, { locked: true }),
    ];
    const target = [
      seg('A', 0, 4, { locked: true }), seg('B', 4, 5), seg('C', 9, 6, { locked: true }),
    ];
    const c = findLockConflict(current, target)!;
    expect(c.segmentId).toBe('A');
    expect(c.count).toBe(2);
    expect(lockConflictMessage(c)).toBe('Segment 1 is locked. Unlock to undo this change. (+1 more locked)');
  });

  it('the single-offender message is the wording the owner specified', () => {
    const c = { segmentId: 'B', index: 11, count: 1 };
    expect(lockConflictMessage(c)).toBe('Segment 12 is locked. Unlock to undo this change.');
  });

  it('a segment ABSENT from the target is not a conflict — the Apply Sync boundary', () => {
    // Apply Sync mints an entirely new id set. Refusing to undo it because a
    // locked segment "disappeared" would make the single most valuable undo in
    // the app permanently unreachable.
    const current = [seg('old-1', 0, 5, { locked: true }), seg('old-2', 5, 5)];
    const target = [seg('new-1', 0, 3), seg('new-2', 3, 7)];
    expect(findLockConflict(current, target)).toBeNull();
  });

  it('ONLY timing is considered — a locked segment may still have other fields undone', () => {
    // A lock has never meant "freeze every field": `computeDragCascade`'s wall,
    // `applyAnchorBasedTiming`'s wall and `canLockSegment` all treat it as
    // position-only. Blocking a grade or overlay-text undo would make it a
    // general-purpose freeze it is nowhere else in the pipeline.
    const current = [seg('A', 0, 5, {
      locked: true,
      overlayFilter: 'sepia',
      effectGrade: { brightness: 0.5, contrast: 0, saturation: 0, temperature: 0 },
    })];
    const target = [seg('A', 0, 5, { locked: true })];
    expect(findLockConflict(current, target)).toBeNull();
  });

  it('a sub-nanosecond difference is not a move (float noise, not an edit)', () => {
    const current = [seg('A', 0, 5, { locked: true })];
    const target = [seg('A', 1e-12, 5 - 1e-12, { locked: true })];
    expect(findLockConflict(current, target)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PART 2 — anchor scroll decision
// ---------------------------------------------------------------------------

describe('PART 2 — scroll ONLY if off-screen', () => {
  const base = { pixelsPerSecond: 100, clientWidth: 800, totalDuration: 60 };

  it('an on-screen segment returns null — no scroll at all', () => {
    // The owner's ruling, and the thing that keeps undo from feeling haunted.
    expect(resolveOffscreenScrollLeft({
      ...base, segmentStartTime: 2, segmentDuration: 2, scrollLeft: 0,
    })).toBeNull();
  });

  it('a segment flush against each visible edge is still on-screen', () => {
    // Boundary exactness: left === scrollLeft and right === viewRight both count
    // as visible, so a segment perfectly filling the viewport does not scroll.
    expect(resolveOffscreenScrollLeft({
      ...base, segmentStartTime: 0, segmentDuration: 8, scrollLeft: 0,
    })).toBeNull();
  });

  it('a segment off the LEFT scrolls back to it, with margin', () => {
    const x = resolveOffscreenScrollLeft({
      ...base, segmentStartTime: 1, segmentDuration: 2, scrollLeft: 500,
    });
    expect(x).toBe(100 - 24); // left(100px) - MARGIN
  });

  it('a segment off the RIGHT scrolls forward to it, with margin', () => {
    const x = resolveOffscreenScrollLeft({
      ...base, segmentStartTime: 20, segmentDuration: 2, scrollLeft: 0,
    });
    expect(x).toBe(2200 - 800 + 24); // right - clientWidth + MARGIN
  });

  it('never scrolls past the content end, or before 0', () => {
    // Clamped against CONTENT width, not scrollWidth — the decorative ruler
    // overflows the content and clamping to scrollWidth once let segment 1
    // scroll off the left edge.
    const maxScroll = 60 * 100 - 800; // 5200
    expect(resolveOffscreenScrollLeft({
      ...base, segmentStartTime: 59, segmentDuration: 1, scrollLeft: 0,
    })).toBe(maxScroll);
    expect(resolveOffscreenScrollLeft({
      ...base, segmentStartTime: 0, segmentDuration: 0.1, scrollLeft: 400,
    })).toBe(0); // 0 - 24 would be negative
  });

  it('when the content fits the viewport, any scroll target clamps to 0', () => {
    expect(resolveOffscreenScrollLeft({
      pixelsPerSecond: 10, clientWidth: 800, totalDuration: 20,
      segmentStartTime: 19, segmentDuration: 1, scrollLeft: 0,
    })).toBeNull(); // 190..200 is inside 0..800 anyway
  });
});

// ---------------------------------------------------------------------------
// PART 3 — coalescing
// ---------------------------------------------------------------------------

describe('PART 3 — one entry per gesture', () => {
  it('a discrete action always pushes and closes any open gesture', () => {
    const open: OpenGesture = { key: 'grade:s1', kind: 'slider', lastWriteMs: 1000 };
    const r = coalesceWrite({ open, nowMs: 1010 });
    expect(r.decision).toBe('push');
    expect(r.open).toBeNull();
  });

  it('a slider gesture: first write pushes, all later writes replace', () => {
    let open: OpenGesture | null = null;
    const decisions: string[] = [];
    for (let i = 0; i < 30; i++) {
      const r = coalesceWrite({ open, key: 'grade:s1', kind: 'slider', nowMs: 1000 + i * 120 });
      decisions.push(r.decision);
      open = r.open;
    }
    expect(decisions[0]).toBe('push');
    expect(decisions.slice(1).every(d => d === 'replace')).toBe(true);
  });

  it('a slider is NOT idle-bounded — holding the handle still is one gesture', () => {
    // The reason a release, not a timer, ends a slider gesture: a slow deliberate
    // drag that pauses would otherwise split into two entries.
    let open: OpenGesture | null = coalesceWrite({
      open: null, key: 'grade:s1', kind: 'slider', nowMs: 0,
    }).open;
    const r = coalesceWrite({ open, key: 'grade:s1', kind: 'slider', nowMs: 60_000 });
    expect(r.decision).toBe('replace');
    open = r.open;
    expect(open).not.toBeNull();
  });

  it('a slider closes after pointerup PLUS the grace period, not at pointerup', () => {
    // The trailing-write problem: EffectsPanel debounces grade writes at 120ms, so
    // the LAST write of a gesture lands after the release. Closing hard at
    // pointerup would push it as a spurious second entry.
    let open = coalesceWrite({ open: null, key: 'grade:s1', kind: 'slider', nowMs: 1000 }).open!;
    open = notePointerUp(open, 2000)!;
    expect(open.releasedAtMs).toBe(2000);
    // The 120ms-late debounced write still belongs to this gesture.
    const trailing = coalesceWrite({ open, key: 'grade:s1', kind: 'slider', nowMs: 2120 });
    expect(trailing.decision).toBe('replace');
    // Past the grace period, a new write is a new gesture.
    const later = coalesceWrite({
      open, key: 'grade:s1', kind: 'slider', nowMs: 2000 + SLIDER_RELEASE_GRACE_MS + 1,
    });
    expect(later.decision).toBe('push');
  });

  it('the grace period exceeds EffectsPanel\'s 120ms grade debounce', () => {
    // Stated as an assertion because that is the constant this one is calibrated
    // against — if the debounce is ever raised, this fails rather than silently
    // producing one spurious entry per slider gesture.
    expect(SLIDER_RELEASE_GRACE_MS).toBeGreaterThan(120);
  });

  it('notePointerUp is idempotent and ignores non-slider gestures', () => {
    const slider = coalesceWrite({ open: null, key: 'k', kind: 'slider', nowMs: 100 }).open!;
    const once = notePointerUp(slider, 200)!;
    expect(notePointerUp(once, 900)!.releasedAtMs).toBe(200); // not re-stamped
    const text = coalesceWrite({ open: null, key: 't', kind: 'text', nowMs: 100 }).open!;
    expect(notePointerUp(text, 200)).toBe(text);
    expect(notePointerUp(null, 200)).toBeNull();
  });

  it('a text gesture is idle-bounded at exactly TEXT_IDLE_MS', () => {
    const open = coalesceWrite({ open: null, key: 'name', kind: 'text', nowMs: 1000 }).open!;
    // Exactly at the boundary is still the same gesture; one ms past is not.
    expect(isExpired(open, 1000 + TEXT_IDLE_MS)).toBe(false);
    expect(isExpired(open, 1000 + TEXT_IDLE_MS + 1)).toBe(true);
    expect(coalesceWrite({ open, key: 'name', kind: 'text', nowMs: 1400 }).decision).toBe('replace');
    expect(coalesceWrite({ open, key: 'name', kind: 'text', nowMs: 1600 }).decision).toBe('push');
  });

  it('typing keeps a text gesture alive — the window is per-write, not per-gesture', () => {
    let open: OpenGesture | null = null;
    let pushes = 0;
    // 40 keystrokes 100ms apart: one entry, even though the total spans 4s.
    for (let i = 0; i < 40; i++) {
      const r = coalesceWrite({ open, key: 'name', kind: 'text', nowMs: i * 100 });
      if (r.decision === 'push') pushes++;
      open = r.open;
    }
    expect(pushes).toBe(1);
  });

  it('a DIFFERENT key opens a new entry immediately', () => {
    // What makes "brightness on segment 5, then segment 9" two entries.
    const open = coalesceWrite({ open: null, key: 'grade:s5', kind: 'slider', nowMs: 0 }).open!;
    const r = coalesceWrite({ open, key: 'grade:s9', kind: 'slider', nowMs: 10 });
    expect(r.decision).toBe('push');
    expect(r.open!.key).toBe('grade:s9');
  });

  it('an interleaved discrete action prevents two slider gestures merging', () => {
    let open = coalesceWrite({ open: null, key: 'grade:s1', kind: 'slider', nowMs: 0 }).open;
    open = coalesceWrite({ open, nowMs: 10 }).open;             // discrete: closes
    const again = coalesceWrite({ open, key: 'grade:s1', kind: 'slider', nowMs: 20 });
    expect(again.decision).toBe('push');
  });
});

// ---------------------------------------------------------------------------
// PART 4 — history anchor action (Stage 4, 2026-08-08 cleanup run)
//
// Timeline.tsx's undo/redo anchor effect had zero coverage before this run
// (grep for `historyAnchor` across every test file returned nothing) despite
// being exactly the path an Apply Sync creates: a stale anchor pointing at a
// segment id that no longer exists once the whole id set is regenerated.
// `resolveHistoryAnchorAction` is a behavior-preserving extraction of that
// effect's decision (segment lookup, degradation, and reuse of
// `resolveOffscreenScrollLeft` from PART 2 above) — no change intended here,
// only coverage of what was already there.
// ---------------------------------------------------------------------------

describe('PART 4 — history anchor action', () => {
  const segments = [seg('a', 0, 2), seg('b', 20, 2)];
  const scrollBase = {
    pixelsPerSecond: 100, clientWidth: 800, totalDuration: 60, scrollLeft: 0,
  };

  it('no anchor at all: no segment, no scroll', () => {
    const action = resolveHistoryAnchorAction({
      historyAnchor: null, segments, canScroll: true, ...scrollBase,
    });
    expect(action).toEqual({ segmentId: null, scrollTo: null });
  });

  it('a stale anchor whose segment id no longer resolves degrades to no-scroll, no throw — the exact path an Apply Sync creates', () => {
    expect(() => resolveHistoryAnchorAction({
      historyAnchor: { segmentId: 'does-not-exist', nonce: 1 },
      segments,
      canScroll: true,
      ...scrollBase,
    })).not.toThrow();

    const action = resolveHistoryAnchorAction({
      historyAnchor: { segmentId: 'does-not-exist', nonce: 1 },
      segments,
      canScroll: true,
      ...scrollBase,
    });
    expect(action).toEqual({ segmentId: null, scrollTo: null });
  });

  it('a resolvable, off-screen anchor scrolls', () => {
    // Segment 'b' spans [20s, 22s) * 100px/s = [2000px, 2200px), well past an
    // 800px viewport — right edge (2200) drives the scroll target.
    const action = resolveHistoryAnchorAction({
      historyAnchor: { segmentId: 'b', nonce: 1 },
      segments,
      canScroll: true,
      ...scrollBase,
    });
    expect(action.segmentId).toBe('b');
    expect(action.scrollTo).toBe(2200 - 800 + 24); // matches resolveOffscreenScrollLeft's own margin math
  });

  it('a resolvable, already-visible anchor does not scroll but still resolves the segment (caller flashes regardless of scrollTo)', () => {
    // Segment 'a' starts at 0 — inside the 0..800px viewport already.
    const action = resolveHistoryAnchorAction({
      historyAnchor: { segmentId: 'a', nonce: 1 },
      segments,
      canScroll: true,
      ...scrollBase,
    });
    expect(action.segmentId).toBe('a');
    expect(action.scrollTo).toBeNull();
  });

  it('canScroll: false (no container yet, or reload restore not applied) still resolves the segment, but never computes a scroll target', () => {
    // Mirrors Timeline.tsx's `container && didRestoreRef.current` gate — the
    // segment can resolve and the caller can still flash it even when the
    // scroll container is not ready to be scrolled.
    const action = resolveHistoryAnchorAction({
      historyAnchor: { segmentId: 'b', nonce: 1 },
      segments,
      canScroll: false,
      ...scrollBase,
    });
    expect(action.segmentId).toBe('b');
    expect(action.scrollTo).toBeNull();
  });
});
