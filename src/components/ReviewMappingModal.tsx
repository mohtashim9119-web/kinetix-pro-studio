/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { X, Video, AlertCircle, Heading1, Music, Search } from 'lucide-react';
import { VideoSegment, Asset } from '../types';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ReviewMappingModalProps {
  segments: VideoSegment[];
  assets: Asset[];
  onClose: () => void;
  onUpdateSegment: (idx: number, updates: Partial<VideoSegment>) => void;
  onOpenStockSearch: (segmentId: string) => void;
}

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export function ReviewMappingModal({
  segments,
  assets,
  onClose,
  onUpdateSegment,
  onOpenStockSearch,
}: ReviewMappingModalProps) {
  const trapRef = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const nonAudioAssets = assets.filter(a => a.type !== 'audio');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Review Mapping"
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        onClick={(e) => e.stopPropagation()}
        className="w-[80vw] h-[85vh] max-w-6xl bg-[#0A0A0A] border border-[#1A1A1A] rounded-[32px] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-[#1A1A1A] flex-shrink-0">
          <h2 className="text-lg font-black uppercase tracking-widest text-white">Review Mapping</h2>
          <button
            onClick={onClose}
            aria-label="Close review mapping"
            className="p-2 hover:bg-[#1A1A1A] rounded-xl transition-colors text-gray-500 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-8">
          {segments.length === 0 && (
            <p className="text-[11px] text-gray-700 italic px-1 py-6">
              No segments yet — apply sync to generate.
            </p>
          )}
          {segments.map((seg, i) => (
            <ReviewMappingRow
              key={seg.id}
              segment={seg}
              index={i}
              assets={nonAudioAssets}
              onUpdateSegment={onUpdateSegment}
              onOpenStockSearch={onOpenStockSearch}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewMappingRow — one segment's full mapping review: thumbnail, asset
// picker bar, stock search trigger, time range, and mute toggle. Heading
// segments hide the asset bar / stock / mute controls — they carry no
// embedded audio and their visual is the optional headingConfig.assetId,
// not the per-segment assetId this row edits.
// ---------------------------------------------------------------------------

interface ReviewMappingRowProps {
  segment: VideoSegment;
  index: number;
  assets: Asset[];
  onUpdateSegment: (idx: number, updates: Partial<VideoSegment>) => void;
  onOpenStockSearch: (segmentId: string) => void;
}

function ReviewMappingRow({ segment: seg, index: idx, assets, onUpdateSegment, onOpenStockSearch }: ReviewMappingRowProps) {
  const asset = assets.find(a => a.id === seg.assetId);
  const isMissing = !asset && !!(seg.text || seg.heading || seg.isHeading);
  const label = seg.headingConfig?.text || seg.heading || asset?.name || `Scene ${idx + 1}`;

  return (
    <div className="py-5 border-b border-[#1A1A1A] last:border-b-0">
      {/* Header line — label + time range + total duration */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-[12px] font-bold text-white truncate">{label}</p>
        <p className="text-[10px] text-gray-500 font-mono whitespace-nowrap">
          {formatTime(seg.startTime)} – {formatTime(seg.startTime + seg.duration)}
          <span className="text-gray-700 ml-2">({seg.duration.toFixed(1)}s)</span>
        </p>
      </div>

      {/* Thumbnail + asset bar */}
      <div className="flex items-start gap-4">
        <div className="w-20 h-14 flex-shrink-0 rounded-lg overflow-hidden bg-[#1A1A1A] flex items-center justify-center">
          {seg.isHeading
            ? <Heading1 size={20} className="text-[#F27D26]/70" />
            : asset?.url && asset.type === 'image'
            ? <img src={asset.url} className="w-full h-full object-cover" alt="" />
            : asset?.type === 'video'
            ? <Video size={20} className="text-blue-400" />
            : isMissing
            ? <AlertCircle size={20} className="text-yellow-500" />
            : <div className="w-full h-full bg-[#1A1A1A]" />
          }
        </div>

        {!seg.isHeading && (
          <div className="flex-1 min-w-0 flex gap-2 overflow-x-auto custom-scrollbar pb-1">
            {assets.length === 0 && (
              <p className="text-[10px] text-gray-700 italic px-1 self-center">No assets uploaded.</p>
            )}
            {assets.map(a => {
              const isAssigned = a.id === seg.assetId;
              return (
                <button
                  key={a.id}
                  onClick={() => onUpdateSegment(idx, { assetId: a.id })}
                  title={a.name}
                  aria-label={`Assign ${a.name}`}
                  className={`w-14 h-10 flex-shrink-0 rounded-md overflow-hidden bg-[#1A1A1A] flex items-center justify-center transition-all ${
                    isAssigned ? 'ring-2 ring-[#F27D26]' : 'border border-[#282828] hover:border-gray-500'
                  }`}
                >
                  {a.type === 'image'
                    ? <img src={a.url} className="w-full h-full object-cover" alt="" />
                    : <Video size={14} className="text-blue-400" />
                  }
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom row — stock search + mute toggle */}
      {!seg.isHeading && (
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => onOpenStockSearch(seg.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-blue-500 hover:text-white transition-all"
          >
            <Search size={11} /> Search Stock
          </button>
          <button
            onClick={() => onUpdateSegment(idx, { isMuted: !seg.isMuted })}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] uppercase font-black tracking-widest transition-all ${
              seg.isMuted
                ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                : 'bg-green-500/10 text-green-400 border border-green-500/20'
            }`}
          >
            <Music size={11} className={seg.isMuted ? 'opacity-40' : ''} />
            {seg.isMuted ? 'Muted' : 'Audio On'}
          </button>
        </div>
      )}
    </div>
  );
}
