# D13 index-attribution measurements — 2026-08-13

> WS1 Task 5, Slice D13. D12 found attribution, not window size, dominates
> chunked-alignment disagreement, but proved it with `attribution_isolation`
> ("B"): an ORACLE construction (chunk boundaries cut wherever the whole-file
> reference itself has a real word gap, text assigned by whole-file WORD
> MEMBERSHIP) that production cannot reproduce, since it presupposes the
> whole-file answer it exists to replace. This document asks whether an
> INDEX-DERIVED rule — buildable from data `computeFaAnchors` already returns,
> no oracle required — reaches the same bound.
>
> Every number below is either copy-pasted verbatim from a real `--nocapture`
> run's own output (labeled `[d12_measurement: ...]`/`[d13_measurement: ...]`)
> or from the `alignQueryToSubject`-based TS triage scripts, all executed live
> during this documentation pass against the real `.work-phase4/replay/173/`
> corpus present on this machine — not reconstructed from memory or the D12
> commit message's prose summary. The whole-file 240s reference (569 words)
> was recomputed fresh this session (its D12-era cache had been cleared) and
> is shared, byte-identical, across every row below.

---

## 0. Step 0 hard-stop — read-only citations

**(a) Does `FaRun`/`computeFaAnchors` expose script-word/transcript-token
indices at each run boundary, or only times?**

`FaRun` (`src/services/faAnchors.ts:75-80`) carries only times and
provenance:
```ts
export interface FaRun {
  windowStart: number;
  windowEnd: number;
  startProvenance: RunBoundaryProvenance;
  endProvenance: RunBoundaryProvenance;
}
```
But `computeFaAnchors`'s full return type, `FaAnchorResult`
(`faAnchors.ts:82-85`), is `{ anchors: FaAnchor[]; runs: FaRun[] }`, and
`FaAnchor` (`faAnchors.ts:55-62`) already carries both indices:
```ts
export interface FaAnchor {
  qi: number;
  tokenIdx: number;
  timeSec: number;
}
```
`computeFaAnchors` itself returns `{ anchors, runs }` (`faAnchors.ts:242`) —
the indices are computed and returned every call. Pre-D13, `faChunkPlan.ts`'s
`computeRuns` discarded them by taking only `.runs` off the result
(`faChunkPlan.ts:91` before this slice's edit).

**(b) If indices were absent, could `faChunkPlan.ts` recover the pairing
without editing `faAnchors.ts`/`syncConstants.ts`?** Moot — (a) is true, so
recovery needs no protected-file edit; `faChunkPlan.ts`'s own
`computeRunContext` (new, Slice D13) simply keeps `anchors` alongside `runs`
from the SAME `computeFaAnchors` call it already made.

**(c) Did D12's ladder (A) and oracle (B) use identity word matching between
two runs over the same script word sequence, so the 4/569 `alignQueryToSubject`
bug affected only Whisper triage (C)?** Confirmed. `text_matched_diff_stats`
(`fa_onnx.rs:1656-1677`, both `d12_measurement` and this slice's
`d13_measurement`) is a plain sequential text-equality walk — no
`alignQueryToSubject` call anywhere in it — valid precisely because both
sides (a windowed pass's `WordSpan.text` and the whole-file reference's
`RefWord.text`) are the SAME model's own output over the SAME underlying
SCRIPT text, normalized identically by
`crate::fa::text::normalize_for_forced_alignment`
(`src-tauri/src/fa/text.rs:435-445`, the one normalizer both passes go
through — `fa_onnx.rs:474`). `alignQueryToSubject` is used ONLY in the
Whisper-triage scripts (`scripts/fa-whisper-triage-report.ts:89`,
`scripts/fa-whisper-triage-report-index.ts:89`) — the leg D12's own doc
comment (`fa_onnx.rs:1859-1874`) explains is necessary there specifically
because Whisper's tokens come from the actual spoken AUDIO, which routinely
differs in wording from the script. So the 4/569 failure mode (a first,
wrong Rust-side attempt to naive-walk FA-vs-Whisper) could only ever have
corrupted the Whisper-relative numbers (§4's triage table) — the ladder/B/
B-control/index legs' whole-file-relative numbers (§4's combined table) never
touch `alignQueryToSubject` and were never at risk from that bug.

**Both (a) and (b) are NOT both false** (a) is true outright — so per the
task's own instruction this is not a STOP condition. Proceeding.

---

## 1. Provenance repair

See `d11-chunked-alignment-2026-08-13.md`:
- §4's root-cause paragraph now cites `scripts/fa-run-distribution.ts` (new,
  Slice D13) instead of an unsourced "Step 3(a)" chat-transcript number, and
  states the exact reproduced figures (240s: p50=3.12s, p90=12.04s,
  p99=24.46s, max=24.46s over 46 runs) plus the 46→32 and 149→97
  runs-vs-chunks reconciliation (both confirmed exact — see script output
  below).
- §5 gained a "Provenance repair (Slice D13 Step 1)" block recording which
  of its four original "NOT concluded" items D12 (not D13) superseded, and
  which remain open.
- §6's filename-date check is independently re-confirmed below (no rename
  needed for either d10 or d11's own filename).

`project-state.md`, `CLAUDE.md`, and `docs/history.md` are untouched by this
slice, per the task's own constraint.

**`scripts/fa-run-distribution.ts` output** (pure TS, no ONNX — reproduces in
under a second):
```
=== 240s excerpt ===
audioDuration=241.18s segments=63 tokens=652 silences=86
runs=46  chunks=32  empty(text-less) runs=14  reconciles=true
run duration (s): min=0.00 p50=3.12 p90=12.04 p99=24.46 max=24.46
chunk duration (s): min=0.62 p50=6.52 p90=15.62 p99=25.60 max=25.60
boundary provenance counts: corpus-start=1 agreed-anchor=90 corpus-end=1

=== full project ===
audioDuration=709.01s segments=172 tokens=1836 silences=239
runs=149  chunks=97  empty(text-less) runs=52  reconciles=true
run duration (s): min=0.00 p50=3.04 p90=12.04 p99=24.46 max=27.92
chunk duration (s): min=0.62 p50=5.70 p90=13.02 p99=25.60 max=27.92
boundary provenance counts: corpus-start=1 agreed-anchor=296 corpus-end=1
```
`reconciles=true` at both lengths: 46 runs − 14 text-less = 32 chunks; 149 −
52 = 97. The `boundary provenance counts` line is also the source for a
finding used below (§3): **every internal boundary in this corpus is
`agreed-anchor`** — 0 `forced-split-*` boundaries at either length, at either
lattice. This matters for index attribution: the "no `qi` at a forced split"
fallback path (§3) is a correctness guard on this corpus, never an exercised
one.

**Filename-date check.** Host clock at time of this run: `Thu Aug 13 15:28:30
PKT 2026` (`date`), `Thu Aug 13 10:28:30 UTC 2026` (`date -u`). Latest commit
before this slice: `2026-08-13 02:55:44 +0500` (`git log -1`). `git log
--follow` on `d11-chunked-alignment-2026-08-13.md` itself shows its own
commit date as `2026-08-13 02:55:44 +0500`, matching its filename exactly. No
skew, no rename needed for either file.

---

## 2. Step 2 — disentangling B (measurement only)

**Question:** does B's near-zero disagreement come from its TEXT being
correct, or from its BOUNDARIES being chosen at convenient, already-known-
clean cut points (B cuts only where the whole-file reference itself shows a
real word gap — a boundary can never land inside a spoken word by
construction)? **B-control** holds boundaries at the REAL, anchor-derived
7s-coalesced run structure (`173-excerpt-240s-ladder-7s.json`'s own
`startSec`/`endSec` — a boundary here is chosen by R.1 three-source agreement,
oblivious to where the whole-file pass's own words start and end, so it CAN
land inside a word) and assigns text by the SAME oracle whole-file-word-
membership rule B uses, keyed by each reference word's own start time
(`fa_onnx.rs`'s `d13_measurement::b_control`).

```
d13_measurement: [b-control] 28 windows -> 28 non-empty chunks (real anchor-derived 7s-coalesced boundaries, oracle text)
d13_measurement: [b-control] matched=569/569 (ref=569) ctc_failed=0/28 wall=41.8s
  START(s) min=0.0000 p50=0.0000 p90=0.0200 p99=0.3200 max=0.5400
  END(s)   min=0.0000 p50=0.0000 p90=0.0200 p99=0.1200 max=0.4600
```

**Comparison** (all fresh re-runs against the same 569-word reference this
session):

| Leg | boundary source | text source | START max | END max |
|---|---|---|---|---|
| ladder-7s (7s control) | real, anchor-derived | `segment.startTime` | 7.54s | 7.48s |
| **B-control** | real, anchor-derived | oracle (whole-file word membership) | **0.54s** | **0.46s** |
| B (full) | oracle (cut at real gaps) | oracle (whole-file word membership) | 0.08s | 0.33s |

**Plainly: both matter, but text assignment accounts for nearly all of it.**
Switching ONLY the text source (ladder-7s → B-control, boundaries held fixed
at the real 7s-coalesced structure) cuts max disagreement from 7.54s to
0.54s — a ~14× reduction. Switching ONLY the boundary source on top of that
(B-control → full B, oracle text held fixed) cuts it further, from 0.54s to
0.08s — a further ~7× reduction. Boundary placement is a real, separate,
measurable contributor (a real anchor CAN land inside a word's own acoustic
span in a way B's gap-cut boundaries structurally cannot), but it is a
second-order effect next to text assignment's first-order one on this
corpus.

---

## 3. Step 3 — index attribution implementation

`faChunkPlan.ts` gained `computeFaChunkPlanWithAttribution(segments, tokens,
silences, audioDuration, attribution, coalesceTargetSec?)`, where
`attribution: 'segment-start-time' | 'script-word-index'`
(`FaTextAttribution`). `'segment-start-time'` is byte-identical to the
existing `computeFaChunkPlan`/`computeFaChunkPlanCoalesced` (verified by
`toEqual` unit tests) — no production default changed. `'script-word-index'`
assigns each chunk's text by the script-word (`qi`) range between its
bounding anchors, via `runQiRanges` (pairs uncoalesced runs with anchor `qi`
by walking both in lockstep — safe because `computeFaAnchors` builds its
boundary list as `[corpus-start, ...anchors (qi-order), corpus-end]`) and
`attributeByIndex` (places each RAW script token by its own `qiStart`,
folding audio-only or text-only degenerate windows into a neighbor exactly as
`runsToChunks` already does for the time-attributed path).

**Text domain finding.** Chunk text must be RAW segment text (whitespace
tokens), not `queryWords` (`normalizeSceneDoc`'s own output) — measured on
the real 240s excerpt: raw text yields exactly 569 representable words
through `normalize_for_forced_alignment` (matching the whole-file reference
exactly), while `queryWords.join(' ')` yields 589, because
`normalizeSceneDoc` expands "41st" → "forty one st" where the FA normalizer
keeps "41st" differently and "don't" stays whole where `normalizeSceneDoc`
splits it. Per-RAW-TOKEN normalization was checked against whole-segment
normalization for faithfulness (a token-by-token `stripStageDirections` could
in principle diverge from a whole-string pass) — measured 63/63 real segments
agree; `assertQiMapConsistent` (`faChunkPlan.ts`) throws rather than
silently mis-cut text if a future corpus disagrees.

**A real bug, caught by real-corpus measurement, fixed before any number in
§4 below was accepted.** The first implementation called `runQiRanges` on
the ALREADY-COALESCED run array. `coalesceRuns` discards an absorbed internal
boundary's own provenance (its own doc comment says so directly), so a
merged run that had silently swallowed 3 original sub-runs still ends in
`'agreed-anchor'` — and the one-anchor-per-run walk desynced from which
anchors a merged run actually spans. This produced a genuinely corrupted
`index-7s` run: `matched=212/212 (ref=569)` (i.e. only 212 of 569 words were
even produced) with `START(s) ... p50=45.8800 ... max=111.2200` — nonsense,
caught only because Step 4's real-corpus run surfaced it; the unit tests
written alongside the initial implementation (global word-conservation +
order checks) do not, because a misassigned qi split still conserves the
total word count and order globally, just not per-chunk. Fixed by
`coalesceRunQiRanges`: merges qi bounds in lockstep with time bounds, in ONE
pass over the original per-anchor ranges (same merge predicate, same order,
same decisions as `coalesceRuns` — verified identical resulting chunk counts
and window bounds before/after the fix), never by re-deriving qi from an
already-coalesced array. Two regression tests
(`faChunkPlan.test.ts`, "coalesced index attribution" describe block) assert
EXACT per-chunk text at a coalesce target that forces an anchor to be
absorbed — the property class the original tests missed.

**Unit tests** (21 total in `faChunkPlan.test.ts`, all passing): every script
word lands in exactly one chunk (no duplication, no drop) versus the unmerged
plan; chunk text order is preserved; gapless/full-span window coverage holds
under index attribution too; no chunk ever gets text with a zero-length
audio window; the word-conservation invariant holds under coalescing; and —
the regression pair above — exact per-chunk text is correct (not just
globally conserved) when coalescing absorbs an internal anchor.

**Gates after Step 3** (before any Step 4 measurement ran): `npm run lint`
clean; `npm test` 77 files, 1919 passed (1908 + 11 new), 1 skipped; golden
replay 6/6; `cargo check` clean both configs.

---

## 4. Step 4 — combined measurement table

All rows below share the identical 569-word whole-file reference, freshly
computed this session (`d12_measurement`/`d13_measurement`'s
`whole_file_reference_240s`, same cache file path either module hits first).
`text_matched_diff_stats`'s sequential walk is valid for every row here (see
§0(c)) — all compare windowed SCRIPT-derived output against the whole-file
SCRIPT-derived reference.

| Row | Boundary source | Text source | Chunks | Matched | CTC failed | START p50/p90/p99/max (s) | END p50/p90/p99/max (s) | Wall |
|---|---|---|---|---|---|---|---|---|
| ladder-7s (D12) | real, anchor-derived, 7s-coalesced | `segment.startTime` | 28 | 569/569 | 0/28 | 2.12 / 4.86 / 6.20 / 7.54 | 2.10 / 4.62 / 6.24 / 7.48 | 41.7s |
| ladder-45s (D12) | real, anchor-derived, 45s-coalesced | `segment.startTime` | 7 | 569/569 | 0/7 | 0.00 / 1.62 / 6.20 / 7.54 | 0.00 / 1.62 / 6.24 / 7.48 | 40.0s |
| B (D12, `attribution_isolation`) | oracle (cut at real reference gaps) | oracle (whole-file word membership) | 38 | 569/569 | 0/38 | 0.01 / 0.02 / 0.03 / 0.08 | 0.01 / 0.01 / 0.03 / 0.33 | 45.9s |
| B-control (D13, §2) | real, anchor-derived, 7s-coalesced | oracle (whole-file word membership) | 28 | 569/569 | 0/28 | 0.00 / 0.02 / 0.32 / 0.54 | 0.00 / 0.02 / 0.12 / 0.46 | 41.8s |
| **index-7s (D13)** | real, anchor-derived, 7s-coalesced | index (`qi` range) | 29 | 569/569 | 0/29 | 0.00 / 0.02 / 0.72 / 1.72 | 0.00 / 0.02 / 0.68 / 1.72 | 40.9s |
| **index-45s (D13)** | real, anchor-derived, 45s-coalesced | index (`qi` range) | 7 | 569/569 | 0/7 | 0.00 / 0.02 / 0.30 / 0.76 | 0.00 / 0.02 / 0.14 / 0.66 | 38.5s |

Every row here reaches 0 CTC-infeasibility (unlike D11's original unmerged
32-chunk plan, which had 1/32) — even light 7s coalescing already merges away
the two pathologically short windows (0.62s, 1.40s) D11 §4 identified as the
proximate cause.

**Index attribution vs. the two attribution baselines it should be judged
against:** against B-CONTROL (same real, non-oracle boundary source — the
fair comparison, since index attribution is a text-only fix and cannot by
itself change where boundaries fall), index-45s (max 0.76s/0.66s) is close
— same order of magnitude, both sub-1-second, a further ~3.5× tighter than
index-7s's own 1.72s. Against full B (oracle boundaries too), a real gap
remains, fully consistent with §2's own finding that boundary placement is a
genuine second-order contributor index attribution does not and structurally
cannot address (`faAnchors.ts` — the boundary source — is out of scope this
slice by the task's own constraint).

### Whisper triage (external ground truth, `alignQueryToSubject`-based —
D12's own methodology, explicitly not D10's; see §0(c))

```
=== whole-file-vs-whisper ===
FA words=569, whisper subject words=667, matched=485
START(s) min=0.0000 p50=0.3600 p90=0.7200 p99=1.0200 max=1.2000
END(s)   min=0.0000 p50=0.2800 p90=0.5800 p99=0.9100 max=1.0100

=== index-45s-vs-whisper ===
FA words=569, whisper subject words=667, matched=485
START(s) min=0.0000 p50=0.3600 p90=0.7000 p99=1.0200 max=1.2000
END(s)   min=0.0000 p50=0.2700 p90=0.5800 p99=0.9100 max=1.0100

=== ladder-90s-vs-whisper (D12's own default rung, supplementary context) ===
FA words=569, whisper subject words=667, matched=485
START(s) min=0.0000 p50=0.3600 p90=0.7600 p99=3.6600 max=5.0400
END(s)   min=0.0000 p50=0.2800 p90=0.6600 p99=3.8500 max=4.8700
```

**index-45s is statistically indistinguishable from the whole-file reference
itself** against real, independent Whisper ground truth (p90 0.70 vs. 0.72,
p99 identical at 1.02, max identical at 1.20 — start side; end side within
0.01s at every percentile). `ladder-90s` — D12's own best time-attribution
rung, at DOUBLE index-45s's window size and therefore its most favorable
comparison — still carries a heavy tail even at its widest, most expensive
setting: p99 3.66s, max 5.04s, nearly 4× and 4× the whole-file reference's
own numbers. Windowing plus index attribution does not measurably degrade
accuracy relative to the whole-file reference when checked against
ground truth neither side was fit to; windowing plus the OLD
`segment.startTime` rule does, substantially, even at a much wider window.

---

## 5. Step 5 — derive or stop

**Verdict: DERIVE.** Index attribution at 45s coalescing lands close to
B-control's bound (the fair, same-boundary comparison) and is
indistinguishable from the whole-file reference itself against external
(Whisper) ground truth. It does not reach full B's bound — §2 already
isolated why: boundary placement is a real, separate, second-order
contributor that a text-only fix cannot close. That residual gap is
attributable to a named, already-quantified cause (boundary placement,
`faAnchors.ts`, out of scope this slice), not to any remaining defect in
index attribution's own text rule.

**Proposed agreement budget, derived from a stated principle, not fitted to
the index-attribution numbers themselves:**

Two candidate principles were available per the task's own framing:

1. **Frame duration (0.02s)**, the CTC output grid's own quantization
   (`conv_stride`-derived, `fa_onnx.rs:1814-1822`'s own citation). Rejected
   as an OPERATING ceiling: even oracle-construction B's own max (0.08s
   start, 0.33s end) exceeds it, so a strict 1-frame budget would reject the
   best construction measured in this document. It remains the right FLOOR
   reference — nothing tighter than measurement/model granularity is a
   meaningful target — but not the budget itself.
2. **Measured Whisper delta.** The whole-file reference's OWN measured
   disagreement against real, independent Whisper ground truth (§4's triage
   table) — a number measured BEFORE any windowed/attributed output is
   considered, so using it as the budget for judging windowed output is not
   fitted to that output. The principle: a windowed approximation should not
   be held to a tighter internal (whole-file-relative) standard than the
   whole-file reference itself achieves against external ground truth —
   demanding otherwise asks the approximation to be more precise than the
   thing it approximates.

**Proposed budget** (whole-file-reference-relative, from principle 2):
p99 ≤ ~1.0s, max ≤ ~1.2s (start) / ~1.0s (end) — the whole-file-vs-Whisper
p99/max figures themselves.

**Against this budget:** index-45s clears comfortably (max 0.76s/0.66s,
well under 1.2s/1.0s). index-7s clears at p99 (0.72s/0.68s, under 1.02s/
0.91s) but its own max (1.72s/1.72s) exceeds the budget on both sides — a
real, honestly-reported miss, not smoothed over. B-control clears
comfortably (max 0.54s/0.46s). This budget is not wired to any production
gate in this slice (out of scope, matching D12's own "not yet a pass/fail
verdict" framing) — it is a derived reference point for whichever future
slice does that wiring.

---

## Cross-references

- D12's own measurements and the "conclusions NOT yet supported" section
  this document's §1 provenance-repairs — `d11-chunked-alignment-2026-08-13.md`.
- Windowing/chunk-plan design — `task5-slice-ledger.md`'s D11 entry; this
  document's own cross-reference entry there.
- Real corpus fixture used — `.work-phase4/replay/173/` (gitignored, not
  committed — present on this machine).
- Reproduction commands (mirrors D12's own invocation pattern):
  ```
  SCRATCHPAD_DIR=<dir> npx tsx scripts/fa-run-distribution.ts
  SCRATCHPAD_DIR=<dir> npx tsx scripts/dump-fa-chunk-plan.ts
  SCRATCHPAD_DIR=<dir> npx tsx scripts/dump-fa-chunk-plan-ladder.ts
  SCRATCHPAD_DIR=<dir> npx tsx scripts/dump-fa-chunk-plan-index-ladder.ts
  ORT_DYLIB_PATH=<path> FA_CHUNK_PLAN_DIR=<dir> cargo test --features fa-inference \
    -- --ignored --nocapture --exact fa_onnx::d13_measurement::b_control
  … (repeat --exact for index_7s, index_45s, whisper_triage_index, and
    d12_measurement::{attribution_isolation,ladder_7s,ladder_45s})
  FA_CHUNK_PLAN_DIR=<dir> npx tsx scripts/fa-whisper-triage-report-index.ts 45s
  ```
