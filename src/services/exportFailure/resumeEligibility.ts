/**
 * Resume is gated on retention evidence, never on `ExportError.kind`.
 *
 * `retainForResume` and `destroySession` both emit the string `destroyed`
 * from different enums. Never treat `disposition === 'destroyed'` as a
 * signal either way — require `source: 'retainForResume'` AND
 * `disposition: 'retained'` AND a confirmed manifest.
 */

import type { ExportError, ExportErrorKind } from '../exportPipeline';
import {
  EXPORT_FAILURE_COPY,
  GRAPHICS_CONTEXT_LOST_NOTE,
  HARDWARE_FAILOVER_NOTE,
  isNeverResumeKind,
} from './exportFailureCopy';

export type DiskFullCardVariant = 'preflight' | 'mid-export';

export interface RetentionEvidence {
  retentionAttempted: boolean;
  sessionDisposition?: ExportError['sessionDisposition'] | null;
  /** Independent post-hoc reading: `diskStateAfterFailure.manifestPresent`. */
  manifestPresent: boolean;
}

export function isResumeEligible(evidence: RetentionEvidence): boolean {
  if (evidence.retentionAttempted !== true) return false;
  const disposition = evidence.sessionDisposition;
  if (!disposition || disposition.source !== 'retainForResume') return false;
  if (disposition.disposition !== 'retained') return false;
  return evidence.manifestPresent === true;
}

export function shouldOfferResume(
  kind: ExportErrorKind,
  evidence: RetentionEvidence,
  diskFullVariant?: DiskFullCardVariant,
): boolean {
  if (isNeverResumeKind(kind)) return false;
  if (kind === 'disk_full' && diskFullVariant === 'preflight') return false;
  return isResumeEligible(evidence);
}

export function shouldMentionHardware(input: {
  hardwareFailoverUsed?: boolean;
  failureVia?: string | null;
}): boolean {
  return input.hardwareFailoverUsed === true || input.failureVia === 'gl-context-lost';
}

export function hardwareNoteFor(input: {
  hardwareFailoverUsed?: boolean;
  failureVia?: string | null;
}): string | null {
  if (input.hardwareFailoverUsed === true) return HARDWARE_FAILOVER_NOTE;
  if (input.failureVia === 'gl-context-lost') return GRAPHICS_CONTEXT_LOST_NOTE;
  return null;
}

export interface ExportFailurePresentationInput extends RetentionEvidence {
  kind: ExportErrorKind;
  diskFullVariant?: DiskFullCardVariant;
  hardwareFailoverUsed?: boolean;
  failureVia?: string | null;
}

export interface ExportFailurePresentation {
  title: string;
  body: string;
  hardwareNote: string | null;
  offerResume: boolean;
  showResumeUnavailable: boolean;
  showDegradedRecovery: boolean;
  showPreflightDisk: boolean;
  showSave: false;
}

export function resolveExportFailurePresentation(
  input: ExportFailurePresentationInput,
): ExportFailurePresentation {
  const copy = EXPORT_FAILURE_COPY[input.kind];
  const preflight = input.kind === 'disk_full' && input.diskFullVariant === 'preflight';
  const offerResume = shouldOfferResume(input.kind, input, input.diskFullVariant);

  let title: string = copy.title;
  let body: string = copy.body;
  if (input.kind === 'disk_full') {
    const disk = EXPORT_FAILURE_COPY.disk_full;
    if (preflight) {
      title = disk.preflightTitle;
      body = disk.preflightBody;
    } else if (input.diskFullVariant === 'mid-export') {
      title = disk.midExportTitle;
      body = disk.midExportBody;
    }
  }

  const showDegradedRecovery = input.kind === 'asset_missing';
  const showResumeUnavailable =
    !offerResume &&
    !isNeverResumeKind(input.kind) &&
    !preflight;

  return {
    title,
    body,
    hardwareNote: hardwareNoteFor(input),
    offerResume,
    showResumeUnavailable,
    showDegradedRecovery,
    showPreflightDisk: preflight,
    showSave: false,
  };
}

export function retainedForResumeDisposition(
  retainedBytes: number,
  path: string,
): NonNullable<ExportError['sessionDisposition']> {
  return {
    source: 'retainForResume',
    disposition: 'retained',
    retainedBytes,
    reclaimedBytes: 0,
    path,
  };
}

export function retainForResumeDestroyedDisposition(
  path: string,
): NonNullable<ExportError['sessionDisposition']> {
  return {
    source: 'retainForResume',
    disposition: 'destroyed',
    retainedBytes: 0,
    reclaimedBytes: 0,
    path,
  };
}

export function destroySessionDestroyedDisposition(): NonNullable<ExportError['sessionDisposition']> {
  return { source: 'destroySession', disposition: 'destroyed' };
}
