# Step C — listening protocol

12 clips (`clip_01.wav`–`clip_12.wav`), each a real narration boundary from the
V6 project, padded 1.0s before the detected pause and 1.0s after the following
word. `clips_manifest.csv` lists each clip's script text only — no timing,
error, or pass/fail information, so a listen-through cannot be biased by
which ones "should" be wrong.

**What to do, per clip:** listen once at normal speed (slow it down again if
your player allows — useful for the short ones). Report two clip-relative
timestamps, in seconds from the start of that clip file: (1) the moment the
narrator's voice truly stops — the last audible energy of the word before the
gap, not counting trailing breath or mouth noise as still-speaking once the
actual voiced sound has ended; and (2) the moment the next word's speech
genuinely begins — its first audible articulation, not any breath intake or
lip-smack that precedes it. Give both to roughly a tenth of a second if you
can (e.g. "stop 1.3s, start 1.6s"), and add "clear" or "uncertain" if the
boundary is fuzzy to your ear. Please don't try to reason about which
measurement "should" be correct or how long a pause "should" be — just report
what you actually hear, clip by clip, in order.
