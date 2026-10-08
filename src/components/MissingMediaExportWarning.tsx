import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { Z } from './overlayLayers';
import { buildMediaIssuesWarning, type MediaIssues } from '../services/exportFailure/missingMediaMessage';

export interface MissingMediaExportWarningProps {
  issues: MediaIssues;
  /** "Add Media" — close the card and open the media picker. */
  onCancel: () => void;
  onContinue: () => void;
  /** Close with no action (X button, Escape). */
  onDismiss: () => void;
}

/** Shown at Export-click time when segments have no, offline, or damaged media. */
export function MissingMediaExportWarning({
  issues,
  onCancel,
  onContinue,
  onDismiss,
}: MissingMediaExportWarningProps): React.ReactElement {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  return (
    <div className={`fixed inset-0 ${Z.blocker} bg-black/70 flex items-center justify-center p-6`}>
      <div
        data-testid="missing-media-export-warning"
        className="relative bg-zinc-900 border border-[#282828] rounded-xl p-6 max-w-md w-full shadow-2xl flex flex-col gap-4"
      >
        <button
          type="button"
          data-testid="missing-media-close"
          aria-label="Close"
          onClick={onDismiss}
          className="absolute top-3 right-3 p-1 rounded text-gray-500 hover:text-white"
        >
          <X size={16} />
        </button>
        <p className="text-sm text-zinc-200 leading-relaxed pr-6">{buildMediaIssuesWarning(issues)}</p>
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
