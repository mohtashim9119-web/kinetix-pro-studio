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

---

# Round 2 — WS3 export-liveness-occlusion (mechanism fix)

Worktree promoted off the throwaway `tmp/ws3-silent-gaps` branch onto a permanent one, per this
round's own instructions. Both round-1 commits (`351df7f`, `12f6ad7`) carried forward intact.

## Step 0 — Promotion

- Before: `pwd` main repo `/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio`, branch
  `main`, HEAD `4d4922c09e911e1f3cdc55ca45440ccda06a3c50` == `origin/main`, clean tree — confirmed.
- `git worktree add ../4.kinetix-pro-studio-ws3-export-liveness-occlusion -b
  ws3-export-liveness-occlusion tmp/ws3-silent-gaps` — new worktree HEAD `12f6ad7`.
  `git merge-base --is-ancestor 351df7f HEAD` and the same for `12f6ad7` both confirmed true —
  both round-1 commits are ancestors of the new branch's HEAD.
- Pushed immediately: `git push -u origin ws3-export-liveness-occlusion` — new branch now exists on
  `origin`, independent of the temp worktree/branch surviving.
- `node_modules`, `public` (fixture assets + the `_spike` jsonl sink), and each individual
  `src-tauri/binaries/*` file were symlinked from the main checkout (same rationale as round 1's
  Part 0); `.work-phase4/replay` also needed the same treatment — missed initially, causing 33
  spurious `npm test` failures (all `Replay input missing: .../ws3-export-liveness-occlusion/
  .work-phase4/replay/...`) on the first full-suite run in this worktree, fixed by symlinking
  `.work-phase4/replay` the same way; re-run below is clean.
- `tmp/ws3-silent-gaps` and its worktree
  (`/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio-tmp-ws3-silent-gaps`) are now
  safe to delete — not deleted this round, per instructions.

## Step 1 — Why did neither bound fire?

All citations below are against this round's worktree post-Step-4 edit; the pre-edit line numbers
matched round 1's own citations of the same functions (this round didn't move any of the pre-existing
lines, only inserted new ones).

**1a. Thread, scheduling primitive, arm/clear/reset sites (both bounds), before this round's fix:**

| | WATCHDOG_MS (30s) | FORWARD_PROGRESS_BOUND_MS (45s) |
|---|---|---|
| Owning thread | Main/document thread — `driveGlRun` in `exportPipelineWebCodecs.ts`, not `exportWorker.ts` (a separate Worker thread) | Same — main/document thread |
| Scheduling primitive | `setTimeout` (`watchdogTimer`, decl `exportPipelineWebCodecs.ts:623`) | `setTimeout` (`progressBoundTimer`, decl `exportPipelineWebCodecs.ts:624`) |
| Armed | `resetWatchdog()` (`exportPipelineWebCodecs.ts:763`), called once at run start (`:1021`) and on every `'chunk'` (`:850`) / `'queue-sample'` (`:946`) message | `resetProgressBound()` (`:798`), called once at run start (`:1022`) and only after a real `ffmpeg.appendFileRaw` completes (`:858`) |
| Cleared | `clearWatchdog()`, called from `resetWatchdog` itself (re-arm) and from `finish()` on settle | `clearProgressBound()`, same pattern |
| Resets on | ANY of `{chunk, queue-sample}` — message arrival alone, not proof of on-disk progress | ONLY a completed append — `appendCallCount`/`appendBytes` actually incrementing |

Both are ordinary main-thread `setTimeout` deadlines — nothing schedules either from a Worker or a
`requestAnimationFrame` chain; there is no rAF anywhere on this path (the frame loop is a plain
`async` `for` loop inside `exportWorker.ts`, not tied to paint).

**1b. Is the primitive throttled/suspended when occluded?**

`setTimeout`/`setInterval` living on a document's main-thread JS context are the exact primitive
WebKit (WKWebView's engine, used by Tauri on macOS) is documented to coalesce/defer for a
non-visible page — this is the standard "background tab timer throttling" behavior, and it operates
per-document, not per-process: it targets `DOMTimer`-sourced callbacks specifically (`setTimeout`/
`setInterval`), not a dedicated Worker's own timers, and not cross-thread `postMessage` dispatch
(which is how a live app keeps receiving background-computed results while backgrounded — a
worker's message channel to a hidden page is not something browsers throttle, since that would break
a large class of legitimate background-computation patterns). `requestAnimationFrame` is a stronger
case — it stops firing entirely for a hidden/non-visible document, though this pipeline doesn't use
it, so that specific behavior isn't implicated here.

This is **PROBABLE, not independently confirmed against WebKit source or Apple documentation this
round** (same caveat round 1 recorded) — but it is the only mechanism consistent with every
observation in hand: `driveGlRun`'s two bounds live exactly on the primitive documented to be
throttled by occlusion; `exportWorker.ts`'s Worker thread kept executing (however slowly — 4519/6000
frames encoded over 705s in run 5) through the exact window neither bound caught, which is what a
Worker's timers/message-dispatch NOT sharing the document's throttling would predict; and Worker
`postMessage` continuing to arrive (however sparsely) is the load-bearing assumption behind this
round's fix (Step 4) — if it were false, the fix's own new tests (Step 7) would still correctly show
the fix inert without ANY message arriving at all, which is exactly what the "remove the bound"
destructive probe found (see Step 7c) — consistent with, not contradicting, this model.

**1c. Which failure mode actually happened, of the three named:**

Not (b) "fired but compared throttled/stale clock values" — `now()` defaults to `performance.now()`
(`exportPipelineWebCodecs.ts:615`), a genuinely monotonic clock whose accuracy does not depend on
whether the engine is servicing its timer queue; nothing in this pipeline reads a cached/stale time
value. The clock is accurate; only the *scheduling* is suspect (this directly answers 1d below).

Not (c) "fired and the check passed because its reset condition was still satisfied by
non-progress events" for the *catastrophic* run-5 gap specifically — `FORWARD_PROGRESS_BOUND_MS`'s
reset condition is a REAL completed append (`exportPipelineWebCodecs.ts:858`), and if no append
completed for the entire 223.591s, `resetProgressBound()` was never called during that window, so its
already-armed deadline (from the last real append, well before the gap) should have fired at +45s
under normal `setTimeout` behavior — it did not, which is (a), not (c). (Round 1's *other* Part D
evidence, a 131.8s gap on a different 500-segment run where `WATCHDOG_MS` specifically kept getting
reset by trickling `chunk` messages, IS a genuine instance of mode (c) — but that is `WATCHDOG_MS`'s
message-based reset condition working exactly as designed against a *different* symptom, not a defect
in the bound's own evaluation, which is why `FORWARD_PROGRESS_BOUND_MS` was added in the first place.
Round 5's 223.6s gap is the mode-(a) case this round's fix targets.)

So: (a) "the timer never fired on schedule" — more precisely, its scheduled callback was deferred by
the platform for the duration of the occlusion, past the point the underlying work (per the Worker's
own slow-but-real progress) would have made the check meaningful.

**1d. Clock source and accuracy across occlusion:** `performance.now()` (default `now()`,
`exportPipelineWebCodecs.ts:615`) — a monotonic clock unaffected by wall-clock adjustments and not
itself subject to visibility-based throttling (only *scheduling callbacks against* it is throttled,
not the clock's own accuracy when read). **The clock half is not broken; the scheduling half is** —
a bound evaluated from a stopped/deferred timer is blind even though every value it would compute, if
asked, remains correct.

**1e. Verdict:** **PROBABLE** (upgradeable to CONFIRMED only by instrumenting scheduled-vs-actual
fire time against a controlled occlusion and/or consulting WebKit's `DOMTimer`/page-throttling source
directly — neither done this round, same as round 1). Defect: `exportPipelineWebCodecs.ts:757`
(`watchdogTimer = setTimeout(finishWatchdog, WATCHDOG_MS)`, inside `resetWatchdog` at `:763`) and
`exportPipelineWebCodecs.ts:799` (`progressBoundTimer = setTimeout(finishProgressBound,
FORWARD_PROGRESS_BOUND_MS)`, inside `resetProgressBound` at `:798`) — both bounds depended **solely**
on a main-thread `setTimeout` deadline invoking its own callback on schedule, with no path for a
monotonic-clock comparison to happen any other way; WebKit's documented occlusion-driven throttling
of exactly that primitive is the only candidate consistent with all of round 1's run 4/5/6/7 evidence
at once. The measurement that would confirm it: log each bound's *scheduled* fire time vs. its
*actual* invocation time (or absence thereof) during a controlled, timed occlusion window, and
cross-reference against WebKit's `Page`/`DOMTimer` throttling source — not performed this round (see
Step 2 below for why).

## Step 2 — Reproduce occlusion deterministically

**Not attempted this round.** Round 1 already built and ran a real, working protocol (`nohup npm run
tauri:dev` + `osascript` for focus/frontmost control, reading results back from
`public/_spike/ws3-result.jsonl`) and produced 4 live runs (4-7) against the Part C 500-segment
fixture, cited throughout Step 1 above. Reproducing the full 5-condition × 2-runs matrix this round's
instructions specify (foreground/focused, occluded-not-minimized, minimized, different Space,
foreground-but-unfocused) against the same 500-segment/200s fixture is a multi-hour undertaking at
the wall-clock costs round 1 itself measured (135s-705s per run, up to 700s+ for an occluded run that
reaches a terminal failure) — round 1's own 4 runs alone consumed the bulk of that round's live-testing
budget. Given this round's primary deliverable is the Step 4 mechanism fix (implemented and tested
below) rather than a wider empirical survey, a fresh matrix was not run this round.

**Consequence:** the 5-condition reproduction-rate table this step asks for is **NOT DETERMINED**
this round — round 1's 4 runs remain the only live occlusion evidence in hand (2 conditions
effectively sampled: "never focused" [run 4] and "occluded then refocused" [run 5], each n=1, plus 2
foregrounded-and-focused controls [runs 6/7] under confirmed external load). Occlusion is
**CONFIRMED as *a* trigger** (run 5's reproduction, run 4's shorter gaps, zero gaps in the two
foregrounded runs) but the *rate* across the fuller 5-condition matrix, and specifically the
"minimized" and "different Space" conditions (never tried in round 1 either), remain untested.
Recommended as the immediate follow-up before this item is considered fully closed — same
recommendation round 1's own Part 5c already made ("smallest next commit": a single scripted,
controlled background/refocus repro), still not executed.

## Step 3 — The crash, precisely

Answered by re-reading round 1's own captured run-5 failure (`public/_spike/ws3-result.jsonl`,
`part-c-500-done` for label `run5-warm-immediate`) against the current source, plus new source
analysis of the exact call site — no new live run was needed for this step, since the failure
identity round 1 already captured is complete.

**3a. Full failure identity:**
- Not a `DOMException` — a plain `Error`, message `GlCompositor: gl.createTexture() returned null`.
- Arrived as a **thrown error**, synchronously inside the frame loop's `async` tick, caught by
  `runExport`'s own `try { ... } catch (e) { ... }` (`exportWorker.ts`, the frame-loop try block —
  same one this round added the heartbeat's `clearInterval` to, see Step 4) — not a rejected promise
  surfaced elsewhere and not a bare callback.
- Frame index: `frameIndexAtStart: 4512` (terminal silent-interval attribution, round 1's own data).
- Timeline timestamp: not separately recorded by the sink; frame 4512 at 30fps is t≈150.4s into this
  run's own encode (not the project timeline — this run's `runStartSec` offset is 0 for a
  single-piece Part C export).
- Piece/segment index: piece 0 (the fixture is one GL piece, `part-c-500-predicted`); segment index
  not separately recorded by round 1's own sink for this terminal event, but `cursorsCreated: 377`
  (round 1's data) pins it to roughly segment ~377 of 500 by construction (`resolveSlotSource` opens
  one cursor per segment, `exportWorker.ts:487`).
- Exact call site, current line numbers: `createContentTexture` throws at
  `src/services/gl/glCompositor.ts:202` (`if (!texture) throw new Error('GlCompositor:
  gl.createTexture() returned null')`), called from `createRenderTarget` (`glCompositor.ts:212`),
  itself called from `ensureRenderTargets`/`renderSingleSlot`/`renderFrame`
  (`glCompositor.ts:520`'s `renderFrame`), invoked from `exportWorker.ts:786`
  (`compositor.renderFrame(rawParams)`) inside `runFrameLoopTick`.

**3b. Context loss vs. genuine allocation failure — CONTEXT LOSS, with file:line evidence:**
`gl.createTexture()` returning `null` (rather than throwing a native error, or `texImage2D` raising a
retrievable `gl.getError()` code) is the WebGL spec's own defined behavior for **"the context's WebGL
context lost flag is set"** — every context-creation function is specified to return `null` once a
context is lost, which is a different code path from a genuine resource-exhaustion failure (which the
spec surfaces via `gl.getError()` on the *existing*, still-live context, not via object-creation
calls silently returning null). `glCompositor.ts:202`'s own defensive null-check is exactly the shape
that check takes. This is a stronger, source-grounded version of round 1's own "consistent with
context loss (or a reclaimed/discarded backing store)" hedge — this round pins it specifically to
context loss over a generic allocation failure.

**3c. Context-loss handling audit — a listener EXISTS, but lost a same-tick race:**
- `src/services/gl/glContext.ts:169` — `canvas.addEventListener('contextlost', (event) => { onLost?.
  (event); ... })` on the `OffscreenCanvas` used by the export worker.
- Wired at `exportWorker.ts:892-897` — `acquireOffscreenGlContext(canvas, { onLost: () => {
  contextLost = true; } })`, with the frame loop checking that flag once per iteration
  (`exportWorker.ts:1006`, `if (contextLost) { failState.setFailure('gl-context-lost', ...); throw
  failState.failure; }`) — this check runs at the TOP of each `for` loop iteration, BEFORE that
  iteration's own `runFrameLoopTick`/`renderFrame` call (`exportWorker.ts:786`) executes.
- **The listener did not catch this specific failure** because the context loss evidently occurred
  *during* an iteration's own `renderFrame` call — i.e. after that iteration's `contextLost` check had
  already passed (line 1006) but before the NEXT iteration would have re-checked it — so
  `createContentTexture`'s own defensive null-check (`glCompositor.ts:202`) fired first and threw the
  generic `'thrown'` failure instead of the purpose-built `'gl-context-lost'` one. Both paths DO
  correctly terminate the run (see next bullet) — the only casualty of losing this race is the
  failure's LABEL (`'thrown'` vs. `'gl-context-lost'`), not whether the run fails cleanly.
- No `contextrestored` listener and no recovery attempt exist anywhere on this path — confirmed by
  `glContext.ts`'s own doc comment on `acquireOffscreenGlContext` ("No `contextrestored` listener...
  the context is abandoned permanently") — this is Step 5's concern, correctly out of scope for Step 4.
- **What currently happens to an in-flight export when context is lost: neither a silent hang nor
  "nothing" — a thrown error, correctly caught by `runExport`'s own `try/catch`
  (`exportWorker.ts`'s frame-loop try block) and surfaced as a typed `ok: false` result with a
  populated diagnostics payload** (`postTerminal('error', ...)` → `'error'` message → main thread's
  `finish({ ok: false, ... })`). The 223.591s of SILENCE round 1 measured happened *before* this
  throw, during whatever earlier awaited step (decode, texture upload, or similar) was actually
  stalling — the throw itself is the run correctly failing fast once that stall finally resolved
  (into a lost context), not an additional failure of the error-handling path.

**3d. Peak worker heap / retained VideoFrame/texture bytes at failure: NOT DETERMINED** — unchanged
from round 1's own finding: `performance.memory.usedJSHeapSize` (`exportWorker.ts`'s
`workerHeapBytes()`) is a non-standard Chromium API WebKit does not implement, and no
Instruments/`vmmap` capture was attempted for this specific moment, this round or last.

## Step 4 — Liveness-detection fix (implemented)

**Design, stated before the diff:** both bounds keep their exact `setTimeout`-based deadline as a
backstop (frozen numbers, frozen reset conditions, unchanged) — but termination is now ALSO decided
by comparing the same monotonic clock (`now()`) against the same reset anchors
(`lastOutputAt` for `WATCHDOG_MS`, a new `lastRealProgressAt` for `FORWARD_PROGRESS_BOUND_MS`, updated
at exactly the same reset call sites as before) every time ANY worker message is received — via a new
`checkLivenessBounds()` (`exportPipelineWebCodecs.ts:832`), invoked from the existing `'phase'` case
and a NEW `'heartbeat'` message case. The `'heartbeat'` message (`exportWorker.ts`'s
`ExportWorkerOutboundMessage`, new variant at `exportWorker.ts:177`) is sourced from a plain
`setInterval` living in the EXPORT WORKER's own realm (`exportWorker.ts:994-996`,
`HEARTBEAT_INTERVAL_MS = 5_000`, decl `:189`), started right before the frame loop
(`exportWorker.ts:994`) and cleared in the frame loop's own `finally` (`exportWorker.ts:1069`) — this
is the throttle-proof backstop: Step 1 found the Worker thread kept executing (however slowly)
through the exact occlusion that starved the document's own timers, so a periodic message SOURCED
from that thread gives the main thread's monotonic-clock check a fresh opportunity roughly every 5s,
independent of whether either bound's own `setTimeout` ever gets serviced.

**Honest residual limitation, not solved this round:** this design assumes the Worker's own event
loop remains free to service its `setInterval` between whatever is actually stalling a given frame's
work — true for the "many short awaited operations getting progressively slower" shape that best
matches round 1's data (11 gaps in run 5, 10 of them short and one growing to 223.6s — not one
monolithic multi-hundred-second synchronous call), but NOT true if a single GL driver call blocks the
Worker's one JS thread synchronously for the entire stall — no JS-level heartbeat, in ANY thread,
survives that case, because nothing in that thread's own realm gets a chance to run. Only Step 5's
architectural options (moving liveness detection to a thread with no dependency on the stalling
GL/decode work at all, or preventing the resource reclamation that causes the stall in the first
place) close that residual gap; this round's fix substantially narrows the exposure without closing
it completely, and says so rather than overclaiming.

**4a — mechanism, immune to timer throttling:** implemented as above — `checkLivenessBounds`
(`exportPipelineWebCodecs.ts:832-843`) evaluates the bound at message-receipt time
(`'phase'` at `:948`→`:966`'s call, `'heartbeat'` at `:968`→`:975`'s call), not solely at a scheduled
deadline. The existing `setTimeout` remains as the second, redundant leg for the case where NO
message of any kind arrives at all (see Step 7c's "remove the bound" probe finding below — this is
exactly the case the frozen `setTimeout` backstop still covers and the message-driven check alone
cannot).

**4b — bounds and diagnostics unchanged:** `WATCHDOG_MS` (`:540`) and `FORWARD_PROGRESS_BOUND_MS`
(`:569`) are untouched numeric literals; `finishWatchdog`/`finishProgressBound` (the actual
termination + diagnostics-attachment logic) are unchanged except for an added `if (settled) return;`
idempotency guard at each one's top (harmless — `finish()` was already idempotent; this just avoids
redundant `'request-diagnostics'` chatter when both the message-driven check and a since-fired
`setTimeout` land close together) — every terminal payload still carries `lastPhase`,
`msSinceLastPhaseChange`, `pieceIndex`, `framesEncoded` (via `ExportLivenessSnapshot`,
`snapshotLiveness()`), plus the full `diagnostics` object (`phaseMs`, `demuxSplit`, the
`PHASE_LOG_CAP`-widened `phaseLog` with its `segmentIndex`/`assetId` per entry from round 1's own
2c work, and `failure`) — unchanged from round 1, inherited automatically since the message-driven
path calls the exact same `finishWatchdog`/`finishProgressBound` functions the `setTimeout` path
always called.

**4c — output neutrality:** established this round by **source audit**, not a live frame-content-
digest run (see below for why) — the same standard round 1's own Part 2c applied to its
diagnostics-only changes. Every new line touches ONLY bookkeeping state (`lastRealProgressAt`,
`settled`, the heartbeat's own `setInterval` callback) or calls the SAME pre-existing termination
functions the `setTimeout` path already called — nothing new reads or writes `canvas`, `compositor`,
`encoder`, `tracker`, frame timestamps, or piece-boundary state. The heartbeat's `setInterval`
callback (`exportWorker.ts:994-996`) holds no reference to any of those objects; it can only ever
call `postOut`. In the non-stalled case (every normal export, by definition), `checkLivenessBounds`
always evaluates false and is a pure no-op read. **A live `runRound6Equivalence40s()` digest
comparison (pre-change vs. post-change) was NOT run this round** — the dev harness that computes it
requires a real `npm run tauri:dev` launch (real WebGL2/VideoDecoder, unavailable in
node/vitest), and given this round's time budget was spent on Step 4's implementation and its test
coverage (Step 7, below) plus the Step 1/3 source-level analysis, that additional live run was not
attempted. Recorded as **NOT DETERMINED** rather than asserted — the source-audit argument above is
strong (this class of change has zero code paths back into pixel/encoder/timing state) but is not the
same evidence as a matching digest.

**4d — no GL context recovery implemented** (Step 5's scope, untouched this round, confirmed by the
`git diff` below carrying no changes to `glContext.ts`/`glCompositor.ts`).

## Step 5 — Design-only: occlusion resilience

| Option | Correctness | Cost | Platform | Blast radius |
|---|---|---|---|---|
| (i) handle `webglcontextlost`, recover/restart the affected piece | Partial — Step 3c found the ACTUAL failure raced past the existing flag check within one tick; a full recovery would also need to rebuild the whole `GlCompositor`/render-target state mid-run and doesn't address the 223.6s STALL that preceded the crash, only the crash itself | High — OffscreenCanvas-in-Worker context recovery has limited precedent; re-establishing shaders/render-targets/textures mid-run without corrupting output is real engineering | WebGL2 spec supports the event; behavior in a Worker's OffscreenCanvas specifically is less battle-tested than on-screen canvas recovery | Contained to `glCompositor.ts`/`exportWorker.ts`'s GL path |
| (ii) move GL work to a context whose lifetime doesn't depend on window visibility | Weak — the compositing already runs in a Worker (a separate JS thread); the GPU-visible resource reclamation Step 1/3 point to is plausibly tied to the OS window/surface itself, not which JS thread issues the calls, so this doesn't obviously change the failure surface without also moving off WKWebView's rendering surface entirely | Very high — a genuine fix along this axis means compositing outside WebGL/WKWebView altogether (e.g. native Rust-side rendering), a major architecture change | N/A — not a JS-level change | Largest of the four |
| (iii) request the OS/webview not throttle/occlude during export | Addresses the RESOURCE-reclamation half of the problem (the standard, well-established fix — video encoders/downloaders commonly prevent App Nap during background work) but not necessarily WebKit's independent per-page `DOMTimer` throttling (a distinct mechanism from system-wide App Nap) — Step 4's fix already covers that half regardless | Moderate — a new Rust command wrapping `ProcessInfo.processInfo.beginActivity(options:reason:)` (macOS) / `SetThreadExecutionState` (Windows), called from the frontend at export start/end via Tauri IPC | macOS and Windows both have an equivalent primitive; **not verified against Apple/Microsoft documentation this round** — flagged, not asserted as certain | Confined to a new small Rust command + two IPC calls bracketing an export; **requires `src-tauri/` changes** |
| (iv) detect occlusion and warn/block backgrounding (stopgap) | Doesn't fix anything — a User-facing mitigation only | Lowest — Tauri already exposes window focus/visibility as a frontend-observable event (`@tauri-apps/api/window`'s focus-changed event / the DOM `visibilitychange` event on the webview's own document), so this needs **no `src-tauri/` changes at all** | Cross-platform by construction (DOM-level API) | Smallest — one new banner/toast component + an event listener |

**Recommendation: (iii) as the permanent direction, with (iv) as the smallest deployable stopgap
that can ship ahead of it.** (i) loses on cost and on not addressing the stall itself (only the
crash at the end of it); (ii) loses on cost — it's effectively "re-architect the renderer," out of
proportion to the problem given (iii) and Step 4 together address both halves (resource reclamation
and timer starvation) without touching the rendering architecture. (iii) is the standard fix for
"don't let the OS throttle my background work" and directly targets the resource-reclamation
mechanism Step 1/3 implicate; (iv) is strictly worse as a PERMANENT fix (fixes nothing) but is the
cheapest thing that can ship immediately, with zero native-code risk, while (iii) waits for a
cargo-gated round.

**Smallest first commit:** (iv)'s frontend-only occlusion-warning banner — no `src-tauri/` change,
no cargo gate, ships independently of and ahead of (iii).

**Does the recommended fix need `src-tauri/` changes, and therefore a cargo gate later?** Yes, for
(iii) specifically — `tauri.conf.json`'s `app.windows` array (`src-tauri/tauri.conf.json:14-23`) has
no existing occlusion/App-Nap-prevention field, and Tauri v2 does not expose one directly; the
smallest correct implementation is a new native Rust command using a macOS-specific crate (e.g.
`objc2`/`cocoa`) to call `ProcessInfo`'s activity API, gated `#[cfg(target_os = "macos")]` with a
Windows equivalent behind its own `#[cfg]` — this round made **zero** `src-tauri/` changes (confirmed
by the empty `git diff --name-only main -- src-tauri/` below) and any (iii) implementation is
explicitly deferred to a future round with its own cargo gate.

## Step 6 — Close run8

**NOT DETERMINED — no new live run was attempted this round** (see Step 2's own explanation for the
scope decision; the same live-run cost applies here, and Step 6 specifically needs the
*instrumented* worktree build to run live, which is exactly the run round 1's own "run 8" attempt
could not get the `maybeAutorunPartC.ts` IIFE to execute for, and that specific mystery
(`docs/ws3-silent-gaps-diagnosis.md`'s own Part 3, "Run 8" section) was not re-investigated this
round either). What's missing to close it: a completed live Part C run against this round's
current worktree (carrying both round 1's `PHASE_LOG_CAP` widening and this round's liveness fix)
that reaches `part-c-500-done` and reports at least one `silentIntervalsOver5s` entry with a non-null
`phase`, `segmentIndexAtStart`, and `assetIdAtStart` — round 1's own source-reading + the
`exportWorkerDiagnostics.test.ts` destructive-probe unit test (parametrized on `PHASE_LOG_CAP`,
passing at the widened value in this round's own `npm test` run below) remain the only verification
in hand for that specific fix; a live end-to-end confirmation is still outstanding.

## Step 7 — Tests

Added to `src/services/webcodecsExport/driveGlRun.test.ts` (the existing fake-worker harness for
`driveGlRun` — no new test file):

**7a.** `'a fully silent worker (heartbeat-only, no chunk/queue-sample ever) terminates at
WATCHDOG_MS with a populated diagnostics payload'` — feeds ONLY `'heartbeat'` messages (no chunk,
no queue-sample, no phase) across real fake-timer advancement to `WATCHDOG_MS`, driven through the
actual `WATCHDOG_MS` constant and the real `checkLivenessBounds`/`finishWatchdog` path (not a mocked
check), and asserts the typed `ok:false` error, `via: 'watchdog'`, and a populated diagnostics
payload — the "frozen export terminates with a populated diagnostics payload, through the real
bound" case, reproducing round 1's own run-5 shape (a stall producing no output/phase/chunk activity
at all, only the new heartbeat).

**7b.** `'the forward-progress bound fires from the message-driven check even when its own setTimeout
deadline never invokes its callback (throttled-scheduler simulation)'` — mocks `global.setTimeout` so
any call with `ms >= WATCHDOG_MS` becomes a permanent no-op (never invokes its callback — a direct
simulation of a throttled/never-serviced DOMTimer deadline) while shorter calls (the 50ms
grace-period timers `finishWatchdog`/`finishProgressBound` use once actually invoked) still run
normally; a hanging `ffmpeg.appendFileRaw` never resolves, and the test manually advances a
controlled `now()` clock (never touching vitest's fake-timer queue) past `FORWARD_PROGRESS_BOUND_MS`
before emitting a single `'heartbeat'` message. Asserts the run still terminates (`via: 'stall'`)
purely off the message-driven check, proving the mechanism survives a scheduler that never services
the original deadline.

**7c. Destructive probes (both performed, both edits reverted after — `git diff` below confirms a
clean tree relative to the intended changes):**
- **Disable the throttle-proof path** (commented out both `checkLivenessBounds();` call sites,
  `exportPipelineWebCodecs.ts:966`/`:975`) → RED: the new 7b test timed out (3000ms budget) with
  no termination — the mechanism is genuinely load-bearing for that scenario. The 7a test stayed
  GREEN under this probe (expected — it still advances vitest's real fake-timer queue, which the
  original, untouched `setTimeout` path also independently catches; 7a is an integration-style check,
  7b is the isolating one). Restored → both green again (12/12 in the file).
- **Remove the bound entirely** (commented out the initial arm, `resetWatchdog();`/
  `resetProgressBound();` at `exportPipelineWebCodecs.ts:1021-1022`) → RED for 3 of the file's
  pre-existing tests (all timed out: `'fires the watchdog on a worker that goes silent...'`,
  `'does not treat phase tokens as watchdog resets...'`, `'fires the forward-progress bound when an
  append hangs...'`). **7a stayed GREEN under this probe too** — worth reporting honestly rather than
  treating as a clean pass: `lastOutputAt`/`lastRealProgressAt` are initialized at variable
  declaration time regardless of whether the initial arm call ever runs, so the message-driven check
  is self-sufficient from a heartbeat alone even with the arm removed. This is a genuine, useful
  property of the new mechanism (it doesn't depend on the `setTimeout` having been armed at all to
  make its FIRST correct decision) — but it also means this specific probe under-constrains 7a. The
  probe DOES correctly show the three pre-existing, message-driven-check-uninvolved tests
  (no heartbeat emitted in any of them) go red without the arm, confirming the original `setTimeout`
  path remains the sole safety net for the "zero messages of any kind ever arrive" case — exactly
  the case Step 4's design doc above names as still requiring the frozen backstop. Restored →
  12/12 green again.

**7d. Existing instrumentation (351df7f) output-neutrality:** unaffected by this round — no changes
to `exportWorkerDiagnostics.ts`/`exportPhaseTracker.ts`/`runPartC.ts` this round (confirmed by the
`git diff --stat` below listing only `exportWorker.ts`, `exportPipelineWebCodecs.ts`, and
`driveGlRun.test.ts`); round 1's own `PHASE_LOG_CAP`-parametrized destructive-probe test in
`exportWorkerDiagnostics.test.ts` is part of the full-suite run below and still passes.

## Gates

- `npx tsc --noEmit` → clean.
- `npm run lint` → clean (same command as `tsc` on this project).
- `npm test` → **3195 passed / 77 skipped / 0 failed** (227 test files: 165 passed / 62 skipped).
  Arithmetic: round 1's baseline was 3193 passed / 77 skipped / 0 failed; this round added exactly 2
  new tests (7a, 7b above) and modified none of the existing ones' assertions — 3193 + 2 = 3195,
  matching exactly. (The first run in this worktree, before the `.work-phase4/replay` symlink was
  added per Step 0, showed 33 spurious failures and 3159 passed — a fixture-path setup gap in this
  worktree, not a code regression; the clean 3195/77/0 figure above is the re-run after that symlink
  was added.)
- `git diff --name-only main -- src-tauri/` → empty — confirmed, no Rust files touched this round.
  Cargo gates skipped on this basis, as instructed.
- `git diff --stat` (this round's changes only): `driveGlRun.test.ts` +114, `exportPipelineWebCodecs.
  ts` +63, `exportWorker.ts` +32/-1 — 3 files changed, 208 insertions, 1 deletion.

## Summary of what remains NOT DETERMINED (this round, in addition to round 1's own list above)

- Step 1's PROBABLE verdict is not upgraded to CONFIRMED — no scheduled-vs-actual timer fire-time
  instrumentation was captured against a controlled occlusion, and WebKit's `DOMTimer`/page-throttling
  source/documentation was not consulted directly.
- Step 2's 5-condition reproduction matrix — not attempted this round (scope decision, see Step 2);
  round 1's 4 live runs remain the only occlusion evidence in hand, with "minimized" and "different
  Space" entirely untested by either round.
- Step 4c's live frame-content-digest before/after comparison — not run this round; output neutrality
  is established by source audit only (see Step 4c for why that argument is nonetheless strong for
  this specific class of change).
- Step 5(iii)'s exact platform behavior (does macOS App-Nap prevention alone stop WebKit's own
  independent per-page timer throttling, or only the system-level resource-reclamation half) — not
  verified against Apple/WebKit documentation this round.
- Step 6 — run 8 remains unresolved; no new live run was attempted to close it this round.
- The residual gap named in Step 4's design section: a single, monolithic, synchronous native GL call
  blocking the export Worker's own thread for the ENTIRE stall duration would defeat even this
  round's heartbeat (no JS in that thread, including its own `setInterval`, could run) — untested
  against round 1's actual run-5 data (which run 8's still-outstanding live validation, or a
  dedicated instrumentation pass timing individual GL calls, could resolve).

---

# Round 3 — WS3 export-liveness-occlusion (blocked-vs-slow verdict, live occlusion proof, context-loss race fix)

Same worktree/branch as Round 2 (`ws3-export-liveness-occlusion`), continuing from `39ac318`.

## Step 1 — Blocked or merely slow?

Answered entirely from Round 1's own already-captured data (`public/_spike/ws3-result.jsonl`,
`/tmp/ws3-ceiling-hang-evidence.jsonl`) — no new run, per the task's own instruction.

**1a. Every event of any kind in run 5's window.** Parsing `ws3-result.jsonl` for run 5
(`part-c-autorun-start` ts `1788805241672` → `part-c-500-done` ts `1788805947986`, label
`run5-warm-immediate`) and listing every logged tag with its timestamp finds exactly 37 events for
the whole 705.25s run, all either `round6-part-c-500-progress` (the coarse, per-150-frame progress
tick fired from the main thread's `onProgress` callback in response to a real `'chunk'`-derived
`stage.frame` update — i.e. itself worker-message-driven, not a main-thread poll) or the run's
start/predicted/terminal tags. The last progress tick before the reported 223.591s gap and the
first event of ANY kind after it:
```
1788805700400  (relMs 457666)  round6-part-c-500-progress
1788805723202  (relMs 480468)  round6-part-c-500-progress   <- last event before the gap
--- 224,719 ms with ZERO events of any kind ---
1788805947921  (relMs 705187)  round6-part-c-500-export-returned  <- first event after the gap
```
This 224,719ms silent span fully encloses (and is 1,128ms wider on each side of, from imprecision
in the progress tick's own 150-frame granularity than) the `silentIntervalsOver5s` terminal entry's
own reported window: `{startMs: 480656, endMs: 704247, durationMs: 223591, phase: 'frame-loop',
framesEncodedAtStart: 4513, frameIndexAtStart: 4512}`. `/tmp/ws3-ceiling-hang-evidence.jsonl` was
independently re-parsed this round (581 lines, 47 distinct tags, ts range
`[1788724305319, 1788778496648]`) — entirely before run 5's own window
(`[1788805241672, 1788805947986]`) and containing zero `part-c-*` tags, confirming Round 1's own
claim that this file holds Round 6 ceiling-bisect data from earlier in the session, unrelated to
Part C.

**1b. CONFIRMED-INERT.** Zero worker-originated output of any kind — no `chunk`, no
`queue-sample`, no phase pulse — reached the main thread for 224.7 continuous seconds. A "merely
slow" worker thread still executes JS between long individual operations and would be expected to
emit at least an occasional message at a reduced rate; a rate that drops to exactly zero for 3.75
minutes is the signature of a thread not running AT ALL, not one running slowly. Consequence: a
worker-side `setInterval` heartbeat — had one existed in Round 1's original (pre-`bc50955`) code —
could not have fired during this specific window either, because a genuinely blocked JS thread
cannot service any of its own timer callbacks, heartbeat included. **Redesign implied (stated, not
built, per the task's instruction):** the bound must be evaluated from something that survives a
fully blocked export-worker thread — either (a) a SEPARATE, independent `Worker` instance (its own
OS-level thread, not sharing the export worker's event loop, so a synchronous native call blocking
the export worker cannot block a different worker's timer) whose only job is a periodic liveness
ping, or (b) a native Rust-side timer (Step 5's "third context") that observes IPC/heartbeat
silence from OUTSIDE the WebView's JS engine entirely. Neither is implemented this round. This also
means `bc50955`'s ACTUAL shipped fix (`checkLivenessBounds` + the export-worker's own heartbeat) is
a genuine improvement for the "worker keeps running slowly but freely" shape (Round 1's non-
catastrophic gaps up to ~10s) but does **not** close the CONFIRMED-INERT gap for the specific
"single synchronous call blocks the whole worker thread" failure mode — a heartbeat sourced from
the very thread that's blocked is exactly as inert as the raw `setTimeout` it backstops, for that
one failure mode specifically.

**1c. Longest synchronous, non-yielding span on the frame path.** In `runFrameLoopTick`
(`exportWorker.ts:731-825`), the steady-state (no active transition) span between the `await` at
`exportWorker.ts:776` (`resolveSlotSource(plan.a, ...)`) returning and the next yield point (either
the conditional `await waitForDequeue(encoder)` at `exportWorker.ts:799`, only entered when
`encoder.encodeQueueSize > BACKPRESSURE_HIGH_WATER`, or the following loop iteration's own
`resolveSlotSource` await) runs entirely synchronously:
- `uploadSlot` → `compositor.uploadFrame('a', ...)` → `gl.texImage2D(...)` (`glCompositor.ts:376`)
  — a single texture upload from a (possibly hardware-decoded, IOSurface-backed) `VideoFrame`,
  the same call class Step 3 below found returning `null` after a context loss.
- `compositor.renderFrame(rawParams)` (`exportWorker.ts:786`) — up to 6 chained
  `gl.useProgram`/`gl.drawArrays` calls on the transition path (`glCompositor.ts`'s
  `renderTransition`: 2×`drawBlit`, 2×`drawZoom`, 1×`drawTransitionBlend`, 1×`drawGrade`), plus,
  whenever the render-target size changes, `ensureRenderTargets` → `createRenderTarget` →
  `gl.createFramebuffer`/`gl.checkFramebufferStatus` — the latter an explicit, spec'd GPU
  synchronization point that cannot return until the driver validates the framebuffer.
- `textRenderer.renderFrame(...)` (`exportWorker.ts:789-795`) — synchronous; on an atlas-cache miss
  (`AtlasCache.set`, `textRenderer.ts:464`) this also does synchronous Canvas2D rasterization
  (`ctx.fillText`, `wrapText`'s `measureText` loop) plus its own `gl.texImage2D` upload
  (`textRenderer.ts:473`) of a possibly-supersampled canvas (heading path,
  `HEADING_SUPERSAMPLE_FACTOR`×).
- `new VideoFrame(canvas, {...})` (`exportWorker.ts:804`) — constructing a `VideoFrame` from an
  `OffscreenCanvas` requires the engine to snapshot the canvas's current backing store; no
  documented async variant exists.
- `encoder.encode(frame, {...})` / `frame.close()` (`exportWorker.ts:813,815`).

**Worst-case duration: NOT DETERMINED precisely** — no instrumentation inside this span times
individual GL calls (`ExportPhaseTracker`'s pulses are throttled to 250ms and only bracket the
OUTER `demux`/`image-bitmap` phases, not calls within `frame-loop`). Empirically, whichever single
call in this chain stalled did so for **at least 223.591s** in Round 1's run 5 (the terminal
`createContentTexture` throw Step 3 below fixes came from exactly this call chain —
`renderFrame` → `ensureRenderTargets` → `createRenderTarget` → `createContentTexture`); nothing in
this span carries its own timeout, so the theoretical worst case is unbounded.

**1d. Heartbeat primitive and worker-throttling citation.** `setInterval`
(`exportWorker.ts:994`, `HEARTBEAT_INTERVAL_MS = 5_000`, `exportWorker.ts:189`), running in the
export Worker's own `DedicatedWorkerGlobalScope` (`self`), posting via `self.postMessage`
(`postOut`, `exportWorker.ts:179-182`) — the identical timer primitive family as the main thread's
`WATCHDOG_MS`/`FORWARD_PROGRESS_BOUND_MS`, differing only in which global scope owns it.
**NOT DETERMINED with certainty for this exact platform** (real windowed WKWebView on macOS,
Tauri) — not assumed exempt either. One concrete, documented WebKit issue was found:
[microsoft/playwright#41044](https://github.com/microsoft/playwright/issues/41044) reports a
dedicated Worker's own event loop (not merely cross-thread `postMessage` dispatch) throttled/
suspended by the WebKit browser process when it considers the page "inactive," with 20-40s delays
before a Worker's `postMessage` was processed — on WebKit running headed under Xvfb on Linux
(virtual display), contradicting the general cross-browser convention (also surfaced by the same
search) that a Worker's own timers are NOT subject to page-visibility throttling the way
`window.setInterval` is. Not confirmed for a real macOS windowed/occluded WKWebView specifically.
Given 1b's CONFIRMED-INERT finding already answers the practical question — the worker was fully
blocked regardless of whether its interval was ALSO independently throttled, since a blocked JS
thread can't run any of its own callbacks either way — this sub-question is secondary to 1b, but is
reported as asked: **NOT DETERMINED**, cited above rather than assumed.

## Step 2 — One live occluded run

**Method, and an early methodological correction (reported honestly).** The first attempt
(`run9-round3-occluded-fullscreen`) was contaminated: Step 3's code edits (below) were made to
`glCompositor.ts`/`textRenderer.ts`/`exportWorker.ts` WHILE that run was still executing — Vite's
dev-server file watcher fired repeated `page reload src/services/gl/glCompositor.ts` /
`...textRenderer.ts` / `...exportWorker.ts` full-page reloads into the SAME running window
(confirmed in `run9_tauri.log`: 12 page-reload lines and a `[TAURI] Couldn't find callback id
1442156703. This might happen when the app is reloaded while Rust is running an asynchronous
operation` warning), which tore down the in-progress export mid-run and even re-triggered
`maybeAutorunPartC.ts`'s IIFE a second time from a fresh page load (two independent
`part-c-autorun-start` events for the one label). That run's data is invalid and is not used below.
**Lesson applied for the rest of this round: no worktree source file was edited while a live run
was in flight for the remainder of this session.** A clean re-run
(`run10-round3-occluded-clean`) was launched only after Step 3's edits were finished and `tsc`/
`lint`/the two new test files all passed.

Setup: `npm run tauri:dev` launched via a backgrounded shell (not double-clicked — matches Round
1's own finding that this alone keeps a freshly-launched window from being focused), immediately
covered by a same-Space (not macOS Space-based Full Screen, which would move the window to a
different Space rather than occlude it) `TextEdit` window resized to `(0,0)-(1792,1120)` via
`osascript`, re-asserted via `osascript` every time an `lsappinfo front` poll (5-8s cadence)
detected a different frontmost app. Before launch, `ps aux` found and killed 3 orphaned
(`ppid=1`) `WebKit.*.xpc` children left over from an earlier, unrelated process — the "leftover
process" scenario Round 1 also hit — and confirmed no `vitest`/other competing CPU load. **Honest
imperfection**: occlusion lapsed briefly at least twice over the run's 88s — once seconds after
launch (the window briefly self-activated) and once, significantly, right at the very start of the
fatal stall window itself (see below) — this was not a single, perfectly clean, uninterrupted
occlusion window the way a dedicated scripted repro would be; the reaction latency (5-8s polling)
is a real limitation of this round's method, reported rather than hidden.

**Result: the liveness bound FIRED.** `part-c-500-done` (label `run10-round3-occluded-clean`):

| Field | Value |
|---|---|
| `resultOk` | `false` |
| `framesEncoded` | 697 / 6000 expected |
| `wallSec` | 88.238 |
| `failureVia` | `watchdog` |
| `failureMessage` | `Export worker produced no output for 30s — aborting (watchdog).` |
| `longestSilent` | `{durationMs: 32423, phase: 'frame-loop'}` |
| `appendCallCount` / `appendBytes` | 654 / 20,521,832 (real encode/append work happened before the stall) |

The single `silentIntervalsOver5s` entry: `{startMs: 52329, endMs: 84752, durationMs: 32423,
phase: 'frame-loop', segmentIndexAtStart: 58, assetIdAtStart:
'68d764a7-0dde-4312-985f-2b7d2ee6233d', frameIndexAtStart: 696}` — **this is also the first live
confirmation of Round 1's own Part 2c instrumentation** (`segmentIndexAtStart`/`assetIdAtStart`),
never exercised by a completed live run before this round (Round 1's own "run 8" attempt never
started; see the still-open Round 2 Step 6 note above).

**Elapsed at firing**: stall began at relMs 52,329 (~52.3s into the run), watchdog fired at relMs
84,752 (~84.8s in) — a 32,423ms stall, closely matching `WATCHDOG_MS` (30,000ms) plus
`finishWatchdog`'s own 50ms grace and polling/detection overhead.

**Full typed-error diagnostics payload — what this dev harness's jsonl report actually captures,
and what it does not:**
- `lastPhase`: `'frame-loop'`
- `pieceIndex`: 0 (single GL piece, per the fixture's own one-piece plan)
- `segmentIndex` / `assetId`: 58 / `68d764a7-0dde-4312-985f-2b7d2ee6233d` (see above)
- `framesEncoded`: 697 (`frameIndexAtStart` 696)
- failure identity: `{via: 'watchdog', name: null, message: 'Export worker produced no output for
  30s — aborting (watchdog).', frameIndex: 696, timelineSec: null}`
- `msSinceLastPhaseChange`, per-phase elapsed (`phaseMs`), `demuxSplit`, and the full
  phase-transition log are **NOT captured by this report type** — `phaseMs` came back as `{}`
  (empty) live, and `demuxSplit`/the raw `phaseLog` array were never fields `PartCRunReport`
  exposes to the jsonl sink at all (a schema gap, not a live-data absence — same class of gap
  Round 1's Part 1b already flagged for the original sink, now confirmed to also apply to the
  post-Round-1-instrumentation report type). The empty `phaseMs` is itself evidence, addressed
  next.

**Every interval >5s** (this run had exactly one): the table row above — phase `frame-loop`,
segment 58, asset `68d764a7-0dde-4312-985f-2b7d2ee6233d`.

**Resource/CPU signature during the stall** (this round's own sampler, ~3-4s cadence, run for the
FULL run rather than ending early — closing the exact gap Round 1's Part 3c flagged in its own
sampler): `com.apple.WebKit.WebContent` and `com.apple.WebKit.GPU` CPU both flatlined at 0.0-0.2%
for the ~23-28s sampled inside the stall window (epoch `1788812845`-`1788812868`), RSS essentially
frozen (415,364 KB -> 407,012 KB, no growth) — the same "blocked, not merely slow" signature Round
1's Part 3c found for its own (differently-timed) sampled portion of run 5, now confirmed for a
second, independent stall.

**Which mechanism actually caught it — NOT DEFINITIVELY DETERMINED, circumstantial evidence leans
toward the pre-existing raw `setTimeout` backstop, not the new heartbeat path.** No instrumentation
this round distinguishes which of `checkLivenessBounds`'s message-driven call to `finishWatchdog`
vs. the raw `setTimeout(finishWatchdog, WATCHDOG_MS)` actually fired. But the CPU signature above
(worker apparently still fully blocked at the moment of firing) plus the empty `phaseMs` and
zeroed resource-count fields (`decodersCreated: 0`, `cursorsCreated: 0`, etc. — inconsistent with
697 real frames having been encoded, meaning `finishWatchdog`'s `'request-diagnostics'`
`postMessage` almost certainly got no response inside its 50ms grace window) together suggest the
export worker was STILL blocked when the bound fired — meaning it could not have sent a
`'heartbeat'` message either, so by elimination the raw `setTimeout` is the more likely culprit.
**Consequence, stated plainly**: this run demonstrates the OVERALL system (both redundant
mechanisms together) correctly turns an occlusion-triggered ~30s stall into a clean, typed failure
in ~88s total, rather than the 223.591s hang + uncaught-exception crash Round 1's unfixed run 5
produced — a genuine, non-hypothetical positive result, since this run DID stall (not a "no gaps,
fix unvalidated" case). It does **not** conclusively isolate the NEW heartbeat mechanism as the one
that mattered here; it is equally consistent with "the main-thread `setTimeout` was not yet
throttled severely enough at the ~32s mark to matter," a milder case than Round 1's run 5 and closer
to Round 1's run 4 (backgrounded the whole time, gaps only up to 10.0s).

**A methodological finding along the way, reported for full transparency**: this round's own
process cleanup made a mistake — a `pkill -f "target/debug/app"` / `pkill -f "node.*tauri dev"`
issued to recover from the contaminated `run9` also matched and killed a concurrent peer session's
(`ws3-120fps-preview`) own `npm run tauri:dev` process on this shared machine, which that session
then had to detect and restart on its own. Every process action for the remainder of this round
used exact PIDs verified by `ps -o pid,ppid,command` immediately beforehand, never a name pattern.

## Step 3 — Context-loss race fix (implemented)

**3a/3b — the fix.** `glContext.ts` gains `GlContextLostError` (a typed `Error` subclass) and
`requireGl<T>(gl, value, what)`: when a GL allocation call returns `null`, `requireGl` checks
`gl.isContextLost()` — a synchronous, spec-guaranteed query independent of whether the async
`contextlost`/`webglcontextlost` event has dispatched yet — and throws `GlContextLostError` when
true, or the original generic `Error` (unchanged message) when false (a genuine, non-loss
allocation failure). Every GL allocation call in the render path that can return `null` on loss now
routes through it: `glCompositor.ts`'s `compileShader`/`linkProgram`/`createContentTexture`/
`createRenderTarget`'s `createFramebuffer`/`setup`'s `createVertexArray`/`createBuffer` (6 sites),
and `textRenderer.ts`'s equivalent 5 sites (`compileShader`/`linkProgram`/`AtlasCache.set`'s
`createTexture`/the constructor's `createVertexArray`/`createBuffer`). `exportWorker.ts`'s outer
`catch` block (the frame loop's own `try/catch`) now recognizes `GlContextLostError` and reports it
via `failState.setFailure('gl-context-lost', e)` instead of the generic `'thrown'` — using the
SAME `RunFailureState`/`ExportFailureIdentity`/`buildDiagnostics` machinery the pre-existing
per-iteration `contextLost`-flag check already used, so the full diagnostics payload (unchanged
shape) is populated identically regardless of which path wins.

**Both orderings converge, by construction, not by handling two cases.** The pre-existing
listener-driven path (`exportWorker.ts`'s per-iteration `contextLost` flag check, unchanged) and
the new null-return-driven path (`requireGl`) both resolve to the identical
`'gl-context-lost'` identity — because both ultimately ask the SAME synchronous
`gl.isContextLost()` state (the flag check indirectly, via the listener that flips it; `requireGl`
directly), there is no longer an ordering-dependent branch to race between: whichever call site
notices the loss first reports the same thing. This is why the fix removes the race rather than
adding a second case to handle it.

**3c — tests (destructive probes both performed, both reverted after; `git diff` below shows the
tree in the KEPT, working state):**
- `glContext.test.ts`'s new `requireGl` suite (5 tests): value passthrough when non-null; throws
  `GlContextLostError` when null+lost, with the exact expected message and `.name`; throws a plain
  `Error` (not `GlContextLostError`) when null+NOT-lost (proves no over-classification); does not
  call `isContextLost()` at all on the non-null hot path.
- `glCompositor.test.ts`'s new "context loss at the point of use" suite (3 tests): a null
  `createTexture()` during a simulated loss (construction-time, texA) throws `GlContextLostError`;
  a null `createFramebuffer()` during a simulated loss reached via a real `renderFrame()` call
  (the exact `ensureRenderTargets` -> `createRenderTarget` path Round 2's Step 3c found live) throws
  `GlContextLostError`; the same null `createTexture()` WITHOUT a context loss still throws the
  original generic `Error`, not `GlContextLostError`.
- **Destructive probe, performed**: reverting `requireGl`'s `isContextLost()` branch (making it
  always throw the generic `Error`) turned the first two glContext tests and the first two
  glCompositor tests RED, confirming they exercise the new branch and not some other path; the
  "without a loss" tests in both files stayed GREEN under this probe (they don't depend on the
  branch under test), correctly bounding what the probe demonstrates. Restored -> all green again.
- No `exportWorker.ts`-level test exists for the catch-block's `GlContextLostError` recognition —
  **stated as a scope boundary, not hidden**: `exportWorker.ts` has no unit-test harness at all
  (confirmed: no `exportWorker.test.ts` exists in this repo; its internals — `RunFailureState`,
  `runFrameLoopTick`, `runExport` — are all unexported, and building a harness would mean mocking
  `OffscreenCanvas`/`WebGL2RenderingContext`/`VideoEncoder`/`VideoDecoder`/`self.postMessage` from
  scratch, out of proportion to this step). The catch-block's one-line ternary is exercised
  indirectly by Step 2's own live run 10 in the sense that `exportWorker.ts` still compiles and
  runs correctly end-to-end under real WebGL2 (tsc + the live run above are the only evidence for
  that specific line, not a dedicated unit test).

**3d.** No context recovery/restart implemented (Step 5's scope, confirmed by the `git diff` below
carrying no changes to any `contextrestored`/`handleContextRestored` code path).

## Step 4 — Output neutrality, measured live

Round 2's Step 4c ran no live comparison ("NOT DETERMINED... the source-audit argument above is
strong... but is not the same evidence as a matching digest"). This round ran it, twice over:

1. **Reproducibility at HEAD** (`run11-round3-digest`, current worktree — Round 1's `351df7f`,
   Round 2's `bc50955`, and this round's Step 3 fix all present): the `~40s` GL fixture
   (100 segments, 1200 frames at 30fps) run twice back-to-back produced
   `frameContentDigest` **`fda1b8dfa616ef8f0ecf76d7b1ae6011bb0c8bb272777146c476cba821ca2ea0`** on
   BOTH runs (`framesA`/`framesB`: 1200/1200, `reproducible: true`).
2. **Matches pre-`bc50955`** (`run12-pre-bc50955-baseline`, the existing worktree
   `4.kinetix-pro-studio-tmp-ws3-silent-gaps` at `12f6ad7` — Round 1's own last commit, before ANY
   Round 2/3 liveness-mechanism or context-loss changes): the identical fixture, run twice on this
   OLDER commit, produced the **exact same digest**,
   `fda1b8dfa616ef8f0ecf76d7b1ae6011bb0c8bb272777146c476cba821ca2ea0`, also with
   `reproducible: true` internally.

**Byte-identical hash across three independent runs spanning two commits (one pre-`bc50955`, one
with `bc50955`+Step 3) is now empirical proof, not source-audit inference, that neither the
liveness-mechanism fix nor the context-loss-race fix changed a single composited pixel.** No frame
digest gate needed to be built this round — `runPartCDigestRepro40s`/`generatePartCFixture`
(dev-only, already existed) were reused unmodified.

## Step 5 — App Nap fix, scoped but not built

- **Exact macOS API**: `ProcessInfo.processInfo.beginActivity(options:reason:)` (Foundation),
  called with `.userInitiated` (or a similar non-suspending option set), retaining the returned
  opaque activity token for the export's duration and releasing it via `endActivity(_:)` when the
  export finishes or fails. This is Apple's documented, standard mechanism for opting a long-running
  operation out of App Nap (precedent: HandBrake's own encode-time use of exactly this API, found
  during this round's research).
- **`src-tauri` file:line**: `src-tauri/src/lib.rs`'s `tauri::generate_handler![...]` macro
  (currently `lib.rs:440-...`, e.g. right after `ffmpeg::reveal_in_finder,` at `lib.rs:456`) would
  gain two new commands (`begin_export_activity`/`end_export_activity`) implemented in a new
  `src-tauri/src/power.rs` — no existing module owns this concern. Each command
  `#[cfg(target_os = "macos")]`-gated to call `ProcessInfo` via the `objc2`/`objc2-foundation`
  crate, with a no-op fallback on other platforms; the frontend would bracket `runExport`'s
  start/end in `exportPipelineWebCodecs.ts` with `invoke(...)` calls, mirroring the existing
  `ffmpeg_create_session`/`ffmpeg_destroy_session` session-bracket pattern.
- **Windows equivalent**: `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED |
  ES_AWAYMODE_REQUIRED)` (`kernel32`, via the `windows-sys` crate) — the standard Windows API for
  preventing system/display sleep during a long operation, but **not a precise analog**: Windows
  has no documented per-window "occlusion-triggered throttling" concept equivalent to macOS App Nap
  or WebKit's own page-visibility timer throttling; `SetThreadExecutionState` targets SYSTEM
  sleep/display timeout, not per-app background CPU/timer throttling.
- **Cargo gates a future round would need**: a new native dependency in `Cargo.toml`
  (`objc2`+`objc2-foundation` macOS-only via `[target.'cfg(target_os = "macos")'.dependencies]`;
  `windows-sys` with its `Win32_System_Power` feature, Windows-only) — `Cargo.toml` currently has
  ZERO such crates (confirmed by grep this round). A future round would need `cargo check`/
  `cargo build` on both platform configurations plus new Rust-side tests (none exist for power
  management today).
- **CPU vs. GPU — the core question, and a correction to Round 2's own framing.**
  `ProcessInfo.beginActivity` addresses ONLY the CPU/timer-throttling half of App Nap (priority
  reduction, `setInterval`/`setTimeout` throttling, I/O throttling) — it does **not** prevent GPU
  surface/window-backing-store reclamation for an occluded window. These are two separate,
  independently-documented Apple mechanisms: App Nap is a CPU/power-management feature: window
  occlusion (`NSWindowOcclusionState`) is a distinct, GPU/compositor-facing concern that Apple's OWN
  guidance explicitly recommends apps COOPERATE with by HALTING GPU work when occluded (the "Work
  When Visible" pattern — e.g. Photo Booth stopping its camera/effects when not visible) — i.e.
  Apple's platform convention runs the OPPOSITE direction from what this app would want, and there
  is no documented, supported "keep my GPU resources live while occluded" API analogous to
  `beginActivity`. **Consequence**: `beginActivity` would help the Step 1/4 timer-throttling risk
  (already independently covered by `bc50955`'s message-driven `checkLivenessBounds`, making its
  marginal value here smaller than Round 2's table estimated) but would **not**, by itself, have
  prevented Round 1 run 5's `gl.createTexture()`-returns-null context loss — that symptom points at
  WebKit's own internal GPU-resource handling for a hidden page, a WebKit-internal decision this
  app's own `beginActivity` call cannot override, and Apple's stated platform philosophy suggests
  there may be no supported app-level fix for that half at all.

## Gates

- `npx tsc --noEmit` -> clean.
- `npm run lint` -> clean (same command as `tsc` on this project).
- `npm test` -> **3203 passed / 77 skipped / 0 failed** (227 test files: 165 passed / 62 skipped).
  Arithmetic: Round 2's baseline was 3195 passed; this round added exactly 8 new tests (5 in
  `glContext.test.ts`'s `requireGl` suite, 3 in `glCompositor.test.ts`'s context-loss suite) and
  modified no existing assertions — 3195 + 8 = 3203, matching exactly.
- `git diff --name-only main -- src-tauri/` -> empty — confirmed, no Rust files touched this round.
  Cargo gates skipped on this basis, as instructed.
- This round's own working-tree diff (`git diff --stat`, uncommitted at time of writing): 6 files
  changed, 197 insertions(+), 23 deletions(-) — `glCompositor.test.ts` (+69), `glCompositor.ts`
  (+17/-11 net), `glContext.test.ts` (+64), `glContext.ts` (+44), `exportWorker.ts` (+10/-2),
  `textRenderer.ts` (+16/-10).

## Summary of what remains NOT DETERMINED (this round, in addition to Rounds 1/2's own lists above)

- Step 1's redesign (a second independent Worker, or a native/Rust-side third context, for a
  genuinely blocked export-worker thread) is stated, not built.
- Step 1d's WebKit-worker-throttling question is answered by a documented but platform-adjacent
  citation (Playwright/WebKit on Linux/Xvfb), not confirmed for macOS windowed WKWebView.
- Step 2's occlusion was imperfect (two brief lapses, 5-8s reaction latency) — a dedicated, single,
  perfectly-clean controlled-interval repro (Round 1's own Part 5c recommendation, still not built
  by either round) remains the cleanest way to close this out further.
- Step 2 could not determine WHICH of the two redundant liveness mechanisms (raw `setTimeout` vs.
  message-driven `checkLivenessBounds`) actually fired for run 10's stall specifically — circumstantial
  evidence favors the raw `setTimeout`, not proof.
- Step 5's `beginActivity` scoping is a design-only report — not implemented, not verified against
  a running macOS App Nap state this round.
- Round 2's Step 6 (run 8) remains open — not attempted this round either.

