// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { ExportErrorKind } from '../../services/exportPipeline';
import { formatBytes } from '../../services/webcodecsExport/diskFull';
import {
  destroySessionDestroyedDisposition,
  retainForResumeDestroyedDisposition,
  retainedForResumeDisposition,
} from '../../services/exportFailure/resumeEligibility';
import { ExportFailureMessage, type ExportFailureMessageProps } from './ExportFailureMessage';
import { createExportFailureActionsFake } from './exportFailureActionsFake';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const RAW_ERROR = 'thread panicked at src/ffmpeg.rs:442: assertion failed: offset < len';
const STACK = 'Error: boom\n    at encode (exportWorker.ts:12:3)\n    at driveGlRun (exportPipelineWebCodecs.ts:9:1)';
const PANIC = 'PANIC: index out of bounds — rustc abort';

const ELIGIBLE = {
  retentionAttempted: true,
  sessionDisposition: retainedForResumeDisposition(4_096, '/sessions/kinetix-export-kept'),
  manifestPresent: true,
};

// Ruling A — timeline_gap is deliberately excluded here: its primary slot is
// always `repair-timeline` (row 2), which outranks Resume (row 4) even when
// retention evidence is eligible. Same reasoning would exclude asset_missing,
// but that kind is already covered separately (isNeverResumeKind).
const RESUME_CAPABLE_KINDS = [
  'disk_full',
  'encode',
  'concat',
  'mux',
  'unknown',
  'destination_path',
  'ffmpeg_load',
  'grade_loss_refused',
] as const satisfies readonly ExportErrorKind[];

const MACHINE_1_DESTROYED_DISK_FULL_FAILURES = Array.from(
  { length: 12 },
  (_, index) => ({
    label: `Machine 1 disk_full failure ${index + 1}`,
    retentionAttempted: true,
    sessionDisposition: {
      source: 'retainForResume' as const,
      disposition: 'destroyed',
      retainedBytes: 0,
      reclaimedBytes: 0,
      path: `/sessions/machine-1-disk-full-${index + 1}`,
    },
    manifestPresent: false,
  }),
);

async function renderMessage(
  over: Partial<ExportFailureMessageProps> & Pick<ExportFailureMessageProps, 'kind'>,
): Promise<ReturnType<typeof createExportFailureActionsFake>> {
  const fake = createExportFailureActionsFake();
  const props: ExportFailureMessageProps = {
    retentionAttempted: false,
    manifestPresent: false,
    rawError: RAW_ERROR,
    stack: STACK,
    panicText: PANIC,
    onResume: fake.onResume,
    onReclaim: fake.onReclaim,
    onOpenDegradedRecovery: fake.onOpenDegradedRecovery,
    onRepairTimeline: fake.onRepairTimeline,
    onDismiss: fake.onDismiss,
    onCopyDiagnostics: fake.onCopyDiagnostics,
    ...over,
  };
  root = createRoot(container);
  await act(async () => {
    root.render(<ExportFailureMessage {...props} />);
  });
  return fake;
}

function primaryText(): string {
  return container.querySelector('[data-testid="export-failure-primary"]')?.textContent ?? '';
}

describe('ExportFailureMessage — raw diagnostics stay collapsed', () => {
  it('keeps raw error, stack, and panic out of the primary body', async () => {
    await renderMessage({ kind: 'unknown', ...ELIGIBLE });
    const primary = primaryText();
    expect(primary).not.toContain(RAW_ERROR);
    expect(primary).not.toContain(STACK);
    expect(primary).not.toContain(PANIC);
    expect(primary).not.toContain('ffmpeg.rs:442');
    expect(primary).not.toContain('PANIC');
    expect(container.querySelector('[data-testid="export-failure-body"]')?.textContent)
      .not.toMatch(/destroyed|retained_bytes|assertion failed/i);

    const details = container.querySelector('[data-testid="export-failure-technical-body"]')?.textContent ?? '';
    expect(details).toContain(RAW_ERROR);
    expect(details).toContain(STACK);
    expect(details).toContain(PANIC);
  });
});

describe('ExportFailureMessage — Resume from evidence, both branches per kind', () => {
  it.each(RESUME_CAPABLE_KINDS)('%s shows Resume when retainForResume retained a manifest', async (kind) => {
    const fake = await renderMessage({
      kind,
      ...ELIGIBLE,
      diskFullVariant: kind === 'disk_full' ? 'mid-export' : undefined,
    });
    const resume = container.querySelector<HTMLButtonElement>('[data-testid="export-failure-resume"]');
    expect(resume).not.toBeNull();
    expect(primaryText()).toMatch(/resume/i);
    await act(async () => { resume!.click(); });
    expect(fake.resumeCount).toBe(1);
  });

  it.each(RESUME_CAPABLE_KINDS)('%s hides Resume when destroySession emitted destroyed', async (kind) => {
    await renderMessage({
      kind,
      retentionAttempted: true,
      sessionDisposition: destroySessionDestroyedDisposition(),
      manifestPresent: false,
      diskFullVariant: kind === 'disk_full' ? 'mid-export' : undefined,
    });
    expect(container.querySelector('[data-testid="export-failure-resume"]')).toBeNull();
    expect(container.querySelector('[data-testid="export-resume-unavailable"]')).not.toBeNull();
  });

  it('does not show Resume for retainForResume.destroyed + retained_bytes=0 (the diagnostic-log case)', async () => {
    await renderMessage({
      kind: 'disk_full',
      diskFullVariant: 'mid-export',
      retentionAttempted: true,
      sessionDisposition: retainForResumeDestroyedDisposition('/sessions/gone'),
      manifestPresent: false,
    });
    expect(container.querySelector('[data-testid="export-failure-resume"]')).toBeNull();
    expect(container.querySelector('[data-testid="export-resume-unavailable"]')).not.toBeNull();
  });

  it.each(MACHINE_1_DESTROYED_DISK_FULL_FAILURES)(
    '$label hides Resume for disposition=destroyed and retained_bytes=0',
    async (failure) => {
      await renderMessage({
        kind: 'disk_full',
        diskFullVariant: 'mid-export',
        retentionAttempted: failure.retentionAttempted,
        sessionDisposition: failure.sessionDisposition,
        manifestPresent: failure.manifestPresent,
      });
      expect(container.querySelector('[data-testid="export-failure-resume"]')).toBeNull();
      expect(container.querySelector('[data-testid="export-resume-unavailable"]')).not.toBeNull();
    },
  );

  it.each(['cancelled', 'asset_missing'] as const)('%s never shows Resume', async (kind) => {
    await renderMessage({ kind, ...ELIGIBLE });
    expect(container.querySelector('[data-testid="export-failure-resume"]')).toBeNull();
  });
});

describe('ExportFailureMessage — disk_full cards', () => {
  it('preflight shows required / available / reclaimable from props and a reclaim action', async () => {
    const fake = await renderMessage({
      kind: 'disk_full',
      diskFullVariant: 'preflight',
      requiredBytes: 5_450_000_000,
      availableBytes: 120_000_000,
      reclaimableBytes: 400_000_000,
      showReclaimAction: true,
      retentionAttempted: false,
      manifestPresent: false,
    });
    expect(container.querySelector('[data-testid="export-failure-preflight-disk"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="export-failure-required"]')?.textContent)
      .toBe(formatBytes(5_450_000_000));
    expect(container.querySelector('[data-testid="export-failure-available"]')?.textContent)
      .toBe(formatBytes(120_000_000));
    expect(container.querySelector('[data-testid="export-failure-reclaimable"]')?.textContent)
      .toBe(formatBytes(400_000_000));
    expect(container.querySelector('[data-testid="export-failure-resume"]')).toBeNull();
    const reclaim = container.querySelector<HTMLButtonElement>('[data-testid="export-failure-reclaim"]');
    expect(reclaim).not.toBeNull();
    await act(async () => { reclaim!.click(); });
    expect(fake.reclaimCount).toBe(1);
  });

  it('preflight hides Reclaim when showReclaimAction is false, even if the numbers would fit', async () => {
    await renderMessage({
      kind: 'disk_full',
      diskFullVariant: 'preflight',
      requiredBytes: 100,
      availableBytes: 40,
      reclaimableBytes: 80,
      showReclaimAction: false,
      retentionAttempted: false,
      manifestPresent: false,
    });
    expect(container.querySelector('[data-testid="export-failure-reclaim"]')).toBeNull();
  });
});

describe('ExportFailureMessage — asset_missing', () => {
  it('never offers Resume or Save and routes to degraded recovery', async () => {
    const fake = await renderMessage({ kind: 'asset_missing', ...ELIGIBLE });
    expect(container.querySelector('[data-testid="export-failure-resume"]')).toBeNull();
    expect(container.querySelector('[data-testid="recovery-save"]')).toBeNull();
    expect(primaryText()).not.toMatch(/\bSave\b/);
    const open = container.querySelector<HTMLButtonElement>('[data-testid="export-failure-open-recovery"]');
    expect(open).not.toBeNull();
    await act(async () => { open!.click(); });
    expect(fake.openDegradedRecoveryCount).toBe(1);
  });
});

describe('ExportFailureMessage — Ruling A primary-slot ladder (a remedy for the cause outranks Resume)', () => {
  it('timeline_gap shows Repair timeline, never Resume, even with eligible retention evidence', async () => {
    const fake = await renderMessage({ kind: 'timeline_gap', ...ELIGIBLE });
    expect(container.querySelector('[data-testid="export-failure-resume"]')).toBeNull();
    const repair = container.querySelector<HTMLButtonElement>('[data-testid="export-failure-repair-timeline"]');
    expect(repair).not.toBeNull();
    await act(async () => { repair!.click(); });
    expect(fake.repairTimelineCount).toBe(1);
    expect(fake.resumeCount).toBe(0);
  });

  it('asset_missing outranks eligible resume evidence too (row 1 over row 4)', async () => {
    await renderMessage({ kind: 'asset_missing', ...ELIGIBLE });
    expect(container.querySelector('[data-testid="export-failure-open-recovery"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="export-failure-resume"]')).toBeNull();
  });

  it('disk_full preflight shows Reclaim, never Resume, even with eligible retention evidence', async () => {
    await renderMessage({
      kind: 'disk_full',
      diskFullVariant: 'preflight',
      showReclaimAction: true,
      reclaimableBytes: 400_000_000,
      ...ELIGIBLE,
    });
    expect(container.querySelector('[data-testid="export-failure-reclaim"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="export-failure-resume"]')).toBeNull();
  });

  it('cancelled renders no primary action and no unavailable card — Close only', async () => {
    await renderMessage({ kind: 'cancelled', retentionAttempted: false, manifestPresent: false });
    expect(container.querySelector('[data-testid="export-failure-resume"]')).toBeNull();
    expect(container.querySelector('[data-testid="export-failure-reclaim"]')).toBeNull();
    expect(container.querySelector('[data-testid="export-failure-repair-timeline"]')).toBeNull();
    expect(container.querySelector('[data-testid="export-failure-open-recovery"]')).toBeNull();
    expect(container.querySelector('[data-testid="export-resume-unavailable"]')).toBeNull();
    expect(container.querySelector('[data-testid="export-failure-dismiss"]')).not.toBeNull();
  });

  it('no-match kind (row 6) renders the inline unavailable card, not a blank primary row', async () => {
    await renderMessage({ kind: 'encode', retentionAttempted: false, manifestPresent: false });
    expect(container.querySelector('[data-testid="export-failure-resume"]')).toBeNull();
    expect(container.querySelector('[data-testid="export-resume-unavailable"]')).not.toBeNull();
  });

  it('never renders a Retry button, for any kind, and the prop no longer exists on the type', async () => {
    const kinds: ExportErrorKind[] = [
      'disk_full', 'encode', 'concat', 'mux', 'unknown', 'destination_path',
      'asset_missing', 'timeline_gap', 'ffmpeg_load', 'grade_loss_refused',
      'resume_adoption_failed', 'cancelled',
    ];
    for (const kind of kinds) {
      await renderMessage({ kind, ...ELIGIBLE });
      expect(container.querySelector('[data-testid="export-failure-retry"]')).toBeNull();
      expect(primaryText()).not.toMatch(/\bRetry\b/);
      act(() => { root.unmount(); });
      container.remove();
      container = document.createElement('div');
      document.body.appendChild(container);
    }
    // Compile-time guard: this line would fail to typecheck if `onRetry`
    // still existed on ExportFailureMessageProps.
    const props: Record<string, unknown> = { kind: 'unknown' };
    expect('onRetry' in props).toBe(false);
  });
});

describe('ExportFailureMessage — Ruling B: reclaimable-bytes pending/resolved stability', () => {
  it('renders Reclaim disabled with pending copy while the byte count is in flight, then keeps the SAME slot once resolved', async () => {
    const fake = createExportFailureActionsFake();
    const baseProps: ExportFailureMessageProps = {
      kind: 'disk_full',
      diskFullVariant: 'preflight',
      showReclaimAction: true,
      retentionAttempted: false,
      manifestPresent: false,
      reclaimablePending: true,
      reclaimableBytes: undefined,
      onReclaim: fake.onReclaim,
    };
    root = createRoot(container);
    await act(async () => { root.render(<ExportFailureMessage {...baseProps} />); });

    let reclaim = container.querySelector<HTMLButtonElement>('[data-testid="export-failure-reclaim"]');
    expect(reclaim).not.toBeNull();
    expect(reclaim!.disabled).toBe(true);
    expect(reclaim!.textContent).toMatch(/checking/i);
    // No fallthrough to another ladder row while pending.
    expect(container.querySelector('[data-testid="export-resume-unavailable"]')).toBeNull();

    // Transition: pending resolves to a nonzero count.
    await act(async () => {
      root.render(<ExportFailureMessage {...baseProps} reclaimablePending={false} reclaimableBytes={400_000_000} />);
    });
    reclaim = container.querySelector<HTMLButtonElement>('[data-testid="export-failure-reclaim"]');
    expect(reclaim).not.toBeNull(); // same testid — slot identity did not change
    expect(reclaim!.disabled).toBe(false);
    expect(reclaim!.textContent).toMatch(/reclaim/i);
    await act(async () => { reclaim!.click(); });
    expect(fake.reclaimCount).toBe(1);
  });

  it('keeps Reclaim in the primary slot, disabled, when the resolved count is zero — never falls through', async () => {
    const baseProps: ExportFailureMessageProps = {
      kind: 'disk_full',
      diskFullVariant: 'preflight',
      showReclaimAction: true,
      retentionAttempted: false,
      manifestPresent: false,
      reclaimablePending: true,
      reclaimableBytes: undefined,
    };
    root = createRoot(container);
    await act(async () => { root.render(<ExportFailureMessage {...baseProps} />); });
    await act(async () => {
      root.render(<ExportFailureMessage {...baseProps} reclaimablePending={false} reclaimableBytes={0} />);
    });
    const reclaim = container.querySelector<HTMLButtonElement>('[data-testid="export-failure-reclaim"]');
    expect(reclaim).not.toBeNull();
    expect(reclaim!.disabled).toBe(true);
    expect(container.querySelector('[data-testid="export-failure-reclaim-none"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="export-resume-unavailable"]')).toBeNull();
    expect(container.querySelector('[data-testid="export-failure-resume"]')).toBeNull();
  });
});

describe('ExportFailureMessage — Close is a plain dismiss, on every variant', () => {
  it('Close triggers only onDismiss — no resume/reclaim/repair/recovery side effect fires', async () => {
    const fake = await renderMessage({ kind: 'mux', ...ELIGIBLE });
    const close = container.querySelector<HTMLButtonElement>('[data-testid="export-failure-dismiss"]');
    expect(close).not.toBeNull();
    await act(async () => { close!.click(); });
    expect(fake.dismissCount).toBe(1);
    expect(fake.resumeCount).toBe(0);
    expect(fake.reclaimCount).toBe(0);
    expect(fake.repairTimelineCount).toBe(0);
    expect(fake.openDegradedRecoveryCount).toBe(0);
  });

  it('Close is present alongside every primary slot kind, never replacing it', async () => {
    for (const kind of ['asset_missing', 'timeline_gap', 'mux'] as const) {
      await renderMessage({ kind, ...ELIGIBLE, diskFullVariant: undefined });
      expect(container.querySelector('[data-testid="export-failure-dismiss"]')).not.toBeNull();
      act(() => { root.unmount(); });
      container.remove();
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });
});

describe('ExportFailureMessage — diagnostics live only inside Technical details, on every variant', () => {
  it('renders Copy diagnostics inside the Technical details disclosure for cancelled too (previously excluded)', async () => {
    const fake = await renderMessage({ kind: 'cancelled', retentionAttempted: false, manifestPresent: false });
    const details = container.querySelector('[data-testid="export-failure-technical"]');
    expect(details).not.toBeNull();
    const copyBtn = details!.querySelector<HTMLButtonElement>('[data-testid="export-failure-copy-diagnostics"]');
    expect(copyBtn).not.toBeNull();
    // Never in the primary row.
    expect(container.querySelector('[data-testid="export-failure-primary"] [data-testid="export-failure-copy-diagnostics"]')).toBeNull();
    await act(async () => { copyBtn!.click(); });
    expect(fake.copyDiagnosticsCount).toBe(1);
  });

  it('renders Copy diagnostics inside Technical details for an ordinary resumable failure too', async () => {
    await renderMessage({ kind: 'mux', ...ELIGIBLE });
    const details = container.querySelector('[data-testid="export-failure-technical"]');
    expect(details!.querySelector('[data-testid="export-failure-copy-diagnostics"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="export-failure-primary"] [data-testid="export-failure-copy-diagnostics"]')).toBeNull();
  });
});
