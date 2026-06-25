/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { X, Video, AlertCircle, Heading1, Search } from 'lucide-react';
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
        className="w-[80vw] h-[85vh] max-w-6xl bg-[#0D0D0D] border border-[#1A1A1A] rounded-[32px] shadow-2xl flex flex-col overflow-hidden"
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
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
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
// ReviewMappingRow — one segment's mapping review card: large thumbnail on
// the left, label/time + asset picker + stock search on the right. Heading
// segments only render the left thumbnail + a centered label/time block —
// they carry no embedded audio and no per-segment assetId to reassign.
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
  const meta = `${seg.duration.toFixed(1)}s · ${formatTime(seg.startTime)} — ${formatTime(seg.startTime + seg.duration)}`;

  return (
    <div className="flex rounded-xl border border-[#2A2A2A] bg-[#1A1A1A] overflow-hidden">
      {/* Left — fixed-width column; thumbnail inside is a 16:9 box, not full-height */}
      <div className="w-56 flex-shrink-0">
        <div className="w-full aspect-video overflow-hidden rounded-tl-xl rounded-bl-xl bg-[#0D0D0D] flex items-center justify-center">
          {seg.isHeading
            ? <Heading1 size={40} className="text-[#F27D26]/70" />
            : asset?.url && asset.type === 'image'
            ? <img src={asset.url} className="w-full h-full object-cover" alt="" />
            : asset?.type === 'video'
            ? <Video size={40} className="text-blue-400" />
            : isMissing
            ? <AlertCircle size={40} className="text-yellow-500" />
            : <div className="w-full h-full bg-[#0D0D0D]" />
          }
        </div>
      </div>

      {/* Right — label/time + asset picker + stock search, equally spaced */}
      <div className={`flex-1 flex flex-col gap-3 p-4 ${seg.isHeading ? 'justify-center' : ''}`}>
        <div>
          <p className="text-[13px] font-bold text-white truncate">{label}</p>
          <p className="text-sm text-white/80 mt-1">{meta}</p>
        </div>

        {!seg.isHeading && (
          <>
            <select
              value={seg.assetId ?? ''}
              onChange={(e) => onUpdateSegment(idx, { assetId: e.target.value })}
              className="w-full bg-[#2A2A2A] border border-[#3A3A3A] text-white rounded-lg py-2.5 px-3 text-sm font-medium outline-none focus:border-[#F27D26] cursor-pointer"
            >
              <option value="">No Asset</option>
              {assets.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <button
              onClick={() => onOpenStockSearch(seg.id)}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-[#3A3A3A] text-white/70 hover:text-white hover:border-white/50 rounded-lg text-sm font-bold uppercase tracking-widest transition-colors"
            >
              <Search size={13} /> Search Stock Footage
            </button>
          </>
        )}
      </div>
    </div>
  );
}
