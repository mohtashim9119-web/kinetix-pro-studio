/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * App Settings (WS2 T4.1) — the MACHINE-GLOBAL settings surface, sibling to
 * `ProjectSettingsModal.tsx` and deliberately not a replacement for it. The
 * split is by SCOPE, not by subject: a setting belongs here when changing it
 * changes the behaviour of every project on this machine, and there when it is
 * stored on the project and travels with it. What belongs on a settings
 * surface *at all* is a separate question, settled by CLAUDE.md §5's
 * live-feedback criterion.
 *
 * ONE FLAT SCROLLING SURFACE, THREE BLOCKS, NO NESTED MODAL (Step 1). The
 * blocks are separated by near-invisible hairlines, not by cards or tabs:
 *
 *   1. Export Engine — the WebCodecs toggle. Named for the one thing it
 *      actually selects: which encoder an export run uses. It was briefly
 *      titled "Rendering Engine" on the D6 finding that the preview read the
 *      same value; that finding was wrong (C4) and the title is back.
 *   2. Models & Add-ons — rendered INLINE via `ModelsSection`, the component
 *      extracted from `ManageModelsModal`'s body. Not a link, not a nested
 *      dialog. Its install/delete actions are IMMEDIATE filesystem side
 *      effects and are exempt from this modal's draft-then-commit discipline
 *      (owner ruling): the block says so in its own copy, so nothing there
 *      reads as pending-until-Save.
 *   3. New Project Defaults — the seeds `NewProjectModal` pre-fills from
 *      (`services/appDefaults.ts`). Seeds only: changing one never reaches a
 *      project that already exists.
 *
 * REACHABLE FROM THE DASHBOARD WITH NO PROJECT LOADED. App renders this in the
 * outer fragment, not inside the editor branch, so the dashboard's gear can
 * raise it over an empty install. `showAppSettingsModal` is in
 * `shortcutsSuppressedRef`.
 *
 * DRAFT-THEN-COMMIT for blocks 1 and 3: every control edits local draft state
 * and only Save writes; Cancel/Escape discard. Block 2 is the stated
 * exception, for the reason above.
 */

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { isWebCodecsExportCapable, isWebCodecsExportToggleOn, setWebCodecsExportToggle } from '../hooks/useExport';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { ModelsSection } from './ModelsSection';
import { SUPPORTED_LANGUAGES } from '../constants';
import { resolveDimensions } from '../services/resolutionConfig';
import {
  AUTO_DETECT,
  readNewProjectDefaults,
  writeNewProjectDefaults,
  type NewProjectDefaults,
} from '../services/appDefaults';
import type { AspectRatio, ResolutionTier } from '../types';

const ASPECT_RATIO_OPTIONS: AspectRatio[] = ['16:9', '9:16', '1:1'];
const RESOLUTION_TIER_OPTIONS: ResolutionTier[] = ['720p', '1080p'];

/** The near-invisible hairline between blocks — a divider, not a card edge. */
const HAIRLINE = 'pt-6 mt-6 border-t border-white/[0.06]';

const BLOCK_TITLE = 'text-[9px] font-black uppercase tracking-widest text-[#F27D26]';
const FIELD_LABEL = 'text-[8px] uppercase tracking-widest text-gray-600';
const SELECT = 'w-full bg-[#1A1A1A] border border-[#282828] p-2.5 rounded-lg text-[11px] font-bold uppercase tracking-widest outline-none focus:border-[#F27D26] transition-colors';

interface Props {
  onClose: () => void;
}

function Toggle({
  on,
  onToggle,
  disabled,
  label,
  testId,
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  label: string;
  testId?: string;
}): React.ReactElement {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      data-testid={testId}
      className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
        disabled
          ? 'bg-[#1A1A1A] border border-[#282828] opacity-40 cursor-not-allowed'
          : on
            ? 'bg-[#F27D26]'
            : 'bg-[#1A1A1A] border border-[#282828]'
      }`}
    >
      <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-all ${on && !disabled ? 'translate-x-5' : ''}`} />
    </button>
  );
}

export function AppSettingsModal({ onClose }: Props): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();

  const [draftWebcodecsEnabled, setDraftWebcodecsEnabled] = useState<boolean>(() => isWebCodecsExportToggleOn());
  const [draftDefaults, setDraftDefaults] = useState<NewProjectDefaults>(() => readNewProjectDefaults());

  const webcodecsCapable = isWebCodecsExportCapable();

  const patchDefaults = (partial: Partial<NewProjectDefaults>): void =>
    setDraftDefaults((prev) => ({ ...prev, ...partial }));

  // Escape = Cancel, same as ProjectSettingsModal/NewProjectModal.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSave = (): void => {
    setWebCodecsExportToggle(draftWebcodecsEnabled);
    writeNewProjectDefaults(draftDefaults);
    onClose();
  };

  const defaultDims = resolveDimensions(draftDefaults.aspectRatio, draftDefaults.resolutionTier);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="App Settings"
      data-testid="app-settings-modal"
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        ref={trapRef}
        className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-lg shadow-2xl max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-black uppercase tracking-[0.2em]">App Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#F27D26] rounded"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-[9px] text-gray-600 mb-5 leading-snug">
          These settings apply to every project on this computer. Settings that belong to one
          project live in Project Settings.
        </p>

        {/* ── Block 1: Export Engine ──────────────────────────────
            TITLE REVERTED from "Rendering Engine" (WS2 T4.1, C4). D6 renamed
            this block on the claim that `PreviewStage.tsx:399` read the same
            stored value; it does not. That line's `useWebCodecsPath` comes
            from `isWebCodecsPreviewSupported()`
            (`services/webcodecsSupport.ts`) — a pure `'VideoDecoder' in window`
            capability probe with no `localStorage` read anywhere in it. The
            two files share a LOCAL VARIABLE NAME and nothing else. The stored
            toggle selects the export encoder and only that;
            `webcodecsToggleConsumers.test.ts` now holds that claim answerable
            to the wiring.

            NOT WIRED TO THE PREVIEW, deliberately (owner ruling, C4). The
            Canvas2D/CSS preview path was DELETED at the WebGL2 cutover, not
            gated (see `PreviewStage.tsx`'s "deliberately NO fallback" note),
            so routing the preview through this toggle would hand the user a
            switch that turns off the only preview renderer that exists. The
            copy gets corrected; the wiring does not get invented to match it.

            The STORAGE KEY keeps its old name by ruling — see `useExport.ts`'s
            gate header. */}
        <section data-testid="app-settings-block-rendering" className="space-y-2">
          <p className={BLOCK_TITLE}>Export Engine</p>
          <label className="flex items-center justify-between gap-4 text-[10px] uppercase tracking-widest text-gray-500 font-bold">
            <span>Use the WebCodecs encoder (faster, beta)</span>
            <Toggle
              on={draftWebcodecsEnabled}
              onToggle={() => setDraftWebcodecsEnabled((v) => !v)}
              disabled={!webcodecsCapable}
              label={draftWebcodecsEnabled ? 'Disable the WebCodecs encoder' : 'Enable the WebCodecs encoder'}
              testId="app-settings-webcodecs-toggle"
            />
          </label>
          <p className="text-[9px] text-gray-600 leading-snug">
            Chooses which encoder an export run uses. Turning it off falls back to the older
            frame-by-frame encoder, which is slower. The editor preview is not affected either way.
          </p>
          {!webcodecsCapable && (
            <p className="text-[8px] leading-snug text-gray-600">
              Not available on this device — requires WebCodecs, WebGL2, and module worker support.
            </p>
          )}
        </section>

        {/* ── Block 2: Models & Add-ons ───────────────────────────────────
            Rendered INLINE, not behind a link and not in a nested dialog.
            Install and delete are immediate filesystem side effects and are
            exempt from this modal's draft-then-commit discipline (owner
            ruling) — the copy below says so explicitly, so nothing in this
            block reads as pending until Save. */}
        <section data-testid="app-settings-block-models" className={HAIRLINE}>
          <p className={BLOCK_TITLE}>Models &amp; Add-ons</p>
          <p className="text-[9px] text-gray-600 leading-snug mt-1 mb-3">
            Downloaded once per computer and shared by every project. Downloads and deletions here
            take effect immediately — they are not held until Save.
          </p>
          <ModelsSection />
        </section>

        {/* ── Block 3: New Project Defaults ───────────────────────────────
            SEEDS ONLY. These pre-fill the New Project modal's fields and are
            read nowhere else; changing one never reaches a project that
            already exists. See `services/appDefaults.ts`. */}
        <section data-testid="app-settings-block-new-project-defaults" className={HAIRLINE}>
          <p className={BLOCK_TITLE}>New Project Defaults</p>
          <p className="text-[9px] text-gray-600 leading-snug mt-1 mb-3">
            What a new project starts with. Existing projects are never changed by these.
          </p>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className={FIELD_LABEL} htmlFor="app-default-aspect">Default Aspect Ratio</label>
              <select
                id="app-default-aspect"
                value={draftDefaults.aspectRatio}
                onChange={(e) => patchDefaults({ aspectRatio: e.target.value as AspectRatio })}
                className={SELECT}
              >
                {ASPECT_RATIO_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <p className="text-[9px] text-gray-600">Locked forever at creation on each new project.</p>
            </div>

            <div className="space-y-1">
              <label className={FIELD_LABEL} htmlFor="app-default-tier">Default Resolution</label>
              <select
                id="app-default-tier"
                value={draftDefaults.resolutionTier}
                onChange={(e) => patchDefaults({ resolutionTier: e.target.value as ResolutionTier })}
                className={SELECT}
              >
                {RESOLUTION_TIER_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <p className="text-[9px] text-gray-600">{defaultDims.width} × {defaultDims.height}</p>
            </div>

            <div className="space-y-1">
              <label className={FIELD_LABEL} htmlFor="app-default-language">Default Language</label>
              <select
                id="app-default-language"
                value={draftDefaults.language}
                onChange={(e) => patchDefaults({ language: e.target.value })}
                className={SELECT}
              >
                <option value={AUTO_DETECT}>Auto-detect</option>
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
              <p className="text-[9px] text-gray-600 leading-snug">
                {draftDefaults.language === AUTO_DETECT
                  ? 'New projects store no language at all and let the first transcription detect it.'
                  : 'New projects start with this language set, overriding auto-detection.'}
              </p>
            </div>

            <label className="flex items-center justify-between gap-4 text-[10px] uppercase tracking-widest text-gray-500 font-bold">
              <span>High-Precision Auto-Sync on new projects</span>
              <Toggle
                on={draftDefaults.faHighPrecisionSync}
                onToggle={() => patchDefaults({ faHighPrecisionSync: !draftDefaults.faHighPrecisionSync })}
                label={
                  draftDefaults.faHighPrecisionSync
                    ? 'Disable High-Precision Auto-Sync on new projects'
                    : 'Enable High-Precision Auto-Sync on new projects'
                }
                testId="app-settings-default-fa-toggle"
              />
            </label>

            <label className="flex items-center justify-between gap-4 text-[10px] uppercase tracking-widest text-gray-500 font-bold">
              <span>Segment text overlay on new projects</span>
              <Toggle
                on={draftDefaults.textOverlay}
                onToggle={() => patchDefaults({ textOverlay: !draftDefaults.textOverlay })}
                label={
                  draftDefaults.textOverlay
                    ? 'Hide segment text overlay on new projects'
                    : 'Show segment text overlay on new projects'
                }
                testId="app-settings-default-overlay-toggle"
              />
            </label>
          </div>
        </section>

        <div className="flex gap-3 mt-8">
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
