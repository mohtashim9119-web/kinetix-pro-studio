# WS1 Session AC — Stage 1 Ear List (open Class A/B rows, no independent ear evidence)

> **CAPTURE ONLY.** This file freezes candidate timestamps for the listening pass nobody has
> run yet. It changes no rule logic, closes no register row, and asserts no verdict. **Ear
> Verdict and Class are blank on purpose** — fill them in after listening; do not infer them
> from candidate ordering, from this document's prose, or from `scripts/phase4-fa-replay.test.ts`'s
> own `earCorrect` field (which names a target but, per Session AC's own Step 2 finding below,
> is not itself backed by a scored listening pass for any of these eight rows). Candidates are
> listed in TIMESTAMP order, not in an order that hints which one is right.

**Provenance.** All eight rows measured fresh this session (WS1 Session AC, HEAD `aea0d19`)
against the same run-id-stamped live-fidelity bundle every WS1 session since Q has read from —
`.work-phase4/replay/v6`, run id `p-20260819T120922Z-cbb403c1` — via `runProductionPath`
(`scripts/ws1-session-p-pipeline.ts`, App.tsx's own rule order/arguments) in
`scripts/ws1-session-ac-drift-probe.test.ts` (`WS1_SESSION_AC_MEASURE=1`). All eight committed
values reproduced **byte-identical** to the values recorded in the register
(`scripts/phase4-fa-replay.test.ts`'s `KNOWN_BAD`) since Session Q — see Session AC's own Step 1
drift audit for the full byte-for-byte comparison. Silence bounds for every candidate below were
independently re-derived this session directly from `.work-phase4/replay/v6/silences_native.json`
(nearest real detected silence to each timestamp, by midpoint distance), not copied from any
prior session's prose. Source audio: `6.m4a` (V6's original, not the 16 kHz replay capture —
same reasoning as Session S/W: low-level breath/pause amplitude sits close to the silence
detector's threshold at 16 kHz, and this file exists to be listened to, not re-measured).

**Why these eight and not more/fewer.** Session AC's Step 2 found that none of the eight open
Class A/B rows has a scored listening pass behind its `earCorrect` target — the register's own
`session-p-live` ledger entries are a same-session transcription of the register's own claim, not
an independent sitting (full reasoning in the session report). All eight open rows therefore
belong on this list; the session brief anticipated six by name (`214_solitary_fire`,
`447_scout_facing_dark`, four Class B rows) — this list also includes `231_slowing_pace` and
`167_smell_of_butchery`, which measure the identical way. `152_frozen_brush_mice` and
`abysmal_opinion` (the two historical R.11 register members) are deliberately **not** here: both
have a genuine independent sitting on record (`ear-12` and `ov3-triage` respectively, in
`scripts/ws1-ear-pass-ledger.ts`) scoring their register target correct.

**How to run this.** Per row, the command below is copy-pasteable as-is. `-autoexit` closes the
player when the clip ends; `-nodisp` skips the (unneeded) video window.

```bash
ffplay -hide_banner -loglevel error -autoexit -nodisp \
  -ss <window start> -t <window duration> \
  "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

**The question for every row.** Listen to the window and judge which of the listed candidate
timestamps is the correct place for the cut — or whether none of them are.

---

## Section A — silence-pair rows (3 rows)

Each candidate below is the midpoint of a real, independently re-measured detected silence.
`214_solitary_fire` and `447_scout_facing_dark` currently commit to a silence that sits
immediately before the one their register entry names as the target — a two-candidate,
adjacent-silence choice. `231_slowing_pace` is a three-candidate row: its committed value is
**not** a silence midpoint at all (nearest real silence is 0.64s away), so a naive
nearest-silence detector's own proposal is included as a genuine third option, alongside the
committed value and the register's named target — this is the same three-way shape Session Q's
own `ws1-session-q-detector-validate.test.ts` measured and found the naive detector's proposal
wrong on, included here so the listener hears all three rather than taking that finding on faith.

| # | Tag | Boundary (prev seg → own seg) | Current committed | Candidates (timestamp — geometric derivation) | Window (start, duration) | Ear Verdict | Class |
|---|---|---|---|---|---|---|---|
| 1 | `214_solitary_fire` | `213_pensive_stare` → `214_solitary_fire` | 629.01 | **A** 629.01 — midpoint of silence [628.86, 629.16] · **B** 630.09 — near midpoint of silence [629.58, 630.62] (mid 630.10, 0.01s off) | 627.51, 4.08s | | |
| 2 | `231_slowing_pace` | `230_slowing_pace` → `231_slowing_pace` | 681.63 | **A** 680.99 — midpoint of silence [680.48, 681.50] (nearest-silence detector's own proposal; not the committed value) · **B** 681.63 — committed value, 0.64s from any real detected silence (not a silence-midpoint pick) · **C** 682.74 — silence [682.42, 683.06] midpoint exactly | 679.49, 4.75s | | |
| 3 | `447_scout_facing_dark` | `446_dark_landscape` → `447_scout_facing_dark` | 1417.12 | **A** 1417.12 — midpoint of silence [1416.94, 1417.30] · **B** 1418.53 — near midpoint of silence [1418.14, 1418.88] (mid 1418.51, 0.02s off) | 1415.62, 4.41s | | |

**Scripted text.**

- **Row 1** — `213_pensive_stare`: "You do not know what it decided or why." / `214_solitary_fire`:
  "You only know you are at the fire because whatever it was let you leave."
- **Row 2** — `230_slowing_pace`: "But when you slow" / `231_slowing_pace`: "they slow." (one
  sentence split across the two tags — the pause itself is the whole content of this boundary.)
- **Row 3** — `446_dark_landscape`: "The dark does not change." / `447_scout_facing_dark`: "Only
  the ones who learn to face it."

**Play commands.**

```bash
ffplay -hide_banner -loglevel error -autoexit -nodisp -ss 627.51 -t 4.08 \
  "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

```bash
ffplay -hide_banner -loglevel error -autoexit -nodisp -ss 679.49 -t 4.75 \
  "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

```bash
ffplay -hide_banner -loglevel error -autoexit -nodisp -ss 1415.62 -t 4.41 \
  "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

---

## Section B — fallback rows (5 rows)

All five are `boundaryUsedFallback` boundaries: no detected silence ever fell inside the narrow
search window each pair's alignment originally used, so the committed value below is **not** a
silence-midpoint pick at all (it sits 0.34–0.67s from the nearest real detected silence in every
row). Each row's register-recorded target sits within 0.09s of a real detected silence found
just outside that original narrow window — included below as Candidate B.

| # | Tag | Boundary (prev seg → own seg) | Current committed | Candidates (timestamp — geometric derivation) | Window (start, duration) | Ear Verdict | Class |
|---|---|---|---|---|---|---|---|
| 4 | `056_dropping_torch` | `055_spear_comparison` → `056_dropping_torch` | 167.03 | **A** 167.03 — committed (fallback, 0.67s from nearest silence) · **B** 167.70 — midpoint of silence [167.08, 168.32] exactly | 165.53, 3.67s | | |
| 5 | `167_smell_of_butchery` | `166_dire_wolf_perimeter` → `167_smell_of_butchery` | 494.43 | **A** 494.43 — committed (fallback, 0.34s from nearest silence) · **B** 494.75 — near midpoint of silence [494.52, 495.02] (mid 494.77, 0.02s off) | 492.93, 3.32s | | |
| 6 | `286_fact_to_act` | `285_elder_seriousness` → `286_fact_to_act` | 856.09 | **A** 856.09 — committed (fallback, 0.45s from nearest silence) · **B** 856.52 — near midpoint of silence [856.22, 856.86] (mid 856.54, 0.02s off) | 854.59, 3.43s | | |
| 7 | `400_endless_dark` | `399_fens_realization` → `400_endless_dark` | 1266.21 | **A** 1266.21 — committed (falls *inside* silence [1266.16, 1267.34] but not at its midpoint — the widest floor miss of the five) · **B** 1266.66 — near midpoint of that same silence (mid 1266.75, 0.09s off) | 1264.71, 3.45s | | |
| 8 | `403_vigilant_embers` | `402_cyclical_darkness` → `403_vigilant_embers` | 1273.14 | **A** 1273.14 — committed (fallback, 0.42s from nearest silence) · **B** 1273.55 — near midpoint of silence [1273.20, 1273.92] (mid 1273.56, 0.01s off) | 1271.64, 3.41s | | |

**Scripted text.**

- **Row 4** — `055_spear_comparison`: "...same as the spear." / `056_dropping_torch`: "You drop
  the torch on the third night of your second season carrying it."
- **Row 5** — `166_dire_wolf_perimeter`: "The threat is a lone dire wolf testing the perimeter" /
  `167_smell_of_butchery`: "drawn by the smell of the previous day's butchering."
- **Row 6** — `285_elder_seriousness`: "You explain that it is not." / `286_fact_to_act`: "It is a
  fact he needs to act on"
- **Row 7** — `399_fens_realization`: "You describe the look on Fen's face the first time slowing
  his feet made a difference he could feel in his whole body." / `400_endless_dark`: "You tell
  them the dark cannot be finished."
- **Row 8** — `402_cyclical_darkness`: "...the same as it always has" / `403_vigilant_embers`:
  "and it expects the same quality of attention on the thousandth night as it did on the first."

**Play commands.**

```bash
ffplay -hide_banner -loglevel error -autoexit -nodisp -ss 165.53 -t 3.67 \
  "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

```bash
ffplay -hide_banner -loglevel error -autoexit -nodisp -ss 492.93 -t 3.32 \
  "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

```bash
ffplay -hide_banner -loglevel error -autoexit -nodisp -ss 854.59 -t 3.43 \
  "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

```bash
ffplay -hide_banner -loglevel error -autoexit -nodisp -ss 1264.71 -t 3.45 \
  "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

```bash
ffplay -hide_banner -loglevel error -autoexit -nodisp -ss 1271.64 -t 3.41 \
  "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

---

## Notes for whoever scores this

- **Window construction.** Every window is `[min(candidates) − 1.5s, max(candidates) + 1.5s]` —
  a uniform ±1.5s pad around the row's own candidate span, per this session's brief. Padding is
  uniform; total window duration varies row to row because candidate spread does.
- **`Ear Verdict`** — suggested vocabulary matches `scripts/ws1-ear-pass-ledger.ts`'s
  `EarVerdict` type (`CORRECT` / `EARLY` / `LATE` / `WRONG` / `ABSENT-OK`), scored against
  whichever candidate letter you judge correct — write both (e.g. "B, CORRECT").
- **`Class`** — open for whatever distinction the listener finds useful (e.g. placement vs.
  attribution, per `sync-pipeline-v2-plan.md` Part P) — not pre-defined here, deliberately.
- Once scored, add rows to `scripts/ws1-ear-pass-ledger.ts` under a fresh `sitting` key (do not
  reuse `session-p-live` — that key is the transcription this session's Step 2 found wanting) and
  re-run `scripts/ws1-session-q-production-pins.test.ts`-style `pinEarVerified` machinery before
  converting anything in `scripts/phase4-fa-replay.test.ts`'s register.
