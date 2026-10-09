/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bulk Export pre-check — run on every not-started (Ready) project as soon as
// the pane shows, BEFORE the operator clicks Export: a project whose sync log
// has unresolved actions goes to Blocked. Decided by the sync log alone (the
// operator's rule) — no media or export-path checks here. View-side only:
// reads the stored record, never writes, never touches the queue.

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadProject } from '../services/projectStore';
import { buildSyncGroups } from '../services/syncLogGroups';

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
 * Why this project should wait, or null when it is clear — decided by its
 * sync log alone: any unresolved action in its newest sync (the sync log
 * panel's own action groups, minus items the operator marked resolved).
 * Reads only the stored record; never loads media or touches storage.
 */
export async function precheckProject(id: string): Promise<string | null> {
  let loaded: Awaited<ReturnType<typeof loadProject>>;
  try {
    loaded = await loadProject(id);
  } catch {
    return null;
  }
  if (!loaded) return null;
  const project = loaded.project;
  const view = buildSyncGroups({
    log: project.syncLog ?? [],
    summaries: project.syncRunSummaries ?? [],
    // No live media view: a stored record has no media URLs, so live media
    // checks would call every asset offline. The log's own records decide.
    dismissed: readDismissed(),
  });
  const open = view.syncs[0]?.actions ?? [];
  if (open.length === 0) return null;
  const items = open.reduce((n, g) => n + g.items.length, 0);
  return `Blocked — ${items === 1 ? '1 unresolved action' : `${items} unresolved actions`} in the sync log (${open[0]!.title})`;
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
      out.set(id, await precheckProject(id));
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
