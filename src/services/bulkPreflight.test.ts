/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { bulkPreflight } from './bulkPreflight';

describe('P10 pre-flight', () => {
  it('rejects a bad file before any cloud call', () => {
    expect(bulkPreflight({ sceneText: '', durationSec: 30 }).ok).toBe(false);
    expect(bulkPreflight({ sceneText: 'Scene one', durationSec: 0 }).ok).toBe(false);
    expect(bulkPreflight({ sceneText: 'Scene one', audioError: 'not audio' }).ok).toBe(false);
    const bad = bulkPreflight({ sceneText: '', durationSec: 90 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/scene/i);
  });

  it('accepts a real spine and names duration, scene count, and a cost estimate', () => {
    const ok = bulkPreflight({ sceneText: 'Intro\nOutro', durationSec: 120 });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.sceneCount).toBe(2);
    expect(ok.durationSec).toBe(120);
    expect(ok.estimatedUsd).toBeGreaterThan(0);
    expect(ok.summary).toMatch(/2 scenes/);
    expect(ok.summary).toMatch(/about \$/);
  });
});
