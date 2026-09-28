/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U5 — cancel honesty. Real `cloudCancelReceipts` + `cloudSyncEngine` +
// `cloudGateway` + `cloudSyncIntent`; only the Tauri IPC boundary is mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@tauri-apps/api/core', () => {
  class FakeChannel<T> {
    onmessage: ((message: T) => void) | undefined;
  }
  return { Channel: FakeChannel, invoke: vi.fn() };
});
vi.mock('./whisperService', () => ({ transcribeWithProgress: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import {
  CLOUD_CANCEL_COPY,
  __resetCancelReceiptsForTests,
  describeCloudCancel,
  hasStoppingCloudRuns,
  recordCancelReceipt,
  settleCloudCancels,
  takeCancelReceiptsSince,
  trackStoppingRun,
  type CloudCancelReceipt,
} from './cloudCancelReceipts';
import { runStageCacheFirst } from './cloudSyncEngine';
import {
  __resetSyncIntentsForTests,
  cancelSyncIntent,
  clearSyncIntentSuppression,
  getSyncIntent,
  isSyncIntentSuppressed,
  startSyncIntent,
  type SyncIntentInputs,
  type SyncIntentOutcome,
} from './cloudSyncIntent';
import type { CloudJobEvent } from './cloudGateway';

const mockInvoke = invoke as unknown as Mock;
const HASH = 'e'.repeat(64);

function receipt(overrides: Partial<CloudCancelReceipt> = {}): CloudCancelReceipt {
  return {
    stage: 'transcribe', jobId: 'j1', confirmed: true, started: false, workerSec: 0, estimatedUsd: 0, at: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  __resetCancelReceiptsForTests();
  __resetSyncIntentsForTests();
  mockInvoke.mockReset();
});

describe('describeCloudCancel — the operator\'s copy ruling', () => {
  it('cancelled before submit: no charge', () => {
    const line = describeCloudCancel([], { cloud: true });
    expect(line).toContain(CLOUD_CANCEL_COPY.nothingRan);
    expect(line).toContain(CLOUD_CANCEL_COPY.timelineUnchanged);
  });

  it('cancelled while queued: the job is $0, and the container-level start-up is named, not hidden', () => {
    const line = describeCloudCancel([receipt()], { cloud: true });
    expect(line).toContain('this job costs nothing');
    expect(line).toContain('may still bill its start-up');
    expect(line).not.toContain('billed (about');
  });

  it('cancelled mid-run: the completed seconds are billed, and the line gives them', () => {
    const line = describeCloudCancel(
      [receipt({ started: true, workerSec: 12.46, estimatedUsd: 0.00259 })],
      { cloud: true },
    );
    expect(line).toContain('already worked 12.5 s on transcription');
    expect(line).toContain('That completed work is billed (about $0.0026)');
    expect(line).not.toContain(CLOUD_CANCEL_COPY.nothingRan);
  });

  it('a cancel that never reached the gateway is never reported as free', () => {
    const line = describeCloudCancel([receipt({ confirmed: false })], { cloud: true });
    expect(line).toContain(CLOUD_CANCEL_COPY.unconfirmed);
    expect(line).not.toContain('costs nothing');
  });

  it('a released held GPU is said, not called free', () => {
    expect(describeCloudCancel([], { cloud: true, heldReleased: true })).toContain('few seconds it waited are billed');
  });

  it('a local run says nothing about the cloud', () => {
    expect(describeCloudCancel([], { cloud: false })).toBe(CLOUD_CANCEL_COPY.timelineUnchanged);
  });
});

describe('receipt bookkeeping', () => {
  it('takes only this run\'s receipts, once', () => {
    recordCancelReceipt(receipt({ jobId: 'old', at: 10 }));
    recordCancelReceipt(receipt({ jobId: 'mine', at: 2000 }));
    expect(takeCancelReceiptsSince(1000).map(r => r.jobId)).toEqual(['mine']);
    expect(takeCancelReceiptsSince(1000)).toEqual([]);
    expect(takeCancelReceiptsSince(0).map(r => r.jobId)).toEqual(['old']);
  });

  it('settle waits for a stopping run, and gives up at its timeout', async () => {
    let finish!: () => void;
    trackStoppingRun(new Promise<void>(resolve => { finish = resolve; }));
    expect(hasStoppingCloudRuns()).toBe(true);
    let settled = false;
    const waiting = settleCloudCancels(5000).then(() => { settled = true; });
    await new Promise(r => setTimeout(r, 20));
    expect(settled).toBe(false);
    finish();
    await waiting;
    expect(settled).toBe(true);
    expect(hasStoppingCloudRuns()).toBe(false);

    trackStoppingRun(new Promise<void>(() => {}));
    await settleCloudCancels(30); // never answers: bounded
  });
});

describe('the engine records the gateway\'s answer to a cancel', () => {
  function gatewayWithSlowJob(cancelEvent: CloudJobEvent): { submitted: () => boolean } {
    let submitted = false;
    let tripCancel: (() => void) | undefined;
    mockInvoke.mockImplementation(async (cmd: string, args: { onEvent?: { onmessage?: (e: CloudJobEvent) => void } }) => {
      switch (cmd) {
        case 'cloud_cache_lookup': return { cached: false, audioPresent: true, audioDurationSec: 60 };
        case 'cloud_run_job':
          submitted = true;
          args.onEvent?.onmessage?.({ type: 'submitted', jobId: 'j1', cached: false });
          // Rust: the flag trips, the DELETE answers, the receipt is emitted,
          // THEN the command rejects.
          await new Promise<void>(resolve => { tripCancel = resolve; });
          args.onEvent?.onmessage?.(cancelEvent);
          throw { kind: 'cancelled' };
        case 'cloud_cancel_run':
          tripCancel?.();
          return true;
        default: throw new Error(cmd);
      }
    });
    return { submitted: () => submitted };
  }

  it('cancel mid-transcribe: the receipt carries the completed seconds', async () => {
    const wire = gatewayWithSlowJob({
      type: 'cancelled', jobId: 'j1', confirmed: true, started: true, workerSec: 9.5, estimatedUsd: 0.00198,
    });
    const controller = new AbortController();
    const since = Date.now();
    const run = runStageCacheFirst({ stage: 'transcribe', audioHash: HASH, language: 'en' }, async () => new Blob(), {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(wire.submitted()).toBe(true));
    controller.abort();
    await expect(run).rejects.toEqual({ kind: 'cancelled' });
    await settleCloudCancels(1000);
    const got = takeCancelReceiptsSince(since);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ stage: 'transcribe', confirmed: true, started: true, workerSec: 9.5 });
    expect(describeCloudCancel(got, { cloud: true })).toContain('9.5 s on transcription');
  });

  it('cancel before submit: no job is created, so there is nothing to bill', async () => {
    let releaseLookup!: () => void;
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'cloud_cache_lookup') {
        await new Promise<void>(resolve => { releaseLookup = resolve; });
        return { cached: false, audioPresent: true, audioDurationSec: 60 };
      }
      throw new Error(`unexpected ${cmd}`);
    });
    const controller = new AbortController();
    const since = Date.now();
    const run = runStageCacheFirst({ stage: 'transcribe', audioHash: HASH, language: 'en' }, async () => new Blob(), {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(releaseLookup).toBeTypeOf('function'));
    controller.abort();
    releaseLookup();
    await expect(run).rejects.toEqual({ kind: 'cancelled' });
    expect(mockInvoke.mock.calls.map(c => c[0])).not.toContain('cloud_run_job');
    await settleCloudCancels(100);
    expect(describeCloudCancel(takeCancelReceiptsSince(since), { cloud: true })).toContain(CLOUD_CANCEL_COPY.nothingRan);
  });
});

describe('cancelSyncIntent — a cancelled background run stays stopped', () => {
  const inputs = (): SyncIntentInputs => ({
    spineKey: `${HASH}|s|cloud`,
    voiceover: { id: 'v', name: 'vo', url: 'blob:x', type: 'audio' },
    audioHash: HASH,
    audioDurationSec: 60,
    tokens: [],
    language: 'en' as SyncIntentInputs['language'],
    prepareSegments: async () => [],
  });

  it('aborts the running intent, suppresses the spine, and a click lifts it', async () => {
    let sawAbort = false;
    const run = (_: SyncIntentInputs, signal: AbortSignal): Promise<SyncIntentOutcome> =>
      new Promise(resolve => signal.addEventListener('abort', () => { sawAbort = true; resolve({ status: 'cancelled' }); }));
    startSyncIntent(inputs(), run);
    expect(getSyncIntent(inputs().spineKey)).toBeDefined();

    await cancelSyncIntent(inputs().spineKey);
    expect(sawAbort).toBe(true);
    expect(getSyncIntent(inputs().spineKey)).toBeUndefined();
    expect(isSyncIntentSuppressed(inputs().spineKey)).toBe(true);

    clearSyncIntentSuppression();
    expect(isSyncIntentSuppressed(inputs().spineKey)).toBe(false);
  });

  it('suppresses a spine even when no intent was running', async () => {
    await cancelSyncIntent('nothing|here|cloud');
    expect(isSyncIntentSuppressed('nothing|here|cloud')).toBe(true);
  });
});
