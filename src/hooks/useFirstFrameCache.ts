/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Asset, VideoSegment } from '../types';

/**
 * First-frame cache (Phase 1 — preview correctness layer).
 *
 * Whenever segments/assets change (sync, edit, add — playing or paused) this hook
 * decodes each VIDEO segment's frame at its trimStart once, off the main render path, into a
 * cached JPEG dataURL keyed by segment id. PreviewStage paints that cached frame
 * the instant the playhead enters a video segment whose live <video> slot has not
 * yet decoded/painted — so the preview always shows the CORRECT segment's real
 * frame (never a stale wrong frame, never a black hole while the slot warms).
 *
 * The cache is invalidated per-segment when its assetId / trimStart / trimEnd
 * changes (signature mismatch) and pruned when the segment is removed. Decoding
 * is fully async and throttled (CONCURRENCY at a time) so it never blocks the UI
 * thread or playback.
 *
 * Diagnostics are tagged //FFCACHE for easy grep + removal.
 */

interface CacheEntry {
  /** assetId|trimStart|trimEnd — invalidates the entry when the segment's source changes. */
  sig: string;
  /** JPEG dataURL of the decoded first frame. */
  url: string;
}

interface DecodeTarget {
  id: string;
  sig: string;
  url: string;
  time: number;
}

/** Cap the captured frame's largest dimension so cached dataURLs stay small. */
const MAX_CAPTURE_DIM = 1280;
/** How many offscreen decodes may run at once (throttle — avoids thrash). */
const CONCURRENCY = 2;
/** Hard ceiling per decode so a wedged element can never hang the queue. */
const DECODE_TIMEOUT_MS = 6000;

function segSignature(seg: VideoSegment): string {
  return `${seg.assetId ?? ''}|${seg.trimStart ?? 0}|${seg.trimEnd ?? ''}`;
}

export function useFirstFrameCache(
  segments: VideoSegment[],
  assets: Asset[],
  isPlaying: boolean,
): { getFirstFrame: (segmentId: string) => string | undefined } {
  // Actual bitmap data lives in a ref (cheap: one small JPEG per video segment).
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  // Bumped whenever an in-flight warm pass is superseded — invalidates its writes.
  const genRef = useRef(0);
  // State solely to force a PreviewStage re-render when a frame lands / is pruned,
  // so the cover layer can pick up the newly-available cached frame.
  const [, setVersion] = useState(0);

  const getFirstFrame = useCallback(
    (segmentId: string): string | undefined => cacheRef.current.get(segmentId)?.url,
    [],
  );

  useEffect(() => {
    // Warm at sync/idle time AND during playback. The bulk warm normally lands
    // right after sync (paused), but a segment that was added/edited mid-session
    // — or somehow missed — must still get warmed while playing so it never
    // black-screens on entry. Decoding is throttled (CONCURRENCY) and only ever
    // targets MISSING/stale entries, so at steady state there's nothing to do
    // and no decoder contention. `isPlaying` is intentionally NOT a gate here.

    // Collect the video segments that still need a fresh cached frame, and the
    // set of ids that are legitimately present so we can prune the rest.
    const targets: DecodeTarget[] = [];
    const validIds = new Set<string>();
    for (const seg of segments) {
      if (seg.isHeading || seg.heading) continue; // heading backgrounds handled separately
      const asset = assets.find(a => a.id === seg.assetId);
      if (!asset || asset.type !== 'video' || !asset.url) continue;
      validIds.add(seg.id);
      const sig = segSignature(seg);
      const existing = cacheRef.current.get(seg.id);
      if (existing && existing.sig === sig) continue; // already cached & fresh
      const raw = Math.max(0, seg.trimStart ?? 0);
      const time = seg.trimEnd !== undefined ? Math.min(raw, seg.trimEnd) : raw;
      targets.push({ id: seg.id, sig, url: asset.url, time });
    }

    // Prune entries whose segment vanished (removed, or asset/trim changed so its
    // id no longer resolves to a plain video segment).
    let pruned = false;
    for (const key of Array.from(cacheRef.current.keys())) {
      if (!validIds.has(key)) {
        cacheRef.current.delete(key);
        pruned = true;
      }
    }
    if (pruned) setVersion(v => v + 1);

    if (targets.length === 0) return;

    const myGen = ++genRef.current;
    let cancelled = false;
    //FFCACHE
    console.log(`//FFCACHE warm start: ${targets.length} segment(s) queued to decode`);

    const decodeOne = (t: DecodeTarget): Promise<void> =>
      new Promise<void>((resolve) => {
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'auto';
        video.playsInline = true;
        let settled = false;

        const cleanup = () => {
          clearTimeout(timeoutId);
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('loadeddata', onLoaded);
          video.removeEventListener('error', onError);
          video.removeAttribute('src');
          video.load();
        };

        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          cleanup();
          //FFCACHE
          console.log(`//FFCACHE decode ${ok ? 'success' : 'fail '}: seg ${t.id} @ ${t.time.toFixed(2)}s`);
          resolve();
        };

        const capture = () => {
          try {
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            if (!vw || !vh) {
              finish(false);
              return;
            }
            const scale = Math.min(1, MAX_CAPTURE_DIM / Math.max(vw, vh));
            const cw = Math.max(1, Math.round(vw * scale));
            const ch = Math.max(1, Math.round(vh * scale));
            const canvas = document.createElement('canvas');
            canvas.width = cw;
            canvas.height = ch;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              finish(false);
              return;
            }
            ctx.drawImage(video, 0, 0, cw, ch);
            const url = canvas.toDataURL('image/jpeg', 0.82);
            if (!cancelled && genRef.current === myGen) {
              cacheRef.current.set(t.id, { sig: t.sig, url });
              setVersion(v => v + 1);
            }
            finish(true);
          } catch (err) {
            //FFCACHE
            console.warn(`//FFCACHE capture threw: seg ${t.id}`, err);
            finish(false);
          }
        };

        const onSeeked = () => capture();
        const onError = () => finish(false);
        const onLoaded = () => {
          // Seek to the segment's start frame; if we're already there and have
          // pixel data, capture straight away (no 'seeked' will fire).
          try {
            if (Math.abs(video.currentTime - t.time) < 0.001 && video.readyState >= 2) {
              capture();
            } else {
              video.currentTime = t.time;
            }
          } catch {
            finish(false);
          }
        };

        const timeoutId = setTimeout(() => finish(false), DECODE_TIMEOUT_MS);
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('loadeddata', onLoaded);
        video.addEventListener('error', onError);
        video.src = t.url;
        video.load();
      });

    // Throttled queue — up to CONCURRENCY decodes in flight at once.
    let idx = 0;
    const worker = async (): Promise<void> => {
      while (!cancelled && genRef.current === myGen) {
        const t = targets[idx++];
        if (!t) break;
        await decodeOne(t);
      }
    };
    const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker());
    void Promise.all(workers).then(() => {
      if (!cancelled && genRef.current === myGen) {
        //FFCACHE
        console.log(`//FFCACHE warm complete: ${cacheRef.current.size} frame(s) cached`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [segments, assets, isPlaying]);

  return { getFirstFrame };
}
