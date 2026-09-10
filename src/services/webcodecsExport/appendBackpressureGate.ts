/**
 * WS3 Tier 1 item 3b — worker-side back-pressure against the append/IPC path.
 *
 * Deliberately dependency-light (no `self`, no `Worker`, no timers) so it is
 * unit-testable without constructing a real export worker. `exportWorker.ts`
 * calls `submit`/`waitIfNeeded` from the frame loop; `exportPipelineWebCodecs.ts`
 * calls `ack` from the main thread after every batch that actually lands on
 * disk (`flushPendingBatch`'s success path) and posts the resulting total to
 * the worker as an `'append-ack'` message. Nothing here talks across the
 * worker boundary itself — that wiring lives in the two call sites.
 *
 * WHY A THRESHOLD BELOW THE 256 MB QUEUE CEILING (`APPEND_QUEUE_CEILING_BYTES`,
 * exportPipelineWebCodecs.ts) RATHER THAN AT IT: the ceiling is a last-resort
 * abort — crossing it means the backlog itself has become the failure. This
 * threshold is meant to never be reached in the failure sense at all; it is
 * where the frame loop voluntarily yields so the backlog stops GROWING before
 * it gets anywhere near the ceiling. The gap between the two is headroom for
 * everything back-pressure cannot prevent by construction:
 *   - the batch already in flight inside `appendFileRaw` when the threshold is
 *     crossed (up to one `APPEND_BATCH_BYTES`, 4 MB) — back-pressure gates the
 *     NEXT frame, not the one already past the encoder;
 *   - the pending buffer accumulating toward its own trigger (another <=4 MB);
 *   - the one frame already mid-flight through `runFrameLoopTick` when the
 *     gate is checked (checked once per frame, before `encoder.encode`, so at
 *     most ~33 KB more per the measured 1080p30 corpus);
 *   - the up-to-1s age-trigger window (`APPEND_BATCH_MAX_AGE_MS`) between the
 *     buffer becoming non-empty and it being forced out regardless of size.
 * None of those individually approach the ceiling; together they are still a
 * small fraction of it, which is the point — the threshold buys a stopping
 * point with a comfortable multiple of margin under the failure line, not a
 * value tuned to sit close to it.
 *
 * CHOSEN VALUE: 32 MB (~1000 frames at the measured ~33 KB/frame 1080p30
 * chunk size). Reasoning against the two neighboring numbers this sits
 * between:
 *   - 8x the 4 MB batch trigger, so ordinary batching noise (one batch
 *     in flight, one accumulating) never spuriously engages the gate — it
 *     should only engage when the writer is genuinely falling behind the
 *     encoder for multiple batch cycles in a row, which is the actual failure
 *     mode this exists to bound (see APPEND_QUEUE_CEILING_BYTES's own doc:
 *     "backlog grows monotonically for the entire run" when the writer sets
 *     the pace).
 *   - 1/8 of the 256 MB ceiling, so a run that legitimately engages
 *     back-pressure (repeatedly waits, then resumes as acks catch up) still
 *     has a large multiple of headroom before the hard abort — back-pressure
 *     is meant to be the thing that makes the ceiling unreachable in
 *     practice, not a value that races it.
 * Expressed in frames for the reasoning above; stored in bytes because that
 * is the unit the ledger and the ceiling already use, and a byte comparison
 * needs no per-frame-size assumption to stay correct as bitrate changes.
 */
export const APPEND_BACKPRESSURE_THRESHOLD_BYTES = 32 * 1024 * 1024;

/**
 * Pure, Promise-based back-pressure gate. `submit` records bytes the frame
 * loop has handed to the encoder's output callback (i.e. posted toward
 * `appendFileRaw`, not yet confirmed on disk); `ack` records the cumulative
 * total the writer has actually confirmed. `waitIfNeeded` resolves
 * immediately while the gap between the two is at or under the threshold,
 * and otherwise resolves the next time (or first time, if already past
 * threshold when called) `ack` brings the gap back at or under it.
 *
 * `ack` takes the new CUMULATIVE acked total, not a delta — matching
 * `appendBytes`, the running total `exportPipelineWebCodecs.ts` already
 * maintains, so the caller never has to compute or track a delta itself and
 * a delivered-out-of-order or duplicate ack (impossible today, since acks
 * only ever originate from the single serialized `appendQueue` chain, but
 * cheap to make safe anyway) can't move the gate backwards: `ack` ignores a
 * total lower than the one it already has.
 */
export class AppendBackpressureGate {
  private submitted = 0;
  private acked = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly thresholdBytes: number) {}

  /** Bytes the frame loop has handed off toward the append path. */
  submit(bytes: number): void {
    this.submitted += bytes;
  }

  /** The writer's new cumulative confirmed-on-disk total. Wakes every
   *  waiter once the unacked gap is back at or under the threshold. */
  ack(cumulativeBytesAcked: number): void {
    if (cumulativeBytesAcked <= this.acked) return;
    this.acked = cumulativeBytesAcked;
    if (this.unacked() > this.thresholdBytes) return;
    const toWake = this.waiters;
    this.waiters = [];
    for (const wake of toWake) wake();
  }

  unacked(): number {
    return this.submitted - this.acked;
  }

  /** Resolves immediately if under threshold; otherwise resolves on the next
   *  `ack` that brings the gap back at or under it. Never resolves on a
   *  timer of its own — the only thing that can unblock this is real
   *  confirmed progress on the write path. */
  waitIfNeeded(): Promise<void> {
    if (this.unacked() <= this.thresholdBytes) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Test/diagnostic only — how many callers are currently parked. */
  waiterCount(): number {
    return this.waiters.length;
  }
}
