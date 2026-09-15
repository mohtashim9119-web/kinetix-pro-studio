/**
 * In-memory doubles for the export-failure message layer. No Tauri, no
 * session directory, no file picker.
 */

export interface ExportFailureActionsFake {
  onResume: () => void;
  onReclaim: () => void;
  onOpenDegradedRecovery: () => void;
  onRepairTimeline: () => void;
  onDismiss: () => void;
  onCopyDiagnostics: () => void;
  resumeCount: number;
  reclaimCount: number;
  openDegradedRecoveryCount: number;
  repairTimelineCount: number;
  dismissCount: number;
  copyDiagnosticsCount: number;
}

export function createExportFailureActionsFake(): ExportFailureActionsFake {
  let resumeCount = 0;
  let reclaimCount = 0;
  let openDegradedRecoveryCount = 0;
  let repairTimelineCount = 0;
  let dismissCount = 0;
  let copyDiagnosticsCount = 0;

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
    onRepairTimeline(): void {
      repairTimelineCount += 1;
    },
    onDismiss(): void {
      dismissCount += 1;
    },
    onCopyDiagnostics(): void {
      copyDiagnosticsCount += 1;
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
    get repairTimelineCount(): number {
      return repairTimelineCount;
    },
    get dismissCount(): number {
      return dismissCount;
    },
    get copyDiagnosticsCount(): number {
      return copyDiagnosticsCount;
    },
  };
}
