# Phase 3 data-cleaning pass — companion to three scripts (2026-08-05)

Companion to `measure-forced-alignment-joint-context.py`,
`measure-forced-alignment-whisper-text.py`, and `extract-full-transcript.py`.
All three reuse `measure-forced-alignment.py`'s `build_aligner`/`align_segment`/
`normalize_word` unchanged (imported directly via `importlib`, not
reimplemented) and `measure-word-onset.py`'s `score_onset_errors`/
`filter_word_tokens` unchanged for scoring — same K8 discipline as every
other script in this directory: committed, re-runnable without archaeology.

Setup: same venv as `measure-forced-alignment.md` (`torch==2.2.2
torchaudio==2.2.2 "numpy<2" uroman`), plus `python-Levenshtein` for the WER/
CER classification step below.

## Step 1 — the "it." scorer bug (no new script)

Fixed directly in `measure-word-onset.py`'s `score_onset_errors` — see that
function's own docstring for the mechanism (an overlap gate: a candidate
token must reach at least the silence's own midpoint, not merely poke past
its start). No companion script; re-run the existing `score` subcommand
against already-committed `tokens_fa2.json`/`silences.json` workdirs to
reproduce:

```bash
python3 measure-word-onset.py score --workdir /path/to/v6/workdir --label fa2 --out-csv v6-corrected.csv
```

## Step 2 — joint multi-segment context re-measurement

`measure-forced-alignment-joint-context.py` re-aligns a set of target
segments (identified by 0-based `seg_i`) in merged ±`--window-radius`
groups, giving MMS-FA the full correct multi-segment text for each group's
own audio span — removing the neighbour-bleed confound a flat wide-padding
bypass suffers (see `measure-forced-alignment.md`'s own neighbour-bleed
writeup). Exact invocation used for the Phase 3 data-cleaning pass:

```bash
python3 extract-full-transcript.py --csv ../docs/V6-Smear-Phase2a.csv --out /tmp/phase3/v6/v6_full_transcript.json  # not used by Step 2 itself, listed for parity with Step 4 below

python3 measure-forced-alignment-joint-context.py align \
  --workdir /tmp/phase3/v6 \
  --segments-json "/path/to/v6-segments-full.json" \
  --targets-json ../docs/phase3-step2-targets-v6.json \
  --label v6 --window-radius 2
```

`--targets-json` is a flat array of `{"seg_i": <0-based index>, ...}` —
`docs/phase3-step2-targets-v6.json` is the exact 49-row target set used
(every V6 pause still scoring >250ms after Step 1's fix, keyed to the
committed segment its word-start timestamp falls inside). Output:
`tokens_<label>_joint.json`, keyed by merged window range
(`"<lo>-<hi>"` -> list of `{text, seg_i, pos, start, end, score}`).

Re-scoring: build a per-window token list (already in the right shape for
`measure-word-onset.py`'s `filter_word_tokens`/`score_onset_errors`) and
score against the SAME `silences.json`, restricted to silences whose
`[start, end]` falls inside the window's own `[lo_t, hi_t)` span — this lets
the (Step-1-fixed) scorer pick a fresh "following word" for every silence in
the window, not just re-verify the originally-flagged word, which matters
because a badly-windowed original per-segment alignment can misplace the
WRONG word onto a given pause in the first place (measured: V6 segment
79/80's "No" case — the original zero-padded alignment placed "No" at
237.925s, far from its true position; scoring only that mis-placed token's
new location would have missed that the pause's real following word is "The"
at 238.387s, not "No" at all).

## Step 4 — Whisper-text mode + script-vs-whisper comparison

`extract-full-transcript.py` pulls the COMPLETE token list out of a
`docs/*-Smear-Phase2a.csv` transcript-inspector export — those CSVs embed the
full transcript inside a second, console-log-dump section; their first
section is a UI table capped at 1000 rows (silently truncates V6/173 to
1000 words if read alone, verified against the inspector's own logged
"N kept" count):

```bash
python3 extract-full-transcript.py --csv ../docs/V6-Smear-Phase2a.csv --out /tmp/phase3/v6/v6_full_transcript.json
```

`measure-forced-alignment-whisper-text.py` then runs the same per-segment,
zero-padded alignment methodology as `measure-forced-alignment.py`'s own
`align` command, but with each segment's TEXT replaced by whichever Whisper
turbo tokens fall inside that segment's own `[startTime, startTime+duration)`
window (concatenated in time order), instead of the segment's real script
text:

```bash
python3 measure-forced-alignment-whisper-text.py \
  --segments-json "/path/to/v6-segments-full.json" \
  --whisper-tokens-json /tmp/phase3/v6/v6_full_transcript.json \
  --workdir /tmp/phase3/v6 --label wtext
```

Output (`tokens_wtext.json`, `meta_wtext.json`) is scored via
`measure-word-onset.py score --workdir ... --label wtext` exactly like any
other config. `meta_wtext.json`'s `empty_segments` field lists every 0-based
segment index Whisper transcribed NOTHING for inside its own time window —
whisper-text mode cannot produce any alignment there at all (script-text
mode has no such failure mode, since it never depends on Whisper having
transcribed anything correctly).

### WER/CER classification (faithful vs. drifted)

No dedicated script — a short one-off using `extract-full-transcript.py`'s
output plus each project's own script text file and the `python-Levenshtein`
package. Naive per-token word-level WER is UNUSABLE for cross-project
comparison here: Whisper's `-ml 1` word-level tokenization still splits some
words into sub-word fragments (`"41st"` → `"41"`+`"st"`, `"millennium"` →
`"millenn"`+`"ium"`, `"don't"` → `"don"`+`"'t"` in English; far more
aggressively in the Spanish run, e.g. `"Scylla"` → `"S"`+`"illa"`), which
inflates naive word-level WER without reflecting any real content
mismatch (measured: 173's naive WER reads 24.8%, Spanish's reads 86.3%,
both dominated by fragmentation, not drift). Character-level CER (both
sides lowercased, letters+digits+apostrophe only, all whitespace/punctuation
stripped) is tokenization-boundary-agnostic and is what this pass classifies
against — see the Phase 3 plan-doc entry (Step 4) for the full table and the
Spanish-specific diagnostic (its raw CER is dominated by two systematic,
non-drift writing-convention differences — Whisper spelling the proper noun
"Scylla" as "Silla," and converting spoken number-words like "seis"/"tres"
to digits "6"/"3" — not genuine speech-vs-script divergence).

### Known limitation

Spanish is excluded from the FA script-vs-whisper comparison arm — this
project has no persisted per-segment timing backup (`startTime`/`duration`
per segment; only raw prose/bracket-doc text files exist for it), and
reconstructing that timing would require either re-running the app's Apply
Sync pipeline (out of this measurement-only pass's scope) or inferring
segment boundaries, which this pass declines to do per the "do not
reconstruct or infer" instruction's spirit. The WER/CER classification
itself does not need segment timing and covers Spanish normally.
