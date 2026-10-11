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
import { BulkExportHost, RESTART_NOTE, COULD_NOT_RESUME_NOTE, NOTHING_FOUND_NOTE } from './BulkExportHost';
import { MediaLoadTimeoutError } from '../services/projectMediaPreparation';
import { trackExportTeardown } from '../services/exportTeardownLatch';
import { BulkExportRunner, type BulkExportExecutorInput } from '../services/bulkExportQueue';
import type { QueueJobOutcome } from '../services/syncQueue';
import type { Project } from '../types';

/** The executor loads media (async) before the slot mounts. */
const settle = (): Promise<void> => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

/** A job's outcome, awaited by flushing React inside act until it settles (the
 *  slot mounts and unmounts as the job runs, so a bare await would update
 *  state outside act). */
const done = async <T,>(p: Promise<T>): Promise<T> => {
  let state: { value: T } | null = null;
  void p.then(value => { state = { value }; });
  for (let i = 0; i < 100 && state === null; i++) await settle();
  if (state === null) throw new Error('the job never settled');
  return (state as { value: T }).value;
};

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
    expect(await done(run({}))).toEqual({ status: 'failed', detail: 'Export is only available in the desktop app.' });
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
    expect(await done(run())).toEqual({ status: 'done' });
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('revokes after a failed export', async () => {
    const revoke = vi.fn();
    hook.startExport.mockImplementation(() => { throw new Error('boom'); });
    const run = mountWith(media(revoke));
    expect(await done(run())).toEqual({ status: 'failed', detail: 'boom' });
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
    await done(p);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(hook.cancelExport).toHaveBeenCalledTimes(1);
    // Bulk cancel keeps a session that carries a resume manifest, so Retry can resume.
    expect(hook.cancelExport).toHaveBeenCalledWith({ keepForResume: true });
  });

  it('a media load failure parks the row with the reason and never starts the export', async () => {
    hook.startExport.mockReset();
    const run = mountWith(async () => { throw new Error('media could not be loaded from storage for 2 scenes'); });
    expect(await done(run())).toEqual({
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
    await done(first);
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

describe('BulkExportHost media load timeout', () => {
  it('a media load that times out parks the row "media would not load" and never starts the export', async () => {
    hook.startExport.mockReset();
    const run = mountHost2(async () => { throw new MediaLoadTimeoutError(); });
    expect(await done(run())).toEqual({ status: 'failed', detail: 'media would not load' });
    expect(hook.startExport).not.toHaveBeenCalled();
  });
});

function mountHost2(loadMedia: (p: Project) => Promise<{ project: Project; revoke: () => void }>): () => Promise<QueueJobOutcome> {
  let executor!: (input: BulkExportExecutorInput) => Promise<QueueJobOutcome>;
  const runner = { setExecutor: (fn: typeof executor) => { executor = fn; } } as unknown as BulkExportRunner;
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<BulkExportHost runner={runner} loadMedia={loadMedia} />));
  return () => {
    let p!: Promise<QueueJobOutcome>;
    act(() => {
      p = executor({
        project: { id: 'P', name: 'P' } as Project, savedPath: '/o/P.mp4', resolution: '1080p', fps: 30,
        resume: false, signal: new AbortController().signal, setPhase: () => {}, setProgress: () => {},
      });
    });
    return p;
  };
}

describe('BulkExportHost: an honest start (resume vs restart)', () => {
  function mountWithProgress(resume: boolean): { setProgress: ReturnType<typeof vi.fn>; start: () => void } {
    const setProgress = vi.fn();
    let executor!: (input: BulkExportExecutorInput) => Promise<QueueJobOutcome>;
    const runner = { setExecutor: (fn: typeof executor) => { executor = fn; } } as unknown as BulkExportRunner;
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<BulkExportHost runner={runner} loadMedia={async p => ({ project: p, revoke: () => {} })} />));
    return {
      setProgress,
      start: () => act(() => {
        void executor({
          project: { id: 'P', name: 'P' } as Project, savedPath: '/o/P.mp4', resolution: '1080p', fps: 30,
          resume, signal: new AbortController().signal, setPhase: () => {}, setProgress,
        });
      }),
    };
  }

  it('a found checkpoint: the bar starts at the resumed position and the row says so', async () => {
    hook.startExport.mockReset();
    hook.state = { ...hook.state, isExporting: true, pendingResumeOffer: { picturesAlreadyRendered: 140, picturesTotal: 1800 } } as typeof hook.state;
    const h = mountWithProgress(true);
    h.start();
    await settle();
    expect(hook.resolveResumeChoice).toHaveBeenCalledWith('resume');
    expect(h.setProgress).toHaveBeenCalledWith(expect.objectContaining({
      pct: 7, note: 'Resuming from checkpoint — 7% done', resumedFromPct: 7,
    }));
  });

  it('nothing recorded yet: "No checkpoint yet — restarting from the beginning", not a silent 0%', async () => {
    hook.startExport.mockReset();
    hook.state = { ...hook.state, isExporting: true, resumeRefusalNotice: { kind: 'no_checkpoint_yet', sessionId: 's', reason: 'r' } } as typeof hook.state;
    const h = mountWithProgress(true);
    h.start();
    await settle();
    expect(h.setProgress).toHaveBeenCalledWith(expect.objectContaining({ note: `${RESTART_NOTE} (r)` }));
    expect(RESTART_NOTE).toBe('No checkpoint yet — restarting from the beginning');
  });

  it('a survivor that could not be used (e.g. its claim is held) is NOT dressed up as "no checkpoint yet"', async () => {
    hook.startExport.mockReset();
    hook.state = { ...hook.state, isExporting: true, resumeRefusalNotice: { kind: 'live_claim_blocked', sessionId: 's', reason: 'another window is using this session' } } as typeof hook.state;
    const h = mountWithProgress(true);
    h.start();
    await settle();
    expect(h.setProgress).toHaveBeenCalledWith(expect.objectContaining({ note: `${COULD_NOT_RESUME_NOTE} (another window is using this session)` }));
    expect(h.setProgress).not.toHaveBeenCalledWith(expect.objectContaining({ note: expect.stringContaining(RESTART_NOTE) }));
  });

  it('a Retry whose export begins encoding with no offer and no notice still says it restarted', async () => {
    hook.startExport.mockReset();
    hook.state = {
      ...hook.state, isExporting: true, progress: 1, stageLabel: 'Encoding segment 1 / 20',
      stage: { type: 'encoding_segment', index: 0, total: 20, frame: 1, totalFrames: 100, cumulative: true },
    } as typeof hook.state;
    const h = mountWithProgress(true);
    h.start();
    await settle();
    expect(h.setProgress).toHaveBeenCalledWith(expect.objectContaining({ note: NOTHING_FOUND_NOTE }));
  });

  it('a fresh Start carries no resume/restart note at all', async () => {
    hook.startExport.mockReset();
    hook.state = {
      ...hook.state, isExporting: true, progress: 1, stageLabel: 'Encoding segment 1 / 20',
      stage: { type: 'encoding_segment', index: 0, total: 20, frame: 1, totalFrames: 100, cumulative: true },
    } as typeof hook.state;
    const h = mountWithProgress(false);
    h.start();
    await settle();
    expect(h.setProgress).toHaveBeenCalledWith({ pct: 1, stage: 'Encoding segment 1 / 20' });
  });
});

describe('BulkExportHost never ships a shorter film silently', () => {
  const offer = {
    picturesKept: 3659, picturesExpected: 3660, picturesLost: 1, keptWallDurationSeconds: 121.97, lostWallDurationSeconds: 0.03, fps: 30,
    sessionId: 'sess-1',
    deviatingPieces: [{ pieceIndex: 2, counted: 1795, expected: 1796 }],
  };

  it('a recorded deviation is auto-accepted, the deliverable stands, and the row notice names the piece, counts and shift', async () => {
    hook.state = { ...hook.state, pendingSealConsent: offer, showExportSuccess: true, isExporting: false };
    const run = mountHost();
    const outcome = await done(run({}));
    expect(hook.resolveSealConsent).toHaveBeenCalledWith(true);
    expect(outcome.status).toBe('done');
    const detail = (outcome as { detail?: string }).detail ?? '';
    expect(detail).toContain('Piece 3');
    expect(detail).toContain('1,795');
    expect(detail).toContain('1,796');
    expect(detail).toContain('33 ms');
  });

  it('diagnostics carry one line naming project id, session id, piece and counts', async () => {
    const lines: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
    hook.state = { ...hook.state, pendingSealConsent: offer, showExportSuccess: true, isExporting: false };
    await done(mountHost()({}));
    warn.mockRestore();
    const mine = lines.filter(l => l.includes('[ws3-bulk-deviation]'));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain('"projectId":"P"');
    expect(mine[0]).toContain('"sessionId":"sess-1"');
    expect(mine[0]).toContain('"pieceIndex":2');
    expect(mine[0]).toContain('"counted":1795');
    expect(mine[0]).toContain('"expected":1796');
  });

  it('a clean bulk row reports nothing new (pin)', async () => {
    hook.state = { ...hook.state, showExportSuccess: true, isExporting: false };
    const outcome = await done(mountHost()({}));
    expect(outcome).toEqual({ status: 'done' });
  });
});
