#!/usr/bin/env python3
"""
measure-forced-alignment-hf.py — Phase 3 follow-up, Task 2 (2026-08-05):
de-risking the commercial forced-alignment path.

MMS-FA (torchaudio's MMS_FA bundle, measured in measure-forced-alignment.py)
is CC-BY-NC-4.0 and cannot ship. This measures the commercial-license
alternative named in the plan doc's Blocker 1 as unadopted-but-candidate:
jonatasgrosman/wav2vec2-large-xlsr-53-english (Apache-2.0). Verified before
this script was written (not assumed) that it exposes a real, usable CTC
head — config.json's architectures=['Wav2Vec2ForCTC'], a real 33-symbol
vocab (a-z, apostrophe, hyphen, word-delimiter '|', blank/specials), and a
live load + greedy-decode sanity check against project 173's own audio
producing an accurate transcription of the actual script — unlike the bare
Meta wav2vec2-large-xlsr-53 pretrain checkpoint Blocker 1 already ruled out
(no CTC head at all). Full verification record: docs/sync-pipeline-v2-plan.md's
Phase 3 entry, Blocker 1 de-risking addendum.

KNOWN, BENIGN LOAD WARNING: transformers reports
'wav2vec2.encoder.pos_conv_embed.conv.weight_g/weight_v' as unused and
'...parametrizations.weight.original0/original1' as newly-initialized on
load. This is a torch/transformers-version weight-norm reparametrization
naming mismatch (old weight_g/weight_v vs. torch's newer parametrize API),
not a missing-CTC-head problem — it affects exactly one positional
convolutional embedding layer, not the CTC head or the acoustic encoder's
main weights. The greedy-decode sanity check above still produced accurate,
coherent transcription with this warning present, so it does not appear to
meaningfully degrade usable accuracy on this corpus — flagged here rather
than silently ignored, since a future session on different transformers/torch
versions may see the resolved (or a differently-broken) load and should know
this is what to compare against.

Deliberately mirrors scripts/measure-forced-alignment.py's `align` subcommand
almost exactly -- same --workdir/--segments-json/--label/--language/--pad-sec
CLI, same per-segment windowed alignment with the same neighbour-midpoint
clamp (measure-forced-alignment.md's neighbour-bleed fix), same
tokens_<label>.json/meta_<label>.json output shape -- so
measure-word-onset.py's score/report subcommands consume it UNCHANGED and the
two models' numbers are directly comparable apples-to-apples on identical
ground truth (silences.json) and identical windowing logic.

Only the model backend differs: instead of MMS_FA's romanized 28-symbol
multilingual CTC vocab + torchaudio.pipelines' bundled aligner, this loads
transformers' Wav2Vec2ForCTC/Wav2Vec2Processor for the named model and calls
torchaudio.functional.forced_align directly on its own log-softmax output --
the same underlying CTC forced-alignment primitive MMS_FA's own aligner
wraps, applied to a different acoustic model's emissions (this is the
standard pattern from torchaudio's own CTC forced-alignment tutorial).
English-only text normalization: lowercase, keep only this model's own
alphabet (a-z, ', -), word-delimiter '|' between words. A word that
normalizes to nothing (pure digits/punctuation, e.g. "41st") is dropped and
counted, exactly mirroring measure-forced-alignment.py's
dropped_unrepresentable handling for MMS-FA's romanization gaps -- unlike
MMS-FA's romanizer, this model's alphabet keeps LETTER-CONTAINING words that
merely have digits stripped (e.g. "41st" -> "st"), which is a silently
degraded target, not a dropped one — a real limitation of a model with no
digit-reading capability absent production's own NUMBER_WORDS normalization
layer (out of scope for this measurement), stated here rather than hidden.

DEPENDENCIES: same torch==2.2.2/torchaudio==2.2.2 pin as
measure-forced-alignment.py (last macOS-x86_64 wheels), plus
transformers==4.40.2 (a version still compatible with torch 2.2.2 — a fresh
`pip install transformers` on this machine resolved 5.14.1, which silently
DISABLES its own PyTorch backend because it requires torch>=2.4; pin an
older release explicitly rather than trusting an unpinned install).
"""

import argparse
import json
import math
import os
import resource
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HOME", "/tmp/hf-cache")

MODEL_ID = "jonatasgrosman/wav2vec2-large-xlsr-53-english"


def load_segments(path: Path) -> list:
    data = json.loads(path.read_text())
    segments = data["segments"] if isinstance(data, dict) and "segments" in data else data
    out = []
    for pos, seg in enumerate(segments):
        display_order = seg.get("order", seg.get("i", pos) + (0 if "order" in seg else 1))
        out.append({
            "display_order": display_order,
            "text": seg["text"],
            "startTime": float(seg["startTime"]),
            "duration": float(seg["duration"]),
        })
    return out


def build_aligner():
    import torch
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

    torch.set_num_threads(max(8, os.cpu_count() or 8))
    processor = Wav2Vec2Processor.from_pretrained(MODEL_ID)
    model = Wav2Vec2ForCTC.from_pretrained(MODEL_ID)
    model.eval()
    vocab = processor.tokenizer.get_vocab()
    blank_id = processor.tokenizer.pad_token_id
    word_delim_id = processor.tokenizer.word_delimiter_token_id
    valid_chars = {c for c in vocab if len(c) == 1 and c.isalpha()} | {"'", "-"}
    sample_rate = processor.feature_extractor.sampling_rate
    return model, processor, vocab, blank_id, word_delim_id, valid_chars, sample_rate


def normalize_word(word: str, valid_chars: set) -> str:
    return "".join(c for c in word.lower() if c in valid_chars)


def merge_frame_path(path_ids: list, path_scores: list):
    """Collapse a raw frame-level CTC alignment path (one label per frame,
    including blanks and repeats) into (label, start_frame, end_frame_excl,
    avg_score) spans, one per non-blank symbol occurrence -- the standard
    CTC merge step (torchaudio's own forced-alignment tutorial names this
    `merge_tokens`)."""
    spans = []
    i = 0
    n = len(path_ids)
    while i < n:
        tok = path_ids[i]
        j = i
        while j < n and path_ids[j] == tok:
            j += 1
        if tok != 0:  # 0 == blank/pad
            avg = sum(path_scores[i:j]) / (j - i)
            spans.append((tok, i, j, avg))
        i = j
    return spans


def align_segment(model, processor, vocab, blank_id, word_delim_id, valid_chars, sample_rate,
                   waveform, audio_duration_sec: float, segment: dict, pad_sec: float,
                   floor_bound: float, ceil_bound: float):
    import torch
    import torchaudio

    lo = max(0.0, segment["startTime"] - pad_sec, floor_bound)
    hi = min(audio_duration_sec, segment["startTime"] + segment["duration"] + pad_sec, ceil_bound)
    clip = waveform[:, int(lo * sample_rate): int(hi * sample_rate)]
    if clip.shape[1] < sample_rate * 0.05:
        return [], [w for w in segment["text"].split()], 0.0, None

    words_raw = segment["text"].split()
    pairs = [(w, normalize_word(w, valid_chars)) for w in words_raw]
    dropped = [w for w, r in pairs if not r]
    pairs = [(w, r) for w, r in pairs if r]
    if not pairs:
        return [], dropped, 0.0, None

    words = [w for w, _ in pairs]
    romanized = [r for _, r in pairs]

    # Build the flat char-id target sequence: word1 chars, '|', word2 chars, '|', ...
    target_ids = []
    word_boundaries = []  # (start_idx_in_target, end_idx_in_target) per word, END exclusive
    for wi, w in enumerate(romanized):
        start = len(target_ids)
        for ch in w:
            target_ids.append(vocab[ch])
        end = len(target_ids)
        word_boundaries.append((start, end))
        if wi != len(romanized) - 1:
            target_ids.append(word_delim_id)

    t0 = time.perf_counter()
    with torch.inference_mode():
        inputs = processor(clip.squeeze(0).numpy(), sampling_rate=sample_rate, return_tensors="pt")
        logits = model(inputs.input_values).logits  # [1, T, V]
        log_probs = torch.log_softmax(logits, dim=-1)
        targets = torch.tensor([target_ids], dtype=torch.int32)
        try:
            path, scores = torchaudio.functional.forced_align(log_probs, targets, blank=blank_id)
        except RuntimeError as e:
            elapsed = time.perf_counter() - t0
            return [], words, elapsed, str(e)
    elapsed = time.perf_counter() - t0

    path_ids = path[0].tolist()
    path_scores = scores[0].tolist()
    spans = merge_frame_path(path_ids, path_scores)  # [(tok_id, frame_start, frame_end, score), ...]

    num_frames = logits.size(1)
    ratio = clip.size(1) / num_frames / sample_rate

    # Map merged (non-blank) spans back onto target_ids positions in order --
    # spans excludes blanks but keeps every non-blank target occurrence
    # (including '|' word-delimiters) in the SAME order as target_ids, since
    # forced_align's path is monotonic in the target sequence.
    if len(spans) != len(target_ids):
        # A rare CTC-path degeneracy (e.g. an entirely dropped symbol at an
        # emission-length boundary) -- treat as a failed segment, matching
        # the MMS-FA script's own CTC-constraint-violation handling.
        elapsed = time.perf_counter() - t0
        return [], words, elapsed, (
            f"merged span count ({len(spans)}) != target length ({len(target_ids)}) "
            f"-- degenerate CTC path"
        )

    records = []
    for wi, (bstart, bend) in enumerate(word_boundaries):
        word_spans = spans[bstart:bend]
        frame_start = word_spans[0][1]
        frame_end = word_spans[-1][2]
        total_len = sum(s[2] - s[1] for s in word_spans)
        score = sum(s[3] * (s[2] - s[1]) for s in word_spans) / total_len if total_len else 0.0
        records.append({
            "text": words[wi],
            "start": round(lo + frame_start * ratio, 3),
            "end": round(lo + frame_end * ratio, 3),
            "score": round(math.exp(score), 4),  # score is an avg LOG prob; exp() to match MMS-FA's [0,1] convention
        })
    return records, dropped, elapsed, None


def cmd_align(args):
    import torch
    import torchaudio

    workdir = Path(args.workdir)
    wav_path = workdir / "audio_16k.wav"
    if not wav_path.exists():
        sys.exit(f"error: {wav_path} not found — run measure-word-onset.py's `prepare` first")

    segments = load_segments(Path(args.segments_json))
    print(f"[align-hf:{args.label}] loaded {len(segments)} segments from {args.segments_json}", file=sys.stderr)

    run_start = time.perf_counter()
    model, processor, vocab, blank_id, word_delim_id, valid_chars, sample_rate = build_aligner()
    model_load_elapsed = time.perf_counter() - run_start
    print(f"[align-hf:{args.label}] model loaded in {model_load_elapsed:.2f}s", file=sys.stderr)

    waveform, sr = torchaudio.load(str(wav_path))
    if sr != sample_rate:
        waveform = torchaudio.functional.resample(waveform, sr, sample_rate)
    audio_duration_sec = waveform.shape[1] / sample_rate

    all_words = []
    all_dropped = []
    all_failed = []
    per_segment_elapsed = []
    n = len(segments)
    for idx, seg in enumerate(segments):
        prev_end = segments[idx - 1]["startTime"] + segments[idx - 1]["duration"] if idx > 0 else 0.0
        floor_bound = (prev_end + seg["startTime"]) / 2.0 if idx > 0 else 0.0
        if idx + 1 < n:
            next_start = segments[idx + 1]["startTime"]
            ceil_bound = (seg["startTime"] + seg["duration"] + next_start) / 2.0
        else:
            ceil_bound = audio_duration_sec
        records, dropped, elapsed, error = align_segment(
            model, processor, vocab, blank_id, word_delim_id, valid_chars, sample_rate,
            waveform, audio_duration_sec, seg, args.pad_sec, floor_bound, ceil_bound,
        )
        for r in records:
            r["seg"] = seg["display_order"]
        all_words.extend(records)
        if dropped:
            all_dropped.append({"seg": seg["display_order"], "words": dropped})
        if error:
            all_failed.append({"seg": seg["display_order"], "text": seg["text"], "error": error})
            print(f"[align-hf:{args.label}] WARNING seg {seg['display_order']} failed to align, skipped: {error}", file=sys.stderr)
        per_segment_elapsed.append(elapsed)
        if seg["display_order"] % 50 == 0:
            print(f"[align-hf:{args.label}] ... segment {seg['display_order']}/{len(segments)}, "
                  f"{sum(per_segment_elapsed):.1f}s elapsed so far", file=sys.stderr)

    total_elapsed = time.perf_counter() - run_start
    peak_rss_bytes = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss

    (workdir / f"tokens_{args.label}.json").write_text(json.dumps(all_words, indent=2))

    meta = {
        "label": args.label,
        "cmd": ["measure-forced-alignment-hf.py", "align", "--segments-json", str(args.segments_json)],
        "elapsed_sec": total_elapsed,
        "model_load_sec": model_load_elapsed,
        "align_only_sec": sum(per_segment_elapsed),
        "peak_rss_bytes": peak_rss_bytes,
        "returncode": 0,
        "token_count": len(all_words),
        "segment_count": len(segments),
        "failed_segments": all_failed,
        "model": f"transformers Wav2Vec2ForCTC ({MODEL_ID}, Apache-2.0)",
        "torch_version": torch.__version__,
        "torchaudio_version": torchaudio.__version__,
        "pad_sec": args.pad_sec,
        "language": args.language,
        "dropped_unrepresentable": all_dropped,
    }
    (workdir / f"meta_{args.label}.json").write_text(json.dumps(meta, indent=2))

    print(f"[align-hf:{args.label}] done. elapsed={total_elapsed:.1f}s "
          f"(model_load={model_load_elapsed:.1f}s, align_only={sum(per_segment_elapsed):.1f}s) "
          f"peak_rss={peak_rss_bytes / (1024**3):.2f}GiB words={len(all_words)} "
          f"dropped_segments_with_unrepresentable_words={len(all_dropped)} "
          f"failed_segments={len(all_failed)}", file=sys.stderr)
    print(f"-> {workdir / f'tokens_{args.label}.json'}", file=sys.stderr)
    print(f"-> {workdir / f'meta_{args.label}.json'}", file=sys.stderr)


def build_parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)

    pa = sub.add_parser("align")
    pa.add_argument("--workdir", required=True)
    pa.add_argument("--segments-json", required=True)
    pa.add_argument("--label", required=True)
    pa.add_argument("--language", default="en")
    pa.add_argument("--pad-sec", type=float, default=3.0)
    pa.set_defaults(func=cmd_align)

    return p


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
