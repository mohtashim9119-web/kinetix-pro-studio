# WS1 Session S — R.12 Placement Ear List (5 clips)

> **RESOLVED, WS1 Session T (2026-08-21).** The owner's answer was **B on all five, "no
> difference" on 383** — the fourth row of the licensing table in §3 below. Session T shipped it:
> the clamp (candidate A) is removed, replaced by a waveform-measured run onset
> (`acousticRunExtent`), closing `042`/`176`/`224`/`307`/`340` at their B values and reopening
> `383_sixty_four` after an A/B side-by-side pass (not this file's own solo-listening format)
> reversed the SOLO verdict recorded here. Full write-up: `docs/work-in-progress.md`'s Changelog,
> "2026-08-21 — WS1 Session T." This file's own content below is kept verbatim as the record of
> what was asked and why — not updated in place.

> **Drawn at the Session S working tree**, against the run-id-stamped live-fidelity
> bundle `p-20260819T120922Z-cbb403c1` and the real production
> `detectRunPlacementDefects` / `computeUnscriptedRuns` / native-rate detected-silence
> output. **5 rows. Uniform 7.00 s window on every row.**
>
> **R.12's value change is BLOCKED on this pass.** Session S measured five principled
> placements for every row and shipped none, because no candidate reproduces both of the
> boundaries your ear already passed (`125_night_circle` -> 370.75 and `383_sixty_four`
> -> 1188.95). This list is what breaks that tie.
>
> **Everything you need is in this file.** One listening pass.

---

## 0. How to run this

**Time:** 5 boundaries x 7.00 s = **35 s of raw audio**; budget **~10 minutes** with
re-listens.

**This pass is NOT blinded, and that is deliberate.** You have already scored all five of
these EARLY — the verdict is not in question. What is being asked is *which of two or
three specific timestamps is right*, so withholding them would make the question
unanswerable rather than harder to game.

**The audio is the ORIGINAL 44.1 kHz source, not the 16 kHz replay capture.** That matters
here specifically: the events under discussion are breaths at -33 to -53 dBFS, and
Session R measured that 16 kHz decimation moves low-level amplitude enough to cross a
threshold. Use the command as given.

```bash
cd "/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio"
```

Per row, substitute `SS` (start) and `NAME`:

```bash
./src-tauri/binaries/ffmpeg-x86_64-apple-darwin -hide_banner -loglevel error -y \
  -ss SS -t 7.0 -i "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a" \
  /tmp/S-NAME.wav && afplay /tmp/S-NAME.wav
```

**Window sizing.** The widest candidate spread is **1.950 s** (row 5). The uniform 7.00 s
window is **3.59x** that, centred on each row's own candidate span, so every row's window
contains every candidate for that row plus the whole of the outgoing line and the start of
the recitation.

**The question for every row, identically.** The scene change is supposed to happen
*after the previous scene's line has finished and before the "Level N ..." recitation
begins*. Play the window and answer: **which listed timestamp is the right place for the
cut?** Answer **A**, **B**, **C**, or **"none — it should be at <your own timestamp>"**.
The last answer is the most useful one if none of the three is right.

**What A / B / C mean** (the same three everywhere, so you are comparing like with like):

- **A — SHIPPED TODAY.** The midpoint of the detected silence *clamped to end at Whisper's
  own reported onset of the recitation*. This is what the app commits right now and what
  you scored EARLY.
- **B — UNCLAMPED.** The midpoint of the *whole* detected silence. This is the single
  candidate that fixes all five rows in the right direction, and the only reason it did
  not ship is that it moves `383_sixty_four` by 0.100 s off the value you passed.
- **C — SILENCE END.** The last instant before the recitation's first real energy. Almost
  certainly too late on most rows; included because it is the hard upper bound, and if you
  ever say "C", the answer is not a midpoint rule at all.

---

## 1. The list — score this

### Row 1 — scene 42 (`042_eleven_years`)

| | |
|---|---|
| **Play from** | `-ss 122.22` (window 122.220 - 129.220) |
| **A — shipped** | **125.540** |
| **B — unclamped** | **125.760** |
| **C — silence end** | **125.900** |

- **Previous scene (41, `041_elder_lesson`):** "But you are old enough to start learning
  what it means." — its last word ends at **125.250**.
- **Unscripted recitation:** ".Level two. The boy who carries fire," — Whisper reports its
  onset at **125.540**; the first frame of real energy is at **125.900**.
- **Next scene (42):** "You are eleven."
- **Note, and it makes this row different from the other four:** no detected silence
  overlaps R.12's placement gap at all here, so the shipped value is a *fallback* that
  lands exactly on Whisper's onset. Measured: there is a **-40.8 dBFS breath at
  [125.540, 125.620]** — Whisper pinned the recitation's onset to the breath. A and the
  breath are the same instant.

### Row 2 — scene 176 (`176_twenty_six_scout`) — the row you annotated

| | |
|---|---|
| **Play from** | `-ss 519.11` (window 519.105 - 526.105) |
| **A — shipped** | **521.710** |
| **B — unclamped** | **522.460** |
| **C — silence end** | **523.500** |

- **Previous scene (175, `175_stepping_into_void`):** "Stop waiting for your mind to finish
  arguing." — last word ends at **521.250**.
- **Unscripted recitation:** ".Level 5. The hunter who fights at night." — Whisper onset
  **522.000**; first real energy **523.500**.
- **Next scene (176):** "You are twenty-six."
- **Your note — "cuts between breath and prev segment" — is CONFIRMED by measurement.**
  The breath is at **[521.880, 522.120]**, max **-52.8 dBFS**. It is *quiet enough that the
  silence detector merged it into silence*, so no rule downstream can see it. A (521.710)
  sits between the previous line and that breath, exactly as you said. **B (522.460) sits
  after the breath.** This row is the clearest test of whether the breath should go with
  the outgoing scene.

### Row 3 — scene 224 (`224_thirty_three`)

| | |
|---|---|
| **Play from** | `-ss 660.89` (window 660.893 - 667.893) |
| **A — shipped** | **663.785** |
| **B — unclamped** | **664.330** |
| **C — silence end** | **665.000** |

- **Previous scene (223, `223_carrying_weight`):** "You carry it." — last word ends at
  **663.630**.
- **Unscripted recitation:** ".Level 6. The one they follow," — Whisper onset **663.910**;
  first real energy **665.000**.
- **Next scene (224):** "You are thirty-three."
- **Note:** this row has **no breath at all** — the entire 1.34 s is floor (-56 to -91
  dBFS). Whisper's onset at 663.910 is pinned to nothing acoustic. If your answer here
  differs in character from row 2, that is the most informative single result in the pass.

### Row 4 — scene 307 (`307_forty_nine_years`)

| | |
|---|---|
| **Play from** | `-ss 922.04` (window 922.040 - 929.040) |
| **A — shipped** | **924.920** |
| **B — unclamped** | **925.430** |
| **C — silence end** | **926.160** |

- **Previous scene (306, `306_flint_knapping`):** "You carry it alongside everything else
  and you keep working." — last word ends at **924.500**.
- **Unscripted recitation:** ".Level 8. The one who teaches what cannot be taught easily."
  — Whisper onset **925.140**; first real energy **926.160**.
- **Next scene (307):** "You are forty-nine."
- **Note:** a loud **-32.0 dBFS breath at [924.580, 924.700]** sits *before* the silence
  starts, so the detector excluded it. **A already sits after that breath.** If A is still
  early here, the breath is not what is being mis-placed.

### Row 5 — scene 340 (`340_fifty_eight`) — the most extreme

| | |
|---|---|
| **Play from** | `-ss 1042.15` (window 1042.145 - 1049.145) |
| **A — shipped** | **1044.670** |
| **B — unclamped** | **1045.620** |
| **C — silence end** | **1046.620** |

- **Previous scene (339, `339_night_voyage`):** "The rest belongs to the nights they will
  face without you." — last word ends at **1044.470**.
- **Unscripted recitation:** ".Level 9. The one whose name the stories use." — Whisper
  onset **1044.720**; first real energy **1046.620**.
- **Next scene (340):** "You are fifty-eight."
- **Note:** the shipped value sits **50 ms** into a **2.00 s** silence — 2.5% of the way
  through it, the worst of the five. A **-36.9 dBFS breath at [1044.500, 1044.620]** sits
  just before it. 1.26 s of this gap is literal digital silence (all-zero samples).

---

## 2. One extra question, worth 30 seconds

The whole value change is blocked on a **0.100 s** disagreement at a boundary you already
passed. If B is right on the five rows above, it would move `383_sixty_four` from
**1188.950** (which you passed) to **1189.050**. Both sit inside 1.26 s of all-zero
samples, so they should be indistinguishable — but that is a prediction, not a
measurement.

```bash
./src-tauri/binaries/ffmpeg-x86_64-apple-darwin -hide_banner -loglevel error -y \
  -ss 1185.45 -t 7.0 -i "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a" \
  /tmp/S-383.wav && afplay /tmp/S-383.wav
```

**Question:** listening at **1188.950** versus **1189.050** — can you hear any difference at
all in where the scene changes? A "no" unblocks candidate B outright.

---

## 3. What each answer licenses

| Your answer | What ships |
|---|---|
| **B on all five**, and "no difference" on 383 | R.12 drops its clamp; the run's onset is taken from the silence's end rather than Whisper's timestamp. One change, no new constant. |
| **B on some, C on others** | The rule is not a midpoint rule. Needs a new measurement pass, not a value edit. |
| **"none — <your timestamp>"** on two or more rows | The candidate family is wrong. Report the timestamps; they become the new target set. |
| **A is fine after all** | The five demoted register rows close and the pins are restored. |

Nothing ships from this list without a second measurement pass confirming the chosen
candidate against all three corpora — this pass selects the target, it does not authorise
the edit.
