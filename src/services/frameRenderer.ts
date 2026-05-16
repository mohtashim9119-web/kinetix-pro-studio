import { VideoSegment, Asset, TextOverlay } from '../types';
import { getFilterStyle } from '../constants';

export interface FrameGlobalConfig {
  overlayConfig: { color: string; backgroundColor: string; fontFamily: string };
  hideAllText: boolean;
  globalOverlayFilter?: string;
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

async function ensureVideoMetadata(el: HTMLVideoElement): Promise<void> {
  if (el.readyState >= 1) return; // HAVE_METADATA
  await new Promise<void>((resolve, reject) => {
    const onMeta = () => { el.removeEventListener('loadedmetadata', onMeta); el.removeEventListener('error', onErr); resolve(); };
    const onErr = () => { el.removeEventListener('loadedmetadata', onMeta); el.removeEventListener('error', onErr); reject(new Error('video metadata load error')); };
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('error', onErr);
  });
}

async function seekVideo(el: HTMLVideoElement, time: number): Promise<void> {
  await ensureVideoMetadata(el);
  if (Math.abs(el.currentTime - time) < 0.04) return;
  await new Promise<void>((resolve, reject) => {
    const onSeeked = () => { el.removeEventListener('seeked', onSeeked); el.removeEventListener('error', onErr); resolve(); };
    const onErr = () => { el.removeEventListener('seeked', onSeeked); el.removeEventListener('error', onErr); reject(new Error('video seek error')); };
    el.addEventListener('seeked', onSeeked);
    el.addEventListener('error', onErr);
    el.currentTime = time;
  });
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
  ctx.shadowColor = 'transparent';
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders one frame of a segment onto an existing 2D canvas context.
 * The canvas should already be the target resolution (width × height).
 * Resolves when the frame is fully drawn (video seeking is async).
 */
export async function renderSegmentFrame(params: FrameRenderParams): Promise<void> {
  const { segment, asset, timeInSegment, ctx, width: w, height: h, global: g } = params;

  // Background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  // -------------------------------------------------------------------------
  // Visual layer (filter applied only to the media, not the text overlays)
  // -------------------------------------------------------------------------
  const filterStr = getFilterStyle(segment.overlayFilter ?? g.globalOverlayFilter);
  ctx.filter = filterStr !== 'none' ? filterStr : 'none';

  if (asset?.url) {
    if (asset.type === 'image') {
      const img = await loadImage(asset.url);
      // Ken Burns: scale 1.0 → 1.1 over the segment duration (matches PreviewStage)
      const progress = segment.duration > 0 ? Math.min(timeInSegment / segment.duration, 1) : 0;
      const scale = 1.0 + 0.1 * progress;
      drawImageCover(ctx, img, w, h, scale);
    } else if (asset.type === 'video') {
      const videoEl = getOrCreateVideo(asset.url);
      const videoTime = (segment.trimStart ?? 0) + timeInSegment * (segment.playbackSpeed ?? 1);
      await seekVideo(videoEl, videoTime);
      drawImageCover(ctx, videoEl, w, h);
    }
  }

  // All overlays drawn without the media filter
  ctx.filter = 'none';

  // Gradient vignette (matches the overlay in PreviewStage)
  drawGradientVignette(ctx, w, h);

  // Extra positioned overlays
  for (const overlay of segment.extraOverlays ?? []) {
    await ensureFont(overlay.fontFamily, overlay.fontSize);
    drawExtraOverlay(ctx, overlay, w, h);
  }

  // -------------------------------------------------------------------------
  // Main heading + body text (mirrors PreviewStage layout)
  // -------------------------------------------------------------------------
  const showText = !g.hideAllText || segment.showOverlay;
  if (showText) {
    const oc = segment.overlayConfig;
    const fontFamily = oc?.fontFamily ?? g.overlayConfig.fontFamily;
    const color = oc?.color ?? g.overlayConfig.color;
    const bgColor = oc?.backgroundColor ?? g.overlayConfig.backgroundColor;
    const fontWeight = oc?.fontWeight ?? 900;
    const fontStyle = oc?.fontStyle ?? 'normal';
    const shadow = oc?.textShadow ?? '0 4px 15px rgba(0,0,0,0.5)';

    // Scale font sizes relative to 1080p reference (PreviewStage uses 60 / 24 px CSS at ~1024px wide)
    const headingPx = Math.round((h / 1080) * 60);
    const bodyPx = Math.round((h / 1080) * 24);

    if (segment.heading) {
      await ensureFont(fontFamily, headingPx);
      ctx.save();
      ctx.font = `${fontStyle} ${fontWeight} ${headingPx}px "${fontFamily}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      applyTextShadow(ctx, shadow);
      ctx.fillText(segment.heading, w / 2, h * 0.30);
      clearShadow(ctx);
      ctx.restore();
    }

    if (segment.text) {
      const displayText = `“${segment.text}”`;
      await ensureFont(fontFamily, bodyPx);
      ctx.save();
      ctx.font = `italic normal ${bodyPx}px "${fontFamily}"`;
      const maxTextW = w * 0.60;
      const lines = wrapText(ctx, displayText, maxTextW);
      const lineH = bodyPx * 1.5;
      const totalH = lines.length * lineH;
      const padX = Math.round(w * 0.05);
      const padY = Math.round(h * 0.03);
      const boxW = maxTextW + padX * 2;
      const boxH = totalH + padY * 2;
      const boxX = (w - boxW) / 2;
      const boxY = h * 0.55;

      ctx.fillStyle = bgColor;
      drawRoundedRect(ctx, boxX, boxY, boxW, boxH, Math.round(h * 0.025));
      ctx.fill();

      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      lines.forEach((line, i) => {
        ctx.fillText(line, w / 2, boxY + padY + i * lineH);
      });
      ctx.restore();
    }
  }
}

/** Purge cached video/image elements (call when assets are deleted). */
export function clearFrameRendererCache(): void {
  videoCache.forEach((el) => { el.src = ''; });
  videoCache.clear();
  imageCache.clear();
}
