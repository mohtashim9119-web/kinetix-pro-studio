import { describe, it, expect } from 'vitest';
import { createRecoveryActionsFake } from './recoveryActionsFake';

describe('createRecoveryActionsFake', () => {
  it('records relink, save, resume, retry, and choose-folder without I/O', () => {
    const fake = createRecoveryActionsFake();
    fake.onRelink('asset-1');
    fake.onRelink('asset-2');
    fake.onSave();
    fake.onResume();
    fake.onRetryFailed();
    fake.onChooseFolder();
    expect(fake.relinked).toEqual(['asset-1', 'asset-2']);
    expect(fake.saveCount).toBe(1);
    expect(fake.resumeCount).toBe(1);
    expect(fake.retryFailedCount).toBe(1);
    expect(fake.chooseFolderCount).toBe(1);
  });
});
