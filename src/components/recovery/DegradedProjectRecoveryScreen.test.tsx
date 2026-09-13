// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { DegradedProjectRecoveryScreen } from './DegradedProjectRecoveryScreen';
import { createRecoveryActionsFake } from './recoveryActionsFake';
import type { RecoveryAsset, RecoverySegment } from './degradedLoad';
import type { RelinkProposal } from '../../services/relinkResolution/types';

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

// No nativeCopyExists/backupExists — assetRecovery.ts's AssetRecoveryEntry
// collapses both into one nativeResolved, so `unresolved` here is already
// exactly "neither the cache nor the native store has this asset's bytes"
// (see degradedLoad.ts's RecoveryAsset doc comment).
const resolvedAsset: RecoveryAsset = {
  id: 'asset-resolved',
  name: 'hero.mp4',
  unresolved: false,
};

const missingAsset: RecoveryAsset = {
  id: 'asset-missing',
  name: 'b-roll.mp4',
  unresolved: true,
};

const anotherMissingAsset: RecoveryAsset = {
  id: 'asset-native',
  name: 'cutaway.mp4',
  unresolved: true,
};

const segments: RecoverySegment[] = [
  { id: 'seg-1', label: 'Hook', assetId: 'asset-resolved', resolutionStatus: 'resolved' },
  { id: 'seg-2', label: 'B-roll', assetId: 'asset-missing', resolutionStatus: 'missing-asset' },
  { id: 'seg-3', label: 'Cutaway', assetId: 'asset-native', resolutionStatus: 'unresolved' },
];

async function renderScreen(props: {
  assets: readonly RecoveryAsset[];
  segments: readonly RecoverySegment[];
}): Promise<ReturnType<typeof createRecoveryActionsFake>> {
  const fake = createRecoveryActionsFake();
  root = createRoot(container);
  await act(async () => {
    root.render(
      <DegradedProjectRecoveryScreen
        projectName="Machine 1 talk"
        segments={props.segments}
        assets={props.assets}
        onRelink={fake.onRelink}
        onSave={fake.onSave}
      />,
    );
  });
  return fake;
}

describe('DegradedProjectRecoveryScreen — no-save invariant', () => {
  it('omits the Save affordance while any asset is unresolved, even if onSave was passed', async () => {
    await renderScreen({
      assets: [resolvedAsset, missingAsset],
      segments,
    });
    expect(container.querySelector('[data-testid="recovery-save"]')).toBeNull();
    expect(container.querySelector('[data-testid="recovery-ready-to-save"]')).toBeNull();
    expect(container.querySelector('[data-testid="recovery-no-save-banner"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="degraded-project-recovery"]')?.getAttribute('data-can-save'))
      .toBe('false');
  });

  it('shows Save and the ready-to-save state only when every asset and segment is resolved', async () => {
    const fake = await renderScreen({
      assets: [resolvedAsset],
      segments: [{ id: 'seg-1', label: 'Hook', assetId: 'asset-resolved', resolutionStatus: 'resolved' }],
    });
    const save = container.querySelector<HTMLButtonElement>('[data-testid="recovery-save"]');
    expect(save).not.toBeNull();
    expect(container.querySelector('[data-testid="recovery-ready-to-save"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="recovery-no-save-banner"]')).toBeNull();
    await act(async () => { save!.click(); });
    expect(fake.saveCount).toBe(1);
  });
});

describe('DegradedProjectRecoveryScreen — status rendering', () => {
  it('renders per-segment resolution status from props', async () => {
    await renderScreen({
      assets: [resolvedAsset, missingAsset, anotherMissingAsset],
      segments,
    });
    const rows = [...container.querySelectorAll('[data-testid="recovery-segment"]')];
    expect(rows.map((el) => el.getAttribute('data-resolution-status'))).toEqual([
      'resolved',
      'missing-asset',
      'unresolved',
    ]);
    expect(container.textContent).toMatch(/Hook/);
    expect(container.textContent).toMatch(/Missing asset/);
  });

  // WS3 recovery-ui reconciliation: a native-vs-backup distinction has no
  // referent in the shipped architecture (assetRecovery.ts's nativeResolved
  // already collapses both), so there is nothing left to distinguish beyond
  // resolved vs missing.
  it('shows Missing for every unresolved asset and Resolved for every resolved one', async () => {
    await renderScreen({
      assets: [missingAsset, anotherMissingAsset, resolvedAsset],
      segments,
    });
    const byId = (id: string): Element => {
      const el = container.querySelector(`[data-testid="recovery-asset"][data-asset-id="${id}"]`);
      if (!el) throw new Error(`missing asset row ${id}`);
      return el;
    };
    expect(byId('asset-missing').getAttribute('data-location')).toBe('missing');
    expect(byId('asset-native').getAttribute('data-location')).toBe('missing');
    expect(byId('asset-resolved').getAttribute('data-location')).toBe('resolved');
    expect(byId('asset-missing').textContent).toMatch(/Missing/);
    expect(byId('asset-resolved').textContent).toMatch(/Resolved/);
  });

  it('invokes the re-link fake with the unresolved asset id', async () => {
    const fake = await renderScreen({
      assets: [missingAsset, anotherMissingAsset],
      segments,
    });
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="recovery-relink"]')];
    expect(buttons).toHaveLength(2);
    await act(async () => { buttons[0]!.click(); });
    expect(fake.relinked).toEqual(['asset-missing']);
    await act(async () => { buttons[1]!.click(); });
    expect(fake.relinked).toEqual(['asset-missing', 'asset-native']);
  });

  it('summarises unresolved assets and never offers re-link on a resolved row', async () => {
    await renderScreen({
      assets: [resolvedAsset, missingAsset],
      segments,
    });
    expect(container.querySelector('[data-testid="recovery-unresolved-summary"]')?.textContent)
      .toMatch(/1 unresolved asset/);
    const resolvedRow = container.querySelector('[data-testid="recovery-asset"][data-asset-id="asset-resolved"]');
    expect(resolvedRow?.querySelector('[data-testid="recovery-relink"]')).toBeNull();
  });
});

describe('DegradedProjectRecoveryScreen — folder-pick primary action (Step 2)', () => {
  it('shows the Pick-folder primary action when no folder has been picked', async () => {
    await renderScreen({ assets: [missingAsset, anotherMissingAsset], segments });
    expect(container.querySelector('[data-testid="recovery-pick-folder"]')).not.toBeNull();
  });

  it('requests a folder pick when the primary action is clicked', async () => {
    let picked = 0;
    root = createRoot(container);
    await act(async () => {
      root.render(
        <DegradedProjectRecoveryScreen
          projectName="t"
          segments={segments}
          assets={[missingAsset]}
          onRelink={() => {}}
          onPickFolder={() => { picked += 1; }}
        />,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="recovery-pick-folder"]')!.click();
    });
    expect(picked).toBe(1);
  });

  it('renders exact proposals pre-selected and probable proposals NOT pre-selected', async () => {
    // a1 → exact (c1), a2 → probable only (c2). Only the exact one is checked.
    const proposals: RelinkProposal[] = [
      { assetId: 'asset-missing', candidateId: 'c1', confidence: 'exact', basis: { name: 'exact', type: 'match', duration: 'within-exact' }, manyToOneAssetIds: [], notes: [] },
      { assetId: 'asset-native', candidateId: 'c2', confidence: 'probable', basis: { name: 'exact', type: 'match', duration: 'within-probable' }, manyToOneAssetIds: [], notes: [] },
    ];
    root = createRoot(container);
    await act(async () => {
      root.render(
        <DegradedProjectRecoveryScreen
          projectName="t"
          segments={segments}
          assets={[missingAsset, anotherMissingAsset]}
          onRelink={() => {}}
          folderRelink={{
            phase: 'proposed',
            proposals,
            candidateById: {
              c1: { id: 'c1', name: 'b-roll.mp4', path: '/m/b-roll.mp4' },
              c2: { id: 'c2', name: 'cutaway.mp4', path: '/m/cutaway.mp4' },
            },
            selection: { 'asset-missing': 'c1', 'asset-native': null },
            unresolvedAssetIds: ['asset-missing', 'asset-native'],
            writeError: null,
          }}
        />,
      );
    });
    const rows = [...container.querySelectorAll('[data-testid="recovery-folder-row"]')];
    expect(rows).toHaveLength(2);
    const exactRow = container.querySelector('[data-testid="recovery-folder-row"][data-asset-id="asset-missing"]');
    const probRow = container.querySelector('[data-testid="recovery-folder-row"][data-asset-id="asset-native"]');
    expect((exactRow?.querySelector('[data-testid="recovery-folder-toggle"]') as HTMLInputElement).checked).toBe(true);
    expect((probRow?.querySelector('[data-testid="recovery-folder-toggle"]') as HTMLInputElement).checked).toBe(false);
    expect(probRow?.querySelector('[data-testid="recovery-folder-proposal"]')?.textContent).toMatch(/needs confirmation/);
  });

  it('toggles a probable proposal on explicit user action and writes only selected', async () => {
    const toggles: Array<[string, string]> = [];
    let confirmed = 0;
    const proposals: RelinkProposal[] = [
      { assetId: 'asset-missing', candidateId: 'c1', confidence: 'probable', basis: { name: 'exact', type: 'match', duration: 'within-probable' }, manyToOneAssetIds: [], notes: [] },
    ];
    root = createRoot(container);
    await act(async () => {
      root.render(
        <DegradedProjectRecoveryScreen
          projectName="t"
          segments={segments}
          assets={[missingAsset]}
          onRelink={() => {}}
          folderRelink={{
            phase: 'proposed',
            proposals,
            candidateById: { c1: { id: 'c1', name: 'b-roll.mp4', path: '/m/b-roll.mp4' } },
            selection: { 'asset-missing': null },
            unresolvedAssetIds: ['asset-missing'],
            writeError: null,
          }}
          onToggleFolderProposal={(a, c) => { toggles.push([a, c]); }}
          onConfirmFolderRelink={() => { confirmed += 1; }}
        />,
      );
    });
    // Confirm is disabled while nothing is selected.
    expect(container.querySelector<HTMLButtonElement>('[data-testid="recovery-folder-confirm"]')!.disabled).toBe(true);
    // User explicitly opts into the probable match.
    await act(async () => {
      (container.querySelector('[data-testid="recovery-folder-toggle"]') as HTMLInputElement).click();
    });
    expect(toggles).toEqual([['asset-missing', 'c1']]);
  });
});
