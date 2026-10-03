/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetCloudWorkerSecForTests,
  cloudWorkerSecForLane,
  cloudWorkerSecForTarget,
  noteCloudJobWorkerSec,
} from './cloudSyncEngine';

beforeEach(() => {
  __resetCloudWorkerSecForTests();
});

describe('F2 per-lane cost attribution', () => {
  it('bulk row cost never includes editor-lane seconds', () => {
    noteCloudJobWorkerSec('bulk-j1', 12, 'bulk');
    noteCloudJobWorkerSec('edit-j1', 5, 'editor');
    expect(cloudWorkerSecForLane('bulk')).toBe(12);
    expect(cloudWorkerSecForLane('editor')).toBe(5);
    expect(cloudWorkerSecForTarget({ rowId: 'row-1' })).toBe(0);
  });
});
