// waveformPeaks.ts — pure, standalone waveform data + canvas-drawing routines
// for the timeline voiceover waveform rewrite (docs/waveform-rewrite-plan.md
// §4 data pipeline, §5 canvas drawing).
//
// Deliberately React-free and DOM-free except for the single `HTMLCanvasElement`
// argument to drawSegmentWaveform — matching the repo's services-vs-components
// split (CLAUDE.md conventions). This module does NOT call decodeAudioData:
// PCM arrives already decoded (channel 0) as a function parameter, so the decode
// concern is wired in a later step (§4.3).
//
// Step 1 scope (groundwork only): no wiring into Timeline.tsx / App.tsx, no
// redraw-trigger effect, no React.memo comparator, no draw registry, no loading
// UI. Smoothing approach (A) — straight lineTo per column (§5.3) — only.

// ---------------------------------------------------------------------------
// Constants (§4.2, §5.2)
// ---------------------------------------------------------------------------

/**
 * Max-zoom density in px/s. MUST stay equal to `ppsMax` in Timeline.tsx:103
 * (§4.2 coupling callout). If max zoom is ever raised, this must rise with
 * it or zoom-in will blur. Independent of PEAKS_PER_SECOND below (2026-07-18)
 * — see that constant's own comment.
 */
export const WAVEFORM_MAX_PPS = 100;

/** DPR cap (plan decision #4): backing store is never sampled above 2×. */
export const WAVEFORM_DPR_CAP = 2;

/**
 * Peak-extraction density: columns of peak data computed per second of
 * audio. Used directly by buildWaveformSource below, and by
 * waveformPipeline.ts's buildSourceChunked, which imports this constant and
 * runs the identical blockSize calc — one value drives both the synchronous
 * and chunked builders, so retuning it here is sufficient everywhere.
 *
 * 10/sec is a deliberate, permanent product choice, not derived from
 * WAVEFORM_MAX_PPS × WAVEFORM_DPR_CAP. The original density (200/sec =
 * ppsMax × dpr-cap) was diagnosed as the dominant cost in a ~2.5-minute
 * Apply-Sync freeze on large projects. Several densities (200, 6, 30, and
 * 10 peaks/sec) were evaluated on the 294-segment/21-min reference project
 * before settling on 10/sec: good enough visual fidelity for this
 * product's zoom levels, while keeping the Apply-Sync peak build fast.
 * Because it's well below WAVEFORM_MAX_PPS × WAVEFORM_DPR_CAP, the "≥1 peak
 * column per backing pixel at max zoom" property this file originally
 * guaranteed no longer holds — waveforms are visibly coarser at high
 * timeline zoom. That's an accepted, permanent trade-off, not a bug.
 */
export const PEAKS_PER_SECOND = 10;

/** Audio lane height in CSS px (Timeline.tsx:552, h-20 = 80px) (§5.2). */
export const LANE_HEIGHT_PX = 80;

/** Vertical padding (top + bottom) inside the lane, in CSS px (§5.3). */
export const VERTICAL_PADDING_PX = 2;

/**
 * Backing-store width clamp (§5.2). A very long segment at 100 px/s × 2 dpr
 * could produce a backing store wider than browsers allow (~16384 px per side
 * in WebKit/Blink; total-area caps are lower). 8192 is a conservative safety
 * net — the reference 21-min/294-seg project averages ~4.3 s/segment (~860 px
 * backing), well under it. When the clamp triggers, columns are collapsed via
 * MAX (never mean) so transients survive (§5.3).
 */
export const MAX_CANVAS_BACKING_WIDTH = 8192;

/**
 * Perceptual amplitude shaping exponent (§5.3). The old DOM path used
 * pow(amp, 0.5); the plan suggests pow(amp, 0.65) as a gentler curve. Chosen
 * value documented here so it stays a single tunable knob.
 */
export const AMP_SHAPE_EXP = 0.65;

// Fill / stroke colors — accent #F27D26 = rgb(242,125,38) (§5.4).
const FILL_EDGE = 'rgba(242,125,38,0.15)'; // faint at vertical extremes
const FILL_CENTER = 'rgba(242,125,38,0.75)'; // strongest at the center line
const CENTER_LINE_COLOR = 'rgba(242,125,38,0.9)'; // thin, brighter center line

// ---------------------------------------------------------------------------
// Data pipeline (§4.2)
// ---------------------------------------------------------------------------

export interface WaveformSource {
  /** Normalized [0,1] against the global peak. */
  peaks: Float32Array;
  /** Columns per second — always PEAKS_PER_SECOND. */
  peaksPerSecond: number;
  /** Decoded duration in seconds, for bounds. */
  totalDuration: number;
}

/**
 * Reduce already-decoded channel-0 PCM to a global peaks array at
 * PEAKS_PER_SECOND density (§4.2). PEAK (max-abs) per block, NOT mean — so
 * speech transients survive. Normalized by the global peak so there are no
 * per-segment brightness jumps.
 *
 * @param pcm         channel-0 PCM (Float32Array), native sample rate.
 * @param sampleRate  decoded.sampleRate (e.g. 44100 / 48000).
 * @param duration    decoded.duration (seconds).
 */
export function buildWaveformSource(
  pcm: Float32Array,
  sampleRate: number,
  duration: number,
): WaveformSource {
  const blockSize = Math.max(1, Math.round(sampleRate / PEAKS_PER_SECOND));
  const totalColumns = Math.max(0, Math.ceil(pcm.length / blockSize));
  const peaks = new Float32Array(totalColumns);

  // Peak (max-abs) per block.
  for (let c = 0; c < totalColumns; c++) {
    const from = c * blockSize;
    const to = Math.min(from + blockSize, pcm.length);
    let peak = 0;
    for (let j = from; j < to; j++) {
      const a = Math.abs(pcm[j]!);
      if (a > peak) peak = a;
    }
    peaks[c] = peak;
  }

  // Global-max normalization; avoid /0 on silence (globalMax || 1e-3).
  let globalMax = 0;
  for (let c = 0; c < totalColumns; c++) {
    if (peaks[c]! > globalMax) globalMax = peaks[c]!;
  }
  const norm = globalMax > 0 ? globalMax : 1e-3;
  for (let c = 0; c < totalColumns; c++) {
    peaks[c] = peaks[c]! / norm;
  }

  return { peaks, peaksPerSecond: PEAKS_PER_SECOND, totalDuration: duration };
}

// ---------------------------------------------------------------------------
// Pure geometry helpers (exported for unit testing — §5.2, §4.2, §5.3)
// ---------------------------------------------------------------------------

export interface BackingDimensions {
  /** Segment width in CSS px at max zoom (100 px/s). */
  cssMaxWidthPx: number;
  /** Lane height in CSS px (80). */
  laneHeightPx: number;
  /** Backing-store width in device px (post DPR + clamp). */
  backingWidth: number;
  /** Backing-store height in device px (post DPR). */
  backingHeight: number;
  /** True when MAX_CANVAS_BACKING_WIDTH reduced the width. */
  clamped: boolean;
  /** DPR actually used (already capped by the caller). */
  dpr: number;
}

/**
 * Backing-store dimensions at max-zoom density, DPR-capped and width-clamped
 * (§5.2). `dpr` is passed in (already capped) rather than read from `window`
 * so this stays a pure, testable function.
 */
export function computeBackingDimensions(
  segmentDuration: number,
  dpr: number,
): BackingDimensions {
  const cssMaxWidthPx = Math.max(0, segmentDuration) * WAVEFORM_MAX_PPS;
  const laneHeightPx = LANE_HEIGHT_PX;
  const targetBackingWidth = Math.round(cssMaxWidthPx * dpr);
  const clamped = targetBackingWidth > MAX_CANVAS_BACKING_WIDTH;
  const backingWidth = clamped ? MAX_CANVAS_BACKING_WIDTH : targetBackingWidth;
  const backingHeight = Math.round(laneHeightPx * dpr);
  return { cssMaxWidthPx, laneHeightPx, backingWidth, backingHeight, clamped, dpr };
}

export interface SegmentWindow {
  startCol: number;
  endCol: number;
}

/**
 * Map a segment's [startTime, startTime+duration) window onto peak-column
 * indices (§4.2). Uses segment.startTime directly (already the cumulative
 * timeline start) and clamps both ends to [0, peaks.length].
 */
export function computeSegmentWindow(
  source: WaveformSource,
  segmentStartTime: number,
  segmentDuration: number,
): SegmentWindow {
  const pps = source.peaksPerSecond;
  const len = source.peaks.length;
  let startCol = Math.floor(segmentStartTime * pps);
  let endCol = Math.floor((segmentStartTime + segmentDuration) * pps);
  startCol = clampInt(startCol, 0, len);
  endCol = clampInt(endCol, 0, len);
  if (endCol < startCol) endCol = startCol;
  return { startCol, endCol };
}

/**
 * Resolve `outputColumns` amplitude samples from peaks[startCol, endCol).
 * Each output column is the MAX over its source group (never mean — preserve
 * transients, §5.3). When outputColumns === N (the non-clamped, one-column-per-
 * backing-pixel case) each group is exactly one source column, so this
 * degenerates to a straight copy.
 */
export function sampleColumnPeaks(
  peaks: Float32Array,
  startCol: number,
  endCol: number,
  outputColumns: number,
): Float32Array {
  const out = new Float32Array(Math.max(0, outputColumns));
  const N = endCol - startCol;
  if (N <= 0 || outputColumns <= 0) return out;

  for (let o = 0; o < outputColumns; o++) {
    const from = startCol + Math.floor((o * N) / outputColumns);
    let to = startCol + Math.floor(((o + 1) * N) / outputColumns);
    if (to <= from) to = from + 1; // ensure at least one sample per output column
    const upper = Math.min(to, endCol);
    let peak = 0;
    for (let j = from; j < upper; j++) {
      const a = peaks[j] ?? 0;
      if (a > peak) peak = a;
    }
    out[o] = peak;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Canvas drawing (§5.3, §5.4, §5.5)
// ---------------------------------------------------------------------------

/**
 * Draw one segment's mirrored filled-curve waveform onto `canvas` (§5.3-5.4).
 * The backing store is sized at max-zoom detail (§5.2); CSS `width:100%` on the
 * canvas element scales the bitmap to the current zoom, so zoom is never a
 * redraw trigger (§6.2). Clears before drawing so redraws don't ghost.
 *
 * `source` is typed as nullable to satisfy the §5.5 "no source yet" case —
 * callers (the future redraw effect) guard it, but a defensive null here draws
 * the centered hairline rather than throwing.
 */
export function drawSegmentWaveform(
  canvas: HTMLCanvasElement,
  source: WaveformSource | null | undefined,
  segmentStartTime: number,
  segmentDuration: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = resolveDpr();
  const { cssMaxWidthPx, laneHeightPx, backingWidth, backingHeight } =
    computeBackingDimensions(segmentDuration, dpr);

  // Setting width/height resizes AND resets the backing store to transparent.
  canvas.width = Math.max(1, backingWidth);
  canvas.height = Math.max(1, backingHeight);

  // Explicit clear in device pixels (identity transform) so redraws never ghost
  // — matches §5.4 even though the width assignment above already clears.
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Map a CSS-pixel coordinate space [0..cssMaxWidthPx] × [0..laneHeightPx]
  // onto the backing store. Equivalent to §5.2's ctx.scale(dpr, dpr) in the
  // common (unclamped) case — scaleX/scaleY ≈ dpr — but this form also absorbs
  // the MAX_CANVAS_BACKING_WIDTH clamp (§5.2/§5.3), where scaleX < dpr squeezes
  // the same coordinate space into the reduced backing width.
  const scaleX = cssMaxWidthPx > 0 ? canvas.width / cssMaxWidthPx : dpr;
  const scaleY = laneHeightPx > 0 ? canvas.height / laneHeightPx : dpr;
  ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

  const W = cssMaxWidthPx;
  const H = laneHeightPx;
  const midY = H / 2;
  const maxAmpPx = midY - VERTICAL_PADDING_PX;

  const drawCenterLine = () => {
    ctx.strokeStyle = CENTER_LINE_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(W, midY);
    ctx.stroke();
  };

  // §5.5: no source yet, or a zero-width lane → hairline only.
  if (!source || W <= 0) {
    drawCenterLine();
    return;
  }

  const { startCol, endCol } = computeSegmentWindow(source, segmentStartTime, segmentDuration);
  const N = endCol - startCol;
  // §5.5: empty window → hairline only.
  if (N <= 0) {
    drawCenterLine();
    return;
  }

  // One output column per backing pixel at most; fewer only if the window has
  // fewer source columns than the backing is wide.
  const outputColumns = Math.min(N, Math.max(1, canvas.width));
  const amps = sampleColumnPeaks(source.peaks, startCol, endCol, outputColumns);

  // §5.5: entirely-silent window → hairline only.
  let maxAmp = 0;
  for (let i = 0; i < amps.length; i++) {
    if (amps[i]! > maxAmp) maxAmp = amps[i]!;
  }
  if (maxAmp <= 0) {
    drawCenterLine();
    return;
  }

  const M = amps.length;
  const xs = new Float32Array(M);
  const topY = new Float32Array(M);
  const botY = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const shaped = Math.pow(clamp01(amps[i]!), AMP_SHAPE_EXP);
    const aPx = Math.max(1, shaped * maxAmpPx); // min 1px so quiet spans still show
    xs[i] = (i / M) * W;
    topY[i] = midY - aPx;
    botY[i] = midY + aPx;
  }

  // Filled body — vertical gradient (strongest at the center line) (§5.4).
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.0, FILL_EDGE);
  grad.addColorStop(0.5, FILL_CENTER);
  grad.addColorStop(1.0, FILL_EDGE);
  ctx.fillStyle = grad;

  // One continuous mirrored path: top envelope L→R, then bottom envelope R→L
  // (approach A — straight lineTo per column, §5.3).
  ctx.beginPath();
  ctx.moveTo(0, midY);
  for (let i = 0; i < M; i++) ctx.lineTo(xs[i]!, topY[i]!);
  ctx.lineTo(W, midY);
  for (let i = M - 1; i >= 0; i--) ctx.lineTo(xs[i]!, botY[i]!);
  ctx.closePath();
  ctx.fill();

  drawCenterLine();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Read devicePixelRatio, defaulting to 1 off-DOM, capped at WAVEFORM_DPR_CAP. */
function resolveDpr(): number {
  const raw =
    typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
      ? window.devicePixelRatio
      : 1;
  return Math.min(Math.max(raw || 1, 1), WAVEFORM_DPR_CAP);
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clampInt(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
