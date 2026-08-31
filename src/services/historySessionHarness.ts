/**
 * App.tsx history-wiring test harness (App.tsx debt cleanup, second attempt,
 * 2026-08-08) — the equivalent of `dragSessionHarness.ts` for
 * `historySession.ts`'s `commitProject`/`commitProjectSilent`/
 * `isBlockedByLock`/`applyRestoredStateImpl`/`performUndo`/`performRedo`.
 *
 * Unlike `dragSession.ts`, none of this cluster reaches the real DOM or
 * `window` directly — every dependency (refs, state setters, the toast
 * callback) is already injected through the `*Deps` interfaces in
 * `historySession.ts`. So, unlike `dragSessionHarness.ts`, this harness does
 * NOT need jsdom: it is a plain in-memory object holding fields that stand
 * in for `App.tsx`'s `useState`/`useRef` slots, running under the repo's
 * default `node` vitest environment. (Stage 0 of this cleanup run confirmed
 * jsdom IS available in this repo — proven out by `dragSessionHarness.ts`
 * itself — but "available" is not "required": reach for jsdom only when the
 * code under test actually touches the DOM, which this cluster never does.)
 *
 * A gesture is expressed as a chain of intentions, mirroring
 * `dragSessionHarness.ts`'s `grab().moveBy().release()` style:
 *
 *   const h = new HistorySessionHarness(makeProject());
 *   h.edit(p => ({ ...p, name: 'x' }), { label: 'rename' });
 *   h.undo();
 *   expect(h.project.name).toBe('Test Project');
 */

import type { Project } from '../types';
import {
  commitProject,
  commitProjectSilent,
  isBlockedByLock,
  applyRestoredStateImpl,
  performUndo,
  performRedo,
  type ProjectUpdater,
  type CommitProjectMeta,
} from './historySession';
import { emptyHistory, undoDepth, redoDepth, type History } from './history';
import type { OpenGesture } from './historyCoalesce';

export interface ToastCall {
  message: string;
  action?: { label: string; onClick: () => void };
}

export interface HistoryAnchorValue {
  segmentId: string;
  nonce: number;
}

export class HistorySessionHarness {
  /** The single mutable cell every `*Deps` interface's `liveProjectRef`
   *  reads/writes — the harness's stand-in for `App.tsx`'s real
   *  `liveProjectRef` (a `useRef`). */
  private readonly liveProjectRef: { current: Project };
  private readonly openGestureRef: { current: OpenGesture | null } = { current: null };
  private history: History<Project> = emptyHistory<Project>();
  private isResizingFlag = false;
  private historyAnchor: HistoryAnchorValue | null = null;
  private readonly toastCalls: ToastCall[] = [];
  private selectedSegmentId: string | null = null;
  private selectedHeadingId: string | null = null;
  private selectedSegmentIds: Set<string> = new Set();
  private currentTimeValue = 0;
  /** How many times each stand-in setter was actually invoked — for
   *  asserting a no-op write skips its downstream setters entirely, the
   *  same way a real `useState` setter call (vs. no call at all) is what
   *  re-renders. */
  private readonly callCounts = {
    setProjectRaw: 0,
    setHistory: 0,
    setSelectedSegmentId: 0,
    setSelectedHeadingId: 0,
    setSelectedSegmentIds: 0,
    setCurrentTime: 0,
    setHistoryAnchor: 0,
  };

  constructor(initialProject: Project) {
    this.liveProjectRef = { current: initialProject };
  }

  get project(): Project {
    return this.liveProjectRef.current;
  }

  get historyDepth(): number {
    return undoDepth(this.history);
  }

  get redoDepth(): number {
    return redoDepth(this.history);
  }

  get anchor(): HistoryAnchorValue | null {
    return this.historyAnchor;
  }

  get toasts(): readonly ToastCall[] {
    return this.toastCalls;
  }

  get callCountsSnapshot(): Readonly<typeof this.callCounts> {
    return { ...this.callCounts };
  }

  setResizing(value: boolean): this {
    this.isResizingFlag = value;
    return this;
  }

  get isResizing(): boolean {
    return this.isResizingFlag;
  }

  private readonly setProjectSilentBound = (action: ProjectUpdater): void => {
    commitProjectSilent(action, {
      liveProjectRef: this.liveProjectRef,
      setProjectRaw: () => { this.callCounts.setProjectRaw++; },
    });
  };

  private readonly applyRestoredStateBound = (restored: Project, what: string): void => {
    applyRestoredStateImpl(restored, what, {
      setProjectSilent: this.setProjectSilentBound,
      setSelectedSegmentId: (updater) => {
        this.callCounts.setSelectedSegmentId++;
        this.selectedSegmentId = updater(this.selectedSegmentId);
      },
      setSelectedHeadingId: (updater) => {
        this.callCounts.setSelectedHeadingId++;
        this.selectedHeadingId = updater(this.selectedHeadingId);
      },
      setSelectedSegmentIds: (updater) => {
        this.callCounts.setSelectedSegmentIds++;
        this.selectedSegmentIds = updater(this.selectedSegmentIds);
      },
      setCurrentTime: (updater) => {
        this.callCounts.setCurrentTime++;
        this.currentTimeValue = updater(this.currentTimeValue);
      },
    });
  };

  private readonly blockedByLockBound = (target: Project): boolean => {
    return isBlockedByLock(target, {
      liveProjectRef: this.liveProjectRef,
      setHistoryAnchor: (v) => {
        this.callCounts.setHistoryAnchor++;
        this.historyAnchor = v;
      },
      showToast: (message, action) => {
        this.toastCalls.push({ message, action });
      },
      setProjectSilent: this.setProjectSilentBound,
    });
  };

  /** Equivalent of a real `setProject(action, meta)` call site. */
  edit(action: ProjectUpdater, meta?: CommitProjectMeta): this {
    commitProject(action, meta, {
      liveProjectRef: this.liveProjectRef,
      setProjectRaw: () => { this.callCounts.setProjectRaw++; },
      setHistory: (updater) => {
        this.callCounts.setHistory++;
        this.history = updater(this.history);
      },
      openGestureRef: this.openGestureRef,
    });
    return this;
  }

  /** Equivalent of a real `setProjectSilent(action)` call site. */
  editSilent(action: ProjectUpdater): this {
    this.setProjectSilentBound(action);
    return this;
  }

  /** Directly runs `blockedByLock(target)` without a full undo/redo
   *  traversal — for characterizing the guard in isolation. */
  wouldBeBlockedBy(target: Project): boolean {
    return this.blockedByLockBound(target);
  }

  /** Directly runs `applyRestoredState(restored, what)` in isolation. */
  applyRestored(restored: Project, what = 'test'): this {
    this.applyRestoredStateBound(restored, what);
    return this;
  }

  undo(): this {
    performUndo({
      isResizingRef: { current: this.isResizingFlag },
      history: this.history,
      liveProjectRef: this.liveProjectRef,
      blockedByLock: this.blockedByLockBound,
      setHistory: (h) => { this.callCounts.setHistory++; this.history = h; },
      applyRestoredState: this.applyRestoredStateBound,
      setHistoryAnchor: (v) => { this.callCounts.setHistoryAnchor++; this.historyAnchor = v; },
      selectedSegmentId: this.selectedSegmentId,
      setSelectedSegmentId: (id) => { this.callCounts.setSelectedSegmentId++; this.selectedSegmentId = id; },
    });
    return this;
  }

  redo(): this {
    performRedo({
      isResizingRef: { current: this.isResizingFlag },
      history: this.history,
      liveProjectRef: this.liveProjectRef,
      blockedByLock: this.blockedByLockBound,
      setHistory: (h) => { this.callCounts.setHistory++; this.history = h; },
      applyRestoredState: this.applyRestoredStateBound,
      setHistoryAnchor: (v) => { this.callCounts.setHistoryAnchor++; this.historyAnchor = v; },
      selectedSegmentId: this.selectedSegmentId,
      setSelectedSegmentId: (id) => { this.callCounts.setSelectedSegmentId++; this.selectedSegmentId = id; },
    });
    return this;
  }

  get selection(): { segmentId: string | null; headingId: string | null; segmentIds: Set<string> } {
    return {
      segmentId: this.selectedSegmentId,
      headingId: this.selectedHeadingId,
      segmentIds: this.selectedSegmentIds,
    };
  }

  setSelection(segmentId: string | null): this {
    this.selectedSegmentId = segmentId;
    return this;
  }

  get currentTime(): number {
    return this.currentTimeValue;
  }

  setCurrentTime(t: number): this {
    this.currentTimeValue = t;
    return this;
  }
}
