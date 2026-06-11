import React, { useEffect, useState, useRef } from 'react';
import { Plus, Trash2, FolderOpen, MoreVertical, Search, Film } from 'lucide-react';
import type { ProjectMeta } from '../types';
import { loadAllMetas, deleteProjectData } from '../services/projectStore';
import { deleteAllAssets } from '../services/assetStore';

interface Props {
  currentProjectId: string | null;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
}

export function ProjectDashboard({
  currentProjectId,
  onSelectProject,
  onNewProject,
}: Props): React.ReactElement {
  const [metas, setMetas] = useState<ProjectMeta[]>([]);
  const [search, setSearch] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const data = loadAllMetas();
    console.log('[dashboard] loaded metas:', data);
    // Sort by lastOpened descending
    data.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    setMetas(data);
  }, []);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = metas.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleDelete(id: string): Promise<void> {
    await deleteAllAssets(id);
    deleteProjectData(id);
    setMetas(prev => prev.filter(m => m.id !== id));
    setConfirmDeleteId(null);
    setMenuOpenId(null);
  }

  function formatDate(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  return (
    <div className="fixed inset-0 z-[200] bg-[#0A0A0A] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <Film size={22} className="text-[#F27D26]" />
          <span className="text-white font-bold text-lg tracking-widest uppercase">
            Kinetix Pro Studio
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded-lg pl-8 pr-4 py-2
                         text-sm text-zinc-200 placeholder-zinc-500
                         focus:outline-none focus:border-[#F27D26] w-52"
            />
          </div>
          {/* New Project button */}
          <button
            onClick={onNewProject}
            className="flex items-center gap-2 bg-[#F27D26] hover:bg-[#e06d1a]
                       text-white font-semibold text-sm px-4 py-2 rounded-lg
                       transition-colors"
          >
            <Plus size={16} />
            New Project
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <h2 className="text-zinc-400 text-xs font-semibold uppercase tracking-widest mb-6">
          Recent Projects
        </h2>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <FolderOpen size={48} className="text-zinc-700" />
            <p className="text-zinc-500 text-sm">
              {search ? 'No projects match your search' : 'No projects yet — create your first one'}
            </p>
          </div>
        )}

        {/* Project grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
          {filtered.map(meta => (
            <div
              key={meta.id}
              onClick={() => onSelectProject(meta.id)}
              className={`group relative bg-zinc-900 rounded-xl overflow-hidden cursor-pointer
                border-2 transition-all duration-200
                ${meta.id === currentProjectId
                  ? 'border-[#F27D26]'
                  : 'border-transparent hover:border-zinc-600'
                }`}
            >
              {/* Thumbnail */}
              <div className="aspect-video bg-zinc-800 flex items-center justify-center overflow-hidden">
                {meta.thumbnailUrl ? (
                  <img
                    src={meta.thumbnailUrl}
                    alt={meta.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <FolderOpen size={32} className="text-zinc-600" />
                )}
              </div>

              {/* Info */}
              <div className="px-3 py-3">
                <p className="text-white text-sm font-medium truncate">{meta.name}</p>
                <p className="text-zinc-500 text-xs mt-0.5">
                  {meta.segmentCount ?? 0} scene{(meta.segmentCount ?? 0) !== 1 ? 's' : ''}
                </p>
                <p className="text-zinc-600 text-xs mt-0.5">
                  {meta.savedAt ? formatDate(meta.savedAt) : '—'}
                </p>
              </div>

              {/* Three-dot menu button — visible on hover */}
              <button
                onClick={e => {
                  e.stopPropagation();
                  setMenuOpenId(prev => prev === meta.id ? null : meta.id);
                }}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60
                           text-zinc-400 hover:text-white opacity-0 group-hover:opacity-100
                           transition-opacity"
                aria-label={`Options for "${meta.name}"`}
              >
                <MoreVertical size={14} />
              </button>

              {/* Dropdown menu */}
              {menuOpenId === meta.id && (
                <div
                  ref={menuRef}
                  className="absolute top-8 right-2 z-10 bg-zinc-800 border border-zinc-700
                             rounded-lg shadow-xl py-1 min-w-32"
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    onClick={() => setConfirmDeleteId(meta.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm
                               text-red-400 hover:bg-zinc-700 transition-colors"
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              )}

              {/* Current project badge */}
              {meta.id === currentProjectId && (
                <span className="absolute top-2 left-2 text-[10px] bg-green-600/80 text-white px-1.5 py-0.5 rounded-full font-medium">
                  Current
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Delete confirmation overlay */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-white font-semibold mb-2">Delete Project</h3>
            <p className="text-zinc-400 text-sm mb-6">
              &ldquo;{metas.find(m => m.id === confirmDeleteId)?.name}&rdquo; will be permanently
              deleted. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white
                           rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500
                           text-white rounded-lg transition-colors font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
