#!/usr/bin/env python3
"""Step A: threshold sweep on the silencedetect reference, V6, for the 40
unresolved Phase 3 forced-alignment failures. Re-runs ffmpeg silencedetect at
several noise floors (min-duration held fixed at 0.25s, matching production's
silenceDetector.ts default and measure-word-onset.py's own default), then for
each of the 40 words re-derives "pause end" at each floor and recomputes the
FA-vs-reference onset error = token_start - silence_end.
"""
import json, re, subprocess, sys, statistics

FFMPEG = "/usr/local/bin/ffmpeg"
WAV = "/tmp/phase3/v6/audio_16k.wav"
MIN_DUR = 0.25
FLOORS = [-50.0, -45.0, -40.0, -35.0, -30.0]

_SILENCE_START_RE = re.compile(r"silence_start:\s*(-?[\d.]+)")
_SILENCE_END_RE = re.compile(r"silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)")


def run_silencedetect(noise_db, min_duration_sec=MIN_DUR):
    cmd = [
        FFMPEG, "-hide_banner",
        "-i", WAV,
        "-af", f"silencedetect=noise={noise_db}dB:d={min_duration_sec}",
        "-f", "null", "-",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    log = result.stderr
    silences = []
    pending_start = None
    for line in log.splitlines():
        m = _SILENCE_START_RE.search(line)
        if m:
            pending_start = float(m.group(1))
            continue
        m = _SILENCE_END_RE.search(line)
        if m:
            end = float(m.group(1))
            if pending_start is not None:
                silences.append({"start": pending_start, "end": end})
                pending_start = None
    silences.sort(key=lambda s: s["start"])
    return silences


def find_corresponding_silence(silences, orig_start, orig_end, token_start):
    """The 'same' pause at a different threshold: prefer a silence whose
    interval overlaps the original [orig_start, orig_end] interval (a
    stricter/looser floor shrinks/grows the same acoustic gap but keeps it
    roughly in place); fall back to the nearest silence ending at or before
    token_start if no overlap survives (the floor dissolved the pause
    entirely at this setting)."""
    best = None
    for s in silences:
        if s["start"] < orig_end and s["end"] > orig_start:
            # overlaps the original window
            if best is None or abs(s["end"] - orig_end) < abs(best["end"] - orig_end):
                best = s
    if best is not None:
        return best, "overlap"
    # No overlapping silence at this floor -> pause vanished (too strict
    # floor merged it into speech) or split. Fall back: nearest silence end
    # at or before the token start.
    candidates = [s for s in silences if s["end"] <= token_start]
    if not candidates:
        return None, "no_prior_silence"
    nearest = max(candidates, key=lambda s: s["end"])
    return nearest, "fallback_nearest_prior"


def main():
    unresolved = json.load(open("/tmp/phase3/v6/unresolved_40.json"))

    print(f"[step-a] running silencedetect at floors {FLOORS} on {WAV}", file=sys.stderr)
    sweeps = {}
    for floor in FLOORS:
        print(f"[step-a]  floor={floor}dB ...", file=sys.stderr)
        sweeps[floor] = run_silencedetect(floor)
        print(f"[step-a]  floor={floor}dB -> {len(sweeps[floor])} silences", file=sys.stderr)

    rows = []
    for u in unresolved:
        m = u["match"]
        orig_start = m["silence_start"]
        orig_end = m["silence_end"]
        token_start = m["token_start"]
        row = {
            "seg_display": u["seg_display"],
            "word": u["word"],
            "token_start": token_start,
            "orig_silence_start_-45": orig_start,
            "orig_silence_end_-45": orig_end,
            "orig_onset_error_-45": token_start - orig_end,
        }
        for floor in FLOORS:
            sil, method = find_corresponding_silence(sweeps[floor], orig_start, orig_end, token_start)
            if sil is None:
                row[f"end_{floor}"] = None
                row[f"err_{floor}"] = None
                row[f"method_{floor}"] = method
            else:
                row[f"end_{floor}"] = sil["end"]
                row[f"err_{floor}"] = token_start - sil["end"]
                row[f"method_{floor}"] = method
        rows.append(row)

    # Write full CSV
    import csv
    fieldnames = ["seg_display", "word", "token_start",
                  "orig_silence_start_-45", "orig_silence_end_-45", "orig_onset_error_-45"]
    for floor in FLOORS:
        fieldnames += [f"end_{floor}", f"err_{floor}", f"method_{floor}"]
    with open("docs/ws1-sync-pipeline/measurements/phase3-step-a-threshold-sweep.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)

    # Summary stats per floor
    print("\n=== Summary: median / p95 |error| per floor (n=40 unresolved) ===")
    print(f"{'floor':>8} {'n_valid':>8} {'median_ms':>10} {'p95_ms':>10} {'mean_ms':>10} {'n_fallback':>11}")
    for floor in [-45.0] + FLOORS:
        if floor == -45.0 and floor in sweeps:
            errs = [r["orig_onset_error_-45"] for r in rows]
            n_fb = 0
        else:
            errs = [r[f"err_{floor}"] for r in rows if r[f"err_{floor}"] is not None]
            n_fb = sum(1 for r in rows if r.get(f"method_{floor}") == "fallback_nearest_prior")
        abs_errs = sorted(abs(e) for e in errs)
        n = len(abs_errs)
        med = statistics.median(abs_errs) if n else float("nan")
        p95 = abs_errs[int(round(0.95 * (n - 1)))] if n else float("nan")
        mean = statistics.mean(abs_errs) if n else float("nan")
        label = "-45(orig)" if floor == -45.0 else str(floor)
        print(f"{label:>8} {n:>8} {med*1000:>10.1f} {p95*1000:>10.1f} {mean*1000:>10.1f} {n_fb:>11}")

    json.dump(sweeps, open("/tmp/phase3/v6/step_a_sweeps.json", "w"), indent=0)
    print("\nWrote docs/ws1-sync-pipeline/measurements/phase3-step-a-threshold-sweep.csv and /tmp/phase3/v6/step_a_sweeps.json")


if __name__ == "__main__":
    main()
