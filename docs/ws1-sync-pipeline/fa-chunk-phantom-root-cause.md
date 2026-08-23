# Root-Cause Investigation — FA "Phantom Text" and the Word-Shift Defect Class

> Follow-up to WS1 Session AE, 2026-08-23. Prompted by the operator's own waveform
> measurement of the `230_slowing_pace` / `231_slowing_pace` seam, which contradicted
> every timestamp the pipeline had for it. Read with `sync-pipeline-v2-plan.md` Part Z.
>
> **Status: a mechanism is identified and evidenced on 13 of 15 known defects. It is NOT
> proven causal.** The proving experiment is named in §6 and has not been run.

---

## 1. The measurement that started it

The operator measured the actual speech in the app's waveform:

| segment | script | measured speech |
|---|---|---|
| `230_slowing_pace` | "But when you slow" | **681.47 → 682.43** |
| `231_slowing_pace` | "they slow." | **683.04 → 683.84** |

The independent silence detector agrees to within 30 ms — its speech bursts in that window
are `[681.50, 682.42]` and `[683.06, 683.74]`. Two arms, derived from different code,
same answer.

What the pipeline had:

| | segment 230 | segment 231 |
|---|---|---|
| measured truth | 681.47 → 682.43 | 683.04 → 683.84 |
| FA's placement | 680.68 → 681.62 | **681.64 → 682.34** |
| error | ~0.8 s early | **~1.4 s early — a whole utterance** |

FA placed segment 231's words on segment 230's audio. Not a smear — a **one-utterance shift**.

---

## 2. The mechanism

FA does not align the whole recording at once. `computeFaChunkPlan` cuts the audio into
chunks at silences and hands each chunk the slice of script it believes belongs in that
window. At this seam:

```
chunk [676.00 → 681.50]   "…There is no formal sense here.  But when you"
chunk [681.50 → 684.44]   "slow they slow. When you stop,"
```

The **cut at 681.50 is correct** — it is the real onset of the burst. The **text cut is
not**: the phrase "But when you slow" was split, and its first three words were filed into
the chunk that *ends* at 681.50. Those words are not spoken anywhere in that window; the
whole phrase is spoken at 681.47–682.43, on the other side of the cut.

A forced aligner must return a time for every word it is given — it has no way to answer
"not present in this audio". So it placed "But when you" in that chunk's trailing silence
and marked the result with the only signal it has:

```
'but'   [680.68, 680.88]  confidence 5.03e-8
'when'  [680.94, 681.02]  confidence 2.96e-7
'you'   [681.06, 681.48]  confidence 4.04e-8
```

Call these **phantom tokens**: script text with a timestamp and no audio behind it.

The next chunk then received the text `"slow they slow. When you stop,"` while its audio
actually carries *"But when you slow / they slow"*. It found one real "slow" at
`[682.04, 682.34]` (confidence **1.000** — the end of segment 230's line, matching the
operator's 682.43) and, having two "slow"s in its text, assigned that real one to the
**second** occurrence, i.e. segment 231. Everything downstream is one phrase early.

**Why the text was cut in the wrong place.** Words are filed to chunks by Whisper's
timestamps, and Whisper runs early here — `But`@681.08, `when`@681.16, `you`@681.20, all
just before the 681.50 edge, against a measured onset of 681.47. Exactly the three words
Whisper placed early fell on the wrong side of an otherwise-correct cut.

### Why 100% word match did not catch it

The Hirschberg pass reported `4/4` and `2/2` matched, full contiguous runs, direct global
match, no rescue, zero filter drops. **Coverage is a claim about text, not about time.** It
verifies every script word found *a* token; it never asks whether that token is at the right
moment. Timing correctness lives entirely in the confidence number — which is precisely what
collapsed to 1e-8. Any check built on match counts is structurally blind to this defect.

---

## 3. How far the mechanism reaches

### v6 — all ten rows

Every one of the ten Class A/B rows has a chunk whose text ends **mid-sentence**, the
trailing words being the incoming segment's own opening line:

| row | chunk text ends… |
|---|---|
| `008_unknown_void` | "…something outside. **You do**" |
| `056_dropping_torch` | "…same as the spear. **You drop the**" |
| `152_frozen_brush_mice` | "…the absence of one. **When the brush mice stop**" |
| `167_smell_of_butchery` | "…testing the perimeter **drawn by**" |
| `214_solitary_fire` | "…or why. **You only know you**" |
| `231_slowing_pace` | "…formal sense here. **But when you**" |
| `286_fact_to_act` | "…It is not. **It is a**" |
| `400_endless_dark` | "…his whole body. **You tell**" |
| `403_vigilant_embers` | "…as it always has **and it**" |
| `447_scout_facing_dark` | "…does not change. **Only the ones who**" |

### 173 — three of five, and two are something else

| seam | chunk evidence | verdict |
|---|---|---|
| **5-6** `lethal_nature_hazard` | chunk `[18.08, 18.70]` holds "They're the worst" (3 words) but only 0.24 s of speech; phantoms at 2.4e-6 / 7.6e-7 | **same mechanism** |
| **21-22** `iron_bounce` | segment 21's own last words "thick enough" land in the *next* chunk at confidence **0.963 / 1.000** — FA's timing is CORRECT. The boundary snapped to silence `[75.50, 75.82]`, a real silence that is mid-sentence, because no silence exists at the true seam | **different — wrong-silence selection** |
| **42-43** `wall_split_path` | chunk `[159.18, 161.46]` text ends "…pull in"; both words phantom (9.9e-7 / 3.9e-7) inside silence `[161.20, 161.46]`; "competing" at 1.000 in the next chunk | **same mechanism** |
| **104-105** `logic_clash` | chunk `[411.78, 417.30]` text ends "…where the laws"; all three phantom (3.3e-6 / 1.7e-6 / 3.1e-6) inside silence `[417.00, 417.30]`; "governing" at 0.999 next chunk | **same mechanism** |
| **106-107** `gadget_decay` | both segments inside one chunk `[417.30, 433.52]`; no chunk edge and no detected silence within seconds | **different — neither chunking nor silence involved** |

**Coverage: 13 of 15 known defects. There are at least three distinct root causes, not one.**

---

## 4. The falsification test — and why we are not at 100%

A mechanism only explains a defect class if it is *absent* from correct boundaries. Census
of every chunk whose last word is both sub-reliability and wholly inside a detected silence:

| corpus | chunks with a phantom tail |
|---|---|
| v6 | **183 of 277 (66.1%)** |
| 173 | **49 of 126 (38.9%)** |
| spanish | **3 of 5 (60.0%)** |

Two thirds of v6's chunks carry phantom text, and only ~11 boundaries are defective. **The
phantom is necessary but nowhere near sufficient.** Most phantoms are harmless because they
fall mid-segment, where no boundary is being placed.

The defect requires a coincidence of three things:

1. a chunk edge splits a phrase, leaving text with no audio → phantom tokens *(pervasive)*;
2. that split lands **at a segment seam**, so the incoming segment's *first* claimed word is
   itself the phantom *(rare)*;
3. `snapCoveredBoundaries` then snaps the seam into the collapsed ~20 ms gap between the
   outgoing segment's last real word and the phantom → an early cut.

R.14's firing condition is, in effect, a detector for (2)+(3).

### Answering the two questions directly

> **Are we 100% confident this is the real root cause?**

**No, and it would be wrong to say so.** What is established: the phantom mechanism is
present and measurable on 13 of 15 defects, and it explains every symptom previously measured
in isolation (near-zero incoming anchors, the collapsed word gap, the correction always being
the next speech onset, and every defect being an *early* cut — a phantom can only land before
real audio). What is **not** established: that removing it removes the defects. That requires
re-running FA against a corrected chunk plan and re-measuring, which has not been done (§6).

> **Does it apply to all projects regardless of pacing?**

The mechanism is pacing-independent in principle — it is a text-to-window assignment error
across a silence, not a rate phenomenon, and it appears in all three corpora. But two
qualifications are load-bearing: the phantom *rate* varies widely by corpus (66% / 39% / 60%),
and **it is not the only defect mechanism** — `iron_bounce` and `gadget_decay` have different
causes and would survive a perfect chunk-plan fix untouched.

---

## 5. Proposed solutions

### S1 — Fold trailing no-audio text forward (primary fix)

`faChunkPlan.ts` **already does this for the total case**: a run with text but a
zero-duration window has its text merged forward into the run that actually contains the
audio, with the comment "Sending Rust text with an empty window is a guaranteed
CTC-infeasibility." The defect is the **partial** case — a window with *some* audio
(segment 229's speech) whose *trailing* text has none.

Extend the existing fold: when a chunk's trailing script words have no remaining audio in
that window (the window's tail is silence), fold those words forward into the next chunk.
This reuses a shipped, tested mechanism rather than inventing one, and it needs no threshold —
"the tail of this window is a detected silence" is an existence test.

*Risk:* changes chunk text for a large fraction of chunks; must be measured, not assumed.

### S2 — Never let a chunk edge split a script sentence

Prefer chunk edges that coincide with sentence or segment ends. Where a silence-derived edge
would fall mid-phrase, move the *text* boundary to the nearest script boundary while keeping
the audio edge at the silence. Complementary to S1 and probably the more durable of the two.

### S3 — Stop filing words across an edge by Whisper timestamps

The proximate trigger was Whisper's ~0.4 s early bias deciding which side of 681.50 three
words belonged on. Whisper's word timestamps are a contiguous partition, not measurements;
using them for a side-of-edge decision is exactly the "timestamps must never decide identity"
failure CLAUDE.md already names. Attribution should be by script index against the *audio*
evidence, not by a coarse ASR clock.

### S4 — Surface phantom text as a first-class signal

FA already tells us, at 1e-8 confidence, that it could not find a word. Nothing consumes
that. A `text-with-no-audio` finding emitted from the chunk stage would make this class
visible in the sync log instead of only inferable from committed timestamps.

### S5 — Separately: the other two mechanisms

`iron_bounce` (wrong-silence selection when no silence exists at the true seam) and
`gadget_decay` (no chunk edge, no silence) need their own answers. Neither is addressed by
S1–S3, and no rule is designed for either.

---

## 6. The experiment that would settle causality

Re-run FA on v6 and 173 with an S1/S2-corrected chunk plan and re-measure:

1. Does the phantom-tail rate drop from 66% / 39%?
2. Do the 13 rows' incoming anchors move to the correct burst?
3. **Does R.14's firing count collapse toward zero?** That is the decisive number.
4. Do the 37 ear-verified controls stay correct?

This is runnable here: `.work-phase4/spike-runtime/` holds `wav2vec2-en.onnx` and an
onnxruntime venv, and `scripts/capture-fa-onnx-reference.py` is the existing harness.
`ORT_DYLIB_PATH` is currently unset, so the in-app FA path would need provisioning first.

---

## 7. Should R.14 be removed?

**Not yet — but it should be reclassified as provisional, and it must not be left
unexamined once the chunk plan is fixed.**

**Why not now.** R.14 stands on its own evidence: zero false positives against all 37
ear-verified controls in three corpora, 10/10 precision on ear-scored rows, three GEOMETRIC
constants none of which is fitted to the rows it fires on, sensitivity flat at ±10%, and a
mutation matrix red on all eight mutations. Removing it today reopens eight register rows and
puts nothing in their place — strictly worse for the user, and it would re-block Stage 1 on
item-7, which R.14 is the only thing that has ever reached.

**Why it is nonetheless a patch.** It repairs a symptom. The boundary is wrong *because the
timestamps feeding it are wrong*, and R.14 does not fix the timestamps — it detects that they
are untrustworthy and substitutes an acoustic landmark. Everything downstream of FA
(waveform display, per-word inspection, any future word-level feature) still sees the phantom
timing.

**The real hazard of keeping it, stated plainly.** If S1/S2 land and R.14 stays unchanged,
R.14 could **double-correct** — moving a boundary FA now places correctly. Its firing
condition would no longer be met in the normal case, but that is a prediction, not a
guarantee, and it must be measured rather than assumed.

**Recommended sequencing:**

1. Ship S1/S2 behind measurement, not behind a flag.
2. Re-run the experiment in §6.
3. **If R.14's firing count goes to zero with all eight rows still correct — delete R.14.**
   It will have served its purpose and its continued presence would be pure risk.
4. **If it still fires on a residual set** — those are genuine cases the chunk fix does not
   reach, and R.14 stays, scoped to them, with its header rewritten to say so.
5. Either way, `iron_bounce` and `gadget_decay` remain open and need S5.

The honest summary is that R.14 bought correct output and a diagnosis. It should be spent, not
kept.
