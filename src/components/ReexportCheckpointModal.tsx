/**
 * WS3 Batch 2 (STEP 2, 2C) — the two-option modal shown at Export-click time
 * when `checkExistingCheckpoint` finds a checkpoint whose `sourceTimelineHash`
 * matches the current project exactly ("unedited"). Presentation only — both
 * buttons are caller-owned callbacks; this component does no purging, no
 * adoption, no session I/O itself.
 */
import React from 'react';

export interface ReexportCheckpointModalProps {
  /**
   * Wall-clock seconds already rendered, for operator context only — omit
   * (undefined) when unknown (2A's peek returns the manifest's own
   * fps/width/height but not a total-expected-frames figure, which needs a
   * full route plan to compute; that's deliberately not done just to
   * populate this line). The line is hidden entirely rather than shown with
   * a fabricated 0:00.
   */
  secondsAlreadyRendered?: number;
  secondsTotal?: number;
  onResumeSession: () => void;
  onStartFresh: () => void;
}

function formatSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

export function ReexportCheckpointModal({
  secondsAlreadyRendered,
  secondsTotal,
  onResumeSession,
  onStartFresh,
}: ReexportCheckpointModalProps): React.ReactElement {
  return (
    <div className="fixed inset-0 z-[500] bg-black/70 flex items-center justify-center p-6">
      <div
        data-testid="reexport-checkpoint-modal"
        className="bg-zinc-900 border border-[#282828] rounded-xl p-6 max-w-lg w-full shadow-2xl flex flex-col gap-4"
      >
        <h2 className="text-sm font-black uppercase tracking-[0.2em] text-zinc-100">
          Existing export checkpoint found
        </h2>
        <p className="text-sm text-zinc-300 leading-relaxed">
          This timeline matches a previous export that did not finish. You can pick up where it
          left off, at its original resolution and destination, or discard it and start a new
          export from scratch.
        </p>
        {secondsAlreadyRendered !== undefined && secondsTotal !== undefined && (
          <p data-testid="reexport-checkpoint-progress" className="text-xs text-zinc-500">
            {formatSeconds(secondsAlreadyRendered)} of {formatSeconds(secondsTotal)} already rendered
          </p>
        )}
        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            data-testid="reexport-start-fresh"
            onClick={onStartFresh}
            className="text-sm bg-transparent border border-[#282828] text-gray-300 hover:text-white hover:border-gray-500 rounded-lg px-4 py-2 transition-colors"
          >
            Start Fresh
          </button>
          <button
            type="button"
            data-testid="reexport-resume-session"
            onClick={onResumeSession}
            className="text-sm bg-[#F27D26] hover:bg-orange-400 text-white font-black uppercase tracking-widest rounded-lg px-4 py-2 transition-colors"
          >
            Resume Session
          </button>
        </div>
      </div>
    </div>
  );
}
