import type React from 'react';
import { useEffect } from 'react';

interface SyncLoadingOverlayProps {
  /** True for the whole handleApplySyncFromFiles run (App.tsx) — covers the
   *  asset/parse/align pre-work of a fresh Apply Sync. This is the ONLY gate:
   *  the overlay never appears on a plain project reload/open (waveform drawing
   *  is now a single instant canvas, no per-segment fan-out to wait on). */
  isProcessing: boolean;
  /** plan-v3 item 5 (M3.5/C8) — whole-run cancel. Fans out to whatever is in
   *  flight (asset persistence, FA's own `fa_cancel`, the matcher pass) via
   *  an `AbortSignal` checked at every stage boundary in
   *  `handleApplySyncFromFiles`; every one of those checks returns BEFORE
   *  the sync's single commit, so cancelling here is always free — the
   *  project is left exactly as it was before Apply Sync started. */
  onCancel: () => void;
}

/**
 * Blocking overlay shown only while a fresh Apply Sync is running. Hides itself
 * the instant the sync work finishes — no minimum display time, no timer, and
 * no waveform gating (the per-segment waveform-ready wait was removed when the
 * waveform collapsed to a single canvas).
 */
export function SyncLoadingOverlay({
  isProcessing,
  onCancel,
}: SyncLoadingOverlayProps): React.ReactElement | null {
  // Escape cancels the sync, same as every other blocking dialog in this app
  // (NewProjectModal, ExportSettingsModal). Only listens while the overlay is
  // actually showing — this effect's own cleanup handles the isProcessing
  // flip from true to false, so no stray listener survives the sync finishing.
  useEffect(() => {
    if (!isProcessing) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isProcessing, onCancel]);

  if (!isProcessing) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-4 bg-[var(--kx-panel)] border border-[var(--kx-line)] rounded-xl px-8 py-6">
        <div className="w-8 h-8 rounded-full border-2 border-t-[#F27D26] border-r-transparent border-b-transparent border-l-transparent animate-spin" />
        <span className="text-sm font-medium tracking-wide">
          Preparing your project…
        </span>
        <button
          data-testid="sync-loading-cancel"
          onClick={onCancel}
          className="text-xs text-gray-500 hover:text-white transition-colors underline underline-offset-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
