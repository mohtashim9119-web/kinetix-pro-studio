/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Media-vault registry recovery findings — the client for
 * `media_vault_recovery.rs`. When `media-vault/registry.json` cannot be parsed
 * the native loader repairs it (salvage → last-good → rebuild) and records a
 * typed finding; this surfaces those records, never silently: the sync-log
 * view carries an attention line until the user dismisses it, and Storage
 * settings keeps the full history.
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauriFfmpeg';

export type VaultRecoveryMode = 'salvage' | 'lastgood' | 'rebuild';

/** Mirrors `VaultRecoveryFinding` (camelCase over IPC). */
export interface VaultRecoveryFinding {
  /** `vault-registry-recovered` | `vault-lastgood-unverified`. */
  kind: string;
  mode?: VaultRecoveryMode | null;
  atMs: number;
  entriesRecovered: number;
  corruptSha256: string;
  corruptBytes: number;
  trailingBytesDiscarded?: number | null;
  refsRederived?: number | null;
  renamedTitlesReverted?: number | null;
  quarantinePath: string;
  detail: string;
  acknowledged: boolean;
}

export async function fetchVaultRecoveryFindings(): Promise<VaultRecoveryFinding[]> {
  if (!isTauri()) return [];
  return invoke<VaultRecoveryFinding[]>('media_vault_recovery_findings');
}

export async function acknowledgeVaultRecovery(): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>('media_vault_recovery_acknowledge');
}

export const unacknowledgedFindings = (all: readonly VaultRecoveryFinding[]): VaultRecoveryFinding[] =>
  all.filter(f => !f.acknowledged);

/** One plain-language line for a finding. */
export function describeVaultRecovery(f: VaultRecoveryFinding): string {
  const n = f.entriesRecovered;
  const entries = `${n} media item${n === 1 ? '' : 's'}`;
  if (f.kind === 'vault-lastgood-unverified') {
    return 'The media library’s backup copy could not be verified and was removed; a fresh one is written on the next change.';
  }
  switch (f.mode) {
    case 'salvage':
      return `The media library index was damaged and was repaired with nothing lost (${entries} kept).`;
    case 'lastgood':
      return `The media library index was damaged and was restored from its backup copy (${entries}); changes made after that copy was written may need re-importing.`;
    case 'rebuild': {
      const reverted = f.renamedTitlesReverted ?? 0;
      const tail = reverted > 0
        ? ` ${reverted} title${reverted === 1 ? '' : 's'} could not be recovered and show a placeholder filename.`
        : '';
      return `The media library index was damaged and was rebuilt from your files (${entries}).${tail}`;
    }
    default:
      return f.detail;
  }
}
