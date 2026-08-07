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
  computeGrabOffsetPx,
  resolveDragEdge,
  segmentEdgeContentX,
  timelineContentX,
  type DragEdge,
} from './dragGeometry';
import { NEGLIGIBLE_DRAG_SEC, resolveDragPreview } from './dragCascade';

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
  ) => boolean;
  /** `setProject(prev => ({ ...prev, segments: originalSegments }))`. */
  revertSegments: (originalSegments: VideoSegment[]) => void;
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
  const applyFrame = (): void => {
    rafId = null;
    if (!pendingEvent) return;
    lastEdgeX = edgeXFor(pendingEvent.clientX);
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
  const handleMove = (e: PointerEvent): void => {
    pendingEvent = e;
    hasMoved = true;
    if (rafId === null) rafId = requestAnimationFrame(applyFrame);
  };
  const handleUp = () => {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    // Ensure lastEdgeX reflects the final pointer position even if the
    // last pointermove's rAF frame had not fired yet — so the committed
    // size matches exactly where the user released.
    if (pendingEvent) lastEdgeX = edgeXFor(pendingEvent.clientX);
    deps.setResizingId(null);
    deps.setResizingType(null);
    document.body.classList.remove('resizing');
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    window.removeEventListener('pointercancel', handleCancel);
    // isResizingRef is cleared by the resizingId effect below,
    // not here — see D12 fix note there.
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
    if (hasMoved) {
      const swallowGhostClick = (clickEvent: MouseEvent) => {
        clickEvent.stopPropagation();
        clickEvent.preventDefault();
      };
      window.addEventListener('click', swallowGhostClick, { capture: true, once: true });
    }
    if (!hasMoved) return;
    // Ruled 2026-08-08 (docs/decisions/2026-08-08-pointercancel-ruling.md): a
    // cancelled gesture never commits, however far it moved before the OS
    // took the pointer away — it reverts, exactly like a blocked/negligible
    // drag below, so a segment-timing change can only ever land from a
    // genuine user-completed release.
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
    // Negligible drag — nothing to commit. K17: the last preview frame
    // resolved through the SAME threshold (resolveDragPreview) and so
    // already restored the original geometry; this setProject is the
    // state-side half of that and cannot move anything on screen.
    if (Math.abs(final.duration - originalTarget.duration) < NEGLIGIBLE_DRAG_SEC) {
      deps.revertSegments(originalSegments);
      return;
    }
    deps.clearSpeedBaseline();
    const succeeded = deps.commitDurationChange(
      originalSegments, id, final.duration, final.trimStart, direction, speedUpdate,
    );
    // null cascade → locked neighbour blocked. K17: the preview frames
    // resolved the same block to the same `originalSegments`, so the
    // cards are already sitting at their pre-drag geometry and this
    // revert moves nothing on screen — it only re-syncs state. Before
    // K17 this was a visible snap-back at release.
    if (!succeeded) deps.revertSegments(originalSegments);
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
