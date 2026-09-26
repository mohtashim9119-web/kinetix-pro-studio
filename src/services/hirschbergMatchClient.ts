/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * hirschbergMatchClient.ts — caller-side wrapper around
 * `hirschbergMatchWorker.ts` (WS2 Wave 2 Group 2, item 2).
 *
 * A single reusable worker (mirrors `segmentEncoder.ts`'s `FrameEncoderPool`:
 * id-correlated pending map, `onerror` rejects every outstanding request).
 * One worker, not a pool — script<->transcript matching happens at most twice
 * per sync today (`faChunkPlan.ts`'s dedup memo, WS2 G2 item 1), so there is
 * no concurrent-request case to parallelize.
 *
 * FALLBACK: when `Worker` is unavailable (vitest/Node has no global `Worker`;
 * verified via `typeof Worker` at the call site, same check
 * `segmentEncoder.ts`'s `createFrameEncoderPool` uses), this calls the exact
 * same `alignQueryToSubject` synchronously and wraps it in a resolved
 * Promise — same code, same output, main thread. This is not a degraded
 * path: it is how every existing test exercises this module, and it is why
 * the pin test (`computeRunContext`/`extractSegmentAlignments` async vs sync,
 * byte-identical boundaries) can run in CI without a real Worker.
 *
 * CANCEL (WS2 G2 item 4, M3.6's "AbortSignal so C8's cancel reaches it"):
 * an aborted `signal` terminates the in-flight worker outright (no partial
 * result, no zombie process) and rejects with `MatchCancelledError`. The
 * Hirschberg recursion itself has no natural yield point (a single
 * divide-and-conquer call, not a per-scene loop) to check an abort flag
 * mid-computation — `terminate()` is the actual cancellation mechanism, not
 * a cooperative in-loop check. Callers map `MatchCancelledError` to their own
 * typed `'cancelled'` outcome.
 */

import { alignQueryToSubject, type TokenAlignment, type TokenAlignmentOp } from './whisperService';

interface WorkerRequest {
  id: number;
  query: string[];
  subject: string[];
  subjectBonus?: number[];
}

interface WorkerResponse {
  id: number;
  ops?: TokenAlignmentOp[];
  matchedSubjectOf?: Int32Array;
  score?: number;
  error?: string;
}

export class MatchCancelledError extends Error {
  constructor() {
    super('hirschbergMatchClient: match cancelled');
    this.name = 'MatchCancelledError';
  }
}

let sharedWorker: Worker | null = null;
const pending = new Map<number, { resolve: (r: TokenAlignment) => void; reject: (e: Error) => void }>();
let nextId = 0;

function onMessage(data: WorkerResponse): void {
  const entry = pending.get(data.id);
  if (!entry) return;
  pending.delete(data.id);
  if (data.error !== undefined || !data.matchedSubjectOf || !data.ops) {
    entry.reject(new Error(data.error ?? 'hirschbergMatchWorker: empty response'));
  } else {
    entry.resolve({ ops: data.ops, matchedSubjectOf: data.matchedSubjectOf, score: data.score ?? 0 });
  }
}

function onWorkerError(e: ErrorEvent): void {
  // A worker-level crash can't be tied to a specific request id, so fail
  // every outstanding job (mirrors `segmentEncoder.ts`'s `#onWorkerError`).
  const err = new Error(`hirschbergMatchWorker crashed: ${e.message || 'unknown error'}`);
  for (const { reject } of pending.values()) reject(err);
  pending.clear();
  sharedWorker?.terminate();
  sharedWorker = null;
}

function getOrCreateWorker(): Worker {
  if (sharedWorker) return sharedWorker;
  const worker = new Worker(new URL('./hirschbergMatchWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => onMessage(e.data);
  worker.onerror = onWorkerError;
  sharedWorker = worker;
  return worker;
}

/** Terminates the shared worker (if any) so no process outlives an abort —
 *  the next call to `alignQueryToSubjectAsync` creates a fresh one. */
function terminateSharedWorker(): void {
  sharedWorker?.terminate();
  sharedWorker = null;
}

/**
 * Async twin of `alignQueryToSubject`, run off the main thread when a Worker
 * is available. Same inputs, same output shape, same algorithm — see this
 * file's own header for the fallback and cancel contracts.
 */
export function alignQueryToSubjectAsync(
  query: string[],
  subject: string[],
  subjectBonus?: ArrayLike<number>,
  signal?: AbortSignal,
): Promise<TokenAlignment> {
  if (signal?.aborted) return Promise.reject(new MatchCancelledError());

  if (typeof Worker === 'undefined') {
    return Promise.resolve(alignQueryToSubject(query, subject, subjectBonus));
  }

  const id = nextId++;
  const worker = getOrCreateWorker();
  return new Promise<TokenAlignment>((resolve, reject) => {
    const onAbort = (): void => {
      pending.delete(id);
      terminateSharedWorker();
      reject(new MatchCancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    pending.set(id, {
      resolve: (r) => { signal?.removeEventListener('abort', onAbort); resolve(r); },
      reject: (e) => { signal?.removeEventListener('abort', onAbort); reject(e); },
    });

    worker.postMessage({
      id,
      query,
      subject,
      subjectBonus: subjectBonus ? Array.from(subjectBonus) : undefined,
    } satisfies WorkerRequest);
  });
}

/** Test-only: forces the fallback (main-thread, synchronous-wrapped-in-a-
 *  Promise) path regardless of `Worker` availability, and resets the shared
 *  worker/pending state. Not used by production code. */
export function __resetHirschbergMatchClientForTests(): void {
  terminateSharedWorker();
  pending.clear();
  nextId = 0;
}
