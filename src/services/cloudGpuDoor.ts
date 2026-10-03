/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Two GPU lanes: bulk stays FIFO-serial; editor syncs run on their own
 *  lane immediately (a second cold boot is an acceptable, disclosed cost). */

export const PARALLEL_GPU_NOTICE =
  'This sync runs in parallel — it may start a second cloud worker (about $0.01 extra).';

let bulkPumping = false;
let editorChain: Promise<unknown> = Promise.resolve();
let notice: string | undefined;
const noticeListeners = new Set<() => void>();

export function markBulkQueuePumping(pumping: boolean): void {
  bulkPumping = pumping;
}

export function bulkLaneIsLive(): boolean {
  return bulkPumping;
}

function notifyNotice(): void {
  for (const l of noticeListeners) l();
}

/** Editor-lane mutex: one job at a time. Does not wait on the bulk lane. */
export async function runOnEditorLane<T>(work: () => Promise<T>): Promise<T> {
  const run = editorChain.then(async () => {
    if (bulkPumping) {
      notice = PARALLEL_GPU_NOTICE;
      notifyNotice();
    }
    return work();
  });
  editorChain = run.then(() => undefined, () => undefined);
  return run as Promise<T>;
}

export function peekParallelGpuNotice(): string | undefined {
  return notice;
}

export function dismissParallelGpuNotice(): void {
  notice = undefined;
  notifyNotice();
}

export function subscribeParallelGpuNotice(listener: () => void): () => void {
  noticeListeners.add(listener);
  return () => { noticeListeners.delete(listener); };
}

export function __resetCloudGpuDoorForTests(): void {
  bulkPumping = false;
  editorChain = Promise.resolve();
  notice = undefined;
  noticeListeners.clear();
}
