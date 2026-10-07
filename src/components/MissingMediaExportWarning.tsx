import React from 'react';
import { Z } from './overlayLayers';
import { buildMediaIssuesWarning, type MediaIssues } from '../services/exportFailure/missingMediaMessage';

export interface MissingMediaExportWarningProps {
  issues: MediaIssues;
  onCancel: () => void;
  onContinue: () => void;
}

/** Shown at Export-click time when segments have no, offline, or damaged media. */
export function MissingMediaExportWarning({
  issues,
  onCancel,
  onContinue,
}: MissingMediaExportWarningProps): React.ReactElement {
  return (
    <div className={`fixed inset-0 ${Z.blocker} bg-black/70 flex items-center justify-center p-6`}>
      <div
        data-testid="missing-media-export-warning"
        className="bg-zinc-900 border border-[#282828] rounded-xl p-6 max-w-md w-full shadow-2xl flex flex-col gap-4"
      >
        <p className="text-sm text-zinc-200 leading-relaxed">{buildMediaIssuesWarning(issues)}</p>
        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            data-testid="missing-media-cancel"
            onClick={onCancel}
            className="text-sm bg-[#F27D26] hover:bg-orange-400 text-white rounded-lg px-4 py-2 transition-colors"
          >
            Add Media
          </button>
          <button
            type="button"
            data-testid="missing-media-continue"
            onClick={onContinue}
            className="text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded-lg px-4 py-2 transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
