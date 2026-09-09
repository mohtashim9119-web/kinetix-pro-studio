# WS3 — the append path: watchdog occlusion, batching, and the payload route

Static analysis only. No live export, no Part C, no `tauri dev`. Every claim below
is either read off source at a cited `file:line` or produced by a mocked test in
`src/services/webcodecsExport/appendBatching.test.ts`.

Field payload under analysis: 354 segments, 1080p30, voiceover. `framesEncoded`
40384, `encoderSessions` 23, `encoderSessionIndex` 22, `lastPhase`
`"encoder-flush"`, `failureVia` NULL (watchdog at 30124 ms, **not**
flush-timeout), `phaseLogTail` = 64 consecutive `encoder-flush-append` pulses
12.4 ms apart, unbroken to the moment of death. All worker-side diagnostic
fields absent.

---

## Step 1 — Which reading is true

**Verdict: B.** The worker had posted `'done'`; the main thread was awaiting the
`appendQueue` drain; the watchdog was still armed and killed a completed export
during its final drain.

### 1a — `finishWatchdog()` relative to `await appendQueue` in the `'done'` handler

`finishWatchdog` is not called in the handler at all — what matters is that
**nothing disarms the watchdog before the drain**, and the only thing that ever
disarms it (`finish` → `clearWatchdog`) runs *after* the queue resolves.

- `exportPipelineWebCodecs.ts:1543` — `void appendQueue.then(() => { … })`
- `exportPipelineWebCodecs.ts:1570` / `:1580` — `finish({...})`, inside that callback
- `exportPipelineWebCodecs.ts:1300` — `finish` → `clearWatchdog()`

Stated plainly: **the disarm is AFTER the drain, so Reading B is confirmed by
construction, and a completed export can be killed during its final drain.**

### 1b — Same question for `'salvage-done'`

Identical shape, identical answer. `exportPipelineWebCodecs.ts:1594` is the
`void appendQueue.then(...)`; both `finish` calls sit inside it. The handler's own
comment ("Identical drain-then-settle shape as 'done'") is accurate, and it
inherits the defect along with the shape.

### 1c — Does anything reset or disarm the watchdog on append completion

**No.** Before this change the append task called `resetProgressBound()` and
nothing else time-related. `notePhaseAppendDuringFlush`
(`exportPipelineWebCodecs.ts:1075` pre-change) only pushes a phase-log entry — it
touches neither `resetWatchdog` nor `lastOutputAt`. `resetWatchdog` was reachable
from exactly three places: the `'chunk'` case, the `'queue-sample'` case, and the
initial arm. **No chunk message can arrive after `'done'` by construction**
(`exportWorker.ts:1436-1438` posts `run-done` then `done`, and the run is over),
so from the terminal message onward `WATCHDOG_MS` ran down monotonically no
matter how fast bytes were reaching disk.

### Why B and not A, from the payload

- Under A the worker sits inside `flush()` for 30 s. `FLUSH_BOUND_MS` is 20 s
  (`exportWorker.ts:807`) and its timer is armed **before** `flush()` is invoked
  (the deliberate arming-order fix, `exportWorker.ts:1003-1016`), so A requires the
  20 s bound to have failed to fire. `failureVia` is NULL — it did not fire, and
  it did not salvage.
- Under B there is no flush bound running at all: the flush returned,
  `endFlushObservation()` ran, `'done'` was posted (`exportWorker.ts:1793-1794`),
  and `failureVia` is legitimately NULL.
- `lastPhase` stays `"encoder-flush"` under B: the `'done'` handler never writes
  `lastPhase`, and the worker enters no phase after `encoder-flush` on the clean
  path. That is also precisely why the `encoder-flush-append` pulses keep firing
  through the drain — `notePhaseAppendDuringFlush` gates on
  `lastPhase === 'encoder-flush'`.
- 64 unbroken pulses at 12.4 ms with **zero** interleaved worker pulses is the
  signature. The worker's own flush pulse is throttled to 250 ms
  (`exportWorker.ts:395-410`), so ~4/s; across a 64-pulse window at 12.4 ms
  (~800 ms) a draining encoder would have produced ~3 of them. There are none:
  the encoder emitted nothing, and the main thread was writing a backlog.

The one thing that is **not** proof: the absence of the worker diagnostic fields
carries no information about A vs B — see Step 2.

---

## Step 2 — Why the worker fields vanished

### 2a — It is not the 50 ms grace, and the worker's state is irrelevant

The grace at `exportPipelineWebCodecs.ts:1027` (pre-change) is a red herring in
both directions. **The fields have no route to the operator at all.**

- `App.tsx:6749-6772` builds the Copy-diagnostics blob from `ExportError` and
  `ExportLivenessSnapshot` **and nothing else**.
- `ExportLivenessSnapshot` (`exportPipeline.ts:50-83`) has no field for
  `flushChunksSinceEntry`, `flushBytesSinceEntry`, `encodeQueueSizeAtFlushExpiry`,
  `appendPendingAtFailure`, or `selectedHardwareRung`. Those live only on
  `ExportWorkerDiagnosticsPayload`, which the blob never touches.

So all four are absent whether the worker answered in 1 ms, answered in 500 ms,
or was already terminated. The same structural bug the phase log had (collected,
capped, then dropped at the last hop — `exportPipeline.ts`'s own comment on
`phaseLogTail`) applies to every one of these fields; only `phaseLogTail` and
`failureVia` were ever given the extra hop.

Secondary, and worth stating so it is not re-derived later: even had the route
existed, three of the four are **legitimately null on a clean `'done'`**.
`endFlushObservation()` (`exportWorker.ts:1793`) clears `activeFlushStartChunkCount`
*before* `postTerminal('done')`, and `buildDiagnostics` (`exportWorker.ts:293-295`)
returns null for `flushChunksSinceEntry`/`flushBytesSinceEntry` whenever that
sentinel is null; `encodeQueueSizeAtFlushExpiry` is null because no flush bound
expired. Only `selectedHardwareRung` would have been populated.

### 2b — Counters moved to the main thread

New `ExportAppendLedger` on `ExportLivenessSnapshot` (`exportPipeline.ts`), stamped
by `snapshotLiveness()` and therefore present on **every** failure payload
regardless of worker state:

| field | answers |
|---|---|
| `chunksAppended` / `bytesAppended` | how much reached disk |
| `ipcCalls` | `appendFileRaw` round-trips actually spent |
| `queueDepthChunks` / `queueDepthBytes` | append queue depth at failure, both currencies |
| `msSinceLastAppendCompleted` | **was the writer alive?** |
| `chunksAppendedDuringFlush` / `bytesAppendedDuringFlush` | appends completed during flush |
| `doneReceived` / `msSinceDone` | **was the export already finished?** |
| `appendInFlight` | was a call in flight |

Pinned by `appendBatching.test.ts` — "the payload carries the main-thread append
ledger even when the worker never replies", which asserts the ledger is populated
in the same payload where `selectedHardwareRung` and `flushChunksSinceEntry` are
null.

### 2c — The next payload answers Step 1 without the worker

`doneReceived: true` + a small `msSinceLastAppendCompleted` + a large
`queueDepthChunks` **is** Reading B, read directly. `doneReceived: false` with a
large `msSinceLastAppendCompleted` is Reading A. No inference from pulse cadence,
no reasoning about which bound should have fired first.

---

## Step 3 — Stop killing healthy exports

### 3a — Chosen: a completed append resets the watchdog

Not "disarm for the duration of the drain". Disarming creates exactly the path
the instruction warned about: a genuinely stuck writer would hang forever inside
an unbounded window. Counting the append is strictly better, and it is not even a
loosening — a `'queue-sample'` already resets `WATCHDOG_MS` and only proves a
frame was *submitted*; an append landing on disk is strictly stronger evidence.

The reset sits **after** the `await` resolves, so a stuck writer produces no
reset at all.

**What a real hang during the drain now looks like:**

1. No append completes for 30 s → `WATCHDOG_MS` fires. Because `doneReceived` is
   true it is routed to a **typed `'append-drain-stall'`** rather than a generic
   `'watchdog'`, with the queue depth, the retained bytes, the ms since the last
   completion, and "worker had already reported done" in the message.
2. Independently, `FORWARD_PROGRESS_BOUND_MS` (45 s) fires — its reset set is
   unchanged and was already append-only.
3. Separately bounded, as instructed: `APPEND_DRAIN_BOUND_MS` = **10 minutes**
   caps the drain even when it *is* progressing, so a pathologically slow writer
   cannot hold the run open on one append per 29 s. Armed on the terminal message,
   cleared by `finish`.

### 3b / 3c — Tests

- *"a 40s terminal drain with zero chunk arrivals COMPLETES instead of being
  killed at WATCHDOG_MS"* — 800 chunks, 8 batches, 5 s per IPC call, all after
  `'done'`. Asserts `ok`, all 800 chunks written, and `appendDrainMs > WATCHDOG_MS`
  (so the test cannot pass by the drain being short).
- *"a drain that makes NO progress still terminates, with a typed error naming the
  queue depth"* — hanging `appendFileRaw`. Asserts `via === 'append-drain-stall'`
  and that the message names `250 chunk(s)`, `2000 byte(s) pending`, and that the
  worker had already reported done.

**Destructive probe (reach, not green):** deleting the two added lines
(`noteWatchdogOutput(); resetWatchdog();`) from the append task turns the 40 s
drain test red and leaves the other eight green. The fixture sees the fix.

---

## Step 4 — Batching

### 4a — The path before this change

One `invoke` per chunk, no batching, no backpressure, and a file re-opened per call:

- `exportPipelineWebCodecs.ts:1312-1332` (pre-change) — `'chunk'` case:
  `appendQueue = appendQueue.then(async () => { await ffmpeg.appendFileRaw(runFile, bytes) … })`,
  one closure per chunk message, no accumulation and no acknowledgement path back
  to the worker.
- `tauriFfmpeg.ts:157-168` — `appendFileRaw` → one `invoke('ffmpeg_append_file_raw', data, …)`.
- `src-tauri/src/ffmpeg.rs:189-198` — **`OpenOptions::new().create(true).append(true).open(&full)`
  then `write_all` — per call.** The file is opened and closed for every single
  frame. That, plus the WebView2 IPC hop, is what 12.4 ms buys.

The consequence is the run-shaped one: 12.4 ms/frame is slower than a 1080p30
encoder produces frames, so the writer sets the pace and the queue grows
monotonically for the entire run.

### 4b — Implemented

Chunks accumulate into `pendingBatch`; one `appendFileRaw` per batch at
**100 chunks, 4 MB, or 1 s of buffer age, whichever first**. The queue remains a strict serial chain,
so batch *k* is fully written before batch *k+1* opens the file. Partial buffers
are flushed at three seams: **session rotation** (so the `sessionByteOffsets`
truncation marker still reads the exact byte seam), and both terminal messages
(`'done'`, `'salvage-done'`).

**The third trigger, found by a failing fixture rather than by design.** A
size-only batch introduces a failure the unbatched path could not have:
`FORWARD_PROGRESS_BOUND_MS` resets *only* on a completed append, so a slow
encoder that emits 50 frames and then composites for a minute leaves them in the
buffer, no append completes, and the 45 s stall guard fires on a healthy run.
`driveGlRun.test.ts`'s silent-interval eviction case caught this immediately —
306 chunks at 300 ms spacing reach the count trigger only at t≈49.7 s, past the
bound. **`APPEND_BATCH_MAX_AGE_MS` = 1 s** therefore flushes any non-empty buffer
within a second, on a timer armed when the buffer becomes non-empty (not per
chunk), so a buffer whose producer goes silent still reaches disk. At the field
run's own 12.4 ms/chunk the count trigger fires roughly eight times over inside
that window, so under load it never fires; when the encoder is slow it costs at
most one extra IPC call per second, which is exactly the regime where landing an
append promptly is the point. Probe: disabling the trigger reddens five tests
across two files.

Two existing `driveGlRun.test.ts` tests changed with this round, both because the
behaviour is now correct rather than to make them pass: the terminal-silent-interval
test waits `WATCHDOG_MS + APPEND_BATCH_MAX_AGE_MS` because the flushed append
legitimately resets the watchdog at t=1 s, and the throttled-scheduler test emits a
full batch instead of one chunk because its whole premise is a scheduler that
cannot be relied on to fire.

**Byte-equality proof.** `appendBatching.test.ts`'s recording `appendFileRaw`
captures every buffer it is handed; the test asserts
`concat(received) === concat(sources)` over 250 chunks with per-index-unique bytes
(so a reorder or a drop cannot hide in zero-fill). The unbatched path no longer
exists to diff against, so its behaviour is *reconstructed*: one append per chunk
in emission order **is** `concat(sources)`. Two further probes measure that
fixture's reach — removing the rotation flush reddens the seam test; removing the
terminal flush reddens both byte-equality tests.

### 4c — IPC reduction and memory

- **Reduction: 100x** in the frame-dominated case (the count trigger fires first
  at 1080p30's ~33 KB/frame, ~3.3 MB per batch). On the field run's 40384 frames:
  **40384 → 404 calls**, and 40384 → 404 file open/close pairs in `ffmpeg.rs`.
  The test asserts `ceil(250/100) = 3` calls for 250 chunks.
- **Memory held by a full batch buffer: ≤ 4 MB** of parts, plus a transient ≤ 4 MB
  for the `concatChunks` copy — which is allocated inside the queued task at call
  time, so the doubling applies to the **in-flight batch only**, never to every
  queued batch. Peak added retention over the unbatched path is therefore ~4 MB.

This is an IPC-cost reduction, **not** a measured throughput number: no live run
was permitted, so whether 404 calls actually finish in ~1/100 of the time is
unmeasured. See NOT DETERMINED.

### 4d — Backpressure

Not needed as the primary mechanism; batching is contained. Backpressure remains
the right second lever if the ceiling below is ever seen to fire, and it is
deliberately **not** implemented now: it costs a worker-side round-trip stall per
N frames, and adding it on top of an unmeasured batching win would confound the
next measurement.

---

## Step 5 — Queue ceiling

**Peak depth and retained bytes for the field run: NOT DETERMINED.** Nothing in
the pipeline recorded either quantity, and the payload carries neither — that is
precisely the gap `ExportAppendLedger` closes. The operator's 5000 × ~33 KB ≈
165 MB is a plausible reconstruction from 12.4 ms/chunk against a faster encoder;
it is not a measurement and is not recorded as one.

**Ceiling: `APPEND_QUEUE_CEILING_BYTES` = 256 MB**, checked on accept (the only
moment depth can grow), failing with a typed `'append-queue-overflow'` naming the
depth. Reasoning: set *above* the ~165 MB plausible-backlog figure on purpose —
under batching the queue should hover near zero, so this is not a tuning knob for
normal operation but the line past which "the writer is behind" has become "the
backlog is itself the failure". Crossing it produces an explainable typed error
instead of an opaque renderer OOM minutes later. It is **not** derived from a
measured legitimate peak, because none exists; re-derive it the first time a real
run reports a `queueDepthBytes` anywhere near it.

---

## NOT DETERMINED

1. **Peak append-queue depth and retained bytes on the field run.** Never
   recorded; the ledger will report it next time.
2. **Whether batching actually restores throughput.** The 100x IPC reduction is
   arithmetic on the call count, not a measured wall-clock. No live export was
   run.
3. **Whether the append backlog is the *only* reason the run outlived its budget.**
   Batching addresses the writer. It says nothing about the encoder, the
   compositor, or the decode path.
4. **Whether `ffmpeg.rs`'s per-call open/close is the dominant term inside the
   12.4 ms**, as against the WebView2 IPC hop itself. Both are eliminated ~100x
   over by batching, so the split does not change the fix — but it is not known,
   and a persistent-handle change would be justified only by measuring it.
5. **Reading A is refuted, not impossible.** It requires the 20 s flush bound to
   have failed to fire; a worker thread wedged synchronously inside `flush()` could
   produce that. The next payload's `doneReceived` settles it outright.
6. **`APPEND_DRAIN_BOUND_MS` = 10 min is a judgement, not a measurement.** No
   legitimate drain duration has been measured on any corpus.
