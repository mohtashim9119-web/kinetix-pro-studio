/**
 * Recovery close — must write nothing. Closing mid-folder-pick leaves
 * project.json byte-identical and the load-failure poison intact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { performRecoveryClose } from './recoverySession';

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
});
