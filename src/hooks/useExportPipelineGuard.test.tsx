// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// One pipeline per project, editor side: the export button on a project that
// is syncing shows a clear blocking error — no picker, no render, no silent
// no-op — and a free project goes on to the save picker as before.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => {
  class FakeChannel<T> { onmessage: ((message: T) => void) | undefined; }
  return { Channel: FakeChannel, invoke: vi.fn(async () => null) };
});
vi.mock('../services/tauriFfmpeg', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/tauriFfmpeg')>();
  return { ...real, isTauri: () => true };
});

import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useExport } from './useExport';
import { __resetPipelineGuardForTests, claimPipeline, EXPORT_BLOCKED_BY_SYNC, heldPipelines } from '../services/pipelineGuard';
import type { Project } from '../types';

const project = { id: 'P', name: 'P', script: '', sceneDetails: '', segments: [], assets: [] } as unknown as Project;

function mount() {
  let api!: ReturnType<typeof useExport>;
  function Probe(): null {
    api = useExport(project, '1080p', 30, () => {});
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<Probe />));
  return { get api() { return api; }, root };
}

beforeEach(() => {
  __resetPipelineGuardForTests();
  vi.mocked(invoke).mockClear();
});

describe('manual export under the pipeline guard', () => {
  it('a project mid-sync: Export shows "project is syncing" and never opens the picker', async () => {
    const release = claimPipeline('P', 'sync')!;
    const t = mount();
    await act(async () => { t.api.startExport(); });
    expect(t.api.state.error).toMatchObject({ kind: 'project_busy', message: EXPORT_BLOCKED_BY_SYNC });
    expect(t.api.state.isExporting).toBe(false);
    expect(vi.mocked(invoke).mock.calls.map(c => c[0])).not.toContain('pick_save_path');
    expect(heldPipelines().get('P')).toBe('sync');
    release();
  });

  it('a free project goes to the save picker (cancel there claims nothing)', async () => {
    const t = mount();
    await act(async () => { t.api.startExport(); await Promise.resolve(); });
    expect(vi.mocked(invoke).mock.calls.map(c => c[0])).toContain('pick_save_path');
    expect(t.api.state.error).toBeNull();
    expect(heldPipelines().size).toBe(0);
  });
});
