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
