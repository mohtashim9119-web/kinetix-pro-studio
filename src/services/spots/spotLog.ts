/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SyncLogEntry } from '../../types';
import { makeSyncLogEntry } from '../syncLog';
import type { SpotFinding } from './spotFinding';

/** Layer-2 findings as sync-log entries: 'info', details-only, never prose-matched. */
export function buildSpotFindingEntries(syncRunId: string, findings: readonly Pick<SpotFinding, 'kind' | 'message'>[]): SyncLogEntry[] {
  return findings.map(f => makeSyncLogEntry(syncRunId, 'info', f.message, { finding: { kind: f.kind } }));
}
