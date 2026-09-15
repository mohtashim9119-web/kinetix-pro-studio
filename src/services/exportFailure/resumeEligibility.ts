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

/**
 * Ruling A (WS3 Batch 2, owner ruling) — the modal renders at MOST one
 * primary action. First match wins, in this fixed order:
 *   1 asset_missing        -> open-recovery
 *   2 timeline_gap         -> repair-timeline
 *   3 disk_full preflight  -> reclaim
 *   4 retention evidence   -> resume
 *   5 cancelled            -> none (Close only, no unavailable card)
 *   6 no match             -> none (Close + inline ExportResumeUnavailableCard)
 *
 * A remedy that addresses the CAUSE of the failure always outranks Resume —
 * resuming a project with missing assets or a timeline gap just fails again
 * at the same point, so rows 1-3 sit above row 4 even when retention
 * evidence exists. `kind === 'cancelled'` is distinguished from the other
 * `none` case only by the caller (no unavailable card for a plain cancel).
 */
export type PrimarySlot =
  | 'open-recovery'
  | 'repair-timeline'
  | 'reclaim'
  | 'resume'
  | 'none';

export function resolvePrimarySlot(input: ExportFailurePresentationInput): PrimarySlot {
  if (input.kind === 'asset_missing') return 'open-recovery';
  if (input.kind === 'timeline_gap') return 'repair-timeline';
  if (input.kind === 'disk_full' && input.diskFullVariant === 'preflight') return 'reclaim';
  // Row 5 — cancelled never offers Resume regardless of retention evidence
  // (isNeverResumeKind also covers asset_missing, already handled above by
  // row 1, so this is only additive for `cancelled` here).
  if (isNeverResumeKind(input.kind)) return 'none';
  if (isResumeEligible(input)) return 'resume';
  return 'none';
}

export interface ExportFailurePresentation {
  title: string;
  body: string;
  hardwareNote: string | null;
  primarySlot: PrimarySlot;
  /** Derived convenience flag — `primarySlot === 'resume'`. */
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
  const primarySlot = resolvePrimarySlot(input);
  const offerResume = primarySlot === 'resume';

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

  const showDegradedRecovery = primarySlot === 'open-recovery';
  // Row 5 (cancelled) renders no unavailable card — Close only. Row 6 (no
  // match) does. `isNeverResumeKind` still includes asset_missing, but that
  // kind never reaches here with primarySlot === 'none' (row 1 wins first).
  const showResumeUnavailable = primarySlot === 'none' && input.kind !== 'cancelled';

  return {
    title,
    body,
    hardwareNote: hardwareNoteFor(input),
    primarySlot,
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
