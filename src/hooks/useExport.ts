import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  exportProject,
  type ExportError,
  type ExportStage,
} from '../services/exportPipeline';
import {
  exportProjectWebCodecs,
  cancelExportWebCodecs,
  type WebCodecsFfmpeg,
} from '../services/webcodecsExport/exportPipelineWebCodecs';
import { type Project, type ResolutionTier } from '../types';
import { isTauri } from '../services/tauriFfmpeg';
import { createTauriBackend, type TauriBackend } from '../services/ffmpegBackend';
import { isWebGL2Supported } from '../services/gl/glContext';
import { readUiState, patchUiState } from '../services/uiStateStore';
import { resolveDimensions, DEFAULT_ASPECT_RATIO } from '../services/resolutionConfig';

/** Export quality tier — the same closed set as the project's own native
 *  resolutionTier (services/resolutionConfig.ts); dimensions are always
 *  derived from (project.aspectRatio, this tier), never stored directly.
 *  Kept as a distinct exported name (rather than importing ResolutionTier
 *  everywhere) so callers don't need to know the two concepts share a type. */
export type ExportResolution = ResolutionTier;
export type ExportFps = 24 | 30 | 60;
export type { ExportError } from '../services/exportPipeline';

// ---------------------------------------------------------------------------
// WebCodecs export gate — capability probe + persisted user toggle
// (docs/webcodecs-export-plan.md §4.4/§6). The new path only runs when BOTH
// are true; either one being false is byte-identical to today (legacy path).
// ---------------------------------------------------------------------------

const WEBCODECS_EXPORT_TOGGLE_KEY = 'webcodecsExportEnabled';

let cachedWebCodecsExportCapability: boolean | null = null;

/**
 * Capability probe: WebCodecs encode+decode, WebGL2, and module-worker
 * support are all required by the new path's worker (exportWorker.ts).
 * Memoized — runtime capability can't change mid-session, matching the
 * isWebGL2Supported()/isWebCodecsPreviewSupported() memoization pattern
 * already used elsewhere (glContext.ts, webcodecsSupport.ts).
 */
export function isWebCodecsExportCapable(): boolean {
  if (cachedWebCodecsExportCapability !== null) return cachedWebCodecsExportCapability;
  cachedWebCodecsExportCapability = (() => {
    if (typeof window === 'undefined') return false;
    if (!('VideoEncoder' in window) || !('VideoDecoder' in window) || !('EncodedVideoChunk' in window)) {
      return false;
    }
    if (!isWebGL2Supported()) return false;
    if (typeof Worker === 'undefined') return false;
    // Module-worker probe: constructing with { type: 'module' } throws
    // synchronously on a runtime that doesn't support it. An empty module
    // script is valid and never executes anything before terminate().
    try {
      const url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
      const worker = new Worker(url, { type: 'module' });
      worker.terminate();
      URL.revokeObjectURL(url);
      return true;
    } catch {
      return false;
    }
  })();
  return cachedWebCodecsExportCapability;
}

/** Test-only: clears the memoized capability result. */
export function __resetWebCodecsExportCapabilityForTests(): void {
  cachedWebCodecsExportCapability = null;
}

/**
 * Persisted user toggle — defaults ON for users who have never touched it
 * (macOS Intel verified; macOS arm64/Windows unverified but accepted risk).
 * An explicit prior choice (stored true or false) is always respected.
 */
export function isWebCodecsExportToggleOn(): boolean {
  try {
    const stored = readUiState()[WEBCODECS_EXPORT_TOGGLE_KEY];
    return typeof stored === 'boolean' ? stored : true;
  } catch { return true; }
}

export function setWebCodecsExportToggle(enabled: boolean): void {
  patchUiState({ [WEBCODECS_EXPORT_TOGGLE_KEY]: enabled });
}

/** The gate itself — capability AND user toggle both required. */
export function isWebCodecsExportGateOpen(): boolean {
  return isWebCodecsExportCapable() && isWebCodecsExportToggleOn();
}

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

  // Which orchestrator the CURRENT (or most recently started) export is using
  // — decided fresh at the top of every runExport call from the gate check.
  // cancelExport reads this to pick the matching cancel sequence (plan §9.1).
  const activePathRef = useRef<'legacy' | 'webcodecs'>('legacy');

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
    const { width: resWidth, height: resHeight } = resolveDimensions(
      snap.aspectRatio ?? DEFAULT_ASPECT_RATIO,
      resolution,
    );

    // Gate branch (plan §4.4): decided fresh per run, capability + toggle
    // both required. When closed, this is byte-identical to the pre-Step-7
    // code — same exportProject call, same args, same onProgress shape.
    const useWebCodecsPath = isWebCodecsExportGateOpen();
    activePathRef.current = useWebCodecsPath ? 'webcodecs' : 'legacy';

    const onProgress = (stage: ExportStage): void => {
      if (generationRef.current !== gen) return;
      setState(prev => ({
        ...prev,
        stage,
        progress: progressFor(stage),
        stageLabel: stageLabelFor(stage),
      }));
    };

    const result = useWebCodecsPath
      ? await exportProjectWebCodecs(
          snap,
          // TauriFfmpeg (the concrete runtime type behind TauriBackend.ffmpeg)
          // implements appendFileRaw/saveSessionFile/kill/destroy in addition
          // to the base FfmpegLike surface — it structurally satisfies
          // WebCodecsFfmpeg even though TauriBackend's own field type doesn't
          // declare those extra members.
          tauriBackendRef.current.ffmpeg as WebCodecsFfmpeg,
          { fps, width: resWidth, height: resHeight },
          onProgress,
        )
      : await exportProject(
          snap,
          tauriBackendRef.current.ffmpeg,
          { fps, width: resWidth, height: resHeight },
          onProgress,
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
    const wasWebCodecsPath = activePathRef.current === 'webcodecs';
    void (async () => {
      if (wasWebCodecsPath) {
        // Plan §9.1 cancel sequence: post 'cancel' to the worker + terminate
        // it FIRST, then kill+destroy the same ffmpeg session the pipeline
        // was using (cancelExportWebCodecs's own module-level activeFfmpeg is
        // the exact `backend.ffmpeg` instance passed into
        // exportProjectWebCodecs above — same session, no separate handle to
        // thread through this hook).
        await cancelExportWebCodecs();
      } else {
        await backend.cancel();
      }
      // teardown() nulls tauriBackendRef regardless of path. For the
      // WebCodecs path this is a second, idempotent destroy() on top of the
      // one cancelExportWebCodecs() already did (TauriFfmpeg.destroy()'s own
      // doc comment: safe to call more than once) — never a second live kill.
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
