// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
/**
 * The operator's export-sessions/ folder held 33 manifest-less sessions, one
 * per export start, each claimed live by the running app. In a dev build
 * StrictMode mounts the bulk slot's kickoff effect twice, so `startExport`
 * runs twice: the first run creates a session, sees the second run has
 * superseded it at its generation check, and returned without releasing it.
 * Any run that creates a session and then abandons it before the pipeline
 * adopts it must release it. A cancel's destroy must also be labelled
 * `cancel`, not `unmount`, even when the unmount reaches native first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const backends = vi.hoisted(() => ({
  created: [] as { id: string; disposals: { force?: boolean; failureKind?: string }[] }[],
}));
vi.mock('../services/ffmpegBackend', () => ({
  createTauriBackend: async () => {
    const b = { id: `s${backends.created.length + 1}`, disposals: [] as { force?: boolean; failureKind?: string }[] };
    backends.created.push(b);
    return {
      ffmpeg: { sessionId: b.id }, sessionId: b.id,
      dispose: async (opts?: { force?: boolean; failureKind?: string }) => { b.disposals.push(opts ?? {}); return null; },
      saveOutputToDisk: async () => ({}), takeDurabilityWarnings: async () => [], cancel: async () => undefined,
    };
  },
}));
vi.mock('../services/tauriFfmpeg', async (orig) => {
  const actual = await orig<typeof import('../services/tauriFfmpeg')>();
  return {
    ...actual,
    isTauri: () => true,
    // The live run parks here; nothing past session creation matters to these tests.
    TauriFfmpeg: { ...actual.TauriFfmpeg, sweepOrphanSessions: () => new Promise(() => undefined) },
  };
});

import React, { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useExport, type UseExportApi } from './useExport';
import type { Project } from '../types';

const project = { id: 'P', name: 'P', segments: [], assets: [] } as unknown as Project;
const settle = (): Promise<void> => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });

beforeEach(() => { backends.created = []; });

describe('a session created by a start that is then abandoned is released', () => {
  it('D6.1 — StrictMode\'s double-mounted kickoff leaves no orphaned session', async () => {
    function Slot(): React.ReactElement {
      const api = useExport(project, '1080p', 30, () => {});
      useEffect(() => { api.startExport({ savedPath: '/out/P.mp4', silent: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return <></>;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<StrictMode><Slot /></StrictMode>));
    await settle();
    expect(backends.created.length).toBe(2);
    const live = backends.created.filter((b) => b.disposals.length === 0);
    expect(live, 'exactly one session survives: the run that is still going').toHaveLength(1);
    const abandoned = backends.created.find((b) => b.disposals.length > 0)!;
    expect(abandoned.disposals[0]).toEqual({ force: false, failureKind: 'abandoned-start' });
  });

  it('D6.3 — a cancel followed at once by the unmount is logged as a cancel', async () => {
    let api!: UseExportApi;
    function Slot(): React.ReactElement { api = useExport(project, '1080p', 30, () => {}); return <></>; }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Slot />));
    act(() => { api.startExport({ savedPath: '/out/P.mp4', silent: true }); });
    await settle();
    expect(backends.created).toHaveLength(1);
    act(() => { api.cancelExport({ keepForResume: true }); root.unmount(); });
    await settle();
    expect(backends.created[0]!.disposals[0]?.failureKind).toBe('cancel');
  });
});
