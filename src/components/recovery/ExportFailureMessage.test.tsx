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
