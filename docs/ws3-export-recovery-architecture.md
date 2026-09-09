# WS3 — Export recovery architecture (flush-timeout round)

Branch `ws3-export-liveness-occlusion`, base `main` @ `4d4922c`, worktree HEAD at round start `c118ac1`.
Static analysis + mocked tests only. No live export, no Part C fixture, no `tauri dev` was run for this
document. `WATCHDOG_MS` (30 000) and `FORWARD_PROGRESS_BOUND_MS` (45 000) are untouched.

Every risk label below is one of **LOW-RISK**, **MEDIUM**, **SPECULATIVE**, with the reasoning attached.

---

## 0. Baseline

```
pwd     /Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio-ws3-export-liveness-occlusion
branch  ws3-export-liveness-occlusion
HEAD    c118ac113c9a0a7b7acaf587678b41f7eca93311
status  clean except untracked docs/ws3-export-routing-audit.md, node_modules/, public/
```

One full-suite run, today, on `c118ac1` before any edit:

```
Test Files   1 failed | 174 passed | 62 skipped (237)
     Tests   1 failed | 3297 passed | 77 skipped (3375)
  Duration   411.53s
```

**N = 3375 total, M = 3297 passed, K = 77 skipped, 1 failed.** The single failure is
`scripts/ws1-session-aj0-oracle-diff.test.ts > … v6`, a 180 s vitest timeout on a WS1 sync-corpus
replay. It is pre-existing, is on the sync pipeline, and touches nothing in `src/services/webcodecsExport/`.
All arithmetic later in this document references 3375/3297/77 exactly.

### A structural fact this round could not assume away

The brief says to assume a trustworthy picture-accurate verifier exists. **It does not exist in this
worktree.** `src/services/webcodecsExport/annexbFrameCount.ts` is absent, and
`grep -rn first_mb_in_slice src/ src-tauri/src/` returns nothing on this branch *or* on `main`. The other
agent's fix is not merged here yet. Everything below is therefore written against the *contract*
("`ffmpeg.countAnnexbFrames` returns pictures, not slices") and not against code I could read.

Worse, there is a live trap on this branch: the JS reference counter
`countAnnexbFrames` (`exportPipelineWebCodecs.ts:1694`) still counts every NAL of type 1 or 5 with no
`first_mb_in_slice == 0` test — i.e. it counts **slices**. It is not on the guard path (the guard calls
the native `ffmpeg.countAnnexbFrames` at `exportPipelineWebCodecs.ts:2097`), but it is exported and used
by the Step 5 spike and by tests as "the reference implementation". On a multi-slice encoder it
over-counts by the slice factor — the exact 8× bug, in the function whose name says it is the reference.
**Flagged for the agent who owns the counter; deliberately not changed here** (out of my ownership, and
changing it would silently move any spike measurement made against it).

---

## 1. Rotation boundary as a recovery anchor

### 1a. Where the boundary is decided, and whether it is always a keyframe — **CONFIRMED**

`exportWorker.ts:1602-1603`:

```ts
const sessionStarts = planEncoderSessions(totalFrames, isKeyFrame, MAX_ENCODER_SESSION_FRAMES);
const rotateAt = new Set<number>(sessionStarts.slice(1));
```

`planEncoderSessions` (`encoderSessionPlan.ts:98-129`) only ever pushes `lastKey`, and `lastKey` is only
ever assigned at `encoderSessionPlan.ts:126` — `if (isKeyFrame(i)) lastKey = i;`. The predicate is the
caller's own `isKeyFrame` (`exportWorker.ts:1352-1354` pre-edit numbering; segment starts ∪ `i % gop === 0`),
the same one passed to `encoder.encode(frame, { keyFrame: … })`. So **a rotation boundary is a frame the
unsplit run would already have encoded as an IDR.** Guarantee 2 of that module's header, and it holds by
construction rather than by measurement.

Is the byte offset at such a boundary an **independently-decodable resume point**? **CONFIRMED, with one
named caveat.** Three facts compose:

1. A fresh `VideoEncoder` always opens its stream with an IDR.
2. The encoder is configured `avc: { format: 'annexb' }` (`exportWorker.ts` `createEncoder`, the `base`
   object), which puts SPS/PPS **inline ahead of every IDR** rather than in an out-of-band `description`.
   That is exactly the property AVCC lacks and the reason annexb is mandatory on this path.
3. The rotation is strictly *between* two `encode()` calls (`exportWorker.ts:1660`), so no frame is
   skipped and none is encoded twice.

Therefore a decoder handed the byte range `[offset(k), EOF)` has parameter sets and an IDR at byte 0 of
that range and needs nothing from session `k-1`.

**Caveat (MEDIUM, unmeasured):** the rebuilt encoder re-walks `HARDWARE_LADDER`
(`exportWorker.ts:1119,1149`) from scratch. Nothing pins it to the rung the previous session selected, and
the selected rung is not recorded anywhere in the diagnostics payload. A rebuild that lands on a different
rung can legally emit a different level, different `constraint_set` flags, or CAVLC instead of CABAC.
Every one of those is legal mid-stream *because* each IDR carries its own SPS — so decodability is not at
risk — but "the two halves are byte-comparable" is not established, and no run has ever checked. See §4c.

### 1b. The field timeline, in exact numbers

Given: `pieceIndex 0`, `encoderSessions 27`, `encoderSessionIndex 26`, `framesEncoded 47840`, sessions
0–25 each flushed in ~81 ms, only the final flush hung. With `MAX_ENCODER_SESSION_FRAMES = 1800`
(`encoderSessionPlan.ts:68`) and 30 fps:

| quantity | value | derivation |
|---|---|---|
| sessions | 27 | reported |
| frames in sessions 0–25 | ≤ 46 800 | 26 × 1800, the cap is a ceiling not a target (`encoderSessionPlan.ts:110-125`) |
| frames in session 26 | ≥ 1 040 | 47 840 − 46 800 |
| video seconds per full session | 60.0 s | 1800 / 30 |
| flush wall per session, sessions 0–25 | ~81 ms each, ~2.1 s total | reported |
| **encode wall per session** | **NOT DETERMINED** | the given facts carry flush wall, not session wall |

Maximum frames at risk, which has two different answers and they are not close:

- **If the Nth flush is a ROTATION flush** the run aborts and every frame from `sessionStarts[N]` to
  `totalFrames` is never encoded: up to **47 840 − 0 = the whole remainder**, and at minimum the session's
  own ≤ 1800. This is why §2's policy refuses to salvage a rotation timeout.
- **If it is the FINAL flush** every one of the run's frames has already been *submitted*
  (`exportWorker.ts:1369`, `onFrameEncoded?.()` fires after `encoder.encode()` returns), and the frame loop
  refuses to submit while `encoder.encodeQueueSize > BACKPRESSURE_HIGH_WATER` (4)
  (`exportWorker.ts:1343-1345`). So the frames that could still be *missing from the file* are bounded by
  **≤ 5 outstanding submissions plus the codec's own reorder depth** — single digits, not 1800.

The brief's "≤ 1800 frames were ever at risk" is the correct bound on *re-render cost*. It is not the bound
on *missing pictures* at a final flush, which is an order of magnitude smaller and is the number the
salvage predicate turns on.

### 1c. Does the worker know the byte offset at each rotation? — **No. Implemented the fix.**

The worker never touches the output file. It posts `{ type: 'chunk', bytes }`
(`exportWorker.ts` output callback, ~`:1519-1527`); `driveGlRun` is the only thing that appends
(`exportPipelineWebCodecs.ts:1254-1271`) and the only thing that knows `appendBytes`.

The smallest change that makes the offset known is therefore **on the main thread, not in the worker** —
and it must be taken *through the append queue*, not at message-receipt time. Message order already
guarantees every chunk of session k−1 is *received* before the `session-rotate` (the worker posts the
rotate after `flushWithBound` + `close()`), but appends are async: at rotate-receipt some of those chunks
may still be queued and `appendBytes` would under-count. Threading a marker through `appendQueue` takes
the reading at the queue position the rotate occupies, which is exactly the seam.

**Implemented** (`exportPipelineWebCodecs.ts:933`, `:1425-1432`, exposed on `RunDriveResult`):

```ts
const sessionByteOffsets: number[] = [0];
…
case 'session-rotate': {
  const rotatedTo = data.sessionIndex;
  appendQueue = appendQueue.then(() => { sessionByteOffsets[rotatedTo] = appendBytes; });
  break;
}
```

**LOW-RISK.** It appends nothing, resets neither liveness bound, and costs one `.then()` per rotation
(27 on the field run). Nothing reads it to make a decision. It is the one number a truncate-and-rewind
recovery needs and does not otherwise have, and it is now recorded for free on every run.

What is still missing to *act* on it: a byte-truncate primitive. `WebCodecsFfmpeg`
(`exportPipelineWebCodecs.ts:123-145`) has `appendFileRaw`, `readFile`, `writeFile`, `deleteFile`,
`countAnnexbFrames`, `concatAnnexbPieces` — and no `truncateFile(path, byteLength)`. Adding one means a
Rust command in `src-tauri/src/ffmpeg.rs`, which this branch may not touch. See §3.

### 1d. Verdict

**A rotation boundary is BOTH a valid re-render anchor and a valid truncation point** — the same property
(a fresh IDR carrying its own inline SPS/PPS at a known frame index) underwrites both. It is not *usable*
as a truncation point today, because nothing can truncate. Confidence: **LOW-RISK** on the bitstream
argument (it follows from the annexb configuration and `planEncoderSessions`'s cut rule, both readable in
source); **MEDIUM** on cross-session byte comparability, per the ladder caveat in 1a.

---

## 2. The salvage predicate

### 2a. What each number actually counts

| number | what it counts | where | when it moves |
|---|---|---|---|
| `framesEncoded` (`framesEmitted`) | frames **SUBMITTED** to an encoder | `exportWorker.ts:1717` (`framesEmitted++`), via `onFrameEncoded?.()` at `:1369` | after `encoder.encode()` **returns** — before any output exists |
| `encodedChunkCount` (`EncodeStats.chunkCount`) | chunks **RECEIVED** from the encoder | `exportWorker.ts:1520` `encodeStats.noteChunk(chunk)` | in the encoder's output callback, in the worker |
| `appendBytes` / `appendCallCount` | bytes **ON DISK** | `exportPipelineWebCodecs.ts:1256-1258` | after `await ffmpeg.appendFileRaw(…)` resolves, on the main thread |

**Yes, they diverge at flush time, and the two gaps have different bounds:**

- *submitted vs received*: bounded. The loop blocks while `encodeQueueSize > 4`
  (`exportWorker.ts:1343`), so at most **5 in flight + the codec's reorder depth** are unreturned. This is
  the bound the 20 s `FLUSH_BOUND_MS` was sized against and it is independent of run length.
- *received vs on disk*: **unbounded in principle**. `appendQueue` is a serialized promise chain; a slow
  or wedged `appendFileRaw` can hold arbitrarily many posted chunks. `appendsInFlight`
  (`exportPipelineWebCodecs.ts:898`) exists precisely to report it, surfaced as `appendPendingAtFailure`.
- *(new, by design)* **received vs written**: after a salvage fences a session, further chunks from it are
  dropped whole. That divergence is intentional and is what makes the on-disk tail stable. §3.

One more, and it is the same class of error as the 8× bug: **`encodedChunkCount` counts chunks, not
pictures.** With `avc: { format: 'annexb' }` one `EncodedVideoChunk` is one access unit, so on this config
1 chunk = 1 picture — but that is a property of the encoder, asserted nowhere and verified nowhere in this
repo. A worker-side chunk count is exactly as trustworthy as a slice count was.

### 2b. The only safe predicate — **I confirm the operator's position**

> pictures present in the (finalised) Annex-B == expectedFrames for the piece, measured by the fixed
> access-unit counter AFTER the file is final — never frames submitted, never chunks received.

Confirmed, on three grounds, each of which independently disqualifies the alternatives:

1. `framesEncoded` is a count of **submissions**. It is incremented at `exportWorker.ts:1369` before the
   encoder has produced anything for that frame. It cannot distinguish "encoded and written" from
   "swallowed by a dead session" even in principle. The operator's own mental model — "all 47 840 frames
   were rendered and written" — is exactly what this number *looks* like it says and does not say. It says
   47 840 frames were **handed to an encoder**.
2. `encodedChunkCount` is a **worker-side** count of what the worker saw, taken before the append queue,
   and it counts chunks rather than pictures (above). The failure under repair is precisely "the worker's
   beliefs and the file diverge"; measuring the worker's beliefs cannot detect that.
3. Only the file is downstream of every failure mode — encoder, postMessage, append queue, append error,
   concat. A count taken from the file's own bytes is the only measurement that is downstream of all of
   them.

One refinement to the wording, not a disagreement: the count must be taken **after concat, on the final
video file, against `totalExpectedFramesOverall`** — which is where the existing guard already takes it
(`exportPipelineWebCodecs.ts:2097-2099`). Taking it per-piece would need a per-piece expected count and a
per-piece scan and buys nothing the whole-file count doesn't.

And what the predicate deliberately does **not** consult: `chunksSinceFlushEntry`. My Part 4 declined
salvage partly because that field has zero field observations; that objection stands and is honoured here
by *not building anything on it*. It also could not decide the question if it had observations — a flush
that emitted nothing may simply have had nothing left to emit. `decideFlushTimeoutDisposition`
(`exportWorker.ts:948`) takes no such parameter, so the signal cannot leak in; there is a test that pins
the signature for exactly that reason.

### 2c. Who computes it — **the orchestrator, necessarily**

The worker cannot. It never opens the file, never learns its length or its byte offsets (§1c), and the
count that matters spans every piece and is only meaningful after concat. So the worker's job at a flush
timeout is strictly: *stop making the file worse, and end the run truthfully*. The verdict is the
orchestrator's existing guard, unchanged and zero-tolerance. That division is what §3 implements.

### 2d. Asymmetry, which drives everything

| direction | what happens | cost |
|---|---|---|
| **false positive** — predicate says complete, file is truncated | a corrupt MP4 ships, looking normal. Raw annexb muxed with `-r fps` yields a *shorter* video with audio running past the end, or a truncated tail. Nothing warns anybody. | **Unbounded.** The user discovers it after delivery, if at all, and the export path loses its credibility permanently. |
| **false negative** — predicate says incomplete, file was fine | the export aborts (or, with a future re-render, re-encodes ≤ 1800 frames) | **≤ ~60 s of wall clock**, or one re-run the user starts by hand. Annoying. Recoverable. |

The ratio is not close, and it is the whole argument for the design: the guard stays at **exact equality,
zero tolerance**, the salvage never widens it, and the salvage's *only* job is to make the file stable
enough that the guard's answer means something. A salvage that "succeeds" is not the worker deciding the
export is good; it is the worker declining to decide.

---

## 3. Implemented: fence-and-verify (PART 3d), with the re-render designed but not built

### 3b. Is a bounded re-render reachable? — **No, not without a forbidden file. Stated plainly.**

Re-rendering frames from the last rotation boundary needs three things. Two are available:

1. **Re-seek the GL run to an arbitrary frame index — AVAILABLE.** Decode cursors are forward-only
   (`decodeCursorLifetime.ts:106-107`: "`frameAt` advances it with `gen.next()` and has no rewind of any
   kind"), but that is a property of *one cursor*, not of the run. `RunState.resolveSlotSource`
   (`exportWorker.ts:676-706`) opens a cursor lazily and keyed by `seg.id`; a released cursor is simply
   re-opened, and `openCursor` seeks by `toSourceTime(seg, currentTime, …)` with keyframe preroll. A
   released demux entry is re-fetched by `getOrCreateDemux` on a cache miss
   (`sequentialDecode.ts:124-131`). So a rewind costs a re-demux and a re-decode, and is otherwise a plain
   `for` loop from the boundary index — all of it inside `exportWorker.ts`, which I own.
2. **A fresh encoder at the boundary — AVAILABLE.** `buildEncoder(sessionIndex)` already exists and
   already opens on an IDR.
3. **Removing the dead session's already-written bytes from `piece_N.h264` — NOT AVAILABLE.** By the time
   a rotation flush hangs, that session has been streaming chunks to disk for up to 60 s. Re-rendering
   from the boundary and appending would leave *partial session K* followed by *complete session K*: the
   file is then **long**, and the strict guard rejects it exactly as it rejects a short one (there is a
   test for that direction too). There are precisely two ways to remove those bytes and this branch may
   take neither:
   - `truncateFile(path, byteLength)` on `WebCodecsFfmpeg`, backed by a Rust command — **`src-tauri/**` is
     forbidden this round.**
   - Per-session output files, so an abandoned session's file is discarded rather than truncated —
     reachable in my files, but it changes the byte-writing layout of **every** export (one concat per GL
     piece where there is none today) to buy a recovery that has never been observed to be reachable
     (below). That trade is bad, and it collides with this round's own "prove the clean path
     byte-unchanged" instruction. **Rejected on judgement, not on permissions**; recorded here so the
     decision is auditable rather than silent.

Per the brief's own conditional, I **stopped and implemented PART 3d only**. Note that 3d as literally
worded ("truncate to the last complete access unit") is blocked by the *same* missing primitive — but it
does not need it, because **the file already ends on a complete access unit**: each `chunk` message is a
whole `EncodedVideoChunk`, appended atomically and in order by a serialized queue
(`exportPipelineWebCodecs.ts:1250-1271`), and on this annexb config one chunk is one access unit. Nothing
is ever half-written. The real work of 3d is not cutting bytes — it is **stopping more bytes from
arriving**.

### 3a/3d. What shipped

**The valve — `SessionOutputFence` (`exportWorker.ts:875`).** A `flush()` that blows its bound is *not
cancelled*: the promise is left pending and the encoder may fire its output callback afterwards, at any
time, from a session the run has abandoned. Every such chunk would be posted and appended *behind*
whatever the recovery decided, corrupting the tail of the file the guard is about to be asked to trust.
Fencing a session makes its output callback a no-op (`exportWorker.ts:1519`): no `postOut`, no
`EncodeStats`, no flush pulse. `encoder.reset()` is also attempted, but is not relied on — if the worker
thread is wedged inside `flush()`, `reset()` never runs either, whereas the fence is a boolean read on
whichever turn of the event loop the callback does eventually get.

**The policy — `decideFlushTimeoutDisposition` (`exportWorker.ts:948`).** Pure, one function, three rules:

- **rotation site → ABORT, always.** Every frame from that boundary to the end is unencoded (§1b), so the
  guard would reject with certainty; salvaging would spend a concat and a whole-file NAL scan to reach a
  foregone conclusion, and — worse — would make "salvage" a routine outcome, which is how a guard
  eventually gets widened.
- **`salvagesUsed >= MAX_FLUSH_SALVAGES` → ABORT** with `FlushSalvageBoundError`. This is 3c's bound.
- **final site, first occurrence → SALVAGE.**

**The recovery — `runFinalFlushWithRecovery` (`exportWorker.ts:1043`).** Extracted from `runExport`
specifically so it is drivable by a mocked encoder rather than only by a real export. Fences **before**
anything that can yield or throw, on every timeout path; never awaits the pending flush; propagates a real
flush *rejection* untouched (a rejection is an encoder error, not a hang).

**The terminal — `salvage-done`.** Posted instead of `done`. `driveGlRun` drains the append queue exactly
as on the clean path (chunks posted before the fence closed still have to reach disk before anyone counts
pictures) and resolves `ok: true, salvaged: true`. The doc comment on the message states the contract
outright: *`ok: true` means "no further bytes will be appended", not "the piece is complete"*.
`exportProjectWebCodecs` records it in `WebCodecsRunDiagnostics.salvagedPieces` and `console.warn`s, then
proceeds to concat and the **unchanged** guard.

### 3c. The retry bound

`MAX_FLUSH_SALVAGES = 1` (`exportWorker.ts:900`). A salvage is *terminal* — it ends the run — so this is a
bound on re-entry and there is deliberately no loop for it to bound. It exists so that a future bounded
re-render, which does re-enter the frame loop, inherits an enforced ceiling instead of inventing one.
Tested at 1, 2, 5 and 50 prior salvages; every one aborts.

### 3e. Output neutrality — the proof

**Claim: a successful non-salvage export is byte-identical, and the *bytes* of a salvaged one are a strict
prefix of what a clean run would have written.**

On the clean path, in source:

- `SessionOutputFence` is constructed but `fence()` is never called, so `accepts()` at
  `exportWorker.ts:1519` is unconditionally `true` and every chunk reaches `postOut` and
  `encodeStats.noteChunk` exactly as before. The predicate is the *only* insertion in the output callback.
- `runFinalFlushWithRecovery` returns `{ kind: 'clean' }` and the caller runs the pre-existing
  `endFlushObservation(); postTerminal('done', …)`. `flushWithBound` itself is unchanged — same arming
  order, same bound, same typed error.
- `salvage-done` is never posted; `salvaged` stays `false`; `salvagedPieces` stays empty.
- The session byte ledger writes integers into a local array. It appends nothing and resets neither bound.
- Nothing in `isKeyFrame`, `planEncoderSessions`, the frame grid, the timestamps
  (`Math.round(frameIndex * 1e6 / fps)`), or the encoder config was touched. `MAX_ENCODER_SESSION_FRAMES`,
  `FLUSH_BOUND_MS`, `BACKPRESSURE_HIGH_WATER`, `WATCHDOG_MS`, `FORWARD_PROGRESS_BOUND_MS` are all
  unchanged.

Asserted, not just argued: `flushSalvage.test.ts` → *"OUTPUT NEUTRALITY: a clean run appends exactly the
chunk bytes, in order, and is not marked salvaged"* records every appended byte through a recording
`appendFileRaw` and asserts the exact byte sequence, call count, byte total, `salvaged === false`,
`salvageReason === null`, `sessionByteOffsets === [0]`.

**What differs in a salvaged output vs a clean one:** *nothing in the bytes that are there.* No extra IDR
is introduced — the salvage opens no new encoder and encodes no new frame; it only stops. The salvaged
file is byte-for-byte the prefix of the clean file that the encoder had actually delivered, ending on a
complete access unit. What differs is what may be **absent**: the ≤ 5 + reorder-depth trailing pictures the
hung flush never returned (§1b). Whether any are absent is exactly what the guard measures, and a salvage
that is short by even one picture aborts.

### 3f. The honest reachability caveat — read this before trusting §3 at all

**This recovery is only reachable if the worker's event loop is still turning.** If `flush()` blocks the
worker thread synchronously rather than returning a never-settling promise, the armed `setTimeout` in
`flushWithBound` cannot fire, `EncoderFlushTimeoutError` is never thrown, and nothing in §3 executes. The
existing doc comment on `flushWithBound` already says this ("a worker-side bound is only ever as live as
the worker's own event loop"), and the field payload — zero events of any kind between `encoder-flush`
entry and the 30 s watchdog — **does not discriminate between the two.**

There is now a cheap discriminator already in the tree and it costs nothing to read: the worker's
`setInterval` heartbeat (`exportWorker.ts`, `HEARTBEAT_INTERVAL_MS`, wired to `checkLivenessBounds` at
`exportPipelineWebCodecs.ts` `case 'heartbeat'`). **If heartbeats continue through a hung flush, the event
loop is alive and §3 will fire. If they stop with the flush, §3 is dead code for that failure and the
main-thread watchdog remains the only backstop.** That is the single most valuable thing the next live run
can produce, and it requires no new instrumentation. **NOT DETERMINED** today.

---

## 4. Software failover (design only — nothing implemented)

### 4a. Does `VideoEncoder` here accept `hardwareAcceleration`? — Yes.

`exportWorker.ts:1119`:
```ts
const HARDWARE_LADDER: HardwareAcceleration[] = ['prefer-hardware', 'no-preference', 'prefer-software'];
```
consumed at `:1149` inside `createEncoder`, which probes `isConfigSupported` and then actually constructs
and `configure()`s, falling through on either failure. So `'prefer-software'` is **already the third rung
today** — but only as a *configure-time* fallback. There is no failover after a session has started, and
none after a hang.

Is `'prefer-software'` available in WebView2? It is a valid WebCodecs value in every Chromium-family
engine, and Chromium desktop ships OpenH264 for software H.264 *encode*. Whether this particular WebView2
build exposes it is **NOT DETERMINED** — no live run was permitted, and, damningly, **the diagnostics
payload does not record which rung was selected**, so no past field run can answer it either. That is a
one-field fix (`selectedHardwareRung` on the payload) and it should land before any failover work does;
otherwise a failover ships without anyone knowing what the baseline rung was. **LOW-RISK, high value.**

### 4b. What already exists

| artifact | verdict |
|---|---|
| `src/dev/webcodecsStep2Spike/exportPipelineWebCodecsSoftwareSpike.ts`, `exportWorkerSoftwareSpike.ts` | **Dev-only scaffolding.** Under `src/dev/`, imported by no production module. Useful as a reference for how a software rung behaves; not a tier. |
| `encodeCanvasPiece` → `encodeSegment` (`segmentEncoder.ts:331`) | **A real production tier (Tier C), and completely unusable as a mid-run failover.** It is not a WebCodecs software encoder at all: it renders canvas → PNG per frame → `ffmpeg -c:v libx264 -preset fast -crf 16` (`segmentEncoder.ts:337-345`) → MP4 → remux to annexb. Different frame source, different container, no GL state, per-frame PNG over IPC. It is the routing fallback for segments GL cannot express, not a drop-in for a stalled encoder session. |

So: neither is a usable software *tier* for this purpose. The usable one is the ladder rung that already
exists and is simply never re-consulted after startup.

### 4c. Failover at a rotation boundary only

Because a rotation already tears down and rebuilds the encoder between two `encode()` calls, failover is
naturally expressible as *"build the next session with a restricted ladder"* and nothing else changes —
no GL, no compositor, no cursors, no frame grid.

- **Trigger:** a session's flush blows its bound, or (better, since it is measurable before the hang) a
  session's `wait-dequeue` phase time crosses a threshold. Never mid-session — a mid-session swap would
  need a flush of the session being escaped, which is the thing that hangs.
- **fps penalty for one 60 s software session (1800 frames @ 1080p):** OpenH264 1080p is roughly an
  order of magnitude slower than a hardware encoder — call it **tens of seconds to a couple of minutes for
  1800 frames** where hardware takes seconds. That is a **SPECULATIVE** estimate: it is a general
  expectation for software H.264, not a measurement on this machine or this config, and no measurement is
  possible under this round's rules.
- **Does the bitstream concatenate cleanly?** Yes, for the same reason rotation works at all: annexb emits
  SPS/PPS inline ahead of every IDR, so a decoder re-reads parameter sets at the seam and a change of
  level, `constraint_set` flags, or entropy coding (CABAC ↔ CAVLC) is legal mid-stream. The mux is
  `-r <fps>` on a PTS-less raw stream, so per-packet duration is unaffected.
- **SPS/PPS profile mismatch risk — MEDIUM, and it is real.** The codec string `avc1.640028` (High 4.0) is
  pinned identically for every rung, so the *requested* profile does not change. But `isConfigSupported`
  can pass and the encoder still emit something else, and this repo already knows that
  (`createEncoder`'s own comment: "isConfigSupported passing does not guarantee configure() succeeds").
  A software rung emitting Baseline or a different level would still decode, and would still pass the
  frame-count guard, and would still mux — the risk is a *quality/compatibility* discontinuity mid-file
  that nothing in the pipeline would notice. Mitigation is to record the selected rung per session (4a)
  and diff the SPS at each seam in a spike, not to add a guard.

### 4d. Smallest commit that would ship it (not written)

1. `createEncoder(…, ladder: HardwareAcceleration[] = HARDWARE_LADDER)` and
   `buildEncoder(forSession, ladder?)` — two signature changes, `exportWorker.ts`.
2. `let softwareFallbackArmed = false;` set where §3 currently fences on a rotation timeout; the next
   `buildEncoder` passes `['prefer-software']`.
3. Two diagnostics fields: `selectedHardwareRung` per session, and `softwareFallbackUsed`.
4. Tests: ladder-override selection with a mocked `VideoEncoder`; the rung is reported; the clean path
   still selects rung 0.

≈ 30 lines of production code, all in `exportWorker.ts`. **MEDIUM** overall — the code is small and the
seam already exists, but it ships an unmeasured fps cliff and the profile-continuity question above, and
item 3 should land and be observed in the field *first*.

---

## 5. Backpressure and driver health

### 5a. The current ceiling

`BACKPRESSURE_HIGH_WATER = 4` (`exportWorker.ts:1122`), enforced at `exportWorker.ts:1343-1345`:

```ts
if (encoder.encodeQueueSize > BACKPRESSURE_HIGH_WATER) {
  const waitStarted = performance.now();
  await waitForDequeue(encoder);
  activeTracker?.add('wait-dequeue', performance.now() - waitStarted);
}
```

**It is a fixed constant, not driver-feedback-adaptive.** `waitForDequeue` (`exportWorker.ts:1189`)
resolves on the encoder's own `dequeue` event, so the *release* is driver-driven, but the threshold never
moves. Effective ceiling: at most 5 outstanding submissions (the check is `>`, so the loop proceeds at
exactly 4 and submits a 5th) plus whatever the codec holds internally for reorder.

### 5b. Is `encodeQueueSize` sampled where it could reveal a stall before the hang?

It is sampled, transmitted, and then **thrown away** — and, more importantly, the signal is structurally
incapable of doing the job asked of it.

- Sampled at `exportWorker.ts:1371`: `if (frameIndex % 5 === 0) postOut({ type: 'queue-sample', frameIndex, size: encoder.encodeQueueSize })`.
- Received at `exportPipelineWebCodecs.ts` `case 'queue-sample'`, which calls `recordOutput('queue-sample')`
  and `resetWatchdog()` — and **never reads `data.size`**. The depth crosses the wire on every 5th frame
  of every export and is discarded. Retaining a max/last would be ~3 lines.
- Also sampled at expiry: `activeFlushExpiryQueueSize = encoder.encodeQueueSize`
  (`exportWorker.ts:1085`), which is on the failure payload.

**But a rising queue depth cannot be an early warning here, by construction.** The frame loop refuses to
submit above 4, so `encodeQueueSize` is clamped to ~5 and *cannot* rise as a driver degrades — the
backpressure caps the very signal you would want to watch. What rises instead is the time spent *waiting*
for the dequeue, and that is already measured: the `wait-dequeue` sub-timer above, aggregated into
`phaseMs`. **So the data does not support a queue-depth early warning, and does support a `wait-dequeue`
one.** No field run has been examined for `wait-dequeue` trajectory ahead of a hang — **NOT DETERMINED**,
and it is a read of existing data rather than new instrumentation.

### 5c. Fixed vs adaptive — **keep it fixed. Nothing implemented.**

An adaptive ceiling would *raise* the queue depth when the encoder is slow to dequeue — i.e. put more
in-flight `VideoFrame`s into a driver that is already struggling, which is the wrong direction for both
memory and for the hang under investigation. The constant's job is to bound in-flight GPU frames, and 4
does that. There is no evidence the ceiling is implicated in the field failure: the failure is in `flush()`
after every frame was submitted, and `encodeQueueSize` at expiry was in the payload precisely so that
question could be asked.

The brief permits implementing only a one-line constant change with a test. This is a recommendation *not*
to change the constant, so nothing was implemented. **LOW-RISK** (a no-op). The 3-line "retain
`queue-sample.size`" change is worth doing and is **not** a constant change, so it is left as a
recommendation: **LOW-RISK, do it in the next round.**

---

## 6. Process isolation, scoped honestly

### 6a. Would it have prevented the frame-47840 failure? — **No. Confirmed.**

Process isolation contains **crashes**, not **hangs**. A `flush()` that never returns still never returns
in another process; the caller still waits. What isolation buys is the ability to *kill* the stuck process
and survive — and this pipeline already has that: the export body runs in a `Worker`, and `driveGlRun`'s
watchdog calls `worker.terminate()` (`exportPipelineWebCodecs.ts`, `finish`), a hard kill that does not
require the worker's cooperation. So for a hang the marginal gain of a separate OS process over the
existing `Worker.terminate()` is close to zero. The operator's read is correct.

### 6b. What it *would* have saved

- **A renderer crash or OOM that takes the whole app down.** A `Worker` shares the renderer process; a
  crash there loses the app and the project, not just the export. This is the strongest genuine case, and
  it is about blast radius, not liveness.
- **Main-thread timer throttling under occlusion** — the run-5 class documented in
  `docs/ws3-silent-gaps-diagnosis.md`, where this document's own `setTimeout` deadlines were starved for
  223.6 s. A *native* process is not subject to WebKit's occlusion policy at all. This is the one class
  where isolation is a real fix rather than a nicer failure mode — and note that it argues specifically
  for the **native** shape and specifically **against** the hidden-window shape (§6c).
- **Not** the `glCompositor.ts:202` context loss (`createContentTexture` → `requireGl`). A lost WebGL
  context is a driver/compositor event; it happens in whatever process owns the context. Isolation changes
  where the exception surfaces, not whether it occurs. It is already handled deterministically
  (`onLost` → `contextLost` flag → `'gl-context-lost'` identity, plus the same identity for the
  `GlContextLostError` race), so this is not a candidate.

### 6c. Two shapes

| | **Full native Rust render process** | **Second hidden WebView window** |
|---|---|---|
| must be rewritten | the WebGL2 compositor (`glCompositor.ts`, shaders → wgpu/OpenGL), the GL text renderer (`textRenderer.ts`, ~900 lines of canvas/font work), decode (`sequentialDecode.ts` + WebCodecs → ffmpeg), encode (`VideoEncoder` → VideoToolbox/libx264), plus a new IPC protocol | the transport only: `new Worker(…)` → a window + `MessageChannel`; the window's own Tauri IPC for `appendFileRaw`; cancel/lifecycle |
| survives untouched | piece/session planning, the frame grid and timestamp math, the frame-count guard, mux, the whole orchestrator | **everything** — `ExportWorkerHandle` (`exportPipelineWebCodecs.ts:785`) is already the only surface `driveGlRun` knows |
| effort | **months.** It is a second renderer, and it re-opens every parity question §4.5 of the export plan already settled once | **days.** One seam. |
| does it fix the motivating class? | **Yes** — a native process is outside WebKit's occlusion/throttling policy entirely | **No, and possibly worse.** A hidden window is *never visible*, so it is the maximally-throttled case of exactly the policy that caused run 5. |

That last row is the whole comparison. The cheap shape does not fix the problem that motivates isolation,
and the shape that does costs months.

### 6d. Recommendation — **DEFER**

Neither shape addresses the failure this round is about (§6a), the cheap shape does not address the
occlusion class either, and the expensive shape is a rewrite whose budget is better spent on the
`truncateFile` primitive plus a bounded re-render (§3b), which *does* address it, in tens of lines.

If it is nonetheless done, the first file is **`src/services/webcodecsExport/exportPipelineWebCodecs.ts`**,
at `driveGlRun`'s worker construction (`:833-836`) — the single seam where the handle is created, already
abstracted behind `ExportWorkerHandle` and already faked by every test in `driveGlRun.test.ts`.

---

## Rungs owned by this branch

| # | rung | status | risk | where |
|---|---|---|---|---|
| 1 | Per-session output fence — a fenced session's chunks never reach disk | **IMPLEMENTED** | LOW-RISK — one boolean read in the output callback; inert unless a timeout fences | `exportWorker.ts:875, :1519` |
| 2 | Flush-timeout policy: rotation aborts, final salvages once | **IMPLEMENTED** | LOW-RISK — pure function, no I/O, 6 tests | `exportWorker.ts:948` |
| 3 | `runFinalFlushWithRecovery` — fence, don't await the hung flush, best-effort reset | **IMPLEMENTED** | LOW-RISK — extracted so a mocked encoder drives it; rejection semantics unchanged | `exportWorker.ts:1043` |
| 4 | Salvage bound: exactly one per run, typed `FlushSalvageBoundError` beyond it | **IMPLEMENTED** | LOW-RISK | `exportWorker.ts:900` |
| 5 | `salvage-done` terminal + `RunDriveResult.salvaged` + `salvagedPieces` + `console.warn` | **IMPLEMENTED** | LOW-RISK — additive message; clean path never posts it | `exportWorker.ts` union, `exportPipelineWebCodecs.ts:1322, :667, :2024` |
| 6 | Session byte ledger, captured through the append queue | **IMPLEMENTED** | LOW-RISK — records numbers, decides nothing | `exportPipelineWebCodecs.ts:933, :1425` |
| 7 | The guard stays exact-equality, zero tolerance | **UNCHANGED, and pinned by test** | LOW-RISK | `exportPipelineWebCodecs.ts:2099` |
| 8 | `truncateFile(path, byteLength)` primitive | **NOT BUILT** — needs `src-tauri/**` | MEDIUM | another agent |
| 9 | Bounded re-render from the last rotation boundary | **DESIGNED, NOT BUILT** — blocked on rung 8 | MEDIUM | §3b |
| 10 | Software failover at a rotation boundary | **DESIGNED, NOT BUILT** | MEDIUM | §4 |
| 11 | Retain `queue-sample.size` on the main thread | **RECOMMENDED, NOT BUILT** (not a constant change) | LOW-RISK | §5b |
| 12 | Record the selected `hardwareAcceleration` rung per session | **RECOMMENDED, NOT BUILT** | LOW-RISK | §4a |
| 13 | Process isolation | **DEFERRED** | SPECULATIVE | §6 |

---

## What must be true before an installer is built

Ordered. Each is a check, not an opinion.

1. **The picture-accurate verifier is actually merged into this branch's base.** Today
   `annexbFrameCount.ts` does not exist here and no `first_mb_in_slice` appears anywhere in `src/` or
   `src-tauri/src/`. Every claim in §2 and §3 rests on that counter being picture-accurate. Verify by
   grep, not by assumption.
2. **The JS `countAnnexbFrames` reference implementation is fixed or renamed**
   (`exportPipelineWebCodecs.ts:1694`). It still counts slices. It is off the guard path but it is what
   spikes and tests diff against; leaving a slice counter named `countAnnexbFrames` next to a fixed
   picture counter is how the 8× bug comes back.
3. **The heartbeat discriminator has been read from one real long export** (§3f). Until then it is
   unknown whether §3 can fire at all in the field failure's shape. This is the single highest-value
   observation available and it needs no new code.
4. **One real export that ends on a `salvage-done` has been observed end to end** — including that the
   guard's verdict on it was correct. Until then the salvage path has mocked coverage only.
5. **The destructive-probe negative in §Tests is closed or accepted**: no fixture currently reaches the
   worker's chunk output callback, so deleting the fence check at its call site leaves the suite green.
   Either add a probe that drives `runExport` with a fake `VideoEncoder`, or accept in writing that rung 1
   is protected only at the class level (`SessionOutputFence`) and not at its call site.
6. **`git diff --name-only main -- src-tauri/` is empty for this branch** — verified below, and it must be
   re-verified at merge, because rungs 8–9 are precisely the temptation to break it.
7. **`npx tsc --noEmit` and `npm run lint` clean; suite at or above the recorded baseline** — §Gates.

---

## Gates

```
npx tsc --noEmit                 -> clean (no output)
npm run lint                     -> clean (it is `tsc --noEmit`)
git diff --name-only main -- src-tauri/   -> EMPTY
```

Suite arithmetic, no approximation:

```
baseline (PART 0, HEAD c118ac1)   3375 tests = 3297 passed + 77 skipped + 1 failed (pre-existing)
added by flushSalvage.test.ts     +21 tests, 21 passed, 0 skipped, 0 failed
edited flushLiveness.test.ts      +0 tests (12 before, 12 after) — one assertion retargeted, see below
expected total                    3375 + 21 = 3396 tests = 3318 passed + 77 skipped + 1 failed
measured total                    3396 tests = 3318 passed + 77 skipped + 1 failed  -- MATCHES
```

The one failure is the same pre-existing `scripts/ws1-session-aj0-oracle-diff.test.ts > v6` 180 s
timeout recorded in PART 0. Recorded honestly: an intermediate full-suite run under heavy CPU contention
(two suites plus a probe loop in flight) showed 5 failures — all of them additional 180 s timeouts in the
same WS1 corpus family, none in `src/services/webcodecsExport/`. Re-run on a quiet machine it is 1, and
that is the number above. Anyone reproducing this should not run the suite concurrently with anything else.

**One existing test was edited, and it is the kind of edit that deserves naming.**
`flushLiveness.test.ts`'s call-site guard asserted the final flush was literally
`await flushWithBound(encoder, framesEmitted, sessionIndex, FLUSH_BOUND_MS, flushObservation)`. Extracting
`runFinalFlushWithRecovery` (so a mocked encoder can drive the recovery at all) moved that call one hop.
The assertion was **retargeted, not relaxed**: it now pins both hops separately — the call site passes
`boundMs: FLUSH_BOUND_MS` and `observe: flushObservation` into the wrapper, *and* the wrapper body calls
`flushWithBound` with them. Its sibling assertion, "there is exactly ONE implementation of the bound"
(one `export async function flushWithBound`, one `new EncoderFlushTimeoutError`, exactly two
`await flushWithBound(` call sites), is untouched and still passes — so the refactor demonstrably did not
fork the bound. Probe P6 below confirms the retargeted guard still goes red on the pre-fix shape.

### Destructive probes (the artifact, not the green run)

Each mutation applied alone, suite = `flushSalvage.test.ts` (21 tests), restored by copy-aside + `cp` (never
`git checkout`, per CLAUDE.md).

| # | mutation | result | reading |
|---|---|---|---|
| P1 | delete `fence.fence(sessionIndex)` from `runFinalFlushWithRecovery` | **RED — 3 failed / 18 passed** | the fence is genuinely load-bearing on all three timeout paths |
| P2 | `decideFlushTimeoutDisposition` returns `salvage` at the rotation site | **RED — 1 failed / 20 passed** | the rotation-abort rule is pinned |
| P3 | `MAX_FLUSH_SALVAGES = 1` → `2` | **RED — 2 failed / 19 passed** | the retry bound is pinned at 1 |
| P4 | widen the frame-count guard to `Math.abs(actual - expected) > 1` | **RED — 2 failed / 19 passed** | zero tolerance is pinned in both directions (short *and* long) |
| P5 | delete `if (!fence.accepts(forSession)) return;` at the chunk output call site | **GREEN — 21 passed** | **negative, reported not hidden.** No fixture reaches that callback: it lives inside `runExport`, which needs a real GL context and `VideoEncoder`. Rung 1 is covered at the class level and at the recovery level, **not at its call site.** See "must be true" item 5. |
| P6 | replace the final-flush call with a bare `await encoder.flush()` (the pre-fix unbounded shape) | **RED — 1 failed / 11 passed** (`flushLiveness.test.ts`, 12 tests) | the source-level call-site guard still reaches the final flush after the `runFinalFlushWithRecovery` extraction — this is the pre-existing P1 probe from that file's own header, re-run because the refactor moved its target |

P5 is the honest one. Per CLAUDE.md's fixture-reach rule a suite that has never been deliberately broken
has unmeasured reach — so the reach of this suite is: policy, bound, valve semantics, recovery sequencing,
orchestrator routing, guard strictness, byte neutrality. It is **not**: the worker's own frame loop, the
output callback, or anything that needs a real encoder.
