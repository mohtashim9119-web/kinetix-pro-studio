// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Media workflow Unit 3 — a Media block tile is a drag source on the
// dedicated asset channel (payload = asset id); the timeline segment card
// is the drop target (Timeline.assetDrop.test.tsx). While its name is being
// edited the tile is not draggable, so text selection inside the input works.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ASSET_DRAG_MIME } from '../services/assetDragChannel';

vi.mock('../services/mediaIngest', () => ({ sha256Hex: vi.fn(async () => 'deadbeef'), ingestLooseFiles: vi.fn() }));
vi.mock('../services/zipIngest', () => ({ ingestZip: vi.fn(), ZipTooLargeError: class extends Error {} }));
vi.mock('../services/mediaVaultClient', () => ({
  mediaVaultGenerateThumbnail: vi.fn(async () => false),
  mediaVaultReadThumbnail: vi.fn(async () => null),
}));
vi.mock('../services/assetStore', () => ({ getAsset: vi.fn(async () => null) }));

import { MediaBlock } from './MediaBlock';

let container: HTMLDivElement;
let root: Root;
const noop = () => {};

beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Media block tile — drag source (Unit 3)', () => {
  it('is draggable and puts its asset id on the asset channel', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={[{ id: 'a7', name: '007.png', url: '', type: 'image' }]} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop} onRenameAsset={noop}
        />,
      );
    });
    const tile = container.querySelector<HTMLElement>('[data-testid="media-block-tile"]')!;
    expect(tile.getAttribute('draggable')).toBe('true');

    const setData = vi.fn();
    const start = new Event('dragstart', { bubbles: true });
    Object.defineProperty(start, 'dataTransfer', { value: { setData, effectAllowed: 'all' } });
    await act(async () => { tile.dispatchEvent(start); });
    expect(setData).toHaveBeenCalledWith(ASSET_DRAG_MIME, 'a7');

    // Editing the name turns dragging off for that tile.
    await act(async () => { container.querySelector<HTMLElement>('[data-testid="media-block-name"]')!.click(); });
    expect(tile.getAttribute('draggable')).toBe('false');
  });
});
