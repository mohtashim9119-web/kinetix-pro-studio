/**
 * WS2 Task 1 — characterization tests for the timeline drag SESSION, written
 * BEFORE `src/services/dragSession.ts` exists (Stage 2 of the extraction).
 *
 * Context: the pure timing/geometry math for a segment-resize drag was already
 * extracted in prior work — `computeDragCascade`/`resolveDragPreview`
 * (`dragCascade.ts`) and `resolveDragEdge`/`computeGrabOffsetPx`/
 * `timelineContentX`/`segmentEdgeContentX` (`dragGeometry.ts`) — and both are
 * already exhaustively tested in `dragCascade.test.ts`, `dragGeometry.test.ts`,
 * and `gaplessInvariant.test.ts`. This extraction (WS2 task 1) moves what is
 * LEFT: `App.tsx`'s `onResizeStart` handler (currently lines ~3977-4206), which
 * is pure DOM/event-listener orchestration gluing those already-tested pure
 * functions to `<Timeline>`'s pointer events. Neither `dragCascade.ts` nor
 * `dragGeometry.ts` is touched by this extraction, so their existing suites
 * remain a valid, unchanged regression net for the timing math the session
 * delegates to — this file does not re-test that math except where the
 * existing suite has a genuine gap (PART 0 below).
 *
 * The orchestration logic itself (element-id map, per-frame DOM-style diffing,
 * the commit/revert dispatch on release) has never been independently
 * testable — it lives inline inside an unexported JSX prop closure, and this
 * repo has no jsdom/testing-library/react-test-renderer (same documented gap
 * as `usePlayback.test.ts`/`useGlPreview.test.ts`/`useExport.test.ts`). Per
 * this repo's own established precedent for exactly this situation
 * (`dragGeometry.test.ts`'s PART 1, "the pre-K16 commit expression is
 * transcribed literally... from `App.tsx`'s `handleUp`"), PART 1 below
 * transcribes the relevant fragments of the CURRENT `onResizeStart` closure
 * verbatim (cited by line number against the pre-extraction file), using
 * plain duck-typed fake elements instead of real DOM nodes — the closure only
 * ever reads `.dataset.segId` and writes `.style.left`/`.style.width`, neither
 * of which requires jsdom.
 *
 * PART 2 (added in Stage 3, once `dragSession.ts` exists) imports the REAL
 * extracted functions and re-runs the identical scenario tables from PART 1,
 * proving the moved code produces byte-identical results. PART 1's tests are
 * never edited by that addition — they keep pinning the transcribed reference
 * exactly as the ONE RULE requires.
 */

import { describe, it, expect } from 'vitest';
import {
  computeDragCascade,
  resolveDragPreview,
} from './dragCascade';
import { resolveDragEdge, type DragEdgeResult, type DragEdge } from './dragGeometry';
import { checkTimelineIsGapless } from './timelinePartition';
import { TransitionType, AnimationType, type VideoSegment } from '../types';

function seg(
  id: string,
  startTime: number,
  duration: number,
  extra: Partial<VideoSegment> = {},
): VideoSegment {
  return {
    id,
    text: `text-${id}`,
    startTime,
    duration,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: 0,
    anchorStart: startTime,
    ...extra,
  };
}

const spans = (segs: VideoSegment[] | null): string =>
  segs === null
    ? 'BLOCKED'
    : segs.map(s => `${s.id}[${s.startTime.toFixed(2)}..${(s.startTime + s.duration).toFixed(2)}]`).join(' ');

const noBlock = (): void => {};

// ---------------------------------------------------------------------------
// PART 0 — a real coverage gap in the existing cascade suite: the drag path
// (not the sync path — `applyAnchorBasedTiming` already has this via
// gaplessInvariant.test.ts) with a lock on BOTH sides of the dragged segment.
// Pure `computeDragCascade`, already stable and unmoved by this extraction —
// this documents a scenario the task's checklist calls out by name.
// ---------------------------------------------------------------------------

describe('PART 0 — drag path, locks on both sides (new coverage, pre-existing pure function)', () => {
  it('a right-edge grow into a locked right neighbour is blocked, left lock irrelevant', () => {
    const arr = [seg('A', 0, 5, { locked: true }), seg('B', 5, 5), seg('C', 10, 5, { locked: true })];
    const blocked: number[] = [];
    const out = computeDragCascade(arr, 1, 6, 0, 'right', i => blocked.push(i));
    expect(out).toBeNull();
    expect(blocked).toEqual([2]);
  });

  it('a left-edge grow into a locked left neighbour is blocked, right lock irrelevant', () => {
    const arr = [seg('A', 0, 5, { locked: true }), seg('B', 5, 5), seg('C', 10, 5, { locked: true })];
    const blocked: number[] = [];
    const out = computeDragCascade(arr, 1, 6, 0, 'left', i => blocked.push(i));
    expect(out).toBeNull();
    expect(blocked).toEqual([0]);
  });

  it('even a SHRINK is blocked with locks on both sides — the freed time still has to cascade somewhere', () => {
    // B shrinking on a right-edge drag hands the freed span to C (the next
    // neighbour grows to absorb it, per computeDragCascade's `remaining > 0`
    // branch) — C being locked blocks that exactly like a grow would.
    const arr = [seg('A', 0, 5, { locked: true }), seg('B', 5, 5), seg('C', 10, 5, { locked: true })];
    const blocked: number[] = [];
    const out = computeDragCascade(arr, 1, 4, 0, 'right', i => blocked.push(i));
    expect(out).toBeNull();
    expect(blocked).toEqual([2]);
  });
});

// ---------------------------------------------------------------------------
// PART 1 — the DOM/session orchestration that IS moving, transcribed verbatim
// from `App.tsx`'s current `onResizeStart` (lines cited below against the
// pre-extraction file, tag `pre-dragsession-2026-08-07`).
// ---------------------------------------------------------------------------

/** A plain duck-typed stand-in for the DOM elements `onResizeStart` writes to.
 *  The real closure only ever touches `.dataset.segId` (read) and
 *  `.style.left`/`.style.width` (write) — no jsdom required. */
interface FakeElement {
  style: { left: string; width: string };
  dataset: { segId?: string };
}

function fakeEl(segId: string): FakeElement {
  return { style: { left: '', width: '' }, dataset: { segId } };
}

/**
 * Transcribed verbatim from `App.tsx:4008-4017` (pre-extraction), parameterized:
 * the real code iterates `timeline.querySelectorAll('[data-seg-id]')` — here
 * that NodeList is just passed in as `elements`.
 *
 *   const elsBySegId = new Map<string, HTMLElement[]>();
 *   for (const el of Array.from(timeline.querySelectorAll<HTMLElement>('[data-seg-id]'))) {
 *     const segId = el.dataset.segId;
 *     if (!segId) continue;
 *     const bucket = elsBySegId.get(segId);
 *     if (bucket) bucket.push(el);
 *     else elsBySegId.set(segId, [el]);
 *   }
 */
function referenceBuildSegIdElementMap(elements: FakeElement[]): Map<string, FakeElement[]> {
  const elsBySegId = new Map<string, FakeElement[]>();
  for (const el of elements) {
    const segId = el.dataset.segId;
    if (!segId) continue;
    const bucket = elsBySegId.get(segId);
    if (bucket) bucket.push(el);
    else elsBySegId.set(segId, [el]);
  }
  return elsBySegId;
}

/**
 * Transcribed verbatim from `App.tsx:4057-4091` (pre-extraction) — the
 * `writeGeometry` closure. The only change: the module-private mutable
 * `writtenIds` variable it closed over and reassigned (`writtenIds = moved;`)
 * is now the return value the caller reassigns instead.
 *
 *   const writeGeometry = (segs: VideoSegment[]): void => {
 *     const moved = new Set<string>();
 *     for (let i = 0; i < segs.length; i++) {
 *       const s = segs[i]!;
 *       const orig = originalSegments[i];
 *       if (!orig) continue;
 *       if (s.startTime === orig.startTime && s.duration === orig.duration) continue;
 *       const els = elsBySegId.get(s.id);
 *       if (!els) continue;
 *       const l = `${s.startTime * pps}px`;
 *       const w = `${s.duration * pps}px`;
 *       for (const el of els) { el.style.left = l; el.style.width = w; }
 *       moved.add(s.id);
 *     }
 *     for (const prevId of writtenIds) {
 *       if (moved.has(prevId)) continue;
 *       const orig = originalById.get(prevId);
 *       const els = elsBySegId.get(prevId);
 *       if (!orig || !els) continue;
 *       const l = `${orig.startTime * pps}px`;
 *       const w = `${orig.duration * pps}px`;
 *       for (const el of els) { el.style.left = l; el.style.width = w; }
 *     }
 *     writtenIds = moved;
 *   };
 */
function referenceWriteGeometry(
  segs: VideoSegment[],
  originalSegments: VideoSegment[],
  originalById: Map<string, VideoSegment>,
  elsBySegId: Map<string, FakeElement[]>,
  pps: number,
  writtenIds: Set<string>,
): Set<string> {
  const moved = new Set<string>();
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    const orig = originalSegments[i];
    if (!orig) continue;
    if (s.startTime === orig.startTime && s.duration === orig.duration) continue;
    const els = elsBySegId.get(s.id);
    if (!els) continue;
    const l = `${s.startTime * pps}px`;
    const w = `${s.duration * pps}px`;
    for (const el of els) {
      el.style.left = l;
      el.style.width = w;
    }
    moved.add(s.id);
  }
  for (const prevId of writtenIds) {
    if (moved.has(prevId)) continue;
    const orig = originalById.get(prevId);
    const els = elsBySegId.get(prevId);
    if (!orig || !els) continue;
    const l = `${orig.startTime * pps}px`;
    const w = `${orig.duration * pps}px`;
    for (const el of els) {
      el.style.left = l;
      el.style.width = w;
    }
  }
  return moved;
}

/**
 * HISTORICAL VALUE. `NEGLIGIBLE_DRAG_SEC` was withdrawn from production by
 * owner ruling on 2026-08-08 (manual triage F7: a drag that moved is committed
 * however small it was). It is inlined here because everything in this file is
 * a verbatim transcription of the PRE-EXTRACTION `App.tsx` closure, kept as the
 * historical record that WS2 task 1's move was faithful — that record has to go
 * on describing what the code did at the time, not what it does now. Nothing in
 * this file drives the real `startDragSession`; `dragSessionHarness.test.ts`
 * does, and its equivalents were re-derived to the new behaviour.
 */
const HISTORICAL_NEGLIGIBLE_DRAG_SEC = 0.01;

type CommitOutcome = 'no-op-not-moved' | 'reverted-negligible' | 'reverted-blocked' | 'committed';

/**
 * Transcribed verbatim from `App.tsx:4168-4197` (pre-extraction) — `handleUp`'s
 * commit-dispatch branch, with `resolveDragEdge`'s call and `applyDurationChange`
 * abstracted to explicit parameters (`final` and `commit`), both already-pure /
 * already-injectable in the real code.
 *
 *   if (!hasMoved) return;
 *   const final = resolveDragEdge({ ... });
 *   const speedUpdate = final.playbackSpeed === undefined ? undefined : { playbackSpeed: final.playbackSpeed };
 *   if (Math.abs(final.duration - originalTarget.duration) < NEGLIGIBLE_DRAG_SEC) {
 *     setProject(prev => ({ ...prev, segments: originalSegments }));
 *     return;
 *   }
 *   speedBaselineRef.current = null;
 *   const succeeded = applyDurationChange(originalSegments, id, final.duration, final.trimStart, direction, speedUpdate);
 *   if (!succeeded) setProject(prev => ({ ...prev, segments: originalSegments }));
 */
function referenceResolveCommitOutcome(
  hasMoved: boolean,
  final: DragEdgeResult,
  originalDuration: number,
  commit: () => boolean,
): CommitOutcome {
  if (!hasMoved) return 'no-op-not-moved';
  if (Math.abs(final.duration - originalDuration) < HISTORICAL_NEGLIGIBLE_DRAG_SEC) return 'reverted-negligible';
  const succeeded = commit();
  return succeeded ? 'committed' : 'reverted-blocked';
}

/**
 * Transcribed verbatim from `App.tsx:3977-3985` (pre-extraction) — the very
 * TOP of `onResizeStart`, before any validation. Pins a real, found-and-left
 * bug (documented in `project-state.md`): `setResizingId`/`setResizingType`/
 * the `resizing` body class are set UNCONDITIONALLY, before `draggedIdx`/
 * `originalTarget` are even looked up, and NOTHING clears them on the early
 * `return` that follows a lookup failure — `resizingId` and the body class
 * are left stuck. Not fixed here; the ONE RULE for this task is behaviour-
 * neutral extraction, and a fix would be a second, unverifiable change.
 *
 *   onResizeStart={(id, type, downClientX) => {
 *     setResizingId(id);
 *     setResizingType(type);
 *     document.body.classList.add('resizing');
 *     const originalSegments = projectRef.current.segments;
 *     const draggedIdx = originalSegments.findIndex(s => s.id === id);
 *     const originalTarget = originalSegments[draggedIdx];
 *     if (draggedIdx < 0 || !originalTarget) return;
 *     ...
 */
function referenceOnResizeStartTop(
  draggedIdx: number,
  calls: string[],
): 'validated' | 'bailed' {
  calls.push('setResizingId');
  calls.push('setResizingType');
  calls.push('classList.add(resizing)');
  if (draggedIdx < 0) return 'bailed';
  return 'validated';
}

describe('PART 1 — reference transcription of the current onResizeStart orchestration', () => {
  describe('elsBySegId construction', () => {
    it('groups multiple elements (thumbnail lane + waveform lane) under one segment id', () => {
      const els = [fakeEl('A'), fakeEl('B'), fakeEl('A')];
      const map = referenceBuildSegIdElementMap(els);
      expect(map.get('A')).toHaveLength(2);
      expect(map.get('B')).toHaveLength(1);
    });

    it('skips an element with no data-seg-id', () => {
      const withNoId: FakeElement = { style: { left: '', width: '' }, dataset: {} };
      const map = referenceBuildSegIdElementMap([fakeEl('A'), withNoId]);
      expect(map.size).toBe(1);
    });
  });

  describe('writeGeometry diffing', () => {
    it('writes left/width only for segments whose geometry actually changed', () => {
      const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
      const originalById = new Map(original.map(s => [s.id, s]));
      const els = new Map([
        ['A', [fakeEl('A')]],
        ['B', [fakeEl('B')]],
        ['C', [fakeEl('C')]],
      ]);
      const grown = [seg('A', 0, 6), seg('B', 6, 4), seg('C', 10, 5)];
      const written = referenceWriteGeometry(grown, original, originalById, els, 100, new Set());
      expect(written).toEqual(new Set(['A', 'B']));
      expect(els.get('A')![0]!.style.left).toBe('0px');
      expect(els.get('A')![0]!.style.width).toBe('600px');
      expect(els.get('B')![0]!.style.left).toBe('600px');
      expect(els.get('B')![0]!.style.width).toBe('400px');
      // C never moved — untouched style.
      expect(els.get('C')![0]!.style.left).toBe('');
      expect(els.get('C')![0]!.style.width).toBe('');
    });

    it('reverts a previously-moved segment to ITS OWN ORIGINAL geometry once a later frame no longer moves it', () => {
      // Frame 1: dragging A grows it, cascading into B.
      const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
      const originalById = new Map(original.map(s => [s.id, s]));
      const els = new Map([
        ['A', [fakeEl('A')]],
        ['B', [fakeEl('B')]],
        ['C', [fakeEl('C')]],
      ]);
      const frame1 = [seg('A', 0, 8), seg('B', 8, 2), seg('C', 10, 5)];
      let written = referenceWriteGeometry(frame1, original, originalById, els, 100, new Set());
      expect(written).toEqual(new Set(['A', 'B']));
      expect(els.get('B')![0]!.style.left).toBe('800px');

      // Frame 2: pointer comes back toward the start — A no longer moved at
      // all (back to its own original geometry), so it must be excluded from
      // `moved` (the `s.startTime === orig.startTime && s.duration === orig.duration`
      // guard) yet its stale frame-1 style must still be reverted via the
      // writtenIds carry-forward loop, exactly as B's is.
      const frame2 = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
      written = referenceWriteGeometry(frame2, original, originalById, els, 100, written);
      expect(written).toEqual(new Set());
      expect(els.get('A')![0]!.style.left).toBe('0px');
      expect(els.get('A')![0]!.style.width).toBe('500px');
      expect(els.get('B')![0]!.style.left).toBe('500px');
      expect(els.get('B')![0]!.style.width).toBe('500px');
    });

    it('a segment with no known element is silently skipped (defensive, matches the real guard)', () => {
      const original = [seg('A', 0, 5)];
      const originalById = new Map(original.map(s => [s.id, s]));
      const grown = [seg('A', 0, 6)];
      // Deliberately empty map — no element registered for 'A'.
      expect(() =>
        referenceWriteGeometry(grown, original, originalById, new Map(), 100, new Set()),
      ).not.toThrow();
    });
  });

  describe('commit-dispatch decision (handleUp)', () => {
    const edge = (duration: number): DragEdgeResult => ({
      duration,
      trimStart: 0,
      segmentLeftPx: 0,
    });

    it('a press-and-release with no movement never resolves or commits anything', () => {
      const outcome = referenceResolveCommitOutcome(false, edge(999), 5, () => {
        throw new Error('must not be called');
      });
      expect(outcome).toBe('no-op-not-moved');
    });

    it('a negligible drag reverted without ever calling commit (HISTORICAL — withdrawn 2026-08-08)', () => {
      const outcome = referenceResolveCommitOutcome(true, edge(5.005), 5, () => {
        throw new Error('must not be called');
      });
      expect(outcome).toBe('reverted-negligible');
    });

    it('a real drag calls commit and reports success', () => {
      const outcome = referenceResolveCommitOutcome(true, edge(6), 5, () => true);
      expect(outcome).toBe('committed');
    });

    it('a real drag whose cascade is blocked by a lock reports reverted-blocked', () => {
      const outcome = referenceResolveCommitOutcome(true, edge(6), 5, () => false);
      expect(outcome).toBe('reverted-blocked');
    });

    it('the negligible-drag threshold was exactly 0.01s, symmetric both directions (HISTORICAL — withdrawn 2026-08-08)', () => {
      const justUnder = referenceResolveCommitOutcome(true, edge(5 + HISTORICAL_NEGLIGIBLE_DRAG_SEC - 0.001), 5, () => true);
      const justOver = referenceResolveCommitOutcome(true, edge(5 + HISTORICAL_NEGLIGIBLE_DRAG_SEC + 0.001), 5, () => true);
      expect(justUnder).toBe('reverted-negligible');
      expect(justOver).toBe('committed');
    });
  });

  describe('onResizeStart top-of-closure bug (found, documented, deliberately left)', () => {
    it('sets resizing state unconditionally, even for an out-of-range dragged index', () => {
      const calls: string[] = [];
      const result = referenceOnResizeStartTop(-1, calls);
      expect(result).toBe('bailed');
      // The bug: these three side effects already ran, and nothing in this
      // early-return path reverses them.
      expect(calls).toEqual(['setResizingId', 'setResizingType', 'classList.add(resizing)']);
    });

    it('the same side effects run on the success path too — the bug is in what does NOT run after, not what does', () => {
      const calls: string[] = [];
      const result = referenceOnResizeStartTop(2, calls);
      expect(result).toBe('validated');
      expect(calls).toEqual(['setResizingId', 'setResizingType', 'classList.add(resizing)']);
    });
  });
});

// ---------------------------------------------------------------------------
// PART 2 — full-gesture scenarios via the real, already-extracted pure
// functions (`resolveDragEdge`, `resolveDragPreview`, `computeDragCascade`),
// exactly as the real closure calls them. Snapshot-style: captures the full
// array at each step of a representative multi-step drag.
// ---------------------------------------------------------------------------

describe('PART 2 — multi-step gesture snapshot (live preview vs. committed result)', () => {
  it('a two-frame right-edge drag on the middle segment previews, then commits, identically', () => {
    const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5), seg('D', 15, 5)];
    const pps = 100;
    const draggedIdx = 1;
    const direction: DragEdge = 'end';

    // Frame 1: pointer has moved the edge to content-x 1200px = 12s (B grows
    // from 5s to 7s duration; edge='end' means duration = edgeSec - startTime).
    const finalFrame1 = resolveDragEdge({
      segment: original[draggedIdx]!,
      edge: direction,
      edgeContentX: 1200,
      pixelsPerSecond: pps,
    });
    const preview1 = resolveDragPreview(original, draggedIdx, finalFrame1.duration, finalFrame1.trimStart, 'right');
    expect(spans(preview1)).toBe('A[0.00..5.00] B[5.00..12.00] C[12.00..15.00] D[15.00..20.00]');
    // D untouched — the cascade only absorbed into C (locality).
    expect(preview1[3]).toEqual(original[3]);

    // Frame 2: pointer continues to content-x 1400px = 14s (B grows to 9s).
    const finalFrame2 = resolveDragEdge({
      segment: original[draggedIdx]!,
      edge: direction,
      edgeContentX: 1400,
      pixelsPerSecond: pps,
    });
    const preview2 = resolveDragPreview(original, draggedIdx, finalFrame2.duration, finalFrame2.trimStart, 'right');
    expect(spans(preview2)).toBe('A[0.00..5.00] B[5.00..14.00] C[14.00..15.00] D[15.00..20.00]');

    // Release at frame 2's position — the commit must equal the last preview.
    const committed = computeDragCascade(original, draggedIdx, finalFrame2.duration, finalFrame2.trimStart, 'right', noBlock);
    expect(spans(committed)).toBe(spans(preview2));
    expect(checkTimelineIsGapless(committed!)).toBeNull();
  });

  it('a drag blocked by a lock leaves the preview AND the commit at the original array', () => {
    const original = [seg('A', 0, 5), seg('B', 5, 5, { locked: true })];
    const final = resolveDragEdge({
      segment: original[0]!,
      edge: 'end',
      edgeContentX: 600,
      pixelsPerSecond: 100,
    });
    const preview = resolveDragPreview(original, 0, final.duration, final.trimStart, 'right');
    expect(preview).toBe(original); // reference equality — resolveDragPreview's own documented no-op path

    const blocked: number[] = [];
    const committed = computeDragCascade(original, 0, final.duration, final.trimStart, 'right', i => blocked.push(i));
    expect(committed).toBeNull();
    expect(blocked).toEqual([1]);
  });
});
