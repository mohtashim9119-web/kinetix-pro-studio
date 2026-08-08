/**
 * Undo/redo history core — Phase 1 tests (2026-08-08).
 *
 * Design of record: `docs/decisions/2026-08-08-undo-redo-design.md` §10.
 *
 * The interesting structural choice here is PART 2's `Editor`: a ~30-line stand-in
 * for `App.tsx`'s `setProject` seam. It exists so the round-trip property can be
 * asserted against a real edit vocabulary — including real `computeDragCascade`
 * drags, so the states under test are genuinely gapless rather than
 * hand-constructed to look it — without a React render, which this repo has no
 * harness for (the same documented gap as `usePlayback.test.ts`/`useExport.test.ts`).
 *
 * It also carries a `captureEnabled` switch, which is what makes the
 * non-vacuity check in PART 5 possible: flipping it off must make the
 * round-trip tests FAIL. A round-trip test that passes with capture disabled is
 * asserting nothing, and this repo has been bitten by exactly that shape before
 * (the universal post-condition had to be validated by reverting a real fix).
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_HISTORY_STATES,
  canRedo,
  canUndo,
  clearHistory,
  emptyHistory,
  peekRedo,
  peekUndo,
  pushEntry,
  redo,
  redoDepth,
  replaceEntry,
  undo,
  undoDepth,
  type History,
  type HistoryEntry,
} from './history';
import { computeDragCascade, DRAG_CASCADE_OPTIONS } from './dragCascade';
import { checkTimelineIsGapless } from './timelinePartition';
import { AnimationType, TransitionType, type VideoSegment } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/** A gapless N-segment timeline: every segment 2s long, back to back. */
function timeline(n: number): VideoSegment[] {
  return Array.from({ length: n }, (_, i) =>
    seg(String.fromCharCode(65 + i), i * 2, 2),
  );
}

const spans = (segs: VideoSegment[]): string =>
  segs.map(s => `${s.id}[${s.startTime.toFixed(3)}..${(s.startTime + s.duration).toFixed(3)}]`).join(' ');

// ---------------------------------------------------------------------------
// PART 1 — the store in isolation: depth, eviction, redo discard, traversal
// ---------------------------------------------------------------------------

describe('PART 1 — history store mechanics', () => {
  const e = (n: number): HistoryEntry<number> => ({ state: n, label: `edit ${n}` });

  it('starts empty and refuses both traversals', () => {
    const h = emptyHistory<number>();
    expect(undoDepth(h)).toBe(0);
    expect(redoDepth(h)).toBe(0);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    // `null`, not a silent no-op returning the same history — a caller must not
    // be able to mistake "nothing to undo" for "undone".
    expect(undo(h, 99)).toBeNull();
    expect(redo(h, 99)).toBeNull();
  });

  it('undo then redo returns to exactly where it started', () => {
    let h = pushEntry(emptyHistory<number>(), e(1)); // left state 1 behind
    const u = undo(h, 2)!;                            // currently showing 2
    expect(u.entry.state).toBe(1);
    expect(undoDepth(u.history)).toBe(0);
    expect(redoDepth(u.history)).toBe(1);
    const r = redo(u.history, u.entry.state)!;
    expect(r.entry.state).toBe(2);
    expect(undoDepth(r.history)).toBe(1);
    expect(redoDepth(r.history)).toBe(0);
    h = r.history;
    expect(peekUndo(h)!.state).toBe(1);
  });

  it('the cap is on the TOTAL, not 20 each — undoDepth + redoDepth <= MAX', () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < MAX_HISTORY_STATES + 15; i++) h = pushEntry(h, e(i));
    expect(undoDepth(h)).toBe(MAX_HISTORY_STATES);
    // Spend every undo; the sum must never exceed the cap at any point.
    let current = 999;
    for (let i = 0; i < MAX_HISTORY_STATES; i++) {
      const t = undo(h, current)!;
      h = t.history;
      current = t.entry.state;
      expect(undoDepth(h) + redoDepth(h)).toBeLessThanOrEqual(MAX_HISTORY_STATES);
    }
    expect(undoDepth(h)).toBe(0);
    expect(redoDepth(h)).toBe(MAX_HISTORY_STATES);
    expect(canUndo(h)).toBe(false);
  });

  it('eviction is oldest-first, so the newest MAX states survive', () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < MAX_HISTORY_STATES + 5; i++) h = pushEntry(h, e(i));
    // 0..4 evicted; 5..24 kept.
    expect(h.past[0]!.state).toBe(5);
    expect(h.past[h.past.length - 1]!.state).toBe(MAX_HISTORY_STATES + 4);
  });

  it('a new edit after an undo discards the redo stack', () => {
    let h = emptyHistory<number>();
    h = pushEntry(h, e(1));
    h = pushEntry(h, e(2));
    const u = undo(h, 3)!;
    expect(redoDepth(u.history)).toBe(1);
    const afterNewEdit = pushEntry(u.history, e(50));
    expect(redoDepth(afterNewEdit)).toBe(0);
    expect(canRedo(afterNewEdit)).toBe(false);
  });

  it('replaceEntry coalesces: the entry count is unchanged and the ORIGINAL state is kept', () => {
    // The whole point of coalescing a slider gesture: 30 writes, one entry, and
    // that entry holds the state from BEFORE the gesture — not from its middle.
    let h = pushEntry(emptyHistory<number>(), { state: 100, label: 'brightness' });
    for (let i = 0; i < 29; i++) {
      h = replaceEntry(h, { state: 100 + i, label: 'brightness', anchorSegmentId: 'B' });
    }
    expect(undoDepth(h)).toBe(1);
    expect(peekUndo(h)!.state).toBe(100);           // pre-gesture state preserved
    expect(peekUndo(h)!.anchorSegmentId).toBe('B'); // context still refinable
  });

  it('replaceEntry on empty history pushes, so a mis-sequenced gesture loses nothing', () => {
    const h = replaceEntry(emptyHistory<number>(), { state: 7, label: 'x' });
    expect(undoDepth(h)).toBe(1);
    expect(peekUndo(h)!.state).toBe(7);
  });

  it('the redo tooltip names the edit being redone, not the one before it', () => {
    let h = pushEntry(emptyHistory<number>(), { state: 1, label: 'resize segment 12' });
    const u = undo(h, 2)!;
    expect(peekRedo(u.history)!.label).toBe('resize segment 12');
    h = redo(u.history, u.entry.state)!.history;
    expect(peekUndo(h)!.label).toBe('resize segment 12');
  });

  it('every operation returns a NEW history — the input is never mutated', () => {
    const h0 = pushEntry(emptyHistory<number>(), e(1));
    const before = { past: [...h0.past], future: [...h0.future] };
    pushEntry(h0, e(2));
    replaceEntry(h0, e(3));
    undo(h0, 9);
    redo(h0, 9);
    expect(h0.past.map(x => x.state)).toEqual(before.past.map(x => x.state));
    expect(h0.future.length).toBe(before.future.length);
  });

  it('clearHistory drops both stacks', () => {
    let h = emptyHistory<number>();
    h = pushEntry(h, e(1));
    const u = undo(h, 2)!;
    const cleared = clearHistory<number>();
    expect(undoDepth(cleared)).toBe(0);
    expect(redoDepth(cleared)).toBe(0);
    expect(redoDepth(u.history)).toBe(1); // and did not mutate the old one
  });
});

// ---------------------------------------------------------------------------
// PART 2 — a stand-in for App.tsx's setProject seam
// ---------------------------------------------------------------------------

/** The subset of `Project` these tests exercise. Opaque to `history.ts`. */
interface Doc {
  segments: VideoSegment[];
  globalFilter?: string;
  name: string;
}

type EditKind = 'drag' | 'rename' | 'filter' | 'grade' | 'applyAll';

/**
 * Mimics `App.tsx`'s wrapper: an edit computes a new document immutably, and
 * the PRE-edit document is pushed as newly undoable. `captureEnabled` is the
 * non-vacuity switch — see PART 5.
 */
class Editor {
  doc: Doc;
  history: History<Doc> = emptyHistory<Doc>();
  captureEnabled = true;
  /** Every document this editor has ever shown, for invariant sweeps. */
  readonly seen: Doc[] = [];

  constructor(initial: Doc) {
    this.doc = initial;
    this.seen.push(initial);
  }

  private commit(next: Doc, label: string, anchorSegmentId?: string): void {
    if (this.captureEnabled) {
      this.history = pushEntry(this.history, { state: this.doc, label, anchorSegmentId });
    }
    this.doc = next;
    this.seen.push(next);
  }

  /** A real drag, through the real cascade — so states are genuinely gapless. */
  drag(idx: number, deltaSec: number): boolean {
    const target = this.doc.segments[idx];
    if (!target) return false;
    const cascade = computeDragCascade(
      this.doc.segments, idx, Math.max(0.1, target.duration + deltaSec),
      target.trimStart ?? 0, 'right', () => {}, undefined, DRAG_CASCADE_OPTIONS,
    );
    if (cascade === null) return false; // locked neighbour blocked: no entry
    this.commit({ ...this.doc, segments: cascade }, `resize segment ${idx + 1}`, target.id);
    return true;
  }

  rename(name: string): void {
    this.commit({ ...this.doc, name }, `rename to ${name}`);
  }

  filter(f: string): void {
    this.commit({ ...this.doc, globalFilter: f }, `filter ${f}`);
  }

  /** A field write on one segment — the grade-slider shape. */
  grade(idx: number, brightness: number): void {
    const target = this.doc.segments[idx];
    if (!target) return;
    this.commit(
      {
        ...this.doc,
        segments: this.doc.segments.map((s, i) =>
          i === idx ? { ...s, effectGrade: { brightness, contrast: 0, saturation: 0, temperature: 0 } } : s,
        ),
      },
      `grade segment ${idx + 1}`, target.id,
    );
  }

  /** Apply-to-all: touches every segment, and has no single anchor. */
  applyAll(t: TransitionType): void {
    this.commit(
      { ...this.doc, segments: this.doc.segments.map(s => ({ ...s, transition: t })) },
      'apply transition to all',
    );
  }

  undo(): boolean {
    const t = undo(this.history, this.doc);
    if (!t) return false;
    this.history = t.history;
    this.doc = t.entry.state;
    this.seen.push(this.doc);
    return true;
  }

  redo(): boolean {
    const t = redo(this.history, this.doc);
    if (!t) return false;
    this.history = t.history;
    this.doc = t.entry.state;
    this.seen.push(this.doc);
    return true;
  }
}

const makeDoc = (n = 6): Doc => ({ segments: timeline(n), name: 'proj' });

// ---------------------------------------------------------------------------
// PART 3 — round-trip identity across the edit vocabulary
// ---------------------------------------------------------------------------

describe('PART 3 — round-trip identity', () => {
  const cases: Array<[EditKind, (ed: Editor) => void]> = [
    ['drag', ed => { ed.drag(1, 0.7); }],
    ['rename', ed => ed.rename('renamed')],
    ['filter', ed => ed.filter('sepia')],
    ['grade', ed => ed.grade(2, 0.4)],
    ['applyAll', ed => ed.applyAll(TransitionType.FADE)],
  ];

  for (const [kind, apply] of cases) {
    it(`do -> undo returns BYTE-IDENTICAL state for a ${kind} edit`, () => {
      const ed = new Editor(makeDoc());
      const before = structuredClone(ed.doc);
      apply(ed);
      expect(ed.doc).not.toEqual(before); // the edit actually did something
      expect(ed.undo()).toBe(true);
      // Deep, not by reference — the design doc's §10 item 1 asks for exactly this.
      expect(ed.doc).toEqual(before);
      // And byte-identical through a serialiser, which catches a difference
      // `toEqual` forgives (e.g. -0 vs 0, key insertion order in a snapshot).
      expect(JSON.stringify(ed.doc)).toBe(JSON.stringify(before));
    });

    it(`do -> undo -> redo re-applies identically for a ${kind} edit`, () => {
      const ed = new Editor(makeDoc());
      apply(ed);
      const afterDo = structuredClone(ed.doc);
      ed.undo();
      expect(ed.redo()).toBe(true);
      expect(ed.doc).toEqual(afterDo);
      expect(JSON.stringify(ed.doc)).toBe(JSON.stringify(afterDo));
    });
  }

  it('a blocked drag (locked neighbour) creates ZERO entries', () => {
    // The cascade returns null, so nothing is committed and nothing is pushed.
    // This is the pure-layer half of the "discarded drags push no entry"
    // requirement; the real-session half lands with the App.tsx seam.
    const ed = new Editor({ segments: [seg('A', 0, 2), seg('B', 2, 2, { locked: true })], name: 'p' });
    const depthBefore = undoDepth(ed.history);
    expect(ed.drag(0, 5)).toBe(false); // needs to eat into locked B
    expect(undoDepth(ed.history)).toBe(depthBefore);
    expect(canUndo(ed.history)).toBe(false);
  });

  it('a committed drag creates EXACTLY one entry, however many frames it took', () => {
    const ed = new Editor(makeDoc());
    ed.drag(1, 0.5);
    expect(undoDepth(ed.history)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PART 4 — the property test: random N-operation round trips
// ---------------------------------------------------------------------------

/** Deterministic PRNG so a failure is reproducible from its seed alone. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('PART 4 — property: random N-operation round trip', () => {
  const SEEDS = [1, 7, 42, 99, 12345, 777, 20260808];
  const LENGTHS = [1, 2, 5, 12, 25, 40];

  for (const seed of SEEDS) {
    for (const n of LENGTHS) {
      it(`N=${n} seed=${seed}: undo N times returns to the initial state; redo N returns to the final`, () => {
        const rand = rng(seed);
        const ed = new Editor(makeDoc(6));
        const initial = structuredClone(ed.doc);

        // Only count operations that actually committed — a blocked drag
        // legitimately pushes nothing, so counting attempts would be wrong.
        let committed = 0;
        for (let i = 0; i < n; i++) {
          const pick = Math.floor(rand() * 5);
          const idx = Math.floor(rand() * 6);
          const before = ed.doc;
          if (pick === 0) ed.drag(idx, (rand() - 0.5) * 1.5);
          else if (pick === 1) ed.rename(`n${i}`);
          else if (pick === 2) ed.filter(`f${i}`);
          else if (pick === 3) ed.grade(idx, rand());
          else ed.applyAll(i % 2 ? TransitionType.FADE : TransitionType.NONE);
          if (ed.doc !== before) committed++;
        }
        const final = structuredClone(ed.doc);

        // Undo everything history is willing to give back. Past the cap, the
        // oldest states are legitimately gone, so the reachable floor is the
        // cap — assert accordingly rather than pretending 40 undos work.
        const reachable = Math.min(committed, MAX_HISTORY_STATES);
        for (let i = 0; i < reachable; i++) expect(ed.undo()).toBe(true);

        if (committed <= MAX_HISTORY_STATES) {
          // Nothing was evicted, so we must land exactly on the initial state.
          expect(ed.doc).toEqual(initial);
          expect(JSON.stringify(ed.doc)).toBe(JSON.stringify(initial));
        }
        expect(canUndo(ed.history)).toBe(false);

        // ...and forward again to the final state.
        for (let i = 0; i < reachable; i++) expect(ed.redo()).toBe(true);
        expect(ed.doc).toEqual(final);
        expect(JSON.stringify(ed.doc)).toBe(JSON.stringify(final));
        expect(canRedo(ed.history)).toBe(false);
      });
    }
  }

  it('EVERY state reachable by any traversal satisfies the gapless invariant', () => {
    // Design §10 item 6 — reusing the existing checker, not a new one.
    for (const seed of SEEDS) {
      const rand = rng(seed);
      const ed = new Editor(makeDoc(8));
      for (let i = 0; i < 30; i++) {
        const pick = Math.floor(rand() * 3);
        const idx = Math.floor(rand() * 8);
        if (pick === 0) ed.drag(idx, (rand() - 0.5) * 2);
        else if (pick === 1) ed.grade(idx, rand());
        else ed.applyAll(TransitionType.FADE);
      }
      while (ed.undo()) { /* walk all the way back */ }
      while (ed.redo()) { /* and all the way forward */ }
      // `seen` holds every document ever shown, including every restored one.
      for (const doc of ed.seen) {
        expect(checkTimelineIsGapless(doc.segments)).toBeNull();
      }
      expect(ed.seen.length).toBeGreaterThan(30);
    }
  });

  it('a restored state may legitimately have a DIFFERENT total duration', () => {
    // Design §10 item 10 / the report's duration-guard proof, at this layer:
    // undo is not subject to the drag path's `conserveTotalDuration` switch,
    // because it does not go through `computeDragCascade` at all. A restore
    // whose total differs must therefore succeed, not be refused.
    const wide: Doc = { segments: timeline(4), name: 'p' };
    const ed = new Editor(wide);
    const totalOf = (d: Doc): number =>
      d.segments.reduce((acc, s) => Math.max(acc, s.startTime + s.duration), 0);
    const t0 = totalOf(ed.doc);
    // Replace the array wholesale, the Apply-Sync shape — total duration moves.
    ed.history = pushEntry(ed.history, { state: ed.doc, label: 'apply sync' });
    ed.doc = { ...ed.doc, segments: timeline(9) };
    expect(totalOf(ed.doc)).not.toBeCloseTo(t0, 6);
    expect(ed.undo()).toBe(true);
    expect(totalOf(ed.doc)).toBeCloseTo(t0, 9);
    expect(spans(ed.doc.segments)).toBe(spans(wide.segments));
  });
});

// ---------------------------------------------------------------------------
// PART 5 — non-vacuity
// ---------------------------------------------------------------------------

describe('PART 5 — non-vacuity of PART 3/4', () => {
  it('with capture DISABLED, undo cannot restore — proving the round-trips test capture', () => {
    const ed = new Editor(makeDoc());
    ed.captureEnabled = false;
    const before = structuredClone(ed.doc);
    ed.drag(1, 0.7);
    expect(ed.doc).not.toEqual(before);
    // Nothing was recorded, so there is nothing to undo and the edit is stuck.
    expect(ed.undo()).toBe(false);
    expect(ed.doc).not.toEqual(before);
    expect(undoDepth(ed.history)).toBe(0);
  });

  it('with capture disabled, the PART 4 property fails — the same sweep, inverted', () => {
    const ed = new Editor(makeDoc());
    ed.captureEnabled = false;
    const initial = structuredClone(ed.doc);
    const rand = rng(42);
    for (let i = 0; i < 8; i++) ed.grade(Math.floor(rand() * 6), rand());
    for (let i = 0; i < 8; i++) ed.undo();
    // The assertion PART 4 makes — and it must not hold here.
    expect(ed.doc).not.toEqual(initial);
  });

  it('history entries share segment objects by reference — the structural-sharing claim', () => {
    // The 0.07 MB measurement in the design doc's R2.1 depends on this being
    // true, so it is asserted rather than assumed: an edit to one segment must
    // leave every OTHER segment object shared with the stored entry, not copied.
    const ed = new Editor(makeDoc(6));
    const originalSegs = ed.doc.segments;
    ed.grade(2, 0.5);
    const stored = peekUndo(ed.history)!.state;
    expect(stored.segments).toBe(originalSegs); // the whole array, by reference
    for (let i = 0; i < 6; i++) {
      if (i === 2) continue;
      expect(ed.doc.segments[i]).toBe(originalSegs[i]); // untouched, shared
    }
    expect(ed.doc.segments[2]).not.toBe(originalSegs[2]); // the edited one is new
  });

  it('a stored entry is not disturbed by later edits (no accidental in-place mutation)', () => {
    const ed = new Editor(makeDoc(5));
    ed.grade(1, 0.2);
    // Hold the ENTRY, not its stack position: 20 further edits push past the
    // depth cap and evict this one, which is correct behaviour and would
    // otherwise make this test read `past[0]` as a different entry entirely.
    // The property under test is that this stored state object never changes,
    // which is independent of whether it is still reachable.
    const stored = peekUndo(ed.history)!.state;
    const snapshotJson = JSON.stringify(stored);
    for (let i = 0; i < 10; i++) { ed.drag(i % 4, 0.1); ed.grade(i % 5, i / 10); }
    // If any writer mutated a committed Project in place, history would have
    // silently rewritten its own past and this would differ.
    expect(JSON.stringify(stored)).toBe(snapshotJson);
    // And while we are here: those 21 pushes must have evicted down to the cap.
    expect(undoDepth(ed.history)).toBe(MAX_HISTORY_STATES);
  });
});
