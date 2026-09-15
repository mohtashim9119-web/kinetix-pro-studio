/**
 * Storage-root relocation view — presentation only.
 *
 * Current root, target volume, required bytes, available bytes, and
 * validation state all arrive as props. This view displays them; it does
 * not compare required vs available to decide ok / insufficient / error.
 * A later host feeds those numbers from the surviving disk estimator
 * (see `.cursor/ws3-size-estimators.md`).
 */

import React from 'react';
import { FolderOpen } from 'lucide-react';
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
  /**
   * Round 28 Increment 1 — true while a copy is in flight. Disables the
   * Cancel button and swaps its label/explanation, since a mid-copy cancel
   * cannot be honored (see `useStorageRootRelocation`'s `cancel` comment).
   */
  copying?: boolean;
  /** Dismisses the modal without initiating or committing any relocation. */
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
  copying = false,
  onCancel,
}: StorageRootRelocationViewProps): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Move storage root"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        ref={trapRef}
        data-testid="storage-root-relocation"
        data-validation={validationState}
        className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-md shadow-2xl"
      >
        <h2 className="text-sm font-black uppercase tracking-[0.2em] mb-6">Move storage root</h2>

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
        </dl>

        <p
          data-testid="relocation-validation"
          data-state={validationState}
          className={`mb-6 text-[11px] ${
            validationState === 'ok'
              ? 'text-emerald-300'
              : validationState === 'insufficient'
                ? 'text-amber-300'
                : 'text-red-300'
          }`}
        >
          {VALIDATION_LABEL[validationState]}
        </p>

        {onChooseFolder && (
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

        {onCancel && (
          <>
            <button
              type="button"
              data-testid="relocation-cancel"
              onClick={onCancel}
              disabled={copying}
              title={copying ? 'A copy is already in progress and cannot be cancelled' : undefined}
              className="w-full mt-3 inline-flex items-center justify-center gap-2 bg-transparent border-none p-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-600 hover:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-600 transition-all"
            >
              [ Cancel ]
            </button>
            {copying && (
              <p data-testid="relocation-cancel-explanation" className="mt-2 text-[9px] text-gray-600 text-center">
                Copy already in progress — it cannot be interrupted, only allowed to finish or fail.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
