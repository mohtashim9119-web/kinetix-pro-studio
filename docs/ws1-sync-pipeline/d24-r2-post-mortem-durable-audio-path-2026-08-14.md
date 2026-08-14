# WS1 Task 5, Slice D24 — R.2 padding post-mortem (Track A), durable FA audio path (Track B)

> Track A (this document's own §1-§3) reproduces every number directly from
> the JSON already on disk under `$FA_CHUNK_PLAN_DIR=/tmp/fa-chunk-plans-d22`
> from D23's own `full_709s_padding_before_after` run
> (`173-full-709s-index-windowed.json`, `173-full-709s-index-unpadded-
> words.json`, `173-full-709s-index-padded-words.json`) — no new alignment
> run, per this slice's own instruction. Track B (§4) is new Rust code,
> verified live against `cargo test`/`cargo check`/`cargo clippy` both
> feature configurations.

## 1. A1 — smear diagnostic: does untokenized pad speech explain the churn?

**Direct answer: NO — smear (a word's decoded timestamp extending into the
padded, untokenized region) is architecturally impossible by construction,
confirmed empirically at 0/236 checks.**

**Why it's impossible, not just untested.** `align_chunk_samples_padded`
(`fa_onnx.rs`, now deleted — see §3) ran the forward pass over the padded
sample buffer for real acoustic context, but then sliced the resulting
emission back down to *exactly* the unpadded chunk's own measured frame
count (`frames_before..slice_end`, `slice_end - frames_before ==
unpadded_frame_count`) **before** handing it to `forced_align`. The Viterbi
decode step therefore never saw a frame outside `[chunk.start_sec,
chunk.end_sec)` in either run — a decoded word's start/end time cannot
structurally exceed its own chunk's window, padded or not. This was already
implied by D23's own Step 5 invariant table (`WordOutsideOwnChunkWindow`
held for both runs), but D23 did not connect that fact to the smear
hypothesis directly — this slice does.

**Empirical confirmation (`d24_smear_diagnostic.py`, ad-hoc analysis script
over the three on-disk JSON files, not a committed test — same convention
D23's own "granular post-hoc breakdown" used).** For every one of the 118
chunks' own first and last word (236 edge-word checks total, both runs):

```
chunks=118 words=1643 edge_word_slots=236
[unpadded] escape-beyond-own-window violations: 0 / 236
[padded]   escape-beyond-own-window violations: 0 / 236
```

Zero violations in either run. The literal mechanism the task's own
hypothesis proposed — decoded output landing inside the untokenized pad
region because the model "sees" real neighbouring speech it has no token
for — cannot happen, and does not happen.

**What the padded run's own edge words show instead (a related but
distinct effect, reported here since it is the honest positive finding
underneath the negative one above):**

```
edge words (first+last per chunk) = 236
confidence rose: 116 (49.2%)  fell: 120 (50.8%)  same: 0

  [ROSE] n=116  edge-dist(unpadded) p50=0.0200 p90=0.4800  edge-dist(padded) p50=0.1000 p90=0.5000
       delta_dist(padded-unpadded): p50=0.0000 p90=0.1600 min=-0.3800 max=0.8400
       moved TOWARD boundary (closer to pad): 6 (5.2%)  moved AWAY: 43 (37.1%)
  [FELL] n=120  edge-dist(unpadded) p50=0.2200 p90=0.5400  edge-dist(padded) p50=0.2400 p90=0.5400
       delta_dist(padded-unpadded): p50=0.0000 p90=0.0000 min=-0.6000 max=0.4000
       moved TOWARD boundary (closer to pad): 9 (7.5%)  moved AWAY: 10 (8.3%)

edge words within one frame (0.02s) of their own chunk boundary:
  unpadded=97/236 (41.1%)  padded=70/236 (29.7%)

timing |delta| (padded vs unpadded): interior words (n=1407) p50=0.0000 p90=0.0000 max=0.6000
timing |delta| (padded vs unpadded): edge words     (n=236)  p50=0.0000 p90=0.1600 max=0.8400
```

Three things this rules out, directly:

1. **Not a railing/pileup effect either.** If untokenized pad speech were
   pushing edge words INTO the boundary (the "smear, but structurally
   clamped at the wall" variant of the same hypothesis), the fraction of
   edge words sitting within one frame of their own boundary should have
   *risen* under padding. It *fell*: 41.1% → 29.7%. Padding measurably moves
   edge words AWAY from the artificial hard edge more often than toward it
   (37.1% away vs. 5.2% toward, in the confidence-rose group specifically) —
   the opposite of what a pad-speech-pileup mechanism would predict.
2. **Confidence direction at the edges is a near-even split (49.2%/50.8%)**,
   not the 70/30-favoring-improvement split D23 Step 4's own post-hoc
   breakdown found *specifically within the below-CONF_MIN tail population*.
   This is a different population (all 236 edge-word slots vs. D23's 155
   below-threshold words) and the two figures are not in tension — they
   measure different things — but it confirms the edge-word effect is not
   uniformly favorable even before any threshold is applied.
3. **Interior words are essentially untouched** (p50/p90 both 0.0000s),
   matching D23's own finding exactly — the perturbation stays where it
   should, at the chunk seams, regardless of direction.

**Conclusion:** the acoustic-context change from padding genuinely shifts
the Viterbi path's chosen boundary WITHIN the true window near an edge —
sometimes correcting a hard-edge artifact (the un-railing effect above),
sometimes not — but this is ordinary context-sensitivity of the emission
distribution, not "speech with no token leaking into the decoded output."
The task's own specific hypothesis is falsified, not merely unconfirmed.

## 2. A2 — amount ladder: not run

Per the task's own instruction ("only if A1 is inconclusive"). A1 gave a
direct, code-structural, empirically-confirmed NO — the proposed mechanism
(untokenized pad speech being mistaken for token content) cannot occur
regardless of padding amount, since decode never sees pad-region frames at
any padding value `> 0`. A wrong-amount-vs-wrong-mechanism ladder has
nothing to discriminate once the mechanism itself is ruled out structurally
rather than merely by an unfavorable net result at one amount.

## 3. A3 — verdict and disposal: CLOSED-NEGATIVE, code deleted

**No fixable cause was identified.** A1 did not find a bug in the padding
implementation to fix — it found that the hypothesis motivating R.2's
existence (D22 Step 4's seam-proximity correlation, reinterpreted as
"untokenized pad speech corrupts edge decoding") does not describe a real,
fixable mechanism. D23 Step 4's own measured net-unfavorable result (155→164
below-CONF_MIN, 83.9%→85.4% seam concentration) is not a tuning miss this
slice can point at a "smallest fix" for — the acoustic-context-sensitivity
effect underneath it is a property of the model's own emission distribution
near a hard edge, not a defect in `align_chunked_with_padding`'s
implementation.

**Disposed per the task's own instruction: `align_chunked_with_padding`,
`align_chunk_samples_padded`, `FA_R2_DEFAULT_PADDING_SEC`, and their section
doc comment were deleted from `fa_onnx.rs` (were lines 930-1108), along with
the padding-specific harness inside `d23_measurement`
(`chunk_index_for_time`, `seam_adjacent_fraction`,
`full_709s_padding_before_after`, were lines 3852-4025) — `d23_measurement`
itself, and its OTHER test (`direct_correlation_index_attribution_240s`,
Step 3's direct-correlation measurement — unrelated to padding), are
unchanged and remain.** `align_chunked` — the only path any production or
test caller invokes — was never modified by R.2's addition and is
unaffected by its removal; re-verified live below.

**R.2 ledger status: CLOSED-NEGATIVE.** Recorded in
`docs/ws1-sync-pipeline/task5-slice-ledger.md`'s Known-gap register (§6),
cross-referenced here. R.2 is not "deferred" or "out of scope" (its pre-D22
status) — it was implemented, measured on real corpus data, and the
specific mechanism motivating it was directly falsified. A future slice
revisiting edge-of-chunk timing degradation should NOT re-attempt symmetric
context padding under this same hypothesis; it should start from the
un-railing/context-sensitivity finding in §1 above if it wants a padding-
shaped mechanism, or pursue a genuinely different mechanism (D23's own
flagged, unexplored confound: the zero-mean/unit-variance normalization
step is computed over the padded window's own samples, not the unpadded
one — still an open question, restated here since R.2's deletion does not
resolve it, it just removes the code that would let anyone probe it further
without re-deriving the padded-forward-pass machinery from scratch).

**Live re-verification after deletion** (both required — `align_chunked`
untouched by the removal, and the whole crate still builds/tests clean):

| Check | Result |
|---|---|
| `cargo check --lib` (default) | clean |
| `cargo check --lib --features fa-inference` | clean |
| `cargo test --lib` (default) | **72 passed, 0 failed** (was 63 at D23 — see §4 for the +9 new Track B tests; 0 from the deletion, since the deleted tests were `#[ignore]`d and never counted toward "passed") |
| `cargo test --lib --features fa-inference` (no ORT) | **146 passed, 0 failed, 19 ignored** (was 137 passed/20 ignored at D23 — ignored count drops by exactly 1, the deleted `full_709s_padding_before_after`; +9 passed from Track B) |
| `cargo clippy --all-targets --features fa-inference` | Same 4 pre-existing warnings D23 already recorded (line numbers shifted by the deletion/addition — `fa.rs` unneeded-return, `fa_dev.rs` 8-arg, `fa_onnx.rs` `flush_word` lifetime, `fa_onnx.rs` neg-multiply); the padding-specific 8-arg-signature warning D23's own gate table recorded is gone with the deleted function; **0 new** |
| Live regression guard, re-run after deletion (`fa_onnx::real_corpus_measurement::full_length_709s_index_attribution_single_call`, `ORT_REQUIRE=1`, real 173-project audio+model) | `wall_clock=76.1s chunks=118 words=1643 fallback=0` — 0 == 0, holds; matches D23 Step 1's own `72.8s`/`76.9s` figures within normal run-to-run variance |
| Six `fa-e2e-alignment-*.json` fixtures | byte-identical (`git status --porcelain` empty) |
| `grep -rn "align_chunked_with_padding\|FA_R2_DEFAULT_PADDING_SEC"` across `src-tauri/src/`, `scripts/`, `docs/` | Only the D23 historical report doc itself (a dated record — left as-is, matching this project's own "report plainly" convention: the report describes what D23 did AT THE TIME, not current state) |

## 4. B1 — durable transcoded-audio path

**Where it resolves.** `app_local_data_dir()/fa-audio-cache/<key>.wav`
(`fa.rs`'s new `fa_audio_cache_dir_from_local_data_dir` /
`fa_audio_cache_dir`), mirroring `fa_model_path`'s own `app_local_data_dir`
resolution precedent (R-D) rather than a new convention. Unlike
`fa_model_path`'s two-tier ladder (managed location, then a manual-
placement fallback — because a MODEL is something the user places by hand),
this cache has exactly one location, because nothing external ever places a
transcoded WAV by hand; the app is the only writer.

**How it's produced.** `ensure_durable_wav(app, source_path)` (new,
`fa.rs`, `pub(crate) async`) calls `whisper.rs::transcode_to_wav`
UNCHANGED (Track B does not modify `whisper.rs`, confirmed empty diff
below) — the exact same helper `whisper_transcribe` and `fa_align_dev`
already use — writing to a `.tmp` sibling of the final cache path first,
then renaming into place only after a successful transcode (never leaves a
partial/corrupt `.wav` for a later caller to trust), then running the
retention pass (§B2). On a cache hit, `ensure_durable_wav` never spawns
ffmpeg at all.

**Split for testability**, mirroring this file's own established
`fa_model_candidate_paths`/`resolve_existing` (pure core) vs. `fa_model_path`
(thin `AppHandle` wrapper) pattern:

- `fa_audio_cache_dir_from_local_data_dir` (pure path builder)
- `source_identity_key` (pure, stats a real file — see B2)
- `resolve_cache_entry` (pure hit/miss decision + mtime re-stamp on hit)
- `finalize_cache_write` (pure rename-into-place + eviction trigger)
- `evict_lru_until_under_cap` (pure retention pass — see B2)
- `fa_audio_cache_dir` / `ensure_durable_wav` (the two `AppHandle`-based thin
  wrappers — genuinely untested directly, same as `fa_model_path` itself;
  this codebase has no `AppHandle` test-mocking precedent anywhere, grepped)

## B2 — retention policy

**Key: source-file identity — `"{filename}|{size_bytes}|{mtime_unix}"`,
SHA-256-hashed into the cache filename.** This deliberately mirrors this
codebase's OWN existing, already-ratified precedent for exactly this class
of problem: `syncEngine.ts`'s `getFileIdentity(file) = "${file.name}|
${file.size}|${file.lastModified}"`, which `CLAUDE.md` records as a standing
invariant ("Transcription cache validity is keyed by file identity, not
asset id"). Rejected alternative — a full content hash — would be more
robust to a same-identity-but-different-bytes edge case, but this codebase
already decided name+size+mtime is what "the same source media" means for
transcription-cache invalidation, and hashing a multi-hundred-MiB source
media file in full on every FA run is real, avoidable cost a `stat()` call
is not. The identity string itself is hashed (not used as the literal
filename) only because a source filename can contain characters that are
not a safe/portable single path segment on every target OS — the
name+size+mtime *semantics* are what's being reused, not the literal string
shape.

**Eviction: bounded LRU, 2 GiB cap, applied opportunistically after every
cache WRITE (never on a hit).** "Least-recently-used" is the cache entry's
own file mtime: a hit re-stamps it to "now" (`resolve_cache_entry`, via
`File::set_modified` — stable since Rust 1.75, this crate's own
`rust-version = "1.77.2"` already requires at least that, so no new crate
was needed for this). An entry nothing has looked up in a while — including
one orphaned by a changed source identity, see below — ages toward
eviction along with everything else; there is no separate "orphan" code
path. 2 GiB was chosen the same stated-order-of-magnitude way this
codebase's other budget constants are (not a measured optimum): a 16kHz
mono WAV runs ~1.83 MiB/minute, so 2 GiB covers roughly 18 hours of cached
source audio.

**Stale source, the direct answer:** if the source file is edited in place
(same path, different size/mtime), its identity string changes, so it
hashes to a DIFFERENT cache key. The cache is never served stale and never
overwritten in place — a changed source simply produces a fresh entry under
a fresh key on its next `ensure_durable_wav` call, and the OLD entry is
silently orphaned (never looked up again under the new identity) rather
than needing an explicit invalidation step. This layer has no reverse index
from an old identity back to a project/asset, so it cannot safely delete an
orphan any sooner than the LRU cap reclaims it — an explicit, stated
trade-off, not a silently-resolved one: a future slice that needs prompter
orphan cleanup would need to thread a project/asset-aware invalidation
signal down to this layer, which does not exist today and was out of this
slice's scope to invent.

## B3 — reachability proof

`ensure_durable_wav` and `fa_audio_cache_dir` themselves are not directly
unit-tested — this codebase has no `AppHandle` test-mocking precedent
anywhere (grepped), matching `fa_model_path`'s own pre-existing,
untested-wrapper convention. Instead, every PURE/sync function the async
entry point delegates to is exercised end-to-end with real temp
files/directories in `fa.rs`'s new "durable WAV cache" test section (9 new
tests):

- `fa_audio_cache_dir_is_a_sibling_of_fa_models_not_shared_with_it` — path
  resolution.
- `source_identity_key_stable_for_an_unchanged_file` /
  `_changes_when_file_size_changes` / `_changes_when_mtime_changes_at_same_size`
  — the retention key's own stability/sensitivity.
- `resolve_cache_entry_misses_then_hits_after_finalize` — the full
  miss → (stand-in transcode) → finalize → hit cycle, real files, no ffmpeg.
- `resolve_cache_entry_hit_re_stamps_mtime` — the LRU freshness signal.
- `evict_lru_until_under_cap_removes_oldest_first_until_under_budget`,
  `_ignores_non_wav_entries`, `_noop_when_already_under_budget` — the
  retention policy's own three load-bearing behaviors.

This is the entire cache pipeline minus the single line that spawns the
ffmpeg sidecar (`crate::whisper::transcode_to_wav`, itself already covered
by `whisper.rs`'s own existing production usage — untouched by this slice).
All 9 pass; see the gate table (§5) for the full before/after counts.

**No caller added.** Grepped `src-tauri/src/` and `src/` for
`ensure_durable_wav` — the only occurrences are the function's own
definition and its 9 tests. `fa_align`, `fa_align_dev`, and `lib.rs`'s
`invoke_handler!` registration list are all unmodified. `isFaGateOpen()`
stays OFF, unreached by anything this slice added.

## 5. Full gate table

| Gate | Status |
|---|---|
| `isFaGateOpen()` capability+toggle gate (D17) | OFF by default, inert — no caller in any production path |
| `fa-inference` Cargo feature | OFF by default (not in default feature set) |
| `fa_align`/`fa_align_dev` production wiring | None — unchanged from D23 |
| `computeFaChunkPlan` (TS live entry point, D23) | Unchanged this slice — still defaults to `'script-word-index'` |
| `align_chunked` | **Unchanged, byte-identical** — the R.2 deletion never touched it; live regression guard re-run, 0/1643 fallback holds |
| `align_chunked_with_padding` / `align_chunk_samples_padded` / `FA_R2_DEFAULT_PADDING_SEC` (R.2) | **DELETED this slice** — see §3. R.2 is CLOSED-NEGATIVE, not deferred/out-of-scope |
| `ensure_durable_wav` / `fa_audio_cache_dir` / durable WAV cache (B1/B2, this slice) | New, entirely unwired — no production/script/test caller invokes it outside `cargo test`'s own pure-function coverage (§B3); `fa-audio-cache/` never created by any live path |
| R.5 (wildcard destination) | Unimplemented, unchanged |
| R.7 (needsReview flag) | Unchanged — schema + Rust computation only, no production writer or consumer |
| IPC wiring (chunk plan → `fa_align` → UI) | None, unchanged |
| `tsc --noEmit` | clean |
| `npm test` | 79 files, **1942 passed**, 1 pre-existing skip (1943 total) — unchanged from D23 (no TS file touched this slice) |
| Golden replay (`scripts/phase4-handoff-replay-sync.test.ts`) | **6/6** |
| Six `fa-e2e-alignment-*.json` fixtures | byte-identical (`git status --porcelain` empty) |
| `cargo check --lib` (default) | clean |
| `cargo check --lib --features fa-inference` | clean |
| `cargo test --lib` (default) | **72 passed, 0 failed** (63 at D23 + 9 new Track B tests) |
| `cargo test --lib --features fa-inference` (no ORT) | **146 passed, 0 failed, 19 ignored** (137/20 at D23; +9 passed, -1 ignored from the deleted padding harness) |
| `cargo clippy --all-targets --features fa-inference` | Same 4 pre-existing warnings D23 recorded (shifted line numbers), **0 new** |
| Live zero-fallback regression guard, re-run after deletion | **0/1643, holds** (wall_clock=76.1s, matches D23's own figures within normal variance) |

**Empty-diff confirmation on protected files:** `git status --porcelain --
src/services/faAnchors.ts src/services/faTextNormalize.ts
src/services/syncConstants.ts Cargo.lock src-tauri/Cargo.lock
scripts/fixtures/ project-state.md CLAUDE.md docs/history.md
src-tauri/src/whisper.rs` — empty (the last path is Track B's own read-only
constraint on `whisper.rs`, verified in addition to the task's own protected
list).

Files changed this slice: `src-tauri/src/fa_onnx.rs` (R.2 deletion),
`src-tauri/src/fa.rs` (B1/B2/B3 durable WAV cache, unwired), this document,
and `docs/ws1-sync-pipeline/task5-slice-ledger.md` (R.2 status update).

## No R.5, no R.7 wiring/threshold ratification, no production writer of `faWordTimings`, no IPC wiring, no gate flip, no new crates

Zero new Rust dependencies (`Cargo.lock`/`src-tauri/Cargo.lock` both
untouched, confirmed above — `File::set_modified` is a Rust 1.75+ std API,
not a crate; the cache key hash reuses the existing hand-rolled
`sha256.rs`). No IPC signature change (grepped: no new `invoke()` call site
anywhere in `src/`). No capability gate touched, no Cargo feature default
changed. `isFaGateOpen()` unchanged, still OFF. `needsReview`/
`faWordTimings` still have no production reader or writer. Production
behaviour is byte-identical at this slice's end for every path any current
caller reaches — `align_chunked` unchanged, and the new durable-WAV-cache
code has no caller at all.

## git status / git log against origin

At this slice's start, `git rev-list --left-right --count origin/main...HEAD`
was `0 0` (fully synced, `3f2b9e6`/D23 was `origin/main`'s HEAD). Committed
and pushed at the end of this slice, per the task's own "commit AND push
before the slice ends" instruction.
