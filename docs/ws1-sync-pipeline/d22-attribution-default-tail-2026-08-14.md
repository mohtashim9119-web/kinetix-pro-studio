# WS1 Task 5, Slice D22 — reconcile confidence, flip the internal default

> All real-corpus numbers below are reproduced live on this machine against
> `.work-phase4/replay/173/` (gitignored, local-only), the same corpus D10–D21
> used. Nothing is carried forward from memory without a fresh run backing it.
> Chunk plans dumped to `/tmp/fa-chunk-plans-d22` this slice; raw per-word
> JSON dumps referenced below live there (gitignored, not committed).

## Step 0 — push

Two commits were unpushed at this slice's start (`13c4f97` D20, `7684e28`
D21's own docs commit — `aa5708e`/D21's code commit had already been folded
into that push). Pushed immediately, confirmed against `origin/main`:

```
To https://github.com/mohtashim9119-web/kinetix-pro-studio.git
   13c4f97..7684e28  main -> main
```

Per the task's own instruction, this "push at the start of the next slice"
convention is retired as of this slice — see the Step 0 confirmation at the
end of this document for how D22's own commit is handled (committed AND
pushed before the slice ends, not deferred).

## Step 1 — reconciling D21's 0.0006 against D12/D13's "near-zero p50"

**Verdict: (i).** The two figures come from different corpora AND different
window-coalescing granularities; at matched granularity they agree, not
conflict. There is no genuine contradiction to resolve by re-measurement —
only two rows of two different tables being compared as if they described
the same measurement.

### The two figures, precisely

- **D21 Step 6** (`d20-ctc-infeasibility-2026-08-14.md` §Step 6, carried
  forward unchanged into D21): median confidence **0.0006**, 62.75%
  (1014/1616) below `CONF_MIN`. Measured on the **full 709s project**, under
  `computeFaChunkPlan`'s **uncoalesced** (D11's original, no coalescing
  target) windowing — **97 chunks**, median chunk duration 5.70s
  (`scripts/fa-run-distribution.ts`'s own full-project row, D13 §1).
- **D12/D13's "near-zero p50"**: this description matches exactly one row of
  D13 §4's combined table — **ladder-45s**, START p50/p90/p99/max =
  `0.00/1.62/6.20/7.54`. Measured on the **240s excerpt**, under
  **45s-coalesced** windowing — **7 chunks**, median chunk duration ≈34.3s.
  The task's framing also names ladder-7s, but ladder-7s's own p50 is
  **2.12s** — not near zero — so "near zero" describes the 45s rung
  specifically, not time attribution generally.

These are not comparable rows: they differ in corpus length (240s vs. 709s)
**and** in coalescing target (45s vs. effectively-uncoalesced, ~7s-median
granularity), and they measure different quantities (a percentile of
seconds-of-timing-disagreement vs. a percentile of a `[0,1]` CTC confidence
score).

### Quantifying the gap — three independent checks, all pointing to (i)

**1. Corpus length is not the driver.** D21 Step 3
(`d21-attribution-confmin-2026-08-14.md`) measured confidence-vs-error on
the **240s excerpt**, under `'segment.startTime'` attribution, using the
SAME uncoalesced/production-default windowing as the 709s figure (confirmed
by a shared signature: both runs hit chunk 4's CTC-infeasibility at
`[18.08, 18.70)` — a window that only exists in the uncoalesced plan; D13
§4's own table shows ladder-7s has **0** CTC failures, so the coalesced
rungs never see it). D21 Step 3's own numbers: **345/556 = 62.05%** of
matched words fall below `CONF_MIN` on the 240s excerpt — against
**1014/1616 = 62.75%** on the full 709s project. A 0.7-point difference
across a 2.95x corpus-length change. Corpus length is not what separates the
"near-zero" quote from the 0.0006 median.

**2. Window/coalescing size is the driver.** At the SAME uncoalesced
granularity the confidence measurements use, seconds-of-disagreement is
**also not near zero**: D21 Step 3's own error distribution for the
below-0.3-confidence group (n=345, i.e. the majority of the 240s excerpt) —
`min=0.00 p50=3.06 p90=4.98 max=7.48 mean=3.04` — is the same order of
magnitude as ladder-7s's own p50=2.12s (both "several seconds," the opposite
of "near zero"). The ONLY row in D13 §4's combined table with a
near-zero MEDIAN is ladder-45s — and no confidence measurement of any kind
exists anywhere in D19–D21 for the 45s-coalesced regime. There is nothing to
reconcile at 45s because nobody measured confidence there.

**3. Why 45s's median is near-zero while its own tail (p99/max) is not —
consistent with, not contradicting, (1) and (2).** D15's mis-assignment
diagnostic (`d15-mis-assignment-diagnostic-2026-08-13.md` §1.2, §1.4)
established mis-assignment is a **per-seam, boundary-word phenomenon**: at
45s coalescing (240s excerpt), only 6 internal seams exist, so only 5/569
words (0.9%) are mis-assigned — few enough that the MEDIAN stays at the
unaffected majority's near-zero value, even though the few affected words
still carry large, seam-magnitude errors (setting p99=6.20s, max=7.54s —
values that don't shrink with coalescing, because the per-seam error
magnitude is set by how far a chunk boundary can land from a word's real
onset, not by how many seams exist). At the uncoalesced/production
granularity (D20/D21's 97-chunk, ~7s-median-chunk regime), there are
roughly `709/5.70 ≈ 124` internal seams — an order of magnitude more — and,
critically, `segment.startTime` attribution's failure mode at this fine a
granularity is not limited to single boundary words: D20 Step 3's own
finding was that an entire STALE SEGMENT's full text can ride along into a
narrow window (chunk 4's 0.62s window inheriting a 13-word, 4.65s-real-span
sentence). D21 Step 1's own text names the resulting mechanism directly:
"every wrong word drags that window's whole forced-alignment pass toward a
worse local optimum, depressing confidence broadly" — i.e. one mis-attributed
word can depress ALL of its chunk's neighbors' confidence too (a joint CTC/
Viterbi optimization effect), not just its own. This is why the fraction of
words affected under fine/production windowing (~62%) is much larger than
D15's own ~1-word-per-seam mis-assignment rate alone would predict, and why
it is a genuinely different, worse regime than the coalesced ladder rungs —
consistent with, not contradicting, D11 §5's own "PARTIALLY SUPERSEDED"
note that "the disagreement tail persists through 45s... so growing the
window alone... does not resolve it."

### What this rules out

- **Not (iii).** No code-version difference exists between the two
  measurements' attribution rule: D20 Step 1 confirms `computeFaChunkPlan`
  is "unchanged since D11," and D12/D13's ladder rows use the same
  `segment.startTime` rule via `computeFaChunkPlanCoalesced` — identical
  attribution code, only the coalescing target and corpus differ.
- **Not (ii)** in the strong form the task poses it ("confidence does not
  measure alignment quality"). D21 Step 3's own Pearson r=-0.75 on the SAME
  uncoalesced/240s population this reconciliation uses is direct evidence
  confidence DOES track timing error, strongly, in that regime. (Step 3
  below re-examines whether that correlation is itself an artifact of
  mis-assignment specifically — a separate, narrower question from "does
  confidence carry no signal at all," which this Step 1 finding already
  answers no to.)

## Step 2 — flip the internal default

**Change** (`src/services/faChunkPlan.ts`): `computeFaChunkPlanWithAttribution`'s
`attribution` parameter now defaults to `'script-word-index'`
(`attribution: FaTextAttribution = 'script-word-index'`), documented inline
with the owner ruling this implements. `'segment-start-time'` remains fully
reachable by passing it explicitly — nothing removes the old rule.

**Scope, confirmed unaffected:**
- `computeFaChunkPlan` — the ONLY function any current production/script/test
  caller actually invokes for real work (`scripts/dump-fa-chunk-plan.ts`,
  `scripts/fa-run-distribution.ts`, `App.tsx`'s dev-only path indirectly via
  the chunk-plan machinery) — is a SEPARATE code path (`computeRuns` +
  `runsToChunks`, hardcoded to segment-start-time) and is untouched.
- Every existing caller of `computeFaChunkPlanWithAttribution`
  (`faChunkPlan.test.ts`, `dump-fa-chunk-plan-index-ladder.ts`,
  `dump-fa-chunk-plan-index-full709s.ts`) already passes `attribution`
  explicitly (grepped, confirmed) — the new default changes zero existing
  call sites' behavior.
- `isFaGateOpen()` (D17) stays OFF; no IPC signature changed; no Cargo
  feature default changed.

**New test** (`faChunkPlan.test.ts`): `'WS1 Task 5 Slice D22: defaults to
script-word-index attribution when no rule is passed'` — asserts the
no-argument call is byte-identical to the explicit `'script-word-index'` call
and NOT equal to the explicit `'segment-start-time'` call, directly proving
the default flipped rather than merely compiling.

### Verification table

| Check | Result |
|---|---|
| `npm run lint` (`tsc --noEmit`) | clean |
| `npm test` | 79 files, **1941 passed** (+1 from D21's 1940 — the new default-attribution test), 1 pre-existing skip |
| Golden replay (`scripts/phase4-handoff-replay-sync.test.ts`) | **6/6**, unchanged |
| Six `fa-e2e-alignment-*.json` fixtures | byte-identical (`git status --porcelain -- scripts/fixtures/` empty — confirmed these fixtures are produced by `scripts/generate-fa-e2e-tokens.ts`, a code path this slice never touches) |
| Protected files (`faAnchors.ts`, `faTextNormalize.ts`, `syncConstants.ts`, `Cargo.lock`, `src-tauri/Cargo.lock`, `scripts/fixtures/`, `project-state.md`, `CLAUDE.md`, `docs/history.md`) | empty diff, confirmed |
| `cargo check --lib` (default) | clean |
| `cargo check --lib --features fa-inference` | clean |
| `cargo test --lib --features fa-inference` (non-`#[ignore]`d) | 137 passed, 0 failed, 18 ignored (+2 from D21's 16 — this slice's two new real-corpus tests) |
| D21's zero-fallback regression guard (`fa_onnx::real_corpus_measurement::full_length_709s_index_attribution_single_call`, re-run live this slice against a freshly regenerated `173-full-709s-index-windowed.json`) | **still holds**: `wall_clock=215.6s chunks=118 words=1643 (of which 0 are D20 CTC-infeasibility fallback placeholders)` — 0 == 0, `assert_eq!` passes. (Wall-clock is elevated vs. D21's own 71-75s because this run shared the machine with two concurrent `d22_measurement` real-corpus tests in the same `cargo test` invocation — a scheduling artifact, not a regression; the actual invariant checked — fallback count — is unaffected by wall-clock.) |

**A real methodology hazard hit and fixed during this slice, recorded
because it cost real time.** The first attempt ran
`full_length_709s_index_attribution_single_call` and both new
`d22_measurement` tests in one multi-threaded `cargo test` invocation.
`d22_measurement`'s own two tests both need the cached 240s whole-file
reference and, on a cold cache, both computed it CONCURRENTLY (each pass
peaks ~20GiB per D10/D11's own measurement) — driving this 32GiB machine to
23GiB+ of swap and stalling in uninterruptible I/O for over 30 minutes with
no forward progress. Killed and re-run with `--test-threads=1` (forces
serialization: the first test computes and caches the reference, the second
reuses the cache file) — completed cleanly in 244.9s total. No test logic
changed; this is a runner-invocation lesson, not a correctness finding, and
is noted here per this project's own convention of recording a real
methodology hazard rather than silently retrying past it.

## Step 3 — correlation on the correctly-assigned population

**Method.** Reused D21 Step 3's exact setup (240s excerpt, production
default `segment.startTime` attribution, `173-excerpt-240s-windowed.json`) —
the same 556 matched (confidence, error) pairs, confirmed by an exact
reproduction of D21's own r: `full_population_r=-0.7458` (D21 reported
`-0.7458`). For each matched word, applied D15's own mis-assignment
identification method (`d15-mis-assignment-diagnostic-2026-08-13.md` §1.1),
generalized from D15's original index-vs-B-control comparison to this
population's `segment.startTime`-vs-oracle-time comparison at the SAME
boundary list: a word is mis-assigned if the chunk window containing its own
measured output start time differs from the chunk window containing the
whole-file reference word's own start time.

```
mis_assignment_filtered_correlation_240s: matched=556 (skipped_fallback=13)
  full_population_r=-0.7458 mis_assigned=214/556 (38.5%) correctly_assigned_n=342
  filtered_r=-0.7781
CORRECTLY-ASSIGNED, BELOW 0.3 confidence (n=138): error min=0.0000 p50=3.1000 p90=4.4800 max=5.7400 mean=2.8113
CORRECTLY-ASSIGNED, ABOVE/EQ 0.3 confidence (n=204): error min=0.0000 p50=0.0000 p90=0.0200 max=7.5400 mean=0.0742
```

**Direct answer: the correlation does not collapse. It is, if anything,
slightly STRONGER on the correctly-assigned population (r=-0.78 vs. the
full population's -0.75).** Per the task's own instruction, this is reported
plainly rather than re-tuned: confidence is not merely a proxy for "was this
word's whole chunk grossly mis-attributed" — it continues to separate
well-timed from poorly-timed words even after that specific failure mode is
filtered out. **R.7 as conceived is not falsified by this check.**

**An honest limitation of this filtering, stated plainly.** 38.5% of the
240s excerpt's words are mis-assigned by D15's chunk-level test — a far
higher rate than D15's own 45s-granularity finding (0.9%) or 7s-granularity
finding (4.9%), because D11's own uncoalesced plan (the granularity this
population and D20/D21's own full-709s confidence figures use) has highly
variable window sizes (0.62s–25.60s, D13 §1) and, per D20 Step 3, can load
an ENTIRE stale segment's text into a narrow window — a coarser, chunk-level
failure than D15's original single-boundary-word finding. Filtering only
removes cases where a word's own text-matched output landed in the WRONG
WINDOW entirely; it does NOT remove cases where a word landed in the RIGHT
window but was still measurably smeared because that window's `segment.
startTime`-attributed text carried OTHER, unrelated wrong or extra content
sharing the same audio span — exactly why the "correctly-assigned" group
above still contains 138/342 (40%) words with error means near 2.8s. Index
attribution's own chunks, by construction, carry only the `qi`-range text
that genuinely belongs to that window (D13's design, not merely coarse
window membership) — so the REAL population index attribution produces is
very likely cleaner than this filtered proxy, not just no-worse-than it.
This is a conservative (if anything, unfavorable-to-R.7) test, and the
correlation still held.

## Step 4 — characterizing the below-0.3 tail (155/1643, index attribution)

**Method.** Ran the full 709s project through index attribution
(`173-full-709s-index-windowed.json`, the same single-call shape D21 Step
1/2 uses) and recorded, per genuinely-aligned word: char length, frame
length (`(end-start)/0.02s`, the CTC frame duration, D6), which chunk it
landed in and its ordinal position there, distance to the nearer edge of its
own chunk window, a heuristic function-word/punctuation-adjacency
classification, and — for the 569 words whose real onset falls within the
240s whole-file reference's own coverage — measured timing error against
that reference (`None` beyond it, not fabricated).

```
genuinely-aligned words=1643 below_0.3=155 (9.43%) above_eq_0.3=1488
BELOW 0.3:     n=155  char_len(median)=4.0  frame_len(median)=9.00f (0.18s)
               seam_dist(median)=0.0400s  position_in_chunk(median)=7.0
               function_word=73/155 (47.1%)  punct_adjacent=0/155 (0.0%)
               reference-backed error available for 54/155 words:
                 min=0.0000 p50=0.4600 max=1.7200 mean=0.4856
ABOVE/EQ 0.3:  n=1488 char_len(median)=5.0  frame_len(median)=14.00f (0.28s)
               seam_dist(median)=1.8600s  position_in_chunk(median)=8.0
               function_word=480/1488 (32.3%)  punct_adjacent=0/1488 (0.0%)
               reference-backed error available for 515/1488 words:
                 min=0.0000 p50=0.0000 max=0.6400 mean=0.0123
```

**Seam proximity dominates.** Of the 155 below-0.3 words: **130 (83.9%) sit
within 0.5s of their own chunk's edge**, and **86 (55.5%) are literally
their chunk's first or last word** — against a ~14.4% baseline expected if
position within a chunk (average 13.92 words/chunk, 118 chunks over 1643
words) were uniform, a ~3.9x overrepresentation. Median seam distance is
**0.04s for the below-0.3 group vs. 1.86s for the above-0.3 group — a ~46x
gap**, the single sharpest split of any variable measured. The below-0.3
group also skews toward smaller chunks (chunk-word-count median 11 vs. 21
for the above-0.3 group) — consistent with smaller windows putting
proportionally more of their own words near an edge by construction.

**Word length is a real but secondary factor.** char_len drops modestly
(5→4 median) and frame_len drops from 14 to 9 frames (0.28s→0.18s) — real,
but far too small a ratio (≈1.6x) to be the dominant explanation next to
seam distance's ~46x split. Function words are overrepresented (47.1% vs.
32.3%) but this is very likely a correlate of both seam proximity and short
length (function words cluster at clause boundaries and are characteristically
short) rather than an independent third cause — not tested for independence
this slice, reported as a plausible confound, not a separated effect.
Punctuation-adjacency shows no signal at all (0% in both groups) — the raw
per-token text this pipeline aligns evidently carries no adjacent
punctuation at this stage (a null finding, not evidence of absence
elsewhere).

**Verdict: primarily real, seam-driven alignment degradation — not a
confidence-definition artifact on short words.** Two lines of evidence:
(1) the effect size hierarchy (seam distance ~46x >> word length ~1.6x)
points overwhelmingly at position, not length; (2) where a reference exists
to check (54/155, 34.8% of the tail), the measured error is real and
substantial — **median 0.46s, mean 0.49s, both above the 0.3s tolerance
D15 proposed** — these are not spuriously low-confidence-but-well-timed
words. This directly confirms, with a real measurement, the hypothesis D20
Step 6 could only flag as "plausible... not proven this slice": production
windowing is deliberately unpadded (R.2 out of scope, `faChunkPlan.ts:47`),
so a word sitting near a raw chunk edge loses acoustic context a padded or
whole-file pass would have had, and both confidence AND (where checkable)
timing accuracy degrade together near that edge. The remaining 101/155
(65.2%) of the tail cannot be directly validated against ground truth this
slice (they fall beyond the 240s reference's own coverage) — reported as a
gap, not papered over with an extrapolation.

## Step 5 — tolerance provenance and sensitivity

**Provenance, stated explicitly, not re-derived.** D21's `0.311` Youden's-J
threshold (Step 4 of that document) was derived against a **0.3s (300ms)**
per-word timing tolerance. That tolerance is **D15's own provisional
figure** (`d15-mis-assignment-diagnostic-2026-08-13.md` §2.2), explicitly
marked there as "PRODUCT DECISION, NOT MEASURED, PENDING OWNER SIGN-OFF" —
"offered as a reasonable middle point, not a researched constant." D15 §2.3
itself already flagged this exact tolerance as **degenerate at the time it
was proposed**, because it equals **B-control-45s's own oracle floor**
(0.30s start max) — i.e. the proposed gate sits exactly AT the best
achievable bound of an oracle construction production cannot build, not
comfortably under it. Neither D21 nor this slice re-derives 0.3s from any
new principle; both treat it as an inherited, unratified input. **This
dependency is now stated explicitly in D21's own document** — see the note
added there this slice (Step 4's threshold-derivation paragraph now cites
this provenance directly).

**Sensitivity, computed from the same real 556-word population D21 Step 4
used** (reproduced this slice as `173-excerpt-240s-mis-assignment-filtered-pairs.json`,
confirmed to reproduce D21's own 0.3s-tolerance numbers exactly —
violators=347, non-violators=209, bestJ=0.9176, threshold=0.3112, TPR=96.5%,
FPR=4.8%, all matching D21's Step 4 verbatim):

| Tolerance | Violators | Non-violators | Best Youden's J | Threshold | TPR | FPR |
|---|---|---|---|---|---|---|
| 0.15s | 352 | 204 | 0.9337 | **0.3112** | 96.3% | 2.9% |
| **0.3s (D21's own figure)** | 347 | 209 | 0.9176 | **0.3112** | 96.5% | 4.8% |
| 0.5s | 343 | 213 | 0.9069 | **0.3112** | 96.8% | 6.1% |

**The optimal threshold is essentially insensitive to the tolerance choice
across this 3.3x range (0.15s–0.5s): it lands at the identical `0.3112`
confidence value at all three tolerances tested.** Only the TPR/FPR
trade-off shifts (tighter tolerance → fewer violators, better precision;
looser tolerance → more violators, more recall at a small FPR cost) — the
CUTOFF itself does not move. This is useful, previously-invisible
information for whichever future slice rules on the tolerance: whatever
value between 0.15s and 0.5s is eventually chosen, `CONF_MIN`'s own
data-derived optimum will not need to change with it.

## Step 6 — stale docs

D20's own Step 6 said 62.75% (1014/1616) below `CONF_MIN`, "close to
uninformative." That is D20's own real measurement at the time, unedited —
but it is superseded by D21's 9.43% (155/1643) under index attribution.
Amended `d20-ctc-infeasibility-2026-08-14.md` with a dated correction block
(not a rewrite) immediately before its own gate table, citing D21 and this
document and stating precisely which parts of D20 remain accurate (the
mechanism/root-cause diagnosis) versus which are stale (the "close to
uninformative" characterization).

Added a new row to `task5-slice-ledger.md` §6's Known-gap register:
**"CTC-infeasibility under production windowing (2/97 chunks at 709s,
D11/D20)" → CLOSED (D21/D22)**, recording that attribution (not the D20
fallback, which stays in place unchanged as a safety net) is what actually
resolved the root cause, and that D22 made the fix the planner's own
internal default.

## Full gate table

| Gate | Status |
|---|---|
| `isFaGateOpen()` capability+toggle gate (D17) | OFF by default, inert — no caller in any production path |
| `fa-inference` Cargo feature | OFF by default (not in default feature set) |
| `fa_align`/`fa_align_dev` production wiring | None — only dev-only `__faDevAlign`, unreachable from any UI control or production build |
| `computeFaChunkPlan` (the only function any production/script caller invokes) | **Unchanged** — still hardcoded to `segment.startTime` attribution, byte-identical since D11 |
| `computeFaChunkPlanWithAttribution`'s `attribution` default (this slice) | **Flipped to `'script-word-index'`** — `'segment-start-time'` remains reachable by explicit parameter; zero existing call sites' behavior changed (all pass the parameter explicitly already) |
| `align_chunked`'s CTC-infeasibility fallback (D20) | Unchanged this slice — still the safety net; 0/1643 fires under index attribution on this corpus, regression-guarded, re-verified live this slice |
| `CONF_MIN = 0.3` (both `syncConstants.ts` and `fa.rs`) | Unchanged — this slice adds tolerance-sensitivity data (Step 5), proposes no new value |
| `conf_min_matches_sync_constants_ts_literal` drift guard | Unchanged, still passing |
| R.2 (padding) | Unimplemented (unaffected) |
| R.5 (wildcard destination) | Unimplemented |
| R.7 (needsReview flag) | Unchanged — schema + Rust computation only, no production writer or consumer |
| IPC wiring (chunk plan → `fa_align` → UI) | None |
| `tsc --noEmit` | clean |
| `npm test` | 79 files, **1941 passed** (+1 — the new default-attribution test), 1 pre-existing skip |
| Golden replay (`scripts/phase4-handoff-replay-sync.test.ts`) | **6/6**, unchanged |
| Six `fa-e2e-alignment-*.json` fixtures | byte-identical (`git status --porcelain` empty) |
| `cargo check --lib` (default) | clean |
| `cargo check --lib --features fa-inference` | clean |
| `cargo test --lib` (default) | **63 passed, 0 failed** — unchanged from D21 |
| `cargo test --lib --features fa-inference` | **137 passed, 0 failed, 18 ignored** (+2 from D21's 16 — this slice's two new real-corpus tests, both `#[ignore]`d, neither in the default gate matrix) |
| `cargo clippy --all-targets` | 2 pre-existing warnings only (`fa_dev.rs`'s arg count, `FaModelCache::default`'s unit-arg lint) — unchanged, confirmed present before this slice |
| D21's zero-fallback regression guard, re-run live | **0/1643 fallback placeholders — still holds** |

**Empty-diff confirmation on protected files:** `git status --porcelain --
src/services/faAnchors.ts src/services/faTextNormalize.ts
src/services/syncConstants.ts Cargo.lock src-tauri/Cargo.lock
scripts/fixtures/ project-state.md CLAUDE.md docs/history.md` — empty.
Files changed this slice: `src/services/faChunkPlan.ts`,
`src/services/faChunkPlan.test.ts`, `src-tauri/src/fa_onnx.rs` (two new
`#[cfg(test)] #[ignore]`d real-corpus measurement tests, no production code
path touched), `docs/ws1-sync-pipeline/d20-ctc-infeasibility-2026-08-14.md`
(dated correction), `docs/ws1-sync-pipeline/d21-attribution-confmin-2026-08-14.md`
(tolerance-provenance note), `docs/ws1-sync-pipeline/task5-slice-ledger.md`
(known-gap register row), and this document.

## No new crates; production byte-identical

Zero new Rust dependencies (`Cargo.lock`/`src-tauri/Cargo.lock` both
untouched, confirmed above). No IPC signature change. No capability gate
touched, no Cargo feature default changed. `computeFaChunkPlan` — the only
function any current production or script caller invokes — is byte-for-byte
unchanged. The Step 2 default flip lives entirely in
`computeFaChunkPlanWithAttribution`, which still has zero production callers
(confirmed by grep: only test files and the existing D13/D21 measurement
scripts call it, all of which already pass `attribution` explicitly).
Production behaviour is byte-identical at this slice's end.

## No R.7 wiring, no R.5, no R.2, no production writer, no IPC, no gate flip

Confirmed by the gate table above and by grep: `needsReview`/`faWordTimings`
still have no production reader or writer; `isFaGateOpen()` is unchanged and
still OFF; no new `invoke()` call site was added anywhere in `src/`.

## git status / git log against origin

Before this slice's own commit:

```
On branch main
Your branch is up to date with 'origin/main'.
Changes not staged for commit:
	modified:   docs/ws1-sync-pipeline/d20-ctc-infeasibility-2026-08-14.md
	modified:   docs/ws1-sync-pipeline/d21-attribution-confmin-2026-08-14.md
	modified:   docs/ws1-sync-pipeline/task5-slice-ledger.md
	modified:   src-tauri/src/fa_onnx.rs
	modified:   src/services/faChunkPlan.test.ts
	modified:   src/services/faChunkPlan.ts
Untracked files:
	docs/ws1-sync-pipeline/d22-attribution-default-tail-2026-08-14.md
```

`git rev-list --left-right --count origin/main...HEAD` → `0 0` (fully synced
with `origin/main` at this slice's start — Step 0's push landed `13c4f97..
7684e28`). Per this slice's own Step 0 instruction, the "push at the start
of the next slice" convention is retired: this slice's own commit is
committed AND pushed below, not deferred.
