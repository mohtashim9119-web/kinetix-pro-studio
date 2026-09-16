/**
 * Storage-root relocation view — presentation only.
 *
 * Current root, target volume, required bytes, available bytes, and
 * validation state all arrive as props. This view displays them; it does
 * not compare required vs available to decide ok / insufficient / error.
 * A later host feeds those numbers from the surviving disk estimator
 * (see `.cursor/ws3-size-estimators.md`).
 */

import React, { useEffect } from 'react';
import { FolderOpen, X } from 'lucide-react';
import { formatBytes } from '../../services/webcodecsExport/diskFull';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export type StorageRootValidationState = 'ok' | 'insufficient' | 'error';

export interface StorageRootRelocationViewProps {
  currentRoot: string;
  targetVolume: string;
  requiredBytes: number;
  availableBytes: number;
  validationState: StorageRootValidationState;
  onChooseFolder?: () => void;
  /** "Reset to default location" fix (WS3 Round 29, approved) — relocates straight to the OS default. Rendered only when both this and `isDefault === false` are given. */
  onResetToDefault?: () => void;
  /** True when `currentRoot` already IS the OS default — hides the reset button. */
  isDefault?: boolean;
  /** True while a copy is in flight — swaps the explanation text below Cancel. */
  copying?: boolean;
  /**
   * D15 fix (WS3 Round 29) — true from the moment the operator clicks
   * Cancel during a copy until the in-flight `relocateStorageRoot` call
   * actually rejects. Disables the button for that (typically sub-second)
   * span so a double-click can't fire the native cancel command twice;
   * `copying` alone no longer disables it, since cancelling mid-copy now
   * genuinely works.
   */
  cancelling?: boolean;
  /** D18 fix (WS3 Round 29) — live copy progress; `null` until the first event lands (a brief span right after Choose folder, before any bytes have moved). */
  progress?: { bytesDone: number; bytesTotal: number } | null;
  /** D-verify-feedback fix (WS3 Round 29) — true once the copy loop has moved into post-copy digest verification (a real, sometimes 30+ second span with no byte-level progress of its own). */
  verifying?: boolean;
  /** D17 fix (WS3 Round 29) — the verbatim refusal message for `validationState === 'error'`. */
  errorMessage?: string | null;
  /**
   * Background-continuation fix (WS3 Round 29, operator decision) — the X
   * button and Escape key. Pre-copy, a plain dismiss. Mid-copy, hides the
   * modal WITHOUT cancelling the relocation, which keeps running in the
   * background; see the hook's own `dismiss` doc comment.
   */
  onDismiss?: () => void;
  /** The bottom "[ Cancel ]" button's actual cancel — genuinely stops the in-flight relocation; see the hook's own `cancel` doc comment. */
  onCancel?: () => void;
}

const VALIDATION_LABEL: Record<StorageRootValidationState, string> = {
  ok: 'Target volume has enough space',
  insufficient: 'Not enough space on the target volume',
  error: 'Could not validate the target volume',
};

export function StorageRootRelocationView({
  currentRoot,
  targetVolume,
  requiredBytes,
  availableBytes,
  validationState,
  onChooseFolder,
  onResetToDefault,
  isDefault = false,
  copying = false,
  cancelling = false,
  progress = null,
  verifying = false,
  errorMessage = null,
  onDismiss,
  onCancel,
}: StorageRootRelocationViewProps): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();

  // D16 fix (WS3 Round 29) — Escape dismisses this modal, same as every
  // other top-level overlay (AppSettingsModal, ProjectSettingsModal,
  // NewProjectModal). Background-continuation fix (WS3 Round 29, operator
  // decision): routed through `onDismiss`, NOT `onCancel` — mid-copy this
  // only hides the modal, it does not stop the relocation.
  useEffect(() => {
    if (!onDismiss) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onDismiss]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Move storage root"
      // D16 fix (WS3 Round 29): AppSettingsModal (App.tsx's launch point for
      // this view) paints at z-[210] — this view was left at the pre-Batch-2
      // z-[200] despite the App.tsx mount comment above already saying it's
      // meant to render ABOVE Settings, so Settings painted over it instead.
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        ref={trapRef}
        data-testid="storage-root-relocation"
        data-validation={validationState}
        className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-md shadow-2xl"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-black uppercase tracking-[0.2em]">Move storage root</h2>
          {onDismiss && (
            <button
              onClick={onDismiss}
              aria-label="Close"
              title={copying ? 'Hide — the copy keeps running in the background' : undefined}
              className="text-gray-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#F27D26] rounded"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <dl className="space-y-3 mb-6">
          <div>
            <dt className="text-[8px] uppercase tracking-widest text-gray-600">Current root</dt>
            <dd
              data-testid="relocation-current-root"
              className="text-[11px] font-bold text-gray-200 break-all"
            >
              {currentRoot}
            </dd>
          </div>
          <div>
            <dt className="text-[8px] uppercase tracking-widest text-gray-600">Target volume</dt>
            <dd
              data-testid="relocation-target-volume"
              className="text-[11px] font-bold text-gray-200 break-all"
            >
              {targetVolume}
            </dd>
          </div>
          {/* D17 fix (WS3 Round 29) — Required/Available/validation used to
              render from the moment the modal opened, before the operator
              had even picked a target folder — the hook's own placeholder
              state defaults `validationState` to 'error' and `availableBytes`
              to 0 until a real check runs, so "Could not validate the target
              volume" / "0 B" appeared as if it were a real failure on every
              open. Gated on `targetVolume` being non-empty (only true once
              Choose Folder has actually returned a path) instead. */}
          {!copying && targetVolume && (
            <>
              <div className="flex items-center justify-between">
                <dt className="text-[8px] uppercase tracking-widest text-gray-600">Required</dt>
                <dd data-testid="relocation-required-bytes" className="text-[11px] font-bold text-gray-200">
                  {formatBytes(requiredBytes)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[8px] uppercase tracking-widest text-gray-600">Available</dt>
                <dd data-testid="relocation-available-bytes" className="text-[11px] font-bold text-gray-200">
                  {formatBytes(availableBytes)}
                </dd>
              </div>
            </>
          )}
        </dl>

        {/* D18 fix (WS3 Round 29) — a real 0-100% bar driven by
            `RelocationEvent::Progress`, replacing the old silent "Copying…"
            text the operator had no way to distinguish from a hang. */}
        {copying ? (
          <div className="mb-6" data-testid="relocation-progress">
            <div className="w-full h-2 bg-[#1a1a1a] rounded-full overflow-hidden mb-2">
              {/* D-verify-flicker fix (WS3 Round 29) — this used to be ONE
                  div whose className/inline-width both changed at once when
                  `verifying` flipped true. `transition-all` and
                  `animate-pulse` landing mid-cycle on the SAME element
                  produced a visible light/dark split right at the jump.
                  Rendering two DIFFERENT-shaped branches wasn't enough by
                  itself to stop this — both branches render a `<div>` at
                  the same tree position with no `key`, so React's
                  reconciler treated them as the SAME element and just
                  patched its class/style in place rather than truly
                  unmounting and remounting, which meant the OLD element's
                  `transition-all` was still "in flight" for that commit and
                  animated the width jump exactly as before. Explicit,
                  distinct `key`s force a genuine unmount/remount: the
                  verifying bar is now a brand-new DOM node with no
                  transition history to inherit, full width and pulsing
                  from its very first paint. */}
              {verifying ? (
                <div key="verifying" className="h-full w-full bg-[#F27D26] animate-pulse" />
              ) : (
                <div
                  key="copying"
                  className="h-full bg-[#F27D26] transition-all duration-200"
                  style={{
                    width: progress
                      ? `${Math.min(100, Math.round((progress.bytesDone / Math.max(1, progress.bytesTotal)) * 100))}%`
                      : '2%',
                  }}
                />
              )}
            </div>
            <p className="text-[10px] text-gray-400 text-center">
              {/* D-verify-feedback fix (WS3 Round 29) — checked FIRST: once
                  the copy loop moves into verification, the byte counter
                  above is stale (it only ever tracked the copy phase) and
                  must not keep being shown as if still live — this text and
                  the bar's pulse are the only feedback for what can be a
                  real 30+ second span. */}
              {verifying
                ? 'Verifying integrity…'
                : progress
                  ? `${formatBytes(progress.bytesDone)} of ${formatBytes(progress.bytesTotal)} (${Math.min(
                      100,
                      Math.round((progress.bytesDone / Math.max(1, progress.bytesTotal)) * 100),
                    )}%)`
                  : 'Starting…'}
            </p>
          </div>
        ) : targetVolume ? (
          <>
            <p
              data-testid="relocation-validation"
              data-state={validationState}
              className={`mb-2 text-[11px] ${
                validationState === 'ok'
                  ? 'text-emerald-300'
                  : validationState === 'insufficient'
                    ? 'text-amber-300'
                    : 'text-red-300'
              }`}
            >
              {VALIDATION_LABEL[validationState]}
            </p>
            {errorMessage && (
              <p data-testid="relocation-error-detail" className="mb-6 text-[10px] text-red-400/80 break-words">
                {errorMessage}
              </p>
            )}
            {!errorMessage && <div className="mb-6" />}
          </>
        ) : (
          <div className="mb-6" />
        )}

        {/* Per operator decision (WS3 Round 29): once a copy is running,
            only progress + Cancel make sense here — "Choose folder" and
            "Reset to default location" are pre-copy decisions, not actions
            you can take mid-copy (both are already `disabled` in that
            state), so showing them at all was just visual noise. */}
        {onChooseFolder && !copying && (
          <button
            type="button"
            data-testid="relocation-choose-folder"
            onClick={onChooseFolder}
            className="w-full inline-flex items-center justify-center gap-2 bg-transparent border border-[#282828] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:border-gray-500 transition-all"
          >
            <FolderOpen size={14} />
            Choose folder
          </button>
        )}

        {/* "Reset to default location" fix (WS3 Round 29, approved) —
            relocates straight back to the OS default without navigating a
            folder picker to find it. Hidden once already at default, or
            once a copy is running (see the comment above). */}
        {onResetToDefault && !isDefault && !copying && (
          <button
            type="button"
            data-testid="relocation-reset-default"
            onClick={onResetToDefault}
            className="w-full mt-2 inline-flex items-center justify-center gap-2 bg-transparent border border-[#282828] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:border-gray-500 transition-all"
          >
            Reset to default location
          </button>
        )}

        {onCancel && (
          <>
            <button
              type="button"
              data-testid="relocation-cancel"
              onClick={onCancel}
              disabled={cancelling}
              title={cancelling ? 'Cancelling — finishing the current file' : undefined}
              className="w-full mt-3 inline-flex items-center justify-center gap-2 bg-transparent border-none p-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-600 hover:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-600 transition-all"
            >
              {cancelling ? '[ Cancelling… ]' : '[ Cancel ]'}
            </button>
            {copying && (
              <p data-testid="relocation-cancel-explanation" className="mt-2 text-[9px] text-gray-600 text-center">
                {cancelling
                  ? 'Stopping — the copy will abort as soon as the current file finishes.'
                  : /* No-auto-delete/resume fix (WS3 Round 29, operator decision) — files
                       already copied are no longer discarded on cancel; the old location
                       stays untouched either way, and the partial copy is left in place
                       so a later relocation to the same folder resumes instead of
                       restarting, or it can be cleaned up manually from Settings. */
                    'Copying — click Cancel to stop. Files already copied are kept, so a retry to the same folder resumes instead of restarting.'}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
