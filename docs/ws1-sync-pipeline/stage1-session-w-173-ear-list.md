# WS1 Session W — 173 Pre-Fix Ear List (capture only, no verdicts recorded)

> **CAPTURE ONLY.** This file freezes the pre-fix state of the 173 project for the
> listening pass the operator has not done yet. It changes no rule logic, closes no
> register row, and asserts no verdict. The **Ear Verdict** and **Class** columns below
> are blank on purpose — fill them in after listening, do not infer them from this
> document.

**Provenance.** Live project: "FINAL TEST 173" (`e334e104-b754-47e7-9e4e-2341442e783c`),
syncRunId `59b1a1a8-4657-47ce-bd80-90208c4768ad`, sync completed
2026-08-21T19:37:04.501Z. Fresh capture bundle:
`.work-phase4/session-w/w-20260821T205355Z-c8a8157f` (input arms from
`.work-phase4/replay/173`, inputRunId `p-20260819T133910Z-5bf038bb` — audio verified
byte-identical to the live sync's own transcoded cache entry, sha256
`c6150bcf519b28eb6654b7247cf0fcf314445623594f3acc0f40da632b4f6153`). Source audio:
`/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a`.

---

## 0. How to run this

**Section A** (8 rows — the operator-reported 6-7 seam, the one fidelity-gate
divergence, and the app's own 6 "still playing" flags): **uniform 6.00 s window**,
centred on each row's own candidate span (widest spread in this section is 1.83 s).

**Section B** (12 rows — additional boundaries this session's reference sheet found
sitting off any detected silence, beyond what the app's own live warning flagged;
lower priority, listen to these only after Section A): **uniform 12.00 s window**
(widest spread in this section is 4.91 s).

Per row, substitute `SS` (window start = row's own listed window start) and `NAME`:

```bash
cd "/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio"
./src-tauri/binaries/ffmpeg-x86_64-apple-darwin -hide_banner -loglevel error -y \
  -ss SS -t WINDOW -i "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a" \
  /tmp/W-NAME.wav && afplay /tmp/W-NAME.wav
```

`WINDOW` is `6.0` for every Section A row and `12.0` for every Section B row. Use the
ORIGINAL m4a, not the 16 kHz replay capture — same reasoning as Session S (low-level
breath/pause amplitude shifts across the -45 dB threshold at 16 kHz).

**The question for every row.** Listen to the window and judge, of the listed candidate
timestamps, which one is the correct place for the cut — or whether none of them are and
the boundary needs a different fix entirely. For the 6-7 seam specifically, also note
whether what you hear matches the "wrong cut" you already caught live — this file's own
attribution dump (below) found no word misattributed across that seam, so if the cut is
still wrong, it is a **placement** defect (wrong instant), not an **attribution** defect
(right instant, wrong word given to the wrong side).

---

## Section A — primary (8 rows)

| # | Pair | Left tag | Right tag | Committed (live) | Candidates (derivation) | Window start | Ear verdict | Class |
|---|---|---|---|---|---|---|---|---|
| 1 | 6-7 | `lethal_nature_hazard` | `rugged_survivalist` | 23.16000 | **23.16** (silence-midpoint, [22.94,23.38], current) · 23.00 (left last word "up" ends) · 23.44 (right first word "number" starts) | 20.16 | | |
| 2 | 45-46 | `pungent_vapor` | `vessel_damage_clue` | 174.74000 (live) / **172.91000 (fresh regen — DIVERGES, see §2 below)** | 172.91 (silence-midpoint, [172.70,173.12] — this session's fresh regen) · 173.32 (word-gap "residue"→"of", the literal script boundary) · 174.74 (silence-midpoint, [174.52,174.96] — the live app's own committed value) | 170.91 | | |
| 3 | 34-35 | `cosmic_wreckage_cluster` | `shifting_monolith` | 130.17000 | 130.17 (current, app-flagged "still playing") · 131.105 (quietest point in app's own 2 s scan window, amplitude 0.00021 vs 0.057 at 130.17) | 127.17 | | |
| 4 | 88-89 | `glitch_check` | `rapid_skirmish_clash` | 348.93000 | 348.93 (current, app-flagged) · 348.665 (quietest point, amplitude 0.0015 vs 0.350) | 345.93 | | |
| 5 | 96-97 | `architectural_pivot` | `ancient_guardian_mechanism` | 382.20000 | 382.20 (current, app-flagged) · 381.275 (quietest point, amplitude 0.00023 vs 0.053) | 379.20 | | |
| 6 | 106-107 | `void_vessel_steering` | `gadget_decay` | 427.48000 | 427.48 (current, app-flagged) · 427.055 (quietest point, amplitude 0.0284 vs 0.212) | 424.48 | | |
| 7 | 133-134 | `unstable_formation` | `pattern_chaos` | 545.89000 | 545.89 (current, app-flagged) · 546.215 (quietest point, amplitude 0.00034 vs 0.292) | 542.89 | | |
| 8 | 144-145 | `battle_network` | `protection_failure` | 603.69000 | 603.69 (current, app-flagged) · 603.275 (quietest point, amplitude 0.0400 vs 0.129) | 600.69 | | |

**Scripted text, rows 1-2 (the two rows this session did its own attribution/fidelity
analysis on):**

- Row 1 left (`lethal_nature_hazard`): "because the environment was already doing the
  killing before the enemy showed up."
- Row 1 right (`rugged_survivalist`): "Number Six, Catachan."
- Row 2 left (`pungent_vapor`): "The atmosphere, where it exists at all, is a chemical
  residue"
- Row 2 right (`vessel_damage_clue`): "of whatever the last crew left behind, which
  includes whatever finished..." (truncated for this table; full text in the project file)

**Scripted text, rows 3-8** (app-flagged "still playing" cuts — text as committed, see
`§0`'s provenance for the full project JSON if the truncation below matters):

- Row 3: L "A Space Hulk is centuries of accumulated ships, stations," / R "and debris,
  fused by warp transit into a structure too massive to ignore and too unstable for any
  chart to stay current on."
- Row 4: L "Whether that's a sensor artifact or accurate data is" / R "not a question
  anyone fighting inside has time to settle."
- Row 5: L "The structure itself continuously reconfigures around the intrusion, sealing
  corridors, shifting gravity orientations, cycling through" / R "defensive responses the
  way a biological organism cycles through immune responses, automatic, tireless, and
  scaling up."
- Row 6: L "Navigation through the outer reaches of the Eye of Terror" / R "requires
  specialized instruments that themselves degrade the deeper in you go."
- Row 7: L "It's matter trying to hold its shape somewhere" / R "that actively works
  against the concept of shape."
- Row 8: L "Supply lines, reinforcements, intelligence, extraction, everything a military
  force depends on" / R "for sustained operation, ceases to function the moment the
  Geller field goes."

---

## Section B — secondary (12 rows, lower priority)

Every one of these sits off any detected silence by this session's own
`reference-sheet.csv` (>20 ms from the nearest silence interval), but was **not** among
the app's own live "still playing" warnings — meaning the amplitude deviation is smaller
than whatever threshold the live heuristic uses. Candidates below are simply "current
committed value" vs. "nearest detected silence midpoint" — no quietest-point scan was run
for these (that scan is the live app's own runtime instrumentation, not reproduced here).

| # | Boundary idx | Segment (1-based) | Tag | Committed | Nearest silence [start,end] | Silence midpoint | Distance | Window start |
|---|---|---|---|---|---|---|---|---|
| 9 | 17 | 18 | `ancient_schematic_view` | 59.59000 | [56.79,57.29] | 57.04 | 2.15 | 53.59 |
| 10 | 29 | 30 | `maintenance_blade` | 110.86000 | [108.10,108.62] | 108.36 | 2.10 | 104.86 |
| 11 | 49 | 50 | `listening_error` | 191.43000 | [188.50,189.36] | 188.93 | 2.37 | 185.43 |
| 12 | 51 | 52 | `perpendicular_structural_entry` | 201.89000 | [196.36,197.66] | 196.98 | 4.91 | 195.89 |
| 13 | 59 | 60 | `rugged_landscape` | 228.48000 | [225.06,225.86] | 225.46 | 2.92 | 222.48 |
| 14 | 64 | 65 | `sturdy_plating` | 244.60000 | [240.90,241.70] | 241.30 | 3.20 | 238.60 |
| 15 | 77 | 78 | `strategic_equivalence` | 305.43000 | [302.12,302.92] | 302.52 | 2.81 | 299.43 |
| 16 | 99 | 100 | `explosive_focus` | 399.29000 | [397.48,398.28] | 397.88 | 1.41 | 393.29 |
| 17 | 115 | 116 | `mystery_signal_lag` | 472.26000 | [470.00,470.80] | 470.40 | 1.86 | 466.26 |
| 18 | 137 | 138 | `unbound_chaos` | 563.50000 | [560.62,561.42] | 561.02 | 2.48 | 557.50 |
| 19 | 163 | 164 | `uncertain_outcome` | 682.13000 | [680.56,681.36] | 680.96 | 1.17 | 676.13 |
| 20 | 167 | 168 | `troop_deployment` | 696.04000 | [697.34,697.74] | 697.54 | 1.30 | 690.04 |

Section B lists the 12 boundaries this session's own reference-sheet scan found sitting
off any detected silence (>20 ms) that the live app's own "still playing" heuristic did
**not** already flag (that heuristic's 6 hits are Section A rows 3-8). One boundary the
scan also flagged, `shifting_monolith`@130.17, is not repeated here — it IS Section A
row 3 (same cut, already listed with the app's own quietest-point candidate).

---

## 1. Fidelity gate (Step 2) — summary, full detail in the session report

172 of 173 committed boundaries in this session's fresh regeneration match the live
project's own committed boundaries exactly (≤0.00001 s, floating-point noise only). The
lone divergence is Row 2 above (`vessel_damage_clue`, boundary 45-46): fresh regen
172.91000 vs. live 174.74000, a 1.83 s gap. Both values are real silence midpoints in the
same input arms — the divergence is which of two adjacent silences each pass picked, not
a fabricated boundary. **The 6-7 seam itself is NOT part of this divergence** — it
matches exactly (23.16000 both ways) — so the fidelity gate does not block using this
session's attribution analysis for that specific seam.

## 2. Attribution dump (Step 5) — summary, full JSON in the session capture bundle

For boundaries 5-6, 6-7 and 7-8, every one of the last four FA words attributed to the
left segment and the first four attributed to the right segment belongs to that
segment's own scripted text (`inOwnerScript: true` on all of them, per
`seam-attribution.json`). **No word crosses the seam to the wrong side at any of these
three boundaries.** If the 6-7 cut still sounds wrong on a fresh listen, it is a
placement question (is 23.16 the right instant), not an attribution question (is a word
on the wrong side) — see the note in §0 above.
