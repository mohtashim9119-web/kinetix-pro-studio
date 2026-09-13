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
    // WS3 Round 20 — fsyncs degraded to "written, not confirmed durable"
    // during the failed run (see `ExportError.durabilityWarnings`).
    durabilityWarnings: err.durabilityWarnings ?? null,
    // PROMPT 28 STEP 1/3 — path choice + GPU capability, flattened
    // top-level same as `appendLedger`/`gpuCapability` above it: `liveness`
    // itself is the completeness guarantee, these are a quick-glance copy.
    exportPathSelection: err.liveness?.exportPathSelection ?? null,
    gpuCapability: err.liveness?.gpuCapability ?? null,
    // PROMPT 28 STEP 2 (CRITICAL) — present only when this run was refused
    // before any encoding started because a segment's color grade would
    // have been silently dropped. See `ExportError.gradeLossRefusal`.
    gradeLossRefusal: err.gradeLossRefusal ?? null,
    // WS3 (diagnostic logging) — the W23 cross-check trio: whether
    // retention was even attempted, the native disposition whichever call
    // (retainForResume or destroySession) actually ran, and an independent
    // post-hoc read of what's really on disk. See `ExportError`'s own doc
    // comments for why `sessionDisposition.source` must be checked before
    // its `disposition` string is compared against either native enum.
    retentionAttempted: err.retentionAttempted ?? null,
    sessionDisposition: err.sessionDisposition ?? null,
    diskStateAfterFailure: err.diskStateAfterFailure ?? null,
    projectMeta,
  };
}
