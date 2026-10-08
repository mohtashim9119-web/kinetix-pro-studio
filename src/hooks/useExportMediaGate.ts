import { useCallback, useState } from 'react';
import type { Asset, VideoSegment } from '../types';
import { findMediaIssues, hasMediaIssues, type MediaIssues } from '../services/exportFailure/missingMediaMessage';

/** One gate for every way into an export (Export button, re-export Resume):
 *  checks for no/offline/damaged media first and holds the request behind the
 *  warning card until the user chooses. */
export function useExportMediaGate<T>(
  segments: readonly VideoSegment[],
  assets: readonly Asset[],
  onProceed: (payload: T) => void,
): { issues: MediaIssues | null; request: (payload: T) => void; confirm: () => void; cancel: () => void } {
  const [held, setHeld] = useState<{ issues: MediaIssues; payload: T } | null>(null);

  const request = useCallback((payload: T): void => {
    const issues = findMediaIssues(segments, assets);
    if (!hasMediaIssues(issues)) { onProceed(payload); return; }
    setHeld({ issues, payload });
  }, [segments, assets, onProceed]);

  const confirm = useCallback((): void => {
    if (!held) return;
    const { payload } = held;
    setHeld(null);
    onProceed(payload);
  }, [held, onProceed]);

  const cancel = useCallback((): void => setHeld(null), []);

  return { issues: held?.issues ?? null, request, confirm, cancel };
}
