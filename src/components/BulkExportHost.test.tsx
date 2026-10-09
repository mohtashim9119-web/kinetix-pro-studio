// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The bulk export slot must always settle its job — a hang stalls the whole
// serial queue with no visible state. A kickoff that throws is a Failed row;
// a resume offer is always answered (resume on Retry-with-checkpoint, else a
// clean start), never left waiting for a dialog bulk export never shows.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const hook = vi.hoisted(() => ({
  state: { pendingResumeOffer: null as unknown, pendingSealConsent: null as unknown, showExportSuccess: false, error: null as unknown, isExporting: false },
  startExport: vi.fn<(r?: unknown) => void>(),
  resolveResumeChoice: vi.fn<(c: 'resume' | 'clean') => void>(),
  resolveSealConsent: vi.fn<(a: boolean) => void>(),
}));
vi.mock('../hooks/useExport', () => ({
  useExport: () => hook,
}));
vi.mock('../services/spots/exportSpecs', () => ({ buildExportSpotPayload: () => ({ request: undefined, findings: [] }) }));

import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { BulkExportHost } from './BulkExportHost';
import { BulkExportRunner, type BulkExportExecutorInput } from '../services/bulkExportQueue';
import type { QueueJobOutcome } from '../services/syncQueue';
import type { Project } from '../types';

function mountHost(): (input: Partial<BulkExportExecutorInput>) => Promise<QueueJobOutcome> {
  let executor!: (input: BulkExportExecutorInput) => Promise<QueueJobOutcome>;
  const runner = { setExecutor: (fn: typeof executor) => { executor = fn; } } as unknown as BulkExportRunner;
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<BulkExportHost runner={runner} />));
  return input => {
    let p!: Promise<QueueJobOutcome>;
    act(() => {
      p = executor({
        project: { id: 'P', name: 'P' } as Project, savedPath: '/o/P.mp4', resolution: '1080p', fps: 30,
        resume: false, signal: new AbortController().signal, setPhase: () => {}, ...input,
      });
    });
    return p;
  };
}

beforeEach(() => {
  hook.state = { pendingResumeOffer: null, pendingSealConsent: null, showExportSuccess: false, error: null, isExporting: false };
  hook.startExport.mockReset();
  hook.resolveResumeChoice.mockReset();
});

describe('BulkExportHost always settles', () => {
  it('a kickoff that throws resolves Failed with the reason (the queue advances)', async () => {
    hook.startExport.mockImplementation(() => { throw new Error('Export is only available in the desktop app.'); });
    const run = mountHost();
    await expect(run({})).resolves.toEqual({ status: 'failed', detail: 'Export is only available in the desktop app.' });
  });

  it('a resume offer on a fresh Start is answered "clean", not left hanging', () => {
    hook.state = { ...hook.state, pendingResumeOffer: { sessionId: 's' }, isExporting: true };
    const run = mountHost();
    void run({ resume: false });
    expect(hook.resolveResumeChoice).toHaveBeenCalledWith('clean');
  });

  it('a resume offer on Retry-with-checkpoint is answered "resume"', () => {
    hook.state = { ...hook.state, pendingResumeOffer: { sessionId: 's' }, isExporting: true };
    const run = mountHost();
    void run({ resume: true });
    expect(hook.resolveResumeChoice).toHaveBeenCalledWith('resume');
  });
});
