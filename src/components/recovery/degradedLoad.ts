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
  /**
   * The original filename this segment was tagged with, recovered from
   * `project.sceneDetails` when `assetId` is null (the asset was deleted).
   * Display-only — there is no asset to re-link bytes into by this name; the
   * operator still picks a file, this just tells them which one.
   */
  expectedFileName?: string | null;
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
 * The header count: every problem the operator still needs to act on.
 * Unresolved assets (bytes missing, id still known) and missing-asset
 * segments (assetId itself is null — the asset was deleted outright) are
 * counted together. Prior to this, the header read only from `assets`, so a
 * project where every problem was a deleted asset (no assetId left to be
 * "unresolved") showed "0 unresolved" while the row list below it listed
 * dozens of "Missing asset" rows — the count and the list disagreed.
 */
export function totalUnresolvedCount(
  assets: readonly RecoveryAsset[],
  segments: readonly RecoverySegment[],
): number {
  const unresolvedAssets = assets.filter((asset) => asset.unresolved).length;
  const missingAssetSegments = segments.filter((s) => s.resolutionStatus === 'missing-asset').length;
  return unresolvedAssets + missingAssetSegments;
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
  /** The segment this row is for, when it is a segment row (not an orphan asset row). */
  segmentId: string | null;
  segmentLabel: string | null;
  assetId: string | null;
  assetName: string | null;
  /** True when `assetName` is a filename recovered from the original scene
   *  tag (the asset itself is gone), not an actual linked asset's name. */
  assetNameIsExpected: boolean;
  resolutionStatus: SegmentResolutionStatus;
  /** When true, the row shows a per-asset Re-link affordance. */
  showRelink: boolean;
}

function resolutionStatusLabel(status: SegmentResolutionStatus): string {
  if (status === 'resolved') return 'Linked';
  return 'Missing asset';
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
      segmentId: segment.id,
      segmentLabel: segment.label,
      assetId: segment.assetId,
      assetName: asset?.name ?? segment.expectedFileName ?? null,
      assetNameIsExpected: !asset?.name && !!segment.expectedFileName,
      resolutionStatus: segment.resolutionStatus,
      // Both shapes of "not resolved" get a Re-link affordance: an asset with
      // no bytes (assetId known) re-links via relinkAsset; a segment with no
      // assetId at all (the asset was deleted) attaches a brand-new asset.
      showRelink: segment.resolutionStatus !== 'resolved',
    };
  });

  const orphanRows: RecoveryItemRow[] = assets
    .filter((asset) => asset.unresolved && !referencedAssetIds.has(asset.id))
    .map((asset) => ({
      rowId: `orphan-${asset.id}`,
      segmentId: null,
      segmentLabel: null,
      assetId: asset.id,
      assetName: asset.name,
      assetNameIsExpected: false,
      resolutionStatus: 'unresolved' as const,
      showRelink: true,
    }));

  return [...segmentRows, ...orphanRows];
}
