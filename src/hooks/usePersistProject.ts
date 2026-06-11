import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { saveProject, upsertProjectMeta } from '../services/projectStore';

export interface PersistHandle {
  /** Immediately writes the project to localStorage (bypasses the 500 ms debounce). */
  saveNow: () => void;
  /** Unix timestamp of the last successful save, or null if not yet saved this session. */
  lastSavedAt: number | null;
}

/** Builds the meta record for the registry, including a live thumbnail blob URL.
 *  Only considers IMAGE assets for the thumbnail — audio/zip blobs cannot be
 *  rendered as <img> and must be skipped. */
function buildMeta(project: Project, savedAt: number) {
  const firstImageAsset = project.assets.find(a => a.type === 'image');
  return {
    id: project.id,
    name: project.name,
    savedAt,
    segmentCount: project.segments.length,
    thumbnailUrl: firstImageAsset?.url ?? undefined,
    thumbnailAssetId: firstImageAsset?.id ?? undefined,
  };
}

export function usePersistProject(project: Project, enabled = true): PersistHandle {
  const isFirstRender = useRef(true);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Keep a ref so saveNow always sees the latest project without deps churn.
  const projectRef = useRef(project);
  projectRef.current = project;

  const saveNow = useCallback(() => {
    if (!enabled) return;
    // Never persist a project the user hasn't explicitly named yet.
    if (!projectRef.current.confirmed) return;
    const ts = Date.now();
    saveProject(projectRef.current);
    upsertProjectMeta(buildMeta(projectRef.current, ts));
    setLastSavedAt(ts);
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
      upsertProjectMeta(buildMeta(project, ts));
      setLastSavedAt(ts);
    }, 500);
    return () => clearTimeout(timer);
  }, [project, enabled]);

  return { saveNow, lastSavedAt };
}
