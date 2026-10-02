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
const mockListEntries = vi.fn();
vi.mock('../services/mediaVaultClient', () => ({
  mediaVaultGenerateThumbnailDetailed: (...args: unknown[]) => mockGenerateThumbnail(...args),
  mediaVaultReadThumbnail: (...args: unknown[]) => mockReadThumbnail(...args),
  mediaVaultListEntries: (...args: unknown[]) => mockListEntries(...args),
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
  mockGenerateThumbnail.mockReset().mockResolvedValue('unavailable');
  mockReadThumbnail.mockReset().mockResolvedValue(null);
  mockListEntries.mockReset().mockResolvedValue([{ contentHash: 'deadbeef' }]);
  sessionStorage.clear();
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

/** Same React value-tracker workaround as `setInputValue`, but for
 *  `<select>` — its native value setter lives on `HTMLSelectElement`, a
 *  different prototype than `HTMLInputElement`'s. */
function setSelectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('MediaBlock', () => {
  it('U9: an empty project renders the block in its empty state (drop zone + add doors), never nothing', async () => {
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
    expect(container.querySelector('[data-testid="media-block"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="media-block-empty"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="media-block-tile"]').length).toBe(0);
    expect(container.querySelector('[aria-label="Import media"]')).not.toBeNull();
    expect(container.querySelector('h3')?.textContent).toBe('Media (0)');
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

  // G6 polish item 6 — type/usage filters are chip buttons, not <select>s.
  describe('type/usage chip filters', () => {
    it('the type chips filter the grid, and clicking one marks it aria-checked', async () => {
      const assets = [
        makeAsset({ id: 'v1', type: 'video', name: 'clip.mp4' }),
        makeAsset({ id: 'i1', type: 'image', name: 'photo.jpg' }),
      ];
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

      const typeGroup = container.querySelector('[role="radiogroup"][aria-label="Filter by type"]') as HTMLElement;
      const videoChip = Array.from(typeGroup.querySelectorAll('[role="radio"]'))
        .find(el => el.getAttribute('title') === 'Video only') as HTMLButtonElement;
      await act(async () => { videoChip.click(); });

      expect(container.querySelectorAll('[data-testid="media-block-tile"]').length).toBe(1);
      expect(videoChip.getAttribute('aria-checked')).toBe('true');
    });

    it('the usage chips filter the grid and the Unused chip carries the live count', async () => {
      const assets = [makeAsset({ id: 'used-1' }), makeAsset({ id: 'unused-1' })];
      const segments = [makeSegment({ id: 's1', assetId: 'used-1' })];
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
      const usageGroup = container.querySelector('[role="radiogroup"][aria-label="Filter by usage"]') as HTMLElement;
      const unusedChip = Array.from(usageGroup.querySelectorAll('[role="radio"]'))
        .find(el => el.textContent?.startsWith('Unused')) as HTMLButtonElement;
      expect(unusedChip.textContent).toBe('Unused (1)');

      await act(async () => { unusedChip.click(); });
      const tileNames = Array.from(container.querySelectorAll('[data-testid="media-block-tile"] p[title]'))
        .map(p => p.getAttribute('title'));
      expect(tileNames).toEqual(['unused-1.jpg']);
    });
  });

  // G6 polish item 2 — sort control.
  describe('sort control', () => {
    function tileOrder(): (string | null)[] {
      return Array.from(container.querySelectorAll('[data-testid="media-block-tile"] p[title]'))
        .map(p => p.getAttribute('title'));
    }

    const sortAssets = [
      makeAsset({ id: 'b', name: 'banana.jpg', addedAt: 200 }),
      makeAsset({ id: 'a', name: 'apple.jpg', addedAt: 300 }),
      makeAsset({ id: 'c', name: 'cherry.jpg', addedAt: 100 }),
    ];

    it('defaults to Newest first', async () => {
      root = createRoot(container);
      await act(async () => {
        root.render(
          <MediaBlock
            projectId="p1" assets={sortAssets} segments={[]} voiceoverId={undefined}
            onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
            onIngestComplete={noop} onIngestError={noop}
          />,
        );
      });
      const select = container.querySelector('[data-testid="media-block-sort"]') as HTMLSelectElement;
      expect(select.value).toBe('newest');
      expect(tileOrder()).toEqual(['apple.jpg', 'banana.jpg', 'cherry.jpg']);
    });

    it('all four sort orders reorder the grid correctly', async () => {
      root = createRoot(container);
      await act(async () => {
        root.render(
          <MediaBlock
            projectId="p1" assets={sortAssets} segments={[]} voiceoverId={undefined}
            onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
            onIngestComplete={noop} onIngestError={noop}
          />,
        );
      });
      const select = container.querySelector('[data-testid="media-block-sort"]') as HTMLSelectElement;

      await act(async () => { setSelectValue(select, 'oldest'); });
      expect(tileOrder()).toEqual(['cherry.jpg', 'banana.jpg', 'apple.jpg']);

      await act(async () => { setSelectValue(select, 'name-asc'); });
      expect(tileOrder()).toEqual(['apple.jpg', 'banana.jpg', 'cherry.jpg']);

      await act(async () => { setSelectValue(select, 'name-desc'); });
      expect(tileOrder()).toEqual(['cherry.jpg', 'banana.jpg', 'apple.jpg']);

      await act(async () => { setSelectValue(select, 'newest'); });
      expect(tileOrder()).toEqual(['apple.jpg', 'banana.jpg', 'cherry.jpg']);
    });

    it('persists the choice for the session (sessionStorage) and a remount reads it back', async () => {
      root = createRoot(container);
      await act(async () => {
        root.render(
          <MediaBlock
            projectId="p1" assets={sortAssets} segments={[]} voiceoverId={undefined}
            onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
            onIngestComplete={noop} onIngestError={noop}
          />,
        );
      });
      const select = container.querySelector('[data-testid="media-block-sort"]') as HTMLSelectElement;
      await act(async () => { setSelectValue(select, 'name-asc'); });
      expect(sessionStorage.getItem('kx-media-block-sort')).toBe('name-asc');

      act(() => root.unmount());
      root = createRoot(container);
      await act(async () => {
        root.render(
          <MediaBlock
            projectId="p1" assets={sortAssets} segments={[]} voiceoverId={undefined}
            onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
            onIngestComplete={noop} onIngestError={noop}
          />,
        );
      });
      const select2 = container.querySelector('[data-testid="media-block-sort"]') as HTMLSelectElement;
      expect(select2.value).toBe('name-asc');
      expect(tileOrder()).toEqual(['apple.jpg', 'banana.jpg', 'cherry.jpg']);
    });
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

    expect(mockIngestLooseFiles).toHaveBeenCalledWith('p1', [file], [], [], expect.any(Function));
    expect(onIngestComplete).toHaveBeenCalledWith({
      assets: [asset], audioAssetId: undefined,
      counts: { imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 0 },
      duplicateNames: [],
      source: 'files',
    });
  });

  describe('G5 Unit 5 — import progress adequacy', () => {
    it('shows a live "Importing N files…" label while ingestLooseFiles is in flight, then clears it', async () => {
      let resolveIngest: (v: unknown) => void = () => {};
      mockIngestLooseFiles.mockReturnValue(new Promise((resolve) => { resolveIngest = resolve; }));
      root = createRoot(container);
      await act(async () => {
        root.render(
          <MediaBlock
            projectId="p1" assets={[makeAsset({ id: "seed" })]} segments={[]} voiceoverId={undefined}
            onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
            onIngestComplete={noop} onIngestError={noop}
          />,
        );
      });
      const fileInput = container.querySelector('input[type="file"][multiple]:not([webkitdirectory])') as HTMLInputElement;
      const files = [new File([new Uint8Array([1])], 'a.jpg'), new File([new Uint8Array([2])], 'b.jpg')];
      setInputFiles(fileInput, files);
      await act(async () => { fileInput.dispatchEvent(new Event('change', { bubbles: true })); });

      expect(container.textContent).toContain('Importing 2 files…');

      await act(async () => {
        resolveIngest({
          assets: [], audioAssetId: undefined,
          counts: { imported: 2, deduped: 0, unsupportedSkipped: 0, failed: 0 },
          duplicateNames: [],
        });
        await Promise.resolve();
      });
      expect(container.textContent).not.toContain('Importing 2 files…');
    });

    it('a single-file import is singular: "Importing 1 file…", not "1 files"', async () => {
      let resolveIngest: (v: unknown) => void = () => {};
      mockIngestLooseFiles.mockReturnValue(new Promise((resolve) => { resolveIngest = resolve; }));
      root = createRoot(container);
      await act(async () => {
        root.render(
          <MediaBlock
            projectId="p1" assets={[makeAsset({ id: "seed" })]} segments={[]} voiceoverId={undefined}
            onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
            onIngestComplete={noop} onIngestError={noop}
          />,
        );
      });
      const fileInput = container.querySelector('input[type="file"][multiple]:not([webkitdirectory])') as HTMLInputElement;
      setInputFiles(fileInput, [new File([new Uint8Array([1])], 'a.jpg')]);
      await act(async () => { fileInput.dispatchEvent(new Event('change', { bubbles: true })); });

      expect(container.textContent).toContain('Importing 1 file…');
      expect(container.textContent).not.toContain('Importing 1 files…');

      await act(async () => {
        resolveIngest({ assets: [], audioAssetId: undefined, counts: { imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 0 }, duplicateNames: [] });
        await Promise.resolve();
      });
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

    expect(mockIngestLooseFiles).toHaveBeenCalledWith('p1', [file], ['hash-a', 'hash-b'], [], expect.any(Function));
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
    const zipInput = container.querySelector('input[type="file"][multiple]:not([webkitdirectory])') as HTMLInputElement;
    const file = new File([new Uint8Array([1])], 'archive.zip');
    setInputFiles(zipInput, [file]);
    await act(async () => { zipInput.dispatchEvent(new Event('change', { bubbles: true })); });

    expect(mockIngestZip).toHaveBeenCalledWith('p1', file, ['hash-a'], [], expect.any(Function));
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
    const zipInput = container.querySelector('input[type="file"][multiple]:not([webkitdirectory])') as HTMLInputElement;
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

  it('FIXED (4a): a project whose ONLY asset is the voiceover shows the empty state, same as an empty project', async () => {
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
    expect(container.querySelector('[data-testid="media-block-empty"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="media-block-tile"]').length).toBe(0);
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

// Wave 3 U9 — one always-visible surface.
describe('U9 — always-visible Media block', () => {
  const ZERO_COUNTS = { imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 0 };

  it('delete-all confirms first, then leaves the block IN PLACE in its empty state (the vanishing-block bug)', async () => {
    const onDeleteAllMedia = vi.fn();
    const assets = [makeAsset({ id: 'a1' })];
    root = createRoot(container);
    const render = async (list: Asset[]) => act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={list} segments={[makeSegment({ id: 's1', assetId: 'a1' })]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop} onDeleteAllMedia={onDeleteAllMedia}
        />,
      );
    });
    await render(assets);
    await act(async () => { (container.querySelector('[data-testid="media-block-delete-all"]') as HTMLButtonElement).click(); });
    expect(onDeleteAllMedia).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('1 scene will show as [NO ASSET] placeholders');
    const confirm = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'Delete all')!;
    await act(async () => { confirm.click(); });
    expect(onDeleteAllMedia).toHaveBeenCalledTimes(1);

    await render([]); // the parent removed every asset
    expect(container.querySelector('[data-testid="media-block"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="media-block-empty"]')).not.toBeNull();
    expect((container.querySelector('[data-testid="media-block-delete-all"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('the parent can push dropped media through the same ingest doors (ref handle): files and zips', async () => {
    mockIngestLooseFiles.mockResolvedValue({ assets: [], audioAssetId: undefined, counts: ZERO_COUNTS, duplicateNames: [] });
    mockIngestZip.mockResolvedValue({ assets: [], audioAssetId: undefined, counts: ZERO_COUNTS, duplicateNames: [] });
    const onIngestComplete = vi.fn();
    const handle: { current: { ingestFiles: (f: File[]) => void; ingestZips: (f: File[]) => void } | null } = { current: null };
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          ref={handle}
          projectId="p1" assets={[]} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={onIngestComplete} onIngestError={noop}
        />,
      );
    });
    await act(async () => { handle.current!.ingestFiles([new File(['x'], 'a.png')]); });
    expect(mockIngestLooseFiles).toHaveBeenCalledTimes(1);
    await act(async () => { handle.current!.ingestZips([new File(['x'], 'one.zip'), new File(['y'], 'two.zip')]); });
    expect(mockIngestZip).toHaveBeenCalledTimes(2);
    expect(onIngestComplete).toHaveBeenCalledTimes(3);
  });

  it('every control lives in the one toolbar: add (files/folder/zip), relink, delete unused, delete all, wand, search, sort, filters', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={[makeAsset({ id: 'a1' })]} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop} onMatchMedia={noop} onDeleteAllMedia={noop} onRenameAsset={noop}
        />,
      );
    });
    for (const label of ['Import media', 'Relink media', 'Delete all media', 'Match media to scenes']) {
      expect(container.querySelector(`[aria-label="${label}"]`), label).not.toBeNull();
    }
    expect(container.querySelector('[data-testid="media-block-delete-unused"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="media-block-sort"]')).not.toBeNull();
    expect(container.querySelector('input[placeholder="Search media…"]')).not.toBeNull();
    expect(container.querySelector('[role="radiogroup"][aria-label="Filter by type"]')).not.toBeNull();
    expect(container.querySelector('[role="radiogroup"][aria-label="Filter by usage"]')).not.toBeNull();
  });
});

describe('U9 — ONE import door for files, folders and zips', () => {
  const COUNTS = { imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 0 };

  it('one icon opens a menu offering Files & zips and Folder', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock projectId="p1" assets={[]} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop} />,
      );
    });
    expect(container.querySelector('[data-testid="media-block-import-menu"]')).toBeNull();
    await act(async () => { (container.querySelector('[data-testid="media-block-import"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="media-block-import-files"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="media-block-import-folder"]')).not.toBeNull();
  });

  it('a mixed pick (images + a zip) imports the loose files as one batch and the zip after it, in one action', async () => {
    mockIngestLooseFiles.mockResolvedValue({ assets: [], audioAssetId: undefined, counts: COUNTS, duplicateNames: [] });
    mockIngestZip.mockResolvedValue({ assets: [], audioAssetId: undefined, counts: COUNTS, duplicateNames: [] });
    const order: string[] = [];
    mockIngestLooseFiles.mockImplementation(async () => { order.push('loose'); return { assets: [], audioAssetId: undefined, counts: COUNTS, duplicateNames: [] }; });
    mockIngestZip.mockImplementation(async () => { order.push('zip'); return { assets: [], audioAssetId: undefined, counts: COUNTS, duplicateNames: [] }; });
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock projectId="p1" assets={[]} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop} />,
      );
    });
    const input = container.querySelector('input[type="file"][multiple]:not([webkitdirectory])') as HTMLInputElement;
    const a = new File(['1'], 'a.png'); const b = new File(['2'], 'b.mp4'); const z = new File(['3'], 'pack.zip');
    setInputFiles(input, [a, z, b]);
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(mockIngestLooseFiles).toHaveBeenCalledTimes(1);
    expect(mockIngestLooseFiles.mock.calls[0]![1]).toEqual([a, b]);
    expect(mockIngestZip).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['loose', 'zip']);
  });

  it('with an owner router, picked zips are handed to it (bundle detection) and NOT ingested directly', async () => {
    mockIngestLooseFiles.mockResolvedValue({ assets: [], audioAssetId: undefined, counts: COUNTS, duplicateNames: [] });
    const onZipsChosen = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock projectId="p1" assets={[]} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop} onZipsChosen={onZipsChosen} />,
      );
    });
    const input = container.querySelector('input[type="file"][multiple]:not([webkitdirectory])') as HTMLInputElement;
    const z = new File(['3'], 'bundle.zip');
    setInputFiles(input, [z]);
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onZipsChosen).toHaveBeenCalledWith([z]);
    expect(mockIngestZip).not.toHaveBeenCalled();
  });
});

// Wave 3 B1/B2 — typed per-asset states on the single surface.
describe('B1/B2 — per-asset state chips and corrupt handling', () => {
  const renderBlock = async (assets: Asset[], extra: Partial<React.ComponentProps<typeof MediaBlock>> = {}) => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock
          projectId="p1" assets={assets} segments={[]} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop}
          onIngestComplete={noop} onIngestError={noop} {...extra}
        />,
      );
    });
  };
  const chipOf = (id: string) =>
    container.querySelector(`[data-testid="media-block-tile"][data-asset-id="${id}"] [data-testid="media-block-health-chip"]`);

  it('every tile carries exactly one chip: available / unverified / missing / corrupt', async () => {
    await renderBlock([
      makeAsset({ id: 'ok', contentHash: 'h' }),
      makeAsset({ id: 'un' }),
      makeAsset({ id: 'gone', contentHash: 'h2', unresolved: true }),
      makeAsset({ id: 'bad', contentHash: 'h3', corrupt: 'image-decode' }),
    ]);
    expect(chipOf('ok')?.getAttribute('data-health')).toBe('available');
    expect(chipOf('un')?.getAttribute('data-health')).toBe('unverified');
    expect(chipOf('gone')?.getAttribute('data-health')).toBe('missing');
    expect(chipOf('bad')?.getAttribute('data-health')).toBe('corrupt');
  });

  it('a corrupt tile is never blank: it says it cannot be read, and stays deletable', async () => {
    await renderBlock([makeAsset({ id: 'bad', corrupt: 'no-frame' })]);
    expect(container.querySelector('[data-testid="media-block-corrupt"]')?.textContent).toContain("Can't read file");
    expect(container.querySelector('[title="Delete"]')).not.toBeNull();
  });

  it('missing -> reconnect flips the chip to available through the same surface', async () => {
    await renderBlock([makeAsset({ id: 'gone', contentHash: 'h', unresolved: true })]);
    expect(chipOf('gone')?.getAttribute('data-health')).toBe('missing');
    root.unmount();
    container.innerHTML = '';
    await renderBlock([makeAsset({ id: 'gone', contentHash: 'h' })]);
    expect(chipOf('gone')?.getAttribute('data-health')).toBe('available');
  });

  it('a video whose frame cannot be read (ffmpeg ran, failed) is reported corrupt exactly once', async () => {
    mockGenerateThumbnail.mockResolvedValue('failed');
    const onAssetCorrupt = vi.fn();
    const video = makeAsset({ id: 'v1', type: 'video', name: 'clip.mp4', file: new File([new Uint8Array([1, 2])], 'clip.mp4') });
    await renderBlock([video], { onAssetCorrupt });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(onAssetCorrupt).toHaveBeenCalledTimes(1);
    expect(onAssetCorrupt).toHaveBeenCalledWith('v1', 'no-frame');
  });

  it('NO verdict when the probe is merely unavailable (no Tauri / IPC error): never flagged corrupt', async () => {
    mockGenerateThumbnail.mockResolvedValue('unavailable');
    const onAssetCorrupt = vi.fn();
    const video = makeAsset({ id: 'v1', type: 'video', name: 'clip.mp4', file: new File([new Uint8Array([1, 2])], 'clip.mp4') });
    await renderBlock([video], { onAssetCorrupt });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(onAssetCorrupt).not.toHaveBeenCalled();
  });

  it('an already-corrupt or offline video is not probed again', async () => {
    const video = makeAsset({ id: 'v1', type: 'video', corrupt: 'no-frame', file: new File(['x'], 'v.mp4') });
    await renderBlock([video, makeAsset({ id: 'v2', type: 'video', unresolved: true })]);
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(mockGenerateThumbnail).not.toHaveBeenCalled();
  });
});

describe('B3 — video thumbnail blob URLs are released', () => {
  it('OLD LEAK: createObjectURL per video thumbnail was never revoked; unmounting now revokes each', async () => {
    mockGenerateThumbnail.mockResolvedValue('generated');
    mockReadThumbnail.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const created: string[] = [];
    const revoked: string[] = [];
    const origCreate = URL.createObjectURL, origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => { const u = `blob:thumb-${created.length}`; created.push(u); return u; };
    URL.revokeObjectURL = (u: string) => { revoked.push(u); };
    try {
      root = createRoot(container);
      await act(async () => {
        root.render(
          <MediaBlock projectId="p1" segments={[]} voiceoverId={undefined}
            assets={[makeAsset({ id: 'v1', type: 'video', name: 'c.mp4', file: new File([new Uint8Array([9])], 'c.mp4') })]}
            onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop} onIngestComplete={noop} onIngestError={noop} />,
        );
      });
      await act(async () => { await new Promise(r => setTimeout(r, 20)); });
      expect(created.length).toBe(1);
      expect(revoked).toEqual([]);
      await act(async () => { root.unmount(); });
      expect(revoked).toEqual(created);
      root = createRoot(container); // afterEach unmounts a live root
    } finally {
      URL.createObjectURL = origCreate; URL.revokeObjectURL = origRevoke;
    }
  });
});

describe('video thumbnails — the film-strip icon must not be permanent', () => {
  const stubUrls = () => {
    const o = { c: URL.createObjectURL, r: URL.revokeObjectURL };
    URL.createObjectURL = () => 'blob:thumb';
    URL.revokeObjectURL = () => {};
    return () => { URL.createObjectURL = o.c; URL.revokeObjectURL = o.r; };
  };
  const mountVideo = async (asset: Asset, segments: VideoSegment[]) => {
    root = createRoot(container);
    const render = (segs: VideoSegment[]) => act(async () => {
      root.render(
        <MediaBlock projectId="p1" assets={[asset]} segments={segs} voiceoverId={undefined}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop} onIngestComplete={noop} onIngestError={noop} />,
      );
    });
    await render(segments);
    return render;
  };
  const thumbImg = () => container.querySelector('[data-testid="media-block-tile"] img');

  it('OLD BUG: a thumbnail finishing AFTER `rows` changed mid-flight was dropped and never re-requested', async () => {
    const restore = stubUrls();
    try {
      let release!: (v: string) => void;
      mockGenerateThumbnail.mockImplementation(() => new Promise(r => { release = r; }));
      mockReadThumbnail.mockResolvedValue(new Uint8Array([1]));
      const video = makeAsset({ id: 'v1', type: 'video', name: 'c.mp4', contentHash: 'deadbeef' });
      const render = await mountVideo(video, []);
      await render([makeSegment({ id: 's1', assetId: 'v1' })]); // the project changed while ffmpeg ran -> `rows` recomputed
      await act(async () => { release('generated'); await new Promise(r => setTimeout(r, 10)); });
      expect(thumbImg()?.getAttribute('src')).toBe('blob:thumb');
      expect(mockGenerateThumbnail).toHaveBeenCalledTimes(1); // requested once, not re-requested
    } finally { restore(); }
  });

  it('uses the stored contentHash: no bytes needed (an asset resolved from the native store has no IndexedDB copy)', async () => {
    const restore = stubUrls();
    try {
      mockGenerateThumbnail.mockResolvedValue('generated');
      mockReadThumbnail.mockResolvedValue(new Uint8Array([1]));
      await mountVideo(makeAsset({ id: 'v1', type: 'video', name: 'c.mp4', contentHash: 'abc123' }), []);
      await act(async () => { await new Promise(r => setTimeout(r, 10)); });
      expect(mockGenerateThumbnail).toHaveBeenCalledWith('abc123');
      expect(thumbImg()).not.toBeNull();
    } finally { restore(); }
  });

  it('a hash the vault never imported reads `failed` too — that is NOT corruption (no false verdict on a legacy asset)', async () => {
    mockGenerateThumbnail.mockResolvedValue('failed');
    mockListEntries.mockResolvedValue([]); // registry does not know this blob
    const onAssetCorrupt = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MediaBlock projectId="p1" segments={[]} voiceoverId={undefined} onAssetCorrupt={onAssetCorrupt}
          assets={[makeAsset({ id: 'v1', type: 'video', name: 'c.mp4', contentHash: 'legacy' })]}
          onDeleteAsset={noop} onOpenRelinkMedia={noop} onHighlightUsage={noop} onIngestComplete={noop} onIngestError={noop} />,
      );
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(onAssetCorrupt).not.toHaveBeenCalled();
  });
});
