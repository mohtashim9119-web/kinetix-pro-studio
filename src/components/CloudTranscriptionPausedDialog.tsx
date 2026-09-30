/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 3 U4 — the cloud transcription pause (the G3 offline contract at
// staging). Shown when staging-time transcription on the cloud failed and its
// one automatic retry (`runStageCacheFirst`) did not fix it — or failed in a
// way a retry cannot fix (a refused key). Replaces `TranscriptionBar`'s inline
// error strip for these failures: a half-hidden strip is not "pause and ask".
//
// THREE ANSWERS, NEVER A SILENT FOURTH: try the cloud again; transcribe THIS
// voiceover on this computer (one run — the standing Cloud/Local choice is
// never written, `syncEngineHost.ts`'s `hostForRun`); or cancel. Nothing is
// ever rerouted to the local engine without the click.
//
// Not restart-persisted, same reasoning as `WhisperModelFailureDialog`: it is
// driven by live `transcriptionStatus`, and the staged voiceover re-fires
// transcription (and so this dialog, if the cloud is still unreachable) on its
// own after a relaunch.
//
// ALL COPY LIVES IN `COPY` BELOW, for operator sign-off.
// ---------------------------------------------------------------------------

import type React from 'react';
import { useEffect } from 'react';
import type { CloudPauseReason } from '../services/cloudSyncEngine';
import { Z } from './overlayLayers';

export const CLOUD_TRANSCRIPTION_PAUSE_COPY = {
  title: 'Cloud transcription paused',
  reason: {
    offline: 'The cloud sync server could not be reached, even after one automatic retry — check your internet connection.',
    'cloud-auth': 'The cloud sync server did not accept this computer’s key — check it in App Settings → Sync Engine → Cloud sync.',
    'inference-failed': 'The cloud transcription failed.',
  } satisfies Record<CloudPauseReason, string>,
  hint: 'Nothing was changed. The voiceover stays staged.',
  retryLabel: 'Try the cloud again',
  useLocalLabel: 'Transcribe on this computer',
  useLocalHint: '(this voiceover only — your Cloud setting stays as it is)',
  cancelLabel: 'Cancel',
} as const;

const COPY = CLOUD_TRANSCRIPTION_PAUSE_COPY;

interface Props {
  reason: CloudPauseReason;
  /** The typed failure's own sentence, shown small under the reason. */
  detail?: string;
  onRetry: () => void;
  onUseLocal: () => void;
  onCancel: () => void;
}

export function CloudTranscriptionPausedDialog({ reason, detail, onRetry, onUseLocal, onCancel }: Props): React.ReactElement {
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
      className={`fixed inset-0 ${Z.dialog} flex items-center justify-center bg-black/80 backdrop-blur-sm`}
    >
      <div className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-sm shadow-2xl">
        <h2 className="text-sm font-black uppercase tracking-[0.2em] mb-4">{COPY.title}</h2>
        <p className="text-sm text-gray-300 mb-2">{COPY.reason[reason]}</p>
        {detail && <p className="text-xs text-gray-500 font-mono mb-2 break-words">{detail}</p>}
        <p className="text-xs text-gray-500 mb-6">{COPY.hint}</p>
        <div className="space-y-2">
          <button
            data-testid="cloud-transcription-retry"
            onClick={onRetry}
            className="w-full bg-[#F27D26] text-black font-bold text-sm py-3 rounded-xl hover:brightness-110 transition"
          >
            {COPY.retryLabel}
          </button>
          <button
            data-testid="cloud-transcription-use-local"
            onClick={onUseLocal}
            className="w-full bg-[#1A1A1A] border border-[#282828] text-sm py-3 rounded-xl hover:border-[#F27D26] transition"
          >
            {COPY.useLocalLabel}
            <span className="block text-[10px] text-gray-500 mt-1">{COPY.useLocalHint}</span>
          </button>
          <button
            data-testid="cloud-transcription-cancel"
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
