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
  ChevronDown,
  ChevronRight,
  Upload,
  Trash2,
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
// Props
// ---------------------------------------------------------------------------

interface Props {
  segments: VideoSegment[];
  assets: Asset[];
  voiceoverId: string | undefined;
  // Current project state — drives "already synced" slot display + editors.
  script: string;
  persistedScript: string;
  persistedSceneDetails: string;
  persistedVoiceoverName: string;
  persistedAssetCount: number;
  // Text editing (collapsible sections)
  onScriptChange: (val: string) => void;
  onSceneDetailsChange: (val: string) => void;
  // Asset management
  onDeleteAsset: (assetId: string) => void;
  onDeleteAllAssets: () => void;
  onDeleteVoiceover: () => void;
  // File actions
  onApplySync: (staged: StagedFiles) => void;
  // Segment actions
  onSegmentClick: (segmentId: string) => void;
  onToggleLock: (segmentId: string) => void;
  onLockAll: () => void;
  onUnlockAll: () => void;
  allLocked: boolean;
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
  onScriptChange,
  onSceneDetailsChange,
  onDeleteAsset,
  onDeleteAllAssets,
  onDeleteVoiceover,
  onApplySync,
  onSegmentClick,
  onToggleLock,
  onLockAll,
  onUnlockAll,
  allLocked,
  selectedSegmentId,
  onOpenSettings,
}: Props) {
  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'files' | 'segments'>('files');

  // ── Collapsible section + top-zone drag state ──────────────────────────────
  const [expanded, setExpanded] = useState<ExpandKey>(null);
  const [dragOver, setDragOver] = useState(false);

  // ── Staged file state ─────────────────────────────────────────────────────
  const [staged, setStaged] = useState<StagedFiles>(EMPTY_STAGED);
  // Ref that mirrors staged synchronously — used by handleApplySync so that
  // React batching cannot cause it to read a stale pre-update value.
  const stagedRef = useRef<StagedFiles>(EMPTY_STAGED);
  const addAssetsRef = useRef<HTMLInputElement>(null);
  const topZoneInputRef = useRef<HTMLInputElement>(null);
  const [assetsDragOver, setAssetsDragOver] = useState(false);

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
        console.log('[addFiles] forceSlot:', forceSlot, 'file:', file.name, 'ext:', ext);
        textEntries.push({
          file,
          key,
          role: forceSlot === 'script' ? 'forced_script' : 'forced_scene',
        });
        continue;
      }

      if (ext === 'txt' || ext === 'rtf') {
        // Top drop-zone path: content detection picks script vs scene.
        const raw = await file.text();
        const stripped = stripRtfIfNeeded(raw);
        console.log('[strip test] bracket count after strip:', (stripped.match(/\[(IMAGE|VIDEO):/gi) ?? []).length, 'in file:', file.name);
        const role = detectTextFileRole(stripped);
        console.log('[addFiles] role detected:', role, 'for file:', file.name);
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
          console.log('[addFiles] staged.sceneFile set to:', tf.file.name);
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
    updateStaged(prev => ({ ...prev, [`${slot}File`]: null }));

  const clearAllStagedAssets = () =>
    updateStaged(prev => ({ ...prev, assetFiles: [], zipFiles: [] }));

  const handleApplySync = () => {
    onApplySync(stagedRef.current);
    // Do NOT reset staged — slots keep showing their files after sync.
    // User can clear individually with × buttons.
  };

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

  // ── Persisted-state labels + derived lookups ────────────────────────────────
  const scriptPersisted = persistedScript.trim().length > 0 ? 'Loaded' : undefined;
  const scenePersisted = persistedSceneDetails.trim().length > 0 ? 'Loaded' : undefined;
  const voiceoverPersisted = persistedVoiceoverName || undefined;

  const voiceoverAsset = assets.find(a => a.id === voiceoverId);
  const nonAudioAssets = assets.filter(a => a.type !== 'audio');

  const toggle = (key: Exclude<ExpandKey, null>) =>
    setExpanded(prev => (prev === key ? null : key));

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

            {/* Top drag-and-drop zone — accepts all types, auto-classifies */}
            <div className="px-4 pt-4">
              <div
                onClick={() => topZoneInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  console.log('[dropzone] files dropped:', Array.from(e.dataTransfer.files).map(f => f.name));
                  void addFiles(Array.from(e.dataTransfer.files));
                }}
                className={`cursor-pointer border-2 border-dashed rounded-lg p-4 text-center
                            text-xs text-gray-500 transition-colors mb-4
                            ${dragOver
                              ? 'border-orange-500 text-orange-400 bg-orange-500/5'
                              : 'border-gray-700 hover:border-gray-500'}`}
              >
                <Upload className="w-4 h-4 mx-auto mb-1 opacity-50" />
                DROP ALL FILES HERE, OR USE SLOTS BELOW
              </div>
              <input
                ref={topZoneInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    void addFiles(Array.from(e.target.files));
                    e.target.value = '';
                  }
                }}
              />
            </div>

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
              <textarea
                value={persistedScript}
                onChange={(e) => onScriptChange(e.target.value)}
                placeholder="Paste or type your script here..."
                className="w-full h-40 bg-transparent text-sm text-gray-300
                  resize-none border border-gray-700 rounded p-2
                  focus:outline-none focus:border-orange-500"
              />
            </SlotRow>

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
              <textarea
                value={persistedSceneDetails}
                onChange={(e) => onSceneDetailsChange(e.target.value)}
                placeholder="Paste scene details with [IMAGE:] or [VIDEO:] tags..."
                className="w-full h-40 bg-transparent text-sm text-gray-300
                  resize-none border border-gray-700 rounded p-2
                  focus:outline-none focus:border-teal-500"
              />
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

          {/* Pinned bottom: Apply Sync + Settings */}
          <div className="flex-shrink-0 px-4 py-3 border-t border-[#1A1A1A] space-y-2">
            <button
              onClick={handleApplySync}
              className="w-full py-3 rounded-xl bg-[#F27D26] text-black text-xs
                         font-black uppercase tracking-widest hover:bg-[#FF9D46]
                         transition-all"
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
