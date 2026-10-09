/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bulk Export — export defaults per workspace: resolution, fps and the folder
// every export lands in. Keyed by workspace id; `all` holds the defaults for
// projects that belong to no workspace. Written synchronously on every change
// (crash-safe). The export queue reads it per project (see
// `exportSettingsForProject`).

import { useSyncExternalStore } from 'react';
import type { ExportFps } from '../hooks/useExport';
import type { ResolutionTier } from '../types';
import { DEFAULT_RESOLUTION_TIER } from '../services/resolutionConfig';
import { workspaceRegistry, type WorkspaceFilter, type WorkspaceRegistry } from './workspaceRegistry';

export const WORKSPACE_EXPORT_SETTINGS_KEY = 'kinetix:workspace-export-settings:v1';

export interface WorkspaceExportSettings {
  resolution: ResolutionTier;
  fps: ExportFps;
  /** Absolute folder path, or null until the operator picks one. */
  folder: string | null;
}

export const RESOLUTION_OPTIONS: readonly ResolutionTier[] = ['720p', '1080p'];
/** 60 fps is hidden from bulk export (operator ruling); a stored 60 reads as the default. */
export const FPS_OPTIONS: readonly ExportFps[] = [24, 30];
export const DEFAULT_EXPORT_SETTINGS: WorkspaceExportSettings = { resolution: DEFAULT_RESOLUTION_TIER, fps: 30, folder: null };

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStorage = (): Store | undefined => (typeof localStorage !== 'undefined' ? localStorage : undefined);

function sanitize(raw: unknown): WorkspaceExportSettings {
  const r = (raw ?? {}) as Partial<WorkspaceExportSettings>;
  return {
    resolution: RESOLUTION_OPTIONS.includes(r.resolution as ResolutionTier) ? r.resolution as ResolutionTier : DEFAULT_EXPORT_SETTINGS.resolution,
    fps: FPS_OPTIONS.includes(r.fps as ExportFps) ? r.fps as ExportFps : DEFAULT_EXPORT_SETTINGS.fps,
    folder: typeof r.folder === 'string' && r.folder.trim() ? r.folder : null,
  };
}

export class WorkspaceExportSettingsStore {
  private map: Record<string, WorkspaceExportSettings> = {};
  private version = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Store | undefined = defaultStorage()) {
    try {
      const raw = storage?.getItem(WORKSPACE_EXPORT_SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      for (const [k, v] of Object.entries(parsed ?? {})) this.map[k] = sanitize(v);
    } catch { this.map = {}; }
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }

  getVersion(): number { return this.version; }

  /** Stored settings for this scope, or the defaults. */
  get(scope: WorkspaceFilter): WorkspaceExportSettings {
    return this.map[scope] ?? DEFAULT_EXPORT_SETTINGS;
  }

  set(scope: WorkspaceFilter, patch: Partial<WorkspaceExportSettings>): void {
    this.map[scope] = sanitize({ ...this.get(scope), ...patch });
    try { this.storage?.setItem(WORKSPACE_EXPORT_SETTINGS_KEY, JSON.stringify(this.map)); } catch { /* this session only */ }
    this.version += 1;
    for (const l of this.listeners) l();
  }
}

let shared: WorkspaceExportSettingsStore | null = null;
export function workspaceExportSettings(): WorkspaceExportSettingsStore {
  if (!shared) shared = new WorkspaceExportSettingsStore();
  return shared;
}

export function useWorkspaceExportSettings(
  scope: WorkspaceFilter,
  store: WorkspaceExportSettingsStore = workspaceExportSettings(),
): WorkspaceExportSettings {
  useSyncExternalStore(l => store.subscribe(l), () => store.getVersion());
  return store.get(scope);
}

/** The export settings that apply to one project: its workspace's, or — for a
 *  project in no workspace — the All tab's. */
export function exportSettingsForProject(
  projectId: string,
  registry: WorkspaceRegistry = workspaceRegistry(),
  store: WorkspaceExportSettingsStore = workspaceExportSettings(),
): WorkspaceExportSettings {
  return store.get(registry.workspaceOf(projectId)?.id ?? 'all');
}

/** "…/Exports/Statham" — the tail of a long path, which is the part that tells folders apart. */
export function shortFolder(path: string, max = 34): string {
  if (path.length <= max) return path;
  const parts = path.split(/[\\/]/).filter(Boolean);
  let out = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const next = `${parts[i]}${out ? `/${out}` : ''}`;
    if (next.length + 2 > max) break;
    out = next;
  }
  return `…/${out || parts[parts.length - 1]!.slice(-(max - 2))}`;
}
