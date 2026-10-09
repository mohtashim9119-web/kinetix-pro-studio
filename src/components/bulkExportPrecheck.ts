/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bulk Export pre-check — run on every not-started (Ready) project as soon as
// the pane shows, BEFORE the operator clicks Export, with full read access to
// each stored project:
//   1. the export queue's own Start checks (export path, media), via the same
//      service functions it calls — so the verdict matches what Start would do;
//   2. the project's sync log: any unresolved action (the sync log panel's own
//      action groups — skipped scenes, mismatches, a stopped sync, offline
//      media …, minus what the operator marked resolved).
// A project with either goes to Blocked. View-side only: reads, never writes,
// and never touches the queue.

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadProject } from '../services/projectStore';
import { settingsFromProject } from '../services/bulkExportSettings';
import { preflightBulkExport } from '../services/bulkExportPreflight';
import { buildSyncGroups } from '../services/syncLogGroups';
import { getProjectAssetRecoveryStatus } from '../services/assetRecovery';
import type { Asset } from '../types';

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

/** The record's assets with `url` / `unresolved` set from real storage
 *  availability (the project-open path's own check). If storage cannot be
 *  read, nothing is marked offline — a pre-check never invents a block. */
async function withStorageAvailability(projectId: string, assets: readonly Asset[]): Promise<Asset[]> {
  let resolved: Map<string, boolean> | null = null;
  try {
    const status = await getProjectAssetRecoveryStatus(projectId);
    if (status) resolved = new Map(status.assets.map(a => [a.assetId, a.resolved]));
  } catch { resolved = null; }
  return assets.map(a => {
    const available = resolved ? resolved.get(a.id) === true : true;
    // Any non-empty url means "has bytes" to the media check; it is never loaded here.
    return available ? { ...a, url: a.url || 'stored:', unresolved: false } : { ...a, url: '', unresolved: true };
  });
}

/** Why this project cannot export yet, or null when it is clear. */
export async function precheckProject(id: string, lastExportPath?: string): Promise<string | null> {
  let loaded: Awaited<ReturnType<typeof loadProject>>;
  try {
    loaded = await loadProject(id);
  } catch (err) {
    return `Blocked — could not open the project: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (!loaded) return 'Blocked — project missing';
  const project = loaded.project;

  const settings = settingsFromProject(project, new Date(), lastExportPath);
  if ('blocked' in settings) return settings.blocked;

  // A STORED record never carries media URLs (projectStore writes every asset
  // with url ''), and may carry a stale `unresolved` flag from an old session —
  // so judging media from the record says "offline" for every project. Ask
  // storage instead, exactly as opening the project does: an asset is
  // available when its bytes are in the cache or the native store.
  const assets = await withStorageAvailability(id, project.assets);
  const gate = preflightBulkExport(project.segments, assets);
  if (gate.kind === 'block') return gate.message;

  const view = buildSyncGroups({
    log: project.syncLog ?? [],
    summaries: project.syncRunSummaries ?? [],
    live: { segments: project.segments, assets, spots: project.spots ?? [] },
    dismissed: readDismissed(),
  });
  const newest = view.syncs[0];
  const open = newest?.actions ?? [];
  if (open.length > 0) {
    const items = open.reduce((n, g) => n + g.items.length, 0);
    return `Blocked — ${items === 1 ? '1 unresolved action' : `${items} unresolved actions`} in the sync log (${open[0]!.title})`;
  }
  return null;
}

export interface PrecheckTarget { id: string; savedAt?: number; lastExportPath?: string }

/**
 * Verdicts for these projects, re-checked whenever one is saved again (or
 * `nonce` changes — the pane coming on screen). `recheck` runs the check now
 * for some ids and returns their fresh verdicts.
 */
export function useExportPrecheck(targets: readonly PrecheckTarget[], nonce: number): {
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

  const run = useCallback(async (ids: readonly string[]): Promise<ReadonlyMap<string, string | null>> => {
    const out = new Map<string, string | null>();
    for (const id of ids) {
      const t = byId.current.get(id);
      out.set(id, await precheckProject(id, t?.lastExportPath));
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
    // The pane came on screen (nonce moved): check every target again — sync
    // logs and media can change without a save the dashboard sees. Otherwise
    // only the ones saved (or re-pathed) since their last check.
    const fresh = nonce !== lastNonce.current;
    lastNonce.current = nonce;
    const ids = fresh ? targets.map(t => t.id) : stale;
    if (ids.length === 0) return;
    setChecking(true);
    void run(ids).finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  return { verdicts, checking, recheck: run };
}
