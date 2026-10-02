/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach } from 'vitest';
import { sha256HexOffthread, __setIngestWorkerForTests } from './ingestOffthread';

afterEach(() => {
  __setIngestWorkerForTests(null);
});

describe('ingestOffthread — Worker path yields the main thread', () => {
  it('a slow hash Worker leaves ping gaps under 50ms while the work is in flight', async () => {
    class FakeWorker {
      onmessage: ((e: MessageEvent<{ id: number; kind: 'hash'; hex: string }>) => void) | null = null;
      postMessage(msg: { id: number }) {
        setTimeout(() => {
          this.onmessage?.({ data: { id: msg.id, kind: 'hash', hex: 'ab' } } as MessageEvent<{ id: number; kind: 'hash'; hex: string }>);
        }, 120);
      }
      terminate() {}
      onerror = null;
    }
    __setIngestWorkerForTests(new FakeWorker() as unknown as Worker);
    const gaps: number[] = [];
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      gaps.push(now - last);
      last = now;
    }, 16);
    const hex = await sha256HexOffthread(new Uint8Array([1, 2, 3]));
    clearInterval(id);
    expect(hex).toBe('ab');
    expect(Math.max(0, ...gaps)).toBeLessThan(50);
  });
});
