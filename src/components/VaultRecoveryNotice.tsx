/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Media-library recovery notice.
//
// An EVENT notice, not a permanent status category: when the native loader
// repaired `media-vault/registry.json` (salvage / last-good / rebuild) it
// persisted a typed finding, and this banner shows for as long as that finding
// is unacknowledged — i.e. from the launch that repaired it until the user
// dismisses it. Dismissing acknowledges the finding durably (it never
// reappears), and the record itself is kept: Storage settings' "Media library
// repairs" block is the durable history. The sync-log user view is deliberately
// NOT involved — it stays its ten run-scoped categories.
// ---------------------------------------------------------------------------

import { AlertTriangle, X } from 'lucide-react';
import { describeVaultRecovery, type VaultRecoveryFinding } from '../services/vaultRecovery';

export interface VaultRecoveryNoticeProps {
  /** Unacknowledged findings only; empty renders nothing. */
  findings: readonly VaultRecoveryFinding[];
  onDismiss: () => void;
}

export function VaultRecoveryNotice({ findings, onDismiss }: VaultRecoveryNoticeProps): React.JSX.Element | null {
  if (findings.length === 0) return null;
  return (
    <div
      role="status"
      data-testid="vault-recovery-notice"
      className="flex items-start gap-3 bg-amber-900/90 border border-amber-500/50 text-amber-100 text-sm font-medium
                 px-5 py-3 rounded-2xl shadow-xl backdrop-blur-md max-w-2xl mx-auto w-full"
    >
      <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-300" />
      <span className="flex-1">
        {findings.map((f) => (
          <span key={`${f.kind}-${f.atMs}-${f.corruptSha256}`} className="block">
            {describeVaultRecovery(f)}
          </span>
        ))}
        <span className="block text-xs opacity-70">
          The damaged copy was kept. Details are in Settings → Storage.
        </span>
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss media library notice"
        className="shrink-0 text-amber-300 hover:text-white transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
}
