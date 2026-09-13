/**
 * Successful-but-degraded finish (W17 frame shortfall) — presentation only.
 * Expected / produced / shortfall all arrive as props. This view does not
 * subtract them.
 */

import React from 'react';
import { FINISH_SHORTFALL_COPY } from '../../services/exportFailure/exportFailureCopy';

export interface ExportFinishShortfallCardProps {
  expectedFrames: number;
  producedFrames: number;
  shortfallFrames: number;
}

export function ExportFinishShortfallCard({
  expectedFrames,
  producedFrames,
  shortfallFrames,
}: ExportFinishShortfallCardProps): React.ReactElement {
  return (
    <div
      data-testid="export-finish-shortfall"
      role="status"
      className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-md shadow-2xl"
    >
      <h2
        data-testid="export-finish-shortfall-title"
        className="text-sm font-black uppercase tracking-[0.2em] mb-3"
      >
        {FINISH_SHORTFALL_COPY.title}
      </h2>
      <p data-testid="export-finish-shortfall-body" className="text-[11px] text-gray-400 mb-6">
        {FINISH_SHORTFALL_COPY.body}
      </p>
      <dl className="space-y-2">
        <CountRow testId="export-shortfall-expected" label="Expected frames" value={expectedFrames} />
        <CountRow testId="export-shortfall-produced" label="Produced frames" value={producedFrames} />
        <CountRow testId="export-shortfall-missing" label="Shortfall" value={shortfallFrames} />
      </dl>
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
