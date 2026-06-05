/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef } from 'react';
import {
  Settings,
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
} from 'lucide-react';
import { VideoSegment, Asset } from '../types';
import { stripRtfIfNeeded, detectTextFileRole } from '../services/textUtils';

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

// ---------------------------------------------------------------------------
// SlotRow — flat two-line file slot (no card border, just row separator)
//
// Display priority per slot:
//   1. staged file present  → staged filename (pending sync)
//   2. persistedLabel set    → "✓ <label>" muted green (already in project)
//   3. otherwise             → subtitle
//
// The × button appears when there's a staged file, OR when persisted data
// exists AND that data is deletable from this slot (canDeletePersisted).
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
      {/* Line 1: icon + label + action button */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-1">
        <span className={`flex-shrink-0 ${color}`}>{icon}</span>
        <span className={`flex-1 text-[10px] font-bold uppercase tracking-widest ${color}`}>
          {label}
        </span>
        <button
          onClick={() => ref.current?.click()}
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

      {/* Line 2: subtitle / staged filename / persisted indicator  +  × */}
      <div className="flex items-center pl-10 pr-4 pb-2.5">
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
        {showDelete && (
          <button
            onClick={onDelete}
            aria-label={`Remove ${label} file`}
            className="flex-shrink-0 ml-2 p-0.5 rounded hover:bg-red-900/40 text-red-500 transition-colors"
          >
            <X size={11} />
          </button>
        )}
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
  // Current project state — drives "already synced" slot display.
  script: string;
  persistedScript: string;
  persistedSceneDetails: string;
  persistedVoiceoverName: string;
  persistedAssetCount: number;
  // Asset management
  onDeleteAsset: (assetId: string) => void;
  onDeleteAllAssets: () => void;
  onDeleteVoiceover: () => void;
  // File actions
  onApplySync: (staged: StagedFiles) => void;
  // Segment actions
  onSegmentClick: (segmentId: string) => void;
  onToggleLock: (segmentId: string) => void;
  onUnlockAll: () => void;
  // Misc
  selectedSegmentId: string | undefined;
  onOpenSettings: () => void;
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
  persistedSceneDetails,
  persistedVoiceoverName,
  persistedAssetCount,
  onDeleteAsset,
  onDeleteAllAssets,
  onDeleteVoiceover,
  onApplySync,
  onSegmentClick,
  onToggleLock,
  onUnlockAll,
  selectedSegmentId,
  onOpenSettings,
}: Props) {
  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'files' | 'segments'>('files');

  // ── Staged file state ─────────────────────────────────────────────────────
  const [staged, setStaged] = useState<StagedFiles>(EMPTY_STAGED);
  const addAssetsRef = useRef<HTMLInputElement>(null);
  const [assetsDragOver, setAssetsDragOver] = useState(false);

  // Props received but not surfaced in this layout; suppress unused-var warnings.
  // (assets + onDeleteAllAssets ARE used below — intentionally not voided.)
  void voiceoverId; void onDeleteAsset;

  /**
   * Classifies and stages dropped/browsed files.
   * forceSlot bypasses content detection for explicit slot drops.
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

      if (ext === 'txt' || ext === 'rtf') {
        if (forceSlot) {
          textEntries.push({
            file,
            key,
            role: forceSlot === 'script' ? 'forced_script' : 'forced_scene',
          });
        } else {
          const raw = await file.text();
          const stripped = stripRtfIfNeeded(raw);
          const role = detectTextFileRole(stripped);
          textEntries.push({ file, key, role });
        }
      } else if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) {
        voiceoverEntries.push({ file, key });
      } else if (ext === 'zip') {
        zipEntries.push({ file, key });
      } else {
        assetEntries.push({ file, key });
      }
    }

    setStaged(prev => {
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
  };

  const removeSlot = (slot: 'script' | 'scene' | 'voiceover') =>
    setStaged(prev => ({ ...prev, [`${slot}File`]: null }));

  const clearAllStagedAssets = () =>
    setStaged(prev => ({ ...prev, assetFiles: [], zipFiles: [] }));

  const handleApplySync = () => {
    onApplySync(staged);
    setStaged(EMPTY_STAGED);
  };

  // Apply Sync enabled when sceneFile is staged AND either scriptFile is
  // staged or an existing script is already loaded.
  const canApplySync =
    !!staged.sceneFile && (!!staged.scriptFile || script.trim().length > 0);

  const allStagedAssets = [...staged.assetFiles, ...staged.zipFiles];

  // ── × clear handlers ───────────────────────────────────────────────────────
  // Rule: a × clears the STAGED file first (deselect, no project mutation).
  // Only when nothing is staged does × delete the persisted project data —
  // and only for slots where that makes sense (voiceover, assets).
  const handleScriptClear = () => {
    if (staged.scriptFile) removeSlot('script');
    // No persisted delete for script — text stays in project until re-sync.
  };

  const handleSceneClear = () => {
    if (staged.sceneFile) removeSlot('scene');
    // No persisted delete for scene details — text stays in project until re-sync.
  };

  const handleVoiceoverClear = () => {
    if (staged.voiceoverFile) removeSlot('voiceover'); // just clear staged
    else onDeleteVoiceover();                          // delete persisted
  };

  const handleAssetsClear = () => {
    if (allStagedAssets.length > 0) clearAllStagedAssets(); // just clear staged
    else onDeleteAllAssets();                               // delete persisted
  };

  // ── Persisted-state labels ─────────────────────────────────────────────────
  const scriptPersisted = persistedScript.trim().length > 0 ? 'Loaded' : undefined;
  const scenePersisted = persistedSceneDetails.trim().length > 0 ? 'Loaded' : undefined;
  const voiceoverPersisted = persistedVoiceoverName || undefined;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full bg-[#080808]">

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 border-b border-[#1A1A1A]">
        {(['files', 'segments'] as const).map((tab) => (
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
              onFile={(f) => void addFiles([f], 'script')}
              onDropFiles={(files) => void addFiles(files, 'script')}
              onDelete={handleScriptClear}
              color="text-orange-400"
            />

            {/* Slot 2 — Scene Details */}
            <SlotRow
              icon={<FileText size={12} />}
              label="Scene Details"
              subtitle="File with [IMAGE:] or [VIDEO:] tags"
              accept=".txt,.rtf"
              stagedFile={staged.sceneFile}
              persistedLabel={scenePersisted}
              onFile={(f) => void addFiles([f], 'scene')}
              onDropFiles={(files) => void addFiles(files, 'scene')}
              onDelete={handleSceneClear}
              color="text-teal-400"
            />

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
            />

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
              <div className="flex items-center gap-3 px-4 pt-3 pb-1">
                <ImageIcon size={12} className="flex-shrink-0 text-purple-400" />
                <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-purple-400">
                  Images &amp; Videos
                </span>
                <button
                  onClick={() => addAssetsRef.current?.click()}
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
              <div className="flex items-center pl-10 pr-4 pb-2.5">
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
                {(allStagedAssets.length > 0 || persistedAssetCount > 0) && (
                  <button
                    onClick={handleAssetsClear}
                    aria-label={allStagedAssets.length > 0 ? 'Clear staged assets' : 'Delete all project assets'}
                    className="flex-shrink-0 ml-2 p-0.5 rounded hover:bg-red-900/40 text-red-500 transition-colors"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>

          </div>{/* end scrollable */}

          {/* Pinned bottom: Apply Sync + Settings */}
          <div className="flex-shrink-0 px-4 py-3 border-t border-[#1A1A1A] space-y-2">
            <button
              onClick={handleApplySync}
              disabled={!canApplySync}
              className="w-full py-3 rounded-xl bg-[#F27D26] text-black text-xs
                         font-black uppercase tracking-widest hover:bg-[#FF9D46]
                         transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Apply Sync
            </button>
            <button
              onClick={onOpenSettings}
              className="flex items-center justify-center gap-1.5 w-full py-1.5
                         text-[9px] uppercase tracking-widest text-gray-600
                         hover:text-gray-400 transition-colors"
            >
              <Settings size={10} />
              Settings
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
              onClick={onUnlockAll}
              aria-label="Unlock all segments"
              title="Unlock all segments"
              className="p-1.5 rounded-lg hover:bg-[#1A1A1A] text-amber-400 hover:text-amber-300
                         transition-colors"
            >
              <LockOpen size={14} />
            </button>
            <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-gray-600">
              {segments.length} Segments
            </span>
          </div>

          {/* Segment list */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 space-y-1">
            {segments.map((seg) => {
              const asset = assets.find(a => a.id === seg.assetId);
              const isSelected = seg.id === selectedSegmentId;
              const isMissing = !asset && !!(seg.text || seg.heading);
              return (
                <div
                  key={seg.id}
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
                    {asset?.url && asset.type === 'image'
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
                      {seg.heading || asset?.name || `Scene ${seg.order + 1}`}
                    </p>
                    <p className="text-[9px] text-gray-600 font-mono">
                      {formatTime(seg.startTime)} — {formatTime(seg.startTime + seg.duration)}
                    </p>
                  </div>
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

    </div>
  );
}
