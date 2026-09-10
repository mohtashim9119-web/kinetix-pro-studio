/**
 * WS3 Tier 1 — closes NOT DETERMINED #1/#2: does batching-plus-back-pressure
 * actually keep the terminal drain under WATCHDOG_MS (30s) at the measured
 * Windows per-call latency (12.4ms), and how much margin is there?
 *
 * THIS IS A SIMULATION, not a replay of the real append path. It models the
 * production batching/back-pressure DECISION LOGIC (imported constants, not
 * reimplemented numbers) against a discrete-event clock, injecting a
 * latency-parameterised stand-in for `ffmpeg_append_file_raw` rather than
 * driving a real `driveGlRun`/`exportWorker.ts`/Tauri IPC/WebView2 stack —
 * that stack cannot run in this Mac/Node test environment at all, let alone
 * at 40,384 frames. See the "WHAT THIS CANNOT ESTABLISH" block at the bottom
 * for exactly what is and isn't covered. Every ledger entry sourced from
 * this file must say SIMULATED, never "resolved" or "measured" — this
 * harness has never touched a real disk, a real WebView2 IPC hop, or real
 * encoder hardware.
 *
 * FIELD CHUNK PROFILE (WS3 append-batching round's own doc, appendBatching's
 * own comment blocks, and this round's own report): 40,384 frames, 23
 * encoder sessions (~1755 frames/session, matching MAX_ENCODER_SESSION_FRAMES
 * ~1800), ~33 KB/chunk, encoder cadence 11.4 ms/frame (i.e. the encoder is
 * the FAST side — it is what makes the writer the pipeline's pacing element
 * whenever the writer is slower than 11.4ms/chunk, which is exactly the
 * regime the field run died in). Three per-call latencies: 0.5ms (Mac-like),
 * 12.4ms (the measured Windows figure the run actually died at), 25ms
 * (pathological, beyond anything measured).
 */
import { describe, it, expect } from 'vitest';
import {
  APPEND_BATCH_CHUNKS,
  APPEND_BATCH_BYTES,
  APPEND_BATCH_MAX_AGE_MS,
  APPEND_QUEUE_CEILING_BYTES,
  WATCHDOG_MS,
  FORWARD_PROGRESS_BOUND_MS,
} from '../src/services/webcodecsExport/exportPipelineWebCodecs';
import { APPEND_BACKPRESSURE_THRESHOLD_BYTES } from '../src/services/webcodecsExport/appendBackpressureGate';

// ---------------------------------------------------------------------------
// Field chunk profile
// ---------------------------------------------------------------------------
const TOTAL_FRAMES = 40_384;
const ENCODER_SESSIONS = 23;
const CHUNK_BYTES = Math.round(33 * 1024); // ~33 KB/chunk, measured
const ENCODER_CADENCE_MS = 11.4;
const FRAMES_PER_SESSION = Math.round(TOTAL_FRAMES / ENCODER_SESSIONS);

const LATENCIES_MS = [0.5, 12.4, 25] as const;

// ---------------------------------------------------------------------------
// The discrete-event simulator.
//
// Deliberately NOT wall-clock/timer-driven — this is a pure numeric
// simulation over a `simNow` clock, so 40,384 simulated frames run in
// milliseconds of real test time regardless of the injected latency.
// ---------------------------------------------------------------------------

interface SimConfig {
  /** null = unbatched: one appendFileRaw call per chunk (the pre-batching path). */
  batching: { chunks: number; bytes: number; ageMs: number } | null;
  /** null = no back-pressure (matches the unbatched path, which never had it). */
  backpressureThresholdBytes: number | null;
  /** Per-call cost of the injected `appendFileRaw` stand-in. */
  writerLatencyMs: number;
}

interface SimResult {
  totalWallClockMs: number;
  /** From the last frame's arrival to every byte finally landing on "disk". */
  terminalDrainMs: number;
  peakQueueDepthChunks: number;
  peakQueueDepthBytes: number;
  ipcCallCount: number;
  /** Longest gap, anywhere in the run, between two watchdog-resetting events
   *  (chunk arrival OR completed append) — compared against WATCHDOG_MS. */
  maxWatchdogGapMs: number;
  /** Longest gap between two COMPLETED appends — compared against
   *  FORWARD_PROGRESS_BOUND_MS. */
  maxProgressGapMs: number;
  watchdogWouldFire: boolean;
  progressBoundWouldFire: boolean;
  /** Highest `unacked bytes` ever reached — for confirming the queue ceiling
   *  is never approached even under the pathological latency. */
  peakUnackedBytes: number;
}

function simulate(cfg: SimConfig): SimResult {
  let simNow = 0;
  let framesSubmitted = 0;
  let bytesSubmitted = 0;
  let bytesAcked = 0;
  let ipcCallCount = 0;
  let peakQueueDepthChunks = 0;
  let peakQueueDepthBytes = 0;
  let peakUnackedBytes = 0;
  let maxWatchdogGapMs = 0;
  let maxProgressGapMs = 0;
  let lastResetAt = 0; // watchdog: chunk arrival OR completed append
  let lastProgressAt = 0; // progress bound: completed append only

  // Chunks accepted from the "encoder" but not yet handed to an in-flight
  // append call.
  let pendingChunks = 0;
  let pendingBytes = 0;
  let pendingFirstArrivalAt: number | null = null;

  // The single serialized "writer" — never more than one appendFileRaw call
  // in flight at once, matching `appendQueue`'s strict serial chain.
  //
  // SIMPLIFICATION, stated explicitly: this models at most ONE outstanding
  // write at a time (accumulate into `pending*`, dispatch, repeat) — not
  // production's ability to have several ALREADY-CLOSED batches queued
  // simultaneously in the `appendQueue` promise chain. For the batched arm
  // this is pessimistic exactly when a backlog spans more than one 4 MB/
  // 100-chunk boundary behind one slow writer call: production would issue
  // several 4 MB-capped calls (each paying `writerLatencyMs`), this
  // simulator issues one call moving everything accumulated so far. Back-
  // pressure (32 MB, ~8x one batch) keeps that gap narrow for this chunk
  // profile — the unbatched arm has no such gap, since it always dispatches
  // exactly one chunk per call regardless of backlog size (see
  // `dispatchFromPending` below).
  let writerBusyUntil: number | null = null;
  let writerChunks = 0;

  // Queue depth accounting: pending (buffered) + in-flight (being written).
  const queueDepthChunks = (): number => pendingChunks + writerChunks;
  const queueDepthBytes = (): number => pendingBytes + writerChunks * CHUNK_BYTES;
  const trackPeaks = (): void => {
    peakQueueDepthChunks = Math.max(peakQueueDepthChunks, queueDepthChunks());
    peakQueueDepthBytes = Math.max(peakQueueDepthBytes, queueDepthBytes());
  };

  const noteWatchdogReset = (t: number): void => {
    maxWatchdogGapMs = Math.max(maxWatchdogGapMs, t - lastResetAt);
    lastResetAt = t;
  };
  const noteProgress = (t: number): void => {
    maxProgressGapMs = Math.max(maxProgressGapMs, t - lastProgressAt);
    lastProgressAt = t;
  };

  /** Starts a write of exactly `chunks`/`bytes` — the caller must already
   *  have removed them from `pending*` (or never added them there). */
  const startWrite = (chunks: number, at: number): void => {
    ipcCallCount++;
    writerBusyUntil = at + cfg.writerLatencyMs;
    writerChunks = chunks;
    trackPeaks();
  };

  /** Batched dispatches its WHOLE current buffer in one call (that is the
   *  entire point of batching); unbatched always dispatches exactly ONE
   *  chunk, leaving any rest still pending for the next opportunity — this
   *  is what makes a backlog behind a busy writer cost one IPC call PER
   *  CHUNK once it drains, matching the pre-batching path exactly. */
  const dispatchFromPending = (at: number): void => {
    if (pendingChunks === 0) return;
    const chunksToSend = cfg.batching ? pendingChunks : 1;
    pendingChunks -= chunksToSend;
    pendingBytes -= chunksToSend * CHUNK_BYTES;
    if (pendingChunks === 0) pendingFirstArrivalAt = null;
    startWrite(chunksToSend, at);
  };

  let lastFrameArrivalAt = 0;
  let doneSubmittingAt: number | null = null;

  // Drive frames one at a time. Back-pressure (when configured) pauses
  // scheduling the NEXT frame — it never un-submits one already accepted,
  // mirroring `AppendBackpressureGate.waitIfNeeded()` gating the frame loop
  // BEFORE `encoder.encode()`, never after.
  while (framesSubmitted < TOTAL_FRAMES || pendingChunks > 0 || writerBusyUntil !== null) {
    const canSubmitMoreFrames =
      framesSubmitted < TOTAL_FRAMES &&
      (cfg.backpressureThresholdBytes === null || bytesSubmitted - bytesAcked <= cfg.backpressureThresholdBytes);
    const nextFrameAt = canSubmitMoreFrames ? Math.max(simNow, lastFrameArrivalAt + ENCODER_CADENCE_MS) : Infinity;

    // A) Writer completion, if it's the next thing to happen — a real
    //    writer completing is what unblocks back-pressure and resets both bounds.
    if (writerBusyUntil !== null && writerBusyUntil <= nextFrameAt) {
      simNow = writerBusyUntil;
      bytesAcked += writerChunks * CHUNK_BYTES;
      writerBusyUntil = null;
      writerChunks = 0;
      noteWatchdogReset(simNow);
      noteProgress(simNow);
      // Batched only re-dispatches immediately if a size trigger has
      // ALREADY fired (otherwise the buffer keeps accumulating toward its
      // own trigger/age timer, exactly as production does); unbatched
      // always re-dispatches the next single chunk immediately.
      const batchTriggered =
        pendingChunks > 0 &&
        (!cfg.batching || pendingChunks >= cfg.batching.chunks || pendingBytes >= cfg.batching.bytes);
      if (batchTriggered) dispatchFromPending(simNow);
      continue;
    }

    // B) All frames submitted — only draining remains.
    if (framesSubmitted >= TOTAL_FRAMES) {
      if (pendingChunks > 0 && writerBusyUntil === null) {
        // Terminal drain: unconditional flush (mirrors `noteTerminalMessage`'s
        // `flushPendingBatch()` on 'done'/'salvage-done'). Unbatched still
        // sends exactly one chunk per call here — a backlog drains serially
        // even at the very end, exactly as the pre-batching path would.
        dispatchFromPending(simNow);
        continue;
      }
      if (writerBusyUntil !== null) {
        simNow = writerBusyUntil;
        continue;
      }
      break; // fully drained
    }

    // C) Parked on back-pressure with nothing else to do but wait for the
    //    writer (back-pressure cannot engage before at least one call is in
    //    flight, or bytesSubmitted - bytesAcked could never exceed the
    //    threshold in the first place).
    if (!canSubmitMoreFrames) {
      if (writerBusyUntil === null) {
        throw new Error('simulate(): back-pressure engaged with no writer in flight — unreachable by construction');
      }
      simNow = writerBusyUntil;
      continue;
    }

    // D) Next frame arrives.
    simNow = nextFrameAt;
    lastFrameArrivalAt = simNow;
    framesSubmitted++;
    bytesSubmitted += CHUNK_BYTES;
    noteWatchdogReset(simNow);
    peakUnackedBytes = Math.max(peakUnackedBytes, bytesSubmitted - bytesAcked);
    if (framesSubmitted === TOTAL_FRAMES) doneSubmittingAt = simNow;
    const forcedFlush = framesSubmitted % FRAMES_PER_SESSION === 0; // session-rotation-style forced flush

    pendingChunks += 1;
    pendingBytes += CHUNK_BYTES;
    if (pendingFirstArrivalAt === null) pendingFirstArrivalAt = simNow;
    trackPeaks();

    if (writerBusyUntil !== null) continue; // writer busy — queued, nothing more to do this tick

    if (!cfg.batching) {
      dispatchFromPending(simNow); // unbatched: always immediate, one call per chunk
      continue;
    }
    const ageExpired = simNow - pendingFirstArrivalAt! >= cfg.batching.ageMs;
    const sizeTriggered = pendingChunks >= cfg.batching.chunks || pendingBytes >= cfg.batching.bytes;
    if (sizeTriggered || ageExpired || forcedFlush) dispatchFromPending(simNow);
  }

  const terminalDrainMs = doneSubmittingAt === null ? 0 : simNow - doneSubmittingAt;

  return {
    totalWallClockMs: simNow,
    terminalDrainMs,
    peakQueueDepthChunks,
    peakQueueDepthBytes,
    ipcCallCount,
    maxWatchdogGapMs,
    maxProgressGapMs,
    watchdogWouldFire: maxWatchdogGapMs >= WATCHDOG_MS,
    progressBoundWouldFire: maxProgressGapMs >= FORWARD_PROGRESS_BOUND_MS,
    peakUnackedBytes,
  };
}

function unbatchedConfig(writerLatencyMs: number): SimConfig {
  return { batching: null, backpressureThresholdBytes: null, writerLatencyMs };
}
function batchedConfig(writerLatencyMs: number): SimConfig {
  return {
    batching: { chunks: APPEND_BATCH_CHUNKS, bytes: APPEND_BATCH_BYTES, ageMs: APPEND_BATCH_MAX_AGE_MS },
    backpressureThresholdBytes: APPEND_BACKPRESSURE_THRESHOLD_BYTES,
    writerLatencyMs,
  };
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

describe('WS3 Tier 1 — append throughput, SIMULATED (not measured)', () => {
  it('reports unbatched vs batched+back-pressure at all three latencies', () => {
    const rows: Array<{ latency: number; arm: string; r: SimResult }> = [];
    for (const latency of LATENCIES_MS) {
      rows.push({ latency, arm: 'unbatched', r: simulate(unbatchedConfig(latency)) });
      rows.push({ latency, arm: 'batched+backpressure', r: simulate(batchedConfig(latency)) });
    }

    // eslint-disable-next-line no-console
    console.log(
      '\n[SIMULATED — not measured] WS3 append throughput, field profile ' +
      `(${TOTAL_FRAMES} frames, ${ENCODER_SESSIONS} sessions, ~${CHUNK_BYTES}B/chunk, ` +
      `${ENCODER_CADENCE_MS}ms/frame encoder cadence)\n` +
      rows.map(({ latency, arm, r }) =>
        `  latency=${latency}ms  arm=${arm.padEnd(21)}  ` +
        `wallClock=${fmt(r.totalWallClockMs)}ms  ` +
        `terminalDrain=${fmt(r.terminalDrainMs)}ms  ` +
        `peakQueue=${r.peakQueueDepthChunks}chunks/${fmt(r.peakQueueDepthBytes / 1024 / 1024)}MB  ` +
        `ipcCalls=${r.ipcCallCount}  ` +
        `watchdogFires=${r.watchdogWouldFire}  progressBoundFires=${r.progressBoundWouldFire}  ` +
        `peakUnacked=${fmt(r.peakUnackedBytes / 1024 / 1024)}MB`,
      ).join('\n'),
    );

    // ---- Sanity: the regression this round exists to fix. -----------------
    // Unbatched at the measured Windows latency (12.4ms) must reproduce the
    // field death: a watchdog/progress-bound fire, or at minimum a terminal
    // drain that blows WATCHDOG_MS. If it does NOT, the simulator itself is
    // wrong and every other number in this file is suspect.
    const unbatched124 = rows.find((r) => r.latency === 12.4 && r.arm === 'unbatched')!.r;
    expect(unbatched124.watchdogWouldFire || unbatched124.terminalDrainMs >= WATCHDOG_MS).toBe(true);

    // ---- THE LOAD-BEARING NUMBER. -------------------------------------
    // Batched+back-pressure's terminal drain at 12.4ms must be under
    // WATCHDOG_MS (30s). If this fails, batching is insufficient and that
    // is what must be reported — not a reason to adjust the simulator.
    const batched124 = rows.find((r) => r.latency === 12.4 && r.arm === 'batched+backpressure')!.r;
    const marginMs = WATCHDOG_MS - batched124.terminalDrainMs;
    // eslint-disable-next-line no-console
    console.log(
      `\n[LOAD-BEARING] batched+backpressure terminal drain @ 12.4ms = ${fmt(batched124.terminalDrainMs)}ms, ` +
      `WATCHDOG_MS = ${WATCHDOG_MS}ms, margin = ${fmt(marginMs)}ms (${fmt((marginMs / WATCHDOG_MS) * 100)}% of the bound)`,
    );
    expect(batched124.terminalDrainMs).toBeLessThan(WATCHDOG_MS);
    expect(batched124.watchdogWouldFire).toBe(false);
    expect(batched124.progressBoundWouldFire).toBe(false);

    // ---- Even the pathological 25ms latency must not blow either bound
    // under batching — if it did, the batching design itself (not just the
    // 12.4ms measured case) would be undersized.
    const batched25 = rows.find((r) => r.latency === 25 && r.arm === 'batched+backpressure')!.r;
    expect(batched25.terminalDrainMs).toBeLessThan(WATCHDOG_MS);
    expect(batched25.watchdogWouldFire).toBe(false);

    // ---- The queue ceiling is never approached, even at 25ms.
    for (const { r } of rows.filter((x) => x.arm === 'batched+backpressure')) {
      expect(r.peakQueueDepthBytes).toBeLessThan(APPEND_QUEUE_CEILING_BYTES);
    }

    // ---- HONEST NEGATIVE FINDING: back-pressure never actually engages at
    // ANY of the three specified latencies for THIS chunk profile — one
    // 100-chunk/~3.3 MB batch buys ~1.14s of encoder production time
    // (100 x 11.4ms), which dwarfs even the pathological 25ms per-call
    // cost by ~45x. `peakUnackedBytes` stays near one batch's worth (a few
    // MB) in every row below, nowhere near the 32 MB threshold that would
    // make the gate actually park the frame loop. BATCHING ALONE accounts
    // for the entire margin measured above; back-pressure's role at these
    // three latencies is a hedge against a WORSE case than any measured
    // here (a much larger per-call cost, or a writer that stalls outright),
    // not something already exercised by them. Do not cite this file as
    // evidence back-pressure "worked" at 12.4ms or 25ms — it was never
    // engaged, so it had nothing to do.
    for (const { latency, r } of rows.filter((x) => x.arm === 'batched+backpressure')) {
      // eslint-disable-next-line no-console
      console.log(`[back-pressure never engaged] latency=${latency}ms peakUnacked=${fmt(r.peakUnackedBytes / 1024 / 1024)}MB (threshold=32MB)`);
      expect(r.peakUnackedBytes).toBeLessThan(APPEND_BACKPRESSURE_THRESHOLD_BYTES);
    }
  });
});

// ---------------------------------------------------------------------------
// WHAT THIS SIMULATION CANNOT ESTABLISH (state explicitly, per this round's
// own instructions — do not let a clean simulated number read as proof):
//
//   1. Real WebView2 IPC marshalling cost on Windows — this harness's
//      "writerLatencyMs" is a single injected constant per run, not a
//      measured distribution of the actual postMessage/invoke round-trip
//      WebView2 performs for a Tauri command.
//   2. Real NTFS/HDD (or SSD) write behavior — no bytes are ever written to
//      any filesystem here; `writerLatencyMs` stands in for the WHOLE
//      `ffmpeg_append_file_raw` cost (open + write + close + IPC) as one
//      opaque number, not a decomposition of where Windows disk I/O time
//      actually goes.
//   3. The real per-call `open`/`write_all`/`close` cost inside
//      `ffmpeg.rs:189-198` on Windows specifically — this file has not run
//      on Windows, has not touched `ffmpeg.rs`, and the 12.4ms figure is
//      carried forward as a previously-measured constant, not re-derived.
//   4. Any GPU interaction — nothing here encodes a frame; `CHUNK_BYTES` and
//      `ENCODER_CADENCE_MS` are fixed inputs from the field profile, not
//      outputs of a running encoder.
//
// This simulation is a strong signal that the batching+back-pressure DESIGN
// has enough headroom at the measured latency — it is not proof the
// production code path behaves identically on real Windows hardware.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WS3 Round 9 — closes the NOT DETERMINED register's "break-even latency"
// row: at what per-call writer latency would APPEND_BACKPRESSURE_THRESHOLD_BYTES
// (32 MB) actually engage for THIS field chunk profile, i.e. stop being a
// hedge and start actually parking the frame loop?
//
// Bisects `writerLatencyMs` using the BATCHED config with the gate DISABLED
// (`backpressureThresholdBytes: null`) — the gate itself caps
// `bytesSubmitted - bytesAcked` the instant it is enabled (see `simulate`'s
// `canSubmitMoreFrames` check), so measuring where the gate would engage
// requires observing what the backlog does WITHOUT it capping the answer.
// SIMULATED, same caveats as the file above — not a real-hardware latency.
// ---------------------------------------------------------------------------
function batchedNoGateConfig(writerLatencyMs: number): SimConfig {
  return {
    batching: { chunks: APPEND_BATCH_CHUNKS, bytes: APPEND_BATCH_BYTES, ageMs: APPEND_BATCH_MAX_AGE_MS },
    backpressureThresholdBytes: null,
    writerLatencyMs,
  };
}

describe('WS3 Round 9 — back-pressure break-even latency (SIMULATED)', () => {
  it('peakUnackedBytes is monotone non-decreasing in writer latency (bisection precondition)', () => {
    const samples = [0.5, 5, 12.4, 25, 50, 100, 250, 500, 1000];
    const peaks = samples.map((ms) => simulate(batchedNoGateConfig(ms)).peakUnackedBytes);
    for (let i = 1; i < peaks.length; i++) {
      expect(peaks[i]).toBeGreaterThanOrEqual(peaks[i - 1]!);
    }
  });

  it('bisects the break-even latency at which the 32MB gate would actually engage', () => {
    const threshold = APPEND_BACKPRESSURE_THRESHOLD_BYTES;

    // Bracket first — confirm the threshold is crossed somewhere inside
    // [0, hi] before bisecting, rather than assuming it.
    let lo = 0;
    let hi = 20_000; // ms — deliberately far beyond anything plausible for a local disk
    const peakAt = (ms: number): number => simulate(batchedNoGateConfig(ms)).peakUnackedBytes;
    expect(peakAt(lo)).toBeLessThan(threshold);
    expect(peakAt(hi)).toBeGreaterThanOrEqual(threshold);

    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (peakAt(mid) >= threshold) hi = mid; else lo = mid;
      if (hi - lo < 0.001) break;
    }

    // eslint-disable-next-line no-console
    console.log(
      `\n[BREAK-EVEN] APPEND_BACKPRESSURE_THRESHOLD_BYTES (${fmt(threshold / 1024 / 1024)}MB) engages ` +
      `at writerLatencyMs ~= ${hi.toFixed(3)}ms for the field chunk profile ` +
      `(${ENCODER_CADENCE_MS}ms/frame encoder cadence, ${CHUNK_BYTES}B/chunk, ` +
      `batch=${APPEND_BATCH_CHUNKS}chunks/${fmt(APPEND_BATCH_BYTES / 1024 / 1024)}MB/${APPEND_BATCH_MAX_AGE_MS}ms). ` +
      `Measured latencies this round: 0.5/12.4/25ms — all far below break-even, ` +
      `so back-pressure is a ceiling guard against a writer roughly ` +
      `${(hi / 12.4).toFixed(0)}x slower than the measured Windows figure, not something ` +
      'any measured latency has exercised.',
    );

    // The break-even point itself must sit comfortably above every latency
    // actually measured this round or a prior one (0.5/12.4/25ms) — if it
    // didn't, the "back-pressure never engaged" finding above would be wrong.
    for (const measured of LATENCIES_MS) {
      expect(hi).toBeGreaterThan(measured);
    }
  });
});
