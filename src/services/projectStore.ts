import type { Asset, Project } from '../types';

export const STORAGE_KEY = 'kinetix:project:v1';

interface StoredAsset extends Omit<Asset, 'url' | 'file'> {
  url: '';
}

interface StoredProject {
  version: 1;
  savedAt: number;
  project: Omit<Project, 'assets'> & { assets: StoredAsset[] };
}

function stripAsset(asset: Asset): StoredAsset {
  const { url: _url, file: _file, ...rest } = asset;
  return { ...rest, url: '' };
}

export function saveProject(project: Project): void {
  const stored: StoredProject = {
    version: 1,
    savedAt: Date.now(),
    project: {
      ...project,
      assets: project.assets.map(stripAsset),
    },
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // quota exceeded or private browsing — silently skip
  }
}

export function loadProject(): { project: Project; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredProject;
    if (stored.version !== 1 || !stored.project) return null;
    return {
      project: stored.project as unknown as Project,
      savedAt: stored.savedAt,
    };
  } catch {
    return null;
  }
}

export function clearProject(): void {
  localStorage.removeItem(STORAGE_KEY);
}
