# WS3 — "Export is 5x slower" — measurement audit

Scope: the field report that export regressed ~5x on the
`ws3-export-liveness-occlusion` branch (13% at 9:34 on a 332-segment project
= ~8.6 fps, against a "45 fps" prior benchmark).

**Verdict: the regression claim is not supported, and it is not bisectable,
because the baseline it is measured against was never stable.** The instrument's
own run-to-run spread on unchanged code is larger than the effect being claimed.

## The evidence

`public/_spike/ws3-result.jsonl` (the round's own autorun sink, 414 records,
2026-09-07 21:21 -> 09-08 02:00) contains repeated runs of the *same* Part C
fixture. The round's first commit is `351df7f` at **09-08 00:09**, so every
`part-c-500` row below ran on PRE-ROUND code:

| when (09-07) | frames | wallSec | fps | note |
|---|---|---|---|---|
| 21:25 | 6000 | 266.93 | 22.48 | |
| 21:28 | 6000 | 135.27 | **44.36** | this is the operator's "6000 frames / 132s = 45 fps" |
| 21:31 | 6000 | 136.53 | 43.95 | |
| 23:09 | 6000 | 264.30 | 22.70 | |
| 23:32 | 4519 | 705.12 | **6.41** | did not complete |
| 23:43 | 6000 | 445.87 | 13.46 | |
| 23:53 | 6000 | 427.91 | 14.02 | |

**6.41 -> 44.36 fps is a 6.9x spread on identical, pre-round code in one
evening.** The quoted "45 fps baseline" is the single best run of that set. The
field number (8.6 fps) sits inside the same pre-round distribution, which
already contained 6.41, 13.46 and 14.02.

A 5x claim cannot be read off an instrument whose noise floor is 6.9x.

## Output is byte-identical across the spread

Six `part-c-digest-*` runs (1200 frames each, on-branch, dev):

| run | wallSec | fps |
|---|---|---|
| a | 132.82 | 9.03 |
| b | 103.67 | 11.58 |
| a | 64.63 | 18.57 |
| b | 61.96 | 19.37 |
| a | 64.75 | 18.53 |
| b | 191.22 | 6.28 |

3.1x spread, and all six produced the SAME `frameContentDigest`
`fda1b8dfa616ef8f0ecf76d7b1ae6011bb0c8bb272777146c476cba821ca2ea0` over 1200
frames. The round's changes are output-neutral; the varying wall time is
environmental, not computational.

These runs are also 1200 frames < `MAX_ENCODER_SESSION_FRAMES` (1800), so
**zero encoder rotations occurred in any of them** — the 3.1x spread is
therefore not attributable to encoder rotation.

## Why the round's code cannot account for 5x

Static read of the owned files (`exportWorker.ts`, `exportPipelineWebCodecs.ts`):

- `tracker.pulse()` is throttled to `PHASE_THROTTLE_MS` (250 ms), so the widened
  `DEV_PHASE_LOG_CAP` (8192) costs ~4 pushes/sec, not one per frame. The
  `log.shift()` ring is not in the hot path.
- `checkLivenessBounds()` runs only on `'phase'` (<=4/s) and `'heartbeat'`
  (0.2/s), never on `'chunk'`. Message-driven evaluation (`bc50955`) is not
  per-frame.
- The only per-frame additions are `releaseStaleAssets` (one Map iteration over
  assets) and `rotateAt.has(i)` (a Set lookup). Both O(small), no I/O.
- The heartbeat is one `setInterval` at 5 s.

Nothing here is worth ~+94 ms/frame, which is what 45 -> 8.6 fps requires.

## Already-documented cause

`docs/ws3-export/silent-gaps-diagnosis.md` (this round) had already measured and
attributed this, and it is being rediscovered as a regression:

- A **load-dependent uniform throughput tax, ~3.3x**, "present in every single
  run attempted this round", tracking machine load — concurrent `vitest`, other
  worktrees' `tauri dev`, and a confirmed external Cursor session.
- A **window-occlusion effect**: runs with the window occluded showed multi-second
  to multi-minute gaps; foregrounded repeats were gap-free.

Both were live during this audit: `npm run tauri:dev` (pid 8606) still running
from this worktree, Cursor helpers at ~45% CPU, load average 4.05.

## "segment 1 / 1" is expected, not a routing collapse

`encoderSessionPlan.ts` documents that the piece planner may only cut at a
boundary with no transition, so a fully-transitioned timeline correctly yields
one piece; and `e1aa4a8` deliberately moved the cap off pieces onto encoder
sessions specifically so the piece count would NOT change. A single-piece
progress display is the designed behaviour on this branch and on main.

## What was NOT done, and why

- **Parts 1(b)/1(c) and Part 2 (production-build fps + bisect) were not run.**
  They are not executable as specified: the autorun harness is
  `import.meta.env.DEV`-gated with a test enforcing it
  (`unreachableFromProduction.test.ts`), and its results sink is a Vite
  middleware declared `apply: 'serve'`. There is no production-reachable way to
  drive or record an export. Building one means shipping the dev harness into
  production, which that test exists to prevent.
- Even setting that aside, a bisect keyed on fps is invalid while the noise
  floor is 6.9x. Any per-commit fps table produced on this machine today would
  be measuring load, not code.

## What would actually be needed

1. Control the environment before measuring: single run, window foregrounded,
   no other worktree's `tauri dev`/`vitest`, no Cursor/Claude agent session
   active. The round's own data shows this alone moves fps by ~7x.
2. Repeat n>=3 per condition and report the distribution, not one number.
3. Break out the frame-loop internals before attributing cost. Currently
   instrumented: `demux` (+`demux-fetch`/`demux-parse` split), `encoder-flush`,
   `encoder-rotate`, `encoder-ladder`, `gl-context`, `shader-compile`,
   `image-bitmap`, `font-init`, `frame-loop`. **Not** broken out: compositing,
   decode wait, encode submit, `waitForDequeue`, cursor open/reopen — they are
   all folded into the single `frame-loop` bucket, and `appendFileRaw` is
   main-thread and outside the tracker entirely. No run in the sink captured a
   non-empty `phaseMs`.

## Encoder rotation cost (Part 4)

Not measured — no run in the sink performed a rotation. Analytically, one
rotation is `flushWithBound` (drains <= `BACKPRESSURE_HIGH_WATER` frames plus
reorder depth) + `close()` + `createEncoder`, whose ladder does one
`isConfigSupported` + one `configure` on macOS's first rung
(`'prefer-hardware'`). The field project's 38061 frames / 1800 = ~21 rotations.
This is an estimate from code shape, not a measurement, and should not be
quoted as one.

## Gates

`tsc --noEmit` clean; `npm run lint` clean (same command); `npm test`
3262 passed / 0 failed / 77 skipped (172 files); `git diff 4d4922c..a92a855 --
src-tauri/` empty. Run at `a92a855` with a clean tree.
