/**
 * Narrow injected surface for every native dependency the export modal needs.
 *
 * The modal and the size estimator must compile, lint and test with zero
 * Tauri runtime. Component code never imports `@tauri-apps` — it receives
 * an `ExportTargetFs`. Tests inject `createFakeExportTargetFs`. After this
 * branch lands, CC implements the same three methods against Round 21's
 * `ffmpeg_volume_free_space` / a folder picker / path validation.
 *
 * Command names the Tauri adapter will bind (documented here so both lanes
 * agree; this file itself never calls them):
 *
 *   export_pick_output_directory  { currentDirectory: string | null }
 *                                 → string | null
 *   export_volume_free_space      { targetPath: string }
 *                                 → VolumeFreeSpaceReading | null
 *   export_validate_output_path   { directory: string, fileName: string }
 *                                 → OutputPathValidation
 */

import { checkExportDestinationPathLength, looksLikeWindowsPath } from './exportDestinationPath';

/** Mirrors native `VolumeFreeSpace` (`disk_space.rs` / `tauriFfmpeg.ts`). */
export interface VolumeFreeSpaceReading {
  path: string;
  probedPath: string;
  volumeKey: string;
  availableBytes: number;
}

export type OutputPathValidation =
  | { ok: true; fullPath: string }
  | { ok: false; reason: string };

export interface ExportTargetFs {
  /**
   * Native folder picker for the output location. Returns the chosen
   * directory, or `null` if the user cancelled / native UI is unavailable.
   */
  pickOutputDirectory(currentDirectory: string | null): Promise<string | null>;

  /**
   * Free space on the volume that holds `targetPath`. `null` when the
   * reading cannot be taken (no native runtime, unreadable path). A `null`
   * reading does not disable Export — only a successful reading whose
   * `availableBytes` is below the estimate's `destinationRequiredBytes` does.
   */
  queryVolumeFreeSpace(targetPath: string): Promise<VolumeFreeSpaceReading | null>;

  /**
   * Native path validation (directory exists, is writable, filename is
   * legal on this volume). Pure checks (empty name, separators, Windows
   * MAX_PATH) run in `validateExportOutputPath` without this method; the
   * native call is the extra writable/exists gate CC owns.
   */
  validateOutputPath(directory: string, fileName: string): Promise<OutputPathValidation>;
}

export function parentDirOf(path: string): string | null {
  const sep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return sep >= 0 ? path.substring(0, sep) : null;
}

export function joinExportOutputPath(directory: string, fileName: string): string {
  const trimmed = directory.replace(/[/\\]+$/, '');
  if (!trimmed) return fileName;
  const sep = looksLikeWindowsPath(trimmed) || (trimmed.includes('\\') && !trimmed.includes('/'))
    ? '\\'
    : '/';
  return `${trimmed}${sep}${fileName}`;
}

export function defaultExportFileName(projectName: string, now: Date = new Date()): string {
  const ts = now.toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const stem = (projectName.trim() || 'export').replace(/\s+/g, '_');
  return `${stem}_${ts}.mp4`;
}

export function sanitizeExportFileName(raw: string): string {
  const stripped = raw.replace(/[/\\]/g, '').trim();
  if (!stripped) return '';
  return stripped.toLowerCase().endsWith('.mp4') ? stripped : `${stripped}.mp4`;
}

/**
 * Pure validation the modal can run with zero native runtime. Native
 * `validateOutputPath` is AND-ed with this, never a replacement for it.
 */
export function validateExportOutputPath(directory: string, fileName: string): OutputPathValidation {
  const dir = directory.trim();
  if (!dir) return { ok: false, reason: 'Choose a folder for the exported file.' };
  const name = sanitizeExportFileName(fileName);
  if (!name) return { ok: false, reason: 'Enter a file name.' };
  const fullPath = joinExportOutputPath(dir, name);
  const lengthIssue = checkExportDestinationPathLength(fullPath);
  if (lengthIssue) return { ok: false, reason: lengthIssue };
  return { ok: true, fullPath };
}

export interface FakeExportTargetFsOptions {
  /** Directory `pickOutputDirectory` returns. `null` = user cancelled. */
  pickedDirectory?: string | null;
  /** Free-space reading; `null` = query failed / unavailable. */
  freeSpace?: VolumeFreeSpaceReading | null;
  /** Override native validation. Default: pure `validateExportOutputPath`. */
  validate?: (directory: string, fileName: string) => OutputPathValidation | Promise<OutputPathValidation>;
}

/**
 * In-memory fake for tests and for the browser-only Vite path. Never talks
 * to Tauri. The modal's unit tests inject one of these.
 */
export function createFakeExportTargetFs(opts: FakeExportTargetFsOptions = {}): ExportTargetFs {
  const pickedDirectory = opts.pickedDirectory === undefined ? '/Users/name/Movies' : opts.pickedDirectory;
  const freeSpace = opts.freeSpace === undefined
    ? {
        path: pickedDirectory ?? '/Users/name/Movies',
        probedPath: pickedDirectory ?? '/Users/name/Movies',
        volumeKey: 'fake:movies',
        availableBytes: 100 * 1024 ** 3,
      }
    : opts.freeSpace;

  return {
    async pickOutputDirectory(): Promise<string | null> {
      return pickedDirectory;
    },
    async queryVolumeFreeSpace(targetPath: string): Promise<VolumeFreeSpaceReading | null> {
      if (freeSpace === null) return null;
      return { ...freeSpace, path: targetPath };
    },
    async validateOutputPath(directory: string, fileName: string): Promise<OutputPathValidation> {
      if (opts.validate) return opts.validate(directory, fileName);
      return validateExportOutputPath(directory, fileName);
    },
  };
}

/**
 * Production adapter. `invoke` is passed in so this module never imports
 * `@tauri-apps` — App.tsx already has `invoke` and CC owns the commands.
 *
 * A missing/unimplemented command rejects; the modal treats a rejected
 * pick as cancel, a rejected free-space query as "unavailable" (does not
 * disable Export), and a rejected validate as the pure-path result.
 */
export function createInvokeExportTargetFs(
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
): ExportTargetFs {
  return {
    async pickOutputDirectory(currentDirectory: string | null): Promise<string | null> {
      return invoke<string | null>('export_pick_output_directory', { currentDirectory });
    },
    async queryVolumeFreeSpace(targetPath: string): Promise<VolumeFreeSpaceReading | null> {
      return invoke<VolumeFreeSpaceReading | null>('export_volume_free_space', { targetPath });
    },
    async validateOutputPath(directory: string, fileName: string): Promise<OutputPathValidation> {
      return invoke<OutputPathValidation>('export_validate_output_path', { directory, fileName });
    },
  };
}
