# WS1 Session K — Annotated Final Ear List

> **Drawn at the Session K working tree** (HEAD `55301be` + this session's changes),
> against the committed FA second-baseline fixtures and the production
> `computeUnscriptedRuns` / `alignScenestoTranscript` / detected-silence data.
> **28 rows.** Uniform **5.80 s** window on every row without exception, always
> centred on the stated boundary.
>
> **Everything you need is in this file.** No setup, no other document.

---

## 0. How to run this

**Time:** 28 boundaries x 5.80 s = **2.7 minutes of raw audio**; budget
**~25 minutes** with one re-listen per row.

**Prerequisite:** the replay WAVs at `.work-phase4/replay/{v6,173,spanish}/audio_16k.wav`.
They are gitignored; if absent this pass cannot run.

**The question for every row, identically:** *play the window, read the two
quoted lines and the two annotation lines, and answer — does the scene change
belong at the stated boundary?* Score **YES** or **NO**. If you cannot tell,
score **NO**.

**What is new in this list.** Every row now carries, without you having to infer
anything: both sides' text **as the app itself holds it** (read from the
committed fixture, which is what the timeline and the Sync Log display — clip 1's
failure was a labelling question, so labels are now part of what gets checked);
whether unscripted speech is present and exactly what it says; the owning rule;
**what the code expects** and **what to listen for**.

**Window sizing.** The largest boundary movement this session is **1.580 s**
(row on v6 `225_night_scouts`). The uniform window is 5.80 s, i.e. **3.67x the
largest delta** and comfortably over the required 2x, so every moved row's
window contains BOTH its old and its new value.

**Blinding.** Row order is `sha256(corpus|tag|boundary)` ascending — deterministic,
reproducible, independent of arm, corpus and magnitude. Arm is never indicated.
**Do not open the sealed key (Section 3) until all 28 rows are scored.**

**One thing you are entitled to know before scoring, because it cannot leak:**
the list deliberately contains boundaries that split a sentence mid-way with no
pause anywhere near them. You ruled that such rows STAY in the draw so that FA's
handling of them keeps being checked. They are annotated as such in the "what the
code expects" line, so they are scoreable rather than unanswerable.

---

## 1. The list — score this

### Row 1 — `v6` @ **256.74**

| | |
|---|---|
| **Window** | 253.84 – 259.64 (5.80 s) |
| **Play** | `ffplay -ss 253.84 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "You are sixteen and you carry your own spear." |
| **After the cut** | "Not the heavy thrusting spear of the senior hunters." |
| **Unscripted speech** | YES — "Level three the scout" spoken 251.56–253.11 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.13 — the atomic-utterance invariant (closing edge) |
| **What the code expects** | The scene that carries the recitation also speaks its own line AFTER it, so this boundary must sit AFTER "You are sixteen and you carry your own spear." has been said in full — R.13's earliest legal value here is 256.2s. |
| **What to listen for** | You should hear the recitation, then "You are sixteen and you carry your own spear.", and only THEN the cut. If the cut lands before that line finishes — or before it starts — it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [256.36, 257.12] |

**YES / NO: ______**

---

### Row 2 — `173` @ **225.37**

| | |
|---|---|
| **Window** | 222.47 – 228.27 (5.80 s) |
| **Play** | `ffplay -ss 222.47 -t 5.80 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| **Before the cut** | "Seventeen years." |
| **After the cut** | "That number starts making sense once you understand what" |
| **Unscripted speech** | NO |
| **Owning rule** | none — plain boundary |
| **What the code expects** | No rule owns this boundary. The pipeline places a plain scene change on the midpoint of the detected silence between the two lines. |
| **What to listen for** | One line finishes, a pause, the next begins — and the cut sits in that pause. |
| **Placement** | boundary is the midpoint of detected silence [225.18, 225.56] |

**YES / NO: ______**

---

### Row 3 — `v6` @ **794.19**

| | |
|---|---|
| **Window** | 791.29 – 797.09 (5.80 s) |
| **Play** | `ffplay -ss 791.29 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "You are forty-one." |
| **After the cut** | "There are children here who have never known a night where someone other than you was the person the adults looked to when something moved at the perimeter." |
| **Unscripted speech** | YES — "Level 7 The one the band depends on" spoken 789.26–791.69 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.13 — the atomic-utterance invariant (closing edge) |
| **What the code expects** | The scene that carries the recitation also speaks its own line AFTER it, so this boundary must sit AFTER "You are forty-one." has been said in full — R.13's earliest legal value here is 793.03s. |
| **What to listen for** | You should hear the recitation, then "You are forty-one.", and only THEN the cut. If the cut lands before that line finishes — or before it starts — it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [793.46, 794.92] |

**YES / NO: ______**

---

### Row 4 — `v6` @ **669.05**

| | |
|---|---|
| **Window** | 666.15 – 671.95 (5.80 s) |
| **Play** | `ffplay -ss 666.15 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "You are thirty-three." |
| **After the cut** | "You lead the night scouts now." |
| **Unscripted speech** | YES — "Level 6 The one they follow" spoken 663.91–666.48 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.13 — the atomic-utterance invariant (closing edge) |
| **What the code expects** | The scene that carries the recitation also speaks its own line AFTER it, so this boundary must sit AFTER "You are thirty-three." has been said in full — R.13's earliest legal value here is 667.73s. |
| **What to listen for** | You should hear the recitation, then "You are thirty-three.", and only THEN the cut. If the cut lands before that line finishes — or before it starts — it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [668.7, 669.4] |

**YES / NO: ______**

---

### Row 5 — `v6` @ **1082.99**

| | |
|---|---|
| **Window** | 1080.09 – 1085.89 (5.80 s) |
| **Play** | `ffplay -ss 1080.09 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "Not the way a man is known for a single event." |
| **After the cut** | "The way a specific ridge is known" |
| **Unscripted speech** | NO |
| **Owning rule** | none — plain boundary |
| **What the code expects** | No rule owns this boundary. The pipeline places a plain scene change on the midpoint of the detected silence between the two lines. |
| **What to listen for** | One line finishes, a pause, the next begins — and the cut sits in that pause. |
| **Placement** | boundary is the midpoint of detected silence [1082.44, 1083.54] |

**YES / NO: ______**

---

### Row 6 — `spanish` @ **48.67**

| | |
|---|---|
| **Window** | 45.77 – 51.57 (5.80 s) |
| **Play** | `ffplay -ss 45.77 -t 5.80 -autoexit .work-phase4/replay/spanish/audio_16k.wav` |
| **Before the cut** | "pero resultan inútiles." |
| **After the cut** | "Scylla se lleva a seis de sus hombres mientras el barco continúa su marcha." |
| **Unscripted speech** | NO |
| **Owning rule** | none — plain boundary |
| **What the code expects** | No rule owns this boundary. The pipeline places a plain scene change on the midpoint of the detected silence between the two lines. |
| **What to listen for** | One line finishes, a pause, the next begins — and the cut sits in that pause. |
| **Placement** | boundary is the midpoint of detected silence [48.48, 48.86] |

**YES / NO: ______**

---

### Row 7 — `v6` @ **130.96**

| | |
|---|---|
| **Window** | 128.06 – 133.86 (5.80 s) |
| **Play** | `ffplay -ss 128.06 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "You are eleven." |
| **After the cut** | "On nights when the band moves between camps" |
| **Unscripted speech** | YES — "Level two The boy who carries fire" spoken 125.54–129.01 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.13 — the atomic-utterance invariant (closing edge) |
| **What the code expects** | The scene that carries the recitation also speaks its own line AFTER it, so this boundary must sit AFTER "You are eleven." has been said in full — R.13's earliest legal value here is 130.14s. |
| **What to listen for** | You should hear the recitation, then "You are eleven.", and only THEN the cut. If the cut lands before that line finishes — or before it starts — it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [130.38, 131.54] |

**YES / NO: ______**

---

### Row 8 — `spanish` @ **6.05**

| | |
|---|---|
| **Window** | 3.15 – 8.95 (5.80 s) |
| **Play** | `ffplay -ss 3.15 -t 5.80 -autoexit .work-phase4/replay/spanish/audio_16k.wav` |
| **Before the cut** | "Scylla es un monstruo que vive dentro de un acantilado junto a un estrecho paso marítimo." |
| **After the cut** | "Tiene seis cuellos largos," |
| **Unscripted speech** | NO |
| **Owning rule** | none — plain boundary |
| **What the code expects** | No rule owns this boundary. The pipeline places a plain scene change on the midpoint of the detected silence between the two lines. |
| **What to listen for** | One line finishes, a pause, the next begins — and the cut sits in that pause. |
| **Placement** | boundary is the midpoint of detected silence [5.8, 6.3] |

**YES / NO: ______**

---

### Row 9 — `v6` @ **14.34**

| | |
|---|---|
| **Window** | 11.44 – 17.24 (5.80 s) |
| **Play** | `ffplay -ss 11.44 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "The fire your mother tends smells like pine resin and scorched bone." |
| **After the cut** | "Your grandmother is asleep against the far wall." |
| **Unscripted speech** | NO |
| **Owning rule** | none — plain boundary |
| **What the code expects** | No rule owns this boundary. The pipeline places a plain scene change on the midpoint of the detected silence between the two lines. |
| **What to listen for** | One line finishes, a pause, the next begins — and the cut sits in that pause. |
| **Placement** | boundary is the midpoint of detected silence [13.9, 14.78] |

**YES / NO: ______**

---

### Row 10 — `v6` @ **788.65**

| | |
|---|---|
| **Window** | 785.75 – 791.55 (5.80 s) |
| **Play** | `ffplay -ss 785.75 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "without announcement, without end." |
| **After the cut** | "You are forty-one." |
| **Unscripted speech** | YES — "Level 7 The one the band depends on" spoken 789.26–791.69 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.12 — the atomic-run invariant (opening edge) |
| **What the code expects** | R.12 puts the WHOLE recitation at the start of the next scene, so this boundary must sit in the pause BEFORE "Level 7 The…" begins — never inside it. |
| **What to listen for** | The previous line must finish, then a pause, then the recitation starts. If you hear the recitation already running when the cut happens, it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [788.04, 789.46] |

**YES / NO: ______**

---

### Row 11 — `v6` @ **5.64**

| | |
|---|---|
| **Window** | 2.74 – 8.54 (5.80 s) |
| **Play** | `ffplay -ss 2.74 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "You are seven years old." |
| **After the cut** | "You live inside a skin-covered shelter at the edge of a shallow valley." |
| **Unscripted speech** | YES — "Level one The child who does not yet know what dark means" spoken 0.08–3.4 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.13 — the atomic-utterance invariant (closing edge) |
| **What the code expects** | The scene that carries the recitation also speaks its own line AFTER it, so this boundary must sit AFTER "You are seven years old." has been said in full — R.13's earliest legal value here is 5.05s. |
| **What to listen for** | You should hear the recitation, then "You are seven years old.", and only THEN the cut. If the cut lands before that line finishes — or before it starts — it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [5.32, 5.96] |

**YES / NO: ______**

---

### Row 12 — `v6` @ **528.09**

| | |
|---|---|
| **Window** | 525.19 – 530.99 (5.80 s) |
| **Play** | `ffplay -ss 525.19 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "You are twenty-six." |
| **After the cut** | "Fear no longer leads when you move in darkness." |
| **Unscripted speech** | YES — "Level 5 The hunter who fights at night" spoken 522–525.63 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.13 — the atomic-utterance invariant (closing edge) |
| **What the code expects** | The scene that carries the recitation also speaks its own line AFTER it, so this boundary must sit AFTER "You are twenty-six." has been said in full — R.13's earliest legal value here is 527.11s. |
| **What to listen for** | You should hear the recitation, then "You are twenty-six.", and only THEN the cut. If the cut lands before that line finishes — or before it starts — it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [527.46, 528.72] |

**YES / NO: ______**

---

### Row 13 — `173` @ **9.14**

| | |
|---|---|
| **Window** | 6.24 – 12.04 (5.80 s) |
| **Play** | `ffplay -ss 6.24 -t 5.80 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| **Before the cut** | "They take apart the conditions under which a soldier can function in the first place." |
| **After the cut** | "Training, equipment, formation, doctrine, gone before the first contact report." |
| **Unscripted speech** | NO |
| **Owning rule** | none — plain boundary |
| **What the code expects** | No rule owns this boundary. The pipeline places a plain scene change on the midpoint of the detected silence between the two lines. |
| **What to listen for** | One line finishes, a pause, the next begins — and the cut sits in that pause. |
| **Placement** | boundary is the midpoint of detected silence [8.92, 9.36] |

**YES / NO: ______**

---

### Row 14 — `v6` @ **924.92**

| | |
|---|---|
| **Window** | 922.02 – 927.82 (5.80 s) |
| **Play** | `ffplay -ss 922.02 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "You carry it alongside everything else and you keep working." |
| **After the cut** | "You are forty-nine." |
| **Unscripted speech** | YES — "Level 8 The one who teaches what cannot be taught easily" spoken 925.14–928.93 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.12 — the atomic-run invariant (opening edge) |
| **What the code expects** | R.12 puts the WHOLE recitation at the start of the next scene, so this boundary must sit in the pause BEFORE "Level 8 The…" begins — never inside it. |
| **What to listen for** | The previous line must finish, then a pause, then the recitation starts. If you hear the recitation already running when the cut happens, it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [924.7, 926.16] |

**YES / NO: ______**

---

### Row 15 — `v6` @ **1193.77**

| | |
|---|---|
| **Window** | 1190.87 – 1196.67 (5.80 s) |
| **Play** | `ffplay -ss 1190.87 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "You are sixty-four." |
| **After the cut** | "The night runs belong to someone else now." |
| **Unscripted speech** | YES — "Level 10 The one the fire remembers" spoken 1189.76–1192.17 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.13 — the atomic-utterance invariant (closing edge) |
| **What the code expects** | The scene that carries the recitation also speaks its own line AFTER it, so this boundary must sit AFTER "You are sixty-four." has been said in full — R.13's earliest legal value here is 1193.22s. |
| **What to listen for** | You should hear the recitation, then "You are sixty-four.", and only THEN the cut. If the cut lands before that line finishes — or before it starts — it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [1193.38, 1194.16] |

**YES / NO: ______**

---

### Row 16 — `v6` @ **521.71**

| | |
|---|---|
| **Window** | 518.81 – 524.61 (5.80 s) |
| **Play** | `ffplay -ss 518.81 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "Stop waiting for your mind to finish arguing." |
| **After the cut** | "You are twenty-six." |
| **Unscripted speech** | YES — "Level 5 The hunter who fights at night" spoken 522–525.63 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.12 — the atomic-run invariant (opening edge) |
| **What the code expects** | R.12 puts the WHOLE recitation at the start of the next scene, so this boundary must sit in the pause BEFORE "Level 5 The…" begins — never inside it. |
| **What to listen for** | The previous line must finish, then a pause, then the recitation starts. If you hear the recitation already running when the cut happens, it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [521.42, 523.5] |

**YES / NO: ______**

---

### Row 17 — `v6` @ **931.4**

| | |
|---|---|
| **Window** | 928.5 – 934.3 (5.80 s) |
| **Play** | `ffplay -ss 928.50 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "You are forty-nine." |
| **After the cut** | "Three of your old scouts lead their own groups now in different parts of the territory." |
| **Unscripted speech** | YES — "Level 8 The one who teaches what cannot be taught easily" spoken 925.14–928.93 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.13 — the atomic-utterance invariant (closing edge) |
| **What the code expects** | The scene that carries the recitation also speaks its own line AFTER it, so this boundary must sit AFTER "You are forty-nine." has been said in full — R.13's earliest legal value here is 930.31s. |
| **What to listen for** | You should hear the recitation, then "You are forty-nine.", and only THEN the cut. If the cut lands before that line finishes — or before it starts — it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [930.7, 932.1] |

**YES / NO: ______**

---

### Row 18 — `v6` @ **1188.95**

| | |
|---|---|
| **Window** | 1186.05 – 1191.85 (5.80 s) |
| **Play** | `ffplay -ss 1186.05 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "All you can do is be honest and let them take what they are able to carry right now." |
| **After the cut** | "You are sixty-four." |
| **Unscripted speech** | YES — "Level 10 The one the fire remembers" spoken 1189.76–1192.17 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.12 — the atomic-run invariant (opening edge) |
| **What the code expects** | R.12 puts the WHOLE recitation at the start of the next scene, so this boundary must sit in the pause BEFORE "Level 10 The…" begins — never inside it. |
| **What to listen for** | The previous line must finish, then a pause, then the recitation starts. If you hear the recitation already running when the cut happens, it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [1188.14, 1189.96] |

**YES / NO: ______**

---

### Row 19 — `v6` @ **663.785**

| | |
|---|---|
| **Window** | 660.88 – 666.68 (5.80 s) |
| **Play** | `ffplay -ss 660.88 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "You carry it." |
| **After the cut** | "You are thirty-three." |
| **Unscripted speech** | YES — "Level 6 The one they follow" spoken 663.91–666.48 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.12 — the atomic-run invariant (opening edge) |
| **What the code expects** | R.12 puts the WHOLE recitation at the start of the next scene, so this boundary must sit in the pause BEFORE "Level 6 The…" begins — never inside it. |
| **What to listen for** | The previous line must finish, then a pause, then the recitation starts. If you hear the recitation already running when the cut happens, it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [663.66, 665] |

**YES / NO: ______**

---

### Row 20 — `v6` @ **250.69**

| | |
|---|---|
| **Window** | 247.79 – 253.59 (5.80 s) |
| **Play** | `ffplay -ss 247.79 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "Your body made that choice without asking." |
| **After the cut** | "You are sixteen and you carry your own spear." |
| **Unscripted speech** | YES — "Level three the scout" spoken 251.56–253.11 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.12 — the atomic-run invariant (opening edge) |
| **What the code expects** | R.12 puts the WHOLE recitation at the start of the next scene, so this boundary must sit in the pause BEFORE "Level three the…" begins — never inside it. |
| **What to listen for** | The previous line must finish, then a pause, then the recitation starts. If you hear the recitation already running when the cut happens, it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [249.82, 251.8] |

**YES / NO: ______**

---

### Row 21 — `v6` @ **694.95**

| | |
|---|---|
| **Window** | 692.05 – 697.85 (5.80 s) |
| **Play** | `ffplay -ss 692.05 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "You did not ask for this." |
| **After the cut** | "You are not sure when it started." |
| **Unscripted speech** | NO |
| **Owning rule** | none — plain boundary |
| **What the code expects** | No rule owns this boundary. The pipeline places a plain scene change on the midpoint of the detected silence between the two lines. |
| **What to listen for** | One line finishes, a pause, the next begins — and the cut sits in that pause. |
| **Placement** | boundary is the midpoint of detected silence [694.78, 695.12] |

**YES / NO: ______**

---

### Row 22 — `v6` @ **370.75**

| | |
|---|---|
| **Window** | 367.85 – 373.65 (5.80 s) |
| **Play** | `ffplay -ss 367.85 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "You start working on the hands." |
| **After the cut** | "You are twenty and you have your first real position in the night circle." |
| **Unscripted speech** | YES — "Level four the night guard" spoken 371.54–373.27 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.12 — the atomic-run invariant (opening edge) |
| **What the code expects** | R.12 puts the WHOLE recitation at the start of the next scene, so this boundary must sit in the pause BEFORE "Level four the…" begins — never inside it. |
| **What to listen for** | The previous line must finish, then a pause, then the recitation starts. If you hear the recitation already running when the cut happens, it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [370.14, 371.36] |

**YES / NO: ______**

---

### Row 23 — `v6` @ **125.54**

| | |
|---|---|
| **Window** | 122.64 – 128.44 (5.80 s) |
| **Play** | `ffplay -ss 122.64 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "But you are old enough to start learning what it means." |
| **After the cut** | "You are eleven." |
| **Unscripted speech** | YES — "Level two The boy who carries fire" spoken 125.54–129.01 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.12 — the atomic-run invariant (opening edge) |
| **What the code expects** | R.12 puts the WHOLE recitation at the start of the next scene, so this boundary must sit in the pause BEFORE "Level two The…" begins — never inside it. |
| **What to listen for** | The previous line must finish, then a pause, then the recitation starts. If you hear the recitation already running when the cut happens, it is wrong. |
| **Placement** | boundary is not on a detected silence (fallback placement) |

**YES / NO: ______**

---

### Row 24 — `173` @ **454.75**

| | |
|---|---|
| **Window** | 451.85 – 457.65 (5.80 s) |
| **Play** | `ffplay -ss 451.85 -t 5.80 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| **Before the cut** | "During the 13th Black Crusade," |
| **After the cut** | "corruption radiating from Abaddon’s fleet destabilized atmospheric conditions across entire operating zones." |
| **Unscripted speech** | NO |
| **Owning rule** | none — plain boundary |
| **What the code expects** | No rule owns this boundary. The pipeline places a plain scene change on the midpoint of the detected silence between the two lines. |
| **What to listen for** | One line finishes, a pause, the next begins — and the cut sits in that pause. |
| **Placement** | boundary is the midpoint of detected silence [454.52, 454.98] |

**YES / NO: ______**

---

### Row 25 — `v6` @ **334.24**

| | |
|---|---|
| **Window** | 331.34 – 337.14 (5.80 s) |
| **Play** | `ffplay -ss 331.34 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "The print is wider than both your hands laid side by side." |
| **After the cut** | "You look at it for a long time." |
| **Unscripted speech** | NO |
| **Owning rule** | none — plain boundary |
| **What the code expects** | No rule owns this boundary. The pipeline places a plain scene change on the midpoint of the detected silence between the two lines. |
| **What to listen for** | One line finishes, a pause, the next begins — and the cut sits in that pause. |
| **Placement** | boundary is the midpoint of detected silence [333.92, 334.56] |

**YES / NO: ______**

---

### Row 26 — `v6` @ **1044.67**

| | |
|---|---|
| **Window** | 1041.77 – 1047.57 (5.80 s) |
| **Play** | `ffplay -ss 1041.77 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "The rest belongs to the nights they will face without you." |
| **After the cut** | "You are fifty-eight." |
| **Unscripted speech** | YES — "Level 9 The one whose name the stories use" spoken 1044.72–1050 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.12 — the atomic-run invariant (opening edge) |
| **What the code expects** | R.12 puts the WHOLE recitation at the start of the next scene, so this boundary must sit in the pause BEFORE "Level 9 The…" begins — never inside it. |
| **What to listen for** | The previous line must finish, then a pause, then the recitation starts. If you hear the recitation already running when the cut happens, it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [1044.62, 1046.62] |

**YES / NO: ______**

---

### Row 27 — `v6` @ **1051.65**

| | |
|---|---|
| **Window** | 1048.75 – 1054.55 (5.80 s) |
| **Play** | `ffplay -ss 1048.75 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "You are fifty-eight." |
| **After the cut** | "Your hair has gone pale at the edges." |
| **Unscripted speech** | YES — "Level 9 The one whose name the stories use" spoken 1044.72–1050 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.13 — the atomic-utterance invariant (closing edge) |
| **What the code expects** | The scene that carries the recitation also speaks its own line AFTER it, so this boundary must sit AFTER "You are fifty-eight." has been said in full — R.13's earliest legal value here is 1051.02s. |
| **What to listen for** | You should hear the recitation, then "You are fifty-eight.", and only THEN the cut. If the cut lands before that line finishes — or before it starts — it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [1051.2, 1052.1] |

**YES / NO: ______**

---

### Row 28 — `v6` @ **378.9**

| | |
|---|---|
| **Window** | 376 – 381.8 (5.80 s) |
| **Play** | `ffplay -ss 376.00 -t 5.80 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| **Before the cut** | "You are twenty and you have your first real position in the night circle." |
| **After the cut** | "The eastern post" |
| **Unscripted speech** | YES — "Level four the night guard" spoken 371.54–373.27 (Whisper timing; the ear runs ~0.8–1.1s later on some rows) |
| **Owning rule** | R.13 — the atomic-utterance invariant (closing edge) |
| **What the code expects** | The scene that carries the recitation also speaks its own line AFTER it, so this boundary must sit AFTER "You are twenty and you have your first real position in the night circle." has been said in full — R.13's earliest legal value here is 377.99s. |
| **What to listen for** | You should hear the recitation, then "You are twenty and you have your first real position in the night circle.", and only THEN the cut. If the cut lands before that line finishes — or before it starts — it is wrong. |
| **Placement** | boundary is the midpoint of detected silence [378.28, 379.52] |

**YES / NO: ______**

---
## 2. Scoring template — bare, for copying back

```
1:    8:    15:   22:
2:    9:    16:   23:
3:    10:   17:   24:
4:    11:   18:   25:
5:    12:   19:   26:
6:    13:   20:   27:
7:    14:   21:   28:

Score: ___ / 28
```

**The bar: 28/28.** Any NO reopens the question it belongs to rather than being
averaged away.

**Listening estimate: ~25 minutes.** 2.7 minutes of audio, plus reading two
annotation lines per row and one re-listen where the pause is short.

---

## 3. SEALED KEY — do not read until Section 1 is fully scored

<details>
<summary>Expand only after scoring all 28 rows.</summary>

| # | corpus | segment | value | arm | why this row is here |
|---|---|---|---|---|---|
| 1 | v6 | `086_spear_contrast` | 256.74 | RECITATION — closing edge | R.13 closing edge, measured already legal and unmoved. These nine had NEVER been on any ear list before this one. |
| 2 | 173 | `logic_comprehension_view` | 225.37 | CONTROL | unmoved control — no rule has ever touched this boundary. |
| 3 | v6 | `267_leader_of_children` | 794.19 | RECITATION — closing edge | R.13 closing edge, measured already legal and unmoved. These nine had NEVER been on any ear list before this one. |
| 4 | v6 | `225_night_scouts` | 669.05 | **MOVED THIS SESSION** | the ONE boundary R.13 moved (667.47 -> 669.05, +1.580s). This is the only row whose answer is not already expected to be YES. |
| 5 | v6 | `350_mountain_ridge` | 1082.99 | CONTROL | unmoved control — no rule has ever touched this boundary. |
| 6 | spanish | `018_scylla_attacks` | 48.67 | CONTROL | unmoved control — no rule has ever touched this boundary. |
| 7 | v6 | `043_night_migration` | 130.96 | RECITATION — closing edge | R.13 closing edge, measured already legal and unmoved. These nine had NEVER been on any ear list before this one. |
| 8 | spanish | `003_scylla_six_necks` | 6.05 | CONTROL | unmoved control — no rule has ever touched this boundary. |
| 9 | v6 | `004_grandmother_asleep` | 14.34 | CONTROL | unmoved control — no rule has ever touched this boundary. |
| 10 | v6 | `266_forty_one_burden` | 788.65 | RECITATION — opening edge | R.12 opening edge, unmoved this session — 5 ear-verified in Session H, 4 ear-verified in the Session I/J mover audit. Effectively a control. |
| 11 | v6 | `002_skin_shelter` | 5.64 | RECITATION — closing edge | R.13 closing edge, measured already legal and unmoved. These nine had NEVER been on any ear list before this one. |
| 12 | v6 | `177_leading_in_darkness` | 528.09 | RECITATION — closing edge | R.13 closing edge, measured already legal and unmoved. These nine had NEVER been on any ear list before this one. |
| 13 | 173 | `military_collapse` | 9.14 | CONTROL | unmoved control — no rule has ever touched this boundary. |
| 14 | v6 | `307_forty_nine_years` | 924.92 | RECITATION — opening edge | R.12 opening edge, unmoved this session — 5 ear-verified in Session H, 4 ear-verified in the Session I/J mover audit. Effectively a control. |
| 15 | v6 | `384_night_scouts` | 1193.77 | RECITATION — closing edge | R.13 closing edge, measured already legal and unmoved. These nine had NEVER been on any ear list before this one. |
| 16 | v6 | `176_twenty_six_scout` | 521.71 | RECITATION — opening edge | R.12 opening edge, unmoved this session — 5 ear-verified in Session H, 4 ear-verified in the Session I/J mover audit. Effectively a control. |
| 17 | v6 | `308_scouts_leading` | 931.4 | RECITATION — closing edge | R.13 closing edge, measured already legal and unmoved. These nine had NEVER been on any ear list before this one. |
| 18 | v6 | `383_sixty_four` | 1188.95 | RECITATION — opening edge | R.12 opening edge, unmoved this session — 5 ear-verified in Session H, 4 ear-verified in the Session I/J mover audit. Effectively a control. |
| 19 | v6 | `224_thirty_three` | 663.785 | RECITATION — opening edge | R.12 opening edge, unmoved this session — 5 ear-verified in Session H, 4 ear-verified in the Session I/J mover audit. Effectively a control. |
| 20 | v6 | `085_the_spear_bearer` | 250.69 | RECITATION — opening edge | R.12 opening edge, unmoved this session — 5 ear-verified in Session H, 4 ear-verified in the Session I/J mover audit. Effectively a control. |
| 21 | v6 | `236_uncertain_start` | 694.95 | CONTROL | unmoved control — no rule has ever touched this boundary. |
| 22 | v6 | `125_night_circle` | 370.75 | RECITATION — opening edge | R.12 opening edge, unmoved this session — 5 ear-verified in Session H, 4 ear-verified in the Session I/J mover audit. Effectively a control. |
| 23 | v6 | `042_eleven_years` | 125.54 | RECITATION — opening edge | R.12 opening edge, unmoved this session — 5 ear-verified in Session H, 4 ear-verified in the Session I/J mover audit. Effectively a control. |
| 24 | 173 | `malignant_swirl_weather` | 454.75 | CONTROL | unmoved control — no rule has ever touched this boundary. |
| 25 | v6 | `110_long_stare` | 334.24 | CONTROL | unmoved control — no rule has ever touched this boundary. |
| 26 | v6 | `340_fifty_eight` | 1044.67 | RECITATION — opening edge | R.12 opening edge, unmoved this session — 5 ear-verified in Session H, 4 ear-verified in the Session I/J mover audit. Effectively a control. |
| 27 | v6 | `341_aging_temples` | 1051.65 | RECITATION — closing edge | R.13 closing edge, measured already legal and unmoved. These nine had NEVER been on any ear list before this one. |
| 28 | v6 | `126_eastern_post` | 378.9 | RECITATION — closing edge | R.13 closing edge, measured already legal and unmoved. These nine had NEVER been on any ear list before this one. |

### Arm composition

| arm | rows |
|---|---|
| **MOVED this session** | **1** |
| Recitation opening edges (R.12) | 9 |
| Recitation closing edges (R.13) | 9 |
| Blinded unmoved controls | 9 |
| **Total** | **28** |

**All ten v6 recitations are covered on both edges.** The count is 9 + 9 + 1 = 19
rather than 20 because recitation 0's carrier is `001_child_seven` at committed
index 0, whose start is forced to 0.00 by `headExtendFirstSegment` and is
therefore not a boundary at all. That is a structural absence, not an omission.

### Rows affected by the 173 index defect: NONE

The index-convention defect fixed this session is in the **display path only** —
`syncLog.ts` labelled R.11's corrections with a parse index while R.12's used a
committed one, so on 173 the Sync Log named `abysmal_opinion` "scene 6" for a
scene the timeline shows as scene 5. **No committed boundary moved**, because
both `applySeamFitCorrections` and `applyRunPlacementCorrections` match by
segment id, never by index. There is therefore nothing to listen to. The three
173 control rows above are ordinary controls, not index-defect rows.

</details>
