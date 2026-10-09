/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Project, ResolutionTier } from '../types';
import { parentDir, type ExportFps } from '../hooks/useExport';
import { DEFAULT_RESOLUTION_TIER } from './resolutionConfig';

export const BULK_EXPORT_NO_PATH =
  "Blocked — no export path. Set a folder in this workspace's export settings, or open the project and export once.";

/** The workspace's export settings for one project (unassigned → the All tab's). */
export interface WorkspaceExportChoice {
  resolution: ResolutionTier;
  fps: ExportFps;
  folder: string | null;
}

export interface BulkExportSettings {
  resolution: ResolutionTier;
  fps: ExportFps;
  savedPath: string;
}

/** "My: Project?" → "My_ Project_" — a name every OS accepts as a file name. */
export function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 120);
  return cleaned || 'Untitled';
}

function joinPath(dir: string, file: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${file}`;
}

/** `<dir>/<name>.mp4`, or " (2)", " (3)" … until `taken` no longer holds the path. */
export function uniqueExportPath(dir: string, projectName: string, taken: (path: string) => boolean): string {
  const base = sanitizeFileName(projectName);
  let candidate = joinPath(dir, `${base}.mp4`);
  for (let n = 2; taken(candidate); n++) candidate = joinPath(dir, `${base} (${n}).mp4`);
  return candidate;
}

/**
 * Per field: the workspace's export settings → the project's own → defaults.
 * Folder: the workspace folder → the folder of the project's last export →
 * blocked. fps is the workspace's (24/30). `taken`: paths already claimed.
 */
export function resolveBulkExportSettings(
  project: Project,
  workspace: WorkspaceExportChoice | undefined,
  metaLastExportPath: string | undefined,
  taken: (path: string) => boolean = () => false,
): BulkExportSettings | { blocked: string } {
  const lastExport = metaLastExportPath ?? project.lastExportPath;
  const dir = workspace?.folder ?? (lastExport ? parentDir(lastExport) : null);
  if (!dir) return { blocked: BULK_EXPORT_NO_PATH };
  return {
    resolution: workspace?.resolution ?? project.resolutionTier ?? DEFAULT_RESOLUTION_TIER,
    fps: workspace?.fps ?? 30,
    savedPath: uniqueExportPath(dir, project.name, taken),
  };
}
