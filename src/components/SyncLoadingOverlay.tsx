import type React from 'react';

interface SyncLoadingOverlayProps {
  /** True for the whole handleApplySyncFromFiles run (App.tsx) — covers the
   *  asset/parse/align pre-work that happens before waveform building even
   *  starts, so the overlay appears from the moment the user clicks Apply
   *  Sync rather than only once waveformReadyTracker has a batch in flight. */
  isProcessing: boolean;
  isWaveformReady: boolean;
  waveformReadyCount: number;
  waveformTotalCount: number;
}

/**
 * Blocking overlay shown while Apply Sync's pre-work runs and/or the
 * per-segment waveform images are still drawing (services/waveformReadyTracker.ts).
 * Hides itself the instant both are done — no minimum display time, no timer.
 */
export function SyncLoadingOverlay({
  isProcessing,
  isWaveformReady,
  waveformReadyCount,
  waveformTotalCount,
}: SyncLoadingOverlayProps): React.ReactElement | null {
  const visible = isProcessing || !isWaveformReady;
  if (!visible) return null;

  const text = waveformTotalCount > 0
    ? `Building waveforms: ${waveformReadyCount}/${waveformTotalCount}`
    : 'Applying sync…';

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-4 bg-[var(--kx-panel)] border border-[var(--kx-line)] rounded-xl px-8 py-6">
        <div className="w-8 h-8 rounded-full border-2 border-t-[#F27D26] border-r-transparent border-b-transparent border-l-transparent animate-spin" />
        <span className="text-[#E4E3E0] text-sm font-mono tracking-wide">{text}</span>
      </div>
    </div>
  );
}
