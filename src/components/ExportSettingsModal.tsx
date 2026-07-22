/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Export-time settings dialog — resolution + fps are chosen here, at export
 * time, instead of in Project Settings (industry-standard pattern for pro
 * video editors). Same blocking-modal shell as ProjectSettingsModal.tsx.
 * Draft state is seeded from the current exportResolution/exportFps (so the
 * last export's choice is remembered); Continue commits the draft back to
 * App.tsx's existing state and proceeds to the save-path dialog + export
 * run; Cancel discards the draft and triggers no export.
 */

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { AspectRatio } from '../types';
import type { ExportFps, ExportResolution } from '../hooks/useExport';
import { resolveDimensions } from '../services/resolutionConfig';
import { useFocusTrap } from '../hooks/useFocusTrap';

const RESOLUTION_OPTIONS: ExportResolution[] = ['720p', '1080p'];

interface Props {
  aspectRatio: AspectRatio;
  exportResolution: ExportResolution;
  exportFps: ExportFps;
  mixedNativeFpsWarning: boolean;
  onContinue: (resolution: ExportResolution, fps: ExportFps) => void;
  onCancel: () => void;
}

export function ExportSettingsModal({
  aspectRatio,
  exportResolution,
  exportFps,
  mixedNativeFpsWarning,
  onContinue,
  onCancel,
}: Props): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();

  const [draftResolution, setDraftResolution] = useState<ExportResolution>(exportResolution);
  const [draftFps, setDraftFps] = useState<ExportFps>(exportFps);

  // Escape = Cancel, matching ProjectSettingsModal's no-backdrop-close behavior.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const dims = resolveDimensions(aspectRatio, draftResolution);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export Settings"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        ref={trapRef}
        className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-md shadow-2xl max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-black uppercase tracking-[0.2em]">Export Settings</h2>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="text-gray-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#F27D26] rounded"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-[8px] uppercase tracking-widest text-gray-600">Resolution</label>
                <select
                  value={draftResolution}
                  onChange={(e) => setDraftResolution(e.target.value as ExportResolution)}
                  className="w-full bg-[#1A1A1A] border border-[#282828] p-2.5 rounded-lg text-[11px] font-bold uppercase tracking-widest outline-none focus:border-[#F27D26] transition-colors"
                >
                  {RESOLUTION_OPTIONS.map((tier) => (
                    <option key={tier} value={tier}>{tier}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-[8px] uppercase tracking-widest text-gray-600">Frame Rate</label>
                <select
                  value={draftFps}
                  onChange={(e) => setDraftFps(Number(e.target.value) as ExportFps)}
                  className="w-full bg-[#1A1A1A] border border-[#282828] p-2.5 rounded-lg text-[11px] font-bold uppercase tracking-widest outline-none focus:border-[#F27D26] transition-colors"
                >
                  <option value={24}>24 fps</option>
                  <option value={30}>30 fps</option>
                  <option value={60}>60 fps</option>
                </select>
              </div>
            </div>
            {mixedNativeFpsWarning && (
              <p className="text-[8px] leading-snug text-amber-500/90">
                Staged videos have different native frame rates — pick the Frame Rate
                that best matches your footage; it won&apos;t be auto-set for you.
              </p>
            )}
            <p className="text-[9px] text-gray-600">{dims.width} × {dims.height}</p>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 bg-transparent border border-[#282828] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:border-gray-500 transition-all focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Cancel
          </button>
          <button
            onClick={() => onContinue(draftResolution, draftFps)}
            className="flex-1 bg-[#F27D26] text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
