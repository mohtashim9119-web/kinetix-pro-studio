# Step Q — Spanish listening batch, listening protocol

10 clips (`clip3_01.wav`–`clip3_10.wav`) from the **Spanish** corpus project —
the first human-ear pass this project has ever had. 7 are drawn from its
worst-scoring MMS-FA boundaries; 3 are controls that currently pass. Same
protocol as the two English batches (Step C's 12, Step H's 20): each clip is
padded 1.0s before the detected pause and 1.0s after the following word,
sourced from the original (non-16kHz-transcoded) audio. `clip` → script text
only in `docs/phase4-step-q-spanish-manifest.csv` — no timing, error, kind
(failure/control), or pass/fail information, so a listen-through cannot be
biased by which ones "should" be wrong.

**Verified before sending, per the standing instruction:** every clip's
padding and duration was checked programmatically (all 10 exact), and every
clip was transcribed with the production whisper-cli sidecar and matched
against its manifest text on three tests (first-word present, lead-in matches
the previous segment's tail, no foreign content) — **10/10 pass**. Results:
`docs/phase4-step-q-integrity-check.csv`. Batch 2's clip 11 mismatch, which
only a human ear caught, would have failed the third of these tests.

**One clip carries a known structural risk, stated without identifying it:**
one of the seven failure clips sits at the very start of the corpus, where
there is no left context — the same edge-of-corpus condition that forced
batch 1's clip 3 to be excluded from scoring. If one clip's pause seems not to
match anything the rest of the batch is doing, that is expected and is not
your error; report what you hear and it will be adjudicated after unblinding.

**What to do, per clip:** listen once at normal speed (slow it down again if
your player allows). Report THREE clip-relative timestamps, in seconds from
the start of that clip file:

1. **A** — the moment the narrator's voice truly stops: the last audible
   energy of the word before the gap, not counting trailing breath or mouth
   noise as still-speaking once the actual voiced sound has ended.
2. **Breath** — if you hear an audible breath/inhale in the gap, its
   approximate start–end window (clip-relative). If none, write "none."
3. **B** — the moment the next word's speech genuinely begins: its first
   audible articulation, not any breath intake or lip-smack that precedes it.

Give all three to roughly a tenth of a second if you can (e.g. "stop 1.3s,
breath 1.4–1.6s, start 1.7s"), and add "clear" or "uncertain" if the boundary
is fuzzy to your ear. Please don't try to reason about which measurement
"should" be correct or how long a pause "should" be — just report what you
actually hear, clip by clip, in order.

**Spanish note:** the narration is Spanish; you do not need to understand it to
do this task — the judgement is purely acoustic (where voice stops, where voice
resumes). If a word's onset is genuinely ambiguous to a non-Spanish ear (e.g. a
soft `s`- or `h`-initial word), mark it "uncertain" rather than guessing.
