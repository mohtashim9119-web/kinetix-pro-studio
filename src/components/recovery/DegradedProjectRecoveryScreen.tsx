/**
 * Degraded-project recovery screen — presentation only.
 *
 * Shown when a project loads with asset metadata present but bytes
 * unresolvable. The user must see per-segment status and missing assets
 * instead of an empty timeline. This component never writes storage:
 * Save is omitted while any asset is unresolved, even if the caller
 * passed `onSave`. Re-link is a callback; there is no file picker here.
 */

import React, { useEffect } from 'react';
import { AlertTriangle, Link2, FolderOpen, X } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  buildRecoveryItemRows,
  canPersistRecoveredProject,
  totalUnresolvedCount,
  type RecoveryAsset,
  type RecoverySegment,
} from './degradedLoad';

/**
 * What a Re-link click targets: an existing asset with missing bytes
 * (`assetId` set — the caller writes into it), or a segment whose asset was
 * deleted outright (`segmentId` set, `assetId` null — the caller attaches a
 * brand-new asset). Exactly one of the two is non-null.
 */
export interface RelinkTarget {
  assetId: string | null;
  segmentId: string | null;
}
import type { RelinkProposal } from '../../services/relinkResolution/types';
import type { FolderSelection } from '../../services/relinkResolution/folderRelinkSession';

/** Display info for one folder-pick candidate, keyed by candidateId. */
export interface FolderRelinkCandidateView {
  id: string;
  name: string;
  path: string;
}

/**
 * The folder-pick session state the screen renders. `null` means no folder
 * has been picked yet — the screen shows the "Pick folder" primary action.
 * Built by App from the pure matcher's output; this view never decides a
 * match (the matcher does) and never writes bytes (App does).
 */
export interface FolderRelinkView {
  phase: 'listing' | 'proposed' | 'writing';
  proposals: readonly RelinkProposal[];
  candidateById: Record<string, FolderRelinkCandidateView>;
  selection: FolderSelection;
  /** Every id (asset or segment) the folder pick proposed matches for. */
  unresolvedAssetIds: readonly string[];
  /** Which of the ids above are segment ids (missing-asset, no asset left)
   *  rather than real asset ids — App.tsx uses this to route the write. */
  segmentIds?: readonly string[];
  writeError: string | null;
}

export interface DegradedProjectRecoveryScreenProps {
  projectName: string;
  segments: readonly RecoverySegment[];
  assets: readonly RecoveryAsset[];
  /** Fake or real re-link. This view does not open a picker. */
  onRelink: (target: RelinkTarget) => void;
  /**
   * Optional persist callback. Ignored while any asset is unresolved —
   * the no-save invariant is enforced here, not by the caller.
   */
  onSave?: () => void;
  /** Folder-pick primary action (Step 2). `null`/absent = no folder picked yet. */
  folderRelink?: FolderRelinkView | null;
  onPickFolder?: () => void;
  onToggleFolderProposal?: (assetId: string, candidateId: string) => void;
  onConfirmFolderRelink?: () => void;
  onCancelFolderRelink?: () => void;
  /** Close without writing — returns to dashboard, project stays poisoned. */
  onClose: () => void;
}

export function DegradedProjectRecoveryScreen({
  projectName,
  segments,
  assets,
  onRelink,
  onSave,
  folderRelink,
  onPickFolder,
  onToggleFolderProposal,
  onConfirmFolderRelink,
  onCancelFolderRelink,
  onClose,
}: DegradedProjectRecoveryScreenProps): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const canSave = canPersistRecoveredProject({ assets, segments });
  const unresolvedCount = totalUnresolvedCount(assets, segments);
  const assetNameById = new Map<string, string>([
    ...assets.map((a): [string, string] => [a.id, a.name]),
    ...segments
      .filter((s): s is RecoverySegment & { expectedFileName: string } => !!s.expectedFileName)
      .map((s): [string, string] => [s.id, s.expectedFileName]),
  ]);
  const itemRows = buildRecoveryItemRows(segments, assets);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Folder-pick proposals grouped per asset (matcher sorts best-first).
  const proposalsByAsset = new Map<string, RelinkProposal[]>();
  if (folderRelink) {
    for (const proposal of folderRelink.proposals) {
      const list = proposalsByAsset.get(proposal.assetId) ?? [];
      list.push(proposal);
      proposalsByAsset.set(proposal.assetId, list);
    }
  }
  const selectedCount = folderRelink
    ? Object.values(folderRelink.selection).filter((c) => c !== null).length
    : 0;

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
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-black uppercase tracking-[0.2em]">Project media missing</h2>
            <p data-testid="recovery-project-name" className="text-[11px] text-gray-400 mt-1">
              {projectName}
            </p>
          </div>
          <button
            type="button"
            data-testid="recovery-close"
            aria-label="Close recovery"
            onClick={onClose}
            className="shrink-0 p-1.5 text-gray-500 hover:text-white border border-transparent hover:border-[#282828] rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-[11px] text-gray-400 mb-4">
          This project still has its timeline metadata, but some media bytes
          cannot be resolved. Saving is blocked so this view cannot be
          written back over the last good project.
        </p>

        <p
          data-testid="recovery-unresolved-summary"
          className={`text-[10px] font-bold uppercase tracking-widest mb-4 ${
            unresolvedCount > 0 ? 'text-red-400' : 'text-emerald-400'
          }`}
        >
          {unresolvedCount > 0
            ? `${unresolvedCount} missing asset${unresolvedCount === 1 ? '' : 's'}`
            : 'All assets linked'}
        </p>

        {/* Step 2 — folder-pick is the PRIMARY recovery action. With many
            unresolved assets, per-asset re-link is unusable; one folder pick
            proposes matches for every asset at once. Per-asset re-link stays
            as the fallback below for what the folder pick misses. */}
        <section data-testid="recovery-folder-pick" className="mb-5 border border-[#282828] rounded-lg p-3">
          {!folderRelink && (
            <button
              type="button"
              data-testid="recovery-pick-folder"
              onClick={() => onPickFolder?.()}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#F27D26] text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all"
            >
              <FolderOpen size={14} />
              Locate Original Files
            </button>
          )}
          {folderRelink?.phase === 'listing' && (
            <p data-testid="recovery-folder-listing" className="text-[11px] text-gray-400 text-center p-3">
              Listing folder…
            </p>
          )}
          {folderRelink?.phase === 'writing' && (
            <p data-testid="recovery-folder-writing" className="text-[11px] text-gray-400 text-center p-3">
              Writing confirmed matches…
            </p>
          )}
          {folderRelink?.phase === 'proposed' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <p data-testid="recovery-folder-summary" className="text-[10px] font-bold uppercase tracking-widest text-gray-300">
                  {selectedCount} of {folderRelink.unresolvedAssetIds.length} selected
                </p>
                <button
                  type="button"
                  data-testid="recovery-folder-cancel"
                  onClick={() => onCancelFolderRelink?.()}
                  className="text-[9px] font-bold uppercase tracking-widest text-gray-500 hover:text-white"
                >
                  Cancel
                </button>
              </div>
              <ul data-testid="recovery-folder-proposals" className="space-y-1 mb-3 max-h-48 overflow-y-auto">
                {folderRelink.unresolvedAssetIds.map((assetId) => {
                  const proposals = proposalsByAsset.get(assetId) ?? [];
                  const confirmable = proposals.filter((p) => p.confidence !== 'rejected');
                  const selectedCandidateId = folderRelink.selection[assetId] ?? null;
                  const top = confirmable[0];
                  const assetName = assetNameById.get(assetId) ?? assetId;
                  return (
                    <li
                      key={assetId}
                      data-testid="recovery-folder-row"
                      data-asset-id={assetId}
                      className="flex items-center gap-2 bg-[#1A1A1A] border border-[#282828] rounded px-2 py-1.5"
                    >
                      <input
                        type="checkbox"
                        data-testid="recovery-folder-toggle"
                        data-asset-id={assetId}
                        data-candidate-id={top?.candidateId ?? ''}
                        checked={selectedCandidateId !== null}
                        disabled={!top}
                        onChange={() => {
                          if (top) onToggleFolderProposal?.(assetId, top.candidateId);
                        }}
                        className="shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold text-gray-200 truncate">{assetName}</p>
                        {top ? (
                          <p
                            data-testid="recovery-folder-proposal"
                            data-confidence={top.confidence}
                            className="text-[9px] text-gray-500 truncate"
                          >
                            → {folderRelink.candidateById[top.candidateId]?.name ?? top.candidateId}
                            {top.confidence !== 'exact' && (
                              <span className="ml-1 text-amber-400">
                                (needs confirmation)
                              </span>
                            )}
                          </p>
                        ) : (
                          <p data-testid="recovery-folder-no-match" className="text-[9px] text-gray-600">
                            no match — use Re-link below
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                data-testid="recovery-folder-confirm"
                disabled={selectedCount === 0}
                onClick={() => onConfirmFolderRelink?.()}
                className="w-full bg-[#F27D26] text-white p-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Write {selectedCount} confirmed match{selectedCount === 1 ? '' : 'es'}
              </button>
              {folderRelink.writeError && (
                <p
                  data-testid="recovery-folder-write-error"
                  role="alert"
                  className="mt-2 text-[10px] text-red-400"
                >
                  {folderRelink.writeError}
                </p>
              )}
            </>
          )}
        </section>

        {!canSave && (
          <div
            data-testid="recovery-no-save-banner"
            role="status"
            className="mb-5 border border-amber-500/40 bg-amber-500/10 rounded-lg px-3 py-2 text-[11px] text-amber-200"
          >
            Saving is blocked until every asset is linked. Locate your
            original files to restore this project.
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

        <section className="space-y-2 mb-6" data-testid="recovery-item-list">
          <h3 className="text-[8px] uppercase tracking-widest text-gray-600">Timeline items</h3>
          {itemRows.map((row) => (
            <div
              key={row.rowId}
              data-testid="recovery-item"
              data-row-id={row.rowId}
              data-asset-id={row.assetId ?? ''}
              data-resolution-status={row.resolutionStatus}
              className="flex items-center justify-between gap-3 bg-[#1A1A1A] border border-[#282828] rounded-lg px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                {row.segmentLabel && (
                  <p data-testid="recovery-item-segment" className="text-[11px] font-bold text-gray-200 truncate">
                    {row.segmentLabel}
                  </p>
                )}
                <p data-testid="recovery-item-asset" className="text-[9px] text-gray-500 truncate">
                  {row.assetName
                    ? row.assetNameIsExpected
                      ? `Expected: ${row.assetName}`
                      : row.assetName
                    : row.assetId ?? 'Not linked — pick a file'}
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {row.showRelink && (row.assetId || row.segmentId) && (
                  <button
                    type="button"
                    data-testid="recovery-relink"
                    aria-label="Re-link"
                    title="Re-link"
                    data-asset-id={row.assetId ?? ''}
                    data-segment-id={row.segmentId ?? ''}
                    onClick={() => onRelink({ assetId: row.assetId, segmentId: row.assetId ? null : row.segmentId })}
                    className="inline-flex items-center justify-center p-1.5 border border-[#282828] rounded-lg text-gray-300 hover:text-white hover:border-gray-500"
                  >
                    <Link2 size={12} />
                  </button>
                )}
                <span
                  data-testid="recovery-item-status"
                  className={`text-[9px] font-black uppercase tracking-widest ${
                    row.resolutionStatus === 'resolved' ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {row.resolutionStatus === 'resolved' ? 'Linked' : 'Missing'}
                </span>
              </div>
            </div>
          ))}
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
