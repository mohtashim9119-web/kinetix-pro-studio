import { useEffect, useRef } from 'react';
import type { Project } from '../types';
import { saveProject } from '../services/projectStore';

export function usePersistProject(project: Project, enabled = true): void {
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      saveProject(project);
    }, 500);
    return () => clearTimeout(timer);
  }, [project, enabled]);
}
