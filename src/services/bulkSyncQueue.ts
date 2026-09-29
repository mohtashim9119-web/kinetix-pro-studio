/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7 — the app's one bulk queue (cloud engine). A module singleton,
// like the sync-intent registry: it outlives the dashboard, so leaving the
// project grid does not stop a batch that is running.

import { SyncQueue } from './syncQueue';
import { cloudQueueEngine, createCloudProjectJob, defaultCloudQueueDeps, type CloudQueueDeps } from './cloudQueueJob';

export const cloudSyncQueue = new SyncQueue(cloudQueueEngine);

/** Queues these stored projects for a cloud sync. Returns how many were added
 *  (a project already live in the queue is not added twice). */
export function queueProjectsForCloudSync(
  projects: readonly { id: string; name: string }[],
  parseProjectData: CloudQueueDeps['parseProjectData'],
): number {
  const deps = defaultCloudQueueDeps(parseProjectData);
  return cloudSyncQueue.enqueue(projects.map(p => createCloudProjectJob(p, deps)));
}

// Wave 3 U7.8 — the persistent batch: survives closing the window, a reload,
// a quit or a crash (see bulkBatch.ts). Created lazily so importing this
// module stays side-effect free for tests.
import { BulkBatchRunner } from './bulkBatch';
import { loadAllMetas } from './projectStore';

let runner: BulkBatchRunner | undefined;
let parseForResume: CloudQueueDeps['parseProjectData'] | undefined;

export function bulkBatchRunner(parseProjectData?: CloudQueueDeps['parseProjectData']): BulkBatchRunner {
  if (parseProjectData) parseForResume = parseProjectData;
  runner ??= new BulkBatchRunner({
    queue: cloudSyncQueue,
    enqueue: rows => { if (parseForResume) queueProjectsForCloudSync(rows, parseForResume); },
    exists: id => loadAllMetas().some(m => m.id === id),
  });
  return runner;
}
