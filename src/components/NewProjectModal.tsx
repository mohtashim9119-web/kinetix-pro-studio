import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { AspectRatio, ResolutionTier } from '../types';
import { resolveDimensions, DEFAULT_ASPECT_RATIO, DEFAULT_RESOLUTION_TIER } from '../services/resolutionConfig';

/** Locked-forever choice, shown first (plan §2.4) — both tiers below are
 *  always offered for every ratio; only their derived dimensions change. */
const ASPECT_RATIO_OPTIONS: AspectRatio[] = ['16:9', '9:16', '1:1'];
const RESOLUTION_TIER_OPTIONS: ResolutionTier[] = ['720p', '1080p'];

interface Props {
  /** Called when the user confirms creation with the chosen name, aspect
   *  ratio (locked forever after this), and native resolution tier
   *  (editable later in Project Settings). */
  onConfirm: (name: string, aspectRatio: AspectRatio, resolutionTier: ResolutionTier) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
}

export function NewProjectModal({ onConfirm, onCancel }: Props): React.ReactElement {
  const [name, setName] = useState('Untitled Project');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(DEFAULT_ASPECT_RATIO);
  const [resolutionTier, setResolutionTier] = useState<ResolutionTier>(DEFAULT_RESOLUTION_TIER);

  const handleConfirm = (): void => {
    onConfirm(name.trim() || 'Untitled Project', aspectRatio, resolutionTier);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New Project"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-black uppercase tracking-[0.2em]">New Project</h2>
          <button
            onClick={onCancel}
            aria-label="Cancel"
            className="text-gray-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#F27D26] rounded"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block mb-2">
              Project Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm();
                if (e.key === 'Escape') onCancel();
              }}
              className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-xl text-sm font-bold outline-none focus:border-[#F27D26] transition-colors"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block mb-2">
              Aspect Ratio
            </label>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Aspect Ratio">
              {ASPECT_RATIO_OPTIONS.map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  role="radio"
                  aria-checked={aspectRatio === ratio}
                  onClick={() => setAspectRatio(ratio)}
                  className={`p-3 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors focus:outline-none focus:ring-2 focus:ring-[#F27D26] ${
                    aspectRatio === ratio
                      ? 'bg-[#F27D26] border-[#F27D26] text-white'
                      : 'bg-[#1A1A1A] border-[#282828] text-gray-500 hover:text-white hover:border-gray-500'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-gray-600 uppercase tracking-widest mt-2">
              Locked forever once created — cannot be changed later.
            </p>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block mb-2">
              Resolution
            </label>
            <select
              value={resolutionTier}
              onChange={(e) => setResolutionTier(e.target.value as ResolutionTier)}
              className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-xl text-sm font-bold outline-none focus:border-[#F27D26] transition-colors"
            >
              {RESOLUTION_TIER_OPTIONS.map((tier) => {
                const dims = resolveDimensions(aspectRatio, tier);
                return (
                  <option key={tier} value={tier}>
                    {tier} — {dims.width} × {dims.height}
                  </option>
                );
              })}
            </select>
          </div>

          <p className="text-[9px] text-gray-600 uppercase tracking-widest">
            The current project will be saved automatically before switching.
          </p>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 bg-transparent border border-[#282828] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:border-gray-500 transition-all focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 bg-[#F27D26] text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
