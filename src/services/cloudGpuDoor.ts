/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** At most one GPU client: the bulk queue owns the door while it pumps. */

let bulkPumping = false;
const waiters = new Set<() => void>();

export function markBulkQueuePumping(pumping: boolean): void {
  bulkPumping = pumping;
  if (!pumping) {
    const due = [...waiters];
    waiters.clear();
    for (const w of due) w();
  }
}

export function editorCloudGpuBlockedReason(): 'waiting-bulk' | undefined {
  return bulkPumping ? 'waiting-bulk' : undefined;
}

export async function waitForEditorCloudGpu(signal?: AbortSignal, onWait?: () => void): Promise<void> {
  while (bulkPumping) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onWait?.();
    await new Promise<void>((resolve, reject) => {
      const finish = (): void => {
        signal?.removeEventListener('abort', onAbort);
        waiters.delete(finish);
        resolve();
      };
      const onAbort = (): void => {
        waiters.delete(finish);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      waiters.add(finish);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

export function __resetCloudGpuDoorForTests(): void {
  bulkPumping = false;
  waiters.clear();
}
