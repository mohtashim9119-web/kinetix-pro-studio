# measure-word-onset — Phase 2b timing-source measurement

Companion to `scripts/measure-word-onset.py`. Committed per
`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` Part K's K8: the original investigation's
harness (which produced the ~190ms figure cited throughout the plan) lived in
`/tmp` and was never committed — confirmed unrecoverable in
`docs/audit-verification-2026-08-03.md` §C.7. This tool exists so Phase 2b,
and any future re-measurement (e.g. after a Phase 3 timing-source swap), does
not depend on re-deriving the method from memory.

No dependencies beyond Python 3 stdlib, a working `ffmpeg` on `PATH` (or
`--ffmpeg-bin`), and the bundled `whisper-cli` sidecar binary.

## What it measures

For each interval ffmpeg's `silencedetect` finds in the audio (independent of
whisper — this is the ground truth), the script finds the transcribed word
that comes right after that pause and asks: does its declared start time
match where the pause actually ends?

`onset_error = word.start - silence.end` (signed seconds). Negative means the
word's declared start precedes the true end of the pause before it — the
segment-96 pathology (`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` Part C): Whisper
assigning a pause's onset to the following word instead of to when the word
was actually spoken.

Word selection deliberately does **not** require `word.start >= silence.end`
(this would silently exclude every negatively-smeared word, since by
definition its declared start is *before* the pause ends — which is the exact
case this measurement most needs to see). Instead it walks the token array in
order and picks the first not-yet-consumed token whose declared **end**
extends past the silence's **start**. See the script's own docstring on
`score_onset_errors` for the full reasoning and the dedup rule for two
silencedetect events that resolve to the same following word.

Pure-punctuation tokens (`.`, `,` — whisper-cli emits these as their own
timestamped entries under `-ml 1`) are filtered out before scoring, mirroring
production's own `filterMalformedTokens` empty-normalized-text drop reason in
`whisperService.ts`. This is not optional: on the first pipeline smoke test
every single scored pause resolved to a comma or period rather than the real
next word, because whichever tokenizer boundary emits the punctuation often
lands it right at the pause. Confirm this filter is still in place before
trusting any future re-run's numbers.

## Exact invocation used for the Phase 2b measurement (2026-08-05)

Paths below are this machine's corpus locations
(`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` Part D.0) — substitute your own.

```bash
SCRIPT="scripts/measure-word-onset.py"
WHISPER="src-tauri/binaries/whisper-x86_64-apple-darwin"
MODEL_TURBO="src-tauri/models/ggml-large-v3-turbo.bin"
MODEL_LARGE_V3="src-tauri/models/ggml-large-v3.bin"   # not bundled by default — see H.9

V6_AUDIO="/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
V6_DIR="/tmp/phase2b/v6"

P173_AUDIO="/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
P173_DIR="/tmp/phase2b/173"

# --- ground truth (once per audio file) ---
python3 "$SCRIPT" prepare --audio "$V6_AUDIO"   --workdir "$V6_DIR"
python3 "$SCRIPT" prepare --audio "$P173_AUDIO" --workdir "$P173_DIR"

# --- config (a): turbo raw, as currently shipped (whisper.rs's real invocation) ---
python3 "$SCRIPT" transcribe --workdir "$V6_DIR"   --whisper-bin "$WHISPER" --model "$MODEL_TURBO" --label a --language en
python3 "$SCRIPT" transcribe --workdir "$P173_DIR" --whisper-bin "$WHISPER" --model "$MODEL_TURBO" --label a --language en

# --- config (b): turbo + -nfa --dtw large.v3.turbo + JSON output ---
python3 "$SCRIPT" transcribe --workdir "$V6_DIR"   --whisper-bin "$WHISPER" --model "$MODEL_TURBO" --label b --language en --nfa --dtw large.v3.turbo --json
python3 "$SCRIPT" transcribe --workdir "$P173_DIR" --whisper-bin "$WHISPER" --model "$MODEL_TURBO" --label b --language en --nfa --dtw large.v3.turbo --json

# --- config (c): large-v3 non-turbo raw ---
python3 "$SCRIPT" transcribe --workdir "$V6_DIR"   --whisper-bin "$WHISPER" --model "$MODEL_LARGE_V3" --label c --language en
python3 "$SCRIPT" transcribe --workdir "$P173_DIR" --whisper-bin "$WHISPER" --model "$MODEL_LARGE_V3" --label c --language en

# --- config (d): large-v3 non-turbo + -nfa --dtw large.v3 + JSON output ---
python3 "$SCRIPT" transcribe --workdir "$V6_DIR"   --whisper-bin "$WHISPER" --model "$MODEL_LARGE_V3" --label d --language en --nfa --dtw large.v3 --json
python3 "$SCRIPT" transcribe --workdir "$P173_DIR" --whisper-bin "$WHISPER" --model "$MODEL_LARGE_V3" --label d --language en --nfa --dtw large.v3 --json

# --- score each V6 config (the quantitative deliverable is V6-only, per the plan) ---
for L in a b c d; do
  python3 "$SCRIPT" score --workdir "$V6_DIR" --label "$L" --out-csv "$V6_DIR/onset_errors_$L.csv"
done
python3 "$SCRIPT" report --workdir "$V6_DIR" --labels a,b,c,d

# --- V6 78-89s dropout recovery check (Phase 2a Step 1 finding) ---
for L in a b c d; do
  echo "== $L =="
  python3 "$SCRIPT" check-word --workdir "$V6_DIR" --label "$L" --word stayed --window "70:95"
  python3 "$SCRIPT" check-word --workdir "$V6_DIR" --label "$L" --word permanent --window "70:95"
done

# --- 173 segment-112 ("Some don't emerge.") recovery check ---
# Audio position from Phase 2a's own finding: "course" ends ~442.94s, "don"
# starts ~443.82s (turbo). Window padded generously on both sides.
for L in a b c d; do
  echo "== $L =="
  python3 "$SCRIPT" check-word --workdir "$P173_DIR" --label "$L" --word Some --window "435:450"
done
```

## Reproducing this exact measurement later (e.g. at a future re-check)

1. Re-run `prepare` only if the corpus audio files themselves changed — the
   ground truth (silence intervals) depends only on the audio, not on any
   whisper config.
2. Re-run `transcribe` for whichever config(s) changed (new whisper.cpp
   build, new model, new flags).
3. Re-run `score`/`report`/`check-word` — these are pure functions over the
   already-saved `tokens_<label>.json` + `silences.json`, safe to re-run any
   number of times without re-transcribing.

`workdir` is left as an explicit CLI argument (not hardcoded into the script)
specifically so this stays runnable from a different machine or against a
different project without editing the script itself.

## Known limitations, stated plainly

- Word-onset error is measured only at ground-truth silence boundaries — it
  says nothing about timestamp accuracy for words in continuous speech with
  no detected pause between them (Part C's own rule only ever needs a cut
  where a pause exists, so this is the right scope, not a gap).
- `silencedetect`'s `-45dB` / `0.25s` thresholds (matching
  `silenceDetector.ts`'s production defaults) are one reasonable choice of
  ground truth, not the only possible one — a much more sensitive threshold
  would find more (and shorter) silences and could shift the measured
  distribution. Not swept in this measurement; if a future session suspects
  threshold sensitivity, treat that as a new, separate measurement question.
- The rare edge case where one token's declared span is long enough to
  extend past two consecutive detected silences (documented in the script's
  `score_onset_errors` docstring) is deduplicated by keeping only the later
  attribution, not specially flagged in the per-row CSV output.
