import { describe, it, expect } from 'vitest';
import { nextBulkExportPath, settingsFromProject, BULK_EXPORT_NO_PATH } from './bulkExportSettings';
import type { Project } from '../types';

describe('bulk export settings seam', () => {
  it('writes the next file next to lastExportPath', () => {
    const p = nextBulkExportPath('/Users/me/out/old.mp4', 'My Project', new Date('2026-10-09T04:00:00Z'));
    expect(p).toBe('/Users/me/out/My_Project_2026-10-09-04-00-00.mp4');
  });

  it('uses resolutionTier and default 30 fps from the saved project', () => {
    const project = {
      id: 'p', name: 'P', lastExportPath: '/o/a.mp4', resolutionTier: '720p',
      script: '', sceneDetails: '', segments: [], assets: [],
    } as unknown as Project;
    const s = settingsFromProject(project, new Date('2026-10-09T04:00:00Z'));
    expect(s).toMatchObject({ resolution: '720p', fps: 30 });
  });

  it('blocks when no lastExportPath is saved', () => {
    const project = { id: 'p', name: 'P', script: '', sceneDetails: '', segments: [], assets: [] } as unknown as Project;
    expect(settingsFromProject(project)).toEqual({ blocked: BULK_EXPORT_NO_PATH });
  });
});
