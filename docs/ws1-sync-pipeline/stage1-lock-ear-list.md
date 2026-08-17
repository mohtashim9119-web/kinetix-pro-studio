# Stage 1 Lock — Ear Pass Dossier (WS1 Session G, 2026-08-17)

> **What this is:** the fresh 12/12 ear list required by the Stage 1 lock gate, drawn at
> HEAD `f7fb9d0`+ (post R.5 / R.10 / R.11), assembled against the RU4 bar — stratified,
> with an unmoved control arm, blinding preserved, ±2 s windows, ~25 s/boundary.
> **Everything needed to run it is in this file.** No setup, no other document.
>
> **Scope (carried verbatim from R-AB..R-AF, WS1 Session C):** Stage 1's "zero defects" is
> **en/es only**. R-T defers fr/de/pt and that corpus does not exist. Carried risk, recorded
> against whichever later stage takes non-English: **text-normalization Rules 1–5 shipped for
> French, Portuguese and German and have never once been exercised against real audio.**

---

## 0. How to run this (read fully before starting)

**Time:** 12 boundaries × ~25 s ≈ **5 minutes of listening**, ~12 minutes with scoring and
re-listens.

**Prerequisite:** the replay WAVs at `.work-phase4/replay/{v6,173,spanish}/audio_16k.wav`.
These are gitignored and present on the machine that ran this session's measurements. If
they are absent, this pass cannot run — nothing else in this file substitutes for them.

**The blinding rule, and why it is stricter this time.** R-AB (WS1 Session C) recorded an
ordering defect — Tier 1 was scored first and spent Tier 2's blinding — and made
**blinded-tier-first binding on the next draw**. This is that next draw, so there is only
ONE tier and it is blinded end to end:

- §1's table shows **one** boundary value per row. It does not say whether that value is
  new or unchanged.
- Every window is **exactly 4.00 s**, centred on the proposed value. This is not cosmetic:
  the largest movement in the set is **1.95 s**, strictly less than 2 s, so a ±2 s window
  *always contains the old value too*. You are therefore hearing both candidates on every
  moved row without being told which row is moved — which is precisely what a varying
  window length would have leaked.
- Row order is `sha256(tag)` ascending — deterministic, reproducible, and independent of
  which arm a row belongs to.
- **Do not open §3 until all 12 rows are scored.** §3 is the sealed key.

**The question for every row, identically:** *play the window, and answer — does the scene
change belong at the stated boundary?* Score **YES** or **NO**. If you cannot tell, score
**NO** — an unscoreable row is not a pass.

**The bar:** 12/12. Any NO reopens Stage 1 rather than being averaged away.

---

## 1. The blinded table — score this

| # | project | segment | proposed boundary | listen | YES / NO |
|---|---|---|---|---|---|
| 1 | 173 | `fallen_regiment_site` | **507.01** | `ffplay -ss 505.01 -t 4.00 -autoexit .work-phase4/replay/173/audio_16k.wav` | |
| 2 | v6 | `192_scout_listening` | **571.07** | `ffplay -ss 569.07 -t 4.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 3 | v6 | `158_scout_false_alert` | **466.09** | `ffplay -ss 464.09 -t 4.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 4 | 173 | `earthwork_corridor` | **256.33** | `ffplay -ss 254.33 -t 4.00 -autoexit .work-phase4/replay/173/audio_16k.wav` | |
| 5 | v6 | `340_fifty_eight` | **1047.57** | `ffplay -ss 1045.57 -t 4.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 6 | v6 | `176_twenty_six_scout` | **524.39** | `ffplay -ss 522.39 -t 4.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 7 | v6 | `266_forty_one_burden` | **790.33** | `ffplay -ss 788.33 -t 4.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 8 | spanish | `016_prepares_weapons` | **44.90** | `ffplay -ss 42.90 -t 4.00 -autoexit .work-phase4/replay/spanish/audio_16k.wav` | |
| 9 | v6 | `318_scout_on_ridge` | **969.30** | `ffplay -ss 967.30 -t 4.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 10 | v6 | `042_eleven_years` | **127.17** | `ffplay -ss 125.17 -t 4.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 11 | v6 | `125_night_circle` | **372.35** | `ffplay -ss 370.35 -t 4.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 12 | v6 | `087_throwing_spear_poise` | **259.88** | `ffplay -ss 257.88 -t 4.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |

**Score: ____ / 12**

---

## 2. How this list was drawn (method, so the result is auditable)

**The mover population is measured, not selected by hand.** Every committed `startTime`
that differs between `40a12cf` (pre-R.5, the last state before this build programme) and
HEAD, per corpus, read from `scripts/fixtures/phase4-fa-second-baseline-{corpus}-segments.csv`
at each commit:

| corpus | movers | dropped |
|---|---|---|
| v6 | 11 | 0 |
| 173 | 2 | 2 (`perilous_realms`, `blue_monkey` — R.10) |
| spanish | 0 | 0 |

**MOVED arm (7 rows)** = every one of those 13 movers that is **not already ear-verified**.
The six excluded as already-scored are `152_frozen_brush_mice` (item 7), `226_four_scouts`
and `abysmal_opinion` (OV3 triage), `308_scouts_leading` and `043_night_migration`
(items 4/5), and `hostile_landscape` (item 10). Re-scoring those would inflate a 12/12 with
rows already known to pass.

**UNMOVED control arm (5 rows)** — drawn by an evenly-spaced deterministic pick over each
corpus's clean pool, where "clean" excludes, in this order:

1. any boundary whose `startTime` **or** `duration` changed (a duration-only change still
   means the surrounding audio was re-cut);
2. any boundary within **±2 index positions** of such a site — this is what removed
   `151_scout_listening_void`, whose start never moved but which sits immediately before
   item 7 and would have been a contaminated "control";
3. any tag used in WS1 Session C's Tier 1 draw — this draw is independent of that one;
4. any boundary within **5 s of a previously ear-scored value** in any earlier sitting —
   which is what removed `156_scout_deep_realization` (459.87), too close to the already-
   scored 457.83 seam;
5. any boundary before 3.00 s (no room for the 2 s lead-in) or on a segment shorter than
   1.2 s (a micro-segment tests the window, not the boundary).

**Stratification.** By arm (7 MOVED / 5 UNMOVED), by corpus (v6 9 / 173 2 / spanish 1), and
by movement magnitude across the MOVED arm — deliberately spanning **+0.41 s to +1.95 s**,
so the pass is not only large-delta cases where the answer is easy. `087_throwing_spear_poise`
(Δ +0.41) is in the list specifically to test precision rather than direction.

The MOVED arm is all-v6 because that is where the unverified movers are: 173's two movers
are both already ear-verified, and spanish has none. The control arm carries the corpus
spread instead.

---

## 3. SEALED KEY — do not read until §1 is fully scored

<details>
<summary>Expand only after scoring all 12 rows.</summary>

| # | segment | arm | current | proposed | Δ | why this row is in the list |
|---|---|---|---|---|---|---|
| 1 | `fallen_regiment_site` | UNMOVED | 507.01 | 507.01 | +0.00 | control |
| 2 | `192_scout_listening` | **MOVED** | 570.18 | 571.07 | +0.89 | **R.11's one UNVERIFIED candidate.** Step 1 of this session scored it TRUE on structural evidence; this row is the ear confirmation that evidence is still owed. |
| 3 | `158_scout_false_alert` | UNMOVED | 466.09 | 466.09 | +0.00 | control |
| 4 | `earthwork_corridor` | UNMOVED | 256.33 | 256.33 | +0.00 | control |
| 5 | `340_fifty_eight` | **MOVED** | 1045.62 | 1047.57 | +1.95 | **R.5 REVERSED an earlier scored decision here.** R-AA proposed 1045.62 and that value was scored in Session C's Tier 1; R.5 returns it to 1047.57. The highest-value row after #2. |
| 6 | `176_twenty_six_scout` | **MOVED** | 526.09 | 524.39 | −1.70 | R.5 mover, never ear-scored |
| 7 | `266_forty_one_burden` | **MOVED** | 792.18 | 790.33 | −1.85 | R.5 mover, never ear-scored |
| 8 | `016_prepares_weapons` | UNMOVED | 44.90 | 44.90 | +0.00 | control — the only non-English corpus in scope (R-T defers fr/de/pt) |
| 9 | `318_scout_on_ridge` | UNMOVED | 969.30 | 969.30 | +0.00 | control |
| 10 | `042_eleven_years` | **MOVED** | 125.76 | 127.17 | +1.41 | R.5 mover, never ear-scored |
| 11 | `125_night_circle` | **MOVED** | 370.75 | 372.35 | +1.60 | R.5 mover, **and** R.11's third-conjunct false-positive guard. This one must read CORRECT — if it reads wrong, `R11_MAX_SPAN_WORD_CONF` was set against a bad reference. |
| 12 | `087_throwing_spear_poise` | **MOVED** | 259.47 | 259.88 | +0.41 | R.5 mover, smallest Δ in the set — tests precision, not direction |

**Reading the result.** A NO on rows 1/3/4/8/9 (controls) means something moved that
should not have, or a currently-committed boundary is wrong — either way Stage 1 reopens.
A NO on row 2 means `192_scout_listening` is a false positive and R.11 needs a fourth
conjunct (see §4 for exactly what evidence would have to be re-read). A NO on row 11 means
R.11's own threshold reference is wrong, which is more serious than a single boundary.

</details>

---

## 4. Appendix — the `192_scout_listening` evidence artifact (row 2)

This is the Step 1 artifact for the register's last unverified row, produced by the
production detector **`detectSeamFitDefects`** (`src/services/faSeamFitGate.ts`), imported
and not reimplemented, run over the PRE-correction committed arrays
(`git show 3faf0ea:scripts/fixtures/phase4-fa-second-baseline-*-segments.csv`) with the real
FA word capture from `.work-phase4/replay/*/fa_production_words.json` (engine: *real Rust
`fa_onnx::align_chunked` via `fa::fa_align`, production path, direct call*).

**Read this only after scoring row 2**, or it stops being a blind pass.

### 4.1 The four findings, side by side

`detectSeamFitDefects` returns exactly 4 findings over 649 committed boundaries — the three
ear-verified register members and this one candidate. Presented identically:

| | segment | committed (old) | corrected (new) | Δ | chunk fit dev. | span max FA conf. | margin below `R11_MAX_SPAN_WORD_CONF` (1.0835e-2) |
|---|---|---|---|---|---|---|---|
| A | `152_frozen_brush_mice` (item 7) | 449.20 | 451.03 | +1.83 | 1.429 | 1.4899e-3 | 7.3× |
| B | **`192_scout_listening`** | **570.18** | **571.07** | **+0.89** | **1.500** | **4.0732e-5** | **266×** |
| C | `226_four_scouts` (OV3) | 670.24 | 671.18 | +0.94 | 1.333 | 9.6935e-4 | 11.2× |
| D | `abysmal_opinion` (OV3) | 16.50 | 17.88 | +1.38 | 1.500 | 3.8954e-3 | 2.8× |

### 4.2 The discriminator: is the committed value an FA word-seam artefact?

Measured directly from the FA word capture — the nearest FA word ending before and starting
after each committed value:

| | prev word (ends) | next word (starts) | seam midpoint | gap | committed **is** the seam midpoint? | real silence containing committed? |
|---|---|---|---|---|---|---|
| A | "one" (449.18) | "when" (449.22) | 449.200 | 0.040 s | **YES** | **NO** |
| B | **"still" (570.14)** | **"you" (570.22)** | **570.180** | **0.080 s** | **YES** | **NO** |
| C | "now" (670.16) | "four" (670.32) | 670.240 | 0.160 s | **YES** | **NO** |
| D | "battlefields" (16.32) | "of" (16.58) | 16.450 | 0.260 s | no | YES — the *wrong* silence [16.36, 16.64] |

Row B matches the item-7 / `226_four_scouts` signature exactly: the committed boundary is the
midpoint of an FA word seam spanning **0.080 s of non-silence**, and its gap sits between the
two ear-verified word-seam cases (0.040 s and 0.160 s).

### 4.3 The ±2 s window around `192_scout_listening`

Competing silences in [568.18, 572.18], from `phase4-baseline-v6-silences.csv` (the production
silence input):

| interval | duration | midpoint | |
|---|---|---|---|
| [568.50, 569.80] | 1.30 | 569.15 | backs the chunk-100 **START** anchor |
| **[570.78, 571.36]** | **0.58** | **571.07** | ← the corrected value; backs the chunk-100 **END** anchor (an untouched R.1 three-source-agreement anchor) |
| [571.86, 572.62] | 0.76 | 572.24 | |

**The committed 570.18 lies in none of them.**

FA words across the same window, with confidence:

| word | span | confidence |
|---|---|---|
| "stop" | 568.26–568.58 | **9.9401e-1** |
| "you" | 568.60–568.66 | 1.5500e-7 |
| "both" | 568.70–569.28 | 2.2335e-7 |
| "go" | 569.34–569.78 | 6.6737e-8 |
| "still" | 569.82–570.14 | 1.0402e-6 |
| "you" | 570.22–570.66 | 4.0732e-5 |
| "listen" | 571.52–571.82 | **9.8873e-1** |

**The corroboration that does not depend on ears at all.** The segment's own text is
"You listen." The only two acoustically-confident words anywhere in the window are
"stop" (0.994) and **"listen" (0.989 at 571.52)**. The corrected boundary 571.07 sits in the
silence immediately preceding "listen". The committed 570.18 would start the segment whose
text is "You listen." **1.34 s before the word "listen" is acoustically present.**

### 4.4 The negative control — a known false positive, same evidence shape

`125_night_circle` is the measured Session F false positive that forced R.11's third
conjunct. Rendered in the identical shape so the true/false discrimination is visible rather
than asserted:

| | committed | fit-only proposal | Δ | committed on a real silence midpoint? | span max conf. | verdict |
|---|---|---|---|---|---|---|
| FP | 372.35 | 373.70 | +1.35 | **YES — [371.94, 372.76], mid 372.35 exactly** | **3.0145e-2** ("are") | **EXCLUDED** by conjunct 3 |

The false positive fails on both discriminators the four findings pass: its committed value
already sits on a genuine separate silence's midpoint, and its span carries real acoustic
support at 3.0145e-2 — **740× higher** than row B's 4.0732e-5.

### 4.5 Verdict entering the ear pass

`192_scout_listening` is a **true positive on every measurable structural axis**, with the
widest evidential margin of the four findings. It is **not** a false positive, so the
Zero-Defect Register's empty state survives Step 1 — and stop-and-rule exit **G2 does not
fire**.

**Stated limitation, not hedging:** this is a *structural* confirmation, not an auditory
one. It is why the row is still carried as a change detector rather than a positive
correctness assertion, and why it is row 2 of this pass. Scoring row 2 YES is what converts
it.

---

## 5. If any row scores NO

Per the plan's hard rule, a defect found in a locked stage reopens that stage. Concretely:

- **Row 2 NO** → R.11 over-fires. The fourth conjunct to investigate first is the one
  §4.2 makes available and R.11 does not currently use: require the committed value to be
  an FA word-seam midpoint over a sub-threshold gap **and** require the corrected value's
  backing silence to be the one already anchoring the chunk edge. Rows A/C would survive
  that conjunct (both are word-seam midpoints); row D would not, so it would need the
  existing wrong-silence branch kept alongside it. Do not add a conjunct that loses A, C
  or D.
- **Row 11 NO** → `R11_MAX_SPAN_WORD_CONF` was calibrated against a bad reference; the
  constant, not the rule, is the defect.
- **Any control NO** → the defect is not in R.5/R.10/R.11 at all; it is in a boundary none
  of them touched, and it predates this programme.
