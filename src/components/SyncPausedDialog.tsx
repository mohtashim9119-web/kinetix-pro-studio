/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// plan-v3 Wave 1 item 4 — the pause-and-ask dialog (M3.1/C5). Shown whenever
// `FaRunResult.status === 'paused'` (a run-level FA failure or precondition,
// `forcedAlignmentRun.ts`) stops an Apply Sync run before any commit, and
// re-shown on relaunch if the user closed the app before answering
// (`faSyncPauseStore.ts` — the record this dialog is driven by is restart-
// safe, this component itself holds no state of its own).
//
// THREE CHOICES, NEVER A SILENT FOURTH. Per the operator ruling
// (`docs/ws1-sync-pipeline/operator-product-rulings-2026-09-19.md`):
// Whisper-only is a flagged-degraded state, never a silent pick, so "use
// Whisper" here is an explicit, logged choice — not the automatic behavior a
// paused run falls into on its own. Retry re-attempts FA (the cached
// transcript this run already had is untouched, so retrying never
// re-transcribes — see FaPauseRecord's own doc comment). Cancel leaves the
// project exactly as it was before Apply Sync started; nothing was committed
// by a paused run, so cancelling here has nothing to undo.
//
// ALL DIALOG COPY LIVES IN ONE BLOCK BELOW (`PAUSE_COPY`) FOR OPERATOR
// SIGN-OFF, per plan-v3 Group B step 3. Placeholder-quality wording,
// deliberately swappable without touching any other line in this file.
// ---------------------------------------------------------------------------

import type React from 'react';
import { useEffect } from 'react';
import type { FaFailureKind } from '../services/forcedAlignmentRun';
import type { FaVictimPauseReason } from '../services/faVictimGate';

/** One line of plain-language cause per pause reason, for the dialog body.
 *  Exhaustive over `FaFailureKind | FaVictimPauseReason` by construction — a
 *  new failure kind without an entry here is a compile error, not a blank
 *  dialog line. */
const PAUSE_COPY: Record<FaFailureKind | FaVictimPauseReason, string> = {
  'unsupported-language': 'The project language has no forced-alignment model.',
  'empty-chunk-plan': 'The chunk plan came out empty — no scene carried any text to align.',
  'zero-words': 'Forced alignment ran but returned no words.',
  'model-not-found': 'No forced-alignment model is installed for this language.',
  'model-hash-mismatch': 'The installed forced-alignment model failed its integrity check.',
  'runtime-load-failed': 'The forced-alignment runtime failed to load.',
  'audio-stage-failed': 'The voiceover could not be prepared for alignment.',
  'inference-failed': 'The alignment engine reported an error.',
  'already-running': 'A forced-alignment run for this project is already in progress.',
  'out-of-memory': 'The alignment engine ran out of memory.',
  offline: 'The cloud alignment engine could not be reached — check your network connection.',
  'all-covered-fabricated': 'Every covered scene’s forced-alignment timing was fabricated — no chunk in this run aligned successfully.',
};

const COPY = {
  title: 'High-precision sync paused',
  bodyPrefix: 'Apply Sync stopped before writing anything to your timeline.',
  retryLabel: 'Try forced alignment again',
  useWhisperLabel: 'Continue with Whisper timing',
  useWhisperHint: '(flagged as degraded — re-run Apply Sync later to retry high-precision alignment)',
  cancelLabel: 'Cancel',
  staleHint: (minutesAgo: number): string =>
    minutesAgo < 1
      ? 'This just happened.'
      : `This happened ${minutesAgo} minute${minutesAgo === 1 ? '' : 's'} ago — you may have closed the app before answering.`,
} as const;

interface Props {
  reason: FaFailureKind | FaVictimPauseReason;
  detail?: string;
  /** Date.now() the pause was recorded, for the "this happened N minutes
   *  ago" hint on a re-presented (post-restart) dialog. */
  timestamp: number;
  /** Re-attempts Apply Sync with the FA gate on — never re-transcribes,
   *  since the cached Whisper transcript this run already had is untouched. */
  onRetry: () => void;
  /** Explicitly, visibly chooses Whisper-only timing for this run — never
   *  the automatic behavior; see module doc comment. */
  onUseWhisper: () => void;
  /** Dismisses the dialog and clears the pause record. Nothing was
   *  committed by a paused run, so this leaves the project untouched. */
  onCancel: () => void;
}

export function SyncPausedDialog({
  reason,
  detail,
  timestamp,
  onRetry,
  onUseWhisper,
  onCancel,
}: Props): React.ReactElement {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const minutesAgo = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={COPY.title}
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-sm shadow-2xl">
        <h2 className="text-sm font-black uppercase tracking-[0.2em] mb-4">{COPY.title}</h2>

        <p className="text-sm text-gray-300 mb-2">{COPY.bodyPrefix}</p>
        <p className="text-sm text-gray-300 mb-2">{PAUSE_COPY[reason]}</p>
        {detail && (
          <p className="text-xs text-gray-500 font-mono mb-2 break-words">{detail}</p>
        )}
        <p className="text-xs text-gray-500 mb-6">{COPY.staleHint(minutesAgo)}</p>

        <div className="space-y-2">
          <button
            data-testid="sync-paused-retry"
            onClick={onRetry}
            className="w-full bg-[#F27D26] text-black font-bold text-sm py-3 rounded-xl hover:brightness-110 transition"
          >
            {COPY.retryLabel}
          </button>
          <button
            data-testid="sync-paused-use-whisper"
            onClick={onUseWhisper}
            className="w-full bg-[#1A1A1A] border border-[#282828] text-sm py-3 rounded-xl hover:border-[#F27D26] transition"
          >
            {COPY.useWhisperLabel}
            <span className="block text-[10px] text-gray-500 mt-1">{COPY.useWhisperHint}</span>
          </button>
          <button
            data-testid="sync-paused-cancel"
            onClick={onCancel}
            className="w-full text-gray-500 hover:text-white text-sm py-2 transition"
          >
            {COPY.cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
