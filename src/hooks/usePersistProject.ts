import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { saveProject, upsertProjectMeta, type SaveOutcome } from '../services/projectStore';

export interface PersistHandle {
  /**
   * Immediately writes the project (bypasses the 500 ms debounce).
   *
   * AWAITABLE (WS2 T4.6). The returned promise settles when the project's own
   * bytes are written AND read back verified by `saveProject` — i.e. when the
   * durable part is durable. Existing fire-and-forget callers are unaffected;
   * they simply ignore the promise. A teardown path (reload, window close,
   * Cmd+Q) MUST await it, and must do so through
   * `services/teardownFlush.ts`'s `flushWithBudget` rather than bare — see the
   * two notes below for what this promise does and does not guarantee.
   *
   * IT DOES NOT COVER THE THUMBNAIL/REGISTRY-META PASS, deliberately.
   * `persistMeta` renders the first image asset through an `Image()` whose
   * `onload`/`onerror` may never fire for a blob URL that is already being torn
   * down — awaiting it would hand the teardown path an unbounded wait for a
   * purely cosmetic dashboard thumbnail. The registry row itself (id, name,
   * savedAt, segmentCount) is written inside `saveProject`, so what is skipped
   * on a teardown is the thumbnail refresh alone.
   *
   * IT RESOLVES, NEVER REJECTS, AND RESOLVING IS NOT SUCCESS. A refused or
   * failed write resolves the same as a successful one; the outcome is reported
   * through `saveError` as it always was. Callers that care must read that, not
   * the promise.
   */
  saveNow: () => Promise<void>;
  /**
   * WS2 T4.7 — `saveNow` for an EXPLICITLY SUPPLIED project snapshot, instead
   * of whatever the last render committed.
   *
   * WHY IT HAD TO EXIST. `saveNow` reads `projectRef.current`, which this hook
   * advances during render. A caller that has just called `setProject(...)` and
   * wants that exact write on disk NOW is one render behind: React has not
   * re-rendered yet, so `saveNow` would faithfully persist the state from
   * BEFORE the update and report success. For an autosave a render's lag is
   * invisible; for a durability flush whose entire purpose is to close the
   * window between "the result exists" and "the result is on disk", persisting
   * the pre-update project is not a smaller window, it is the wrong bytes.
   *
   * Callers pass `App.tsx`'s `liveProjectRef.current` — the synchronous mirror
   * `setProject` advances inside the wrapper itself (see its own note there) —
   * so the snapshot handed here is the one the update just produced.
   *
   * Same contract as `saveNow` otherwise: honours the `enabled` flag and the
   * `confirmed` gate, resolves rather than rejects, and resolving is not
   * success (read `saveError`).
   */
  saveSnapshot: (project: Project) => Promise<void>;
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

  // Returns a promise that settles once the PROJECT bytes are written and
  // verified. The trailing `persistMeta` pass is intentionally left off that
  // promise (see `PersistHandle.saveNow`'s note) — it is fire-and-forget here
  // exactly as it was before, so the debounced autosave's behaviour is
  // unchanged and only the teardown path gains something to await.
  const runSave = useCallback(async (proj: Project): Promise<void> => {
    const attempt = ++latestAttemptRef.current;
    const ts = Date.now();
    const outcome = await saveProject(proj);
    if (latestAttemptRef.current !== attempt) return; // superseded by a newer save
    if (!outcome.ok) {
      setSaveError(outcome);
      return;
    }
    setSaveError(null);
    void persistMeta(proj, ts).then(() => {
      if (latestAttemptRef.current === attempt) setLastSavedAt(ts);
    });
  }, []);

  // Awaitable since WS2 T4.6. Fire-and-forget callers are unchanged — they just
  // drop the promise — but a teardown path now has something to wait on.
  //
  // The two early returns resolve immediately, which is correct in both cases:
  // persistence is disabled (mid-hydration), or the project has never been
  // named and must not enter the registry. Neither is a state a teardown should
  // stall for, and neither is a state where anything is pending.
  const saveNow = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    // Never persist a project the user hasn't explicitly named yet.
    if (!projectRef.current.confirmed) return;
    await runSave(projectRef.current);
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
    // `void`: the debounced autosave is fire-and-forget, exactly as before
    // `runSave` gained a return value. Only the teardown path awaits.
    const timer = setTimeout(() => { void runSave(project); }, 500);
    return () => clearTimeout(timer);
  }, [project, enabled, runSave]);

  const saveSnapshot = useCallback(async (snapshot: Project): Promise<void> => {
    if (!enabled) return;
    if (!snapshot.confirmed) return;
    await runSave(snapshot);
  }, [enabled, runSave]);

  return { saveNow, saveSnapshot, lastSavedAt, saveError };
}
