/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  __resetCloudGpuDoorForTests,
  PARALLEL_GPU_NOTICE,
  dismissParallelGpuNotice,
  markBulkQueuePumping,
  peekParallelGpuNotice,
  runOnEditorLane,
} from './cloudGpuDoor';

beforeEach(() => {
  __resetCloudGpuDoorForTests();
});

describe('F2 parallel GPU lanes', () => {
  it('editor lane starts immediately while bulk is pumping (no waiting gate)', async () => {
    markBulkQueuePumping(true);
    let started = false;
    await runOnEditorLane(async () => { started = true; });
    expect(started).toBe(true);
    expect(peekParallelGpuNotice()).toBe(PARALLEL_GPU_NOTICE);
  });

  it('two editor syncs serialize within the editor lane', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = runOnEditorLane(() => new Promise<void>(resolve => {
      order.push('a-start');
      releaseFirst = resolve;
    }));
    const second = runOnEditorLane(async () => { order.push('b'); });
    await new Promise(r => setTimeout(r, 20));
    expect(order).toEqual(['a-start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['a-start', 'b']);
  });

  it('the parallel notice shows once per event, is dismissible, and never blocks', async () => {
    markBulkQueuePumping(true);
    let editorDone = false;
    const work = runOnEditorLane(async () => {
      expect(peekParallelGpuNotice()).toBe(PARALLEL_GPU_NOTICE);
      dismissParallelGpuNotice();
      expect(peekParallelGpuNotice()).toBeUndefined();
      editorDone = true;
    });
    await work;
    expect(editorDone).toBe(true);
    expect(peekParallelGpuNotice()).toBeUndefined();
  });

  it('waiting-bulk overlay and waitForEditorCloudGpu are gone', () => {
    const intent = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), './cloudSyncIntent.ts'), 'utf8');
    expect(intent).not.toMatch(/waitForEditorCloudGpu/);
    expect(intent).not.toMatch(/waiting-bulk/);
    expect(intent).not.toMatch(/Waiting for bulk cloud work to finish/);
    const host = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), './cloudSyncEngine.ts'), 'utf8');
    expect(host).not.toMatch(/waitForEditorCloudGpu/);
    const door = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), './cloudGpuDoor.ts'), 'utf8');
    expect(door).not.toMatch(/waitForEditorCloudGpu/);
  });
});
