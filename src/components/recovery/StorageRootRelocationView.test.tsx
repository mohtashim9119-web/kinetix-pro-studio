// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import {
  StorageRootRelocationView,
  type StorageRootRelocationViewProps,
  type StorageRootValidationState,
} from './StorageRootRelocationView';
import { formatBytes } from '../../services/webcodecsExport/diskFull';
import { createRecoveryActionsFake } from './recoveryActionsFake';

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

const REQUIRED = 5_450_000_000;
const AVAILABLE = 120_000_000;

async function renderView(
  over: Partial<StorageRootRelocationViewProps> = {},
): Promise<ReturnType<typeof createRecoveryActionsFake>> {
  const fake = createRecoveryActionsFake();
  const props: StorageRootRelocationViewProps = {
    currentRoot: '/Users/me/Library/Application Support/com.kinetix.pro-studio',
    targetVolume: '/Volumes/Media',
    requiredBytes: REQUIRED,
    availableBytes: AVAILABLE,
    validationState: 'insufficient',
    onChooseFolder: fake.onChooseFolder,
    ...over,
  };
  root = createRoot(container);
  await act(async () => {
    root.render(<StorageRootRelocationView {...props} />);
  });
  return fake;
}

describe('StorageRootRelocationView — props in, no arithmetic', () => {
  it('renders current root, target volume, required bytes, and available bytes from props', async () => {
    await renderView();
    expect(container.querySelector('[data-testid="relocation-current-root"]')?.textContent)
      .toBe('/Users/me/Library/Application Support/com.kinetix.pro-studio');
    expect(container.querySelector('[data-testid="relocation-target-volume"]')?.textContent)
      .toBe('/Volumes/Media');
    expect(container.querySelector('[data-testid="relocation-required-bytes"]')?.textContent)
      .toBe(formatBytes(REQUIRED));
    expect(container.querySelector('[data-testid="relocation-available-bytes"]')?.textContent)
      .toBe(formatBytes(AVAILABLE));
  });

  it.each<[StorageRootValidationState, string]>([
    ['ok', 'Target volume has enough space'],
    ['insufficient', 'Not enough space on the target volume'],
    ['error', 'Could not validate the target volume'],
  ])('validationState %s is displayed, not derived from the byte props', async (validationState, label) => {
    await renderView({
      validationState,
      // Deliberately contradictory numbers: ok + available << required.
      requiredBytes: 9_000_000_000,
      availableBytes: 1,
    });
    const el = container.querySelector('[data-testid="relocation-validation"]');
    expect(el?.getAttribute('data-state')).toBe(validationState);
    expect(el?.textContent).toBe(label);
    expect(container.querySelector('[data-testid="storage-root-relocation"]')?.getAttribute('data-validation'))
      .toBe(validationState);
  });

  it('fires the choose-folder fake without inspecting the filesystem', async () => {
    const fake = await renderView();
    const button = container.querySelector<HTMLButtonElement>('[data-testid="relocation-choose-folder"]');
    expect(button).not.toBeNull();
    await act(async () => { button!.click(); });
    expect(fake.chooseFolderCount).toBe(1);
  });
});
