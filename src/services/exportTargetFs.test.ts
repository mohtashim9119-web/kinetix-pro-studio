import { describe, it, expect } from 'vitest';
import {
  parentDirOf,
  joinExportOutputPath,
  defaultExportFileName,
  sanitizeExportFileName,
  validateExportOutputPath,
  createFakeExportTargetFs,
  createInvokeExportTargetFs,
} from './exportTargetFs';

describe('path helpers (pure — no Tauri)', () => {
  it('parentDirOf handles POSIX and Windows separators', () => {
    expect(parentDirOf('/Users/name/video.mp4')).toBe('/Users/name');
    expect(parentDirOf('C:\\Users\\name\\video.mp4')).toBe('C:\\Users\\name');
    expect(parentDirOf('video.mp4')).toBeNull();
  });

  it('joinExportOutputPath picks the separator from the directory', () => {
    expect(joinExportOutputPath('/Users/name/Movies', 'out.mp4')).toBe('/Users/name/Movies/out.mp4');
    expect(joinExportOutputPath('/Users/name/Movies/', 'out.mp4')).toBe('/Users/name/Movies/out.mp4');
    expect(joinExportOutputPath('C:\\Videos', 'out.mp4')).toBe('C:\\Videos\\out.mp4');
  });

  it('defaultExportFileName matches useExport\'s ts-stamped pattern', () => {
    const now = new Date('2026-09-13T11:52:00.000Z');
    expect(defaultExportFileName('My Project', now)).toBe('My_Project_2026-09-13-11-52-00.mp4');
  });

  it('sanitizeExportFileName strips separators and ensures .mp4', () => {
    expect(sanitizeExportFileName('clip')).toBe('clip.mp4');
    expect(sanitizeExportFileName('clip.mp4')).toBe('clip.mp4');
    expect(sanitizeExportFileName('a/b\\c')).toBe('abc.mp4');
    expect(sanitizeExportFileName('   ')).toBe('');
  });

  it('validateExportOutputPath refuses an empty folder or name', () => {
    expect(validateExportOutputPath('', 'out.mp4')).toEqual({
      ok: false,
      reason: 'Choose a folder for the exported file.',
    });
    expect(validateExportOutputPath('/Users/name/Movies', '   ')).toEqual({
      ok: false,
      reason: 'Enter a file name.',
    });
    expect(validateExportOutputPath('/Users/name/Movies', 'out')).toEqual({
      ok: true,
      fullPath: '/Users/name/Movies/out.mp4',
    });
  });
});

describe('createFakeExportTargetFs', () => {
  it('returns a programmed directory, free-space reading, and pure validation', async () => {
    const fs = createFakeExportTargetFs({
      pickedDirectory: '/Volumes/Media',
      freeSpace: {
        path: '/Volumes/Media',
        probedPath: '/Volumes/Media',
        volumeKey: 'dev:1',
        availableBytes: 42,
      },
    });
    expect(await fs.pickOutputDirectory(null)).toBe('/Volumes/Media');
    const space = await fs.queryVolumeFreeSpace('/Volumes/Media/out.mp4');
    expect(space?.availableBytes).toBe(42);
    expect(space?.volumeKey).toBe('dev:1');
    const v = await fs.validateOutputPath('/Volumes/Media', 'final');
    expect(v).toEqual({ ok: true, fullPath: '/Volumes/Media/final.mp4' });
  });

  it('a cancelled picker and an unavailable free-space reading are both representable', async () => {
    const fs = createFakeExportTargetFs({ pickedDirectory: null, freeSpace: null });
    expect(await fs.pickOutputDirectory('/Users/name/Movies')).toBeNull();
    expect(await fs.queryVolumeFreeSpace('/Users/name/Movies')).toBeNull();
  });
});

describe('createInvokeExportTargetFs — binds the three named commands, never a fourth', () => {
  it('pickOutputDirectory / queryVolumeFreeSpace / validateOutputPath map 1:1 onto invoke', async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ cmd, args });
      if (cmd === 'export_pick_output_directory') return '/picked' as T;
      if (cmd === 'export_volume_free_space') {
        return { path: 'p', probedPath: 'p', volumeKey: 'k', availableBytes: 1 } as T;
      }
      return { ok: true, fullPath: '/picked/out.mp4' } as T;
    };
    const fs = createInvokeExportTargetFs(invoke);
    expect(await fs.pickOutputDirectory('/cur')).toBe('/picked');
    await fs.queryVolumeFreeSpace('/cur/out.mp4');
    await fs.validateOutputPath('/cur', 'out.mp4');
    expect(calls.map((c) => c.cmd)).toEqual([
      'export_pick_output_directory',
      'export_volume_free_space',
      'export_validate_output_path',
    ]);
  });
});
