/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T4.7 Requirement 3 — the recovery banner.
//
// Rendered whenever the open project carries a `Project.unappliedTranscript`:
// a transcription that finished but that no Apply Sync ever consumed. It offers
// the two actions and nothing else.
//
// IT ALWAYS ASKS. There is no auto-apply path and there must not be one, in
// either direction:
//   • Auto-APPLYING would rewrite the user's timeline on open, from a decision
//     they never made, using a transcript they may have deliberately abandoned.
//   • Auto-DISCARDING a transcript that looks stale would destroy the exact
//     work this requirement exists to preserve, on a heuristic.
// So a stale-looking record changes the WORDING and nothing else — the user
// still gets both buttons and makes the call. See `unappliedTranscript.ts`'s
// `unappliedTranscriptStaleness`.
//
// APPLY IS ASYNC AND CAN FAIL. `onApply` returns a promise; the banner stays
// mounted and disabled while it runs, and — critically — stays mounted if it
// resolves false. A failed apply must leave the user exactly where they were,
// with the offer still on screen, because the transcript is still on disk.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { AlertTriangle, FileText } from 'lucide-react';
import type { UnappliedTranscript } from '../types';
import type { UnappliedTranscriptStaleness } from '../services/unappliedTranscript';

export interface UnappliedTranscriptBannerProps {
  record: UnappliedTranscript;
  staleness: UnappliedTranscriptStaleness;
  /** Resolves `true` only when the timeline write actually completed. The
   *  caller — not this component — is what clears the stored record on a
   *  `true`; the banner only stops rendering because the record went away. */
  onApply: () => Promise<boolean>;
  onDiscard: () => void;
}

/** "1,204 words · 4 Sept 2026, 14:02" — falls back gracefully on an
 *  unparseable timestamp rather than rendering "Invalid Date". */
function describeRecord(record: UnappliedTranscript): string {
  const words = `${record.tokens.length.toLocaleString()} word${record.tokens.length === 1 ? '' : 's'}`;
  const when = new Date(record.completedAt);
  if (Number.isNaN(when.getTime())) return words;
  return `${words} · ${when.toLocaleString()}`;
}

export function UnappliedTranscriptBanner({
  record,
  staleness,
  onApply,
  onDiscard,
}: UnappliedTranscriptBannerProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const stale = staleness === 'stale';

  const handleApply = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await onApply();
    } catch (err) {
      // A THROWN apply is a FAILED apply, handled here rather than escaping.
      // The caller (App.tsx) already catches internally and resolves `false`,
      // so this is defence for any other caller: without it a rejection
      // escapes the click handler as an unhandled promise rejection, which in
      // this app's WKWebView shell is invisible — the user would see the
      // buttons come back with no indication anything went wrong, and no log.
      // The banner stays mounted either way; the transcript is still on disk.
      console.error('[recovery] applying the unapplied transcript threw:', err);
    } finally {
      // Unconditional: on success this component unmounts anyway (the record is
      // gone), and on failure the buttons MUST come back — a banner left
      // permanently disabled after a failed apply is a dead end holding the
      // user's only recovery path hostage.
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      data-testid="unapplied-transcript-banner"
      className={`w-full flex items-center gap-3 text-sm font-medium
                  px-5 py-3 rounded-2xl shadow-xl backdrop-blur-md max-w-2xl mx-auto border
                  ${stale
                    ? 'bg-amber-900/90 border-amber-500/50 text-amber-100'
                    : 'bg-sky-900/90 border-sky-500/50 text-sky-100'}`}
    >
      {stale
        ? <AlertTriangle size={16} className="shrink-0 text-amber-300" />
        : <FileText size={16} className="shrink-0 text-sky-300" />}
      <span className="flex-1">
        {stale
          ? 'A finished transcription is waiting, but the project’s voiceover has changed since it ran — applying it may mistime the timeline.'
          : 'A finished transcription was never applied to the timeline.'}
        <span className="block text-xs opacity-70">{describeRecord(record)}</span>
      </span>
      <button
        type="button"
        onClick={() => { void handleApply(); }}
        disabled={busy}
        className="shrink-0 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-50
                   disabled:cursor-not-allowed transition-colors"
      >
        {busy ? 'Applying…' : 'Apply Sync to Timeline'}
      </button>
      <button
        type="button"
        onClick={onDiscard}
        disabled={busy}
        className="shrink-0 px-3 py-1.5 rounded-lg border border-white/20 hover:bg-white/10
                   disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Discard
      </button>
    </div>
  );
}
