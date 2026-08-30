/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 ws2-26 Commit 2 — the Forced Restore confirmation modal.
//
// A restore request (sync-log checkbox or Timeline right-click "Restore
// absorbed segments") can name a mix of evidence-backed and zero-evidence
// gaps. The evidence-backed ones restore immediately, automatically — this
// modal exists only for the zero-evidence remainder: `App.tsx` never fails
// silently on those (ws2-26 Commit 1's whole point), it asks a human instead,
// naming exactly what evidence is missing.
//
// ONE MODAL FOR THE WHOLE BATCH, not one per row — a multi-select restore
// that includes several zero-evidence rows lists every one of them here and
// confirms once. Cancelling leaves ALL of them untouched; there is no
// per-row confirm/cancel split.
// ---------------------------------------------------------------------------
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { PendingForceRestoreCluster } from '../services/absorbedGapRestore';

interface Props {
  /** One entry per zero-evidence cluster pending confirmation — see
   *  `collectPendingForceRestores`. Never empty when this modal is rendered
   *  (the caller doesn't render it otherwise). */
  clusters: readonly PendingForceRestoreCluster[];
  /** Leaves the timeline untouched — none of `clusters` are restored. */
  onCancel: () => void;
  /** Force-restores every gap named across every cluster in one batch. */
  onConfirm: () => void;
}

export function ForceRestoreConfirmModal({ clusters, onCancel, onConfirm }: Props): React.ReactElement {
  const rowCount = clusters.reduce((n, c) => n + c.items.length, 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Force Restore"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-md shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle size={20} className="text-amber-400 flex-shrink-0" />
          <h2 className="text-sm font-black uppercase tracking-[0.2em]">
            {rowCount === 1 ? 'Force restore this scene?' : `Force restore ${rowCount} scenes?`}
          </h2>
        </div>

        <p className="text-[11px] text-gray-400 leading-snug mb-4">
          {rowCount === 1 ? 'This scene has' : 'These scenes each have'} 0 matched words and no
          timestamp data — the transcript never recorded anything for{' '}
          {rowCount === 1 ? 'it' : 'them'}. Restoring anyway sizes the clip by character count
          across the gap, a guess with no audio evidence behind it.
        </p>

        <ul className="space-y-2 max-h-56 overflow-y-auto mb-6 pr-1">
          {clusters.flatMap((cluster) => cluster.items).map((item) => (
            <li
              key={item.segmentId}
              className="bg-[#1A1A1A] border border-[#282828] rounded-lg px-3 py-2"
            >
              <p className="text-[10px] text-gray-300 leading-snug break-words">{item.text}</p>
              <p className="text-[9px] text-amber-500/80 uppercase tracking-widest mt-1">
                0 matched words · no timestamp data
              </p>
            </li>
          ))}
        </ul>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 bg-transparent border border-[#282828] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:border-gray-500 transition-all focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 bg-amber-500 text-black p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-400 transition-all focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            Force Restore
          </button>
        </div>
      </div>
    </div>
  );
}
