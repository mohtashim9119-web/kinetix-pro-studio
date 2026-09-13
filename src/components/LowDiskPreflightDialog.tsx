/**
 * Low-disk preflight — presentation only.
 *
 * Takes required / available / reclaimable bytes and a caller-owned
 * `showReclaimAction` flag. Does not add, subtract, or compare those
 * numbers to decide whether reclaim would make the export fit.
 */

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { formatBytes } from '../services/webcodecsExport/diskFull';

export interface LowDiskPreflightDialogProps {
  requiredBytes: number;
  availableBytes: number;
  reclaimableBytes: number;
  /**
   * Caller-owned. When false the Reclaim control is absent even if the
   * three byte figures would arithmetically fit. This component does not
   * compute `available + reclaimable >= required`.
   */
  showReclaimAction: boolean;
  onReclaim?: () => void;
  onDismiss: () => void;
}

export function LowDiskPreflightDialog({
  requiredBytes,
  availableBytes,
  reclaimableBytes,
  showReclaimAction,
  onReclaim,
  onDismiss,
}: LowDiskPreflightDialogProps): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Not enough disk space"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        ref={trapRef}
        className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-md shadow-2xl"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-black uppercase tracking-[0.2em]">Not enough space</h2>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            className="text-gray-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#F27D26] rounded"
          >
            <X size={18} />
          </button>
        </div>

        <dl className="space-y-2 mb-6">
          <div className="flex items-center justify-between">
            <dt className="text-[8px] uppercase tracking-widest text-gray-600">Required</dt>
            <dd data-testid="low-disk-required" className="text-[11px] font-bold text-gray-200">
              {formatBytes(requiredBytes)}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-[8px] uppercase tracking-widest text-gray-600">Available</dt>
            <dd data-testid="low-disk-available" className="text-[11px] font-bold text-gray-200">
              {formatBytes(availableBytes)}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-[8px] uppercase tracking-widest text-gray-600">Reclaimable</dt>
            <dd data-testid="low-disk-reclaimable" className="text-[11px] font-bold text-gray-200">
              {formatBytes(reclaimableBytes)}
            </dd>
          </div>
        </dl>

        <div className="flex gap-3">
          <button
            type="button"
            data-testid="low-disk-dismiss"
            onClick={onDismiss}
            className="flex-1 bg-transparent border border-[#282828] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:border-gray-500 transition-all focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Dismiss
          </button>
          {showReclaimAction && (
            <button
              type="button"
              data-testid="low-disk-reclaim"
              onClick={() => onReclaim?.()}
              className="flex-1 bg-[#F27D26] text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              Reclaim
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
