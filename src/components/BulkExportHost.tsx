/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { useExport, type ExportFps, type ExportResolution } from '../hooks/useExport';
import { BULK_EXPORT_INTEREST_OWNER, type BulkExportExecutorInput, type BulkExportRunner } from '../services/bulkExportQueue';
import type { ExportInterestRegistry } from '../services/webcodecsExport/exportInterestRegistry';
import { buildExportSpotPayload } from '../services/spots/exportSpecs';
import { DEFAULT_RESOLUTION_TIER } from '../services/resolutionConfig';
import type { QueueJobOutcome } from '../services/syncQueue';
import { ENCODE_END_PCT } from '../services/exportEta';
import { awaitExportTeardown } from '../services/exportTeardownLatch';
import { MediaLoadTimeoutError } from '../services/projectMediaPreparation';
import { loadProjectMedia, type LoadedProjectMedia } from '../services/bulkExportMedia';
import { bulkDeviationNote } from '../services/webcodecsExport/pieceDeviationText';
import type { ForcedMp4SealOffer } from '../services/webcodecsExport/muxOnly';
import type { Project } from '../types';

import { bulkRowResumeNote, NOTHING_FOUND_NOTE } from '../services/webcodecsExport/resumeRefusalText';
export { RESTART_NOTE, COULD_NOT_RESUME_NOTE, NOTHING_FOUND_NOTE } from '../services/webcodecsExport/resumeRefusalText';

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
      interests={runner.interests}
      onDone={(o) => {
        resolveRef.current?.(o);
        resolveRef.current = null;
        setJob(null);
      }}
    />
  );
}

function BulkExportSlot({
  input, onDone, interests,
}: {
  input: BulkExportExecutorInput;
  onDone: (o: QueueJobOutcome) => void;
  interests?: ExportInterestRegistry;
}): React.ReactElement {
  const resolution: ExportResolution = input.resolution ?? DEFAULT_RESOLUTION_TIER;
  const fps: ExportFps = input.fps;
  const { state, startExport, cancelExport, resolveResumeChoice, resolveSealConsent } = useExport(
    input.project,
    resolution,
    fps,
    () => {},
    { interests, interestOwner: BULK_EXPORT_INTEREST_OWNER },
  );
  const finished = useRef(false);

  // How this run started — never silent. A found checkpoint: the bar starts at
  // the resumed position with "Resuming from checkpoint — N% done". Nothing
  // recorded yet (or nothing usable found): "restarting from the beginning".
  const startInfo = useRef<{ note: string; resumedFromPct?: number } | null>(null);
  const report = (pct: number, stage: string): void => {
    input.setProgress({ pct, stage, ...(startInfo.current ?? {}) });
  };

  // Live progress for the Active row: bar, stage text, timer / ETA.
  useEffect(() => {
    if (finished.current || typeof state.progress !== 'number') return;
    const stage = state.stageLabel || 'Starting…';
    // Encoding began on a Retry that was never offered a checkpoint: say so.
    if (!startInfo.current && input.resume && state.stage?.type === 'encoding_segment') {
      startInfo.current = { note: state.resumeRefusalNotice ? bulkRowResumeNote(state.resumeRefusalNotice) : NOTHING_FOUND_NOTE };
    }
    input.setPhase(stage);
    report(state.progress, stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.progress, state.stageLabel, state.stage, input]);

  // Discovery's two honest outcomes, before the first frame is encoded.
  useEffect(() => {
    if (finished.current || startInfo.current) return;
    const notice = state.resumeRefusalNotice;
    if (notice) {
      // The real reason, never one of a few fixed strings.
      startInfo.current = { note: bulkRowResumeNote(notice) };
      report(0, 'Starting…');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.resumeRefusalNotice]);

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
    const offer = state.pendingResumeOffer;
    if (!offer) return;
    if (input.resume) {
      // The bar's own scale: encoding fills 0–90.
      const pct = Math.round((offer.picturesAlreadyRendered / Math.max(1, offer.picturesTotal)) * ENCODE_END_PCT);
      startInfo.current = { note: `Resuming from checkpoint — ${pct}% done`, resumedFromPct: pct };
      report(pct, 'Resuming…');
    }
    resolveResumeChoice(input.resume ? 'resume' : 'clean');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingResumeOffer, input.resume, resolveResumeChoice]);

  // Bulk has no one to ask: the seal decision is answered yes so the deliverable
  // is kept. What it must not do is stay silent — the offer (with its recorded
  // deviations) is remembered here and reaches the row's notice when the row
  // finishes, and the diagnostics get one line per deviating piece.
  const sealedOffer = useRef<ForcedMp4SealOffer | null>(null);
  useEffect(() => {
    const offer = state.pendingSealConsent;
    if (!offer) return;
    if (!sealedOffer.current) {
      sealedOffer.current = offer;
      for (const d of offer.deviatingPieces ?? []) {
        // eslint-disable-next-line no-console
        console.warn('[ws3-bulk-deviation] saved with a recorded piece deviation', JSON.stringify({
          projectId: input.project.id, sessionId: offer.sessionId ?? null, ...d,
        }));
      }
    }
    resolveSealConsent(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingSealConsent, resolveSealConsent]);

  useEffect(() => {
    if (finished.current) return;
    if (state.showExportSuccess) {
      finished.current = true;
      const note = bulkDeviationNote(sealedOffer.current ?? state.lastExportSealedOffer ?? { fps });
      onDone(note ? { status: 'done', detail: note } : { status: 'done' });
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
