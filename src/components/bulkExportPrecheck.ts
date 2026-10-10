/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bulk Export pre-check — run on every not-started (Ready) project as soon as
// the pane shows, BEFORE the operator clicks Export: a project whose sync log
// has unresolved actions — or whose media is really offline in storage — goes
// to Blocked. Media comes from the same storage seam Start uses (a stored
// record has no media URLs; log-recorded offline entries are stale snapshots
// and never block); the rest of the sync-log actions are the newest sync's.
// No export-path check here. View-side only: reads, never writes, never
// touches the queue.

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadProject } from '../services/projectStore';
import { buildSyncGroups } from '../services/syncLogGroups';
import { withStorageAvailability } from '../services/bulkExportMedia';
import { BULK_EXPORT_OFFLINE, preflightBulkExport } from '../services/bulkExportPreflight';
import type { Project } from '../types';

/** The sync log panel's dismissals (the same store it reads and writes). */
const SYNC_LOG_DISMISSED_KEY = 'kx-sync-log-dismissed';

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(SYNC_LOG_DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * Why this project should wait, or null when it is clear:
 *  1. a segment's media is really offline (storage holds no bytes for it) —
 *     the same availability seam and media check Start uses;
 *  2. any unresolved action in its newest sync (the sync log panel's own
 *     action groups, minus items the operator marked resolved). Media and
 *     Layer 2 actions come from the project's current state, not the log's
 *     snapshots; offline is storage's call (1).
 */
export async function precheckProject(
  id: string,
  deps: {
    load?: (id: string) => Promise<{ project: Project } | null>;
    withAvailability?: (p: Project) => Promise<Project>;
  } = {},
): Promise<string | null> {
  let loaded: { project: Project } | null;
  try {
    loaded = await (deps.load ?? loadProject)(id);
  } catch {
    return null;
  }
  if (!loaded) return null;
  const project = loaded.project;

  const checked = await (deps.withAvailability ?? withStorageAvailability)(project);
  if (preflightBulkExport(checked.segments, checked.assets).kind === 'block') return BULK_EXPORT_OFFLINE;

  // The newest sync's media / Layer 2 actions are LIVE state, never the log's
  // frozen records (the sync log panel does the same: it replaces the log's
  // "missing media" lines with the project as it is now). Without this a
  // media gap fixed after the sync stayed blocked forever. Assets carry the
  // storage-availability stamp, so a stored record's empty URLs read right.
  const view = buildSyncGroups({
    log: project.syncLog ?? [],
    summaries: project.syncRunSummaries ?? [],
    live: { segments: checked.segments, assets: checked.assets, spots: checked.spots ?? [] },
    dismissed: readDismissed(),
  });
  const open = (view.syncs[0]?.actions ?? []).filter(g => g.id !== 'offline-media');
  if (open.length === 0) return null;
  const items = open.reduce((n, g) => n + g.items.length, 0);
  return `Blocked — ${items === 1 ? '1 unresolved action' : `${items} unresolved actions`} in the sync log (${open[0]!.title})`;
}

export interface PrecheckTarget { id: string; savedAt?: number; lastExportPath?: string }

/**
 * Verdicts remembered per project + record save time: loading a stored record
 * is the expensive part (large projects), and a record that was not saved again
 * cannot have a different verdict. A save moves `savedAt`, which is the key.
 * `force` (Retry / Start) always re-reads. A record with no save time is never
 * cached (nothing says when it changed).
 */
export class PrecheckCache {
  private entries = new Map<string, { savedAt: number; verdict: Promise<string | null> }>();

  check(
    id: string,
    savedAt: number | undefined,
    compute: () => Promise<string | null>,
    force = false,
  ): Promise<string | null> {
    if (savedAt === undefined) return compute();
    const hit = this.entries.get(id);
    if (!force && hit && hit.savedAt === savedAt) return hit.verdict;
    const verdict = compute();
    this.entries.set(id, { savedAt, verdict });
    // A check that throws must not poison the cache.
    verdict.catch(() => { if (this.entries.get(id)?.verdict === verdict) this.entries.delete(id); });
    return verdict;
  }
}

const sharedCache = new PrecheckCache();

/**
 * Verdicts for these projects, re-checked whenever one is saved again (or
 * `nonce` changes — the pane coming on screen). `recheck` runs the check now
 * for some ids and returns their fresh verdicts.
 */
export function useExportPrecheck(
  targets: readonly PrecheckTarget[],
  nonce: number,
  deps: { check?: (id: string) => Promise<string | null>; cache?: PrecheckCache } = {},
): {
  verdicts: ReadonlyMap<string, string>;
  checking: boolean;
  recheck: (ids: readonly string[]) => Promise<ReadonlyMap<string, string | null>>;
} {
  const [verdicts, setVerdicts] = useState<ReadonlyMap<string, string>>(new Map());
  const [checking, setChecking] = useState(false);
  const checkedAt = useRef(new Map<string, string>());
  const byId = useRef(new Map<string, PrecheckTarget>());
  const lastNonce = useRef<number | null>(null);
  byId.current = new Map(targets.map(t => [t.id, t]));

  const apply = useCallback((results: ReadonlyMap<string, string | null>) => {
    setVerdicts(prev => {
      const next = new Map(prev);
      for (const [id, reason] of results) {
        if (reason) next.set(id, reason);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const depsRef = useRef(deps);
  depsRef.current = deps;
  const run = useCallback(async (ids: readonly string[], force = false): Promise<ReadonlyMap<string, string | null>> => {
    const out = new Map<string, string | null>();
    const cache = depsRef.current.cache ?? sharedCache;
    const check = depsRef.current.check ?? precheckProject;
    for (const id of ids) {
      const t = byId.current.get(id);
      out.set(id, await cache.check(id, t?.savedAt, () => check(id), force));
      checkedAt.current.set(id, `${t?.savedAt ?? 0}|${t?.lastExportPath ?? ''}`);
    }
    apply(out);
    return out;
  }, [apply]);

  const key = targets.map(t => `${t.id}:${t.savedAt ?? 0}:${t.lastExportPath ?? ''}`).join('|');
  useEffect(() => {
    let live = true;
    const stale = targets
      .filter(t => checkedAt.current.get(t.id) !== `${t.savedAt ?? 0}|${t.lastExportPath ?? ''}`)
      .map(t => t.id);
    // The pane came on screen (nonce moved): every target is looked at again,
    // but a project not saved since its last check answers from the cache
    // (no record load). Otherwise only the ones saved (or re-pathed) since.
    const fresh = nonce !== lastNonce.current;
    lastNonce.current = nonce;
    const ids = fresh ? targets.map(t => t.id) : stale;
    if (ids.length === 0) return;
    setChecking(true);
    void run(ids).finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  // Retry's re-check is always fresh: it reads the record again.
  const recheck = useCallback((ids: readonly string[]) => run(ids, true), [run]);
  return { verdicts, checking, recheck };
}
