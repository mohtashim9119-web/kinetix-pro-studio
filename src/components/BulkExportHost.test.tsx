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
  cancelExport: vi.fn<(opts?: { keepForResume?: boolean }) => void>(),
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
import { trackExportTeardown } from '../services/exportTeardownLatch';
import { BulkExportRunner, type BulkExportExecutorInput } from '../services/bulkExportQueue';
import type { QueueJobOutcome } from '../services/syncQueue';
import type { Project } from '../types';

/** The executor loads media (async) before the slot mounts. */
const settle = (): Promise<void> => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

function mountHost(): (input: Partial<BulkExportExecutorInput>) => Promise<QueueJobOutcome> {
  let executor!: (input: BulkExportExecutorInput) => Promise<QueueJobOutcome>;
  const runner = { setExecutor: (fn: typeof executor) => { executor = fn; } } as unknown as BulkExportRunner;
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<BulkExportHost runner={runner} loadMedia={async p => ({ project: p, revoke: () => {} })} />));
  return input => {
    let p!: Promise<QueueJobOutcome>;
    act(() => {
      p = executor({
        project: { id: 'P', name: 'P' } as Project, savedPath: '/o/P.mp4', resolution: '1080p', fps: 30,
        resume: false, signal: new AbortController().signal, setPhase: () => {}, setProgress: () => {}, ...input,
      });
    });
    return p;
  };
}

beforeEach(() => {
  hook.state = { pendingResumeOffer: null, pendingSealConsent: null, showExportSuccess: false, error: null, isExporting: false };
  hook.startExport.mockReset();
  hook.cancelExport.mockReset();
  hook.resolveResumeChoice.mockReset();
});

describe('BulkExportHost always settles', () => {
  it('a kickoff that throws resolves Failed with the reason (the queue advances)', async () => {
    hook.startExport.mockImplementation(() => { throw new Error('Export is only available in the desktop app.'); });
    const run = mountHost();
    await expect(run({})).resolves.toEqual({ status: 'failed', detail: 'Export is only available in the desktop app.' });
  });

  it('a resume offer on a fresh Start is answered "clean", not left hanging', async () => {
    hook.state = { ...hook.state, pendingResumeOffer: { sessionId: 's' }, isExporting: true };
    const run = mountHost();
    void run({ resume: false });
    await settle();
    expect(hook.resolveResumeChoice).toHaveBeenCalledWith('clean');
  });

  it('a resume offer on Retry-with-checkpoint is answered "resume"', async () => {
    hook.state = { ...hook.state, pendingResumeOffer: { sessionId: 's' }, isExporting: true };
    const run = mountHost();
    void run({ resume: true });
    await settle();
    expect(hook.resolveResumeChoice).toHaveBeenCalledWith('resume');
  });
});

describe('BulkExportHost loads real media around each export', () => {
  function mountWith(loadMedia: (p: Project) => Promise<{ project: Project; revoke: () => void }>): (input?: Partial<BulkExportExecutorInput>) => Promise<QueueJobOutcome> {
    let executor!: (input: BulkExportExecutorInput) => Promise<QueueJobOutcome>;
    const runner = { setExecutor: (fn: typeof executor) => { executor = fn; } } as unknown as BulkExportRunner;
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<BulkExportHost runner={runner} loadMedia={loadMedia} />));
    return input => {
      let p!: Promise<QueueJobOutcome>;
      act(() => {
        p = executor({
          project: { id: 'P', name: 'P' } as Project, savedPath: '/o/P.mp4', resolution: '1080p', fps: 30,
          resume: false, signal: new AbortController().signal, setPhase: () => {}, setProgress: () => {}, ...input,
        });
      });
      return p;
    };
  }
  const media = (revoke: () => void) => async (p: Project) => ({ project: { ...p, name: 'LOADED' } as Project, revoke });

  it('exports the media-loaded project and revokes after success', async () => {
    const revoke = vi.fn();
    hook.state = { ...hook.state, showExportSuccess: true };
    const run = mountWith(media(revoke));
    await expect(run()).resolves.toEqual({ status: 'done' });
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('revokes after a failed export', async () => {
    const revoke = vi.fn();
    hook.startExport.mockImplementation(() => { throw new Error('boom'); });
    const run = mountWith(media(revoke));
    await expect(run()).resolves.toEqual({ status: 'failed', detail: 'boom' });
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('revokes when the export is aborted', async () => {
    const revoke = vi.fn();
    hook.startExport.mockImplementation(() => {});
    const ac = new AbortController();
    const run = mountWith(media(revoke));
    const p = run({ signal: ac.signal });
    await settle();
    act(() => ac.abort());
    await p;
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(hook.cancelExport).toHaveBeenCalledTimes(1);
    // Bulk cancel keeps a session that carries a resume manifest, so Retry can resume.
    expect(hook.cancelExport).toHaveBeenCalledWith({ keepForResume: true });
  });

  it('a media load failure parks the row with the reason and never starts the export', async () => {
    hook.startExport.mockReset();
    const run = mountWith(async () => { throw new Error('media could not be loaded from storage for 2 scenes'); });
    await expect(run()).resolves.toEqual({
      status: 'failed', detail: "could not load the project's media — media could not be loaded from storage for 2 scenes",
    });
    expect(hook.startExport).not.toHaveBeenCalled();
  });
});

describe('BulkExportHost reports live progress', () => {
  it('forwards the engine\'s percent and stage to the row (bar, timer, ETA)', async () => {
    hook.state = { ...hook.state, progress: 42, stageLabel: 'Encoding segment 3 / 20', isExporting: true } as typeof hook.state;
    const setProgress = vi.fn();
    const setPhase = vi.fn();
    let executor!: (input: BulkExportExecutorInput) => Promise<QueueJobOutcome>;
    const runner = { setExecutor: (fn: typeof executor) => { executor = fn; } } as unknown as BulkExportRunner;
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<BulkExportHost runner={runner} loadMedia={async p => ({ project: p, revoke: () => {} })} />));
    act(() => {
      void executor({
        project: { id: 'P', name: 'P' } as Project, savedPath: '/o/P.mp4', resolution: '1080p', fps: 30,
        resume: false, signal: new AbortController().signal, setPhase, setProgress,
      });
    });
    await settle();
    expect(setProgress).toHaveBeenCalledWith({ pct: 42, stage: 'Encoding segment 3 / 20' });
    expect(setPhase).toHaveBeenCalledWith('Encoding segment 3 / 20');
  });
});

describe('BulkExportHost serialises the cancelled row\'s teardown before the next start', () => {
  it('cancel active row → the next row starts only after the teardown resolves', async () => {
    let releaseTeardown!: () => void;
    hook.startExport.mockReset();
    hook.startExport.mockImplementation(() => {});
    // The engine's cancel is fire-and-forget: it registers its teardown on the latch.
    hook.cancelExport.mockImplementation(() => {
      trackExportTeardown(new Promise<void>(res => { releaseTeardown = res; }));
    });
    const run = mountHost();
    const ac = new AbortController();
    const first = run({ signal: ac.signal });
    await settle();
    expect(hook.startExport).toHaveBeenCalledTimes(1);
    act(() => ac.abort());
    await first;
    expect(hook.cancelExport).toHaveBeenCalledTimes(1);

    hook.startExport.mockClear();
    void run({});
    await settle();
    expect(hook.startExport, 'the next row launched while the old session was still tearing down').not.toHaveBeenCalled();

    releaseTeardown();
    await settle();
    expect(hook.startExport).toHaveBeenCalledTimes(1);
  });
});
