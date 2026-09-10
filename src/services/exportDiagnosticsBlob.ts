/**
 * WS3 Tier 1 item 4 — the operator-visible "Copy diagnostics" blob, pulled
 * out of App.tsx's click handler into a pure function so it is unit-testable.
 *
 * This has been the exact hop two prior classes of bug were lost at:
 * `phaseLogTail`, then the flush fields, existed on `ExportWorkerDiagnostics`
 * but had no route into `ExportLivenessSnapshot`, so this blob showed them
 * as absent even on a perfectly healthy worker. Both are fixed now
 * (`ExportLivenessSnapshot.phaseLogTail`/`.appendLedger`), but the CLASS of
 * bug — a field that exists on the type and is populated at one construction
 * site, dropped at another — is only caught by a test that walks the real
 * shape, not by fixing the two known instances. See
 * `exportDiagnosticsBlob.test.ts`'s completeness test.
 */
import type { ExportError } from './exportPipeline';
import type { ExportResolution, ExportFps } from '../hooks/useExport';

export interface ExportDiagnosticsProjectMeta {
  segmentCount: number;
  hasVoiceover: boolean;
  exportResolution: ExportResolution;
  exportFps: ExportFps;
  ts: string;
}

/**
 * Built from `ExportError` + `ExportLivenessSnapshot` ONLY — no worker-only
 * diagnostic field reaches this blob no matter how healthy the worker was
 * when the failure was recorded (see `ExportLivenessSnapshot`'s own doc).
 * `liveness` carries the full snapshot; the flattened top-level copies below
 * are a convenience for a quick glance at the pasted JSON, never the
 * completeness guarantee — that's `liveness` itself.
 */
export function buildExportDiagnosticsBlob(
  err: ExportError,
  projectMeta: ExportDiagnosticsProjectMeta,
): Record<string, unknown> {
  return {
    error: err,
    liveness: err.liveness ?? null,
    lastPhase: err.liveness?.lastPhase ?? null,
    msSinceLastPhaseChange: err.liveness?.msSinceLastPhaseChange ?? null,
    pieceIndex: err.liveness?.pieceIndex ?? null,
    framesEncoded: err.liveness?.framesEncoded ?? null,
    maxSilentMs: err.liveness?.maxSilentMs ?? null,
    failureVia: err.liveness?.failureVia ?? null,
    appendLedger: err.liveness?.appendLedger ?? null,
    phaseLogTail: err.liveness?.phaseLogTail ?? null,
    projectMeta,
  };
}
