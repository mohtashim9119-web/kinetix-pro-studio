/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// waveformDrawQueue.ts — a tiny shared FIFO scheduler that spreads waveform
// draws across animation frames so the initial batch (294 segments on the
// reference project) never runs in one synchronous React passive-effect flush.
//
// Background: Step 2's comparison lane drew all 294 SegmentWaveform canvases in
// a single un-yielded burst (~161MB of live GPU canvas allocated at once),
// freezing the app on load. This scheduler is the "chunked draw scheduling"
// half of plan §7 mitigation #1; the ImageBitmap/<img> half lives in
// SegmentWaveform.tsx. Every SegmentWaveform enqueues its draw here instead of
// running it inline; the queue drains WAVEFORM_DRAW_BATCH_SIZE tasks per frame,
// yielding to paint between frames.
//
// Deliberately React-free / DOM-free (only touches requestAnimationFrame), so
// it is unit-testable with a stubbed rAF and matches the repo's services split.

/**
 * Tasks drawn per animation frame. Chosen at 24 (mid of the 20–30 range): at
 * ~60fps the 294-segment reference project drains in ~13 frames (~215ms) with a
 * paint between each, so the UI stays responsive; each frame's 24 off-screen
 * draws + convertToBlob dispatches are well within a frame budget. Lower would
 * stretch the total wall time; higher risks a single frame janking.
 */
export const WAVEFORM_DRAW_BATCH_SIZE = 24;

type Runnable = () => void;

interface Entry {
  token: object;
  run: Runnable;
}

let queue: Entry[] = [];
let rafId: number | null = null;

// --- TEMP diagnostic instrumentation (waveform freeze audit) -----------------
// Gated on globalThis.__WF_INSTRUMENT__ so unit tests + production stay silent.
// Records, per drained batch: the rAF timestamp at batch-start, the wall-clock
// gap since the previous batch-start (proves whether rAF actually yields ~16ms
// between batches), the batch size, and how long the SYNCHRONOUS portion of the
// batch took (entry.run() up to its first await). Remove after the audit.
let __wfLastBatchStart = 0;
let __wfBatchIndex = 0;
function __wfInstrOn(): boolean {
  return (globalThis as unknown as { __WF_INSTRUMENT__?: boolean }).__WF_INSTRUMENT__ === true;
}
// -----------------------------------------------------------------------------

function drain(): void {
  rafId = null;
  const instr = __wfInstrOn();
  const batchStart = instr ? performance.now() : 0;
  const gap = instr ? batchStart - __wfLastBatchStart : 0;
  const idx = __wfBatchIndex;

  const batch = queue.splice(0, WAVEFORM_DRAW_BATCH_SIZE);
  for (const entry of batch) {
    // One failing draw must never stall the rest of the queue.
    try {
      entry.run();
    } catch {
      /* swallow */
    }
  }

  if (instr) {
    const syncMs = performance.now() - batchStart;
    const rec = {
      idx,
      batchStart,
      gapSincePrevStart: __wfLastBatchStart === 0 ? null : gap,
      size: batch.length,
      syncDrainMs: syncMs,
      remaining: queue.length,
    };
    (
      (globalThis as unknown as { __wfBatches?: unknown[] }).__wfBatches ??= []
    ).push(rec);
    // eslint-disable-next-line no-console
    console.log('[wf-batch]', JSON.stringify(rec));
    __wfLastBatchStart = batchStart;
    __wfBatchIndex += 1;
  }

  if (queue.length > 0) schedule();
}

function schedule(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(drain);
}

export interface WaveformDrawHandle {
  /** Remove this task if it has not yet run. Safe to call after it ran. */
  cancel(): void;
}

/**
 * Enqueue a draw. Runs in FIFO order, at most WAVEFORM_DRAW_BATCH_SIZE per
 * frame. Returns a handle whose cancel() drops the task if still pending — used
 * by SegmentWaveform to drop a queued draw on unmount / redraw so a stale draw
 * never runs.
 */
export function enqueueWaveformDraw(run: Runnable): WaveformDrawHandle {
  const token: object = {};
  queue.push({ token, run });
  schedule();
  return {
    cancel() {
      const before = queue.length;
      queue = queue.filter((e) => e.token !== token);
      if (queue.length !== before && queue.length === 0 && rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };
}

/** Test-only: reset module state between unit tests. */
export function _resetWaveformDrawQueueForTests(): void {
  if (rafId !== null) {
    try {
      cancelAnimationFrame(rafId);
    } catch {
      /* noop */
    }
  }
  queue = [];
  rafId = null;
}
