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

export interface SlipBarGeometryInput {
  duration: number;
  playbackSpeed?: number;
  trimStart: number;
  sourceDuration: number | undefined;
}

export interface SlipBarGeometry {
  hasKnownSourceDuration: boolean;
  widthPct: number;
  leftPct: number;
  // Max legal `trimStart`, in source seconds. 0 whenever
  // hasKnownSourceDuration is false — same "decline to guess, never
  // fabricate a bound" rule as widthPct/leftPct above, reused by every
  // trimStart-drag caller (Timeline.tsx's in-place drag, the segment
  // editor's range slider) instead of each defaulting sourceDuration to a
  // guessed constant. Deliberately NOT playbackSpeed-adjusted (matches the
  // pre-existing callers' own `sourceDuration - duration` formula) — a
  // playbackSpeed-aware bound is a separate, pre-existing question this
  // fix does not touch.
  maxTrimStartSec: number;
}

export function computeSlipBarGeometry({
  duration,
  playbackSpeed,
  trimStart,
  sourceDuration,
}: SlipBarGeometryInput): SlipBarGeometry {
  const srcDur = sourceDuration ?? 0;
  const hasKnownSourceDuration = srcDur > 0;

  const widthPct = hasKnownSourceDuration
    ? Math.min(100, Math.max(0, (duration * (playbackSpeed ?? 1) / srcDur) * 100))
    : 0;
  const leftPct = hasKnownSourceDuration
    ? Math.min(100, Math.max(0, (trimStart / srcDur) * 100))
    : 0;
  const maxTrimStartSec = hasKnownSourceDuration
    ? Math.max(0, srcDur - duration)
    : 0;

  return { hasKnownSourceDuration, widthPct, leftPct, maxTrimStartSec };
}
