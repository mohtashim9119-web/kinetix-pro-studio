// @vitest-environment jsdom
/**
 * Recovery close — must write nothing. Closing mid-folder-pick leaves
 * project.json byte-identical and the load-failure poison intact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { DegradedProjectRecoveryScreen, type FolderRelinkView } from './DegradedProjectRecoveryScreen';
import { performRecoveryClose } from './recoverySession';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('performRecoveryClose', () => {
  it('discards folder-pick UI state and clears the recovery screen without other side effects', () => {
    let recoveryCleared = false;
    let folderCleared = false;
    let extraCalled = false;

    performRecoveryClose({
      clearRecoveryUi: () => { recoveryCleared = true; },
      clearFolderRelink: () => { folderCleared = true; },
    });

    expect(folderCleared).toBe(true);
    expect(recoveryCleared).toBe(true);
    expect(extraCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Storage contract — mirrors assetRecovery.test.ts's Map-backed harness so
// "close mid-session" is proved against the real saveProject guard, not a
// mock of the guard itself.
// ---------------------------------------------------------------------------
let osBacking: Map<string, string>;
let osWriteCount = 0;

vi.mock('../../services/tauriFfmpeg', () => ({ isTauri: () => true }));

vi.mock('../../services/projectStoreClient', () => ({
  osStoreWrite: (id: string, contents: string) => {
    osWriteCount += 1;
    osBacking.set(id, contents);
    return Promise.resolve();
  },
  osStoreRead: (id: string) => Promise.resolve(osBacking.has(id) ? osBacking.get(id)! : null),
  osStoreDelete: (id: string) => {
    osBacking.delete(id);
    return Promise.resolve();
  },
  osStoreListIds: () => Promise.resolve([...osBacking.keys()]),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('recovery close — project.json and load failure unchanged', () => {
  beforeEach(async () => {
    osBacking = new Map();
    osWriteCount = 0;
    const backing = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
      setItem: (k: string, v: string) => backing.set(k, String(v)),
      removeItem: (k: string) => void backing.delete(k),
      clear: () => backing.clear(),
      key: (i: number) => [...backing.keys()][i] ?? null,
      get length() { return backing.size; },
    } as Storage);
    const { __resetStoreGuardsForTests } = await import('../../services/projectStore');
    __resetStoreGuardsForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves project.json byte-identical and load failure intact when folder-pick is discarded via close', async () => {
    const { saveProject, reportAssetResolutionFailure, getLoadFailure } = await import('../../services/projectStore');
    const { AnimationType, TransitionType } = await import('../../types');
    type Project = import('../../types').Project;
    const project = {
      id: 'p-close',
      name: 'Close fixture',
      script: '',
      sceneDetails: '',
      segments: [{ id: 's0', text: 'Hook', assetId: 'a1', startTime: 0, duration: 1, transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0 }],
      headings: [],
      assets: [{ id: 'a1', name: 'clip.mp4', url: '', type: 'video' as const }],
      globalTransition: TransitionType.NONE,
      globalTransitionDuration: 0.5,
      globalAnimation: AnimationType.NONE,
      textLayers: [],
      globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
      confirmed: true,
      aspectRatio: '16:9',
      resolutionTier: '1080p',
    } as Project;
    await saveProject(project);
    const bytesBefore = osBacking.get('p-close');
    expect(bytesBefore).toBeDefined();
    osWriteCount = 0;

    reportAssetResolutionFailure('p-close', 'asset a1 unresolvable from storage');
    expect(getLoadFailure('p-close')?.reason).toBe('asset-unresolvable');

    // Mid-session: operator picked a folder (UI only) then closed — App must
    // call performRecoveryClose, which clears UI state and never touches storage.
    performRecoveryClose({
      clearFolderRelink: () => { /* in-flight folder-pick discarded */ },
      clearRecoveryUi: () => { /* return to dashboard */ },
    });

    expect(osBacking.get('p-close')).toBe(bytesBefore);
    expect(osWriteCount).toBe(0);
    expect(getLoadFailure('p-close')?.reason).toBe('asset-unresolvable');

    const refused = await saveProject(project);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('blocked-by-load-failure');
    expect(osBacking.get('p-close')).toBe(bytesBefore);
  });

  it.each(['X', 'Escape'] as const)(
    'with 42 unresolved assets, folder proposals closed via %s write nothing',
    async (closeVia) => {
      const { saveProject, reportAssetResolutionFailure, getLoadFailure } =
        await import('../../services/projectStore');
      const { AnimationType, TransitionType } = await import('../../types');
      type Project = import('../../types').Project;
      const assets = Array.from({ length: 42 }, (_, index) => ({
        id: `asset-${index}`,
        name: `clip-${index}.mp4`,
        url: '',
        type: 'video' as const,
      }));
      const project = {
        id: `p-close-${closeVia}`,
        name: '42 unresolved assets',
        script: '',
        sceneDetails: '',
        segments: assets.map((asset, index) => ({
          id: `segment-${index}`,
          text: `Segment ${index}`,
          assetId: asset.id,
          startTime: index,
          duration: 1,
          transition: TransitionType.NONE,
          animation: AnimationType.NONE,
          order: index,
        })),
        headings: [],
        assets,
        globalTransition: TransitionType.NONE,
        globalTransitionDuration: 0.5,
        globalAnimation: AnimationType.NONE,
        textLayers: [],
        globalOverlayConfig: {
          color: '#fff',
          backgroundColor: '#000',
          fontFamily: 'Inter',
        },
        confirmed: true,
        aspectRatio: '16:9',
        resolutionTier: '1080p',
      } as Project;
      await saveProject(project);
      const bytesBefore = osBacking.get(project.id);
      const keysBefore = [...osBacking.keys()];
      osWriteCount = 0;
      vi.mocked(invoke).mockClear();
      reportAssetResolutionFailure(project.id, '42 assets unresolved');

      const container = document.createElement('div');
      document.body.appendChild(container);
      const reactRoot = createRoot(container);
      let pickCount = 0;
      let toggleCount = 0;
      let recoveryCleared = false;
      let folderCleared = false;
      const proposal = {
        assetId: assets[0]!.id,
        candidateId: 'candidate-0',
        confidence: 'probable' as const,
        basis: {
          name: 'similar' as const,
          type: 'match' as const,
          duration: 'within-probable' as const,
        },
        manyToOneAssetIds: [],
        notes: [],
      };
      const folderRelink: FolderRelinkView = {
        phase: 'proposed',
        proposals: [proposal],
        candidateById: {
          'candidate-0': {
            id: 'candidate-0',
            name: 'clip-0.mp4',
            path: '/media/clip-0.mp4',
          },
        },
        selection: Object.fromEntries(assets.map((asset) => [asset.id, null])),
        unresolvedAssetIds: assets.map((asset) => asset.id),
        writeError: null,
      };
      const close = (): void => {
        performRecoveryClose({
          clearRecoveryUi: () => {
            recoveryCleared = true;
          },
          clearFolderRelink: () => {
            folderCleared = true;
          },
        });
      };
      const render = (view: FolderRelinkView | null): void => {
        reactRoot.render(
          React.createElement(DegradedProjectRecoveryScreen, {
            projectName: project.name,
            assets: assets.map((asset) => ({
              id: asset.id,
              name: asset.name,
              unresolved: true,
            })),
            segments: project.segments.map((segment) => ({
              id: segment.id,
              label: segment.text,
              assetId: segment.assetId ?? null,
              resolutionStatus: 'unresolved' as const,
            })),
            onRelink: () => undefined,
            folderRelink: view,
            onPickFolder: () => {
              pickCount += 1;
              render(folderRelink);
            },
            onToggleFolderProposal: () => {
              toggleCount += 1;
            },
            onClose: close,
          }),
        );
      };

      await act(async () => {
        render(null);
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="recovery-pick-folder"]')!.click();
      });
      await act(async () => {
        container.querySelector<HTMLInputElement>('[data-testid="recovery-folder-toggle"]')!.click();
      });
      await act(async () => {
        if (closeVia === 'X') {
          container.querySelector<HTMLButtonElement>('[data-testid="recovery-close"]')!.click();
        } else {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        }
      });

      expect(pickCount).toBe(1);
      expect(toggleCount).toBe(1);
      expect(recoveryCleared).toBe(true);
      expect(folderCleared).toBe(true);
      expect(osBacking.get(project.id)).toBe(bytesBefore);
      expect([...osBacking.keys()]).toEqual(keysBefore);
      expect(osWriteCount).toBe(0);
      expect(getLoadFailure(project.id)?.reason).toBe('asset-unresolvable');
      expect(invoke).not.toHaveBeenCalled();

      await act(async () => reactRoot.unmount());
      container.remove();
    },
  );
});
