/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which vault blobs a set of deleted assets lets go of.
 *
 * A blob is unreferenced for this project only when NO surviving asset (audio
 * included) still carries the same contentHash — the TWIN CASE: legacy
 * projects can hold same-bytes-different-name duplicates mapped onto one
 * shared hash, and deleting one twin must not unreference the blob while its
 * sibling still resolves through it. Each hash appears once however many
 * removed assets carried it.
 *
 * Both single delete and delete-all use this, so the two can never disagree
 * (delete-all once skipped the unreference entirely and pinned every blob
 * against reclaim).
 */

import type { Asset } from '../types';

export function vaultHashesToUnreference(removed: readonly Asset[], remaining: readonly Asset[]): string[] {
  const surviving = new Set(remaining.map(a => a.contentHash).filter((h): h is string => !!h));
  const out = new Set<string>();
  for (const a of removed) {
    if (a.contentHash && !surviving.has(a.contentHash)) out.add(a.contentHash);
  }
  return [...out];
}
