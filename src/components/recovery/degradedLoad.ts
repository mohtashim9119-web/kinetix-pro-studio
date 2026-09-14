/**
 * Degraded-load model — props a future App.tsx can pass without this
 * slice knowing about IndexedDB, native copies, or autosave.
 *
 * A project can keep segment metadata after Chromium evicts media bytes
 * (`docs/ws3-export-pipeline/persistence-layer-audit.md` at 01e565d). Opening that
 * project must not persist. `canPersistRecoveredProject` is the UI-side
 * gate: if any asset is unresolved, Save is not a legal affordance.
 */

export type SegmentResolutionStatus = 'resolved' | 'unresolved' | 'missing-asset';

export interface RecoverySegment {
  id: string;
  label: string;
  assetId: string | null;
  resolutionStatus: SegmentResolutionStatus;
}

/**
 * `nativeCopyExists`/`backupExists` (this module's original shape) modeled a
 * distinction that doesn't exist in the shipped architecture:
 * `assetRecovery.ts`'s `AssetRecoveryEntry` collapses both into one
 * `nativeResolved` — the native store IS the durable backing copy once the
 * IndexedDB cache is gone, there is no separate "backup" an asset could sit
 * in instead. An asset with EITHER a cache or native copy is `resolved`, full
 * stop; nothing about a native-vs-backup split is ever surfaced to the user
 * because there is nothing left for the user to choose between. `unresolved`
 * here is therefore exactly "neither copy exists" — the one state that still
 * needs a decision, and the only one this screen has anything to say about.
 */
export interface RecoveryAsset {
  id: string;
  name: string;
  unresolved: boolean;
}

export function canPersistRecoveredProject(input: {
  assets: readonly RecoveryAsset[];
  segments: readonly RecoverySegment[];
}): boolean {
  if (input.assets.some((asset) => asset.unresolved)) return false;
  if (input.segments.some((segment) => segment.resolutionStatus !== 'resolved')) return false;
  return true;
}

export function unresolvedAssetIds(assets: readonly RecoveryAsset[]): string[] {
  return assets.filter((asset) => asset.unresolved).map((asset) => asset.id);
}

/**
 * One row in the collapsed recovery list — segment text, asset filename,
 * resolution status, and the per-row re-link action live together so the
 * operator is not forced to correlate separate segment and asset sections
 * by eye (the 42-asset Machine-1 case).
 */
export interface RecoveryItemRow {
  /** Stable React key — segment id, or `orphan-<assetId>` for assets not on any segment. */
  rowId: string;
  segmentLabel: string | null;
  assetId: string | null;
  assetName: string | null;
  resolutionStatus: SegmentResolutionStatus;
  /** When true, the row shows a per-asset Re-link affordance. */
  showRelink: boolean;
}

function resolutionStatusLabel(status: SegmentResolutionStatus): string {
  if (status === 'resolved') return 'Resolved';
  if (status === 'missing-asset') return 'Missing asset';
  return 'Unresolved';
}

export { resolutionStatusLabel as recoveryResolutionStatusLabel };

/**
 * Collapses the separate segment and asset lists into one operator-facing
 * table. Primary rows follow segments (each shows its segment text + linked
 * asset filename + resolution status). Unresolved assets that no segment
 * references are appended as orphan rows so nothing is hidden.
 */
export function buildRecoveryItemRows(
  segments: readonly RecoverySegment[],
  assets: readonly RecoveryAsset[],
): RecoveryItemRow[] {
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const referencedAssetIds = new Set<string>();

  const segmentRows: RecoveryItemRow[] = segments.map((segment) => {
    if (segment.assetId) referencedAssetIds.add(segment.assetId);
    const asset = segment.assetId ? assetById.get(segment.assetId) : undefined;
    return {
      rowId: segment.id,
      segmentLabel: segment.label,
      assetId: segment.assetId,
      assetName: asset?.name ?? null,
      resolutionStatus: segment.resolutionStatus,
      showRelink: asset?.unresolved === true,
    };
  });

  const orphanRows: RecoveryItemRow[] = assets
    .filter((asset) => asset.unresolved && !referencedAssetIds.has(asset.id))
    .map((asset) => ({
      rowId: `orphan-${asset.id}`,
      segmentLabel: null,
      assetId: asset.id,
      assetName: asset.name,
      resolutionStatus: 'unresolved' as const,
      showRelink: true,
    }));

  return [...segmentRows, ...orphanRows];
}
