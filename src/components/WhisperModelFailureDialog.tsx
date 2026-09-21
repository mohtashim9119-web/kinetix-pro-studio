/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 1 hotfix (operator-ordered) — the Whisper fail-loud dialog. Shown
// whenever a fresh transcription attempt halts on a typed model-integrity
// failure (`WhisperFailureKind` 'model-not-found' | 'model-hash-mismatch',
// whisperService.ts / whisper.rs's Fix-2 gate) — the ONLY two reasons this
// dialog fires for. Every other transcription error (in-flight refusal,
// generic inference failure) keeps using `TranscriptionBar`'s existing inline
// banner; this dialog replaces that banner for the model-integrity pair only,
// since a half-hidden strip under the toolbar is not "fail loud" for the one
// failure mode that stops transcription cold and needs a decision.
//
// Both reasons converge on the same `useWhisper` `transcriptionStatus`, so
// this fires from every path that can produce a fresh 'error' phase with one
// of these two kinds — staging-time auto-transcribe on file drop AND the
// explicit "Transcribe this file" re-attempt (App.tsx's
// `handleVoiceoverTranscribeRequested`) both route through the same
// `startTranscription` call site and land here identically.
//
// NEVER SILENT, NEVER AUTO-SWITCH, NEVER AUTO-DOWNLOAD WITHOUT THE CLICK —
// same house rule `SyncPausedDialog` documents for FA's pause-and-ask. Visual
// family matches that dialog (same backdrop, panel, title, button styling) so
// the app has one coherent fail-loud look; this one has two answers, not
// three, because there is no "continue with a different model" — the whole
// point of the model-integrity gate is that it never substitutes one.
//
// DELIBERATELY NOT RESTART-PERSISTED, unlike `SyncPausedDialog` (which is
// backed by `faSyncPauseStore.ts` so an unanswered FA pause re-presents after
// a relaunch). This dialog is driven purely by live `transcriptionStatus`
// React state: a reload clears it. That is the correct behavior here, not a
// gap — the missing/corrupt model is still on disk after a relaunch, so the
// very next transcription attempt (staging-time auto-fire on the still-staged
// file, or an explicit re-transcribe) reclassifies the same typed failure and
// re-fires this dialog on its own. `faSyncPauseStore.ts` stays FA-scoped; no
// second, near-identical store was added for this.
//
// ALL DIALOG COPY LIVES IN ONE BLOCK BELOW (`COPY`), same convention as
// `SyncPausedDialog`'s `PAUSE_COPY`/`COPY`, for operator sign-off.
// Placeholder-quality wording, deliberately swappable without touching any
// other line in this file.
// ---------------------------------------------------------------------------

import type React from 'react';
import { useEffect } from 'react';

export type WhisperModelFailureKind = 'model-not-found' | 'model-hash-mismatch';

const COPY = {
  title: 'Whisper model unavailable',
  reason: {
    'model-not-found': 'The Whisper transcription model (ggml-large-v3-turbo.bin) was not found.',
    'model-hash-mismatch': 'The installed Whisper model failed its integrity check — it may be corrupted or incomplete.',
  } satisfies Record<WhisperModelFailureKind, string>,
  hint: 'Transcription needs this model to run. It will not switch to another model or continue without it.',
  downloadLabel: 'Download model',
  cancelLabel: 'Cancel',
  /** Shown (as a toast, App.tsx) when a download just completed but there was
   *  no staged file left to safely auto-retry against — see App.tsx's
   *  ManageModelsModal close handler. Kept in this same COPY block so every
   *  operator-facing string this feature owns has one home. */
  downloadedRetryMessage: 'Model downloaded — try again.',
} as const;

interface Props {
  kind: WhisperModelFailureKind;
  /** Opens the existing model-download flow (`ManageModelsModal`) — the same
   *  remediation surface `TranscriptionBar`'s old "Download Model" action and
   *  `SyncLogPanel`'s equivalent already use. Never starts a download on its
   *  own; this only fires on the click. */
  onDownloadModel: () => void;
  /** Dismisses the dialog without acting — same semantics as
   *  `TranscriptionBar`'s existing Dismiss button (`useWhisper`'s
   *  `dismissError`). Nothing was committed by a failed transcription, so
   *  there is nothing to undo. */
  onCancel: () => void;
}

export function WhisperModelFailureDialog({ kind, onDownloadModel, onCancel }: Props): React.ReactElement {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={COPY.title}
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-sm shadow-2xl">
        <h2 className="text-sm font-black uppercase tracking-[0.2em] mb-4">{COPY.title}</h2>

        <p className="text-sm text-gray-300 mb-2">{COPY.reason[kind]}</p>
        <p className="text-xs text-gray-500 mb-6">{COPY.hint}</p>

        <div className="space-y-2">
          <button
            data-testid="whisper-model-failure-download"
            onClick={onDownloadModel}
            className="w-full bg-[#F27D26] text-black font-bold text-sm py-3 rounded-xl hover:brightness-110 transition"
          >
            {COPY.downloadLabel}
          </button>
          <button
            data-testid="whisper-model-failure-cancel"
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

export { COPY as WHISPER_MODEL_FAILURE_COPY };
