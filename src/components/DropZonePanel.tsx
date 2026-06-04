/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef } from 'react';
import {
  Upload,
  Settings,
  RefreshCw,
  Lock,
  Unlock,
  Plus,
  FileText,
  FileCode,
  Music,
  Image as ImageIcon,
  Video,
  AlertCircle,
  Archive,
  Trash2,
  ChevronDown,
  ChevronRight,
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

function hasStagedFiles(s: StagedFiles): boolean {
  return !!(
    s.scriptFile ||
    s.sceneFile ||
    s.voiceoverFile ||
    s.assetFiles.length > 0 ||
    s.zipFiles.length > 0
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

// A single labelled file-slot row used in pre-sync view.
// Supports both browse-click and drag-and-drop directly onto the slot.
interface SlotRowProps {
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  accept: string;
  stagedFile: StagedFile | null;
  onFile: (file: File) => void;        // from browse input
  onDropFiles: (files: File[]) => void; // from drag-and-drop onto slot
  onDelete: () => void;
  color?: string;
}
function SlotRow({
  icon,
  label,
  subtitle,
  accept,
  stagedFile,
  onFile,
  onDropFiles,
  onDelete,
  color = 'text-gray-500',
}: SlotRowProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      className={`flex flex-col gap-1 rounded-xl border px-3 py-2 transition-colors
                  ${isDragOver ? 'border-[#F27D26]/60 bg-[#F27D26]/5' : 'border-[#1A1A1A] bg-[#0A0A0A]'}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        onDropFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex items-center gap-2">
        <span className={`flex-shrink-0 ${color}`}>{icon}</span>
        <div className="flex-1 min-w-0">
          <span className={`text-[10px] font-bold uppercase tracking-widest ${color}`}>{label}</span>
          {!stagedFile && (
            <p className="text-[9px] text-gray-600">{subtitle}</p>
          )}
        </div>
        {stagedFile ? (
          <>
            <span className="text-[10px] text-gray-300 truncate max-w-[120px]">{stagedFile.file.name}</span>
            <button
              onClick={onDelete}
              aria-label={`Remove ${label} file`}
              className="flex-shrink-0 p-1 rounded hover:bg-red-900/40 text-red-500 transition-colors"
            >
              <Trash2 size={11} />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => ref.current?.click()}
              className="flex-shrink-0 text-[9px] uppercase tracking-widest text-gray-600
                         hover:text-white border border-[#2A2A2A] rounded px-2 py-0.5 transition-colors"
            >
              Browse
            </button>
            <input
              ref={ref}
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { onFile(f); e.target.value = ''; }
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  isSynced: boolean;
  segments: VideoSegment[];
  assets: Asset[];
  voiceoverId: string | undefined;
  // Text content (for editing after sync)
  script: string;
  sceneDetails: string;
  onScriptChange: (text: string) => void;
  onSceneDetailsChange: (text: string) => void;
  // Asset management
  onDeleteAsset: (assetId: string) => void;
  onDeleteAllAssets: () => void;
  // File actions
  onApplySync: (staged: StagedFiles) => void; // atomic: files + sync
  onDropFiles: (files: File[]) => void;        // post-sync add-more
  onReSync: () => void;
  // Segment actions
  onSegmentClick: (segmentId: string) => void;
  onToggleLock: (segmentId: string) => void;
  onUnlockAll: () => void;
  // Misc
  onAddFiles?: () => void; // kept for compat, unused
  selectedSegmentId: string | undefined;
  onOpenSettings: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DropZonePanel({
  isSynced,
  segments,
  assets,
  voiceoverId,
  script,
  sceneDetails,
  onScriptChange,
  onSceneDetailsChange,
  onDeleteAsset,
  onDeleteAllAssets,
  onApplySync,
  onDropFiles,
  onReSync,
  onSegmentClick,
  onToggleLock,
  onUnlockAll,
  selectedSegmentId,
  onOpenSettings,
}: Props) {
  // ── Pre-sync: staged file state ──────────────────────────────────────────
  const [staged, setStaged] = useState<StagedFiles>(EMPTY_STAGED);
  const dropZoneRef = useRef<HTMLInputElement>(null);
  const addAssetsRef = useRef<HTMLInputElement>(null);

  /**
   * Adds files to staged state with content-based text classification.
   * For .txt/.rtf files, reads content and strips RTF before deciding
   * whether the file belongs in the Script slot or Scene Details slot.
   *
   * forceSlot: when the user drags directly onto a specific labelled slot,
   * skip content detection and assign to that slot unconditionally.
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

    // Apply changes to staged state using functional updater so concurrent
    // calls from other event sources don't lose each other's updates.
    setStaged(prev => {
      let { scriptFile, sceneFile, voiceoverFile } = prev;
      const assetFiles = [...prev.assetFiles];
      const zipFiles = [...prev.zipFiles];

      // Voiceover: last wins (smart replace)
      for (const v of voiceoverEntries) {
        voiceoverFile = { file: v.file, key: v.key };
      }

      // Assets/zips: accumulate
      for (const a of assetEntries) assetFiles.push({ file: a.file, key: a.key });
      for (const z of zipEntries) zipFiles.push({ file: z.file, key: z.key });

      // Text files: forced assignments first, then content-detected.
      // For content-detected: sceneDetails → sceneFile, script → scriptFile.
      // When multiple files compete for the same slot, the second one fills
      // the other slot (fallback). Always smart-replace existing files.
      let pendingScript: TextEntry | null = null;
      let pendingScene: TextEntry | null = null;

      for (const tf of textEntries) {
        if (tf.role === 'forced_script') {
          scriptFile = { file: tf.file, key: tf.key };
        } else if (tf.role === 'forced_scene') {
          sceneFile = { file: tf.file, key: tf.key };
        } else if (tf.role === 'sceneDetails') {
          if (!pendingScene) pendingScene = tf;
          else if (!pendingScript) pendingScript = tf; // overflow → script
        } else {
          // 'script'
          if (!pendingScript) pendingScript = tf;
          else if (!pendingScene) pendingScene = tf; // overflow → scene
        }
      }

      // Smart replace: always assign even if slot already had a file
      if (pendingScript) scriptFile = { file: pendingScript.file, key: pendingScript.key };
      if (pendingScene) sceneFile = { file: pendingScene.file, key: pendingScene.key };

      return { scriptFile, sceneFile, voiceoverFile, assetFiles, zipFiles };
    });
  };

  const removeSlot = (slot: 'script' | 'scene' | 'voiceover') =>
    setStaged(prev => ({ ...prev, [`${slot}File`]: null }));

  const removeStagedAsset = (key: string) =>
    setStaged(prev => ({
      ...prev,
      assetFiles: prev.assetFiles.filter(f => f.key !== key),
      zipFiles: prev.zipFiles.filter(f => f.key !== key),
    }));

  const handleApplySync = () => {
    onApplySync(staged);
    setStaged(EMPTY_STAGED);
  };

  // ── Post-sync: expandable section state ──────────────────────────────────
  const [showAssets, setShowAssets] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [showScene, setShowScene] = useState(false);
  const addFilesRef = useRef<HTMLInputElement>(null);

  // ── PRE-SYNC VIEW ─────────────────────────────────────────────────────────
  if (!isSynced) {
    const allStagedAssets = [...staged.assetFiles, ...staged.zipFiles];
    return (
      <div className="flex flex-col h-full p-4 gap-3 overflow-y-auto custom-scrollbar">
        {/* Drop zone */}
        <div
          className="border-2 border-dashed border-[#1A1A1A] rounded-2xl p-6
                     flex flex-col items-center justify-center gap-2
                     hover:border-[#F27D26]/50 transition-all cursor-pointer bg-[#050505]
                     min-h-[90px]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void addFiles(Array.from(e.dataTransfer.files)); }}
          onClick={() => dropZoneRef.current?.click()}
        >
          <Upload size={20} className="text-[#F27D26]" />
          <p className="text-[10px] text-gray-600 uppercase tracking-widest text-center">
            Drop all files here, or use slots below
          </p>
          <input
            ref={dropZoneRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { void addFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
          />
        </div>

        {/* File slots */}
        <div className="space-y-1.5">
          {/* Script slot */}
          <SlotRow
            icon={<FileText size={12} />}
            label="Script"
            subtitle="Plain text voiceover script"
            accept=".txt,.rtf"
            stagedFile={staged.scriptFile}
            onFile={(f) => void addFiles([f], 'script')}
            onDropFiles={(files) => void addFiles(files, 'script')}
            onDelete={() => removeSlot('script')}
            color="text-blue-400"
          />
          {/* Scene Details slot */}
          <SlotRow
            icon={<FileCode size={12} />}
            label="Scene Details"
            subtitle="File with [IMAGE:] tags"
            accept=".txt,.rtf"
            stagedFile={staged.sceneFile}
            onFile={(f) => void addFiles([f], 'scene')}
            onDropFiles={(files) => void addFiles(files, 'scene')}
            onDelete={() => removeSlot('scene')}
            color="text-cyan-400"
          />
          {/* Voiceover slot */}
          <SlotRow
            icon={<Music size={12} />}
            label="Voiceover"
            subtitle="MP3, WAV, M4A, or OGG"
            accept="audio/*"
            stagedFile={staged.voiceoverFile}
            onFile={(f) => void addFiles([f])}
            onDropFiles={(files) => void addFiles(files)}
            onDelete={() => removeSlot('voiceover')}
            color="text-[#F27D26]"
          />

          {/* Assets slot */}
          <div className="rounded-xl border border-[#1A1A1A] bg-[#0A0A0A] px-3 py-2 space-y-1">
            <div className="flex items-center gap-2">
              <ImageIcon size={12} className="text-purple-400 flex-shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400 w-24 flex-shrink-0">Assets</span>
              <button
                onClick={() => addAssetsRef.current?.click()}
                className="ml-auto text-[9px] uppercase tracking-widest text-gray-600 hover:text-white border border-[#2A2A2A] rounded px-2 py-0.5 transition-colors"
              >
                + Add
              </button>
              <input
                ref={addAssetsRef}
                type="file"
                multiple
                accept="image/*,video/*,.zip"
                className="hidden"
                onChange={(e) => { void addFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
              />
            </div>
            {allStagedAssets.length === 0 && (
              <p className="text-[10px] text-gray-600 italic pl-1">No files</p>
            )}
            {allStagedAssets.map((sf) => {
              const ext = sf.file.name.split('.').pop()?.toLowerCase() ?? '';
              const isZip = ext === 'zip';
              const isVideo = ['mp4', 'mov', 'webm', 'm4v'].includes(ext);
              return (
                <div key={sf.key} className="flex items-center gap-2">
                  {isZip
                    ? <Archive size={10} className="text-indigo-400 flex-shrink-0" />
                    : isVideo
                    ? <Video size={10} className="text-blue-400 flex-shrink-0" />
                    : <ImageIcon size={10} className="text-purple-400 flex-shrink-0" />
                  }
                  <span className="flex-1 text-[10px] text-gray-300 truncate">{sf.file.name}</span>
                  <button
                    onClick={() => removeStagedAsset(sf.key)}
                    aria-label={`Remove ${sf.file.name}`}
                    className="flex-shrink-0 p-0.5 rounded hover:bg-red-900/40 text-red-500 transition-colors"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Apply Sync */}
        <button
          onClick={handleApplySync}
          disabled={!hasStagedFiles(staged)}
          className="w-full py-3 rounded-xl bg-[#F27D26] text-black text-xs
                     font-black uppercase tracking-widest hover:bg-[#FF9D46]
                     transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Apply Sync
        </button>

        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 text-[10px] uppercase tracking-widest
                     text-gray-600 hover:text-white transition-colors"
        >
          <Settings size={12} /> Settings
        </button>
      </div>
    );
  }

  // ── POST-SYNC VIEW ────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A1A1A] flex-shrink-0">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          {segments.length} Segments
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onUnlockAll}
            className="text-[9px] uppercase tracking-widest text-gray-600 hover:text-white transition-colors"
          >
            Unlock All
          </button>
          <button
            onClick={onReSync}
            className="flex items-center gap-1 text-[9px] uppercase tracking-widest
                       text-[#F27D26] hover:text-white transition-colors font-bold"
          >
            <RefreshCw size={10} /> Re-sync
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Segment list */}
        <div className="px-4 py-2 space-y-1">
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
        </div>

        {/* ── Assets section ── */}
        <div className="border-t border-[#1A1A1A]">
          <div className="flex items-center">
            <button
              onClick={() => setShowAssets(p => !p)}
              className="flex-1 flex items-center gap-2 px-5 py-3 hover:bg-[#0F0F0F] transition-colors"
            >
              {showAssets
                ? <ChevronDown size={12} className="text-gray-500" />
                : <ChevronRight size={12} className="text-gray-500" />
              }
              <ImageIcon size={12} className="text-purple-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Assets
              </span>
              <span className="text-[9px] text-gray-600 ml-1">({assets.length})</span>
            </button>
            {assets.length > 0 && (
              <button
                onClick={onDeleteAllAssets}
                title="Delete all assets"
                className="px-3 py-3 text-[9px] uppercase tracking-widest text-red-700
                           hover:text-red-400 transition-colors flex-shrink-0"
              >
                Delete All
              </button>
            )}
          </div>
          {showAssets && (
            <div className="px-4 pb-3 space-y-1">
              {assets.length === 0 && (
                <p className="text-[10px] text-gray-600 italic px-1">No assets loaded</p>
              )}
              {assets.map((asset) => (
                <div key={asset.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#0F0F0F]">
                  {asset.type === 'audio'
                    ? <Music size={11} className="text-[#F27D26] flex-shrink-0" />
                    : asset.type === 'video'
                    ? <Video size={11} className="text-blue-400 flex-shrink-0" />
                    : <ImageIcon size={11} className="text-purple-400 flex-shrink-0" />
                  }
                  <span className="flex-1 text-[10px] text-gray-300 truncate">{asset.name}</span>
                  {asset.id === voiceoverId && (
                    <span className="text-[8px] uppercase text-[#F27D26] font-bold">VO</span>
                  )}
                  <button
                    onClick={() => onDeleteAsset(asset.id)}
                    aria-label={`Delete ${asset.name}`}
                    className="flex-shrink-0 p-1 rounded hover:bg-red-900/40 text-red-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Script editor ── */}
        <div className="border-t border-[#1A1A1A]">
          <button
            onClick={() => setShowScript(p => !p)}
            className="w-full flex items-center gap-2 px-5 py-3 hover:bg-[#0F0F0F] transition-colors"
          >
            {showScript
              ? <ChevronDown size={12} className="text-gray-500" />
              : <ChevronRight size={12} className="text-gray-500" />
            }
            <FileText size={12} className="text-blue-400" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              Script
            </span>
          </button>
          {showScript && (
            <div className="px-4 pb-3">
              <textarea
                value={script}
                onChange={(e) => onScriptChange(e.target.value)}
                className="w-full h-28 bg-[#050505] border border-[#1A1A1A] rounded-xl p-3
                           text-[11px] leading-relaxed outline-none focus:border-blue-500/40
                           transition-all resize-none font-mono text-gray-300"
                placeholder="Voiceover script…"
              />
            </div>
          )}
        </div>

        {/* ── Scene Details editor ── */}
        <div className="border-t border-[#1A1A1A]">
          <button
            onClick={() => setShowScene(p => !p)}
            className="w-full flex items-center gap-2 px-5 py-3 hover:bg-[#0F0F0F] transition-colors"
          >
            {showScene
              ? <ChevronDown size={12} className="text-gray-500" />
              : <ChevronRight size={12} className="text-gray-500" />
            }
            <FileCode size={12} className="text-cyan-400" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              Scene Details
            </span>
          </button>
          {showScene && (
            <div className="px-4 pb-3">
              <textarea
                value={sceneDetails}
                onChange={(e) => onSceneDetailsChange(e.target.value)}
                className="w-full h-28 bg-[#050505] border border-[#1A1A1A] rounded-xl p-3
                           text-[11px] leading-relaxed outline-none focus:border-cyan-500/40
                           transition-all resize-none font-mono text-gray-300"
                placeholder="[IMAGE: hero.jpg]&#10;[HEADING: Intro]&#10;…"
              />
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-[#1A1A1A] flex items-center justify-between flex-shrink-0">
        <button
          onClick={() => addFilesRef.current?.click()}
          className="text-[9px] uppercase tracking-widest text-gray-600
                     hover:text-white transition-colors flex items-center gap-1"
        >
          <Plus size={10} /> Add Files
        </button>
        <input
          ref={addFilesRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) { onDropFiles(files); e.target.value = ''; }
          }}
        />
        <button
          onClick={onOpenSettings}
          className="text-[9px] uppercase tracking-widest text-gray-600
                     hover:text-white transition-colors flex items-center gap-1"
        >
          <Settings size={10} /> Settings
        </button>
      </div>
    </div>
  );
}
