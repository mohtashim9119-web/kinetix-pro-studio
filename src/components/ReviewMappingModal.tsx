/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { VideoSegment, Asset } from '../types';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ReviewMappingModalProps {
  segments: VideoSegment[];
  assets: Asset[];
  onClose: () => void;
  onUpdateSegment: (idx: number, updates: Partial<VideoSegment>) => void;
  onOpenStockSearch: (segmentId: string) => void;
}

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
        <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-6 space-y-3">
          {segments.length === 0 && (
            <p className="text-[11px] text-gray-700 italic px-1 py-2">
              No segments yet — apply sync to generate.
            </p>
          )}
          {segments.map((seg, i) => (
            <div
              key={seg.id}
              className="p-4 bg-[#0D0D0D] border border-[#1A1A1A] rounded-2xl text-[11px] text-gray-400"
            >
              Segment {i + 1}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
