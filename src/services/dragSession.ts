/**
 * Timeline drag-resize SESSION — the DOM/pointer-event orchestration for one
 * segment-boundary drag gesture, extracted out of `App.tsx`'s `onResizeStart`
 * (WS2 task 1, 2026-08-07). Verbatim move, no behaviour change: every pure
 * timing/geometry decision was already extracted in prior work —
 * `computeDragCascade`/`resolveDragPreview`/`NEGLIGIBLE_DRAG_SEC`
 * (`dragCascade.ts`, K15/K17) and `timelineContentX`/`segmentEdgeContentX`/
 * `computeGrabOffsetPx`/`resolveDragEdge` (`dragGeometry.ts`, K16) — neither
 * file is touched by this extraction. What lived on in `App.tsx` was purely
 * the glue: querying the DOM for the dragged segment's card elements, writing
 * `style.left`/`style.width` directly (bypassing React, per K17's own
 * rationale — see `dragCascade.ts`'s header), rAF-coalescing pointermove into
 * one preview write per frame, and wiring/tearing down the window pointer
 * listeners around the release commit.
 *
 * `startDragSession` is a plain function, not a hook — it holds no React
 * state and calls no hooks. Every piece of React state it needs to read or
 * write crosses through `DragSessionDeps`, so `App.tsx` keeps every
 * `useState`/`useRef` declaration exactly where it was; this module only
 * receives accessor functions. `App.tsx`'s `onResizeStart` prop is now a
 * thin call-in: validate the drag-start guards that were always inline here
 * (dragged segment exists, timeline element exists), then hand off.
 *
 * TEARDOWN IS STRUCTURAL, NOT POSITIONAL (WS2 re-scope, 2026-08-08). Every
 * side effect a gesture leaves behind is undone in ONE `teardown()` function,
 * invoked from `handleUp`'s `finally` — so commit, revert-blocked, and
 * pointercancel-discard all unwind identically and no resolution path can
 * return without it. It used to be an inline block at the top of `handleUp`,
 * above that function's early returns: correct, but enforced by nothing, and
 * broken twice in one day by edits that added a return above a cleanup step.
 * See `teardown`'s own comment for the two failures and the ordering argument.
 *
 * FOUND, NOT FIXED — a real bug preserved verbatim by this move (see
 * `project-state.md`): the original code set `resizingId`/`resizingType`/the
 * `resizing` body class UNCONDITIONALLY, before validating that the dragged
 * segment or the timeline element actually exist, and nothing on that early
 * bail path ever clears them. A drag that starts against a stale segment id
 * or before the timeline DOM node exists would leave `resizingId` stuck
 * non-null and the `resizing` cursor class stuck on `<body>` forever. Left
 * exactly as it was — a fix here would be a second, unverifiable behaviour
 * change riding along with a refactor whose whole point is to have none.
 */

import type { Asset, TranscriptToken, VideoSegment } from '../types';
import {
  computeAutoScrollVelocity,
  computeGrabOffsetPx,
  resolveDragEdge,
  segmentEdgeContentX,
  timelineContentX,
  type DragEdge,
} from './dragGeometry';
import {
  DRAG_CASCADE_OPTIONS,
  isDragEdgeLocked,
  resolveDragPreview,
  type DragCascadeOptions,
} from './dragCascade';

/**
 * The frame clock a drag runs on. Injected rather than called directly so the
 * auto-scroll loop (checklist step 9) is deterministic under test: a real rAF
 * ramp scrolls by however much wall-clock time happened to pass between frames,
 * which is untestable, whereas a stub can advance time by an exact amount.
 *
 * The default delegates to the bare `requestAnimationFrame`/`cancelAnimationFrame`
 * identifiers AT CALL TIME, so they still resolve through `globalThis` — which
 * is what `dragSessionHarness.ts`'s existing manual-flush rAF stub overrides.
 * Injecting nothing therefore preserves the pre-step-9 behaviour exactly.
 */
export interface DragScheduler {
  requestFrame: (cb: (timeMs: number) => void) => number;
  cancelFrame: (handle: number) => void;
  now: () => number;
}

const defaultScheduler: DragScheduler = {
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

export interface DragSessionDeps {
  /** Segment array snapshot at drag start — `projectRef.current.segments`. */
  getSegments: () => VideoSegment[];
  /** Current timeline zoom — `pixelsPerSecondRef.current`. */
  getPixelsPerSecond: () => number;
  /** Current asset list — `assetsRef.current` — to resolve the dragged
   *  segment's asset type for the video speed-coupling gate. */
  getAssets: () => Asset[];
  /** Live transcript tokens — `projectRef.current.transcriptTokens` — read
   *  fresh on EVERY preview frame (not snapshotted at drag start), so the
   *  preview's yield floor matches what the commit will read. */
  getTranscriptTokens: () => TranscriptToken[] | undefined;
  setResizingId: (id: string | null) => void;
  setResizingType: (type: DragEdge | null) => void;
  /** `isResizingRef.current = true`. Only ever called with `true` here — the
   *  `false` clear lives in App.tsx's `resizingId`-keyed effect (D12 fix),
   *  untouched by this extraction. */
  setIsResizing: (value: boolean) => void;
  /** `speedBaselineRef.current = null`. */
  clearSpeedBaseline: () => void;
  /** = `applyDurationChange`. Returns true on success, false if a locked
   *  neighbour blocked the cascade. */
  commitDurationChange: (
    originalSegments: VideoSegment[],
    segmentId: string,
    newDuration: number,
    finalTrimStart: number,
    fromSide: 'left' | 'right',
    additionalUpdates?: Partial<VideoSegment>,
    /** Cascade switches. The drag path passes `DRAG_CASCADE_OPTIONS` so the
     *  commit conserves total duration exactly as the live preview did; the
     *  speed slider, which shares `applyDurationChange`, passes nothing. */
    options?: DragCascadeOptions,
  ) => boolean;
  /** `setProject(prev => ({ ...prev, segments: originalSegments }))`. */
  revertSegments: (originalSegments: VideoSegment[]) => void;
  /** Frame clock. Omit in production — the default drives the real rAF. */
  scheduler?: DragScheduler;
}

/**
 * Starts one timeline segment-resize drag gesture. Wires window pointer
 * listeners, rAF-coalesces pointermove into a single live-preview DOM write
 * per frame (bypassing React — see this file's header), and on release
 * either commits through `deps.commitDurationChange` or reverts through
 * `deps.revertSegments`.
 *
 * Verbatim extraction of `App.tsx`'s former `onResizeStart` body
 * (K15-K17-era code, moved unchanged at WS2 task 1) — every expression,
 * clamp, and ordering, including the top-of-closure bug documented above, is
 * preserved exactly.
 */
export function startDragSession(
  id: string,
  type: DragEdge,
  downClientX: number,
  deps: DragSessionDeps,
): void {
  // ---------------------------------------------------------------------
  // DEFENSIVE LAYER — the last segment's right edge is inert (owner ruling
  // 2026-08-08, docs/decisions/2026-08-08-last-segment-edge.md).
  //
  // `Timeline.tsx` already declines to render a hit target there, so in the
  // shipped UI this is unreachable. That is exactly why it is here: an
  // affordance-only lock is undone the first time someone refactors the JSX
  // or adds a second way to start a drag (a keyboard nudge, a context menu,
  // a test harness), and nothing would fail. Both layers read the SAME
  // predicate, so they cannot disagree about which edges are inert.
  //
  // Placed ABOVE the `setResizingId`/`setResizingType`/body-class writes on
  // purpose. Those three run unconditionally in the original code and are
  // never cleared on the two early-bail paths just below — a real, still
  // UNRULED bug this extraction preserved verbatim (see this file's header
  // and project-state.md). Returning before them means this new refusal
  // cannot leave that stuck state behind, and does not disturb the existing
  // bug in either direction.
  // ---------------------------------------------------------------------
  const segmentsAtStart = deps.getSegments();
  if (isDragEdgeLocked(segmentsAtStart, segmentsAtStart.findIndex(s => s.id === id), type)) {
    return;
  }

  deps.setResizingId(id);
  deps.setResizingType(type);
  document.body.classList.add('resizing');
  // Snapshot original segments at drag-start; used for cascade + revert.
  const originalSegments = deps.getSegments();
  const draggedIdx = originalSegments.findIndex(s => s.id === id);
  const originalTarget = originalSegments[draggedIdx];
  if (draggedIdx < 0 || !originalTarget) return;
  // K17 — pre-drag geometry, for restoring any card a later frame
  // stops moving (see writeGeometry below).
  const originalById = new Map(originalSegments.map(s => [s.id, s]));
  const pps = deps.getPixelsPerSecond();
  // B3 — cache the timeline element + its left edge ONCE at drag start.
  // rect.left is stable for the whole gesture, so re-measuring it (a
  // layout read) on every move was pure thrash. scrollLeft is still
  // read live, but only at the top of each rAF frame, before any write.
  const timeline = document.getElementById('timeline-scroll-area');
  if (!timeline) return;
  const rectLeft = timeline.getBoundingClientRect().left;
  // B1 — elements whose geometry we update directly during the drag,
  // so we avoid a per-move setProject/full re-render. The real state
  // change is committed ONCE on pointerup, below.
  //
  // K17 — indexed by segment id, for EVERY segment, not just the
  // dragged one. The cascade moves neighbours, so the preview has to
  // move them too; leaving them frozen is what let a growing segment's
  // edge run straight through the next card and then snap everything
  // into place on release (services/dragCascade.ts's resolveDragPreview
  // documents the three symptoms). Both lanes tag their cell with the
  // same data-seg-id, so one id can map to several elements.
  const elsBySegId = new Map<string, HTMLElement[]>();
  for (const el of Array.from(
    timeline.querySelectorAll<HTMLElement>('[data-seg-id]'),
  )) {
    const segId = el.dataset.segId;
    if (!segId) continue;
    const bucket = elsBySegId.get(segId);
    if (bucket) bucket.push(el);
    else elsBySegId.set(segId, [el]);
  }
  let hasMoved = false;
  // Set only by handleCancel, never by a genuine pointerup — distinguishes an
  // OS-forced gesture takeover from a real user-completed release. See
  // docs/decisions/2026-08-08-pointercancel-ruling.md: a cancelled gesture
  // discards rather than commits, since a silent, unreviewed segment-timing
  // change is worse for this app than losing one gesture the user can redo.
  let wasCancelled = false;
  // Capture video context at drag-start for speed coupling.
  const dragAsset = deps.getAssets().find(a => a.id === originalTarget.assetId);
  const isVideoSeg = dragAsset?.type === 'video';

  // K16 — how far the pointer sat from the edge it grabbed, held
  // constant for the whole gesture. Subtracting it on every move is
  // what keeps the edge under the exact point of the handle the user
  // is holding, instead of snapping it to the pointer on the first
  // move (the handles are 8px wide, so that snap was worth up to 8px).
  const grabOffsetPx = computeGrabOffsetPx(
    timelineContentX(downClientX, rectLeft, timeline.scrollLeft),
    originalTarget,
    type,
    pps,
  );
  // Content-space x the grabbed edge should sit at, for a given
  // pointer position. timelineContentX carries NO padding correction —
  // the container measures 0px padding / 0px border; the pre-K16 `- 24`
  // was a stale constant from the initial commit's `p-6` container and
  // was placing every dragged edge 24px left of the pointer.
  const edgeXFor = (clientX: number): number =>
    timelineContentX(clientX, rectLeft, timeline.scrollLeft) - grabOffsetPx;
  let lastEdgeX = segmentEdgeContentX(originalTarget, type, pps);
  const direction = type === 'end' ? 'right' as const : 'left' as const;

  // K17 — ids whose DOM geometry this drag has overwritten. Needed
  // because we are writing behind React's back: React diffs the style
  // props it rendered LAST against the ones it renders NEXT, and never
  // looks at the DOM. So a card we moved on frame 10 and that the
  // cascade no longer touches on frame 20 (the cascade window can
  // shrink as the pointer comes back) would keep frame 10's inline
  // styles forever — React sees no prop change and issues no write.
  // Each frame therefore restores anything it did not itself move.
  let writtenIds = new Set<string>();

  /** Writes `segs`' geometry straight to the DOM. `segs` is always a
   *  full array in the original order, so index i lines up with
   *  originalSegments[i]. */
  const writeGeometry = (segs: VideoSegment[]): void => {
    const moved = new Set<string>();
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]!;
      const orig = originalSegments[i];
      if (!orig) continue;
      if (s.startTime === orig.startTime && s.duration === orig.duration) continue;
      const els = elsBySegId.get(s.id);
      if (!els) continue;
      // Exactly Timeline.tsx's own layout expression
      // (computeSegmentLayout): left = startTime * pps,
      // width = duration * pps. Anything else here would make the
      // preview and the post-commit render disagree by construction.
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
    writtenIds = moved;
  };

  // B5 — coalesce pointermoves into a single rAF; only the latest
  // pointer position matters per frame. The frame body stays the
  // cheapest thing that can express the drag: one scrollLeft read, two
  // pure calls, and two style writes per moved element. No React state
  // is touched, so no render and no timing recomputation until release.
  let rafId: number | null = null;
  let pendingEvent: PointerEvent | null = null;
  /** Resolves the drag for a pointer position and writes the live preview.
   *  Shared by the pointermove frame and the auto-scroll tick, so a gesture
   *  driven by the scroll ramp resolves through exactly the same math as one
   *  driven by pointer motion. */
  const resolveAndWrite = (clientX: number): void => {
    lastEdgeX = edgeXFor(clientX);
    // Same two functions the commit below resolves through, in the
    // same order, so the live preview cannot drift from what will
    // actually be committed:
    //   resolveDragEdge   — pointer position → this segment's timing
    //   resolveDragPreview — that timing → the whole array
    // K16's pointer math is untouched; the edge still sits exactly
    // under the grabbed point of the handle.
    const live = resolveDragEdge({
      segment: originalTarget,
      edge: type,
      edgeContentX: lastEdgeX,
      pixelsPerSecond: pps,
      isVideo: isVideoSeg,
    });
    // Read the tokens live rather than closing over a drag-start copy,
    // so the preview's yield floor is the same input applyDurationChange
    // will read at commit time.
    writeGeometry(resolveDragPreview(
      originalSegments,
      draggedIdx,
      live.duration,
      live.trimStart,
      direction,
      deps.getTranscriptTokens(),
    ));
  };
  const applyFrame = (): void => {
    rafId = null;
    if (!pendingEvent) return;
    resolveAndWrite(pendingEvent.clientX);
  };

  // ---------------------------------------------------------------------
  // EDGE AUTO-SCROLL (manual WKWebView checklist step 9, 2026-08-08)
  //
  // Dragging toward the edge of the timeline's visible area used to simply
  // stop being useful: the pointer left the viewport and the drag could not
  // reach anything further along the timeline.
  //
  // The coordinate correctness the brief warns about is structural here, not
  // something this loop has to get right by hand. `timelineContentX` is
  // `clientX - rectLeft + scrollLeft` and `edgeXFor` reads `timeline.scrollLeft`
  // LIVE on every resolve, so content-space x already advances when the
  // container scrolls under a stationary pointer. Auto-scroll therefore adds no
  // delta arithmetic of its own — it moves `scrollLeft` and re-resolves through
  // the SAME `resolveAndWrite` a pointermove uses. That is also why a drag that
  // reaches a given content-x by scrolling commits identically to one that
  // reaches it by pointer motion alone (pinned by a property test).
  //
  // It needs its own frame loop rather than riding on pointermove: a pointer
  // HELD STILL at the edge emits no further pointermove events, and that is
  // precisely the gesture that must keep scrolling.
  // ---------------------------------------------------------------------
  const scheduler = deps.scheduler ?? defaultScheduler;
  let autoScrollHandle: number | null = null;
  let autoScrollLastMs = 0;
  let lastClientX = downClientX;

  const stopAutoScroll = (): void => {
    if (autoScrollHandle === null) return;
    scheduler.cancelFrame(autoScrollHandle);
    autoScrollHandle = null;
  };

  const autoScrollTick = (nowMs: number): void => {
    autoScrollHandle = null;
    const rect = timeline.getBoundingClientRect();
    const velocity = computeAutoScrollVelocity(lastClientX, rect.left, timeline.clientWidth);
    // Zero velocity = the pointer came back inside the viewport. This is the
    // loop's only termination condition besides teardown.
    if (velocity === 0) return;
    // Clamp the delta so a stalled tab (or a debugger pause) cannot resume with
    // one enormous jump.
    const deltaSec = Math.min(0.05, Math.max(0, (nowMs - autoScrollLastMs) / 1000));
    autoScrollLastMs = nowMs;
    const maxScroll = Math.max(0, timeline.scrollWidth - timeline.clientWidth);
    const before = timeline.scrollLeft;
    const next = Math.max(0, Math.min(maxScroll, before + velocity * deltaSec));
    if (next !== before) {
      timeline.scrollLeft = next;
      // The pointer has not moved, but content-space x has — re-resolve so the
      // dragged edge tracks the newly-revealed timeline.
      resolveAndWrite(lastClientX);
    }
    // Keep ticking even when pinned at a scroll limit, so backing off the limit
    // resumes immediately rather than waiting for the next pointermove.
    autoScrollHandle = scheduler.requestFrame(autoScrollTick);
  };

  const updateAutoScroll = (): void => {
    const rect = timeline.getBoundingClientRect();
    const velocity = computeAutoScrollVelocity(lastClientX, rect.left, timeline.clientWidth);
    if (velocity === 0) {
      stopAutoScroll();
      return;
    }
    if (autoScrollHandle !== null) return;
    autoScrollLastMs = scheduler.now();
    autoScrollHandle = scheduler.requestFrame(autoScrollTick);
  };

  const handleMove = (e: PointerEvent): void => {
    pendingEvent = e;
    lastClientX = e.clientX;
    hasMoved = true;
    if (rafId === null) rafId = requestAnimationFrame(applyFrame);
    updateAutoScroll();
  };
  // ---------------------------------------------------------------------
  // TEARDOWN — the ONE place a gesture's side effects are undone, shared
  // verbatim by all three resolutions (commit, revert-blocked, discard).
  //
  // STRUCTURAL FIX (WS2 re-scope, 2026-08-08). This block used to sit inline
  // at the top of `handleUp`, ABOVE that function's `!hasMoved` and
  // `wasCancelled` early returns. That was correct, but only positionally:
  // nothing enforced it, and the invariant "teardown is above every return"
  // is exactly the kind a later edit silently breaks. It already had —
  // twice. The 2026-08-08 discard ruling added the `wasCancelled` early
  // return, which skipped the then-below-it `clearSpeedBaseline()` and
  // stranded a stale speed baseline; and the ghost-click swallower armed on
  // a cancel that produces no click, leaving a one-shot listener waiting to
  // eat the user's next legitimate click anywhere in the app. Both were
  // found by hand (manual checklist step 10), not by the suite.
  //
  // `handleUp` now calls this from a `finally`, so no resolution path — and
  // no future one, and not even a throw out of `commitDurationChange` — can
  // return without it running. Idempotent via `torndown`.
  //
  // ORDERING NOTE: this now runs AFTER the commit rather than before it. All
  // four effects are order-independent with respect to `commitDurationChange`:
  // the React setters land in the same batch either way; no pointer or click
  // event can arrive during a synchronous handler, so listener removal and
  // swallower arming cannot race it; no rAF frame can fire mid-body; and
  // `applyDurationChange` (the real `commitDurationChange`) never reads
  // `speedBaselineRef` — verified by grep over App.tsx, whose only readers are
  // the separate speed-slider gesture in `handleSpeedChange`.
  let torndown = false;
  const teardown = (): void => {
    if (torndown) return;
    torndown = true;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    // Step 9's auto-scroll loop is self-perpetuating — it re-arms itself every
    // tick and stops only when the pointer re-enters the viewport. A gesture
    // that ends while the pointer is still parked in an edge zone would
    // otherwise leave it scrolling forever. This is exactly the cleanup class
    // the `finally` above exists to make unmissable.
    stopAutoScroll();
    deps.setResizingId(null);
    deps.setResizingType(null);
    document.body.classList.remove('resizing');
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    window.removeEventListener('pointercancel', handleCancel);
    // isResizingRef is cleared by App.tsx's resizingId-keyed effect, not
    // here — see the D12 fix note there.
    if (!hasMoved) return;
    // D12 fix (round 4) — the real cause of the "playhead jumps to
    // wherever I dragged" report: the left-edge handle sits at a fixed
    // `left-0` inside the card, so after a left-edge drag the pointer
    // ends up away from it and the browser's native 'click', hit-tested
    // at the release position, lands on the segment ROW body instead of
    // the handle — and that row's onClick is onSeek(s.startTime)
    // (Timeline.tsx), a real, direct setCurrentTime call. Swallow
    // exactly that one ghost click before any React handler can see it.
    // (K16 note: the card now tracks the pointer on a left-edge drag,
    // which narrows but does not close this — the handle is only 8px
    // wide and the release can still land beside it — so the swallow
    // stays.)
    // Manual triage 2026-08-08 (checklist step 10) — armed ONLY for a genuine
    // pointerup. A `pointercancel` produces no synthetic click at all, so
    // arming it there left the one-shot swallower permanently armed.
    if (!wasCancelled) {
      const swallowGhostClick = (clickEvent: MouseEvent) => {
        clickEvent.stopPropagation();
        clickEvent.preventDefault();
      };
      window.addEventListener('click', swallowGhostClick, { capture: true, once: true });
    }
    // This gesture moved, so its speed baseline is spent however it resolved —
    // commit, cancel, or block.
    deps.clearSpeedBaseline();
  };

  const handleUp = () => {
    try {
      // Ensure lastEdgeX reflects the final pointer position even if the
      // last pointermove's rAF frame had not fired yet — so the committed
      // size matches exactly where the user released. Must run before the
      // commit below, so it is gesture input, not teardown.
      if (pendingEvent) lastEdgeX = edgeXFor(pendingEvent.clientX);
      if (!hasMoved) return;
      // Ruled 2026-08-08 (docs/decisions/2026-08-08-pointercancel-ruling.md): a
      // cancelled gesture never commits, however far it moved before the OS
      // took the pointer away — it reverts, exactly like a blocked drag below,
      // so a segment-timing change can only ever land from a genuine
      // user-completed release.
      if (wasCancelled) {
        deps.revertSegments(originalSegments);
        return;
      }
      // Commit — one pure call, the identical one the live frames used.
      const final = resolveDragEdge({
        segment: originalTarget,
        edge: type,
        edgeContentX: lastEdgeX,
        pixelsPerSecond: pps,
        isVideo: isVideoSeg,
      });
      const speedUpdate = final.playbackSpeed === undefined
        ? undefined
        : { playbackSpeed: final.playbackSpeed };
      // F7, OWNER RULING 2026-08-08 — there is no negligible-drag threshold any
      // more. A drag that moved is committed however small it was: fine
      // adjustment at high zoom is a real editing gesture, and silently
      // discarding it made the timeline feel like it was ignoring the user. The
      // guard against a plain CLICK committing anything is `hasMoved` above,
      // which is unaffected — it requires an actual pointermove, not a distance.
      const succeeded = deps.commitDurationChange(
        originalSegments, id, final.duration, final.trimStart, direction, speedUpdate,
        // The SAME options object `resolveDragPreview` used for every frame of
        // this gesture. Preview and commit must resolve identically or the
        // cards jump on release (K17) — and here specifically, a commit that
        // did not conserve would lengthen the timeline after a preview that
        // showed it not lengthening.
        DRAG_CASCADE_OPTIONS,
      );
      // null cascade → locked neighbour blocked. K17: the preview frames
      // resolved the same block to the same `originalSegments`, so the
      // cards are already sitting at their pre-drag geometry and this
      // revert moves nothing on screen — it only re-syncs state. Before
      // K17 this was a visible snap-back at release.
      if (!succeeded) deps.revertSegments(originalSegments);
    } finally {
      teardown();
    }
  };
  // A cancelled pointer (OS gesture takeover, device switch, system
  // interruption) must not leave the drag armed forever — but unlike a real
  // release, it must not commit either (ruled 2026-08-08, see the
  // `wasCancelled` branch in `handleUp` above): this flag is the only way
  // `handleUp` can tell a forced cancel apart from a genuine pointerup.
  const handleCancel = (): void => {
    wasCancelled = true;
    handleUp();
  };
  deps.setIsResizing(true);
  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp);
  window.addEventListener('pointercancel', handleCancel);
}
