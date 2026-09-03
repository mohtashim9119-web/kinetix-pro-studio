import type React from 'react';

interface SyncLoadingOverlayProps {
  /** True for the whole handleApplySyncFromFiles run (App.tsx) — covers the
   *  asset/parse/align pre-work of a fresh Apply Sync. This is the ONLY gate:
   *  the overlay never appears on a plain project reload/open (waveform drawing
   *  is now a single instant canvas, no per-segment fan-out to wait on). */
  isProcessing: boolean;
}

/**
 * Blocking overlay shown only while a fresh Apply Sync is running. Hides itself
 * the instant the sync work finishes — no minimum display time, no timer, and
 * no waveform gating (the per-segment waveform-ready wait was removed when the
 * waveform collapsed to a single canvas).
 */
export function SyncLoadingOverlay({
  isProcessing,
}: SyncLoadingOverlayProps): React.ReactElement | null {
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
      </div>
    </div>
  );
}
