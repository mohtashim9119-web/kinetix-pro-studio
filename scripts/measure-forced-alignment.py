#!/usr/bin/env python3
"""
measure-forced-alignment.py — Phase 3 forced-alignment (MMS-FA) measurement
(sync-pipeline-v2-plan.md, Part D Phase 3 / Blocker 2).

Committed for the same reason scripts/measure-word-onset.py was (Part K's K8):
a prior prototype session produced real artifacts at /tmp/phase3/ (tokens,
emissions, onset-error CSVs) but the driver script itself was never committed
and did not survive — the exact /tmp-loss pattern K8 already documents, one
programme phase later. This is that driver, rebuilt and committed so the
measurement is re-runnable without archaeology.

WHAT THIS MEASURES
Runs torchaudio's MMS_FA (Meta's multilingual forced-alignment bundle, built
on a wav2vec2-large-scale CTC acoustic model over a 28-symbol romanized
alphabet — see measure-forced-alignment.md for the license and model-choice
detail, Part H.3's Blocker 1) against a project's own already-committed
segments (script text + a rough startTime/duration per segment, read from a
project.json-shaped backup or a bare segments-array JSON), and produces
per-word {text, start, end, score} timestamps in exactly the shape
measure-word-onset.py's `score`/`report`/`check-word` subcommands already
consume (tokens_<label>.json + meta_<label>.json). Those subcommands are
REUSED UNCHANGED — this script's only job is the `align` step (the
FA-specific equivalent of measure-word-onset.py's `transcribe`), reusing that
script's `prepare` step as-is (ffmpeg transcode + silencedetect ground truth
is audio-only and model-independent — there is nothing FA-specific to redo
there).

WHY PER-SEGMENT WINDOWED ALIGNMENT, NOT ONE ALIGNMENT PASS OVER THE WHOLE FILE
Empirically measured (not assumed) before writing this: a single forward
pass over a 62s clip of V6's audio took 15-30s wall-clock on this machine
(no GPU backend, matching H.9's own finding) — self-attention cost scales
worse than linearly with sequence length. A single pass over V6's full
1421.3s would require ~71,000 frames of self-attention per layer per head
(24 layers, 16 heads in this model) and is not tractable on this machine.
Forced alignment is therefore run per-project-segment, each against a
padded window of the audio around that segment's own already-committed
startTime/duration (padding governs how much timestamp drift in the
INPUT window the aligner can tolerate before losing real speech off the
edge — this is a measurement-time convenience, not a claim about how a
future production windowing strategy should work; that is Rust-integration
scope, out of this phase).

Each segment's own text is aligned independently against its own window,
so results are exact regardless of window overlap between neighbours;
`with_star=True` (MMS-FA's built-in wildcard/"garbage" token) absorbs
real speech inside the padding that does not belong to this segment's own
transcript, which is what keeps a generous pad from stealing a
neighbour's words.

DEPENDENCIES (not stdlib — see measure-forced-alignment.md for exact setup)
torch==2.2.2, torchaudio==2.2.2 (the last release with macOS x86_64/Intel
wheels — this machine has no GPU backend either way, matching every other
measurement in this document), numpy<2 (ABI match for torch 2.2.2),
uroman (the real Meta/ISI uroman romanizer package, not a hand-rolled
ASCII-fold — verified against the real tool per H.3's own instruction not
to implement from recall).
"""

import argparse
import json
import resource
import sys
import time
from pathlib import Path


def load_segments(path: Path) -> list:
    """Accepts either a project.json-shaped file ({"segments": [...]}) or a
    bare segments-array JSON ([...]), each element carrying at least `text`,
    `startTime`, `duration`. Returns segments in script order, each tagged
    with a 1-based `display_order` — preferring a real `order` field
    (project.json's VideoSegment.order is already 1-based) and falling back
    to `i + 1` (the bare-array convenience export's 0-based `i` field) or
    plain array position, so "segment N" in this script's output always
    matches the plan document's own 1-based convention."""
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


def build_aligner(language: str):
    """Loads the MMS_FA bundle once. Returns (model, tokenizer, aligner,
    romanizer, valid_chars, sample_rate). `language` is accepted and
    recorded in this run's meta for provenance (Contract 1->2 P7 — "the
    timing source that produced the timestamps is identified on the
    output") but does not change behaviour today: uroman romanizes without
    requiring a language hint for the languages this program supports
    (H.0), and MMS_FA's acoustic model and CTC vocabulary are the same
    regardless of language — see H.3's amendment on why this is still the
    correct shape for the Stage 1 timing-source interface
    (language -> model, vocab, decode strategy) even though only one point
    in that space (MMS-FA) is exercised here."""
    import torch
    import torchaudio
    import uroman

    torch.set_num_threads(max(8, __import__("os").cpu_count() or 8))
    bundle = torchaudio.pipelines.MMS_FA
    model = bundle.get_model(with_star=True)
    model.eval()
    tokenizer = bundle.get_tokenizer()
    aligner = bundle.get_aligner()
    romanizer = uroman.Uroman()
    valid_chars = set(tokenizer.dictionary.keys()) - {"-", "*"}
    return model, tokenizer, aligner, romanizer, valid_chars, bundle.sample_rate


def normalize_word(word: str, romanizer, valid_chars: set) -> str:
    """Romanizes then keeps only characters in MMS_FA's 27-letter+apostrophe
    alphabet (its CTC vocabulary has no punctuation, digits, or hyphen — the
    literal '-' key in its dictionary is the CTC blank symbol, not a
    printable hyphen). A word that normalizes to nothing (pure punctuation,
    a bare digit run with no letters, etc.) is dropped by the caller and
    counted in `dropped_unrepresentable`, mirroring production's own
    filterMalformedTokens empty-normalized-text drop reason
    (whisperService.ts) rather than silently feeding the aligner an empty
    token list for that word."""
    return "".join(c for c in romanizer.romanize_string(word).lower() if c in valid_chars)


def align_segment(model, tokenizer, aligner, romanizer, valid_chars, sample_rate,
                   waveform, audio_duration_sec: float, segment: dict, pad_sec: float,
                   floor_bound: float, ceil_bound: float):
    """Aligns one segment's own text against a padded window of the audio
    around its own committed startTime/duration. Returns
    (word_records, dropped_words, elapsed_sec, error_or_None).

    `floor_bound`/`ceil_bound` are the midpoints to this segment's immediate
    neighbours (or 0 / audio_duration_sec at the ends) — the window is
    clamped to never cross them. Measured necessity, not defensive
    programming: an early flat-pad version of this function (no clamp) let
    a dense segment's window reach into a NEIGHBOUR's own real speech that
    isn't in this segment's transcript at all; with_star's wildcard token
    did not reliably absorb it, and a handful of words were assigned
    timestamps landing inside the neighbour's territory, including runs
    backwards in time relative to the segment's own preceding words.
    Clamping to the inter-segment midpoint removes the possibility by
    construction — the padding's job was only ever to cover this segment's
    OWN boundary-timing uncertainty, never to reach a neighbour's content."""
    import torch

    lo = max(0.0, segment["startTime"] - pad_sec, floor_bound)
    hi = min(audio_duration_sec, segment["startTime"] + segment["duration"] + pad_sec, ceil_bound)
    clip = waveform[:, int(lo * sample_rate): int(hi * sample_rate)]
    if clip.shape[1] < sample_rate * 0.05:
        return [], [w for w in segment["text"].split()], 0.0, None

    words_raw = segment["text"].split()
    pairs = [(w, normalize_word(w, romanizer, valid_chars)) for w in words_raw]
    dropped = [w for w, r in pairs if not r]
    pairs = [(w, r) for w, r in pairs if r]
    if not pairs:
        return [], dropped, 0.0, None

    words = [w for w, _ in pairs]
    romanized = [r for _, r in pairs]

    t0 = time.perf_counter()
    with torch.inference_mode():
        emission, _ = model(clip)
        tokens = tokenizer(romanized)
        try:
            token_spans = aligner(emission[0], tokens)
        except RuntimeError as e:
            # CTC forced_align requires enough emission frames for the target
            # sequence (target length plus required blank-separator frames
            # for immediately-repeated symbols) -- measured necessity, not
            # defensive programming: hit for real on V6 (a mid-corpus segment
            # whose window, per this codebase's own gapless-committed-segment
            # invariant (CLAUDE.md Key Invariant (f) -- adjacent segments
            # already satisfy startTime[i]+duration[i]==startTime[i+1], so
            # the neighbour-midpoint clamp above degenerates to ZERO padding
            # for every interior segment in this corpus) was too short for
            # its own text once the neighbour-bleed fix removed the padding
            # that had been masking it. Skipped, not crashed -- matches this
            # codebase's own established philosophy (filterMalformedTokens,
            # the coverage gate, silence-scan-error fallback) of never
            # aborting a whole run over one segment's bad input.
            elapsed = time.perf_counter() - t0
            return [], words, elapsed, str(e)
    elapsed = time.perf_counter() - t0

    num_frames = emission.size(1)
    ratio = clip.size(1) / num_frames / sample_rate  # seconds per frame, this window
    records = []
    for word, spans in zip(words, token_spans):
        total_len = sum(len(s) for s in spans)
        score = (sum(s.score * len(s) for s in spans) / total_len) if total_len else 0.0
        records.append({
            "text": word,
            "start": round(lo + spans[0].start * ratio, 3),
            "end": round(lo + spans[-1].end * ratio, 3),
            "score": round(score, 4),
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
    print(f"[align:{args.label}] loaded {len(segments)} segments from {args.segments_json}", file=sys.stderr)

    run_start = time.perf_counter()
    model, tokenizer, aligner, romanizer, valid_chars, sample_rate = build_aligner(args.language)
    model_load_elapsed = time.perf_counter() - run_start
    print(f"[align:{args.label}] model loaded in {model_load_elapsed:.2f}s", file=sys.stderr)

    waveform, sr = torchaudio.load(str(wav_path))
    if sr != sample_rate:
        sys.exit(f"error: {wav_path} is {sr}Hz, MMS_FA expects {sample_rate}Hz — re-run `prepare`")
    audio_duration_sec = waveform.shape[1] / sr

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
            model, tokenizer, aligner, romanizer, valid_chars, sample_rate,
            waveform, audio_duration_sec, seg, args.pad_sec, floor_bound, ceil_bound,
        )
        for r in records:
            r["seg"] = seg["display_order"]
        all_words.extend(records)
        if dropped:
            all_dropped.append({"seg": seg["display_order"], "words": dropped})
        if error:
            all_failed.append({"seg": seg["display_order"], "text": seg["text"], "error": error})
            print(f"[align:{args.label}] WARNING seg {seg['display_order']} failed to align, skipped: {error}", file=sys.stderr)
        per_segment_elapsed.append(elapsed)
        if seg["display_order"] % 50 == 0:
            print(f"[align:{args.label}] ... segment {seg['display_order']}/{len(segments)}, "
                  f"{sum(per_segment_elapsed):.1f}s elapsed so far", file=sys.stderr)

    total_elapsed = time.perf_counter() - run_start
    peak_rss_bytes = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss  # bytes on macOS

    (workdir / f"tokens_{args.label}.json").write_text(json.dumps(all_words, indent=2))

    meta = {
        "label": args.label,
        "cmd": ["measure-forced-alignment.py", "align", "--segments-json", str(args.segments_json)],
        "elapsed_sec": total_elapsed,
        "model_load_sec": model_load_elapsed,
        "align_only_sec": sum(per_segment_elapsed),
        "peak_rss_bytes": peak_rss_bytes,
        "returncode": 0,
        "token_count": len(all_words),
        "segment_count": len(segments),
        "failed_segments": all_failed,
        "model": "torchaudio MMS_FA (mling_uroman, with_star=True)",
        "torch_version": torch.__version__,
        "torchaudio_version": torchaudio.__version__,
        "pad_sec": args.pad_sec,
        "language": args.language,
        "dropped_unrepresentable": all_dropped,
    }
    (workdir / f"meta_{args.label}.json").write_text(json.dumps(meta, indent=2))

    print(f"[align:{args.label}] done. elapsed={total_elapsed:.1f}s "
          f"(model_load={model_load_elapsed:.1f}s, align_only={sum(per_segment_elapsed):.1f}s) "
          f"peak_rss={peak_rss_bytes / (1024**3):.2f}GiB words={len(all_words)} "
          f"dropped_segments_with_unrepresentable_words={len(all_dropped)} "
          f"failed_segments={len(all_failed)}", file=sys.stderr)
    print(f"-> {workdir / f'tokens_{args.label}.json'}", file=sys.stderr)
    print(f"-> {workdir / f'meta_{args.label}.json'}", file=sys.stderr)


def build_parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)

    pa = sub.add_parser("align", help="run MMS-FA over a prepared workdir's audio using a project's own committed segments as alignment windows")
    pa.add_argument("--workdir", required=True, help="must already contain audio_16k.wav (measure-word-onset.py's `prepare` step)")
    pa.add_argument("--segments-json", required=True, help="a project.json-shaped file ({'segments': [...]})  or a bare segments-array JSON, each element carrying text/startTime/duration")
    pa.add_argument("--label", required=True, help="short config tag, e.g. fa")
    pa.add_argument("--language", default="en")
    pa.add_argument("--pad-sec", type=float, default=3.0,
                     help="seconds of audio padded onto each side of a segment's own committed [startTime, startTime+duration) window before aligning — a measurement-time convenience, not a production windowing strategy")
    pa.set_defaults(func=cmd_align)

    return p


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
