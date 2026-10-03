/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { ProjectMeta } from '../types';
import {
  enqueueBackgroundThumbnail,
  objectUrlForThumbnail,
  releaseThumbnailObjectUrl,
} from '../services/projectThumbnail';

interface Props {
  meta: ProjectMeta;
}

export function ProjectCardThumb({ meta }: Props): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [src, setSrc] = useState<string | null>(meta.thumbnailUrl ?? null);
  const hash = meta.thumbnailHash;

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setVisible(e.isIntersecting);
      },
      { rootMargin: '120px', threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onReady = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId: string; hash: string }>).detail;
      if (!detail || detail.projectId !== meta.id) return;
      void objectUrlForThumbnail(meta.id, detail.hash).then((url) => {
        if (url) setSrc(url);
      });
    };
    window.addEventListener('kinetix-thumb-ready', onReady);
    return () => window.removeEventListener('kinetix-thumb-ready', onReady);
  }, [meta.id]);

  useEffect(() => {
    if (!visible) {
      if (hash) releaseThumbnailObjectUrl(meta.id, hash);
      return;
    }
    enqueueBackgroundThumbnail(meta);
    if (!hash) return;
    let cancelled = false;
    void objectUrlForThumbnail(meta.id, hash).then((url) => {
      if (!cancelled && url) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, meta, hash]);

  const showImg = Boolean(src);
  return (
    <div ref={hostRef} className="kxd-card-thumb-host">
      {showImg ? (
        <img src={src!} alt="" draggable={false} />
      ) : (
        <div className="kxd-art-empty" data-testid="kxd-art-empty">
          <ImageIcon size={26} strokeWidth={1.5} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
