# WS3 Round 4 — export liveness: static-analysis fixes

**Branch:** `ws3-export-liveness-occlusion` · **Base:** `3ad686e` · **Head:** see §8
**Date:** 2026-09-08

> **Read this first.** NOTHING in this round was empirically verified. No export,
> fixture export, Part C run, ceiling suite, digest harness or `tauri:dev`
> session was executed — by instruction. Every fix below is static source
> analysis plus unit tests. Each one is tagged LOW-RISK (mechanical, neutral by
> construction) or SPECULATIVE (rests on an unproven hypothesis), and §7 says
> what to look for in a real export to confirm or refute each.

---

## 1. What changed

| # | Defect | What changed | Where | Risk | Symptom that would PROVE it worked | Symptom that would prove it FAILED |
|---|---|---|---|---|---|---|
| 1 | Unbounded encoder session | GL runs are cut into pieces of ≤1800 frames at hard cuts; all pieces of one run share an absolute frame grid | `exportPipelineWebCodecs.ts` `buildPiecePlans` :380, `planGlRunPieceStarts`; `exportWorker.ts` `frameGridOriginSec` | **SPECULATIVE** (the number 1800; the mechanism is LOW-RISK) | Diagnostics `routing` shows ~23 pieces, not 1; `pieceIndex` > 0 appears in payloads | Post-concat frame-count guard fires ("does not match the expected total"), or a visible seam/stutter at a piece boundary |
| 2 | Concat/mux paths unbounded | Typed wall-clock bound + `ffmpeg.kill()` on 6 ffmpeg call sites | `ffmpegLivenessBound.ts` (new); call sites in `exportPipelineWebCodecs.ts` | **LOW-RISK** (pure wrapper; no bound fires under normal timing) | A hang now ends with `ffmpeg step "<LABEL>" made no progress for Ns … (ffmpeg liveness bound)` instead of hanging forever | A bound fires on a *healthy* long job — that means the value is too tight, not that the mechanism is wrong |
| 3 | Flush emits no liveness signal | `encodedChunkCountAtFlushStart` recorded at flush entry | `exportWorker.ts` :~1060; `exportWorkerDiagnostics.ts` | **LOW-RISK** (one integer copy, diagnostics only) | A watchdog payload in `encoder-flush` now shows drained = `encodedChunkCount − encodedChunkCountAtFlushStart` | n/a — cannot change export behaviour |
| 4 | Timeline gap (blocking) | Pass 4 contiguity repair for pairs Pass 3 skips; `repairTimelineGaps` + "Repair timeline" button | `snapBoundaries.ts` Pass 4; `timelinePartition.ts`; `App.tsx` | **SPECULATIVE** (that this mechanism produced *the operator's* gap); the mechanism itself is **CONFIRMED** by construction and by red-before tests | The 424-segment project exports after one "Repair timeline" press; new Apply Syncs on locked projects stop producing holes | The gap reappears after a fresh Apply Sync → a *different* producer exists |
| 5 | Diagnostics lost on long exports | Production `PHASE_LOG_CAP` 128 → 1024 | `exportWorkerDiagnostics.ts` :36 | **LOW-RISK** | Field payloads carry real `phase`/`segmentIndex`/`assetId` attribution instead of `null`/`0` | Memory pressure on a very long export (see §1 note) |
| 6 | Demuxers never released | `releaseDemux(url)`; per-asset release once the playhead passes | `videoDemuxer.ts`; `exportWorker.ts` `RunState` | **LOW-RISK** (release is non-poisoning — worst case is a re-demux) | `demuxCacheSize` in payloads stays flat instead of climbing | A decode stall/re-fetch mid-run → release fired too early |
| 7 | Accumulation across the run | `outputEvents` (O(frames)) replaced by a bounded incremental gap recorder | `exportPipelineWebCodecs.ts` `driveGlRun` | **LOW-RISK** (diagnostics only) | `workerHeapBytes` flatter across a long run; `silentIntervals` is a short list of real gaps | A real stall no longer appears in `silentIntervals` → threshold too high |
| 8 | Blocked-worker liveness | **Design only — nothing built.** Backstop confirmed correct in source | — | — | — | — |

> **§1 note on Defect 5's cost.** The phase log is retained *per finished GL
> piece* in `WebCodecsRunDiagnostics.glPieces` for the whole export, so memory is
> `cap × pieces × entry`. At ~150 B/entry: 1024 × 23 pieces ≈ **3.4 MB**. The DEV
> cap of 8192 would be ~28 MB for the same job, which is why it was not simply
> promoted to production.

---

## 2. The encoder-session cap

**1a — why 334 segments collapsed to `pieceIndex 0`.**
`buildPiecePlans` (`exportPipelineWebCodecs.ts:380`). Its GL branch ran
`while (j + 1 < n && tiers[j + 1] === 'gl') j++`, merging every maximal run of
adjacent GL-tier segments into ONE `PiecePlan`. Upstream,
`groupConnectedComponents` unions every segment pair joined by a real-duration
transition into a single component and gives the whole component one tier, so a
project where every segment is GL-expressible produces one run and therefore one
piece. **There was no bound of any kind** on piece duration, frame count or
encoder-session length anywhere in the file. `expectedFrames` was computed but
used only for progress reporting and the post-concat guard.

**1b — the cap: `MAX_ENCODER_SESSION_FRAMES = 1800`** (60s at 30fps).

Stated in **frames**, not seconds, because every accumulator this bounds grows
per frame.

On the ~60s / ~62s number the round asked me to evaluate: I did **not** use it.
This repo's own history refuted the ~62s ceiling (commit `4d4922c`,
"refuted ~62s ceiling"), so building a cap on it would be building on a
retracted result. The 1268.7s field failure gives an *upper* bound on what is
too much and no *lower* bound on what is enough.

What 1800 is actually justified by:

- A piece boundary **is a worker boundary** — `driveGlRun` constructs a fresh
  `Worker` per GL piece and `terminate()`s it. It is the only point in this
  pipeline where the demux cache, the `ImageBitmap` map, decode cursors, encoder
  state, and the main thread's per-run arrays all reset at once. Capping the
  piece caps all of Defect 7's growth surface, and 1800 vs 38061 is a **21×**
  reduction in every per-frame accumulator.
- A piece is the unit of **attribution and retry**. With one piece, every
  failure payload can only ever say `pieceIndex 0`.
- Against a per-piece fixed cost (GL context + shader compile + font init) that
  the phase log already measures, so it is tunable from a real run.

**Be clear: 1800 is a judgement call.** Tune it from a real export's `phaseMs`,
not from this document.

**1c — output-neutral by construction.** Two guarantees, both in code:

1. **The frame grid is shared, so counts telescope.** Every piece cut from one
   run carries the same `gridOriginSec` (the run's first segment's `startTime`)
   and its own `gridBaseFrame`. Each piece's span is
   `gridFrame(pieceEnd) − gridFrame(pieceStart)` on *one* grid, so the per-piece
   counts telescope to `gridFrame(runEnd) − gridFrame(runStart)` — byte-for-byte
   the single number the unsplit run produced. The worker computes
   `currentTime = gridOriginSec + (gridBaseFrame + i) / fps`, which is exactly
   the value the unsplit run would have computed for that absolute frame. Both
   worker fields are optional and default to the pre-cap arithmetic exactly.
   *Pinned by* `encoderSessionCap.test.ts` — "frame counts telescope", asserted
   against `Math.round(totalSec * fps)`.

2. **A boundary may only fall where a keyframe is already forced and no
   transition straddles.** `isLegalPieceBoundary` requires the candidate to be a
   segment start (`exportWorker.ts`'s `segmentStartFrames`/`isKeyFrame` already
   forces a keyframe on the first frame of every segment in a run — so the new
   encoder session's IDR was going to be an IDR anyway) **and** requires
   `resolveEffectiveTransition(run[k-1], …).duration <= 0`. When a transition
   *would* straddle a candidate, **the boundary moves** — `planGlRunPieceStarts`
   cuts at the last legal hard cut instead — and the transition is never
   touched. A run with no hard cut anywhere stays one piece; that is a stated
   limit, not an oversight, and it is pinned by its own test.

**1d — piece count for 1268.7s.** For 334 × 3.799s segments at 30fps
(1268.866s, 38066 frames):

```
PIECES  23
frames  1710 ×22, then 456      (sum 38066 = unsplit 38066)
```

22 full pieces of 15 segments each (16 would be 1824 > 1800), plus a 456-frame
tail.

---

## 3. Per-path concat/mux bounds

**2a — classification.** Every one of these is a bare `invoke(...)` into the Rust
sidecar: one promise, no incremental output, nothing streamed back. All are
**class (ii), opaque, needs a timeout** — with one exception.

| Path | ffmpeg invocation | Consumed as | Class |
|---|---|---|---|
| `encodeTier1Piece` | `encodePlainVideoSegment` / `encodeStaticImageSegment` → `ffmpeg.exec` (`segmentEncoder.ts` :~429 / :~533) | one awaited promise → MP4 bytes | (ii) opaque |
| `encodeCanvasPiece` | `encodeSegment` → per-frame `writeFile` loop, then one `ffmpeg.exec` (`segmentEncoder.ts` :~331) | promise, **plus** `onProgress(framesWritten, totalFrames)` per frame | **(i) incremental** |
| `remuxMp4ToAnnexb` | `ffmpeg.exec(['-i', …, 'h264_mp4toannexb', …])` | one awaited promise | (ii) opaque |
| `concatAnnexbPieces` | `ffmpeg_concat_annexb_pieces` (`tauriFfmpeg.ts:224`) | one awaited promise, void | (ii) opaque |
| `countAnnexbFrames` | `ffmpeg_count_annexb_frames` (`tauriFfmpeg.ts:202`) | one awaited promise → number | (ii) opaque |
| `muxOnly` | 1–2 × `ffmpeg.exec` (`muxOnly.ts` :167/:178/:186) | awaited promises, void | (ii) opaque |

**2b — the bounds.** Sized against a ~23-piece, 1268.7s, 1080p30 job, whose
concatenated annexb video is ~1.3–1.9 GB at 8–12 Mbps.

| Constant | Value | Reasoning |
|---|---|---|
| `REMUX_BOUND_MS` | **120s** | One piece (≤1800 frames), stream copy, touches no pixels. Milliseconds in practice. |
| `FRAME_COUNT_BOUND_MS` | **300s** | 64 KB-chunked native sequential read of ~1.9 GB, no decode. 300s ≈ 6 MB/s — far below any real device. |
| `TIER_PIECE_BOUND_MS` | **600s** | Tier C is the expensive one: one PNG written over IPC per frame *before* ffmpeg runs. A 60s segment at 30fps = 1800 IPC round-trips; at a pessimistic 100 ms each that is 180s, plus the libx264 encode. >3× headroom. **Resettable** on the canvas path. |
| `CONCAT_BOUND_MS` | **600s** | Stream copy of the whole ~1.9 GB with 2 FDs open. Even at a punitive 5 MB/s that is ~380s; seconds on a real disk. |
| `MUX_BOUND_MS` | **900s** | The loosest, because the with-audio case makes **two** passes over the whole ~1.9 GB (annexb → real-PTS premux, then the audio mix) *and* AAC-encodes ~21 minutes of voiceover. |

These are deliberately loose. Their job is to convert *"hangs forever with no
payload"* into *"fails in bounded time with a typed error and a diagnostics
payload"* — not to catch a merely slow machine. None reuses the frozen
`WATCHDOG_MS`: that measures worker-message silence, not subprocess wall time.

The one class-(i) path (`encodeCanvasPiece`) resets its bound on each completed
frame write via `handle.touch()`, so a slow-but-moving canvas encode is never
killed for being slow — pinned by a test that survives 9× the bound while moving
and still fires once movement stops.

**2c — cancelable, kills the process.** On expiry the bound calls
`ffmpeg.kill()` (→ `ffmpeg_kill_session`) *before* rejecting, so the sidecar dies
rather than being orphaned while the renderer walks away from its promise. The
abandoned `invoke` promise is settled by the kill, not awaited. A kill that
itself throws is recorded (`killed: false`, `killError`) rather than masked.
`boundedStepError` surfaces the typed error and its full diagnostics payload
instead of burying it under the generic per-step wording.

---

## 4. Is 30s enough for the worst-case flush?

**Yes — by a very wide margin, and the cap does not need to be smaller.**

**3a.** Flush call site: `exportWorker.ts:~1060` (`tracker.enter('encoder-flush');
await encoder.flush();`). Chunk-forwarding path: the encoder output callback
registered in `createEncoder` (`exportWorker.ts` :~849-853), which does
`encodeStats.noteChunk` → `postOut({type:'chunk', …})`.

`VideoEncoder.flush()` **does** emit its remaining chunks through that same
output callback as it drains, and `chunk` **is** in the main thread's
`WATCHDOG_MS` reset set (`exportPipelineWebCodecs.ts`, the `case 'chunk'`
handler). So a draining flush keeps the watchdog alive on its own; no new reset
wiring was needed and none was added.

**3b.** What was missing was a **baseline** — `encodedChunkCount` is a whole-run
total, so a payload reading `lastPhase: "encoder-flush"` could not say whether
anything had drained *since the flush began*. `encodedChunkCountAtFlushStart`
now records the count at flush entry; `encodedChunkCount −
encodedChunkCountAtFlushStart` reads straight off any payload.

**3c — worst-case flush size: ~5 frames plus codec reorder depth.** The frame
loop refuses to submit while `encoder.encodeQueueSize > BACKPRESSURE_HIGH_WATER`
(**4**, `exportWorker.ts:588`), checked before every `encode()`. So at most ~5
frames are outstanding when flush is entered — **independent of the run's frame
count and independent of Defect 1's cap**. 30s for ~10 frames of drain is 3s per
frame.

**This reframes field evidence A.** With at most ~5 frames outstanding, 30055 ms
of flush silence was *not* a legitimately slow flush of 38061 frames. Either the
encoder produced nothing for 30s with a near-empty queue, or the worker thread
was blocked so `postMessage` never ran. **The watchdog verdict was most likely
correct** — this was not a working export being killed.

---

## 5. Timeline gap: root cause and the unblock

**4a — the validator, and whether the hole is real.**
`timelinePartition.ts:163` `checkTimelineIsGapless` → `findPartitionViolations`
:114-125, which compares `next.startTime − (curr.startTime + curr.duration)`
against `PARTITION_EPSILON_SEC` (0.0015s). It is called at
`exportPipelineWebCodecs.ts:1526` (and `exportPipeline.ts:122`) on
`project.segments` **directly**. No export-time boundary computation is
involved. **The 0.200s hole is real in the saved project data.**

Indexing note: the guard names the **later** side, 1-based. "before segment 99"
means the hole sits between array indices **97 and 98**, and it is
`segments[97]` that ends 0.200s early.

**4b — the producer: `snapCoveredBoundaries` (`snapBoundaries.ts`).**

Pass 3 has two `continue` paths — a null `plan` (a **locked** segment on either
side, or missing alignment data, `:705`) and the degenerate-pair guard (`:829`).
Both are documented as leaving the pair *"exactly as the caller supplied them"*.
**That is not what the code does.** `out[i].startTime` has already been
overwritten **in place** by pair `i−1`'s own write, while `out[i].duration` and
`out[i+1].startTime` still hold their pre-snap values. The adjacency then breaks
by exactly the distance pair `i−1` moved segment `i`'s start. The contiguity
repair at `:896-900` only ever runs on the **write** path, never for a skipped
pair.

Fixed with a **Pass 4** that repairs only what Pass 3's skips broke. It is a
provable no-op on written pairs (Pass 3 maintains adjacency exactly, so `delta`
is 0 there) and it never moves a locked segment — it adjusts the unlocked side,
and leaves the refused-upstream double-lock shape alone.

**4c — the uncovered case.** `gaplessInvariant.test.ts` swept
`computeDragCascade` and `applyAnchorBasedTiming` and **never called
`snapCoveredBoundaries` at all** — the third boundary writer was simply not in
the net, which is how 36/36 green shipped alongside a real hole. Added four
cases, including the 424-segment / lock-at-99 shape and the missing-alignments
branch. **All three new failure cases were confirmed RED before the fix**
(re-verified after the fix by neutering Pass 4's loop).

> **Golden replay is 6/6 green, and that green is VACUOUS for this change.**
> A destructive probe instrumenting *both* the Pass 3 skip and the Pass 4 repair
> produced **zero hits across all three corpora**, while the positive control
> fired **3/3**. None of them contains a locked segment or a truncated
> alignments array. What the green does mean: lock-free projects replay
> byte-identically. What it does not mean: anything at all about a project with
> a lock.

**4d — the unblock for the 424-segment project.**

The producer fix does nothing for a project that already has a hole saved.
`repairTimelineGaps` (`timelinePartition.ts`) writes **exactly one field**: the
**duration** of the segment before each hole. It never writes a `startTime`.

**That is the entire safety argument, and it is total:**

- Every `startTime` is where the sync pipeline put it against the voiceover.
  Leaving all of them untouched means **every segment after a repaired hole
  stays exactly where the audio put it**. A repair cannot shift the timeline,
  cannot accumulate, and cannot move a heading (`headingLayer.ts` selects
  headings by absolute `startTime`).
- The only change is that **one** segment holds up to `maxGapSec` longer (a gap)
  or shorter (an overlap). Nothing downstream of it moves.

**Threshold: `MAX_REPAIRABLE_GAP_SEC = 1.0s`.** It does not exist because a
larger repair would be unsafe by the argument above — it exists to separate
*residue* from *damage*. A sub-second discontinuity is skip/rounding residue of
the class Pass 4 now prevents; a multi-second one means a scene's worth of time
is unassigned, which is a different problem and must not be silently absorbed.
Anything over the threshold, anything on a **locked** segment, and anything that
would drive a segment under `MIN_SEGMENT_DURATION` is **reported untouched**.

**Explicit and reported, never silent:** exposed as a **"Repair timeline"**
button that appears only on the `timeline_gap` export failure. It reports every
change and every refusal through the toast, and goes through `setProject`, so it
is one undoable history entry like any other edit.

### Exact steps for the 424-segment project

1. Build and run this branch (§7).
2. Open the project and press **Export**.
3. Export is refused with *"Timeline is not continuous: a 0.200s gap before
   segment 99…"*. The error dialog now shows a **Repair timeline** button.
4. Press it. Expect a toast reading approximately: *"Closed 1 timeline
   discontinuity (0.200s total) by adjusting one segment's duration. No segment
   start time was moved, so nothing after them shifted."*
   - If it instead reports a refusal, note the reason and the segment number —
     that is a case outside the threshold and needs a look, not a bigger
     threshold.
5. Press **Export** again. It should now pass preflight.
6. If you dislike the result, **Undo** restores the pre-repair state.

Re-running **Apply Sync** is the alternative and, with the Pass 4 fix, will no
longer produce the hole — but it re-derives every boundary and discards manual
edits, which is why the repair button exists.

---

## 6. What I chose NOT to fix, and why

- **`appendQueue` backpressure (Defect 7).** Buffered `EncodedVideoChunk` bytes
  before `appendFileRaw` are a real exposure — they are bounded only by how far
  appends lag chunk arrival, not by frame count. I left it alone because adding
  backpressure there changes export *timing*, and this round has no way to
  measure the consequence. Flagged, not fixed.
- **Releasing the demuxer inside `sequentialDecode.ts` itself.** That function is
  per-segment-range and cannot know whether a *later* segment reuses the asset.
  The release belongs one level up, at asset scope in `RunState`, which is where
  it went.
- **Defect 8's real design.** Explicitly design-only this round. See §8.
- **The four long-running v6 FA test timeouts.** Pre-existing suite runtime
  characteristic, not caused by this round — see §8.
- **Everything frozen by instruction:** `WATCHDOG_MS` and its reset set, encoder
  config, frame timing, compositing OUTPUT, transition/animation catalogs,
  preview files (`videoDecoderPool.ts`, `useWebCodecsPreview.ts`), `src-tauri/`.
  `videoDemuxer.ts` was touched **additively only** (one new exported function);
  no existing behaviour changed, and the export worker's cache is a separate
  module realm from preview's.

---

## 7. Build-and-test checklist

**Branch to build:** `ws3-export-liveness-occlusion` @ head (§8). Mac first,
then Windows — the field evidence is Windows.

**Before anything else — collect the routing line.** Every run logs
`[ws3-liveness] routing {...}` at export start. Capture it: it now names the
piece count, and Defect 1 is confirmed or refuted by that number alone.

| # | Export this | Expect | If it misbehaves, suspect |
|---|---|---|---|
| 1 | **The 424-segment project** (currently blocked) | Preflight refuses → "Repair timeline" → toast reports 1 change, 0 refusals → export proceeds | Button missing → D4 wiring. Refusal reported → a gap outside the 1.0s threshold. Gap returns after a fresh Apply Sync → a **different** producer than Pass 3's skips (D4b is then wrong) |
| 2 | **The 334-segment 1080p30 project** (the watchdog run) | `routing` shows **~23** GL pieces, not 1; progress advances across pieces; export completes | Still 1 piece → the run has no hard cut anywhere (D1's stated limit) — check for a global transition on every segment. Frame-count guard fires → D1c's telescoping is wrong, **stop and report** |
| 3 | Same, watching for a hang | If it dies, the payload now names the phase and a bounded piece | `ffmpeg step "<LABEL>" …` → D2 fired: that label is your culprit. `encoder-flush` with drained = 0 → a genuinely hung flush (D3) |
| 4 | Any long export, then read the payload | `phaseLog` carries real `segmentIndex`/`assetId`, not `null`/`0`; `silentIntervals` is a short list of real gaps | All-`null` attribution → D5's cap still too small. Empty `silentIntervals` on a run that visibly stalled → D7's 250 ms threshold too high |
| 5 | A long export with several video assets | `demuxCacheSize` in payloads stays flat rather than climbing monotonically | Climbing → D6 release never fires. A decode stall or visible re-fetch mid-run → release fired **too early**, report the segment |
| 6 | A short, ordinary export (regression control) | Byte-identical result to before this branch; exactly 1 GL piece; nothing new in the payload | Any visual difference at all → D1's neutrality is broken, **stop and report** |

**Cross-check between #2 and #6:** #6 is the control that says the cap changed
nothing when it does not apply; #2 says it applies when it should. A green #2
with a red #6 means the split is doing something other than splitting.

---

## 8. Gates, SHAs, and what is NOT DETERMINED

### Commits (one per defect, independently revertable)

| Defect | SHA | Subject |
|---|---|---|
| 1 | `4a42fe4` | bound the encoder session — cap GL pieces at 1800 frames |
| 2 | `c4825fa` | liveness bounds for every unbounded ffmpeg sidecar path |
| 3 | `163375a` | make a hung encoder-flush distinguishable from a slow one |
| 4 | `374fc32` | close the snapCoveredBoundaries gap producer, and unblock a saved one |
| 5 | `5337816` | raise the production phase-log cap 128 → 1024 |
| 6 | `cd19d34` | release demuxers and ImageBitmaps once the playhead has passed them |
| 7 | `c929e5e` | bound the per-frame accumulators in driveGlRun |

Tree clean, pushed to `origin/ws3-export-liveness-occlusion`. No merge to main,
no PR.

### Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **clean** |
| `npm run lint` | **clean** |
| `git diff --name-only main -- src-tauri/` | **empty** |
| `npm test` | see below |

**Test arithmetic (exact).**

```
baseline (3ad686e)   3203 passed  /  77 skipped  /  0 failed   = 3280 total
added this round       39 tests
                     ------------------------------------------------------
expected             3242 passed  /  77 skipped  /  0 failed   = 3319 total
observed             3238 passed  /  77 skipped  /  4 failed   = 3319 total
```

Added tests, per file:

| File | Added |
|---|---|
| `webcodecsExport/encoderSessionCap.test.ts` (new) | 6 |
| `webcodecsExport/ffmpegLivenessBound.test.ts` (new) | 7 |
| `timelineRepair.test.ts` (new) | 9 |
| `webcodecsExport/decodeCursorLifetime.test.ts` | +5 (6 → 11) |
| `gaplessInvariant.test.ts` | +4 (19 → 23) |
| `webcodecsExport/driveGlRun.test.ts` | +3 (12 → 15) |
| `videoDemuxer.test.ts` | +3 (4 → 7) |
| `webcodecsExport/exportWorkerDiagnostics.test.ts` | +2 (7 → 9) |
| **Total** | **39** |

`6 + 7 + 9 + 5 + 4 + 3 + 3 + 2 = 39`. `3203 + 39 = 3242 = 3238 + 4`.

**The 4 failures are all `→ Test timed out`. Zero assertion failures.**

```
ws1-session-s-measure           312379ms   (limit 300000)
ws1-session-q-production-pins   312836ms   (limit 300000)
ws1-session-s-exclusion         312267ms   (limit 300000)
ws1-session-aj0-oracle-diff     312717ms   (limit 180000)
```

All four elapsed within **570 ms of each other** at ~312.3–312.8s, against two
*different* limits — the signature of four multi-minute v6 FA jobs running
concurrently and starving together on one wall clock, not of four independent
failures. **Run in isolation they pass: 16 passed / 2 skipped / 0 failed, 51s
wall.** An earlier run also printed `AJ-0 oracle diff — v6: 447 compared, 446
exact, 1 allowlisted, 0 unexplained` — i.e. it completed its comparison cleanly
and only then hit the clock.

Nothing this round touches those paths except an O(n ≤ 447) loop in
`snapCoveredBoundaries` Pass 4.

### NOT DETERMINED

1. **Whether any fix works in a real export.** No export was run. Every claim
   above is static analysis plus unit tests.
2. **Whether 1800 frames is the right cap.** The mechanism is neutral by
   construction; the number is a judgement call. The refuted ~62s ceiling was
   deliberately not used as its basis.
3. **Whether Pass 3's skip is what produced the operator's specific 0.200s
   gap.** The mechanism is confirmed by construction and reproduced red in
   tests; that it is *the* producer in that project is inference. Checklist
   item 1 settles it.
4. **Whether the six ffmpeg bound values are right for real hardware.** They are
   reasoned upper bounds, never measured. A bound firing on a healthy job means
   the value is too tight, not that the mechanism is wrong.
5. **Whether the 4 timing-out FA tests pass under a full suite run on the
   operator's machine.** They pass in isolation here; I did not re-measure the
   baseline commit under identical load.
6. **Whether Defect 6's release is early enough to matter, or too early.** The
   rule is provably safe against revisits (it takes the max over referencing
   segments); its actual memory benefit is unmeasured.

---

## Appendix — Defect 8: blocked-worker liveness (design only)

**Confirmed in source: the main-thread backstop is independent of every worker
signal, and always produces a populated payload. No fix needed.**

- **Independence.** `resetWatchdog()` is called at
  `exportPipelineWebCodecs.ts:1276`, *before* `worker.postMessage(initMsg)` at
  `:1278`, arming `watchdogTimer = setTimeout(finishWatchdog, WATCHDOG_MS)`
  (`:1018`) on the main thread. Worker messages only ever **reset** it; nothing
  from the worker is required for it to **fire**. A worker that goes silent from
  the very first instant still trips it.
- **Populated payload.** `finishWatchdog` posts `request-diagnostics`, waits
  50 ms, then calls `reconstructDiagnostics()` (`:910`). If the worker is
  blocked it cannot answer, `lastWorkerDiagnostics` stays null, and the fallback
  is built from **main-thread-observed** state — `framesEncoded:
  lastFramesEncoded`, `lastPhase`, `phaseLog.slice()` merged from earlier
  `phase` messages, zeros elsewhere — then stamped with a `via: 'watchdog'`
  failure. This is exactly what happened in the field: the payload carried
  `framesEncoded 38061`, `lastPhase "encoder-flush"`, `pieceIndex 0`.
- Its one inherent limit: if the worker blocks *before* sending any `phase`
  message, the payload is honest but uninformative (`lastPhase: "init"`,
  `framesEncoded: 0`). Nothing on the main thread can know more than it was
  told.

**Recommended real design — a native-side watchdog, not a second worker.**

Round 3 already proved a worker-side heartbeat CONFIRMED-INERT: it cannot fire
when the worker thread is blocked. A **second Worker** would fix that (its own
thread, its own event loop, unaffected by the export worker blocking) but shares
the export's fate in the cases that matter most — a WebView-wide stall, a GPU
process hang, or the OS deprioritising the whole renderer for an occluded
window, which is the documented Round 3 finding. It would also need its own
channel to the main thread to be useful, and the main thread is exactly what was
being starved.

Put the watchdog **in Rust**, outside the WebView entirely:

- The renderer registers an export with the native side and sends a cheap
  keepalive on real progress (an `appendFileRaw` completing is already the
  Round-3-approved forward-progress signal — reuse it, do not invent a new one).
- A Tokio timer on the Rust side owns the deadline. Nothing in the WebView can
  starve it: not an occluded window, not a blocked worker, not a throttled
  `setTimeout`.
- On expiry Rust kills the ffmpeg session it already owns, and emits an event
  the renderer surfaces if it is still alive — and if it is not, the process
  tree is still cleaned up, which is the case no in-WebView design can cover.

This is also the only design that survives the renderer dying outright, which
today leaks an orphaned ffmpeg process. It needs `src-tauri/` writes and is
therefore out of scope for this round by instruction.
