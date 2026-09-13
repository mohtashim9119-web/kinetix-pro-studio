/**
 * IndexedDB → native asset migration progress — presentation only.
 *
 * Every count arrives as a prop. This view formats those numbers; it does
 * not derive remaining from total/completed, and it does not decide
 * resumability from the counts. Resume / retry are caller-owned.
 */

import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

export type IdbToNativeMigrationStatus =
  | 'in-progress'
  | 'per-asset-failure'
  | 'partial'
  | 'resumable';

export interface MigrationFailedAsset {
  id: string;
  name: string;
}

export interface IdbToNativeMigrationViewProps {
  status: IdbToNativeMigrationStatus;
  total: number;
  completed: number;
  failed: number;
  remaining: number;
  failedAssets: readonly MigrationFailedAsset[];
  /** Caller-owned. Resume is shown only when this flag is true. */
  resumable: boolean;
  onResume?: () => void;
  onRetryFailed?: () => void;
}

const STATUS_LABEL: Record<IdbToNativeMigrationStatus, string> = {
  'in-progress': 'Migrating assets',
  'per-asset-failure': 'Asset copy failed',
  partial: 'Migration partially complete',
  resumable: 'Migration can be resumed',
};

export function IdbToNativeMigrationView({
  status,
  total,
  completed,
  failed,
  remaining,
  failedAssets,
  resumable,
  onResume,
  onRetryFailed,
}: IdbToNativeMigrationViewProps): React.ReactElement {
  return (
    <div
      data-testid="idb-native-migration"
      data-status={status}
      data-resumable={resumable ? 'true' : 'false'}
      className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-md shadow-2xl"
    >
      <div className="flex items-center gap-3 mb-6">
        {status === 'in-progress' ? (
          <Loader2 size={16} className="animate-spin text-[#F27D26]" />
        ) : (
          <AlertCircle size={16} className="text-amber-400" />
        )}
        <h2
          data-testid="migration-status-label"
          className="text-sm font-black uppercase tracking-[0.2em]"
        >
          {STATUS_LABEL[status]}
        </h2>
      </div>

      <dl className="space-y-2 mb-6">
        <CountRow testId="migration-total" label="Total" value={total} />
        <CountRow testId="migration-completed" label="Completed" value={completed} />
        <CountRow testId="migration-failed" label="Failed" value={failed} />
        <CountRow testId="migration-remaining" label="Remaining" value={remaining} />
      </dl>

      {failedAssets.length > 0 && (
        <section data-testid="migration-failed-list" className="space-y-2 mb-6">
          <h3 className="text-[8px] uppercase tracking-widest text-gray-600">Failed assets</h3>
          {failedAssets.map((asset) => (
            <div
              key={asset.id}
              data-testid="migration-failed-asset"
              data-asset-id={asset.id}
              className="bg-[#1A1A1A] border border-[#282828] rounded-lg px-3 py-2 text-[11px] text-gray-200"
            >
              {asset.name}
            </div>
          ))}
        </section>
      )}

      <div className="flex gap-3">
        {resumable && (
          <button
            type="button"
            data-testid="migration-resume"
            onClick={() => onResume?.()}
            className="flex-1 bg-[#F27D26] text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all"
          >
            Resume
          </button>
        )}
        {onRetryFailed && (
          <button
            type="button"
            data-testid="migration-retry-failed"
            onClick={onRetryFailed}
            className="flex-1 bg-transparent border border-[#282828] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:border-gray-500 transition-all"
          >
            Retry failed
          </button>
        )}
      </div>
    </div>
  );
}

function CountRow({
  testId,
  label,
  value,
}: {
  testId: string;
  label: string;
  value: number;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[8px] uppercase tracking-widest text-gray-600">{label}</dt>
      <dd data-testid={testId} className="text-[11px] font-bold text-gray-200">
        {value}
      </dd>
    </div>
  );
}
