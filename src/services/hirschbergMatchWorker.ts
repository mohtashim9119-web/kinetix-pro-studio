/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * hirschbergMatchWorker.ts — off-main-thread Hirschberg script/transcript
 * matcher (WS2 Wave 2 Group 2, item 2).
 *
 * `alignQueryToSubject` (`whisperService.ts`) is the ONE primitive every
 * script<->transcript matching call in the sync pipeline reduces to —
 * `computeRunContext` (`faChunkPlan.ts`, the FA path) and
 * `extractSegmentAlignments` (`whisperService.ts`, the DEFAULT Whisper-timing
 * path every sync runs regardless of FA) each call it once, full-length,
 * synchronously, on the main thread. Measured (`docs/ws1-sync-pipeline/
 * verification-sweep-2026-09-18.md` W3): ~3.03-3.13s at 500 scenes / 30min,
 * ~11.5-13.1s at 1000 scenes / 60min, scaling as the O(n*m) cost predicts —
 * synchronous and uninterruptible, so the UI is unresponsive for the whole
 * call.
 *
 * This worker runs the SAME, unmodified `alignQueryToSubject` — no algorithm
 * changes, no reimplementation — just off the main thread. `hirschbergMatch
 * Client.ts` is the caller-side wrapper; it falls back to calling
 * `alignQueryToSubject` directly when `Worker` is unavailable (the vitest/
 * Node test environment, and any runtime without Worker support), so the
 * exact same code path is exercised either way and output is provably
 * unaffected by which side of the postMessage boundary it ran on.
 *
 * Contract:
 *   in : { id, query: string[], subject: string[], subjectBonus?: number[] }
 *   out: { id, ops, matchedSubjectOf: Int32Array (transferred), score }  on success
 *        { id, error: string }                                           on failure
 */

import { alignQueryToSubject, type TokenAlignmentOp } from './whisperService';

interface MatchRequest {
  id: number;
  query: string[];
  subject: string[];
  subjectBonus?: number[];
}

interface MatchResponse {
  id: number;
  ops?: TokenAlignmentOp[];
  matchedSubjectOf?: Int32Array;
  score?: number;
  error?: string;
}

// `self` in a dedicated worker; typed narrowly to avoid pulling in the
// "webworker" lib (which conflicts with the "DOM" lib this project compiles
// with) — mirrors `frameEncodeWorker.ts`'s own narrowing.
const workerScope = self as unknown as {
  onmessage: ((e: MessageEvent<MatchRequest>) => void) | null;
  postMessage: (message: MatchResponse, transfer?: Transferable[]) => void;
};

workerScope.onmessage = (e: MessageEvent<MatchRequest>) => {
  const { id, query, subject, subjectBonus } = e.data;
  try {
    const result = alignQueryToSubject(query, subject, subjectBonus);
    workerScope.postMessage(
      { id, ops: result.ops, matchedSubjectOf: result.matchedSubjectOf, score: result.score },
      [result.matchedSubjectOf.buffer],
    );
  } catch (err) {
    workerScope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
