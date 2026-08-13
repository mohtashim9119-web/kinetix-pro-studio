# WS1 Task 5, Slice D20 — CTC infeasibility in the chunked path

> All real-corpus numbers below are reproduced live on this machine against
> `.work-phase4/replay/173/` (gitignored, local-only), the same corpus D10–D19
> used. Nothing is carried forward from memory without a fresh run backing it.

## Step 0 — D19 committed and pushed

Committed `b7f1d0a` ("feat(fa): R.7 confidence fallback — needsReview flag,
WS1 Task 5 Slice D19"), pushed to `origin/main`. Gate table re-verified
immediately before committing (all matching D19's own reported numbers
exactly): `tsc --noEmit` clean; `npm test` 79 files, 1940 passed, 1
pre-existing skip; golden replay 6/6; `cargo test --lib` 63/63 (default);
`cargo test --lib --features fa-inference` 132/132 (13 ignored); `cargo
clippy --all-targets` — 2 pre-existing warnings only (`fa_dev.rs`'s
`fa_align_dev` arg count, `FaModelCache::default`'s unit-arg lint),
confirmed present at D18's own committed HEAD too via a stash/restore
check, so unrelated to this diff.

## Step 1 — corrected verdict (read-only)

**D19's verdict — "CTC failure is unreachable with correct text" — is
WRONG. Amended verdict: REACHABLE, with correct (non-shuffled) text, on the
production Rust chunked path. D19's own reachability claim rested on the
wrong artifact.**

Both facts the task asked to verify, confirmed by file:line:

- **Production is Rust, chunked, and unpadded.**
  [`src/services/faChunkPlan.ts:47`](../../src/services/faChunkPlan.ts#L47):
  `FaChunk`'s own doc comment — *"an audio time window (raw, unpadded — R.2
  padding is out of scope for this slice)"*. The chunk-plan windows this
  module produces are what `fa_onnx.rs`'s `align_chunked`
  (`src-tauri/src/fa_onnx.rs:875`) consumes one at a time, in Rust, with no
  padding added at any point between the two.
- **D19's `meta_fa.json` reachability check was Python, segment-level,
  padded.** `scripts/measure-forced-alignment.py:152-153` pads every
  segment's own window by `pad_sec` on both sides
  (`lo = segment.startTime - pad_sec`, `hi = segment.startTime +
  segment.duration + pad_sec`); `scripts/measure-forced-alignment.py:302-303`
  defaults `--pad-sec` to `3.0`. This is the script `meta_fa.json`'s own
  `cmd` field names (per D19 Step 1) — a fundamentally different windowing
  regime (padded, keyed to the segment's OWN committed span) than production's
  (unpadded, keyed to an independently-computed anchor-run window that need
  not have any particular relationship to a segment's own span — see Step 3).

**D11's own chunked run already found the failure, with correct text, eight
slices before D19 re-asked the question:**
[`docs/ws1-sync-pipeline/measurements/d11-chunked-alignment-2026-08-13.md:129`](measurements/d11-chunked-alignment-2026-08-13.md#L129):
`full_length_709s_windowed_sanity: wall_clock=132.1s chunks_ok=95/97
chunks_failed=2 words=1616 audio_duration=709.01s` — **2/97**, exactly the
count the task brief anticipated. This run used `computeFaChunkPlan`
(`scripts/dump-fa-chunk-plan.ts:93`, the plain `segment.startTime`-membership
rule, unchanged since D11) over `golden_baseline_segments.json`'s real
committed text — the SAME text the project actually has, not a shuffled
donor swap. "Correct text" in D19's Step 1 sense (not deliberately
mismatched) and "reachable" are not mutually exclusive; D19 conflated
"not deliberately mismatched" with "the production windowing regime,"
and only tested the latter's absence, not its presence.

**The padding confound, named explicitly:** D19's `meta_fa.json` run pads
every segment's window by 3s on each side — for a segment whose window would
otherwise be too narrow to fit its own text (exactly Step 3's mechanism,
below), 6 extra seconds of context is frequently enough to make the CTC
bound (`t >= l + r`) satisfiable even when the unpadded production window
would not be. D19's own Step 1 table further confirms this asymmetry
independently: its four MISMATCHED-run failures were all "shortest-audio
segments... forced against a donor's text 5–9x longer," a padding-window
mismatch of the same *shape* as D20's own root cause (Step 3) — the two
documents independently converged on the same underlying mechanism (a
window far shorter than the text's real acoustic extent) from two different
angles (deliberate donor-text mismatch vs. real committed-segment/anchor-run
mismatch) without D19 recognizing the connection, because D19 never ran the
unpadded, chunked, real-text path to see it.

## Step 2 — reproduction (real corpus)

Reproduces exactly. Chunk plan regenerated fresh
(`SCRATCHPAD_DIR=/tmp/fa-chunk-plans-d20 npx tsx scripts/dump-fa-chunk-plan.ts`
→ `audioDuration=709.01s segments=172 windowed chunks=97`, byte-identical
chunk count to D11) and run against the real ONNX model + real 709s audio
(`ORT_DYLIB_PATH=<repo>/.work-phase4/spike-runtime/onnxruntime-osx-x86_64-1.23.2/lib/libonnxruntime.dylib
FA_CHUNK_PLAN_DIR=/tmp/fa-chunk-plans-d20 cargo test --features fa-inference
-- --ignored --nocapture full_length_709s_windowed_sanity`):

```
full_length_709s_windowed_sanity: chunk 4 [18.08,18.70) FAILED (81 chars): forced alignment failed: targets length is too long for CTC. Found input length: 30, target length: 80, and number of repeats: 1
full_length_709s_windowed_sanity: chunk 52 [405.58,406.98) FAILED (77 chars): forced alignment failed: targets length is too long for CTC. Found input length: 69, target length: 76, and number of repeats: 0
full_length_709s_windowed_sanity: wall_clock=133.4s chunks_ok=95/97 chunks_failed=2 words=1616 audio_duration=709.01s
```

Wall-clock 133.4s (D11: 132.1s), peak RSS 2,534,510,592 bytes ≈ 2.36 GiB
(D11: 2.23 GiB) — both within normal run-to-run noise. **Identical failure
set, identical shapes, identical word count.** Per-chunk table:

| Chunk | Window | Duration | Chars | CTC input length (frames) | CTC target length (tokens) | Repeats | Bound violated by |
|---|---|---|---|---|---|---|---|
| 4 | `[18.08, 18.70)` | 0.62s | 81 | 30 | 80 | 1 | needs `t >= l+r` = 81; has 30 (51 short) |
| 52 | `[405.58, 406.98)` | 1.40s | 77 | 69 | 76 | 0 | needs `t >= l+r` = 76; has 69 (7 short) |

## Step 3 — cause

**Both are (i), seam mis-assignment — not (ii), genuinely dense text.
100% of the failures are attribution-caused. R.2 padding is therefore
correctly excluded per this slice's own constraint.**

**Method** (per D15's own diagnostic technique — compare each word's real
acoustic onset against the window it was attributed to; a word whose real
onset falls outside its own chunk's window is mis-assigned): identified the
committed segment `faChunkPlan.ts` attributed each failing chunk's FULL text
from (`golden_baseline_segments.json`, matched on `startTime` membership per
that module's own rule), then cross-referenced every word's real onset from
the corpus's real Whisper token timestamps (`transcript_tokens.json`).

- **Chunk 4** `[18.08, 18.70)`: segment 5 (`startTime=18.51`, `duration=4.65s`
  → real committed span `[18.51, 23.16)`) falls inside this 0.62s window by
  `startTime` alone, so its FULL text ("because the environment was already
  doing the killing before the enemy showed up.", 13 representable words) is
  attributed here — text matching `chunk4.text` exactly. Real Whisper onsets
  for those 13 words: `because@18.64` (the only word whose onset falls
  inside `[18.08,18.70)` at all, and even it ends at 19.02, past the
  window) through `up@22.93`. **12 of 13 words have a real onset entirely
  past the window's own end** — they acoustically belong to later chunks in
  the run structure, not chunk 4.
- **Chunk 52** `[405.58, 406.98)`: segment 101 (`startTime=406.76`,
  `duration=4.8s` → real committed span `[406.76, 411.56)`) falls inside
  this 1.40s window the same way; its full text ("It just became a problem
  with a physical solution rather than a tactical one.", 14 representable
  words) is attributed here. Real onsets: `just@406.9` (marginally inside,
  ends 407.06 — past the window) through `one@410.77`. **At least 12 of 14
  words have a real onset entirely past the window's own end.**

**Would removing the mis-assigned words bring each chunk under the bound?
Yes, decisively, in both cases.** Chunk 4's bound needs `t >= l+r`; its
80-token text is 51 tokens over the 30-frame budget. Trimming to only the
in-window content (`because`, 7 characters, ≈6–7 target tokens after
normalization) leaves enormous headroom under 30. Chunk 52 is short by only
7 tokens against a 69-frame budget — trimming to `just` (or even `it just`)
clears it outright. **Both failures are explained, and both would be fixed,
by correcting text attribution — not by adding acoustic content the window
doesn't have (ruling out (ii)).**

**Why this is not the same shape as D15's own finding, but is the same
mechanism at a different scale.** D15 measured *single boundary words*
mis-assigned across a run seam (~1 word per seam, 0.9% of a 569-word sample)
— a small, local effect. D20's two failures are *whole-segment* mis-
assignments: `faChunkPlan.ts`'s `segment.startTime`-membership rule has no
check that a run's `endSec` actually reaches far enough to contain the
segment's own real duration — when an anchor-verified run happens to be
much narrower than the stale committed segment whose `startTime` lands
inside it (exactly the scenario D11's own source-code FINDING comment
already named for chunk 4: "the segment whose committed startTime falls in
that window has a stale, imprecise OLD timing"), the ENTIRE segment's text
rides along, not just its boundary word. Same root class of bug (the
attribution rule trusts `startTime` membership without checking duration
compatibility), worse at the extreme.

**(iii) something else — ruled out.** No other candidate cause was found:
not a vocab/tokenization bug (both chunks' text tokenizes normally — see
Step 4's tests), not a model/ORT failure (the error is `AlignError`'s own
length precondition, checked before any ONNX output is even consulted —
`fa_viterbi.rs:145-154`), not corpus-specific noise (the D11 240s-excerpt
run hit the exact same chunk 4 for the exact same reason, at a different
audio-length cutoff).

## Step 4 — behaviour, then the build

**Recommended and implemented: skip the chunk's own alignment, fall back to
evenly-spaced placeholder timing across its own window, flag every one of
those words `needs_review` (the same signal a real low-confidence D19/R.7
word already carries), and continue the run** — never a silent drop, never
a whole-run abort over one bad window.

Weighing the three options the task named, at minimum:

- **Fail the run (status quo)** — rejected. D11/D20 both show this discards
  every chunk's real work (95/97 succeeding chunks, 1616 real words) over 2
  bad windows out of 97. For a ~12-minute real project, that is the entire
  alignment result lost to a single narrow anchor-run/stale-segment
  coincidence — a cost wildly disproportionate to the actual defect, and it
  would make R.7's whole `needs_review` mechanism moot for this corpus
  (there would be no successful run to attach the flag to).
- **Split the chunk and retry** — rejected. Step 3 establishes the cause is
  attribution (the wrong TEXT assigned to a window), not that the window
  itself needs subdividing — chunk 4's window is already only 0.62s; making
  it smaller cannot help, and there is no principled place to split a
  window that is already narrower than a single word's worth of audio. This
  option would be the right shape only if the cause were (ii) (genuinely
  too much audio for one pass), which Step 3 ruled out.
- **Skip the chunk and mark its words `needs_review`** — implemented. The
  only option that keeps `wordIndex` gapless (a hole in an index-keyed
  array is exactly what D19's own Step 2 already rejected for the
  low-confidence case, and the same argument applies here) while making
  the event completely unmissable to any consumer already reading the
  `needs_review` flag.

**Consequence for a consumer reading `faWordTimings`:** every word in a
CTC-infeasible chunk is present (no gap, no missing index), carries a
placeholder timestamp evenly spaced across the chunk's own real window
(never outside it — same-window guarantee `check_words_within_own_chunk`
already asserts for real alignment), and is unconditionally flagged
`needsReview: true` — indistinguishable, from the consumer's point of view,
from a real word D19's confidence gate flagged. A consumer that already
respects `needsReview` (filters it, highlights it, or defers to it) handles
this case with zero new code; a consumer that ignores the flag gets an
approximate-but-bounded timestamp rather than a crash, a silent drop, or a
lost run.

**Implementation** (`src-tauri/src/fa_onnx.rs`):

- `fallback_words_for_infeasible_chunk(chunk, lang, vocab) -> Vec<WordSpan>`
  — normalizes the chunk's own text via the same
  `normalize_for_forced_alignment` every other chunk's tokenization uses,
  keeps only representable words, and evenly spaces them across
  `[chunk.start_sec, chunk.end_sec)`. Empty representable-word input
  returns an empty `Vec`, not a panic (mirrors `merge_char_spans_to_words`'s
  own "no empty output" contract).
- `CTC_INFEASIBLE_FALLBACK_SCORE: f32 = f32::NEG_INFINITY` — `.exp() ==
  0.0` exactly (clean f32 underflow), unconditionally below `CONF_MIN`
  after `fa.rs::word_span_to_dto`'s IPC-boundary conversion, so every
  fallback word surfaces as `needs_review: true` through the EXISTING D19
  mechanism — no new field, no new wire shape.
- `align_chunked`'s per-chunk loop now matches on
  `align_chunk_samples`'s result: `Ok` unchanged; `Err(FaOnnxError::
  Align(AlignError::TooManyRepeats { .. }))` specifically logs the event
  (`eprintln!`, never silent) and extends `all_words` with the fallback
  instead of returning; every OTHER error variant (`Wav`, `OrtRun`,
  `EmptyTokenization`, `AlignError::EmptyTargets`, `Cancelled`, …) is
  UNCHANGED — still propagates and aborts the whole run, since none of
  those indicate the specific "text too long for this window" failure mode
  this fallback exists for.

**Tests — real chunks from Step 2, not fabricated** (`mod
ctc_infeasibility_fallback`, `fa_onnx.rs`): both `real_chunk_4()`/
`real_chunk_52()` fixtures are the exact (window, text) pairs from Step 2's
own reproduction.

- `real_infeasible_chunk_still_produces_a_ctc_error_this_slice_catches` —
  confirms both real chunks still trip `AlignError::TooManyRepeats` via the
  same length precondition the real ONNX run hit (no ORT needed —
  `forced_align`'s length check runs before touching emission values).
- `fallback_covers_every_representable_word_evenly_spaced_within_the_window`
  — word count matches the normalizer's own count; every word lies inside
  its chunk's window, in order, non-overlapping; every word's confidence is
  exactly `0.0`, below `CONF_MIN`.
- `fallback_produces_real_expected_word_text_for_chunk_4` — pins the exact
  13-word sequence.
- `fallback_on_empty_representable_text_returns_empty_not_a_panic` — digit-
  only text edge case.

**End-to-end validation, real corpus, single call** (new `#[ignore]`d
`full_length_709s_single_call_with_fallback_and_confidence_distribution`,
same module as D11's own real-corpus tests): calls `align_chunked` ONCE
with the full 97-chunk list — the shape a real (still-gated) production
caller would use, no per-chunk workaround — and now returns `Ok`:

```
fa_onnx::align_chunked: chunk 4 [18.08,18.70) is CTC-infeasible (input_length=30, target_length=80, num_repeats=1) — falling back to evenly-spaced placeholder timing, every word flagged needs_review; run continues
fa_onnx::align_chunked: chunk 52 [405.58,406.98) is CTC-infeasible (input_length=69, target_length=76, num_repeats=0) — falling back to evenly-spaced placeholder timing, every word flagged needs_review; run continues
full_length_709s_single_call_with_fallback_and_confidence_distribution: wall_clock=74.7s words=1643 (of which 27 are D20 CTC-infeasibility fallback placeholders) audio_duration=709.01s — single align_chunked call, no per-chunk workaround
full_length_709s_single_call_with_fallback_and_confidence_distribution: all hard structural invariants hold at full 709s length (single-call, fallback included).
```

1643 = 1616 genuinely-aligned words (matching D11/Step 2 exactly) + 27
fallback placeholders (13 for chunk 4 + 14 for chunk 52, matching Step 3's
own representable-word counts). All hard structural invariants
(`check_times_non_decreasing`, `check_no_overlap`,
`check_times_within_audio_bounds`, `check_confidence_in_unit_interval`)
pass over the combined output.

## Step 5 — CONF_MIN drift guard, and the required/optional question

**Drift guard implemented** (`fa::tests::conf_min_matches_sync_constants_ts_literal`,
`src-tauri/src/fa.rs`): reads `syncConstants.ts`'s own source text at test
time (read-only — the file itself is untouched, still off limits), extracts
the literal following `export const CONF_MIN = `, parses it, and asserts
equality against `fa.rs`'s own `CONF_MIN` constant. Unlike the
`FaErrorKind` exhaustive-match guard it's styled after (which fails to
*compile* on drift, because Rust's own type system can enforce
enum-variant exhaustiveness), a numeric literal in a `.ts` file has no
compile-time hook from Rust — this is the runtime equivalent: it fails the
*test*, not the *build*, but with the same "cannot silently ship a drift"
property. **Verified to actually catch drift**: temporarily changed `fa.rs`'s
`CONF_MIN` to `0.4`, confirmed the test fails with a clear message naming
both values, then reverted and confirmed it passes again clean.

**`needsReview` on `TranscriptToken`: optional**
(`src/types.ts:307`, `needsReview?: boolean`) — this was D19's own decision,
unchanged this slice, "same convention as `confidence`/`wordIndex`:
Whisper-sourced tokens never set it." Since it's optional, the "if
required, confirm every non-FA producer still compiles" branch does not
apply: TypeScript's structural typing means every existing
`TranscriptToken`-producing call site (Whisper's own token construction,
test fixtures, etc.) already satisfies the interface without setting the
field, and `tsc --noEmit` staying clean throughout this slice (Step 0's gate
table, re-verified after all Step 4/5 changes below) confirms nothing broke.

## Step 6 — Rust-side confidence distribution (real corpus)

Computed inside the same single-call test above, over the 1616 genuinely-
aligned words only (`score.is_finite()` — excludes the 27 fallback
placeholders' sentinel `NEG_INFINITY`, which would otherwise flood the low
end with a synthetic, not-model-produced value):

```
Rust-path confidence distribution over 1616 genuinely-aligned words (fallback excluded) —
min=0.0000 p1=0.0000 p50=0.0006 p90=0.9996 p99=1.0000 max=1.0000
fraction_below_0.3=0.6275 (1014/1616)
```

15 lowest: `(3.4e-9,"of") (6.3e-9,"the") (9.5e-9,"warp") (9.8e-9,"a")
(1.5e-8,"six") (1.6e-8,"exposure") (1.8e-8,"in") (1.9e-8,"by")
(2.4e-8,"mission") (2.6e-8,"before") (2.7e-8,"first") (2.8e-8,"knows")
(3.1e-8,"it") (3.8e-8,"place") (3.9e-8,"function")`. 15 highest: all in
`[0.99997, 0.99999]` — `"some", "terror", "being", "military", "exposure",
"being", "on", "a", "can", "the", "for", "soil", "itself", "who", "a"`.

**The distribution is sharply bimodal, not smoothly spread** — the vast
majority of mass sits either near `1.0` (p90 already at 0.9996) or within a
few orders of magnitude of `0.0` (p50 is `0.0006`, and the bottom
percentiles are down at `1e-8`–`1e-9`), with very little density in
between. This is consistent with CTC/wav2vec2-family models' known
tendency toward extremely peaked (over-confident) per-frame softmax output
— "right" and "wrong" both saturate, rather than producing a smooth
confidence gradient.

**Does the Python-derived baseline transfer? No.** D19's own cited figures
(1.8%/55.3%, its Step 1) come from `measure-forced-alignment.py`'s
torchaudio/MMS_FA pipeline — a completely different model family and
inference stack than production's Rust/ONNX jonatasgrosman wav2vec2 path.
This is the FIRST real-corpus measurement of the Rust path's own confidence
distribution (no prior D-slice ran this specific measurement — D9's
`exp(score) ∈ [0.730, 1.0]` finding was over short, clean e2e fixture clips,
not real narration audio run through the windowed/unpadded production
path). The two numbers are not comparable: **62.75% of genuinely-aligned
real words fall below the current `CONF_MIN` (0.3)** on the Rust path,
against a Python-side baseline of 1.8%. At face value, `CONF_MIN=0.3` as
currently set would flag the majority of a real Rust-path run's SUCCESSFUL
alignments as `needsReview`, which would make the flag close to
uninformative for this production model (most words would carry it,
diluting its use as a signal for the genuinely bad minority).

**Plausible contributing factor, not proven this slice:** production
windowing is deliberately unpadded (`faChunkPlan.ts:47`, R.2 explicitly out
of scope) — every one of the ~97 chunk boundaries in this 709s corpus cuts
audio context abruptly, and words sitting near a chunk edge lose acoustic
context a padded or whole-file pass would have had. This could plausibly
explain much of the low-confidence mass, but isolating window-edge
proximity as the dominant variable (vs. some other property of real
narration audio, e.g. background music/pacing) was not done this slice —
doing so would mean measuring confidence-vs-distance-from-chunk-boundary,
which is out of this slice's scope and is not needed to answer the
question asked (whether the baseline transfers — it does not).

**Recommendation: `CONF_MIN` needs re-examination against real Rust-path
statistics before R.7 is wired to any production consumer.** No change is
made to `CONF_MIN` this slice (`syncConstants.ts` is off limits, and no
consumer of `needsReview` exists yet to be affected by leaving it as-is —
Step 4's own gate table below confirms `needs_review` still has no
production reader anywhere). This is recorded as an open finding for
whichever future slice wires R.7 to a real consumer, not resolved here.

## Full gate table

| Gate | Status |
|---|---|
| `isFaGateOpen()` capability+toggle gate (D17) | OFF by default, inert — no caller in any production path |
| `fa-inference` Cargo feature | OFF by default (not in default feature set) |
| `fa_align`/`fa_align_dev` production wiring | None — only dev-only `__faDevAlign`, unreachable from any UI control or production build |
| `Project.faWordTimings` (D18) | Schema only — no production writer |
| `FaWordSpan.needsReview` / `TranscriptToken.needsReview` (D19) | Schema + Rust computation only — no production writer, no consumer that acts on the flag |
| `align_chunked`'s CTC-infeasibility fallback (D20, this slice) | Implemented in `fa_onnx.rs` only — reachable exclusively through `align_chunked`/`align_chunked_for_language`, both still called only from `fa.rs::fa_align`, itself still only reachable via the DEV-only `__faDevAlign` path |
| `conf_min_matches_sync_constants_ts_literal` drift guard (D20) | Implemented, verified to actually fail on drift, currently passing |
| R.2 (padding) | Unimplemented (correctly excluded — Step 3 found (i) dominant, not (ii)) |
| R.5 (wildcard destination) | Unimplemented |
| R.7 (CONF_MIN gate, fallback rule) | `needs_review` flag only (D19); this slice adds a SECOND source of `needs_review = true` (CTC-infeasibility fallback) reusing the same mechanism; `CONF_MIN`'s own calibration flagged as needing re-examination (Step 6), not changed |
| IPC wiring (chunk plan → `fa_align` → UI) | None |
| `tsc --noEmit` | clean |
| `npm test` | 79 files, 1940 passed, 1 pre-existing skip (unchanged by this slice — no TS files touched) |
| `cargo check --lib` (default) | clean |
| `cargo test --lib` (default, no `fa-inference`) | 63 passed, 0 failed (unchanged from D19 — this slice's new code is entirely feature-gated) |
| `cargo test --lib --features fa-inference` | 137 passed (+5 from D19's 132: 4 fallback tests + 1 drift-guard test), 0 failed, 14 ignored (+1 — the new real-corpus single-call test) |
| `cargo clippy --all-targets` | 2 pre-existing warnings only (confirmed present at D19's own committed HEAD, unrelated to this diff) |
| Golden replay (`scripts/phase4-handoff-replay-sync.test.ts`) | 6/6, unchanged — this slice touches no file the replay depends on |

## Empty-diff confirmation on protected files

`git status --porcelain -- src/services/faAnchors.ts
src/services/faTextNormalize.ts src/services/syncConstants.ts Cargo.lock
scripts/fixtures/ project-state.md CLAUDE.md docs/history.md` — empty.
Only `src-tauri/src/fa.rs` and `src-tauri/src/fa_onnx.rs` changed this
slice.

## No new crates; production byte-identical

Zero new Rust dependencies (`Cargo.lock` untouched, confirmed above). No
IPC signature change (`align_chunked`'s own signature, `FaChunkInput`,
`FaWordSpan` are all unchanged — the fallback is entirely internal to
`align_chunked`'s existing `Result<Vec<WordSpan>, FaOnnxError>` contract).
No new Cargo feature. No capability gate touched, no default flipped —
production behaviour is byte-identical, since every path this slice's code
runs on is still reachable only from `fa-inference`-feature-gated,
dev-only-invoked code with no production caller.

## git status / git log against origin

```
On branch main
Your branch is up to date with 'origin/main'.
Changes not staged for commit:
	modified:   src-tauri/src/fa.rs
	modified:   src-tauri/src/fa_onnx.rs
```

`git log --oneline -3` (before this slice's own commit): `b7f1d0a
feat(fa): R.7 confidence fallback — needsReview flag (WS1 Task 5 Slice
D19)`, `78a0d4d feat(fa): index-keyed word-timing schema...(D18)`, `6e3293c
feat(fa): capability + toggle gate...(D17)` — `b7f1d0a` is D19's own commit
from this slice's Step 0, confirmed pushed (`78a0d4d..b7f1d0a main ->
main`) before any Step 1+ work began.
