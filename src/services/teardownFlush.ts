/**
 * BOUNDED TEARDOWN FLUSH (WS2 T4.6).
 *
 * One primitive, shared by every path that wants to persist before the page or
 * the process goes away: reload (Cmd+R), window close (Cmd+W / red button), and
 * — from the Rust side — Cmd+Q.
 *
 * WHY A BUDGET AT ALL, AND WHY IT IS THE WHOLE POINT OF THIS MODULE. A flush is
 * an I/O call that can hang: `saveProject` awaits an OS-file write through the
 * Tauri IPC bridge, reads it back to verify, and on the browser-dev path touches
 * `localStorage`. If a teardown path simply `await`s that and the await never
 * settles, the app becomes unclosable and unquittable — a strictly worse
 * regression than the data loss the flush exists to prevent. So the contract
 * here is the inverse of a normal promise's: **this function always settles, it
 * never rejects, and it settles within `budgetMs` of being called.** The caller
 * is then free to tear down unconditionally.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not cancel the flush it gave up on.
 * There is nothing to cancel — an in-flight `saveProject` is a single verified
 * write that is either atomic at the OS layer or not, and abandoning the wait
 * does not abandon the write. On the reload/close paths the write may well land
 * after we stop waiting and still be read back on the next launch; on the quit
 * path the process dies first. Either way, waiting longer is the only thing that
 * would help, and waiting longer is exactly what the budget forbids.
 *
 * THE BUDGET IS OWNED BY WHOEVER CAN STILL ACT IF THE RENDERER IS WEDGED. For
 * reload and window-close that is this module, because the renderer is the thing
 * doing the tearing down. For Cmd+Q it is NOT — see `src-tauri/src/lib.rs`'s
 * `await_flush`, which runs the same budget on a Rust thread precisely because a
 * budget implemented in JS is no guarantee when JS is what has hung.
 */

/**
 * How long a teardown will wait for persistence before proceeding anyway.
 *
 * 2000 ms, per the owner's Q1 answer, and the margin is what makes it safe
 * rather than the number itself. MEASURED against the largest real project on
 * the development machine — 815,558 chars, close to the ~915,000-char ceiling
 * `projectStore.ts` records from a real 21-minute-audio run — one full
 * `saveProject` round trip (stringify, atomic temp+rename write, read-back
 * verify) took a median of 20.8 ms and a worst-of-12 of 50.1 ms, taken while
 * the machine was already loaded. The budget is ~40x that worst case.
 *
 * NOT MEASURED, and stated so the margin is not over-claimed: the Tauri IPC hop
 * that carries the payload from the webview to Rust. It is the one term left
 * out, and it would have to be roughly 40x the entire rest of the write before
 * a healthy save came anywhere near this budget.
 *
 * So this is a ceiling, not a target. The flush is expected to finish in tens of
 * milliseconds; the budget only ever elapses in the pathological case (a wedged
 * IPC bridge, a stalled filesystem), which is precisely the case where waiting
 * longer would not have helped either.
 *
 * Mirrored on the Rust side as `QUIT_FLUSH_BUDGET_MS` in `src-tauri/src/lib.rs`.
 * The two are deliberately separate constants rather than one shared value:
 * the whole point of the Rust budget is that it holds when the JS side is
 * unreachable, so it cannot be sourced from the JS side.
 */
export const TEARDOWN_FLUSH_BUDGET_MS = 2000;

/**
 * What happened inside the budget. Returned for logging and for tests; NO caller
 * may branch its teardown on this value — teardown proceeds identically in all
 * three cases, which is the guarantee.
 */
export type FlushOutcome =
  /** The flush settled successfully inside the budget. */
  | 'flushed'
  /** The budget elapsed first. The flush may still land; we stopped waiting. */
  | 'timed-out'
  /** The flush threw or rejected. Nothing was persisted by it. */
  | 'failed';

/**
 * Runs `flush` and resolves within `budgetMs`, whatever `flush` does.
 *
 * Never rejects, including when `flush` throws synchronously and when it rejects
 * after the budget has already elapsed (that late rejection is attached to a
 * handler here, so it cannot surface as an unhandled rejection during teardown).
 */
export function flushWithBudget(
  flush: () => Promise<unknown>,
  budgetMs: number = TEARDOWN_FLUSH_BUDGET_MS,
): Promise<FlushOutcome> {
  let started: Promise<unknown>;
  try {
    started = Promise.resolve(flush());
  } catch (err) {
    // A synchronous throw is a failed flush, not a hang — resolve immediately
    // rather than burning the budget waiting for a promise that never existed.
    console.warn('[teardown] flush threw synchronously (proceeding anyway):', err);
    return Promise.resolve('failed');
  }

  return new Promise<FlushOutcome>(resolve => {
    const timer = setTimeout(() => {
      console.warn(
        `[teardown] flush did not settle within ${budgetMs}ms — proceeding without it.`,
      );
      resolve('timed-out');
    }, budgetMs);

    started.then(
      () => {
        clearTimeout(timer);
        resolve('flushed');
      },
      (err: unknown) => {
        clearTimeout(timer);
        console.warn('[teardown] flush rejected (proceeding anyway):', err);
        resolve('failed');
      },
    );
  });
}
