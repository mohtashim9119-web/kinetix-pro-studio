// Pure geometry for BottomDrawer.tsx's Clip Trim "slip bar" — the fixed-width
// active-zone window that slides over a video segment's source clip.
//
// A missing/unknown sourceDuration (asset probe never ran, or failed) means
// there is no real source length to express the trim window as a proportion
// of. The previous implementation defaulted to `sourceDuration ?? 60`, which
// silently fabricated a 60s source for any segment whose real duration was
// unprobed — a segment with a genuine duration over 60s then computed a
// widthPct over 100%, overflowing the track container (confirmed FAIL, manual
// step 13, cleanup run 2026-08-08). Fixed two ways, both required: (1) an
// unknown source duration reports itself via `hasKnownSourceDuration: false`
// so the caller can hide the bar entirely rather than draw it against a
// fabricated denominator: (2) `widthPct`/`leftPct` are clamped to [0, 100]
// regardless of input, as a hard backstop against any other future mismatch
// (e.g. a stale/edited duration exceeding a since-corrected sourceDuration).
//
// WS3 Batch B, Piece 3 — two more fixes, both required:
// (3) `rightPct` (= leftPct + widthPct, clamped to 100) is now computed HERE,
// once, rather than at each render site composing `leftPct + widthPct`
// inline and unclamped — that inline composition was the actual overflow
// bug: each of widthPct/leftPct was individually clamped correctly, but
// their sum never was, and could reach 200. Callers must render the right
// edge at `rightPct`, never recompute
// `leftPct + widthPct` themselves.
// (4) `isInert` reports when the clip is shorter than (or exactly as long
// as) the segment's own duration (WS3 Batch B, Piece 2's Case A —
// freeze-last-frame): the whole clip plays, so there is no meaningful
// window to choose and the caller should render the control disabled
// rather than a live-looking draggable bar with a nonsensical window.
//
// `playbackSpeed` no longer factors in anywhere here — WS3 Batch B removed
// it as a concept; a video clip always plays at its native rate.

export interface SlipBarGeometryInput {
  duration: number;
  trimStart: number;
  sourceDuration: number | undefined;
}

export interface SlipBarGeometry {
  hasKnownSourceDuration: boolean;
  /** True when the clip is no longer than the segment's own duration — Case
   *  A (freeze-last-frame). Nothing to trim; the caller should disable the
   *  control rather than render a draggable window. */
  isInert: boolean;
  widthPct: number;
  leftPct: number;
  /** The right edge's actual rendered position: `leftPct + widthPct`,
   *  clamped to 100. Always use this for the right handle / fill width —
   *  never recompute `leftPct + widthPct` at the call site. */
  rightPct: number;
  // Max legal `trimStart`, in source seconds. 0 whenever
  // hasKnownSourceDuration is false — same "decline to guess, never
  // fabricate a bound" rule as widthPct/leftPct above, reused by every
  // trimStart-drag caller (Timeline.tsx's in-place drag, the segment
  // editor's range slider) instead of each defaulting sourceDuration to a
  // guessed constant.
  maxTrimStartSec: number;
}

export function computeSlipBarGeometry({
  duration,
  trimStart,
  sourceDuration,
}: SlipBarGeometryInput): SlipBarGeometry {
  const srcDur = sourceDuration ?? 0;
  const hasKnownSourceDuration = srcDur > 0;
  const isInert = hasKnownSourceDuration && srcDur <= duration;

  const widthPct = hasKnownSourceDuration
    ? Math.min(100, Math.max(0, (duration / srcDur) * 100))
    : 0;
  const leftPct = hasKnownSourceDuration
    ? Math.min(100, Math.max(0, (trimStart / srcDur) * 100))
    : 0;
  const rightPct = Math.min(100, leftPct + widthPct);
  const maxTrimStartSec = hasKnownSourceDuration
    ? Math.max(0, srcDur - duration)
    : 0;

  return { hasKnownSourceDuration, isInert, widthPct, leftPct, rightPct, maxTrimStartSec };
}
