/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// G6 Step 4 — the Media block: a library view over `project.assets`, shown
// in the Files tab below the 4 upload slots (operator decision — name "media
// vault" for the underlying store, this block is its UI). Large thumbnails,
// name/type/duration, a "used in N scenes" chip (click highlights those
// scenes), used/unused + type filters, search, and an "add media" door
// (loose files / folder / zip) through the same `mediaIngest.ts`/
// `zipIngest.ts` write-through Step 3 built.
//
// Missing/offline reuses the EXISTING unresolved/relink machinery AS-IS —
// `asset.unresolved` (already set by the native asset store's resolution
// ladder) and `onOpenRelinkMedia` (already wired in App.tsx to
// `refreshDegradedRecovery`, the same call slot 4's own "Relink Media…"
// button makes) are the only two things this block reads/calls for that;
// no new relink UI or state was built.
//
// Thumbnails: images use themselves (`asset.url`, same as everywhere else in
// this app — DropZonePanel's own slot list does this too). Videos generate a
// real JPEG via the vault's ffmpeg-backed `media_vault_generate_thumbnail`
// (Step 4a), keyed by content hash. `Asset.contentHash` does not exist on
// the type yet (Step 5 adds it) — this block computes the hash from the
// asset's own bytes on demand and caches it in a ref for the component's
// lifetime, accepting the one-time re-hash cost until Step 5's stored field
// makes it free.
// ---------------------------------------------------------------------------

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Search, Film, Image as ImageIcon, Music, Link2, Trash2, FolderPlus, FileUp, FileArchive, AlertCircle } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import type { Asset, VideoSegment } from '../types';
import { formatTime } from '../services/timeFormat';
import { getAsset } from '../services/assetStore';
import { sha256Hex, ingestLooseFiles, type MediaIngestCounts } from '../services/mediaIngest';
import { ingestZip, ZipTooLargeError } from '../services/zipIngest';
import { mediaVaultGenerateThumbnail, mediaVaultReadThumbnail } from '../services/mediaVaultClient';

export interface MediaIngestOutcome {
  assets: Asset[];
  audioAssetId: string | undefined;
  counts: MediaIngestCounts;
  source: 'zip' | 'files' | 'folder' | 'bundle';
  /** Names of files dropped as duplicates of an already-in-project asset or
   *  of another file in the same import (G6 polish item 1). */
  duplicateNames: string[];
}

interface MediaBlockProps {
  projectId: string;
  assets: Asset[];
  segments: VideoSegment[];
  /** G6 polish item 4 — the project's spine voiceover (slot 3's own home,
   *  above this block). Excluded from the grid entirely: no tile, no delete
   *  affordance here, no way to kill the timeline voiceover from the media
   *  door — use slot 3 / "Delete voiceover" for that. */
  voiceoverId: string | undefined;
  onDeleteAsset: (assetId: string) => void;
  onOpenRelinkMedia: () => void;
  /** Switches to the Segments tab and selects every segment using this
   *  asset — the "used in N scenes" chip's click target. */
  onHighlightUsage: (assetId: string) => void;
  onIngestComplete: (outcome: MediaIngestOutcome) => void;
  onIngestError: (message: string) => void;
}

type TypeFilter = 'all' | 'image' | 'video' | 'audio';
type UsageFilter = 'all' | 'used' | 'unused';
type SortOrder = 'newest' | 'oldest' | 'name-asc' | 'name-desc';

// G6 polish item 2 — sort control, session-persisted (sessionStorage, not
// the project file — a UI display preference, not project state). Default
// Newest first, per operator decision.
const SORT_STORAGE_KEY = 'kx-media-block-sort';
const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name-asc', label: 'Name A-Z' },
  { value: 'name-desc', label: 'Name Z-A' },
];

function isSortOrder(v: string | null): v is SortOrder {
  return v === 'newest' || v === 'oldest' || v === 'name-asc' || v === 'name-desc';
}

function readStoredSortOrder(): SortOrder {
  try {
    const v = sessionStorage.getItem(SORT_STORAGE_KEY);
    return isSortOrder(v) ? v : 'newest';
  } catch {
    return 'newest'; // sessionStorage unavailable (private mode, etc.)
  }
}

function compareBySortOrder(order: SortOrder, a: Asset, b: Asset): number {
  switch (order) {
    case 'name-asc': return a.name.localeCompare(b.name);
    case 'name-desc': return b.name.localeCompare(a.name);
    case 'oldest': return (a.addedAt ?? 0) - (b.addedAt ?? 0);
    case 'newest': return (b.addedAt ?? 0) - (a.addedAt ?? 0);
  }
}

// G6 polish item 6 — toolbar compaction. Row 2's type/usage filters become
// compact chip buttons (icon + tooltip for type, short label for usage)
// instead of two more <select>s, so row 1 (search + sort) and row 2 (type
// chips + usage chips) both fit the left panel's width with no horizontal
// scroll, even at a narrow panel width — a <select>'s own rendered width
// can't compress the way a small icon button can.
const TYPE_FILTER_OPTIONS: { value: TypeFilter; label: string; Icon: typeof Film | null }[] = [
  { value: 'all', label: 'All', Icon: null },
  { value: 'video', label: 'Video', Icon: Film },
  { value: 'image', label: 'Image', Icon: ImageIcon },
  { value: 'audio', label: 'Audio', Icon: Music },
];
const USAGE_FILTER_OPTIONS: { value: UsageFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'used', label: 'Used' },
  { value: 'unused', label: 'Unused' },
];
const CHIP_BASE = 'px-1.5 py-1 rounded text-[10px] leading-none flex items-center gap-1 shrink-0';
const CHIP_ACTIVE = 'bg-[#F27D26] text-white';
const CHIP_INACTIVE = 'bg-[var(--kx-surface-2)] text-[var(--kx-faint)] hover:text-white';

const TYPE_ICON: Record<Asset['type'], typeof Film> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
};

// G6 polish items 3/5 — swappable copy block for the media block's two
// delete-confirmation dialogs (operator sign-off point, same pattern as
// SyncPausedDialog.tsx's own PAUSE_COPY/COPY blocks).
const DELETE_COPY = {
  bulkTitle: 'Delete unused media?',
  bulkBody: (count: number): string =>
    `Delete ${count} unused item${count === 1 ? '' : 's'}? Their files stay in the vault until you free up cached data.`,
  bulkConfirmLabel: 'Delete unused',
  usedTitle: 'Delete used media?',
  usedBody: (uses: number): string =>
    `Used in ${uses} scene${uses === 1 ? '' : 's'}. Delete anyway? Those scenes will show as missing until you relink or replace.`,
  usedConfirmLabel: 'Delete anyway',
  cancelLabel: 'Cancel',
} as const;

/**
 * G6 polish item 4b — defense in depth. `voiceoverId` (spine reference) is
 * ALWAYS counted as used, on top of any segment references, so an asset the
 * project's voiceover is pointed at can never read "Unused" — even if some
 * future caller passes it into this grid despite item 4a's exclusion.
 */
export function usageCount(segments: VideoSegment[], assetId: string, voiceoverId: string | undefined): number {
  const segmentUses = segments.filter(s => s.assetId === assetId).length;
  return assetId === voiceoverId ? segmentUses + 1 : segmentUses;
}

/** Hashes a video asset's bytes (from its staged `File`, falling back to the
 *  IndexedDB-stored blob for an asset restored across a reload — same
 *  fallback `resolveVoiceoverDuration` in App.tsx already uses) and asks the
 *  vault to generate/read back its thumbnail. `null` on ANY failure — every
 *  failure mode renders identically here (fall back to the type icon). */
async function loadVideoThumbnailUrl(projectId: string, asset: Asset): Promise<string | null> {
  try {
    let bytes: Uint8Array;
    if (asset.file) {
      bytes = new Uint8Array(await asset.file.arrayBuffer());
    } else {
      const stored = await getAsset(projectId, asset.id);
      if (!stored?.blob) return null;
      bytes = new Uint8Array(await stored.blob.arrayBuffer());
    }
    const contentHash = await sha256Hex(bytes);
    const generated = await mediaVaultGenerateThumbnail(contentHash);
    if (!generated) return null;
    const thumbBytes = await mediaVaultReadThumbnail(contentHash);
    if (!thumbBytes) return null;
    return URL.createObjectURL(new Blob([thumbBytes.slice()], { type: 'image/jpeg' }));
  } catch (err) {
    console.warn('[MediaBlock] thumbnail load failed, falling back to an icon:', asset.id, err);
    return null;
  }
}

export function MediaBlock({
  projectId,
  assets,
  segments,
  voiceoverId,
  onDeleteAsset,
  onOpenRelinkMedia,
  onHighlightUsage,
  onIngestComplete,
  onIngestError,
}: MediaBlockProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [usageFilter, setUsageFilter] = useState<UsageFilter>('all');
  const [sortOrder, setSortOrderState] = useState<SortOrder>(readStoredSortOrder);
  const [busy, setBusy] = useState(false);
  const [videoThumbUrls, setVideoThumbUrls] = useState<Record<string, string>>({});
  const thumbRequestedRef = useRef<Set<string>>(new Set());

  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  // G6 polish item 4a — the project's voiceover is spine, not presentation
  // media: slot 3 (above this block) is its home, never this grid.
  const mediaAssets = useMemo(
    () => assets.filter(a => a.id !== voiceoverId),
    [assets, voiceoverId],
  );

  // G6 polish item 2 — persists across remounts within the session
  // (sessionStorage), never across app restarts — a display preference,
  // not project state.
  const handleSortOrderChange = useCallback((next: SortOrder) => {
    setSortOrderState(next);
    try {
      sessionStorage.setItem(SORT_STORAGE_KEY, next);
    } catch {
      // sessionStorage unavailable — the choice just doesn't outlive this render
    }
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mediaAssets
      .map(asset => ({ asset, uses: usageCount(segments, asset.id, voiceoverId) }))
      .filter(({ asset }) => typeFilter === 'all' || asset.type === typeFilter)
      .filter(({ uses }) => usageFilter === 'all' || (usageFilter === 'used' ? uses > 0 : uses === 0))
      .filter(({ asset }) => q === '' || asset.name.toLowerCase().includes(q))
      .sort((a, b) => compareBySortOrder(sortOrder, a.asset, b.asset));
  }, [mediaAssets, segments, search, typeFilter, usageFilter, voiceoverId, sortOrder]);

  // G6 polish item 3 — the ids behind "Delete unused (N)"'s live count AND
  // its bulk-delete action, computed once so the button's count and its
  // confirm handler can never disagree about which assets are unused.
  const unusedAssetIds = useMemo(
    () => mediaAssets.filter(a => usageCount(segments, a.id, voiceoverId) === 0).map(a => a.id),
    [mediaAssets, segments, voiceoverId],
  );
  const unusedCount = unusedAssetIds.length;

  // Lazily generate/fetch a thumbnail for each VISIBLE video row, once,
  // caching the resulting blob URL for the component's lifetime — not
  // reactive to scroll position (no virtualization here), but bounded to
  // whatever the current filter/search actually shows.
  useEffect(() => {
    let cancelled = false;
    for (const { asset } of rows) {
      if (asset.type !== 'video') continue;
      if (thumbRequestedRef.current.has(asset.id)) continue;
      thumbRequestedRef.current.add(asset.id);
      void loadVideoThumbnailUrl(projectId, asset).then(url => {
        if (cancelled || url === null) return;
        setVideoThumbUrls(prev => ({ ...prev, [asset.id]: url }));
      });
    }
    return () => { cancelled = true; };
  }, [rows, projectId]);

  // G6 polish item 1 — every ingest door needs the project's own already-
  // imported content hashes to dedupe AGAINST THE PROJECT, not just within
  // one ingest call's own batch (the bug: two separate "add files" clicks
  // for the same bytes each got a fresh dedup set, so the second stacked a
  // duplicate Asset record). `.filter(Boolean)` drops assets not yet
  // hashed (pre-v6, backfill not yet run) — those simply can't be matched,
  // same as before this fix.
  const existingHashes = useMemo(
    () => assets.map(a => a.contentHash).filter((h): h is string => !!h),
    [assets],
  );

  const runIngest = useCallback(async (
    source: 'zip' | 'files' | 'folder',
    run: () => Promise<{ assets: Asset[]; audioAssetId: string | undefined; counts: MediaIngestCounts; duplicateNames: string[] }>,
  ) => {
    setBusy(true);
    try {
      const result = await run();
      onIngestComplete({ ...result, source });
    } catch (err) {
      const message = err instanceof ZipTooLargeError
        ? err.message
        : 'This import could not be completed — see the console for details.';
      console.error(`[MediaBlock] ${source} ingest failed:`, err);
      onIngestError(message);
    } finally {
      setBusy(false);
    }
  }, [onIngestComplete, onIngestError]);

  const handleFilesChosen = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    void runIngest('files', () => ingestLooseFiles(projectId, Array.from(fileList), existingHashes));
  }, [projectId, runIngest, existingHashes]);

  const handleFolderChosen = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    void runIngest('folder', () => ingestLooseFiles(projectId, Array.from(fileList), existingHashes));
  }, [projectId, runIngest, existingHashes]);

  const handleZipChosen = useCallback((file: File | undefined) => {
    if (!file) return;
    void runIngest('zip', () => ingestZip(projectId, file, existingHashes));
  }, [projectId, runIngest, existingHashes]);

  // G6 polish item 3 — bulk "Delete unused". Routes every unused asset
  // through the SAME `onDeleteAsset` prop a single-tile delete uses, so the
  // native-store delete + media-vault unreference wiring (App.tsx's
  // `handleDeleteAsset`) fires per asset — no separate bulk-delete path to
  // keep in sync with that wiring.
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const handleConfirmDeleteUnused = useCallback(() => {
    for (const id of unusedAssetIds) onDeleteAsset(id);
    setConfirmBulkDelete(false);
  }, [unusedAssetIds, onDeleteAsset]);

  // G6 polish item 5 — used-media delete needs a confirmation naming how
  // many scenes it's used in; unused single-delete stays direct (no dialog).
  const [confirmDeleteAsset, setConfirmDeleteAsset] = useState<{ id: string; uses: number } | null>(null);
  const handleTileDeleteClick = useCallback((assetId: string, uses: number) => {
    if (uses > 0) {
      setConfirmDeleteAsset({ id: assetId, uses });
    } else {
      onDeleteAsset(assetId);
    }
  }, [onDeleteAsset]);

  if (mediaAssets.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-[var(--kx-border)] pt-3 mt-1" data-testid="media-block">
      <div className="flex items-center justify-between px-1 mb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kx-faint)]">
          Media ({mediaAssets.length})
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="Add loose files"
            disabled={busy}
            onClick={() => filesInputRef.current?.click()}
            className="p-1 rounded hover:bg-[var(--kx-surface-2)] text-[var(--kx-faint)] disabled:opacity-40"
          >
            <FileUp size={13} />
          </button>
          <button
            type="button"
            title="Add a folder"
            disabled={busy}
            onClick={() => folderInputRef.current?.click()}
            className="p-1 rounded hover:bg-[var(--kx-surface-2)] text-[var(--kx-faint)] disabled:opacity-40"
          >
            <FolderPlus size={13} />
          </button>
          <button
            type="button"
            title="Add a zip"
            disabled={busy}
            onClick={() => zipInputRef.current?.click()}
            className="p-1 rounded hover:bg-[var(--kx-surface-2)] text-[var(--kx-faint)] disabled:opacity-40"
          >
            <FileArchive size={13} />
          </button>
          <button
            type="button"
            data-testid="media-block-delete-unused"
            title={`Delete unused (${unusedCount})`}
            aria-label={`Delete unused (${unusedCount})`}
            disabled={unusedCount === 0}
            onClick={() => setConfirmBulkDelete(true)}
            className="relative p-1 rounded hover:bg-[var(--kx-surface-2)] text-[var(--kx-faint)] disabled:opacity-40"
          >
            <Trash2 size={13} />
            {unusedCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[13px] h-[13px] px-[3px] rounded-full bg-[var(--kx-danger)] text-white text-[8px] leading-[13px] text-center">
                {unusedCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        className="hidden"
        onChange={(e) => { handleFilesChosen(e.target.files); e.target.value = ''; }}
      />
      <input
        ref={(el) => {
          // React has no typed prop for `webkitdirectory` — a non-standard
          // but universally-supported (Chromium/WebKit, hence Tauri's
          // webview) attribute that turns a file input into a folder picker.
          folderInputRef.current = el;
          el?.setAttribute('webkitdirectory', '');
        }}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => { handleFolderChosen(e.target.files); e.target.value = ''; }}
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(e) => { handleZipChosen(e.target.files?.[0]); e.target.value = ''; }}
      />

      {/* Row 1 — search (flex) + sort. */}
      <div className="flex items-center gap-1.5 px-1 mb-1.5">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 bg-[var(--kx-surface-2)] rounded-lg px-2 py-1">
          <Search size={12} className="text-[var(--kx-faint)] shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search media…"
            className="bg-transparent text-[11px] flex-1 min-w-0 outline-none placeholder:text-[var(--kx-faint)]"
          />
        </div>
        <select
          data-testid="media-block-sort"
          value={sortOrder}
          onChange={(e) => handleSortOrderChange(e.target.value as SortOrder)}
          title="Sort"
          className="shrink-0 text-[11px] bg-[var(--kx-surface-2)] rounded-lg px-1.5 py-1 outline-none"
        >
          {SORT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* Row 2 — type chips + usage chips, as compact toggle-button groups
          (never <select>s — a select's own min rendered width doesn't
          compress the way an icon/short-label chip does). */}
      <div className="flex items-center justify-between gap-1.5 px-1 mb-2">
        <div role="radiogroup" aria-label="Filter by type" className="flex items-center gap-1">
          {TYPE_FILTER_OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={typeFilter === value}
              title={`${label} only`}
              onClick={() => setTypeFilter(value)}
              className={`${CHIP_BASE} ${typeFilter === value ? CHIP_ACTIVE : CHIP_INACTIVE}`}
            >
              {Icon ? <Icon size={11} /> : label}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Filter by usage" className="flex items-center gap-1">
          {USAGE_FILTER_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={usageFilter === value}
              title={value === 'unused' ? `${label} only (${unusedCount})` : `${label} only`}
              onClick={() => setUsageFilter(value)}
              className={`${CHIP_BASE} ${usageFilter === value ? CHIP_ACTIVE : CHIP_INACTIVE}`}
            >
              {value === 'unused' ? `${label} (${unusedCount})` : label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-[var(--kx-faint)] px-1 pb-2">No media matches this filter.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 px-1 pb-2" data-testid="media-block-grid">
          {rows.map(({ asset, uses }) => {
            const TypeIcon = TYPE_ICON[asset.type];
            const thumbUrl = asset.type === 'image' ? asset.url : videoThumbUrls[asset.id];
            return (
              <div
                key={asset.id}
                data-testid="media-block-tile"
                className="relative aspect-square rounded-lg overflow-hidden bg-[var(--kx-surface-2)] group"
              >
                {asset.unresolved ? (
                  <button
                    type="button"
                    data-testid="media-block-relink"
                    onClick={onOpenRelinkMedia}
                    title="Relink this file"
                    className="w-full h-full flex flex-col items-center justify-center gap-1 text-[var(--kx-danger)]"
                  >
                    <AlertCircle size={18} />
                    <span className="text-[9px]">Offline</span>
                    <Link2 size={11} />
                  </button>
                ) : thumbUrl ? (
                  <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <TypeIcon size={20} className="text-[var(--kx-faint)]" />
                  </div>
                )}

                <button
                  type="button"
                  title="Delete"
                  onClick={() => handleTileDeleteClick(asset.id, uses)}
                  className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 size={11} />
                </button>

                {asset.duration !== undefined && (
                  <span className="absolute bottom-1 right-1 text-[9px] bg-black/70 text-white rounded px-1">
                    {formatTime(asset.duration)}
                  </span>
                )}

                <button
                  type="button"
                  data-testid="media-block-usage-chip"
                  onClick={() => onHighlightUsage(asset.id)}
                  disabled={uses === 0}
                  title={uses === 0 ? 'Not used in any scene' : `Used in ${uses} scene(s) — click to highlight`}
                  className={`absolute bottom-1 left-1 text-[9px] rounded px-1 ${
                    uses === 0
                      ? 'bg-black/40 text-[var(--kx-faint)] cursor-default'
                      : 'bg-black/70 text-white hover:bg-black/90 cursor-pointer'
                  }`}
                >
                  {uses === 0 ? 'Unused' : `${uses}×`}
                </button>

                <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-1 py-0.5">
                  <p className="text-[9px] text-white truncate" title={asset.name}>{asset.name}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmBulkDelete && (
        <ConfirmDialog
          title={DELETE_COPY.bulkTitle}
          body={DELETE_COPY.bulkBody(unusedCount)}
          confirmLabel={DELETE_COPY.bulkConfirmLabel}
          cancelLabel={DELETE_COPY.cancelLabel}
          onConfirm={handleConfirmDeleteUnused}
          onCancel={() => setConfirmBulkDelete(false)}
        />
      )}

      {confirmDeleteAsset && (
        <ConfirmDialog
          title={DELETE_COPY.usedTitle}
          body={DELETE_COPY.usedBody(confirmDeleteAsset.uses)}
          confirmLabel={DELETE_COPY.usedConfirmLabel}
          cancelLabel={DELETE_COPY.cancelLabel}
          onConfirm={() => { onDeleteAsset(confirmDeleteAsset.id); setConfirmDeleteAsset(null); }}
          onCancel={() => setConfirmDeleteAsset(null)}
        />
      )}
    </div>
  );
}
