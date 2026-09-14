/**
 * In-memory doubles for recovery UI actions. Tests and browser-dev hosts
 * inject these; a later App.tsx swap-in talks to a file picker / native
 * migrate / folder chooser. This module never imports Tauri or IndexedDB.
 */

import type { RelinkTarget } from './DegradedProjectRecoveryScreen';

export interface RecoveryActionsFake {
  onRelink: (target: RelinkTarget) => void;
  onSave: () => void;
  onResume: () => void;
  onRetryFailed: () => void;
  onChooseFolder: () => void;
  relinked: readonly string[];
  saveCount: number;
  resumeCount: number;
  retryFailedCount: number;
  chooseFolderCount: number;
}

export function createRecoveryActionsFake(): RecoveryActionsFake {
  const relinked: string[] = [];
  let saveCount = 0;
  let resumeCount = 0;
  let retryFailedCount = 0;
  let chooseFolderCount = 0;

  return {
    onRelink(target: RelinkTarget): void {
      relinked.push(target.assetId ?? `segment:${target.segmentId}`);
    },
    onSave(): void {
      saveCount += 1;
    },
    onResume(): void {
      resumeCount += 1;
    },
    onRetryFailed(): void {
      retryFailedCount += 1;
    },
    onChooseFolder(): void {
      chooseFolderCount += 1;
    },
    get relinked(): readonly string[] {
      return relinked.slice();
    },
    get saveCount(): number {
      return saveCount;
    },
    get resumeCount(): number {
      return resumeCount;
    },
    get retryFailedCount(): number {
      return retryFailedCount;
    },
    get chooseFolderCount(): number {
      return chooseFolderCount;
    },
  };
}
