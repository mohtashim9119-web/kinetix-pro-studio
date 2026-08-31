/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, Lock, Unlock, ArrowLeftRight, Sparkles, Layers } from 'lucide-react';
import { VideoSegment, Asset, HeadingOverlay } from '../types';
import { SegmentControls } from './SegmentControls';
import { labelOf, TRANSITIONS, ANIMATIONS, OVERLAYS, TRANSITION_NONE, ANIMATION_NONE, OVERLAY_NONE } from '../effectsOptions';
import { DEFAULT_ZOOM_SCALE_RATE, isRateCapped } from '../services/zoomScale';
import { computeSlipBarGeometry } from '../services/slipBarGeometry';

interface Props {
  segment: VideoSegment | null;
  segmentIndex: number;
  /** Path B (docs/history.md ("Path B — Separate Heading Layer — Design Decisions", archived), Phase 5) — top-level heading
   *  overlay target, mutually exclusive with `segment`. When set, the drawer
   *  renders the HeadingOverlay editor instead of the segment editor. */
  heading?: HeadingOverlay | null;
  assets: Asset[];
  globalOverlayConfig: NonNullable<VideoSegment['overlayConfig']>;
  onClose: () => void;
  onUpdateSegment: (idx: number, updates: Partial<VideoSegment>) => void;
  onUpdateSegmentOverlay: (idx: number, updates: Partial<NonNullable<VideoSegment['overlayConfig']>>) => void;
  /** Required when `heading` is set. */
  onUpdateHeading?: (id: string, updates: Partial<HeadingOverlay>) => void;
  onOpenStockSearch: (segmentId: string) => void;
  onToggleLock: (segmentId: string) => void;
  onSeek?: (time: number) => void;
}

export function BottomDrawer({
  segment,
  segmentIndex,
  heading,
  assets,
  globalOverlayConfig,
  onClose,
  onUpdateSegment,
  onUpdateSegmentOverlay,
  onUpdateHeading,
  onOpenStockSearch,
  onToggleLock,
  onSeek,
}: Props) {
  const trimTrackRef = useRef<HTMLDivElement>(null);

  const s = segment;
  const idx = segmentIndex;
  const h = heading ?? null;

  // WS3 Batch B tail-defect fix — the Clip Trim handles below used to call
  // `onUpdateSegment` (a full, immutable `setProject`) on every raw
  // `pointermove`. Each of those commits made `App.tsx`'s `currentSegment`
  // a brand-new object (it is never frozen for this gesture the way a
  // Timeline resize-drag freezes it via `isResizingRef` — this drawer never
  // touches that ref), which is a dependency of `useWebCodecsPreview.ts`'s
  // decode-ahead effect: `VideoDecoderPool.ensureSession` sees `startSec`
  // change every tick and fully tears down + rebuilds the async decode
  // session dozens of times per second, racing against itself (sometimes
  // producing zero frames before the next tick invalidates it — a black
  // canvas that was never painted; sometimes settling on a stale one — a
  // freeze). `dragSession.ts` (Timeline's own resize-drag) solved the
  // identical class of problem the same way: live visual feedback stays
  // local to the component during the gesture, and the single project
  // commit happens once, at release. `liveTrimStart` is that local
  // override — non-null only while a Clip Trim drag is in flight, mirrored
  // into a ref so the pointerup handler can read the latest value
  // synchronously without depending on a possibly-stale render closure.
  const [liveTrimStart, setLiveTrimStartState] = useState<number | null>(null);
  const liveTrimStartRef = useRef<number | null>(null);
  const setLiveTrimStart = (value: number | null): void => {
    liveTrimStartRef.current = value;
    setLiveTrimStartState(value);
  };
  // Guards against a stale live override leaking into a different segment's
  // rendering if the drawer's target changes out from under an in-flight
  // gesture (e.g. selection change mid-drag).
  useEffect(() => {
    setLiveTrimStart(null);
  }, [s?.id]);

  // A zoom whose rate was limited by the segment's length (apply-to-all across
  // mixed durations, or a segment dialed to its own max) — surfaced as a small
  // "capped" note on the animation pill so the reduced zoom isn't a mystery.
  const zoomCapped = !!s
    && (s.effectAnimation === 'zoom-in' || s.effectAnimation === 'zoom-out')
    && isRateCapped(s.effectAnimationScaleRate ?? DEFAULT_ZOOM_SCALE_RATE, s.duration);

  const effectPills = s ? [
    s.effectTransition && s.effectTransition !== TRANSITION_NONE
      ? { icon: ArrowLeftRight, label: labelOf(TRANSITIONS, s.effectTransition), capped: false }
      : null,
    s.effectAnimation && s.effectAnimation !== ANIMATION_NONE
      ? { icon: Sparkles, label: labelOf(ANIMATIONS, s.effectAnimation), capped: zoomCapped }
      : null,
    s.effectOverlay && s.effectOverlay !== OVERLAY_NONE
      ? { icon: Layers, label: labelOf(OVERLAYS, s.effectOverlay), capped: false }
      : null,
  ].filter((p): p is { icon: typeof ArrowLeftRight; label: string; capped: boolean } => p !== null && p.label !== undefined) : [];

  const asset = s ? assets.find(a => a.id === s.assetId) : undefined;
  const isVideo = asset?.type === 'video';
  // Live-drag override takes priority for rendering (geometry + labels) so
  // the bar still tracks the pointer in real time — only the project commit
  // itself is deferred to release. See liveTrimStart's own comment above.
  const trimStart = liveTrimStart ?? (s?.trimStart ?? 0);
  // See slipBarGeometry.ts for why an unknown sourceDuration hides the bar
  // (hasKnownSourceDuration: false) instead of guessing, why widthPct/leftPct
  // are clamped to [0, 100] regardless of input, why `rightPct` (not
  // `leftPct + widthPct` composed here) is the only correct right-edge
  // position, and why `isInert` (clip no longer than the segment) disables
  // the control instead of rendering a nonsensical draggable window.
  const { hasKnownSourceDuration, isInert, leftPct, rightPct } = computeSlipBarGeometry({
    duration: s?.duration ?? 0,
    trimStart,
    sourceDuration: asset?.duration,
  });
  // The clip length always comes from the asset the segment currently points
  // at, never a copy cached on the segment — see Asset.duration's own doc.
  const srcDur = asset?.duration ?? 0;

  // WS2 ws2-28 Commit 1 — this used to be an AnimatePresence mount/unmount:
  // `{(s || h) && <motion.div exit={...}>...</motion.div>}`. When `s`/`h`
  // went from a real target to null (the open segment got split or deleted
  // out from under the drawer), AnimatePresence held the LAST COMMITTED
  // subtree on screen for the whole exit transition — meaning
  // `SegmentControls` kept rendering with a segment object that was already
  // gone from `project.segments`, indefinitely in at least one measured case
  // (split-text-diagnosis.md, session ws2-28: still showing stale text 3+
  // seconds later, and reproduced even on a plain manual close, not just
  // split/delete). Restructured so `motion.div` is ALWAYS mounted and the
  // slide is driven by `animate` variants instead of presence — nothing ever
  // "exits" holding stale props, because nothing ever unmounts. The content
  // below is gated on the live `isOpen` (derived from the live `s`/`h`
  // props, freshly evaluated every render), so it goes blank the instant the
  // selection is gone rather than freezing on old data. The animation itself
  // is kept — this is a mechanism change, not a removal.
  const isOpen = !!(s || h);

  return (
    <motion.div
      initial={false}
      animate={{ y: isOpen ? 0 : '100%', x: '-50%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="fixed bottom-0 z-50
                 bg-[#0A0A0A] border-t border-[#1A1A1A]
                 rounded-t-3xl shadow-2xl"
      style={{ maxHeight: '45vh', left: '50%', width: '50vw', pointerEvents: isOpen ? 'auto' : 'none' }}
      aria-hidden={!isOpen}
    >
      {isOpen && (
        <>
          {/* Header */}
          <div className="grid grid-cols-3 items-center px-6 py-3 border-b border-[#1A1A1A]">
            <div className="flex items-center gap-3 justify-self-start">
              <div className="w-8 h-1 rounded-full bg-[#282828]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                {h ? (h.text || 'Heading') : `Scene ${idx + 1}`}
              </span>
              <span className="px-2 py-0.5 bg-[#1A1A1A] rounded text-[9px] font-mono text-gray-500">
                {(h ? h.duration : s?.duration ?? 0).toFixed(1)}s
              </span>
            </div>
            <div className="flex items-center gap-2 justify-self-center">
              {effectPills.map(({ icon: Icon, label, capped }, i) => (
                <div
                  key={i}
                  title={capped ? `${label} — zoom rate capped for this scene's length` : label}
                  className="flex items-center justify-center gap-1.5 px-2 py-1.5 w-[110px]
                             rounded-lg border border-[#282828] bg-[#1A1A1A]
                             text-[9px] font-black uppercase tracking-widest
                             whitespace-nowrap overflow-hidden text-gray-400"
                >
                  <Icon className="w-3 h-3 shrink-0 text-gray-500" />
                  <span className="truncate">{label}</span>
                  {capped && (
                    <span className="shrink-0 text-[8px] text-amber-500" aria-label="zoom rate capped">▲</span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 justify-self-end">
              {/* HeadingOverlay has no lock field (Path B Decision 1) — lock toggle is segment-only. */}
              {s && (
                <button
                  onClick={() => onToggleLock(s.id)}
                  className="flex items-center gap-1 text-[9px] uppercase tracking-widest transition-colors"
                  style={{ color: s.locked ? '#F27D26' : '#4B5563' }}
                >
                  {s.locked ? <><Lock size={10} /> Locked</> : <><Unlock size={10} /> Lock</>}
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-[#1A1A1A] transition-colors"
              >
                <X size={14} className="text-gray-500" />
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="overflow-y-auto p-5 space-y-4" style={{ maxHeight: 'calc(45vh - 52px)' }}>

            {/* Shared controls — same set as the Review Mapping card (no thumbnail) */}
            <SegmentControls
              segment={s ?? undefined}
              index={idx}
              heading={h ?? undefined}
              assets={assets}
              globalOverlayConfig={globalOverlayConfig}
              onUpdateSegment={onUpdateSegment}
              onUpdateSegmentOverlay={onUpdateSegmentOverlay}
              onUpdateHeading={h ? (updates) => onUpdateHeading?.(h.id, updates) : undefined}
              onOpenStockSearch={onOpenStockSearch}
            />

            {/* Visual Trim Bar — video segments only (slip model). Requires a known,
                positive sourceDuration; see hasKnownSourceDuration's own comment above
                for why an unknown source duration hides this instead of guessing.
                Drawn against the CLIP length (sourceDuration), not the segment's own
                duration — the window has width = segment duration, positioned at
                trimStart (WS3 Batch B, Piece 3). When isInert (clip no longer than
                the segment — Case A, freeze-last-frame), there is nothing to trim:
                the control renders disabled rather than a draggable window whose
                numbers would exceed the real clip. */}
            {isVideo && s && hasKnownSourceDuration && (
              <div className="space-y-2 pt-1">
                <label className="text-[7px] uppercase font-bold text-gray-500 block">Clip Trim</label>

                {isInert ? (
                  <div
                    className="relative h-6 flex items-center select-none"
                    aria-disabled="true"
                    title="Source clip is no longer than the segment — it plays once, then holds its last frame. Nothing to trim."
                  >
                    <div className="relative w-full h-2.5 rounded-full bg-[#161616] cursor-not-allowed">
                      <div className="absolute inset-0 rounded-full bg-[#3A3A3A]/60" />
                    </div>
                  </div>
                ) : (
                  <div className="relative h-6 select-none" ref={trimTrackRef} data-testid="clip-trim-track">
                    <div className="absolute inset-y-0 left-0 right-0 flex items-center">
                      <div className="relative w-full h-2.5 rounded-full bg-[#161616]">
                        {/* Active zone — fixed width = segment.duration / srcDur, positioned
                            at trimStart / srcDur. Drag to slip (move window), click to seek
                            preview. Right edge always rendered at rightPct (leftPct + widthPct,
                            pre-clamped by computeSlipBarGeometry) — never recomposed here, so
                            it can never exceed 100 (investigation doc §3's overflow bug). */}
                        <div
                          className="absolute top-0 bottom-0 bg-[#F27D26] rounded-full cursor-grab active:cursor-grabbing"
                          style={{ left: `${leftPct}%`, width: `${Math.max(0, rightPct - leftPct)}%` }}
                          data-testid="clip-trim-fill"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (srcDur <= 0) return;
                            const track = trimTrackRef.current;
                            if (!track) return;
                            const startX = e.clientX;
                            const rect = track.getBoundingClientRect();
                            const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                            const offsetInTime = clickRatio * srcDur - trimStart;
                            const maxStart = Math.max(0, srcDur - s.duration);
                            let didMove = false;
                            const handleMove = (me: PointerEvent) => {
                              if (!didMove && Math.abs(me.clientX - startX) < 3) return;
                              didMove = true;
                              const r = trimTrackRef.current?.getBoundingClientRect();
                              if (!r) return;
                              const ratio = Math.max(0, Math.min(1, (me.clientX - r.left) / r.width));
                              const newStart = Math.max(0, Math.min(maxStart, ratio * srcDur - offsetInTime));
                              // Local-only during the gesture — see liveTrimStart's doc above
                              // for why the project commit is deferred to pointerup.
                              setLiveTrimStart(newStart);
                            };
                            const cleanup = (ue: Event) => {
                              window.removeEventListener('pointermove', handleMove);
                              window.removeEventListener('pointerup', cleanup);
                              if (didMove) {
                                const finalStart = liveTrimStartRef.current;
                                if (finalStart !== null) {
                                  onUpdateSegment(idx, { trimStart: finalStart, trimEnd: finalStart + s.duration });
                                }
                                setLiveTrimStart(null);
                              } else if (onSeek) {
                                const r = trimTrackRef.current?.getBoundingClientRect();
                                if (!r) return;
                                const pe = ue as PointerEvent;
                                const ratio = Math.max(0, Math.min(1, (pe.clientX - r.left) / r.width));
                                onSeek(s.startTime + ratio * s.duration);
                              }
                            };
                            window.addEventListener('pointermove', handleMove);
                            window.addEventListener('pointerup', cleanup);
                          }}
                        />
                      </div>
                    </div>

                    {/* Left handle — left edge of window tracks mouse */}
                    <div
                      className="absolute inset-y-0 z-10 flex items-center justify-center cursor-col-resize"
                      style={{ left: `calc(${leftPct}% - 5px)`, width: '10px' }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (srcDur <= 0) return;
                        const maxStart = Math.max(0, srcDur - s.duration);
                        const handleMove = (me: PointerEvent) => {
                          const r = trimTrackRef.current?.getBoundingClientRect();
                          if (!r) return;
                          const ratio = Math.max(0, Math.min(1, (me.clientX - r.left) / r.width));
                          const newStart = Math.max(0, Math.min(maxStart, ratio * srcDur));
                          setLiveTrimStart(newStart);
                        };
                        const cleanup = () => {
                          window.removeEventListener('pointermove', handleMove);
                          window.removeEventListener('pointerup', cleanup);
                          const finalStart = liveTrimStartRef.current;
                          if (finalStart !== null) {
                            onUpdateSegment(idx, { trimStart: finalStart, trimEnd: finalStart + s.duration });
                          }
                          setLiveTrimStart(null);
                        };
                        window.addEventListener('pointermove', handleMove);
                        window.addEventListener('pointerup', cleanup);
                      }}
                    >
                      <div className="w-[3px] h-5 rounded-full bg-blue-400 shadow-lg" />
                    </div>

                    {/* Right handle — right edge of window tracks mouse. Rendered at
                        rightPct, matching the fill's own right edge exactly. */}
                    <div
                      className="absolute inset-y-0 z-10 flex items-center justify-center cursor-col-resize"
                      style={{ left: `calc(${rightPct}% - 5px)`, width: '10px' }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (srcDur <= 0) return;
                        const maxStart = Math.max(0, srcDur - s.duration);
                        const handleMove = (me: PointerEvent) => {
                          const r = trimTrackRef.current?.getBoundingClientRect();
                          if (!r) return;
                          const ratio = Math.max(0, Math.min(1, (me.clientX - r.left) / r.width));
                          const newStart = Math.max(0, Math.min(maxStart, ratio * srcDur - s.duration));
                          setLiveTrimStart(newStart);
                        };
                        const cleanup = () => {
                          window.removeEventListener('pointermove', handleMove);
                          window.removeEventListener('pointerup', cleanup);
                          const finalStart = liveTrimStartRef.current;
                          if (finalStart !== null) {
                            onUpdateSegment(idx, { trimStart: finalStart, trimEnd: finalStart + s.duration });
                          }
                          setLiveTrimStart(null);
                        };
                        window.addEventListener('pointermove', handleMove);
                        window.addEventListener('pointerup', cleanup);
                      }}
                    >
                      <div className="w-[3px] h-5 rounded-full bg-purple-400 shadow-lg" />
                    </div>
                  </div>
                )}

                {/* Time labels: start · total · end of window — or, when inert, a
                    single explanatory message instead of numbers that would exceed
                    the real clip length. */}
                {isInert ? (
                  <div className="text-center text-[7px] font-mono text-gray-600">
                    Clip ({srcDur.toFixed(1)}s) plays once, then holds — nothing to trim
                  </div>
                ) : (
                  <div className="flex justify-between text-[7px] font-mono">
                    <span className="text-blue-400">{trimStart.toFixed(1)}s</span>
                    <span className="text-gray-600">{srcDur.toFixed(1)}s total</span>
                    <span className="text-purple-400">{(trimStart + s.duration).toFixed(1)}s</span>
                  </div>
                )}
              </div>
            )}

          </div>
        </>
      )}
    </motion.div>
  );
}
