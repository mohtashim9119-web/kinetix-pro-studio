#!/usr/bin/env python3
"""
measure-forced-alignment-joint-context.py — Phase 3 data-cleaning pass, Step 2
(sync-pipeline-v2-plan.md).

Re-measures a set of target segments using "Method 2" from the Blocker 2
follow-up (docs/sync-pipeline-v2-plan.md's Phase 3 entry — already validated
there on segments 144/80): one MMS-FA forward pass per GROUP of consecutive
segments, giving the aligner the full correct multi-segment text for the
group's own audio span, so there is no "neighbour" left for with_star to
bleed into. Deliberately NOT Method 1 (a flat, unclamped wide-padding bypass
of the neighbour-midpoint clamp) — that method was tried first and rejected:
it resolved 3 of 5 low-confidence cases cleanly but made segments 144/80
WORSE via with_star neighbour-bleed (confirmed: a re-aligned word landed
inside an adjacent segment's own committed span). Joint multi-segment context
removes the neighbour-bleed confound entirely, since there is no "neighbour"
outside the window — the window IS the neighbours, with their own real text.

Reuses measure-forced-alignment.py's build_aligner/normalize_word/align_segment
building blocks unchanged (imported directly, not reimplemented) so the
model/vocab/romanizer path is byte-identical to the committed per-segment
script; only the grouping and joint-text construction are new.

INPUT: a JSON array of target cases, each needing at minimum a `seg_i`
(0-based segment index) field — e.g. the failure rows filtered from a
measure-word-onset.py `score --out-csv` run, joined to committed segment
timings by which segment's [startTime, startTime+duration) window a scored
token's start falls inside. See measure-forced-alignment-joint-context.md
for the exact Phase 3 Step 2 invocation.

OUTPUT: tokens_<label>.json in the SAME {seg_i, pos, text, start, end,
score} per-word shape produced by every window's joint pass, keyed by
window range in a raw JSON dump AND flattened for direct re-scoring via
measure-word-onset.py's score_onset_errors against the same silences.json
ground truth used everywhere else in this document.
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
    # Same ordering precedence as measure-forced-alignment.py's load_segments:
    # a real 'order' field (project.json's VideoSegment.order, 1-based) first,
    # falling back to 'i' (bare-array convenience export, 0-based), then
    # plain array position.
    for pos, s in enumerate(segs):
        s["_sort_key"] = s.get("order", s.get("i", pos))
    return sorted(segs, key=lambda s: s["_sort_key"])


def build_windows(target_indices: list, n_segments: int, radius: int) -> list:
    """Merges overlapping ±radius windows around each target index into the
    minimal set of non-overlapping [lo, hi] ranges (0-based, inclusive)."""
    windows = []
    for idx in sorted(set(target_indices)):
        lo = max(0, idx - radius)
        hi = min(n_segments - 1, idx + radius)
        if windows and lo <= windows[-1][1] + 1:
            windows[-1] = (windows[-1][0], max(windows[-1][1], hi))
        else:
            windows.append((lo, hi))
    return windows


def cmd_align(args):
    import torch
    import torchaudio

    workdir = Path(args.workdir)
    wav_path = workdir / "audio_16k.wav"
    if not wav_path.exists():
        sys.exit(f"error: {wav_path} not found — run measure-word-onset.py's `prepare` first")

    segs = load_segments(Path(args.segments_json))
    n = len(segs)
    targets = json.loads(Path(args.targets_json).read_text())
    target_indices = [int(t["seg_i"]) for t in targets]
    print(f"[joint-context] {len(target_indices)} target cases", file=sys.stderr)

    windows = build_windows(target_indices, n, args.window_radius)
    print(f"[joint-context] {len(windows)} merged windows (radius={args.window_radius})", file=sys.stderr)
    for lo, hi in windows:
        span = segs[hi]["startTime"] + segs[hi]["duration"] - segs[lo]["startTime"]
        print(f"  segs {lo}..{hi} ({hi - lo + 1} segments, {span:.1f}s audio)", file=sys.stderr)

    print("[joint-context] building MMS-FA aligner...", file=sys.stderr)
    model, tokenizer, aligner, romanizer, valid_chars, sample_rate = mfa.build_aligner(args.language)
    print("[joint-context] loading full waveform...", file=sys.stderr)
    waveform, sr = torchaudio.load(str(wav_path))
    if sr != sample_rate:
        sys.exit(f"error: {wav_path} is {sr}Hz, MMS_FA expects {sample_rate}Hz")
    audio_duration_sec = waveform.shape[1] / sr
    print(f"[joint-context] done. audio duration {audio_duration_sec:.1f}s", file=sys.stderr)

    all_word_records = {}
    t_start = time.perf_counter()
    for wi, (lo_i, hi_i) in enumerate(windows):
        lo_t = segs[lo_i]["startTime"]
        hi_t = segs[hi_i]["startTime"] + segs[hi_i]["duration"]
        clip = waveform[:, int(lo_t * sample_rate): int(hi_t * sample_rate)]

        # Joint word list across every segment in [lo_i, hi_i], tagging each
        # word with its owning segment index + position-within-segment so the
        # target word can be found unambiguously afterward (repeated common
        # words like "You"/"It" would otherwise collide on text alone).
        joint_words = []
        for si in range(lo_i, hi_i + 1):
            for pos, w in enumerate(segs[si]["text"].split()):
                joint_words.append((w, si, pos))

        pairs = [(w, mfa.normalize_word(w, romanizer, valid_chars)) for w, si, pos in joint_words]
        kept = [(i, w, r) for i, (w, r) in enumerate(pairs) if r]
        romanized = [r for _, _, r in kept]

        t0 = time.perf_counter()
        with torch.inference_mode():
            emission, _ = model(clip)
            tokens = tokenizer(romanized)
            try:
                token_spans = aligner(emission[0], tokens)
            except RuntimeError as e:
                print(f"[joint-context] window {lo_i}-{hi_i} FAILED: {e}", file=sys.stderr)
                continue
        elapsed = time.perf_counter() - t0

        num_frames = emission.size(1)
        ratio = clip.size(1) / num_frames / sample_rate

        records = []
        for (orig_idx, w, r), spans in zip(kept, token_spans):
            total_len = sum(len(s) for s in spans)
            score = (sum(s.score * len(s) for s in spans) / total_len) if total_len else 0.0
            raw_word, si, pos = joint_words[orig_idx]
            records.append({
                "text": raw_word, "seg_i": si, "pos": pos,
                "start": round(lo_t + spans[0].start * ratio, 3),
                "end": round(lo_t + spans[-1].end * ratio, 3),
                "score": round(score, 4),
            })
        all_word_records[f"{lo_i}-{hi_i}"] = records
        print(f"[joint-context] window {wi + 1}/{len(windows)} segs {lo_i}-{hi_i}: "
              f"{len(records)} words, {elapsed:.1f}s (cumulative {time.perf_counter() - t_start:.1f}s)",
              file=sys.stderr)

    out_path = workdir / f"tokens_{args.label}_joint.json"
    out_path.write_text(json.dumps(all_word_records, indent=2))
    print(f"[joint-context] done. -> {out_path}", file=sys.stderr)


def build_parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)

    pa = sub.add_parser("align", help="run one joint MMS-FA pass per merged window of target segments")
    pa.add_argument("--workdir", required=True, help="must already contain audio_16k.wav")
    pa.add_argument("--segments-json", required=True, help="project.json-shaped or bare segments-array JSON")
    pa.add_argument("--targets-json", required=True,
                     help="JSON array of {seg_i: <0-based segment index>, ...} target cases to re-measure")
    pa.add_argument("--label", required=True)
    pa.add_argument("--language", default="en")
    pa.add_argument("--window-radius", type=int, default=2,
                     help="segments before/after each target to include in its joint window (default 2, "
                          "matching the 144/80 precedent's 5-segment groups)")
    pa.set_defaults(func=cmd_align)

    return p


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
