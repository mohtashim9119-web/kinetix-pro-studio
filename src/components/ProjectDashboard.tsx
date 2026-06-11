import React, { useEffect, useState } from 'react';
import { X, Plus, Trash2, FolderOpen } from 'lucide-react';
import type { ProjectMeta } from '../types';
import { loadAllMetas, deleteProjectData } from '../services/projectStore';
import { deleteAllAssets } from '../services/assetStore';

interface Props {
  currentProjectId: string;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  onClose: () => void;
}

export function ProjectDashboard({
  currentProjectId,
  onSelectProject,
  onNewProject,
  onClose,
}: Props): React.ReactElement {
  const [metas, setMetas] = useState<ProjectMeta[]>([]);

  useEffect(() => {
    const data = loadAllMetas();
    console.log('[dashboard] loaded metas:', data);
    setMetas(data);
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    if (id === currentProjectId) {
      // Shouldn't happen (button not rendered for current), but guard anyway
      return;
    }
    const meta = metas.find(m => m.id === id);
    const confirmed = window.confirm(
      `Delete "${meta?.name ?? 'this project'}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    deleteProjectData(id);
    await deleteAllAssets(id).catch((err: unknown) =>
      console.error('[ProjectDashboard] Failed to delete assets for project', id, err),
    );
    setMetas((prev) => prev.filter((m) => m.id !== id));
  };

  const formatDate = (ts: number): string =>
    new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Projects"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm"
    >
      <div className="bg-[#0D0D0D] border border-[#1A1A1A] rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-[#1A1A1A] flex-shrink-0">
          <h2 className="text-sm font-black uppercase tracking-[0.3em]">Projects</h2>
          <button
            onClick={onClose}
            aria-label="Close projects panel"
            className="text-gray-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#F27D26] rounded"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
          {/* New project card */}
          <button
            onClick={onNewProject}
            className="w-full border border-dashed border-[#F27D26]/40 rounded-xl p-5 flex items-center gap-4 text-left hover:border-[#F27D26] hover:bg-[#F27D26]/5 transition-all group focus:outline-none focus:ring-2 focus:ring-[#F27D26]"
          >
            <div className="w-10 h-10 rounded-lg bg-[#F27D26]/10 flex items-center justify-center group-hover:bg-[#F27D26]/20 transition-colors flex-shrink-0">
              <Plus size={18} className="text-[#F27D26]" />
            </div>
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[#F27D26]">
              New Project
            </span>
          </button>

          {/* Existing projects */}
          {metas.map((meta) => {
            const isCurrent = meta.id === currentProjectId;
            return (
              <div
                key={meta.id}
                role={isCurrent ? undefined : 'button'}
                tabIndex={isCurrent ? undefined : 0}
                onClick={() => {
                  if (!isCurrent) onSelectProject(meta.id);
                }}
                onKeyDown={(e) => {
                  if (!isCurrent && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onSelectProject(meta.id);
                  }
                }}
                className={`w-full border rounded-xl p-5 flex items-center gap-4 transition-all ${
                  isCurrent
                    ? 'border-[#F27D26] bg-[#F27D26]/5 cursor-default'
                    : 'border-[#282828] hover:border-[#444] hover:bg-[#1A1A1A] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#F27D26]'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isCurrent ? 'bg-[#F27D26]/20' : 'bg-[#1A1A1A]'
                  }`}
                >
                  <FolderOpen
                    size={18}
                    className={isCurrent ? 'text-[#F27D26]' : 'text-gray-500'}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold truncate">{meta.name}</span>
                    {isCurrent && (
                      <span className="text-[8px] font-black uppercase tracking-widest text-[#F27D26] bg-[#F27D26]/10 px-2 py-0.5 rounded-full flex-shrink-0">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="text-[9px] text-gray-600 uppercase tracking-widest mt-0.5">
                    {meta.segmentCount} scene{meta.segmentCount !== 1 ? 's' : ''} · Saved{' '}
                    {formatDate(meta.savedAt)}
                  </div>
                </div>

                {!isCurrent && (
                  <button
                    onClick={(e) => handleDelete(meta.id, e)}
                    aria-label={`Delete project "${meta.name}"`}
                    className="p-2 text-gray-700 hover:text-red-500 transition-colors rounded-lg hover:bg-red-500/10 flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}

          {metas.length === 0 && (
            <p className="text-center text-gray-600 text-xs uppercase tracking-widest py-8">
              No saved projects yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
