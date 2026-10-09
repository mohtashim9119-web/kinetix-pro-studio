/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// One pipeline per project. Ruling: a project is never actively SYNCING and
// actively EXPORTING at the same moment — any mix of bulk sync (cloud queue
// and its background finish), editor Apply Sync, bulk export and the editor's
// manual export. Different projects never block each other.
//
// Claims are taken at the moment work actually starts (a queue job's run, an
// editor button press), never at enqueue time, and live only in this JS
// session's memory — so a reload starts with nothing held, and every restored
// row re-claims when (and if) it runs again. Same-kind claims stack: the bulk
// export job claims 'export' and the export engine it drives claims it again.

import type { QueueJobOutcome } from './syncQueue';

export type PipelineKind = 'sync' | 'export';

/** The queue-outcome reason a parked (waiting) row carries. */
export const PIPELINE_BUSY_REASON = 'pipeline-busy';

export const WAITING_FOR_SYNC = 'Waiting — project is syncing';
export const WAITING_FOR_EXPORT = 'Waiting — project is exporting';

/** Editor-side blocking copy (the sync / export buttons). */
export const SYNC_BLOCKED_BY_EXPORT =
  'This project is exporting — sync is blocked until the export finishes.';
export const EXPORT_BLOCKED_BY_SYNC =
  'This project is syncing — export is blocked until the sync finishes.';

const held = new Map<string, { kind: PipelineKind; count: number }>();
const listeners = new Set<() => void>();

/** The OTHER pipeline holding this project, or null when `kind` may start. */
export function pipelineConflict(projectId: string, kind: PipelineKind): PipelineKind | null {
  const h = held.get(projectId);
  return h && h.kind !== kind ? h.kind : null;
}

/** Claims `kind` on this project. Null when the other pipeline holds it —
 *  nothing is claimed then. Otherwise an idempotent release. */
export function claimPipeline(projectId: string, kind: PipelineKind): (() => void) | null {
  if (pipelineConflict(projectId, kind)) return null;
  const h = held.get(projectId);
  if (h) h.count += 1;
  else held.set(projectId, { kind, count: 1 });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const cur = held.get(projectId);
    if (!cur) return;
    cur.count -= 1;
    if (cur.count <= 0) held.delete(projectId);
    for (const l of [...listeners]) l();
  };
}

/** Called after any release (a waiting row may now proceed). */
export function onPipelineReleased(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function waitingMessageFor(other: PipelineKind): string {
  return other === 'sync' ? WAITING_FOR_SYNC : WAITING_FOR_EXPORT;
}

/** A queue job's run under the guard: when the other pipeline holds this
 *  project, nothing runs and the row parks as Waiting (the queue advances);
 *  otherwise the claim is held for the whole run and always released. */
export async function runGuarded(
  projectId: string,
  kind: PipelineKind,
  run: () => Promise<QueueJobOutcome>,
): Promise<QueueJobOutcome> {
  const other = pipelineConflict(projectId, kind);
  const release = other ? null : claimPipeline(projectId, kind);
  if (!release) {
    return { status: 'paused', reason: PIPELINE_BUSY_REASON, detail: waitingMessageFor(other ?? (kind === 'sync' ? 'export' : 'sync')) };
  }
  try {
    return await run();
  } finally {
    release();
  }
}

/** What holds what, for tests and diagnostics. */
export function heldPipelines(): ReadonlyMap<string, PipelineKind> {
  return new Map([...held].map(([id, h]) => [id, h.kind]));
}

export function __resetPipelineGuardForTests(): void {
  held.clear();
  listeners.clear();
}
