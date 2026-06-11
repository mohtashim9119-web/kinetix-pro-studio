import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { saveProject } from '../services/projectStore';

export interface PersistHandle {
  /** Immediately writes the project to localStorage (bypasses the 500 ms debounce). */
  saveNow: () => void;
  /** Unix timestamp of the last successful save, or null if not yet saved this session. */
  lastSavedAt: number | null;
}

export function usePersistProject(project: Project, enabled = true): PersistHandle {
  const isFirstRender = useRef(true);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Keep a ref so saveNow always sees the latest project without deps churn.
  const projectRef = useRef(project);
  projectRef.current = project;

  const saveNow = useCallback(() => {
    if (!enabled) return;
    saveProject(projectRef.current);
    setLastSavedAt(Date.now());
  }, [enabled]);

  // Debounced auto-save: fires 500 ms after any project change.
  useEffect(() => {
    if (!enabled) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      saveProject(project);
      setLastSavedAt(Date.now());
    }, 500);
    return () => clearTimeout(timer);
  }, [project, enabled]);

  return { saveNow, lastSavedAt };
}
