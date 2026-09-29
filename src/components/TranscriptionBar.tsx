import type React from 'react';
import type { TranscriptionStatus } from '../types';
import { isModelMissingError } from '../services/modelDownload';

interface TranscriptionBarProps {
  status: TranscriptionStatus;
  onCancel: () => void;
  onDismiss: () => void;
  onDownloadModel: () => void;
}

export function TranscriptionBar({
  status,
  onCancel,
  onDismiss,
  onDownloadModel,
}: TranscriptionBarProps): React.ReactElement | null {
  if (status.phase === 'idle') return null;

  // Wave 3 U4.6 — progress is silent. The 0–100% transcription bar no
  // longer renders (both engines); the Build Timeline click shows the honest
  // phase instead. Failures below stay loud.
  if (status.phase === 'transcribing') return null;

  if (status.phase === 'done') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="px-4 py-1.5 bg-emerald-950/90 border-b border-emerald-800/50 text-xs text-emerald-300"
      >
        ✓ Transcription complete — segment times updated
      </div>
    );
  }

  if (status.phase === 'warning') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-between gap-3 px-4 py-1.5 bg-amber-950/90 border-b border-amber-800/50 text-xs text-amber-300"
      >
        <span className="truncate select-text">⚠ {status.message}</span>
        <button
          onClick={onDismiss}
          className="shrink-0 px-2 py-0.5 rounded border border-amber-700 hover:bg-amber-900/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 transition-colors"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (status.phase === 'error') {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="flex items-center justify-between gap-3 px-4 py-1.5 bg-red-950/90 border-b border-red-800/50 text-xs text-red-300"
      >
        <span className="truncate select-text">Transcription failed: {status.message}</span>
        <div className="flex shrink-0 items-center gap-2">
          {isModelMissingError(status.message) && (
            <button
              onClick={onDownloadModel}
              className="px-2 py-0.5 rounded border border-red-700 bg-red-900/40 hover:bg-red-900/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400 transition-colors font-bold uppercase tracking-widest"
            >
              Download Model
            </button>
          )}
          <button
            onClick={onDismiss}
            className="px-2 py-0.5 rounded border border-red-700 hover:bg-red-900/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400 transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return null;
}
