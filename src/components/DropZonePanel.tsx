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
  Music,
  Image as ImageIcon,
  Video,
  AlertCircle,
  Archive,
} from 'lucide-react';
import { VideoSegment, Asset } from '../types';

interface FileSummary {
  sceneDoc: string | null;
  voiceover: string | null;
  assetCount: number;
  zipCount: number;
  unmatchedCount: number;
  canSync: boolean;
  rawFiles: File[];
}

interface Props {
  isSynced: boolean;
  segments: VideoSegment[];
  assets: Asset[];
  voiceoverId: string | undefined;
  onDropFiles: (files: File[]) => void;
  onApplySync: () => void;
  onReSync: () => void;
  onSegmentClick: (segmentId: string) => void;
  onToggleLock: (segmentId: string) => void;
  onUnlockAll: () => void;
  onAddFiles: () => void;
  selectedSegmentId: string | undefined;
  onOpenSettings: () => void;
}

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export function DropZonePanel({
  isSynced,
  segments,
  assets,
  onDropFiles,
  onApplySync,
  onReSync,
  onSegmentClick,
  onToggleLock,
  onUnlockAll,
  selectedSegmentId,
  onOpenSettings,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFilesRef = useRef<HTMLInputElement>(null);
  const [fileSummary, setFileSummary] = useState<FileSummary | null>(null);

  const computeSummary = (files: File[]): FileSummary => {
    let sceneDoc: string | null = null;
    let voiceover: string | null = null;
    let assetCount = 0;
    let zipCount = 0;

    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (ext === 'txt') {
        sceneDoc = file.name;
      } else if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) {
        voiceover = file.name;
      } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm', 'm4v'].includes(ext)) {
        assetCount++;
      } else if (ext === 'zip') {
        zipCount++;
      }
    }

    return {
      sceneDoc,
      voiceover,
      assetCount,
      zipCount,
      unmatchedCount: 0,
      canSync: !!(sceneDoc || voiceover || assetCount > 0 || zipCount > 0),
      rawFiles: files,
    };
  };

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return;
    setFileSummary(computeSummary(files));
  };

  const handleApplySync = () => {
    if (!fileSummary) return;
    onDropFiles(fileSummary.rawFiles);
    onApplySync();
    setFileSummary(null);
  };

  // ── Pre-sync state: unified drop zone ──────────────────────────────────────
  if (!isSynced) {
    return (
      <div className="flex flex-col h-full p-6 gap-6">
        <div
          className="flex-1 border-2 border-dashed border-[#1A1A1A] rounded-3xl
                      flex flex-col items-center justify-center gap-4 p-8
                      hover:border-[#F27D26]/50 transition-all cursor-pointer
                      bg-[#050505]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(Array.from(e.dataTransfer.files));
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="w-16 h-16 rounded-2xl bg-[#0A0A0A] border border-[#1A1A1A]
                          flex items-center justify-center">
            <Upload size={24} className="text-[#F27D26]" />
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-white mb-1">Drop your files here</p>
            <p className="text-[10px] text-gray-600 uppercase tracking-widest">
              Scene doc · Voiceover · Images · Videos
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(Array.from(e.target.files || []))}
          />
        </div>

        {fileSummary && (
          <div className="bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl p-4 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-3">
              Files Ready
            </p>
            {fileSummary.sceneDoc && (
              <div className="flex items-center gap-2 text-xs">
                <FileText size={12} className="text-blue-400" />
                <span className="text-gray-300 truncate flex-1">{fileSummary.sceneDoc}</span>
                <span className="text-green-500 ml-auto">✓</span>
              </div>
            )}
            {fileSummary.voiceover && (
              <div className="flex items-center gap-2 text-xs">
                <Music size={12} className="text-[#F27D26]" />
                <span className="text-gray-300 truncate flex-1">{fileSummary.voiceover}</span>
                <span className="text-green-500 ml-auto">✓</span>
              </div>
            )}
            {fileSummary.assetCount > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <ImageIcon size={12} className="text-purple-400" />
                <span className="text-gray-300">{fileSummary.assetCount} assets</span>
                {fileSummary.unmatchedCount > 0
                  ? <span className="text-yellow-500 ml-auto">⚠ {fileSummary.unmatchedCount} unmatched</span>
                  : <span className="text-green-500 ml-auto">✓ all matched</span>
                }
              </div>
            )}
            {fileSummary.zipCount > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <Archive size={12} className="text-indigo-400" />
                <span className="text-gray-300 truncate flex-1">
                  {fileSummary.zipCount} zip {fileSummary.zipCount === 1 ? 'archive' : 'archives'}
                </span>
                <span className="text-green-500 ml-auto">✓</span>
              </div>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); handleApplySync(); }}
              disabled={!fileSummary.canSync}
              className="w-full mt-3 py-3 rounded-xl bg-[#F27D26] text-black text-xs
                         font-black uppercase tracking-widest hover:bg-[#FF9D46]
                         transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Apply Sync
            </button>
          </div>
        )}

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

  // ── Post-sync state: segment mapping list ──────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A1A1A]">
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

      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
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

      <div className="px-6 py-4 border-t border-[#1A1A1A] flex items-center justify-between">
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
            if (files.length > 0) onDropFiles(files);
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
