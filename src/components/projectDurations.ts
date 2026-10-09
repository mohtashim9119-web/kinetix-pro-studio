/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Workspace cards — each project's timeline length, read from its stored
// record (the timeline is a gapless partition, so its length is the end of
// the last segment). Read-only and cached per project + save time, so a card
// re-reads a project only after it was saved again.

import { useEffect, useState } from 'react';
import { loadProject } from '../services/projectStore';

const cache = new Map<string, { savedAt: number; sec: number }>();
const inflight = new Set<string>();

function timelineSec(segments: readonly { startTime: number; duration: number }[]): number {
  let end = 0;
  for (const s of segments) end = Math.max(end, (s.startTime ?? 0) + (s.duration ?? 0));
  return end;
}

/** Seconds per project id, filled in as records load (missing = not loaded yet / unreadable). */
export function useProjectDurations(projects: readonly { id: string; savedAt?: number }[]): ReadonlyMap<string, number> {
  const [, bump] = useState(0);
  const key = projects.map(p => `${p.id}:${p.savedAt ?? 0}`).join('|');
  useEffect(() => {
    let live = true;
    const stale = projects.filter(p => p.savedAt && cache.get(p.id)?.savedAt !== p.savedAt && !inflight.has(p.id));
    if (stale.length === 0) return;
    void (async () => {
      for (const p of stale) {
        inflight.add(p.id);
        try {
          const loaded = await loadProject(p.id);
          if (loaded) cache.set(p.id, { savedAt: p.savedAt!, sec: timelineSec(loaded.project.segments ?? []) });
        } catch { /* unreadable record: no duration shown for it */ }
        finally { inflight.delete(p.id); }
        if (live) bump(n => n + 1);
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const out = new Map<string, number>();
  for (const p of projects) {
    const hit = cache.get(p.id);
    if (hit) out.set(p.id, hit.sec);
  }
  return out;
}

export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}
