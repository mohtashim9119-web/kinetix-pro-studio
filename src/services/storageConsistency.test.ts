import { describe, expect, it } from 'vitest';
import { describeFinding, type ConsistencyFinding } from './storageConsistency';

const base: ConsistencyFinding = {
  id: 'x', kind: 'recordNotOnDashboard', name: 'Alpha', segmentCount: 3, tombstoned: false, paths: [],
};

describe('describeFinding', () => {
  it('names each finding kind in plain language', () => {
    expect(describeFinding(base)).toContain('not listed on this dashboard');
    expect(describeFinding({ ...base, kind: 'dashboardWithoutRecord' })).toContain('saved data is missing');
    expect(describeFinding({ ...base, kind: 'emptyStoreDir', name: null })).toContain('empty project folder');
  });
  it('tells deletion residue from a project that lost its record', () => {
    const residue = describeFinding({ ...base, kind: 'dataWithoutRecord', tombstoned: true });
    const lost = describeFinding({ ...base, kind: 'dataWithoutRecord', tombstoned: false });
    expect(residue).toContain('deleted project');
    expect(lost).toContain('project itself is gone');
  });
  it('does not invent a name for an unnamed project', () => {
    expect(describeFinding({ ...base, name: null })).toContain('an unnamed project');
  });
});
