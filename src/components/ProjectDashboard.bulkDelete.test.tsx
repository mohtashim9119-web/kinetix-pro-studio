// @vitest-environment jsdom
//
// WS3 item H (folded-in project-delete orphaning fix) — a deleted project's
// NATIVE asset cleanup failure must surface, never leak silently. Same
// jsdom + react-dom/client + act pattern as App.projectSwitch.test.tsx (no
// @testing-library in this repo).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { ProjectMeta } from '../types';

const mockLoadAllMetas = vi.fn();
const mockDeleteProjectData = vi.fn(async (_id: string): Promise<void> => undefined);
vi.mock('../services/projectStore', () => ({
  loadAllMetas: () => mockLoadAllMetas(),
  deleteProjectData: (id: string) => mockDeleteProjectData(id),
}));

vi.mock('../services/stagedFilesStore', () => ({
  deleteAllStagedForProject: vi.fn(async () => undefined),
}));

const mockDeleteAllAssets = vi.fn(async (_id: string): Promise<void> => undefined);
vi.mock('../services/assetStore', () => ({
  deleteAllAssets: (id: string) => mockDeleteAllAssets(id),
}));

const mockDeleteProjectAssetsNativeStrict = vi.fn(async (_projectId: string): Promise<void> => undefined);
vi.mock('../services/nativeAssetStore', () => ({
  deleteProjectAssetsNativeStrict: (projectId: string) => mockDeleteProjectAssetsNativeStrict(projectId),
}));

vi.mock('../services/waveformStore', () => ({
  deleteAllWaveforms: vi.fn(async () => undefined),
}));

// eslint-disable-next-line import/first
import { ProjectDashboard } from './ProjectDashboard';

function meta(id: string, name: string): ProjectMeta {
  return { id, name, savedAt: Date.now(), segmentCount: 1 };
}

let container: HTMLDivElement;
let root: Root;

async function mount(onAssetCleanupFailed?: (m: string) => void): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ProjectDashboard
        currentProjectId={null}
        onSelectProject={() => {}}
        onNewProject={() => {}}
        onOpenAppSettings={() => {}}
        onAssetCleanupFailed={onAssetCleanupFailed}
      />,
    );
  });
}

async function selectAndDelete(id: string): Promise<void> {
  const toggle = container.querySelector<HTMLButtonElement>(
    `[data-testid="project-card-${id}"] .kxd-select-toggle`,
  );
  await act(async () => { toggle!.click(); });
  const deleteBtn = container.querySelector<HTMLButtonElement>('.kxd-btn-sm-danger');
  await act(async () => { deleteBtn!.click(); });
  const confirmBtn = container.querySelector<HTMLButtonElement>('.kxd-dialog-confirm');
  await act(async () => { confirmBtn!.click(); });
  // Let the async handleBulkDelete's awaits settle.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadAllMetas.mockReturnValue([meta('p1', 'Project One')]);
  mockDeleteProjectAssetsNativeStrict.mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ProjectDashboard bulk delete — native asset cleanup', () => {
  it('a successful cleanup calls onAssetCleanupFailed NEVER', async () => {
    const onFailed = vi.fn();
    await mount(onFailed);
    await selectAndDelete('p1');

    expect(mockDeleteProjectAssetsNativeStrict).toHaveBeenCalledWith('p1');
    expect(mockDeleteProjectData).toHaveBeenCalledWith('p1');
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('a failed native cleanup surfaces via onAssetCleanupFailed, AND the project record is still deleted', async () => {
    mockDeleteProjectAssetsNativeStrict.mockRejectedValueOnce(new Error('disk full'));
    const onFailed = vi.fn();
    await mount(onFailed);
    await selectAndDelete('p1');

    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed.mock.calls[0]![0]).toContain('p1');
    expect(onFailed.mock.calls[0]![0]).toContain('disk full');
    // The project record deletion is NOT blocked by the cleanup failure —
    // the project is still gone from the grid either way.
    expect(mockDeleteProjectData).toHaveBeenCalledWith('p1');
  });

  it('never throws out of handleBulkDelete even when cleanup fails — caught, not propagated', async () => {
    mockDeleteProjectAssetsNativeStrict.mockRejectedValueOnce(new Error('permission denied'));
    await mount(); // no onAssetCleanupFailed passed at all
    await expect(selectAndDelete('p1')).resolves.toBeUndefined();
  });
});
