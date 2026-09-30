import { describe, it, expect } from 'vitest';
import { describeVaultRecovery, unacknowledgedFindings, type VaultRecoveryFinding } from './vaultRecovery';

const base: VaultRecoveryFinding = {
  kind: 'vault-registry-recovered',
  mode: 'salvage',
  atMs: 1,
  entriesRecovered: 4,
  corruptSha256: 'ab'.repeat(32),
  corruptBytes: 100,
  quarantinePath: '/q/vault-registry-abc',
  detail: 'raw detail',
  acknowledged: false,
};

describe('describeVaultRecovery', () => {
  it('salvage says nothing was lost', () => {
    expect(describeVaultRecovery(base)).toBe('The media library index was damaged and was repaired with nothing lost (4 media items kept).');
  });
  it('last-good warns that later changes may need re-importing', () => {
    expect(describeVaultRecovery({ ...base, mode: 'lastgood', entriesRecovered: 1 })).toContain('may need re-importing');
  });
  it('rebuild states how many titles reverted to a placeholder, and stays quiet at zero', () => {
    expect(describeVaultRecovery({ ...base, mode: 'rebuild', renamedTitlesReverted: 2 })).toContain('2 titles could not be recovered');
    expect(describeVaultRecovery({ ...base, mode: 'rebuild', renamedTitlesReverted: 1 })).toContain('1 title could not be recovered');
    expect(describeVaultRecovery({ ...base, mode: 'rebuild', renamedTitlesReverted: 0 })).not.toContain('placeholder');
  });
  it('an unverified backup copy has its own sentence', () => {
    expect(describeVaultRecovery({ ...base, kind: 'vault-lastgood-unverified', mode: null })).toContain('backup copy could not be verified');
  });
});

describe('unacknowledgedFindings', () => {
  it('keeps only the ones the user has not dismissed', () => {
    expect(unacknowledgedFindings([base, { ...base, acknowledged: true }])).toHaveLength(1);
  });
});
