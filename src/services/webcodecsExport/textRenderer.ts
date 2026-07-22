/// <reference lib="webworker" />
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GL text renderer (docs/webcodecs-export-plan.md §4.3/§5) — Step 6 of the
 * WebCodecs+WebGL2 export. PARITY REFERENCE for every text-drawing decision
 * below is `../frameRenderer.ts` (read end-to-end before touching this
 * file); this module is a byte-for-byte port of its wrapping/sizing/
 * positioning math onto a Canvas2D "atlas" that is then GPU-composited as a
 * textured quad, instead of drawing straight into the same 2D context the
 * media was drawn to. Only the OUTPUT MECHANISM changes (GL quad vs. direct
 * 2D draw); every measurement/wrap/pill/shadow number is the same formula.
 *
 * Design (plan §4.3):
 *   1. ATLAS BUILD (Canvas2D, OffscreenCanvas, once per unique text config,
 *      cached — see AtlasCache below): renders exactly the text element
 *      (text + pill background + shadow) to a canvas sized to its own
 *      bounding box — NOT the full frame — so the atlas is small and
 *      independent of WHERE on screen the element ends up. The one
 *      exception is the Path B heading (see `buildHeadingTextAtlas`'s own
 *      doc comment): its atlas is frame-sized because its wrap width (90%
 *      of frame width) and vertical centering are computed against the
 *      full frame, exactly like `drawHeadingLayerOverlay` does.
 *   2. PER-FRAME RENDER: bind the atlas texture, draw one alpha-blended
 *      textured quad at the element's on-screen position, AFTER
 *      GlCompositor's grade pass (text sits on top of video+grade+
 *      transition). The heading's full-frame background fill is a
 *      separate, solid-color quad drawn BEFORE the heading's own text
 *      quad — matching `drawHeadingLayerOverlay`'s fillRect-then-text
 *      order without baking the (arbitrary CSS-color, possibly
 *      translucent) fill into the atlas image itself.
 *
 * Worker-safe: no DOM, no React, no `document`. Uses OffscreenCanvas (atlas
 * build + a 1x1 CSS-color probe) and `self.fonts` (font loading) — both
 * confirmed available in the real WKWebView worker by Step 0.
 */

import type { HeadingOverlay, TextOverlay, VideoSegment } from '../../types';
import { getActiveHeadingAt } from '../headingLayer';

// ---------------------------------------------------------------------------
// Config threading (plan §8's text-relevant fields, minus `hideAllText`
// which the plan's Adjustments §17.2 confirms does not exist anywhere in the
// export config). `FrameGlobalConfig` (frameRenderer.ts) is not reused
// directly — that interface requires `overlayConfig`, but the current
// exportPipelineWebCodecs.ts (explicitly out of this step's scope — see this
// step's own report) does not yet thread project-level text config into the
// worker's init message, so every field here must be safely OPTIONAL. See
// DEFAULT_GLOBAL_OVERLAY_CONFIG below for the documented fallback this
// implies until that wiring lands.
// ---------------------------------------------------------------------------

export interface TextRenderGlobalConfig {
  overlayConfig?: { color: string; backgroundColor: string; fontFamily: string; fontSize?: number };
  textLayers?: TextOverlay[];
  headings?: HeadingOverlay[];
}

/** One worker-loadable font (plan §4.3 point 4). `family` must match the
 *  `fontFamily` string segments/overlays/headings actually store (e.g.
 *  "Inter"). Carries raw font BYTES, not a URL: `FontFace.load()` on a
 *  `url(...)` source performs its own network fetch, which fails with a
 *  NetworkError inside the export worker (confirmed on real WKWebView —
 *  the worker cannot fetch cross-origin fonts the way the main thread can).
 *  Fetching the bytes on the main thread (`fontResolver.ts`'s
 *  `resolveFontBytes`, where `fetch` works) and constructing `FontFace`
 *  directly from an `ArrayBuffer` needs no network access in the worker at
 *  all. Resolving `FONT_FAMILIES` to concrete font files is the calling
 *  orchestrator's job (out of this file's scope), not this renderer's — it
 *  only knows how to load whatever bytes it's given under whatever family
 *  name it's given. */
export interface FontConfig {
  family: string;
  bytes: ArrayBuffer;
  weight?: string;
  style?: string;
}

/** Everything one call to `GLTextRenderer.renderFrame` needs for one tick.
 *  `segment` is the SINGLE segment whose text (extraOverlays / body caption)
 *  is shown this tick — see the "which segment's text during a transition"
 *  design note below `resolveTextSegment` in exportWorker.ts for how the
 *  caller picks it; `null` skips every segment-scoped element but still
 *  renders a heading (headings are keyed by absoluteTime only, not by
 *  segment). */
export interface TextRenderTickContext {
  segment: VideoSegment | null;
  global: TextRenderGlobalConfig;
  /** Absolute (whole-timeline) seconds — required for the Path B heading
   *  lookup, exactly like FrameRenderParams.absoluteTime in frameRenderer.ts. */
  absoluteTime: number;
  frameWidth: number;
  frameHeight: number;
}

/** frameRenderer.ts's App.tsx-default fallback (App.tsx's blank-project
 *  literal: `globalOverlayConfig: { color: '#FFFFFF', backgroundColor:
 *  '#000000', fontFamily: 'Inter' }`) — used ONLY when the caller's
 *  `global.overlayConfig` is absent (the current, documented orchestrator
 *  gap; see this file's header). A project that customized its global
 *  overlay config away from this default will render a segment's own
 *  per-field-unset caption fields against THIS fallback rather than the
 *  project's real one until that wiring lands — flagged, not silently
 *  "fixed" by guessing the real value. */
const DEFAULT_GLOBAL_OVERLAY_CONFIG = { color: '#FFFFFF', backgroundColor: '#000000', fontFamily: 'Inter' };

// ---------------------------------------------------------------------------
// Ported primitives — line-for-line from frameRenderer.ts (cited per
// function) so a divergence here is a diff against a known source, not a
// silent reimplementation.
// ---------------------------------------------------------------------------

/** frameRenderer.ts:272 drawRoundedRect — verbatim. */
function drawRoundedRect(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** frameRenderer.ts:286 applyTextShadow — verbatim (CSS "offsetX offsetY blur color" parse). */
function applyTextShadow(ctx: OffscreenCanvasRenderingContext2D, shadow: string): void {
  const m = shadow.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(.+)/);
  if (m) {
    ctx.shadowOffsetX = parseFloat(m[1]!);
    ctx.shadowOffsetY = parseFloat(m[2]!);
    ctx.shadowBlur = parseFloat(m[3]!);
    ctx.shadowColor = m[4]!.trim();
  }
}

/** frameRenderer.ts:297 clearShadow — verbatim. */
function clearShadow(ctx: OffscreenCanvasRenderingContext2D): void {
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(0,0,0,0)';
}

/** frameRenderer.ts:315 wrapText — verbatim. */
function wrapText(ctx: OffscreenCanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ---------------------------------------------------------------------------
// CSS color -> straight-alpha RGBA floats, via a 1x1 probe canvas. Used only
// for the heading's full-frame background fill (see the file header — that
// fill is a separate GL solid-color quad, not baked into an atlas image), so
// its color needs to reach a GL uniform as numbers. Canvas2D's `fillStyle`
// setter accepts the FULL CSS color grammar (hex/rgb/rgba/named/etc — the
// same grammar `HeadingOverlay.backgroundColor` is authored in via the color
// picker), so probing through a real 2D context is correct for any input
// this app can actually produce, unlike a hand-rolled regex parser that
// would only cover the subset of CSS color syntax someone thought to test.
// ---------------------------------------------------------------------------

let colorProbeCanvas: OffscreenCanvas | null = null;
function resolveCssColorRgba(color: string): [number, number, number, number] {
  if (!colorProbeCanvas) colorProbeCanvas = new OffscreenCanvas(1, 1);
  const ctx = colorProbeCanvas.getContext('2d');
  if (!ctx) return [0, 0, 0, 1]; // unreachable in a WebGL2-capable worker, defensive only
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return [r! / 255, g! / 255, b! / 255, a! / 255];
}

// ---------------------------------------------------------------------------
// Atlas builders — one per element kind. Each returns a canvas sized to
// exactly its own content (never the full frame, except the heading text
// atlas — see its own doc comment) plus that size, so the caller can both
// upload the texture and know the on-screen quad's pixel dimensions.
// ---------------------------------------------------------------------------

interface AtlasBuild {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
}

/**
 * frameRenderer.ts:332 drawExtraOverlay, ported. Used for BOTH
 * `segment.extraOverlays` entries and `project.textLayers` (global layers)
 * entries — frameRenderer.ts draws both through the same function
 * (renderSegmentFrame's extraOverlays loop and globalTextLayers loop both
 * call `drawExtraOverlay`), so one atlas builder covers both element kinds
 * here too.
 *
 * The legacy function always centers its pill box ON the overlay's
 * (x%, y%) anchor regardless of `textAlign` — `drawRoundedRect(ctx, x -
 * tw/2 - px, y - th/2 - py, ...)` never reads `ctx.textAlign` for the box,
 * only `fillText` does. That means the on-screen QUAD placement for this
 * atlas is always "centered on the anchor point" (rectPx.xy = anchorPx -
 * (boxW/2, boxH/2)) independent of textAlign; textAlign only changes where
 * the text sits WITHIN the box, which this function reproduces by drawing
 * at the box's own local center (boxW/2, boxH/2) with the same
 * `ctx.textAlign` — i.e. exactly frameRenderer's `x, y` role, translated
 * into local atlas coordinates instead of frame coordinates.
 */
function buildOverlayAtlas(overlay: TextOverlay): AtlasBuild {
  const fw = overlay.fontWeight ?? 'normal';
  const fs = overlay.fontStyle ?? 'normal';
  const font = `${fs} ${fw} ${overlay.fontSize}px "${overlay.fontFamily}"`;
  const textAlign = (overlay.textAlign ?? 'center') as CanvasTextAlign;

  // Sizing pass — a throwaway 1x1 context just to get real font metrics
  // before the real atlas canvas (whose size depends on those metrics) can
  // be created.
  const measure = new OffscreenCanvas(1, 1).getContext('2d')!;
  measure.font = font;
  measure.textAlign = textAlign;
  measure.textBaseline = 'middle';
  const metrics = measure.measureText(overlay.text);
  const tw = metrics.width;
  const th = overlay.fontSize * 1.4;
  const px = 16;
  const py = 8;
  const boxW = Math.max(1, Math.ceil(tw + px * 2));
  const boxH = Math.max(1, Math.ceil(th + py * 2));

  const canvas = new OffscreenCanvas(boxW, boxH);
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.textAlign = textAlign;
  ctx.textBaseline = 'middle';

  const localX = boxW / 2;
  const localY = boxH / 2;

  if (overlay.backgroundColor) {
    ctx.fillStyle = overlay.backgroundColor;
    drawRoundedRect(ctx, localX - tw / 2 - px, localY - th / 2 - py, tw + px * 2, th + py * 2, 12);
    ctx.fill();
  }

  ctx.fillStyle = overlay.color;
  applyTextShadow(ctx, overlay.textShadow ?? '0 2px 10px rgba(0,0,0,0.5)');
  ctx.fillText(overlay.text, localX, localY);
  clearShadow(ctx);

  return { canvas, width: boxW, height: boxH };
}

/** frameRenderer.ts:568-604 (the body-caption block inside renderSegmentFrame),
 *  ported. `frameW`/`frameH` are the FULL frame dimensions (needed for the
 *  70%-width wrap cap and the refScale/xPct/yPct math, exactly like the
 *  original); the returned atlas itself is sized to the resulting pill box
 *  only, positioned separately (see resolveBodyCaptionQuad below) — the box
 *  ANCHOR (top-left, position-aware per xPct/yPct) is NOT centering-
 *  symmetric like the overlay case above, so it is computed by the caller
 *  from `frameW`/`frameH`, not baked into this atlas. */
interface BodyCaptionParams {
  text: string;
  fontFamily: string;
  color: string;
  bgColor: string;
  fontWeight: string | number;
  fontStyle: string;
  shadow: string;
  bodyPx: number;
  refScale: number;
  frameW: number;
}

function buildBodyCaptionAtlas(p: BodyCaptionParams): AtlasBuild {
  const font = `${p.fontStyle} ${p.fontWeight} ${p.bodyPx}px "${p.fontFamily}"`;
  const measure = new OffscreenCanvas(1, 1).getContext('2d')!;
  measure.font = font;
  const maxTextW = p.frameW * 0.7; // matches DOM's maxWidth: '70%' / frameRenderer's w*0.7
  const lines = wrapText(measure, p.text, maxTextW);
  const lineH = p.bodyPx * 1.5;
  const totalH = lines.length * lineH;
  const textW = Math.max(...lines.map((line) => measure.measureText(line).width));
  const padX = Math.round(20 * p.refScale);
  const padY = Math.round(12 * p.refScale);
  const boxW = Math.max(1, Math.ceil(textW + padX * 2));
  const boxH = Math.max(1, Math.ceil(totalH + padY * 2));

  const canvas = new OffscreenCanvas(boxW, boxH);
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;

  if (p.bgColor !== 'transparent') {
    ctx.fillStyle = p.bgColor;
    drawRoundedRect(ctx, 0, 0, boxW, boxH, Math.round(24 * p.refScale));
    ctx.fill();
  }

  ctx.fillStyle = p.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  applyTextShadow(ctx, p.shadow);
  const centerX = boxW / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, centerX, padY + i * lineH);
  });
  clearShadow(ctx);

  return { canvas, width: boxW, height: boxH };
}

/**
 * frameRenderer.ts:370 drawHeadingLayerOverlay, ported — TEXT ONLY. The
 * full-frame `backgroundColor` fill that function draws first is
 * deliberately NOT reproduced here (see the file header: it is a separate
 * GL solid-color quad, drawn by the caller before this atlas's quad, so an
 * arbitrary/translucent CSS background color never needs to be re-parsed
 * inside a Canvas2D atlas step). This atlas IS frame-sized (unlike the
 * overlay/caption atlases above) because the wrap width (90% of frame
 * width) and the vertical centering both key off the full frame, exactly
 * like the original — reproducing that math in a smaller local canvas would
 * require re-deriving frame-relative wrap/position math a second time for
 * no benefit (a heading is at most one visible instance at a time). */
function buildHeadingTextAtlas(heading: HeadingOverlay, frameW: number, frameH: number): AtlasBuild {
  const canvas = new OffscreenCanvas(frameW, frameH);
  const ctx = canvas.getContext('2d')!;
  const x = (heading.x / 100) * frameW;
  const y = (heading.y / 100) * frameH;

  ctx.font = `${heading.fontWeight} ${heading.fontSize}px "${heading.fontFamily}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = frameW * 0.9;
  const lines = wrapText(ctx, heading.text, maxWidth);
  const lineHeight = heading.fontSize * 1.2;
  const totalHeight = lines.length * lineHeight;

  ctx.fillStyle = heading.color;
  lines.forEach((line, i) => {
    ctx.fillText(line, x, y - totalHeight / 2 + lineHeight / 2 + i * lineHeight);
  });

  return { canvas, width: frameW, height: frameH };
}

// ---------------------------------------------------------------------------
// Atlas cache — bounded LRU (plan §4.3: "~50 entries; GL texture + canvas
// released on eviction"). Keyed by a JSON string over the full config tuple
// for that element kind (see the per-kind `*CacheKey` functions below the
// class) — two elements with identical configs share one atlas entry;
// anything that changes rendered PIXELS must be in the key.
//
// Deliberately NOT in the key: an element's on-screen (x%, y%) position for
// the overlay/text-layer/body-caption kinds — the atlas for those is always
// just "the box", position-independent by construction (see each builder's
// doc comment), so moving an otherwise-identical overlay around the frame
// reuses the same atlas entry at a different quad transform. The heading
// kind is the one exception: its atlas IS frame-sized with (x%, y%) baked
// into the text layout, so heading.x/heading.y ARE part of its cache key.
// ---------------------------------------------------------------------------

interface AtlasEntry {
  texture: WebGLTexture;
  width: number;
  height: number;
}

const MAX_ATLAS_ENTRIES = 50;

class AtlasCache {
  private readonly gl: WebGL2RenderingContext;
  // Map iteration order = insertion order; re-inserting a key on a cache HIT
  // moves it to the end, so `.keys().next().value` is always the true LRU
  // entry — a plain, dependency-free LRU (no extra library needed for a
  // 50-entry bound).
  private readonly map = new Map<string, AtlasEntry>();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  get(key: string): AtlasEntry | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    this.map.set(key, hit); // move to most-recently-used
    return hit;
  }

  set(key: string, build: AtlasBuild): AtlasEntry {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('GLTextRenderer: gl.createTexture() returned null for a text atlas');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, build.canvas);
    const entry: AtlasEntry = { texture, width: build.width, height: build.height };
    this.map.set(key, entry);
    this.evictIfNeeded();
    return entry;
  }

  private evictIfNeeded(): void {
    while (this.map.size > MAX_ATLAS_ENTRIES) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      const entry = this.map.get(oldestKey);
      if (entry) this.gl.deleteTexture(entry.texture);
      this.map.delete(oldestKey);
    }
  }

  get size(): number {
    return this.map.size;
  }

  dispose(): void {
    for (const entry of this.map.values()) this.gl.deleteTexture(entry.texture);
    this.map.clear();
  }
}

// ---------------------------------------------------------------------------
// Cache-key derivation — pure functions, unit-tested directly (see
// textRenderer.test.ts) without needing a real GL context. Exported for
// tests only; not part of the class's public per-frame contract.
// ---------------------------------------------------------------------------

export function overlayCacheKey(overlay: TextOverlay, frameW: number, frameH: number): string {
  return JSON.stringify({
    kind: 'overlay',
    text: overlay.text,
    fontFamily: overlay.fontFamily,
    fontSize: overlay.fontSize,
    fontWeight: String(overlay.fontWeight ?? 'normal'),
    fontStyle: overlay.fontStyle ?? 'normal',
    color: overlay.color,
    backgroundColor: overlay.backgroundColor ?? '',
    textShadow: overlay.textShadow ?? '0 2px 10px rgba(0,0,0,0.5)',
    textAlign: overlay.textAlign ?? 'center',
    frameW,
    frameH,
  });
}

export function bodyCaptionCacheKey(p: BodyCaptionParams): string {
  return JSON.stringify({
    kind: 'body-caption',
    text: p.text,
    fontFamily: p.fontFamily,
    color: p.color,
    bgColor: p.bgColor,
    fontWeight: String(p.fontWeight),
    fontStyle: p.fontStyle,
    shadow: p.shadow,
    bodyPx: p.bodyPx,
    refScale: p.refScale,
    frameW: p.frameW,
  });
}

/** frameRenderer.ts:537-538's `globalTextLayers` visibility filter, extracted
 *  as its own pure function so `hiddenOnSegments` behavior is unit-testable
 *  without a GL context. */
export function filterVisibleTextLayers(layers: readonly TextOverlay[], segmentId: string): TextOverlay[] {
  return layers.filter((layer) => !(layer.hiddenOnSegments ?? []).includes(segmentId));
}

export function headingCacheKey(heading: HeadingOverlay, frameW: number, frameH: number): string {
  return JSON.stringify({
    kind: 'heading',
    text: heading.text,
    fontFamily: heading.fontFamily,
    fontSize: heading.fontSize,
    fontWeight: String(heading.fontWeight),
    color: heading.color,
    // x/y ARE part of this key (unlike the other two kinds) — the heading
    // atlas is frame-sized with position baked into the text layout itself;
    // see buildHeadingTextAtlas's doc comment.
    x: heading.x,
    y: heading.y,
    frameW,
    frameH,
  });
}

// ---------------------------------------------------------------------------
// Text-config derivation for the body caption — the per-field fallback chain
// frameRenderer.ts:548-566 applies (segment.overlayConfig, per field, falls
// back to the global overlayConfig), extracted as its own pure function so
// it's unit-testable without a GL context. Returns null when the caption
// should not render at all (frameRenderer.ts's own `showText`/`segment.text`
// gate).
// ---------------------------------------------------------------------------

export interface ResolvedBodyCaption extends BodyCaptionParams {
  xPct: number;
  yPct: number;
}

export function resolveBodyCaptionConfig(
  segment: VideoSegment,
  global: TextRenderGlobalConfig,
  frameW: number,
  frameH: number,
): ResolvedBodyCaption | null {
  const showText = segment.showOverlay ?? false;
  if (!showText || !segment.text) return null;

  const oc = segment.overlayConfig;
  const g = global.overlayConfig ?? DEFAULT_GLOBAL_OVERLAY_CONFIG;
  const fontFamily = oc?.fontFamily ?? g.fontFamily;
  const color = oc?.color ?? g.color;
  const bgColor = oc?.backgroundColor ?? g.backgroundColor;
  const fontWeight = oc?.fontWeight ?? 900;
  const fontStyle = oc?.fontStyle ?? 'normal';
  const shadow = oc?.textShadow ?? '0 4px 15px rgba(0,0,0,0.5)';
  const xPct = (oc?.x ?? 50) / 100;
  const yPct = (oc?.y ?? 78) / 100;
  const refScale = frameH / 1080;
  const bodyPx = Math.round(refScale * (oc?.fontSize ?? 24));

  return { text: segment.text, fontFamily, color, bgColor, fontWeight, fontStyle, shadow, bodyPx, refScale, frameW, xPct, yPct };
}

// ---------------------------------------------------------------------------
// GL programs — a positioned, alpha-blended textured quad (atlases) and a
// positioned, alpha-blended solid-color quad (the heading's full-frame
// background fill). Both share one vertex shader and one quad VBO/VAO;
// separate from GlCompositor's own fullscreen-triangle geometry, which
// this class does not touch or depend on.
//
// Positioning: `u_rectPx` is (x, y, w, h) in TOP-LEFT-ORIGIN pixel space —
// the same convention frameRenderer.ts's ctx/canvas coordinates use — mapped
// to NDC via the standard `1.0 - pixelY/canvasH*2.0` flip (NDC +Y = visual
// top, the same convention GlCompositor's own straight-vertex-shader passes
// already rely on when writing the final graded frame to this same canvas).
// `a_uv` is used directly (no additional flip) to sample the atlas texture:
// the atlas is a plain Canvas2D-drawn, top-left-origin OffscreenCanvas
// uploaded via texImage2D with no UNPACK_FLIP_Y_WEBGL set (default false,
// matching GlCompositor's own uploads), so texel row 0 (the atlas's own
// visual top) already lines up with `a_uv.y = 0` (this quad's own top edge)
// with no flip needed — unlike GlCompositor's blit shader, which flips
// because it reconciles a raw VideoFrame/ImageBitmap upload's row order
// against a DIFFERENT downstream convention (see shaders.ts's header). This
// quad has no such reconciliation to do: it defines its own top-left-origin
// pixel space directly from `u_rectPx`, so there is exactly one coordinate
// system in play, not two.
// ---------------------------------------------------------------------------

const QUAD_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_uv;
uniform vec4 u_rectPx;      // x, y, w, h — top-left-origin pixel space
uniform vec2 u_canvasSize;  // width, height in pixels
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  vec2 pixelPos = u_rectPx.xy + a_uv * u_rectPx.zw;
  vec2 ndc = vec2(
    pixelPos.x / u_canvasSize.x * 2.0 - 1.0,
    1.0 - pixelPos.y / u_canvasSize.y * 2.0
  );
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

const TEXTURED_QUAD_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_tex;
void main() {
  o_color = texture(u_tex, v_uv);
}`;

const SOLID_QUAD_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
out vec4 o_color;
uniform vec4 u_color; // straight (non-premultiplied) rgba, 0..1
void main() {
  o_color = u_color;
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('GLTextRenderer: gl.createShader() returned null');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`GLTextRenderer: shader compile failed: ${info ?? '(no info log)'}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, fragSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, QUAD_VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('GLTextRenderer: gl.createProgram() returned null');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`GLTextRenderer: program link failed: ${info ?? '(no info log)'}`);
  }
  return program;
}

interface TexturedQuadProgram {
  program: WebGLProgram;
  uRectPx: WebGLUniformLocation | null;
  uCanvasSize: WebGLUniformLocation | null;
  uTex: WebGLUniformLocation | null;
}

interface SolidQuadProgram {
  program: WebGLProgram;
  uRectPx: WebGLUniformLocation | null;
  uCanvasSize: WebGLUniformLocation | null;
  uColor: WebGLUniformLocation | null;
}

// ---------------------------------------------------------------------------
// Public class
// ---------------------------------------------------------------------------

export class GLTextRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly texturedProgram: TexturedQuadProgram;
  private readonly solidProgram: SolidQuadProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly atlasCache: AtlasCache;
  private readonly loadedFontFamilies = new Set<string>();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.atlasCache = new AtlasCache(gl);

    const texturedProgram = linkProgram(gl, TEXTURED_QUAD_FRAGMENT_SHADER);
    this.texturedProgram = {
      program: texturedProgram,
      uRectPx: gl.getUniformLocation(texturedProgram, 'u_rectPx'),
      uCanvasSize: gl.getUniformLocation(texturedProgram, 'u_canvasSize'),
      uTex: gl.getUniformLocation(texturedProgram, 'u_tex'),
    };

    const solidProgram = linkProgram(gl, SOLID_QUAD_FRAGMENT_SHADER);
    this.solidProgram = {
      program: solidProgram,
      uRectPx: gl.getUniformLocation(solidProgram, 'u_rectPx'),
      uCanvasSize: gl.getUniformLocation(solidProgram, 'u_canvasSize'),
      uColor: gl.getUniformLocation(solidProgram, 'u_color'),
    };

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('GLTextRenderer: gl.createVertexArray() returned null');
    this.vao = vao;
    gl.bindVertexArray(this.vao);
    const vbo = gl.createBuffer();
    if (!vbo) throw new Error('GLTextRenderer: gl.createBuffer() returned null');
    this.vbo = vbo;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    // Unit quad in (0,0)..(1,1), drawn as a TRIANGLE_STRIP: (0,0) (1,0) (0,1) (1,1).
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  /** Loads every font this export will need, once, before the frame loop
   *  starts — matching frameRenderer.ts's per-draw `ensureFont` call in
   *  effect (every family is loadable before any text is measured/drawn)
   *  but done once per family up front rather than per draw call: a loaded
   *  `FontFace`'s outline data is usable at any size, so there is no
   *  per-size reload the way `ensureFont`'s `document.fonts.load` call
   *  might imply. A family that fails to load is skipped non-fatally
   *  (`ensureFont`'s own "canvas falls back to system font" contract) —
   *  this export never fails an export over a missing web font. */
  async init(fontConfigs: readonly FontConfig[]): Promise<void> {
    await Promise.all(
      fontConfigs.map(async (cfg) => {
        if (this.loadedFontFamilies.has(cfg.family)) return;
        try {
          const descriptors: FontFaceDescriptors = {};
          if (cfg.weight) descriptors.weight = cfg.weight;
          if (cfg.style) descriptors.style = cfg.style;
          // Bytes, not a URL — see FontConfig's own doc comment: FontFace.load()
          // on a url(...) source performs its own network fetch, which fails
          // inside this worker on real WKWebView. Constructing FontFace
          // directly from the ArrayBuffer needs no network access at all.
          const face = new FontFace(cfg.family, cfg.bytes, descriptors);
          await face.load();
          self.fonts.add(face);
          this.loadedFontFamilies.add(cfg.family);
        } catch (e) {
          // Non-fatal — see this method's own doc comment. Logged so a
          // genuinely broken font is still visible in worker devtools,
          // without failing the export over it.
          // eslint-disable-next-line no-console
          console.warn(`GLTextRenderer: failed to load font "${cfg.family}" from bytes:`, e);
        }
      }),
    );
  }

  private getOrBuildAtlas(key: string, build: () => AtlasBuild): AtlasEntry {
    const hit = this.atlasCache.get(key);
    if (hit) return hit;
    return this.atlasCache.set(key, build());
  }

  private drawTexturedQuad(entry: AtlasEntry, x: number, y: number, canvasW: number, canvasH: number): void {
    const gl = this.gl;
    const p = this.texturedProgram;
    gl.useProgram(p.program);
    gl.uniform4f(p.uRectPx, x, y, entry.width, entry.height);
    gl.uniform2f(p.uCanvasSize, canvasW, canvasH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.uniform1i(p.uTex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawSolidQuad(x: number, y: number, w: number, h: number, canvasW: number, canvasH: number, rgba: [number, number, number, number]): void {
    const gl = this.gl;
    const p = this.solidProgram;
    gl.useProgram(p.program);
    gl.uniform4f(p.uRectPx, x, y, w, h);
    gl.uniform2f(p.uCanvasSize, canvasW, canvasH);
    gl.uniform4f(p.uColor, rgba[0], rgba[1], rgba[2], rgba[3]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Draws every visible text element for one frame, in the SAME order as
   * frameRenderer.ts's renderSegmentFrame (plan §4.3 point 3):
   *   1. segment.extraOverlays
   *   2. project.textLayers (global layers), skipping hiddenOnSegments
   *   3. body caption
   *   4. Path B heading (composited LAST, on top of everything)
   * Call AFTER GlCompositor.renderFrame() (this draws to the same canvas,
   * whatever GlCompositor already rendered stays as the base underneath).
   */
  renderFrame(ctx: TextRenderTickContext): void {
    const gl = this.gl;
    const { segment, global, absoluteTime, frameWidth, frameHeight } = ctx;

    gl.viewport(0, 0, frameWidth, frameHeight);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    if (segment) {
      // 1. Extra overlays — box always centered on (x%, y%) regardless of
      // textAlign (see buildOverlayAtlas's doc comment).
      for (const overlay of segment.extraOverlays ?? []) {
        this.drawOverlayElement(overlay, frameWidth, frameHeight);
      }

      // 2. Global text layers, minus any hidden on this segment.
      for (const layer of filterVisibleTextLayers(global.textLayers ?? [], segment.id)) {
        this.drawOverlayElement(layer, frameWidth, frameHeight);
      }

      // 3. Body caption.
      const caption = resolveBodyCaptionConfig(segment, global, frameWidth, frameHeight);
      if (caption) {
        const key = bodyCaptionCacheKey(caption);
        const entry = this.getOrBuildAtlas(key, () => buildBodyCaptionAtlas(caption));
        const boxX = caption.xPct * (frameWidth - entry.width);
        const boxY = caption.yPct * (frameHeight - entry.height);
        this.drawTexturedQuad(entry, boxX, boxY, frameWidth, frameHeight);
      }
    }

    // 4. Path B heading — absoluteTime-keyed, independent of `segment`.
    const heading = global.headings && global.headings.length > 0 ? getActiveHeadingAt(global.headings, absoluteTime) : undefined;
    if (heading && heading.text) {
      if (heading.backgroundColor && heading.backgroundColor !== 'transparent') {
        const rgba = resolveCssColorRgba(heading.backgroundColor);
        this.drawSolidQuad(0, 0, frameWidth, frameHeight, frameWidth, frameHeight, rgba);
      }
      const key = headingCacheKey(heading, frameWidth, frameHeight);
      const entry = this.getOrBuildAtlas(key, () => buildHeadingTextAtlas(heading, frameWidth, frameHeight));
      this.drawTexturedQuad(entry, 0, 0, frameWidth, frameHeight);
    }

    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  private drawOverlayElement(overlay: TextOverlay, frameWidth: number, frameHeight: number): void {
    const key = overlayCacheKey(overlay, frameWidth, frameHeight);
    const entry = this.getOrBuildAtlas(key, () => buildOverlayAtlas(overlay));
    const anchorX = (overlay.position.x / 100) * frameWidth;
    const anchorY = (overlay.position.y / 100) * frameHeight;
    const boxX = anchorX - entry.width / 2;
    const boxY = anchorY - entry.height / 2;
    this.drawTexturedQuad(entry, boxX, boxY, frameWidth, frameHeight);
  }

  /** Releases every GL resource this class owns, including every cached
   *  atlas texture (AtlasCache.dispose). */
  dispose(): void {
    const gl = this.gl;
    this.atlasCache.dispose();
    gl.deleteProgram(this.texturedProgram.program);
    gl.deleteProgram(this.solidProgram.program);
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
  }

  /** Test/diagnostic only — current atlas entry count. */
  get atlasCacheSize(): number {
    return this.atlasCache.size;
  }
}
