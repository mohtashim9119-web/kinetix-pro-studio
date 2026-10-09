/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bulk UI rebuild — the batch's progress read-outs (the dashboard's Bulk Sync
// tab): a small ring and a red dot with a count when any row failed. Same
// palette as the bulk pane (orange progress on the #282828 line, the app's
// red for failure).

import React from 'react';
import { BULK_COPY } from '../services/bulkContext';

export function ProgressRing({ done, total, size = 16 }: { done: number; total: number; size?: number }): React.ReactElement {
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <svg
      data-testid="bulk-ring"
      data-progress={String(Math.round(p * 1000) / 1000)}
      role="img"
      aria-label={BULK_COPY.ringLabel(done, total)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="flex-shrink-0 -rotate-90"
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#282828" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F27D26" strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={c * (1 - p)} strokeLinecap="round"
      />
    </svg>
  );
}

export function FailedDot({ count }: { count: number }): React.ReactElement | null {
  if (count <= 0) return null;
  return (
    <span
      data-testid="bulk-failed-dot"
      aria-label={BULK_COPY.failedCount(count)}
      title={BULK_COPY.failedCount(count)}
      className="flex-shrink-0 min-w-[16px] h-4 rounded-full bg-red-500 px-1 text-center text-[9px] font-black leading-4 text-white"
    >
      {count}
    </span>
  );
}
