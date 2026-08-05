# measure-forced-alignment-hf — Phase 3 follow-up, Task 2 (commercial-license de-risking)

Companion to `scripts/measure-forced-alignment-hf.py`. Committed for the same
reason `scripts/measure-forced-alignment.py` and `scripts/measure-word-onset.py`
were (Part K's K8): this is a real, reusable measurement, not a scratch
experiment, and this codebase's own established discipline is to never let a
driver script live only in `/tmp`.

## Why this script exists

`docs/sync-pipeline-v2-plan.md`'s Phase 3 entry, Blocker 1, found MMS-FA
(torchaudio's `MMS_FA` bundle, measured in `measure-forced-alignment.py`) to
be **CC-BY-NC-4.0** — usable for this measurement programme, not for a
commercial ship of the app. Blocker 1 named two unadopted commercial-license
candidates: `jonatasgrosman`'s per-language `wav2vec2-large-xlsr-53`
fine-tunes (Apache-2.0) and `nvidia/parakeet-tdt-0.6b-v3` (commercially
licensed, CTC-extractability unverified, out of scope here). This script
measures the first candidate — `jonatasgrosman/wav2vec2-large-xlsr-53-english`
— to find out whether the commercial path is viable at all before any
integration work is considered.

## Model verification performed before this script was written

The bare Meta `wav2vec2-large-xlsr-53` pretrain checkpoint (Blocker 1's other
finding) has **no CTC head at all** — it is a self-supervised feature
extractor. `jonatasgrosman/wav2vec2-large-xlsr-53-english` is a genuinely
different artifact, confirmed directly (not from recall) before any weights
were downloaded:

- `config.json`: `"architectures": ["Wav2Vec2ForCTC"]`, `vocab_size: 33`,
  `pad_token_id: 0` (blank).
- `vocab.json`: a real 33-symbol CTC alphabet — `<pad>`/`<s>`/`</s>`/`<unk>`,
  `|` (word delimiter), `'`, `-`, and `a`-`z`. This is the standard
  wav2vec2-CTC English alphabet, not a placeholder.
- HF Hub API tags: `license:apache-2.0`.
- The downloaded weight blob (`pytorch_model.bin`, resolved via `transformers`'
  own cache) is **1,261,942,732 bytes** — confirmed by direct
  `os.path.getsize` on the cached blob after `from_pretrained` completed, not
  assumed from a listing.
- **Live usable-CTC-head check**: loaded the model and ran a greedy CTC
  decode (`argmax` over logits, no forced alignment) on the first 5 seconds
  of project 173's own `audio_16k.wav`. Output: *"some places in the
  forty-first millennium don't just kill soldiers they take up"* — an
  accurate transcription of project 173's actual first two segments ("Some
  places in the 41st Millennium don't just kill soldiers." / "They take
  apart the conditions...", the second cut short by the 5s window and the
  model's lack of digit-reading turning "41st" into a phonetic "forty-first").
  This proves the CTC head produces real, usable output on this corpus's own
  audio, not just that the model object loads without error.

**One load-time warning, investigated rather than ignored**: transformers
reports `wav2vec2.encoder.pos_conv_embed.conv.weight_g`/`weight_v` as unused
and the `...parametrizations.weight.original0`/`original1` equivalents as
newly-initialized. This is a torch/transformers-version weight-norm
reparametrization NAMING mismatch (the checkpoint was saved under the older
`weight_g`/`weight_v` convention; this transformers/torch pairing expects the
newer `parametrizations.weight` naming), affecting exactly one positional
convolutional embedding layer inside the encoder — not the CTC head and not
the bulk of the acoustic model's weights. The greedy-decode sanity check
above still produced accurate, coherent transcription with this warning
present, so it does not appear to meaningfully degrade usable accuracy on
this corpus. Flagged here, not silently absorbed, so a future session on a
different transformers/torch pairing knows what to compare its own load
warnings (or lack thereof) against.

## What this measures, and what it reuses unchanged

Same shape as `measure-forced-alignment.py`: per-segment windowed alignment
against a project's own already-committed `[startTime, startTime+duration)`
spans (padded by `--pad-sec`, clamped to the neighbour-midpoint so no two
segments' windows can overlap — identical clamp logic, ported as-is), text
normalized to the model's own alphabet (lowercase, keep only `a-z'-`, drop
words that normalize to nothing), and the SAME `measure-word-onset.py`
`prepare`/`score`/`report`/`check-word` subcommands consume its
`tokens_<label>.json`/`meta_<label>.json` output completely unchanged — so
the two models' numbers are directly comparable on identical ground truth
(`silences.json`) and identical windowing logic.

**Only the alignment mechanics differ.** MMS-FA romanizes text via `uroman`
and uses `torchaudio.pipelines.MMS_FA`'s own bundled `aligner` object. This
script instead builds a flat `word1|word2|word3` character-id target
sequence directly against this model's own 33-symbol vocabulary and calls
`torchaudio.functional.forced_align` on the model's own log-softmax output —
the same underlying CTC forced-alignment primitive `MMS_FA`'s aligner wraps
internally, applied to a different acoustic model's emissions. This is the
standard pattern from
[torchaudio's own CTC forced-alignment tutorial](https://pytorch.org/audio/stable/tutorials/ctc_forced_alignment_api_tutorial.html).
Per-word spans are recovered by merging the raw frame-level CTC path
(collapsing blanks and repeats) and splitting on the `|` word-delimiter
token — again the tutorial's own `merge_tokens` + word-grouping approach, not
a novel decode method. Per-word confidence is the average per-frame log-prob
across the word's own span, exponentiated back into MMS-FA's `[0,1]`
convention for direct comparability.

## Setup

Same pin as `measure-forced-alignment.py` (`python3.11`, `torch==2.2.2`,
`torchaudio==2.2.2`, `numpy<2` — last macOS-x86_64/Intel wheels), plus:

```bash
pip install "transformers==4.40.2"
```

**Do not `pip install transformers` unpinned.** A fresh install on this
machine resolved `transformers==5.14.1`, which prints `Disabling PyTorch
because PyTorch >= 2.4 is required but found 2.2.2` and silently drops all
model-loading capability (tokenizer/config utilities only) — confirmed
empirically, not assumed. `4.40.2` is a real, tested-working pin against
`torch==2.2.2` on this machine.

The model downloads on first use via `from_pretrained` (~1.2GB, cached under
`HF_HOME`, defaulted here to `/tmp/hf-cache` — override via the `HF_HOME` env
var if a persistent cache location is wanted).

## Exact invocation used for the Task 2 measurement (2026-08-05)

Project 173 only, per instruction — this candidate did not warrant the full
V6 run at this stage.

```bash
SCRIPT="scripts/measure-forced-alignment-hf.py"
SCORE_SCRIPT="scripts/measure-word-onset.py"   # score/report reused unchanged

P173_DIR="/tmp/phase3/173"   # already has audio_16k.wav + silences.json
                              # (measure-word-onset.py's own `prepare` step,
                              # reused as-is — audio-only, model-independent)
P173_SEGMENTS="/Users/mohtashim/Downloads/All Projects Test Data/Projects Backend Data/project.json"

/usr/bin/time -l python3 "$SCRIPT" align --workdir "$P173_DIR" --segments-json "$P173_SEGMENTS" --label hf --language en

python3 "$SCORE_SCRIPT" score  --workdir "$P173_DIR" --label hf --out-csv "$P173_DIR/onset_errors_hf.csv"
python3 "$SCORE_SCRIPT" report --workdir "$P173_DIR" --labels fa2,hf

cp "$P173_DIR/onset_errors_hf.csv" docs/phase3-onset-173-hf.csv
```

## Results (173, side by side with MMS-FA's own `fa2` run)

See `docs/sync-pipeline-v2-plan.md`'s Phase 3 entry for the full table and
gate-relevant discussion. Summary: median and p95 both within ~10-20ms of
MMS-FA's own numbers (noise-level on this project), zero zero-duration
tokens (clean pass, same as MMS-FA), wall-clock ~29% slower than MMS-FA on
this run, peak RSS measurably LOWER than MMS-FA's (a smaller, monolingual
model with no romanizer/multilingual-vocab overhead).

## Update (Phase 3->4 handoff, 2026-08-06) — `--model-id`, V6 and Spanish measured

`build_aligner`/`cmd_align` now take a `--model-id` CLI parameter (default:
`MODEL_ID`, the English fine-tune above — every prior invocation of this
script is byte-unaffected) so a different per-language `jonatasgrosman`
fine-tune can be measured without duplicating this file. Used to run:

```bash
# V6 — same stale v6-segments-full.json windows the original V6 MMS-FA run
# used, for a true apples-to-apples comparison on identical boundaries.
python3 "$SCRIPT" align --workdir /tmp/phase3/v6 \
  --segments-json "/Users/mohtashim/Downloads/All Projects Test Data/Projects Backend Data/v6-segments-full.json" \
  --label hf --language en

# Spanish — jonatasgrosman/wav2vec2-large-xlsr-53-spanish, against Step M's
# own freshly-committed segment timings (see docs/phase4-baseline-methodology.md).
python3 "$SCRIPT" align --workdir /tmp/phase3/spanish \
  --segments-json /tmp/phase3/spanish/spanish-segments.json \
  --label hf --language es --model-id jonatasgrosman/wav2vec2-large-xlsr-53-spanish
```

V6: median 25.8ms / p95 400.8ms / negative-smear 49.7% / 0 zero-duration
tokens — within noise of MMS-FA's own V6 numbers (21.2ms/476ms/49.0%), and
**both models independently fail on the identical segment (320)**, the same
CTC-constraint-violation defect Blocker 2 already found — model-agnostic
confirmation it is a pre-existing committed-duration bug, not an aligner
artifact. Spanish: see `docs/sync-pipeline-v2-plan.md`'s Phase 3->4 handoff
entry (Step N.2) for the completed figures, or the disclosed download-time
gap if the session ended first — the Spanish-language model weight (~1.2GB)
required a cold download that repeatedly stalled on this network and needed
a retry-hardened `curl` fallback (see that entry's own note).

## Known limitations, stated plainly

- **English only, originally** (see the Update above for the Spanish run).
  This model family is one fine-tune per language by construction
  (`jonatasgrosman`) — H.0's other three still-unmeasured supported languages
  (French, Portuguese, German) would each need their own per-language model
  download, unlike MMS-FA's single multilingual checkpoint. This is the
  direct cost of the commercial-license trade: **~1.2GB × 5 languages ≈ 6GB**
  total, versus MMS-FA's one ~1.2GB multilingual checkpoint.
- **Digit-reading is absent**, same limitation class as MMS-FA's own
  romanization gaps but different in kind: a word with digits (e.g. "41st")
  is not dropped outright, it degrades silently to whatever letters survive
  char-filtering (e.g. "st") — a real, if minor, accuracy cost on any script
  segment containing a written-digit number, unaddressed by production's own
  `NUMBER_WORDS` normalization layer, which this measurement does not invoke.
- **The `pos_conv_embed` load-time reinit** (see above) was judged
  non-catastrophic by a single greedy-decode spot check, not a rigorous
  ablation — a future session with more time budget could compare against a
  torch/transformers pairing that loads the checkpoint's weight-norm
  parameters cleanly, if one is found, to quantify the actual cost (if any).
- **Per-segment windowing inherits the same measurement-vs-production gap**
  `measure-forced-alignment.md` already documents for MMS-FA: the committed
  segment timings used as alignment windows are base.en-era and may
  themselves be stale, and a real production windowing strategy is
  Rust-integration scope, out of this phase.
