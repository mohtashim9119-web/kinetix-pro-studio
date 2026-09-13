/**
 * Prompt-37 contract: the three native commands, against the fake.
 * No Rust, no Tauri — `createExportTargetFsFake` is the filesystem.
 */
import { describe, it, expect } from 'vitest';
import { WINDOWS_MAX_PATH } from './exportDestinationPath';
import { joinExportOutputPath } from './exportTargetFs';
import {
  createExportTargetFsFake,
  EXPORT_PICK_OUTPUT_DIRECTORY,
  EXPORT_VALIDATE_OUTPUT_PATH,
  EXPORT_VOLUME_FREE_SPACE,
  FAKE_MISSING_PARENT_REASON,
  FAKE_NOT_WRITABLE_REASON,
  type FakeDirectory,
} from './exportTargetFsFake';

const WRITABLE: FakeDirectory = {
  path: 'C:\\Users\\name\\Videos',
  exists: true,
  writable: true,
  volumeKey: 'prefix:C:',
  availableBytes: 50 * 1024 ** 3,
};
const LOCKED: FakeDirectory = {
  path: 'C:\\Users\\name\\Locked',
  exists: true,
  writable: false,
  volumeKey: 'prefix:C:',
  availableBytes: 50 * 1024 ** 3,
};
const POSIX: FakeDirectory = {
  path: '/Users/name/Movies',
  exists: true,
  writable: true,
  volumeKey: 'dev:1',
  availableBytes: 12 * 1024 ** 3,
};

/** Nested `C:\s\s\...` directory such that `directory\\fileName` is exactly `destLen` chars. */
function deepWindowsDir(fileName: string, destLen: number): string {
  const targetDirLen = destLen - 1 - fileName.length;
  const parts = ['C:'];
  let len = 2;
  while (len + 2 <= targetDirLen) {
    parts.push('s');
    len += 2;
  }
  if (len < targetDirLen) {
    const last = parts.length - 1;
    parts[last] = (parts[last] ?? '') + 's'.repeat(targetDirLen - len);
  }
  return `${parts[0]}${parts.slice(1).map((p) => `\\${p}`).join('')}`;
}

describe('export_pick_output_directory', () => {
  it('returns the chosen directory', async () => {
    const fake = createExportTargetFsFake([POSIX]);
    fake.queuePick('/Users/name/Movies');
    expect(await fake.adapted.pickOutputDirectory(null)).toBe('/Users/name/Movies');
  });

  it('returns null when the user cancels', async () => {
    const fake = createExportTargetFsFake([POSIX]);
    fake.queuePick(null);
    fake.queuePick(null);
    expect(await fake.adapted.pickOutputDirectory('/Users/name/Movies')).toBeNull();
    expect(await fake.invoke<string | null>(EXPORT_PICK_OUTPUT_DIRECTORY, {
      currentDirectory: '/Users/name/Movies',
    })).toBeNull();
  });
});

describe('export_volume_free_space', () => {
  it('returns the volume reading for the dest path', async () => {
    const fake = createExportTargetFsFake([WRITABLE, POSIX]);
    const viaAdapter = await fake.adapted.queryVolumeFreeSpace('C:\\Users\\name\\Videos\\out.mp4');
    expect(viaAdapter).toEqual({
      path: 'C:\\Users\\name\\Videos\\out.mp4',
      probedPath: 'C:\\Users\\name\\Videos',
      volumeKey: 'prefix:C:',
      availableBytes: 50 * 1024 ** 3,
    });
    const viaInvoke = await fake.invoke<typeof viaAdapter>(EXPORT_VOLUME_FREE_SPACE, {
      targetPath: 'C:\\Users\\name\\Videos\\out.mp4',
    });
    expect(viaInvoke).toEqual(viaAdapter);
  });

  it('returns null for a path on no registered volume', async () => {
    const fake = createExportTargetFsFake([POSIX]);
    expect(await fake.adapted.queryVolumeFreeSpace('E:\\other\\out.mp4')).toBeNull();
  });
});

describe('export_validate_output_path', () => {
  it('refuses a non-writable target', async () => {
    const fake = createExportTargetFsFake([LOCKED]);
    const result = await fake.adapted.validateOutputPath(LOCKED.path, 'out.mp4');
    expect(result).toEqual({ ok: false, reason: FAKE_NOT_WRITABLE_REASON });
    const viaInvoke = await fake.invoke<typeof result>(EXPORT_VALIDATE_OUTPUT_PATH, {
      directory: LOCKED.path,
      fileName: 'out.mp4',
    });
    expect(viaInvoke).toEqual(result);
  });

  it('refuses a nonexistent parent', async () => {
    const fake = createExportTargetFsFake([WRITABLE]);
    const result = await fake.adapted.validateOutputPath('C:\\Users\\name\\Missing', 'out.mp4');
    expect(result).toEqual({ ok: false, reason: FAKE_MISSING_PARENT_REASON });
  });

  it('refuses a Windows path that is too long (including the .part delivery suffix)', async () => {
    const fileName = 'out.mp4';
    // dest length 255 → 255 + 5 (.part) = 260, which is not < WINDOWS_MAX_PATH.
    const directory = deepWindowsDir(fileName, 255);
    const destPath = joinExportOutputPath(directory, fileName);
    expect(destPath.length).toBe(255);
    expect(destPath.length + '.part'.length).toBe(WINDOWS_MAX_PATH);
    const fake = createExportTargetFsFake([{
      path: directory,
      exists: true,
      writable: true,
      volumeKey: 'prefix:C:',
      availableBytes: 50 * 1024 ** 3,
    }]);
    const result = await fake.adapted.validateOutputPath(directory, fileName);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected reject');
    expect(result.reason).toContain(String(WINDOWS_MAX_PATH));
    expect(result.reason).toContain('255');
  });

  it('accepts a deep nested Windows dest of 254 chars (just under the .part ceiling)', async () => {
    const fileName = 'out.mp4';
    const directory = deepWindowsDir(fileName, 254);
    const destPath = joinExportOutputPath(directory, fileName);
    expect(destPath.length).toBe(254);
    expect(destPath.length + '.part'.length).toBeLessThan(WINDOWS_MAX_PATH);
    expect(directory.split('\\').length).toBeGreaterThan(10);
    const fake = createExportTargetFsFake([{
      path: directory,
      exists: true,
      writable: true,
      volumeKey: 'prefix:C:',
      availableBytes: 50 * 1024 ** 3,
    }]);
    const result = await fake.adapted.validateOutputPath(directory, fileName);
    expect(result).toEqual({ ok: true, fullPath: destPath });
  });
});
