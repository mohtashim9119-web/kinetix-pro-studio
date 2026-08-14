# WS1 Task 5, Slice D25 — durable cache exercised live, R.5 reachability scoped

> All real-corpus numbers below are reproduced live on this machine against
> `.work-phase4/replay/173/` (gitignored, local-only) and the real
> `com.kinetix.pro-studio` app-local-data directory. Nothing is carried
> forward from D24 without a fresh run backing it. Track A (A1-A3, this
> document + `src-tauri/src/fa.rs`/`fa_dev.rs`/`lib.rs`/`Cargo.toml` +
> `src-tauri/tests/fa_durable_wav_live.rs`) and Track B (B1, read-only) both
> land in this one document per the task's own instruction.

## 1. A1 — exercising the untested half of `ensure_durable_wav`

**D24's own gap, restated:** `ensure_durable_wav`'s pure core (path building,
key derivation, hit/miss decision, finalize/rename, LRU eviction) had 9 tests,
but `app_local_data_dir()` resolution and the real `whisper::transcode_to_wav`
call had never executed — D24's own test-module header said so plainly:
"this codebase has no `AppHandle` test-mocking precedent anywhere."

**Route:** `fa_dev.rs`'s `fa_align_dev` now calls `crate::fa::ensure_durable_wav`
instead of its own throwaway per-call `transcode_to_wav` + temp-dir-cleanup
lifecycle. The decoded audio bytes are written to a content-addressed (SHA-256
of the bytes), not per-call-UUID'd, path under a stable temp directory — this
matters structurally: `ensure_durable_wav`'s cache key is the SOURCE file's own
identity (name|size|mtime), so a fresh UUID'd file on every call would give
every invocation of the identical clip a fresh mtime and defeat the durable
cache before it ever got a chance to hit.

**How a real `AppHandle` was obtained without a running app.** This codebase's
command signatures (`fa_align_dev`, `ensure_durable_wav`, and — protected,
unmodified this slice — `whisper.rs::transcode_to_wav`) are all hardcoded to
`AppHandle<Wry>` (tauri's own `#[default_runtime(crate::Wry, "wry")]` macro
applies whenever `AppHandle` is written bare, which every one of them does).
`tauri::test::mock_builder()`'s `MockRuntime` therefore cannot reach any of
them — a real type mismatch, not a missing test-mocking convention to add.
The actual fix: `tauri::test::mock_context::<tauri::Wry, _>(tauri::test::
noop_assets())` builds a `Context<R>` GENERIC over the runtime, with an EMPTY
`app.windows` list — so `tauri::Builder::<tauri::Wry>::default().build(ctx)`
constructs a REAL Wry-backed `App` (a real `AppHandle<Wry>`, satisfying every
signature unmodified) without ever needing to create an actual webview/window
(no Vite dev server, no built `dist/`, no display dependency beyond the
underlying wry/tao `EventLoop::new()` itself). The identifier was set to the
real `com.kinetix.pro-studio` so `app_local_data_dir()` resolves to the exact
path production does.

This had to be its own `harness = false` integration-test binary
(`src-tauri/tests/fa_durable_wav_live.rs`, gated in Cargo.toml), not a
`#[cfg(test)]` unit test inside `fa.rs`: `tao::EventLoop::new()` is an
AppKit main-thread-only operation on macOS, and libtest always runs `#[test]`
functions on their own worker thread, never the process's actual main
thread — only a plain `fn main()` in its own binary satisfies that. Being an
integration-test crate also means it can only reach `pub` items, so `fa`/
`fa_dev` were widened from `mod` to `pub mod` in `lib.rs`, and
`ensure_durable_wav` from `pub(crate)` to `pub` — compile-time-only, zero
runtime effect (verified: `cargo check` clean, `cargo clippy` 0 new warnings
after the widening — see §5's gate table for the one incidental private-type-
leak warning this widening DID surface and how it was fixed, unrelated to the
cache logic itself).

Self-gated behind `FA_LIVE_DURABLE_WAV=1` plus the real corpus audio's
presence (mirrors this codebase's `ORT_REQUIRE=1`/`ort_dylib_or_skip`
convention) — a plain `cargo test` sweep still compiles this binary but exits
immediately, touching neither the filesystem nor the Wry runtime.

### A real bug this exercise caught, live, on the first run

The first real run failed with an ffmpeg error: **`Unable to choose an output
format` / `Invalid argument`**, for every attempted transcode. Root cause: the
`.tmp` file's name (both the pre-existing D24 shape, `{key}.wav.tmp`, and this
slice's first uniqueness fix, `{key}.{uuid}.wav.tmp`) ends in `.tmp`, and
`whisper.rs::transcode_to_wav` (protected, unmodified) passes ffmpeg no
explicit `-f` — ffmpeg's own output-muxer auto-detection keys off the LITERAL
trailing filename extension, which was `.tmp`, not `.wav`. **Every real
transcode into the durable cache was failing, and nothing had caught it before
this slice** because nothing had exercised `ensure_durable_wav` with a real
`AppHandle` and a real ffmpeg invocation until now — D24's own 9 tests all
stand in for the transcode step with a plain `fs::write`, which never
round-trips through ffmpeg's own filename-based format inference.

**Fix** (`resolve_cache_entry`, `fa.rs`): the tmp file now lives at
`cache_dir/.tmp/{key}.{uuid}.wav` — ending in `.wav` (ffmpeg's own
auto-detection succeeds) while staying invisible to
`evict_lru_until_under_cap`'s non-recursive `read_dir(cache_dir)` scan (a
bare `.tmp` directory name has no `Path::extension()` in Rust's own
convention, so it's excluded the same way a non-`.wav` file already was).
Still "in the destination directory" for the atomicity guarantee this
function's own doc comment states — `.tmp/` is a child of `cache_dir`, same
filesystem, same mount, always; `fs::rename` is only atomic within a
filesystem, not a directory.

### Results (`FA_LIVE_DURABLE_WAV=1 cargo test --test fa_durable_wav_live -- --nocapture`, after the fix)

```
fa_durable_wav_live: source audio = <repo>/.work-phase4/replay/173/audio_16k.wav
fa_durable_wav_live: expected cache dir = /Users/mohtashim/Library/Application Support/com.kinetix.pro-studio/fa-audio-cache
fa_durable_wav_live: app_local_data_dir() resolved to /Users/mohtashim/Library/Application Support/com.kinetix.pro-studio
fa_durable_wav_live[run1_miss]: wall_clock=73.767s
fa_durable_wav_live: cache file after run1 = .../fa-audio-cache/80b60165a480c31c12e1e046d1de4d2def3b03be0d5912fe1901a619d2a99995.wav (22688632 bytes, sha256=c6150bcf519b28eb6654b7247cf0fcf314445623594f3acc0f40da632b4f6153)
fa_durable_wav_live[run2_expected_hit]: wall_clock=78.141s
fa_durable_wav_live: PART A (full fa_align_dev, includes the ~1.2GiB model.onnx SHA-256 manifest-verification step that runs unconditionally on every call — a pre-existing D10 fixed cost, UNRELATED to the durable cache, expected to swamp the miss-vs-hit delta at this scale) run1(miss)=73.767s run2(hit)=78.141s content_identical=true mtime_restamped=true
fa_durable_wav_live: PART B (ensure_durable_wav direct, isolated from manifest verification) cache_path=.../fa-audio-cache/5690190d15c9ba6c348278bb1cc810bbe7a7a27ed5aad971333e345bcc9bde00.wav run1(miss)=0.158s run2(hit)=0.000s speedup=1538.2x content_identical=true mtime_restamped=true
fa_durable_wav_live: PASS
```

**Direct answers:**

- **Resolved cache directory path:** `/Users/mohtashim/Library/Application
  Support/com.kinetix.pro-studio/fa-audio-cache` — confirmed to match
  `app_local_data_dir()`'s own live-resolved value (asserted in the test),
  the exact production path `fa_model_path` (D2) already uses for
  `fa-models/`.
- **File written:** a single `.wav`, keyed by the SOURCE's own identity hash;
  22,688,632 bytes (matches the real 173 corpus's known size exactly).
- **Second run reuses, not re-transcodes:** proven three independent ways,
  not just asserted — (1) byte-identical SHA-256 content before/after run2,
  (2) the entry's mtime (artificially aged 1 hour before run2) is re-stamped
  forward past that artificial age, and (3) **wall-clock is the signal that
  actually distinguishes "skipped ffmpeg" from "ran it again and happened to
  produce the same bytes"**: Part B's isolated measurement shows
  run1(miss)=0.158s vs. run2(hit)=0.000s (**1538x**), and the live test
  asserts `run2 < run1/4` as a hard pass/fail gate, not just prints the ratio.
- **Wall-clock for both runs:** Part A (through the real `fa_align_dev`
  command) shows run1=73.767s / run2=78.141s — nearly identical, and that is
  itself an honest, important finding, not noise: `fa_align_dev`'s own
  `verify_model_manifest` step (D10) SHA-256-hashes the full ~1.2 GiB
  `model.onnx` unconditionally on EVERY call, a pre-existing fixed cost
  entirely unrelated to the durable cache, that dominates an end-to-end
  measurement at this scale and would have masked the real signal if Part B
  hadn't isolated it. Part B (calling `ensure_durable_wav` directly,
  bypassing manifest verification) is the clean measurement: 0.158s vs.
  0.000s.

## 2. A2 — atomicity and eviction

**(a) Is the `.tmp` file created in the destination directory, not a system
temp dir?** **Yes, confirmed** — `resolve_cache_entry`'s `tmp_path` is always
`cache_dir.join(".tmp").join(...)`, a child of `cache_dir`, same filesystem —
required for `finalize_cache_write`'s `fs::rename` to stay atomic (`rename`
is only atomic within one filesystem, not one directory). Asserted directly:
`resolve_cache_entry_tmp_path_lives_under_a_dot_tmp_subdir_of_cache_dir`
(`fa.rs`).

**(b) Two concurrent runs on the same source — does one clobber the other's
tmp file?** **Yes, this was a real bug, now fixed.** Before this slice,
`resolve_cache_entry` derived `tmp_path` deterministically from `key` alone
(`{key}.wav.tmp`) — two concurrent misses on the identical source would both
resolve to the SAME tmp path, and two real ffmpeg processes would then race
to write the same file: whichever `finalize_cache_write` rename ran first
could be clobbered mid-write by the other process still appending to that
now-renamed-away path, or the two writers' output could interleave,
corrupting the WAV a third caller might already be reading as a "finalized"
hit. **Fix:** `tmp_path` now carries a per-call UUID suffix (`uuid` already a
direct dependency — no new crate), so two concurrent misses on the same
source structurally cannot share a tmp file; each writer owns its own file
exclusively, so by the time either reaches `finalize_cache_write`, its own
tmp file is already a complete, valid transcode. Both callers' renames still
target the same `final_path`; a real filesystem `rename` is atomic, so the
second rename to complete simply replaces the first (last-writer-wins),
never a torn/partial file. Verified directly:
`resolve_cache_entry_concurrent_misses_on_the_same_source_get_distinct_tmp_paths`
(`fa.rs`) — two sequential `resolve_cache_entry` calls before either
finalizes get distinct tmp paths (the actual hazard is about the decision
each call makes independently, not about literal OS-thread concurrency, so a
sequential reproduction exercises the identical code path two real
concurrent async tasks would each hit), and the test drives both writers to
completion, confirming the final file ends up with one writer's COMPLETE
content, never an interleaved mix.

**(c) Does eviction actually fire past the 2 GiB cap, respecting LRU order,
without evicting an in-use entry?** **Yes, confirmed at the real cap.**
`evict_lru_until_under_cap_at_the_real_cap_respects_a_recent_touch_over_
creation_order` (`fa.rs`) uses the real `FA_AUDIO_CACHE_MAX_BYTES` constant
(2 GiB), not a scaled-down stand-in — three sparse files (`File::set_len`,
no bytes physically written, so this stays fast and disk-light while
`metadata().len()` still reports real logical sizes, the only thing eviction
ever reads) totaling 2500 MiB. One entry (1200 MiB) is created FIRST — the
natural LRU-eviction target by creation order — but its mtime is bumped to
"now" AFTER the other two are created, simulating a fresh hit
(`resolve_cache_entry`'s own re-stamp). Result: the entry nobody touched
again (the true oldest-by-mtime) is evicted; the artificially-touched entry
survives despite being oldest by creation; remaining total is confirmed
`<=` the real cap.

**(d) Stale source — does an edited file mint a new key and avoid serving the
old WAV?** **Yes, confirmed end-to-end**, not just at `source_identity_key`'s
own isolated level (already covered by D24's 2 tests).
`resolve_cache_entry_edited_source_is_a_miss_and_never_serves_the_old_final_
path` (`fa.rs`) writes a source, finalizes a "transcode," edits the source
(same path, different size), then confirms `resolve_cache_entry` on the
edited source returns a **Miss** with a **different** `final_path` — never a
`Hit` against the old entry — and that the OLD entry's own bytes are
completely untouched (not overwritten, not deleted): it is silently orphaned,
reclaimed only by LRU eviction eventually, exactly as `source_identity_key`'s
own doc comment already stated and this test now proves against the real
`resolve_cache_entry` code path, not just the key derivation in isolation.

## 3. A3 — chunk count under index attribution

**Confirmed live, re-run this slice**
(`SCRATCHPAD_DIR=... npx tsx scripts/dump-fa-chunk-plan-index-full709s.ts`):

```
[index-full-709s] audioDuration=709.01s segments=172 chunks=118 (max 27.92s) words=1645
```

**118 chunks**, matching D21/D22/D23/D24's own reported figure exactly — no
drift since D21.

**Why 118 (index) vs. 97 (time attribution, D11/D20) — same underlying
window structure, different text-attribution join.** `faChunkPlan.ts`'s own
doc comment (`runQiRanges`, line 388) records the real 709s corpus's total
run count directly: **149 runs**, of which **31 are zero-duration** (two
anchors agreeing on the same detected silence, producing a run with no
audio at all) — folded away identically under EITHER attribution mode
(`attributeByIndex`'s own doc comment: "mirroring `runsToChunks`'s own
existing empty-run rule so both attribution modes handle text-less windows
identically"). That leaves **149 − 31 = 118** runs with real audio — and
under index attribution, EVERY one of those 118 audio-bearing runs receives
non-empty text, because `attributeByIndex`'s join is exhaustive over the raw
script token stream by construction (every token's own `qi` places it in
exactly one run). Under time attribution, only 97 of those same 118
audio-bearing runs happen to CONTAIN some segment's own `startTime` — the
coarser, single-point join `runsToChunks` uses — so the other 21 runs
receive zero text and get folded into a neighboring chunk, collapsing the
emitted count to 97. **The chunk-COUNT difference is a direct, arithmetic
consequence of the attribution join's granularity (whole-segment-by-
startTime vs. per-token-by-qi), not a difference in the underlying window
structure — `computeRuns`/`computeFaAnchors` are unmodified and identical
inputs to both attribution modes.** Recorded here because, per this slice's
own task instruction, this exact number's drift (97 → 118, D11/D20 → D21)
has caused confusion twice already without this arithmetic identity being
written down anywhere.

## 4. B1 — R.5 reachability, read-only, no implementation

**What R.5 requires, quoted verbatim**
(`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md:1485-1489`):

> **R.5 — Unscripted audio inside a run.** Between consecutive segments
> inside a run, insert a CTC wildcard (`<star>` in MMS-FA; the equivalent
> free blank-run allowance in a `Wav2Vec2ForCTC` decode) that may absorb
> arbitrary audio at zero alignment cost. Audio absorbed by a wildcard
> belongs to **no** segment: the preceding segment ends at its own last
> word's end, the following segment starts at its own first word's start,
> and the wildcard span becomes an explicit, recorded gap.

**Trigger condition:** genuinely UNSCRIPTED spoken content — an ad-lib,
filler ("umm"), a false start, a breath, any real speech Whisper transcribed
that has no corresponding word in the SCRIPT text — occurring on the audio
timeline BETWEEN two segments that share the same forced-alignment run/chunk.
Owner decision D1 (`task5-integration-scope.md` §0: "D1 SCOPE = Option B,
full word-level timings, persisted in project data, with R.5 wildcards and
R.7 CONF_MIN fallback") mandates building this.

**Does D21's index-attribution fix eliminate this condition? No — it fixes a
different bug, at a different granularity, and does not touch the mechanism
R.5 needs.**

- **D21's fix was an ATTRIBUTION-JOIN bug**: which chunk a whole SEGMENT's
  text gets assigned to, when `segment.startTime` is a coarse, stale
  single-point join. Its symptom was CTC-INFEASIBILITY — an entire
  multi-word sentence assigned to a window too short to physically hold it
  (D20's `[18.08,18.70)` case: a 13-word sentence in a 0.62s window). Index
  attribution fixed WHICH text goes in WHICH window.
- **R.5 is a WITHIN-A-WINDOW content bug**: even a CORRECTLY-scoped chunk
  window can contain real spoken audio (a pause, an ad-lib) that has no
  script word at all. Nothing about fixing WHICH window gets WHICH text
  changes whether the text handed to that window is a complete, gap-free
  description of everything actually spoken inside it.
- **Multi-segment chunks are the norm today, not a rare edge case** — this
  slice's own A3 live run: **172 segments across 118 chunks**. By
  construction, at least 54 chunks contain 2+ segments' worth of
  concatenated text (`textsByRun[i]!.push(...)`/`textsByRun[rangeIdx]!.
  push(...)`, both attribution modes), joined with a plain space
  (`text = textsByRun[i]!.join(' ')`) — **segment boundaries do not survive
  into the text handed to Rust's CTC decode, under EITHER attribution mode,
  today.** If real unscripted audio sits between two segments sharing a
  run, the flat target sequence has no marker there at all — nowhere for
  R.5's wildcard to go even if one existed.
- **No wildcard/star-token mechanism exists anywhere in the Rust alignment
  core, confirmed by direct reading** (`grep -rn "wildcard\|R\.5\|<star>"
  src-tauri/src/fa_viterbi.rs src-tauri/src/fa_onnx.rs` → zero hits).
  `fa_viterbi.rs`'s own module doc comment confirms it is a line-by-line
  port of torchaudio's STANDARD CTC `forced_align` — the expanded label
  sequence is `blank/label/blank/label/.../blank`, ordinary CTC blanks
  between REAL consecutive target labels only. A standard blank is not a
  free-absorption wildcard: every symbol in the target sequence must still
  be matched somewhere, so genuinely unscripted audio (no corresponding
  target symbol at all) still gets silently absorbed into the timing of the
  nearest real word — exactly the failure mode R.5 exists to prevent, and
  exactly what happens today, unchanged by D21.

**Verdict: (i) — still reachable.** The case R.5 handles (real unscripted
audio between two segments sharing a chunk, forced onto a neighboring word's
timing because no wildcard exists to absorb it) is not merely un-eliminated
by index attribution — it is architecturally guaranteed to occur routinely,
since 172 segments distributed over 118 chunks means most chunks already
concatenate multiple segments' text today, and any real narration's natural
pauses/filler between them have nowhere to go but onto a neighboring word.

**The smallest implementation, for the record (not built this slice):** two
layers, not one, because segment boundaries are erased before they ever
reach the Rust decode step:

1. **`faChunkPlan.ts` (TS)**: `runsToChunks`/`attributeByIndex` would need to
   emit an ORDERED LIST of per-segment text spans per chunk (not a single
   `.join(' ')`'d string) — the `FaChunkInput` IPC shape (`fa.rs`) would need
   a `Vec<String>` (or equivalent per-segment breakdown) instead of one
   `text: String`, so the boundary information R.5 needs to place its
   wildcard actually survives past chunk planning.
2. **`fa_viterbi.rs`/`fa_onnx.rs` (Rust)**: the target-token construction
   (`text_to_token_ids`) and the Viterbi DP itself would need an explicit
   wildcard/free-transition state INSERTED at each segment-boundary position
   in the expanded label sequence — not the standard CTC blank (which still
   costs alignment probability and only sits between real labels), but a
   genuinely zero-cost, arbitrary-duration absorption state, closer to
   MMS-FA's own `<star>` token than anything `forced_align_impl`'s current
   port implements. This is new DP structure, not a parameter change.

Per this slice's own instruction, this is a finding for the owner, not an
implementation — no `faAnchors.ts`, `faTextNormalize.ts`, `syncConstants.ts`,
or Rust decode-core file was touched to build any part of this.

## 5. B2 — record

**R.2's edge-railing observation (D24 §1), restated plainly: observed, noted,
deliberately NOT pursued.** D24's own A1 diagnostic measured that padding
moved a real fraction of edge words away from their own chunk's hard
boundary — the fraction of edge words sitting within one frame (0.02s) of
their own boundary fell from 41.1% (unpadded) to 29.7% (padded), a genuine,
non-trivial reduction. This slice deliberately did not pursue building
anything around that reduction, for three stated reasons, not an oversight:
(1) R.2 itself is **CLOSED-NEGATIVE** (D24 §3) — the specific hypothesis that
motivated padding's existence (untokenized pad-region speech corrupting
edge-word decoding) was falsified outright, 0/236 violations, so any new
mechanism chasing the un-railing effect would need its OWN justification
from scratch, not inherited from R.2's now-dead rationale; (2) the same
measurement showed a near-even split (49.2% rose / 50.8% fell) in
edge-confidence direction — padding is not uniformly favorable, so "the
41%→30% reduction" is one favorable statistic sitting alongside an
unfavorable net result on the metric that actually gates output quality
(below-`CONF_MIN` tail, 155→164, D23); and (3) this slice's own scope is A1
(exercise the durable path) + A2 (atomicity/eviction) + A3 (chunk count) +
B1 (R.5 scoping) — re-opening a closed-negative track was explicitly
out of scope (task's own constraint: "no R.5 implementation, no R.7
threshold change... no gate flip"; R.2 re-litigation falls under the same
"stay in this slice's lane" spirit). D24's own report already named the
un-railing finding as *where a future slice should start* if it wants a
padding-shaped mechanism — this slice confirms that finding is still real,
still unpursued, and states the reason plainly rather than letting it decay
into an implicit "someone probably looked at this."

**Production-audio-path gap (`task5-slice-ledger.md` §6) — result.** D24
left `ensure_durable_wav` built but genuinely untested against a real
`AppHandle`. This slice (A1) wired it into `fa_align_dev` (the one caller
that exists, dev-only, console-invoked — unchanged from D10's own scope) and
proved it live against the real 173 corpus: resolved cache path matches
production's `app_local_data_dir()` exactly, a real ffmpeg transcode
produces the correct file, and a second call is a genuine cache hit (1538x
faster, byte-identical content, mtime re-stamped) — not a re-transcode that
happened to look like one. A real, previously-undetected bug (ffmpeg's own
filename-based format auto-detection failing against a `.tmp`-suffixed
output path) was caught and fixed by this exercise, and would have made
EVERY real transcode into the durable cache fail silently-into-error the
first time any real caller (the future capability-gated Settings-toggle
wiring) ever reached it. **Still has no PRODUCTION caller** — `fa_align_dev`
remains dev-only/console-invoked, `isFaGateOpen()` stays OFF, and the
capability-gated Settings-toggle slice (§4's ruling) is still what will
wire `ensure_durable_wav` into a real Apply-Sync path. What changed this
slice is confidence: the durable cache is now proven correct against a real
`AppHandle` and real I/O, not just its pure core in isolation.

**R.5 wildcards — still deferred, ruling unchanged, reachability now
established.** The `§4 Rulings` "ship without them initially" decision is
unaffected — this slice adds no implementation. What changes is the basis
for a future slice: R.5's own trigger condition (real unscripted audio
between segments sharing a run) is confirmed, by direct code reading and
the real corpus's own segment/chunk arithmetic, to still be fully reachable
under the current index-attribution chunked path — not eliminated by D21,
which fixed an unrelated (coarser-granularity) attribution bug. A future
slice building R.5 does not need to re-derive this; it needs §4's "smallest
implementation" sketch above and an owner ruling on the wildcard-gap
destination question (`sync-pipeline-v2-plan.md`'s own still-open
recommendation: assign the whole gap to the PRECEDING segment).

## 6. Full gate table

| Gate | Status |
|---|---|
| `isFaGateOpen()` capability+toggle gate (D17) | OFF by default, inert — no caller in any production path |
| `fa-inference` Cargo feature | OFF by default (not in default feature set) |
| `fa_align`/`fa_align_dev` production wiring | None — dev-only/console-invoked, unchanged from D10 |
| `computeFaChunkPlan` (TS live entry point, D23) | Unchanged this slice — still defaults to `'script-word-index'`; A3 re-confirms 118 chunks live |
| `align_chunked` | Unchanged this slice (not touched) |
| `ensure_durable_wav` / `fa_audio_cache_dir` (durable WAV cache) | **Wired into `fa_align_dev` this slice (A1)** — still no PRODUCTION (UI-reachable) caller; live-verified against a real `AppHandle`, real ffmpeg, and the real 173 corpus |
| `.tmp` write location/naming | **Fixed this slice (A1/A2a)** — moved to `cache_dir/.tmp/{key}.{uuid}.wav`, fixing a real ffmpeg format-auto-detection bug the previous `{key}.wav.tmp` naming caused |
| Concurrent-miss tmp-path collision | **Fixed this slice (A2b)** — tmp path now UUID-suffixed per call, structurally eliminating the shared-tmp-file race |
| R.5 (wildcard destination) | Unimplemented, unchanged — reachability scoped this slice (B1), verdict (i) still reachable, no code change |
| R.7 (needsReview flag) | Unchanged — schema + Rust computation only, no production writer or consumer |
| IPC wiring (chunk plan → `fa_align` → UI) | None, unchanged |
| `tsc --noEmit` | clean |
| `npm test` | 79 files, **1942 passed**, 1 pre-existing skip (1943 total) — unchanged from D24 (no TS file touched this slice) |
| Golden replay (`scripts/phase4-handoff-replay-sync.test.ts`) | **6/6** |
| Six `fa-e2e-alignment-*.json` fixtures | byte-identical (`git status --porcelain -- scripts/fixtures/` empty) |
| `cargo check --lib` (default) | clean |
| `cargo check --lib --features fa-inference` | clean |
| `cargo check --tests` (default, includes the new live-probe target) | clean |
| `cargo test --lib` (default) | **76 passed, 0 failed** (72 at D24 + 4 new A2 tests) |
| `cargo test --lib --features fa-inference` (no ORT) | **150 passed, 0 failed, 19 ignored** (146/19 at D24; +4 from A2, ignored count unchanged) |
| `cargo test --test fa_durable_wav_live` (default, `FA_LIVE_DURABLE_WAV` unset) | Skips immediately, as designed — no filesystem/Wry-runtime touch |
| `FA_LIVE_DURABLE_WAV=1 cargo test --test fa_durable_wav_live` | **PASS** — see §1's full output |
| `cargo clippy --all-targets --features fa-inference` | Same 4 pre-existing warnings D24 recorded (needless_return `fa.rs`, 8-arg `fa_dev.rs`, `flush_word` lifetime `fa_onnx.rs`, neg-multiply `fa_onnx.rs`), **0 new** — one incidental private-type-leak warning surfaced by widening `fa`/`fa_dev` to `pub mod` was found and fixed in the same pass (`FaModelCache`'s tuple field narrowed `pub` → `pub(crate)`), not left as a 5th pre-existing warning |
| Live zero-fallback regression guard (`fa_onnx::real_corpus_measurement::full_length_709s_index_attribution_single_call`, `ORT_REQUIRE=1`, real 173-project audio+model) | **wall_clock=74.4s chunks=118 words=1643 fallback=0** — 0 == 0, holds; matches D23/D24's own 72.8s/76.9s/76.1s figures within normal run-to-run variance; `align_chunked` untouched by this slice |
| Protected-files empty-diff | `git status --porcelain -- src/services/faAnchors.ts src/services/faTextNormalize.ts src/services/syncConstants.ts Cargo.lock src-tauri/Cargo.lock scripts/fixtures/ project-state.md CLAUDE.md docs/history.md src-tauri/src/whisper.rs` — empty |

**Empty-diff confirmation on protected files:** confirmed empty (see table's
last row) — `Cargo.lock`/`src-tauri/Cargo.lock` unaffected by the `test`
tauri feature (`test = []`, zero additional dependencies, verified by
`shasum -a 256` before/after). `whisper.rs` untouched — `ensure_durable_wav`
still calls its existing `transcode_to_wav` unmodified.

Files changed this slice: `src-tauri/Cargo.toml` (dev-dependency +
`[[test]]` target), `src-tauri/src/lib.rs` (`mod` → `pub mod` for `fa`/
`fa_dev`), `src-tauri/src/fa.rs` (tmp-path fix, concurrency fix, visibility
widening, 6 new tests), `src-tauri/src/fa_dev.rs` (routes through
`ensure_durable_wav`, content-addressed dev-input path), `src-tauri/tests/
fa_durable_wav_live.rs` (new), this document, and `docs/ws1-sync-pipeline/
task5-slice-ledger.md` (D25 row + gap-register updates).

## No R.5 implementation, no R.7 threshold change, no production writer of `faWordTimings`, no IPC wiring, no gate flip, no new crates

Zero new Rust dependencies (`Cargo.lock`/`src-tauri/Cargo.lock` both
untouched, confirmed above — `tauri`'s `test` feature and the `[[test]]`
target both reuse crates already in the dependency graph; the concurrency
fix reuses the already-direct `uuid` dependency). No IPC signature change
(grepped: no new `invoke()` call site anywhere in `src/`). No capability
gate touched, no Cargo feature default changed. `isFaGateOpen()` unchanged,
still OFF. `needsReview`/`faWordTimings` still have no production reader or
writer. Production behaviour is byte-identical at this slice's end for
every path any current caller reaches — `align_chunked` unchanged,
`fa_align`/`fa_align_dev`'s only caller is still the same dev-only console
path, and the durable-WAV-cache code (now WIRED, previously unwired) has no
UI-reachable caller either way.

## git status / git log against origin

At this slice's start, `git rev-list --left-right --count origin/main...HEAD`
was `0 0` (fully synced, `a89f70a`/D24 was `origin/main`'s HEAD). Committed
and pushed at the end of this slice, per the task's own "commit AND push
before the slice ends" instruction.
