import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { saveProject, upsertProjectMeta, type SaveOutcome } from '../services/projectStore';

export interface PersistHandle {
  /** Immediately writes the project (bypasses the 500 ms debounce). */
  saveNow: () => void;
  /** Unix timestamp of the last successful save, or null if not yet saved this session. */
  lastSavedAt: number | null;
  /**
   * The most recent FAILED save outcome, or null if the last save (if any)
   * succeeded. Cleared the moment a save succeeds again. `lastSavedAt` is
   * intentionally NOT updated while this is set — a failed save must never
   * look like a successful one to the caller.
   */
  saveError: SaveOutcome & { ok: false } | null;
}

/**
 * Converts a blob URL to a small (320×180) JPEG base64 data URL via an
 * offscreen canvas.  Returns undefined if the URL is falsy or conversion fails.
 *
 * The canvas resize keeps thumbnails at ~15–25 KB so localStorage stays lean
 * even with many projects.  Uses letterbox (black bars) to preserve aspect ratio.
 */
export async function buildThumbnailBase64(url: string | undefined): Promise<string | undefined> {
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
  const [saveError, setSaveError] = useState<SaveOutcome & { ok: false } | null>(null);

  // Keep a ref so saveNow always sees the latest project without deps churn.
  const projectRef = useRef(project);
  projectRef.current = project;

  // Guards against an in-flight save's result landing after a LATER save has
  // already resolved (saveNow + the debounced effect can both fire close
  // together) — only the most recently STARTED attempt is allowed to write
  // lastSavedAt/saveError.
  const latestAttemptRef = useRef(0);

  const runSave = useCallback((proj: Project) => {
    const attempt = ++latestAttemptRef.current;
    const ts = Date.now();
    void saveProject(proj).then(outcome => {
      if (latestAttemptRef.current !== attempt) return; // superseded by a newer save
      if (!outcome.ok) {
        setSaveError(outcome);
        return;
      }
      setSaveError(null);
      void persistMeta(proj, ts).then(() => {
        if (latestAttemptRef.current === attempt) setLastSavedAt(ts);
      });
    });
  }, []);

  // saveNow is typed () => void so callers can fire-and-forget; the async
  // work happens inside without blocking the caller.
  const saveNow = useCallback(() => {
    if (!enabled) return;
    // Never persist a project the user hasn't explicitly named yet.
    if (!projectRef.current.confirmed) return;
    runSave(projectRef.current);
  }, [enabled, runSave]);

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
    const timer = setTimeout(() => runSave(project), 500);
    return () => clearTimeout(timer);
  }, [project, enabled, runSave]);

  return { saveNow, lastSavedAt, saveError };
}
