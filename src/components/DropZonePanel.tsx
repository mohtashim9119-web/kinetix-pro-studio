/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef } from 'react';
import {
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
  Trash2,
  ChevronDown,
  ChevronRight,
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
// SlotRow — single-file labelled slot with browse + × always visible when filled
// ---------------------------------------------------------------------------

interface SlotRowProps {
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  accept: string;
  stagedFile: StagedFile | null;
  onFile: (file: File) => void;
  onDropFiles: (files: File[]) => void;
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
      className={`rounded-xl border px-3 py-2 transition-colors
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
          {stagedFile ? (
            <p className="text-[10px] text-gray-300 truncate">{stagedFile.file.name}</p>
          ) : (
            <p className="text-[9px] text-gray-600">{subtitle}</p>
          )}
        </div>
        {stagedFile && (
          <button
            onClick={onDelete}
            aria-label={`Remove ${label} file`}
            className="flex-shrink-0 p-1 rounded hover:bg-red-900/40 text-red-500 transition-colors"
          >
            <X size={11} />
          </button>
        )}
        {/* Browse always visible */}
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
  onDeleteVoiceover: () => void;
  // File actions
  onApplySync: (staged: StagedFiles) => void;
  onDropFiles: (files: File[]) => void;
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
  onDeleteVoiceover,
  onApplySync,
  onDropFiles,
  onReSync,
  onSegmentClick,
  onToggleLock,
  onUnlockAll,
  selectedSegmentId,
  onOpenSettings,
}: Props) {
  // ── Staged file state (always active) ────────────────────────────────────
  const [staged, setStaged] = useState<StagedFiles>(EMPTY_STAGED);
  const addAssetsRef = useRef<HTMLInputElement>(null);

  // Kept for any external logic that still toggles it; slots no longer need it
  // to determine visibility — they are always rendered.
  const [showUploadView, setShowUploadView] = useState(false);
  void showUploadView; // intentionally unused after redesign

  // ── Post-sync expandable sections ────────────────────────────────────────
  const [showAssets, setShowAssets] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [showScene, setShowScene] = useState(false);
  const addFilesRef = useRef<HTMLInputElement>(null);

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
    setShowUploadView(false);
  };

  // Apply Sync is enabled when sceneFile is staged AND either scriptFile is
  // staged or an existing script is already loaded.
  const canApplySync =
    !!staged.sceneFile && (!!staged.scriptFile || script.trim().length > 0);

  const allStagedAssets = [...staged.assetFiles, ...staged.zipFiles];

  return (
    <div className="flex flex-col h-full">

      {/* ── Scrollable body ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">

        {/* ── 4 upload slots (always visible) ── */}
        <div className="p-3 space-y-1.5">

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
            onDelete={() => {
              removeSlot('voiceover');
              onDeleteVoiceover();
            }}
            color="text-[#F27D26]"
          />

          {/* Images & Videos slot */}
          <div
            className="rounded-xl border border-[#1A1A1A] bg-[#0A0A0A] px-3 py-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void addFiles(Array.from(e.dataTransfer.files)); }}
          >
            <div className="flex items-center gap-2">
              <ImageIcon size={12} className="text-purple-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400">
                  Images &amp; Videos
                </span>
                {allStagedAssets.length > 0 ? (
                  <p className="text-[10px] text-gray-300">
                    {allStagedAssets.length} file{allStagedAssets.length !== 1 ? 's' : ''}
                  </p>
                ) : (
                  <p className="text-[9px] text-gray-600">Images, videos, or ZIP archive</p>
                )}
              </div>
              {allStagedAssets.length > 0 && (
                <button
                  onClick={() => { clearAllStagedAssets(); onDeleteAllAssets(); }}
                  aria-label="Clear all staged assets"
                  className="flex-shrink-0 p-1 rounded hover:bg-red-900/40 text-red-500 transition-colors"
                >
                  <X size={11} />
                </button>
              )}
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
                onChange={(e) => { void addFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
              />
            </div>
          </div>
        </div>

        {/* ── Post-sync content ── */}
        {isSynced && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-[#1A1A1A]">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                {segments.length} Segments
              </span>
              <div className="flex items-center gap-3">
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

            {/* Segment list */}
            <div className="px-3 pb-2 space-y-1">
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
                  className="flex-1 flex items-center gap-2 px-4 py-2.5 hover:bg-[#0F0F0F] transition-colors"
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
                    className="px-3 py-2.5 text-[9px] uppercase tracking-widest text-red-700
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
                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[#0F0F0F] transition-colors"
              >
                {showScript
                  ? <ChevronDown size={12} className="text-gray-500" />
                  : <ChevronRight size={12} className="text-gray-500" />
                }
                <FileText size={12} className="text-blue-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Script</span>
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
                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[#0F0F0F] transition-colors"
              >
                {showScene
                  ? <ChevronDown size={12} className="text-gray-500" />
                  : <ChevronRight size={12} className="text-gray-500" />
                }
                <FileCode size={12} className="text-cyan-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Scene Details</span>
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

            {/* Footer: add files + settings */}
            <div className="px-4 py-3 border-t border-[#1A1A1A] flex items-center justify-between">
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
          </>
        )}

        {/* Settings link when not yet synced */}
        {!isSynced && (
          <div className="px-4 pb-3">
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-2 text-[10px] uppercase tracking-widest
                         text-gray-600 hover:text-white transition-colors"
            >
              <Settings size={12} /> Settings
            </button>
          </div>
        )}
      </div>

      {/* ── Apply Sync — always pinned at bottom ───────────────────────────── */}
      <div className="px-3 py-3 border-t border-[#1A1A1A] flex-shrink-0">
        <button
          onClick={handleApplySync}
          disabled={!canApplySync}
          className="w-full py-3 rounded-xl bg-[#F27D26] text-black text-xs
                     font-black uppercase tracking-widest hover:bg-[#FF9D46]
                     transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Apply Sync
        </button>
      </div>
    </div>
  );
}
