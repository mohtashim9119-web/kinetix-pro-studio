/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wave 3 U9 B1/B2 — the four honest states of a media asset, derived (never
 * stored as a label) from facts the project already carries, plus the typed
 * findings that name them. Same discipline as the sync log's `finding.kind`:
 * every state has a machine-readable kind set at build time, so nothing
 * downstream ever recognises one by its display text.
 *
 *   missing    — the bytes are not there (`unresolved`, the existing offline
 *                machinery; relink or a same-bytes re-upload resolves it).
 *   corrupt    — the bytes are there but a decode/thumbnail/probe failed
 *                (`corrupt`, set by the Media block, persisted).
 *   unverified — resolved but no `contentHash`: identity never verified, so
 *                dedup/relink-by-hash cannot vouch for it yet.
 *   available  — resolved, hashed, decodable as far as anything has checked.
 *
 * Precedence: missing > corrupt > unverified > available (a missing file's
 * old corrupt flag is stale; an unhashed corrupt file is corrupt first).
 */

import type { Asset, SyncLogEntry, SyncLogFindingKind } from '../types';
import { makeSyncLogEntry } from './syncLog';

export type AssetHealthState = 'available' | 'unverified' | 'missing' | 'corrupt';

export function assetHealth(asset: Pick<Asset, 'unresolved' | 'corrupt' | 'contentHash'>): AssetHealthState {
  if (asset.unresolved) return 'missing';
  if (asset.corrupt) return 'corrupt';
  if (!asset.contentHash) return 'unverified';
  return 'available';
}

/** Operator-swappable copy for the chips (label + tooltip). */
export const ASSET_HEALTH_COPY: Record<AssetHealthState, { label: string; title: string }> = {
  available: { label: 'Available', title: 'File is present and verified' },
  unverified: { label: 'Unverified', title: 'File is present, but its content has not been verified yet' },
  missing: { label: 'Missing', title: 'File is offline — click the tile to relink, or re-upload the same file' },
  corrupt: { label: 'Corrupt', title: 'The file could not be read — replace it with a working copy or delete it' },
};

export type AssetHealthFindingKind = Extract<
  SyncLogFindingKind,
  'asset-missing' | 'asset-unverified' | 'asset-corrupt' | 'asset-replaced'
>;

export const HEALTH_STATE_FINDING_KIND: Record<Exclude<AssetHealthState, 'available'>, AssetHealthFindingKind> = {
  missing: 'asset-missing',
  unverified: 'asset-unverified',
  corrupt: 'asset-corrupt',
};

const CORRUPT_REASON: Record<NonNullable<Asset['corrupt']>, string> = {
  'image-decode': 'the image could not be decoded',
  'no-frame': 'no frame could be read from the video',
};

/** ONE grouped, typed finding per state per event. Type 'media-import' so it
 *  lands on the Imports surface with the other media events. */
export function buildAssetHealthEntry(
  syncRunId: string,
  kind: AssetHealthFindingKind,
  assets: readonly Pick<Asset, 'name' | 'corrupt'>[],
  timestamp: number = Date.now(),
): SyncLogEntry {
  const n = assets.length;
  const names = assets.map(a => a.name).join(', ');
  let message: string;
  let severity: 'warning' | 'info' = 'warning';
  switch (kind) {
    case 'asset-missing':
      message = `${n} media file${n === 1 ? ' is' : 's are'} offline: ${names}. Relink or re-upload the same file${n === 1 ? '' : 's'} to bring ${n === 1 ? 'it' : 'them'} back.`;
      break;
    case 'asset-unverified':
      message = `${n} media file${n === 1 ? ' is' : 's are'} unverified (no content hash yet): ${names}.`;
      break;
    case 'asset-corrupt': {
      const why = assets[0]?.corrupt ? ` (${CORRUPT_REASON[assets[0].corrupt]})` : '';
      message = `${n} media file${n === 1 ? ' is' : 's are'} corrupt${n === 1 ? why : ''}: ${names}. Nothing was deleted — replace ${n === 1 ? 'it' : 'them'} with a working copy or delete ${n === 1 ? 'it' : 'them'}.`;
      break;
    }
    case 'asset-replaced':
      message = `Scenes were re-pointed from ${n} corrupt file${n === 1 ? '' : 's'} to a same-named re-upload: ${names}. The corrupt ${n === 1 ? 'file is' : 'files are'} still in Media (unused) until you delete ${n === 1 ? 'it' : 'them'}.`;
      severity = 'info';
      break;
  }
  return makeSyncLogEntry(syncRunId, 'media-import', message, { severity, finding: { kind, count: n } }, timestamp);
}

/**
 * Re-point scenes from a corrupt asset to a healthy re-upload of the SAME
 * NAME (case-insensitive exact filename). Nothing is deleted: the corrupt
 * asset stays in the project, now unused, for the user to delete with the
 * normal confirmation. A scene's binding provenance (`assetAssignedBy`) is
 * preserved. Segments are returned by reference when nothing moves.
 */
export interface ReplaceResult {
  segments: import('../types').VideoSegment[];
  /** The corrupt assets whose scenes moved. */
  replaced: Asset[];
}

export function repointFromCorrupt(
  existing: readonly Asset[],
  incoming: readonly Asset[],
  segments: import('../types').VideoSegment[],
): ReplaceResult {
  const moves = new Map<string, string>();
  const replaced: Asset[] = [];
  for (const fresh of incoming) {
    if (fresh.corrupt || fresh.unresolved) continue;
    const old = existing.find(
      a => a.corrupt && !a.unresolved && a.id !== fresh.id && a.type === fresh.type
        && a.name.trim().toLowerCase() === fresh.name.trim().toLowerCase(),
    );
    if (old && !moves.has(old.id)) {
      moves.set(old.id, fresh.id);
      replaced.push(old);
    }
  }
  if (moves.size === 0) return { segments, replaced };
  let changed = false;
  const next = segments.map(s => {
    const to = s.assetId ? moves.get(s.assetId) : undefined;
    if (!to) return s;
    changed = true;
    return { ...s, assetId: to };
  });
  return { segments: changed ? next : segments, replaced };
}
