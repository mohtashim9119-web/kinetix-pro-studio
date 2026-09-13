/**
 * In-memory doubles for the export-failure message layer. No Tauri, no
 * session directory, no file picker.
 */

export interface ExportFailureActionsFake {
  onResume: () => void;
  onReclaim: () => void;
  onOpenDegradedRecovery: () => void;
  resumeCount: number;
  reclaimCount: number;
  openDegradedRecoveryCount: number;
}

export function createExportFailureActionsFake(): ExportFailureActionsFake {
  let resumeCount = 0;
  let reclaimCount = 0;
  let openDegradedRecoveryCount = 0;

  return {
    onResume(): void {
      resumeCount += 1;
    },
    onReclaim(): void {
      reclaimCount += 1;
    },
    onOpenDegradedRecovery(): void {
      openDegradedRecoveryCount += 1;
    },
    get resumeCount(): number {
      return resumeCount;
    },
    get reclaimCount(): number {
      return reclaimCount;
    },
    get openDegradedRecoveryCount(): number {
      return openDegradedRecoveryCount;
    },
  };
}
