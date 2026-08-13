# D15 mis-assignment diagnostic + budget replacement — 2026-08-13

> WS1 Task 5, Slice D15 (Track A: A1–A3). D14's own A3 tested whether
> **anchor-time error** (how imprecise an anchor's committed boundary is)
> correlates with index-45s's residual disagreement against the whole-file
> reference, and found only a weak correlation (|r| ≤ 0.24, n=6) — the wrong
> variable to test. This document tests the actual mechanism directly:
> **which chunk a word's TEXT was assigned to**, compared word-by-word
> between index attribution and B-control (oracle-time) attribution at
> shared boundaries, using data already on disk from D13/D14's own real-corpus
> runs (`~/.../fa-chunk-plans/173-excerpt-240s-*.json`, produced during those
> slices' `#[ignore]`d `cargo test` runs). **No ONNX run was executed to
> produce this document** — every number below is either read directly from
> an existing JSON file or computed from files that already existed on disk,
> with the two exceptions noted inline where a computation had to be
> reconstructed from raw data because the original slice did not persist an
> aggregate the size this document needed (index-7s's per-word alignment
> output does not exist on disk anywhere — see §1.3).
>
> Also replaces D14 §A4's degenerate "B-control-as-budget" derivation
> (B-control uses oracle text production cannot compute — a floor, not a
> gate) with an explicit product-decision proposal pending owner sign-off
> (§2), and re-reports every combined-table row against it with exceedance
> counts, not just percentiles (§2.3).

---

## 1. A1 — mis-assignment diagnostic

### 1.1 Method

`index-45s` and `B-control-45s` are declared to share identical chunk
boundaries. Verified directly: `173-excerpt-240s-index-45s.json`'s 7
`(startSec, endSec)` pairs are byte-identical to
`173-excerpt-240s-ladder-45s.json`'s (the file `b_control_45s` loads
boundaries from) — confirmed by direct comparison, all 7 pairs equal.

For each of the reference's 569 words, this document computes **which chunk
each attribution rule assigns it to**:

- **B-control-45s (oracle-time rule):** the reference word's own `start`
  time, walked against the shared boundary list left-to-right (same walk
  `fa_onnx.rs`'s `b_control` uses) — no ONNX needed, pure arithmetic over
  `173-excerpt-240s-reference-words.json` + the boundary file.
- **index-45s (qi rule):** `173-excerpt-240s-index-45s-words.json` is the
  ALIGNED OUTPUT of actually running the index-attributed chunk plan through
  the real ONNX aligner (produced by D13's `whisper_triage_index` test,
  already on disk). Because `align_chunked` processes chunks strictly in
  order and each chunk's own output word count equals its own input word
  count (0/7 CTC failures), output word `i`'s own chunk of origin is
  recoverable by checking which chunk window contains ITS OWN start time —
  validated as **non-decreasing across the full 569-word sequence** (chunks
  are emitted in order, sanity-checked directly) and, independently, cross-
  checked against a second method (counting raw whitespace tokens per chunk
  in `index-45s.json`'s own `text` fields and walking a greedy raw-token→
  reference-word match) — **the two independent methods agree on all
  569/569 words**, and the reproduced index-45s-vs-reference percentiles
  (`0.00/0.02/0.30/0.76` start, `0.00/0.02/0.14/0.66` end) match D13 §4's
  own recorded numbers exactly, which is itself confirmation the
  reconstruction is faithful to what actually shipped.

### 1.2 45s result

**5/569 words (0.9%) are assigned to a different chunk** between the two
rules — every one of them the single word immediately adjacent to an
internal 45s seam:

| word | ref start (s) | B-control chunk | index chunk | seam (s) | startErr | endErr |
|---|---|---|---|---|---|---|
| `and` | 42.54 | 1 | 0 | 42.48 | 0.60 | 0.20 |
| `sever` | 83.28 | 2 | 1 | 82.88 | **0.76** | **0.66** |
| `is` | 127.18 | 3 | 2 | 127.14 | 0.14 | 0.14 |
| `in` | 161.84 | 4 | 3 | 161.46 | 0.44 | 0.44 |
| `squad` | 194.32 | 5 | 4 | 194.22 | 0.52 | 0.48 |

**The mis-assigned set carries the START/END max exactly** (`sever`,
0.76/0.66 — identical to D13 §4's own reported max for this row) and the
overwhelming majority of the error mass:

| Set | n | mean startErr | p50 | p90 | p99 | max |
|---|---|---|---|---|---|---|
| Mis-assigned | 5 | 0.492 | 0.520 | 0.760 | 0.760 | 0.760 |
| Correctly-assigned | 564 | 0.005 | 0.000 | 0.020 | 0.020 | 0.420 |

Mean error in the mis-assigned set is **~100× the correctly-assigned set's**.
The words at/above the p99 START threshold (0.30s) are
`[100, 188, 189, 372, 373, 453, 531]` — the 5 mis-assigned indices plus two
immediate NEIGHBORS (188, 531) that are themselves correctly assigned but
sit adjacent to a mis-assigned word, consistent with a small "blast radius":
a chunk boundary that lands mid-word doesn't just mis-time that one word, it
mildly perturbs the Viterbi context for its immediate neighbor too.

**Concrete seam quote.** At the 82.88s seam (chunk 1/chunk 2, `sever`'s
seam): `index-45s.json`'s chunk 1 text ends `"...Strangler plants drop
tendrils that sever"` and chunk 2 begins `"limbs before the soldier..."` —
the `qi` cut falls between `sever` and `limbs`. But `sever`'s own real
onset (per the whole-file reference) is **83.28s, 0.40s after the 82.88s
window boundary** — by real audio time it belongs to chunk 2, not chunk 1.
`ladder-45s.json` (the `segment.startTime` production rule) makes the SAME
placement error here for an unrelated reason (`sever`'s *segment* had an
old, stale committed `startTime` before 82.88s) — the two independently-
wrong rules coincidentally agree, so B-control's oracle-time rule is the
only one of the three that gets this word right.

**Directionality — not a consistent bias.** All 5 of the 45s mis-
assignments happen to have the index rule place the word in the EARLIER
chunk than oracle-time does. At 7s (§1.3, more seams, more signal) the same
check finds cases going the OTHER way too (e.g. `training` at t=9.34,
`index-7s` places it in the LATER chunk `(9.36,14.66)`, oracle-time places
it in the EARLIER chunk `(4.36,9.36)`) — so the 45s sample's uniform
direction is very likely a small-n (5) coincidence, not a real bias to
correct against. Any fix candidate needs to handle both directions.

### 1.3 7s result — boundary-sharing premise does NOT hold at 7s

**Correction to the task's own premise:** `index-7s` and `B-control-7s`'s
boundary source (`173-excerpt-240s-ladder-7s.json`) do **not** share
identical boundaries. `index-7s` has **29 chunks**, ladder-7s has **28**.
The first 21 chunks (0.00–135.86s) are byte-identical; at that point
`index-7s` SPLITS a window ladder-7s keeps whole:

| | index-7s | ladder-7s (B-control-7s boundary source) |
|---|---|---|
| chunk 21 | 135.86–**159.18** | 135.86–**161.46** |
| chunk 22 | 159.18–161.46 | (continues at 161.46) |

From 161.46s onward every boundary value reappears in both lists, just
shifted one index over in `index-7s`. This is itself informative: it means
the empty-window-folding rule differs by attribution mode at this one seam —
a run that received no TEXT under one rule's cut gets folded into a
neighbor (invisible as its own chunk), while the same underlying run
receives non-empty text under the other rule and survives as its own chunk.
Boundary PLACEMENT, not just text attribution, can differ between the two
modes — a second-order effect the task's framing didn't anticipate.

Given this, chunk-INDEX comparison (as used for 45s) is not meaningful at
7s. Instead, each reference word's assigned window under each rule is
compared as a **time range**: if `index-7s`'s window is a subset of
`B-control-7s`'s window (i.e. `index-7s` merely subdivides the same real
chunk more finely), that's not a disagreement. Only a genuine cross-chunk
mismatch counts.

**28/569 words (4.9%) are genuine mis-assignments** at 7s (vs. 5/569 at
45s) — proportionally similar to the seam count (27 internal seams at 7s vs.
6 at 45s: ~1.0 mis-assigned word per seam either way), consistent with §1.2's
finding that this is a **per-seam, boundary-word phenomenon**, not something
that scales with window size beyond the seam count itself. 61 further
words fall in the boundary-refinement-only category (the 135.86–161.46s
region `index-7s` subdivides).

**Per-word error join for index-7s: DATA GAP, not computed.** Unlike
index-45s, **no aligned-output file for index-7s exists on disk anywhere**
(`fa_onnx.rs`'s `run_index_rung("7s")`/`index_7s` test computes and prints
percentiles but never persists the underlying 569 per-word timestamps to a
file, unlike `whisper_triage_index`, which only ever ran the 45s rung by
default). The combined table's own index-7s row (`START p50/p90/p99/max =
0.00/0.02/0.72/1.72`) is real (from an actual prior `cargo test` run) but is
an AGGREGATE with no surviving per-word breakdown — there is no way to
determine, from data alone, whether index-7s's own mis-assigned words carry
its p99/max without re-running the ONNX aligner, which this slice's own
constraints forbid. **This gap is reported rather than papered over with an
extrapolation from the 45s finding.**

### 1.4 Verdict

**Mis-assignment explains the index-vs-oracle gap, cleanly, at 45s** where
it can be directly checked: 0.9% of words carry the entire max and
~100× the mean error of the correctly-assigned 99.1%. It is very likely the
same mechanism at 7s (same per-seam rate, same "boundary word" shape), but
that cannot be stated as *measured* without the missing per-word data
(§1.3).

**Smallest rule that would fix it — not implemented, per this slice's
constraint:** the boundary word immediately adjacent to a `qi`-derived chunk
cut is the one at risk, in EITHER direction (§1.2's directionality note) —
a rule would need to compare, for that one specific word, which side of the
anchor's own audio-time boundary its real onset falls on. Production has no
oracle per-word onset to consult (that's exactly the value forced alignment
exists to produce), so a workable version of this rule cannot use the
reference/oracle timing this diagnostic used — it would need some other,
already-available signal (e.g. the anchor's own bounding Whisper
`tokenIdx`/timestamp, which `FaAnchor` already carries) to decide, at cut
time, which side a boundary word belongs on. Designing and validating that
signal is out of scope here.

---

## 2. A2 — replacing the budget

### 2.1 Existing tolerance search

**(a) `syncConstants.ts`:** grepped for every tolerance-shaped constant.
None is a consumer-facing word-level timing gate:

- `TEMPORAL_TOLERANCE_RATIO`/`_MIN_SEC`/`_MAX_SEC` (`syncConstants.ts:152-154`)
  — an internal Hirschberg-alignment SEARCH-WINDOW bound (how far a
  segment's own text matcher looks for candidate tokens), not an accuracy
  gate on the output.
- `MALFORMED_TOKEN_DURATION_TOLERANCE_SEC` (`syncConstants.ts:170`) — a
  container/codec padding slack for discarding a malformed trailing token,
  unrelated to display timing.
- `TOKEN_GAP_EPSILON_SEC` (`syncConstants.ts:201`) — a silence/token-gap
  quantization epsilon for boundary-vs-breath classification, internal to
  sync computation.

**Subtitle/highlight render path:** grepped the whole frontend for
word-level highlight/karaoke rendering. **It does not exist.** `WordSpan`/
`FaWordSpan` data only ever reaches `faWordSpansToTranscriptTokens`
(`src/services/faBoundaryTypes.ts:117`), which feeds the existing
segment-level `TranscriptToken` pipeline — consumed today only by the
DEV-only `__faDevAlign` harness (`src/App.tsx`, gated behind
`import.meta.env.DEV`, no UI, no invoke() from any production code path).
`VideoSegment`/`TextOverlay` (`src/types.ts`) render whole-segment or
whole-overlay text; there is no per-word timed highlight consumer anywhere
in this codebase today.

**Conclusion: no existing tolerance applies. There is no gate to inherit
because there is no consumer feature yet to gate.**

### 2.2 Proposed number — PRODUCT DECISION, NOT MEASURED, PENDING OWNER SIGN-OFF

Since (a) found nothing, this is a proposal, not a derivation:

> **Proposed gate: per-word timing error ≤ 0.3s (300ms), both start and
> end, for word-level highlight timing.**

Rationale (engineering judgment, not measurement): captioning/subtitle-
highlight tooling generally treats ~150–300ms drift as the point where a
highlight visibly desyncs from speech for a casual viewer (looser than
broadcast lip-sync tolerances like ITU-R BT.1359, which govern a much more
scrutinized case — a moving mouth, not a text highlight). 0.3s is offered as
a reasonable middle point, not a researched constant. **This number requires
explicit owner sign-off before it is wired to anything** — it is asserted
here only so §2.3's exceedance counts have a concrete threshold to report
against.

### 2.3 Every combined-table row against the proposed 0.3s gate

Only **index-45s** has a surviving full per-word array (§1.1) — its
exceedance counts below are **exact**. Every other row is known only by its
recorded percentiles (`p50/p90/p99/max`), so its exceedance count is
**bounded, not exact** — inferred from where 0.3s falls relative to the
recorded percentile breakpoints (e.g. if `p90 < 0.3 ≤ p99`, between 1% and
10% of 569 words exceed — 6 to 57 words). This bound is reported explicitly
rather than a fabricated point estimate, since (per the task's own framing)
a percentile alone cannot distinguish "one word at 0.76s" from "fifty words
at 0.76s."

| Row | START max (s) | START exceed 0.3s | END max (s) | END exceed 0.3s |
|---|---|---|---|---|
| ladder-7s (D12) | 7.54 | **>285 (majority)** | 7.48 | >285 (majority) |
| ladder-45s (D12) | 7.54 | 57–285 | 7.48 | 57–285 |
| B (D12, full oracle) | 0.08 | **0 (exact)** | 0.33 | 1–6 |
| B-control-7s (D13) | 0.54 | 6–57 | 0.46 | 1–6 |
| B-control-45s (D14) | 0.30 | **0 (exact — at, not above, gate)** | 0.24 | **0 (exact)** |
| index-7s (D13) | 1.72 | 6–57 | 1.72 | 6–57 |
| **index-45s (D13)** | 0.76 | **6/569 = 1.1% (exact)** | 0.66 | **5/569 = 0.9% (exact)** |

At the proposed gate, **only B and B-control-45s clear it outright**;
index-45s exceeds on ~1% of words (the same 5–6 words §1.2 already
identified as the mis-assigned set); everything at 7s or under the old
`segment.startTime` rule exceeds on a large fraction to a outright majority
of words.

### 2.4 B-control as headroom, not a gate

Restated per this slice's own correction: **B-control is an oracle
construction (it uses whole-file reference TEXT membership production
cannot compute without already having solved alignment) — a floor showing
what's achievable if text attribution were perfect, never a pass/fail gate
for any production row.** B-control-45s's own max (0.30s/0.24s) is
informative headroom: it says the CURRENT 45s boundary structure, if text
attribution were somehow perfect, would already be at (not comfortably
under) whatever gate ends up chosen — i.e. there is very little room left to
gain from a text-attribution fix alone at this window size before boundary
placement itself (§1's mis-assignment mechanism, ultimately downstream of
`faAnchors.ts`, out of scope this slice) becomes the binding constraint.

### 2.5 Has the whole-file-reference-agreement proxy saturated?

**Yes, for any further work aimed at improving reference-agreement
specifically.** D13's own Whisper-triage finding (§4 of that document,
re-verified directly by D14 §A1) already showed index-45s is **statistically
indistinguishable from the whole-file reference itself** against real,
independent ground truth (Whisper): p90 0.70 vs 0.72s, p99 identical at
1.02s, max identical at 1.20s (start side). The remaining reference-relative
gap this document quantifies (0.76s max, 5–6 affected words) is smaller
than or comparable to the noise floor of the measurement methodology
itself — Whisper's own token-timestamp jitter, which is the ~0.3–1.2s band
the whole-file reference ITSELF sits inside when checked against Whisper.
Squeezing index-45s's reference-agreement further toward B-control's 0.30s
floor would not be observable by any real consumer, because the metric
being optimized (agreement with the SCRIPT-based whole-file reference) has
already saturated at a level real-world ground truth cannot even resolve
past. Further agreement work should target something with finer
discriminating power than Whisper timestamps (e.g. forced-alignment-vs-
forced-alignment against audio with independently hand-labeled word
boundaries, or direct perceptual testing once a real highlight consumer
exists) — not tighter fitting against the whole-file reference.

---

## 3. A3 — sample adequacy

Every D13/D14 conclusion, and this document's own §1/§2, rests on **one
240-second excerpt from one corpus project (`173`), one language (English),
one narrator, one register (narrative documentary-style prose)** — D14's own
correlation ran at n=6 internal boundaries, and this document's own §1.2
mis-assignment set is n=5 words, both small enough that a single outlier
(the `sever` word, which alone sets the combined table's max at both 45s and
in D14's own per-chunk table) determines the reported max outright; a
different corpus, narrator pace, or silence structure could plausibly move
that single number substantially in either direction without changing
anything about the underlying mechanism. The Whisper-ground-truth leg
matches only 485/569 (85%) words, so even the "external" validation carries
an uncharacterized ~15% gap. No non-English corpus, no dense/fast dialogue,
no multi-speaker audio, and no full production-length (vs. 240s) run has
been tested against ANY attribution rule. **A shippable verdict needs, at
minimum: several (3–5+) independent excerpts across different corpus
projects and narrators, at full production length (not a 240s slice), and
covering the same five supported languages this codebase already gates
sync accuracy on (`constants.ts`'s `SUPPORTED_LANGUAGES`) — enough total
internal seams (order 100+, aggregated across corpora) that p99/max stop
being set by a single word.** This is scoped, not run, per this slice's own
constraint.
