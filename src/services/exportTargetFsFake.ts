/**
 * Prompt-37 drop-in fake for `ExportTargetFs`.
 *
 * CC replaces `invoke` with the real Tauri commands of the same three
 * names. This module never imports `@tauri-apps` and never talks to Rust.
 * Contract tests in `exportTargetFsFake.contract.test.ts` run against this
 * fake so they stay green in cloud.
 *
 * Command names (must stay byte-identical to `createInvokeExportTargetFs`):
 *   export_pick_output_directory
 *   export_volume_free_space
 *   export_validate_output_path
 */

import {
  createInvokeExportTargetFs,
  validateExportOutputPath,
  type ExportTargetFs,
  type OutputPathValidation,
  type VolumeFreeSpaceReading,
} from './exportTargetFs';

export const EXPORT_PICK_OUTPUT_DIRECTORY = 'export_pick_output_directory';
export const EXPORT_VOLUME_FREE_SPACE = 'export_volume_free_space';
export const EXPORT_VALIDATE_OUTPUT_PATH = 'export_validate_output_path';

export const FAKE_MISSING_PARENT_REASON = 'The save folder does not exist.';
export const FAKE_NOT_WRITABLE_REASON = 'The save folder is not writable.';

export interface FakeDirectory {
  path: string;
  exists: boolean;
  writable: boolean;
  volumeKey: string;
  availableBytes: number;
}

export interface ExportTargetFsFake {
  fs: ExportTargetFs;
  /**
   * Same three-command `invoke` `createInvokeExportTargetFs` already binds.
   * Prompt 37: CC substitutes the real `invoke` and leaves the adapter.
   */
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  /** Adapter wrapping this fake's `invoke` — what App.tsx will hold after rebase. */
  adapted: ExportTargetFs;
  /** Next picker result. `null` = the user cancelled the dialog. */
  queuePick(result: string | null): void;
}

function stripTrailingSep(path: string): string {
  return path.replace(/[/\\]+$/, '');
}

function isUnder(parent: string, path: string): boolean {
  const p = stripTrailingSep(parent);
  return path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}\\`);
}

function findExact(dirs: readonly FakeDirectory[], directory: string): FakeDirectory | undefined {
  const want = stripTrailingSep(directory);
  return dirs.find((d) => stripTrailingSep(d.path) === want);
}

function findVolume(dirs: readonly FakeDirectory[], targetPath: string): FakeDirectory | undefined {
  const n = stripTrailingSep(targetPath);
  const hits = dirs.filter((d) => isUnder(d.path, n));
  hits.sort((a, b) => stripTrailingSep(b.path).length - stripTrailingSep(a.path).length);
  return hits[0];
}

export function createExportTargetFsFake(
  directories: readonly FakeDirectory[] = [],
): ExportTargetFsFake {
  const picks: Array<string | null> = [];
  const fs: ExportTargetFs = {
    async pickOutputDirectory(_currentDirectory: string | null): Promise<string | null> {
      if (picks.length === 0) return null;
      return picks.shift() ?? null;
    },
    async queryVolumeFreeSpace(targetPath: string): Promise<VolumeFreeSpaceReading | null> {
      const hit = findVolume(directories, targetPath);
      if (!hit || !hit.exists) return null;
      return {
        path: targetPath,
        probedPath: stripTrailingSep(hit.path),
        volumeKey: hit.volumeKey,
        availableBytes: hit.availableBytes,
      };
    },
    async validateOutputPath(directory: string, fileName: string): Promise<OutputPathValidation> {
      const pure = validateExportOutputPath(directory, fileName);
      if (!pure.ok) return pure;
      const dir = findExact(directories, directory);
      if (!dir || !dir.exists) return { ok: false, reason: FAKE_MISSING_PARENT_REASON };
      if (!dir.writable) return { ok: false, reason: FAKE_NOT_WRITABLE_REASON };
      return pure;
    },
  };

  const invoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    if (cmd === EXPORT_PICK_OUTPUT_DIRECTORY) {
      return fs.pickOutputDirectory((args?.currentDirectory as string | null | undefined) ?? null) as Promise<T>;
    }
    if (cmd === EXPORT_VOLUME_FREE_SPACE) {
      return fs.queryVolumeFreeSpace(String(args?.targetPath ?? '')) as Promise<T>;
    }
    if (cmd === EXPORT_VALIDATE_OUTPUT_PATH) {
      return fs.validateOutputPath(String(args?.directory ?? ''), String(args?.fileName ?? '')) as Promise<T>;
    }
    throw new Error(`ExportTargetFs fake: unknown command ${cmd}`);
  };

  return {
    fs,
    invoke,
    adapted: createInvokeExportTargetFs(invoke),
    queuePick(result: string | null): void {
      picks.push(result);
    },
  };
}
