/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// Layer 2 spots R4 — the wand's summary reports BOTH layers.
import { describe, it, expect } from 'vitest';
import { MEDIA_COPY } from './MediaBlock';
import { buildMediaMatchEntry } from '../services/syncLog';

const base = { matched: 3, unmatched: 1, filled: 0, placeholders: 0, conflicts: 0, manualKept: 0 };

describe('wand summary — both layers', () => {
  it('layer-1 only: unchanged', () => {
    expect(MEDIA_COPY.matchSummary(base)).toBe('Matched 3 · 1 unmatched');
  });
  it('with spots: a second Layer 2 line', () => {
    expect(MEDIA_COPY.matchSummary({ ...base, layer2: { matched: 2, unmatched: 1, conflicts: 0 } }))
      .toBe('Matched 3 · 1 unmatched\nLayer 2: matched 2 · 1 unmatched');
  });
  it('sync-log entry carries the Layer 2 line when given', () => {
    const e = buildMediaMatchEntry('r', { matched: 1, unmatched: [], ambiguous: [], layer2: { matched: 2, unmatched: 1 } });
    expect(e.message).toContain('Layer 2: matched 2 · 1 unmatched');
    const none = buildMediaMatchEntry('r', { matched: 1, unmatched: [], ambiguous: [] });
    expect(none.message).not.toContain('Layer 2');
  });
});
