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

import { useRef, useState } from 'react';
import { Trash2, Upload, Plus, AlertCircle } from 'lucide-react';
import type { Asset, Spot, SpotCorner, VideoSegment } from '../types';
import type { SpotDocError } from '../services/spots/parseSpotDoc';
import type { SpotFinding } from '../services/spots/spotFinding';
import type { SpotPatch } from '../services/spots/spotOps';
import { formatTime } from '../services/timeFormat';

export interface Layer2PanelProps {
  segments: VideoSegment[];
  assets: Asset[];
  spots: Spot[];
  /** spotId -> resolved absolute start/duration (undefined = not placeable). */
  resolved: Record<string, { startSec: number; durSec: number } | undefined>;
  /** A doc waiting to bind (or just bound) with its parse errors. */
  pendingDoc: { name: string; errors: SpotDocError[] } | null;
  findings: Pick<SpotFinding, 'kind' | 'message'>[];
  onDropDoc: (file: File) => void;
  onClearPending: () => void;
  onPatchSpot: (id: string, patch: SpotPatch) => void;
  onDeleteSpot: (id: string) => void;
  onAddManual: (segmentId: string) => void;
}

const CORNERS: { value: SpotCorner; label: string }[] = [
  { value: 'top-right', label: 'Top right' },
  { value: 'top-left', label: 'Top left' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'bottom-left', label: 'Bottom left' },
];

function sceneLabel(segments: VideoSegment[], id: string): string | undefined {
  const i = segments.findIndex(s => s.id === id);
  if (i < 0) return undefined;
  const s = segments[i]!;
  return `Scene ${i + 1}${s.tag ? ` · ${s.tag}` : ''}`;
}

export function Layer2Panel(p: Layer2PanelProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [addSegId, setAddSegId] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const hasTimeline = p.segments.length > 0;
  const assetName = (id?: string) => (id ? p.assets.find(a => a.id === id)?.name : undefined);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 gap-3" data-testid="layer2-panel">
      {/* Dedicated field */}
      <div
        data-testid="layer2-dropfield"
        className={`rounded-lg border border-dashed px-3 py-4 text-center text-[12px] transition-colors ${
          isDragOver ? 'border-[var(--kx-accent)] bg-[var(--kx-line)]' : 'border-[var(--kx-line)]'
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
          className="mt-2 px-2 py-1 rounded bg-[var(--kx-line)] text-[var(--kx-text)] hover:opacity-80"
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
        <div className="flex items-start gap-2 text-[12px] text-[var(--kx-muted)]" data-testid="layer2-prebuild">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>
            Waiting for first Build Timeline — Layer-2 docs bind to scenes once the timeline exists.
            {p.pendingDoc ? ` "${p.pendingDoc.name}" is queued.` : ''}
          </span>
        </div>
      )}

      {p.pendingDoc && (
        <div className="text-[12px] rounded border border-[var(--kx-line)] p-2" data-testid="layer2-pending">
          <div className="flex items-center justify-between">
            <span className="text-[var(--kx-text)] truncate">{p.pendingDoc.name}</span>
            <button type="button" onClick={p.onClearPending} className="text-[var(--kx-faint)] hover:text-[var(--kx-text)]" aria-label="Dismiss Layer 2 doc notes">
              ×
            </button>
          </div>
          {p.pendingDoc.errors.map((e, i) => (
            <div key={i} className="text-amber-400 mt-1">{e.message}</div>
          ))}
        </div>
      )}

      {p.findings.length > 0 && (
        <ul className="text-[12px] text-amber-400 list-disc pl-4" data-testid="layer2-findings">
          {p.findings.map((f, i) => <li key={i}>{f.message}</li>)}
        </ul>
      )}

      {/* Spot list */}
      <div className="flex flex-col gap-2" data-testid="layer2-list">
        {p.spots.length === 0 && <div className="text-[12px] text-[var(--kx-faint)]">No Layer-2 spots yet.</div>}
        {p.spots.map(s => {
          const r = p.resolved[s.id];
          const name = assetName(s.assetId);
          const label = sceneLabel(p.segments, s.anchorSegmentId);
          return (
            <div key={s.id} data-testid={`layer2-spot-${s.id}`} className="rounded border border-[var(--kx-line)] p-2 text-[12px] flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--kx-text)] truncate">{label ?? 'Scene removed'}</span>
                <button type="button" onClick={() => p.onDeleteSpot(s.id)} aria-label="Delete spot" className="text-[var(--kx-faint)] hover:text-red-400">
                  <Trash2 size={13} />
                </button>
              </div>
              <div className={name ? 'text-[var(--kx-muted)] truncate' : 'text-red-400'}>
                {name ?? (s.assetId ? 'NO CLIP (deleted)' : 'NO CLIP')}
              </div>
              {s.needsReview && (
                <div className="text-amber-400">Needs review — its scene is gone; kept at {formatTime(s.lastKnownStartSec ?? 0)}.</div>
              )}
              <div className="text-[var(--kx-faint)]">
                {r ? `${formatTime(r.startSec)} · ${r.durSec.toFixed(1)}s${s.durOverrideSec !== undefined ? ' (override)' : ''}` : 'Not placed'}
              </div>
              <div className="flex gap-1.5 items-center">
                <select
                  value={s.corner}
                  onChange={e => p.onPatchSpot(s.id, { corner: e.target.value as SpotCorner })}
                  aria-label="Corner"
                  className="bg-[var(--kx-line)] text-[var(--kx-text)] rounded px-1 py-0.5 flex-1"
                >
                  {CORNERS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  placeholder="auto s"
                  aria-label="Duration override (seconds)"
                  defaultValue={s.durOverrideSec ?? ''}
                  onBlur={e => {
                    const v = e.target.value.trim();
                    const n = Number(v);
                    p.onPatchSpot(s.id, { durOverrideSec: v === '' || !(n > 0) ? null : n });
                  }}
                  className="w-16 bg-[var(--kx-line)] text-[var(--kx-text)] rounded px-1 py-0.5"
                />
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
            className="bg-[var(--kx-line)] text-[var(--kx-text)] rounded px-1.5 py-1 flex-1 min-w-0"
          >
            <option value="">Add at scene…</option>
            {p.segments.map((s, i) => <option key={s.id} value={s.id}>{`Scene ${i + 1}${s.tag ? ` · ${s.tag}` : ''}`}</option>)}
          </select>
          <button
            type="button"
            disabled={!addSegId}
            onClick={() => { p.onAddManual(addSegId); setAddSegId(''); }}
            className="px-2 rounded bg-[var(--kx-line)] text-[var(--kx-text)] disabled:opacity-40"
            aria-label="Add spot"
          >
            <Plus size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
