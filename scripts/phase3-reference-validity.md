# Phase 3 reference-validity pass — companion to three scripts (2026-08-05)

Companion to `phase3-reference-validity-step-a-sweep.py`,
`phase3-reference-validity-step-b-phoneme.py`, and
`phase3-reference-validity-step-c-clips.py`. Same K8 discipline as every
other script in this directory: committed, re-runnable without archaeology.
Measurement-only — none of the three touches `src/`, integration, or any
threshold.

**Task these three answer:** all 40 unresolved Phase 3 forced-alignment
failures (`docs/phase3-step2-joint-context-results.csv`, `resolved=False`)
share one sign — FA places the word LATER than `silencedetect`'s declared
pause end, never earlier, clustered on sentence-initial pronouns. A
uniform-sign error is the signature of a biased reference (silencedetect
firing early on a soft onset ramp) rather than random FA noise — this pass
tests that hypothesis directly instead of assuming it.

## Setup

Steps A and C need only `ffmpeg` on `PATH` and Python 3 stdlib — no venv.
Step B needs the `cmudict` package (`pip install cmudict`; pulls
`importlib-metadata`/`importlib-resources`/`zipp` as transitive deps, all
pure-Python, no torch). All three read from `/tmp/phase3/v6/` — the same
workdir every other Phase 3 script uses — and assume it already has
`silences.json`, `audio_16k.wav`, and the corrected/matched intermediate
files Step A/B/C build against (see each script's own top-of-file
docstring for the exact upstream file it depends on:
`docs/phase3-onset-v6-fa-step1-2-corrected.csv`,
`docs/phase3-step2-joint-context-results.csv`, and
`/tmp/phase3/v6/corrected_failures_gt250ms.json`, all already committed or
already produced by the Phase 3 data-cleaning pass).

Before running Step A/B/C fresh, first reconstruct the 40-row unresolved
target list with silence bounds attached (this join step was done inline in
this session, not as a committed script — reproduce with the following,
which cross-references `docs/phase3-onset-v6-fa-step1-2-corrected.csv`
against `docs/phase3-step2-joint-context-results.csv` and
`/tmp/phase3/v6/corrected_failures_gt250ms.json` by word text + tight
onset-error tolerance, writing `/tmp/phase3/v6/unresolved_40.json`):

```python
import csv, json
rows = list(csv.DictReader(open("docs/phase3-onset-v6-fa-step1-2-corrected.csv")))
for r in rows:
    for k in ("onset_error_sec","silence_start","silence_end","token_start","token_end"):
        r[k] = float(r[k])
targets = json.load(open("/tmp/phase3/v6/corrected_failures_gt250ms.json"))
step2 = list(csv.DictReader(open("docs/phase3-step2-joint-context-results.csv")))
resolved = {(r["old_word"], round(float(r["old_err"]),4)): r["resolved"]=="True" for r in step2}
unresolved = []
for t in targets:
    key = (t["word"], round(t["onset_error_sec"],4))
    if resolved.get(key) is False:
        cands = [r for r in rows if r["token_text"]==t["word"]
                 and abs(r["onset_error_sec"]-t["onset_error_sec"]) < 1e-6]
        if cands:
            unresolved.append({**t, "match": cands[0]})
json.dump(unresolved, open("/tmp/phase3/v6/unresolved_40.json","w"), indent=2, default=str)
```

## Step A — threshold sweep on the silencedetect reference

`phase3-reference-validity-step-a-sweep.py` re-runs ffmpeg `silencedetect`
over V6's `audio_16k.wav` at noise floors -50/-45/-40/-35/-30dB (min-duration
held fixed at 0.25s, matching production's `silenceDetector.ts` default and
`measure-word-onset.py`'s own default), then for each of the 40 unresolved
words re-derives "pause end" at each floor (preferring a silence whose
interval overlaps the original -45dB interval; falling back to the nearest
prior silence end if the floor dissolved that interval entirely — flagged
per-row as `method_<floor>`) and recomputes `onset_error = token_start -
silence_end`.

```bash
python3 phase3-reference-validity-step-a-sweep.py
```

Writes `docs/phase3-step-a-threshold-sweep.csv` (full per-row, per-floor
table) and `/tmp/phase3/v6/step_a_sweeps.json` (raw silence lists per
floor, for re-deriving anything the summary script didn't compute).

**Caveat, stated plainly:** the -50dB step occasionally produces a large
spurious error via the fallback path (the pause vanishes entirely at a
stricter floor, so "nearest prior silence" grabs a genuinely different,
much-earlier gap) — this is a property of the matching heuristic, not the
underlying acoustic signal, and is called out in the per-row `method`
column so it isn't silently averaged into the aggregate stats. -45 through
-30 never hit this fallback path on any of the 40 rows.

## Step B — onset phonetic class bucketing

`phase3-reference-validity-step-b-phoneme.py` looks up each of the full 501
V6 boundaries' following word in the CMU Pronouncing Dictionary
(`cmudict` package — the standard, freely-licensed ARPAbet transcription
dictionary; no local phoneme model was built for this), classifies the
word's FIRST phoneme into one of 7 fine classes (vowel, glide, nasal,
liquid, plosive/stop, fricative, affricate — `HH` classified as fricative
per standard phonetics), and coarsens those into `soft` (vowel/glide/
nasal/liquid) vs `sharp` (plosive/fricative/affricate) per the task's own
bucketing. A word not in CMUdict (6 of 501 on V6 — proper nouns like
`Korik`, `Daret`, `Yaro`) is left unclassified rather than guessed.

```bash
python3 phase3-reference-validity-step-b-phoneme.py
```

Writes `docs/phase3-step-b-phoneme-bucket.csv` (every V6 boundary, tagged
with its phone class and bucket) and prints median/p95/>250ms-rate per
bucket to stdout, both coarse and fine-grained, plus a cross-reference
against the 40 unresolved failures' own bucket membership.

## Step C — export 12 ground-truth listening clips

`phase3-reference-validity-step-c-clips.py` extracts 12 clips from V6's
original source audio (`6.m4a`, not the 16kHz working copy, for listening
quality) — 8 from the 40 unresolved failures (a deliberate spread: 4 of the
threshold-invariant outliers Step A found don't collapse even at -30dB, 2
that resolve cleanly by -35dB, 2 mid-range) plus 4 passing controls
(|error| < 30ms, spanning the same phoneme classes, including a same-word
"You" control for direct A/B against the many failing "You" cases). Each
clip is `[silence_start - 1.0s, token_end + 1.0s]` from the original -45dB
reference, clamped to the audio's own bounds. Clip order is shuffled
(`random.seed(42)`) and renamed to opaque `clip_NN.wav` so a listener can't
infer which are failures from the manifest.

```bash
python3 phase3-reference-validity-step-c-clips.py
```

Writes 12 `.wav` files to `/tmp/phase3/v6/clips/`, a public
`clips_manifest.csv` (clip name + script text ONLY — no timing/error/
pass-fail data) also copied to `docs/phase3-step-c-clips-manifest.csv`, and
a private `/tmp/phase3/v6/step_c_answer_key.json` (clip name → seg/word/
error/kind, kept out of `docs/` deliberately — this is the key the next
session compares the owner's returned labels against; do not hand it to
the listener before they report back).
