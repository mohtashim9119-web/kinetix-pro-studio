/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Native width/height of a spot's video or image, probed from its URL (DOM
 * metadata only — no decode pool). Used so the resolver can turn the corner
 * default into the SAME percent rect for preview and export. Resolves
 * undefined when the media can't be read (the resolver then assumes 16:9).
 */

import type { Asset } from '../../types';

export function probeClipAspect(asset: Pick<Asset, 'url' | 'type'>, timeoutMs = 8000): Promise<number | undefined> {
  if (!asset.url || (asset.type !== 'video' && asset.type !== 'image') || typeof document === 'undefined') {
    return Promise.resolve(undefined);
  }
  return new Promise(resolve => {
    let done = false;
    const finish = (v: number | undefined) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    const ok = (w: number, h: number) => {
      clearTimeout(timer);
      finish(w > 0 && h > 0 ? w / h : undefined);
    };
    if (asset.type === 'image') {
      const img = new Image();
      img.onload = () => ok(img.naturalWidth, img.naturalHeight);
      img.onerror = () => { clearTimeout(timer); finish(undefined); };
      img.src = asset.url;
    } else {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => { ok(v.videoWidth, v.videoHeight); v.removeAttribute('src'); v.load(); };
      v.onerror = () => { clearTimeout(timer); finish(undefined); };
      v.src = asset.url;
    }
  });
}
