/**
 * Regression coverage for the Apply Sync double-history-entry bug (Stage 3,
 * 2026-08-08 cleanup run).
 *
 * `App.tsx`'s `handleApplySyncFromFiles` used to push history TWICE per Apply
 * Sync run: once for the main timeline commit (step 8, ~line 2917), and again
 * for a post-hoc boundary-quality log append (~line 3005) that runs after an
 * async waveform build. Both calls went through `setProject`, and a keyless
 * `setProject` always pushes (`historyCoalesce.ts`'s discrete-write rule — see
 * `coalesceWrite`'s own doc comment: "Apply Sync... always push[es]"). Result:
 * undoing one Apply Sync took two presses, and the first press was a visual
 * no-op whenever the waveform-unavailable branch ran (its log entry was the
 * ONLY thing that second push added).
 *
 * The fix: the boundary-quality follow-up now goes through `setProjectSilent`
 * instead — it is a continuation of the SAME edit that already got its entry,
 * not a second user-authored one (see `App.tsx`'s `setProjectSilent` doc
 * comment and its call site at the fixed line).
 *
 * `App.tsx` itself has no test harness (no jsdom/testing-library in this repo —
 * same documented gap as `usePlayback.test.ts`/`useGlPreview.test.ts`), so this
 * test exercises the REAL `history.ts`/`historyCoalesce.ts` production modules
 * through a harness that is a faithful, byte-level mirror of `App.tsx`'s
 * `setProject`/`setProjectSilent` wrappers (~lines 1190-1252) — same
 * transcription precedent as `dragGeometry.test.ts`'s PART 1. If those wrappers
 * ever change shape, this harness must be updated to match or it stops proving
 * anything about the real code path.
 */

import { describe, expect, it } from 'vitest';
import {
  emptyHistory,
  pushEntry,
  replaceEntry,
  undo,
  type History,
  type HistoryEntry,
} from './history';
import { coalesceWrite, type CoalesceClass, type OpenGesture } from './historyCoalesce';

// ---------------------------------------------------------------------------
// Harness — mirrors App.tsx's setProject/setProjectSilent exactly.
// ---------------------------------------------------------------------------

interface Harness<S> {
  current: S;
  history: History<S>;
  openGesture: OpenGesture | null;
}

function makeHarness<S>(initial: S): Harness<S> {
  return { current: initial, history: emptyHistory<S>(), openGesture: null };
}

/** Mirrors App.tsx's `setProject` (the capturing setter). */
function setProject<S>(
  h: Harness<S>,
  updater: (prev: S) => S,
  meta?: {
    label?: string;
    anchorSegmentId?: string;
    coalesceKey?: string;
    coalesceKind?: CoalesceClass;
  },
  nowMs = 0,
): void {
  const prev = h.current;
  const next = updater(prev);
  if (next !== prev) {
    const { decision, open } = coalesceWrite({
      open: h.openGesture,
      key: meta?.coalesceKey,
      kind: meta?.coalesceKind,
      nowMs,
    });
    h.openGesture = open;
    const entry: HistoryEntry<S> = {
      state: prev,
      label: meta?.label ?? 'edit',
      anchorSegmentId: meta?.anchorSegmentId,
    };
    h.history = decision === 'replace' ? replaceEntry(h.history, entry) : pushEntry(h.history, entry);
  }
  h.current = next;
}

/** Mirrors App.tsx's `setProjectSilent` (writes without recording history). */
function setProjectSilent<S>(h: Harness<S>, updater: (prev: S) => S): void {
  h.current = updater(h.current);
}

// ---------------------------------------------------------------------------
// A minimal Apply-Sync-shaped fixture — only what the history mechanism cares
// about (identity-changing writes), not a real Project.
// ---------------------------------------------------------------------------

interface FakeProject {
  segments: string[];
  syncLog: string[];
}

const preSyncProject: FakeProject = { segments: ['pre-sync-segment'], syncLog: [] };

function runMainCommit(h: Harness<FakeProject>): void {
  // Mirrors handleApplySyncFromFiles step 8 (~App.tsx:2917) — the single
  // atomic timeline commit. Always a keyless, discrete setProject: always
  // pushes exactly one entry.
  setProject(h, prev => ({ ...prev, segments: ['synced-segment-1', 'synced-segment-2'] }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Apply Sync history — exactly one entry per run (Stage 3 fix)', () => {
  it('waveform-available branch (a boundary-quality violation was found): exactly one history entry', () => {
    const h = makeHarness(preSyncProject);

    runMainCommit(h);
    // Mirrors the fixed ~App.tsx:3005 call — a non-empty boundaryLogEntries
    // array from `buildGroupedViolationEntry`, now via setProjectSilent.
    setProjectSilent(h, prev => ({
      ...prev,
      syncLog: [...prev.syncLog, 'boundary-quality: 1 warning grouped'],
    }));

    expect(h.history.past.length).toBe(1);
  });

  it('waveform-unavailable branch (always produces a log entry): exactly one history entry', () => {
    const h = makeHarness(preSyncProject);

    runMainCommit(h);
    // Mirrors the fixed ~App.tsx:3005 call on the resolvedWaveform-falsy path
    // — this branch ALWAYS produces a non-empty boundaryLogEntries array (a
    // single 'Waveform unavailable...' info entry), which is exactly the case
    // that made the pre-fix double-push guaranteed rather than occasional.
    setProjectSilent(h, prev => ({
      ...prev,
      syncLog: [...prev.syncLog, 'Waveform unavailable — 1 boundary(ies) not waveform-verified.'],
    }));

    expect(h.history.past.length).toBe(1);
  });

  it('one undo fully reverts an Apply Sync — including the silently-appended boundary-quality log', () => {
    const h = makeHarness(preSyncProject);

    runMainCommit(h);
    setProjectSilent(h, prev => ({
      ...prev,
      syncLog: [...prev.syncLog, 'boundary-quality: 1 warning grouped'],
    }));

    // Sanity: the visible state reflects BOTH writes before any undo.
    expect(h.current.segments).toEqual(['synced-segment-1', 'synced-segment-2']);
    expect(h.current.syncLog).toEqual(['boundary-quality: 1 warning grouped']);

    const traversal = undo(h.history, h.current);
    expect(traversal).not.toBeNull();
    // A single undo restores the exact pre-sync object — not an intermediate
    // state between the two writes. If the old two-push bug were still
    // present, this same single undo would only strip the log entry and
    // leave the synced segments in place.
    expect(traversal!.entry.state).toEqual(preSyncProject);
    expect(traversal!.entry.state.segments).toEqual(['pre-sync-segment']);
    expect(traversal!.entry.state.syncLog).toEqual([]);

    // And a second undo has nothing left to do — proof there was only ever
    // one entry to begin with.
    const secondUndo = undo(traversal!.history, traversal!.entry.state);
    expect(secondUndo).toBeNull();
  });

  it('demonstrates the bug this replaces: two keyless setProject calls push two entries', () => {
    // Not exercising App.tsx — this documents why the fix (setProjectSilent
    // for the second write) was necessary, using the same real production
    // coalesceWrite/pushEntry functions the harness above uses.
    const h = makeHarness(preSyncProject);

    runMainCommit(h);
    // The PRE-fix code path: a second keyless setProject.
    setProject(h, prev => ({
      ...prev,
      syncLog: [...prev.syncLog, 'boundary-quality: 1 warning grouped'],
    }));

    expect(h.history.past.length).toBe(2);
  });
});
