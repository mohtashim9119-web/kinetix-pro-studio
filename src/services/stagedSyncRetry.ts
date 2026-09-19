/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// plan-v3 Wave 1 landing — first-sync pause retry: the dialog can fire before
// DropZonePanel's async IDB restore publishes into `stagedFilesRef`. The retry
// path hydrates from the store when the live snapshot is still empty.

import type { StagedFiles } from '../components/DropZonePanel';
import { isStagedEmpty, loadStagedFromStore } from './stagedFilesPersist';

export const STAGED_NOT_READY_FOR_RETRY_MESSAGE =
  'Staged files are still loading — wait a moment, then try forced alignment again.';

export async function ensureStagedSnapshotReady(
  projectId: string,
  snapshot: StagedFiles,
  publish: (next: StagedFiles) => void,
): Promise<{ ready: true } | { ready: false; message: string }> {
  if (!isStagedEmpty(snapshot)) return { ready: true };
  const restored = await loadStagedFromStore(projectId);
  if (!restored || isStagedEmpty(restored)) {
    return { ready: false, message: STAGED_NOT_READY_FOR_RETRY_MESSAGE };
  }
  publish(restored);
  return { ready: true };
}
