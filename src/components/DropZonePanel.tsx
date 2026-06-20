/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef } from 'react';
import {
  Lock,
  LockOpen,
  Unlock,
  FileText,
  Music,
  Image as ImageIcon,
  Video,
  AlertCircle,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Trash2,
  Heading1,
} from 'lucide-react';
import { VideoSegment, Asset, TextOverlay, TransitionType, AnimationType } from '../types';
import { TRANSITION_OPTIONS, ANIMATION_OPTIONS, FILTERS, FONT_FAMILIES } from '../constants';
import { PresetPicker, type OverlayConfigPreset } from './PresetPicker';
import { stripRtfIfNeeded, detectTextFileRole } from '../services/textUtils';
import { TextLayersPanel } from './TextLayersPanel';
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

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  color = 'text-gray-500',
  multiFile = false,
  expanded,
  onToggle,
  children,
}: SlotRowProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const showDelete = !!stagedFile || (!!persistedLabel && canDeletePersisted);

  return (
    <div
      className={`border-b border-[#111] transition-colors ${isDragOver ? 'bg-[#F27D26]/5' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        onDropFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {/* Line 1: chevron + icon + label + [×] [Browse/Add] */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-1 cursor-pointer" onClick={onToggle}>
        {expanded
          ? <ChevronDown size={12} className="flex-shrink-0 text-gray-500" />
          : <ChevronRight size={12} className="flex-shrink-0 text-gray-500" />
        }
        <span className={`flex-shrink-0 ${color}`}>{icon}</span>
        <span className={`flex-1 text-[10px] font-bold uppercase tracking-widest ${color}`}>
          {label}
        </span>
        {showDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            aria-label={`Remove ${label} file`}
            className="flex-shrink-0 flex items-center text-[9px] uppercase tracking-widest
                       text-red-500 border border-red-500 rounded px-2 py-0.5
                       hover:bg-red-500/10 transition-colors"
          >
            <X size={11} />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); ref.current?.click(); }}
          className="flex-shrink-0 text-[9px] uppercase tracking-widest text-gray-600
                     hover:text-white border border-[#2A2A2A] rounded px-2 py-0.5 transition-colors"
        >
          {multiFile ? '+ Add' : 'Browse'}
        </button>
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
      </div>

      {/* Line 2: subtitle / staged filename / persisted indicator */}
      <div className="flex items-center pl-10 pr-4 pb-2.5 cursor-pointer" onClick={onToggle}>
        {stagedFile ? (
          <span className="flex-1 text-[10px] truncate text-gray-300">{stagedFile.file.name}</span>
        ) : persistedLabel ? (
          <span className="flex-1 text-[10px] truncate text-green-500/70 flex items-center gap-1">
            <Check size={10} className="flex-shrink-0" />
            {persistedLabel}
          </span>
        ) : (
          <span className="flex-1 text-[10px] truncate text-gray-600">{subtitle}</span>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3">{children}</div>
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
      <div ref={trapRef} className="bg-[#111] border border-[#282828] rounded-2xl p-6 w-full max-w-xs shadow-2xl">
        <p className="text-sm text-gray-200 mb-5">Are you sure you want to save the changes?</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 bg-transparent border border-[#282828] py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:border-gray-500 transition-all focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 bg-[#F27D26] text-black py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#FF9D46] transition-all focus:outline-none focus:ring-2 focus:ring-orange-400"
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
  persistedSceneDetails: string;
  persistedSceneDetailsName: string;
  persistedVoiceoverName: string;
  persistedAssetCount: number;
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
  /** Insert a new heading segment at the given index (0 = before all segments). */
  onInsertHeading: (afterIndex: number) => void;
  /** Delete a heading segment by id — only shown on isHeading tiles. */
  onDeleteHeading?: (id: string) => void;
  // Misc
  selectedSegmentId: string | undefined;
  // Global text layers
  textLayers: TextOverlay[];
  onAddTextLayer: () => void;
  onUpdateTextLayer: (id: string, updates: Partial<TextOverlay>) => void;
  onDeleteTextLayer: (id: string) => void;
  onToggleTextLayerOnSegment: (layerId: string, segmentId: string) => void;
  // Effects tab props
  globalTransition: TransitionType;
  globalTransitionDuration: number;
  globalAnimation: string;
  globalOverlayFilter: string;
  globalOverlayConfig: { color: string; backgroundColor: string; fontFamily: string };
  hideAllText: boolean;
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
  onHideAllTextChange: (v: boolean) => void;
  onExportResolutionChange: (v: string) => void;
  onExportFpsChange: (v: number) => void;
  onApplyTransitionPreset: (preset: OverlayConfigPreset | string) => void;
  onApplyAnimationPreset: (preset: OverlayConfigPreset | string) => void;
  onApplyOverlayFilterPreset: (preset: OverlayConfigPreset | string) => void;
  onApplyOverlayConfigPreset: (preset: OverlayConfigPreset) => void;
  onBackToProjects: () => void;
  projectName: string;
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
  persistedSceneDetails,
  persistedSceneDetailsName,
  persistedVoiceoverName,
  persistedAssetCount,
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
  onInsertHeading,
  onDeleteHeading,
  selectedSegmentId,
  textLayers,
  onAddTextLayer,
  onUpdateTextLayer,
  onDeleteTextLayer,
  onToggleTextLayerOnSegment,
  globalTransition,
  globalTransitionDuration,
  globalAnimation,
  globalOverlayFilter,
  globalOverlayConfig,
  hideAllText,
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
  onHideAllTextChange,
  onExportResolutionChange,
  onExportFpsChange,
  onApplyTransitionPreset,
  onApplyAnimationPreset,
  onApplyOverlayFilterPreset,
  onApplyOverlayConfigPreset,
  onBackToProjects,
  projectName,
}: Props) {
  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'files' | 'segments' | 'effects'>('files');

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
  // Index of the inter-segment gap currently being hovered for "+ heading" insertion.
  // -1 = before all segments; i = after segment[i].
  const [hoveredGapIdx, setHoveredGapIdx] = useState<number | null>(null);

  // ── Scene Details edit-mode state ─────────────────────────────────────────
  const [isEditingScene, setIsEditingScene] = useState(false);
  const [sceneDraft, setSceneDraft] = useState('');
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

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

  const toggle = (key: Exclude<ExpandKey, null>) =>
    setExpanded(prev => (prev === key ? null : key));

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#080808] overflow-hidden">

      {/* Panel header — back button + project name */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-[#1A1A1A]">
        <button
          onClick={onBackToProjects}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors"
        >
          <ChevronLeft size={12} />
          <span>Projects</span>
        </button>
        <span className="text-xs text-zinc-500 truncate max-w-[120px]">{projectName}</span>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 border-b border-[#1A1A1A]">
        {(['files', 'segments', 'effects'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest transition-colors
                        ${activeTab === tab
                          ? 'text-white border-b-2 border-[#F27D26] -mb-px'
                          : 'text-gray-600 hover:text-gray-400'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── FILES TAB ───────────────────────────────────────────────────────── */}
      {activeTab === 'files' && (
        <div className="flex flex-col flex-1 min-h-0">

          {/* Scrollable slots area */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">

            {/* Slot 1 — Script */}
            <SlotRow
              icon={<FileText size={12} />}
              label="Script"
              subtitle="Plain text voiceover script"
              accept=".txt,.rtf"
              stagedFile={staged.scriptFile}
              persistedLabel={scriptPersisted}
              canDeletePersisted={true}
              onFile={(f) => void addFiles([f], 'script')}
              onDropFiles={(files) => void addFiles(files, 'script')}
              onDelete={handleScriptClear}
              color="text-orange-400"
              expanded={expanded === 'script'}
              onToggle={() => toggle('script')}
            >
              {persistedScript ? (
                <div
                  className="w-full h-40 overflow-y-auto custom-scrollbar whitespace-pre-wrap
                    bg-transparent text-sm text-gray-300 border border-gray-700 rounded p-2
                    cursor-default"
                >
                  {persistedScript}
                </div>
              ) : (
                <p className="text-[11px] text-gray-600 italic">No script loaded.</p>
              )}
            </SlotRow>

            {slotError && (
              <div className="mx-4 mb-2 px-3 py-2 rounded bg-red-900/60 border border-red-500/50 text-red-300 text-xs flex items-center justify-between gap-2">
                <span>{slotError}</span>
                <button onClick={() => setSlotError(null)} className="text-red-400 hover:text-red-200 shrink-0">✕</button>
              </div>
            )}

            {/* Slot 2 — Scene Details */}
            <SlotRow
              icon={<FileText size={12} />}
              label="Scene Details"
              subtitle="File with [IMAGE:] or [VIDEO:] tags"
              accept=".txt,.rtf"
              stagedFile={staged.sceneFile}
              persistedLabel={scenePersisted}
              canDeletePersisted={true}
              onFile={(f) => void addFiles([f], 'scene')}
              onDropFiles={(files) => void addFiles(files, 'scene')}
              onDelete={handleSceneClear}
              color="text-teal-400"
              expanded={expanded === 'scene'}
              onToggle={() => toggle('scene')}
            >
              {isEditingScene ? (
                <div className="space-y-2">
                  <textarea
                    value={sceneDraft}
                    onChange={(e) => setSceneDraft(e.target.value)}
                    placeholder="Paste scene details with [IMAGE:] or [VIDEO:] tags..."
                    className="w-full h-40 bg-transparent text-sm text-gray-300
                      resize-none border border-teal-700 rounded p-2
                      focus:outline-none focus:border-teal-500"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowSaveConfirm(true)}
                      className="flex-1 py-1.5 rounded-lg bg-[#F27D26] text-black text-[9px]
                                 font-black uppercase tracking-widest hover:bg-[#FF9D46] transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setIsEditingScene(false)}
                      className="flex-1 py-1.5 rounded-lg bg-[#1A1A1A] border border-[#282828] text-[9px]
                                 font-black uppercase tracking-widest text-gray-400 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {persistedSceneDetails ? (
                    <div
                      className="w-full h-40 overflow-y-auto custom-scrollbar whitespace-pre-wrap
                        bg-transparent text-sm text-gray-300 border border-gray-700 rounded p-2
                        cursor-default"
                    >
                      {persistedSceneDetails}
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-600 italic">No scene details loaded.</p>
                  )}
                  <button
                    onClick={() => { setSceneDraft(persistedSceneDetails); setIsEditingScene(true); }}
                    className="text-[9px] uppercase tracking-widest text-gray-500 hover:text-white
                               border border-[#2A2A2A] rounded px-2 py-1 transition-colors"
                  >
                    Edit File
                  </button>
                </div>
              )}
            </SlotRow>

            {/* Slot 3 — Voiceover */}
            <SlotRow
              icon={<Music size={12} />}
              label="Voiceover"
              subtitle="MP3, WAV, M4A or OGG"
              accept="audio/*"
              stagedFile={staged.voiceoverFile}
              persistedLabel={voiceoverPersisted}
              canDeletePersisted
              onFile={(f) => void addFiles([f])}
              onDropFiles={(files) => void addFiles(files)}
              onDelete={handleVoiceoverClear}
              color="text-amber-400"
              expanded={expanded === 'voiceover'}
              onToggle={() => toggle('voiceover')}
            >
              {voiceoverAsset ? (
                <div className="text-[11px] text-gray-400 space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-600">File</span>
                    <span className="truncate text-gray-300">{voiceoverAsset.name}</span>
                  </div>
                  {voiceoverAsset.file && (
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-600">Size</span>
                      <span className="text-gray-300">{formatBytes(voiceoverAsset.file.size)}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-gray-600 italic">No voiceover loaded.</p>
              )}
            </SlotRow>

            {/* Slot 4 — Images & Videos (multi-file, inline drag state) */}
            <div
              className={`border-b border-[#111] transition-colors ${assetsDragOver ? 'bg-[#F27D26]/5' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setAssetsDragOver(true); }}
              onDragLeave={() => setAssetsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setAssetsDragOver(false);
                void addFiles(Array.from(e.dataTransfer.files));
              }}
            >
              {/* Line 1 */}
              <div className="flex items-center gap-2 px-4 pt-3 pb-1 cursor-pointer" onClick={() => toggle('assets')}>
                {expanded === 'assets'
                  ? <ChevronDown size={12} className="flex-shrink-0 text-gray-500" />
                  : <ChevronRight size={12} className="flex-shrink-0 text-gray-500" />
                }
                <ImageIcon size={12} className="flex-shrink-0 text-purple-400" />
                <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-purple-400">
                  Images &amp; Videos
                </span>
                {(allStagedAssets.length > 0 || persistedAssetCount > 0) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAssetsClear(); }}
                    aria-label={allStagedAssets.length > 0 ? 'Clear staged assets' : 'Delete all project assets'}
                    className="flex-shrink-0 flex items-center text-[9px] uppercase tracking-widest
                               text-red-500 border border-red-500 rounded px-2 py-0.5
                               hover:bg-red-500/10 transition-colors"
                  >
                    <X size={11} />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); addAssetsRef.current?.click(); }}
                  className="flex-shrink-0 text-[9px] uppercase tracking-widest text-gray-600
                             hover:text-white border border-[#2A2A2A] rounded px-2 py-0.5 transition-colors"
                >
                  + Add
                </button>
                <input
                  ref={addAssetsRef}
                  type="file"
                  multiple
                  accept="image/*,video/*,.zip"
                  className="hidden"
                  onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
                />
              </div>
              {/* Line 2 */}
              <div className="flex items-center pl-10 pr-4 pb-2.5 cursor-pointer" onClick={() => toggle('assets')}>
                {allStagedAssets.length > 0 ? (
                  <span className="flex-1 text-[10px] text-gray-300">
                    {allStagedAssets.length} file{allStagedAssets.length !== 1 ? 's' : ''}
                  </span>
                ) : persistedAssetCount > 0 ? (
                  <span className="flex-1 text-[10px] text-green-500/70 flex items-center gap-1">
                    <Check size={10} className="flex-shrink-0" />
                    {persistedAssetCount} file{persistedAssetCount !== 1 ? 's' : ''}
                  </span>
                ) : (
                  <span className="flex-1 text-[10px] text-gray-600">Images, videos, or ZIP archive</span>
                )}
              </div>
              {/* Expanded: project asset list (non-audio) */}
              {expanded === 'assets' && (
                <div className="px-4 pb-3">
                  <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1">
                    {nonAudioAssets.length === 0 && (
                      <p className="text-[10px] text-gray-600 italic px-1">No images or videos loaded.</p>
                    )}
                    {nonAudioAssets.map((asset) => (
                      <div key={asset.id} className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0
                                        bg-[#1A1A1A] flex items-center justify-center">
                          {asset.type === 'image'
                            ? <img src={asset.url} className="w-full h-full object-cover" alt="" />
                            : <Video size={16} className="text-blue-400" />
                          }
                        </div>
                        <span className="flex-1 text-[10px] text-gray-300 truncate">{asset.name}</span>
                        <button
                          onClick={() => onDeleteAsset(asset.id)}
                          aria-label={`Delete ${asset.name}`}
                          className="flex-shrink-0 p-1 rounded hover:bg-red-900/40 text-red-600
                                     hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

          </div>{/* end scrollable */}

          {/* Pinned bottom: Apply Sync */}
          <div className="flex-shrink-0 px-4 py-3 border-t border-[#1A1A1A]">
            <button
              onClick={handleApplySync}
              disabled={applySyncDisabled}
              title={applySyncDisabled ? 'Waiting for transcription to finish…' : undefined}
              className="w-full py-3 rounded-xl bg-[#F27D26] text-black text-xs
                         font-black uppercase tracking-widest hover:bg-[#FF9D46]
                         transition-all disabled:opacity-40 disabled:cursor-not-allowed
                         disabled:hover:bg-[#F27D26]"
            >
              Apply Sync
            </button>
          </div>

        </div>
      )}

      {/* ── SEGMENTS TAB ────────────────────────────────────────────────────── */}
      {activeTab === 'segments' && (
        <div className="flex flex-col flex-1 min-h-0">

          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1A1A1A] flex-shrink-0">
            <button
              onClick={() => allLocked ? onUnlockAll() : onLockAll()}
              title={allLocked ? 'Unlock All' : 'Lock All'}
              aria-label={allLocked ? 'Unlock all segments' : 'Lock all segments'}
              className={`p-1.5 rounded-lg hover:bg-[#1A1A1A] transition-colors
                          ${allLocked
                            ? 'text-amber-500 hover:text-amber-400'
                            : 'text-indigo-400 hover:text-indigo-300'}`}
            >
              {allLocked
                ? <LockOpen className="w-4 h-4" />
                : <Lock className="w-4 h-4" />
              }
            </button>
            <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-gray-600">
              {segments.length} Segments
            </span>
          </div>

          {/* Global text layers */}
          <TextLayersPanel
            textLayers={textLayers}
            segments={segments}
            onAddTextLayer={onAddTextLayer}
            onUpdateTextLayer={onUpdateTextLayer}
            onDeleteTextLayer={onDeleteTextLayer}
            onToggleTextLayerOnSegment={onToggleTextLayerOnSegment}
          />

          {/* Segment list */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2">
            {/* Permanent "+ Add Heading" at the top */}
            <button
              onClick={() => onInsertHeading(-1)}
              className="w-full mb-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg
                         border border-dashed border-[#282828] text-[9px] font-bold uppercase tracking-widest
                         text-[#F27D26]/60 hover:text-[#F27D26] hover:border-[#F27D26]/40
                         hover:bg-[#F27D26]/5 transition-all"
              aria-label="Insert heading before all segments"
            >
              <span className="text-sm leading-none">+</span> Add Heading
            </button>

            {segments.map((seg, i) => {
              const asset = assets.find(a => a.id === seg.assetId);
              const isSelected = seg.id === selectedSegmentId;
              const isMissing = !asset && !!(seg.text || seg.heading || seg.isHeading);
              return (
                <div key={seg.id} className="relative group/gap">
                  <div
                    onClick={() => onSegmentClick(seg.id)}
                    className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer
                                transition-all border
                                ${isSelected
                                  ? 'bg-[#F27D26]/10 border-[#F27D26]/30'
                                  : 'bg-[#0A0A0A] border-[#1A1A1A] hover:border-[#282828]'
                                }`}
                  >
                    <div className="w-10 h-8 rounded-lg overflow-hidden flex-shrink-0
                                    bg-[#1A1A1A] flex items-center justify-center">
                      {seg.isHeading
                        ? <Heading1 size={14} className="text-[#F27D26]/70" />
                        : asset?.url && asset.type === 'image'
                        ? <img src={asset.url} className="w-full h-full object-cover" alt="" />
                        : asset?.type === 'video'
                        ? <Video size={14} className="text-blue-400" />
                        : isMissing
                        ? <AlertCircle size={14} className="text-yellow-500" />
                        : <div className="w-full h-full bg-[#1A1A1A]" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold text-white truncate">
                        {seg.headingConfig?.text || seg.heading || asset?.name || `Scene ${seg.order + 1}`}
                      </p>
                      <p className="text-[9px] text-gray-600 font-mono">
                        {formatTime(seg.startTime)} — {formatTime(seg.startTime + seg.duration)}
                      </p>
                    </div>
                    {seg.isHeading && onDeleteHeading && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteHeading(seg.id); }}
                        className="flex-shrink-0 p-1 rounded-lg hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-colors opacity-0 group-hover/gap:opacity-100"
                        aria-label="Delete heading"
                        title="Delete heading"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleLock(seg.id); }}
                      className="flex-shrink-0 p-1 rounded-lg hover:bg-[#1A1A1A] transition-colors"
                      aria-label={seg.locked ? 'Unlock segment' : 'Lock segment'}
                    >
                      {seg.locked
                        ? <Lock size={12} className="text-[#F27D26]" />
                        : <Unlock size={12} className="text-gray-600" />
                      }
                    </button>
                  </div>

                  {/* Hover-reveal "+ heading" gap button — appears between segments */}
                  <div
                    className="relative h-3 flex items-center justify-center"
                    onMouseEnter={() => setHoveredGapIdx(i)}
                    onMouseLeave={() => setHoveredGapIdx(null)}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); onInsertHeading(i); }}
                      className={`absolute flex items-center gap-1 px-2 py-0.5 rounded-md
                                  text-[8px] font-black uppercase tracking-widest
                                  bg-[#0A0A0A] border border-[#282828] text-[#F27D26]/70
                                  hover:text-[#F27D26] hover:border-[#F27D26]/40 hover:bg-[#F27D26]/5
                                  transition-all z-10
                                  ${hoveredGapIdx === i ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                      aria-label={`Insert heading after segment ${i + 1}`}
                    >
                      <span className="text-xs leading-none">+</span> heading
                    </button>
                    <div className={`w-full h-px bg-[#F27D26]/20 transition-opacity ${hoveredGapIdx === i ? 'opacity-100' : 'opacity-0'}`} />
                  </div>
                </div>
              );
            })}
            {segments.length === 0 && (
              <p className="text-[10px] text-gray-700 italic px-1 py-2">
                No segments yet — apply sync to generate.
              </p>
            )}
          </div>

        </div>
      )}

      {/* ── EFFECTS TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'effects' && (
        <div className="flex-1 overflow-y-auto custom-scrollbar">

          {/* Section: Transition */}
          <div className="px-4 py-3 border-b border-[#111] space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#F27D26]">Transition</p>
            <select
              value={globalTransition}
              onChange={(e) => onTransitionChange(e.target.value as TransitionType)}
              className="w-full bg-[#111] border border-[#222] p-2 rounded-lg text-[10px] uppercase font-bold tracking-widest outline-none focus:border-[#F27D26]"
            >
              {TRANSITION_OPTIONS.map(t => (
                <option key={t} value={t}>{t === TransitionType.NONE ? 'instant (none)' : t}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <label className="text-[9px] text-gray-600 uppercase tracking-widest">Duration (s)</label>
              <input
                type="number" step="0.1" min="0.1" max="2"
                value={globalTransitionDuration}
                onChange={(e) => onTransitionDurationChange(parseFloat(e.target.value) || 0.1)}
                className="w-20 bg-[#111] border border-[#222] p-1.5 rounded-lg text-[10px] font-bold outline-none focus:border-[#F27D26]"
              />
            </div>
            <button
              onClick={onApplyTransitionToAll}
              className="w-full py-1.5 rounded-lg bg-[#1A1A1A] border border-[#282828] text-[9px] font-black uppercase tracking-widest text-[#F27D26] hover:bg-[#F27D26] hover:text-white transition-all"
            >
              Apply to all segments
            </button>
            <PresetPicker
              category="transition"
              label="Transition"
              currentValue={currentTransition}
              onApply={(v) => onApplyTransitionPreset(v as string)}
            />
          </div>

          {/* Section: Animation */}
          <div className="px-4 py-3 border-b border-[#111] space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#F27D26]">Animation</p>
            <select
              value={globalAnimation}
              onChange={(e) => onAnimationChange(e.target.value)}
              className="w-full bg-[#111] border border-[#222] p-2 rounded-lg text-[10px] uppercase font-bold tracking-widest outline-none focus:border-[#F27D26]"
            >
              {ANIMATION_OPTIONS.map(a => (
                <option key={a} value={a}>{a === AnimationType.NONE ? 'static (none)' : a.replace('-', ' ')}</option>
              ))}
            </select>
            <button
              onClick={onApplyAnimationToAll}
              className="w-full py-1.5 rounded-lg bg-[#1A1A1A] border border-[#282828] text-[9px] font-black uppercase tracking-widest text-[#F27D26] hover:bg-[#F27D26] hover:text-white transition-all"
            >
              Apply to all segments
            </button>
            <PresetPicker
              category="animation"
              label="Animation"
              currentValue={currentAnimation}
              onApply={(v) => onApplyAnimationPreset(v as string)}
            />
          </div>

          {/* Section: Overlay Filter */}
          <div className="px-4 py-3 border-b border-[#111] space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#F27D26]">Overlay Filter</p>
            <select
              value={globalOverlayFilter || 'none'}
              onChange={(e) => onFilterChange(e.target.value)}
              className="w-full bg-[#111] border border-[#222] p-2 rounded-lg text-[10px] uppercase font-bold tracking-widest outline-none focus:border-[#F27D26]"
            >
              {FILTERS.map(f => <option key={f} value={f}>{f.replace('-', ' ')}</option>)}
            </select>
            <button
              onClick={onApplyFilterToAll}
              className="w-full py-1.5 rounded-lg bg-[#1A1A1A] border border-[#282828] text-[9px] font-black uppercase tracking-widest text-[#F27D26] hover:bg-[#F27D26] hover:text-white transition-all"
            >
              Apply to all segments
            </button>
            <PresetPicker
              category="overlayFilter"
              label="Overlay Filter"
              currentValue={currentOverlayFilter}
              onApply={(v) => onApplyOverlayFilterPreset(v as string)}
            />
          </div>

          {/* Section: Overlay Style */}
          <div className="px-4 py-3 border-b border-[#111] space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#F27D26]">Overlay Style</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[8px] uppercase tracking-widest text-gray-600">Text Color</label>
                <input
                  type="color"
                  value={globalOverlayConfig.color}
                  onChange={(e) => onOverlayConfigChange({ color: e.target.value })}
                  className="w-full h-7 bg-transparent border-none cursor-pointer"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] uppercase tracking-widest text-gray-600">Bg Color</label>
                <input
                  type="color"
                  value={globalOverlayConfig.backgroundColor}
                  onChange={(e) => onOverlayConfigChange({ backgroundColor: e.target.value })}
                  className="w-full h-7 bg-transparent border-none cursor-pointer"
                />
              </div>
            </div>
            <select
              value={globalOverlayConfig.fontFamily}
              onChange={(e) => onOverlayConfigChange({ fontFamily: e.target.value })}
              className="w-full bg-[#111] border border-[#222] p-2 rounded-lg text-[10px] font-bold outline-none focus:border-[#F27D26]"
            >
              {FONT_FAMILIES.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            </select>
            <PresetPicker
              category="overlayConfig"
              label="Overlay Style"
              currentValue={currentOverlayConfig}
              onApply={(v) => onApplyOverlayConfigPreset(v as OverlayConfigPreset)}
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
              Hide On-Screen Text
              <button
                onClick={() => onHideAllTextChange(!hideAllText)}
                aria-label={hideAllText ? 'Show on-screen text' : 'Hide on-screen text'}
                aria-pressed={hideAllText}
                className={`w-10 h-5 rounded-full transition-colors relative ${hideAllText ? 'bg-[#F27D26]' : 'bg-[#1A1A1A] border border-[#282828]'}`}
              >
                <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-all ${hideAllText ? 'translate-x-5' : ''}`} />
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
