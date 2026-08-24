# Stage 1 Lock — Exhaustive Mover Audit (WS1 Session I, 2026-08-18)

> **What this is:** the audit that owner ruling **R-AM** requires and that supersedes the
> blind-12 sampling method. It covers the **entire mover population** — every boundary whose
> committed value any rule has ever changed — plus a blinded unmoved-control arm.
> **Everything needed to run it is in this file.** No setup, no other document.
>
> **Drawn at HEAD `726112b`.** Superseded: the Session G ear list's (`docs/history-2.md`) 12-row sample (scored
> in Session H; all twelve re-verified against this HEAD in §5 below, no drift).
>
> **Scope (carried verbatim from R-AB..R-AF):** Stage 1's "zero defects" is **en/es only**.
> R-T defers fr/de/pt and that corpus does not exist.

---

## 0. How to run this (read fully before starting)

**Time:** 24 boundaries × 5.80 s window ≈ **2.3 minutes of raw audio**; budget
**~20 minutes** with scoring and one re-listen per row.

**Prerequisite:** the replay WAVs at `.work-phase4/replay/{v6,173,spanish}/audio_16k.wav`.
Verified present on this machine at draw time (v6 45.5 MB, 173 22.7 MB, spanish 2.9 MB).
They are gitignored; if absent, this pass cannot run and nothing here substitutes for them.

**The question for every row, identically:** *play the window, and answer — does the scene
change belong at the stated boundary?* Score **YES** or **NO**. If you cannot tell, score
**NO** — an unscoreable row is not a pass.

**The bar:** 24/24. Any NO reopens Stage 1 rather than being averaged away.

**Blinding.** §1 shows one value per row and never says whether it is new or unchanged.
Every window is **exactly 5.80 s**, centred on the stated value, on every row without
exception. Row order is `sha256(tag)` ascending — deterministic, reproducible, and
independent of arm, corpus and magnitude. **Do not open §4 until all 24 rows are scored.**

**One exception you are entitled to know about before scoring, because it cannot leak:**
five rows carry a historical competing value further than 2.90 s from the stated value, so
the 5.80 s window does not contain it. This is stop-and-rule exit **I4** and it is reported
in §3.3 — the resolution is recorded there and the rows are still scoreable as stated,
because in every one of those five cases the competing value is a *reverted transient* that
no rule proposes at HEAD.

---
## 1. The blinded table — score this

| # | project | segment | boundary | what it separates | listen | YES / NO |
|---|---|---|---|---|---|---|
| 1 | 173 | `protection_failure` | **603.69** | …Supply lines, reinforcements, intelligence, e… **‖** for sustained operation, ceases to function t… | `ffplay -ss 600.79 -t 5.80 -autoexit .work-phase4/replay/173/audio_16k.wav` | |
| 2 | 173 | `team_disperse` | **624.68** | …the most controlled form of Warp-adjacent tra… **‖** The loyalist strike force scattered across a … | `ffplay -ss 621.78 -t 5.80 -autoexit .work-phase4/replay/173/audio_16k.wav` | |
| 3 | 173 | `battle_network` | **597.83** | …Communication with anything outside the hull … **‖** Supply lines, reinforcements, intelligence, e… | `ffplay -ss 594.93 -t 5.80 -autoexit .work-phase4/replay/173/audio_16k.wav` | |
| 4 | v6 | `242_fen_excited_run` | **710.11** | …Your youngest scout is Fen. **‖** He has the instincts but his feet carry his e… | `ffplay -ss 707.21 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 5 | spanish | `006_attack_setup` | **12.87** | …y 12 patas debajo de su cuerpo. **‖** Su ataque es sencillo. | `ffplay -ss 9.97 -t 5.80 -autoexit .work-phase4/replay/spanish/audio_16k.wav` | |
| 6 | v6 | `332_fading_sound` | **1020.65** | …A smell change at the base of a slope. **‖** A sound she had not consciously registered un… | `ffplay -ss 1017.75 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 7 | 173 | `vessel_access` | **138.54** | …and debris, fused by warp transit into a stru… **‖** Boarding one isn’t a tactical challenge. | `ffplay -ss 135.64 -t 5.80 -autoexit .work-phase4/replay/173/audio_16k.wav` | |
| 8 | 173 | `unstable_spirit_journey` | **586.28** | …as measured by external observers, and some h… **‖** Crew psychological integrity declines in prop… | `ffplay -ss 583.38 -t 5.80 -autoexit .work-phase4/replay/173/audio_16k.wav` | |
| 9 | v6 | `036_outward_sentry` | **105.55** | …The band has a shape at night it does not hav… **‖** Certain men always face outward. | `ffplay -ss 102.65 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 10 | v6 | `412_youngest_scout` | **1312.15** | …the place a thing moves to when it stops bein… **‖** Fen’s youngest scout | `ffplay -ss 1309.25 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 11 | v6 | `060_reassuring_hand` | **184.02** | …But Daret, the rear guard **‖** moves up beside you and puts his hand flat on… | `ffplay -ss 181.12 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 12 | v6 | `225_night_scouts` | **667.47** | …You are thirty-three. **‖** You lead the night scouts now. | `ffplay -ss 664.57 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 13 | v6 | `307_forty_nine_years` | **924.92** | …You carry it alongside everything else and yo… **‖** You are forty-nine. | `ffplay -ss 922.02 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 14 | v6 | `383_sixty_four` | **1188.95** | …All you can do is be honest and let them take… **‖** You are sixty-four. | `ffplay -ss 1186.05 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 15 | 173 | `unstable_energy_consequence` | **612.51** | …The final boarding of the Vengeful Spirit ill… **‖** what even partial Warp exposure does at close… | `ffplay -ss 609.61 -t 5.80 -autoexit .work-phase4/replay/173/audio_16k.wav` | |
| 16 | 173 | `broken_link` | **593.88** | …Crew psychological integrity declines in prop… **‖** Communication with anything outside the hull … | `ffplay -ss 590.98 -t 5.80 -autoexit .work-phase4/replay/173/audio_16k.wav` | |
| 17 | spanish | `014_keep_moving` | **37.98** | …Eso significa que la estrategia más segura no… **‖** Es seguir moviéndose antes de que pueda ataca… | `ffplay -ss 35.08 -t 5.80 -autoexit .work-phase4/replay/spanish/audio_16k.wav` | |
| 18 | 173 | `entry_clash` | **609.24** | …for sustained operation, ceases to function t… **‖** The final boarding of the Vengeful Spirit ill… | `ffplay -ss 606.34 -t 5.80 -autoexit .work-phase4/replay/173/audio_16k.wav` | |
| 19 | 173 | `safety_passage` | **361.37** | …That single feature separates this from every… **‖** A fire lane is cleared. | `ffplay -ss 358.47 -t 5.80 -autoexit .work-phase4/replay/173/audio_16k.wav` | |
| 20 | v6 | `133_wake_man` | **399.79** | …You guard your stretch **‖** wake the next man | `ffplay -ss 396.89 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 21 | v6 | `245_seasonal_contrast` | **719.91** | …You watch him for two full seasons and say al… **‖** You let him see the contrast. | `ffplay -ss 717.01 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 22 | 173 | `eternal_focus` | **37.73** | …The jungle didn’t evolve around human warfare. **‖** It spent millions of years optimizing toward … | `ffplay -ss 34.83 -t 5.80 -autoexit .work-phase4/replay/173/audio_16k.wav` | |
| 23 | v6 | `085_the_spear_bearer` | **250.69** | …Your body made that choice without asking. **‖** You are sixteen and you carry your own spear. | `ffplay -ss 247.79 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |
| 24 | v6 | `224_thirty_three` | **663.785** | …You carry it. **‖** You are thirty-three. | `ffplay -ss 660.88 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` | |

**Score: ____ / 24**

---


---

## 2. The complete mover population (Step 2)

**Method, so the count is auditable rather than asserted.** The committed value of every
boundary is `scripts/fixtures/phase4-fa-second-baseline-{corpus}-segments.csv`. That file's
full git history *is* the rule history — every commit that changed a committed boundary is a
rule landing:

| commit | date | rule | corpora touched |
|---|---|---|---|
| `580ba0f` | 2026-08-16 | — (pristine FA second-baseline, no rule applied) | all three |
| `92746cf` | 2026-08-16 | **R-U** zero-seam rejection | v6, 173, spanish |
| `52140e5` | 2026-08-16 | **R-AA** seam-region reading (narrows R-U) | v6, 173 |
| `a0ff7c0` | 2026-08-17 | **R.5** unscripted-audio excision | v6 |
| `3faf0ea` | 2026-08-17 | **R.10** scripted-text-never-spoken | 173 |
| `f7fb9d0` | 2026-08-17 | **R.11** chunk-fit boundary correction | v6, 173 |
| `5959430` | 2026-08-17 | (Session G — no fixture change; **verified as a control**) | none |
| `726112b` | 2026-08-18 | **R.12** atomic-run invariant | v6 |

Every consecutive pair was diffed by `tag` on `startTime`. **The population is exhaustive
and closed** — stop-and-rule exit **I1 does not fire**.

### 2.1 The population — 31 boundaries

| # | project | idx | segment | pre-rule (pristine FA) | current (HEAD) | Δ | owning rule(s) | scoring status |
|---|---|---|---|---|---|---|---|---|
| 1 | v6 | 41 | `042_eleven_years` | 125.76 | 125.54 | -0.22 | R.5, R.12 | ear-verified |
| 2 | v6 | 42 | `043_night_migration` | 128.43 | 130.96 | +2.53 | R.5 | ear-verified |
| 3 | v6 | 59 | `060_reassuring_hand` | 183.03 | 184.02 | +0.99 | R-U | **never scored** |
| 4 | v6 | 84 | `085_the_spear_bearer` | 252.74 | 250.69 | -2.05 | R.12 | structurally-derived |
| 5 | v6 | 86 | `087_throwing_spear_poise` | 259.47 | 259.88 | +0.41 | R.5 | ear-verified |
| 6 | v6 | 124 | `125_night_circle` | 370.75 | 370.75 | **0 (net-unmoved)** | R.5, R.12 | ear-verified |
| 7 | v6 | 151 | `152_frozen_brush_mice` | 449.2 | 451.03 | +1.83 | R.11 | ear-verified |
| 8 | v6 | 175 | `176_twenty_six_scout` | 526.09 | 521.71 | -4.38 | R.5, R.12 | ear-verified |
| 9 | v6 | 191 | `192_scout_listening` | 570.18 | 571.07 | +0.89 | R.11 | ear-verified |
| 10 | v6 | 223 | `224_thirty_three` | 664.33 | 663.785 | -0.545 | R-U, R-AA, R.12 | structurally-derived |
| 11 | v6 | 224 | `225_night_scouts` | 667.47 | 667.47 | **0 (net-unmoved)** | R-U, R-AA | **never scored** |
| 12 | v6 | 225 | `226_four_scouts` | 670.24 | 671.18 | +0.94 | R-U, R-AA, R.11 | ear-verified |
| 13 | v6 | 241 | `242_fen_excited_run` | 708.95 | 710.11 | +1.16 | R-U | **never scored** |
| 14 | v6 | 265 | `266_forty_one_burden` | 792.18 | 788.65 | -3.53 | R.5, R.12 | ear-verified |
| 15 | v6 | 306 | `307_forty_nine_years` | 926.97 | 924.92 | -2.05 | R.12 | structurally-derived |
| 16 | v6 | 307 | `308_scouts_leading` | 928.67 | 931.4 | +2.73 | R.5 | ear-verified |
| 17 | v6 | 339 | `340_fifty_eight` | 1047.57 | 1044.67 | -2.9 | R-U, R.5, R.12 | ear-verified |
| 18 | v6 | 382 | `383_sixty_four` | 1190.81 | 1188.95 | -1.86 | R.12 | structurally-derived |
| 19 | 173 | 0 | `hostile_landscape` | 1.36 | 0 | -1.36 | R.10 | ear-verified |
| 20 | 173 | 0 | `perilous_realms` | 0 | *dropped* | — | R.10 | **never scored** |
| 21 | 173 | 4 | `abysmal_opinion` | 16.5 | 17.88 | +1.38 | R-U, R-AA, R.11 | ear-verified |
| 22 | 173 | 11 | `eternal_focus` | 37.73 | 37.73 | **0 (net-unmoved)** | R-U, R-AA | **never scored** |
| 23 | 173 | 12 | `blue_monkey` | 36.96 | *dropped* | — | R-U, R-AA, R.10 | ear-verified |
| 24 | 173 | 45 | `vessel_damage_clue` | 172.91 | 174.74 | +1.83 | R-U | ear-verified |
| 25 | 173 | 141 | `unstable_spirit_journey` | 586.28 | 586.28 | **0 (net-unmoved)** | R-U, R-AA | **never scored** |
| 26 | 173 | 142 | `broken_link` | 593.88 | 593.88 | **0 (net-unmoved)** | R-U, R-AA | **never scored** |
| 27 | 173 | 143 | `battle_network` | 597.83 | 597.83 | **0 (net-unmoved)** | R-U, R-AA | **never scored** |
| 28 | 173 | 144 | `protection_failure` | 603.69 | 603.69 | **0 (net-unmoved)** | R-U, R-AA | **never scored** |
| 29 | 173 | 145 | `entry_clash` | 609.24 | 609.24 | **0 (net-unmoved)** | R-U, R-AA | **never scored** |
| 30 | 173 | 146 | `unstable_energy_consequence` | 612.51 | 612.51 | **0 (net-unmoved)** | R-U, R-AA | **never scored** |
| 31 | spanish | 22 | `023_scylla_six_sailors` | 66.73 | 65.12 | -1.61 | R-U | ear-verified |
**Totals: 31 unique boundaries — 16 ear-verified, 4 structurally-derived, 11 never scored.**
Two of the 31 are *dropped* rather than moved (`perilous_realms`, `blue_monkey` — both R.10).
Nine are **net-unmoved**: R-U moved them and R-AA reverted them to the pristine value, so they
have been touched by a rule but hold their original number at HEAD.

### 2.2 Multi-rule rows, named as required

Seventeen of the 31 were touched by more than one rule. The two the brief names by value are
both present and both reconcile:

| value in the brief | row | rules that touched it | chain |
|---|---|---|---|
| **372.35** | v6 `125_night_circle` | **R.5, R.12** | 370.75 →(R.5) **372.35** →(R.12) 370.75 — net-unmoved, and 372.35 is an *intermediate* value, never a HEAD or pristine one |
| **1047.57** | v6 `340_fifty_eight` | **R-U, R.5, R.12** — three rules, the most-touched row in the corpus | 1047.57 →(R-U) 1045.62 →(R.5) **1047.57** →(R.12) 1044.67 |

The full set of multi-rule rows: `042_eleven_years` (R.5, R.12), `125_night_circle` (R.5,
R.12), `176_twenty_six_scout` (R.5, R.12), `224_thirty_three` (R-U, R-AA, R.12),
`225_night_scouts` (R-U, R-AA), `226_four_scouts` (R-U, R-AA, R.11), `266_forty_one_burden`
(R.5, R.12), `340_fifty_eight` (R-U, R.5, R.12), `abysmal_opinion` (R-U, R-AA, R.11),
`blue_monkey` (R-U, R-AA, R.10), `eternal_focus`, `unstable_spirit_journey`, `broken_link`,
`battle_network`, `protection_failure`, `entry_clash`, `unstable_energy_consequence` (all
R-U, R-AA).

### 2.3 Reconciliation against the per-rule counts

| rule | documented count | measured here | agrees? |
|---|---|---|---|
| R-U | "16/649 boundaries move (6 v6, 10 173, **0 spanish**)" (`92746cf`) | 17 (6 v6, 10 173, **1 spanish**) | ✅ on v6+173, **+1 spanish** |
| R-AA | "4/649 boundaries move (3 v6, 1 173, **0 spanish**)" (`52140e5`) | 5 (3 v6, 1 173, **1 spanish**) | ✅ on v6+173, **+1 spanish** |
| R.5 | 8 movers, v6-only | 8, v6-only | ✅ exact |
| R.10 | items 10/11, 173-only | 1 moved + 2 dropped, 173-only | ✅ exact |
| R.11 | 4 findings (3 v6, 1 173) | 4 (3 v6, 1 173) | ✅ exact |
| R.12 | 9, v6-only | 9, v6-only | ✅ exact |

**The single discrepancy, explained and NOT an I2 exit.** Both R-U and R-AA are one lower
than measured, and it is the *same one row* in both cases: spanish `023_scylla_six_sailors`,
66.73 → 65.12 at `92746cf`. That change is **not an R-U move**. `92746cf`'s own commit
message says so twice — "0 spanish", and "Those fixtures are regenerated here; A.5's
KNOWN-STALE marker on the Spanish file is cleared." The row is the *stale-fixture clearance*
carried in the same commit: the Spanish baseline finally showed the live 65.12 instead of
the stale 66.73. It is fully accounted for — it is register roster member `item-9`, closed
by a positive assertion at 65.12, ear-verified, `closingCommit` `616abb2`, owning cause "the
forced-split chunk-plan attribution bug".

So: **every one of the 31 movers has a named owner.** One of them (`item-9`) is owned by a
documented cause rather than by one of the five named rules, which is why it is called out
here rather than passed over. **Exit I2 does not fire.** The owner may still wish to rule on
whether a fixture-staleness clearance should count as a mover at all; nothing downstream
depends on the answer, since the row is ear-verified either way.

---

## 3. How this audit set was drawn

### 3.1 The audit arm — 14 rows

Every **never-scored** and every **structurally-derived** mover from §2.1, with one
documented exclusion:

- **All 4 structurally-derived rows** (`085_the_spear_bearer`, `224_thirty_three`,
  `307_forty_nine_years`, `383_sixty_four`) — these are R-AM(c)'s provisional closures.
- **All 11 never-scored rows**, minus `perilous_realms`.
- **`perilous_realms` is excluded, and here is why it is not a gap.** It is a *dropped* row —
  an absence assertion, not a boundary. Its ear verification already exists: R.10 refused the
  never-voiced on-screen title carved out of [0.00, 1.36], which is precisely what makes
  `hostile_landscape` the first committed segment at 0.00 — and `hostile_landscape` 0.00 is
  ear-verified register member `item-10`. Scoring the absence *is* scoring `item-10`, which
  was scored. Recorded rather than silently dropped.

### 3.2 The control arm — 10 rows (41.7% of the set)

Sized as a meaningful fraction, not a token two or three, so arm membership is not inferable
from count. Drawn by an evenly-spaced deterministic pick over each corpus's clean pool
(v6 5, 173 3, spanish 2 — from clean pools of 342 / 136 / 15). "Clean" excludes, in order:

1. any boundary whose `startTime` **or** `duration` changed at any commit in §2 (32 v6 /
   16 173 / 2 spanish tags);
2. any boundary within **±2 index positions** of such a site (contamination guard, carried
   from Session G's draw — this is what removed `151_scout_listening_void` there);
3. any boundary within **5 s of any previously ear-scored value** in any earlier sitting;
4. any boundary within **5 s of any row in this audit's own audit arm**, so the arms cannot
   be told apart by adjacency;
5. any boundary before 3.00 s, or on a segment shorter than 1.2 s (a micro-segment tests the
   window, not the boundary);
6. any boundary whose 5.80 s window would fall outside [0, audio duration].

### 3.3 Blinding proof — and stop-and-rule exit **I4**, FIRED

**What holds.** Window length is **5.80 s on all 24 rows without exception**, always centred
on the stated value, so window geometry carries zero information about arm. Presentation
order is `sha256(tag)` ascending, computed from the tag alone — independent of arm, corpus,
magnitude and draw order. The audit:control split is 14:10, so neither arm is the residue of
the other. Both arms span all three corpora. No window falls outside its corpus's audio.

**What does not hold — I4.** The brief requires the uniform window to contain *both* candidate
values on every row. At 5.80 s (half-window 2.90 s) that holds on 9 of the 14 audit rows and
**fails on 5**:

| row | stated value | competing value | separation |
|---|---|---|---|
| 173 `entry_clash` | 609.24 | 613.57 | 4.33 s |
| 173 `protection_failure` | 603.69 | 612.51 | 8.82 s |
| 173 `battle_network` | 597.83 | 609.99 | 12.16 s |
| 173 `broken_link` | 593.88 | 609.24 | 15.36 s |
| 173 `unstable_spirit_journey` | 586.28 | 606.51 | **20.23 s** |

Containing all of them would need a uniform window of **≈40.5 s** — which breaks the
listening budget outright and would itself be the larger defect.

**The resolution — RATIFIED BY THE OWNER, 2026-08-18 (WS1 Session J). I4 is CLOSED.** All five
are the same structure: a contiguous 173 cascade (indices 141–146) where R-U's instant
reading shifted a run of consecutive segments forward by up to 20 s and **R-AA reverted every
one of them**. Their competing value is a *reverted transient* — a value no rule proposes at
HEAD, already ruled wrong, and not a live alternative. The "hear both candidates" requirement
exists so a genuinely moved row can be scored against its real alternative; where the only
alternative is a discarded historical artifact, a single-value judgement at the committed
boundary is the correct test, and it is exactly the test the control arm takes. **Blinding is
unaffected either way, because the window is uniform.**

> **OWNER RULING, 2026-08-18:** *the five 173 cascade rows (committed indices 141–146) are
> scored with the **uniform 5.80 s window**, exactly as every other row. I4 is resolved as
> proposed and the exit is closed.*

Consequently **every one of the 24 rows in §1 carries a 5.80 s window with no exception**, and
the five cascade rows are scored as single-value judgements at their committed boundary. The
audit is drawn, ratified and ready to score.

**Re-verified at WS1 Session J's HEAD:** all 24 boundary values in §1 were re-read from
`scripts/fixtures/phase4-fa-second-baseline-{corpus}-segments.csv` and **all 24 match** —
0 mismatches. The list below is current, not inherited.

---
## 4. SEALED KEY — do not read until §1 is fully scored

<details>
<summary>Expand only after scoring all 24 rows.</summary>

| # | segment | arm | value | competing value | sep | owning rule(s) | why this row is here |
|---|---|---|---|---|---|---|---|
| 1 | `protection_failure` | **AUDIT** | 603.69 | 612.51 | 8.820 | R-U, R-AA | mover, **never ear-scored** |
| 2 | `team_disperse` | CONTROL | 624.68 | — | — | — | unmoved control — no rule has ever touched this boundary |
| 3 | `battle_network` | **AUDIT** | 597.83 | 609.99 | 12.160 | R-U, R-AA | mover, **never ear-scored** |
| 4 | `242_fen_excited_run` | **AUDIT** | 710.11 | 708.95 | 1.160 | R-U | mover, **never ear-scored** |
| 5 | `006_attack_setup` | CONTROL | 12.87 | — | — | — | unmoved control — no rule has ever touched this boundary |
| 6 | `332_fading_sound` | CONTROL | 1020.65 | — | — | — | unmoved control — no rule has ever touched this boundary |
| 7 | `vessel_access` | CONTROL | 138.54 | — | — | — | unmoved control — no rule has ever touched this boundary |
| 8 | `unstable_spirit_journey` | **AUDIT** | 586.28 | 606.51 | 20.230 | R-U, R-AA | mover, **never ear-scored** |
| 9 | `036_outward_sentry` | CONTROL | 105.55 | — | — | — | unmoved control — no rule has ever touched this boundary |
| 10 | `412_youngest_scout` | CONTROL | 1312.15 | — | — | — | unmoved control — no rule has ever touched this boundary |
| 11 | `060_reassuring_hand` | **AUDIT** | 184.02 | 183.03 | 0.990 | R-U | mover, **never ear-scored** |
| 12 | `225_night_scouts` | **AUDIT** | 667.47 | 669.05 | 1.580 | R-U, R-AA | mover, **never ear-scored** |
| 13 | `307_forty_nine_years` | **AUDIT** | 924.92 | 926.97 | 2.050 | R.12 | R.12 closure admitted on the mechanism, **never ear-scored** |
| 14 | `383_sixty_four` | **AUDIT** | 1188.95 | 1190.81 | 1.860 | R.12 | R.12 closure admitted on the mechanism, **never ear-scored** |
| 15 | `unstable_energy_consequence` | **AUDIT** | 612.51 | 615.3 | 2.790 | R-U, R-AA | mover, **never ear-scored** |
| 16 | `broken_link` | **AUDIT** | 593.88 | 609.24 | 15.360 | R-U, R-AA | mover, **never ear-scored** |
| 17 | `014_keep_moving` | CONTROL | 37.98 | — | — | — | unmoved control — no rule has ever touched this boundary |
| 18 | `entry_clash` | **AUDIT** | 609.24 | 613.57 | 4.330 | R-U, R-AA | mover, **never ear-scored** |
| 19 | `safety_passage` | CONTROL | 361.37 | — | — | — | unmoved control — no rule has ever touched this boundary |
| 20 | `133_wake_man` | CONTROL | 399.79 | — | — | — | unmoved control — no rule has ever touched this boundary |
| 21 | `245_seasonal_contrast` | CONTROL | 719.91 | — | — | — | unmoved control — no rule has ever touched this boundary |
| 22 | `eternal_focus` | **AUDIT** | 37.73 | 38.5 | 0.770 | R-U, R-AA | mover, **never ear-scored** |
| 23 | `085_the_spear_bearer` | **AUDIT** | 250.69 | 252.74 | 2.050 | R.12 | R.12 closure admitted on the mechanism, **never ear-scored** |
| 24 | `224_thirty_three` | **AUDIT** | 663.785 | 664.33 | 0.545 | R-U, R-AA, R.12 | R.12 closure admitted on the mechanism, **never ear-scored** |

</details>
---

## 5. The twelve previously scored rows, re-verified at HEAD `726112b`

Required by the brief; **any drift here is stop-and-rule exit I5**. The Session G list was
drawn at `f7fb9d0` and scored in Session H. Seven scored YES and must still hold their value;
five scored NO and must have been corrected away by R.12 — a NO row that still held its
scored value would be the more serious failure.

| # | project | segment | scored value | Session H verdict | at draw `f7fb9d0` | at HEAD `726112b` | status |
|---|---|---|---|---|---|---|---|
| 1 | 173 | `fallen_regiment_site` | 507.01 | YES | 507.01 | 507.01 | ✅ holds |
| 2 | v6 | `192_scout_listening` | 571.07 | YES | 571.07 | 571.07 | ✅ holds |
| 3 | v6 | `158_scout_false_alert` | 466.09 | YES | 466.09 | 466.09 | ✅ holds |
| 4 | 173 | `earthwork_corridor` | 256.33 | YES | 256.33 | 256.33 | ✅ holds |
| 5 | v6 | `340_fifty_eight` | 1047.57 | **NO** | 1047.57 | **1044.67** | ✅ corrected away by R.12, as designed |
| 6 | v6 | `176_twenty_six_scout` | 524.39 | **NO** | 524.39 | **521.71** | ✅ corrected away by R.12, as designed |
| 7 | v6 | `266_forty_one_burden` | 790.33 | **NO** | 790.33 | **788.65** | ✅ corrected away by R.12, as designed |
| 8 | spanish | `016_prepares_weapons` | 44.90 | YES | 44.90 | 44.90 | ✅ holds |
| 9 | v6 | `318_scout_on_ridge` | 969.30 | YES | 969.30 | 969.30 | ✅ holds |
| 10 | v6 | `042_eleven_years` | 127.17 | **NO** | 127.17 | **125.54** | ✅ corrected away by R.12, as designed |
| 11 | v6 | `125_night_circle` | 372.35 | **NO** | 372.35 | **370.75** | ✅ corrected away by R.12, as designed |
| 12 | v6 | `087_throwing_spear_poise` | 259.88 | YES | 259.88 | 259.88 | ✅ holds |

**Result: 12/12 consistent. No drift. Exit I5 does not fire.**

Note that none of these twelve is re-scored in §1 — re-scoring rows already known to pass
would inflate the result, the same reasoning Session G's own draw applied.

---

## 6. If any row scores NO

Per the plan's hard rule, a defect found in a locked stage reopens that stage.

- **A NO on any of the four structurally-derived rows** (`085_the_spear_bearer`,
  `224_thirty_three`, `307_forty_nine_years`, `383_sixty_four`) → R.12's closure of that entry
  was wrong on the merits, and under R-AM the entry reopens rather than being downgraded. This
  is the specific outcome R-AM(c) exists to catch.
- **A NO on `060_reassuring_hand` or `242_fen_excited_run`** → these are R-U's two surviving
  net movers that R-AA did not revert. A NO means R-AA's narrowing kept a boundary it should
  have reverted, and the defect is in R-AA's seam-region reading, not in R-U.
- **A NO on any net-unmoved row** (the 173 141–146 cascade, `eternal_focus`,
  `225_night_scouts`) → the defect predates the entire programme: R-U moved it, R-AA put it
  back, and the value it was put back to is wrong. That is not a rule regression; it is an
  original FA defect no rule has ever owned, and it needs a new register entry.
- **A NO on any control** → the defect is in a boundary no rule has touched, and it predates
  this programme.
