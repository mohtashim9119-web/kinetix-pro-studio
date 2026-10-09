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

export function BulkExportHost({ runner }: { runner: BulkExportRunner }): React.ReactElement {
  const [job, setJob] = useState<BulkExportExecutorInput | null>(null);
  const resolveRef = useRef<((o: QueueJobOutcome) => void) | null>(null);

  useEffect(() => {
    runner.setExecutor(async (input) => new Promise((resolve) => {
      resolveRef.current = resolve;
      setJob(input);
    }));
  }, [runner]);

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
  const { state, startExport, resolveResumeChoice, resolveSealConsent } = useExport(
    input.project,
    resolution,
    fps,
    () => {},
  );
  const finished = useRef(false);

  useEffect(() => {
    const payload = buildExportSpotPayload(input.project, { projectDefault: input.project.spotDefaultGeometry });
    startExport({
      savedPath: input.savedPath,
      silent: true,
      spotRenderSpecs: payload.request?.spotRenderSpecs,
    });
    // One kickoff per mounted slot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.pendingResumeOffer && input.resume) resolveResumeChoice('resume');
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

  useEffect(() => {
    if (input.signal.aborted) return;
    const onAbort = (): void => {
      if (finished.current) return;
      finished.current = true;
      onDone({ status: 'failed', detail: 'cancelled' });
    };
    input.signal.addEventListener('abort', onAbort);
    return () => input.signal.removeEventListener('abort', onAbort);
  }, [input.signal, onDone]);

  return <></>;
}
