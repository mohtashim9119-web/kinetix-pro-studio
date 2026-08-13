# WS1 Task 5, Slice D21 — attribution as the real CTC fix + CONF_MIN re-derivation

> All real-corpus numbers below are reproduced live on this machine against
> `.work-phase4/replay/173/` (gitignored, local-only), the same corpus D10–D20
> used. Nothing is carried forward from memory without a fresh run backing it.
> Chunk plans dumped to `/tmp/fa-chunk-plans-d21` this slice; raw per-word
> JSON dumps referenced below live there (gitignored, not committed).

## Step 0 — D20 committed and pushed

Committed `13c4f97` ("fix(fa): CTC-infeasible chunks skip+flag instead of
aborting the run, WS1 Task 5 Slice D20"), already on `origin/main` at this
slice's start. Gate table re-verified during this slice's own Step 5 below.

## Step 1 — does attribution fix it? Yes, entirely.

**Method.** `scripts/dump-fa-chunk-plan-index-full709s.ts` (new) drives the
existing, unmodified `computeFaChunkPlanWithAttribution(segments, tokens,
silences, audioDuration, 'script-word-index')` (`faChunkPlan.ts`, D13) over
the FULL 709s project — no coalescing, same run/window granularity as D11's
own `173-full-709s-windowed.json`, the only variable changed is the text-
attribution rule. Output: `118 chunks, 1645 raw-split words` (vs. D11/D20's
97 chunks under `segment.startTime` attribution).

A new Rust test, `fa_onnx::real_corpus_measurement::
full_length_709s_index_attribution_single_call`, loads this plan and calls
`align_chunked` ONCE over the full chunk list — the exact call shape a real
(still-gated) production caller would use, D20's own fallback left fully in
place, not bypassed:

```
full_length_709s_index_attribution_single_call: wall_clock=71-75s chunks=118 words=1643
  (of which 0 are D20 CTC-infeasibility fallback placeholders) audio_duration=709.01s
```

**Direct answers:**

- **Do chunks 4 and 52 still violate the CTC bound?** No. The exact same
  windows exist in the new plan (`[18.08,18.70)` and `[405.58,406.98)`,
  confirmed by inspecting the dumped plan JSON directly) but now carry
  correctly-scoped text:
  - `[18.08, 18.70)`: was the wrongly-attributed 13-word sentence ("because
    the environment..."); now **"the worst"** (2 words) — the sentence that
    was mis-assigned in D20 now correctly lands in the NEXT chunk,
    `[18.70, 30.34)` (an 11.64s window with ample room).
  - `[405.58, 406.98)`: was the wrongly-attributed 14-word sentence ("It just
    became a problem..."); now **"decision. It"** (2 words) — the mis-
    assigned sentence now correctly lands in `[406.98, 411.78)`.
- **By how much do they miss the bound now?** They don't — 0 fallback
  placeholders across all 118 chunks means every chunk's CTC pass succeeded
  outright; there is no violation magnitude to report.
- **Does any chunk abort?** No. `align_chunked` returned `Ok` for the single
  118-chunk call (an abort would have surfaced as `Err` from the *first*
  `TooManyRepeats` case — D20's own fallback only intercepts that specific
  error kind, everything else still propagates and aborts).
- **Does the D20 fallback fire at all?** No — 0/1643 words are fallback
  placeholders. **Stated plainly, per the task's own instruction: the
  fallback is now a safety net, not a remedy.** It was necessary and
  correctly implemented under D20's own (still-shipped) `segment.startTime`
  attribution rule; under index attribution, on this real corpus, it has
  nothing to catch.

**A finding beyond what Step 1 asked for.** Re-running Step 6's confidence-
distribution measurement (D20) on this same clean 1643-word population shows
attribution's effect is not limited to the 2 extreme CTC-infeasibility
cases — it changes the WHOLE corpus's alignment quality:

| | Time attribution (D20, `segment.startTime`) | Index attribution (this slice) |
|---|---|---|
| Genuinely-aligned words | 1616 (+27 fallback = 1643 total) | 1643 (0 fallback) |
| Confidence p50 | 0.0006 | **0.9970** |
| Confidence p90 | 0.9996 | 0.9999 |
| Fraction below CONF_MIN (0.3) | 62.75% (1014/1616) | **9.43%** (155/1643) |

Under the old rule, most windows got SOME wrong words mixed into their
correct ones (not just the 2 that hit the hard CTC bound) — every wrong word
drags that window's whole forced-alignment pass toward a worse local optimum,
depressing confidence broadly. Index attribution removes that source of
noise corpus-wide, not just at the 2 extreme windows.

## Step 2 — demoting the fallback

The new test (`full_length_709s_index_attribution_single_call`) now ends
with a hard assertion:

```rust
assert_eq!(fallback_count, 0, "... expected ZERO CTC-infeasibility fallback
placeholders under index attribution on the real 709s corpus (Step 1 of this
slice measured 0/1643) — a nonzero count here means index attribution no
longer fully resolves chunk text mis-assignment and needs re-investigation,
not silent absorption by the D20 fallback.");
```

Verified to actually gate: re-ran after adding it, still passes (0 == 0).
The fallback's own code (`fallback_words_for_infeasible_chunk`,
`CTC_INFEASIBLE_FALLBACK_SCORE`, the `align_chunked` match arm) is
**unchanged, kept in place** — per the task's own constraint, and because it
is still the correct behavior for whatever index attribution does not cover
(a genuinely-too-dense window, a future corpus with different pacing, a
regression in the attribution logic itself).

**Recommendation: index attribution (`'script-word-index'`) should become
the chunked path's internal default**, for two independent reasons this
slice measured directly:
1. It eliminates the only reachable CTC-infeasibility case found on real
   corpus data (D11→D20→this slice).
2. It improves confidence broadly (62.75% → 9.43% below `CONF_MIN`), which
   is a precondition for `CONF_MIN`/`needsReview` being a USEFUL signal at
   all — D20 Step 6 already flagged that a majority-flagging gate is "close
   to uninformative." Index attribution is what makes Step 3/4 below
   possible to reason about meaningfully.

This is a recommendation, not a flip — no default changed this slice, per
the task's own constraint. The owner should rule on it; `'segment-start-
time'` remains the sole production default in `faChunkPlan.ts`.

## Step 3 — does confidence predict error? Yes, clearly.

**Method.** New Rust module `fa_onnx::d21_measurement`
(`confidence_vs_error_correlation_240s`), mirroring `d12_measurement`'s own
whole-file-reference machinery: the real 240s excerpt, run through
PRODUCTION's own default (unmodified) windowing/attribution
(`173-excerpt-240s-windowed.json`, `segment.startTime` rule — the only
length a whole-file FA reference is computable at, D10), matched word-by-word
against the whole-file reference (same greedy text-matched walk
`text_matched_diff_stats` already uses elsewhere in this file). For each
matched, genuinely-aligned word (13 fallback placeholders excluded — this
excerpt DOES still hit chunk 4's CTC-infeasibility under time attribution,
confirming Step 1's own finding is attribution-specific, not excerpt-length-
specific), pairs real Rust confidence (`exp(score)`) with measured timing
error (`max(|start diff|, |end diff|)` against the whole-file reference).

```
confidence_vs_error_correlation_240s: matched=556 (skipped_fallback=13)
  pearson_r(confidence, error) = -0.7458
BELOW 0.3 confidence (n=345): error min=0.00 p50=3.06 p90=4.98 max=7.48 mean=3.04
ABOVE/EQ 0.3 confidence (n=211): error min=0.00 p50=0.00 p90=0.02 max=7.54 mean=0.18
```

**Direct answer: yes — low-confidence words have measurably, substantially
worse timing than high-confidence words.** Pearson r = -0.75 (strong
negative correlation: confidence up, error down). The below/above-0.3 split
shows a ~17x gap in mean error (3.04s vs. 0.18s) and the median tells an even
starker story: the below-0.3 group's median error is 3.06s while the
above-0.3 group's median is 0.00s (over half of high-confidence words landed
within measurement noise of the reference). **CONF_MIN can work — R.7
proceeds as a tuning question, not a design question.**

**Honesty check — a real tail that a single-point derivation must not
ignore.** 12/556 matched words (2.2%) have confidence > 0.3 (several > 0.99)
AND error > 0.3s (up to 7.54s) — visible as the above-0.3 group's own
max=7.54 despite its otherwise tiny median/p90. Inspected directly
(`173-excerpt-240s-confidence-error-pairs.json`): these are short, common,
frequently-repeated words (the kind of token that appears several times close
together in real narration), which is exactly the failure mode a GREEDY
single-pass text-matcher (this test's own matching technique, shared with
`d12_measurement`/`d13_measurement`) can occasionally pair to the wrong
occurrence. This is flagged as a probable measurement-methodology artifact,
not a claim that the model itself is occasionally confident-and-wrong on 2%
of words — but it is reported, not hidden, because it directly breaks the
naive "flag every observed violator" derivation approach (Step 4).

## Step 4 — re-deriving CONF_MIN

**Stated principle first, per the task's own instruction.** This project
already has a named per-word timing tolerance, proposed (not yet owner-
approved) at D15: **0.3s (300ms), both start and end**
(`d15-mis-assignment-diagnostic-2026-08-13.md` §2.2 — "captioning/subtitle-
highlight tooling generally treats ~150–300ms drift as the point where a
highlight visibly desyncs... offered as a reasonable middle point, not a
researched constant"). This slice reuses that SAME number rather than
inventing a fresh one — deriving a threshold against a tolerance nobody has
approved would just move the unapproved-number problem, not solve it.

**Derivation method:** the naive "no-miss" approach (threshold = the highest
confidence among any observed violator of the 0.3s tolerance) degenerates
because of Step 3's own outlier tail — it lands at confidence=0.999976 and
would flag 208/209 (99.5%) of non-violators too, which is not a usable
threshold by any measure. Instead: **Youden's J statistic** (true-positive
rate minus false-positive rate, maximized over every candidate cutoff) — a
standard, principled way to find "the value separating violators from
non-violators" without being dominated by a small number of matching-
artifact outliers, and without picking a percentile of the raw confidence
distribution "to look reasonable."

```
best Youden J = 0.9176 at confidence threshold = 0.3112
  true-positive rate (violators caught)     = 96.5% (335/347)
  false-positive rate (non-violators swept) = 4.8%  (10/209)
```

**Result: the data-derived optimal threshold (0.311) is statistically
indistinguishable from the existing `CONF_MIN = 0.3`.** Moving from 0.01 to
0.3 buys real additional recall (89.3% → 96.5% of violators caught) for a
small FPR cost (1.9% → 4.8%); pushing further toward the raw "no-miss" value
buys almost nothing more (violators caught plateaus near 96-97% past ~0.1)
while FPR keeps climbing toward the degenerate 99.5% case above. **No change
to `CONF_MIN` is proposed.** This finding is provisional pending owner
sign-off, same as D15's own 0.3s tolerance it depends on — it is not a new
number, but it IS the first real-corpus evidence that the existing number is
well-placed, not merely inherited.

**How many of the real corpus's words does it flag?** The task's own text
cites "1616 real words" — D20's own (pre-index-attribution, time-attributed)
population. Two numbers, both real, both reported:
- **D20's own population (1616 genuinely-aligned words, time attribution,
  already measured, not re-run this slice):** 1014/1616 = 62.75% below 0.3
  (D20 Step 6's own figure, cited for continuity — this slice did not
  reproduce the time-attribution full-709s run again).
- **This slice's own population (1643 genuinely-aligned words, index
  attribution, Step 1 above, 0 fallback):** **155/1643 = 9.43%** below 0.3
  (157/1643 = 9.56% at the derived 0.311 cutoff — materially the same).

The task's cited 1616-word figure is now the STALE (pre-attribution-fix)
number; this slice's own 1643-word, 9.43%-flagged figure is the current,
accurate one, and it directly supports Step 2's recommendation: under index
attribution, `CONF_MIN` flags a plausible minority (~1 in 10 words) instead
of D20's own "close to uninformative" majority (~2 in 3 words).

**Should Rust and TS `CONF_MIN` remain one shared constant?** **Yes —
confirmed they measure the SAME quantity, not different ones.** Read
directly: `syncConstants.ts:530-536`'s own comment states `CONF_MIN` is
"FA per-word confidence... consumed by a later (post-FA) phase" — it was
always specifically the FA-output confidence gate, never a Whisper-side or
segment-match-confidence constant (that's a different field,
`SegmentAlignment.confidence` in `whisperService.ts`, gated by a DIFFERENT
constant, `LOW_CONFIDENCE_RATIO`, not `CONF_MIN` — confirmed by grep, no
collision). `TranscriptToken.confidence` (`types.ts:291`) is explicitly
FA-only ("Whisper-sourced tokens never set it"). D9's own "resolved spec
defect" ruling already fixed the one real unit mismatch that existed (Rust's
internal LOG-probability vs. `CONF_MIN`'s probability units) by applying
`exp()` once at the IPC boundary — after that fix, landed two slices ago,
both sides compare a plain `[0,1]` probability of the identical underlying
quantity (FA's own per-word confidence). There is no live unit mismatch to
split the constant over. **Recommend: keep the single shared constant and
the existing `conf_min_matches_sync_constants_ts_literal` drift guard
unchanged** — introducing a second, Rust-only named constant would solve a
problem that Step 4's own reading found does not exist.

## Step 5 — verify

**Full gate table:**

| Gate | Status |
|---|---|
| `isFaGateOpen()` capability+toggle gate (D17) | OFF by default, inert — no caller in any production path |
| `fa-inference` Cargo feature | OFF by default (not in default feature set) |
| `fa_align`/`fa_align_dev` production wiring | None — only dev-only `__faDevAlign`, unreachable from any UI control or production build |
| `Project.faWordTimings` (D18) | Schema only — no production writer |
| `FaWordSpan.needsReview` / `TranscriptToken.needsReview` (D19) | Schema + Rust computation only — no production writer, no consumer |
| `align_chunked`'s CTC-infeasibility fallback (D20) | Unchanged this slice — kept as the safety net for whatever index attribution doesn't cover; 0/1643 fires under index attribution on this corpus (Step 1/2, this slice), now regression-guarded |
| `computeFaChunkPlanWithAttribution` / `'script-word-index'` (D13) | Still measurement-only — `'segment-start-time'` remains the sole production default; this slice adds a full-709s dumper script and 2 new `#[ignore]`d real-corpus tests exercising it, no production caller added |
| `conf_min_matches_sync_constants_ts_literal` drift guard (D20) | Unchanged, still passing |
| `CONF_MIN = 0.3` (both `syncConstants.ts` and `fa.rs`) | Unchanged — this slice's own Youden's-J derivation (0.311) validates the existing value rather than proposing a different one |
| R.2 (padding) | Unimplemented (unaffected by this slice) |
| R.5 (wildcard destination) | Unimplemented |
| IPC wiring (chunk plan → `fa_align` → UI) | None |
| `tsc --noEmit` | clean |
| `npm test` | 79 files, 1940 passed, 1 pre-existing skip — unchanged (no TS file touched this slice) |
| Golden replay (`scripts/phase4-handoff-replay-sync.test.ts`) | 6/6, unchanged |
| `cargo check --lib` (default) | clean |
| `cargo test --lib` (default, no `fa-inference`) | 63 passed, 0 failed — unchanged from D20 (this slice's new code is entirely `#[cfg(test)]`+feature-gated) |
| `cargo test --lib --features fa-inference` | 137 passed, 0 failed, **16 ignored** (+2 from D20's 14 — the 2 new real-corpus tests, both `#[ignore]`d, neither runs in the default gate matrix) |
| `cargo clippy --all-targets` | 2 pre-existing warnings only (`fa_dev.rs`'s arg count, `FaModelCache::default`'s unit-arg lint) — unchanged, confirmed present before this slice too |

**Fixture byte-identity:** all six `scripts/fixtures/fa-e2e-alignment-*.json`
fixtures confirmed byte-identical (`git diff --quiet` per file, all
UNCHANGED) — expected, this slice touches no fixture-consuming code path.

**Confirm nothing behind the gate executes in production:** grepped —
`computeFaChunkPlanWithAttribution` has exactly one non-test, non-script
definition site (`faChunkPlan.ts`) and two script callers (D13's own
`dump-fa-chunk-plan-index-ladder.ts`, this slice's new
`dump-fa-chunk-plan-index-full709s.ts`) — no `App.tsx`/hook/component caller
exists. Both new Rust tests are `#[cfg(test)]` + `#[ignore]`, unreachable
from any build. `align_chunked`'s fallback code path is unchanged from D20
(still only reachable via `fa_align` → dev-only `fa_align_dev`).

## Empty-diff confirmation on protected files

`git status --porcelain -- scripts/fixtures/ src/services/faAnchors.ts
src/services/faTextNormalize.ts src/services/syncConstants.ts Cargo.lock
src-tauri/Cargo.lock project-state.md CLAUDE.md docs/history.md` — empty.
Only `src-tauri/src/fa_onnx.rs` (2 new `#[ignore]`d tests + 1 hardened
assertion, all inside `#[cfg(test)]` modules) and the new
`scripts/dump-fa-chunk-plan-index-full709s.ts` changed this slice.

## No new crates; production byte-identical

Zero new Rust dependencies (`Cargo.lock` untouched, confirmed above). No IPC
signature change. No capability gate touched, no default flipped — index
attribution remains `faChunkPlan.ts`'s measurement-only mode, exactly as D13
left it; production behaviour is byte-identical.

## git status / git log against origin

```
On branch main
Your branch is ahead of 'origin/main' by 1 commit.
nothing to commit, working tree clean
```

`git log --oneline -3`: `aa5708e feat(fa): index attribution resolves CTC
infeasibility; CONF_MIN validated (WS1 Task 5 Slice D21)`, `13c4f97 fix(fa):
CTC-infeasible chunks skip+flag instead of aborting the run (WS1 Task 5
Slice D20)`, `b7f1d0a feat(fa): R.7 confidence fallback — needsReview flag
(WS1 Task 5 Slice D19)` — `aa5708e` is this slice's own commit, not yet
pushed (matches D19/D20's own convention of pushing at the START of the
NEXT slice's Step 0, not committed here since push wasn't requested this
turn).
