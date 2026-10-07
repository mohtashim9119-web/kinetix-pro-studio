/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Layer 2 panel — the DEDICATED field for Layer-2 docs plus the spot list.
 * Anything dropped on this field is layer 2 by definition (no detection); the
 * file is parsed in App and bound to main segments after a timeline exists.
 * Presentational only: state and effects live in App.
 */

import { useEffect, useRef, useState } from 'react';
import { Trash2, Upload, Plus, AlertCircle, Search, ChevronDown, Film, Image as ImageIcon } from 'lucide-react';
import type { Asset, Spot, VideoSegment } from '../types';
import type { SpotDocError } from '../services/spots/parseSpotDoc';
import type { SpotFinding } from '../services/spots/spotFinding';
import type { SpotPatch } from '../services/spots/spotOps';
import { formatTime } from '../services/timeFormat';
import { ConfirmDialog } from './ConfirmDialog';
import { formatSpotGeometry, spotGeometryLevel, GLOBAL_SPOT_GEOMETRY, type PctRect, type SpotGeometryLevel } from '../services/spots/spotGeometry';

export interface Layer2PanelProps {
  segments: VideoSegment[];
  assets: Asset[];
  spots: Spot[];
  /** spotId -> resolved placement incl. the box (undefined = not placeable). */
  resolved: Record<string, { startSec: number; durSec: number; rect: PctRect } | undefined>;
  /** R7 level 2: the per-project default box (absent -> built-in left half). */
  projectDefault?: PctRect;
  /** A doc waiting to bind (or just bound) with its parse errors. */
  pendingDoc: { name: string; errors: SpotDocError[] } | null;
  findings: Pick<SpotFinding, 'kind' | 'message'>[];
  /** The box being dragged in the preview, shown in realtime in the geometry row. */
  liveRect?: { id: string; rect: PctRect; scope: 'project' | 'block' } | null;
  selectedSpotId?: string | null;
  onSelectSpot: (id: string) => void;
  onDropDoc: (file: File) => void;
  onClearPending: () => void;
  onPatchSpot: (id: string, patch: SpotPatch) => void;
  onDeleteSpot: (id: string) => void;
  onAddManual: (segmentId: string) => void;
  /** Clear a block's individual box -> falls back to the project default. */
  onResetSpotGeometry: (id: string) => void;
  /** Stamp the block's current box as its own individual geometry. */
  onCustomizeSpotGeometry: (id: string, rect: PctRect) => void;
  onResetProjectDefault: () => void;
}

const LEVEL_LABEL: Record<SpotGeometryLevel, string> = { default: 'Default', project: 'Project', custom: 'Custom' };

function sceneLabel(segments: VideoSegment[], id: string): string | undefined {
  const i = segments.findIndex(s => s.id === id);
  if (i < 0) return undefined;
  const s = segments[i]!;
  return `Scene ${i + 1}${s.tag ? ` · ${s.tag}` : ''}`;
}

/** Media row (b): the selected clip, or "Not set"; click opens a searchable list
 *  of the vault's video + image assets (audio is never a candidate). */
function SpotMediaPicker({ spotId, current, assets, onPick }: {
  spotId: string; current?: Asset; assets: Asset[]; onPick: (a: Asset) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const media = assets.filter(a => a.type === 'video' || a.type === 'image');
  const q = query.trim().toLowerCase();
  const shown = q ? media.filter(a => a.name.toLowerCase().includes(q)) : media;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = () => { setOpen(false); setQuery(''); setActive(0); };
  const pick = (a: Asset) => { onPick(a); close(); };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid={`layer2-media-${spotId}`}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className={`w-full flex items-center gap-1.5 bg-[var(--kx-surface-2)] rounded-lg px-2 py-1 text-[11px] text-left hover:opacity-90 ${
          current ? 'text-[var(--kx-text)]' : 'text-[var(--kx-faint)]'
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {current?.type === 'image' ? <ImageIcon size={11} className="shrink-0" /> : <Film size={11} className="shrink-0" />}
        <span className="flex-1 min-w-0 truncate">{current ? current.name : 'Not set'}</span>
        <ChevronDown size={11} className="shrink-0 text-[var(--kx-faint)]" />
      </button>
      {open && (
        <div
          data-testid={`layer2-media-menu-${spotId}`}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-10 rounded-[13px] border border-[var(--kx-line-2)] bg-[var(--kx-surface)] shadow-xl p-1.5"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5 bg-[var(--kx-surface-2)] rounded-lg px-2 py-1 mb-1">
            <Search size={12} className="text-[var(--kx-faint)] shrink-0" />
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              data-testid={`layer2-media-search-${spotId}`}
              value={query}
              onChange={e => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={e => {
                if (e.key === 'Escape') { e.stopPropagation(); close(); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, Math.max(shown.length - 1, 0))); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
                else if (e.key === 'Enter') { e.preventDefault(); const a = shown[active]; if (a) pick(a); }
              }}
              placeholder="Search media…"
              className="bg-transparent text-[11px] flex-1 min-w-0 outline-none placeholder:text-[var(--kx-faint)]"
            />
          </div>
          <div className="max-h-40 overflow-y-auto custom-scrollbar">
            {shown.length === 0 && <div className="px-2 py-2 text-[11px] text-[var(--kx-faint)]">No media matches</div>}
            {shown.map((a, i) => (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={a.id === current?.id}
                data-testid={`layer2-media-option-${a.id}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(a)}
                className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-left text-[var(--kx-text)] ${
                  i === active ? 'bg-[var(--kx-hover)]' : ''
                }`}
              >
                {a.type === 'image' ? <ImageIcon size={11} className="shrink-0 text-[var(--kx-faint)]" /> : <Film size={11} className="shrink-0 text-[var(--kx-faint)]" />}
                <span className="truncate">{a.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Layer2Panel(p: Layer2PanelProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [addSegId, setAddSegId] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasTimeline = p.segments.length > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 gap-3" data-testid="layer2-panel">
      {/* Dedicated field */}
      <div
        data-testid="layer2-dropfield"
        className={`rounded-[13px] border border-dashed px-3 py-4 text-center text-[12.5px] transition-colors bg-[var(--kx-surface)] ${
          isDragOver ? 'border-[var(--kx-accent-line)] bg-[var(--kx-accent-soft)]' : 'border-[var(--kx-line)] hover:border-[var(--kx-line-2)]'
        }`}
        onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setIsDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) p.onDropDoc(f);
        }}
      >
        <Upload size={16} className="mx-auto mb-1 text-[var(--kx-faint)]" />
        <div className="text-[var(--kx-text)] font-medium">Layer 2 doc</div>
        <div className="text-[var(--kx-faint)] mt-0.5">
          Drop a scene-format file here ([scene-tag] then an optional clip name). Whatever lands here is Layer 2.
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-2 px-2.5 py-1 rounded-[8px] bg-[var(--kx-surface-2)] border border-[var(--kx-line)] text-[var(--kx-muted)] hover:text-[var(--kx-text)] hover:border-[var(--kx-line-2)] transition-colors"
        >
          Choose file…
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.rtf,.md,text/plain"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) p.onDropDoc(f);
            e.target.value = '';
          }}
        />
      </div>

      {!hasTimeline && (
        <div className="flex items-start gap-2 text-[12.5px] text-[var(--kx-muted)]" data-testid="layer2-prebuild">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>
            Waiting for first Build Timeline — Layer-2 docs bind to scenes once the timeline exists.
            {p.pendingDoc ? ` "${p.pendingDoc.name}" is queued.` : ''}
          </span>
        </div>
      )}

      {p.pendingDoc && (
        <div className="px-3 py-2 rounded-[9px] bg-[var(--kx-surface)] border border-[var(--kx-line)] text-[12.5px]" data-testid="layer2-pending">
          <div className="flex items-center justify-between">
            <span className="text-[var(--kx-text)] truncate">{p.pendingDoc.name}</span>
            <button type="button" onClick={p.onClearPending} className="text-[var(--kx-faint)] hover:text-[var(--kx-text)]" aria-label="Dismiss Layer 2 doc notes">
              ×
            </button>
          </div>
          {p.pendingDoc.errors.map((e, i) => (
            <div key={i} className="text-[var(--kx-warning)] mt-1">{e.message}</div>
          ))}
        </div>
      )}

      {p.findings.length > 0 && (
        <ul className="px-3 py-2 pl-7 rounded-[9px] bg-[rgba(251,191,36,.12)] border border-[rgba(251,191,36,.35)] text-[var(--kx-warning)] text-[12.5px] list-disc" data-testid="layer2-findings">
          {p.findings.map((f, i) => <li key={i}>{f.message}</li>)}
        </ul>
      )}

      {/* Project default box (R7 level 2) */}
      <div className="rounded-[13px] border border-[var(--kx-line)] bg-[var(--kx-surface)] px-3 py-2 text-[11px] flex flex-col gap-1" data-testid="layer2-project-default">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--kx-faint)]">Default box · {p.projectDefault ? 'Project' : 'Left half'}</span>
          {p.projectDefault && (
            <button type="button" onClick={p.onResetProjectDefault} className="text-[var(--kx-faint)] hover:text-[var(--kx-text)]">
              Reset
            </button>
          )}
        </div>
        <div className="text-[var(--kx-text)] tabular-nums">{formatSpotGeometry(p.projectDefault ?? GLOBAL_SPOT_GEOMETRY)}</div>
        <div className="text-[var(--kx-faint)]">Drag the box in the preview to set it for every block · hold Alt to move just one.</div>
      </div>

      {/* Spot list */}
      <div className="flex flex-col gap-2" data-testid="layer2-list">
        {p.spots.length === 0 && <div className="text-[11px] text-[var(--kx-faint)] px-1">No Layer-2 spots yet.</div>}
        {p.spots.map(s => {
          const r = p.resolved[s.id];
          const label = sceneLabel(p.segments, s.anchorSegmentId);
          const asset = s.assetId ? p.assets.find(a => a.id === s.assetId) : undefined;
          const level = spotGeometryLevel(s, p.projectDefault);
          const live =
            p.liveRect && (p.liveRect.id === s.id || (p.liveRect.scope === 'project' && !s.geometry)) ? p.liveRect.rect : undefined;
          const rect = live ?? r?.rect ?? s.geometry ?? p.projectDefault ?? GLOBAL_SPOT_GEOMETRY;
          const selected = p.selectedSpotId === s.id;
          return (
            <div
              key={s.id}
              data-testid={`layer2-spot-${s.id}`}
              data-selected={selected ? 'true' : undefined}
              onClick={() => p.onSelectSpot(s.id)}
              className={`rounded-[13px] border px-3 py-2.5 text-[12px] flex flex-col gap-1.5 cursor-pointer transition-colors ${
                selected
                  ? 'border-[var(--kx-accent-line)] bg-[var(--kx-accent-soft)]'
                  : 'bg-[var(--kx-surface)] border-[var(--kx-line)] hover:border-[var(--kx-line-2)]'
              }`}
            >
              {/* (a) scene number + tag, (d) bin */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--kx-text)] truncate">{label ?? 'Scene removed'}</span>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setConfirmDeleteId(s.id); }}
                  aria-label="Delete spot"
                  className="text-[var(--kx-faint)] hover:text-[var(--kx-danger)] transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {/* (b) media */}
              <SpotMediaPicker
                spotId={s.id}
                current={asset}
                assets={p.assets}
                onPick={a => p.onPatchSpot(s.id, { assetId: a.id, clipName: a.name })}
              />
              {s.assetId && !asset && <div className="text-[var(--kx-danger)]">Clip deleted — pick another</div>}
              {s.needsReview && (
                <div className="text-[var(--kx-warning)]">Needs review — its scene is gone; kept at {formatTime(s.lastKnownStartSec ?? 0)}.</div>
              )}
              {/* timing */}
              <div className="flex items-center justify-between gap-2 text-[var(--kx-faint)] tabular-nums">
                <span>{r ? `${formatTime(r.startSec)} · ${r.durSec.toFixed(1)}s${s.durOverrideSec !== undefined ? ' (override)' : ''}` : 'Not placed'}</span>
                <input
                  type="number"
                  min={0.5}
                  step={0.1}
                  placeholder="auto s"
                  aria-label="Duration override (seconds)"
                  defaultValue={s.durOverrideSec ?? ''}
                  onClick={e => e.stopPropagation()}
                  onBlur={e => {
                    const v = e.target.value.trim();
                    const n = Number(v);
                    p.onPatchSpot(s.id, { durOverrideSec: v === '' || !(n > 0) ? null : n });
                  }}
                  className="w-16 bg-[var(--kx-surface-2)] text-[var(--kx-text)] rounded-lg px-1.5 py-0.5 outline-none tabular-nums"
                />
              </div>
              {/* (c) geometry */}
              <div className="flex items-center justify-between gap-2" data-testid={`layer2-geometry-${s.id}`}>
                <span className="text-[var(--kx-text)] tabular-nums">{formatSpotGeometry(rect)}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <span data-level={level} className="text-[var(--kx-faint)]">{LEVEL_LABEL[level]}</span>
                  {level === 'custom' ? (
                    <button type="button" onClick={e => { e.stopPropagation(); p.onResetSpotGeometry(s.id); }} className="text-[var(--kx-faint)] hover:text-[var(--kx-text)]">
                      Reset to default
                    </button>
                  ) : (
                    <button type="button" onClick={e => { e.stopPropagation(); p.onCustomizeSpotGeometry(s.id, rect); }} className="text-[var(--kx-faint)] hover:text-[var(--kx-text)]">
                      Customize
                    </button>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Manual add */}
      {hasTimeline && (
        <div className="flex gap-1.5 text-[12px]">
          <select
            value={addSegId}
            onChange={e => setAddSegId(e.target.value)}
            aria-label="Scene for new spot"
            className="bg-[var(--kx-surface-2)] text-[var(--kx-text)] rounded-lg px-1.5 py-1 flex-1 min-w-0 outline-none"
          >
            <option value="">Add at scene…</option>
            {p.segments.map((s, i) => <option key={s.id} value={s.id}>{`Scene ${i + 1}${s.tag ? ` · ${s.tag}` : ''}`}</option>)}
          </select>
          <button
            type="button"
            disabled={!addSegId}
            onClick={() => { p.onAddManual(addSegId); setAddSegId(''); }}
            className="px-2 rounded-[8px] bg-[var(--kx-surface-2)] border border-[var(--kx-line)] text-[var(--kx-muted)] hover:text-[var(--kx-text)] hover:border-[var(--kx-line-2)] transition-colors disabled:opacity-40"
            aria-label="Add spot"
          >
            <Plus size={13} />
          </button>
        </div>
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this spot?"
          body="It will be removed from Layer 2 and the timeline. Its clip stays in your media."
          confirmLabel="Delete spot"
          onConfirm={() => { p.onDeleteSpot(confirmDeleteId); setConfirmDeleteId(null); }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  );
}
