# D14 measurement closure — 2026-08-13

> WS1 Task 5, Slice D14, Track A. Closes four open questions D13 left
> unresolved: (A1) whether D13's own "index-45s statistically
> indistinguishable from whole-file" Whisper-triage finding survives a direct
> plumbing check; (A2) the missing B-control-at-45s row D13's own combined
> table lacked; (A3) whether anchor-time error actually explains index-45s's
> residual disagreement against the whole-file reference, a question D13 §5
> asserted an answer to without measuring it; (A4) a budget derived from an
> alignment-intrinsic quantity rather than Whisper noise.
>
> Every number below is either copy-pasted verbatim from a real
> `--nocapture` `cargo test` run's own output, or from the TS analysis
> scripts this slice added, run live during this documentation pass against
> the real `.work-phase4/replay/173/` corpus present on this machine — not
> reconstructed from memory or a prior session. The whole-file 240s reference
> (569 words) was recomputed fresh this session (cache cleared between
> sessions) and reproduced D13's own recorded figures exactly wherever
> compared (see A1) — direct evidence the whole pipeline is deterministic
> across sessions, not just within one.

---

## A1 — plumbing check on the Whisper-triage coincidence

**Question.** D13 §4 found `index-45s-vs-whisper` statistically
indistinguishable from `whole-file-vs-whisper` (several percentiles equal to
2dp) — striking enough to verify directly rather than trust.

**Input file identity (SHA-256).** The two inputs are genuinely different
files, not a self-comparison bug:

```
173-excerpt-240s-reference-words.json:  sha256=09617ed3c3f0f6d2aad4e12056b676b0231d40ac950029ab2cfd86f308438799
173-excerpt-240s-index-45s-words.json:  sha256=9bf31772c5efe1639a56f24b19c5ea2ef2490591c3599eb03ebf196f335bdbbd
```

**Percentiles (fresh run, `scripts/fa-whisper-triage-report-index.ts`,
`FA_CHUNK_PLAN_DIR` cleared and rebuilt fresh this session):**

```
=== whole-file-vs-whisper ===
FA words=569, whisper subject words=667, matched=485
START(s) min=0.0000 p50=0.3600 p90=0.7200 p99=1.0200 max=1.2000
END(s)   min=0.0000 p50=0.2800 p90=0.5800 p99=0.9100 max=1.0100

=== index-45s-vs-whisper ===
FA words=569, whisper subject words=667, matched=485
START(s) min=0.0000 p50=0.3600 p90=0.7000 p99=1.0200 max=1.2000
END(s)   min=0.0000 p50=0.2700 p90=0.5800 p99=0.9100 max=1.0100
```

These are **byte-for-byte identical to D13's own recorded numbers** (§4 of
`d13-index-attribution-2026-08-13.md`), to 4 decimal places, despite being
recomputed from a from-scratch reference (D13's own note that "the whole-file
240s reference... was recomputed fresh this session" applies here too — the
cache was empty at the start of this slice). This is independent evidence
the whole `align_chunked`/Viterbi path is deterministic across sessions, not
a coincidence of stale caching.

**p99/max are genuinely identical, not merely close** (start: p99 1.02=1.02,
max 1.20=1.20; end: p99 0.91=0.91, max 1.01=1.01) — only p90 differs at all
(0.72 vs 0.70, start; 0.58=0.58, end). Per the task's own instruction, the
per-word top-10-by-`|startDiff|` tail for each side:

| whole-file-vs-whisper | index-45s-vs-whisper |
|---|---|
| qi410 "which" faStart=177.48 whisperStart=176.28 **diff=1.2000** | qi410 "which" faStart=177.48 whisperStart=176.28 **diff=1.2000** |
| qi403 "of" diff=1.1300 | qi403 "of" diff=1.1300 |
| qi404 "whatever" diff=1.0800 | qi404 "whatever" diff=1.0800 |
| qi405 "the" diff=1.0700 | qi405 "the" diff=1.0700 |
| qi411 "includes" diff=1.0500 | qi411 "includes" diff=1.0500 |
| qi407 "crew" diff=1.0200 | qi407 "crew" diff=1.0200 |
| qi406 "last" diff=0.9900 | qi406 "last" diff=0.9900 |
| qi408 "left" diff=0.9900 | qi408 "left" diff=0.9900 |
| qi559 "rather" diff=0.9300 | qi559 "rather" diff=0.9300 |
| qi189 "sever" diff=0.9200 | qi412 "whatever" diff=0.9200 |

**9 of the top 10 outlier words are the identical qi, identical text,
identical FA start/end time, identical Whisper start/end time, in BOTH
comparisons** — not just similar percentiles. This is not a coincidence in
the summary statistics; it is index-45s reproducing the whole-file
reference's own per-word FA output almost exactly for words far from any
chunk boundary or CTC-failure zone. The large Whisper deltas these specific
words carry are therefore a **Whisper-side phenomenon** (a real ASR
transcription/timestamp quirk on this corpus, e.g. "which... last crew left
behind" around 175-178s), not evidence about windowing accuracy one way or
the other. **Verdict: the coincidence is real and mechanistically explained,
not a plumbing bug.**

---

## A2 — the missing control: B-control at 45s

New Rust test `d13_measurement::b_control_45s` (`fa_onnx.rs`), sharing
`b_control`'s exact boundary/oracle-text logic via an extracted
`run_b_control(context, ladder_label)` helper — real, anchor-derived
45s-coalesced boundaries (`173-excerpt-240s-ladder-45s.json`'s own
`startSec`/`endSec`), oracle whole-file-word-membership text:

```
d13_measurement: [b-control-45s] 7 windows -> 7 non-empty chunks (real anchor-derived 45s-coalesced boundaries, oracle text)
d13_measurement: [b-control-45s] matched=569/569 (ref=569) ctc_failed=0/7 wall=39.4s
  START(s) min=0.0000 p50=0.0000 p90=0.0200 p99=0.0200 max=0.3000
  END(s)   min=0.0000 p50=0.0000 p90=0.0200 p99=0.0200 max=0.2400
```

### Combined table, every row now matched by window size

| Row | Boundary source | Text source | START p50/p90/p99/max (s) | END p50/p90/p99/max (s) |
|---|---|---|---|---|
| ladder-7s (D12) | real, 7s-coalesced | `segment.startTime` | 2.12/4.86/6.20/7.54 | 2.10/4.62/6.24/7.48 |
| ladder-45s (D12) | real, 45s-coalesced | `segment.startTime` | 0.00/1.62/6.20/7.54 | 0.00/1.62/6.24/7.48 |
| B (D12, full oracle) | oracle (real gaps) | oracle (word membership) | 0.01/0.02/0.03/0.08 | 0.01/0.01/0.03/0.33 |
| **B-control-7s (D13)** | real, 7s-coalesced | oracle (word membership) | 0.00/0.02/0.32/**0.54** | 0.00/0.02/0.12/**0.46** |
| **B-control-45s (D14, new)** | real, 45s-coalesced | oracle (word membership) | 0.00/0.02/0.02/**0.30** | 0.00/0.02/0.02/**0.24** |
| index-7s (D13) | real, 7s-coalesced | index (`qi` range) | 0.00/0.02/0.72/1.72 | 0.00/0.02/0.68/1.72 |
| index-45s (D13) | real, 45s-coalesced | index (`qi` range) | 0.00/0.02/0.30/0.76 | 0.00/0.02/0.14/0.66 |

**Does index attribution reach oracle (B-control) attribution at equal window
size?**

- **At 7s: no.** index-7s's own max (1.72s/1.72s) is **~3.2x/3.7x**
  B-control-7s's own max (0.54s/0.46s) at the identical boundary structure.
- **At 45s: no, though closer in absolute terms.** index-45s's own max
  (0.76s/0.66s) is **~2.5x/2.75x** B-control-45s's own max (0.30s/0.24s) —
  the SAME real anchor-derived boundaries, text being the only variable that
  differs. Coalescing to a wider window narrows the ratio (3.2x→2.5x,
  3.7x→2.75x) but does not close it — text assignment is not the whole
  story at 45s any more than boundary placement alone is (§4's own D13
  finding). This corrects D13 §4's own softer "close... same order of
  magnitude" framing: with the real matched-window B-control-45s number in
  hand, index-45s is closer to B-control-45s than index-7s was to
  B-control-7s, but "close" does not mean "reaches" at either window size —
  neither does, independently.

---

## A3 — residual diagnosis: does anchor-time error explain index-45s's gap?

D13 §5 *asserted*, without measuring it, that index-45s's own residual gap
(vs. the whole-file reference) is "attributable to a named, already-
quantified cause (boundary placement, `faAnchors.ts`)" — this is Step 5's own
skipped question.

**Method note — a wrong first attempt, caught by its own precondition
check.** The first implementation tried to recover each chunk's
`[qiLo, qiHi)` script-word range from `FaAnchor.qi` and index directly into
the FA output word arrays. This is WRONG: `qi` lives in
`normalizeSceneDoc`'s word space (589 words on this excerpt — the same
589-vs-569 text-domain gap D13 Step 3 already documented for a different
reason), but the FA output arrays (`WordSpan`, both the reference and the
windowed pass) live in Rust's `normalize_for_forced_alignment` space (569
words) — the two do not share an index space. The script's own precondition
check caught this immediately (chunk word counts summed to 589, not 569) and
refused to proceed rather than silently mis-attribute words to the wrong
chunk. Fixed by matching chunk boundaries to reference words **by time**
instead: a chunk boundary's seconds value IS an anchor's own `timeSec` by
construction (`coalesceRuns`/`coalesceRunQiRanges` only ever adopt an
existing run's own edge value, never interpolate one), so the whole-file
reference word nearest that boundary time is looked up directly — no `qi`
translation needed. `scripts/fa-index-45s-residual-diagnosis.ts`.

**Per-chunk table** (mean/max over each chunk's own words; "edge" = the
single first/last word in the chunk; anchor error = `|boundary time − nearest
whole-file-reference word's own start|`, `null` at the corpus start/end):

| chunk | window (s) | words | mean\|startD\| | max\|startD\| | mean\|endD\| | max\|endD\| | edge startD | edge endD | left anchor err | right anchor err |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | [0.00, 42.48) | 101 | 0.0091 | 0.60 | 0.0061 | 0.20 | 0.0000 | 0.20 | corpus-start | 0.06 |
| 1 | [42.48, 82.88) | 89 | 0.0157 | **0.76** | 0.0157 | **0.66** | 0.0000 | 0.66 | 0.06 | 0.04 |
| 2 | [82.88, 127.14) | 102 | 0.0033 | 0.14 | 0.0047 | 0.14 | 0.0000 | 0.14 | 0.04 | 0.04 |
| 3 | [127.14, 161.46) | 82 | 0.0144 | 0.44 | 0.0127 | 0.44 | 0.0000 | 0.44 | 0.04 | 0.02 |
| 4 | [161.46, 194.22) | 80 | 0.0085 | 0.52 | 0.0093 | 0.48 | 0.0000 | 0.48 | 0.02 | 0.10 |
| 5 | [194.22, 225.56) | 78 | 0.0067 | 0.30 | 0.0059 | 0.12 | 0.0000 | 0.12 | 0.10 | 0.02 |
| 6 | [225.56, 241.18) | 37 | 0.0049 | 0.02 | 0.0038 | 0.02 | 0.0000 | 0.00 | 0.02 | corpus-end |

Chunk 1 alone accounts for both the combined table's own START max (0.76)
and END max (0.66) for index-45s.

**Correlation** (n=6 internal boundaries either side, excluding the
corpus-start/-end chunk):

```
pearson(edgeStartDiff, leftAnchorError)  =    NaN  (edgeStartDiff is 0.0000 for every chunk — zero variance)
pearson(edgeEndDiff,   rightAnchorError) = 0.2425
pearson(meanStartDiff, leftAnchorError)  = 0.1186
pearson(meanEndDiff,   rightAnchorError) = -0.0861
pearson(maxStartDiff,  leftAnchorError)  = 0.1949
pearson(maxEndDiff,    rightAnchorError) = 0.2425
```

Every boundary word's own `startDiff` is EXACTLY 0.0000 in every chunk — an
anchor is, by construction, a confident three-source-agreement point, so the
word sitting right at one is disproportionately an "easy," exactly-agreeing
case for FA; that pairing carries no information (zero variance, undefined
correlation). The remaining five pairings are all **weak** (|r| ≤ 0.24,
n=6) — nowhere near a correlation strong enough to call anchor-time error
the explanation for the residual. Chunk 1 is the clearest counter-example: it
carries the row's entire max, yet its own bounding anchor errors are modest
(0.06s left, 0.04s right) — small, unremarkable numbers that do not
distinguish it from chunks 2-6, which show far smaller word-level residuals.

**Verdict: anchor-time error PARTIALLY explains the residual, at best, and
does not explain its dominant outlier.** A weak positive trend exists across
4 of 5 non-degenerate pairings, consistent with boundary placement being *a*
contributor (§2's own finding, unchanged), but chunk 1's own disagreement is
not proportional to its own anchor's imprecision — some other source
contributes at least as much, most plausibly the same one D7's own
cancellation rationale already named: windowed and whole-file passes are
different algorithm runs (a smaller receptive field, a different Viterbi
target-sequence length) with no guaranteed frame-level equivalence even away
from any boundary.

**Candidate boundary-refinement designs, named only — not proposed or
implemented this slice:**

1. **Symmetric padding past the anchor boundary** (R.2's own deferred
   design), trimming the result back to the chunk's nominal window. Cost:
   reintroduces exactly the multi-pass-ambiguity question R.2 was scoped to
   answer carefully; more forward-pass compute per chunk; needs its own
   fresh agreement measurement, not inherited from this one.
2. **Wider left/right context "bleed" per chunk, reconciled post-hoc** —
   run each chunk with extra context, then trim to its own nominal boundary.
   Cost: adjacent chunks' own bleed regions can disagree with each other
   (same "different algorithm" argument D7 raised for the whole windowed-
   vs-whole-file comparison, now applied pairwise between neighbors); needs
   a reconciliation rule that does not yet exist.
3. **Confidence-weighted blending across an overlap** — if two neighboring
   chunks both cover a boundary word (design 1/2's own prerequisite), blend
   their two predictions by `WordSpan.score`. Cost: needs an overlap scheme
   to exist first, plus a principled blending rule (naive averaging of two
   independently-Viterbi'd times has no obvious correctness argument).

---

## A4 — re-derived budget, alignment-intrinsic

**Derivation principle, stated before any number below:** the budget is
`B-control(windowSize)`'s own measured `(p99, max)` — the best any
REAL-boundary construction (the same anchor-derived boundaries index
attribution actually runs on) can achieve, given PERFECT text. This is
alignment-intrinsic (derived from this pipeline's own real boundary
structure, not from an external ASR's transcription noise) and is the
*matched-window-size counterpart* A2 was built to supply. Frame duration
(0.02s) is rejected as the budget itself (only as a floor reference) for the
same reason D13 §5 already gave: even oracle `B`'s own max (0.08s/0.33s)
exceeds it. Whisper delta is **not** used as the budget here — A2/A3 already
show it does not participate in this derivation at all; it is reported below
only as a separately-labeled usefulness ceiling, per the task's own
instruction.

### Pass/fail against `Budget(windowSize) = B-control(windowSize).(p99, max)`

| Row | Budget (p99 / max, start\|end) | Actual (p99 / max, start\|end) | Verdict |
|---|---|---|---|
| B (D12, full oracle) | vs. 7s budget: 0.32/0.54 \| 0.12/0.46 | 0.03/0.08 \| 0.03/0.33 | **PASS** (every measure) |
| B-control-7s | is the 7s budget | — | trivial PASS |
| B-control-45s | is the 45s budget | — | trivial PASS |
| ladder-7s (old rule) | 0.32/0.54 \| 0.12/0.46 | 6.20/7.54 \| 6.24/7.48 | **FAIL** (every measure, by ~14x) |
| ladder-45s (old rule) | 0.02/0.30 \| 0.02/0.24 | 6.20/7.54 \| 6.24/7.48 | **FAIL** (every measure, by ~25-300x) |
| index-7s | 0.32/0.54 \| 0.12/0.46 | 0.72/1.72 \| 0.68/1.72 | **FAIL** (every measure) |
| index-45s | 0.02/0.30 \| 0.02/0.24 | 0.02/0.76 \| 0.02/0.66 | **p99 TIES (both sides, exact); max FAILS (both sides, ~2.5x over)** |

**No row built from real (non-oracle) boundaries clears this budget on its
own max figure.** index-45s comes closest — it exactly meets the p99 bar on
both sides — but its max does not clear, by roughly the same 2.5x margin A2
already found between it and B-control-45s directly (same underlying gap,
restated as a pass/fail call). Per the task's own instruction: **this is
reported as a plain miss, and the budget is not widened to make it pass.**
This budget is not wired to any production gate in this slice (unchanged
from D12/D13's own framing) — it is a derived reference point for whichever
future slice does that wiring, and a stricter, more honest one than D13's
own Whisper-relative proposal (below).

**Whisper delta — a separate quantity, reported for context only, not the
budget:**

```
whole-file-vs-whisper: START p99=1.02 max=1.20   END p99=0.91 max=1.01
```

This is forced alignment's own **usefulness ceiling** relative to
independent ground truth — even the whole-file reference, FA's best-case
construction, is itself only accurate to ~1.0-1.2s against real Whisper
timestamps on this corpus. index-45s failing the (much stricter)
alignment-intrinsic budget above does not mean it is less USEFUL in absolute
terms than the whole-file reference: A1 already showed index-45s is
statistically indistinguishable from whole-file-vs-Whisper. The two
questions — "does index attribution reach what real boundaries could
achieve with perfect text" (A4's own question, answer: no) and "is index
attribution any worse than the whole-file reference in the real world" (A1's
question, answer: no, indistinguishable) — have different, non-contradictory
answers on this corpus.

---

## Cross-references

- D13's own combined table, Whisper-triage finding, and original (rejected
  as the budget, kept as context) budget proposal —
  `d13-index-attribution-2026-08-13.md`.
- D12's window-size ladder and `attribution_isolation` (full oracle `B`) —
  `d11-chunked-alignment-2026-08-13.md` §5's provenance-repair notes and
  `d13-index-attribution-2026-08-13.md` §4.
- Real corpus fixture used: `.work-phase4/replay/173/` (gitignored, not
  committed — present on this machine).
- Reproduction commands:
  ```
  SCRATCHPAD_DIR=<dir> npx tsx scripts/dump-fa-chunk-plan.ts
  SCRATCHPAD_DIR=<dir> npx tsx scripts/dump-fa-chunk-plan-ladder.ts
  SCRATCHPAD_DIR=<dir> npx tsx scripts/dump-fa-chunk-plan-index-ladder.ts
  ORT_DYLIB_PATH=<path> FA_CHUNK_PLAN_DIR=<dir> FA_REQUIRE_ORT=1 cargo test --features fa-inference \
    -- --ignored --nocapture --exact fa_onnx::d13_measurement::b_control_45s
  ORT_DYLIB_PATH=<path> FA_CHUNK_PLAN_DIR=<dir> FA_REQUIRE_ORT=1 FA_D13_BEST_RUNG=45s cargo test --features fa-inference \
    -- --ignored --nocapture --exact fa_onnx::d13_measurement::whisper_triage_index
  FA_CHUNK_PLAN_DIR=<dir> npx tsx scripts/fa-whisper-triage-report-index.ts 45s
  FA_CHUNK_PLAN_DIR=<dir> npx tsx scripts/fa-index-45s-residual-diagnosis.ts
  ```
