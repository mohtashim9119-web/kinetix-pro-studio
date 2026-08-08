/**
 * Undo/redo history — the PURE core (Phase 1, 2026-08-08).
 *
 * Design of record: `docs/decisions/2026-08-08-undo-redo-design.md`, as
 * reconciled with the owner's rulings in that document's REVISION 2 section.
 * Read it before changing anything here; several shapes below look
 * over-specified until you know which alternative was measured and rejected.
 *
 * WHAT THIS MODULE IS. A snapshot ring plus a cursor, and nothing else. No
 * React, no DOM, no IndexedDB, no knowledge of `Project` beyond it being an
 * opaque value type. Persistence lives in `historyPersist.ts`; the wiring to
 * `setProject` lives in `App.tsx`. Keeping those three apart is what lets the
 * round-trip property test below assert byte-identity without a render.
 *
 * SNAPSHOTS, NOT PATCHES — and the reason is measured, not aesthetic. At the
 * ruled depth of 20, snapshots with structural sharing cost **0.07 MB** of real
 * retained heap for the largest corpus project (444 segments); a naive
 * `structuredClone` per entry costs 20.71 MB, and the pathological case where
 * all 20 entries are Apply Sync commits costs 12.18 MB. A patch scheme would
 * claw back at most that 12 MB in exchange for hand-maintaining an inverse for
 * every one of `App.tsx`'s 62 `setProject` sites, and would forfeit the
 * golden-replay guarantee: a snapshot RESTORES a value the sync pipeline
 * produced, whereas a patch RECOMPUTES one. See the design doc's R2.1.
 *
 * "Structural sharing" here is not a library and needs no library: an entry
 * holds the very `Project` object that was committed. Because every writer in
 * this app is already immutable (`CLAUDE.md`'s DO-NOT-DO table, verified by
 * grep — zero direct-mutation sites), that object is frozen in practice, and
 * the segment objects inside it are shared with every other entry that did not
 * change them. **This is load-bearing.** If a future writer ever mutates a
 * committed `Project` in place, history silently rewrites its own past. That is
 * what `assertNoMutation` in the test file exists to catch.
 *
 * DEPTH — "total 20 states" (owner ruling). History stores the states you can
 * travel TO; the state you are currently looking at lives in `useState`, not
 * here. So the invariant is
 *
 *     undoDepth + redoDepth <= MAX_HISTORY_STATES
 *
 * and 20 stored states means 20 undo levels from a fresh full ring, with redo
 * bounded by however many of those you have already spent. It is not 20 each.
 */

/** Owner ruling 2026-08-08: 20 stored states TOTAL, split across undo/redo. */
export const MAX_HISTORY_STATES = 20;

/**
 * One reachable state, plus the two pieces of context the UI needs.
 *
 * `label` and `anchorSegmentId` are supplied by the CALLER, never derived here.
 * A caller knows what gesture it is performing; this module would have to guess
 * by diffing, and a guessed label is worse than none.
 */
export interface HistoryEntry<S> {
  /** The committed value. Shared by reference — never cloned. */
  readonly state: S;
  /** Human-readable, for the button tooltip: "resize segment 12". */
  readonly label: string;
  /**
   * The segment the gesture STARTED on — the anchor an undo scrolls to and
   * flashes (design §5.2). `undefined` for an edit with no single anchor
   * (apply-to-all, Apply Sync). Never a heading id: heading identity is not
   * stable across insert/delete, segment identity is (design R2.2).
   */
  readonly anchorSegmentId?: string;
}

/**
 * The whole store. Immutable — every operation returns a new `History`, so it
 * can live in a ref or in state without an aliasing hazard, and so a test can
 * hold onto an older value and compare.
 *
 * `past` is ordered oldest-first; its LAST element is what the next undo
 * travels to. `future` is ordered nearest-first; its LAST element is what the
 * next redo travels to. Both are plain arrays because 20 is small and an
 * array's semantics are obvious at a glance; a ring buffer here would be
 * cleverness with no measurable payoff.
 */
export interface History<S> {
  readonly past: readonly HistoryEntry<S>[];
  readonly future: readonly HistoryEntry<S>[];
}

export function emptyHistory<S>(): History<S> {
  return { past: [], future: [] };
}

export function undoDepth<S>(h: History<S>): number {
  return h.past.length;
}

export function redoDepth<S>(h: History<S>): number {
  return h.future.length;
}

export function canUndo<S>(h: History<S>): boolean {
  return h.past.length > 0;
}

export function canRedo<S>(h: History<S>): boolean {
  return h.future.length > 0;
}

/** The entry the next undo would travel to, for the button's tooltip. */
export function peekUndo<S>(h: History<S>): HistoryEntry<S> | undefined {
  return h.past[h.past.length - 1];
}

/** The entry the next redo would travel to, for the button's tooltip. */
export function peekRedo<S>(h: History<S>): HistoryEntry<S> | undefined {
  return h.future[h.future.length - 1];
}

/**
 * Records `entry` — the state being LEFT BEHIND — as newly undoable.
 *
 * Call this with the PRE-edit state, at the moment an edit is committed. The
 * post-edit state is not stored: it is what the app is now showing.
 *
 * Two consequences, both intentional and both owner-ruled:
 *  - **Redo is discarded.** A new edit after an undo abandons the branch you
 *    had undone away from. Standard linear model; no redo tree.
 *  - **Eviction is silent, oldest-first**, once the total would exceed
 *    `MAX_HISTORY_STATES`. No warning, no toast.
 */
export function pushEntry<S>(h: History<S>, entry: HistoryEntry<S>): History<S> {
  const past = [...h.past, entry];
  // `future` is dropped, so the cap only ever has to consider `past`.
  while (past.length > MAX_HISTORY_STATES) past.shift();
  return { past, future: [] };
}

/**
 * Rewrites the newest undoable entry in place instead of adding another.
 *
 * This is the COALESCING primitive (design §3.2): a slider gesture emits many
 * commits but must leave exactly one entry, and the entry it leaves must hold
 * the state from BEFORE the gesture started — so the first write of a gesture
 * pushes and every subsequent write replaces, keeping the original `state`
 * while letting the label/anchor be refined.
 *
 * Explicit rather than inferred, per the brief: a store that decided for itself
 * whether a write "looked like" a continuation of the last one would be
 * guessing at gesture boundaries, and every such heuristic eventually splits a
 * slow deliberate drag into two entries or merges two deliberate edits into one.
 *
 * `state` is deliberately NOT overwritten — only `label` and `anchorSegmentId`.
 * Replacing the state would defeat the purpose: undo would land in the middle of
 * the gesture rather than before it. A `replaceEntry` on empty history pushes,
 * so a caller cannot lose the first write of a gesture by mis-sequencing.
 */
export function replaceEntry<S>(
  h: History<S>,
  entry: HistoryEntry<S>,
): History<S> {
  if (h.past.length === 0) return pushEntry(h, entry);
  const past = h.past.slice();
  const existing = past[past.length - 1]!;
  past[past.length - 1] = {
    state: existing.state,
    label: entry.label,
    anchorSegmentId: entry.anchorSegmentId,
  };
  return { past, future: [] };
}

/** What a traversal produced: the state to restore, plus its context. */
export interface Traversal<S> {
  readonly history: History<S>;
  readonly entry: HistoryEntry<S>;
}

/**
 * Steps back one state. Returns `null` when there is nothing to undo, so the
 * caller cannot accidentally treat "nothing happened" as a restore.
 *
 * `current` — the state being left — becomes redoable. It is passed in rather
 * than read from the store because the store does not hold the present; see the
 * depth note in this file's header.
 *
 * The label carried onto the redo entry is the UNDONE entry's own label, which
 * is what makes "Redo resize segment 12" name the action a user recognises: the
 * thing they are redoing is the edit they just undid, not the edit before it.
 */
export function undo<S>(h: History<S>, current: S): Traversal<S> | null {
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  return {
    history: {
      past: h.past.slice(0, -1),
      future: [
        ...h.future,
        { state: current, label: entry.label, anchorSegmentId: entry.anchorSegmentId },
      ],
    },
    entry,
  };
}

/** Steps forward one state. Mirror of `undo`; `null` when nothing to redo. */
export function redo<S>(h: History<S>, current: S): Traversal<S> | null {
  const entry = h.future[h.future.length - 1];
  if (!entry) return null;
  return {
    history: {
      past: [
        ...h.past,
        { state: current, label: entry.label, anchorSegmentId: entry.anchorSegmentId },
      ],
      future: h.future.slice(0, -1),
    },
    entry,
  };
}

/**
 * Drops everything. Called on project switch, dashboard return, project
 * re-open, New Project, the DEV fixture load, and project deletion — every
 * "this is a different project now" transition (design §6.0).
 *
 * NOT called on the mount-time hydration swap, where a placeholder `Project` is
 * replaced by the real persisted one. Keying a clear on `project.id` alone
 * reproduces the D15 bug the `sliderT` restore already had to fix: a first-run
 * guard is consumed by the placeholder's id and then fires unguarded when the
 * real project arrives. See the design doc §6.0's closing paragraph.
 */
export function clearHistory<S>(): History<S> {
  return emptyHistory<S>();
}
