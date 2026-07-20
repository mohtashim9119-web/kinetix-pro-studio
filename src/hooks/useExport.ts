import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  exportProject,
  type ExportError,
  type ExportStage,
} from '../services/exportPipeline';
import { type Project } from '../types';
import { isTauri } from '../services/tauriFfmpeg';
import { createTauriBackend, type TauriBackend } from '../services/ffmpegBackend';

export type ExportResolution = '1080p' | '4k';
export type ExportFps = 24 | 30 | 60;
export type { ExportError } from '../services/exportPipeline';

export interface UseExportState {
  isExporting: boolean;
  stage: ExportStage | null;
  progress: number;
  stageLabel: string;
  error: ExportError | null;
  showExportSuccess?: boolean;
  lastExportPath?: string;
}

export interface UseExportApi {
  state: UseExportState;
  startExport: () => void;
  cancelExport: () => void;
  retryExport: () => void;
  dismissSuccess: () => void;
}

interface ExportSnapshot {
  project: Project;
  resolution: ExportResolution;
  fps: ExportFps;
  savedPath: string;
}

const IDLE_STATE: UseExportState = {
  isExporting: false,
  stage: null,
  progress: 0,
  stageLabel: '',
  error: null,
};

/**
 * Returns the parent directory of a file path, or null if the path has no
 * directory component. Handles BOTH `/` (POSIX/macOS) and `\` (Windows)
 * separators — `pick_save_path` returns native paths, so on Windows the saved
 * path uses backslashes and a `/`-only split would return an empty string,
 * silently breaking the "remember last export directory" default. Mirrors the
 * dual-separator handling in App.tsx's export-filename display.
 */
export function parentDir(path: string): string | null {
  const sep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return sep >= 0 ? path.substring(0, sep) : null;
}

function stageLabelFor(stage: ExportStage): string {
  if (stage.type === 'loading_ffmpeg') return 'Loading ffmpeg…';
  if (stage.type === 'encoding_segment') return `Encoding segment ${stage.index + 1} / ${stage.total}`;
  if (stage.type === 'muxing') return 'Muxing & packaging…';
  if (stage.type === 'done') return 'Done!';
  return '';
}

function progressFor(stage: ExportStage): number {
  if (stage.type === 'loading_ffmpeg') return 0;
  if (stage.type === 'encoding_segment') {
    const segPct = stage.total > 0
      ? (stage.index + (stage.totalFrames > 0 ? stage.frame / stage.totalFrames : 0)) / stage.total
      : 0;
    return Math.round(segPct * 90);
  }
  if (stage.type === 'muxing') return 93;
  if (stage.type === 'done') return 100;
  return 0;
}

export function useExport(
  project: Project,
  exportResolution: ExportResolution,
  exportFps: ExportFps,
  onSavePath: (path: string) => void,
): UseExportApi {
  const [state, setState] = useState<UseExportState>(IDLE_STATE);

  // Tauri native backend ref — lazy: created on first startExport.
  const tauriBackendRef = useRef<TauriBackend | null>(null);

  // Generation counter — incremented on every cancel so in-flight onProgress
  // callbacks from the dying export silently no-op and never overwrite new state.
  const generationRef = useRef(0);

  // Last snapshot — retryExport re-runs with the same inputs as the last startExport.
  const lastSnapshotRef = useRef<ExportSnapshot | null>(null);

  // Tear down the active backend and null the ref.
  // Async because session cleanup (dispose) awaits an IPC call.
  const teardown = useCallback(async (): Promise<void> => {
    if (tauriBackendRef.current) {
      await tauriBackendRef.current.dispose();
      tauriBackendRef.current = null;
    }
  }, []);

  // Clean up on unmount — fire-and-forget since useEffect cleanup must be sync.
  useEffect(() => () => { void teardown(); }, [teardown]);

  const runExport = useCallback(async (snapshot: ExportSnapshot): Promise<void> => {
    const gen = ++generationRef.current;

    setState({
      isExporting: true,
      stage: null,
      progress: 0,
      stageLabel: 'Loading ffmpeg…',
      error: null,
    });

    // -------------------------------------------------------------------------
    // Backend acquisition — Tauri native path only (wasm removed in Phase 6.4).
    // -------------------------------------------------------------------------
    try {
      tauriBackendRef.current = await createTauriBackend();
    } catch (err) {
      if (generationRef.current !== gen) return;
      await teardown();
      setState({
        isExporting: false,
        stage: null,
        progress: 0,
        stageLabel: '',
        error: {
          kind: 'ffmpeg_load',
          message: 'Failed to create a native ffmpeg session. Is ffmpeg installed and on PATH?',
          cause: err instanceof Error ? err.message : String(err),
        },
      });
      return;
    }

    if (generationRef.current !== gen) return;

    const { resolution, fps, project: snap, savedPath } = snapshot;
    const resWidth = resolution === '4k' ? 3840 : 1920;
    const resHeight = resolution === '4k' ? 2160 : 1080;

    const result = await exportProject(
      snap,
      tauriBackendRef.current.ffmpeg,
      { fps, width: resWidth, height: resHeight },
      (stage: ExportStage) => {
        if (generationRef.current !== gen) return;
        setState(prev => ({
          ...prev,
          stage,
          progress: progressFor(stage),
          stageLabel: stageLabelFor(stage),
        }));
      },
    );

    // Guard required: cancelExport increments the generation counter; without this
    // check its result would overwrite the 'cancelled' error state.
    if (generationRef.current !== gen) return;

    if (!result.ok) {
      await teardown();
      setState(prev => ({
        ...prev,
        isExporting: false,
        error: result.error,
      }));
      return;
    }

    // Copy the finished MP4 from the session temp dir straight to the path the
    // user chose before rendering started (no dialog here — it ran in startExport
    // before any render work). This runs BEFORE teardown (which deletes the
    // session dir) and never pulls the file's bytes into the renderer: the old
    // readFile → Blob → arrayBuffer → base64 → save_bytes_to_disk chain inflated
    // the whole file ~5–6× in the WebView heap and crashed WebView2's OOM guard
    // (STATUS_BREAKPOINT) on large exports.
    const backend = tauriBackendRef.current;
    try {
      if (!backend) throw new Error('export backend was torn down before save');
      await backend.saveOutputToDisk(result.outputFile, savedPath);
    } catch (err) {
      await teardown();
      if (generationRef.current !== gen) return;
      setState(prev => ({
        ...prev,
        isExporting: false,
        error: {
          kind: 'unknown',
          message: 'Failed to save the exported file to disk.',
          cause: err instanceof Error ? err.message : String(err),
        },
      }));
      return;
    }

    await teardown();
    if (generationRef.current !== gen) return;

    setState({
      ...IDLE_STATE,
      lastExportPath: savedPath,
      showExportSuccess: true,
    });
  }, [teardown]);

  const startExport = useCallback((): void => {
    if (!isTauri()) {
      throw new Error('Export is only available in the desktop app.');
    }
    void (async () => {
      // Step 1: prompt for destination BEFORE any rendering work begins.
      // If the user cancels nothing is wasted.
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const defaultName = `${project.name.replace(/\s+/g, '_')}_${ts}.mp4`;
      const defaultDir = project.lastExportPath
        ? parentDir(project.lastExportPath)
        : null;
      const savedPath = await invoke<string | null>('pick_save_path', {
        defaultName,
        defaultDir,
      });
      if (!savedPath) return; // user cancelled — nothing rendered, nothing wasted

      // Step 2: remember path immediately so retryExport and the toast can use it.
      onSavePath(savedPath);

      // Step 3: render and write.
      const snapshot: ExportSnapshot = {
        project,
        resolution: exportResolution,
        fps: exportFps,
        savedPath,
      };
      lastSnapshotRef.current = snapshot;
      void runExport(snapshot);
    })();
  }, [project, exportResolution, exportFps, runExport, onSavePath]);

  const cancelExport = useCallback((): void => {
    if (tauriBackendRef.current === null) {
      // No active export — just dismiss the error/cancelled modal.
      setState(IDLE_STATE);
      return;
    }
    // Invalidate all in-flight onProgress callbacks from the current generation.
    generationRef.current++;
    // D13 fix — kill the in-flight ffmpeg subprocess before tearing down the
    // session dir it's writing into. Fire-and-forget: cancelExport is sync;
    // cancel() runs before teardown() so the sidecar isn't left running against
    // an already-deleted temp dir.
    const backend = tauriBackendRef.current;
    void (async () => {
      await backend.cancel();
      await teardown();
    })();
    setState({
      isExporting: false,
      stage: null,
      progress: 0,
      stageLabel: '',
      error: { kind: 'cancelled', message: 'Export cancelled.' },
    });
  }, [teardown]);

  const retryExport = useCallback((): void => {
    const snapshot = lastSnapshotRef.current;
    if (!snapshot) return;
    // Tear down any lingering backend before re-spawning. Fire-and-forget:
    // retryExport is sync; runExport creates a fresh session regardless.
    void teardown();
    void runExport(snapshot);
  }, [runExport, teardown]);

  const dismissSuccess = useCallback((): void => {
    setState(prev => ({ ...prev, showExportSuccess: false }));
  }, []);

  return { state, startExport, cancelExport, retryExport, dismissSuccess };
}
