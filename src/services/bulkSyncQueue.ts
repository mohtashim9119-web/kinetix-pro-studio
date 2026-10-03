/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7 — the app's one bulk queue (cloud engine). A module singleton,
// like the sync-intent registry: it outlives the dashboard, so leaving the
// project grid does not stop a batch that is running.

import { SyncQueue } from './syncQueue';
import { cloudQueueEngine, createCloudProjectJob, defaultCloudQueueDeps, type CloudQueueDeps } from './cloudQueueJob';
import { markBulkQueuePumping } from './cloudGpuDoor';

export const cloudSyncQueue = new SyncQueue(cloudQueueEngine);
cloudSyncQueue.subscribe(() => markBulkQueuePumping(cloudSyncQueue.snapshot().running));

/** Queues these stored projects for a cloud sync. Returns how many were added
 *  (a project already live in the queue is not added twice). */
export function queueProjectsForCloudSync(
  projects: readonly { id: string; name: string; checkpoint?: import('./bulkBatch').BulkCheckpoint; contentKey?: string }[],
  parseProjectData: CloudQueueDeps['parseProjectData'],
  opts?: { next?: boolean },
): number {
  const deps: CloudQueueDeps = {
    ...defaultCloudQueueDeps(parseProjectData),
    noteContent: (id, key) => { runner?.noteContent(id, key); },
    noteCloudJob: (id, jobId) => { runner?.noteCloudJob(id, jobId); },
  };
  return cloudSyncQueue.enqueue(projects.map(p => createCloudProjectJob(p, deps)), opts);
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
    enqueue: (rows, opts) => { if (parseForResume) queueProjectsForCloudSync(rows, parseForResume, opts); },
    exists: id => loadAllMetas().some(m => m.id === id),
  });
  return runner;
}
