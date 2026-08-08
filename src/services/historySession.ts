/**
 * App.tsx history-wiring EXTRACTION (App.tsx debt cleanup, second attempt,
 * 2026-08-08). Verbatim move, no behaviour change — same precedent
 * `dragSession.ts` set for the drag-resize gesture: `App.tsx` keeps every
 * `useState`/`useRef` declaration (`project`, `history`, `liveProjectRef`,
 * `openGestureRef`, `isResizingRef`, `historyAnchor`, selection state,
 * `currentTime`, `toast`) exactly where it was; this module receives them
 * only through explicit deps objects, mirroring `DragSessionDeps`.
 *
 * `setProject`/`setProjectSilent` are the two exceptions the design doc
 * (`docs/decisions/2026-08-08-undo-redo-design.md` §1.3) calls out by name —
 * `setProjectRaw` may be called from exactly two places, the hydration commit
 * in `App.tsx` and `commitProjectSilent` below. Do not add a third; see that
 * doc and `CLAUDE.md`'s DO NOT DO list.
 *
 * Every exported function here takes an explicit deps object rather than
 * closing over React state, so it is callable and assertable with plain
 * in-memory objects — no DOM, no React renderer, no jsdom. Characterized
 * first in `historySession.test.ts` (PART 1 transcribes the pre-extraction
 * `App.tsx` closures verbatim, cited by line number against commit
 * `5f2e385`; PART 2 imports these real functions and re-runs the identical
 * scenario tables to prove byte-identical behaviour).
 */

import type { Project } from '../types';
import {
  coalesceWrite,
  type CoalesceClass,
  type OpenGesture,
} from './historyCoalesce';
import {
  pushEntry,
  replaceEntry,
  redo as redoHistory,
  undo as undoHistory,
  type History,
} from './history';
import { findLockConflict, lockConflictMessage } from './historyLockPolicy';
import {
  repairSelectedSegmentId,
  repairSelectedHeadingId,
  repairSelectedSegmentIds,
  clampCurrentTimeToRestoredEnd,
} from './historyRestore';
import { findPartitionViolations } from './timelinePartition';

/** Matches the `React.SetStateAction<Project>` shape `setProject`/
 *  `setProjectSilent`'s ~61 call sites already pass, without this file (a
 *  plain services module, like every other file in `src/services/`) taking a
 *  dependency on `react` just for a type. */
export type ProjectUpdater = Project | ((prev: Project) => Project);

function resolveUpdater(action: ProjectUpdater, prev: Project): Project {
  return typeof action === 'function' ? (action as (p: Project) => Project)(prev) : action;
}

// ---------------------------------------------------------------------------
// setProjectSilent — App.tsx lines 1201-1208 (commit 5f2e385)
// ---------------------------------------------------------------------------

export interface CommitProjectSilentDeps {
  liveProjectRef: { current: Project };
  setProjectRaw: (p: Project) => void;
}

/** Writes the project WITHOUT recording history. See `App.tsx`'s own
 *  `setProjectSilent` doc comment (unmoved) for which writes belong here. */
export function commitProjectSilent(action: ProjectUpdater, deps: CommitProjectSilentDeps): void {
  const prev = deps.liveProjectRef.current;
  const next = resolveUpdater(action, prev);
  deps.liveProjectRef.current = next;
  deps.setProjectRaw(next);
}

// ---------------------------------------------------------------------------
// setProject — App.tsx lines 1219-1260 (commit 5f2e385)
// ---------------------------------------------------------------------------

export interface CommitProjectMeta {
  label?: string;
  anchorSegmentId?: string;
  coalesceKey?: string;
  coalesceKind?: CoalesceClass;
}

export interface CommitProjectDeps {
  liveProjectRef: { current: Project };
  setProjectRaw: (p: Project) => void;
  setHistory: (updater: (h: History<Project>) => History<Project>) => void;
  openGestureRef: { current: OpenGesture | null };
}

/** The capturing setter — what all pre-existing `setProject` call sites
 *  resolve to. See `App.tsx`'s own `setProject` doc comment (unmoved) for
 *  the coalescing/no-op-write rationale. */
export function commitProject(
  action: ProjectUpdater,
  meta: CommitProjectMeta | undefined,
  deps: CommitProjectDeps,
): void {
  const prev = deps.liveProjectRef.current;
  const next = resolveUpdater(action, prev);
  if (next !== prev) {
    const { decision, open } = coalesceWrite({
      open: deps.openGestureRef.current,
      key: meta?.coalesceKey,
      kind: meta?.coalesceKind,
      nowMs: Date.now(),
    });
    deps.openGestureRef.current = open;
    const entry = {
      state: prev,
      label: meta?.label ?? 'edit',
      anchorSegmentId: meta?.anchorSegmentId,
    };
    deps.setHistory(h => (decision === 'replace' ? replaceEntry(h, entry) : pushEntry(h, entry)));
  }
  deps.liveProjectRef.current = next;
  deps.setProjectRaw(next);
}

// ---------------------------------------------------------------------------
// applyRestoredState — App.tsx lines 1915-1946 (commit 5f2e385)
// ---------------------------------------------------------------------------

export interface ApplyRestoredStateDeps {
  setProjectSilent: (action: ProjectUpdater) => void;
  setSelectedSegmentId: (updater: (prev: string | null) => string | null) => void;
  setSelectedHeadingId: (updater: (prev: string | null) => string | null) => void;
  setSelectedSegmentIds: (updater: (prev: Set<string>) => Set<string>) => void;
  setCurrentTime: (updater: (prev: number) => number) => void;
}

export function applyRestoredStateImpl(
  restored: Project,
  what: string,
  deps: ApplyRestoredStateDeps,
): void {
  if (import.meta.env.DEV) {
    const violations = findPartitionViolations(restored.segments)
      .filter(v => v.kind === 'lock-lock-gap' || v.kind === 'lock-lock-overlap');
    if (violations.length > 0) {
      console.error(
        `[history] ${what} would restore a state that VIOLATES the gapless invariant `
        + `(${violations.length} site(s)). This means a bad state was captured, not that `
        + `the traversal is wrong — look at the writer that produced it.`,
        violations,
      );
    }
  }
  deps.setProjectSilent(restored);
  deps.setSelectedSegmentId(prev => repairSelectedSegmentId(prev, restored));
  deps.setSelectedHeadingId(prev => repairSelectedHeadingId(prev, restored));
  deps.setSelectedSegmentIds(prev => repairSelectedSegmentIds(prev, restored));
  deps.setCurrentTime(prev => clampCurrentTimeToRestoredEnd(prev, restored));
}

// ---------------------------------------------------------------------------
// blockedByLock — App.tsx lines 1959-1975 (commit 5f2e385)
// ---------------------------------------------------------------------------

export interface BlockedByLockDeps {
  liveProjectRef: { current: Project };
  setHistoryAnchor: (v: { segmentId: string; nonce: number } | null) => void;
  showToast: (message: string, action?: { label: string; onClick: () => void }) => void;
  setProjectSilent: (action: ProjectUpdater) => void;
}

/** LOCK CONFLICT — blocks a traversal that would move a locked segment
 *  (owner ruling, design §5.1). Returns true when blocked. See `App.tsx`'s
 *  own `blockedByLock` doc comment (unmoved) for why "restore everything
 *  except the locked segment" is not buildable. */
export function isBlockedByLock(target: Project, deps: BlockedByLockDeps): boolean {
  const conflict = findLockConflict(deps.liveProjectRef.current.segments, target.segments);
  if (!conflict) return false;
  deps.setHistoryAnchor({ segmentId: conflict.segmentId, nonce: Date.now() });
  deps.showToast(lockConflictMessage(conflict), {
    label: 'Unlock',
    onClick: () => deps.setProjectSilent(prev => ({
      ...prev,
      segments: prev.segments.map(sg =>
        sg.id === conflict.segmentId ? { ...sg, locked: false } : sg),
    })),
  });
  return true;
}

// ---------------------------------------------------------------------------
// handleUndo / handleRedo — App.tsx lines 1977-2003 (commit 5f2e385)
// ---------------------------------------------------------------------------

export interface UndoRedoDeps {
  isResizingRef: { current: boolean };
  history: History<Project>;
  liveProjectRef: { current: Project };
  blockedByLock: (target: Project) => boolean;
  setHistory: (h: History<Project>) => void;
  applyRestoredState: (restored: Project, what: string) => void;
  setHistoryAnchor: (v: { segmentId: string; nonce: number } | null) => void;
}

export function performUndo(deps: UndoRedoDeps): void {
  // A live drag owns the timeline until it resolves. An undo landing between a
  // gesture's direct DOM writes and its commit would leave the preview and
  // state disagreeing, with the drag's own release then committing on top of
  // the restored array.
  if (deps.isResizingRef.current) return;
  const t = undoHistory(deps.history, deps.liveProjectRef.current);
  if (!t) return;
  if (deps.blockedByLock(t.entry.state)) return;
  deps.setHistory(t.history);
  deps.applyRestoredState(t.entry.state, `Undo ${t.entry.label}`);
  if (t.entry.anchorSegmentId) {
    deps.setHistoryAnchor({ segmentId: t.entry.anchorSegmentId, nonce: Date.now() });
  }
}

export function performRedo(deps: UndoRedoDeps): void {
  if (deps.isResizingRef.current) return;
  const t = redoHistory(deps.history, deps.liveProjectRef.current);
  if (!t) return;
  if (deps.blockedByLock(t.entry.state)) return;
  deps.setHistory(t.history);
  deps.applyRestoredState(t.entry.state, `Redo ${t.entry.label}`);
  if (t.entry.anchorSegmentId) {
    deps.setHistoryAnchor({ segmentId: t.entry.anchorSegmentId, nonce: Date.now() });
  }
}
