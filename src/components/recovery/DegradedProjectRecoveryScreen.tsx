/**
 * Degraded-project recovery screen — presentation only.
 *
 * Shown when a project loads with asset metadata present but bytes
 * unresolvable. The user must see per-segment status and missing assets
 * instead of an empty timeline. This component never writes storage:
 * Save is omitted while any asset is unresolved, even if the caller
 * passed `onSave`. Re-link is a callback; there is no file picker here.
 */

import React from 'react';
import { AlertTriangle, FolderOpen, HardDrive, Link2 } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  canPersistRecoveredProject,
  unresolvedAssetIds,
  type RecoveryAsset,
  type RecoverySegment,
} from './degradedLoad';

export interface DegradedProjectRecoveryScreenProps {
  projectName: string;
  segments: readonly RecoverySegment[];
  assets: readonly RecoveryAsset[];
  /** Fake or real re-link. This view does not open a picker. */
  onRelink: (assetId: string) => void;
  /**
   * Optional persist callback. Ignored while any asset is unresolved —
   * the no-save invariant is enforced here, not by the caller.
   */
  onSave?: () => void;
}

function assetLocationLabel(asset: RecoveryAsset): string {
  if (!asset.unresolved) return 'Resolved';
  if (asset.nativeCopyExists) return 'Native copy available';
  if (asset.backupExists) return 'Backup available';
  return 'Missing';
}

function assetLocationKind(asset: RecoveryAsset): 'resolved' | 'native-copy' | 'backup' | 'missing' {
  if (!asset.unresolved) return 'resolved';
  if (asset.nativeCopyExists) return 'native-copy';
  if (asset.backupExists) return 'backup';
  return 'missing';
}

function segmentStatusLabel(status: RecoverySegment['resolutionStatus']): string {
  if (status === 'resolved') return 'Resolved';
  if (status === 'missing-asset') return 'Missing asset';
  return 'Unresolved';
}

export function DegradedProjectRecoveryScreen({
  projectName,
  segments,
  assets,
  onRelink,
  onSave,
}: DegradedProjectRecoveryScreenProps): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const canSave = canPersistRecoveredProject({ assets, segments });
  const missingIds = unresolvedAssetIds(assets);
  const unresolvedCount = missingIds.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Project recovery"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        ref={trapRef}
        data-testid="degraded-project-recovery"
        data-can-save={canSave ? 'true' : 'false'}
        className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-xl shadow-2xl max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-start gap-3 mb-6">
          <AlertTriangle size={18} className="shrink-0 text-amber-400 mt-0.5" />
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.2em]">Project media missing</h2>
            <p data-testid="recovery-project-name" className="text-[11px] text-gray-400 mt-1">
              {projectName}
            </p>
          </div>
        </div>

        <p className="text-[11px] text-gray-400 mb-4">
          This project still has its timeline metadata, but some media bytes
          cannot be resolved. Saving is blocked so this view cannot be
          written back over the last good project.
        </p>

        <p
          data-testid="recovery-unresolved-summary"
          className="text-[10px] font-bold uppercase tracking-widest text-amber-300 mb-4"
        >
          {unresolvedCount} unresolved asset{unresolvedCount === 1 ? '' : 's'}
        </p>

        {!canSave && (
          <div
            data-testid="recovery-no-save-banner"
            role="status"
            className="mb-5 border border-amber-500/40 bg-amber-500/10 rounded-lg px-3 py-2 text-[11px] text-amber-200"
          >
            Saving is blocked until every asset is resolved. Re-link your
            original files — they are the realistic recovery path.
          </div>
        )}

        {canSave && (
          <div
            data-testid="recovery-ready-to-save"
            role="status"
            className="mb-5 border border-emerald-500/40 bg-emerald-500/10 rounded-lg px-3 py-2 text-[11px] text-emerald-200"
          >
            All assets are resolved. This project is ready to save.
          </div>
        )}

        <section className="space-y-2 mb-6" data-testid="recovery-segment-list">
          <h3 className="text-[8px] uppercase tracking-widest text-gray-600">Segments</h3>
          {segments.map((segment) => (
            <div
              key={segment.id}
              data-testid="recovery-segment"
              data-segment-id={segment.id}
              data-resolution-status={segment.resolutionStatus}
              className="flex items-center justify-between gap-3 bg-[#1A1A1A] border border-[#282828] rounded-lg px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-gray-200 truncate">{segment.label}</p>
                <p className="text-[9px] text-gray-600">
                  {segment.assetId ? `asset ${segment.assetId}` : 'no asset'}
                </p>
              </div>
              <span
                data-testid="recovery-segment-status"
                className="shrink-0 text-[9px] font-black uppercase tracking-widest text-gray-400"
              >
                {segmentStatusLabel(segment.resolutionStatus)}
              </span>
            </div>
          ))}
        </section>

        <section className="space-y-2 mb-6" data-testid="recovery-asset-list">
          <h3 className="text-[8px] uppercase tracking-widest text-gray-600">Assets</h3>
          {assets.map((asset) => {
            const kind = assetLocationKind(asset);
            return (
              <div
                key={asset.id}
                data-testid="recovery-asset"
                data-asset-id={asset.id}
                data-unresolved={asset.unresolved ? 'true' : 'false'}
                data-location={kind}
                className="flex items-center justify-between gap-3 bg-[#1A1A1A] border border-[#282828] rounded-lg px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-gray-200 truncate">{asset.name}</p>
                  <p
                    data-testid="recovery-asset-location"
                    className="text-[9px] text-gray-500 flex items-center gap-1"
                  >
                    {kind === 'native-copy' && <HardDrive size={11} />}
                    {kind === 'backup' && <FolderOpen size={11} />}
                    {assetLocationLabel(asset)}
                  </p>
                </div>
                {asset.unresolved && (
                  <button
                    type="button"
                    data-testid="recovery-relink"
                    data-asset-id={asset.id}
                    onClick={() => onRelink(asset.id)}
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[9px] font-black uppercase tracking-widest border border-[#282828] rounded-lg text-gray-300 hover:text-white hover:border-gray-500"
                  >
                    <Link2 size={11} />
                    Re-link
                  </button>
                )}
              </div>
            );
          })}
        </section>

        {canSave && onSave && (
          <button
            type="button"
            data-testid="recovery-save"
            onClick={onSave}
            className="w-full bg-[#F27D26] text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            Save
          </button>
        )}
      </div>
    </div>
  );
}
