import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { saveProject, upsertProjectMeta } from '../services/projectStore';

export interface PersistHandle {
  /** Immediately writes the project to localStorage (bypasses the 500 ms debounce). */
  saveNow: () => void;
  /** Unix timestamp of the last successful save, or null if not yet saved this session. */
  lastSavedAt: number | null;
}

/** Builds the meta record for the registry, including a live thumbnail blob URL. */
function buildMeta(project: Project, savedAt: number) {
  return {
    id: project.id,
    name: project.name,
    savedAt,
    segmentCount: project.segments.length,
    thumbnailUrl: project.assets[0]?.url ?? undefined,
    thumbnailAssetId: project.assets[0]?.id ?? undefined,
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
