import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withAssetLoadTimeout, AssetLoadTimeoutError, ASSET_LOAD_TIMEOUT_MS } from './assetLoadTimeout';

describe('withAssetLoadTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when the underlying promise settles first', async () => {
    const p = withAssetLoadTimeout(Promise.resolve(42), 'fast');
    await expect(p).resolves.toBe(42);
  });

  it('rejects with AssetLoadTimeoutError when the deadline passes', async () => {
    const p = withAssetLoadTimeout(new Promise<number>(() => {}), 'stuck', 100);
    vi.advanceTimersByTime(100);
    await expect(p).rejects.toBeInstanceOf(AssetLoadTimeoutError);
    await expect(p).rejects.toMatchObject({ label: 'stuck', timeoutMs: 100 });
  });

  it('exports a default timeout long enough for large libraries', () => {
    expect(ASSET_LOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
  });
});
