/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { shouldClearStagedAfterSync } from './applySyncAbort';

describe('shouldClearStagedAfterSync (plan-v3 item 9 completion)', () => {
  it('keeps staged rows only when the run says holdStaged', () => {
    expect(shouldClearStagedAfterSync({ ok: false, message: 'paused', holdStaged: true })).toBe(false);
    expect(shouldClearStagedAfterSync({ ok: true })).toBe(true);
    expect(shouldClearStagedAfterSync({ ok: false, message: 'Sync cancelled.' })).toBe(true);
    expect(shouldClearStagedAfterSync(undefined)).toBe(true);
  });
});
