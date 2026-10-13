// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
/**
 * A spot refusal is decided before any encoding. Its payload must still carry the path-selection
 * diagnostics (the reason the path was chosen), and the session it opened is released.
 */
import { describe, it, expect, vi } from 'vitest';

const disposals = vi.hoisted(() => [] as { force?: boolean; failureKind?: string }[]);
vi.mock('../services/ffmpegBackend', () => ({
  createTauriBackend: async () => ({
    ffmpeg: { sessionId: 's1' }, sessionId: 's1',
    dispose: async (opts?: { force?: boolean; failureKind?: string }) => { disposals.push(opts ?? {}); return null; },
    saveOutputToDisk: async () => ({}), takeDurabilityWarnings: async () => [], cancel: async () => undefined,
  }),
}));
vi.mock('../services/tauriFfmpeg', async (orig) => {
  const actual = await orig<typeof import('../services/tauriFfmpeg')>();
  return {
    ...actual,
    isTauri: () => true,
    TauriFfmpeg: { ...actual.TauriFfmpeg, sweepOrphanSessions: async () => ({ candidates: 0 }) },
  };
});

import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useExport, type UseExportApi } from './useExport';
import type { Project } from '../types';

const project = {
  id: 'P', name: 'P', segments: [{ id: 's0', startTime: 0, duration: 10, assetId: 'a' }], assets: [{ id: 'a', name: 'a.png', type: 'image', url: 'blob:a' }],
} as unknown as Project;
const settle = (): Promise<void> => act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); });

describe('spot_path_refused payload', () => {
  it('carries exportPathSelection and releases the session it opened', async () => {
    let api!: UseExportApi;
    function Slot(): React.ReactElement { api = useExport(project, '1080p', 30, () => {}); return <></>; }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Slot />));
    act(() => {
      api.startExport({ savedPath: '/out/P.mp4', silent: true, spotRenderSpecs: [{ assetId: 'x', startSec: 1, durSec: 2, xPct: 0, yPct: 0, wPct: 50, hPct: 100 }] } as never);
    });
    await settle();
    const err = api.state.error!;
    expect(err.kind).toBe('spot_path_refused');
    expect(err.liveness?.exportPathSelection).toBeTruthy();
    expect(err.liveness?.exportPathSelection?.topLevelPath).toBeDefined();
    expect(disposals[0]).toMatchObject({ force: false, failureKind: 'spot_path_refused' });
  });
});
