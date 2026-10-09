/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Project } from '../types';
import { parentDir, type ExportFps, type ExportResolution } from '../hooks/useExport';
import { DEFAULT_RESOLUTION_TIER } from './resolutionConfig';

export const BULK_EXPORT_NO_PATH = 'Blocked — no saved export path';

export interface BulkExportSettings {
  resolution: ExportResolution;
  fps: ExportFps;
  savedPath: string;
}

/** Per-project settings the manual export already persists: last output
 *  path, native resolution tier, session default fps (30). No new fields. */
export function settingsFromProject(project: Project, now: Date = new Date()): BulkExportSettings | { blocked: string } {
  const savedPath = nextBulkExportPath(project.lastExportPath, project.name, now);
  if (!savedPath) return { blocked: BULK_EXPORT_NO_PATH };
  return {
    resolution: project.resolutionTier ?? DEFAULT_RESOLUTION_TIER,
    fps: 30,
    savedPath,
  };
}

export function nextBulkExportPath(
  lastExportPath: string | undefined,
  projectName: string,
  now: Date = new Date(),
): string | null {
  if (!lastExportPath) return null;
  const dir = parentDir(lastExportPath);
  if (!dir) return null;
  const ts = now.toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const file = `${projectName.replace(/\s+/g, '_')}_${ts}.mp4`;
  const sep = lastExportPath.lastIndexOf('\\') > lastExportPath.lastIndexOf('/') ? '\\' : '/';
  return `${dir}${sep}${file}`;
}
