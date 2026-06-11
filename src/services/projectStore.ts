import type { Asset, Project, ProjectMeta } from '../types';

/** Registry key — stores ProjectMeta[] (newest-first sorted on write). */
const REGISTRY_KEY = 'kinetix:projects:v1';

/** Per-project data key. */
function projectKey(id: string): string {
  return `kinetix:project:${id}:v1`;
}

/** Legacy single-project key — read-once for migration then removed. */
const LEGACY_KEY = 'kinetix:project:v1';

// ---------------------------------------------------------------------------
// Internal serialisation helpers
// ---------------------------------------------------------------------------

interface StoredAsset extends Omit<Asset, 'url' | 'file'> {
  url: '';
}

interface StoredProject {
  version: 2;
  savedAt: number;
  project: Omit<Project, 'assets'> & { assets: StoredAsset[] };
}

function stripAsset(asset: Asset): StoredAsset {
  const { url: _url, file: _file, ...rest } = asset;
  return { ...rest, url: '' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persists a project and upserts its entry in the registry.
 * Silent on quota / private-browsing errors.
 */
export function saveProject(project: Project): void {
  const savedAt = Date.now();
  const stored: StoredProject = {
    version: 2,
    savedAt,
    project: { ...project, assets: project.assets.map(stripAsset) },
  };
  try {
    localStorage.setItem(projectKey(project.id), JSON.stringify(stored));

    // Upsert registry entry
    const metas = loadAllMetas();
    const meta: ProjectMeta = {
      id: project.id,
      name: project.name,
      savedAt,
      segmentCount: project.segments.length,
    };
    const idx = metas.findIndex(m => m.id === project.id);
    if (idx >= 0) {
      metas[idx] = meta;
    } else {
      metas.push(meta);
    }
    // Sort newest first before writing
    metas.sort((a, b) => b.savedAt - a.savedAt);
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(metas));
  } catch {
    // quota exceeded or private browsing — silently skip
  }
}

/** Loads a single project by id. Returns null if not found or parse error. */
export function loadProject(id: string): { project: Project; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(projectKey(id));
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredProject;
    if (!stored.project) return null;
    return { project: stored.project as unknown as Project, savedAt: stored.savedAt };
  } catch {
    return null;
  }
}

/**
 * Returns all project metas from the registry, newest first.
 * Returns empty array on any error.
 */
export function loadAllMetas(): ProjectMeta[] {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProjectMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Returns the most-recently saved project meta, or null if registry is empty. */
export function loadMostRecentMeta(): ProjectMeta | null {
  const metas = loadAllMetas();
  return metas[0] ?? null; // already sorted newest-first
}

/** Removes a project's per-project key and its registry entry. */
export function deleteProjectData(id: string): void {
  localStorage.removeItem(projectKey(id));
  const metas = loadAllMetas().filter(m => m.id !== id);
  if (metas.length > 0) {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(metas));
  } else {
    localStorage.removeItem(REGISTRY_KEY);
  }
}

/**
 * Detects the legacy single-project key (`kinetix:project:v1`) and migrates it
 * to the new multi-project format.  Call once at app boot before reading the
 * registry.  Removes the legacy key on success.
 *
 * Returns the migrated `{ project, savedAt }` if migration was performed, or
 * null if no legacy data was present.
 */
export function migrateLegacyIfNeeded(): { project: Project; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;

    // Legacy format had version: 1 and a single project object
    const stored = JSON.parse(raw) as {
      version?: number;
      savedAt: number;
      project: Project;
    };
    if (!stored.project) {
      localStorage.removeItem(LEGACY_KEY);
      return null;
    }

    // Re-save under the new per-project key and update registry
    saveProject(stored.project);

    // Remove legacy key so migration only runs once
    localStorage.removeItem(LEGACY_KEY);
    return { project: stored.project, savedAt: stored.savedAt };
  } catch {
    // If the legacy data is corrupt, just discard it
    localStorage.removeItem(LEGACY_KEY);
    return null;
  }
}
