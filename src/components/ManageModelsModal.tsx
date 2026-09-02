/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Manage Models & Add-ons — the MODAL CHROME only. Its body was extracted to
 * `ModelsSection.tsx` by WS2 T4.1 Step 1 so App Settings can render the same UI
 * inline (block 2, no nested modal) and Project Settings' FA-pack detector can
 * render it filtered to one language, without three copies of a download
 * engine. See that file's header for what the section owns and why.
 *
 * WHY THIS WRAPPER STILL EXISTS after App Settings stopped opening it. Two
 * REMEDIATION links still need a models UI that appears directly, on top of the
 * flow that is failing: `TranscriptionBar`'s "Download model" action on a
 * model-not-found error, and `SyncLogPanel`'s equivalent. Those are "fetch the
 * thing you are missing, right now", not navigation — routing them through App
 * Settings would put two clicks and a context switch between a blocked user and
 * the file they need. App Settings' own entry point is gone: block 2 IS the
 * section, rendered inline.
 */

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { ModelsSection } from './ModelsSection';

const SURFACE = '#121214';
const BORDER = '#26262A';
const ACCENT = '#FF7300';

interface Props {
  onClose: () => void;
  /** The current project's language, if any — highlighted as "needed by
   *  this project" per Phase 2.5. Undefined outside a project context. */
  projectLanguage?: string;
}

export function ManageModelsModal({ onClose, projectLanguage }: Props): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage Models & Add-ons"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        ref={trapRef}
        style={{ background: SURFACE, borderColor: BORDER }}
        className="border rounded-2xl p-8 w-full max-w-lg shadow-2xl max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-black uppercase tracking-[0.2em]">Manage Models &amp; Add-ons</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-500 hover:text-white transition-colors focus:outline-none rounded"
            style={{ outlineColor: ACCENT }}
          >
            <X size={18} />
          </button>
        </div>

        <ModelsSection projectLanguage={projectLanguage} />

        <div className="mt-6 pt-4 border-t" style={{ borderColor: BORDER }}>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg text-black font-bold uppercase tracking-widest text-[10px] transition-colors"
            style={{ background: ACCENT }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
