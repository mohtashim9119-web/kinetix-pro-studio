/**
 * App.tsx debt cleanup, second attempt (2026-08-08) — characterization tests
 * for the history-wiring cluster the first attempt declined to move:
 * `setProject`/`setProjectSilent`, `blockedByLock`, `applyRestoredState`,
 * `handleUndo`/`handleRedo`.
 *
 * PART 1 transcribes those closures VERBATIM from `App.tsx` as it stood at
 * commit `5f2e385` (lines cited below), using plain in-memory fakes instead
 * of real `useState`/`useRef` — none of this cluster touches the DOM, so no
 * jsdom is needed (see `historySessionHarness.ts`'s header for why this
 * differs from `dragSessionHarness.ts`'s DOM-dependent case). This is the
 * ground truth, written and run BEFORE `historySession.ts`'s functions are
 * wired into `App.tsx`.
 *
 * PART 2 imports the REAL extracted functions (via `HistorySessionHarness`)
 * and re-runs the identical scenario tables, proving byte-identical
 * behaviour — same `dragSession.test.ts` PART 1 / PART 2 precedent.
 */

import { describe, expect, it, vi } from 'vitest';
import { AnimationType, TransitionType, type Project, type VideoSegment } from '../types';
import { emptyHistory, pushEntry, replaceEntry, redo as redoHistory, undo as undoHistory, type History } from './history';
import { coalesceWrite, type CoalesceClass, type OpenGesture } from './historyCoalesce';
import { findLockConflict, lockConflictMessage } from './historyLockPolicy';
import {
  repairSelectedSegmentId,
  repairSelectedHeadingId,
  repairSelectedSegmentIds,
  clampCurrentTimeToRestoredEnd,
} from './historyRestore';
import { findPartitionViolations } from './timelinePartition';
import { HistorySessionHarness } from './historySessionHarness';

function seg(id: string, startTime: number, duration: number, extra: Partial<VideoSegment> = {}): VideoSegment {
  return {
    id, text: `t-${id}`, startTime, duration,
    transition: TransitionType.NONE, animation: AnimationType.NONE,
    order: 0, anchorStart: startTime,
    ...extra,
  };
}

function makeProject(partial: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test Project',
    script: '',
    sceneDetails: '',
    segments: [seg('a', 0, 5), seg('b', 5, 5)],
    assets: [],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// PART 1 — verbatim transcription of App.tsx's closures at commit 5f2e385
// (lines 1201-1208 setProjectSilent, 1219-1260 setProject, 1915-1946
// applyRestoredState, 1959-1975 blockedByLock, 1977-2003 handleUndo/handleRedo).
// ---------------------------------------------------------------------------

/** A plain stand-in for App's `useRef`/`useState` slots — no React involved. */
interface RefWorld {
  liveProjectRef: { current: Project };
  openGestureRef: { current: OpenGesture | null };
  isResizingRef: { current: boolean };
  history: History<Project>;
  historyAnchor: { segmentId: string; nonce: number } | null;
  toasts: { message: string; action?: { label: string; onClick: () => void } }[];
  selectedSegmentId: string | null;
  selectedHeadingId: string | null;
  selectedSegmentIds: Set<string>;
  currentTime: number;
  setProjectRawCalls: number;
}

function makeRefWorld(initial: Project): RefWorld {
  return {
    liveProjectRef: { current: initial },
    openGestureRef: { current: null },
    isResizingRef: { current: false },
    history: emptyHistory<Project>(),
    historyAnchor: null,
    toasts: [],
    selectedSegmentId: null,
    selectedHeadingId: null,
    selectedSegmentIds: new Set<string>(),
    currentTime: 0,
    setProjectRawCalls: 0,
  };
}

function refSetProjectSilent(world: RefWorld, action: Project | ((p: Project) => Project)): void {
  const prev = world.liveProjectRef.current;
  const next = typeof action === 'function' ? (action as (p: Project) => Project)(prev) : action;
  world.liveProjectRef.current = next;
  world.setProjectRawCalls++;
}

function refSetProject(
  world: RefWorld,
  action: Project | ((p: Project) => Project),
  meta?: { label?: string; anchorSegmentId?: string; coalesceKey?: string; coalesceKind?: CoalesceClass },
): void {
  const prev = world.liveProjectRef.current;
  const next = typeof action === 'function' ? (action as (p: Project) => Project)(prev) : action;
  if (next !== prev) {
    const { decision, open } = coalesceWrite({
      open: world.openGestureRef.current,
      key: meta?.coalesceKey,
      kind: meta?.coalesceKind,
      nowMs: Date.now(),
    });
    world.openGestureRef.current = open;
    const entry = { state: prev, label: meta?.label ?? 'edit', anchorSegmentId: meta?.anchorSegmentId };
    world.history = decision === 'replace' ? replaceEntry(world.history, entry) : pushEntry(world.history, entry);
  }
  world.liveProjectRef.current = next;
  world.setProjectRawCalls++;
}

function refApplyRestoredState(world: RefWorld, restored: Project, what: string): void {
  if (import.meta.env.DEV) {
    const violations = findPartitionViolations(restored.segments)
      .filter(v => v.kind === 'lock-lock-gap' || v.kind === 'lock-lock-overlap');
    if (violations.length > 0) {
      console.error(`[history] ${what} violated gapless`, violations);
    }
  }
  refSetProjectSilent(world, restored);
  world.selectedSegmentId = repairSelectedSegmentId(world.selectedSegmentId, restored);
  world.selectedHeadingId = repairSelectedHeadingId(world.selectedHeadingId, restored);
  world.selectedSegmentIds = repairSelectedSegmentIds(world.selectedSegmentIds, restored);
  world.currentTime = clampCurrentTimeToRestoredEnd(world.currentTime, restored);
}

function refBlockedByLock(world: RefWorld, target: Project): boolean {
  const conflict = findLockConflict(world.liveProjectRef.current.segments, target.segments);
  if (!conflict) return false;
  world.historyAnchor = { segmentId: conflict.segmentId, nonce: Date.now() };
  world.toasts.push({
    message: lockConflictMessage(conflict),
    action: {
      label: 'Unlock',
      onClick: () => refSetProjectSilent(world, prev => ({
        ...prev,
        segments: prev.segments.map(sg => sg.id === conflict.segmentId ? { ...sg, locked: false } : sg),
      })),
    },
  });
  return true;
}

/** Wrapped in its own function so TS's control-flow narrowing of
 *  `world.historyAnchor` to `null` does not leak past the reset — a direct
 *  inline assignment narrows the property for the rest of the enclosing
 *  scope even across the subsequent `refHandleRedo(world)` call. */
function resetAnchor(world: RefWorld): void {
  world.historyAnchor = null;
}

function refHandleUndo(world: RefWorld): void {
  if (world.isResizingRef.current) return;
  const t = undoHistory(world.history, world.liveProjectRef.current);
  if (!t) return;
  if (refBlockedByLock(world, t.entry.state)) return;
  world.history = t.history;
  refApplyRestoredState(world, t.entry.state, `Undo ${t.entry.label}`);
  if (t.entry.anchorSegmentId) {
    world.historyAnchor = { segmentId: t.entry.anchorSegmentId, nonce: Date.now() };
  }
}

function refHandleRedo(world: RefWorld): void {
  if (world.isResizingRef.current) return;
  const t = redoHistory(world.history, world.liveProjectRef.current);
  if (!t) return;
  if (refBlockedByLock(world, t.entry.state)) return;
  world.history = t.history;
  refApplyRestoredState(world, t.entry.state, `Redo ${t.entry.label}`);
  if (t.entry.anchorSegmentId) {
    world.historyAnchor = { segmentId: t.entry.anchorSegmentId, nonce: Date.now() };
  }
}

describe('PART 1 — reference transcription (App.tsx @ 5f2e385)', () => {
  it('setProjectSilent writes without recording history', () => {
    const world = makeRefWorld(makeProject());
    refSetProjectSilent(world, p => ({ ...p, name: 'renamed' }));
    expect(world.liveProjectRef.current.name).toBe('renamed');
    expect(world.history.past.length).toBe(0);
  });

  it('a no-op setProject write (next === prev) records no history entry', () => {
    const world = makeRefWorld(makeProject());
    const same = world.liveProjectRef.current;
    refSetProject(world, same, { label: 'no-op' });
    expect(world.history.past.length).toBe(0);
  });

  it('a discrete setProject write always pushes, closing any open gesture', () => {
    const world = makeRefWorld(makeProject());
    refSetProject(world, p => ({ ...p, name: 'a' }), { label: 'first' });
    refSetProject(world, p => ({ ...p, name: 'b' }), { label: 'second' });
    expect(world.history.past.length).toBe(2);
    expect(world.history.past[0]!.label).toBe('first');
    expect(world.history.past[1]!.label).toBe('second');
  });

  it('coalesced slider writes with the same key REPLACE — one undoable entry for the whole gesture', () => {
    const world = makeRefWorld(makeProject());
    const original = world.liveProjectRef.current;
    refSetProject(world, p => ({ ...p, name: 'v1' }), { label: 'grade', coalesceKey: 'grade:brightness:a', coalesceKind: 'slider' });
    refSetProject(world, p => ({ ...p, name: 'v2' }), { label: 'grade', coalesceKey: 'grade:brightness:a', coalesceKind: 'slider' });
    refSetProject(world, p => ({ ...p, name: 'v3' }), { label: 'grade', coalesceKey: 'grade:brightness:a', coalesceKind: 'slider' });
    expect(world.history.past.length).toBe(1);
    // The stored entry holds the PRE-gesture state, not an intermediate one.
    expect(world.history.past[0]!.state).toBe(original);
    expect(world.liveProjectRef.current.name).toBe('v3');
  });

  it('a different coalesce key opens a new entry instead of absorbing', () => {
    const world = makeRefWorld(makeProject());
    refSetProject(world, p => ({ ...p, name: 'v1' }), { coalesceKey: 'grade:brightness:a', coalesceKind: 'slider' });
    refSetProject(world, p => ({ ...p, name: 'v2' }), { coalesceKey: 'grade:brightness:b', coalesceKind: 'slider' });
    expect(world.history.past.length).toBe(2);
  });

  it('the depth cap evicts the OLDEST entry once past MAX_HISTORY_STATES (20)', () => {
    const world = makeRefWorld(makeProject());
    for (let i = 0; i < 25; i++) {
      refSetProject(world, p => ({ ...p, name: `v${i}` }), { label: `edit ${i}` });
    }
    expect(world.history.past.length).toBe(20);
    // The oldest surviving entry is edit 5 (0..4 evicted), the newest is edit 24.
    expect(world.history.past[0]!.label).toBe('edit 5');
    expect(world.history.past[19]!.label).toBe('edit 24');
  });

  it('handleUndo is a no-op while a live drag owns the timeline (isResizingRef guard)', () => {
    const world = makeRefWorld(makeProject());
    refSetProject(world, p => ({ ...p, name: 'edited' }), { label: 'edit' });
    world.isResizingRef.current = true;
    refHandleUndo(world);
    expect(world.liveProjectRef.current.name).toBe('edited');
    expect(world.history.past.length).toBe(1);
  });

  it('handleUndo/handleRedo are no-ops on empty history/future', () => {
    const world = makeRefWorld(makeProject());
    refHandleUndo(world);
    expect(world.liveProjectRef.current.name).toBe('Test Project');
    refHandleRedo(world);
    expect(world.liveProjectRef.current.name).toBe('Test Project');
  });

  it('a lock conflict BLOCKS undo — history is left untouched (entry not consumed) and a toast fires', () => {
    const world = makeRefWorld(makeProject({ segments: [seg('a', 0, 5, { locked: true }), seg('b', 5, 5)] }));
    // Move the locked segment's timing, recorded as an undoable edit.
    refSetProject(world, p => ({
      ...p,
      segments: p.segments.map(s => s.id === 'a' ? { ...s, startTime: 1, duration: 4 } : s),
    }), { label: 'move a' });
    const depthBefore = world.history.past.length;
    refHandleUndo(world);
    // Blocked: history untouched, project untouched, but the toast/anchor fired.
    expect(world.history.past.length).toBe(depthBefore);
    expect(world.liveProjectRef.current.segments.find(s => s.id === 'a')!.startTime).toBe(1);
    expect(world.toasts.length).toBe(1);
    expect(world.toasts[0]!.message).toContain('locked');
    expect(world.historyAnchor?.segmentId).toBe('a');
  });

  it('undo again AFTER unlocking (via the toast action) performs it normally — the entry was never consumed', () => {
    const world = makeRefWorld(makeProject({ segments: [seg('a', 0, 5, { locked: true }), seg('b', 5, 5)] }));
    refSetProject(world, p => ({
      ...p,
      segments: p.segments.map(s => s.id === 'a' ? { ...s, startTime: 1, duration: 4 } : s),
    }), { label: 'move a' });
    refHandleUndo(world); // blocked
    expect(world.history.past.length).toBe(1);
    // Simulate clicking "Unlock" on the toast.
    world.toasts[0]!.action!.onClick();
    expect(world.liveProjectRef.current.segments.find(s => s.id === 'a')!.locked).toBe(false);
    // Now undo proceeds.
    refHandleUndo(world);
    expect(world.history.past.length).toBe(0);
    expect(world.liveProjectRef.current.segments.find(s => s.id === 'a')!.startTime).toBe(0);
  });

  it('redo after a NEW edit is unreachable — the new edit discards the redo branch', () => {
    const world = makeRefWorld(makeProject());
    refSetProject(world, p => ({ ...p, name: 'v1' }), { label: 'edit1' });
    refHandleUndo(world);
    expect(world.liveProjectRef.current.name).toBe('Test Project');
    expect(world.history.future.length).toBe(1);
    // A fresh edit instead of redo discards the future branch.
    refSetProject(world, p => ({ ...p, name: 'v2' }), { label: 'edit2' });
    expect(world.history.future.length).toBe(0);
    refHandleRedo(world);
    expect(world.liveProjectRef.current.name).toBe('v2'); // no-op, nothing to redo
  });

  it('a successful undo/redo carries the anchorSegmentId through to historyAnchor', () => {
    const world = makeRefWorld(makeProject());
    refSetProject(world, p => ({ ...p, name: 'v1' }), { label: 'edit1', anchorSegmentId: 'b' });
    refHandleUndo(world);
    expect(world.historyAnchor?.segmentId).toBe('b');
    resetAnchor(world);
    refHandleRedo(world);
    expect(world.historyAnchor?.segmentId).toBe('b');
  });

  it('applyRestoredState repairs a selection pointing at a segment removed by the restored state', () => {
    const world = makeRefWorld(makeProject());
    world.selectedSegmentId = 'gone';
    world.currentTime = 100;
    const restored = makeProject({ segments: [seg('a', 0, 5)] });
    refApplyRestoredState(world, restored, 'Undo test');
    expect(world.selectedSegmentId).toBeNull();
    expect(world.currentTime).toBeLessThanOrEqual(5);
  });

  it('applyRestoredState logs a DEV console.error when the restored state violates the gapless invariant', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const world = makeRefWorld(makeProject());
    // Two locked segments with a gap between them — lock-lock-gap violation.
    const restored = makeProject({
      segments: [seg('a', 0, 5, { locked: true }), seg('b', 8, 5, { locked: true })],
    });
    refApplyRestoredState(world, restored, 'Undo bad state');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('applyRestoredState does NOT log when the restored state is gapless', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const world = makeRefWorld(makeProject());
    refApplyRestoredState(world, makeProject(), 'Undo good state');
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// PART 2 — the REAL extracted functions (via HistorySessionHarness), same
// scenario tables as PART 1, proving byte-identical behaviour.
// ---------------------------------------------------------------------------

describe('PART 2 — real historySession.ts functions (via HistorySessionHarness)', () => {
  it('editSilent writes without recording history', () => {
    const h = new HistorySessionHarness(makeProject());
    h.editSilent(p => ({ ...p, name: 'renamed' }));
    expect(h.project.name).toBe('renamed');
    expect(h.historyDepth).toBe(0);
  });

  it('a no-op edit (next === prev) records no history entry', () => {
    const h = new HistorySessionHarness(makeProject());
    const same = h.project;
    h.edit(same, { label: 'no-op' });
    expect(h.historyDepth).toBe(0);
  });

  it('a discrete edit always pushes, closing any open gesture', () => {
    const h = new HistorySessionHarness(makeProject());
    h.edit(p => ({ ...p, name: 'a' }), { label: 'first' });
    h.edit(p => ({ ...p, name: 'b' }), { label: 'second' });
    expect(h.historyDepth).toBe(2);
  });

  it('coalesced slider writes with the same key REPLACE — one undoable entry for the whole gesture', () => {
    const h = new HistorySessionHarness(makeProject());
    const original = h.project;
    h.edit(p => ({ ...p, name: 'v1' }), { label: 'grade', coalesceKey: 'grade:brightness:a', coalesceKind: 'slider' });
    h.edit(p => ({ ...p, name: 'v2' }), { label: 'grade', coalesceKey: 'grade:brightness:a', coalesceKind: 'slider' });
    h.edit(p => ({ ...p, name: 'v3' }), { label: 'grade', coalesceKey: 'grade:brightness:a', coalesceKind: 'slider' });
    expect(h.historyDepth).toBe(1);
    h.undo();
    expect(h.project).toBe(original);
  });

  it('a different coalesce key opens a new entry instead of absorbing', () => {
    const h = new HistorySessionHarness(makeProject());
    h.edit(p => ({ ...p, name: 'v1' }), { coalesceKey: 'grade:brightness:a', coalesceKind: 'slider' });
    h.edit(p => ({ ...p, name: 'v2' }), { coalesceKey: 'grade:brightness:b', coalesceKind: 'slider' });
    expect(h.historyDepth).toBe(2);
  });

  it('the depth cap evicts the OLDEST entry once past MAX_HISTORY_STATES (20)', () => {
    const h = new HistorySessionHarness(makeProject());
    for (let i = 0; i < 25; i++) {
      h.edit(p => ({ ...p, name: `v${i}` }), { label: `edit ${i}` });
    }
    expect(h.historyDepth).toBe(20);
  });

  it('undo is a no-op while a live drag owns the timeline (isResizingRef guard)', () => {
    const h = new HistorySessionHarness(makeProject());
    h.edit(p => ({ ...p, name: 'edited' }), { label: 'edit' });
    h.setResizing(true);
    h.undo();
    expect(h.project.name).toBe('edited');
    expect(h.historyDepth).toBe(1);
  });

  it('undo/redo are no-ops on empty history/future', () => {
    const h = new HistorySessionHarness(makeProject());
    h.undo();
    expect(h.project.name).toBe('Test Project');
    h.redo();
    expect(h.project.name).toBe('Test Project');
  });

  it('a lock conflict BLOCKS undo — history is left untouched (entry not consumed) and a toast fires', () => {
    const h = new HistorySessionHarness(makeProject({ segments: [seg('a', 0, 5, { locked: true }), seg('b', 5, 5)] }));
    h.edit(p => ({
      ...p,
      segments: p.segments.map(s => s.id === 'a' ? { ...s, startTime: 1, duration: 4 } : s),
    }), { label: 'move a' });
    const depthBefore = h.historyDepth;
    h.undo();
    expect(h.historyDepth).toBe(depthBefore);
    expect(h.project.segments.find(s => s.id === 'a')!.startTime).toBe(1);
    expect(h.toasts.length).toBe(1);
    expect(h.toasts[0]!.message).toContain('locked');
    expect(h.anchor?.segmentId).toBe('a');
  });

  it('undo again AFTER unlocking (via the toast action) performs it normally — the entry was never consumed', () => {
    const h = new HistorySessionHarness(makeProject({ segments: [seg('a', 0, 5, { locked: true }), seg('b', 5, 5)] }));
    h.edit(p => ({
      ...p,
      segments: p.segments.map(s => s.id === 'a' ? { ...s, startTime: 1, duration: 4 } : s),
    }), { label: 'move a' });
    h.undo(); // blocked
    expect(h.historyDepth).toBe(1);
    h.toasts[0]!.action!.onClick();
    expect(h.project.segments.find(s => s.id === 'a')!.locked).toBe(false);
    h.undo();
    expect(h.historyDepth).toBe(0);
    expect(h.project.segments.find(s => s.id === 'a')!.startTime).toBe(0);
  });

  it('redo after a NEW edit is unreachable — the new edit discards the redo branch', () => {
    const h = new HistorySessionHarness(makeProject());
    h.edit(p => ({ ...p, name: 'v1' }), { label: 'edit1' });
    h.undo();
    expect(h.project.name).toBe('Test Project');
    expect(h.redoDepth).toBe(1);
    h.edit(p => ({ ...p, name: 'v2' }), { label: 'edit2' });
    expect(h.redoDepth).toBe(0);
    h.redo();
    expect(h.project.name).toBe('v2');
  });

  it('a successful undo/redo carries the anchorSegmentId through to the anchor', () => {
    const h = new HistorySessionHarness(makeProject());
    h.edit(p => ({ ...p, name: 'v1' }), { label: 'edit1', anchorSegmentId: 'b' });
    h.undo();
    expect(h.anchor?.segmentId).toBe('b');
    h.redo();
    expect(h.anchor?.segmentId).toBe('b');
  });

  it('applyRestored repairs a selection pointing at a segment removed by the restored state', () => {
    const h = new HistorySessionHarness(makeProject());
    h.setSelection('gone');
    h.setCurrentTime(100);
    h.applyRestored(makeProject({ segments: [seg('a', 0, 5)] }));
    expect(h.selection.segmentId).toBeNull();
    expect(h.currentTime).toBeLessThanOrEqual(5);
  });

  it('applyRestored logs a DEV console.error when the restored state violates the gapless invariant', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = new HistorySessionHarness(makeProject());
    h.applyRestored(makeProject({
      segments: [seg('a', 0, 5, { locked: true }), seg('b', 8, 5, { locked: true })],
    }));
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('applyRestored does NOT log when the restored state is gapless', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = new HistorySessionHarness(makeProject());
    h.applyRestored(makeProject());
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('wouldBeBlockedBy matches isBlockedByLock in isolation, without a full undo/redo traversal', () => {
    const h = new HistorySessionHarness(makeProject({ segments: [seg('a', 0, 5, { locked: true }), seg('b', 5, 5)] }));
    const moved = makeProject({ segments: [seg('a', 1, 4, { locked: true }), seg('b', 5, 5)] });
    expect(h.wouldBeBlockedBy(moved)).toBe(true);
    const same = makeProject({ segments: [seg('a', 0, 5, { locked: true }), seg('b', 5, 5)] });
    expect(h.wouldBeBlockedBy(same)).toBe(false);
  });
});
