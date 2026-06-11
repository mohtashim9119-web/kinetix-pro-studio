import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { saveProject, upsertProjectMeta } from '../services/projectStore';

export interface PersistHandle {
  /** Immediately writes the project to localStorage (bypasses the 500 ms debounce). */
  saveNow: () => void;
  /** Unix timestamp of the last successful save, or null if not yet saved this session. */
  lastSavedAt: number | null;
}

/**
 * Converts a blob URL to a small (320×180) JPEG base64 data URL via an
 * offscreen canvas.  Returns undefined if the URL is falsy or conversion fails.
 *
 * The canvas resize keeps thumbnails at ~15–25 KB so localStorage stays lean
 * even with many projects.  Uses letterbox (black bars) to preserve aspect ratio.
 */
async function buildThumbnailBase64(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    return await new Promise<string | undefined>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(undefined); return; }
        // Letterbox: fill black then draw scaled image centered.
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 320, 180);
        const scale = Math.min(320 / img.width, 180 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (320 - w) / 2;
        const y = (180 - h) / 2;
        ctx.drawImage(img, x, y, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => resolve(undefined);
      img.src = url;
    });
  } catch {
    return undefined;
  }
}

/**
 * Builds and persists the registry meta entry for `project`.
 * Async because it converts the first image asset's blob URL to a base64
 * data URL that survives app restarts (blob URLs are ephemeral).
 */
async function persistMeta(project: Project, savedAt: number): Promise<void> {
  const firstImageAsset = project.assets.find(a => a.type === 'image');
  const thumbnailUrl = await buildThumbnailBase64(firstImageAsset?.url);
  upsertProjectMeta({
    id: project.id,
    name: project.name,
    savedAt,
    segmentCount: project.segments.length,
    thumbnailUrl,
    thumbnailAssetId: firstImageAsset?.id ?? undefined,
  });
}

export function usePersistProject(project: Project, enabled = true): PersistHandle {
  const isFirstRender = useRef(true);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Keep a ref so saveNow always sees the latest project without deps churn.
  const projectRef = useRef(project);
  projectRef.current = project;

  // saveNow is typed () => void so callers can fire-and-forget; the async
  // work happens inside without blocking the caller.
  const saveNow = useCallback(() => {
    if (!enabled) return;
    // Never persist a project the user hasn't explicitly named yet.
    if (!projectRef.current.confirmed) return;
    const ts = Date.now();
    saveProject(projectRef.current);
    void persistMeta(projectRef.current, ts).then(() => setLastSavedAt(ts));
  }, [enabled]);

  // Debounced auto-save: fires 500 ms after any project change.
  useEffect(() => {
    if (!enabled) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Never auto-save a project the user hasn't explicitly named yet —
    // prevents blank "Untitled Project" entries appearing in the registry.
    if (!project.confirmed) return;
    const timer = setTimeout(() => {
      const ts = Date.now();
      saveProject(project);
      void persistMeta(project, ts).then(() => setLastSavedAt(ts));
    }, 500);
    return () => clearTimeout(timer);
  }, [project, enabled]);

  return { saveNow, lastSavedAt };
}
