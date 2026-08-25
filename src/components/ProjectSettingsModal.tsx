/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Project Settings modal (docs/project-settings-plan.md §2.1-2.2) — pulls
 * Export Engine / Text Overlay out of the Effects tab (DropZonePanel.tsx)
 * into a blocking, draft-then-commit modal, plus a new Project section
 * (native resolution tier, editable; aspect ratio, locked and read-only).
 * Export Quality (resolution/fps) moved out to ExportSettingsModal.tsx —
 * those are chosen at export time, not here. All edits are local draft
 * state until Save; Cancel/Escape discard everything.
 */

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { AspectRatio, ResolutionTier, VideoSegment } from '../types';
import { isWebCodecsExportCapable, isWebCodecsExportToggleOn, setWebCodecsExportToggle } from '../hooks/useExport';
import { isFaCapable, shouldPersistFaChoice } from '../services/faGate';
import { resolveDimensions } from '../services/resolutionConfig';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { SUPPORTED_LANGUAGES } from '../constants';

const RESOLUTION_TIER_OPTIONS: ResolutionTier[] = ['720p', '1080p'];

/** Sentinel for the "no override — detect on next transcription" option.
 *  Never a real whisper language code (constants.ts's SUPPORTED_LANGUAGES),
 *  so it can't collide. Selecting it clears Project.language back to
 *  undefined (see handleSave below). */
const AUTO_DETECT_VALUE = 'auto';

interface Props {
  segments: VideoSegment[];
  /** Locked at creation — display only, never an input in this modal. */
  aspectRatio: AspectRatio;
  /** The project's native resolution tier — editable here. */
  resolutionTier: ResolutionTier;
  onResolutionTierChange: (v: ResolutionTier) => void;
  onSetAllOverlay: (value: boolean) => void;
  /** Phase 2a (H.1/H.7) — the project's current language (detected or
   *  overridden), or undefined if no transcription has run yet and the user
   *  hasn't set one. Detection is a suggestion, not a fact — this control is
   *  always editable regardless of how the current value got here. */
  language: string | undefined;
  onLanguageChange: (v: string | undefined) => void;
  /** WS1 Session G (owner ruling R-AK) — the project's EFFECTIVE
   *  high-precision-sync setting, already resolved through
   *  `faGate.ts`'s `isFaEnabledForProject` (so `undefined` has become the
   *  default, `true`). This modal never sees the raw tri-state and so can
   *  never accidentally render "no preference" as "off". */
  faEnabled: boolean;
  onFaEnabledChange: (v: boolean) => void;
  /** Bug 4 fix — opens ModelDownloadPanel for the in-app whisper model
   *  acquisition/status UI. */
  onManageModel: () => void;
  onClose: () => void;
}

export function ProjectSettingsModal({
  segments,
  aspectRatio,
  resolutionTier,
  onResolutionTierChange,
  onSetAllOverlay,
  language,
  onLanguageChange,
  faEnabled,
  onFaEnabledChange,
  onManageModel,
  onClose,
}: Props): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();

  // ── Draft state — all four sections. Committed atomically on Save;
  // Cancel/Escape discard everything below (§2.2). ──────────────────────────
  const [draftNativeTier, setDraftNativeTier] = useState<ResolutionTier>(resolutionTier);
  const [draftWebcodecsEnabled, setDraftWebcodecsEnabled] = useState<boolean>(() => isWebCodecsExportToggleOn());
  const [draftOverlayOn, setDraftOverlayOn] = useState<boolean>(() => segments.every((s) => s.showOverlay));
  const [draftLanguage, setDraftLanguage] = useState<string>(() => language ?? AUTO_DETECT_VALUE);
  // WS1 Session G (owner ruling R-AK) made this PER-PROJECT; WS1 Session H
  // flipped the resolved DEFAULT back to OFF (`faGate.ts`'s
  // `FA_PROJECT_DEFAULT_ON`, value-only — see its own doc comment for the
  // exact flip-back condition). The seed here is the already-resolved
  // effective value regardless of which way the default currently points, so
  // a project with no stored preference opens showing whatever it will
  // actually do.
  const [draftFaEnabled, setDraftFaEnabled] = useState<boolean>(() => faEnabled);

  const webcodecsCapable = isWebCodecsExportCapable();
  const faCapable = isFaCapable();

  // Escape = Cancel (no exact precedent in this codebase, per plan §2.2 —
  // matches NewProjectModal's no-backdrop-close, Escape-cancels behavior).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSave = (): void => {
    onResolutionTierChange(draftNativeTier);
    setWebCodecsExportToggle(draftWebcodecsEnabled);
    // WS1 Session G — write ONLY on an actual change. The retired global
    // toggle was written unconditionally by this very handler, which is
    // exactly why its stored `false` carried no recoverable intent
    // (faGate.ts's LEGACY_GLOBAL_FA_TOGGLE_KEY). Saving an unchanged control
    // must leave `Project.faHighPrecisionSync` absent, so a project that has
    // expressed no preference still has none after the user edits their
    // resolution tier — and still follows the default.
    if (shouldPersistFaChoice(draftFaEnabled, faEnabled)) onFaEnabledChange(draftFaEnabled);
    onSetAllOverlay(draftOverlayOn);
    onLanguageChange(draftLanguage === AUTO_DETECT_VALUE ? undefined : draftLanguage);
    onClose();
  };

  const nativeDims = resolveDimensions(aspectRatio, draftNativeTier);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Project Settings"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        ref={trapRef}
        className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-md shadow-2xl max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-black uppercase tracking-[0.2em]">Project Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#F27D26] rounded"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5">
          {/* Section: Project */}
          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#F27D26]">Project</p>
            <div className="space-y-1">
              <label className="text-[8px] uppercase tracking-widest text-gray-600">Native Resolution</label>
              <select
                value={draftNativeTier}
                onChange={(e) => setDraftNativeTier(e.target.value as ResolutionTier)}
                className="w-full bg-[#1A1A1A] border border-[#282828] p-2.5 rounded-lg text-[11px] font-bold uppercase tracking-widest outline-none focus:border-[#F27D26] transition-colors"
              >
                {RESOLUTION_TIER_OPTIONS.map((tier) => (
                  <option key={tier} value={tier}>{tier}</option>
                ))}
              </select>
              <p className="text-[9px] text-gray-600">{nativeDims.width} × {nativeDims.height}</p>
            </div>
            <div className="space-y-1">
              <label className="text-[8px] uppercase tracking-widest text-gray-600">Aspect Ratio</label>
              <p className="text-[12px] text-gray-400 font-bold">{aspectRatio}</p>
              <p className="text-[9px] text-gray-600 italic">Aspect ratio is locked at project creation</p>
            </div>
          </div>

          {/* Section: Language (Phase 2a, H.1/H.7) — detection is a
              suggestion, not a fact; always editable here regardless of
              whether the current value came from detection or a prior
              override. */}
          <div className="space-y-2 pt-4 border-t border-[#222]">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#F27D26]">Language</p>
            <div className="space-y-1">
              <label className="text-[8px] uppercase tracking-widest text-gray-600">Transcription Language</label>
              <select
                value={draftLanguage}
                onChange={(e) => setDraftLanguage(e.target.value)}
                className="w-full bg-[#1A1A1A] border border-[#282828] p-2.5 rounded-lg text-[11px] font-bold uppercase tracking-widest outline-none focus:border-[#F27D26] transition-colors"
              >
                <option value={AUTO_DETECT_VALUE}>Auto-detect</option>
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
              <p className="text-[9px] text-gray-600">
                {draftLanguage === AUTO_DETECT_VALUE
                  ? 'Detected automatically on the next transcription — a suggestion, not a guarantee.'
                  : 'Overrides auto-detection on the next transcription. Only English, Spanish, French, Portuguese, and German are verified for sync accuracy.'}
              </p>
            </div>
          </div>

          {/* Section: Sync (forced-alignment gate — WS1 Task 5 Slice D17,
              made PER-PROJECT by WS1 Session G, owner ruling R-AK; resolved
              default flipped back to OFF by WS1 Session H, value-only —
              `faGate.ts`'s `FA_PROJECT_DEFAULT_ON`). This control now edits
              `Project.faHighPrecisionSync`
              rather than a per-machine global key, and Save writes it only
              when the user actually moved it (`shouldPersistFaChoice`) — see
              docs/work-in-progress.md §7 item 2 / §11 item 1 (original source
              docs/ws1-sync-pipeline/task5-integration-scope.md was deleted
              2026-08-14, `9cf5867`; retrieve: `git show
              251be64:docs/ws1-sync-pipeline/task5-integration-scope.md`). */}
          <div className="space-y-2 pt-4 border-t border-[#222]">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#F27D26]">Sync</p>
            <label className="flex items-center justify-between text-[10px] uppercase tracking-widest text-gray-500 font-bold">
              <span>High-Precision Auto-Sync (Forced Alignment)</span>
              <button
                onClick={() => setDraftFaEnabled((v) => !v)}
                disabled={!faCapable}
                aria-label={draftFaEnabled ? 'Disable High-Precision Auto-Sync' : 'Enable High-Precision Auto-Sync'}
                aria-pressed={draftFaEnabled}
                className={`w-10 h-5 rounded-full transition-colors relative ${
                  !faCapable
                    ? 'bg-[#1A1A1A] border border-[#282828] opacity-40 cursor-not-allowed'
                    : draftFaEnabled
                      ? 'bg-[#F27D26]'
                      : 'bg-[#1A1A1A] border border-[#282828]'
                }`}
              >
                <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-all ${draftFaEnabled && faCapable ? 'translate-x-5' : ''}`} />
              </button>
            </label>
            {!faCapable && (
              <p className="text-[8px] leading-snug text-gray-600">
                Not available outside the desktop app.
              </p>
            )}
            <button
              onClick={onManageModel}
              className="text-[9px] uppercase tracking-widest text-gray-500 hover:text-[#F27D26] transition-colors underline underline-offset-2"
            >
              Manage sync model
            </button>
          </div>

          {/* Section: Export Engine (WebCodecs export toggle — mirrors DropZonePanel's) */}
          <div className="space-y-2 pt-4 border-t border-[#222]">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#F27D26]">Export Engine</p>
            <label className="flex items-center justify-between text-[10px] uppercase tracking-widest text-gray-500 font-bold">
              <span>Use WebCodecs export (faster, beta)</span>
              <button
                onClick={() => setDraftWebcodecsEnabled((v) => !v)}
                disabled={!webcodecsCapable}
                aria-label={draftWebcodecsEnabled ? 'Disable WebCodecs export' : 'Enable WebCodecs export'}
                aria-pressed={draftWebcodecsEnabled}
                className={`w-10 h-5 rounded-full transition-colors relative ${
                  !webcodecsCapable
                    ? 'bg-[#1A1A1A] border border-[#282828] opacity-40 cursor-not-allowed'
                    : draftWebcodecsEnabled
                      ? 'bg-[#F27D26]'
                      : 'bg-[#1A1A1A] border border-[#282828]'
                }`}
              >
                <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-all ${draftWebcodecsEnabled && webcodecsCapable ? 'translate-x-5' : ''}`} />
              </button>
            </label>
            {!webcodecsCapable && (
              <p className="text-[8px] leading-snug text-gray-600">
                Not available on this device — requires WebCodecs, WebGL2, and module worker support.
              </p>
            )}
          </div>

          {/* Section: Text Overlay (mirrors DropZonePanel's showOverlay cascade) */}
          <div className="space-y-2 pt-4 border-t border-[#222]">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#F27D26]">Text Overlay</p>
            <label className="flex items-center justify-between text-[10px] uppercase tracking-widest text-gray-500 font-bold">
              Segments Text Overlay Default:
              <button
                onClick={() => setDraftOverlayOn((v) => !v)}
                aria-label={draftOverlayOn ? 'Hide overlay text on all segments' : 'Show overlay text on all segments'}
                aria-pressed={draftOverlayOn}
                className={`w-10 h-5 rounded-full transition-colors relative ${draftOverlayOn ? 'bg-[#F27D26]' : 'bg-[#1A1A1A] border border-[#282828]'}`}
              >
                <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-all ${draftOverlayOn ? 'translate-x-5' : ''}`} />
              </button>
            </label>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 bg-transparent border border-[#282828] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:border-gray-500 transition-all focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 bg-[#F27D26] text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
