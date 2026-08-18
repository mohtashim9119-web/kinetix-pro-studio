# WS1 Session K — Root-Cause Findings for the Two Audit Failures

> **Status: CLOSED. Both failures root-caused, the owner has ruled on both, R.13 has shipped,
> and the display-path defect is fixed and machine-checked.** Exit K1 fired and was reported
> before any fix was written; the owner's rulings are recorded in §6 below.
> Drawn at HEAD `55301be`, clean tree, `faAnchors.ts` sha256 `b61e94cb…`, suite
> 89 files / 2314 passed / 1 skipped at rest.
>
> Every number below names the production function that produced it. Scratch
> harnesses live in `.work-phase4/sessionK/` (gitignored).

---

## 1. Clip 1 — 173 @ 603.69. NOT A TIMING DEFECT.

### 1.1 What is actually spoken there

`scripts/fixtures/phase4-fa-second-baseline-173-segments.csv` (committed):

| committed idx | tag | text | start | end |
|---|---|---|---|---|
| 143 | `battle_network` | "Supply lines, reinforcements, intelligence, extraction, everything a military force depends on" | 597.83 | 603.69 |
| 144 | `protection_failure` | "for sustained operation, ceases to function the moment the Geller field goes." | **603.69** | 609.24 |

The split is **scripted mid-sentence**. The audit table's labels are correct
against the fixture — there is no mislabelling in `stage1-mover-audit.md` §1.

Forced-alignment words (`.work-phase4/replay/173/fa_production_words.json`, the
capture `fa_align_production` produced):

```
603.240  603.540  conf=0.998  depends
603.600  603.660  conf=1.000  on
603.720  603.800  conf=1.000  for
603.860  604.180  conf=0.963  sustained
```

**603.69 is the exact midpoint of the inter-word gap [603.660, 603.720]** —
`(603.660 + 603.720) / 2 = 603.690`, to the millisecond — between two words at
confidence **1.000** on both sides. It is precisely the seam between the two
segments' own words. It is the best value available.

Detected silences (`scripts/fixtures/phase4-baseline-173-silences.csv`) in the
neighbourhood: `597.620–598.040`, `604.820–605.300`, `609.040–609.440`. **There
is no detected silence anywhere in [598.04, 604.82]** — `battle_network` and
`protection_failure` are one continuous 6.8 s utterance with a 60 ms inter-word
gap at their seam.

### 1.2 Therefore the row was unscoreable by ear as posed

The audit's question is *"does the scene change belong at the stated boundary?"*
There is no scene change in the audio at 603.69 and there cannot be one — the
script splits a single sentence across two scenes. A listener will always answer
NO, at 603.69 and at every other value in that 6.8 s span. **The NO is a correct
ear judgement and carries no information about the committed value.**

### 1.3 The contradiction, resolved by git

`git show <ref>:scripts/fixtures/phase4-fa-second-baseline-173-segments.csv`:

| commit | rule landing | `order` | `startTime` |
|---|---|---|---|
| `580ba0f` | pristine FA second baseline | 146 | **603.69** |
| `92746cf` | R-U | 146 | 612.51 |
| `52140e5` | R-AA (reverts R-U) | 146 | **603.69** |
| `3faf0ea` | R.10 (two drops) | **144** | **603.69** |
| `f7fb9d0` → `55301be` | R.11, R.12, Sessions G–J | 144 | **603.69** |

**The committed value never moved.** What moved is the `order` field: 146 → 144
at R.10, the two-drop reindex.

The brief's dichotomy was "the committed value moved, or the associated text
changed". **Neither is true.** The third possibility is what happened:

- The **earlier** pass (OV3 triage, Session D, `docs/work-in-progress.md` §11(i))
  presented row 1 as **window + boundary only — no text at all**: `173 @ 599.69 –
  607.69`, boundary `603.69`. Scored **Correct**.
- The **new** pass (`stage1-mover-audit.md` §1) presents the same value with
  **both sides' text quoted**. Scored **NO**.

Same audio, same value, opposite verdict, because the *question the presentation
posed* changed. Without text, the nearest audible pause is `604.820–605.300`
(midpoint 605.06), 1.37 s away, and a listener with an 8.0 s window will accept
603.69 as "the pause". With text, the listener can see the boundary claims to
split "…depends on" from "for sustained operation…" and correctly rejects it as
a scene change. **Neither verdict was wrong; the earlier one answered a weaker
question.**

**Consequence for the audit:** clip 1 is not a defect and must not enter the
register. It is an **unscoreable-by-construction** row — the first one the
programme has produced — and the audit's draw method has no exclusion for it.

---

## 2. Clip 12 — v6 `225_night_scouts` @ 667.47. A REAL DEFECT. K2 DOES NOT FIRE.

### 2.1 All ten v6 recitations, both edges — the measurement that had never been taken

Produced by `computeUnscriptedRuns` (`faChunkPlan.ts`) and
`alignScenestoTranscript` (`whisperService.ts`), both production, against the
committed FA second-baseline at HEAD.

| run | recitation | owning segment | opening edge | closing edge | owner's own words (Whisper) | closing edge inside owner's own utterance? |
|---|---|---|---|---|---|---|
| 0 | "Level one, the child who does not yet know what dark means" | `001_child_seven` | 0.000 | 5.640 | 3.570–5.050 | no |
| 1 | "Level two, the boy who carries fire" | `042_eleven_years` | 125.540 | 130.960 | 129.150–130.140 | no |
| 2 | "Level three, the scout" | `085_the_spear_bearer` | 250.690 | 256.740 | 253.320–256.200 | no |
| 3 | "Level four, the night guard" | `125_night_circle` | 370.750 | 378.900 | 373.490–377.990 | no |
| 4 | "Level 5, the hunter who fights at night" | `176_twenty_six_scout` | 521.710 | 528.090 | 525.820–527.110 | no |
| **5** | **"Level 6, the one they follow"** | **`224_thirty_three`** | **663.785** | **667.470** | **666.610–667.730** | **YES** |
| 6 | "Level 7, the one the band depends on" | `266_forty_one_burden` | 788.650 | 794.190 | 791.940–793.030 | no |
| 7 | "Level 8, the one who teaches what cannot be taught easily" | `307_forty_nine_years` | 924.920 | 931.400 | 929.330–930.310 | no |
| 8 | "Level 9, the one whose name the stories use" | `340_fifty_eight` | 1044.670 | 1051.650 | 1050.080–1051.020 | no |
| 9 | "Level 10, the one the fire remembers" | `383_sixty_four` | 1188.950 | 1193.770 | 1192.330–1193.220 | no |

**All ten opening edges are outside their run** — R.12's shipped half holds
everywhere, including the four provisional closures the owner has now
ear-verified (rows 13, 14, 23, 24 of the audit).

**Exactly one of ten closing edges is wrong.** Stop-and-rule exit **K2 does not
fire**: R.12 is not broadly half-built.

### 2.2 What is wrong at run 5, and what the correct value is

Detected silences (`phase4-baseline-v6-silences.csv`) around run 5:

```
663.660 – 665.000   (mid 664.330)
665.760 – 666.400   (mid 666.080)
667.300 – 667.640   (mid 667.470)   <-- the committed boundary
668.700 – 669.400   (mid 669.050)   <-- the correct boundary
```

Owner's ear on clip 12: *"At 667.47s started 'You are thirty three' till 668.85s,
then at 669.37s started 'You lead the night scouts…'"* — and on clip 24:
*"'You carry it' ended on 663.79s, then unscripted text 'Level Six, the one they
follow' started at 664.99s till 667.31s."*

The ear and the silence detector agree exactly: the pause before "You are
thirty-three" is `667.300–667.640`, and the pause after it is `668.700–669.400`.
**The committed boundary sits on the pause *before* the segment's own line
instead of the pause *after* it**, so `224_thirty_three` is stripped of the one
line it exists for and `225_night_scouts` opens holding it. The correct value is
**669.05**, the midpoint of the later silence.

### 2.3 THE ROOT CAUSE IS NOT "R.12'S MISSING HALF" — and this is the material finding

The exact mirror of R.12 is buildable and threshold-free: place the closing edge
in `[owner's own last token end, next segment's own first token onset]`, clamped
to an intersecting silence, mirroring R.12's clamped-midpoint construction.

**Measured, that interval is `[667.730, 668.010]`, no detected silence
intersects it, and the fallback lands at 667.73 — a move of +0.26 s that is
still audibly wrong.** The mirror rule does not reach 669.05.

The reason is that **both token streams are unreliable in the region immediately
following an unscripted run**, while the silence stream is accurate:

- Whisper (`phase4-baseline-v6-words.csv`) puts "you are 33" at 666.61–667.73;
  the ear puts it at 667.47–668.85. ~0.9 s early. Token 1832 "the" is given the
  span `[668.650, 669.400]` — it **swallows the entire correct silence**, so no
  token-index construction can locate that seam.
- Forced alignment (`fa_production_words.json`) collapses in the same region:
  `you` 9.95e-06, `are` 3.58e-04, `thirty-three` 2.46e-05, `lead` 1.96e-04,
  `night` 9.96e-07, `scouts` 5.99e-05, `now` 7.08e-04 — against a corpus median
  of **0.9985**. FA has no acoustic support there because R.5 excised the run
  from the chunk window using Whisper's own smeared span (`[663.910, 666.480]`
  computed vs `[664.99, 667.31]` by ear — off by ~+1.0 s), so the excision
  removed the wrong 2.57 s and left the recitation's tail inside the window.

The confidences are continuous, not zero (`0` occurs 0 times in 3874 words;
`<1e-6` occurs 337 times), so **no threshold-free `== 0` test is available** the
way R.5's `qiHole == 0` was.

**This is why the opening edge works and the closing edge does not.** R.12's
opening edge is anchored to `prevToken.endSec` — a token *before* the run, in
the reliable region. The closing edge lies entirely inside the unreliable
region. It is not an oversight in R.12's statement; it is a place where the
inputs R.12 is built on stop being trustworthy.

---

## 3. A THIRD, INDEPENDENT DEFECT — the index convention in the SHIPPED display path

Step 1 asked for the index convention traced end to end and every place the two
conventions meet. Session J fixed the off-by-two in
`stage1-live-run-prep.md` §5.3. **The same off-by-N is live in `src/`, untouched.**

### 3.1 Where the conventions meet

| site | array the index means | evidence |
|---|---|---|
| `App.tsx:3017` `filterToCoveredSegments(aligned.segments, …)` skip records | **PRE-skip (parse)** | `segmentIndex: i` over the pre-filter array; carries its own `segmentText`, so it is self-consistent |
| `App.tsx:3040` rescue records | **PRE-skip (parse)** | stated in the code comment |
| `App.tsx:2995` R.10 `detectUnspokenScriptSegmentsFromWhisper(aligned.segments, …)` | **PRE-skip (parse)** | |
| `App.tsx:3155` R.11 `detectSeamFitDefects(anchorTimed, …)` | **PRE-skip (parse)** | `faSeamFitGate.ts:271` `segmentIndex: segIdx` over `segments` = `anchorTimed` |
| `App.tsx:3182` R.12 `detectRunPlacementDefects(anchorTimed, finalTimedSegments, …)` | **POST-skip (committed)** | `faRunPlacementGate.ts:222` `segmentIndex: i` over `committedSegments` |
| `syncLog.ts:127/517/547/588` | rendered uniformly as `segmentIndex + 1` | |
| `SyncLogPanel.tsx:145,352` | rendered uniformly as `Scene {segmentIndex + 1}` | |

`syncLog.ts:116` documents the field as *"0-based into whatever segments array"* —
the meaning is explicitly undefined, and two shipped writers use different ones.

**Correction application is safe.** `applySeamFitCorrections` and
`applyRunPlacementCorrections` both match by `segmentId`, not by index
(`faSeamFitGate.ts:318`, `faRunPlacementGate.ts:269`), so **no committed timing
is affected**. This is a display defect only.

### 3.2 Measured, through the production detectors and the shipped log builders

Re-running `detectSeamFitDefects` / `detectRunPlacementDefects` against the
pre-correction fixtures (`3faf0ea`, `f7fb9d0`) and feeding the findings to the
shipped `buildSeamFitLogEntries` / `buildRunPlacementLogEntries`:

| corpus | rule | tag | `finding.segmentIndex` | true committed idx | divergence | shipped message |
|---|---|---|---|---|---|---|
| **173** | **R.11** | `abysmal_opinion` | **5** | **4** | **+1** | *"R.11 moved scene **6** (abysmal_opinion) from 16.5s to 17.88s (+1.38s)."* |
| v6 | R.11 | 3 rows | 151/191/225 | 151/191/225 | 0 | — |
| v6 | R.12 | 9 rows | 41…382 | 41…382 | 0 | — |
| 173 | R.10 | `perilous_realms`, `blue_monkey` | 0, 12 | dropped | n/a | — |

The user sees `abysmal_opinion` as **scene 5** on the timeline; the log names it
**scene 6**. Divergence is `+1` before `blue_monkey` (parse 12) and `+2` after
it, so an R.11 firing anywhere past index 12 on 173 would print **scene 147** for
timeline **scene 145**.

**The defect is invisible on v6 and spanish** (zero drops there) and appears only
on a corpus where R.10 fires — which is why no earlier session caught it.

### 3.3 A second, related site — flagged as INFERRED, not measured

`buildUnscriptedRunLogEntries` (`syncLog.ts:466`) is the only rule-firing entry
that attaches `segmentText`. It resolves the owning scene by a **containment scan
over `anchorTimed`** — the pre-skip, pre-snap, pre-R.11/R.12 array — so both the
scene number and the quoted text come from an array whose `startTime`/`duration`
are not the committed values. Its doc comment justifies the scan by Model P
gaplessness, which holds, but gaplessness of the *wrong* array does not make the
lookup correct. R.5 fires on v6 only, where the index convention happens to
coincide (zero drops), so the *number* is right today; the *text* is resolved
against pre-commit timings and is not verified. **Not measured this session.**

---

## 4. Stop-and-rule assessment

| exit | fires? | basis |
|---|---|---|
| **K1** — the 173 defect is in the display path rather than timing; committed values were never wrong | **FIRES, amended** | 603.69 is the exact FA seam midpoint between two conf-1.000 words and never moved (§1.1, §1.3). But the earlier verdict was not invalidated by a labelling *change* — the earlier presentation carried **no labels at all**. Separately, a real display-path index defect **does** exist in shipped code (§3), and it is not the cause of clip 1's verdict. |
| **K2** — more than the two known closing edges wrong; R.12 broadly half-built | **does not fire** | 1 of 10 closing edges violates; 10 of 10 opening edges are clean (§2.1). |
| **K3** — a previously passing row moves | n/a | no code changed. |
| **K4** — a fix requires touching a forbidden file | **at risk** | the ear-correct value 669.05 is a `snapCoveredBoundaries` silence midpoint. A post-correction gate (R.12's own precedent) can reach it without touching `snapBoundaries.ts`, but the *derivation* cannot come from either token stream (§2.3). |

---

## 5. Owner rulings, and what shipped

### 5.1 The two rulings

| question | ruling |
|---|---|
| **Clip 1 disposition** | **Verified CORRECT in the app.** Mid-sentence and no-silence splits **STAY** in future ear-test draws so FA's handling of boundary edge cases keeps being verified. **No exclusion rule** was added — the recommendation to add one was declined. |
| **Clip 12 fix** | Build the **silence-anchored closing edge**. |

### 5.2 What the clip-12 derivation turned out to be

The ruling's sketch bounded the rule by the carrier's own script **sentence count**. The
measurement showed that bound is not needed and would have been wrong: a silence-ORDINAL rule
("skip the first silence after the run") fires on **6 of 10** recitations, five of them
boundaries the owner has already verified. The correct discriminator is the carrier's own
**utterance END** — the far side of its own line, past the smeared region — and with that
anchor the rule fires on exactly one boundary and is a bit-exact no-op on the other nine. R.13
therefore ships with **no counting construct and no threshold**.

### 5.3 Shipped

* **R.13**, in `faRunPlacementGate.ts` alongside R.12 (ruling R-AO). Blast radius **predicted 1
  of 649 before implementation, actual 1 of 649**: v6 `225_night_scouts` 667.47 → 669.05.
* **The index-convention fix**: one resolver (`syncLog.ts`'s `committedIndexOf`), every
  rule-correction entry carrying a committed index or none, R.5's scan moved onto the committed
  array, and `types.ts`'s false uniformity claim replaced.
* **Ruling R-AO** and its two machine checks, `ruleBothSides.test.ts` and
  `syncLog.indexConvention.test.ts`.
* **The deliverable**: `stage1-session-k-ear-list.md`, 28 annotated blinded rows.

### 5.4 Register

Reopened at 1 and closed in the same commit: `r13-225-night-scouts`, `earCorrect: 669.05`,
`verification: 'structural'` — the owner scored the OLD value wrong, which is not the same as
scoring the NEW one right. Clip 1 is not a register entry (not a defect). The display defect is
not a register entry (no committed value moved). Both omissions are deliberate.

---

## 6. Reproducing the measurements

The scratch harnesses were removed after use (they would otherwise inflate the standing test
file count). Their outputs are retained at `.work-phase4/sessionK/` (gitignored):
`measure-out.md` (both edges of all ten recitations), `predict-out.md` (the blast-radius
prediction), `index-audit-out.md` (the divergence, through the shipped log builders),
`earlist.json` (the ear list's source data).

Every number in this document is now additionally locked by a standing test:
`src/services/faRunPlacementGate.test.ts` (R.13's corpus rows, blast radius, mutual exclusion,
both-edges assertion), `scripts/phase4-fa-replay.test.ts` (both edges of run 5, the clip-1
control, M8) and `src/services/syncLog.indexConvention.test.ts` (the convention itself).
