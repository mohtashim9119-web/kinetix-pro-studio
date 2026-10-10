import { describe, it, expect } from 'vitest';
import { trackExportTeardown, awaitExportTeardown } from './exportTeardownLatch';

const deferred = (): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } => {
  let resolve!: () => void; let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('export teardown latch', () => {
  it('is open when nothing is tearing down', async () => {
    await expect(awaitExportTeardown()).resolves.toBeUndefined();
  });

  it('holds until every registered teardown has settled', async () => {
    const a = deferred(); const b = deferred();
    trackExportTeardown(a.promise); trackExportTeardown(b.promise);
    let open = false;
    void awaitExportTeardown().then(() => { open = true; });
    a.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(open).toBe(false);
    b.resolve(); await awaitExportTeardown();
    expect(open).toBe(true);
  });

  it('a teardown that rejects still opens the latch (the next start is never wedged)', async () => {
    const a = deferred();
    trackExportTeardown(a.promise);
    a.reject(new Error('kill failed'));
    await expect(awaitExportTeardown()).resolves.toBeUndefined();
  });
});
