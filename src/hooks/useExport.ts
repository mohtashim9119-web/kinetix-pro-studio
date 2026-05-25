import { useCallback, useEffect, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import { invoke } from '@tauri-apps/api/core';
import { type FfmpegWorkerService } from '../workers/exportWorker';
import {
  exportProject,
  type ExportError,
  type ExportStage,
} from '../services/exportPipeline';
import { type Project } from '../types';
import { isTauri, bytesToBase64 } from '../services/tauriFfmpeg';
import { createTauriBackend, type TauriBackend } from '../services/ffmpegBackend';
import type { FfmpegLike } from '../services/segmentEncoder';

export type ExportResolution = '1080p' | '4k';
export type ExportFps = 24 | 30 | 60;
export type { ExportError } from '../services/exportPipeline';

export interface UseExportState {
  isExporting: boolean;
  stage: ExportStage | null;
  progress: number;
  stageLabel: string;
  error: ExportError | null;
}

export interface UseExportApi {
  state: UseExportState;
  startExport: () => void;
  cancelExport: () => void;
  retryExport: () => void;
}

interface ExportSnapshot {
  project: Project;
  resolution: ExportResolution;
  fps: ExportFps;
}

const IDLE_STATE: UseExportState = {
  isExporting: false,
  stage: null,
  progress: 0,
  stageLabel: '',
  error: null,
};

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
): UseExportApi {
  const [state, setState] = useState<UseExportState>(IDLE_STATE);

  // Wasm worker refs — lazy: created on first startExport when !isTauri().
  // Preserved as fallback for non-Tauri contexts. Removed in Phase 6.4.
  const workerRef = useRef<Worker | null>(null);
  const svcRef = useRef<Comlink.Remote<FfmpegWorkerService> | null>(null);

  // Tauri native backend ref — lazy: created on first startExport when isTauri().
  const tauriBackendRef = useRef<TauriBackend | null>(null);

  // Generation counter — incremented on every cancel so in-flight onProgress
  // callbacks from the dying export silently no-op and never overwrite new state.
  const generationRef = useRef(0);

  // Last snapshot — retryExport re-runs with the same inputs as the last startExport.
  const lastSnapshotRef = useRef<ExportSnapshot | null>(null);

  // Tear down whichever backend is active and null the refs.
  // Async because Tauri session cleanup (dispose) awaits an IPC call.
  // Call sites inside async functions should await; sync callers fire-and-forget.
  const teardown = useCallback(async (): Promise<void> => {
    // Wasm worker path
    workerRef.current?.terminate();
    workerRef.current = null;
    svcRef.current = null;

    // Tauri native path
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
    // Backend acquisition — runtime-select Tauri native vs wasm worker.
    // -------------------------------------------------------------------------
    if (isTauri()) {
      // Tauri native path: each export gets a fresh session-scoped temp directory
      // under $TMPDIR/kinetix-export-<uuid>/. The session is disposed by teardown().
      //
      // Cancellation note: cancelExport() increments the generation counter and
      // calls teardown(), but the in-flight ffmpeg subprocess (running inside Rust
      // via Command::output()) cannot be killed from the frontend in this sub-phase.
      // The subprocess runs to completion; its result is discarded by the generation
      // guard. True subprocess termination is deferred to Phase 7 (requires a Child
      // handle in Rust state and an ffmpeg_cancel_session command).
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
    } else {
      // Browser wasm path — preserved for non-Tauri contexts. Removed in Phase 6.4.
      if (!workerRef.current) {
        workerRef.current = new Worker(
          new URL('../workers/exportWorker.ts', import.meta.url),
          { type: 'module' },
        );
        svcRef.current = Comlink.wrap<FfmpegWorkerService>(workerRef.current);
      }

      try {
        await svcRef.current!.load();
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
            message: 'Failed to load the ffmpeg engine. Check your network connection and try again.',
            cause: err instanceof Error ? err.message : String(err),
          },
        });
        return;
      }
    }

    if (generationRef.current !== gen) return;

    // Resolve FfmpegLike from whichever backend was just acquired.
    const ffmpegLike: FfmpegLike = isTauri()
      ? tauriBackendRef.current!.ffmpeg
      : (svcRef.current! as unknown as FfmpegLike);

    const { resolution, fps, project: snap } = snapshot;
    const resWidth = resolution === '4k' ? 3840 : 1920;
    const resHeight = resolution === '4k' ? 2160 : 1080;

    const result = await exportProject(
      snap,
      ffmpegLike,
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

    // Guard required: for the wasm path, worker.terminate() causes Comlink to reject
    // the exportProject promise; without this check that rejection would overwrite the
    // 'cancelled' error state that cancelExport already set.
    if (generationRef.current !== gen) return;

    await teardown();

    if (!result.ok) {
      setState(prev => ({
        ...prev,
        isExporting: false,
        error: result.error,
      }));
      return;
    }

    // Trigger download — native save dialog in Tauri, anchor click in browser.
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const fileName = `${snap.name.replace(/\s+/g, '_')}_${ts}.mp4`;

    if (isTauri()) {
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      await invoke<boolean>('save_bytes_to_disk', {
        dataB64: bytesToBase64(bytes),
        defaultName: fileName,
      });
      // Guard: a new export may have started while the save dialog was open.
      if (generationRef.current !== gen) return;
    } else {
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    setState(IDLE_STATE);
  }, [teardown]);

  const startExport = useCallback((): void => {
    const snapshot: ExportSnapshot = {
      project,
      resolution: exportResolution,
      fps: exportFps,
    };
    lastSnapshotRef.current = snapshot;
    void runExport(snapshot);
  }, [project, exportResolution, exportFps, runExport]);

  const cancelExport = useCallback((): void => {
    // Detect whether any backend is active (= an export is in progress).
    const hasActiveTauri = tauriBackendRef.current !== null;
    const hasActiveWorker = workerRef.current !== null;
    if (!hasActiveTauri && !hasActiveWorker) {
      // No active export — just dismiss the error/cancelled modal.
      setState(IDLE_STATE);
      return;
    }
    // Invalidate all in-flight onProgress callbacks from the current generation.
    generationRef.current++;
    // Fire-and-forget: cancelExport is sync. Under Tauri, dispose() is best-effort —
    // the in-flight ffmpeg subprocess is not killed (see cancellation note in runExport).
    void teardown();
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

  return { state, startExport, cancelExport, retryExport };
}
