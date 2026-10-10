/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { useExport, type ExportFps, type ExportResolution } from '../hooks/useExport';
import type { BulkExportExecutorInput, BulkExportRunner } from '../services/bulkExportQueue';
import { buildExportSpotPayload } from '../services/spots/exportSpecs';
import { DEFAULT_RESOLUTION_TIER } from '../services/resolutionConfig';
import type { QueueJobOutcome } from '../services/syncQueue';
import { awaitExportTeardown } from '../services/exportTeardownLatch';
import { MediaLoadTimeoutError } from '../services/projectMediaPreparation';
import { loadProjectMedia, type LoadedProjectMedia } from '../services/bulkExportMedia';
import type { Project } from '../types';

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function BulkExportHost({
  runner, loadMedia = loadProjectMedia,
}: {
  runner: BulkExportRunner;
  /** Loads a project's real media for one export (default: storage → blob URLs). */
  loadMedia?: (project: Project) => Promise<LoadedProjectMedia>;
}): React.ReactElement {
  const [job, setJob] = useState<BulkExportExecutorInput | null>(null);
  const resolveRef = useRef<((o: QueueJobOutcome) => void) | null>(null);

  useEffect(() => {
    runner.setExecutor(async (input) => {
      // The stored record has no media URLs: load the real media first, the
      // way opening the project does. A load failure parks the row with the
      // reason; the queue advances. The URLs are freed on every exit.
      let media: LoadedProjectMedia;
      // The previous row's cancel tears its ffmpeg session down in the
      // background: the next start waits for that to finish, never overlaps it.
      await awaitExportTeardown();
      input.setPhase('Loading media…');
      try {
        media = await loadMedia(input.project);
      } catch (err) {
        // A hung probe reads "Failed — Retry — media would not load" as it is.
        if (err instanceof MediaLoadTimeoutError) return { status: 'failed', detail: err.message };
        return { status: 'failed', detail: `could not load the project's media — ${errorText(err)}` };
      }
      try {
        if (input.signal.aborted) return { status: 'failed', detail: 'cancelled' };
        return await new Promise<QueueJobOutcome>((resolve) => {
          resolveRef.current = resolve;
          setJob({ ...input, project: media.project });
        });
      } finally {
        media.revoke();
      }
    });
  }, [runner, loadMedia]);

  if (!job) return <></>;
  return (
    <BulkExportSlot
      input={job}
      onDone={(o) => {
        resolveRef.current?.(o);
        resolveRef.current = null;
        setJob(null);
      }}
    />
  );
}

function BulkExportSlot({
  input, onDone,
}: {
  input: BulkExportExecutorInput;
  onDone: (o: QueueJobOutcome) => void;
}): React.ReactElement {
  const resolution: ExportResolution = input.resolution ?? DEFAULT_RESOLUTION_TIER;
  const fps: ExportFps = input.fps;
  const { state, startExport, cancelExport, resolveResumeChoice, resolveSealConsent } = useExport(
    input.project,
    resolution,
    fps,
    () => {},
  );
  const finished = useRef(false);

  // Live progress for the Active row: bar, stage text, timer / ETA.
  useEffect(() => {
    if (finished.current || typeof state.progress !== 'number') return;
    const stage = state.stageLabel || 'Starting…';
    input.setPhase(stage);
    input.setProgress({ pct: state.progress, stage });
  }, [state.progress, state.stageLabel, input]);

  useEffect(() => {
    // A kickoff that throws must still settle the job (a hang stalls the
    // whole serial queue with no visible row state).
    try {
      const payload = buildExportSpotPayload(input.project, { projectDefault: input.project.spotDefaultGeometry });
      startExport({
        savedPath: input.savedPath,
        silent: true,
        spotRenderSpecs: payload.request?.spotRenderSpecs,
      });
    } catch (err) {
      finished.current = true;
      onDone({ status: 'failed', detail: err instanceof Error ? err.message : String(err) });
    }
    // One kickoff per mounted slot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bulk export shows no resume dialog, so an offer is always answered here:
  // resume on a Retry that found a checkpoint, otherwise a clean start.
  useEffect(() => {
    if (state.pendingResumeOffer) resolveResumeChoice(input.resume ? 'resume' : 'clean');
  }, [state.pendingResumeOffer, input.resume, resolveResumeChoice]);

  useEffect(() => {
    if (state.pendingSealConsent) resolveSealConsent(true);
  }, [state.pendingSealConsent, resolveSealConsent]);

  useEffect(() => {
    if (finished.current) return;
    if (state.showExportSuccess) {
      finished.current = true;
      onDone({ status: 'done' });
      return;
    }
    if (state.error && !state.isExporting) {
      finished.current = true;
      onDone({ status: 'failed', detail: state.error.message });
    }
  }, [state.showExportSuccess, state.error, state.isExporting, onDone]);

  // Cancel / Stop all: the engine's own cancel (worker first, then ffmpeg;
  // a session with a resume manifest is kept), then the job settles. The
  // queue records the row as cancelled, not failed.
  useEffect(() => {
    const onAbort = (): void => {
      if (finished.current) return;
      finished.current = true;
      cancelExport({ keepForResume: true });
      onDone({ status: 'failed', detail: 'cancelled' });
    };
    if (input.signal.aborted) { onAbort(); return; }
    input.signal.addEventListener('abort', onAbort);
    return () => input.signal.removeEventListener('abort', onAbort);
  }, [input.signal, onDone, cancelExport]);

  return <></>;
}
