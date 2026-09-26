// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Media workflow Unit 2 — the "Match media to scenes" button lives in the
// Media block header and fires one callback; the matching itself is
// `matchMediaToScenes.ts` (tested there) and App's handler.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

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

describe('Media block — Match media to scenes button (Unit 2)', () => {
  it('is in the header and fires onMatchMedia once per click', async () => {
    const onMatchMedia = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={[{ id: 'a1', name: '001.png', url: '', type: 'image' }]} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop} onMatchMedia={onMatchMedia}
        />,
      );
    });
    const button = container.querySelector<HTMLButtonElement>('[data-testid="media-block-match"]');
    expect(button).not.toBeNull();
    expect(button!.getAttribute('aria-label')).toBe('Match media to scenes');
    await act(async () => { button!.click(); });
    expect(onMatchMedia).toHaveBeenCalledTimes(1);
  });
});
