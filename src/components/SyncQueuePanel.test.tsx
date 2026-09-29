// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7 — the queue panel shows honest position/state, cancels anywhere,
// and ends with one cost line.

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { SyncQueue, type QueueEngine } from '../services/syncQueue';
import { SyncQueuePanel } from './SyncQueuePanel';

describe('SyncQueuePanel', () => {
  it('shows "2 of 3", the running phase, cancels a queued and the running item, then the batch line', async () => {
    let worked = 0;
    const engine: QueueEngine = {
      workerSec: () => worked, usdPerSec: 0.001, onDrain: () => {},
      cancelReceipt: (_i, started) => (started ? 'The cloud had already worked 4.0 s.' : 'It hadn’t started, so nothing was charged.'),
    };
    const q = new SyncQueue(engine);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(<SyncQueuePanel queue={q} />); });
    expect(el.querySelector('[data-testid="sync-queue-panel"]')).toBeNull();

    let finishFirst!: () => void;
    const first = new Promise<void>(r => { finishFirst = r; });
    await act(async () => {
      q.enqueue([
        { id: 'a', label: 'Alpha', run: async ctx => { ctx.setPhase('Transcribing on the cloud…'); await first; worked += 20; return { status: 'done' }; } },
        { id: 'b', label: 'Bravo', run: async ctx => new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(new Error('x')))) },
        { id: 'c', label: 'Charlie', run: async () => ({ status: 'done' }) },
      ]);
    });
    const text = () => el.textContent ?? '';
    expect(text()).toContain('1 of 3');
    expect(text()).toContain('Transcribing on the cloud…');
    expect(text()).toContain('Waiting');

    await act(async () => { (el.querySelector('[data-testid="sync-queue-cancel-c"]') as HTMLButtonElement).click(); });
    expect(el.querySelector('[data-testid="sync-queue-receipt-c"]')?.textContent).toBe('It hadn’t started, so nothing was charged.');

    await act(async () => { finishFirst(); });
    await vi.waitFor(() => expect(q.snapshot().items[1]!.status).toBe('running'));
    await act(async () => { (el.querySelector('[data-testid="sync-queue-cancel-b"]') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(q.snapshot().running).toBe(false));
    await act(async () => {});
    expect(el.querySelector('[data-testid="sync-queue-receipt-b"]')?.textContent).toBe('The cloud had already worked 4.0 s.');
    expect(el.querySelector('[data-testid="sync-queue-batch-line"]')?.textContent)
      .toBe('3 projects: 1 built, 2 cancelled · about $0.02 of cloud GPU (20 s worked)');
    await act(async () => { (el.querySelector('[data-testid="sync-queue-clear"]') as HTMLButtonElement).click(); });
    expect(el.querySelector('[data-testid="sync-queue-panel"]')).toBeNull();
    act(() => root.unmount());
  });
});
