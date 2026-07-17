/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// waveformReadyTracker.ts — makes "every segment's waveform image has drawn (or
// failed)" observable (docs/waveform-rewrite-plan.md §6.6 "draw-completion
// registry", rewrite Step 4 of 6). Steps 1-3 built the decode pipeline
// (waveformPipeline.ts), the per-segment image renderer (SegmentWaveform.tsx),
// and the FIFO draw scheduler (waveformDrawQueue.ts) — but nothing yet knows
// WHEN the whole batch finishes, which Step 5's loading screen needs in order to
// gate on real completion instead of a timer or guess.
//
// This module changes nothing about WHEN or HOW FAST anything draws — it is
// pure bookkeeping bolted onto the existing draw completions.
//
// Generation token: beginGeneration() bumps a monotonic counter and resets the
// ready/failed sets every time App.tsx starts a new tracked batch (an Apply-Sync
// run, or the reload-rebuild effect) — this happens EVERY call, whether or not
// the underlying WaveformSource itself needs rebuilding, because a re-sync
// against an unchanged voiceover still mounts a fresh set of SegmentWaveform
// instances that each draw once on mount and must be tracked as a new batch.
// SegmentWaveform captures getCurrentGeneration() at the moment it enqueues a
// draw and reports that captured value back on completion, so a completion that
// lands after a NEWER generation has already begun (e.g. a sync-again fired
// before the prior batch finished drawing) is recognized as stale and ignored —
// mirroring the generation-counter pattern already used by useWhisper.ts /
// useExport.ts for the same "guard against stale async callbacks" purpose.
//
// A segment that fails counts toward completion exactly like one that
// succeeds — "all ready" means "every expected segment has settled, whether it
// drew an image or threw," so one permanently-failing draw cannot hang this
// signal forever. (Step 5's own 8s safety timeout is a separate, additional
// guard against a completion never arriving at all — this module doesn't
// implement that timeout; it only makes the underlying counts observable.)
//
// Deliberately React-free / DOM-free (module-level mutable state, plain
// functions) — matches waveformDrawQueue.ts's services-vs-components split.
// App.tsx mirrors this into React state via subscribe()/onAllReady().

export interface WaveformReadySnapshot {
  /** Current generation id — bumped once per beginGeneration() call. */
  generation: number;
  /** Segments expected to report for this generation. */
  expected: number;
  /** Segments that finished drawing successfully. */
  ready: number;
  /** Segments whose draw threw. */
  failed: number;
  /** ready + failed — every segment that has reported some outcome. */
  settled: number;
  /**
   * True once settled >= expected. A generation with expected === 0 (no
   * voiceover — no SegmentWaveform will ever mount to report) is trivially
   * true immediately.
   */
  allReady: boolean;
}

export type WaveformReadyListener = (snapshot: WaveformReadySnapshot) => void;

let currentGeneration = 0;
let expectedTotal = 0;
let readyIds = new Set<string>();
let failedIds = new Set<string>();
/** Generation the all-ready event last fired for — guards "exactly once per generation". */
let firedGeneration: number | null = null;
/** performance.now() at the start of the current generation — instrumentation only. */
let genStartedAt = 0;

const listeners = new Set<WaveformReadyListener>();
const allReadyListeners = new Set<WaveformReadyListener>();

// --- dormant diagnostic instrumentation ---------------------------------------
// Gated on globalThis.__WF_INSTRUMENT__ — the same flag waveformDrawQueue.ts and
// SegmentWaveform.tsx already use, so flipping it on captures the whole pipeline
// (batching + per-segment encode + this registry's completion signal) with no
// new flag to remember. Silent by default; remove after the audit.
function __wfInstrOn(): boolean {
  return (globalThis as unknown as { __WF_INSTRUMENT__?: boolean }).__WF_INSTRUMENT__ === true;
}

function __wfLog(rec: Record<string, unknown>): void {
  if (!__wfInstrOn()) return;
  (
    (globalThis as unknown as { __wfReadyEvents?: Record<string, unknown>[] }).__wfReadyEvents ??= []
  ).push(rec);
  // eslint-disable-next-line no-console
  console.log('[wf-ready]', JSON.stringify(rec));
}
// -------------------------------------------------------------------------------

function computeSnapshot(): WaveformReadySnapshot {
  const ready = readyIds.size;
  const failed = failedIds.size;
  const settled = ready + failed;
  return {
    generation: currentGeneration,
    expected: expectedTotal,
    ready,
    failed,
    settled,
    allReady: settled >= expectedTotal,
  };
}

function notify(): void {
  const snap = computeSnapshot();
  for (const l of listeners) l(snap);
}

function maybeFireAllReady(): void {
  const snap = computeSnapshot();
  if (snap.allReady && firedGeneration !== snap.generation) {
    firedGeneration = snap.generation;
    __wfLog({
      event: 'all-ready',
      generation: snap.generation,
      expected: snap.expected,
      ready: snap.ready,
      failed: snap.failed,
      elapsedMs: Number((performance.now() - genStartedAt).toFixed(1)),
    });
    for (const l of allReadyListeners) l(snap);
  }
}

/**
 * Start a new tracked batch: bumps the generation and resets ready/failed to
 * empty. Call once per Apply-Sync run and once per reload rebuild — every call
 * is a fresh batch regardless of whether the underlying WaveformSource itself
 * needed rebuilding (see file header).
 *
 * Pass 0 when there is no voiceover — no SegmentWaveform will ever mount to
 * report, so the batch is trivially complete and fires all-ready immediately.
 *
 * Returns the new generation id. Callers that need to tag later reports should
 * prefer getCurrentGeneration() at the actual report-site (e.g. inside
 * SegmentWaveform, which has no direct handle to this call's return value).
 */
export function beginGeneration(expected: number): number {
  currentGeneration += 1;
  expectedTotal = Math.max(0, expected);
  readyIds = new Set();
  failedIds = new Set();
  genStartedAt = performance.now();
  __wfLog({ event: 'begin', generation: currentGeneration, expected: expectedTotal });
  notify();
  maybeFireAllReady();
  return currentGeneration;
}

/** The generation currently accepting reports. Capture this at draw-enqueue time. */
export function getCurrentGeneration(): number {
  return currentGeneration;
}

/** Current expected/ready/failed/allReady snapshot. */
export function getSnapshot(): WaveformReadySnapshot {
  return computeSnapshot();
}

/**
 * Report that `segmentId` finished drawing successfully, for the generation the
 * caller captured at enqueue time. A report tagged with any generation other
 * than the current one is a stale straggler from a previous batch and is
 * silently ignored (it must not corrupt the current batch's count).
 */
export function markSegmentReady(generation: number, segmentId: string): void {
  if (generation !== currentGeneration) {
    __wfLog({ event: 'stale-ready-ignored', reportedGeneration: generation, currentGeneration, segmentId });
    return;
  }
  failedIds.delete(segmentId);
  readyIds.add(segmentId);
  __wfLog({
    event: 'ready', generation, segmentId, ready: readyIds.size, failed: failedIds.size, expected: expectedTotal,
  });
  notify();
  maybeFireAllReady();
}

/** Same as markSegmentReady, for a segment whose draw threw. */
export function markSegmentFailed(generation: number, segmentId: string): void {
  if (generation !== currentGeneration) {
    __wfLog({ event: 'stale-failed-ignored', reportedGeneration: generation, currentGeneration, segmentId });
    return;
  }
  readyIds.delete(segmentId);
  failedIds.add(segmentId);
  __wfLog({
    event: 'failed', generation, segmentId, ready: readyIds.size, failed: failedIds.size, expected: expectedTotal,
  });
  notify();
  maybeFireAllReady();
}

/** Subscribe to every state change (begin/ready/failed). Returns an unsubscribe fn. */
export function subscribe(listener: WaveformReadyListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Subscribe to the "all ready" transition only — fires exactly once per
 * generation, the instant settled reaches expected (immediately, for a
 * 0-expected generation). Returns an unsubscribe fn.
 */
export function onAllReady(listener: WaveformReadyListener): () => void {
  allReadyListeners.add(listener);
  return () => allReadyListeners.delete(listener);
}

/** Test-only: reset module state between unit tests. */
export function _resetWaveformReadyTrackerForTests(): void {
  currentGeneration = 0;
  expectedTotal = 0;
  readyIds = new Set();
  failedIds = new Set();
  firedGeneration = null;
  genStartedAt = 0;
  listeners.clear();
  allReadyListeners.clear();
}
