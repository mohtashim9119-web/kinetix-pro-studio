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

import { useState, useRef, useCallback, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Search, Film, Image as ImageIcon, Music, Link2, Trash2, FolderPlus, FileUp, Upload, AlertCircle, Loader2, Copy, Wand2, X, ChevronRight } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import type { Asset, VideoSegment } from '../types';
import { formatTime } from '../services/timeFormat';
import { getAsset } from '../services/assetStore';
import { sha256Hex, ingestLooseFiles, type MediaIngestCounts, type OfflineReconnect } from '../services/mediaIngest';
import { ingestZip, ZipTooLargeError } from '../services/zipIngest';
import { mediaVaultGenerateThumbnailDetailed, mediaVaultListEntries, mediaVaultReadThumbnail } from '../services/mediaVaultClient';
import { assetHealth, ASSET_HEALTH_COPY } from '../services/assetHealth';
import { ASSET_DRAG_MIME } from '../services/assetDragChannel';
import type { MediaMatchSummary } from '../services/matchMediaToScenes';

export interface MediaIngestOutcome {
  assets: Asset[];
  audioAssetId: string | undefined;
  counts: MediaIngestCounts;
  source: 'zip' | 'files' | 'folder' | 'bundle';
  /** Names of files dropped as duplicates of an already-in-project asset or
   *  of another file in the same import (G6 polish item 1). */
  duplicateNames: string[];
  /** Bundle ingest only — zips nested inside a bundle's own inner zip,
   *  never opened (one nesting level). Named in the same grouped finding. */
  nestedZipsSkipped?: string[];
  /** Media workflow Unit 4 — re-uploaded bytes of an OFFLINE asset; the
   *  caller reconnects that asset in place instead of adding a new one. */
  reconnected?: OfflineReconnect[];
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
  /** Media workflow Unit 1 — commits an inline rename (already trimmed,
   *  never empty, never unchanged). The name is the match key for "Match
   *  media to scenes". Absent -> the name renders read-only. */
  onRenameAsset?: (assetId: string, newName: string) => void;
  /** Media workflow Unit 2 — the header's "Match media to scenes" button:
   *  re-assigns every scene whose tag names an asset (overwriting), keeps
   *  the rest. Absent -> no button. */
  onMatchMedia?: () => MediaMatchSummary | void;
  /** Wave 3 U9 — delete EVERY project media asset (the old slot-4 "×"). The
   *  block confirms first; absent -> no button. */
  onDeleteAllMedia?: () => void;
  /** Wave 3 U9 — when present the zip door hands the chosen zip(s) to the
   *  owner instead of ingesting directly, so a BUNDLE zip (script + scene doc
   *  + voiceover + media) is recognised and routed, not swallowed as media. */
  onZipsChosen?: (files: File[]) => void;
  /** Wave 3 B2 — a decode/thumbnail probe FAILED on present bytes. The owner
   *  flags the asset (`Asset.corrupt`) and stamps the typed finding; nothing
   *  is deleted. Absent -> the tile still shows its corrupt state locally. */
  onAssetCorrupt?: (assetId: string, reason: NonNullable<Asset['corrupt']>) => void;
  /** Wave 3 U9 — when given, the block renders the slot's own header (chevron,
   *  tile, title, wand + import) and collapses its body like the other slots. */
  header?: {
    expanded: boolean;
    onToggle: () => void;
    icon: React.ReactNode;
    color: string;
    title: string;
    subtitle: string;
  };
}

/** Wave 3 U9 — what the parent drives through a ref: media dropped anywhere
 *  on the Files tab goes through the SAME ingest doors as the toolbar. */
export interface MediaBlockHandle {
  ingestFiles: (files: File[]) => void;
  ingestZips: (files: File[]) => void;
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

// Wave 3 U9 — swappable copy for the one Media surface (operator sign-off
// point, same pattern as DELETE_COPY above).
export const MEDIA_COPY = {
  emptyTitle: 'No media yet',
  emptyBody: 'Drop images, videos or a zip here — or use the buttons. Media is optional: scenes without a file stay as placeholders until you add some and press Match.',
  deleteAllTitle: 'Delete all media?',
  deleteAllBody: (count: number, uses: number): string =>
    `Delete ${count} file${count === 1 ? '' : 's'}?` +
    (uses > 0 ? ` ${uses} scene${uses === 1 ? '' : 's'} will show as [NO ASSET] placeholders until you add media again.` : '') +
    ' Their files stay in the vault until you free up cached data.',
  deleteAllConfirmLabel: 'Delete all',
  matchSummary: (s: MediaMatchSummary): string => {
    let msg = `Matched ${s.matched} · ${s.unmatched} unmatched`;
    if (s.filled > 0) msg += ` · ${s.filled} placeholder${s.filled === 1 ? '' : 's'} filled`;
    if (s.conflicts > 0) msg += ` · ${s.conflicts} name conflict${s.conflicts === 1 ? '' : 's'} (oldest used)`;
    if (s.manualKept > 0) msg += ` · ${s.manualKept} manual pick${s.manualKept === 1 ? '' : 's'} kept`;
    return msg;
  },
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

type ThumbResult = { url: string } | { corrupt: true } | null;

/** Hashes a video asset's bytes (from its staged `File`, falling back to the
 *  IndexedDB-stored blob for an asset restored across a reload — same
 *  fallback `resolveVoiceoverDuration` in App.tsx already uses) and asks the
 *  vault to generate/read back its thumbnail. `{ corrupt: true }` ONLY when
 *  the vault ran ffmpeg and it could not read a frame; every other failure
 *  (no Tauri, IPC error, unreadable bytes here) is `null` — no verdict, the
 *  tile falls back to the type icon. */
async function loadVideoThumbnailUrl(projectId: string, asset: Asset): Promise<ThumbResult> {
  try {
    // The stored content hash names the vault blob directly — no need to have
    // the bytes in hand (an asset resolved from the native store has no IndexedDB
    // copy). Only an unhashed asset falls back to hashing its bytes.
    let contentHash = asset.contentHash;
    if (!contentHash) {
      let bytes: Uint8Array;
      if (asset.file) {
        bytes = new Uint8Array(await asset.file.arrayBuffer());
      } else {
        const stored = await getAsset(projectId, asset.id);
        if (!stored?.blob) return null;
        bytes = new Uint8Array(await stored.blob.arrayBuffer());
      }
      contentHash = await sha256Hex(bytes);
    }
    const outcome = await mediaVaultGenerateThumbnailDetailed(contentHash);
    if (outcome === 'failed') {
      // `failed` also covers "this hash was never imported into the vault" (a
      // legacy asset): only a blob the registry KNOWS can be called unreadable.
      const known = (await mediaVaultListEntries()).some(e => e.contentHash === contentHash);
      return known ? { corrupt: true } : null;
    }
    if (outcome !== 'generated') return null;
    const thumbBytes = await mediaVaultReadThumbnail(contentHash);
    if (!thumbBytes) return null;
    return { url: URL.createObjectURL(new Blob([thumbBytes.slice()], { type: 'image/jpeg' })) };
  } catch (err) {
    console.warn('[MediaBlock] thumbnail load failed, falling back to an icon:', asset.id, err);
    return null;
  }
}

/** An <img> error is not proof of corruption (a revoked blob URL errors too),
 *  so re-decode the STORED bytes: `true` = definitively undecodable. */
async function imageBytesUndecodable(projectId: string, asset: Asset): Promise<boolean> {
  try {
    const blob = asset.file ?? (await getAsset(projectId, asset.id))?.blob;
    if (!blob || typeof createImageBitmap !== 'function') return false;
    try {
      const bmp = await createImageBitmap(blob);
      bmp.close?.();
      return false;
    } catch {
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * Media workflow Unit 1 — a tile's name, inline-editable. Click the name ->
 * text input (native select/copy/paste work inside it); Enter or click-away
 * commits, Escape cancels. The committed value is trimmed; empty or unchanged
 * commits nothing. The copy icon puts the current name on the clipboard.
 */
function TileName({ name, onRename, onEditingChange }: {
  name: string;
  onRename?: (newName: string) => void;
  /** Lets the tile stop being a drag source while its name is edited. */
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  // Escape unmounts the input, and a focused element's removal can still
  // deliver a blur — which would otherwise commit the draft being cancelled.
  const settledRef = useRef(false);

  const begin = () => {
    settledRef.current = false;
    setDraft(name);
    setEditing(true);
    onEditingChange?.(true);
  };
  const finish = (commit: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;
    setEditing(false);
    onEditingChange?.(false);
    const next = draft.trim();
    if (commit && next !== '' && next !== name) onRename?.(next);
  };

  if (editing) {
    return (
      <input
        data-testid="media-block-name-input"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); finish(true); }
          else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        }}
        className="w-full text-[9px] bg-black/80 text-white rounded px-0.5 outline-none ring-1 ring-[#F27D26]"
      />
    );
  }
  return (
    <div className="flex items-center gap-0.5 min-w-0">
      <p
        data-testid="media-block-name"
        role={onRename ? 'button' : undefined}
        tabIndex={onRename ? 0 : undefined}
        onClick={onRename ? begin : undefined}
        onKeyDown={onRename ? (e) => { if (e.key === 'Enter') begin(); } : undefined}
        title={name}
        className={`flex-1 min-w-0 text-[9px] text-white truncate ${onRename ? 'cursor-text hover:underline' : ''}`}
      >
        {name}
      </p>
      <button
        type="button"
        data-testid="media-block-copy-name"
        title="Copy name"
        onClick={() => { void navigator.clipboard?.writeText(name).catch(() => {}); }}
        className="shrink-0 p-0.5 rounded text-white/70 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Copy size={9} />
      </button>
    </div>
  );
}

export const MediaBlock = forwardRef<MediaBlockHandle, MediaBlockProps>(function MediaBlock({
  projectId,
  assets,
  segments,
  voiceoverId,
  onDeleteAsset,
  onOpenRelinkMedia,
  onHighlightUsage,
  onIngestComplete,
  onIngestError,
  onRenameAsset,
  onMatchMedia,
  onDeleteAllMedia,
  onZipsChosen,
  onAssetCorrupt,
  header,
}, ref) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [usageFilter, setUsageFilter] = useState<UsageFilter>('all');
  const [sortOrder, setSortOrderState] = useState<SortOrder>(readStoredSortOrder);
  const [busy, setBusy] = useState(false);
  // Unit 3 — the tile whose name is being edited is not a drag source.
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [matchSummary, setMatchSummary] = useState<MediaMatchSummary | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [videoThumbUrls, setVideoThumbUrls] = useState<Record<string, string>>({});
  const thumbRequestedRef = useRef<Set<string>>(new Set());
  const imageCheckedRef = useRef<Set<string>>(new Set());
  const onAssetCorruptRef = useRef(onAssetCorrupt);
  onAssetCorruptRef.current = onAssetCorrupt;

  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [importMenuPos, setImportMenuPos] = useState({ top: 0, right: 0 });
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const toggleImportMenu = useCallback(() => {
    const rect = importButtonRef.current?.getBoundingClientRect();
    if (rect) setImportMenuPos({ top: rect.bottom + 4, right: Math.max(4, window.innerWidth - rect.right) });
    setImportMenuOpen(o => !o);
  }, []);
  // Close the menu on any outside press or Escape.
  useEffect(() => {
    if (!importMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest('[data-testid="media-block-import-menu"], [data-testid="media-block-import"]')) setImportMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setImportMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [importMenuOpen]);

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

  // Release the video-thumbnail blob URLs when the block goes away (each
  // `createObjectURL` pins its bytes until revoked; they were never released).
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const videoThumbUrlsRef = useRef(videoThumbUrls);
  videoThumbUrlsRef.current = videoThumbUrls;
  useEffect(() => () => {
    for (const url of Object.values(videoThumbUrlsRef.current)) URL.revokeObjectURL(url);
  }, []);

  // Lazily generate/fetch a thumbnail for each VISIBLE video row, once,
  // caching the resulting blob URL for the component's lifetime — not
  // reactive to scroll position (no virtualization here), but bounded to
  // whatever the current filter/search actually shows.
  useEffect(() => {
    for (const { asset } of rows) {
      if (asset.type !== 'video') continue;
      if (thumbRequestedRef.current.has(asset.id)) continue;
      if (asset.unresolved || asset.corrupt) continue; // offline / already known-bad: no probe (and retried if it comes back)
      thumbRequestedRef.current.add(asset.id);
      void loadVideoThumbnailUrl(projectId, asset).then(result => {
        if (result === null) return;
        if ('corrupt' in result) { onAssetCorruptRef.current?.(asset.id, 'no-frame'); return; }
        // NOT gated on this effect's cleanup: the id is already in
        // `thumbRequestedRef`, so a result dropped because `rows` changed
        // mid-flight would never be requested again (the tile stayed a
        // film-strip icon forever). Only an unmounted block drops it.
        if (!mountedRef.current) { URL.revokeObjectURL(result.url); return; }
        setVideoThumbUrls(prev => ({ ...prev, [asset.id]: result.url }));
      });
    }
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
  // Media workflow Unit 4 — offline assets' hashes (voiceover included): a
  // re-upload of these bytes through any door here reconnects the asset.
  const offlineHashes = useMemo(
    () => assets.filter(a => a.unresolved && a.contentHash).map(a => a.contentHash!),
    [assets],
  );

  // G5 Unit 5 — import progress adequacy. Hashing/vault-writing a multi-GB
  // folder is real, measured seconds of work (Step 1: ~150 MiB/s) and
  // `ingestLooseFiles`/`ingestZip` are both sequential (one file at a time,
  // by design — see either module's own doc comment), so a large drop can
  // sit for a visible while with the buttons merely `disabled={busy}` and
  // NOTHING else on screen — indistinguishable from a frozen UI. This is
  // the smallest HONEST fix: a static label naming what's running and, where
  // known up front, how many files — not a fake ticking counter, since
  // neither ingest function reports per-file progress today (adding that
  // would mean threading a callback through `ingestLooseFiles`/`ingestZip`/
  // `ingestOneMediaFile` and every one of their call sites and tests — not
  // small; queued for the UI revamp per the operator's own scoping call).
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  const runIngest = useCallback(async (
    source: 'zip' | 'files' | 'folder',
    label: string,
    run: () => Promise<{ assets: Asset[]; audioAssetId: string | undefined; counts: MediaIngestCounts; duplicateNames: string[]; reconnected?: OfflineReconnect[] }>,
  ) => {
    setBusy(true);
    setBusyLabel(label);
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
      setBusyLabel(null);
    }
  }, [onIngestComplete, onIngestError]);

  // Wave 3 U9 — ONE import door. Whatever was picked (images, videos, audio,
  // zips, any mix) goes through `importMixed`: loose media first as one batch,
  // then each zip on its own (bounded memory, one archive at a time). When the
  // owner supplies `onZipsChosen`, zips go to it instead so a BUNDLE zip is
  // recognised and routed rather than swallowed as media.
  const importMixed = useCallback(async (files: File[], routeZips: boolean): Promise<void> => {
    const isZip = (f: File) => f.name.toLowerCase().endsWith('.zip');
    const loose = files.filter(f => !isZip(f));
    const zips = files.filter(isZip);
    if (loose.length > 0) {
      await runIngest('files', `Importing ${loose.length} file${loose.length === 1 ? '' : 's'}…`, () => ingestLooseFiles(projectId, loose, existingHashes, offlineHashes));
    }
    if (zips.length > 0 && routeZips && onZipsChosen) { onZipsChosen(zips); return; }
    for (const zip of zips) {
      await runIngest('zip', 'Importing zip…', () => ingestZip(projectId, zip, existingHashes, offlineHashes));
    }
  }, [projectId, runIngest, existingHashes, offlineHashes, onZipsChosen]);

  const handleFilesChosen = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    void importMixed(Array.from(fileList), true);
  }, [importMixed]);

  const handleFolderChosen = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    void runIngest('folder', `Importing folder (${files.length} file${files.length === 1 ? '' : 's'})…`, () => ingestLooseFiles(projectId, files, existingHashes, offlineHashes));
  }, [projectId, runIngest, existingHashes, offlineHashes]);

  // Wave 3 U9 — drops on the Files tab (and bundle-less zips) enter through
  // the same doors as the toolbar, so there is ONE ingest path and one place
  // the result lands. Zips run one at a time (bounded memory).
  useImperativeHandle(ref, () => ({
    // The owner has already classified these (bundles handled) — plain media
    // only, so zips must NOT be handed back to `onZipsChosen`.
    ingestFiles: (files: File[]) => { if (files.length > 0) void importMixed(files, false); },
    ingestZips: (files: File[]) => { if (files.length > 0) void importMixed(files, false); },
  }), [importMixed]);

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

  const totalUses = useMemo(
    () => segments.filter(sg => sg.assetId && mediaAssets.some(a => a.id === sg.assetId)).length,
    [segments, mediaAssets],
  );

  // The two primary actions (wand + import) live in the slot HEADER when the
  // block is given one (so they stay visible collapsed, keeping all four slots
  // symmetrical), and in the toolbar otherwise.
  const actionBtnClass = header
    ? 'flex items-center justify-center w-8 h-8 rounded-[8px] bg-[var(--kx-surface-2)] border border-[var(--kx-line)] text-[var(--kx-muted)] hover:text-[var(--kx-text)] hover:border-[var(--kx-line-2)] transition-colors flex-shrink-0 disabled:opacity-40'
    : 'p-1 rounded hover:bg-[var(--kx-surface-2)] text-[var(--kx-faint)] disabled:opacity-40';
  const primaryActions = (
    <>
          {onMatchMedia && (
            <button
              type="button"
              data-testid="media-block-match"
              title="Match media to scenes — assign each scene the file its tag names"
              aria-label="Match media to scenes"
              disabled={busy}
              onClick={() => { const summary = onMatchMedia(); setMatchSummary(summary ?? null); }}
              className={actionBtnClass}
            >
              <Wand2 size={13} />
            </button>
          )}
          <div className="relative">
            <button
              ref={importButtonRef}
              type="button"
              data-testid="media-block-import"
              title="Import media — files, folders or zips"
              aria-label="Import media"
              aria-haspopup="menu"
              aria-expanded={importMenuOpen}
              disabled={busy}
              onClick={toggleImportMenu}
              className={actionBtnClass}
            >
              <Upload size={13} />
            </button>
            {importMenuOpen && (
              <div
                role="menu"
                data-testid="media-block-import-menu"
                style={{ top: importMenuPos.top, right: importMenuPos.right }}
                className="fixed z-50 min-w-[170px] rounded-lg border border-[var(--kx-line-2)] bg-[var(--kx-surface)] py-1 shadow-lg"
              >
                <button
                  type="button" role="menuitem"
                  data-testid="media-block-import-files"
                  onClick={() => { setImportMenuOpen(false); filesInputRef.current?.click(); }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-[var(--kx-muted)] hover:bg-[var(--kx-surface-2)] hover:text-white"
                >
                  <FileUp size={12} /> Files &amp; zips…
                </button>
                <button
                  type="button" role="menuitem"
                  data-testid="media-block-import-folder"
                  onClick={() => { setImportMenuOpen(false); folderInputRef.current?.click(); }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-[var(--kx-muted)] hover:bg-[var(--kx-surface-2)] hover:text-white"
                >
                  <FolderPlus size={12} /> Folder…
                </button>
              </div>
            )}
          </div>
    </>
  );

  return (
    <div data-testid="media-block">
      {header && (
        <div className="w-full flex items-center gap-2.5 px-3 py-2.5">
          <button
            type="button"
            data-testid="media-slot-toggle"
            aria-expanded={header.expanded}
            onClick={header.onToggle}
            className="flex-1 min-w-0 flex items-center gap-2.5 text-left"
          >
            <span className="flex-none w-6 flex items-center justify-center">
              <ChevronRight
                size={13}
                className={`transition-transform ${header.expanded ? 'rotate-90 text-[var(--kx-accent)]' : 'text-[var(--kx-faint)]'}`}
              />
            </span>
            <span
              className="flex-none w-9 h-9 rounded-[10px] flex items-center justify-center"
              style={{ background: `${header.color}26`, color: header.color }}
            >
              {header.icon}
            </span>
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="text-[14px] font-semibold text-[var(--kx-text)] min-w-0 truncate">{header.title}</span>
              <span className="text-[11.5px] text-[var(--kx-muted)] truncate">{header.subtitle}</span>
            </span>
          </button>
          {primaryActions}
        </div>
      )}
      <div hidden={header ? !header.expanded : false} className="px-3 pb-3" data-testid="media-block-body">
      <div className="flex items-center justify-between gap-1.5 px-1 mb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kx-faint)] shrink-0" data-testid="media-block-count">
          Media ({mediaAssets.length})
        </h3>
        {busyLabel && (
          <span
            className="flex items-center gap-1 text-[10px] text-[var(--kx-faint)] min-w-0 truncate"
            role="status"
            aria-live="polite"
          >
            <Loader2 size={11} className="animate-spin shrink-0" />
            {busyLabel}
          </span>
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          {!header && primaryActions}
          <button
            type="button"
            data-testid="media-block-relink-door"
            title="Relink media…"
            aria-label="Relink media"
            onClick={onOpenRelinkMedia}
            className="p-1 rounded hover:bg-[var(--kx-surface-2)] text-[var(--kx-faint)]"
          >
            <Link2 size={13} />
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
          {onDeleteAllMedia && (
            <button
              type="button"
              data-testid="media-block-delete-all"
              title="Delete all media"
              aria-label="Delete all media"
              disabled={mediaAssets.length === 0}
              onClick={() => setConfirmDeleteAll(true)}
              className="p-1 rounded hover:bg-[var(--kx-surface-2)] text-[var(--kx-faint)] hover:text-[var(--kx-danger)] disabled:opacity-40"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {matchSummary && (
        <div
          data-testid="media-block-match-summary"
          role="status"
          className="mx-1 mb-2 flex items-start gap-1.5 rounded-lg bg-[var(--kx-surface-2)] px-2 py-1 text-[11px] text-[var(--kx-muted)]"
        >
          <span className="flex-1 min-w-0">{MEDIA_COPY.matchSummary(matchSummary)}</span>
          <button
            type="button"
            aria-label="Dismiss match result"
            onClick={() => setMatchSummary(null)}
            className="shrink-0 text-[var(--kx-faint)] hover:text-white"
          >
            <X size={11} />
          </button>
        </div>
      )}

      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*,.zip"
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

      {mediaAssets.length === 0 ? (
        <div
          data-testid="media-block-empty"
          className="mx-1 mb-1 rounded-[10px] border border-dashed border-[var(--kx-line-2)] px-3 py-5 text-center"
        >
          <p className="text-[12px] font-semibold text-[var(--kx-muted)]">{MEDIA_COPY.emptyTitle}</p>
          <p className="mt-1 text-[11px] text-[var(--kx-faint)]">{MEDIA_COPY.emptyBody}</p>
        </div>
      ) : rows.length === 0 ? (
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
                data-asset-id={asset.id}
                data-unresolved={asset.unresolved ? 'true' : 'false'}
                data-health={assetHealth(asset)}
                // Media workflow Unit 3 — drag onto a timeline segment to
                // assign it (dedicated asset channel; payload = asset id).
                draggable={editingAssetId !== asset.id}
                onDragStart={(e) => {
                  e.dataTransfer.setData(ASSET_DRAG_MIME, asset.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                className="relative aspect-square rounded-lg overflow-hidden bg-[var(--kx-surface-2)] group cursor-grab active:cursor-grabbing"
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
                    <span data-testid="asset-offline-badge" className="text-[9px]">Offline</span>
                    <Link2 size={11} />
                  </button>
                ) : asset.corrupt ? (
                  <div data-testid="media-block-corrupt" className="w-full h-full flex flex-col items-center justify-center gap-1 text-[var(--kx-danger)]">
                    <AlertCircle size={18} />
                    <span className="text-[9px]">Can't read file</span>
                  </div>
                ) : thumbUrl ? (
                  <img
                    src={thumbUrl} alt="" draggable={false} className="w-full h-full object-cover"
                    onError={() => {
                      if (asset.type !== 'image' || imageCheckedRef.current.has(asset.id)) return;
                      imageCheckedRef.current.add(asset.id);
                      void imageBytesUndecodable(projectId, asset).then(bad => {
                        if (bad) onAssetCorruptRef.current?.(asset.id, 'image-decode');
                      });
                    }}
                  />
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

                {(() => {
                  const health = assetHealth(asset);
                  const copy = ASSET_HEALTH_COPY[health];
                  const tone = health === 'available'
                    ? 'bg-black/60 text-[var(--kx-ready)]'
                    : health === 'unverified'
                      ? 'bg-black/70 text-[var(--kx-accent-2)]'
                      : 'bg-black/80 text-[var(--kx-danger)]';
                  return (
                    <span
                      data-testid="media-block-health-chip"
                      data-health={health}
                      title={copy.title}
                      className={`absolute top-[22px] left-1 text-[8px] leading-none rounded px-1 py-0.5 ${tone}`}
                    >
                      {copy.label}
                    </span>
                  );
                })()}

                <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-1 py-0.5 pr-6">
                  <TileName
                    name={asset.name}
                    onRename={onRenameAsset ? (next) => onRenameAsset(asset.id, next) : undefined}
                    onEditingChange={(editing) => setEditingAssetId(editing ? asset.id : null)}
                  />
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

      {confirmDeleteAll && (
        <ConfirmDialog
          title={MEDIA_COPY.deleteAllTitle}
          body={MEDIA_COPY.deleteAllBody(mediaAssets.length, totalUses)}
          confirmLabel={MEDIA_COPY.deleteAllConfirmLabel}
          cancelLabel={DELETE_COPY.cancelLabel}
          onConfirm={() => { onDeleteAllMedia?.(); setConfirmDeleteAll(false); setMatchSummary(null); }}
          onCancel={() => setConfirmDeleteAll(false)}
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
    </div>
  );
});
