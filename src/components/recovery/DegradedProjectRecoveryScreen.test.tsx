// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { DegradedProjectRecoveryScreen } from './DegradedProjectRecoveryScreen';
import { createRecoveryActionsFake } from './recoveryActionsFake';
import type { RecoveryAsset, RecoverySegment } from './degradedLoad';

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

const resolvedAsset: RecoveryAsset = {
  assetId: 'asset-resolved',
  name: 'hero.mp4',
  type: 'video',
  cacheResolved: true,
  nativeResolved: true,
  resolved: true,
};

const cacheOnlyAsset: RecoveryAsset = {
  assetId: 'asset-cache',
  name: 'cutaway.mp4',
  type: 'video',
  cacheResolved: true,
  nativeResolved: false,
  resolved: true,
};

const missingAsset: RecoveryAsset = {
  assetId: 'asset-missing',
  name: 'b-roll.mp4',
  type: 'video',
  cacheResolved: false,
  nativeResolved: false,
  resolved: false,
};

const segments: RecoverySegment[] = [
  { id: 'seg-1', label: 'Hook', assetId: 'asset-resolved', resolutionStatus: 'resolved' },
  { id: 'seg-2', label: 'B-roll', assetId: 'asset-missing', resolutionStatus: 'missing-asset' },
  { id: 'seg-3', label: 'Cutaway', assetId: 'asset-cache', resolutionStatus: 'resolved' },
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

describe('DegradedProjectRecoveryScreen — collapsed nativeResolved contract', () => {
  it('renders per-segment resolution status from props', async () => {
    await renderScreen({
      assets: [resolvedAsset, missingAsset, cacheOnlyAsset],
      segments,
    });
    const rows = [...container.querySelectorAll('[data-testid="recovery-segment"]')];
    expect(rows.map((el) => el.getAttribute('data-resolution-status'))).toEqual([
      'resolved',
      'missing-asset',
      'resolved',
    ]);
    expect(container.textContent).toMatch(/Hook/);
    expect(container.textContent).toMatch(/Missing asset/);
  });

  it('renders missing vs nativeResolved without a backup state', async () => {
    await renderScreen({
      assets: [missingAsset, resolvedAsset, cacheOnlyAsset],
      segments,
    });
    const byId = (id: string): Element => {
      const el = container.querySelector(`[data-testid="recovery-asset"][data-asset-id="${id}"]`);
      if (!el) throw new Error(`missing asset row ${id}`);
      return el;
    };
    expect(byId('asset-missing').getAttribute('data-location')).toBe('missing');
    expect(byId('asset-missing').getAttribute('data-native-resolved')).toBe('false');
    expect(byId('asset-missing').textContent).toMatch(/Missing/);
    expect(byId('asset-resolved').getAttribute('data-location')).toBe('native');
    expect(byId('asset-resolved').getAttribute('data-native-resolved')).toBe('true');
    expect(byId('asset-resolved').textContent).toMatch(/Native copy available/);
    expect(byId('asset-cache').getAttribute('data-location')).toBe('resolved');
    expect(byId('asset-cache').getAttribute('data-unresolved')).toBe('false');
    expect(container.textContent).not.toMatch(/Backup available/);
    expect(container.querySelector('[data-location="backup"]')).toBeNull();
    expect(container.querySelector('[data-location="native-copy"]')).toBeNull();
  });

  it('invokes the re-link fake only for unresolved asset ids', async () => {
    const fake = await renderScreen({
      assets: [missingAsset, resolvedAsset],
      segments,
    });
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="recovery-relink"]')];
    expect(buttons).toHaveLength(1);
    await act(async () => { buttons[0]!.click(); });
    expect(fake.relinked).toEqual(['asset-missing']);
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
