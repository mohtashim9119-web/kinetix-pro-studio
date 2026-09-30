/**
 * Storage consistency scan — the client for `storage_consistency_scan`
 * (`src-tauri/src/storage_consistency.rs`). Compares what the dashboard lists
 * against what is on disk and returns typed findings; read-only.
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauriFfmpeg';
import { deletedProjectIds, loadAllMetas } from './projectStore';

export type ConsistencyFindingKind =
  | 'recordNotOnDashboard'
  | 'dashboardWithoutRecord'
  | 'dataWithoutRecord'
  | 'emptyStoreDir';

export interface ConsistencyPath {
  role: 'storeRecord' | 'assets' | 'mirrorRecord' | 'storeDir' | 'vaultRefs';
  /** Empty for `vaultRefs` (a set of registry entries, not a path). */
  path: string;
  bytes: number;
  files: number;
  modifiedMs: number;
}

export interface ConsistencyFinding {
  id: string;
  kind: ConsistencyFindingKind;
  name: string | null;
  segmentCount: number | null;
  tombstoned: boolean;
  paths: ConsistencyPath[];
}

export interface ConsistencyReport {
  findings: ConsistencyFinding[];
  totalBytes: number;
  idsExamined: number;
}

export async function scanStorageConsistency(): Promise<ConsistencyReport> {
  if (!isTauri()) throw new Error('scanStorageConsistency: desktop app only');
  return invoke<ConsistencyReport>('storage_consistency_scan', {
    dashboardIds: loadAllMetas().map(m => m.id),
    deletedIds: [...deletedProjectIds()],
  });
}

/** One plain-language line per finding kind — what the operator is looking at. */
export function describeFinding(f: ConsistencyFinding): string {
  const who = f.name ? `“${f.name}”` : 'an unnamed project';
  switch (f.kind) {
    case 'recordNotOnDashboard':
      return `${who} is saved on disk but not listed on this dashboard.`;
    case 'dashboardWithoutRecord':
      return `The dashboard lists ${who}, but its saved data is missing.`;
    case 'dataWithoutRecord':
      return f.tombstoned
        ? `Leftover files from a deleted project (${who}).`
        : `Files belonging to ${who} remain, but the project itself is gone.`;
    case 'emptyStoreDir':
      return 'An empty project folder with no saved project inside.';
  }
}
