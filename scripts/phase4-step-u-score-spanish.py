#!/usr/bin/env python3
"""
phase4-step-u-score-spanish.py — Phase 4 Step U: score the Spanish listening
batch against the owner's human ground truth.

Settles ONE question: is Spanish's 282.1ms p95 `silencedetect` REFERENCE BIAS
(as English's was — Step C/Step H) or GENUINE forced-alignment error?

Inputs, all pre-existing and unmodified by this script:
  .answer-keys/step_q_answer_key.json    — the private Step Q key (clip -> abs times)
  scripts/fixtures/phase3-onset-spanish-fa.csv — the 22-pause Spanish FA dataset
  .work-phase4/spanish-breath-ref.json   — output of scripts/phase3-breath-aware-reference.py
                                           run UNMODIFIED (Step F thresholds, fixed for
                                           English before Spanish labels existed)
  HUMAN_LABELS below                     — the owner's ear, clip-local seconds

NOTHING IS TUNED HERE. No threshold in any upstream script was touched after the
labels arrived; this file only joins and subtracts.

Usage:  python3 scripts/phase4-step-u-score-spanish.py
"""
import csv
import json
import statistics
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
KEY = REPO / ".answer-keys" / "step_q_answer_key.json"
FA_CSV = REPO / "scripts" / "fixtures" / "phase3-onset-spanish-fa.csv"
BREATH = REPO / ".work-phase4" / "spanish-breath-ref.json"
OUT = REPO / "docs" / "ws1-sync-pipeline" / "measurements" / "phase4-step-u-spanish-scored.csv"

# The owner's listening pass, verbatim. Clip-local seconds.
#   a_end   — where segment A's speech actually stops
#   breath  — (start, end) of an audible breath, or None
#   b_start — where segment B's first word actually begins  <-- GROUND TRUTH
HUMAN_LABELS = {
    "clip3_01": dict(a_end=1.003, breath=None,           b_start=1.742),
    "clip3_02": dict(a_end=1.050, breath=(1.571, 1.758), b_start=1.837),
    "clip3_03": dict(a_end=0.999, breath=(1.652, 1.804), b_start=1.902),
    "clip3_04": dict(a_end=1.002, breath=None,           b_start=1.744),
    "clip3_05": dict(a_end=0.996, breath=None,           b_start=1.293),
    "clip3_06": dict(a_end=0.722, breath=(1.242, 1.336), b_start=1.425),
    "clip3_07": dict(a_end=0.986, breath=(1.211, 1.423), b_start=1.543),
    "clip3_08": dict(a_end=0.926, breath=(1.227, 1.375), b_start=1.440),
    "clip3_09": dict(a_end=1.012, breath=(1.240, 1.433), b_start=1.485),
    "clip3_10": dict(a_end=1.002, breath=None,           b_start=1.452),
}

GATE_P95_MS = 250.0


def ms(x):
    return None if x is None else x * 1000.0


def pctl(vals, p):
    if not vals:
        return float("nan")
    s = sorted(vals)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def load():
    key = {r["clip"]: r for r in json.loads(KEY.read_text())}
    breath = {round(r["silence_start"], 6): r
              for r in json.loads(BREATH.read_text())["results"]}
    fa = {round(float(r["silence_start"]), 6): r
          for r in csv.DictReader(FA_CSV.open())}
    return key, breath, fa


def build_rows():
    key, breath, fa = load()
    rows = []
    for clip, hum in sorted(HUMAN_LABELS.items()):
        k = key[clip]
        c0 = k["clip_start_abs"]
        sk = round(k["silence_start"], 6)
        br = breath[sk]

        human_b = c0 + hum["b_start"]
        human_a = c0 + hum["a_end"]
        fa_onset = k["token_start"]
        raw_ref = k["silence_end"]
        bref = br["corrected_speech_onset"]

        rows.append(dict(
            clip=clip,
            kind=k["kind"],
            word=k["word"],
            human_breath=hum["breath"] is not None,
            detector_breath=bool(br["has_breath"]),
            human_a_end=human_a,
            human_b=human_b,
            fa_onset=fa_onset,
            raw_ref=raw_ref,
            breath_ref=bref,
            fa_err=fa_onset - human_b,
            raw_err=raw_ref - human_b,
            bref_err=(None if bref is None else bref - human_b),
            recorded_onset_error=k["onset_error_sec"],
        ))
    return rows


def table(rows, title):
    print(f"\n  {title}")
    print("  clip      kind     brth  human_B   FA      rawref  brref  |  FA_err   raw_err  bref_err")
    print("  " + "-" * 92)
    for r in rows:
        b = "yes" if r["human_breath"] else " no"
        be = "  n/a " if r["bref_err"] is None else f"{ms(r['bref_err']):+7.0f}"
        br = "   n/a" if r["breath_ref"] is None else f"{r['breath_ref']:6.3f}"
        print(f"  {r['clip']}  {r['kind']:<8} {b}  {r['human_b']:7.3f}  {r['fa_onset']:6.3f}  "
              f"{r['raw_ref']:6.3f}  {br}  |{ms(r['fa_err']):+7.0f}  {ms(r['raw_err']):+8.0f}  {be}")


def stats(rows, label):
    fa = [abs(ms(r["fa_err"])) for r in rows]
    raw = [abs(ms(r["raw_err"])) for r in rows]
    bre = [abs(ms(r["bref_err"])) for r in rows if r["bref_err"] is not None]
    print(f"    {label:<28} n={len(rows):<3} "
          f"|FA| med {statistics.median(fa):6.1f} max {max(fa):7.1f}   "
          f"|raw| med {statistics.median(raw):6.1f} max {max(raw):7.1f}   "
          f"|bref| med {statistics.median(bre):6.1f} max {max(bre):7.1f}")


def recompute_corpus_p95():
    """Recompute Spanish onset-error p50/p95 with the reference REPLACED by the
    breath-aware corrected onset, across all 22 scored pauses. FA untouched."""
    breath = {round(r["silence_start"], 6): r
              for r in json.loads(BREATH.read_text())["results"]}
    raw_errs, cor_errs, missing = [], [], 0
    for r in csv.DictReader(FA_CSV.open()):
        ss = round(float(r["silence_start"]), 6)
        tok = float(r["token_start"])
        raw_errs.append(abs(float(r["onset_error_sec"])) * 1000.0)
        b = breath.get(ss)
        if b is None or b["corrected_speech_onset"] is None:
            missing += 1
            cor_errs.append(abs(float(r["onset_error_sec"])) * 1000.0)
            continue
        cor_errs.append(abs(tok - b["corrected_speech_onset"]) * 1000.0)
    return raw_errs, cor_errs, missing


def main():
    rows = build_rows()

    print("=" * 96)
    print("STEP U — Spanish listening batch scored against human ground truth")
    print("=" * 96)
    print("""
  All times in seconds, absolute (source: Spanish VOiceover.m4a). Errors in ms,
  SIGNED, measured against the human B onset (positive = late).
    FA      = forced-alignment declared onset of segment B's first word
    rawref  = ffmpeg silencedetect's declared silence_end (the reference every
              Spanish number in this programme was scored against)
    brref   = Step F's breath-aware corrected onset, script run UNMODIFIED""")

    table(rows, "ALL 10 CLIPS")

    fails = [r for r in rows if r["kind"] == "failure"]
    ctrls = [r for r in rows if r["kind"] == "control"]
    brth = [r for r in rows if r["human_breath"]]
    nobr = [r for r in rows if not r["human_breath"]]

    print("\n  ABSOLUTE ERROR SUMMARY (ms)")
    stats(rows, "all 10")
    stats(fails, "7 failures")
    stats(ctrls, "3 controls")
    stats(brth, f"{len(brth)} breath clips")
    stats(nobr, f"{len(nobr)} no-breath clips")

    print("\n  BREATH DETECTOR vs HUMAN EAR (Step F script, unmodified)")
    tp = sum(1 for r in rows if r["human_breath"] and r["detector_breath"])
    fn = sum(1 for r in rows if r["human_breath"] and not r["detector_breath"])
    fp = sum(1 for r in rows if not r["human_breath"] and r["detector_breath"])
    tn = sum(1 for r in rows if not r["human_breath"] and not r["detector_breath"])
    print(f"    human breath present {len(brth)}: detector found {tp}, missed {fn}")
    print(f"    human breath absent  {len(nobr)}: detector agreed {tn}, false-fired {fp}")

    edge = [r for r in rows if r["clip"] == "clip3_06"]
    rest = [r for r in rows if r["clip"] != "clip3_06"]
    print("\n  THE ONE OUTLIER, SEPARATED RATHER THAN AVERAGED AWAY")
    print(f"    clip3_06 FA error {ms(edge[0]['fa_err']):+.0f}ms — corpus-start clip. The "
          f"pipeline SKIPPED\n    the preceding segment 001_scylla_intro (text: \"Scylla.\"), so "
          f"this segment's\n    committed window starts at t=0 and contains that unscripted "
          f"lead-in — which is\n    the SAME WORD. FA matched the first 'Scylla' (0.12-0.64) "
          f"instead of the segment's\n    own (human B 1.425). Duplicated word + zero left "
          f"context + a window that is the\n    committed span: the Step R.6 case, named before "
          f"these labels arrived.")
    print(f"    9 clips excluding it: |FA| median "
          f"{statistics.median([abs(ms(r['fa_err'])) for r in rest]):.1f}ms, "
          f"max {max(abs(ms(r['fa_err'])) for r in rest):.1f}ms")

    raw_errs, cor_errs, missing = recompute_corpus_p95()
    print("\n  CORPUS RECOMPUTE — all 22 Spanish scored pauses, FA untouched,")
    print("  reference swapped raw silencedetect -> Step F breath-aware onset")
    for label, errs in (("raw reference        ", raw_errs),
                        ("breath-aware reference", cor_errs)):
        p95 = pctl(errs, 0.95)
        print(f"    {label}: median {statistics.median(errs):6.1f}ms   p95 {p95:6.1f}ms   "
              f"max {max(errs):7.1f}ms   >250ms: {sum(1 for e in errs if e > GATE_P95_MS)}/22"
              f"   -> {'PASS' if p95 <= GATE_P95_MS else 'FAIL'} vs {GATE_P95_MS:.0f}ms gate")
    print("    NOTE, stated so the statistic is not oversold: with n=22 the p95 rank sits")
    print("    below the maximum, so the single remaining >250ms row (clip3_06) is excluded")
    print("    by rank from BOTH p95 figures. The comparison is like-for-like, but the")
    print("    corrected p95 is not a claim that every Spanish boundary is inside 250ms.")
    if missing:
        print(f"    ({missing} of 22 pauses had no corrected onset; raw error carried through "
              f"unchanged — conservative, never improved by omission)")

    with OUT.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if v is None else v) for k, v in r.items()})
    print(f"\n  wrote {OUT.relative_to(REPO)}")


if __name__ == "__main__":
    sys.exit(main())
