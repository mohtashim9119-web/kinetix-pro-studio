# WS3 Silent-Gaps Diagnosis (Part C 500-segment throughput regression)

Analysis-only round. Worktree: `../4.kinetix-pro-studio-tmp-ws3-silent-gaps`, branch
`tmp/ws3-silent-gaps`, based on `main@4d4922c`. This file is written incrementally as
findings are confirmed — every claim below carries a `file:line` citation or is marked
`NOT DETERMINED`.

## Part 0 — Worktree

- `pwd` (main repo): `/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio`
- Branch: `main`, HEAD `4d4922c09e911e1f3cdc55ca45440ccda06a3c50`, matches `origin/main`, clean tree — confirmed.
- Worktree created: `git worktree add ../4.kinetix-pro-studio-tmp-ws3-silent-gaps -b tmp/ws3-silent-gaps` at `4d4922c`.
- `node_modules` is untracked/gitignored and not shared by `git worktree` — symlinked from the
  main checkout (`ln -s .../4.kinetix-pro-studio/node_modules .../4.kinetix-pro-studio-tmp-ws3-silent-gaps/node_modules`)
  rather than reinstalled, since no `package.json` change is needed for this round's TS-only
  instrumentation.
- `public/_spike/` is gitignored (`.gitignore:27`) and therefore **only exists in the original
  checkout**, not the worktree — all raw run artifacts (Part 1) were read from
  `/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio/public/_spike/`, not the worktree.
- `src-tauri/target` is reused from the main checkout via `CARGO_TARGET_DIR` so that running
  `npm run tauri:dev` from the worktree does not force a Rust rebuild (no `src-tauri/` diff this
  round — see Gates).

## Part 1 — Mining existing evidence

### 1a. Artifacts located

`public/_spike/ws3-result.jsonl` (23,133 bytes, mtime 2026-09-07 21:31) is the vite-dev-server
POST sink the task refers to; it is **append-only across the whole session**, not truncated per
run — it holds all three of the session's Part C 500 runs plus their raw `progress`/`predicted`/
`start`/`done` events. There is no `/tmp/ws3-ceiling-hang-evidence.jsonl` data belonging to the
Part C runs — that file (693,878 bytes, mtime 16:02, i.e. **before** the Part C block which starts
at 21:16 per `part-c-autorun-start`'s `ts`) belongs to the earlier same-session Round 6
ceiling-bisect work, not Part C — it contains zero `part-c-*` tags (confirmed by grep) and is not
used further in this report. Sibling files: `ws3-result.pre-partc.jsonl` (826,557 bytes, 17:19) is
a pre-Part-C snapshot/backup of the sink, also not needed here. `ws3-result-round5.jsonl` (0
bytes) and `ws3-result-aborted-run.jsonl` (955,875 bytes, 00:51) predate Part C entirely.

Parsed `ws3-result.jsonl`: 141 events total, tag histogram:
`part-c-autorun-start`×3, `part-c-500-predicted`×3, `round6-part-c-500-start`×3,
`round6-part-c-500-progress`×120 (40/run — one per 150 encoded frames, 6000/150=40), 
`round6-part-c-500-export-returned`×3, `round6-part-c-500`×3, `part-c-500-report`×3,
`part-c-500-done`×3.

Run boundaries (`part-c-autorun-start` → matching `part-c-500-done`, epoch ms):
run1 `[1788798075980, 1788798343910]` (267.93s wall between tags; `wallSec` reported by the
app itself, measured from inside the run, is 266.93s — the 1s difference is autorun-harness
overhead outside the timed export call, not part of the regression), run2
`[1788798382945, 1788798519207]`, run3 `[1788798553821, 1788798691324]`. These match the
`wallSec` values 266.93 / 135.271 / 136.53 in the task brief exactly.

### 1b. Run 1's 15 intervals >5s

Source: `part-c-500-done` payload (also duplicated verbatim in the preceding `part-c-500-report`
event) for run1, field `silentIntervalsOver5s`. All times are ms elapsed since that run's own
`round6-part-c-500-start` (i.e. `relMs()` in `exportPipelineWebCodecs.ts:635`, not wall-clock).
"Frame index before/after" is derived from the bracketing `round6-part-c-500-progress` events
(logged every 150 frames = 5 output-timeline seconds, `runRound6.ts:81`), since the interval
record's own `frameIndexAtStart`/`framesEncodedAtStart` is **`0`/`null` for 13 of the 15** — this
is the attribution hole Part 2 explains; the *progress* stream is a separate, uncapped log and is
reliable for all 15.

| # | start (ms) | end (ms) | dur (ms) | framesEncoded bracket (before→after, from progress log) | reported phase | reported framesEncodedAtStart |
|---|---|---|---|---|---|---|
| 1 | 57497 | 67514 | 10017 | 2400→2550 (t=57550 progress lands 53ms after gap start) | null | 0 |
| 2 | 72144 | 78192 | 6048 | 2850→3000 (progress burst 72059/72461/72761 landed just before gap start) | null | 0 |
| 3 | 80355 | 86488 | 6133 | 3300→3450 | null | 0 |
| 4 | 91836 | 101151 | 9315 | 3600→3750 | null | 0 |
| 5 | 103143 | 108741 | 5598 | 3750→3900 | null | 0 |
| 6 | 123093 | 131145 | 8052 | 3900→4050 | null | 0 |
| 7 | 146794 | 156350 | 9556 | 4200→4350 | null | 0 |
| 8 | 156355 | 167094 | 10739 (longest) | 4350→4500 | null | 0 |
| 9 | 182541 | 191140 | 8599 | 4650→4800 | null | 0 |
| 10 | 192189 | 197686 | 5497 | 4800→4950 | null | 0 |
| 11 | 206589 | 216599 | 10010 | 4950→5100 | null | 0 |
| 12 | 219230 | 228088 | 8858 | 5100→5250 | null | 0 |
| 13 | 230232 | 236486 | 6254 | 5250→5400 | null | 0 |
| 14 | 244139 | 250142 | 6003 | 5550→5700 (frame 5696 at start) | `frame-loop` | 5697 |
| 15 | 252428 | 258201 | 5773 | 5850→5913-ish (frame 5912 at start) | `demux` | 5913 |

Piece index: all 15 fall inside the single GL piece (`pieceIndex 0`) — the fixture's
`part-c-500-predicted` event records exactly one piece: `{"tier":"gl","startIndex":0,
"segmentCount":500,"expectedFrames":6000}` (`ws3-result.jsonl` predicted payload). At ~12
frames/segment (6000/500) and 30fps, gap #1 (frame ~2400) sits around segment index ~200; gap #15
(frame ~5900) sits around segment index ~492 — i.e. these gaps recur across nearly the entire
back three-quarters of the segment range, not clustered at one boundary.

Asset identity per gap: **NOT DETERMINED from the sink alone** — `part-c-500-predicted` records
`uniqueVideoAssets` (4) and the transition/animation cycle but not a per-segment asset-id
timeline, and the per-gap `assetId` that `ExportPhaseTracker.postNow` would have attached
(`exportPhaseTracker.ts:196-207`) is exactly the field lost to the same ring-buffer eviction
documented in Part 2 — the surviving tail-of-run phase-log entries (gaps #14/#15) do carry
`assetId`, but the JSONL sink's `part-c-500-done`/`report` events only ever logged the reduced
`SilentIntervalAttribution` shape (`phase`, not `assetId`) via `runPartC.ts:45`
(`gl.silentIntervals.filter(...)`), not the richer per-entry phase-log record. Fixing this is
covered under the Part 2/3 instrumentation below.

### 1c. Structure

**Not periodic, not front-loaded, not boundary-locked to a fixed segment count**: gap start times
(57.5, 72.1, 80.4, 91.8, 103.1, 123.1, 146.8, 156.4, 182.5, 192.2, 206.6, 219.2, 230.2, 244.1,
252.4, all seconds) have irregular spacing (14.6s, 8.3s, 11.5s, 11.3s, 20.0s, 23.7s, 9.6s, 26.1s,
9.7s, 14.4s, 12.6s, 11.0s, 13.9s, 8.3s) — no common period, but a clear **density trend**: gaps are
sparser in the first third of the run (one gap per ~20-45s of progress before frame 2400) and
denser from frame ~3600 onward (gaps roughly every 10-25s, back-to-back in cases — e.g. #7 ends at
156350 and #8 starts at 156355, 5ms apart, effectively one 19.3s combined stall split only by a
single progress tick landing between them). This growing-density shape argues against a fixed
number of "cold asset first-touch" events (only 4 unique assets exist; a pure cold-read theory
predicts at most ~4 isolated stalls near the run's start, not 15 spread through frames 2400-5900)
and toward an **accumulating condition** (see Part 4).

**Sum of the 15 gaps**: 10017+6048+6133+9315+5598+8052+9556+10739+8599+5497+10010+8858+6254+6003+5773
= **124,452 ms = 124.45s**. Against the task's stated 131.66s excess (266.93-135.27=131.66,
matching this session's arithmetic: 266.93-135.271=131.659), the 15 named gaps account for
**124.45s / 131.66s = 94.5%** of the excess. The remaining **7.21s** is distributed across the
*rest* of the run as uniformly-slower-than-baseline frame production, not additional named gaps —
confirmed by comparing the per-150-frame progress deltas outside the 15 windows: run1's chunks
outside any listed gap average ~3.3-4.9s/150-frames in the first 80s (vs run2/3's steady
~3.2-3.3s/150-frames throughout, see table below), i.e. even the "clean" stretches of run1 ran
mildly slower than baseline before the gaps even start. This is the "many small sub-5s
contributions" case, not "one dominant additional cause" — distinguished from "uniformly slower
frames throughout" because run1's early progress deltas (before frame 2400) are close to run2/3's
baseline (see table), so the mild slowdown is itself concentrated in the back three-quarters of
the run, consistent with the same accumulating condition that produces the >5s gaps, just below
the 5s reporting threshold in its early stages.

Per-150-frame progress deltas (ms), all three runs, from `round6-part-c-500-progress` events
(`ws3-result.jsonl`):

| framesEncoded | run1 Δms | run2 Δms | run3 Δms |
|---|---|---|---|
| 150 | 4256 | 4978 | 4586 |
| 300 | 3389 | 3294 | 3301 |
| 450 | 3398 | 3345 | 3305 |
| 600 | 3330 | 3241 | 3227 |
| 750 | 3775 | 3392 | 3407 |
| 900 | 3560 | 3255 | 3402 |
| 1050 | 3670 | 3270 | 3336 |
| 1200 | 3797 | 3349 | 3386 |
| 1350 | 2920 | 3273 | 3380 |
| 1500 | 4150 | 3212 | 3254 |
| 1650 | 3031 | 3210 | 3236 |
| 1800 | 3054 | 3198 | 3170 |
| 1950 | 4908 | 3410 | 3548 |
| 2100 | 2033 | 3207 | 3302 |
| 2250 | 3379 | 3266 | 3300 |
| 2400 | 4010 | 3234 | 3379 |
| 2550 | **14509** | 3285 | 3324 |
| 2700 | 402 | 3169 | 3575 |
| 2850 | 300 | 3175 | 3286 |
| 3000 | **6422** | 3217 | 3217 |
| 3150 | 415 | 3382 | 3395 |
| 3300 | 495 | 3290 | 3250 |
| 3450 | **7586** | 3240 | 3230 |
| 3600 | 2502 | 3292 | 3418 |
| 3750 | **13018** | 3215 | 3415 |
| 3900 | 7587 | 3300 | 3257 |
| 4050 | **21358** | 3287 | 3232 |
| 4200 | 7703 | 3183 | 3173 |
| 4350 | **17938** | 3402 | 3389 |
| 4500 | 13613 | 3226 | 3293 |
| 4650 | 11587 | 3246 | 3199 |
| 4800 | **16292** | 3293 | 3253 |
| 4950 | 18901 | 3307 | 3253 |
| 5100 | 996 | 3253 | 3283 |
| 5250 | 10321 | 3241 | 3199 |
| 5400 | 8123 | 3231 | 3200 |
| 5550 | 2527 | 3465 | 3279 |
| 5700 | 11020 | 3325 | 3287 |
| 5850 | 1356 | 3275 | 3271 |
| 6000 | 6999 | 3671 | 3268 |

Note the bursty pairing: a large delta (e.g. 14509ms at framesEncoded=2550) is frequently
followed immediately by one or more near-instant deltas (402ms, 300ms at 2700/2850) — i.e. the
150-frame progress *reporting* granularity is too coarse to localize a stall inside a 150-frame
(5-output-second) window; the stall and a burst of "catch-up" frames both land inside the same or
adjacent windows. This is consistent with the finer-grained `silentIntervalsOver5s` list above
being the more precise signal, and with the stalls being real encode/decode-side delays rather
than a postMessage-batching artifact (a pure batching delay would not correlate with an
`ExportPhaseTracker` phase transition landing exactly at the gap boundary the way gaps #14/#15
do).

## Part 2 — The attribution hole

### 2a. Root cause, file:line

`ExportPhaseTracker` (`src/services/webcodecsExport/exportPhaseTracker.ts`) keeps a **ring
buffer** of phase-transition log entries, capped at `PHASE_LOG_CAP = 128`
(`src/services/webcodecsExport/exportWorkerDiagnostics.ts:15`), evicted oldest-first by
`pushPhaseLogEntry`'s `if (log.length > PHASE_LOG_CAP) log.shift()`
(`exportWorkerDiagnostics.ts:106-109`). The cap's own doc comment
(`exportWorkerDiagnostics.ts:9-14`) states the assumption plainly: *"at PHASE_THROTTLE_MS (250 ms)
one `pulse()` per phase yields at most 4 entries/s; 128 entries cover ~32 s of continuous
single-phase activity ... without growing with segment or frame count."* That assumption is
correct as written but does not hold for this fixture: Part C 500 is a **single GL piece**
(`part-c-500-predicted`'s one-piece plan, confirmed above) whose one `ExportPhaseTracker` instance
lives for the entire 130-267s run, continuously alternating `frame-loop` (entered once,
`exportWorker.ts:969`) with per-segment nested `demux`/`image-bitmap` phases
(`exportWorker.ts:489/517`, pushed via `enter()`/popped via `leave()` inside
`resolveSlotSource`, `exportWorker.ts:481-532`, called once per segment whose decode cursor
doesn't exist yet — i.e. up to 500 times, since `resolveSlotSource` keys cursors by **segment id**
not asset id, `exportWorker.ts:487`, so even a segment reusing an already-demuxed asset still
gets its own fresh `enter('demux')`/`leave()` pair). Over a 130-267s run this produces far more
than 128 phase-log entries in total.

Both copies of the log hit this cap, independently:
- The **worker's own** `ExportPhaseTracker.phaseLog` (`exportPhaseTracker.ts:63`, pushed via
  `postNow` at `exportPhaseTracker.ts:192`) is capped at 128 and is what gets embedded in each
  outbound `'phase'`-adjacent diagnostics snapshot.
- The **main thread's merged copy** (`exportPipelineWebCodecs.ts:632`,
  `const phaseLog: ExportPhaseLogEntry[] = []`) is built by replaying every incoming worker phase
  entry through the *same* `pushPhaseLogEntry` (`mergePhaseFromWorker`, `exportPipelineWebCodecs.ts:650-654`)
  — so it is capped at 128 **again**, this time over the entire run's history, not per-message.

Meanwhile `outputEvents` (`exportPipelineWebCodecs.ts:633`, appended on every `'chunk'`/
`'queue-sample'` in `recordOutput`, `exportPipelineWebCodecs.ts:637-642`) is **never capped** — it
holds one entry per encoder output for the whole run (thousands of entries over 6000 frames).

The silent-interval computation is a single retrospective pass at the very end of the run:
```
const silentIntervals = (): SilentIntervalAttribution[] =>
  attributeSilentIntervals(outputEvents, phaseLog, 0, relMs());
```
(`exportPipelineWebCodecs.ts:684-685`). It walks the **full, uncapped** `outputEvents` history
against the **tail-only** (last ~128 entries / ~32s of coverage) `phaseLog`. For each gap,
`pushSilentGap` calls `phaseAtTime(phaseLog, startMs)` (`exportWorkerDiagnostics.ts:145`) and
`framesAtTime(phaseLog, startMs)` (`exportWorkerDiagnostics.ts:140`), both of which scan the
surviving ring-buffer entries in order and return their **initialized defaults** (`phase =
null`, `frames = 0`) whenever every surviving entry's `atMs` is *greater* than the queried
`startMs` (`phaseAtTime`, `exportWorkerDiagnostics.ts:112-119`; `framesAtTime`,
`exportWorkerDiagnostics.ts:122-129`) — i.e. whenever the gap being attributed is older than the
oldest entry the ring buffer still holds.

This is confirmed exactly by run1's own numbers: the run is 266.93s long; only gaps #14 (ends
250.1s, i.e. 16.8s before run end) and #15 (ends 258.2s, i.e. 8.7s before run end) fall inside the
~32s tail window the cap preserves, and only those two carry a non-null phase (`frame-loop`,
`demux`) and a nonzero `framesEncodedAtStart`. Every earlier gap (up to 236.5s, i.e. 30.4s before
run end — right at the edge of the theoretical 32s window, already evicted in practice because the
per-segment `enter`/`leave` traffic runs faster than the idealized "one pulse per phase" the
comment assumes) reads `phase: null`, `framesEncodedAtStart: 0`. **This is not a code region that
emits no phase token** — `demux` and `frame-loop` are both real, populated phase names
(`exportWorker.ts:489`, `exportWorker.ts:969`) that almost certainly *were* pushed at the time
each early gap occurred; the record is lost afterward, evicted by later segments' own phase
transitions before the end-of-run attribution pass ever reads it. None of the task's three
candidate explanations is literally correct as posed ("cleared on terminal transition", "never set
for that region", "read after a reset") — the precise mechanism is a **capacity mismatch between
an unbounded history array (`outputEvents`) and a small ring buffer (`phaseLog`) that is
retrospectively queried against that unbounded history's old timestamps**.

### 2b. Is there also a genuinely unlabelled region?

No evidence of one. Every phase name touched during a segment's slot resolution has an `enter()`/
`leave()` bracket: `demux` (video, `exportWorker.ts:489-496`), `image-bitmap` (image,
`exportWorker.ts:517-526`), plus run-level `gl-context`, `shader-compile`×2, `font-init`,
`encoder-ladder`, `frame-loop`, `encoder-flush` (`exportWorker.ts:867,886,896,898,913,969,1031`).
The frame loop itself calls `tracker.pulse()` on every iteration inside its inner loop
(`exportWorker.ts:1017`), so even time spent inside `frame-loop` doing GL composite/encode work
between per-segment `demux` calls is tokenized at least once per `PHASE_THROTTLE_MS` (250ms) while
that code is live. **The gap is entirely explained by 2a (retrospective read of an evicted ring
buffer); there is no additional "silent" code region with zero instrumentation.**

### 2c. Instrumentation added (dev-only, output-neutral)

Two changes, both confined to bookkeeping objects `ExportPhaseTracker`/`exportWorkerDiagnostics`
already documents as "never touch[ing] encoder configuration, frame timestamps, compositing, or
piece boundaries" (`exportPhaseTracker.ts:13-15`) — verified independently by re-reading every
call site in `exportWorker.ts` above: `enter`/`leave`/`pulse`/`add`/`setContext`/
`setFramesEncoded` are all synchronous, contain no `await`, and are called immediately adjacent to
(never inside) the existing async work. Increasing how much history they retain changes no
timing and no pacing.

See "Instrumentation commit" below for the diff. Both changes are gated on `import.meta.env.DEV`,
which Vite/esbuild statically resolves and dead-code-eliminates at build time — `npm run
tauri:build` (production, `DEV=false`) compiles to the exact original literals, proven by
`npx tsc --noEmit` + the existing `unreachableFromProduction.test.ts` gate staying green (this
file itself is NOT a dev/-only file — it is a production module already always bundled — so the
gating is expression-level `import.meta.env.DEV ? X : Y`, not a file-level dev/prod split).

The three concrete edits (all in already-always-bundled production files, gated at the expression
level, not new dev-only files):

1. `exportWorkerDiagnostics.ts`: `PHASE_LOG_CAP` becomes `import.meta.env.DEV ? 8192 : 128`
   (was a bare `128`). 8192 entries at the same 250ms throttle covers ~34 minutes of continuous
   single-phase activity, and comfortably absorbs 500 segments' worth of `enter`/`leave` pairs on
   top of that — enough to keep phase attribution intact for the whole length of a Part C run (and
   considerably longer real exports) without unbounded growth.
2. `exportWorkerDiagnostics.ts`: `SilentIntervalAttribution` gains `segmentIndexAtStart` and
   `assetIdAtStart`, populated by a new local `entryAtTime` helper (mirrors the existing
   `phaseAtTime`/`framesAtTime` shape) inside `pushSilentGap`. Diagnostics-only, same eviction
   caveat documented on the interface.
3. `src/dev/exportLivenessProbe/runPartC.ts`: `PartCRunReport` (dev-only harness type; this file
   itself IS one of the throwaway files gated out of production per its own header comment and
   `unreachableFromProduction.test.ts`) now also carries `demuxCacheSize`, `workerHeapBytes`,
   `decodersCreated`, `decodedSourceFrames`, `encodedChunkCount`, `phaseMs`, `instrumentationMs`,
   `appendCallCount`, `appendBytes` — all read straight off the `gl` diagnostics object
   (`WebCodecsGlPieceDiagnostics`) that `runProductionExport` (`runRound6.ts`) already computes;
   no new computation was added anywhere on the frame path, only additional fields copied into the
   jsonl-bound report object.

Gates after these three edits, run in the worktree (`node_modules` and `src-tauri/binaries/`
symlinked from the main checkout, `.work-phase4/replay` symlinked likewise — none of these are
tracked by git; see Part 0): `npx tsc --noEmit` clean, `npm run lint` clean (same command),
`npm test` → **3193 passed / 77 skipped / 0 failed** (227 files, 165 passed/62 skipped) — identical
to the task's stated baseline; no new test files were added this round, so the count matches
exactly rather than growing by N. `git diff --name-only main -- src-tauri/` is empty (no Rust
files touched) — Cargo gates skipped on that basis, as instructed.

## Part 3 — Reproducing deliberately

### Method

The original 3 runs were driven by the (pre-existing) `ws3-round6-mac-run.sh`/autorun harness:
writing `public/_spike/ws3-autorun.json` (`{run:true, phase:"part-c-500", label:...}`, read once at
page load by `maybeAutorunPartC.ts:11-26`, gated by a `sessionStorage` lock keyed on
`phase+label` so a fresh `label` always re-triggers) and launching `npm run tauri:dev`, which
opens a real native window and runs the export autonomously — no manual interaction needed once
the config file is in place before the process starts. This round reused that harness unmodified
for the baseline reproduction runs (run4/run5/run6 below use the **original, uninstrumented**
main-checkout code, not the worktree — the instrumentation lives only in `tmp/ws3-silent-gaps`)
and separately verified the instrumentation's mechanics by source inspection + the unit-test gate
above (see "Instrumentation not yet exercised on a live run" caveat at the end of this section).

Every run's completion is read back from `public/_spike/ws3-result.jsonl`
(`persistLivenessReport`'s vite-dev POST sink), the same file mined in Part 1 — confirmed
append-only across process restarts, so run boundaries are found the same way (bracketing
`part-c-autorun-start`/`part-c-500-done` pairs by each run's distinct `label`).

**A methodological finding surfaced immediately and changed the plan**: `npm run tauri:dev`
launched via `nohup ... &` from a shell opens the native window **without focusing it** — nothing
in the original 3-run methodology description states whether the window was focused/visible
during those runs either, so this is a real, previously-uncontrolled variable, not an assumption
this round introduces. Given how decisive it turned out to be (below), window focus state is
treated as its own explicit factor, on top of cold/warm cache state.

### Runs 4-6

| Run | Launch state | Window state | resultOk | frames | wallSec | cursorsCreated | intervals >5s | longest gap |
|---|---|---|---|---|---|---|---|---|
| 4 (`run4-cold-a`) | fresh process, first launch this session | never focused (background the whole run) | true | 6000/6000 | 264.304 | 500 | 10 | 10.027s |
| 5 (`run5-warm-immediate`) | fresh process, immediately after run4 | background for ~480s, then manually focused (`osascript`) at t≈480s | **false** | 4519/6000 | 705.121 | 377 | 11 (10 short + 1 terminal) | **223.591s**, ends in a thrown GL error |
| 6 (`run6-foreground-idle`) | fresh process, ~2 min after run5, machine otherwise idle | focused within ~1s of launch, kept frontmost throughout via a repeating `osascript ... set frontmost` | true | 6000/6000 | 445.869 | 500 | **0** | 1.272s |

Full detail, run 5 (the significant one — `public/_spike/ws3-result.jsonl`, `part-c-500-done` for
label `run5-warm-immediate`): `failureVia: "thrown"`, not `"watchdog"` or `"stall"`. The exception:
```
createContentTexture@.../src/services/gl/glCompositor.ts:103:31
createRenderTarget@.../src/services/gl/glCompositor.ts:112:38
ensureRenderTargets@.../src/services/gl/glCompositor.ts:300:32
renderSingleSlot@.../src/services/gl/glCompositor.ts:446:27
renderFrame@.../src/services/gl/glCompositor.ts:427:25
runFrameLoopTick@.../src/services/webcodecsExport/exportWorker.ts:494:25
```
i.e. a WebGL texture/render-target creation call itself threw, from inside the ordinary
per-frame render path — consistent with the underlying `WebGLRenderingContext` having been
invalidated (context loss, or a reclaimed/discarded backing store) while the window was not
visible, discovered only once real work resumed. `cursorsCreated: 377` (vs. 500 for a completed
run) independently corroborates that the failure happened partway through, around segment ~377,
consistent with `frameIndexAtStart: 4512` on the terminal gap.

**Neither `WATCHDOG_MS` (30s) nor `FORWARD_PROGRESS_BOUND_MS` (45s) fired during that 223.591s
gap** — both are frozen this round per the task's constraints, and both are confirmed present and
unmodified in this run (same `exportPipelineWebCodecs.ts` as runs 1-3). The proximate reason ties
directly to the window-occlusion finding: both timers are `setTimeout`s living on the export's
**main-thread** JS context (`exportPipelineWebCodecs.ts`'s `watchdogTimer`/`progressBoundTimer`),
and WebKit is documented to throttle/coalesce timers for an occluded (fully hidden/not-visible)
window's page — if that throttling suppressed the watchdog's own recurring check for the same
window that was actually still crawling forward on its true work, the mechanism meant to catch
"no progress for N seconds" cannot fire, because its own clock is starved by the identical cause.
This is circumstantial (the precise WebKit throttling behavior for an Occluded-but-not-minimized
Tauri/WKWebView window was not independently verified against WebKit source or documentation this
round — flagged NOT DETERMINED below), but it is the only candidate consistent with all three
observations at once: (a) the worker kept producing frames throughout, however slowly (no hard
freeze at the JS level — 4519 frames did get encoded before the crash), (b) the 223.591s gap is
~5-7x longer than any gap in the un-focused-the-whole-time run 4, and (c) bringing the window to
the foreground (`osascript`, ~t=480s into the gap) is what immediately preceded the resumption
that produced the throw, rather than the gap continuing indefinitely or self-recovering the way
every gap in runs 1/4 did.

Run 6 (window kept frontmost throughout, machine otherwise idle) produced a **qualitatively
different profile from every other run this session**: zero gaps over 5s (`longestSilent: 1.272s`)
— matching runs 2/3's *gap-free shape* — but `wallSec: 445.869`, over 3x slower than runs 2/3's
~135s and even slower than run1's 266.93s. This is strong evidence for **two distinct, separable
phenomena** bundled under "the intermittent stall": (1) discrete multi-second-to-multi-minute
gaps (runs 1, 4, 5) that come and go and are the ones the task's `silentIntervalsOver5s` machinery
was built to catch, and (2) a uniform throughput tax with no discrete gaps at all (run 6), visible
only in total `wallSec`. Both were present to some degree in every run attempted this session; the
original clean runs 2/3 (135.27s/136.53s, zero gaps) are the ONLY data points this round or
originally that show neither. A plausible mechanism for (2) specifically: a foregrounded,
uncovered window's WKWebView page is actually composited to the physical display on every paint,
in addition to the offscreen WebGL2 export compositing this pipeline drives — doubling GPU work
relative to an occluded window (which the OS can skip presenting) — but this is inference, not
measured (no GPU-side compositor counter was captured); recorded as a hypothesis, not a finding.

**Confound acknowledged directly**: runs 4-6 were all executed within the same ~40-minute window
of this diagnosis session, during which this session had already run three full `npm test` suites
(each 175-235s of multi-process vitest CPU load) and one prior full Part C export (run4) on the
same machine — i.e. every reproduction attempt this round ran under "the earlier session's known
load" (heavy), never against a machine that had been genuinely idle for more than ~2 minutes
beforehand. Run 6's 445.869s despite zero gaps is most simply explained by this cumulative load,
not exclusively by window-foreground state — see run 7 below, which isolates the idle-machine
condition specifically.

### Run 7, and a confirmed external competitor

Correction to the above: run 7 was launched specifically to isolate "genuinely idle machine" —
but checking process state immediately before launch (`ps aux`) found an **unrelated, externally
launched** `vitest run` process already consuming a full core (94-99% CPU), rooted at
`4.kinetix-pro-studio-ws3-120fps-preview` — a **different worktree of this same repo**, invoked
from a shell whose environment carries `__CURSOR_SANDBOX_ENV_RESTORE`, i.e. **a separate AI coding
session (Cursor) running its own `npm test` on this shared machine, independent of and unprompted
by this diagnosis round.** This directly and concretely confirms the "another process competing"
hypothesis's precondition (Part 4's own reminder: "this bit us before") — not as a maybe, but as
an observed fact, twice (a second, later invocation of the same competitor was still running when
run 7 finished). Given a genuinely idle machine could not be arranged (this session does not own
the machine exclusively), run 7 is honestly labelled `run7-foreground-competing-vitest`.

| Run | Launch state | Window state | External competitor confirmed? | resultOk | wallSec | intervals >5s |
|---|---|---|---|---|---|---|
| 7 (`run7-foreground-competing-vitest`) | fresh process, ~2 min after run6 | focused within ~1s, kept frontmost throughout | **yes** (`vitest run`, another session, confirmed via `ps aux` before and after) | true | 427.906 | 0 |

Run 7 reproduces run 6's exact shape: zero gaps >5s (`longestSilent: 1.354s`), `wallSec` in the
same 400-450s band (427.906 vs 445.869). Two independent trials, both foregrounded, both under
confirmed external CPU competition, land within 4% of each other and neither shows a single
discrete gap — this is a **reproducible, not incidental, result**: foregrounded + externally
loaded machine → uniformly slow, gap-free. `run4`/`run5` (backgrounded, and machine load not
independently verified at launch time — the competing `vitest` process's own start timestamp,
11:35PM, postdates both run4 (`04:36-09:00`) and run5 (`20:53-32:38`), so it specifically was
**not** present for either) → gappy, and in run 5's case eventually a hard failure. This is the
cleanest split this round produced: **window-foreground state, not the external competitor,
tracks with which failure shape appears** (gaps-and-possible-crash vs. uniform-slowdown-only);
the external competitor most plausibly explains *why even the gap-free foregrounded runs are still
3x slower than the original clean baseline*, not the gaps themselves.

### Run 8 — instrumentation validation attempt (inconclusive)

An attempt was made to run the **instrumented** worktree build itself (rather than the
unmodified main checkout) to obtain a live look at the widened `PHASE_LOG_CAP` closing the
attribution hole, and to populate the new `demuxCacheSize`/`workerHeapBytes`/`decodersCreated`/
`appendCallCount`/`appendBytes` fields added in Part 2c. Setup: symlinked `public/_spike` (holding
the fixture assets and the jsonl sink) from the main checkout into the worktree (same rationale as
`node_modules`/`src-tauri/binaries` in Part 0), pointed `CARGO_TARGET_DIR` at the shared main
checkout's `src-tauri/target`, and launched `npm run tauri:dev` from the worktree. Cargo rebuilt
the `app` binary from the worktree's own source path (~64s — expected, since Cargo's build cache
partly keys on absolute source paths even with byte-identical Rust source and no `src-tauri/`
diff was introduced by this round) and the window opened successfully.

The sibling `maybeAutorunRound6.ts` autorun IIFE demonstrably ran (its own "unrecognized phase"
`console.warn` appeared in the terminal, confirming `isTauri()` was true, the same-origin fetch of
`/_spike/ws3-autorun.json` succeeded, and the dev server correctly served the current file content
— independently verified with a direct `curl http://localhost:3000/_spike/ws3-autorun.json`). But
the sibling `maybeAutorunPartC.ts` IIFE — structurally identical, reading the same file, gated by
the same `isTauri()` check — never visibly executed: no `part-c-autorun-start` (or any `part-c-*`,
or a `part-c-autorun-error`) event reached the jsonl sink in over 340s, and `ps aux` samples during
that window showed the run's `WebKit.GPU`/`WebKit.WebContent` processes at a flat 0.0% CPU
throughout — i.e. not merely slow, genuinely never started any work. `persistLivenessReport`'s
`console.info` calls (unlike `console.warn`) are not forwarded to the `tauri dev` terminal by
default, so the absence of a *log line* does not by itself prove the absence of the *run* — but
the jsonl sink and the 0% CPU reading together do. The vite dev sink's write path
(`viteMiddleware.ts:9`, `path.resolve(process.cwd(), 'public/_spike/ws3-result.jsonl')`) was
verified by inspection to resolve correctly through the `public/_spike` symlink.

**This is recorded as NOT DETERMINED, not swept aside**: the specific reason
`maybeAutorunPartC.ts`'s IIFE didn't run in this rebuilt binary, while its file-adjacent sibling
did, was not isolated within this round's time budget (candidates not yet checked: a
`sessionStorage` interaction specific to a freshly-rebuilt-but-same-bundle-id WKWebView data
store; an async ordering difference between the two IIFEs' `import()` resolution on a cold Vite
dependency-optimizer pass — the terminal log's "Re-optimizing dependencies because vite config has
changed" line appeared only for this launch, not runs 4-7). **Consequence for this report**: the
`PHASE_LOG_CAP` widening and the new report fields are verified by source-reading (Part 2c) and by
the existing unit-test gate (`exportWorkerDiagnostics.test.ts`'s destructive-probe test, which
parametrizes on `PHASE_LOG_CAP` itself and passed at 3193/3193), but **not by a live Part C run
this round** — recommended as the immediate follow-up before relying on the widened cap in a real
diagnostic session (see Part 5c).

### 3c. Resident resources, heap, and thermal state

A background sampler (`ps -o pid=,pcpu=,rss=,vsz=`, plus `pmset -g therm`, every 3s) ran during
the first ~320s of run 5 (its sampler's own fixed window ended before run 5's catastrophic 223.6s
tail — that specific window is **NOT DETERMINED** for resource state, the sampler's biggest gap).
Over the sampled window (105 samples/process, covering roughly frames 150-3300 of run 5, i.e. the
first several of its discrete gaps):

| Process | Role | max RSS | avg CPU | max CPU |
|---|---|---|---|---|
| `target/debug/app` (38233) | Tauri/Rust shell | 137.1 MB | 1.8% | 15.7% |
| `com.apple.WebKit.GPU` (38266) | GPU/compositor/VideoToolbox | 248.1 MB | 33.6% | 70.7% |
| `com.apple.WebKit.Networking` (38267) | networking XPC | 120.2 MB | 0.1% | 2.5% |
| `com.apple.WebKit.WebContent` (38268) | JS engine, worker, DOM | 352.9 MB (peak) | 12.5% | 29.2% |

`WebContent`'s RSS grew from 343.2 MB to 361.3 MB across the sampled ~320s — **18.1 MB total,
roughly linear, not exponential or a step function** — modest growth, inconsistent with a runaway
per-frame leak given ~2400 frames and ~200 segments' worth of decode-cursor churn happened in that
same window. `pmset -g therm`'s `CPU_Speed_Limit` read **100 (no throttling) on all 105 samples**
— thermal/power throttling is **ruled out** for this specific sampled window (first ~320s of run
5), though not for the unsampled 223.6s tail (**NOT DETERMINED** there).

Neither GPU (max 70.7%) nor WebContent (max 29.2%) CPU saturates a full core during the sampled
gaps — both stay well under 100%. This is evidence *against* a simple "CPU is just fully busy and
therefore slow" explanation for the discrete-gap pattern (that would show sustained near-100% CPU
on the process doing the work) and *for* something that blocks/waits rather than computes —
consistent with the window-occlusion/GPU-resource-reclamation mechanism proposed above, and with a
resource-contention (queue backpressure, lock wait) explanation more than a pure compute-bound one.

**`decodersCreated`, `demuxCacheSize`, `appendCallCount`, `appendBytes` were not captured live**
this round for any run — the existing (uninstrumented) `part-c-500-done` payload never included
them (Part 2c added them to the dev harness's report type, but the live validation run that would
have exercised that code path did not complete — see run 8 above). `cursorsCreated` is the closest
available proxy (500 for every completed run, 377 for the failed run 5) and, per
`exportWorker.ts:487`, is 1:1 with `decodersCreated` by construction (`resolveSlotSource` opens
exactly one cursor and one decoder together, `exportWorker.ts:487-491`) — so **decodersCreated is
inferred, not measured, at ~500 for a completed run / ~377 for run 5's partial one.**
`workerHeapBytes` is confirmed **structurally unavailable on this platform**: it reads
`performance.memory.usedJSHeapSize` (`exportWorker.ts:174`), a non-standard Chromium/V8 API that
WebKit (the engine behind Tauri's WKWebView on macOS) does not implement — every run, instrumented
or not, will report `null` here regardless of how long it runs. A future round wanting real
worker-heap numbers on this platform needs a different source entirely (e.g. `vmmap`/`leaks`
against the `WebKit.WebContent` PID, or Instruments) — out of scope for dev-only, output-neutral
instrumentation inside the JS bundle itself.

**Demuxer count and retained bytes are bounded by construction, not measured**: `getOrCreateDemux`
(`../videoDemuxer.ts:166-178`) keys its cache by asset URL in a plain `Map`, and the fixture uses
exactly 4 unique video assets (`part-c-500-predicted`'s `uniqueVideoAssets: 4`) — so
`demuxCacheSize` cannot exceed 4 for this fixture regardless of how many of the 500 segments are
processed, and the cache is **per-Worker-instance** (module-level state inside a freshly created
`Worker`, `exportPipelineWebCodecs.ts:611-613`), so it starts empty at the beginning of every
single export run — it is not a candidate for the run-to-run cold/warm difference (a fresh demux
cache is paid for identically by every run, clean or slow) or for unbounded growth within one run.
This narrows, but does not by itself explain, this session's `CLAUDE.md`-flagged standing note
that `sequentialDecode.ts:267-270` never releases demuxers — true, and worth fixing for a
long-lived multi-export session (many distinct assets across many exports would accumulate), but
not implicated in this single-run regression given the 4-asset ceiling.

Frame-loop timing distribution (Part 4h's question, answered here since the data comes from this
section's runs): per-150-frame-chunk deltas for the two foregrounded/gapless runs are tight and
unimodal — run 6: median 10.78s, p90 11.98s, min 8.90s, max 12.75s (n=39 chunks); run 7: median
10.70s, p90 11.46s, min 7.66s, max 11.74s (n=39). Both cluster at **≈3.3x** the clean run 2/3
baseline (~3.2-3.3s/150-frame-chunk, Part 1c's table) with essentially no spread — a genuinely
uniform per-frame slowdown, not a few outliers dragging an average. Run 1/4/5's chunk deltas
(Part 1c's table; run 4/5 not re-tabulated but visually the same shape from the raw polling
transcript) are the opposite: heavy-tailed and bimodal, from 300ms bursts to 21+ second stalls
within the same run. **These are two distinct statistical signatures, not one phenomenon at two
severities** — reinforcing the two-distinct-phenomena conclusion drawn from run 6 above.

## Part 4 — Hypothesis ranking

- **Cold page cache / first-read disk I/O on the 4 assets — RULED OUT as the primary or sole
  cause.** The per-Worker demux cache (`../videoDemuxer.ts:53`) is empty at the start of *every*
  run regardless of OS-level file-cache warmth (a fresh `Worker` per `driveGlRun` call,
  `exportPipelineWebCodecs.ts:611-613`, never persists this cache across runs) — so "cold vs warm"
  in the OS-cache sense cannot distinguish run 1 from runs 2/3 the way the original write-up
  framed it. Direct counter-evidence from this round: run 5 (immediately after run 4, so if
  anything *warmer* than run 4 at the OS-file-cache level) was far worse than run 4, not better —
  the reverse of what a cache-warmth story predicts. `sudo purge` (the literal instruction) could
  not be run — this machine requires an interactive password and none was available
  non-interactively (`sudo -n purge` → "a password is required") — so a true OS-page-cache-cleared
  trial was not obtained; **NOT DETERMINED** whether a genuinely purged cache changes anything, but
  the mechanism this round *can* rule out (the app-level demux cache) has been ruled out, and nothing
  else observed correlates with cache state.
- **Resident demuxer accumulation and memory pressure leading to swap — RULED OUT for this
  fixture.** `demuxCacheSize` is bounded at ≤4 for the whole run by construction (4 unique video
  assets, Part 3c) and `WebContent` RSS grew only ~18 MB over ~320s of sampled run 5 (modest,
  linear, Part 3c) — not the signature of runaway accumulation. The real, separately-flagged
  `sequentialDecode.ts:267-270` "demuxers are never released" note is confirmed true by reading the
  code (Part 3c) but is a multi-export-session concern, structurally incapable of causing a
  single-run regression on a 4-asset fixture.
- **GC pauses in the worker (correlate gap timing with heap growth) — NOT DETERMINED.**
  `workerHeapBytes` (`exportWorker.ts:173-176`) reads the non-standard
  `performance.memory.usedJSHeapSize`, which WebKit (Tauri's engine on macOS) does not implement —
  every run this round and presumably the original 3 report `null` here regardless of instrumentation.
  RSS is a weak proxy (includes GPU-mapped buffers, native decoder state, everything) and showed no
  spikes correlated with gap timing in the one window sampled, which is *some* evidence against a
  large GC-pause-triggering allocation spike, but real V8/JSC GC pause data was never available to
  directly test this hypothesis. Would need `vmmap`/Instruments against the `WebKit.WebContent`
  PID, out of scope for this round's dev-only JS instrumentation.
- **VideoToolbox / hardware encoder contention or thermal throttling on macOS — PARTIALLY RULED
  OUT (thermal), NOT DETERMINED (contention).** `pmset -g therm`'s `CPU_Speed_Limit` read 100 (no
  throttling) on all 105 samples spanning run 5's first ~320s (Part 3c) — thermal/power throttling
  is ruled out for that specific window. The unsampled 223.6s catastrophic tail of run 5 was not
  covered by the sampler (a real gap in this round's evidence, NOT DETERMINED for that window
  specifically). Hardware decode/encode *session contention* (as opposed to thermal throttling) —
  500 segments each opening a brand-new `VideoDecoder` even when reusing an already-demuxed asset
  (`exportWorker.ts:487`, keyed by segment id not asset id) plausibly creates more
  session-open/close churn than a hardware decode pipeline is tuned for — was not directly
  measured (no VideoToolbox session counter available from JS) and stays NOT DETERMINED, though it
  remains a live, code-supported candidate specifically for the *discrete-gap* runs given the
  create-heavy pattern.
- **Encoder queue backpressure: `waitForDequeue` stalling with no chunk emitted — NOT DETERMINED,
  disfavored for the one crash this round captured.** The single concrete failure captured live
  (run 5) threw inside GL compositing (`glCompositor.ts:103`, `createContentTexture` →
  `renderFrame` → `runFrameLoopTick`), not inside any encoder-dequeue wait path — for that
  specific 223.6s gap, the stall is on the render/compositing side, not the encode side. Whether
  encoder backpressure contributes to any of the *shorter*, still phase-null-attributed gaps in
  runs 1/4/5 could not be checked (attribution hole, Part 2; not fixed live this round, Part 3's
  run 8).
- **Main-thread `appendFileRaw` drain blocking the message channel — RULED OUT as the explanation
  for the discrete-gap pattern specifically.** `appendFileRaw` work is identical in volume and
  timing regardless of whether the Tauri window is focused — nothing about window visibility
  changes how many chunks get written or how large they are. But window-foreground state is
  exactly what tracked with whether discrete gaps appeared at all this round (runs 4/5, backgrounded,
  gappy/crashed; runs 6/7, foregrounded, zero gaps) — if main-thread append-blocking were the
  primary driver of the *gaps*, foregrounding the window should not have changed anything, yet it
  did, cleanly, twice. (`appendCallCount`/`appendBytes` were not captured live this round — Part
  2c added the fields, Part 3's run 8 did not complete — so a *general* contribution to the uniform
  slowdown component cannot be excluded; only its role as the *discrete-gap* cause is ruled out.)
- **Another process competing (including a leftover tauri/vite/app process from a prior run) —
  CONFIRMED present, but for the uniform-slowdown pattern, not the discrete-gap/crash pattern.**
  This round found and killed genuinely leftover `WebKit` XPC child processes from a just-killed
  run before launching the next one (Part 3, between run 5 and run 6) — the exact "this bit us
  before" scenario, confirmed real and now handled by explicit process-tree verification before
  each launch. Separately and more significantly, an **unrelated external session** (`vitest run`
  in a different worktree, `4.kinetix-pro-studio-ws3-120fps-preview`, a Cursor session per its
  shell environment) was confirmed running at 94-99% CPU during both run 6 and run 7 and confirmed
  absent (by process start-timestamp) during run 4 and run 5. The correlation runs opposite to a
  naive "competing process explains the gaps" story: the runs *with* a confirmed competitor
  (6, 7) had zero gaps; the runs *without* one (4, 5) had the gaps and the crash. Verdict:
  CONFIRMED as a real, present contributor to the uniform ~3.3x slowdown seen in every run this
  round (none of which matched the original clean 135s baseline) — but RULED OUT as the explanation
  for the discrete gaps themselves, which track with window-focus state instead.
- **The frame loop itself simply running slower (uniform, not gaps) — CONFIRMED as a distinct,
  separate phenomenon from the gaps, with a clean quantitative signature.** Runs 6/7
  (foregrounded, competitor present): per-150-frame-chunk deltas tight and unimodal, median
  10.7-10.8s, p90 11.5-12.0s, ≈3.3x the clean baseline's ~3.2-3.3s, essentially no spread (values
  above). Runs 1/4/5: the opposite — heavy-tailed, bimodal (300ms-21s+ deltas within the same
  run). Two distinct statistical signatures, not the same thing at two severities.

**Most probable cause, by evidence chain**: the intermittent stall the task named ("Part C 500
silent gaps") is **not one mechanism** — it is at least two, distinguishable this round for the
first time by whether the exporting window is the frontmost/visible window:

1. **A window-visibility-dependent GPU/GL-resource degradation** (new finding this round, not on
   the task's original hypothesis list) produces the *discrete, multi-second-to-multi-minute*
   gaps: reproduced twice (run 4: 10 gaps up to 10.0s, completed; run 5: 11 gaps, the last one
   223.6s, ending in a real `WebGLRenderingContext`-adjacent thrown error) whenever the window was
   not the frontmost/visible one, and reproduced **zero times** (0 gaps in run 6, 0 in run 7) when
   the window was kept frontmost throughout. Evidence chain: (a) run 1's own 15 gaps are
   concentrated in the back three-quarters of a 500-segment run with growing density, not the
   fixed ~4-events shape a cold-asset-read theory predicts (Part 1c); (b) this round's run 5
   reproduced an extreme version — 223.6s frozen, then a GL texture-creation exception the instant
   after the window regained focus (Part 3); (c) both foregrounded repeats (runs 6, 7) were
   completely gap-free despite otherwise-comparable-or-worse system load (Part 3); (d) neither
   `WATCHDOG_MS` nor `FORWARD_PROGRESS_BOUND_MS` fired during the 223.6s freeze, consistent with
   those same main-thread timers being subject to whatever throttles an occluded window's
   scheduling (Part 3). This chain is strong but not fully closed — the precise WebKit/macOS
   mechanism (window occlusion → GPU resource reclamation → texture creation failure) was
   reasoned from symptoms, not confirmed against WebKit source or Apple documentation, and is
   recorded as the leading hypothesis rather than a certainty.
2. **A separate, load-dependent uniform throughput tax** (present in every single run attempted
   this round, including the two gap-free ones) that tracks with overall machine load — this
   round's own three `npm test` runs, one prior Part C export, and a confirmed external `vitest`
   process are the concretely observed contributors, none of which were present during the
   original clean runs 2/3. This explains why not even the cleanest reproduction this round
   (run 6/7, zero gaps) matched the original 135s baseline.

Neither mechanism was isolated in the original 3-run write-up because it treated "silent gaps" as
one phenomenon and never varied window focus or checked for external competitors — this round's
main contribution is separating them.

## Part 5 — Verdict and recommendation

### 5a. Risk classification

**Both a throughput risk and a latent hang/crash risk — not merely cosmetic.** The original 3-run
evidence alone (all `resultOk: true`, all exact frame counts, neither watchdog ever firing)
supported "throughput regression only." This round's run 5 changes that: a real export, run
through the identical unmodified production export path, **failed** (`resultOk: false`,
`framesEncoded: 4519/6000`) after a 223.591s stall that a thrown `WebGLRenderingContext`-adjacent
exception terminated — not a watchdog-initiated abort, an uncaught failure in the ordinary render
path. That is a genuine correctness/reliability risk for any export whose host window loses
foreground/visibility for an extended stretch (locking the screen, switching to another full-screen
app, a laptop lid-adjacent display sleep, or simply alt-tabbing away and forgetting about it for a
long export) — a realistic scenario for a 15-20 minute captioned slideshow export, the exact
workload class named in the task's own priority question (5d).

### 5b. Can it reach `FORWARD_PROGRESS_BOUND_MS` (45s) and kill a real export?

**Yes — and this round observed it happen, at 223.591s, roughly 5x the 45s bound, without the
bound doing anything to stop it**, because (per Part 4) the mechanism most consistent with the
evidence starves the very main-thread timer that implements the bound. The arithmetic the task
asked for, from the *original* evidence alone (10.74s maximum observed there): a discrete gap
would need to grow **~4.2x** (10.74s → 45s) to reach the bound under the "many short gaps" model —
plausible with a longer timeline, more segments, or slower disk, as the task suggests. But this
round shows a **more direct and already-observed path that requires no scaling at all**: put the
exporting window out of focus (locked screen, covered by another window, backgrounded to check
something else) for long enough, and the gap does not need to scale with timeline length, asset
count, or disk speed — it scales with **how long the window stays out of focus**, a variable the
export's own timeline duration does not bound. A 20-minute captioned slideshow export left running
in the background while the user works in another app for several minutes is a materially *more*
likely real-world trigger than "a slower disk," and this round found no code path that prevents or
limits it. **This raises the finding from "if things get generally slower, headroom to 45s could
theoretically erode" to "a common, everyday desktop-usage pattern (backgrounding the app during a
multi-minute export) can already cross the bound today,"** conditioned on the window-occlusion
mechanism (Part 4's leading hypothesis) being correct — which was reasoned from strong but not
airtight evidence (5a's caveat applies here too).

### 5c. Recommended fix and smallest next commit

**Permanent fix, once 5a/5b's mechanism is confirmed** (see "what's still missing" below): the
export should not depend on the host window's foreground/visibility state for either liveness
(the watchdog) or correctness (the GL render path). Two independent angles, likely both needed:
  - Make `WATCHDOG_MS`/`FORWARD_PROGRESS_BOUND_MS` immune to main-thread timer throttling — e.g.
    checking elapsed wall-clock time (`Date.now()`/`performance.now()` deltas) from a source that
    keeps running even when the window is occluded (a dedicated dormant Worker whose own timer is
    less likely to be throttled the same way a document-context timer is, or requesting a
    wake-lock / explicitly opting the export window out of App Nap-style suspension for the
    duration of an export), so the *liveness* mechanism can fire even if the *render* mechanism is
    starved.
  - Either prevent GL/decoder resource reclamation for an occluded export window (if Tauri/WebKit
    exposes a way to mark the window as needing to stay fully resourced), or make the render path
    resilient to context loss (detect `webglcontextlost`, restore, and resume mid-export) instead
    of letting a bare `createContentTexture` throw crash the whole run.

**Smallest next commit** (before either permanent fix): confirm the window-occlusion mechanism
directly and cheaply, since everything above is conditioned on it. A single scripted repro —
launch the Part C fixture, background the window for a fixed, controlled interval (e.g. exactly
60s, well past `FORWARD_PROGRESS_BOUND_MS`), then refocus and observe whether the run reliably
(a) shows a gap approximately matching the backgrounded interval and (b) never throws when the
interval is short enough not to trigger GL resource reclamation — would convert this round's
circumstantial, symptom-based inference into a controlled, repeatable finding, at a fraction of the
cost of either permanent fix above. This is a test/measurement commit, not a behavior change, and
fits entirely within "analysis only."

**If the cause is to be treated as NOT DETERMINED instead** (i.e. rejecting the window-occlusion
inference as too indirect): the missing artifact is exactly that scripted, controlled
background/refocus repro described above, run several times, with the resource sampler (Part 3c)
covering the *entire* run this time (this round's sampler window ended before run 5's actual
crash — a self-inflicted gap in coverage, not a fundamental limitation) so CPU/thermal/RSS state
during the freeze itself is available rather than inferred from the ~320s that preceded it.

### 5d. Priority call

Relative to the other open export items named in the task (unbounded ffmpeg/concat/mux paths,
macOS encoder byte non-reproducibility) for a 20-minute captioned-slideshow workload: **this round
raises this item's priority, it does not lower it.** It entered this round as "an intermittent,
always-self-recovering throughput regression, 1-of-3 reproduction rate, cosmetic-leaning" per the
task's own framing. It leaves this round as "a mechanism that has now been observed, live, to fail
a real export outright, via an everyday desktop interaction (backgrounding the window) that a
20-minute export left running is likely to encounter, with both governing watchdogs confirmed
unable to catch it." Encoder byte non-reproducibility is a determinism/testing concern, not a
user-facing failure — this item, as now understood, is. The unbounded ffmpeg/concat/mux paths are
a comparable class of risk (an unbounded resource growing until something breaks) but this round
produced a *live, reproduced* crash for the silent-gaps item and did not for that one; **recommend
this item ranks above encoder-byte-reproducibility and at least even with the unbounded-concat
item** for a captioned-slideshow-length workload, pending the smallest-next-commit repro in 5c to
either confirm or downgrade it.

## Gates

- `npx tsc --noEmit` → clean (worktree, after the Part 2c edits).
- `npm run lint` → clean (same command as `tsc` on this project).
- `npm test` → **3193 passed / 77 skipped / 0 failed** (227 test files: 165 passed, 62 skipped) —
  identical to the task's stated baseline; no new test files were added this round (the
  instrumentation reuses/extends existing types and an existing destructive-probe test that
  already parametrizes on `PHASE_LOG_CAP`), so the count matches exactly rather than growing.
- `git diff --name-only main -- src-tauri/` → empty (verified in the worktree; no Rust files were
  touched this round). Cargo gates skipped on this basis, as instructed.

## Summary of what remains NOT DETERMINED

- Whether a genuinely OS-page-cache-purged run behaves differently — `sudo purge` requires an
  interactive password not available this round (Part 4).
- Resource/thermal state during run 5's actual 223.6s catastrophic gap — the sampler's fixed
  window ended before it (Part 3c).
- The precise WebKit/macOS mechanism behind the window-occlusion finding (which specific
  API/behavior throttles the main-thread timers and/or reclaims GL resources) — reasoned from
  symptoms, not confirmed against WebKit source, Apple documentation, or a dedicated occlusion
  test (Part 4, 5c).
- Why `maybeAutorunPartC.ts`'s autorun IIFE did not visibly execute in the one attempt to run the
  instrumented worktree build live (run 8) — the widened `PHASE_LOG_CAP` and new report fields are
  verified by source-reading and the existing unit-test gate only, not by a live run this round
  (Part 3, run 8).
- Hardware decode/encoder session contention (as distinct from thermal throttling, which was ruled
  out for the one sampled window) as a contributor to the discrete gaps (Part 4).
- Whether GC pauses correlate with gap timing — `workerHeapBytes` is structurally unavailable on
  WebKit (`performance.memory` is a non-standard Chromium API), and no alternative heap source
  (Instruments/`vmmap`) was captured this round (Part 3c, Part 4).
- `decodersCreated`, `demuxCacheSize`, `appendCallCount`, `appendBytes` for any run this round —
  `cursorsCreated` (500 completed / 377 for run 5) is used as a 1:1 proxy for `decodersCreated` by
  construction, but none of the four were captured directly from a live run (Part 3c).

