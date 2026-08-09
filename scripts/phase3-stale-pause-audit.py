#!/usr/bin/env python3
"""
phase3-stale-pause-audit.py — Phase 3 Step E (sync-pipeline-v2-plan.md).

Audits measure-word-onset.py's score_onset_errors() selection rule (the
ordinal greedy walk over ffmpeg silencedetect events) against every real
V6 committed-segment boundary, to test the hypothesis that the harness is
picking a STALE (wrong, distant) silence for some boundaries rather than
the one truly adjacent to the segment split.

Selection rule under audit (unchanged, defined in measure-word-onset.py):
for each detected silence in ascending time order, walk forward to the
first not-yet-consumed token whose midpoint clears the silence's start and
whose declared end reaches the silence's own midpoint (the "it." overlap
gate). There is no cap on how far forward this walk may reach, and no
check that the resulting silence is plausibly the one immediately before
the attributed word — this script tests whether that absence of a
plausibility check produces a materially different answer from what a
per-boundary "last silence detected before this word's true onset" rule
would give.

Ground truth for "true onset" is FA's own aligned start of each committed
segment's first word (tokens_fa2.json, `seg` field is 1-based and matches
v6-segments-full.json's `i`+1) — FA's own accuracy against the 12 human
labels (Phase 3 Step C) is 12-39ms on 6 of 7 scored failures, so it is a
sound per-word anchor even where the SILENCE reference is not.

Usage:
    python3 phase3-stale-pause-audit.py \
        --segments /path/to/v6-segments-full.json \
        --silences /path/to/silences.json \
        --fa-tokens /path/to/tokens_fa2.json \
        --onset-errors scripts/fixtures/phase3-onset-v6-fa-step1-2-corrected.csv \
        --out-csv docs/ws1-sync-pipeline/measurements/phase3-step-e-stale-pause-audit.csv \
        --max-plausible-error 1.0
"""

import argparse
import csv
import json
import statistics
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util
_spec = importlib.util.spec_from_file_location(
    "measure_word_onset", Path(__file__).resolve().parent / "measure-word-onset.py")
mwo = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mwo)


def percentile(data, pct):
    if not data:
        return None
    data = sorted(data)
    k = (len(data) - 1) * (pct / 100.0)
    f, c = math.floor(k), math.ceil(k)
    if f == c:
        return data[int(k)]
    return data[f] * (c - k) + data[c] * (k - f)


def last_silence_before(t: float, silences: list, slack: float = 0.05):
    """The last-ending detected silence at or before t (+ small slack for
    ordinary trailing-edge blur) — the single, FA-onset-anchored definition
    of "the pause immediately preceding this spoken word." None if no
    silence was ever detected before t at all (a genuine detector miss)."""
    cands = [s for s in silences if s["end"] <= t + slack]
    if not cands:
        return None
    return max(cands, key=lambda s: s["end"])


def audit(segments, silences, fa_tokens, results, mismatch_tolerance=0.02):
    by_seg = {}
    for t in fa_tokens:
        by_seg.setdefault(t["seg"], []).append(t)
    for seg_id in by_seg:
        by_seg[seg_id].sort(key=lambda t: t["start"])

    row_by_token_start = {(round(r["token_start"], 6), r["token_text"]): r for r in results}

    n_boundaries = len(segments) - 1
    rows = []
    for i in range(n_boundaries):
        seg_next = segments[i + 1]
        seg_next_1based = seg_next["i"] + 1
        toks_next = by_seg.get(seg_next_1based, [])
        if not toks_next:
            rows.append({"seg_next_display": seg_next_1based, "status": "no_fa_data"})
            continue
        first_tok = toks_next[0]
        fa_onset = first_tok["start"]
        key = (round(fa_onset, 6), first_tok["text"])
        row = row_by_token_start.get(key)
        true_sil = last_silence_before(fa_onset, silences)

        if row is None:
            status = "harness_never_scored_this_boundary"
            chosen_end = None
        elif true_sil is None:
            status = "no_silence_before_fa_onset_at_all"
            chosen_end = row["silence_end"]
        else:
            chosen_end = row["silence_end"]
            status = ("stale_pause_selection_bug"
                      if abs(chosen_end - true_sil["end"]) > mismatch_tolerance
                      else "ok")

        rows.append({
            "seg_next_display": seg_next_1based,
            "fa_word": first_tok["text"],
            "fa_onset": fa_onset,
            "chosen_silence_end": chosen_end,
            "true_silence_end": true_sil["end"] if true_sil else None,
            "onset_error_sec": row["onset_error_sec"] if row else None,
            "status": status,
        })
    return rows


def cmd_main(args):
    segments = json.loads(Path(args.segments).read_text())
    silences = sorted(json.loads(Path(args.silences).read_text())["silences"], key=lambda s: s["start"])
    fa_tokens = json.loads(Path(args.fa_tokens).read_text())
    word_tokens = mwo.filter_word_tokens(fa_tokens)
    results = mwo.score_onset_errors(word_tokens, silences)

    rows = audit(segments, silences, fa_tokens, results)

    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print(f"[audit] {len(segments) - 1} interior boundaries", file=sys.stderr)
    for k, v in sorted(counts.items()):
        print(f"[audit] {k}: {v}", file=sys.stderr)

    if args.out_csv:
        with open(args.out_csv, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=[
                "seg_next_display", "fa_word", "fa_onset", "chosen_silence_end",
                "true_silence_end", "onset_error_sec", "status"])
            w.writeheader()
            for r in rows:
                w.writerow(r)
        print(f"[audit] wrote {len(rows)} rows -> {args.out_csv}", file=sys.stderr)

    # Distance-capped re-score: reject any attribution whose |onset_error|
    # exceeds --max-plausible-error, rather than silently keeping a stale,
    # arbitrarily-distant attribution. Informed by the p99 of the clean
    # (status == "ok") population on this corpus (~530ms) with a doubling
    # safety margin, NOT fit to the 3 known outliers after the fact.
    if args.onset_errors:
        orig_rows = list(csv.DictReader(open(args.onset_errors)))
        capped_rows = [r for r in orig_rows if abs(float(r["onset_error_sec"])) <= args.max_plausible_error]
        removed = [r for r in orig_rows if abs(float(r["onset_error_sec"])) > args.max_plausible_error]

        def summarize(rs):
            errors = [float(r["onset_error_sec"]) for r in rs]
            abs_e = [abs(e) for e in errors]
            neg = [e for e in errors if e < 0]
            return {
                "n": len(rs),
                "median_ms": round(statistics.median(abs_e) * 1000, 1),
                "p95_ms": round(percentile(abs_e, 95) * 1000, 1),
                "neg_frac": round(len(neg) / len(errors), 4) if errors else None,
                "n_gt250ms": sum(1 for e in abs_e if e > 0.25),
            }

        print(f"\n[re-score] max plausible |onset_error| = {args.max_plausible_error}s", file=sys.stderr)
        print(f"[re-score] rows excluded as stale/detector-miss: {len(removed)}", file=sys.stderr)
        for r in removed:
            print(f"           silence=[{r['silence_start']},{r['silence_end']}] "
                  f"word={r['token_text']}@{r['token_start']} error={r['onset_error_sec']}", file=sys.stderr)
        print(f"[re-score] BEFORE: {summarize(orig_rows)}", file=sys.stderr)
        print(f"[re-score] AFTER:  {summarize(capped_rows)}", file=sys.stderr)


def build_parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--segments", required=True, help="v6-segments-full.json (committed segment array)")
    p.add_argument("--silences", required=True, help="silences.json (ffmpeg silencedetect output)")
    p.add_argument("--fa-tokens", required=True, help="tokens_fa2.json (FA word tokens, carries a 1-based 'seg' field)")
    p.add_argument("--onset-errors", default=None,
                    help="the committed onset_errors CSV to re-score with the distance cap (optional)")
    p.add_argument("--max-plausible-error", type=float, default=1.0,
                    help="reject an attribution whose |onset_error| exceeds this many seconds (default 1.0s)")
    p.add_argument("--out-csv", default=None)
    p.set_defaults(func=cmd_main)
    return p


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
