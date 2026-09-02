/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * New Project (WS2 T4.1 Step 2) — five fields, every one of them PRE-FILLED
 * from App Settings' New Project Defaults (`services/appDefaults.ts`).
 *
 * THE LANGUAGE FIELD IS THE ONE WITH A TRAP IN IT. "Auto-detect" is the
 * default choice and it must WRITE NOTHING: a project created under it carries
 * no `language` field at all. The absence is load-bearing, not tidiness —
 * `faGate.ts`'s `resolveFaLanguage` is `language ?? detectedLanguage`, and
 * `useWhisper.ts` writes a detection only into an EMPTY `language`, so any
 * seeded code (`'en'` included) permanently shadows Whisper detection for the
 * life of the project: a Spanish voiceover would resolve FA to English forever
 * with no way back. `languageDefaultDrift.test.ts` locks the `makeDefaultProject`
 * end of this; `App.newProjectDefaults.test.tsx` locks this end.
 *
 * THE FA TOGGLE WRITES ONLY WHEN IT DIFFERS FROM THE READ-TIME DEFAULT, the
 * same discipline `ProjectSettingsModal` applies through `shouldPersistFaChoice`
 * and for the same reason: an absent `Project.faHighPrecisionSync` means "no
 * preference" and must keep meaning that, so a future change to
 * `FA_PROJECT_DEFAULT_ON` still reaches a project whose owner never expressed
 * one. Seeing a control at creation and leaving it alone is not a choice.
 * `handleNewProjectConfirm` owns that comparison — see App.tsx.
 */

import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { AspectRatio, ResolutionTier } from '../types';
import { resolveDimensions } from '../services/resolutionConfig';
import { AUTO_DETECT, readNewProjectDefaults } from '../services/appDefaults';
import { isFaCapable } from '../services/faGate';
import { SUPPORTED_LANGUAGES } from '../constants';

/** Locked-forever choice, shown first (plan §2.4) — both tiers below are
 *  always offered for every ratio; only their derived dimensions change. */
const ASPECT_RATIO_OPTIONS: AspectRatio[] = ['16:9', '9:16', '1:1'];
const RESOLUTION_TIER_OPTIONS: ResolutionTier[] = ['720p', '1080p'];

export interface NewProjectChoices {
  name: string;
  aspectRatio: AspectRatio;
  resolutionTier: ResolutionTier;
  /** A supported whisper code, or `AUTO_DETECT`. The caller is responsible for
   *  turning `AUTO_DETECT` into "write no field at all" — this component never
   *  invents a code of its own. */
  language: string;
  faHighPrecisionSync: boolean;
}

interface Props {
  /** Called when the user confirms creation. Aspect ratio is locked forever
   *  after this; resolution tier and language stay editable in Project
   *  Settings. */
  onConfirm: (choices: NewProjectChoices) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
}

export function NewProjectModal({ onConfirm, onCancel }: Props): React.ReactElement {
  // Read ONCE, lazily, at mount. These are seeds: a later App Settings edit
  // must not reach into a New Project dialog already on screen.
  const [defaults] = useState(() => readNewProjectDefaults());

  const [name, setName] = useState('Untitled Project');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(defaults.aspectRatio);
  const [resolutionTier, setResolutionTier] = useState<ResolutionTier>(defaults.resolutionTier);
  const [language, setLanguage] = useState<string>(defaults.language);
  const [faEnabled, setFaEnabled] = useState<boolean>(defaults.faHighPrecisionSync);

  const faCapable = isFaCapable();

  const handleConfirm = (): void => {
    onConfirm({
      name: name.trim() || 'Untitled Project',
      aspectRatio,
      resolutionTier,
      language,
      faHighPrecisionSync: faEnabled,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New Project"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-sm shadow-2xl max-h-[85vh] overflow-y-auto">
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
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block mb-2" htmlFor="new-project-name">
              Project Name
            </label>
            <input
              id="new-project-name"
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
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block mb-2" htmlFor="new-project-resolution">
              Resolution
            </label>
            <select
              id="new-project-resolution"
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

          <div>
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block mb-2" htmlFor="new-project-language">
              Language
            </label>
            <select
              id="new-project-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-xl text-sm font-bold outline-none focus:border-[#F27D26] transition-colors"
            >
              <option value={AUTO_DETECT}>Auto-detect</option>
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
            <p className="text-[9px] text-gray-600 mt-2 leading-snug">
              {language === AUTO_DETECT
                ? 'Detected from the voiceover on the first transcription. Nothing is stored until then.'
                : 'Stored on the project and used instead of auto-detection. Editable later in Project Settings.'}
            </p>
          </div>

          <label className="flex items-center justify-between gap-4 text-[10px] uppercase tracking-widest text-gray-500 font-bold">
            <span>High-Precision Auto-Sync</span>
            <button
              type="button"
              onClick={() => setFaEnabled((v) => !v)}
              disabled={!faCapable}
              aria-label={faEnabled ? 'Disable High-Precision Auto-Sync' : 'Enable High-Precision Auto-Sync'}
              aria-pressed={faEnabled}
              data-testid="new-project-fa-toggle"
              className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
                !faCapable
                  ? 'bg-[#1A1A1A] border border-[#282828] opacity-40 cursor-not-allowed'
                  : faEnabled
                    ? 'bg-[#F27D26]'
                    : 'bg-[#1A1A1A] border border-[#282828]'
              }`}
            >
              <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-all ${faEnabled && faCapable ? 'translate-x-5' : ''}`} />
            </button>
          </label>
          {!faCapable && (
            <p className="text-[8px] leading-snug text-gray-600">
              Not available outside the desktop app.
            </p>
          )}

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
