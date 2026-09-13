/**
 * Resume-unavailable — the no-progress / retention-failed explanation.
 * Not kind-specific. Presentation only.
 */

import React from 'react';
import { RESUME_UNAVAILABLE_COPY } from '../../services/exportFailure/exportFailureCopy';

export function ExportResumeUnavailableCard(): React.ReactElement {
  return (
    <div
      data-testid="export-resume-unavailable"
      role="status"
      className="border border-amber-500/40 bg-amber-500/10 rounded-lg px-3 py-2 text-left"
    >
      <p
        data-testid="export-resume-unavailable-title"
        className="text-[9px] font-black uppercase tracking-widest text-amber-300 mb-1"
      >
        {RESUME_UNAVAILABLE_COPY.title}
      </p>
      <p data-testid="export-resume-unavailable-body" className="text-[11px] text-amber-100">
        {RESUME_UNAVAILABLE_COPY.body}
      </p>
    </div>
  );
}
