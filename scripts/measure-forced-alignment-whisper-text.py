#!/usr/bin/env python3
"""
measure-forced-alignment-whisper-text.py — Phase 3 data-cleaning pass, Step 4
(sync-pipeline-v2-plan.md).

"Whisper-text mode": instead of aligning each committed segment's SCRIPT text
(measure-forced-alignment.py's normal mode, used everywhere else in Phase 3)
against its own audio window, this aligns WHISPER TURBO'S OWN TRANSCRIBED
WORDS for that same time window — i.e. FA refines Whisper's timestamps for
whatever Whisper itself believed was said, rather than assuming the narrator
read the script verbatim. This is the candidate SAFE DEFAULT for drifted
audio (script-text mode forces FA to place words nobody spoke, which is only
sound on content already verified faithful to its script — see Step 4's WER/
CER classification pass).

Reuses measure-forced-alignment.py's build_aligner/align_segment unchanged;
only the per-segment TEXT source differs (Whisper's own transcript, windowed
by timestamp, instead of segments[i].text).

INPUT: a project's committed segments (project.json-shaped or bare array,
for per-segment startTime/duration timing only) plus the FULL Whisper turbo
transcript for the same audio, as a flat JSON array of {text, start, end}
tokens (see this repo's scripts/fixtures/*-Smear-Phase2a.csv transcript-inspector
exports — parse_full_transcript in this script's own test/companion .md
documents the exact extraction, since those CSVs embed the complete token
list inside a second, console-log-dump section rather than their capped
1000-row UI table).

OUTPUT: tokens_wtext.json, meta_wtext.json — same shape as
measure-forced-alignment.py's own `align` output, directly consumable by
measure-word-onset.py's `score`/`report` subcommands unchanged.
"""
import argparse
import json
import sys
import time
import importlib.util
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("mfa", _THIS_DIR / "measure-forced-alignment.py")
mfa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mfa)


def load_segments(path: Path) -> list:
    data = json.loads(path.read_text())
    segs = data["segments"] if isinstance(data, dict) and "segments" in data else data
    for pos, s in enumerate(segs):
        s["_sort_key"] = s.get("order", s.get("i", pos))
    return sorted(segs, key=lambda s: s["_sort_key"])


def whisper_text_for_window(whisper_tokens: list, lo: float, hi: float) -> str:
    """Concatenates every Whisper token whose declared START falls within
    [lo, hi) — i.e. "whatever Whisper transcribed during this segment's own
    committed time window," used as the alignment target text in place of
    the script. Can legitimately be empty (a segment Whisper transcribed
    nothing for at all, e.g. a content dropout) — the caller must handle
    that (mfa.align_segment already no-ops on empty text)."""
    return " ".join(t["text"] for t in whisper_tokens if lo <= t["start"] < hi)


def run(segments_json: str, whisper_tokens_json: str, workdir: str, label: str,
        language: str = "en", pad_sec: float = 3.0):
    workdir = Path(workdir)
    wav_path = workdir / "audio_16k.wav"
    if not wav_path.exists():
        sys.exit(f"error: {wav_path} not found — run measure-word-onset.py's `prepare` first")

    import torch
    import torchaudio

    segs = load_segments(Path(segments_json))
    n = len(segs)
    whisper_tokens = json.loads(Path(whisper_tokens_json).read_text())
    print(f"[{label}] {n} segments, {len(whisper_tokens)} whisper tokens", file=sys.stderr)

    model, tokenizer, aligner, romanizer, valid_chars, sample_rate = mfa.build_aligner(language)
    waveform, sr = torchaudio.load(str(wav_path))
    if sr != sample_rate:
        sys.exit(f"error: {wav_path} is {sr}Hz, MMS_FA expects {sample_rate}Hz")
    audio_duration_sec = waveform.shape[1] / sr

    all_words, all_failed, empty_segments = [], [], []
    t_start = time.perf_counter()
    for idx, seg in enumerate(segs):
        start_time = float(seg["startTime"])
        duration = float(seg["duration"])
        prev_end = float(segs[idx - 1]["startTime"]) + float(segs[idx - 1]["duration"]) if idx > 0 else 0.0
        floor_bound = (prev_end + start_time) / 2.0 if idx > 0 else 0.0
        if idx + 1 < n:
            next_start = float(segs[idx + 1]["startTime"])
            ceil_bound = (start_time + duration + next_start) / 2.0
        else:
            ceil_bound = audio_duration_sec

        whisper_text = whisper_text_for_window(whisper_tokens, start_time, start_time + duration)
        if not whisper_text.strip():
            empty_segments.append(idx)
            continue
        pseudo_seg = {"text": whisper_text, "startTime": start_time, "duration": duration}

        records, dropped, elapsed, error = mfa.align_segment(
            model, tokenizer, aligner, romanizer, valid_chars, sample_rate,
            waveform, audio_duration_sec, pseudo_seg, pad_sec, floor_bound, ceil_bound,
        )
        for r in records:
            r["seg"] = idx
        all_words.extend(records)
        if error:
            all_failed.append({"seg": idx, "error": error})
        if idx % 50 == 0:
            print(f"[{label}] ... {idx}/{n}, {time.perf_counter() - t_start:.1f}s elapsed", file=sys.stderr)

    total_elapsed = time.perf_counter() - t_start
    print(f"[{label}] done. {total_elapsed:.1f}s, {len(all_words)} words, "
          f"{len(empty_segments)} segments with zero whisper text, {len(all_failed)} failed", file=sys.stderr)

    (workdir / f"tokens_{label}.json").write_text(json.dumps(all_words, indent=2))
    meta = {
        "label": label, "mode": "whisper-text", "elapsed_sec": total_elapsed,
        "empty_segments": empty_segments, "failed_segments": all_failed,
        "token_count": len(all_words), "segment_count": n, "language": language, "pad_sec": pad_sec,
    }
    (workdir / f"meta_{label}.json").write_text(json.dumps(meta, indent=2))
    print(f"-> {workdir / f'tokens_{label}.json'}", file=sys.stderr)


def build_parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--segments-json", required=True)
    p.add_argument("--whisper-tokens-json", required=True,
                    help="flat JSON array of {text,start,end} — the full (not UI-capped) Whisper turbo "
                         "transcript for this project's audio")
    p.add_argument("--workdir", required=True, help="must already contain audio_16k.wav")
    p.add_argument("--label", required=True)
    p.add_argument("--language", default="en")
    p.add_argument("--pad-sec", type=float, default=3.0)
    return p


if __name__ == "__main__":
    args = build_parser().parse_args()
    run(args.segments_json, args.whisper_tokens_json, args.workdir, args.label, args.language, args.pad_sec)
