/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { memo, useEffect, useRef, useState } from 'react';
import { drawSegmentWaveform, WaveformSource } from '../services/waveformPeaks';
import { enqueueWaveformDraw } from '../services/waveformDrawQueue';
import { getCurrentGeneration, markSegmentFailed, markSegmentReady } from '../services/waveformReadyTracker';
import { peekImage, putImage, getPersistedImage } from '../services/waveformImageCache';

/**
 * One segment's voiceover waveform, rendered as an <img> (NOT a live <canvas>).
 *
 * Why an image (plan §7 mitigation #1): 294 live GPU-backed canvases allocated
 * in one burst froze the reference project. Instead we draw each segment ONCE
 * into an off-screen surface (OffscreenCanvas when available, else a detached
 * <canvas> never appended to the DOM), snapshot it to an image URL, and display
 * that. There are then ZERO live canvases — the compositor handles decoded
 * images far more cheaply and the canvas-count ceiling disappears.
 *
 * drawSegmentWaveform (waveformPeaks.ts) is used verbatim — only where its
 * output goes changed. The draw is enqueued through waveformDrawQueue so the
 * initial 294-segment batch is spread across frames rather than one sync flush.
 *
 * pointer-events:none is load-bearing (§8): the resize handles (z-20) and the
 * row's click-to-seek must keep receiving events; the <img> must never
 * intercept them.
 */

interface SegmentWaveformProps {
  /** Minimal subset of VideoSegment needed to place + window the waveform. */
  segment: { id: string; startTime: number; duration: number };
  source: WaveformSource | null;
  /**
   * Voiceover asset identity (docs/history.md ("Waveform rendered-image caching," 2026-07-19 entry) Phase B) —
   * together with segment id/startTime/duration these form the rendered-
   * image cache key. undefined disables caching entirely (falls back to the
   * pre-Phase-B always-redraw behavior) rather than guessing at a key.
   */
  assetId: string | undefined;
  blobSize: number | undefined;
  projectId: string | undefined;
}

const isBlobUrl = (url: string | null): url is string => !!url && url.startsWith('blob:');

/**
 * Draw the segment into an off-screen surface and snapshot it to a displayable
 * URL. OffscreenCanvas → convertToBlob + createObjectURL (blob: URL, must be
 * revoked); detached <canvas> fallback → toDataURL (data: URL, nothing to
 * revoke). drawSegmentWaveform sizes the surface itself, so a 1×1 start is fine.
 */
// --- TEMP diagnostic instrumentation (waveform freeze audit) -----------------
// Gated on globalThis.__WF_INSTRUMENT__. Counts which code path each segment
// takes and times the draw vs. the encode (convertToBlob / toDataURL) portions
// separately, so we can attribute the freeze. Remove after the audit.
type WfPath = 'offscreen-convert' | 'offscreen-convert-failed' | 'fallback-toDataURL';
interface WfInstr {
  counts: Record<WfPath, number>;
  drawMs: number[];
  encodeMs: number[];
  totalMs: number[];
}
function wfInstr(): WfInstr | null {
  const g = globalThis as unknown as { __WF_INSTRUMENT__?: boolean; __wfRender?: WfInstr };
  if (g.__WF_INSTRUMENT__ !== true) return null;
  return (g.__wfRender ??= {
    counts: { 'offscreen-convert': 0, 'offscreen-convert-failed': 0, 'fallback-toDataURL': 0 },
    drawMs: [],
    encodeMs: [],
    totalMs: [],
  });
}

// --- TEMP diagnostic instrumentation (waveform freeze audit, encode-step
// follow-up) ------------------------------------------------------------------
// The wfInstr() aggregate above records encodeMs into an array but never logs
// per-segment, so there's no way to see WHICH segments are slow or whether
// encode time correlates with canvas width. Gated on the same
// globalThis.__WF_INSTRUMENT__ flag — no new flag to flip. Reuses the `instr`
// null-check already computed at each call site below, so this is strictly
// additive: zero calls, zero allocations, and no console output when the flag
// is off. Remove after the audit alongside wfInstr() above.
type WfEncodeMethod = 'offscreen-convert' | 'fallback-toDataURL';
interface WfEncodeEntry {
  idx: number;
  segmentId: string;
  width: number;
  height: number;
  ms: number;
  method: WfEncodeMethod;
}
let __wfEncodeSeq = 0;
function recordWfEncode(entry: Omit<WfEncodeEntry, 'idx'>): void {
  const g = globalThis as unknown as {
    __wfEncodeEntries?: WfEncodeEntry[];
    __wfEncodeDump?: () => void;
  };
  const full: WfEncodeEntry = { idx: __wfEncodeSeq++, ...entry };
  (g.__wfEncodeEntries ??= []).push(full);
  // eslint-disable-next-line no-console
  console.log('[wf-encode]', JSON.stringify(full));
  g.__wfEncodeDump ??= () => {
    const entries = g.__wfEncodeEntries ?? [];
    if (entries.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[wf-encode] no entries captured');
      return;
    }
    const msVals = entries.map((e) => e.ms);
    const total = msVals.reduce((a, b) => a + b, 0);
    const avg = total / msVals.length;
    const min = Math.min(...msVals);
    const max = Math.max(...msVals);
    // eslint-disable-next-line no-console
    console.log('[wf-encode] === summary (n=%s) ===', entries.length);
    // eslint-disable-next-line no-console
    console.log(
      '  total=%sms avg=%sms min=%sms max=%sms',
      total.toFixed(1), avg.toFixed(2), min.toFixed(1), max.toFixed(1),
    );
    // Bucket by canvas width (200px buckets) so width/ms correlation can be
    // eyeballed without a spreadsheet — never mean-collapse the raw entries
    // (still available in globalThis.__wfEncodeEntries for a full listing).
    const BUCKET_PX = 200;
    const buckets = new Map<number, number[]>();
    for (const e of entries) {
      const key = Math.floor(e.width / BUCKET_PX) * BUCKET_PX;
      let arr = buckets.get(key);
      if (!arr) { arr = []; buckets.set(key, arr); }
      arr.push(e.ms);
    }
    // eslint-disable-next-line no-console
    console.log('  width-bucket breakdown (px range → avg ms, n):');
    for (const key of [...buckets.keys()].sort((a, b) => a - b)) {
      const vals = buckets.get(key)!;
      const bAvg = vals.reduce((a, b) => a + b, 0) / vals.length;
      // eslint-disable-next-line no-console
      console.log(`    [${key}-${key + BUCKET_PX}) avg=${bAvg.toFixed(2)}ms n=${vals.length}`);
    }
  };
}
// -----------------------------------------------------------------------------

// --- TEMP diagnostic instrumentation (gen-6 / blob-revocation audit) ---------
// Gated on the same globalThis.__WF_INSTRUMENT__ flag. Logs every blob: URL
// create/revoke for a segment's waveform image, so a runtime capture can show
// whether a revoke lands while an <img> is still resolving the prior URL.
// Read-only investigation aid — does not change create/revoke timing or order.
function wfBlobLog(event: string, segmentId: string, url: string | null): void {
  if ((globalThis as unknown as { __WF_INSTRUMENT__?: boolean }).__WF_INSTRUMENT__ !== true) return;
  // eslint-disable-next-line no-console
  console.log('[wf-blob]', JSON.stringify({ event, segmentId, url }));
}
// -----------------------------------------------------------------------------

interface RenderedWaveformImage {
  url: string;
  /**
   * The encoded PNG, for write-through into waveformImageCache.ts — only
   * present on the OffscreenCanvas path (a real Blob). The toDataURL
   * fallback path returns null here: a data: URL isn't a Blob, and
   * converting one back to a Blob just to persist it isn't worth it for a
   * fallback that only runs when OffscreenCanvas is unavailable. That
   * segment simply isn't cached — it correctly redraws again next time.
   */
  blob: Blob | null;
}

async function renderWaveformImageUrl(
  source: WaveformSource,
  startTime: number,
  duration: number,
  segmentId: string,
): Promise<RenderedWaveformImage> {
  const instr = wfInstr();
  const t0 = instr ? performance.now() : 0;
  if (typeof OffscreenCanvas !== 'undefined') {
    const off = new OffscreenCanvas(1, 1);
    // drawSegmentWaveform only uses getContext('2d')/width/height, all present
    // on OffscreenCanvas; cast keeps waveformPeaks.ts untouched.
    drawSegmentWaveform(off as unknown as HTMLCanvasElement, source, startTime, duration);
    const tDraw = instr ? performance.now() : 0;
    try {
      const blob = await off.convertToBlob({ type: 'image/png' });
      const url = URL.createObjectURL(blob);
      wfBlobLog('create', segmentId, url);
      if (instr) {
        const tEncode = performance.now();
        const encodeMs = tEncode - tDraw;
        instr.counts['offscreen-convert'] += 1;
        instr.drawMs.push(tDraw - t0);
        instr.encodeMs.push(encodeMs);
        instr.totalMs.push(tEncode - t0);
        recordWfEncode({
          segmentId, width: off.width, height: off.height, ms: encodeMs, method: 'offscreen-convert',
        });
      }
      return { url, blob };
    } catch (e) {
      if (instr) instr.counts['offscreen-convert-failed'] += 1;
      throw e;
    }
  }
  const canvas = document.createElement('canvas'); // detached — never appended
  drawSegmentWaveform(canvas, source, startTime, duration);
  const tDraw = instr ? performance.now() : 0;
  const url = canvas.toDataURL('image/png');
  if (instr) {
    const tEncode = performance.now();
    const encodeMs = tEncode - tDraw;
    instr.counts['fallback-toDataURL'] += 1;
    instr.drawMs.push(tDraw - t0);
    instr.encodeMs.push(encodeMs);
    instr.totalMs.push(tEncode - t0);
    recordWfEncode({
      segmentId, width: canvas.width, height: canvas.height, ms: encodeMs, method: 'fallback-toDataURL',
    });
  }
  return { url, blob: null };
}

function SegmentWaveformImpl({ segment, source, assetId, blobSize, projectId }: SegmentWaveformProps) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  // Currently-displayed URL, tracked for revocation on swap/unmount.
  const urlRef = useRef<string | null>(null);
  // True when urlRef.current came from waveformImageCache.ts's Tier-1 mirror
  // (docs/history.md ("Waveform rendered-image caching," 2026-07-19 entry) Phase B) and is therefore owned by
  // that cache — only ITS eviction/invalidation may revoke it. A URL this
  // component drew itself (via renderWaveformImageUrl) is a separate,
  // independently-created object URL even after a write-through putImage
  // call (putImage mints its own fresh URL for the cache), so it remains
  // this component's own responsibility to revoke, same as before Phase B.
  const urlIsCacheOwnedRef = useRef(false);

  useEffect(() => {
    if (!source) return; // no peaks yet → skip; redraws when source arrives
    let cancelled = false;
    let handle: ReturnType<typeof enqueueWaveformDraw> | null = null;

    // Captured once per draw attempt (rewrite Step 4, waveformReadyTracker.ts):
    // tags this segment's eventual ready/failed report so a completion landing
    // after a NEWER sync/reload has already begun is recognized as stale and
    // ignored, rather than corrupting the new batch's count.
    const generation = getCurrentGeneration();

    // Applies an already-resolved cache hit (Tier 1 or Tier 2) directly,
    // skipping the draw queue entirely — shared by both cache-check paths
    // below so the swap/revoke bookkeeping only lives in one place.
    const applyCachedUrl = (cachedUrl: string) => {
      const prev = urlRef.current;
      const prevWasCacheOwned = urlIsCacheOwnedRef.current;
      urlRef.current = cachedUrl;
      urlIsCacheOwnedRef.current = true;
      setImgUrl(cachedUrl);
      markSegmentReady(generation, segment.id);
      if (!prevWasCacheOwned && isBlobUrl(prev)) {
        wfBlobLog('revoke-swap', segment.id, prev);
        URL.revokeObjectURL(prev);
      }
    };

    // Draws fresh via the throttled queue (plan §7 chunked scheduling) — the
    // fallback when neither cache tier has this segment's image yet.
    const drawFresh = () => {
      handle = enqueueWaveformDraw(() => {
        if (cancelled) return;
        renderWaveformImageUrl(source, segment.startTime, segment.duration, segment.id)
          .then(({ url, blob }) => {
            // Report completion regardless of `cancelled` — the registry only
            // cares that this segment's draw settled, not whether THIS component
            // instance still wants the resulting image (a superseded draw is
            // always followed by a fresh one reporting the same segment id, and
            // the registry's Set-based bookkeeping makes that idempotent).
            markSegmentReady(generation, segment.id);
            if (cancelled) {
              if (isBlobUrl(url)) {
                wfBlobLog('revoke-cancelled', segment.id, url);
                URL.revokeObjectURL(url);
              }
              return;
            }
            const prev = urlRef.current;
            const prevWasCacheOwned = urlIsCacheOwnedRef.current;
            urlRef.current = url;
            urlIsCacheOwnedRef.current = false; // freshly drawn — this component's own URL
            setImgUrl(url);
            // Revoke the previous image only after swapping in the new one —
            // unless the cache still owns it (only its own eviction may revoke).
            if (!prevWasCacheOwned && isBlobUrl(prev)) {
              wfBlobLog('revoke-swap', segment.id, prev);
              URL.revokeObjectURL(prev);
            }
            // Write-through so the NEXT mount of this exact segment window
            // (same-session switch-back, or a future restart's Tier-2 lookup
            // below) hits the cache instead of redrawing.
            if (blob && assetId !== undefined && blobSize !== undefined && projectId !== undefined) {
              void putImage(projectId, assetId, blobSize, segment.id, segment.startTime, segment.duration, blob)
                .catch(() => { /* best-effort — image stays displayed, just uncached for next time */ });
            }
          })
          .catch(() => {
            /* draw failed → leave the hairline/empty state in place */
            markSegmentFailed(generation, segment.id);
          });
      });
    };

    // Tier-1 synchronous cache check (Phase B) — BEFORE touching the draw
    // queue at all. A hit skips drawing/encoding entirely: first paint
    // already shows the correct image. Covers same-session remounts (a
    // project switch back to an asset already seen this session).
    if (assetId !== undefined && blobSize !== undefined) {
      const cachedUrl = peekImage(assetId, blobSize, segment.id, segment.startTime, segment.duration);
      if (cachedUrl) {
        applyCachedUrl(cachedUrl);
        return;
      }
    }

    // Tier-2 lookup (Phase C, revised) — a single-key IndexedDB get for just
    // THIS segment, not a bulk cursor scan of the whole asset. An earlier
    // version bulk-warmed every segment's image upfront, awaited in App.tsx
    // before the waveform source even committed — a real-device trace showed
    // that one serialized 294-step cursor walk took the same ~5 seconds the
    // redraw-from-scratch path did, just moving the delay behind a blocked
    // overlay instead of removing it. Each segment now resolves its own fast
    // single-key lookup independently and concurrently with its siblings, so
    // no one component blocks or is blocked by the rest of the batch.
    if (assetId !== undefined && blobSize !== undefined && projectId !== undefined) {
      getPersistedImage(projectId, assetId, segment.id, blobSize, segment.startTime, segment.duration)
        .then((cachedUrl) => {
          if (cancelled) return;
          if (cachedUrl) {
            applyCachedUrl(cachedUrl);
            return;
          }
          drawFresh();
        });
      // The Tier-2 lookup itself needs no cancellation — it doesn't mutate
      // component state until the `cancelled` check inside its `.then`, and
      // drawFresh() (which does enqueue a cancellable task) only ever runs
      // after that check.
    } else {
      drawFresh();
    }

    // Redraw-relevant deps ONLY (plan §6.3) — unchanged from Step 2. Do not add
    // currentTime, pixelsPerSecond/sliderT, or any scroll state.
    return () => {
      cancelled = true;
      handle?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, segment.id, segment.startTime, segment.duration, assetId, blobSize, projectId]);

  // Revoke the last displayed blob URL on unmount — unless the cache still
  // owns it (Phase B: only waveformImageCache.ts's own eviction may revoke
  // a Tier-1-owned URL).
  useEffect(
    () => () => {
      if (!urlIsCacheOwnedRef.current && isBlobUrl(urlRef.current)) {
        wfBlobLog('revoke-unmount', segment.id, urlRef.current);
        URL.revokeObjectURL(urlRef.current);
      }
    },
    [],
  );

  // Until this segment's turn in the draw queue comes up, render nothing — the
  // lane background shows through (the §5.5 empty state). No placeholder UI.
  if (!imgUrl) return null;

  return (
    <img
      src={imgUrl}
      alt=""
      draggable={false}
      style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
    />
  );
}

/**
 * React.memo comparator (§6.4): re-render ONLY when a redraw-relevant input
 * changes. `source` must be a stable object reference or every waveform
 * re-renders every parent render — a load-bearing invariant.
 */
export const SegmentWaveform = memo(
  SegmentWaveformImpl,
  (prev, next) =>
    prev.source === next.source &&
    prev.segment.id === next.segment.id &&
    prev.segment.startTime === next.segment.startTime &&
    prev.segment.duration === next.segment.duration &&
    prev.assetId === next.assetId &&
    prev.blobSize === next.blobSize &&
    prev.projectId === next.projectId,
);

export default SegmentWaveform;
