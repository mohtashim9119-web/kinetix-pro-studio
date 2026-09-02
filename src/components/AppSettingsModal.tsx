/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * App Settings (WS2 T4.1) — the MACHINE-GLOBAL settings surface, sibling to
 * `ProjectSettingsModal.tsx` and deliberately not a replacement for it. The
 * split is by SCOPE, not by subject: a setting belongs here when changing it
 * changes the behaviour of every project on this machine, and there when it is
 * stored on the project and travels with it.
 *
 * Two things live here today:
 *   • Rendering Engine (the WebCodecs toggle) — MOVED out of Project Settings.
 *     It was never project state: `useExport.ts`'s `webcodecsExportEnabled` is
 *     a `localStorage` key read through `uiStateStore.ts`, so editing it in
 *     Project Settings changed every other project too while looking as though
 *     it changed one. Named "Export Engine" until WS2 T4.1's D6 finding — it
 *     also selects the WebGL2 PREVIEW renderer (`PreviewStage.tsx:399`), so an
 *     export-only label described only half of what it does.
 *   • Models & Add-ons — the entry point into `ManageModelsModal`, whose
 *     contents (`app_local_data_dir/models`) are per-machine by construction.
 *
 * Same modal-boolean pattern as every other modal in this app (no router
 * exists): App owns a `showAppSettingsModal` flag, renders this behind it, and
 * passes `onOpenModels` so this can raise the models modal on top without
 * unmounting itself.
 *
 * DRAFT-THEN-COMMIT, matching `ProjectSettingsModal`: every control edits local
 * draft state and only Save writes. Cancel/Escape discard.
 */

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { isWebCodecsExportCapable, isWebCodecsExportToggleOn, setWebCodecsExportToggle } from '../hooks/useExport';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface Props {
  /** Raises `ManageModelsModal` on top of this one — the machine-global model
   *  and add-on store. This modal stays mounted behind it. */
  onOpenModels: () => void;
  onClose: () => void;
}

export function AppSettingsModal({ onOpenModels, onClose }: Props): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();

  const [draftWebcodecsEnabled, setDraftWebcodecsEnabled] = useState<boolean>(() => isWebCodecsExportToggleOn());

  const webcodecsCapable = isWebCodecsExportCapable();

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
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="App Settings"
      data-testid="app-settings-modal"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        ref={trapRef}
        className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-md shadow-2xl max-h-[85vh] overflow-y-auto"
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

        <div className="space-y-5">
          {/* Section: Rendering Engine — MOVED from ProjectSettingsModal. Stored in
              localStorage via uiStateStore, i.e. per-machine all along.

              WS2 T4.1 (D6) — RENAMED from "Export Engine", which was
              measurably wrong, not merely narrow. The same toggle value is
              read by `PreviewStage.tsx:399` as
              `glPathActive = useWebCodecsPath && webgl2Supported`, selecting
              the WebGL2 preview renderer — so turning this off changes what
              the user sees while editing, not just how the file is encoded.
              A control whose label names one of its two consumers is a
              control the user cannot reason about. The STORAGE KEY keeps its
              old name (`webcodecsExportEnabled`) by ruling: a migration
              across every existing profile buys nothing but a tidier string.
              See `useExport.ts`'s gate header. */}
          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#F27D26]">Rendering Engine</p>
            <label className="flex items-center justify-between text-[10px] uppercase tracking-widest text-gray-500 font-bold">
              <span>Use the WebCodecs renderer (faster, beta)</span>
              <button
                onClick={() => setDraftWebcodecsEnabled((v) => !v)}
                disabled={!webcodecsCapable}
                aria-label={draftWebcodecsEnabled ? 'Disable the WebCodecs renderer' : 'Enable the WebCodecs renderer'}
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
            <p className="text-[9px] text-gray-600 leading-snug">
              Governs both the editor preview and the export encoder — one engine drives
              the picture you edit against and the file you render out, so they always match.
            </p>
            {!webcodecsCapable && (
              <p className="text-[8px] leading-snug text-gray-600">
                Not available on this device — requires WebCodecs, WebGL2, and module worker support.
              </p>
            )}
          </div>

          {/* Section: Models & Add-ons — the entry point, not the UI itself.
              Deliberately carries NO claim about what any model enables: see
              this commit's message for the FA-copy audit. */}
          <div className="space-y-2 pt-4 border-t border-[#222]">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#F27D26]">Models &amp; Add-ons</p>
            <p className="text-[9px] text-gray-600 leading-snug">
              Downloaded once per computer and shared by every project.
            </p>
            <button
              onClick={onOpenModels}
              data-testid="app-settings-open-models"
              className="text-[9px] uppercase tracking-widest text-gray-500 hover:text-[#F27D26] transition-colors underline underline-offset-2"
            >
              Manage models &amp; add-ons
            </button>
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
