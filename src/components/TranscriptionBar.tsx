import type React from 'react';
import type { TranscriptionStatus } from '../types';

interface TranscriptionBarProps {
  status: TranscriptionStatus;
  onCancel: () => void;
  onDismiss: () => void;
}

export function TranscriptionBar({
  status,
  onCancel,
  onDismiss,
}: TranscriptionBarProps): React.ReactElement | null {
  if (status.phase === 'idle') return null;

  if (status.phase === 'transcribing') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 px-4 py-1.5 bg-indigo-950/90 border-b border-indigo-800/50 text-sm"
      >
        <div className="flex-1 relative h-1.5 bg-indigo-900 rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-indigo-400 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${status.percent}%` }}
          />
        </div>
        <span className="shrink-0 text-xs text-indigo-300 tabular-nums">
          Transcribing… {status.percent}%
        </span>
        <button
          onClick={onCancel}
          aria-label="Cancel transcription"
          className="shrink-0 p-0.5 rounded hover:bg-indigo-800/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400 text-indigo-400 hover:text-indigo-200 transition-colors text-xs leading-none"
        >
          ✕
        </button>
      </div>
    );
  }

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

  if (status.phase === 'error') {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="flex items-center justify-between gap-3 px-4 py-1.5 bg-red-950/90 border-b border-red-800/50 text-xs text-red-300"
      >
        <span className="truncate">Transcription failed: {status.message}</span>
        <button
          onClick={onDismiss}
          className="shrink-0 px-2 py-0.5 rounded border border-red-700 hover:bg-red-900/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400 transition-colors"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}
