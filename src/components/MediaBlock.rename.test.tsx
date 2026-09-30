// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Media workflow Unit 1 — inline rename on a Media block tile. The tile's
// name is the match key for "Match media to scenes" (Unit 2), so a wrongly
// named file is fixed here, in place: click the name -> input; Enter or
// click-away commits (trimmed); Escape cancels; empty is rejected. A copy
// icon puts the name on the clipboard (native select/copy/paste covers the
// rest inside the input itself).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { Asset } from '../types';

vi.mock('../services/mediaIngest', () => ({ sha256Hex: vi.fn(async () => 'deadbeef'), ingestLooseFiles: vi.fn() }));
vi.mock('../services/zipIngest', () => ({ ingestZip: vi.fn(), ZipTooLargeError: class extends Error {} }));
vi.mock('../services/mediaVaultClient', () => ({
  mediaVaultGenerateThumbnailDetailed: vi.fn(async () => 'unavailable'),
  mediaVaultReadThumbnail: vi.fn(async () => null),
  mediaVaultListEntries: vi.fn(async () => []),
}));
vi.mock('../services/assetStore', () => ({ getAsset: vi.fn(async () => null) }));

import { MediaBlock } from './MediaBlock';

let container: HTMLDivElement;
let root: Root;
const onRenameAsset = vi.fn();
const noop = () => {};

const asset: Asset = { id: 'a1', name: 'wrong_name.png', url: 'blob:a1', type: 'image' };

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function mount(): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MediaBlock
        projectId="p1" assets={[asset]} segments={[]} voiceoverId={undefined}
        onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
        onIngestComplete={noop} onIngestError={noop}
        onRenameAsset={onRenameAsset}
      />,
    );
  });
}

function nameButton(): HTMLElement {
  return container.querySelector<HTMLElement>('[data-testid="media-block-name"]')!;
}
function nameInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('[data-testid="media-block-name-input"]');
}
async function startEdit(): Promise<HTMLInputElement> {
  await act(async () => { nameButton().click(); });
  const input = nameInput();
  expect(input, 'clicking the name must open an inline input').not.toBeNull();
  return input!;
}
async function key(input: HTMLInputElement, k: string): Promise<void> {
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  onRenameAsset.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Media block — inline rename (Unit 1)', () => {
  it('Enter commits the trimmed name', async () => {
    await mount();
    const input = await startEdit();
    expect(input.value).toBe('wrong_name.png');
    await act(async () => { setInputValue(input, '  004_savings_account.png  '); });
    await key(input, 'Enter');
    expect(onRenameAsset).toHaveBeenCalledWith('a1', '004_savings_account.png');
    expect(nameInput()).toBeNull();
  });

  it('click-away (blur) commits', async () => {
    await mount();
    const input = await startEdit();
    await act(async () => { setInputValue(input, 'renamed.png'); });
    await act(async () => { input.blur(); });
    expect(onRenameAsset).toHaveBeenCalledWith('a1', 'renamed.png');
  });

  it('Escape cancels — nothing committed, the old name stays', async () => {
    await mount();
    const input = await startEdit();
    await act(async () => { setInputValue(input, 'discard me.png'); });
    await key(input, 'Escape');
    expect(onRenameAsset).not.toHaveBeenCalled();
    expect(nameInput()).toBeNull();
    expect(nameButton().textContent).toBe('wrong_name.png');
  });

  it('an empty / whitespace-only name is rejected', async () => {
    await mount();
    const input = await startEdit();
    await act(async () => { setInputValue(input, '   '); });
    await key(input, 'Enter');
    expect(onRenameAsset).not.toHaveBeenCalled();
    expect(nameButton().textContent).toBe('wrong_name.png');
  });

  it('an unchanged name commits nothing', async () => {
    await mount();
    const input = await startEdit();
    await key(input, 'Enter');
    expect(onRenameAsset).not.toHaveBeenCalled();
  });

  it('the copy icon puts the name on the clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount();
    const copy = container.querySelector<HTMLElement>('[data-testid="media-block-copy-name"]');
    expect(copy).not.toBeNull();
    await act(async () => { copy!.click(); });
    expect(writeText).toHaveBeenCalledWith('wrong_name.png');
  });
});
