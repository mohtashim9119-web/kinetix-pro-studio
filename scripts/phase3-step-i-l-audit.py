#!/usr/bin/env python3
"""
phase3-step-i-l-audit.py — Phase 3 Steps I-L (sync-pipeline-v2-plan.md).

Four subcommands, run in the order the plan's Steps I-L brief specifies:

  extract-raw-transcript   Parse the FULL, untruncated V6 turbo transcript
                            out of docs/V6-Smear-Phase2a.csv's second
                            section (the console-log CSV dump past the
                            1000-row UI table cap — see Phase 3's Step 4
                            entry for why the FIRST section alone silently
                            truncates to 1000 words). Writes a clean JSON
                            list of {idx, text, start, end}.

  transcript-audit         Step I. For every clip in BOTH listening
                            batches (Step C's original 12, Step H's fresh
                            20), build "heard text" from the raw transcript
                            by absolute-time-window overlap with the
                            clip's own [clip_start_abs, clip_end_abs], and
                            check whether the manifest's claimed
                            script_text is actually what's audible there
                            (an ordered-prefix containment test, not exact
                            match, since a long segment's manifest text
                            naturally overruns a short clip's own window
                            per this program's own established, benign
                            pattern). Reports a PASS/FAIL table for all 32
                            clips.

  heading-sweep             Step K. Scans the raw transcript for every
                            literal "Level" token (V6's chapter-marker
                            convention), and for each occurrence, finds
                            the nearest FA-aligned token on either side
                            (tokens_fa2.json) to report which two committed
                            segments the heading sits between and how large
                            the resulting dead-audio gap is.

  score-batch2               Step J. Scores the Step H fresh-batch human
                            labels (embedded below, exactly as returned)
                            against FA onset, raw silencedetect, and the
                            Step F breath-aware corrected reference
                            (phase3-breath-aware-reference.py's own
                            --out-json), excluding clips 9/11/15 per
                            instruction, split by breath presence.

K8 discipline: committed, re-runnable without archaeology. Measurement
only — nothing here touches src/, integration, or any threshold.
"""

import argparse
import csv
import json
import statistics
from pathlib import Path


# ---------------------------------------------------------------------------
# extract-raw-transcript
# ---------------------------------------------------------------------------

def cmd_extract_raw_transcript(args):
    lines = Path(args.smear_csv).read_text().splitlines()
    start = None
    for i, l in enumerate(lines):
        if l.startswith('"[Log] index,text,startSec'):
            start = i + 1
            break
    if start is None:
        raise SystemExit("could not find the console-dump section header in " + args.smear_csv)

    raw = []
    for l in lines[start:]:
        parts = l.split(",")
        if len(parts) < 4:
            continue
        idx_s, text, s, e = parts[0].lstrip('"'), parts[1], parts[2], parts[3]
        try:
            s = float(s)
            e = float(e)
        except ValueError:
            continue
        raw.append({"idx": idx_s, "text": text, "start": s, "end": e})

    Path(args.out_json).write_text(json.dumps(raw, indent=2))
    print(f"[extract] wrote {len(raw)} raw tokens -> {args.out_json}")


# ---------------------------------------------------------------------------
# transcript-audit (Step I)
# ---------------------------------------------------------------------------

def _norm_words(s):
    import re
    s = s.lower()
    s = re.sub(r"[^a-z0-9' ]", " ", s)
    return [w for w in s.split() if len(w) > 1]


def _heard_text(raw, clip_start, clip_end):
    return " ".join(t["text"] for t in raw if t["start"] < clip_end and t["end"] > clip_start)


def _load_manifest(path):
    d = {}
    with open(path) as f:
        for row in csv.DictReader(f):
            d[row["clip"]] = row["script_text"]
    return d


def _prefix_match(script, heard, n=4):
    sw = _norm_words(script)[:n]
    hw = set(_norm_words(heard))
    hits = sum(1 for w in sw if w in hw)
    return hits, len(sw)


def cmd_transcript_audit(args):
    raw = json.loads(Path(args.raw_transcript).read_text())

    batches = [
        ("batch1 (Step C, 12 clips)", args.batch1_answer_key, args.batch1_manifest),
        ("batch2 (Step H, 20 clips)", args.batch2_answer_key, args.batch2_manifest),
    ]

    rows_out = []
    for label, ak_path, manifest_path in batches:
        ak = json.loads(Path(ak_path).read_text())
        manifest = _load_manifest(manifest_path)
        print(f"\n=== {label} ===")
        for a in ak:
            clip = a["clip"]
            script = manifest.get(clip, "")
            heard = _heard_text(raw, a["clip_start_abs"], a["clip_end_abs"])
            hits, total = _prefix_match(script, heard, n=args.prefix_n)
            verdict = "PASS" if hits >= total - 1 else "FAIL"
            print(f"{clip:10} seg={str(a['seg_display']):5} prefix {hits}/{total} {verdict:5} "
                  f"| script: {script[:55]!r:58} | heard: {heard[:75]!r}")
            rows_out.append({
                "batch": label, "clip": clip, "seg_display": a["seg_display"],
                "prefix_hits": hits, "prefix_total": total, "verdict": verdict,
                "script_text": script, "heard_text": heard,
            })

    if args.out_csv:
        with open(args.out_csv, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows_out[0].keys()))
            w.writeheader()
            for r in rows_out:
                w.writerow(r)
        print(f"\n[transcript-audit] wrote {args.out_csv}")

    n_fail = sum(1 for r in rows_out if r["verdict"] == "FAIL")
    print(f"\n[transcript-audit] {len(rows_out)} clips checked, {n_fail} FAIL")


# ---------------------------------------------------------------------------
# heading-sweep (Step K)
# ---------------------------------------------------------------------------

def cmd_heading_sweep(args):
    raw = json.loads(Path(args.raw_transcript).read_text())
    tok = json.loads(Path(args.fa_tokens).read_text())
    tok_sorted = sorted(tok, key=lambda t: t["start"])

    level_times = [t["start"] for t in raw if t["text"].strip().lower() == args.marker.lower()]
    print(f"[heading-sweep] found {len(level_times)} occurrences of {args.marker!r} in the raw transcript\n")

    rows_out = []
    for lv_time in level_times:
        prev = [t for t in tok_sorted if t["end"] <= lv_time]
        nxt = [t for t in tok_sorted if t["start"] >= lv_time]
        p = prev[-1] if prev else None
        n = nxt[0] if nxt else None
        gap = (n["start"] - p["end"]) if (p and n) else None
        pstr = f"seg={p['seg']} '{p['text']}' end={p['end']:.2f}" if p else "NONE (file start)"
        nstr = f"seg={n['seg']} '{n['text']}' start={n['start']:.2f}" if n else "NONE"
        print(f"{args.marker}@{lv_time:8.2f}s | prev: {pstr:38} | next: {nstr:33} | gap={gap}")
        rows_out.append({
            "marker_time": lv_time,
            "prev_seg": p["seg"] if p else None, "prev_text": p["text"] if p else None,
            "prev_end": p["end"] if p else None,
            "next_seg": n["seg"] if n else None, "next_text": n["text"] if n else None,
            "next_start": n["start"] if n else None,
            "gap_sec": gap,
        })

    if args.out_csv:
        with open(args.out_csv, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows_out[0].keys()))
            w.writeheader()
            for r in rows_out:
                w.writerow(r)
        print(f"\n[heading-sweep] wrote {args.out_csv}")


# ---------------------------------------------------------------------------
# score-batch2 (Step J)
# ---------------------------------------------------------------------------

# Human labels exactly as returned for the Step H fresh 20-clip batch
# (clip N -> clip2_0N). A-end / breath window / B-start, seconds, clip-local.
# Clip 11 is INVALID (Step I) and is never scored. Clips 9 and 15 are held
# aside pending Step K per instruction (not scored into the aggregate).
HUMAN_LABELS = {
    1:  (0.998, None,                1.525),
    2:  (2.529, None,                2.876),
    3:  (1.008, None,                1.751),
    4:  (1.028, None,                1.287),
    5:  (0.892, None,                1.728),
    6:  (1.010, (1.202, 1.328),      1.607),
    7:  (1.002, None,                1.747),
    8:  (1.009, None,                1.718),
    9:  (2.270, None,                2.341),
    10: (1.021, None,                1.851),
    12: (2.920, None,                3.144),
    13: (1.014, (1.544, 1.865),      1.949),
    14: (1.004, (1.333, 1.503),      1.601),
    15: (0.692, (1.309, 1.707),      1.796),
    16: (1.047, (1.123, 1.415),      1.523),
    17: (1.011, (1.281, 1.490),      1.620),
    18: (1.129, (1.364, 1.621),      1.661),
    19: (1.009, None,                2.140),
    20: (1.011, None,                1.626),
}
EXCLUDE_FROM_AGGREGATE = {9, 11, 15}


def cmd_score_batch2(args):
    ak = {a["clip"]: a for a in json.loads(Path(args.answer_key).read_text())}
    targets = {t["clip"]: t for t in json.loads(Path(args.targets).read_text())}
    breath = {r["clip"]: r for r in json.loads(Path(args.breath_json).read_text())["results"]}

    header = (f"{'clip':9} {'seg':5} {'kind':10} {'breath':6} {'FA onset':10} {'SD onset':10} "
              f"{'F-corr':10} {'human B':10} {'FA-hum(ms)':11} {'SD-hum(ms)':11} {'F-hum(ms)':10}")
    print(header)

    agg = {"FA": [], "SD": [], "F": []}
    breath_agg = {"FA": [], "SD": [], "F": []}
    nobreath_agg = {"FA": [], "SD": [], "F": []}
    rows_out = []

    for n in sorted(HUMAN_LABELS):
        clip = f"clip2_{n:02d}"
        a_end, breath_window, b_start = HUMAN_LABELS[n]
        if clip not in ak:
            continue  # clip 11 invalid, no answer-key row scored here by design
        a = ak[clip]
        t = targets[clip]
        cs = a["clip_start_abs"]
        human_B_abs = cs + b_start
        fa_onset = a["token_start"]
        sd_end = t["silence_end"]
        fcorr = breath[clip]["corrected_speech_onset"]
        is_breath = breath_window is not None

        fa_err = (fa_onset - human_B_abs) * 1000
        sd_err = (sd_end - human_B_abs) * 1000
        f_err = (fcorr - human_B_abs) * 1000

        scored = n not in EXCLUDE_FROM_AGGREGATE
        print(f"{clip:9} {str(a['seg_display']):5} {a['kind']:10} {str(is_breath):6} "
              f"{fa_onset:10.3f} {sd_end:10.3f} {fcorr:10.3f} {human_B_abs:10.3f} "
              f"{fa_err:11.1f} {sd_err:11.1f} {f_err:10.1f}"
              f"{'' if scored else '  [EXCLUDED]'}")

        rows_out.append({
            "clip": clip, "seg_display": a["seg_display"], "kind": a["kind"],
            "is_breath": is_breath, "scored": scored,
            "fa_onset": fa_onset, "sd_end": sd_end, "f_corrected": fcorr,
            "human_B_abs": human_B_abs,
            "fa_err_ms": fa_err, "sd_err_ms": sd_err, "f_err_ms": f_err,
        })

        if not scored:
            continue
        agg["FA"].append(abs(fa_err)); agg["SD"].append(abs(sd_err)); agg["F"].append(abs(f_err))
        bucket = breath_agg if is_breath else nobreath_agg
        bucket["FA"].append(abs(fa_err)); bucket["SD"].append(abs(sd_err)); bucket["F"].append(abs(f_err))

    def stats(lst):
        return f"n={len(lst)} median={statistics.median(lst):.1f}ms max={max(lst):.1f}ms"

    print(f"\nALL {len(agg['FA'])} scored (excludes clips 9, 11, 15):")
    for k in ["FA", "SD", "F"]:
        print(f"  {k}: {stats(agg[k])}")
    print(f"\nBREATH (n={len(breath_agg['FA'])}):")
    for k in ["FA", "SD", "F"]:
        print(f"  {k}: {stats(breath_agg[k])}")
    print(f"\nNO-BREATH (n={len(nobreath_agg['FA'])}):")
    for k in ["FA", "SD", "F"]:
        print(f"  {k}: {stats(nobreath_agg[k])}")

    if args.out_csv:
        with open(args.out_csv, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows_out[0].keys()))
            w.writeheader()
            for r in rows_out:
                w.writerow(r)
        print(f"\n[score-batch2] wrote {args.out_csv}")


def build_parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(required=True)

    p1 = sub.add_parser("extract-raw-transcript")
    p1.add_argument("--smear-csv", required=True, help="docs/V6-Smear-Phase2a.csv")
    p1.add_argument("--out-json", required=True)
    p1.set_defaults(func=cmd_extract_raw_transcript)

    p2 = sub.add_parser("transcript-audit")
    p2.add_argument("--raw-transcript", required=True)
    p2.add_argument("--batch1-answer-key", required=True, help="/tmp/phase3/v6/step_c_answer_key.json")
    p2.add_argument("--batch1-manifest", required=True, help="docs/phase3-step-c-clips-manifest.csv")
    p2.add_argument("--batch2-answer-key", required=True, help="/tmp/phase3/v6/step_h_answer_key.json")
    p2.add_argument("--batch2-manifest", required=True, help="docs/phase3-step-h-batch2-manifest.csv")
    p2.add_argument("--prefix-n", type=int, default=4)
    p2.add_argument("--out-csv", default=None)
    p2.set_defaults(func=cmd_transcript_audit)

    p3 = sub.add_parser("heading-sweep")
    p3.add_argument("--raw-transcript", required=True)
    p3.add_argument("--fa-tokens", required=True, help="/tmp/phase3/v6/tokens_fa2.json")
    p3.add_argument("--marker", default="Level")
    p3.add_argument("--out-csv", default=None)
    p3.set_defaults(func=cmd_heading_sweep)

    p4 = sub.add_parser("score-batch2")
    p4.add_argument("--answer-key", required=True, help="/tmp/phase3/v6/step_h_answer_key.json")
    p4.add_argument("--targets", required=True, help="/tmp/phase3/v6/step_j_targets.json")
    p4.add_argument("--breath-json", required=True, help="output of phase3-breath-aware-reference.py")
    p4.add_argument("--out-csv", default=None)
    p4.set_defaults(func=cmd_score_batch2)

    return p


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
