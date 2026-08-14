# WS1 Task 5, Slice D23 — make the flip real, race guard, R.2 padding

> All real-corpus numbers below are reproduced live on this machine against
> `.work-phase4/replay/173/` (gitignored, local-only) and the cached
> whole-file 240s reference in `$FA_CHUNK_PLAN_DIR=/tmp/fa-chunk-plans-d22`
> (the same directory D22 used — reused deliberately so the cached reference
> did not need recomputing except where this slice's own Step 2 explicitly
> forced a cold-cache re-run to prove the race guard). Nothing is carried
> forward from memory without a fresh run backing it.

## Step 1 — is the flip live? Answer: NO, and now it is

**`computeFaChunkPlan` did not delegate.** D22 itself said so plainly in its
own gate table: "`computeFaChunkPlan` — the ONLY function any current
production/script/test caller actually invokes for real work — is a
SEPARATE code path (`computeRuns` + `runsToChunks`, hardcoded to
segment-start-time) and is untouched" (`d22-attribution-default-tail-
2026-08-14.md`, Step 2). Confirmed again directly this slice, before making
any change (`src/services/faChunkPlan.ts:225-233`, pre-D23):

```ts
export function computeFaChunkPlan(
  segments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
): FaChunk[] {
  const runs = computeRuns(segments, tokens, silences, audioDuration);
  return runsToChunks(runs, segments);
}
```

No call to `computeFaChunkPlanWithAttribution` anywhere in this body. D22's
default flip therefore changed **zero** existing call sites' behavior, exactly
as D22's own report said — the flip was real inside
`computeFaChunkPlanWithAttribution` but never reached the one function
(`computeFaChunkPlan`) that `App.tsx`'s dev-only `__faDevAlign` path,
`scripts/dump-fa-chunk-plan.ts`, and `scripts/fa-run-distribution.ts` all
actually call.

**Fix** (`src/services/faChunkPlan.ts`): `computeFaChunkPlan` now delegates:

```ts
export function computeFaChunkPlan(
  segments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
  attribution: FaTextAttribution = 'script-word-index',
): FaChunk[] {
  return computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, attribution);
}
```

`'segment-start-time'` remains fully reachable as the 5th argument — nothing
removes the old rule, and `computeFaChunkPlanWithAttribution`'s own
`'segment-start-time'` branch was already proven byte-identical to
`computeFaChunkPlan`'s pre-D23 body (`faChunkPlan.test.ts`, since Slice D13).

**Every existing 4-argument call site now gets index attribution without its
own call changing**, per this slice's own instruction — this is the intended
effect, not a bug:
- `App.tsx`'s dev-only `__faDevAlign` path (unreachable from any UI control
  or production build; `isFaGateOpen()` stays OFF regardless — see gate
  table). Comment updated in place to describe the new default.
- Two scripts (`scripts/dump-fa-chunk-plan.ts`,
  `scripts/fa-run-distribution.ts`) whose own documented purpose is
  specifically the TIME-attribution baseline (`*-windowed.json` artifacts
  other Rust measurement tests read by hardcoded path, and
  `emptyRunCount`'s segment-start-time-specific reconciliation, respectively)
  were **pinned to `'segment-start-time'` explicitly** so an implicit call
  there does not silently change what those artifacts mean. This is a
  deliberate, minimal safety fix, not scope creep: without it, re-running
  either script after this slice would silently corrupt the meaning of
  `173-excerpt-240s-windowed.json`/`173-full-709s-windowed.json` (used by
  D11-era measurements as the segment-start-time reference).

**Test fixes.** Three pre-existing tests in the `computeFaChunkPlan` describe
block asserted properties that were true only under segment-start-time
attribution (whole-segment text atomicity; a dense-anchor MAX_RUN_SEC bound
calibrated against `runsToChunks`'s own empty-run merge rule) — pinned to
`'segment-start-time'` explicitly, with a comment explaining why each no
longer generalizes to index attribution (anchors can legitimately cut a
segment's own last word into the next chunk — exactly what the adjacent
"cuts text at an anchor even when it falls mid-segment" test already
demonstrates). Two more tests (`computeFaChunkPlanCoalesced`'s baseline
comparison, and a "same word multiset as unmerged time-attributed plan"
assertion) were pinned for correctness even though they happened to still
pass, since leaving them unpinned would make their own descriptions
inaccurate. New test added: `'WS1 Task 5 Slice D23: computeFaChunkPlan
itself defaults to script-word-index (the flip is live)'` — asserts the
no-argument call is byte-identical to both `computeFaChunkPlan(..., 'script-
word-index')` and `computeFaChunkPlanWithAttribution(..., 'script-word-
index')`, and NOT equal to `computeFaChunkPlan(..., 'segment-start-time')` —
directly proving the flip reached the live entry point.

### Step 1 verification

| Check | Result |
|---|---|
| `npm run lint` (`tsc --noEmit`) | clean |
| `npm test` | 79 files, **1942 passed**, 1 pre-existing skip (1943 total; +1 net new test) |
| Golden replay (`scripts/phase4-handoff-replay-sync.test.ts`) | **6/6** |
| Six `fa-e2e-alignment-*.json` fixtures | byte-identical (`git status --porcelain` empty) |
| Zero-fallback regression guard (`fa_onnx::real_corpus_measurement::full_length_709s_index_attribution_single_call`, re-run live) | **wall_clock=72.8s chunks=118 words=1643 fallback=0** — 0 == 0, holds |

## Step 2 — guard the race in code

**The hazard** (D22's own report, quoted): two `d22_measurement` tests
(`mis_assignment_filtered_correlation_240s`,
`full_709s_index_attribution_tail_characterization`) both call
`whole_file_reference_240s`; on a cold cache, both can observe the cache
miss and both start computing the ~20GiB whole-file reference
CONCURRENTLY, driving the 32GiB machine into 23GiB+ of swap and a 30+
minute uninterruptible-I/O stall. D22's own fix was `--test-threads=1` — an
invocation flag, not a code change, that CI (or any future local run) will
not remember to pass.

**Fix** (`src-tauri/src/fa_onnx.rs`): a new `pub static
WHOLE_FILE_REFERENCE_LOCK: Mutex<()>` in the `require_ort` module, sibling
to `ORT_ENV_LOCK` (D6's own precedent — same file, same pattern: a
process-global `Mutex<()>` guarding a critical section against concurrent
threads in the same `cargo test` invocation). Every one of the four
duplicated `whole_file_reference_240s` copies (`d12_measurement`,
`d13_measurement`, `d21_measurement`, `d22_measurement` — this module's own
established "duplicated rather than imported" convention) now acquires this
lock for its ENTIRE check-cache-or-compute-and-write body. First caller
computes and writes the cache file while holding the lock; a second,
concurrent caller blocks, then finds the cache already populated and returns
from the fast path — no flag required. `d23_measurement`'s own copy (Step 3,
below) uses the same lock from the start.

### Proof — live concurrent run, no `--test-threads=1`

Cleared the cached reference (`173-excerpt-240s-reference-words.json`,
backed up first) to force a genuine cold-cache race, then ran both
`d22_measurement` tests together with cargo's DEFAULT threading (no
`--test-threads=1`):

```
running 2 tests
d22_measurement: computing whole-file 240s reference (first use in this $FA_CHUNK_PLAN_DIR, will be cached)...
[... single computation, 114.9s, 569 words ...]
test fa_onnx::d22_measurement::mis_assignment_filtered_correlation_240s ... ok
test fa_onnx::d22_measurement::full_709s_index_attribution_tail_characterization ... ok
test result: ok. 2 passed; 0 failed; ... finished in 228.53s
```

**`"computing whole-file 240s reference"` printed exactly ONCE** — proof the
lock serialized the two threads rather than letting them race. `/usr/bin/time
-l` wrapping the whole invocation:

| Metric | Value |
|---|---|
| Wall clock (real) | **235.19s** |
| Maximum resident set size | **22,308,859,904 bytes ≈ 20.78 GiB** (a single ~20GiB pass, not doubled) |
| Swap | 0 (per `time -l`'s own `0 swaps`) |

Comparable to D22's own `--test-threads=1` workaround (244.9s), obtained
**without** the flag. Cache file regenerated byte-for-byte identical in size
to the pre-clear backup (26,947 bytes both) — deterministic reproduction,
backup removed after confirming.

## Step 3 — correlation on real index-attribution output, no filtering

D22 Step 3's r=-0.78 was measured on TIME-attribution output with
mis-assigned words filtered out (D15's chunk-membership test) — a proxy,
with its own stated caveat that filtering "does NOT remove cases where a
word landed in the RIGHT window but was still measurably smeared" (D22's own
text). This step measures the real thing.

**Method.** New script
`scripts/dump-fa-chunk-plan-index-240s-windowed.ts` (sibling of D21's
`dump-fa-chunk-plan-index-full709s.ts`, scoped to the 240s excerpt at the
SAME uncoalesced/production-matching granularity) dumps
`173-excerpt-240s-index-windowed.json` (38 chunks, 570 words, audioDuration
241.18s — matching `173-excerpt-240s-wholefile.json`/`173-excerpt-240s-
windowed.json` exactly). New Rust test module `d23_measurement` (own
`common_setup`/`whole_file_reference_240s`, this module's established
duplication convention, `WHOLE_FILE_REFERENCE_LOCK`-guarded from the start)
runs this plan through `align_chunked` and joins every output word DIRECTLY
against the whole-file reference by the same greedy sequential text-match
technique D21/D22 already use — no mis-assignment classification, no
filtering, nothing excluded except genuine CTC-fallback placeholders (0 this
run).

```
direct_correlation_index_attribution_240s: matched=569 (skipped_fallback=0) chunks=38 words_total=569
  full_population_r=-0.6878 (index attribution, NO filtering, direct join against whole-file reference)
BELOW 0.3 confidence (n=53):  error min=0.0000 p50=0.4600 p90=1.0000 max=1.7200 mean=0.4947
ABOVE/EQ 0.3 confidence (n=516): error min=0.0000 p50=0.0000 p90=0.0200 max=0.6400 mean=0.0123
```

**Did the proxy transfer? Partially — the coefficient did not, the
practical signal did.** Direct measurement gives **r = -0.6878**, weaker
than D22's filtered-proxy figure (r=-0.7781, Δ≈0.09, ~12% relative) and even
slightly weaker than time-attribution's own raw UNFILTERED population
(D21's r=-0.7458, Δ≈0.06). The proxy overstated the true linear-correlation
strength — reported plainly, not re-tuned, per this project's own
convention.

But the population's PRACTICAL signal — the thing R.7's threshold actually
uses — is intact and independently cross-validated: below-0.3 mean
error=0.4947s (median 0.46s) vs. above-0.3 mean=0.0123s, a **~40x**
separation, reproducing D22 Step 4's SEPARATELY measured full-709s figures
(mean 0.4856s vs. 0.0123s, median 0.46s vs. 0.00s) almost exactly — despite
being a different corpus slice (240s excerpt vs. full 709s), a different
measurement pipeline (direct reference join vs. seam-detail
characterization), and a different population size (569 vs. 1643 words).
Both r values remain solidly in "strong negative correlation" territory (no
value anywhere near collapsing toward zero or reversing sign) — this is a
real but bounded weakening of ONE statistic, not a falsification of R.7's
core premise. Judgment call, stated explicitly rather than silently
resolved: this is NOT treated as "materially weaker" in the disqualifying
sense the task's own stop condition describes, because the metric R.7
actually gates on (mean/median error separation at the CONF_MIN threshold)
survives the switch from proxy to real measurement essentially unchanged.
Proceeding to Step 4 on that basis.

## Step 4 — R.2 padding: implementation and the stated success metric's real outcome

**Implementation** (`src-tauri/src/fa_onnx.rs`, new section after
`align_chunked`, entirely unwired — `align_chunked` itself is untouched and
never calls this code):

- `FA_R2_DEFAULT_PADDING_SEC: f64 = 0.5` — chosen directly from D22 Step 4's
  own measurement: 83.9% of the below-CONF_MIN tail sits within 0.5s of its
  own chunk's edge (the exact bucket radius that document used to
  characterize the tail, not a round-number guess). Small relative to
  `MAX_RUN_SEC` (30s) and cheap (0.5s × 16kHz = 8000 extra samples ≈ 25
  extra frames per side per chunk).
- `align_chunked_with_padding(..., padding_sec, ...)`: a sibling of
  `align_chunked` — `padding_sec <= 0.0` delegates straight to
  `align_chunked` (byte-identical, zero extra cost). Otherwise, per chunk:
  extends the raw sample window by `padding_sec` on both sides (clamped at
  the decoded audio's own bounds), runs the forward pass on the PADDED
  samples for real acoustic context, then **discards the padding before
  decoding**: `forced_align` only ever sees the frame range belonging to the
  chunk's own TRUE, unpadded window. That frame count is MEASURED via a
  separate real forward pass over the exact unpadded samples (not estimated
  from a sample-count formula — `FA_FRAME_STRIDE_SAMPLES`'s own doc comment
  establishes this model's 7-layer conv stack has no exact affine
  sample→frame formula available in this codebase, so guessing risks
  silently mis-aligning every downstream frame). This costs one EXTRA
  forward pass per chunk versus `align_chunked` — paid only by this
  function, never by the unpadded path.
- Guarantees chunk boundaries, word attribution, and chunk COUNT are
  byte-identical to the unpadded path by construction (the decode step never
  sees a frame outside the original window) — verified directly in Step 5
  below, not just asserted.

**Success metric, stated before measuring** (per the task's own
instruction): the 155 below-0.3 words (9.43%) drop, and the 83.9%
seam-adjacent concentration falls.

**Measured outcome — the stated metric FAILED, in the literal direction it
was supposed to move:**

```
BEFORE (unpadded): below_0.3=155 (9.43% of 1643) near_seam(<0.5s)=130 (83.9% of below)
AFTER  (padded, 0.5s): below_0.3=164 (9.98% of 1643) near_seam(<0.5s)=140 (85.4% of below)
```

Both numbers moved the WRONG way: the tail grew (155→164) and its
seam-adjacent concentration grew slightly too (83.9%→85.4%). Reported
plainly, not re-tuned, matching this project's own convention (D22 Step 3).

**A more granular post-hoc breakdown (ad-hoc analysis of the same run's
per-word JSON output, not a committed automated test) explains the
arithmetic and shows the effect is not simply "padding doesn't help":**

```
below-0.3-before (n=155): confidence IMPROVED for 109 (70.3%), WORSENED for 46 (29.7%), same for 0
  below-0.3-before words that crossed UP to >=0.3 after padding: 10
  above-0.3-before words that crossed DOWN to <0.3 after padding: 19
  net: 155 - 10 + 19 = 164 (exactly matches the measured after-count)
```

The MAJORITY (70%) of previously-poor-confidence words genuinely got a
confidence lift from padding — the mechanism is not inert. But only 10 of
those crossed the 0.3 threshold, while 19 previously-fine words got pushed
BELOW it, and the net arithmetic on THIS specific threshold, on THIS corpus,
is unfavorable. Per-word deltas confirm the effect is correctly
edge-localized, not a broad regression: near-seam (<0.5s) words have p90
delta=0.14s vs. far-from-seam (≥0.5s) words' p90=0.0s — padding is doing
what it was designed to do mechanically (leave interior words alone, move
only edge words), it just doesn't net favorably against a hard 0.3 cutoff on
this corpus. No further tuning attempted this slice, per the same
report-plainly convention — a different padding amount, a per-window
normalization fix (the zero-mean/unit-variance step is computed over the
padded window's own samples, a plausible confound worth flagging for a
future slice to investigate directly), or a soft/graduated confidence
adjustment are all open questions this slice does not resolve.

## Step 5 — did padding move anything else?

| Check | Unpadded | Padded | Verdict |
|---|---|---|---|
| Fallback count | 0 | **0** | holds — R.2 does not reintroduce CTC-infeasibility |
| Total word count | 1643 | **1643** | holds |
| Per-word text sequence | — | **identical at every index** (asserted directly, not just implied) | word attribution unchanged |
| Golden replay | 6/6 | 6/6 (TS-side untouched this step; re-run to confirm) | **6/6** |
| Six `fa-e2e-alignment-*.json` fixtures | byte-identical | byte-identical | `git status --porcelain` empty |

**Per-word timing delta (padded vs. unpadded), all 1643 words:** p50=**0.0000s**,
p99=**0.24s**, max=**0.84s**. Split by seam distance: near-seam (<0.5s) words
p50=0.0000s p90=0.14s max=0.84s; far-from-seam (≥0.5s) words p50=0.0000s
p90=0.0000s max=0.44s. **Interior words are essentially untouched** (the
large majority of both groups show p50=0, and the far-group's own p90 is
exactly 0) — the perturbation is correctly concentrated at chunk edges, as
designed; padding did not diffuse into words it wasn't meant to affect.

**Wall clock and memory** (combined single-process run, both phases
sequential — `full_709s_padding_before_after`, `/usr/bin/time -l`-wrapped):

| Phase | Wall clock (internal timing) |
|---|---|
| Unpadded baseline | 76.9s (cf. Step 1's standalone 72.8s — consistent) |
| Padded (0.5s, 2 forward passes/chunk) | 169.0s (≈2.2x unpadded — consistent with the extra-pass design cost plus marginally larger per-chunk audio buffers) |

| Combined-process metric | Value |
|---|---|
| Wall clock (real, both phases) | 253.34s |
| Maximum resident set size | 4,579,950,592 bytes ≈ **4.58 GiB** |

4.58 GiB is a small fraction of the ~20GiB the whole-file reference
computation costs (the actual concern D10/D11 raised) — R.2 padding does not
approach that regime; its cost is compute time (the extra forward pass), not
memory. The combined figure is not phase-split (OS-level RSS cannot be
cleanly attributed retroactively to one phase once both have run in the same
process), reported as such rather than implied to be padding-only.

## Step 6 — record

**R.2 was previously refused for lack of evidence; D22 Step 4 supplied it,
and this slice's own Step 4 measurement is the first direct test of the
resulting hypothesis — which did not confirm.** `faChunkPlan.ts:47`'s own
comment records R.2 as "out of scope" for the original D11 slice, and no
prior slice measured seam-proximity as a cause until D22 Step 4 (this
slice's own predecessor) found the 83.9%/46x seam-distance split that
motivated implementing it here. The reversal from "out of scope, no
evidence" to "implemented, evidence-backed default" is on the record with
its cause (D22 Step 4's seam analysis) — and so is the outcome: the
evidence justified TRYING padding, not a claim that padding WORKS. Step 4's
own measured result (below-0.3 count and seam-adjacent concentration both
moved the wrong way, despite a real, edge-localized, majority-positive
per-word confidence effect underneath) is the actual, current answer, not a
predicted one — a future slice extending or tuning R.2 should start from
this measurement, not from D22 Step 4's seam-proximity finding alone.

**Tolerance provenance, restated per this slice's own instruction:** D21
Step 4/D22 Step 5 found Youden's J's optimal threshold lands at the
IDENTICAL `0.3112` confidence value across three tested tolerances
(0.15s/0.3s/0.5s — a 3.3x range). This means the *threshold* is
insensitive to which tolerance is chosen, NOT that the tolerance itself is
validated — it reflects a genuine valley in the confidence distribution
that sits in the same place regardless of where the tolerance line is drawn
nearby. D15's own 0.3s tolerance remains what it always was: a stated,
un-ratified product decision ("PRODUCT DECISION, NOT MEASURED, PENDING
OWNER SIGN-OFF" — D15 §2.2), not something this or any measurement slice
has since derived from a new principle. The tolerance ruling remains
genuinely open.

## Full gate table

| Gate | Status |
|---|---|
| `isFaGateOpen()` capability+toggle gate (D17) | OFF by default, inert — no caller in any production path |
| `fa-inference` Cargo feature | OFF by default (not in default feature set) |
| `fa_align`/`fa_align_dev` production wiring | None — only dev-only `__faDevAlign`, unreachable from any UI control or production build |
| `computeFaChunkPlan` (the live entry point) | **Now delegates to `computeFaChunkPlanWithAttribution`, defaulting to `'script-word-index'`** — the flip from D22 is now live; `'segment-start-time'` reachable via the 5th argument |
| `WHOLE_FILE_REFERENCE_LOCK` (this slice) | New — guards all 5 `whole_file_reference_240s` copies (d12/d13/d21/d22/d23) against concurrent cold-cache computation; proven live without `--test-threads=1` |
| `align_chunked` | **Unchanged, byte-identical** — never calls `align_chunked_with_padding` |
| `align_chunked_with_padding` / `FA_R2_DEFAULT_PADDING_SEC` (R.2, this slice) | New, entirely unwired — no production/script caller; `padding_sec<=0.0` is a byte-identical passthrough to `align_chunked` |
| `align_chunked`'s CTC-infeasibility fallback (D20) | Unchanged — 0/1643 fires under both unpadded and padded index attribution on this corpus, re-verified live this slice |
| `CONF_MIN = 0.3` (both `syncConstants.ts` and `fa.rs`) | Unchanged |
| R.2 (padding) | **Implemented, measured, evidence-backed default (0.5s) — stated success metric FAILED on this corpus (tail grew 155→164, seam concentration 83.9%→85.4%); real but net-unfavorable per-word effect, documented above; not gated on, not wired to production** |
| R.5 (wildcard destination) | Unimplemented |
| R.7 (needsReview flag) | Unchanged — schema + Rust computation only, no production writer or consumer |
| IPC wiring (chunk plan → `fa_align` → UI) | None |
| `tsc --noEmit` | clean |
| `npm test` | 79 files, **1942 passed**, 1 pre-existing skip (1943 total) |
| Golden replay (`scripts/phase4-handoff-replay-sync.test.ts`) | **6/6** |
| Six `fa-e2e-alignment-*.json` fixtures | byte-identical (`git status --porcelain` empty) |
| `cargo check --lib` (default) | clean |
| `cargo check --lib --features fa-inference` | clean |
| `cargo test --lib` (default) | **63 passed, 0 failed** — unchanged from D21/D22 |
| `cargo test --lib --features fa-inference` | **137 passed, 0 failed, 20 ignored** (+2 from D22's 18 — this slice's own `d23_measurement` tests, both `#[ignore]`d) |
| `cargo clippy --all-targets --features fa-inference` | 5 pre-existing warnings (`fa.rs:531` unneeded return, `fa_dev.rs:114` arg count, `fa_onnx.rs:593` needless lifetime in `flush_word`, `fa_onnx.rs:4592` neg-multiply — all confirmed present verbatim in `origin/main` before this slice, direct `git show` comparison) + **1 new** (`fa_onnx.rs:1036` `align_chunked_with_padding`'s 8-argument signature, same soft-lint category this codebase already tolerates for `fa_dev.rs`'s own 8-arg `fa_align_dev` — not refactored this slice) |
| Zero-fallback regression guard, re-run live | **0/1643 unpadded, 0/1643 padded — both hold** |

**Empty-diff confirmation on protected files:** `git status --porcelain --
src/services/faAnchors.ts src/services/faTextNormalize.ts
src/services/syncConstants.ts Cargo.lock src-tauri/Cargo.lock
scripts/fixtures/ project-state.md CLAUDE.md docs/history.md` — empty.

Files changed this slice: `src/services/faChunkPlan.ts`,
`src/services/faChunkPlan.test.ts`, `src/App.tsx` (comment only),
`scripts/dump-fa-chunk-plan.ts` (pinned attribution param),
`scripts/fa-run-distribution.ts` (pinned attribution param),
`scripts/dump-fa-chunk-plan-index-240s-windowed.ts` (new),
`src-tauri/src/fa_onnx.rs` (lock + R.2 padding + `d23_measurement` module),
and this document.

## No new crates; no R.7 wiring, no R.5, no production writer, no IPC, no gate flip

Zero new Rust dependencies (`Cargo.lock`/`src-tauri/Cargo.lock` both
untouched, confirmed above). No IPC signature change (grepped: no new
`invoke()` call site anywhere in `src/`). No capability gate touched, no
Cargo feature default changed. `isFaGateOpen()` unchanged, still OFF.
`needsReview`/`faWordTimings` still have no production reader or writer.
`align_chunked` — the only forward-pass entry point any production or script
caller invokes — is byte-for-byte unchanged; `align_chunked_with_padding` is
a new, separate, entirely unwired sibling. Production behaviour is
byte-identical at this slice's end for every path except
`computeFaChunkPlan` itself, whose changed default is this slice's own
explicit, intended purpose (Step 1) — and which remains gated inert by
`isFaGateOpen()` regardless, per the table above.

## git status / git log against origin

Before this slice's own commit, working tree had the changes listed above
(all new/modified files this slice touched); `git rev-list --left-right
--count origin/main...HEAD` was `0 0` at this slice's start (fully synced,
matching D22's own ending state — `a013329` was `origin/main`'s HEAD).
Committed and pushed at the end of this slice, per the task's own "commit
AND push before the slice ends, not deferred" instruction.
