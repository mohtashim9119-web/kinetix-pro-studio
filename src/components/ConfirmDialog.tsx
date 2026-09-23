/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// G6 polish items 3/5 — a small generic confirm/cancel modal, styled after
// SyncPausedDialog.tsx's own dialog shell (fixed inset-0 overlay, role/
// aria-modal, Escape-to-cancel). Used by MediaBlock.tsx for both the bulk
// "Delete unused" confirmation (item 3) and the single used-media delete
// confirmation (item 5) — two different copies, one dialog shell.
// ---------------------------------------------------------------------------

import type React from 'react';
import { useEffect } from 'react';

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
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
      aria-label={title}
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div className="bg-[#111] border border-[#282828] rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <h2 className="text-sm font-black uppercase tracking-[0.2em] mb-3">{title}</h2>
        <p className="text-sm text-gray-300 mb-6">{body}</p>
        <div className="space-y-2">
          <button
            type="button"
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            className="w-full bg-[#F27D26] text-black font-bold text-sm py-2.5 rounded-xl hover:brightness-110 transition"
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            data-testid="confirm-dialog-cancel"
            onClick={onCancel}
            className="w-full text-gray-500 hover:text-white text-sm py-2 transition"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
