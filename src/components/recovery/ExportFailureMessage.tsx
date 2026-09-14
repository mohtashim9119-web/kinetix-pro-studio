/**
 * Export-failure message layer — presentation only.
 *
 * Copy comes from the total `EXPORT_FAILURE_COPY` record. Resume is derived
 * from retention evidence inside this tree, never from `kind === 'disk_full'`.
 * Raw errors, stacks, panics, and disposition strings live only under
 * Technical details.
 */

import React from 'react';
import type { ExportError, ExportErrorKind } from '../../services/exportPipeline';
import { formatBytes } from '../../services/webcodecsExport/diskFull';
import {
  resolveExportFailurePresentation,
  type DiskFullCardVariant,
} from '../../services/exportFailure/resumeEligibility';
import { ExportResumeUnavailableCard } from './ExportResumeUnavailableCard';

export interface ExportFailureMessageProps {
  kind: ExportErrorKind;
  retentionAttempted: boolean;
  sessionDisposition?: ExportError['sessionDisposition'] | null;
  manifestPresent: boolean;
  diskFullVariant?: DiskFullCardVariant;
  requiredBytes?: number;
  availableBytes?: number;
  reclaimableBytes?: number;
  /** Caller-owned. This view does not compare required vs available. */
  showReclaimAction?: boolean;
  hardwareFailoverUsed?: boolean;
  failureVia?: string | null;
  rawError?: string | null;
  stack?: string | null;
  panicText?: string | null;
  onResume?: () => void;
  onReclaim?: () => void;
  onOpenDegradedRecovery?: () => void;
  onRepairTimeline?: () => void;
  onCopyDiagnostics?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function ExportFailureMessage({
  kind,
  retentionAttempted,
  sessionDisposition,
  manifestPresent,
  diskFullVariant,
  requiredBytes,
  availableBytes,
  reclaimableBytes,
  showReclaimAction = false,
  hardwareFailoverUsed,
  failureVia,
  rawError,
  stack,
  panicText,
  onResume,
  onReclaim,
  onOpenDegradedRecovery,
  onRepairTimeline,
  onCopyDiagnostics,
  onRetry,
  onDismiss,
}: ExportFailureMessageProps): React.ReactElement {
  const presentation = resolveExportFailurePresentation({
    kind,
    retentionAttempted,
    sessionDisposition,
    manifestPresent,
    diskFullVariant,
    hardwareFailoverUsed,
    failureVia,
  });

  const technicalLines = [
    `kind=${kind}`,
    `retentionAttempted=${String(retentionAttempted)}`,
    `manifestPresent=${String(manifestPresent)}`,
    sessionDisposition
      ? `sessionDisposition.source=${sessionDisposition.source}`
      : 'sessionDisposition=(absent)',
    sessionDisposition
      ? `sessionDisposition.disposition=${sessionDisposition.disposition}`
      : null,
    failureVia ? `failureVia=${failureVia}` : null,
    rawError ? `rawError=${rawError}` : null,
    stack ? `stack=${stack}` : null,
    panicText ? `panic=${panicText}` : null,
  ].filter((line): line is string => line !== null);

  return (
    <div
      data-testid="export-failure-message"
      data-kind={kind}
      data-offer-resume={presentation.offerResume ? 'true' : 'false'}
      className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-md shadow-2xl"
    >
      <div data-testid="export-failure-primary">
        <h2
          data-testid="export-failure-title"
          className="text-sm font-black uppercase tracking-[0.2em] mb-3"
        >
          {presentation.title}
        </h2>
        <p data-testid="export-failure-body" className="text-[11px] text-gray-300 mb-4">
          {presentation.body}
        </p>
        {presentation.hardwareNote && (
          <p data-testid="export-failure-hardware" className="text-[11px] text-gray-400 mb-4">
            {presentation.hardwareNote}
          </p>
        )}

        {presentation.showPreflightDisk && (
          <dl data-testid="export-failure-preflight-disk" className="space-y-2 mb-4">
            <ByteRow testId="export-failure-required" label="Required" bytes={requiredBytes} />
            <ByteRow testId="export-failure-available" label="Available" bytes={availableBytes} />
            <ByteRow testId="export-failure-reclaimable" label="Reclaimable" bytes={reclaimableBytes} />
          </dl>
        )}

        {presentation.showResumeUnavailable && <div className="mb-4"><ExportResumeUnavailableCard /></div>}

        <div className="flex flex-col gap-2 mb-4">
          {presentation.offerResume && (
            <button
              type="button"
              data-testid="export-failure-resume"
              onClick={() => onResume?.()}
              className="w-full bg-[#F27D26] text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all"
            >
              Resume
            </button>
          )}
          {presentation.showPreflightDisk && showReclaimAction && (
            <button
              type="button"
              data-testid="export-failure-reclaim"
              onClick={() => onReclaim?.()}
              className="w-full bg-transparent border border-[#282828] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:border-gray-500 transition-all"
            >
              Reclaim
            </button>
          )}
          {presentation.showDegradedRecovery && (
            <button
              type="button"
              data-testid="export-failure-open-recovery"
              onClick={() => onOpenDegradedRecovery?.()}
              className="w-full bg-[#F27D26] text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all"
            >
              Open project recovery
            </button>
          )}
          {kind === 'timeline_gap' && onRepairTimeline && (
            <button
              type="button"
              data-testid="export-failure-repair-timeline"
              onClick={() => onRepairTimeline()}
              className="w-full bg-[#F27D26] text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all"
            >
              Repair timeline
            </button>
          )}
          {kind !== 'cancelled' && onCopyDiagnostics && (
            <button
              type="button"
              data-testid="export-failure-copy-diagnostics"
              onClick={() => onCopyDiagnostics()}
              className="w-full bg-transparent border border-[#282828] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:border-gray-500 transition-all"
            >
              Copy diagnostics
            </button>
          )}
          {kind !== 'cancelled' && onRetry && (
            <button
              type="button"
              data-testid="export-failure-retry"
              onClick={() => onRetry()}
              className="w-full bg-[#F27D26] text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all"
            >
              Retry
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              data-testid="export-failure-dismiss"
              onClick={() => onDismiss()}
              className="w-full bg-transparent border border-[#282828] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:border-gray-500 transition-all"
            >
              {kind === 'cancelled' ? 'Dismiss' : 'Cancel'}
            </button>
          )}
        </div>
      </div>

      <details data-testid="export-failure-technical" className="text-left">
        <summary className="text-[9px] font-black uppercase tracking-widest text-gray-600 cursor-pointer">
          Technical details
        </summary>
        <pre
          data-testid="export-failure-technical-body"
          className="mt-2 text-[10px] text-gray-500 whitespace-pre-wrap break-all"
        >
          {technicalLines.join('\n')}
        </pre>
      </details>
    </div>
  );
}

function ByteRow({
  testId,
  label,
  bytes,
}: {
  testId: string;
  label: string;
  bytes: number | undefined;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[8px] uppercase tracking-widest text-gray-600">{label}</dt>
      <dd data-testid={testId} className="text-[11px] font-bold text-gray-200">
        {bytes === undefined ? '—' : formatBytes(bytes)}
      </dd>
    </div>
  );
}
