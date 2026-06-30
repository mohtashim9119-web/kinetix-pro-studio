import { VideoSegment, Asset, TextOverlay, TransitionType, AnimationType } from '../types';
import { getFilterStyle } from '../constants';
import { applySegmentAnimation } from './canvasAnimations';
import { TRANSITION_NONE } from '../effectsOptions';

export interface FrameGlobalConfig {
  overlayConfig: { color: string; backgroundColor: string; fontFamily: string; fontSize?: number };
  globalOverlayFilter?: string;
  globalTextLayers?: TextOverlay[];
}

/**
 * Blend parameters for transition compositing.
 * When present, the adjacent segment's pre-rendered frame is composited
 * on top of the current frame after all overlays have been drawn.
 *
 * alpha=0 → fully current segment; alpha=1 → fully adjacent segment.
 * This is applied at the OUTGOING end of a segment (the encoder passes
 * the incoming segment's first frame as adjacentCanvas).
 */
export interface TransitionBlendParams {
  adjacentCanvas: HTMLCanvasElement;
  /** Blend factor 0..1 (0 = current, 1 = adjacent). */
  alpha: number;
  type: TransitionType | string;
}

export interface FrameRenderParams {
  segment: VideoSegment;
  asset: Asset | undefined;
  /** Elapsed seconds within this segment (0 … segment.duration). */
  timeInSegment: number;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  global: FrameGlobalConfig;
  /** Optional: blend with an adjacent segment's frame for transitions. */
  transition?: TransitionBlendParams;
  /**
   * Reference height for the body-caption font-size formula (bodyPx =
   * textRefHeight/1080 * fontSize). Defaults to `height` when omitted —
   * correct for export and any full-resolution render, where the canvas
   * pixel height IS the final output height with no further stretch. Pass
   * this separately from `height` for a caller that bakes captions onto a
   * smaller bitmap which then gets stretched back up before display
   * (otherwise the caption bakes in at the bitmap's own smaller scale and
   * lands too small once stretched). Not currently exercised by any call
   * site — the transition-preview snapshot (the bitmap case this was built
   * for) now sets `skipCaption: true` instead and bakes no caption at all.
   */
  textRefHeight?: number;
  /**
   * When true, skips drawing the main body-caption pill + text only (the
   * block gated by `segment.text` below). Headings, extra overlays, and
   * global text layers are unaffected — they're drawn elsewhere in this
   * function and never check this flag. Set by the transition-preview
   * snapshot path (useTransitionPreview.ts): the live DOM caption is now
   * the single visible caption layer throughout a transition, so the
   * snapshot must not bake its own copy underneath it — a size/position
   * mismatch between the two was the source of a visible "pop" at the
   * transition's end. Export (segmentEncoder.ts) never sets this — export
   * has no DOM caption, so it still bakes the body caption exactly as before.
   */
  skipCaption?: boolean;
}

// ---------------------------------------------------------------------------
// Asset caches — avoid re-creating elements or re-fetching between frames
// ---------------------------------------------------------------------------

const imageCache = new Map<string, HTMLImageElement>();
const videoCache = new Map<string, HTMLVideoElement>();

function loadImage(url: string): Promise<HTMLImageElement> {
  const hit = imageCache.get(url);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imageCache.set(url, img); resolve(img); };
    img.onerror = () => reject(new Error(`frameRenderer: failed to load image ${url}`));
    img.src = url;
  });
}

function getOrCreateVideo(url: string): HTMLVideoElement {
  let el = videoCache.get(url);
  if (!el) {
    el = document.createElement('video');
    el.src = url;
    el.muted = true;
    el.playsInline = true;
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    videoCache.set(url, el);
  }
  return el;
}

/** Wait for readyState >= HAVE_METADATA (1) and a non-NaN duration. */
async function ensureMetadata(el: HTMLVideoElement): Promise<void> {
  if (el.readyState >= 1 && !isNaN(el.duration)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('error', onErr);
      clearTimeout(timer);
    };
    const onMeta = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error('video metadata load error')); };
    const timer = setTimeout(() => {
      cleanup();
      console.warn('[seek] metadata wait timed out — proceeding anyway');
      resolve(); // non-fatal: proceed and let seeked handle it
    }, 5000);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('error', onErr);
  });

  if (el.duration === 0 || isNaN(el.duration)) {
    console.warn(`[seek] videoDuration=${el.duration} after metadata wait — video may be empty or unreadable`);
  }
}

/** Await the `seeked` event with a 5s timeout. */
function awaitSeeked(el: HTMLVideoElement, targetForLog: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const cleanup = () => {
      el.removeEventListener('seeked', onSeeked);
      el.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('video seek failed')); };
    const timer = setTimeout(() => {
      cleanup();
      const elapsed = Date.now() - start;
      console.error(
        `[seek] TIMEOUT after ${elapsed}ms —` +
        ` target=${targetForLog.toFixed(3)}s currentTime=${el.currentTime.toFixed(3)}s` +
        ` videoDuration=${el.duration}s readyState=${el.readyState}` +
        ` networkState=${el.networkState} src=${el.src.slice(0, 80)}`,
      );
      reject(new Error('video seek timeout (5s)'));
    }, 5000);
    el.addEventListener('seeked', onSeeked);
    el.addEventListener('error', onError);
  });
}

async function seekVideo(el: HTMLVideoElement, time: number): Promise<void> {
  // Step 1: ensure metadata is ready so duration is known.
  await ensureMetadata(el);

  // Step 2: clamp seek beyond duration (handles stretched segments).
  let target = time;
  if (el.duration > 0 && !isNaN(el.duration) && target > el.duration) {
    target = Math.max(0, el.duration - 0.05);
    if (import.meta.env.DEV) {
      console.debug(`[seek] clamped ${time.toFixed(3)}s → ${target.toFixed(3)}s (duration=${el.duration}s)`);
    }
  }

  if (import.meta.env.DEV) {
    console.debug(
      `[seek] target=${target.toFixed(3)}s videoDuration=${el.duration}s` +
      ` readyState=${el.readyState} networkState=${el.networkState}` +
      ` src=${el.src.slice(0, 80)}`,
    );
  }

  // Step 3: if already exactly at target, nudge first so `seeked` fires.
  // A seek to the current position is a no-op — the browser never fires `seeked`.
  if (Math.abs(el.currentTime - target) < 0.001) {
    const nudge = target > 0.001 ? target - 0.001 : target + 0.001;
    el.currentTime = nudge;
    await awaitSeeked(el, nudge);
  }

  // Step 4: seek to actual target.
  el.currentTime = target;
  await awaitSeeked(el, target);
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLVideoElement,
  w: number,
  h: number,
  scale = 1,
): void {
  const srcW = img instanceof HTMLVideoElement ? img.videoWidth : img.naturalWidth;
  const srcH = img instanceof HTMLVideoElement ? img.videoHeight : img.naturalHeight;
  if (!srcW || !srcH) return;

  const canvasAspect = w / h;
  const imgAspect = srcW / srcH;
  let drawW: number, drawH: number;
  if (imgAspect > canvasAspect) {
    drawH = h * scale;
    drawW = drawH * imgAspect;
  } else {
    drawW = w * scale;
    drawH = drawW / imgAspect;
  }
  ctx.drawImage(img, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH);
}

function drawGradientVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Matches PreviewStage: bg-gradient-to-t from-black/80 via-transparent to-black/40
  const grad = ctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.80)');
  grad.addColorStop(0.4, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.40)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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

function applyTextShadow(ctx: CanvasRenderingContext2D, shadow: string): void {
  // Parse CSS shadow string "offsetX offsetY blur color"
  const m = shadow.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(.+)/);
  if (m) {
    ctx.shadowOffsetX = parseFloat(m[1]!);
    ctx.shadowOffsetY = parseFloat(m[2]!);
    ctx.shadowBlur = parseFloat(m[3]!);
    ctx.shadowColor = m[4]!.trim();
  }
}

function clearShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.shadowBlur = 0;
  // 'transparent' is rejected by some Chromium canvas implementations;
  // 'rgba(0,0,0,0)' is unambiguous and universally accepted.
  ctx.shadowColor = 'rgba(0,0,0,0)';
}

async function ensureFont(family: string, sizePx: number): Promise<void> {
  try {
    await document.fonts.load(`${sizePx}px "${family}"`);
  } catch {
    // non-fatal — canvas falls back to system font
  }
}

/** Break text into lines that fit within maxWidth at the current ctx.font. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
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

function drawExtraOverlay(ctx: CanvasRenderingContext2D, overlay: TextOverlay, w: number, h: number): void {
  const x = (overlay.position.x / 100) * w;
  const y = (overlay.position.y / 100) * h;
  const fw = overlay.fontWeight ?? 'normal';
  const fs = overlay.fontStyle ?? 'normal';
  const font = `${fs} ${fw} ${overlay.fontSize}px "${overlay.fontFamily}"`;

  ctx.save();
  ctx.font = font;
  ctx.textAlign = (overlay.textAlign ?? 'center') as CanvasTextAlign;
  ctx.textBaseline = 'middle';

  const metrics = ctx.measureText(overlay.text);
  const tw = metrics.width;
  const th = overlay.fontSize * 1.4;
  const px = 16, py = 8;

  if (overlay.backgroundColor) {
    ctx.fillStyle = overlay.backgroundColor;
    drawRoundedRect(ctx, x - tw / 2 - px, y - th / 2 - py, tw + px * 2, th + py * 2, 12);
    ctx.fill();
  }

  ctx.fillStyle = overlay.color;
  applyTextShadow(ctx, overlay.textShadow ?? '0 2px 10px rgba(0,0,0,0.5)');
  ctx.fillText(overlay.text, x, y);
  clearShadow(ctx);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Clip-effect helpers (effectAnimation slug → canvas ops)
// ---------------------------------------------------------------------------

/**
 * Resolves a CSS-filter string for the filter-based clip effects
 * (effectAnimation slugs). Returns 'none' for any slug that is not a
 * filter effect (zoom/ken-burns are transforms; duotone is a
 * scratch-canvas pixel op handled separately after the media draw).
 */
function resolveClipEffectFilter(slug: string | undefined): string {
  switch (slug) {
    case 'color-grade':
      return 'brightness(1.05) contrast(1.15) saturate(1.25)';
    case 'gaussian-blur':
      return 'blur(6px)';
    case 'sepia':
      return 'sepia(0.85)';
    case 'invert':
      return 'invert(1)';
    default:
      return 'none';
  }
}

function applyDuotone(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Shadow color: deep blue (20,20,80) / Highlight color: warm cream (255,240,200)
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    const t = lum / 255;
    data[i]     = Math.round(20  + t * (255 - 20));
    data[i + 1] = Math.round(20  + t * (240 - 20));
    data[i + 2] = Math.round(80  + t * (200 - 80));
  }
  ctx.putImageData(imageData, 0, 0);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders one frame of a segment onto an existing 2D canvas context.
 * The canvas should already be the target resolution (width × height).
 * Resolves when the frame is fully drawn (video seeking is async).
 */
export async function renderSegmentFrame(params: FrameRenderParams): Promise<void> {
  const { segment, asset, timeInSegment, ctx, width: w, height: h, global: g, textRefHeight, skipCaption } = params;

  // Background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  // -------------------------------------------------------------------------
  // Heading segments: title is primary content — bypass overlays and the showOverlay gate.
  // Renders background asset (if set in headingConfig) or solid color fill,
  // then draws title text at the configured position. Returns early.
  // -------------------------------------------------------------------------
  if (segment.isHeading || segment.heading) {
    const hc = segment.headingConfig;
    const headingText = hc?.text ?? segment.heading ?? '';
    const bgColor = hc?.backgroundColor ?? '#000000';
    const textColor = hc?.color ?? '#ffffff';
    const fontFamily = hc?.fontFamily ?? g.overlayConfig.fontFamily ?? 'sans-serif';
    const xPct = (hc?.x ?? 50) / 100;
    const yPct = (hc?.y ?? 50) / 100;

    // Background: draw asset if headingConfig.assetId resolves, else solid color.
    // (asset is already resolved by the caller from assetMap; headingConfig.assetId
    //  sets segment.assetId when the user picks a background — the caller passes it.)
    if (asset?.url) {
      ctx.filter = 'none';
      if (asset.type === 'image') {
        const img = await loadImage(asset.url);
        drawImageCover(ctx, img, w, h);
      } else if (asset.type === 'video') {
        const videoEl = getOrCreateVideo(asset.url);
        const rawTime = (segment.trimStart ?? 0) + timeInSegment * (segment.playbackSpeed ?? 1);
        const videoTime = segment.trimEnd !== undefined ? Math.min(rawTime, segment.trimEnd) : rawTime;
        await seekVideo(videoEl, videoTime);
        drawImageCover(ctx, videoEl, w, h);
      }
    } else {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);
    }

    if (!headingText) {
      if (params.transition && params.transition.alpha > 0) {
        applyTransitionBlend(ctx, params.transition, w, h);
      }
      return;
    }

    const maxWidth = w * 0.9;
    const maxHeight = h * 0.8;
    let fontSize = hc?.fontSize ?? Math.floor(h * 0.10);
    const minFontSize = Math.floor(h * 0.03);
    const fontWeight = hc?.fontWeight ?? 'bold';
    await ensureFont(fontFamily, fontSize);

    let lines: string[] = [];
    ctx.save();

    if (hc?.fontSize) {
      // Fixed size: wrap without shrinking.
      ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}"`;
      let currentLine = '';
      for (const word of headingText.split(' ')) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);
    } else {
      // Auto-fit: shrink until text fits within maxHeight.
      while (fontSize >= minFontSize) {
        ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}"`;
        lines = [];
        let currentLine = '';
        for (const word of headingText.split(' ')) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          if (ctx.measureText(testLine).width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
        if (currentLine) lines.push(currentLine);
        if (lines.length * fontSize * 1.2 <= maxHeight) break;
        fontSize -= Math.max(4, Math.floor(fontSize * 0.08));
      }
    }

    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    const centerX = w * xPct;
    const centerY = h * yPct - totalHeight / 2 + lineHeight / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, centerX, centerY + i * lineHeight);
    });
    ctx.restore();

    if (params.transition && params.transition.alpha > 0) {
      applyTransitionBlend(ctx, params.transition, w, h);
    }
    return;
  }

  // -------------------------------------------------------------------------
  // Visual layer (filter applied only to the media, not the text overlays)
  // -------------------------------------------------------------------------
  // Resolve clip effect filter (effectAnimation slug wins over legacy overlayFilter)
  const clipEffectFilter = resolveClipEffectFilter(segment.effectAnimation);
  const filterStr = clipEffectFilter !== 'none'
    ? clipEffectFilter
    : getFilterStyle(segment.overlayFilter ?? g.globalOverlayFilter);
  ctx.filter = filterStr !== 'none' ? filterStr : 'none';

  if (asset?.url) {
    // Apply segment animation transform around media draw.
    // NONE and undefined both produce identity (no transform).
    // effectAnimation slug wins over the legacy segment.animation when set
    // (filter/pixel slugs cast harmlessly to identity in applySegmentAnimation).
    const effectiveAnimation = (segment.effectAnimation && segment.effectAnimation !== 'none')
      ? segment.effectAnimation as AnimationType
      : segment.animation;
    const animation = effectiveAnimation ?? AnimationType.NONE;
    ctx.save();
    const animResult = applySegmentAnimation(ctx, {
      animation,
      timeInSegment,
      segmentDuration: segment.duration,
      canvasWidth: w,
      canvasHeight: h,
    });
    // postDrawAlpha must be applied before the draw to affect the image.
    if (animResult.postDrawAlpha !== undefined) {
      ctx.globalAlpha = animResult.postDrawAlpha;
    }

    if (asset.type === 'image') {
      const img = await loadImage(asset.url);
      drawImageCover(ctx, img, w, h);
    } else if (asset.type === 'video') {
      const videoEl = getOrCreateVideo(asset.url);
      const rawTime = (segment.trimStart ?? 0) + timeInSegment * (segment.playbackSpeed ?? 1);
      // undefined trimEnd = "play to end of media"; seekVideo clamps to el.duration internally
      const videoTime = segment.trimEnd !== undefined ? Math.min(rawTime, segment.trimEnd) : rawTime;
      await seekVideo(videoEl, videoTime);
      drawImageCover(ctx, videoEl, w, h);
    }

    ctx.restore();
    // Restore global state after animation transform
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'rgba(0,0,0,0)';
  }

  // All overlays drawn without the media filter
  ctx.filter = 'none';

  // Pixel-op clip effects that can't be expressed as a CSS filter string.
  // Applied to the drawn media only, before vignette/overlay compositing.
  if (segment.effectAnimation === 'duotone') {
    applyDuotone(ctx, w, h);
  }

  // Gradient vignette (matches the overlay in PreviewStage)
  drawGradientVignette(ctx, w, h);

  // Extra positioned overlays
  for (const overlay of segment.extraOverlays ?? []) {
    await ensureFont(overlay.fontFamily, overlay.fontSize);
    drawExtraOverlay(ctx, overlay, w, h);
  }

  // Global text layers — visible on all segments unless explicitly hidden
  for (const layer of g.globalTextLayers ?? []) {
    if ((layer.hiddenOnSegments ?? []).includes(segment.id)) continue;
    await ensureFont(layer.fontFamily, layer.fontSize);
    drawExtraOverlay(ctx, layer, w, h);
  }

  // -------------------------------------------------------------------------
  // Main heading + body text (mirrors PreviewStage layout)
  // -------------------------------------------------------------------------
  const showText = segment.showOverlay ?? false;
  if (showText) {
    const oc = segment.overlayConfig;
    const fontFamily = oc?.fontFamily ?? g.overlayConfig.fontFamily;
    const color = oc?.color ?? g.overlayConfig.color;
    const bgColor = oc?.backgroundColor ?? g.overlayConfig.backgroundColor;
    const fontWeight = oc?.fontWeight ?? 900;
    const fontStyle = oc?.fontStyle ?? 'normal';
    const shadow = oc?.textShadow ?? '0 4px 15px rgba(0,0,0,0.5)';
    const xPct = (oc?.x ?? 50) / 100;
    const yPct = (oc?.y ?? 78) / 100;

    // refScale converts PreviewStage's fixed DOM CSS px (24px font, 768px wrap cap,
    // 20/12px padding, 24px radius — PreviewStage.tsx:719-733) into canvas px at the
    // current render resolution. Uses textRefHeight when supplied (snapshot bitmaps
    // get stretched up before display) else the canvas's own height (export).
    const refScale = (textRefHeight ?? h) / 1080;
    const bodyPx = Math.round(refScale * (oc?.fontSize ?? 24));

    if (segment.text && !skipCaption) {
      const displayText = segment.text;
      await ensureFont(fontFamily, bodyPx);
      ctx.save();
      ctx.font = `italic normal ${bodyPx}px "${fontFamily}"`;
      const maxTextW = 768 * refScale; // matches DOM's max-w-3xl
      const lines = wrapText(ctx, displayText, maxTextW);
      const lineH = bodyPx * 1.5;
      const totalH = lines.length * lineH;
      const textW = Math.max(...lines.map(line => ctx.measureText(line).width));
      const padX = Math.round(20 * refScale); // matches DOM's px-5
      const padY = Math.round(12 * refScale); // matches DOM's py-3
      const boxW = textW + padX * 2;
      const boxH = totalH + padY * 2;
      // Position-aware anchor (mirrors PreviewStage.tsx:719's translate(-xPct%, -yPct%)):
      // box's near edge sits at the frame edge at 0%, far edge at 100%, centered at 50%.
      // A fixed own-center anchor (the old w*xPct - boxW/2) only agreed with this at 50%.
      const boxX = xPct * (w - boxW);
      const boxY = yPct * (h - boxH);
      const centerX = boxX + boxW / 2;

      if (bgColor !== 'transparent') {
        ctx.fillStyle = bgColor;
        drawRoundedRect(ctx, boxX, boxY, boxW, boxH, Math.round(24 * refScale)); // matches DOM's rounded-3xl
        ctx.fill();
      }

      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      lines.forEach((line, i) => {
        ctx.fillText(line, centerX, boxY + padY + i * lineH);
      });
      ctx.restore();
    }
  }

  // -------------------------------------------------------------------------
  // Transition blend (composited last, over all overlays)
  // -------------------------------------------------------------------------
  if (params.transition && params.transition.alpha > 0) {
    applyTransitionBlend(ctx, params.transition, w, h);
  }
}

// ---------------------------------------------------------------------------
// glitch-rgb scratch canvases — created once, resized only when w×h changes,
// and reused across every frame/call rather than allocated fresh each time.
// Module-level (not segmentEncoder.ts-local) because applyTransitionBlend is
// shared by both the export path and the preview-overlay path
// (useTransitionPreview/PreviewStage), and both need the same reuse
// guarantee across their own frame loops.
// ---------------------------------------------------------------------------
let glitchRedCanvas: HTMLCanvasElement | null = null;
let glitchBlueCanvas: HTMLCanvasElement | null = null;

function getGlitchScratchCanvases(
  w: number,
  h: number,
): {
  redCanvas: HTMLCanvasElement;
  redCtx: CanvasRenderingContext2D;
  blueCanvas: HTMLCanvasElement;
  blueCtx: CanvasRenderingContext2D;
} | null {
  if (!glitchRedCanvas) glitchRedCanvas = document.createElement('canvas');
  if (!glitchBlueCanvas) glitchBlueCanvas = document.createElement('canvas');
  if (glitchRedCanvas.width !== w || glitchRedCanvas.height !== h) {
    glitchRedCanvas.width = w;
    glitchRedCanvas.height = h;
  }
  if (glitchBlueCanvas.width !== w || glitchBlueCanvas.height !== h) {
    glitchBlueCanvas.width = w;
    glitchBlueCanvas.height = h;
  }
  const redCtx = glitchRedCanvas.getContext('2d');
  const blueCtx = glitchBlueCanvas.getContext('2d');
  if (!redCtx || !blueCtx) return null;
  return { redCanvas: glitchRedCanvas, redCtx, blueCanvas: glitchBlueCanvas, blueCtx };
}

/**
 * Composites the adjacent segment's canvas onto the current frame.
 * Called after all overlays have been drawn for the current frame.
 *
 * alpha=0 → fully current; alpha=1 → fully adjacent (incoming segment).
 *
 * `type` is keyed on the new slug strings (effectTransition) first; legacy
 * TransitionType enum values are kept as equal-weight cases for backward
 * compatibility (old projects, and the Settings global-transition dropdown,
 * both still emit enum values via resolveEffectiveTransition's fallback
 * path). Slugs not yet implemented this slice, and any other unrecognized
 * value, fall through to the `default` hard-cut — that path is deliberately
 * silent (see note above the switch).
 *
 * Exported for use by the preview transition canvas overlay
 * (useTransitionPreview / PreviewStage). The encoder calls this indirectly
 * via the `transition` param of renderSegmentFrame.
 */
export function applyTransitionBlend(
  ctx: CanvasRenderingContext2D,
  blend: TransitionBlendParams,
  w: number,
  h: number,
): void {
  const { adjacentCanvas, alpha, type } = blend;
  if (alpha <= 0) return;

  ctx.save();

  switch (type) {
    // ── Hard cut / cross-dissolve family ────────────────────────────────────
    // hard-cut reuses the exact same code NONE already used — today that's
    // an alpha blend, not a true instant cut (see transitionResolver.ts: the
    // resolver currently always routes hard-cut to the legacy NONE branch
    // before it would reach here, so this slug case is defensive/forward-
    // looking rather than reachable today).
    case TransitionType.FADE:
    case TransitionType.CROSSFADE:
    case TransitionType.DISSOLVE:
    case TransitionType.NONE:
    case TRANSITION_NONE: // 'hard-cut' slug
    case 'cross-dissolve': {
      ctx.globalAlpha = alpha;
      ctx.drawImage(adjacentCanvas, 0, 0, w, h);
      break;
    }

    // ── Slide family ─────────────────────────────────────────────────────────
    // SLIDE/SLIDE_UP/SLIDE_DOWN (legacy enum only) keep the outgoing layer
    // static and only slide the incoming layer over it (curtain reveal).
    case TransitionType.SLIDE: {
      // Adjacent slides in from the right
      ctx.drawImage(adjacentCanvas, (1 - alpha) * w, 0, w, h);
      break;
    }
    case TransitionType.SLIDE_UP: {
      // Adjacent slides in from the bottom
      ctx.drawImage(adjacentCanvas, 0, (1 - alpha) * h, w, h);
      break;
    }
    case TransitionType.SLIDE_DOWN: {
      // Adjacent slides in from the top
      ctx.drawImage(adjacentCanvas, 0, -(alpha * h), w, h);
      break;
    }
    case 'slide-push': {
      // True synchronized push (unlike the curtain-style SLIDE above): the
      // outgoing layer also moves, exiting left while incoming enters from
      // the right. Self-blit is well-defined per spec — drawImage snapshots
      // its source before writing, so reading ctx.canvas as the source for
      // a draw back onto the same ctx does not feed back into itself. Must
      // run before the incoming draw below: the self-blit reads the FULL
      // current canvas, so if incoming were drawn first, the self-blit would
      // also pick up and shift a copy of the incoming pixels.
      ctx.drawImage(ctx.canvas, -alpha * w, 0, w, h);
      ctx.drawImage(adjacentCanvas, (1 - alpha) * w, 0, w, h);
      break;
    }

    // ── Zoom family ──────────────────────────────────────────────────────────
    // TransitionType.ZOOM's enum value IS the string 'zoom', so this case
    // already matches the slug too — no separate slug case needed/possible.
    case TransitionType.ZOOM:
    case TransitionType.ZOOM_WIPE: {
      const scale = 0.5 + 0.5 * alpha; // 0.5 → 1.0
      const sw = w * scale;
      const sh = h * scale;
      ctx.globalAlpha = alpha;
      ctx.drawImage(adjacentCanvas, (w - sw) / 2, (h - sh) / 2, sw, sh);
      break;
    }

    // ── Wipe ─────────────────────────────────────────────────────────────────
    // TransitionType.WIPE's enum value IS the string 'wipe', so this case
    // already matches the slug too — no separate slug case needed/possible
    // (same situation as ZOOM above). Advancing left-to-right clip reveal.
    // Uses its OWN save/restore around the clip specifically — ctx.clip()
    // intersects with any existing clip path and is otherwise permanent for
    // the rest of this save level, so it must not leak past this case.
    case TransitionType.WIPE: {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, alpha * w, h);
      ctx.clip();
      ctx.drawImage(adjacentCanvas, 0, 0, w, h);
      ctx.restore();
      break;
    }

    // ── Blur cross-dissolve (legacy enum only) ──────────────────────────────
    case TransitionType.BLUR: {
      const blurPx = Math.round((1 - alpha) * 20);
      if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
      ctx.globalAlpha = alpha;
      ctx.drawImage(adjacentCanvas, 0, 0, w, h);
      break;
    }
    case 'whip-pan': {
      // Fast horizontal pan with motion blur peaking mid-transition and
      // tapering to zero at both ends (alpha * (1 - alpha), max 0.25 at
      // alpha=0.5) — distinct from the BLUR case above, which is a static
      // crossfade with blur fading out linearly from frame 0. Positioning
      // reuses the legacy SLIDE x-offset formula at full opacity (no
      // globalAlpha) — a spatial reveal, not a fade.
      const blurPx = Math.round(alpha * (1 - alpha) * 80); // 0 at edges, 20px peak at alpha=0.5
      if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
      ctx.drawImage(adjacentCanvas, (1 - alpha) * w, 0, w, h);
      break;
    }

    // ── Dip family ───────────────────────────────────────────────────────────
    // First half (alpha 0→0.5): fade the outgoing frame, already on ctx, to a
    // solid color. Second half (0.5→1): a full-alpha fill of that color erases
    // the outgoing frame entirely (it becomes the new base), then the incoming
    // frame fades in over it. The solid-color fill mediates instead of a direct
    // crossfade, giving a true hold on black/white at the mid-point rather than
    // the two frames ever blending directly into each other.
    case 'dip-black':
    case 'dip-white': {
      const dipColor = type === 'dip-white' ? '#ffffff' : '#000000';
      if (alpha < 0.5) {
        ctx.globalAlpha = alpha / 0.5;
        ctx.fillStyle = dipColor;
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.globalAlpha = 1;
        ctx.fillStyle = dipColor;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = (alpha - 0.5) / 0.5;
        ctx.drawImage(adjacentCanvas, 0, 0, w, h);
      }
      break;
    }

    // ── Glitch / RGB split ───────────────────────────────────────────────────
    // Compositing-only fake (no getImageData): two scratch canvases hold a
    // red-tinted and a blue-tinted copy of the incoming frame, each drawn
    // back onto ctx with 'screen' at a small horizontal offset that peaks
    // mid-transition (alpha*(1-alpha), same parabolic shape as whip-pan's
    // blur above) and converges to 0 at both ends. A final low-alpha clean
    // copy of the incoming frame is layered on top so the result isn't pure
    // chromatic noise.
    case 'glitch-rgb': {
      const scratch = getGlitchScratchCanvases(w, h);
      if (!scratch) {
        // Scratch 2D context unavailable — fall back to a plain crossfade
        // rather than dropping the incoming frame entirely.
        ctx.globalAlpha = alpha;
        ctx.drawImage(adjacentCanvas, 0, 0, w, h);
        break;
      }
      const { redCanvas, redCtx, blueCanvas, blueCtx } = scratch;
      const dx = Math.round(w * 0.03 * alpha * (1 - alpha) * 4);

      // Reset to 'source-over' before each tint draw — these scratch
      // contexts are reused across frames/calls, and the previous frame's
      // 'multiply' tint pass would otherwise corrupt this frame's drawImage.
      redCtx.globalCompositeOperation = 'source-over';
      redCtx.drawImage(adjacentCanvas, 0, 0, w, h);
      redCtx.globalCompositeOperation = 'multiply';
      redCtx.fillStyle = 'rgba(255, 0, 0, 0.6)';
      redCtx.fillRect(0, 0, w, h);

      blueCtx.globalCompositeOperation = 'source-over';
      blueCtx.drawImage(adjacentCanvas, 0, 0, w, h);
      blueCtx.globalCompositeOperation = 'multiply';
      blueCtx.fillStyle = 'rgba(0, 0, 255, 0.6)';
      blueCtx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = alpha;
      ctx.drawImage(redCanvas, -dx, 0, w, h);
      ctx.drawImage(blueCanvas, dx, 0, w, h);

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha * 0.5;
      ctx.drawImage(adjacentCanvas, 0, 0, w, h);

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      break;
    }

    // ── Light leak ───────────────────────────────────────────────────────────
    // Base crossfade (same body as the cross-dissolve case above) plus a
    // warm radial-gradient bloom overlaid with 'screen' so it adds light
    // rather than occluding the frame. Bloom strength follows the same
    // alpha*(1-alpha) peak-at-midpoint shape, scaled to peak at 1.0.
    case 'light-leak': {
      ctx.globalAlpha = alpha;
      ctx.drawImage(adjacentCanvas, 0, 0, w, h);

      const bloomAlpha = alpha * (1 - alpha) * 4;
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = bloomAlpha;
      const gradient = ctx.createRadialGradient(
        w * 0.35, h * 0.25, 0,
        w * 0.35, h * 0.25, w * 0.7,
      );
      gradient.addColorStop(0, 'rgba(255, 240, 200, 1.0)');
      gradient.addColorStop(0.3, 'rgba(255, 160, 60, 0.6)');
      gradient.addColorStop(1.0, 'rgba(255, 100, 20, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      break;
    }

    // ── Not yet implemented: any legacy TransitionType enum member without
    // a canvas implementation (FLIP, RANDOM, PIXELATE, SPIRAL, etc.), or a
    // genuinely unknown value — all expected-not-yet-built states, not
    // errors, so no warn. All 10 new slugs are now implemented above.
    default: {
      if (alpha >= 0.5) {
        ctx.drawImage(adjacentCanvas, 0, 0, w, h);
      }
      break;
    }
  }

  ctx.restore();
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
}

/** Purge cached video/image elements (call when assets are deleted). */
export function clearFrameRendererCache(): void {
  videoCache.forEach((el) => { el.src = ''; });
  videoCache.clear();
  imageCache.clear();
}
