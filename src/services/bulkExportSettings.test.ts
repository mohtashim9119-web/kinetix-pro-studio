import { describe, it, expect } from 'vitest';
import { resolveBulkExportSettings, sanitizeFileName, uniqueExportPath, BULK_EXPORT_NO_PATH } from './bulkExportSettings';
import type { Project } from '../types';

const project = (extra: Record<string, unknown> = {}): Project => ({ id: 'p', name: 'My Project', ...extra }) as unknown as Project;

describe('sanitizeFileName', () => {
  it('replaces characters no OS accepts, keeps spaces, never empty', () => {
    expect(sanitizeFileName('My: Project?/v2')).toBe('My_ Project__v2');
    expect(sanitizeFileName('  ...  ')).toBe('Untitled');
  });
});

describe('uniqueExportPath', () => {
  it('<folder>/<name>.mp4, then " (2)", " (3)" on collision', async () => {
    const used = new Set<string>();
    const take = async (): Promise<string> => { const p = await uniqueExportPath('/out', 'Clip', x => used.has(x)); used.add(p); return p; };
    expect([await take(), await take(), await take()]).toEqual(['/out/Clip.mp4', '/out/Clip (2).mp4', '/out/Clip (3).mp4']);
  });
  it("keeps a Windows folder's separator", async () => {
    expect(await uniqueExportPath('C:\\Exports\\', 'Clip', () => false)).toBe('C:\\Exports\\Clip.mp4');
  });
});

describe('resolveBulkExportSettings', () => {
  it("workspace folder wins over the project's last export", async () => {
    const s = await resolveBulkExportSettings(project({ lastExportPath: '/old/x.mp4' }), { resolution: '720p', fps: 24, folder: '/ws' }, undefined);
    expect(s).toEqual({ resolution: '720p', fps: 24, savedPath: '/ws/My Project.mp4' });
  });
  it("falls back to the project's last export folder (meta first)", async () => {
    const s = await resolveBulkExportSettings(project({ lastExportPath: '/rec/x.mp4' }), { resolution: '1080p', fps: 30, folder: null }, '/meta/y.mp4');
    expect(s).toMatchObject({ savedPath: '/meta/My Project.mp4' });
  });
  it('no folder anywhere is Blocked with the new copy', async () => {
    expect(await resolveBulkExportSettings(project(), { resolution: '1080p', fps: 30, folder: null }, undefined)).toEqual({ blocked: BULK_EXPORT_NO_PATH });
    expect(BULK_EXPORT_NO_PATH).toBe("Blocked — no export path. Set a folder in this workspace's export settings, or open the project and export once.");
  });
  it('without workspace settings: project tier, then default; fps 30', async () => {
    expect(await resolveBulkExportSettings(project({ resolutionTier: '720p' }), undefined, '/m/a.mp4')).toMatchObject({ resolution: '720p', fps: 30 });
  });
});
