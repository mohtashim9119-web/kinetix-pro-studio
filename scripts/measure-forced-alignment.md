# measure-forced-alignment — Phase 3 forced-alignment (MMS-FA) measurement

Companion to `scripts/measure-forced-alignment.py`. Committed for the same
reason `scripts/measure-word-onset.py` was (`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`
Part K's K8): a prototype session (2026-08-05) produced real artifacts —
`tokens_fa.json`, `emission.pt`, `onset_errors_fa.csv`, `meta_fa.json`,
`silences.json`, `audio_16k.wav` — for both V6 and the 173-project at
`/tmp/phase3/{v6,173}/`, but the driver script that produced `tokens_fa.json`
was never committed and did not survive a later `/tmp` clear. The DATA
survived; the SCRIPT did not — confirmed by direct inspection before writing
this replacement (no venv, no stray `.py`, nothing under git status). This is
the exact K8 pattern recurring one phase later. `measure-forced-alignment.py`
is this driver, rebuilt from scratch and committed so this measurement is
re-runnable without archaeology, same as K8 required for Phase 2b.

## What this measures, and what it reuses unchanged

Runs [torchaudio's `MMS_FA` bundle](https://pytorch.org/audio/stable/pipelines.html#torchaudio.pipelines.MMS_FA)
(Meta's multilingual forced-alignment model — a wav2vec2-large-scale CTC
acoustic model over a 28-symbol romanized alphabet, released CC-BY-NC-4.0;
see `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`'s H.3/Phase 3 entry for the full
license/model-choice record, Blocker 1) against a project's own
already-committed segments, producing per-word `{text, start, end, score}`
timestamps in **exactly** the shape `measure-word-onset.py`'s
`score`/`report`/`check-word` subcommands already consume
(`tokens_<label>.json` + `meta_<label>.json`, keyed by an arbitrary `--label`
string). Those subcommands are **reused unchanged** — this script only adds
the FA-specific equivalent of `measure-word-onset.py`'s `transcribe` step
(named `align` here, since there is no transcription step, only alignment of
already-known text).

`measure-word-onset.py`'s `prepare` step (ffmpeg transcode to 16kHz mono WAV +
`silencedetect` ground truth) is reused as-is, not reimplemented — it is
audio-only and model-independent, so there is nothing FA-specific to redo.
This is also why FA's numbers are directly comparable to Phase 2b's Whisper
numbers: both are scored against the identical ground-truth silences on the
identical transcoded WAV.

## Setup (not stdlib — a real, separate step from measure-word-onset.py)

PyTorch dropped macOS x86_64 (Intel) wheel support after the 2.2.x line —
verified empirically (`pip index versions torch` on this machine lists 2.2.2
as the newest available for this platform), not assumed. This machine is
Intel x86_64 with no GPU backend (same as every other measurement in this
document — H.9's own whisper-cli runs found no GPU backend either).

```bash
python3.11 -m venv /path/to/venv        # a plain `python3` here resolved to
                                          # 3.14 on this machine, for which no
                                          # torch wheel exists at all — use a
                                          # 3.11 interpreter explicitly
source /path/to/venv/bin/activate
pip install torch==2.2.2 torchaudio==2.2.2   # last macOS-x86_64 release
pip install "numpy<2"                         # ABI match for torch 2.2.2 —
                                                # without this, torch/torchaudio
                                                # import with a NumPy-1.x-vs-2.x
                                                # warning (harmless but noisy)
pip install uroman     # the real Meta/ISI uroman package — H.3 explicitly
                        # requires verifying romanization mechanics against
                        # the real tool, not a hand-rolled ASCII fold
```

The MMS_FA model weights (`ctc_alignment_mling_uroman/model.pt`, downloaded by
torchaudio via `torch.hub` on first use) were already cached on this machine
at `~/.cache/torch/hub/checkpoints/model.pt` from the prior prototype session
— confirmed present before any network call was made this session. A fresh
machine needs network access for one download (multi-hundred-MB range) the
first time `bundle.get_model()` runs; every run after that is offline.

## Exact invocation used for the Phase 3 measurement (2026-08-05)

`measure-word-onset.py`'s `prepare` step had already been run for both
corpus projects by the lost prototype session, and those outputs —
`audio_16k.wav` and `silences.json` — survived at `/tmp/phase3/{v6,173}/`
(confirmed identical in kind to what a fresh `prepare` call produces: same
ffmpeg transcode, same `silencedetect` flags). They were reused directly
rather than re-transcoding. A fresh run on a machine without them would
start with `measure-word-onset.py prepare` exactly as Phase 2b's own `.md`
documents.

```bash
SCRIPT="scripts/measure-forced-alignment.py"
SCORE_SCRIPT="scripts/measure-word-onset.py"   # score/report reused unchanged

V6_DIR="/tmp/phase3/v6"       # already has audio_16k.wav + silences.json
P173_DIR="/tmp/phase3/173"    # already has audio_16k.wav + silences.json

V6_SEGMENTS="/Users/mohtashim/Downloads/All Projects Test Data/Projects Backend Data/v6-segments-full.json"
P173_SEGMENTS="/Users/mohtashim/Downloads/All Projects Test Data/Projects Backend Data/project.json"   # full project backup; --segments-json accepts either shape

# --- config (fa2): MMS-FA, this session's fresh, honestly-timed run ---
# (the recovered prototype's own output is left in place, unmodified, as
# tokens_fa.json / meta_fa.json — label fa2 avoids overwriting it, so both
# can be compared side by side)
/usr/bin/time -l python3 "$SCRIPT" align --workdir "$V6_DIR"   --segments-json "$V6_SEGMENTS"   --label fa2 --language en
/usr/bin/time -l python3 "$SCRIPT" align --workdir "$P173_DIR" --segments-json "$P173_SEGMENTS" --label fa2 --language en

# --- score each config (measure-word-onset.py, unmodified) ---
python3 "$SCORE_SCRIPT" score --workdir "$V6_DIR"   --label fa2 --out-csv "$V6_DIR/onset_errors_fa2.csv"
python3 "$SCORE_SCRIPT" score --workdir "$P173_DIR" --label fa2 --out-csv "$P173_DIR/onset_errors_fa2.csv"
python3 "$SCORE_SCRIPT" report --workdir "$V6_DIR"   --labels fa2
python3 "$SCORE_SCRIPT" report --workdir "$P173_DIR" --labels fa2

# the committed, permanent copies (workdir itself is /tmp and not persisted):
cp "$V6_DIR/onset_errors_fa2.csv"   docs/phase3-onset-v6-fa.csv
cp "$P173_DIR/onset_errors_fa2.csv" docs/phase3-onset-173-fa.csv
```

`--segments-json` accepts either shape: a full `project.json`-style backup
(`{"segments": [...], ...}`, as used for the 173-project here) or a bare
segments array (`[...]`, as used for V6 here, from the smaller convenience
export `v6-segments-full.json`) — both need only `text`, `startTime`,
`duration` per element. **These are the project's own most-recently
committed segment timings — for both corpus projects here, that means the
base.en era (pre-Phase-2a), the most recent full per-segment snapshot that
exists** (see the plan document's Blocker-2 writeup for why no turbo-era
equivalent exists and the caveat that follows from using this one). They are
used only as a rough **audio window** to align each segment's own text
against — not as ground truth for anything, and specifically not as ground
truth for the word-onset-error scoring, which (like Phase 2b) comes
entirely from `silences.json`'s independent `ffmpeg silencedetect` output.

## Why per-segment windowed alignment, and the neighbour-bleed bug found while building this

A single MMS-FA forward pass over a 62-second clip of V6's audio measured
15–30s wall-clock on this machine (no GPU backend) — self-attention cost
does not scale linearly with sequence length, and a single pass over V6's
full 1421.3s (~71,000 frames at this model's ~20ms/frame stride, 24 encoder
layers, 16 attention heads each) is not tractable here. `align` therefore
runs the model once per **project segment**, each against a padded window
of the audio around that segment's own already-committed
`[startTime, startTime+duration)` (`--pad-sec`, default 3.0s — governs how
much input-timing drift the aligner can tolerate before losing real speech
off the window's edge; this is a measurement-time convenience, not a claim
about a production windowing strategy, which is Rust-integration scope and
out of this phase).

**A real bug was found and fixed while validating this script, not merely
guarded against speculatively.** An earlier version padded every segment by
a flat `--pad-sec` with no other bound. On V6's first five segments, this
produced a segment (`"The fire your mother tends..."`) whose first word
`"The"` was assigned a 1.5-second span landing **inside the immediately
preceding segment's own real speech** (`"...a shallow valley."`) — a
neighbour-bleed, not an onset-error artifact: `with_star=True` (MMS-FA's
wildcard/garbage token, meant to absorb audio outside the given transcript)
did not reliably exclude real, phonetically-plausible speech that happens to
sit in the padding but belongs to a neighbour's transcript, not this
segment's. Confirmed by comparing against a static, single-pass alignment of
the same audio range with the full multi-segment text given at once (which
placed the same word cleanly at 10.2s, not 8.0s). Fixed by clamping every
segment's window to the **midpoint of the gap to its immediate neighbour** on
each side (`floor_bound`/`ceil_bound` in `align_segment`) — a segment's window
can reach `--pad-sec` seconds past its own boundary, but never past the
midpoint to whichever neighbour is closer, so two segments' windows can never
overlap and neither can ever see into the other's real content. Re-verified
clean (monotonic timestamps, no cross-segment jumps) on the same five
segments after the fix; this is the version committed.

## Wall-clock and peak RSS

`align`'s own `meta_<label>.json` records `elapsed_sec` (model load through
the last segment, matching what `measure-word-onset.py`'s `transcribe`
times for whisper-cli — the whole model-run cost, not file I/O),
`model_load_sec` and `align_only_sec` separately for diagnostic clarity, and
a self-measured `peak_rss_bytes` (via Python's `resource.getrusage` —
already bytes on macOS, no unit conversion needed, unlike Linux's KB). The
authoritative figures reported in the plan document also wrap the whole
invocation in `/usr/bin/time -l`, the same tool and flag H.9 used to measure
whisper-cli's own peak RSS, so the two timing-source costs in this document
are measured the same way. The two readings (self-measured vs.
externally-measured) are a cross-check against each other, not two different
claims.

## Known limitations, stated plainly

- **Per-segment windowing is a measurement convenience, not the production
  design.** A real Rust integration must decide its own windowing strategy
  (most likely anchored to Stage 2's token-index spans, not a raw
  wall-clock-seconds guess re-derived from a stale committed timing) — this
  script's only job is measuring MMS-FA's own achievable accuracy and cost,
  not prescribing how it gets windowed in production.
- **The segment windows come from a stale (base.en-era) committed timing.**
  See the note under "Exact invocation" above and the plan document's own
  caveat — this affects only how generous the window needs to be, not the
  word-onset-error scoring itself (which never reads segment timings, only
  `silences.json` and the aligner's own output).
- **English only, this run.** `uroman` and MMS-FA's acoustic model are both
  genuinely multilingual, and `--language` is threaded through and recorded
  in `meta_<label>.json` for provenance, but nothing non-English-specific
  has been exercised or verified by this script yet.
- **`with_star=True` is not a complete guarantee against neighbour-bleed on
  its own** — see the bug above. The midpoint clamp is what actually
  prevents it; do not remove the clamp on the assumption that `with_star`
  alone is sufficient.
- **Torch/torchaudio 2.2.2 is a pinned, aging release** (last with macOS
  x86_64 wheels). A future session on a different machine (Linux, or
  Apple-silicon macOS with newer torch) has no such constraint and may use a
  newer pinned pair — re-verify the API surface used here
  (`bundle.get_model(with_star=...)`, `TokenSpan.__len__`, `tokenizer.dictionary`)
  still matches if so; these are exactly the spots this script's own
  development hit version-specific surprises.
