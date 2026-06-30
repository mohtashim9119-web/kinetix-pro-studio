/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import {
  Lock,
  LockOpen,
  FileText,
  Music,
  Image as ImageIcon,
  Video,
  Film,
  AlertCircle,
  Check,
  X,
  ChevronRight,
  ChevronLeft,
  Trash2,
  ListChecks,
  CheckSquare,
  Square,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { VideoSegment, Asset, TransitionType, AnimationType } from '../types';
import { TRANSITION_OPTIONS, ANIMATION_OPTIONS, FILTERS, FONT_FAMILIES } from '../constants';
import { PresetPicker, type OverlayConfigPreset } from './PresetPicker';
import EffectsPanel, { type Preset as EffectsPreset, type ApplyEvent as EffectsApplyEvent } from './EffectsPanel';
import { loadLookPresets, saveLookPreset, deleteLookPreset, type LookPreset } from '../services/lookPresetService';
import { stripRtfIfNeeded, detectTextFileRole } from '../services/textUtils';
import { useFocusTrap } from '../hooks/useFocusTrap';

// ---------------------------------------------------------------------------
// Exported types (consumed by App.tsx)
// ---------------------------------------------------------------------------

export interface StagedFile {
  file: File;
  key: string; // stable React key, generated on staging
}

export interface StagedFiles {
  scriptFile: StagedFile | null;
  sceneFile: StagedFile | null;
  voiceoverFile: StagedFile | null;
  assetFiles: StagedFile[]; // images + videos
  zipFiles: StagedFile[];
}

const EMPTY_STAGED: StagedFiles = {
  scriptFile: null,
  sceneFile: null,
  voiceoverFile: null,
  assetFiles: [],
  zipFiles: [],
};

type ExpandKey = 'script' | 'scene' | 'voiceover' | 'assets' | null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

const formatFileDate = (ms: number) =>
  new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

/**
 * Human-readable segment title for the Segments tab row. Heading segments use their
 * own text; content segments fall back through the asset filename (cleaned of leading
 * index codes / trailing timestamps / extension) to a positional "Scene N" label.
 * VideoSegment has no filename/sceneLine field of its own — the filename lives on the
 * looked-up Asset.
 */
const humanTitle = (seg: VideoSegment, asset: Asset | undefined): string => {
  if (seg.isHeading) return seg.headingConfig?.text || seg.heading || `Heading ${seg.order + 1}`;
  if (asset?.name) {
    const cleaned = asset.name
      .replace(/\.[a-zA-Z0-9]+$/, '')      // extension
      .replace(/^\d{2,4}[_-]/, '')          // leading index code
      .replace(/[_-]\d{8,}$/, '')           // trailing timestamp
      .replace(/[_-]+/g, ' ')
      .trim();
    if (cleaned) return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return seg.heading || `Scene ${seg.order + 1}`;
};

/**
 * Resolves a pointer's vertical position to a gap index (0..rows.length) among
 * the given row elements — the first row whose vertical midpoint sits below
 * the pointer wins; falls through to rows.length if the pointer is below all
 * of them. Rows with no measured element (not yet mounted) are skipped.
 */
const computeDropGapIndex = (rows: (HTMLDivElement | null)[], pointerY: number): number => {
  for (let i = 0; i < rows.length; i++) {
    const rect = rows[i]?.getBoundingClientRect();
    if (!rect) continue;
    if (pointerY < rect.top + rect.height / 2) return i;
  }
  return rows.length;
};

// ---------------------------------------------------------------------------
// SlotRow — flat two-line file slot with a collapsible content section.
//
// Display priority on line 2:
//   1. staged file present  → staged filename (pending sync)
//   2. persistedLabel set    → "✓ <label>" muted green (already in project)
//   3. otherwise             → subtitle
//
// Right-side buttons (line 1): [×] (when deletable) then [Browse / + Add].
// Clicking the label rows toggles the expanded content section (children).
// ---------------------------------------------------------------------------

interface SlotRowProps {
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  accept: string;
  stagedFile: StagedFile | null;
  persistedLabel?: string;      // non-empty = already-synced data exists
  canDeletePersisted?: boolean; // does × delete persisted data when no staged file?
  onFile: (file: File) => void;
  onDropFiles: (files: File[]) => void;
  onDelete: () => void;
  color?: string;
  multiFile?: boolean; // renders "+ Add" instead of "Browse"
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode; // expanded content
}

function SlotRow({
  icon,
  label,
  subtitle,
  accept,
  stagedFile,
  persistedLabel,
  canDeletePersisted = false,
  onFile,
  onDropFiles,
  onDelete,
  color = '#8a93a2',
  multiFile = false,
  expanded,
  onToggle,
  children,
}: SlotRowProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const showDelete = !!stagedFile || (!!persistedLabel && canDeletePersisted);
  const hasContent = !!stagedFile || !!persistedLabel;
  const subLine = stagedFile ? stagedFile.file.name : (persistedLabel || subtitle);

  return (
    <div
      className={`mx-3 mb-2 rounded-[13px] border overflow-hidden transition-colors
                  bg-[var(--kx-surface)] border-[var(--kx-line)] hover:border-[var(--kx-line-2)]
                  ${isDragOver ? 'bg-[var(--kx-accent-soft)]' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        onDropFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {/* Header — chevron + type tile + label/sub-line + status chip + action buttons.
          Action buttons (Replace/Browse/+Add/×) are always visible, independent of
          `expanded` — only the body below the header shows/hides on toggle. */}
      <div className="w-full flex items-center gap-2.5 px-3 py-2.5">
        <button onClick={onToggle} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
          <span className="flex-none w-6 flex items-center justify-center">
            <ChevronRight
              size={13}
              className={`transition-transform ${expanded ? 'rotate-90 text-[var(--kx-accent)]' : 'text-[var(--kx-faint)]'}`}
            />
          </span>
          <span
            className="flex-none w-9 h-9 rounded-[10px] flex items-center justify-center"
            style={{ background: `${color}26`, color }}
          >
            {icon}
          </span>
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-[14px] font-semibold text-[var(--kx-text)] min-w-0 truncate">{label}</span>
            <span className="text-[11.5px] text-[var(--kx-muted)] truncate">{subLine}</span>
          </span>
        </button>

        {stagedFile ? (
          <span className="flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-[6px]
                           bg-[var(--kx-accent-soft)] text-[var(--kx-accent-2)]">
            <RefreshCw size={11} /> Pending
          </span>
        ) : persistedLabel ? (
          <span className="flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-[6px]
                           bg-[var(--kx-ready-soft)] text-[var(--kx-ready)]">
            <Check size={11} /> Ready
          </span>
        ) : (
          <span className="flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-[6px]
                           bg-[var(--kx-surface-2)] text-[var(--kx-faint)]">
            <AlertCircle size={11} /> Empty
          </span>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); ref.current?.click(); }}
          aria-label={multiFile ? `Add ${label} file` : (hasContent ? `Replace ${label} file` : `Browse for ${label} file`)}
          className={multiFile
            ? `flex items-center justify-center w-8 h-8 rounded-[8px]
               bg-[var(--kx-accent-soft)] border border-[var(--kx-accent-line)]
               text-[var(--kx-accent-2)] hover:bg-[rgba(255,138,60,.2)]
               transition-colors flex-shrink-0`
            : `flex items-center justify-center w-8 h-8 rounded-[8px]
               bg-[var(--kx-surface-2)] border border-[var(--kx-line)]
               text-[var(--kx-muted)] hover:text-[var(--kx-text)]
               hover:border-[var(--kx-line-2)] transition-colors flex-shrink-0`
          }
        >
          {multiFile ? <Plus size={13} /> : <RefreshCw size={13} />}
        </button>

        {showDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            aria-label={`Remove ${label} file`}
            className="flex items-center justify-center w-8 h-8 rounded-[8px]
                       bg-[var(--kx-surface-2)] border border-[var(--kx-line)]
                       text-[var(--kx-faint)] hover:text-[var(--kx-danger)]
                       hover:border-[var(--kx-danger)] transition-colors flex-shrink-0"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiFile}
        className="hidden"
        onChange={(e) => {
          if (multiFile) {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) { onDropFiles(files); e.target.value = ''; }
          } else {
            const f = e.target.files?.[0];
            if (f) { onFile(f); e.target.value = ''; }
          }
        }}
      />

      {/* Expanded body — per-slot content only; action buttons live in the header above */}
      {expanded && (
        <div className="px-3 pb-3">{children}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SaveConfirmDialog — small centered confirm popup for committing a Scene
// Details edit. Mounted/unmounted on demand so useFocusTrap's mount-effect
// (which focuses the first control and traps Tab) fires at the right time.
// ---------------------------------------------------------------------------

function SaveConfirmDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm save"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div ref={trapRef} className="bg-[var(--kx-surface)] border border-[var(--kx-line-2)] rounded-2xl p-6 w-full max-w-xs shadow-2xl">
        <p className="text-[14px] text-[var(--kx-text)] mb-5">Are you sure you want to save the changes?</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 bg-transparent border border-[var(--kx-line-2)] py-2.5 rounded-xl text-[12.5px] font-semibold text-[var(--kx-muted)] hover:text-[var(--kx-text)] hover:border-[var(--kx-muted)] transition-all focus:outline-none focus:ring-2 focus:ring-[var(--kx-line-2)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 bg-[var(--kx-accent)] text-[#1a1003] py-2.5 rounded-xl text-[12.5px] font-semibold hover:bg-[var(--kx-accent-hover)] transition-all focus:outline-none focus:ring-2 focus:ring-[var(--kx-accent-line)]"
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  segments: VideoSegment[];
  assets: Asset[];
  voiceoverId: string | undefined;
  // Current project state — drives "already synced" slot display + editors.
  script: string;
  persistedScript: string;
  persistedScriptName: string;
  /** Epoch ms (`file.lastModified`) of the script file last committed via Apply Sync. */
  persistedScriptUpdatedAt: number | undefined;
  persistedSceneDetails: string;
  persistedSceneDetailsName: string;
  /** Epoch ms (`file.lastModified`) of the scene-details file last committed via Apply Sync. */
  persistedSceneDetailsUpdatedAt: number | undefined;
  persistedVoiceoverName: string;
  persistedAssetCount: number;
  /** True once the project has completed its first sync — locks the Scene Details editor. */
  isSynced: boolean;
  // Text editing (collapsible sections)
  onClearScript: () => void;
  onClearSceneDetails: () => void;
  // Asset management
  onDeleteAsset: (assetId: string) => void;
  onDeleteAllAssets: () => void;
  onDeleteVoiceover: () => void;
  // File actions
  onApplySync: (staged: StagedFiles) => void;
  /** Fired the moment a voiceover file is staged (dropped/browsed), before Apply Sync is clicked. */
  onVoiceoverStaged: (file: File) => void;
  /** Fired when a staged-but-uncommitted voiceover is removed or replaced. */
  onVoiceoverUnstaged: () => void;
  /** True while Apply Sync should be inert — voiceover staged/persisted but not yet transcribed. */
  applySyncDisabled: boolean;
  // Segment actions
  onSegmentClick: (segmentId: string) => void;
  onToggleLock: (segmentId: string) => void;
  onLockAll: () => void;
  onUnlockAll: () => void;
  allLocked: boolean;
  onOpenReviewMapping: () => void;
  /** Insert a new heading segment at the given index (0 = before all segments). */
  onInsertHeading: (afterIndex: number) => void;
  /** Delete a heading segment by id — only shown on isHeading tiles. */
  onDeleteHeading?: (id: string) => void;
  /** Move a heading segment to a new gap index (0..segments.length) among the
   *  current segments array — only shown (drag handle) on isHeading tiles. */
  onMoveHeading?: (id: string, targetIndex: number) => void;
  // Misc
  selectedSegmentId: string | undefined;
  // Currently playing/active segment id (derived from playback time in App.tsx).
  currentSegmentId?: string;
  // Batch (multi-)selection for Effects tab — separate from selectedSegmentId.
  selectedSegmentIds: Set<string>;
  onToggleSegmentSelect: (id: string) => void;
  onSelectAllSegments: () => void;
  onClearSegmentSelection: () => void;
  // Effects Tab Rebuild — Step 5: writes effect fields onto segments.
  onApplyEffect: (e: EffectsApplyEvent) => void;
  // Effects tab props
  globalTransition: TransitionType;
  globalTransitionDuration: number;
  globalAnimation: string;
  globalOverlayFilter: string;
  globalOverlayConfig: { color: string; backgroundColor: string; fontFamily: string };
  exportResolution: string;
  exportFps: number;
  currentTransition: string;
  currentAnimation: string;
  currentOverlayFilter: string;
  currentOverlayConfig: OverlayConfigPreset;
  onTransitionChange: (v: TransitionType) => void;
  onTransitionDurationChange: (v: number) => void;
  onApplyTransitionToAll: () => void;
  onAnimationChange: (v: string) => void;
  onApplyAnimationToAll: () => void;
  onFilterChange: (v: string) => void;
  onApplyFilterToAll: () => void;
  onOverlayConfigChange: (v: Partial<{ color: string; backgroundColor: string; fontFamily: string }>) => void;
  /** Master "Overlay Text Display" setter — bulk-writes showOverlay across all segments. */
  onSetAllOverlay: (value: boolean) => void;
  onExportResolutionChange: (v: string) => void;
  onExportFpsChange: (v: number) => void;
  onApplyTransitionPreset: (preset: OverlayConfigPreset | string) => void;
  onApplyAnimationPreset: (preset: OverlayConfigPreset | string) => void;
  onApplyOverlayFilterPreset: (preset: OverlayConfigPreset | string) => void;
  onApplyOverlayConfigPreset: (preset: OverlayConfigPreset) => void;
  onBackToProjects: () => void;
  projectName: string;
  onRename: (name: string) => void;
  activeLeftTab: 'files' | 'segments' | 'effects';
  onActiveLeftTabChange: (tab: 'files' | 'segments' | 'effects') => void;
  isPlaying: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DropZonePanel({
  segments,
  assets,
  voiceoverId,
  script,
  persistedScript,
  persistedScriptName,
  persistedScriptUpdatedAt,
  persistedSceneDetails,
  persistedSceneDetailsName,
  persistedSceneDetailsUpdatedAt,
  persistedVoiceoverName,
  persistedAssetCount,
  isSynced,
  onClearScript,
  onClearSceneDetails,
  onDeleteAsset,
  onDeleteAllAssets,
  onDeleteVoiceover,
  onApplySync,
  onVoiceoverStaged,
  onVoiceoverUnstaged,
  applySyncDisabled,
  onSegmentClick,
  onToggleLock,
  onLockAll,
  onUnlockAll,
  allLocked,
  onOpenReviewMapping,
  onInsertHeading,
  onDeleteHeading,
  onMoveHeading,
  selectedSegmentId,
  currentSegmentId,
  selectedSegmentIds,
  onToggleSegmentSelect,
  onSelectAllSegments,
  onClearSegmentSelection,
  onApplyEffect,
  globalTransition,
  globalTransitionDuration,
  globalAnimation,
  globalOverlayFilter,
  globalOverlayConfig,
  exportResolution,
  exportFps,
  currentTransition,
  currentAnimation,
  currentOverlayFilter,
  currentOverlayConfig,
  onTransitionChange,
  onTransitionDurationChange,
  onApplyTransitionToAll,
  onAnimationChange,
  onApplyAnimationToAll,
  onFilterChange,
  onApplyFilterToAll,
  onOverlayConfigChange,
  onSetAllOverlay,
  onExportResolutionChange,
  onExportFpsChange,
  onApplyTransitionPreset,
  onApplyAnimationPreset,
  onApplyOverlayFilterPreset,
  onApplyOverlayConfigPreset,
  onBackToProjects,
  projectName,
  onRename,
  activeLeftTab,
  onActiveLeftTabChange,
  isPlaying,
}: Props) {
  // ── Tab state (controlled from App.tsx for persistence) ───────────────────
  const activeTab = activeLeftTab;
  const setActiveTab = onActiveLeftTabChange;
  // ── Inline project-name edit state ────────────────────────────────────────
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(projectName);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [segmentSearch, setSegmentSearch] = useState('');

  // Master "Overlay Text Display" state: ON only when every segment shows its overlay.
  // Empty segments → true (vacuously), which is harmless — there is nothing to toggle.
  const allOverlayOn = segments.every((s) => s.showOverlay);
  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
  const maxSegmentDuration = Math.max(1, ...segments.map((s) => s.duration));

  // ── Collapsible section state ──────────────────────────────────────────────
  const [expanded, setExpanded] = useState<ExpandKey>(null);
  const [slotError, setSlotError] = useState<string | null>(null);

  // ── Staged file state ─────────────────────────────────────────────────────
  const [staged, setStaged] = useState<StagedFiles>(EMPTY_STAGED);
  // Ref that mirrors staged synchronously — used by handleApplySync so that
  // React batching cannot cause it to read a stale pre-update value.
  const stagedRef = useRef<StagedFiles>(EMPTY_STAGED);
  const addAssetsRef = useRef<HTMLInputElement>(null);
  const [assetsDragOver, setAssetsDragOver] = useState(false);
  // Combined-look effect presets — loaded from lookPresetService on mount, kept in
  // sync with localStorage on every add/remove from EffectsPanel.
  const [lookPresets, setLookPresets] = useState<LookPreset[]>(() => loadLookPresets());

  const handleLookPresetsChange = (next: EffectsPreset[]): void => {
    const prevIds = new Set(lookPresets.map((p) => p.id));
    const nextIds = new Set(next.map((p) => p.id));

    for (const id of prevIds) {
      if (!nextIds.has(id)) deleteLookPreset(id);
    }
    for (const preset of next) {
      if (!prevIds.has(preset.id)) {
        saveLookPreset(preset);
      }
    }
    setLookPresets(loadLookPresets());
  };
  // Index of the inter-segment gap currently being hovered for "+ heading" insertion.
  // -1 = before all segments; i = after segment[i].
  const [hoveredGapIdx, setHoveredGapIdx] = useState<number | null>(null);

  // ── Heading drag-to-reorder state ─────────────────────────────────────────
  // Id of the heading currently being dragged via its grip handle, if any.
  const [draggingHeadingId, setDraggingHeadingId] = useState<string | null>(null);
  // Gap index (0..segments.length) the dragged heading would land in if dropped now.
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  // Mirrors dropTargetIdx synchronously so onPointerUp always commits the latest value,
  // independent of whether React has re-rendered between the last move and the up event.
  const dropTargetIdxRef = useRef<number | null>(null);
  // Row elements indexed by position, measured on pointer move to resolve dropTargetIdx.
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Auto-scroll the active segment into view during playback (Bug 4).
  useEffect(() => {
    if (!isPlaying || !currentSegmentId) return;
    const idx = segments.findIndex(s => s.id === currentSegmentId);
    if (idx < 0) return;
    const row = rowRefs.current[idx];
    const container = document.getElementById('segment-list-scroll');
    if (!row || !container) return;
    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    if (rowTop < viewTop || rowBottom > viewBottom) {
      container.scrollTo({ top: rowTop - container.clientHeight / 2, behavior: 'smooth' });
    }
  }, [currentSegmentId, isPlaying, segments]);

  // ── Scene Details edit-mode state ─────────────────────────────────────────
  const [isEditingScene, setIsEditingScene] = useState(false);
  const [sceneDraft, setSceneDraft] = useState('');
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  // Lock-out safety: if a sync completes while the Scene Details editor is
  // open (e.g. Apply Sync was triggered from a different staged slot mid-edit),
  // force it closed — otherwise it'd be stuck open with no "Edit File" button
  // left to ever reach Cancel again.
  useEffect(() => {
    if (isSynced) setIsEditingScene(false);
  }, [isSynced]);

  const updateStaged = (updater: (prev: StagedFiles) => StagedFiles) => {
    setStaged(prev => {
      const next = updater(prev);
      stagedRef.current = next;
      return next;
    });
  };

  // `script` retained for compatibility; Apply Sync no longer gates on it.
  void script;

  /**
   * Classifies and stages dropped/browsed files.
   * forceSlot bypasses content detection AND extension sniffing for explicit
   * slot drops/browses (Script + Scene Details).
   */
  const addFiles = async (
    files: File[],
    forceSlot?: 'script' | 'scene',
  ): Promise<void> => {
    type TextEntry = {
      file: File;
      key: string;
      role: 'script' | 'sceneDetails' | 'forced_script' | 'forced_scene';
    };

    const textEntries: TextEntry[] = [];
    const voiceoverEntries: { file: File; key: string }[] = [];
    const assetEntries: { file: File; key: string }[] = [];
    const zipEntries: { file: File; key: string }[] = [];

    for (const file of files) {
      const key = crypto.randomUUID();
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

      // FIX 4A: a forced slot (direct drop / Browse on Script or Scene Details)
      // always wins — regardless of extension or content. This must be checked
      // BEFORE extension sniffing, or non-.txt/.rtf files would be misrouted to
      // the asset bucket and the forced slot would never fill.
      if (forceSlot) {
        if (forceSlot === 'script') {
          const raw = await file.text();
          const stripped = stripRtfIfNeeded(raw);
          const bracketCount = (stripped.match(/\[(IMAGE|VIDEO|AUDIO):/gi) ?? []).length;
          if (bracketCount >= 3) {
            setSlotError('Wrong file — drop your plain text script here, not a scene details file.');
            setTimeout(() => setSlotError(null), 4000);
            return;
          }
        }
        textEntries.push({
          file,
          key,
          role: forceSlot === 'script' ? 'forced_script' : 'forced_scene',
        });
        continue;
      }

      if (ext === 'txt' || ext === 'rtf') {
        const raw = await file.text();
        const stripped = stripRtfIfNeeded(raw);
        const role = detectTextFileRole(stripped);
        textEntries.push({ file, key, role });
      } else if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) {
        voiceoverEntries.push({ file, key });
      } else if (ext === 'zip') {
        zipEntries.push({ file, key });
      } else {
        assetEntries.push({ file, key });
      }
    }

    updateStaged(prev => {
      let { scriptFile, sceneFile, voiceoverFile } = prev;
      const assetFiles = [...prev.assetFiles];
      const zipFiles = [...prev.zipFiles];

      for (const v of voiceoverEntries) {
        voiceoverFile = { file: v.file, key: v.key };
      }

      for (const a of assetEntries) assetFiles.push({ file: a.file, key: a.key });
      for (const z of zipEntries) zipFiles.push({ file: z.file, key: z.key });

      let pendingScript: TextEntry | null = null;
      let pendingScene: TextEntry | null = null;

      for (const tf of textEntries) {
        if (tf.role === 'forced_script') {
          scriptFile = { file: tf.file, key: tf.key };
        } else if (tf.role === 'forced_scene') {
          sceneFile = { file: tf.file, key: tf.key };
        } else if (tf.role === 'sceneDetails') {
          if (!pendingScene) pendingScene = tf;
          else if (!pendingScript) pendingScript = tf;
        } else {
          if (!pendingScript) pendingScript = tf;
          else if (!pendingScene) pendingScene = tf;
        }
      }

      if (pendingScript) scriptFile = { file: pendingScript.file, key: pendingScript.key };
      if (pendingScene) sceneFile = { file: pendingScene.file, key: pendingScene.key };

      return { scriptFile, sceneFile, voiceoverFile, assetFiles, zipFiles };
    });

    // Option C — trigger transcription the moment a voiceover is staged,
    // independent of Apply Sync. Last-one-wins, mirroring the staging loop above.
    const lastVoiceoverEntry = voiceoverEntries.at(-1);
    if (lastVoiceoverEntry) {
      onVoiceoverStaged(lastVoiceoverEntry.file);
    }
  };

  const removeSlot = (slot: 'script' | 'scene' | 'voiceover') =>
    updateStaged(prev => ({ ...prev, [`${slot}File`]: null }));

  const clearAllStagedAssets = () =>
    updateStaged(prev => ({ ...prev, assetFiles: [], zipFiles: [] }));

  // Shared by the Apply Sync button and the Scene Details save-confirm flow —
  // runs the sync with an explicit snapshot, clears staged files, and switches
  // to the Segments tab so the result is immediately visible.
  const triggerSync = (snapshot: StagedFiles) => {
    onApplySync(snapshot);
    // Clear staged so slots immediately switch to the green persisted indicator.
    updateStaged(() => EMPTY_STAGED);
    setActiveTab('segments');
  };

  const handleApplySync = () => {
    triggerSync(stagedRef.current);
  };

  // Commits an edited Scene Details draft by staging it as a synthetic file —
  // this routes the new text through the same atomic sync path as an uploaded
  // file (handleApplySyncFromFiles reads project.sceneDetails off a ref that
  // only updates post-render, so a direct setProject call here could be read
  // back stale if it raced with the sync trigger).
  const handleConfirmSaveScene = () => {
    const fileName = persistedSceneDetailsName || 'scene-details.txt';
    const sceneFile: StagedFile = {
      file: new File([sceneDraft], fileName, { type: 'text/plain' }),
      key: crypto.randomUUID(),
    };
    setIsEditingScene(false);
    setShowSaveConfirm(false);
    triggerSync({ ...stagedRef.current, sceneFile });
  };

  const allStagedAssets = [...staged.assetFiles, ...staged.zipFiles];

  // Nothing newly staged — Apply Sync re-running on unchanged persisted data is
  // harmless (idempotent) but no longer an explicit, intentional trigger. Gate
  // it out so "Apply Sync only fires on new file upload" is a real invariant,
  // not just an accident of how staged state happens to reset post-sync.
  const isStagedEmpty = !staged.scriptFile && !staged.sceneFile && !staged.voiceoverFile
    && staged.assetFiles.length === 0 && staged.zipFiles.length === 0;

  // ── × clear handlers ───────────────────────────────────────────────────────
  // Single click clears both staged file AND persisted project data.
  const handleScriptClear = () => {
    updateStaged(prev => ({ ...prev, scriptFile: null }));
    onClearScript();
  };

  const handleSceneClear = () => {
    updateStaged(prev => ({ ...prev, sceneFile: null }));
    onClearSceneDetails();
  };

  const handleVoiceoverClear = () => {
    updateStaged(prev => ({ ...prev, voiceoverFile: null }));
    onVoiceoverUnstaged();
    onDeleteVoiceover();
  };

  const handleAssetsClear = () => {
    updateStaged(prev => ({ ...prev, assetFiles: [], zipFiles: [] }));
    onDeleteAllAssets();
  };

  // ── Persisted-state labels + derived lookups ────────────────────────────────
  const scriptPersisted = persistedScript.trim().length > 0
    ? (persistedScriptName || 'Script loaded')
    : undefined;
  const scenePersisted = persistedSceneDetails.trim().length > 0
    ? (persistedSceneDetailsName || 'Scene loaded')
    : undefined;
  const voiceoverPersisted = persistedVoiceoverName || undefined;

  const voiceoverAsset = assets.find(a => a.id === voiceoverId);
  const nonAudioAssets = assets.filter(a => a.type !== 'audio');
  const voiceoverExt = voiceoverAsset?.name.split('.').pop()?.toUpperCase();
  // addedAt survives a reload (plain number); file.lastModified only survives the
  // same session — file itself is dropped during IndexedDB rehydration.
  const voiceoverUpdatedAtMs = voiceoverAsset?.addedAt ?? voiceoverAsset?.file?.lastModified;

  const scriptWordCount = persistedScript.trim().length > 0
    ? persistedScript.trim().split(/\s+/).length
    : undefined;

  const toggle = (key: Exclude<ExpandKey, null>) =>
    setExpanded(prev => (prev === key ? null : key));

  // ── Files tab summary row ───────────────────────────────────────────────────
  const readyCount = [!!scriptPersisted, !!scenePersisted, !!voiceoverPersisted, persistedAssetCount > 0]
    .filter(Boolean).length;
  const fileCount = (scriptPersisted ? 1 : 0) + (scenePersisted ? 1 : 0)
    + (voiceoverPersisted ? 1 : 0) + persistedAssetCount;
  const allReady = readyCount === 4;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--kx-panel)] overflow-hidden">

      {/* Panel header — back button + project name */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-[var(--kx-line)]">
        <button
          onClick={onBackToProjects}
          className="flex items-center gap-1.5 text-[13px] text-[var(--kx-muted)] hover:text-[var(--kx-text)] transition-colors"
        >
          <ChevronLeft size={12} />
          <span>Projects</span>
        </button>
        {isEditingName ? (
          <input
            ref={nameInputRef}
            type="text"
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={() => { onRename(nameDraft.trim() || projectName); setIsEditingName(false); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { onRename(nameDraft.trim() || projectName); setIsEditingName(false); }
              if (e.key === 'Escape') { setNameDraft(projectName); setIsEditingName(false); }
            }}
            className="text-[12px] text-[var(--kx-text)] font-medium bg-[var(--kx-line)] border border-[var(--kx-accent)] rounded px-1.5 py-0.5 max-w-[120px] outline-none"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
        ) : (
          <button
            onClick={() => { setNameDraft(projectName); setIsEditingName(true); }}
            title="Rename project"
            className="text-[12px] text-[var(--kx-faint)] font-medium truncate max-w-[120px] hover:text-[var(--kx-text)] transition-colors text-left"
          >
            {projectName}
          </button>
        )}
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 border-b border-[var(--kx-line)]">
        {(['files', 'segments', 'effects'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 text-[13px] font-semibold tracking-[0.3px] capitalize transition-colors
                        ${activeTab === tab
                          ? 'text-[var(--kx-text)] border-b-2 border-[var(--kx-accent)] -mb-px'
                          : 'text-[var(--kx-faint)] hover:text-[var(--kx-muted)]'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── FILES TAB ───────────────────────────────────────────────────────── */}
      {activeTab === 'files' && (
        <div className="flex flex-col flex-1 min-h-0">

          {/* Summary row */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="flex items-center gap-1.5 text-[13px]">
              <span className="font-semibold text-[var(--kx-text)]">{readyCount}</span>
              <span className="text-[var(--kx-muted)]">sources</span>
              <span className="text-[var(--kx-faint)]">·</span>
              <span className="text-[var(--kx-muted)]">{fileCount} files</span>
            </div>
            <span className={`flex items-center gap-1 text-[12px] font-semibold
                             ${allReady ? 'text-[var(--kx-ready)]' : 'text-[var(--kx-accent-2)]'}`}>
              {allReady ? <Check size={13} /> : <AlertCircle size={13} />}
              {allReady ? 'All ready' : `${readyCount} of 4 ready`}
            </span>
          </div>
          {/* Progress bar */}
          <div className="mx-4 mb-3 h-[4px] rounded-full bg-[rgba(255,255,255,.07)] overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500
                            ${allReady
                              ? 'bg-gradient-to-r from-[var(--kx-ready)] to-[#7ee3b8]'
                              : 'bg-gradient-to-r from-[var(--kx-accent)] to-[var(--kx-accent-2)]'}`}
                 style={{ width: `${(readyCount / 4) * 100}%` }} />
          </div>

          {/* Scrollable slots area */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">

            {/* Slot 1 — Script */}
            <SlotRow
              icon={<FileText size={18} />}
              label="Script"
              subtitle="Plain text voiceover script"
              accept=".txt,.rtf"
              stagedFile={staged.scriptFile}
              persistedLabel={scriptPersisted}
              canDeletePersisted={true}
              onFile={(f) => void addFiles([f], 'script')}
              onDropFiles={(files) => void addFiles(files, 'script')}
              onDelete={handleScriptClear}
              color="#fb923c"
              expanded={expanded === 'script'}
              onToggle={() => toggle('script')}
            >
              {persistedScript ? (
                <div className="space-y-1">
                  {[
                    { label: 'Format', value: 'Plain text' },
                    { label: 'Words', value: scriptWordCount ?? '—' },
                    {
                      label: 'Updated',
                      value: persistedScriptUpdatedAt
                        ? formatFileDate(persistedScriptUpdatedAt)
                        : (persistedScriptName || 'Script loaded'),
                    },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center py-1 text-[12px]">
                      <span className="text-[var(--kx-faint)]">{label}</span>
                      <span className="text-[var(--kx-muted)]">{value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-[var(--kx-faint)] italic">No script loaded.</p>
              )}
            </SlotRow>

            {slotError && (
              <div className="mx-3 mb-2 px-3 py-2 rounded-[9px] bg-[rgba(255,107,107,.12)] border border-[rgba(255,107,107,.35)] text-[var(--kx-danger)] text-[12.5px] flex items-center justify-between gap-2">
                <span>{slotError}</span>
                <button onClick={() => setSlotError(null)} className="hover:opacity-70 shrink-0">✕</button>
              </div>
            )}

            {/* Slot 2 — Scene Details */}
            <SlotRow
              icon={<FileText size={18} />}
              label="Scene Details"
              subtitle="File with [IMAGE:] or [VIDEO:] tags"
              accept=".txt,.rtf"
              stagedFile={staged.sceneFile}
              persistedLabel={scenePersisted}
              canDeletePersisted={true}
              onFile={(f) => void addFiles([f], 'scene')}
              onDropFiles={(files) => void addFiles(files, 'scene')}
              onDelete={handleSceneClear}
              color="#2dd4bf"
              expanded={expanded === 'scene'}
              onToggle={() => toggle('scene')}
            >
              {isEditingScene ? (
                <div className="space-y-2">
                  <textarea
                    value={sceneDraft}
                    onChange={(e) => setSceneDraft(e.target.value)}
                    placeholder="Paste scene details with [IMAGE:] or [VIDEO:] tags..."
                    className="w-full h-40 bg-[var(--kx-surface-2)] text-[13px] text-[var(--kx-muted)]
                      resize-none border border-[var(--kx-line-2)] rounded-[9px] p-2.5
                      focus:outline-none focus:border-[var(--kx-type-scene)]"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowSaveConfirm(true)}
                      className="flex-1 h-8 rounded-[9px] bg-[var(--kx-accent)] text-[#1a1003] text-[12px]
                                 font-semibold hover:bg-[var(--kx-accent-hover)] transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setIsEditingScene(false)}
                      className="flex-1 h-8 rounded-[9px] bg-[var(--kx-surface-2)] border border-[var(--kx-line)] text-[12px]
                                 font-semibold text-[var(--kx-muted)] hover:text-[var(--kx-text)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {persistedSceneDetails ? (
                    <div className="space-y-1">
                      {[
                        { label: 'Format', value: 'Plain text' },
                        { label: 'Scenes', value: String(segments.length) },
                        {
                          label: 'Updated',
                          value: persistedSceneDetailsUpdatedAt
                            ? formatFileDate(persistedSceneDetailsUpdatedAt)
                            : (persistedSceneDetailsName || 'Scene loaded'),
                        },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between items-center py-1 text-[12px]">
                          <span className="text-[var(--kx-faint)]">{label}</span>
                          <span className="text-[var(--kx-muted)]">{value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-[var(--kx-faint)] italic">No scene details loaded.</p>
                  )}
                  {!isSynced && (
                    <button
                      onClick={() => { setSceneDraft(persistedSceneDetails); setIsEditingScene(true); }}
                      className="text-[12px] font-medium text-[var(--kx-muted)] hover:text-[var(--kx-text)]
                                 border border-[var(--kx-line)] rounded-[8px] px-2.5 py-1.5 transition-colors"
                    >
                      Edit file
                    </button>
                  )}
                </div>
              )}
            </SlotRow>

            {/* Slot 3 — Voiceover */}
            <SlotRow
              icon={<Music size={18} />}
              label="Voiceover"
              subtitle="MP3, WAV, M4A or OGG"
              accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.wma,.opus,.aiff,.aif"
              stagedFile={staged.voiceoverFile}
              persistedLabel={voiceoverPersisted}
              canDeletePersisted
              onFile={(f) => void addFiles([f])}
              onDropFiles={(files) => void addFiles(files)}
              onDelete={handleVoiceoverClear}
              color="#fbbf24"
              expanded={expanded === 'voiceover'}
              onToggle={() => toggle('voiceover')}
            >
              {voiceoverAsset ? (
                <div className="space-y-1">
                  {[
                    { label: 'Duration', value: segments.length > 0 ? formatTime(totalDuration) : '—' },
                    { label: 'Format', value: voiceoverExt ?? '—' },
                    {
                      label: 'Updated',
                      value: voiceoverUpdatedAtMs ? formatFileDate(voiceoverUpdatedAtMs) : voiceoverAsset.name,
                    },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center py-1 text-[12px]">
                      <span className="text-[var(--kx-faint)]">{label}</span>
                      <span className="text-[var(--kx-muted)]">{value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-[var(--kx-faint)] italic">No voiceover loaded.</p>
              )}
            </SlotRow>

            {/* Slot 4 — Images & Videos (multi-file, inline drag state). Hand-rolled (not
                SlotRow) since it needs the asset-list + multi-file staged count, but shares
                SlotRow's header/chip visual language and always-visible action buttons. */}
            <div
              className={`mx-3 mb-2 rounded-[13px] border overflow-hidden transition-colors
                          bg-[var(--kx-surface)] border-[var(--kx-line)] hover:border-[var(--kx-line-2)]
                          ${assetsDragOver ? 'bg-[var(--kx-accent-soft)]' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setAssetsDragOver(true); }}
              onDragLeave={() => setAssetsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setAssetsDragOver(false);
                void addFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <div className="w-full flex items-center gap-2.5 px-3 py-2.5">
                <button onClick={() => toggle('assets')} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
                  <span className="flex-none w-6 flex items-center justify-center">
                    <ChevronRight
                      size={13}
                      className={`transition-transform ${expanded === 'assets' ? 'rotate-90 text-[var(--kx-accent)]' : 'text-[var(--kx-faint)]'}`}
                    />
                  </span>
                  <span
                    className="flex-none w-9 h-9 rounded-[10px] flex items-center justify-center"
                    style={{ background: '#c084fc26', color: '#c084fc' }}
                  >
                    <ImageIcon size={18} />
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-[14px] font-semibold text-[var(--kx-text)] min-w-0 truncate">Images &amp; Videos</span>
                    <span className="text-[11.5px] text-[var(--kx-muted)] truncate">
                      {allStagedAssets.length > 0
                        ? `${allStagedAssets.length} file${allStagedAssets.length !== 1 ? 's' : ''}`
                        : persistedAssetCount > 0
                          ? `${persistedAssetCount} file${persistedAssetCount !== 1 ? 's' : ''}`
                          : 'Images, videos, or ZIP archive'}
                    </span>
                  </span>
                </button>

                {allStagedAssets.length > 0 ? (
                  <span className="flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-[6px]
                                   bg-[var(--kx-accent-soft)] text-[var(--kx-accent-2)]">
                    <RefreshCw size={11} /> Pending
                  </span>
                ) : persistedAssetCount > 0 ? (
                  <span className="flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-[6px]
                                   bg-[var(--kx-ready-soft)] text-[var(--kx-ready)]">
                    <Check size={11} /> Ready
                  </span>
                ) : (
                  <span className="flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-[6px]
                                   bg-[var(--kx-surface-2)] text-[var(--kx-faint)]">
                    <AlertCircle size={11} /> Empty
                  </span>
                )}

                <button
                  onClick={(e) => { e.stopPropagation(); addAssetsRef.current?.click(); }}
                  aria-label="Add images or videos"
                  className="flex items-center justify-center w-8 h-8 rounded-[8px]
                             bg-[var(--kx-surface-2)] border border-[var(--kx-line)]
                             text-[var(--kx-muted)] hover:text-[var(--kx-text)]
                             hover:border-[var(--kx-line-2)] transition-colors flex-shrink-0"
                >
                  <Plus size={13} />
                </button>

                {(allStagedAssets.length > 0 || persistedAssetCount > 0) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAssetsClear(); }}
                    aria-label={allStagedAssets.length > 0 ? 'Clear staged assets' : 'Delete all project assets'}
                    className="flex items-center justify-center w-8 h-8 rounded-[8px]
                               bg-[var(--kx-surface-2)] border border-[var(--kx-line)]
                               text-[var(--kx-faint)] hover:text-[var(--kx-danger)]
                               hover:border-[var(--kx-danger)] transition-colors flex-shrink-0"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <input
                ref={addAssetsRef}
                type="file"
                multiple
                accept="image/*,video/*,.zip"
                className="hidden"
                onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
              />

              {expanded === 'assets' && (
                <div className="px-3 pb-3">
                  <div className="max-h-48 overflow-y-auto custom-scrollbar">
                    {nonAudioAssets.length === 0 && (
                      <p className="text-[11px] text-[var(--kx-faint)] italic px-1">No images or videos loaded.</p>
                    )}
                    {nonAudioAssets.map((asset) => (
                      <div key={asset.id} className="flex items-center gap-2.5 px-3 py-1.5">
                        <div className="w-8 h-8 rounded-[7px] overflow-hidden flex-shrink-0
                                        bg-[var(--kx-surface-2)] flex items-center justify-center">
                          {asset.type === 'image'
                            ? <img src={asset.url} className="w-full h-full object-cover" alt="" />
                            : <Film size={13} className="text-[var(--kx-faint)]" />
                          }
                        </div>
                        <span className="flex-1 min-w-0 text-[12px] text-[var(--kx-muted)] truncate">{asset.name}</span>
                        <button
                          onClick={() => onDeleteAsset(asset.id)}
                          aria-label={`Delete ${asset.name}`}
                          className="flex-shrink-0 w-8 h-8 rounded-[8px] flex items-center justify-center
                                     text-[var(--kx-faint)] hover:text-[var(--kx-danger)] hover:bg-[rgba(255,107,107,.1)]
                                     transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

          </div>{/* end scrollable */}

          {/* Pinned bottom: Apply Sync */}
          <div className="flex-shrink-0 px-4 pb-4 pt-3 border-t border-[var(--kx-line)]">
            <p className="text-center text-[11.5px] text-[var(--kx-faint)] mb-2.5">
              Generates{' '}
              <span className="text-[var(--kx-muted)] font-medium">{segments.length} segments</span>
              {' · '}
              <span className="text-[var(--kx-muted)] font-medium">{formatTime(totalDuration)}</span>
              {' '}timeline
            </p>
            <button
              onClick={handleApplySync}
              disabled={applySyncDisabled || isStagedEmpty}
              title={
                applySyncDisabled
                  ? 'Waiting for transcription to finish…'
                  : isStagedEmpty
                    ? 'Stage a new file to sync'
                    : undefined
              }
              className="w-full h-12 rounded-[13px] flex items-center justify-center gap-2.5
                         font-semibold text-[14.5px] tracking-[0.3px] text-[#1a1003]
                         bg-gradient-to-b from-[var(--kx-accent-2)] to-[var(--kx-accent)]
                         shadow-[0_6px_20px_rgba(255,138,60,.28),inset_0_1px_0_rgba(255,255,255,.22)]
                         hover:brightness-105 active:scale-[.99]
                         disabled:bg-none disabled:bg-[var(--kx-surface-2)]
                         disabled:text-[var(--kx-faint)] disabled:shadow-none disabled:cursor-not-allowed
                         transition-all"
            >
              <RefreshCw size={17} className={applySyncDisabled ? 'animate-spin' : ''} />
              {applySyncDisabled ? 'Syncing…' : 'Apply sync'}
            </button>
          </div>

        </div>
      )}

      {/* ── SEGMENTS TAB ────────────────────────────────────────────────────── */}
      {activeTab === 'segments' && (
        <div className="flex flex-col flex-1 min-h-0">

          {/* Header row 1 — count/runtime + search */}
          <div className="flex items-center justify-between px-4 pt-3.5 pb-2 flex-shrink-0">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-semibold text-[15px] text-[var(--kx-text)]">{segments.length}</span>
              <span className="text-[12.5px] text-[var(--kx-muted)]">segment{segments.length !== 1 ? 's' : ''}</span>
              <span className="text-[var(--kx-faint)]">·</span>
              <span className="font-mono text-[12px] text-[var(--kx-muted)]">{formatTime(totalDuration)}</span>
            </div>
            <div className="relative flex-shrink-0">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--kx-faint)] pointer-events-none" />
              <input
                type="text"
                value={segmentSearch}
                onChange={(e) => setSegmentSearch(e.target.value)}
                placeholder="Search segments…"
                className="h-[28px] w-[160px] pl-7 pr-3 rounded-full text-[12px]
                           bg-[var(--kx-surface)] border border-[var(--kx-line)] text-[var(--kx-text)]
                           placeholder:text-[var(--kx-faint)] focus:outline-none focus:border-[var(--kx-line-2)]"
              />
            </div>
          </div>

          {/* Header row 2 — 3 unified action buttons */}
          <div className="flex gap-2 px-4 pb-3 flex-shrink-0 border-b border-[var(--kx-line)]">
            {([
              {
                key: 'lock',
                label: allLocked ? 'Unlock all' : 'Lock all',
                Icon: allLocked ? LockOpen : Lock,
                active: allLocked,
                title: allLocked ? 'Unlock All' : 'Lock All',
                onClick: () => (allLocked ? onUnlockAll() : onLockAll()),
              },
              {
                key: 'review',
                label: 'Review',
                Icon: ListChecks,
                active: false,
                title: 'Review Mapping',
                onClick: onOpenReviewMapping,
              },
              {
                key: 'select',
                label: selectedSegmentIds.size > 0 ? 'Clear' : 'Select all',
                Icon: selectedSegmentIds.size > 0 ? CheckSquare : Square,
                active: selectedSegmentIds.size > 0,
                title: selectedSegmentIds.size > 0 ? 'Clear selection' : 'Select all segments',
                onClick: () => (selectedSegmentIds.size > 0 ? onClearSegmentSelection() : onSelectAllSegments()),
              },
            ] as const).map(({ key, label, Icon, active, title, onClick }) => (
              <button
                key={key}
                onClick={onClick}
                title={title}
                aria-label={title}
                className={`flex-1 flex items-center justify-center gap-1.5 h-[34px] px-3 rounded-[9px] text-[12.5px]
                            font-medium border transition-colors
                            ${active
                              ? 'bg-[var(--kx-accent-soft)] border-[var(--kx-accent-line)] text-[var(--kx-accent-2)]'
                              : 'bg-[var(--kx-surface)] border-[var(--kx-line)] text-[var(--kx-muted)] hover:text-[var(--kx-text)] hover:border-[var(--kx-line-2)] hover:bg-[var(--kx-hover)]'
                            }`}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Segment list */}
          <div id="segment-list-scroll" className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2">
            {/* Permanent "+ Add Heading" at the top */}
            <button
              onClick={() => onInsertHeading(-1)}
              className="w-full h-[42px] mb-1.5 flex items-center justify-center gap-2 rounded-[11px]
                         border border-dashed border-[var(--kx-line-2)] text-[12.5px] font-medium
                         text-[var(--kx-muted)] hover:text-[var(--kx-accent-2)] hover:border-[var(--kx-accent-line)]
                         hover:bg-[var(--kx-accent-soft)] transition-all"
              aria-label="Insert heading before all segments"
            >
              <Plus size={15} /> Add heading
            </button>

            {segments.map((seg, i) => {
              if (segmentSearch && !seg.text?.toLowerCase().includes(segmentSearch.toLowerCase())) return null;
              const asset = assets.find(a => a.id === seg.assetId);
              const isSelected = seg.id === selectedSegmentId;
              const isActive = seg.id === currentSegmentId;
              const isChecked = selectedSegmentIds.has(seg.id);
              const title = humanTitle(seg, asset);
              return (
                <div
                  key={seg.id}
                  ref={(el) => { rowRefs.current[i] = el; }}
                  className="relative group/gap"
                >
                  {draggingHeadingId && dropTargetIdx === i && (
                    <div className="absolute -top-0.5 left-0 right-0 h-0.5 bg-[var(--kx-accent)] rounded-full z-20 pointer-events-none" />
                  )}
                  <div
                    onClick={() => onSegmentClick(seg.id)}
                    className={`group relative flex items-stretch mx-0.5 mb-1.5 rounded-[13px] border overflow-hidden
                                cursor-pointer transition-colors
                                ${seg.isHeading ? 'select-none' : ''}
                                ${isActive
                                  ? 'border-[var(--kx-accent-line)]'
                                  : isSelected
                                    ? 'border-[var(--kx-accent-line)] bg-[var(--kx-accent-soft)]'
                                    : 'border-[var(--kx-line)] hover:border-[var(--kx-line-2)]'
                                }
                                ${!isActive && !isSelected ? 'bg-[var(--kx-surface)] hover:bg-[var(--kx-hover)]' : ''}`}
                    {...(seg.isHeading && onMoveHeading ? {
                      onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
                        if ((e.target as HTMLElement).closest('button')) return;
                        e.preventDefault();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setDraggingHeadingId(seg.id);
                        dropTargetIdxRef.current = i;
                        setDropTargetIdx(i);
                      },
                      onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
                        if (draggingHeadingId !== seg.id) return;
                        const idx = computeDropGapIndex(rowRefs.current, e.clientY);
                        if (idx !== dropTargetIdxRef.current) {
                          dropTargetIdxRef.current = idx;
                          setDropTargetIdx(idx);
                        }
                      },
                      onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                        if (draggingHeadingId === seg.id && onMoveHeading) {
                          onMoveHeading(seg.id, dropTargetIdxRef.current ?? i);
                        }
                        setDraggingHeadingId(null);
                        setDropTargetIdx(null);
                      },
                      style: { cursor: draggingHeadingId === seg.id ? 'grabbing' : 'grab' },
                    } : {})}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-[8px] bottom-[8px] w-[3px]
                                       bg-[var(--kx-accent)] rounded-r-[3px] z-10" />
                    )}
                    {!isActive && isSelected && (
                      <span className="absolute left-0 top-[8px] bottom-[8px] w-[3px] bg-[var(--kx-accent)] rounded-r-[3px]" />
                    )}
                    {/* Left spine — drag handle (headings) or index + duration bar + start time */}
                    <div className="flex-none flex flex-col items-center justify-center gap-1.5 w-[40px] py-2.5 border-r border-[var(--kx-line)]">
                      <span className={`font-mono text-[10px] ${isActive ? 'text-[var(--kx-accent-2)]' : isSelected ? 'text-[var(--kx-accent-2)]' : 'text-[var(--kx-faint)]'}`}>{String(i + 1).padStart(2, '0')}</span>
                      <span
                        className={`w-1 rounded-[2px] ${isActive || isSelected || isChecked ? 'bg-[var(--kx-accent)]' : 'bg-[rgba(255,255,255,.13)]'}`}
                        style={{ height: Math.max(10, Math.min(32, (seg.duration / maxSegmentDuration) * 32)) }}
                      />
                      <span className="font-mono text-[9px] text-[var(--kx-faint)]">{formatTime(seg.startTime)}</span>
                    </div>

                    {/* Thumbnail */}
                    {seg.isHeading ? (
                      <div className="w-[60px] h-[60px] m-2.5 mr-3 rounded-[9px] flex-shrink-0
                                      bg-[var(--kx-accent)] flex items-center justify-center">
                        <span className="text-white font-bold text-[18px] tracking-tight">H1</span>
                      </div>
                    ) : (
                      <div className="flex-none w-[60px] h-[60px] m-2.5 mr-3 rounded-[9px] overflow-hidden flex-shrink-0
                                      bg-[var(--kx-surface-2)] flex items-center justify-center
                                      shadow-[inset_0_0_0_1px_rgba(255,255,255,.07)]">
                        {asset?.url && asset.type === 'image'
                          ? <img src={asset.url} className="w-full h-full object-cover" alt="" />
                          : asset?.type === 'video'
                          ? <Video size={18} className="text-blue-400" />
                          : <div className="w-full h-full rounded-[9px] bg-[var(--kx-surface-2)]" />
                        }
                      </div>
                    )}

                    {/* Meta */}
                    <div className="flex-1 min-w-0 flex flex-col justify-center gap-1 py-2.5 pr-2">
                      <p className="text-[14px] font-semibold text-[var(--kx-text)] truncate">{title}</p>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-[var(--kx-muted)]">
                          {formatTime(seg.startTime)}<span className="text-[var(--kx-faint)] mx-0.5">→</span>{formatTime(seg.startTime + seg.duration)}
                        </span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-[5px] bg-[var(--kx-accent-soft)] text-[var(--kx-accent-2)]">
                          {seg.duration.toFixed(1)}s
                        </span>
                      </div>
                      {!seg.isHeading && asset?.name && (
                        <span className="font-mono text-[10px] text-[var(--kx-faint)] truncate
                                         opacity-0 group-hover/gap:opacity-100 transition-opacity">
                          {asset.name}
                        </span>
                      )}
                    </div>

                    {/* Right controls */}
                    <div className="flex-none flex flex-col items-center justify-center gap-2 px-3 py-2.5">
                      <div className="relative flex items-center justify-center">
                        {seg.isHeading && onDeleteHeading && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onDeleteHeading(seg.id); }}
                            className="absolute right-full mr-1 opacity-0 group-hover:opacity-100 transition-opacity
                                       p-1.5 rounded-[6px] text-[var(--kx-faint)]
                                       hover:text-[var(--kx-danger)]
                                       hover:bg-[rgba(255,107,107,0.1)]"
                            aria-label="Delete heading"
                            title="Delete heading"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggleLock(seg.id); }}
                          className={`w-8 h-8 rounded-[8px] flex items-center justify-center border transition-all
                                      ${seg.locked
                                        ? 'bg-[var(--kx-accent-soft)] border-[var(--kx-accent-line)] text-[var(--kx-accent-2)]'
                                        : 'bg-transparent border-[var(--kx-line)] text-[var(--kx-faint)] hover:text-[var(--kx-text)] hover:border-[var(--kx-line-2)] hover:bg-[var(--kx-hover)]'
                                      }`}
                          aria-label={seg.locked ? 'Unlock segment' : 'Lock segment'}
                        >
                          {seg.locked ? <Lock size={14} /> : <LockOpen size={14} />}
                        </button>
                      </div>
                      {/* Batch-select checkbox — hover-reveal unless checked. stopPropagation so it never triggers row seek. */}
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleSegmentSelect(seg.id); }}
                        role="checkbox"
                        aria-checked={isChecked}
                        aria-label={isChecked ? 'Deselect segment' : 'Select segment'}
                        title={isChecked ? 'Deselect' : 'Select'}
                        className={`w-[18px] h-[18px] rounded-[5px] flex items-center justify-center border transition-all
                                    ${isChecked
                                      ? 'bg-[var(--kx-accent)] border-[var(--kx-accent)] opacity-100'
                                      : 'bg-transparent border-[var(--kx-line-2)] opacity-0 group-hover/gap:opacity-100 hover:border-[var(--kx-muted)]'}`}
                      >
                        {isChecked && <Check size={11} className="text-[#1a1003]" strokeWidth={3} />}
                      </button>
                    </div>
                  </div>

                  {/* Hover-reveal "+ heading" gap button — appears between segments */}
                  <div
                    className="relative h-3 flex items-center justify-center"
                    onMouseEnter={() => setHoveredGapIdx(i)}
                    onMouseLeave={() => setHoveredGapIdx(null)}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); onInsertHeading(i); }}
                      className={`absolute flex items-center gap-1 px-2 py-0.5 rounded-[6px]
                                  text-[10px] font-medium
                                  bg-[var(--kx-surface)] border border-[var(--kx-line-2)] text-[var(--kx-muted)]
                                  hover:text-[var(--kx-accent-2)] hover:border-[var(--kx-accent-line)] hover:bg-[var(--kx-accent-soft)]
                                  transition-all z-10
                                  ${hoveredGapIdx === i ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                      aria-label={`Insert heading after segment ${i + 1}`}
                    >
                      <Plus size={11} /> heading
                    </button>
                    <div className={`w-full h-px bg-[var(--kx-line-2)] transition-opacity ${hoveredGapIdx === i ? 'opacity-100' : 'opacity-0'}`} />
                  </div>
                </div>
              );
            })}
            {draggingHeadingId && dropTargetIdx === segments.length && (
              <div className="h-0.5 bg-[var(--kx-accent)] rounded-full" />
            )}
            {segments.length === 0 && (
              <p className="text-[12px] text-[var(--kx-faint)] italic px-1 py-2">
                No segments yet — apply sync to generate.
              </p>
            )}
          </div>

        </div>
      )}

      {/* ── EFFECTS TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'effects' && (
        <div className="flex-1 overflow-y-auto custom-scrollbar">

          {/* ── EFFECTS REBUILD (Step 1: UI landing, inert stubs) ──────────── */}
          <div className="p-3">
            <EffectsPanel
              initialPresets={lookPresets}
              selectedCount={selectedSegmentIds.size}
              onApply={onApplyEffect}
              onPresetsChange={handleLookPresetsChange}
            />
          </div>

          {/* Section: Export Quality */}
          <div className="px-4 py-3 border-b border-[#111] space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#F27D26]">Export Quality</p>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-[8px] uppercase tracking-widest text-gray-600">Resolution</label>
                <select
                  value={exportResolution}
                  onChange={(e) => onExportResolutionChange(e.target.value)}
                  className="w-full bg-[#111] border border-[#222] p-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest outline-none focus:border-[#F27D26]"
                >
                  <option value="1080p">1080p</option>
                  <option value="4k">4K</option>
                </select>
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-[8px] uppercase tracking-widest text-gray-600">Frame Rate</label>
                <select
                  value={exportFps}
                  onChange={(e) => onExportFpsChange(Number(e.target.value))}
                  className="w-full bg-[#111] border border-[#222] p-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest outline-none focus:border-[#F27D26]"
                >
                  <option value={24}>24 fps</option>
                  <option value={30}>30 fps</option>
                  <option value={60}>60 fps</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section: Display */}
          <div className="px-4 py-3 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#F27D26]">Display</p>
            <label className="flex items-center justify-between text-[10px] uppercase tracking-widest text-gray-500 font-bold">
              Overlay Text Display (Default)
              <button
                onClick={() => onSetAllOverlay(!allOverlayOn)}
                aria-label={allOverlayOn ? 'Hide overlay text on all segments' : 'Show overlay text on all segments'}
                aria-pressed={allOverlayOn}
                className={`w-10 h-5 rounded-full transition-colors relative ${allOverlayOn ? 'bg-[#F27D26]' : 'bg-[#1A1A1A] border border-[#282828]'}`}
              >
                <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-all ${allOverlayOn ? 'translate-x-5' : ''}`} />
              </button>
            </label>
          </div>

        </div>
      )}

      {showSaveConfirm && (
        <SaveConfirmDialog
          onConfirm={handleConfirmSaveScene}
          onCancel={() => setShowSaveConfirm(false)}
        />
      )}

    </div>
  );
}
