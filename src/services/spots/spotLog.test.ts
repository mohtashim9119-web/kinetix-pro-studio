/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { buildSpotFindingEntries } from './spotLog';
import { attentionKindForEntry } from '../syncLogUserView';

describe('buildSpotFindingEntries', () => {
  it('one details-only info entry per finding, stamped with its kind', () => {
    const es = buildSpotFindingEntries('run1', [
      { kind: 'spot-overlap', message: 'm1' },
      { kind: 'spot-clip-missing', message: 'm2' },
    ]);
    expect(es.map(e => [e.type, e.message, e.finding?.kind, e.syncRunId])).toEqual([
      ['info', 'm1', 'spot-overlap', 'run1'],
      ['info', 'm2', 'spot-clip-missing', 'run1'],
    ]);
    expect(es.every(e => attentionKindForEntry(e) === undefined)).toBe(true);
  });
  it('empty in, empty out', () => expect(buildSpotFindingEntries('r', [])).toEqual([]));
});
