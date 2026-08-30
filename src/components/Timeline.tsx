/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Play, Pause, RotateCcw, AlertCircle, Heading1,
} from 'lucide-react';
import { VideoSegment, Asset, HeadingOverlay } from '../types';
import { patchUiState } from '../services/uiStateStore';
import { resizeHeading } from '../services/headingLayer';
import { isDragEdgeLocked } from '../services/dragCascade';
import { isSliceSegmentId } from '../services/segmentId';
import { WaveformSource } from '../services/waveformPeaks';
import { useTimelineWaveform } from './TimelineWaveform';
import {
  computeZoomPixelsPerSecond,
  computeBoundaryMarkerPositions,
  computeSegmentLayout,
  computeHeadingLayout,
  computeSeekTimeFromClientX,
  resolveHistoryAnchorAction,
} from '../services/timelineLayout';

const MIN_SEGMENT_DURATION = 0.3; // seconds — mirrors App.tsx constant

// Timeline content width (and lane widths derived from it) must span the
// actual rightmost segment edge, not just the sum of durations — the two
// only coincide when segments are gapless/contiguous. Falls back to the
// duration sum (still gapless-safe) when there are no segments at all.
// Parameter widened to the two fields it actually reads (2026-08-08) — same
// structural-typing convention `timelinePartition.ts`'s checkers already use,
// and for the same reason: the total-duration invariant guard must be able to
// ask this question of a live-DOM readback (`readLiveSegments`), which carries
// timing but not text/transition/animation. Type-only; no runtime change, and
// every existing `VideoSegment[]` caller still satisfies it.
export function computeTotalDuration(segments: Pick<VideoSegment, 'startTime' | 'duration'>[]): number {
  if (segments.length === 0) return 1;
  const maxEnd = segments.reduce((acc, s) => Math.max(acc, s.startTime + s.duration), 0);
  return maxEnd || segments.reduce((acc, s) => acc + s.duration, 0) || 1;
}

interface Props {
  segments: VideoSegment[];
  assets: Asset[];
  headings: HeadingOverlay[];
  currentSegmentId: string | undefined;
  currentTime: number;
  isPlaying: boolean;
  isSynced: boolean;
  sliderT: number;
  onPixelsPerSecondChange: (pps: number) => void;
  globalPlaybackSpeed: number;
  /** Undo/redo anchor (design §5.2) — the segment a traversal should reveal and
   *  flash. The `nonce` is what makes a repeat traversal onto the SAME segment
   *  re-fire the flash; keying on the id alone would light it once and then stay
   *  silent while the user pressed undo four more times on the same segment.
   *  `null` when no traversal has happened, or when the entry carried no anchor
   *  (an apply-to-all, or an Apply Sync whose ids no longer resolve). */
  historyAnchor?: { segmentId: string; nonce: number } | null;
  resizingId: string | null;
  resizingType: 'start' | 'end' | null;
  voiceoverName: string | undefined;
  // Waveform peaks are built ONCE upfront in App.tsx's Apply-Sync flow (and a
  // reload effect) via services/waveformPipeline, then passed in here. Timeline
  // splits the waveform into multiple ≤16384px canvas tiles at the current zoom
  // level (useTimelineWaveform) and lays them out as CSS multi-background layers
  // on one shared lane — true 1:1 fidelity at any zoom, debounced rebuild on
  // zoom change (docs/history.md).
  waveformSource: WaveformSource | null;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  /** K16 — `clientX` is the pointerdown position, required so the drag can hold
   *  the grabbed edge under the exact point of the handle the user pressed
   *  instead of snapping it to the pointer (services/dragGeometry.ts's
   *  `computeGrabOffsetPx`). Without it the edge jumps by up to the handle's
   *  own 8px on the first move. */
  onResizeStart: (id: string, type: 'start' | 'end', clientX: number) => void;
  onSegmentUpdate: (updater: (prev: VideoSegment[]) => VideoSegment[]) => void;
  onOpenStockSearch: (segmentId: string) => void;
  onSelectSegment?: (id: string) => void;
  /** WS2 ws2-23 (bugs 4/6) — a SINGLE click on a clip. Distinct from
   *  `onSelectSegment` (double-click, which OPENS the scene drawer): this
   *  only tells App which clip the pointer landed on, so an ALREADY-open
   *  drawer can retarget to it. A plain seek-click on a closed drawer must
   *  not pop one open, which is why this is a separate signal. */
  onClipClick?: (id: string) => void;
  onHeadingResizeCommit?: (id: string, next: { time: number; duration: number }) => void;
  initialScrollLeft?: number;
  /** WS2 T2.1 Commit 3 — restores every absorbed-gap cluster hosted on the
   *  named segment. Optional; the right-click "Restore absorbed segments"
   *  menu item simply doesn't render without it. */
  onRestoreAbsorbedGaps?: (segmentId: string) => void;
  /** WS2 ws2-25 Commit 4 — deletes a split slice or individually-restored
   *  segment. Optional; the right-click "Delete segment" menu item simply
   *  doesn't render without it. Applies the same eligibility rule as the D
   *  shortcut (segmentSplitDelete.ts's `deleteSegment`) — a native segment
   *  right-clicked here shows no delete entry. */
  onDeleteSegment?: (segmentId: string) => void;
  /** WS2 ws2-25 Commit 4 — ids of every individually-restored absorbed-gap
   *  segment (`Project.segmentOverrides`'s own keys). A split slice is
   *  detected structurally instead (`isSliceSegmentId`) and needs nothing
   *  passed in for it — see DropZonePanel's identical prop for the same
   *  reasoning. */
  restoredSegmentIds?: ReadonlySet<string>;
}

export function Timeline({
  segments,
  assets,
  headings,
  currentSegmentId,
  currentTime,
  isPlaying,
  isSynced,
  sliderT,
  onPixelsPerSecondChange,
  globalPlaybackSpeed,
  historyAnchor,
  resizingId,
  resizingType,
  voiceoverName,
  waveformSource,
  onTogglePlay,
  onSeek,
  onResizeStart,
  onSegmentUpdate,
  onOpenStockSearch,
  onSelectSegment,
  onClipClick,
  onHeadingResizeCommit,
  initialScrollLeft,
  onRestoreAbsorbedGaps,
  onDeleteSegment,
  restoredSegmentIds,
}: Props) {
  const totalDuration = useMemo(() => computeTotalDuration(segments), [segments]);

  // WS2 T2.1 Commit 3 — right-click context menu. Not a general-purpose
  // reusable menu component: scoped to these two actions (restore, and —
  // WS2 ws2-25 Commit 4 — delete), dismissed on outside click or Escape.
  // Holds only the id; which action(s) apply is recomputed at render time
  // from the current segment/props, so it can never disagree with the
  // eligibility check the click handler itself just ran.
  const [gapContextMenu, setGapContextMenu] = useState<{ segmentId: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!gapContextMenu) return;
    const close = (): void => setGapContextMenu(null);
    const closeOnEscape = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [gapContextMenu]);

  const [containerWidth, setContainerWidth] = useState(0);

  // Measure the scroll container so the zoom formula can derive ppsMin from the
  // available width. Falls back to 800 until the first observation lands.
  useEffect(() => {
    const container = document.getElementById('timeline-scroll-area');
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // F2 (manual triage 2026-08-08) — THE ZOOM BASIS.
  //
  // Reported: dragging the LAST segment's right edge stretches it and also
  // moves every earlier segment. The committed array is not at fault — it is
  // provably untouched outside the dragged index (dragTriage.test.ts pins
  // that) — the movement is a rescale. `computeZoomPixelsPerSecond` derives
  // its lower bound `ppsMin` as a FIT-TO-WIDTH term, `(width * 0.95) /
  // totalDuration`, so lengthening the timeline shrinks pixelsPerSecond, and
  // every card's `left = startTime * pixelsPerSecond` shrinks with it. Measured
  // on the triage fixture: segment B's left went 300px -> 259.09px without B's
  // own timing changing by a single millisecond.
  //
  // So the zoom is evaluated against a BASIS duration that a resize drag never
  // moves, rather than against live `totalDuration`. An edit changes what the
  // timeline contains, not how far you are zoomed into it — the invariant the
  // report states as "nothing before the dragged segment should ever move".
  // The basis re-syncs to reality the moment the user does something that is
  // genuinely about scale: touching the zoom slider, or the panel being
  // resized. Everything else on this component — lane widths, scroll extent,
  // marker and card positions — still reads live `totalDuration`; only the
  // zoom formula reads the basis.
  //
  // ---------------------------------------------------------------------
  // IS THIS STILL LOAD-BEARING AFTER THE 2026-08-08 RULING? — investigated,
  // answer: PROBABLY NOT, BUT NOT PROVABLY SO. KEPT.
  // (docs/decisions/2026-08-08-last-segment-edge.md)
  //
  // The ruling makes total timeline duration immutable via drag, which is
  // the only thing this freeze suppresses — so the obvious reading is that
  // it is now dead code. It was removed and measured:
  //
  //   [MEASURED] With the freeze deleted (`zoomBasisDuration = totalDuration`),
  //   the full suite is GREEN — 1529 passed / 1 skipped, `tsc` clean. So the
  //   suite cannot distinguish the two, which is expected: nothing renders
  //   this component through a duration-changing gesture and measures the
  //   resulting `pixelsPerSecond`.
  //
  //   [ASSERTED] Structurally it now suppresses nothing. Its guard is
  //   `resizingId !== null`, and `resizingId` is written in exactly two
  //   places, both in `dragSession.ts` (set at gesture start, cleared in
  //   `teardown`) — verified by grep. So the suppression window is precisely
  //   one drag gesture, and inside that window `totalDuration` can no longer
  //   change. Every OTHER duration-changing path in the enumeration (Apply
  //   Sync, `retileCoveredSegments`, the playback-speed slider, the segment
  //   editor's numeric duration field, project hydration, New Project, the
  //   DEV fixture) runs with `resizingId === null` and rebases the basis
  //   normally, exactly as if this code were absent.
  //
  //   [ASSUMED] — and this is why it stays. That argument depends on no
  //   non-drag duration change ever landing while `resizingId !== null`,
  //   which is a claim about UI concurrency that cannot be proven, only
  //   not-yet-falsified. It is also actively falsifiable by the still-UNRULED
  //   early-bail stuck-`resizingId` bug (`dragSession.ts`'s header,
  //   project-state.md): with `resizingId` stuck non-null, this effect
  //   latches `resizeTouchedZoomRef` and would skip the NEXT genuine rebase —
  //   an Apply Sync onto a completely different project length — leaving the
  //   zoom basis stale. That is a latent harm of KEEPING it, recorded here
  //   deliberately; it is not a reason to remove it in the same change the
  //   manual tester is about to re-run step 4 against, which would put an
  //   unrequested render-path variable inside the measurement.
  //
  // Revisit when the stuck-`resizingId` bug is ruled on. If it is fixed, the
  // last reachable path to a stale basis closes and this block can go.
  // ---------------------------------------------------------------------
  const [zoomBasisDuration, setZoomBasisDuration] = useState(totalDuration);
  const resizeTouchedZoomRef = useRef(false);
  useEffect(() => {
    if (resizingId !== null) {
      // A gesture is in flight; whatever totalDuration does next is its doing.
      resizeTouchedZoomRef.current = true;
      return;
    }
    if (resizeTouchedZoomRef.current) {
      // The commit lands in the same batched render that clears resizingId, so
      // this is the one totalDuration change that must NOT rebase the zoom.
      resizeTouchedZoomRef.current = false;
      return;
    }
    setZoomBasisDuration(totalDuration);
  }, [totalDuration, resizingId]);
  // A deliberate scale change always re-fits, so "fully zoomed out" keeps its
  // promise to fit the real content.
  useEffect(() => {
    setZoomBasisDuration(computeTotalDuration(segments));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliderT, containerWidth]);

  // Single source of truth for zoom: exponential interpolation between ppsMin
  // (fit-to-width) and ppsMax (100). When ppsMin >= ppsMax the project is short
  // enough to fit, so the slider is a no-op pinned at 100.
  const pixelsPerSecond = useMemo(
    () => computeZoomPixelsPerSecond(zoomBasisDuration, containerWidth, sliderT),
    [sliderT, containerWidth, zoomBasisDuration],
  );

  // Keep App's pixelsPerSecond ref in sync for its non-rendering consumer sites.
  useEffect(() => {
    onPixelsPerSecondChange(pixelsPerSecond);
  }, [pixelsPerSecond, onPixelsPerSecondChange]);

  // Draw the voiceover waveform as multiple ≤16384px-wide tiles sized to the
  // CURRENT zoom level (debounced rebuild on zoom change — TimelineWaveform.tsx),
  // each a separate blob: URL. Rendered below as a single shared CSS
  // multi-background layer spanning the whole timeline, not per-segment.
  // The peaks source itself is built upfront by services/waveformPipeline.
  const { tiles: waveformTiles } = useTimelineWaveform(waveformSource, totalDuration, pixelsPerSecond);

  // One-shot scroll restore. Deferred until containerWidth first lands (non-zero)
  // from the ResizeObserver above — only then are pixelsPerSecond and the segment
  // (content) widths final. Restoring earlier (against the 800px fallback layout)
  // let the browser clamp scrollLeft to 0 because the content didn't yet overflow
  // the real viewport, producing the "0 then scroll" flash. useLayoutEffect
  // applies it before the paint of the measured frame; the two auto-scroll effects
  // below are gated on didRestoreRef so neither can clobber it before it lands.
  const didRestoreRef = useRef(false);
  useLayoutEffect(() => {
    if (didRestoreRef.current || containerWidth === 0) return;
    const el = document.getElementById('timeline-scroll-area');
    if (!el) return;
    if (initialScrollLeft) el.scrollLeft = initialScrollLeft;
    didRestoreRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerWidth]);

  // Attach the scroll listener here, where timeline-scroll-area is guaranteed
  // to exist in the DOM.
  useEffect(() => {
    const el = document.getElementById('timeline-scroll-area');
    if (!el) return;
    // Persist on scroll (debounced 300ms)
    let timer: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        patchUiState({ timelineScrollLeft: el.scrollLeft });
      }, 300);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      el.removeEventListener('scroll', handleScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Skip the first execution on mount so the restored scrollLeft from
  // kinetix:ui:v1 is never overwritten before the user has interacted.
  const hasMountedRef = useRef(false);

  // Keep the active segment visible: when the current segment changes (a segment
  // clicked in the left-panel list, a timeline click, or playback crossing a
  // boundary), scroll the timeline horizontally so it comes into view. Only
  // scrolls when the segment is off-screen, so it never fights manual scrubbing.
  useEffect(() => {
    // Gate until the one-shot scroll restore has applied, so the mount-time and
    // width-settle runs can't override it. Checked before hasMountedRef so those
    // pre-restore runs don't consume the mount-skip; the first run AFTER restore
    // (the ResizeObserver pixelsPerSecond settle) is then absorbed by hasMountedRef.
    if (!didRestoreRef.current) return;
    if (!hasMountedRef.current) { hasMountedRef.current = true; return; }
    if (!currentSegmentId) return;
    const seg = segments.find(s => s.id === currentSegmentId);
    if (!seg) return;
    const container = document.getElementById('timeline-scroll-area');
    if (!container) return;
    const left = seg.startTime * pixelsPerSecond;
    const right = (seg.startTime + seg.duration) * pixelsPerSecond;
    const viewLeft = container.scrollLeft;
    const viewRight = viewLeft + container.clientWidth;
    // Clamp to the timeline CONTENT width (segments), not container.scrollWidth —
    // the decorative ruler overflows the content by a few px, and using scrollWidth
    // let that overflow scroll segment 1 off the left edge.
    const maxScroll = Math.max(0, totalDuration * pixelsPerSecond - container.clientWidth);
    if (left < viewLeft) {
      container.scrollTo({ left: Math.min(maxScroll, Math.max(0, left - 24)), behavior: 'smooth' });
    } else if (right > viewRight) {
      container.scrollTo({ left: Math.min(maxScroll, Math.max(0, right - container.clientWidth + 24)), behavior: 'smooth' });
    }
  }, [currentSegmentId, pixelsPerSecond, segments]);

  // ---------------------------------------------------------------------------
  // UNDO/REDO ANCHOR — reveal and flash (design §5.2, owner ruling).
  //
  // SCROLL ONLY IF OFF-SCREEN, ALWAYS FLASH. The decision itself (segment
  // lookup, unresolvable-anchor degradation, and reuse of
  // `resolveOffscreenScrollLeft`) is `resolveHistoryAnchorAction`
  // (timelineLayout.ts, extracted 2026-08-08 so the degradation path can be
  // unit tested without a DOM harness — see that function's own tests). The
  // design doc is explicit that a second scroller must not be written,
  // because the existing one already handles the reload-restore ordering trap
  // (`didRestoreRef`) that once produced a visible "scroll to 0, then scroll
  // again" flash.
  //
  // The flash fires even when no scroll happens, which is the point: a 0.2s
  // duration change on a segment already in view is otherwise invisible, and the
  // user would have no confirmation their undo did anything.
  // ---------------------------------------------------------------------------
  const [flashSegmentId, setFlashSegmentId] = useState<string | null>(null);
  useEffect(() => {
    const container = document.getElementById('timeline-scroll-area');
    const action = resolveHistoryAnchorAction({
      historyAnchor,
      segments,
      canScroll: !!container && didRestoreRef.current,
      pixelsPerSecond,
      scrollLeft: container?.scrollLeft ?? 0,
      clientWidth: container?.clientWidth ?? 0,
      totalDuration,
    });
    // No anchor, or an unresolvable one (reachable across an Apply Sync
    // boundary, where the whole id set changes): no scroll, no flash, never a
    // throw.
    if (!action.segmentId) return;
    if (action.scrollTo !== null && container) {
      container.scrollTo({ left: action.scrollTo, behavior: 'smooth' });
    }
    setFlashSegmentId(action.segmentId);
    const t = setTimeout(() => setFlashSegmentId(null), 700);
    return () => clearTimeout(t);
    // Keyed on the NONCE, not the id — see the prop's own comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyAnchor?.nonce]);

  // Center the active segment when the zoom slider moves. Fires ONLY on sliderT
  // change (not pixelsPerSecond/currentSegmentId/segments) so it never fights the
  // active-segment effect above, which has a different trigger. Instant, not smooth.
  useEffect(() => {
    // Gate until the one-shot scroll restore has applied — this effect has no
    // mount guard of its own, so on reload it would otherwise center the current
    // segment and override the restored scroll. sliderT is stable through the
    // mount settle, so after restore this fires only on genuine zoom changes.
    if (!didRestoreRef.current) return;
    const container = document.getElementById('timeline-scroll-area');
    if (!container || !currentSegmentId) return;
    const seg = segments.find(s => s.id === currentSegmentId);
    if (!seg) return;
    const segStart = seg.startTime;
    const segCenterX = (segStart + seg.duration / 2) * pixelsPerSecond;
    const targetScrollLeft = segCenterX - container.clientWidth / 2;
    // Clamp to the timeline CONTENT width (segments), not container.scrollWidth —
    // the decorative ruler overflows by a few px; when the content fits the viewport
    // maxScroll is 0 and segment 1 stays pinned to the left edge.
    const maxScroll = Math.max(0, totalDuration * pixelsPerSecond - container.clientWidth);
    container.scrollLeft = Math.min(maxScroll, Math.max(0, targetScrollLeft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliderT]);

  // Path B Phase 4 (docs/history.md ("Path B — Separate Heading Layer — Design Decisions", archived)) — heading band edge-drag.
  // Reuses the f4da926 ref+rAF live-drag pattern: no setProject/onHeadingResizeCommit
  // per mousemove, live visual feedback via direct DOM style writes on the band
  // element (found via data-heading-id), the real commit fires exactly once on
  // mouseup. Fully independent of segment resize/layout — a heading band is an
  // absolutely-positioned overlay, not a flex track item.
  const handleHeadingResizeStart = (
    e: React.MouseEvent,
    heading: HeadingOverlay,
    edge: 'start' | 'end',
  ): void => {
    e.stopPropagation();
    const el = document.querySelector<HTMLElement>(`[data-heading-id="${heading.id}"]`);
    if (!el) return;
    const startClientX = e.clientX;
    const pps = pixelsPerSecond;
    let pendingClientX: number | null = null;
    let hasMoved = false;
    let rafId: number | null = null;

    const applyFrame = (): void => {
      rafId = null;
      if (pendingClientX === null) return;
      const deltaSeconds = (pendingClientX - startClientX) / pps;
      const next = resizeHeading(heading, edge, deltaSeconds);
      el.style.left = `${next.time * pps}px`;
      el.style.width = `${next.duration * pps}px`;
    };
    const handleMove = (moveEvent: MouseEvent): void => {
      pendingClientX = moveEvent.clientX;
      hasMoved = true;
      if (rafId === null) rafId = requestAnimationFrame(applyFrame);
    };
    const handleUp = (): void => {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      if (!hasMoved || pendingClientX === null) return;
      const deltaSeconds = (pendingClientX - startClientX) / pps;
      onHeadingResizeCommit?.(heading.id, resizeHeading(heading, edge, deltaSeconds));
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden relative">
      {/* Timeline Tracks Area */}
      <div
        id="timeline-scroll-area"
        className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar relative bg-[#030303] flex flex-col p-0 pt-[15px] cursor-crosshair focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F27D26] focus-visible:ring-inset"
        onMouseDownCapture={(e) => {
          // Suppress the browser's default click-to-focus behavior for this
          // element — it's a plain scroll container (mouse-scrub only, no
          // keyboard seek; role="slider"/tabIndex/onKeyDown were removed in
          // 299f014), but WebKit/Tauri's focus-visible heuristic was still
          // firing on ordinary mouse clicks/drags inside the timeline
          // (scrubbing, resize-handles, heading drags), showing an orange
          // ring around the whole timeline during normal mouse use.
          // preventDefault on the capture-phase mousedown stops the native
          // focus-shift before any descendant's bubble-phase stopPropagation()
          // can leave it unaffected; real keyboard Tab-focus is untouched since
          // Tab never dispatches a mousedown.
          e.preventDefault();
        }}
        onMouseDown={(e) => {
          if (resizingId) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const scrollLeft = e.currentTarget.scrollLeft;
          const x = e.clientX - rect.left + scrollLeft;
          const newTime = computeSeekTimeFromClientX(x, pixelsPerSecond, totalDuration);
          onSeek(newTime);

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const moveX = moveEvent.clientX - rect.left + scrollLeft - 24;
            onSeek(computeSeekTimeFromClientX(moveX, pixelsPerSecond, totalDuration));
          };
          const handleMouseUp = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
          };
          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);
        }}
      >
        {/* Path B corrective fix (docs/history.md ("Path B — Separate Heading Layer — Design Decisions", archived), Phase 3/4/5
            correction) — three stacked lanes, top to bottom: headings, segments,
            voiceover waveform, each with the same bounded-lane border/background
            (bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg). Originally a
            ring-inset box-shadow (matching the waveform track's pre-existing
            style), but that was optically masked on the waveform lane — its
            cells sit flush edge-to-edge with near-full-height bars, unlike the
            heading/segment lanes which have visible background showing through
            gaps — so it's a real border now, which always paints at the box
            edge regardless of child content density. Same horizontal time-to-pixel
            mapping/scroll/zoom for all three. The playhead lives at THIS
            wrapper's level (not inside any one lane) so it spans the full
            vertical height of whichever lanes are currently rendered — 2 lanes
            (segments+waveform) with no headings yet, 3 once a heading exists —
            as one continuous line (CapCut-style), instead of being confined to
            the segment track's own height. */}
        <div className="flex-shrink-0 flex flex-col gap-1 relative">
          {/* Playhead — absolutely positioned against the lanes wrapper above,
              so top-0/bottom-0 spans every rendered lane. Horizontal position
              and smooth-follow animation are unchanged. */}
          <motion.div
            className="absolute top-0 bottom-0 w-px bg-[#F27D26] z-50 shadow-[0_0_10px_#F27D26]"
            style={{
              left: `${currentTime * pixelsPerSecond}px`,
              transition: isPlaying ? 'none' : 'left 0.1s linear',
            }}
          >
            <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-[#F27D26] rotate-45" />
            <div className="absolute top-0 bottom-0 left-0 w-[2px] bg-white opacity-20" />
          </motion.div>

          {/* Segment-boundary markers — thin vertical lines spanning every lane
              (heading/segment/waveform) at once, so a boundary can be tracked
              across lanes the way it could before the lane redesign. Lives at
              this same lanes-wrapper level as the playhead above (one continuous
              overlay column per boundary, not per-lane borders that could drift
              out of alignment) and reads the identical startTime*pixelsPerSecond
              math every lane already uses — no re-derived positions. Only
              INTERIOR boundaries are drawn (segments[1..]'s own startTime): the
              very first boundary (time 0) and the final end are already marked
              by the lanes' own left/right border, so a line there would just
              double it. Same 1px width as the lane borders (w-px, matching the
              borders' own default 1px), and a LIGHTER alpha than them
              (#F29C5F @ 0.2 vs. the borders' rgba(242,125,38,0.3)) — visible
              through both the dark thumbnails and the #141414 waveform panel
              without reading as thicker/darker than the border line it's meant
              to echo, and without being mistaken for the solid #F27D26
              playhead. z-40 keeps it under the playhead (z-50 — playhead always
              paints on top) while still clearing the heading badges (z-30).
              pointer-events-none so it never intercepts clicks/drags on the
              lanes underneath. */}
          {isSynced && computeBoundaryMarkerPositions(segments, pixelsPerSecond).map((m) => (
            <div
              key={`boundary-${m.id}`}
              className="absolute top-0 bottom-0 w-px bg-[rgba(242,156,95,0.2)] z-40 pointer-events-none"
              style={{ left: `${m.left}px` }}
            />
          ))}

          {/* Heading lane — Path B new-layer headings (Phase 4). Own horizontal
              lane; never overlaps the segment track below. pointer-events-none
              on each band so clicks pass through; only the edge handles (and,
              going forward, any lane-level interactions) are interactive. */}
          {isSynced && headings.length > 0 && (
            <div
              className="relative h-20 flex-shrink-0 bg-[#0A0A0A] rounded-lg"
              style={{ width: `${totalDuration * pixelsPerSecond}px` }}
            >
              {/* Border is a separate pointer-events-none overlay painted AFTER
                  the heading badges (last child, so it stacks on top) rather
                  than a border on this div directly — the badges use top-0
                  bottom-0 and, combined with overflow-hidden + rounded-lg, an
                  actual border on this element was invisible in the real
                  Tauri/WKWebView shell (confirmed visually, 2026-07-31
                  follow-up): WebKit has a known compositing bug where
                  overflow:hidden + border-radius on a parent can hide
                  descendant content once a child uses `transform` (the
                  segment lane's <video>/motion.img elements below hit the
                  same bug more severely — this lane's badges don't animate,
                  but the fix is kept consistent across both lanes). This
                  overlay never uses overflow-hidden, so it can't trigger it.
                  The lane div itself is now given an explicit
                  totalDuration*pixelsPerSecond width (matching the waveform
                  lane's pattern below) rather than left to stretch to the
                  scroll container's viewport width — as a flex item with the
                  default `align-items: stretch` in the flex-column scroll
                  container, it previously sized to the VIEWPORT, not the
                  scrollable content, so this inset-0 border overlay only
                  matched the full strip when zoomed out enough that content
                  ≈ viewport; at any deeper zoom the overlay stopped short of
                  the actual (wider) content and appeared to vanish while
                  scrolling. The badges' `left`/`width` inline styles already
                  assumed this same full-content coordinate space, so they were
                  never affected — only the border overlay, which relied on
                  the parent's own box size via `inset-0`, was. */}
              {headings.map((h) => {
                const headingLayout = computeHeadingLayout(h, pixelsPerSecond);
                return (
                <div
                  key={h.id}
                  data-heading-id={h.id}
                  className="absolute top-0 bottom-0 z-30 bg-[#F27D26]/10 border-2 border-[#F27D26]/70 rounded-lg pointer-events-none flex items-center justify-center overflow-hidden"
                  style={{ left: `${headingLayout.left}px`, width: `${headingLayout.width}px` }}
                >
                  <div className="flex items-center gap-1 px-1 max-w-full">
                    <Heading1 size={11} className="text-[#F27D26] flex-shrink-0" />
                    <span className="text-[7px] font-black uppercase tracking-wide text-[#F27D26] truncate">
                      {h.text || 'Heading'}
                    </span>
                  </div>
                  {h.needsReview && (
                    <div
                      className="absolute top-1 right-1 flex items-center gap-0.5 px-1 py-0.5 rounded-[4px] bg-[rgba(255,193,7,0.15)]"
                      title="Re-sync clamped this heading's time — review its position"
                    >
                      <AlertCircle size={9} className="text-[#ffc107]" />
                    </div>
                  )}
                  <div
                    className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize pointer-events-auto hover:bg-[#F27D26]/40"
                    onMouseDown={(e) => handleHeadingResizeStart(e, h, 'start')}
                  />
                  <div
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize pointer-events-auto hover:bg-[#F27D26]/40"
                    onMouseDown={(e) => handleHeadingResizeStart(e, h, 'end')}
                  />
                </div>
                );
              })}
              {/* z-40 — must out-rank the heading badges' z-30 (explicit z-index
                  always paints above a z-index:auto sibling regardless of DOM
                  order), or each badge's opaque body covers this border
                  wherever it sits, leaving only the gaps between badges
                  showing it — a dashed-looking line instead of a solid one. */}
              <div className="absolute inset-0 z-40 border border-[rgba(242,125,38,0.3)] rounded-lg pointer-events-none" />
            </div>
          )}

          {/* Segment track (unchanged internals — segment thumbnails; playhead
              now lives at the lanes-wrapper level above, spanning all lanes).
              Bounded-lane border/background matches the heading lane and
              waveform track for visual consistency across all three. Border
              is a separate pointer-events-none overlay painted AFTER the
              segment cards (last child) rather than a border on this div
              directly — same WebKit overflow:hidden + border-radius +
              transform compositing bug as the heading lane above, worse here
              since these cards contain <video>/motion.img elements that use
              `transform` (scale on hover/active), which is exactly the
              trigger; confirmed visually in the real Tauri/WKWebView shell
              (2026-07-31 follow-up) — overflow-hidden made this whole lane
              render black. This overlay never uses overflow-hidden.
              Explicit totalDuration*pixelsPerSecond width on this lane div
              (matching the heading lane fix above and the waveform lane's
              existing pattern below) — without it, this flex item stretches
              to the scroll container's viewport width instead of the
              scrollable content width, so the inset-0 border below only
              spanned the full segment strip when zoomed out to
              content ≈ viewport. */}
          <div
            className="relative flex-shrink-0 h-20 flex gap-2 bg-[#0A0A0A] rounded-lg"
            style={{ width: `${totalDuration * pixelsPerSecond}px` }}
          >
          {/* Visual Track */}
          {!isSynced ? (
            <div className="flex-1 h-20 bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg" style={{ minWidth: '100%' }} />
          ) : (
            <div className="relative flex h-full items-stretch">
              {segments.map((s, i) => {
                const asset = assets.find(a => a.id === s.assetId);
                const isActive = currentSegmentId === s.id;
                const isMissing = !asset && !!s.text;
                const segLayout = computeSegmentLayout(s, pixelsPerSecond);

                return (
                  <div
                    key={s.id}
                    data-seg-id={s.id}
                    onClick={(e) => { e.stopPropagation(); onSeek(s.startTime); onClipClick?.(s.id); }}
                    onDoubleClick={(e) => { e.stopPropagation(); onSeek(s.startTime); onSelectSegment?.(s.id); }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      if (resizingId) return;
                      onSeek(s.startTime);
                    }}
                    onContextMenu={(e) => {
                      const canRestore = !!s.absorbedGaps?.length && !!onRestoreAbsorbedGaps;
                      const canDelete = !!onDeleteSegment
                        && (isSliceSegmentId(s.id) || !!restoredSegmentIds?.has(s.id));
                      if (!canRestore && !canDelete) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setGapContextMenu({ segmentId: s.id, x: e.clientX, y: e.clientY });
                    }}
                    style={{
                      position: 'absolute',
                      left: `${segLayout.left}px`,
                      width: `${segLayout.width}px`,
                      height: '80px',
                      opacity: 1,
                      filter: 'none',
                      transform: 'scale(1)',
                      // The undo/redo flash uses boxShadow rather than a
                      // competing outline — the card already transitions
                      // box-shadow, so the flash inherits that easing for free.
                      boxShadow: flashSegmentId === s.id
                        ? '0 0 0 2px #F27D26, 0 0 36px rgba(242,125,38,0.55)'
                        : 'none',
                      zIndex: flashSegmentId === s.id
                        ? 60
                        : (isActive ? 10 : 1),
                    }}
                    className={`rounded-lg border transition-[opacity,filter,transform,box-shadow,border-color,background-color] duration-300 cursor-pointer relative flex flex-col group overflow-hidden ${isActive ? 'bg-[#151515] border-[#F27D26]' : 'bg-[#080808] border-[#1A1A1A] hover:bg-[#0C0C0C]'}`}
                  >
                    {/* K16 — pointer events + pointer capture, not mousedown.
                        Capture guarantees this element keeps receiving
                        pointermove/pointerup for the whole gesture even when the
                        pointer leaves it, leaves the window, or the element is
                        re-rendered underneath — and the events still bubble to
                        App's window listeners. `touchAction: 'none'` stops the
                        browser claiming the gesture as a pan/scroll before the
                        first pointermove arrives. `e.clientX` is forwarded so
                        the drag can preserve the grab offset within the handle
                        (services/dragGeometry.ts). */}
                    <div className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-20 hover:bg-[#F27D26]/20 transition-colors"
                      style={{ touchAction: 'none' }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        onResizeStart(s.id, 'start', e.clientX);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    {/* AFFORDANCE LAYER — the last segment's right edge has no
                        resize handle at all (owner ruling 2026-08-08,
                        docs/decisions/2026-08-08-last-segment-edge.md). Not a
                        disabled handle: no hit target, no `col-resize` cursor,
                        and no hover highlight, so it is visually apparent that
                        the edge is fixed rather than broken. A handle that
                        renders and silently does nothing is the worse of the
                        two failures.

                        `isDragEdgeLocked` (services/dragCascade.ts) is the ONE
                        definition of which edges are inert; `dragSession.ts`
                        consults the same function to refuse the gesture even if
                        a future edit re-adds a hit target here. */}
                    {!isDragEdgeLocked(segments, i, 'end') && (
                      <div className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-20 hover:bg-[#F27D26]/20 transition-colors"
                        style={{ touchAction: 'none' }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          onResizeStart(s.id, 'end', e.clientX);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}

                    <div className="flex-1 relative bg-black/50">
                      {asset?.url ? (
                        asset.type === 'video' ? (
                          <video src={asset.url} className={`w-full h-full object-cover opacity-40 ${isActive ? 'opacity-80' : ''}`} />
                        ) : (
                          <img src={asset.url} draggable={false} className={`w-full h-full object-cover opacity-30 transition-transform duration-700 ${isActive ? 'scale-110 opacity-70' : 'group-hover:scale-105'}`} alt={asset.name} />
                        )
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <AlertCircle size={14} className={isMissing ? 'text-red-900 animate-pulse' : 'text-gray-900'} />
                        </div>
                      )}

                      <div className="absolute inset-0 p-2 flex flex-col justify-between pointer-events-none">
                        <div className="flex justify-between items-start">
                          <div className="flex flex-col gap-1">
                            <span className="px-1 py-0.5 bg-black/60 rounded-sm text-[7px] font-mono text-[#F27D26]">#{i + 1}</span>
                            {(s.trimStart ?? 0) > 0 && (
                              <span className="px-1 py-0.5 bg-blue-500/20 text-blue-400 rounded-sm text-[6px] font-mono">
                                Slip: {(s.trimStart ?? 0).toFixed(1)}s
                              </span>
                            )}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); onOpenStockSearch(s.id); }}
                            className="px-1.5 py-1 bg-blue-500 text-white rounded text-[8px] font-black uppercase pointer-events-auto opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            Change
                          </button>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[8px] font-black text-white/90 uppercase tracking-tight truncate">Scene</p>
                          <p className="text-[7px] text-gray-500 font-medium truncate italic">{s.text}</p>
                        </div>
                      </div>

                      {(s.trimStart ?? 0) > 0 && (
                        <div className="absolute left-0 top-0 bottom-0 w-2 bg-red-500/20 border-r border-red-500/40" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* z-[60] — must out-rank every segment card's inline zIndex (1 /
              10 / 50, the trim-active card being the highest); explicit
              z-index always paints above a z-index:auto sibling regardless
              of DOM order, so without this the cards' opaque bodies cover
              the border wherever they sit, leaving only the seams between
              adjacent cards showing it — a dashed-looking line instead of a
              solid one. */}
          <div className="absolute inset-0 z-[60] border border-[rgba(242,125,38,0.3)] rounded-lg pointer-events-none" />
          </div>

          {/* Audio waveform lane — TILED waveform (useTimelineWaveform). The
              voiceover is split into multiple ≤16384px-wide canvas tiles at the
              CURRENT zoom level (debounced rebuild on zoom change), each its own
              blob: URL, so every tile gets ~1 peak-column per backing pixel
              (true 1:1 fidelity) instead of the old single-canvas approach's
              density loss on long audio. All tiles are applied as CSS
              multi-background layers on ONE shared lane div spanning the full
              timeline width:
                backgroundImage    comma-separated url()s, one per tile
                backgroundPosition each tile offset by its own startTime * pps
                backgroundSize     each tile's own CSS width at the current zoom
              Segment cells render on top (active-segment tint + a subtle
              divider so segment extents stay readable through the waveform)
              and this shared layer has NO data-seg-id (so App.tsx's
              resize-drag querySelectorAll never touches it) and NO resize
              handles — purely visual, pointer-events-none.
              The inset-panel treatment (bg + hairline border + radius) lives
              on the FULL-WIDTH tile container just below (the div with the
              explicit `width: totalDuration * pixelsPerSecond` inline style),
              NOT on this outer flex-stretch wrapper — that's the fix for the
              old moving-border bug: a border on the viewport-width wrapper
              only ever painted the first screen and appeared to scroll away
              with the content. The tile container genuinely spans the full
              scrollable timeline, so its border/background are visible at
              both the start AND the end of the timeline at any zoom level.
              This outer div is layout-only (height/overflow/centering), no
              bg or border of its own.
              Panel colors (2026-07-31 follow-up): a semi-transparent black
              fill read as near-identical to the app's own near-black bg
              (#030303/#050505/#0A0A0A) — solid mid-grey #1C1C1C is used
              instead so the lane genuinely reads as its own surface, with a
              thin orange-tinted border (accent-family, low opacity) rather
              than a plain white hairline. */}
          {voiceoverName && (
            <div className="h-20 relative overflow-visible flex items-center">
              <div
                className="relative h-full flex-shrink-0 bg-[#141414] border border-[rgba(242,125,38,0.3)] rounded-lg overflow-hidden"
                style={{ width: `${totalDuration * pixelsPerSecond}px` }}
              >
                {waveformTiles.length > 0 && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      backgroundImage: waveformTiles.map((t) => `url(${t.url})`).join(', '),
                      backgroundPosition: waveformTiles
                        .map((t) => `${t.startTime * pixelsPerSecond}px 0`)
                        .join(', '),
                      backgroundSize: waveformTiles.map((t) => `${t.width}px 100%`).join(', '),
                      backgroundRepeat: 'no-repeat',
                    }}
                  />
                )}
                <div className="relative h-full w-max">
                  {segments.map((s, i) => {
                    const voLayout = computeSegmentLayout(s, pixelsPerSecond);
                    return (
                    <div
                      key={`vo-new-${s.id}`}
                      // K16 — carries data-seg-id so App's resize-drag writes its
                      // live left/width here too. Without it only the thumbnail
                      // lane tracked during a drag and this lane's cell snapped
                      // into place at release, so the two lanes visibly
                      // disagreed for the whole gesture. Purely visual: this
                      // element has no handles and no click behaviour, and the
                      // shared waveform TILE layer above still deliberately
                      // carries no data-seg-id.
                      data-seg-id={s.id}
                      style={{ position: 'absolute', left: `${voLayout.left}px`, width: `${voLayout.width}px` }}
                      className={`h-full relative flex items-center flex-shrink-0 border-r border-[rgba(255,255,255,0.05)] ${i % 2 === 1 ? 'bg-white/[0.015]' : ''}`}
                    >
                      {currentSegmentId === s.id && (
                        <div className="absolute inset-0 bg-[#F27D26]/5 pointer-events-none" />
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Captions track — hook-in for Task 9d (captionCues not yet wired) */}
        {false && (
          <div className="h-8 border-t border-[#1A1A1A] flex items-center px-2">
            {/* caption cues rendered here — Task 9d */}
          </div>
        )}
      </div>

      {gapContextMenu && (() => {
        const target = segments.find(s => s.id === gapContextMenu.segmentId);
        if (!target) return null;
        const gapCount = target.absorbedGaps?.length ?? 0;
        const canDelete = !!onDeleteSegment
          && (isSliceSegmentId(target.id) || !!restoredSegmentIds?.has(target.id));
        if (gapCount === 0 && !canDelete) return null;
        return (
          <div
            style={{ position: 'fixed', left: gapContextMenu.x, top: gapContextMenu.y, zIndex: 200 }}
            className="bg-[#151515] border border-[#2A2A2A] rounded-lg shadow-xl py-1 min-w-[220px]"
            onClick={(e) => e.stopPropagation()}
          >
            {gapCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  onRestoreAbsorbedGaps?.(gapContextMenu.segmentId);
                  setGapContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-gray-200 hover:bg-[#F27D26]/15 hover:text-[#F27D26]"
              >
                Restore absorbed segments ({gapCount})
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => {
                  onDeleteSegment?.(gapContextMenu.segmentId);
                  setGapContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-gray-200 hover:bg-[#F27D26]/15 hover:text-[#F27D26]"
              >
                Delete segment
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}
