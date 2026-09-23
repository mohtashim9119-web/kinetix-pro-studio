// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { Asset, VideoSegment } from '../types';

const mockIngestLooseFiles = vi.fn();
vi.mock('../services/mediaIngest', () => ({
  sha256Hex: vi.fn(async () => 'deadbeef'),
  ingestLooseFiles: (...args: unknown[]) => mockIngestLooseFiles(...args),
}));

const mockIngestZip = vi.fn();
vi.mock('../services/zipIngest', () => ({
  ingestZip: (...args: unknown[]) => mockIngestZip(...args),
  ZipTooLargeError: class ZipTooLargeError extends Error {},
}));

const mockGenerateThumbnail = vi.fn();
const mockReadThumbnail = vi.fn();
vi.mock('../services/mediaVaultClient', () => ({
  mediaVaultGenerateThumbnail: (...args: unknown[]) => mockGenerateThumbnail(...args),
  mediaVaultReadThumbnail: (...args: unknown[]) => mockReadThumbnail(...args),
}));

vi.mock('../services/assetStore', () => ({
  getAsset: vi.fn(async () => null),
}));

import { MediaBlock, usageCount } from './MediaBlock';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  mockIngestLooseFiles.mockReset();
  mockIngestZip.mockReset();
  mockGenerateThumbnail.mockReset().mockResolvedValue(false);
  mockReadThumbnail.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function makeAsset(overrides: Partial<Asset> & { id: string }): Asset {
  return {
    name: `${overrides.id}.jpg`,
    url: `blob:${overrides.id}`,
    type: 'image',
    ...overrides,
  };
}

function makeSegment(overrides: Partial<VideoSegment> & { id: string }): VideoSegment {
  return {
    text: '',
    startTime: 0,
    duration: 1,
    ...overrides,
  } as VideoSegment;
}

const noop = () => {};

/** React tracks an input's previous value on a hidden property to dedupe
 *  onChange dispatches — setting `.value` directly (without going through
 *  the native setter) is invisible to it, so a plain `input.value = 'x'`
 *  never fires the component's onChange. This is the standard workaround. */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** jsdom has no `DataTransfer` — a plain FileList-shaped array satisfies
 *  every use this component makes of `e.target.files` (`Array.from`,
 *  `.length`, `[0]`). */
function setInputFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
}

describe('MediaBlock', () => {
  it('renders nothing when the project has no assets', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={[]} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop}
        />,
      );
    });
    expect(container.querySelector('[data-testid="media-block"]')).toBeNull();
  });

  it('renders one tile per asset', async () => {
    const assets = [makeAsset({ id: 'a1' }), makeAsset({ id: 'a2' })];
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={assets} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop}
        />,
      );
    });
    expect(container.querySelectorAll('[data-testid="media-block-tile"]').length).toBe(2);
  });

  it('shows "Unused" for an asset no segment references, and "N×" for one that is used, from real usage counting', async () => {
    const assets = [makeAsset({ id: 'a1' }), makeAsset({ id: 'a2' })];
    const segments = [
      makeSegment({ id: 's1', assetId: 'a1' }),
      makeSegment({ id: 's2', assetId: 'a1' }),
    ];
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={assets} segments={segments} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop}
        />,
      );
    });
    const chips = Array.from(container.querySelectorAll('[data-testid="media-block-usage-chip"]')).map(el => el.textContent);
    expect(chips.sort()).toEqual(['2×', 'Unused']);
  });

  it('clicking a used-in-N chip calls onHighlightUsage with that asset\'s id', async () => {
    const assets = [makeAsset({ id: 'a1' })];
    const segments = [makeSegment({ id: 's1', assetId: 'a1' })];
    const onHighlightUsage = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={assets} segments={segments} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={onHighlightUsage}
          onIngestComplete={noop} onIngestError={noop}
        />,
      );
    });
    const chip = container.querySelector('[data-testid="media-block-usage-chip"]') as HTMLButtonElement;
    await act(async () => { chip.click(); });
    expect(onHighlightUsage).toHaveBeenCalledWith('a1');
  });

  it('an unused asset\'s chip is disabled — clicking it does nothing', async () => {
    const assets = [makeAsset({ id: 'a1' })];
    const onHighlightUsage = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={assets} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={onHighlightUsage}
          onIngestComplete={noop} onIngestError={noop}
        />,
      );
    });
    const chip = container.querySelector('[data-testid="media-block-usage-chip"]') as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
  });

  it('an unresolved (offline) asset shows the relink door AS-IS, reusing onOpenRelinkMedia', async () => {
    const assets = [makeAsset({ id: 'a1', unresolved: true })];
    const onOpenRelinkMedia = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={assets} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={onOpenRelinkMedia} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop}
        />,
      );
    });
    const relinkButton = container.querySelector('[data-testid="media-block-relink"]') as HTMLButtonElement;
    expect(relinkButton).not.toBeNull();
    await act(async () => { relinkButton.click(); });
    expect(onOpenRelinkMedia).toHaveBeenCalledTimes(1);
  });

  it('the search box filters tiles by asset name', async () => {
    const assets = [makeAsset({ id: 'a1', name: 'sunset.jpg' }), makeAsset({ id: 'a2', name: 'city.jpg' })];
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={assets} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop}
        />,
      );
    });
    const input = container.querySelector('input[placeholder="Search media…"]') as HTMLInputElement;
    await act(async () => { setInputValue(input, 'sunset'); });
    expect(container.querySelectorAll('[data-testid="media-block-tile"]').length).toBe(1);
  });

  it('adding loose files calls ingestLooseFiles and reports the result via onIngestComplete', async () => {
    const asset = makeAsset({ id: 'new-1' });
    mockIngestLooseFiles.mockResolvedValue({
      assets: [asset], audioAssetId: undefined,
      counts: { imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 0 },
      duplicateNames: [],
    });
    const onIngestComplete = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={[makeAsset({ id: 'a1' })]} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={onIngestComplete} onIngestError={noop}
        />,
      );
    });
    const fileInput = container.querySelector('input[type="file"][multiple]:not([webkitdirectory])') as HTMLInputElement;
    const file = new File([new Uint8Array([1])], 'photo.jpg');
    setInputFiles(fileInput, [file]);
    await act(async () => { fileInput.dispatchEvent(new Event('change', { bubbles: true })); });

    expect(mockIngestLooseFiles).toHaveBeenCalledWith('p1', [file], []);
    expect(onIngestComplete).toHaveBeenCalledWith({
      assets: [asset], audioAssetId: undefined,
      counts: { imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 0 },
      duplicateNames: [],
      source: 'files',
    });
  });

  // G6 polish item 1 — OLD BUG: this call used to be
  // `mockIngestLooseFiles).toHaveBeenCalledWith('p1', [file])`, i.e. the
  // project's own already-imported content hashes were never threaded
  // through, so a second "add files" for identical bytes got a fresh dedup
  // set every time and silently stacked a duplicate Asset record. Fixed by
  // passing every existing asset's `contentHash` as ingestLooseFiles'/
  // ingestZip's third argument.
  it('passes the project\'s existing asset content hashes to ingestLooseFiles, so a re-import of identical bytes dedupes against the project', async () => {
    mockIngestLooseFiles.mockResolvedValue({
      assets: [], audioAssetId: undefined,
      counts: { imported: 0, deduped: 1, unsupportedSkipped: 0, failed: 0 },
      duplicateNames: ['photo.jpg'],
    });
    const existing = [
      makeAsset({ id: 'a1', contentHash: 'hash-a' }),
      makeAsset({ id: 'a2', contentHash: 'hash-b' }),
      makeAsset({ id: 'a3' }), // no contentHash yet (pre-backfill) — must not crash/appear as 'undefined'
    ];
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={existing} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop}
        />,
      );
    });
    const fileInput = container.querySelector('input[type="file"][multiple]:not([webkitdirectory])') as HTMLInputElement;
    const file = new File([new Uint8Array([1])], 'photo.jpg');
    setInputFiles(fileInput, [file]);
    await act(async () => { fileInput.dispatchEvent(new Event('change', { bubbles: true })); });

    expect(mockIngestLooseFiles).toHaveBeenCalledWith('p1', [file], ['hash-a', 'hash-b']);
  });

  it('passes the project\'s existing asset content hashes to ingestZip too', async () => {
    mockIngestZip.mockResolvedValue({
      assets: [], audioAssetId: undefined,
      counts: { imported: 0, deduped: 0, unsupportedSkipped: 0, failed: 0 },
      duplicateNames: [],
    });
    const existing = [makeAsset({ id: 'a1', contentHash: 'hash-a' })];
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={existing} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop}
        />,
      );
    });
    const zipInput = container.querySelector('input[accept=".zip"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1])], 'archive.zip');
    setInputFiles(zipInput, [file]);
    await act(async () => { zipInput.dispatchEvent(new Event('change', { bubbles: true })); });

    expect(mockIngestZip).toHaveBeenCalledWith('p1', file, ['hash-a']);
  });

  it('a rejected zip ingest reports its message via onIngestError, never throws uncaught', async () => {
    mockIngestZip.mockRejectedValue(Object.assign(new Error('too big'), { name: 'ZipTooLargeError' }));
    const onIngestError = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={[makeAsset({ id: 'a1' })]} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={onIngestError}
        />,
      );
    });
    const zipInput = container.querySelector('input[accept=".zip"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1])], 'archive.zip');
    setInputFiles(zipInput, [file]);
    await act(async () => { zipInput.dispatchEvent(new Event('change', { bubbles: true })); });

    expect(onIngestError).toHaveBeenCalledTimes(1);
  });

  // G6 polish item 4 — the project's voiceover is spine, not presentation
  // media. OLD BUG (documented via the underlying primitive, since the
  // component itself is now fixed and can no longer reproduce it): plain
  // segment-reference counting alone reads a voiceover asset as "Unused"
  // (0) because a voiceover is referenced via `project.voiceoverId`, never
  // via any `VideoSegment.assetId` — this is exactly why deleting it from
  // the old, unfiltered media grid both killed the timeline voiceover
  // (handleDeleteAsset clears voiceoverId on delete, App.tsx:6274) AND the
  // grid showed it as "Unused" right up until the delete.
  it('OLD BUG (documented): plain segment-reference counting alone reads a voiceover asset as unused', () => {
    expect(usageCount([], 'voice-1', undefined)).toBe(0);
  });

  it('FIXED (4b, defense in depth): a spine-referenced asset always counts as used, never 0, even with no segment references', () => {
    expect(usageCount([], 'voice-1', 'voice-1')).toBeGreaterThan(0);
  });

  it('FIXED (4a): the project voiceover is excluded from the grid entirely — no tile, no delete affordance', async () => {
    const assets = [
      makeAsset({ id: 'voice-1', type: 'audio', name: 'narration.mp3' }),
      makeAsset({ id: 'img-1', name: 'photo.jpg' }),
    ];
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={assets} segments={[]} voiceoverId="voice-1"
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop}
        />,
      );
    });
    const tiles = container.querySelectorAll('[data-testid="media-block-tile"]');
    expect(tiles.length).toBe(1);
    expect(container.textContent).not.toContain('narration.mp3');
    expect(container.querySelector('h3')?.textContent).toBe('Media (1)');
  });

  it('FIXED (4a): a project whose ONLY asset is the voiceover renders nothing, same as an empty project', async () => {
    const assets = [makeAsset({ id: 'voice-1', type: 'audio', name: 'narration.mp3' })];
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={assets} segments={[]} voiceoverId="voice-1"
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop}
        />,
      );
    });
    expect(container.querySelector('[data-testid="media-block"]')).toBeNull();
  });

  // G6 polish item 3 — bulk "Delete unused".
  describe('bulk "Delete unused"', () => {
    it('the button is disabled and shows (0) when nothing is unused', async () => {
      const assets = [makeAsset({ id: 'a1' })];
      const segments = [makeSegment({ id: 's1', assetId: 'a1' })];
      root = createRoot(container);
      await act(async () => {
        root.render(
          <MediaBlock
            projectId="p1" assets={assets} segments={segments} voiceoverId={undefined}
            onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
            onIngestComplete={noop} onIngestError={noop}
          />,
        );
      });
      const button = container.querySelector('[data-testid="media-block-delete-unused"]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.title).toBe('Delete unused (0)');
    });

    it('shows the live unused count and, on confirm, deletes every unused asset through onDeleteAsset (the existing per-asset delete path)', async () => {
      const assets = [
        makeAsset({ id: 'used-1' }),
        makeAsset({ id: 'unused-1' }),
        makeAsset({ id: 'unused-2' }),
      ];
      const segments = [makeSegment({ id: 's1', assetId: 'used-1' })];
      const onDeleteAsset = vi.fn();
      root = createRoot(container);
      await act(async () => {
        root.render(
          <MediaBlock
            projectId="p1" assets={assets} segments={segments} voiceoverId={undefined}
            onDeleteAsset={onDeleteAsset} onOpenRelinkMedia={noop} onHighlightUsage={noop}
            onIngestComplete={noop} onIngestError={noop}
          />,
        );
      });
      const button = container.querySelector('[data-testid="media-block-delete-unused"]') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      expect(button.title).toBe('Delete unused (2)');

      await act(async () => { button.click(); });
      const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
      expect(dialog.textContent).toContain('Delete 2 unused items?');
      expect(dialog.textContent).toContain('Their files stay in the vault until you free up cached data.');

      const confirmButton = dialog.querySelector('[data-testid="confirm-dialog-confirm"]') as HTMLButtonElement;
      await act(async () => { confirmButton.click(); });

      expect(onDeleteAsset).toHaveBeenCalledTimes(2);
      expect(onDeleteAsset).toHaveBeenCalledWith('unused-1');
      expect(onDeleteAsset).toHaveBeenCalledWith('unused-2');
      expect(onDeleteAsset).not.toHaveBeenCalledWith('used-1');
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('cancel closes the dialog without deleting anything', async () => {
      const assets = [makeAsset({ id: 'unused-1' })];
      const onDeleteAsset = vi.fn();
      root = createRoot(container);
      await act(async () => {
        root.render(
          <MediaBlock
            projectId="p1" assets={assets} segments={[]} voiceoverId={undefined}
            onDeleteAsset={onDeleteAsset} onOpenRelinkMedia={noop} onHighlightUsage={noop}
            onIngestComplete={noop} onIngestError={noop}
          />,
        );
      });
      const button = container.querySelector('[data-testid="media-block-delete-unused"]') as HTMLButtonElement;
      await act(async () => { button.click(); });
      const cancelButton = container.querySelector('[data-testid="confirm-dialog-cancel"]') as HTMLButtonElement;
      await act(async () => { cancelButton.click(); });

      expect(onDeleteAsset).not.toHaveBeenCalled();
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    });
  });

  // G6 polish item 5 — single-delete confirmations.
  describe('single-delete confirmation', () => {
    it('an unused asset deletes directly, no dialog', async () => {
      const onDeleteAsset = vi.fn();
      root = createRoot(container);
      await act(async () => {
        root.render(
          <MediaBlock
            projectId="p1" assets={[makeAsset({ id: 'a1' })]} segments={[]} voiceoverId={undefined}
            onDeleteAsset={onDeleteAsset} onOpenRelinkMedia={noop} onHighlightUsage={noop}
            onIngestComplete={noop} onIngestError={noop}
          />,
        );
      });
      const deleteButton = container.querySelector('[title="Delete"]') as HTMLButtonElement;
      await act(async () => { deleteButton.click(); });
      expect(onDeleteAsset).toHaveBeenCalledWith('a1');
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('a used asset shows a confirmation naming the scene count; cancel deletes nothing; confirm deletes it', async () => {
      const assets = [makeAsset({ id: 'a1' })];
      const segments = [
        makeSegment({ id: 's1', assetId: 'a1' }),
        makeSegment({ id: 's2', assetId: 'a1' }),
        makeSegment({ id: 's3', assetId: 'a1' }),
      ];
      const onDeleteAsset = vi.fn();
      root = createRoot(container);
      await act(async () => {
        root.render(
          <MediaBlock
            projectId="p1" assets={assets} segments={segments} voiceoverId={undefined}
            onDeleteAsset={onDeleteAsset} onOpenRelinkMedia={noop} onHighlightUsage={noop}
            onIngestComplete={noop} onIngestError={noop}
          />,
        );
      });
      const deleteButton = container.querySelector('[title="Delete"]') as HTMLButtonElement;
      await act(async () => { deleteButton.click(); });
      expect(onDeleteAsset).not.toHaveBeenCalled();

      const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
      expect(dialog.textContent).toContain('Used in 3 scenes. Delete anyway?');
      expect(dialog.textContent).toContain('Those scenes will show as missing until you relink or replace.');

      const cancelButton = dialog.querySelector('[data-testid="confirm-dialog-cancel"]') as HTMLButtonElement;
      await act(async () => { cancelButton.click(); });
      expect(onDeleteAsset).not.toHaveBeenCalled();
      expect(container.querySelector('[role="dialog"]')).toBeNull();

      await act(async () => { deleteButton.click(); });
      const confirmButton = container.querySelector('[data-testid="confirm-dialog-confirm"]') as HTMLButtonElement;
      await act(async () => { confirmButton.click(); });
      expect(onDeleteAsset).toHaveBeenCalledWith('a1');
    });
  });

  it('deleting a tile calls onDeleteAsset with that asset\'s id', async () => {
    const onDeleteAsset = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={[makeAsset({ id: 'a1' })]} segments={[]} voiceoverId={undefined}
          onDeleteAsset={onDeleteAsset} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop}
        />,
      );
    });
    const deleteButton = container.querySelector('[title="Delete"]') as HTMLButtonElement;
    await act(async () => { deleteButton.click(); });
    expect(onDeleteAsset).toHaveBeenCalledWith('a1');
  });
});
