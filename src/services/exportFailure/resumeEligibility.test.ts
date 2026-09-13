import { describe, it, expect } from 'vitest';
import type { ExportErrorKind } from '../exportPipeline';
import {
  destroySessionDestroyedDisposition,
  isResumeEligible,
  resolveExportFailurePresentation,
  retainForResumeDestroyedDisposition,
  retainedForResumeDisposition,
  shouldOfferResume,
} from './resumeEligibility';

const ELIGIBLE = {
  retentionAttempted: true,
  sessionDisposition: retainedForResumeDisposition(1_024, '/tmp/kinetix-export-1'),
  manifestPresent: true,
};

const RESUME_CAPABLE_KINDS = [
  'disk_full',
  'encode',
  'concat',
  'mux',
  'unknown',
  'destination_path',
  'timeline_gap',
  'ffmpeg_load',
  'grade_loss_refused',
] as const satisfies readonly ExportErrorKind[];

describe('isResumeEligible — retention evidence, not kind', () => {
  it('is true only when attempted + retainForResume/retained + manifest', () => {
    expect(isResumeEligible(ELIGIBLE)).toBe(true);
  });

  it('is false when retention was never attempted', () => {
    expect(isResumeEligible({ ...ELIGIBLE, retentionAttempted: false })).toBe(false);
  });

  it('is false when the manifest is absent even if retainForResume says retained', () => {
    expect(isResumeEligible({ ...ELIGIBLE, manifestPresent: false })).toBe(false);
  });

  it('does not treat retainForResume.destroyed as resume — even with a manifest (diagnostic log: retained_bytes=0)', () => {
    expect(isResumeEligible({
      retentionAttempted: true,
      sessionDisposition: retainForResumeDestroyedDisposition('/tmp/kinetix-export-1'),
      manifestPresent: true,
    })).toBe(false);
  });

  it('does not treat destroySession.destroyed as resume — same raw string, different enum', () => {
    const retainDestroyed = retainForResumeDestroyedDisposition('/tmp/a');
    const destroyDestroyed = destroySessionDestroyedDisposition();
    expect(retainDestroyed.disposition).toBe('destroyed');
    expect(destroyDestroyed.disposition).toBe('destroyed');
    expect(retainDestroyed.source).not.toBe(destroyDestroyed.source);
    expect(isResumeEligible({
      retentionAttempted: true,
      sessionDisposition: destroyDestroyed,
      manifestPresent: true,
    })).toBe(false);
  });
});

describe('shouldOfferResume — both branches for every resume-capable kind', () => {
  it.each(RESUME_CAPABLE_KINDS)('%s offers Resume when retention evidence is complete', (kind) => {
    expect(shouldOfferResume(kind, ELIGIBLE, kind === 'disk_full' ? 'mid-export' : undefined)).toBe(true);
  });

  it.each(RESUME_CAPABLE_KINDS)('%s hides Resume when destroySession emitted destroyed', (kind) => {
    expect(shouldOfferResume(kind, {
      retentionAttempted: true,
      sessionDisposition: destroySessionDestroyedDisposition(),
      manifestPresent: false,
    }, kind === 'disk_full' ? 'mid-export' : undefined)).toBe(false);
  });

  it.each(['cancelled', 'asset_missing'] as const)(
    '%s never offers Resume even with complete retention evidence',
    (kind) => {
      expect(shouldOfferResume(kind, ELIGIBLE)).toBe(false);
    },
  );

  it('disk_full preflight never offers Resume — nothing was encoded', () => {
    expect(shouldOfferResume('disk_full', ELIGIBLE, 'preflight')).toBe(false);
  });
});

describe('resolveExportFailurePresentation', () => {
  it('routes asset_missing to degraded recovery and forbids save', () => {
    const view = resolveExportFailurePresentation({ kind: 'asset_missing', ...ELIGIBLE });
    expect(view.showDegradedRecovery).toBe(true);
    expect(view.offerResume).toBe(false);
    expect(view.showSave).toBe(false);
  });

  it('uses the preflight disk card without resume-unavailable', () => {
    const view = resolveExportFailurePresentation({
      kind: 'disk_full',
      diskFullVariant: 'preflight',
      retentionAttempted: false,
      manifestPresent: false,
    });
    expect(view.showPreflightDisk).toBe(true);
    expect(view.offerResume).toBe(false);
    expect(view.showResumeUnavailable).toBe(false);
    expect(view.title).toMatch(/start/i);
  });

  it('shows resume-unavailable on a mid-export failure with no retention', () => {
    const view = resolveExportFailurePresentation({
      kind: 'mux',
      retentionAttempted: true,
      sessionDisposition: destroySessionDestroyedDisposition(),
      manifestPresent: false,
    });
    expect(view.offerResume).toBe(false);
    expect(view.showResumeUnavailable).toBe(true);
  });

  it('mentions hardware only when evidence supports it', () => {
    const bare = resolveExportFailurePresentation({ kind: 'encode', ...ELIGIBLE });
    expect(bare.hardwareNote).toBeNull();
    const failedOver = resolveExportFailurePresentation({
      kind: 'encode',
      ...ELIGIBLE,
      hardwareFailoverUsed: true,
    });
    expect(failedOver.hardwareNote).toMatch(/hardware encoding/i);
    const contextLost = resolveExportFailurePresentation({
      kind: 'encode',
      ...ELIGIBLE,
      failureVia: 'gl-context-lost',
    });
    expect(contextLost.hardwareNote).toMatch(/graphics context/i);
    const watchdog = resolveExportFailurePresentation({
      kind: 'encode',
      ...ELIGIBLE,
      failureVia: 'watchdog',
    });
    expect(watchdog.hardwareNote).toBeNull();
  });
});
