import { useCallback, useEffect, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import { type FfmpegWorkerService } from '../workers/exportWorker';
import {
  exportProject,
  type ExportError,
  type ExportStage,
} from '../services/exportPipeline';
import { type Project } from '../types';

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

  // Worker refs — lazy: created on first startExport, not on mount.
  const workerRef = useRef<Worker | null>(null);
  const svcRef = useRef<Comlink.Remote<FfmpegWorkerService> | null>(null);

  // Generation counter — incremented on every cancel so in-flight onProgress
  // callbacks from the dying export silently no-op and never overwrite new state.
  const generationRef = useRef(0);

  // Last snapshot — retryExport re-runs with the same inputs as the last startExport.
  const lastSnapshotRef = useRef<ExportSnapshot | null>(null);

  // Terminate and null out the worker refs.
  const teardownWorker = useCallback((): void => {
    workerRef.current?.terminate();
    workerRef.current = null;
    svcRef.current = null;
  }, []);

  // Terminate worker on unmount.
  useEffect(() => teardownWorker, [teardownWorker]);

  const runExport = useCallback(async (snapshot: ExportSnapshot): Promise<void> => {
    const gen = ++generationRef.current;

    setState({
      isExporting: true,
      stage: null,
      progress: 0,
      stageLabel: 'Loading ffmpeg…',
      error: null,
    });

    // Lazy worker creation — spawn only when actually needed.
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../workers/exportWorker.ts', import.meta.url),
        { type: 'module' },
      );
      svcRef.current = Comlink.wrap<FfmpegWorkerService>(workerRef.current);
    }

    const svc = svcRef.current!;

    try {
      await svc.load();
    } catch (err) {
      if (generationRef.current !== gen) return;
      teardownWorker();
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

    if (generationRef.current !== gen) return;

    const { resolution, fps, project: snap } = snapshot;
    const resWidth = resolution === '4k' ? 3840 : 1920;
    const resHeight = resolution === '4k' ? 2160 : 1080;

    const result = await exportProject(
      snap,
      svc,
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

    // Guard required: worker.terminate() causes Comlink to reject the exportProject
    // promise with an unknown error. Without this check that rejection would overwrite
    // the 'cancelled' error state that cancelExport already set.
    if (generationRef.current !== gen) return;

    teardownWorker();

    if (!result.ok) {
      setState(prev => ({
        ...prev,
        isExporting: false,
        error: result.error,
      }));
      return;
    }

    // Trigger download.
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    a.download = `${snap.name.replace(/\s+/g, '_')}_${ts}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);

    setState(IDLE_STATE);
  }, [teardownWorker]);

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
    if (workerRef.current === null) {
      // No active export — just dismiss the error/cancelled modal.
      setState(IDLE_STATE);
      return;
    }
    // Invalidate all in-flight onProgress callbacks from the current generation.
    generationRef.current++;
    teardownWorker();
    setState({
      isExporting: false,
      stage: null,
      progress: 0,
      stageLabel: '',
      error: { kind: 'cancelled', message: 'Export cancelled.' },
    });
  }, [teardownWorker]);

  const retryExport = useCallback((): void => {
    const snapshot = lastSnapshotRef.current;
    if (!snapshot) return;
    // Tear down any lingering worker before re-spawning.
    teardownWorker();
    void runExport(snapshot);
  }, [runExport, teardownWorker]);

  return { state, startExport, cancelExport, retryExport };
}
