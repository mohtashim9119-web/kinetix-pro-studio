# Boundary-Drift Investigation — 2026-08-02 to 2026-08-03

> Persists findings from a two-day investigation into segment-boundary
> placement quality that otherwise only existed in chat transcripts. Per the
> project's own working rule, audit findings must be persisted to `docs/` —
> this file is that persistence. Read this before re-investigating anything
> in the sync boundary-placement pipeline.
>
> **The word-shift defect this document documents is addressed by
> `docs/sync-pipeline-v2-plan.md` Phases 3+5.** This document's own
> DO NOT RE-INVESTIGATE list and dead-hypothesis measurements remain
> authoritative and must be read before any related work.

## Summary

Two separate defects were investigated:

1. **Breath-vs-boundary misclassification** (`isBreathSilence`'s
   multi-fragment override) — root-caused, fixed, and **ear-verified** on a
   real 447-segment production project (86.8% → 96.2% correct cuts). See
   `snapBoundaries.ts`'s own doc comments and `docs/history.md`'s
   implementation record for the shipped fix.
2. **Word-shift defect** (a segment's cut point lands one or more words off
   from where it should) — root-caused to the *picker*, not the aligner, but
   **not yet fixed**. Two candidate fixes were tried and both failed. This
   remains open — see "The open word-shift defect" below.

This document also records every dead end pursued along the way, so they are
not re-investigated.

---

## Dead hypotheses (why each died)

### 1. JSON vs. stdout parsing

Hypothesis: whisper-cli's two output modes (structured JSON vs. parsed
stdout) might disagree on token timestamps, and the wrong one might be in
use.

**Result: dead.** Measured **0.0ms median delta** across 3,578 words between
the two parsing paths. They are identical in practice. Not the cause of
anything.

### 2. `-ml 1` (max token length)

Hypothesis: capping whisper-cli's max token length to 1 word might change
tokenization enough to affect alignment quality.

**Result: dead.** No effect on token count or token content was observed.
Not worth revisiting.

### 3. Whisper timestamp accuracy as the cause of bad cuts

Hypothesis: bad cuts are caused by generally-inaccurate Whisper timestamps —
i.e., Whisper's timing is just noisy, and bad cuts are the noisy tail of a
normal distribution.

**Result: dead.** Measured **~190ms median onset error** — real, but small,
and not distinguishing. Bad-cut timestamps were **statistically
indistinguishable** from good-cut timestamps on the V6 project. Whisper's
general timing noise is not what separates a good cut from a bad one; if it
were, bad-cut segments would show a measurably larger onset error than
good-cut segments, and they don't.

---

## Tooling notes (whisper.cpp)

- **Version pinned:** whisper.cpp v1.9.1, commit `f049fff9`, model
  `ggml-base.en.bin`.
- **`--dtw base.en` is a silent no-op in production.** Flash attention is on
  by default in this build, and flash attention **disables DTW with no
  error** outside verbose mode — the flag is silently ignored. Enabling DTW
  requires passing `-nfa` (no-flash-attention), which (a) costs decode speed
  and (b) **broke whisper-cli's stdout printing** in this build. Not usable
  as shipped.
- **`--vad` exists but needs an unbundled VAD model file** that is not part
  of this project's bundled model set. Not usable without adding a new
  bundled asset and provisioning story — not pursued.

---

## The `isBreathSilence` root cause (shipped fix)

**Root cause:** the multi-fragment override inside `isBreathSilence`
(`snapBoundaries.ts`) classified breath-vs-boundary using token
**timestamps** — specifically, the tested span's own first token's
timestamp, which every distance/ratio in the coverage computation is
measured relative to. Whisper's timestamp for a span's first token can smear
**100–900ms** backward across the true silence boundary (the model assigns
the *preceding* pause's onset to the next word's start, rather than to when
the word is actually articulated). When that happens, the override sees
high "coverage" of the silence by the span's own tokens and (wrongly)
classifies a genuine inter-segment seam as an internal breath.

**Fix:** re-pose the same question in **token index** terms instead of
timestamp terms. Token indices are assigned by the Hirschberg alignment pass
— a pure text match with no timestamp involved — so they are never smeared.
The exemption asks: does the silence sit at or after the point in the token
array where the *preceding* segment's own genuine last match ends? If so,
the silence cannot — by index position, independent of the (possibly
smeared) timestamp — be interior to the preceding segment's own speech.

This exemption is wired **NEXT-side only** — see "curr-side disabled"
below.

### The 8 genuine V6 fixes

Project: the 447-segment V6 production project (see "Reproduction assets"
below). All 8 are the multi-fragment-override shape (ratio ≥ 0.9,
significantInteriorCount ≥ 2) where the seam anchor sits before the tested
silence:

| Segment | Fixed? |
|---|---|
| 34 | Genuine fix |
| 96 | Genuine fix |
| 162 | Genuine fix |
| 316 | Genuine fix |
| 338 | Genuine fix |
| 352 | Genuine fix |
| 405 | Genuine fix |
| 412 | Genuine fix |

**Segment 60 was NOT a genuine fix** — it was a spurious metric artifact.
It was originally miscounted as a 9th genuine fix because the comparison
harness's diff showed it as "improved," but on retroactive audit (prompted
by the curr-side false positive found on the second, 173-segment project —
see below) it turned out to be the *curr-side* exemption stealing a 1.32s
trailing breath from an unrelated sentence ("...puts his hand flat on your
shoulder."). It only *looked* like an improvement because the corrupted
boundary happened to also land inside a detected silence. The correct count
of genuine fixes from this exemption is **8, not 9**.

An exhaustive scan of all 446 real pairs in the V6 project (both NEXT-side
and CURR-side) found **zero** real cases where the multi-fragment override
fires and the NEXT-side exemption does *not* strip it — i.e., no real
"fallback is correct" counter-example exists in this dataset. (One such
counter-example was originally hypothesized at segment 405; verification
against real V6 data showed that premise was wrong — segment 405 is one of
the 8 genuine fixes, not a case where the override should have stayed
active. See `syncTiming.test.ts`'s own comment on that test for the detailed
correction.)

### The curr-side variant — permanently disabled

`snapCoveredBoundaries` calls `isBreathSilence` on **both sides** of every
pair: the NEXT segment's own span (does this silence look like *next's*
leading breath?) and the CURR segment's own span (does this silence look
like *curr's* trailing breath?).

For the **NEXT-side** call, the natural "preceding segment" anchor is
**curr's own `lastTokenIdx`** — genuinely temporally adjacent to the silence
under test. Real seam evidence.

For a **CURR-side** call, the only symmetric choice is the segment
*before* curr — i.e., the segment **two positions back** from the silence
being tested. That token has **no temporal relationship to the silence at
all**. The condition `silence.startSec >= seamAnchor.endSec` is satisfied
almost trivially whenever curr has any predecessor, so applying the
exemption on the curr side silently strips multi-fragment breath protection
from the entire curr side.

This was confirmed concretely on a **second, independent, 173-segment
production project** (2026-08-03): the exact production case that
originally motivated the multi-fragment override — the segment "They're the
worst" — has its own 0.38s internal breath silence wrongly exempted this
way under the curr-side variant, landing the boundary at 18.51s (the
pre-fix breath centre the override exists to prevent) instead of the
correct 18.87s. The curr-side variant was retroactively found to explain
segment 60's false "fix" on V6 too (see above).

**The curr-side exemption is permanently disabled** — every real call site
passes `-1` for the curr-side call, which the `otherSideLastTokenIdx`
parameter's default value already produces (disabling the exemption
entirely). Do not re-enable it by threading a predecessor index into the
curr-side call without a fundamentally different anchor — "the segment two
back" is not fixable by tuning, the same way the original timestamp-only
leading-edge exemption was not fixable by tuning.

---

## The open word-shift defect

**Status: OPEN, not fixed.** Two candidate fixes were tried; both failed.

### The evidence

11 user-reported, ear-verified cases of word-shift (a cut lands one or more
words earlier/later than where the sentence actually breaks), given as
segment-index pairs:

28–29, 60–61, 77–81, 105–106, 117–118, 130–131, 144–147, 188–189, 222–223,
295–296, 428–429.

**The aligner itself is exonerated** — all 447 spans in the V6 project were
independently confirmed correct at the alignment level. The defect is
**localized to the boundary picker**: specifically, the picker widens its
silence-candidate search window when the claimed inter-segment gap looks
narrow. Measured: **0.244s mean gap on defective pairs vs. 0.700s mean gap
on clean pairs.** The picker's window-widening heuristic, tuned for the
common case, systematically misfires on this narrower-gap minority.

### The "246 PICK-WRONG" figure overcounts

An earlier broad sweep counted 246 cases where the picker's choice looked
"wrong." That figure **overcounts** — at least **45 of those 246** are
Whisper timestamp blur (the same 100–900ms smear documented above)
**misread as theft**, not real word-shift. The only **trustworthy** test set
right now is the user's **11 ear-verified cases** — every other candidate in
the 246 needs the same ear-verification before it can be trusted as a real
defect instance.

### Two failed fix candidates

**FENCE.** Fences the picker's search window to prevent widening past a
hard boundary. **Failed:** reverts all 8 Candidate-1 breath-exemption fixes
(above) — it is a **direct conflict**, not additive. Fencing the window
tight enough to stop word-shift also stops the multi-fragment override's
NEXT-side exemption from ever having room to fire.

**QUIET.** Biases the picker toward the quietest point in the candidate
window rather than the geometric closest-centre point. **Failed:** fails
**3 of 4** hard correctness checks at **every** window size tested — not
a tuning problem, a structural one.

Neither candidate is viable as designed. A real fix needs a different
mechanism — not yet identified.

---

## Reproduction assets

**V6 project** (447-segment production project used for the breath-exemption
fix and the word-shift evidence above):
- Project id: `30e61c51-47d5-4049-98d9-e8373553cb24`
- 447 segments / 4,517 tokens / 1,421.28s audio duration

**173-segment project** (used to find and confirm the curr-side false
positive):
- 173 segments / 1,973 tokens / 709.0s audio duration

### Console-extraction technique (so this data can be recovered again)

Project state and tokens are not otherwise exportable from the running app.
To pull them from a live session's browser devtools console:

- **Project JSON:** `localStorage` key `kinetix:project:<id>:v1`
- **Audio/assets:** IndexedDB database `kinetix-assets`, object store
  `assets-v2`, compound key `[projectId, id]`

This is the only way to recover this data without a chat transcript — no
export/download feature exists for it in the app itself.

---

## DO NOT RE-INVESTIGATE

- JSON vs. stdout token parsing — identical (0.0ms median delta, 3,578
  words).
- `-ml 1` — no measurable effect.
- General Whisper timestamp noise as the direct cause of bad cuts — bad-cut
  and good-cut timestamps are statistically indistinguishable; the real
  cause is the *first-token smear* mechanism above, which is a specific,
  structural effect, not generic noise.
- `--dtw base.en` — silent no-op under this build's default flash attention;
  `-nfa` breaks stdout printing. Not usable without further whisper.cpp
  build work.
- `--vad` — needs an unbundled model file; not pursued.
- The curr-side seam exemption variant — confirmed unsound on real data
  twice (segment 60 on V6, "They're the worst" on the 173-segment project).
  Permanently disabled; do not re-enable without a fundamentally different
  anchor.
- FENCE and QUIET as fixes for the word-shift defect — both tried, both
  failed, for structural (not tuning) reasons documented above.
- Segment 405 as a "fallback is correct behavior" control case — this
  premise was checked against real V6 data and is **wrong**; segment 405 is
  one of the 8 genuine breath-exemption fixes.
- The "246 PICK-WRONG" figure as a trustworthy defect count — it overcounts
  by at least 45 (Whisper blur misread as theft). Only the 11 ear-verified
  cases are currently trustworthy.
