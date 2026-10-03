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
  markBulkQueuePumping,
  waitForEditorCloudGpu,
  editorCloudGpuBlockedReason,
} from './cloudGpuDoor';

beforeEach(() => {
  __resetCloudGpuDoorForTests();
});

describe('H2 one GPU door', () => {
  it('editor sync waits while the bulk queue pumps, then both complete; never two GPU clients', async () => {
    markBulkQueuePumping(true);
    expect(editorCloudGpuBlockedReason()).toBe('waiting-bulk');

    let editorStarted = false;
    const editor = (async () => {
      await waitForEditorCloudGpu();
      editorStarted = true;
    })();

    await new Promise(r => setTimeout(r, 20));
    expect(editorStarted).toBe(false);

    markBulkQueuePumping(false);
    await editor;
    expect(editorStarted).toBe(true);
  });

  it('waitForEditorCloudGpu is a no-op when bulk is idle', async () => {
    markBulkQueuePumping(false);
    await waitForEditorCloudGpu();
    expect(editorCloudGpuBlockedReason()).toBeUndefined();
  });

  it('editor intent and host transcribe wait on the bulk GPU door outside tests', () => {
    const intent = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), './cloudSyncIntent.ts'), 'utf8');
    expect(intent).toMatch(/waitForEditorCloudGpu/);
    expect(intent).toMatch(/waiting-bulk/);
    const host = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), './cloudSyncEngine.ts'), 'utf8');
    expect(host).toMatch(/waitForEditorCloudGpu/);
  });
});
