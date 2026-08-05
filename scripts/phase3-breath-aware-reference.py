#!/usr/bin/env python3
"""
phase3-breath-aware-reference.py — Phase 3 Step F (sync-pipeline-v2-plan.md).

Builds a breath-aware corrected reference for a silencedetect-flagged pause,
separating three acoustic states inside and around the flagged interval:

  SILENCE — near-noise-floor energy, no structure.
  BREATH  — low-energy, aperiodic, broadband (turbulent airflow): elevated
            energy above the floor but well below normal voiced-speech
            level, high spectral flatness (noise-like spectrum), low
            harmonicity (no periodic voiced structure), and (a secondary,
            per-file-relative cue) an elevated zero-crossing rate.
  SPEECH  — voiced onset: rising energy into the normal speech band, LOW
            spectral flatness (energy concentrated at harmonic partials),
            HIGH harmonicity (a strong periodic/autocorrelation peak in the
            typical pitch range).

silencedetect (a plain -45dB/0.25s RMS threshold) cannot distinguish BREATH
from SILENCE — both simply read as "quiet enough." Its declared silence_end
is therefore biased toward the START of a breath (breath crosses the energy
floor before the next word's voiced articulation does), not the true word
onset. This script re-derives, per flagged interval: whether a breath is
present, where it starts/ends, and where genuine voiced SPEECH resumes
(the corrected reference "pause end").

Thresholds (chosen BEFORE this script was run against the 12 human-labeled
clips — see phase3-reference-validity.md's Step F entry for the disclosure
of what this session had already read before designing this):
  - FLATNESS_BREATH_THRESH = 0.35 — standard spectral-flatness-measure (SFM)
    convention: SFM near 1.0 is white-noise-like, near 0 is a pure tone;
    0.3-0.4 is the common textbook cut for "noisy vs. tonal" (e.g. used in
    MPEG audio classification literature). A round, non-corpus-fit value.
  - HARMONICITY_BREATH_THRESH = 0.35 / HARMONICITY_SPEECH_THRESH = 0.5 —
    normalized-autocorrelation-peak convention: > 0.5 is conventionally
    "clearly voiced" in pitch-tracking literature (e.g. praat's default
    voicing threshold is 0.45); < 0.35 gives a buffer zone below that
    excludes ambiguous transitional frames from being called BREATH.
  - Energy bands are FILE-ADAPTIVE (percentiles of this file's own frame
    RMS distribution), not a fixed dB value, so the detector is not tied
    to one file's recording level: SILENCE_FLOOR = p10, SPEECH_LEVEL = p60
    of the whole file's frame RMS-dB distribution. BREATH band = floor+6dB
    to speech_level-10dB — comfortably between the two, a wide margin
    chosen to avoid hugging either boundary.

No dependency beyond numpy/scipy/soundfile.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

FRAME_SEC = 0.032
HOP_SEC = 0.008
FLATNESS_BAND_HZ = (150, 4000)
PITCH_LAG_HZ = (70, 350)  # plausible fundamental-frequency range for voiced speech

FLATNESS_BREATH_THRESH = 0.35
HARMONICITY_BREATH_THRESH = 0.35
HARMONICITY_SPEECH_THRESH = 0.50
FLATNESS_SPEECH_THRESH = 0.25

SILENCE_FLOOR_PCTL = 10
SPEECH_LEVEL_PCTL = 60
BREATH_LOW_MARGIN_DB = 6.0
BREATH_HIGH_MARGIN_DB = 10.0

MIN_CONSEC_FRAMES_BREATH = 3   # >= 24ms at 8ms hop
MIN_CONSEC_FRAMES_SPEECH = 3


def frame_signal(y, sr, frame_sec=FRAME_SEC, hop_sec=HOP_SEC, t0=0.0, t1=None):
    if t1 is None:
        t1 = len(y) / sr
    frame_len = int(round(frame_sec * sr))
    hop_len = int(round(hop_sec * sr))
    i0 = max(0, int(round(t0 * sr)))
    i1 = min(len(y), int(round(t1 * sr)))
    starts = list(range(i0, max(i0, i1 - frame_len), hop_len))
    win = np.hanning(frame_len)
    frames = []
    times = []
    for s in starts:
        seg = y[s:s + frame_len]
        if len(seg) < frame_len:
            break
        frames.append(seg)
        times.append(s / sr)
    return np.array(frames), np.array(times), win, frame_len


def spectral_flatness(frame, win, sr, band=FLATNESS_BAND_HZ):
    spec = np.abs(np.fft.rfft(frame * win)) ** 2 + 1e-12
    freqs = np.fft.rfftfreq(len(frame), d=1.0 / sr)
    band_mask = (freqs >= band[0]) & (freqs <= band[1])
    band_spec = spec[band_mask]
    if len(band_spec) == 0:
        return 0.0
    gm = np.exp(np.mean(np.log(band_spec)))
    am = np.mean(band_spec)
    return float(gm / am) if am > 0 else 0.0


def zero_crossing_rate(frame):
    signs = np.sign(frame)
    signs[signs == 0] = 1
    return float(np.mean(signs[:-1] != signs[1:]))


def harmonicity(frame, win, sr, lag_hz=PITCH_LAG_HZ):
    x = frame * win
    x = x - np.mean(x)
    energy0 = np.sum(x * x)
    if energy0 <= 1e-12:
        return 0.0
    ac = np.correlate(x, x, mode="full")[len(x) - 1:]
    lag_min = int(sr / lag_hz[1])
    lag_max = min(len(ac) - 1, int(sr / lag_hz[0]))
    if lag_max <= lag_min:
        return 0.0
    peak = np.max(ac[lag_min:lag_max + 1])
    return float(max(0.0, peak / energy0))


def rms_db(frame):
    r = np.sqrt(np.mean(frame.astype(np.float64) ** 2) + 1e-16)
    return 20.0 * np.log10(r + 1e-12)


def compute_features(y, sr, t0, t1):
    frames, times, win, flen = frame_signal(y, sr, t0=t0, t1=t1)
    feats = []
    for f in frames:
        feats.append({
            "rms_db": rms_db(f),
            "flatness": spectral_flatness(f, win, sr),
            "zcr": zero_crossing_rate(f),
            "harmonicity": harmonicity(f, win, sr),
        })
    return times, feats


def file_adaptive_bands(y, sr, sample_stride_sec=1.0):
    """Sample RMS-dB across the whole file (coarse stride, cheap) to derive
    a file-adaptive silence floor and speech level, so thresholds are not
    tied to one recording's absolute gain."""
    frame_len = int(round(FRAME_SEC * sr))
    stride = int(round(sample_stride_sec * sr))
    dbs = []
    for s in range(0, len(y) - frame_len, stride):
        dbs.append(rms_db(y[s:s + frame_len]))
    dbs = np.array(dbs)
    floor = np.percentile(dbs, SILENCE_FLOOR_PCTL)
    speech = np.percentile(dbs, SPEECH_LEVEL_PCTL)
    return float(floor), float(speech)


def classify_frame(feat, silence_floor_db, speech_level_db):
    db = feat["rms_db"]
    in_breath_band = (db > silence_floor_db + BREATH_LOW_MARGIN_DB) and (db < speech_level_db - BREATH_HIGH_MARGIN_DB)
    is_breath = (in_breath_band
                 and feat["flatness"] > FLATNESS_BREATH_THRESH
                 and feat["harmonicity"] < HARMONICITY_BREATH_THRESH)
    is_speech_onset = (db > speech_level_db - BREATH_HIGH_MARGIN_DB
                       and feat["harmonicity"] > HARMONICITY_SPEECH_THRESH
                       and feat["flatness"] < FLATNESS_SPEECH_THRESH)
    if is_speech_onset:
        return "speech"
    if is_breath:
        return "breath"
    return "silence"


def find_runs(labels, target, min_len):
    runs = []
    i = 0
    n = len(labels)
    while i < n:
        if labels[i] == target:
            j = i
            while j < n and labels[j] == target:
                j += 1
            if j - i >= min_len:
                runs.append((i, j))
            i = j
        else:
            i += 1
    return runs


def analyze_interval(y, sr, silence_start, silence_end, silence_floor_db, speech_level_db,
                      context_before=0.15, context_after=0.9):
    t0 = max(0.0, silence_start - context_before)
    t1 = silence_end + context_after
    times, feats = compute_features(y, sr, t0, t1)
    labels = [classify_frame(f, silence_floor_db, speech_level_db) for f in feats]

    # The small pre-silence_start context exists only so a breath/frame right
    # at the flagged interval's own leading edge isn't missed by frame-window
    # truncation — it must NOT let a "speech" run belonging to the PRECEDING
    # word's own trailing voiced decay (which can still occur before
    # silence_start) win the "first speech run in the window" search below.
    search_from_idx = next((i for i, t in enumerate(times) if t >= silence_start), 0)

    breath_runs = find_runs(labels[search_from_idx:], "breath", MIN_CONSEC_FRAMES_BREATH)
    speech_runs = find_runs(labels[search_from_idx:], "speech", MIN_CONSEC_FRAMES_SPEECH)

    breath_start = breath_end = None
    if breath_runs:
        # the breath run closest to (overlapping or just after) the flagged silence
        i0, i1 = breath_runs[0]
        breath_start = float(times[search_from_idx + i0])
        breath_end = float(times[search_from_idx + i1 - 1] + HOP_SEC)

    corrected_onset = None
    if speech_runs:
        i0, _ = speech_runs[0]
        corrected_onset = float(times[search_from_idx + i0])

    return {
        "has_breath": breath_start is not None,
        "breath_start": breath_start,
        "breath_end": breath_end,
        "corrected_speech_onset": corrected_onset,
        "n_frames": len(labels),
    }


def cmd_main(args):
    y, sr = sf.read(args.wav)
    if y.ndim > 1:
        y = y.mean(axis=1)
    print(f"[breath-ref] loaded {args.wav}: sr={sr}, dur={len(y)/sr:.1f}s", file=sys.stderr)

    silence_floor_db, speech_level_db = file_adaptive_bands(y, sr)
    print(f"[breath-ref] file-adaptive silence_floor={silence_floor_db:.1f}dB "
          f"speech_level={speech_level_db:.1f}dB", file=sys.stderr)

    targets = json.loads(Path(args.targets).read_text())
    results = []
    for t in targets:
        r = analyze_interval(y, sr, t["silence_start"], t["silence_end"],
                              silence_floor_db, speech_level_db)
        r.update({k: t[k] for k in t})
        results.append(r)
        print(f"  {t.get('clip', t.get('seg_display'))}: breath={r['has_breath']} "
              f"breath=[{r['breath_start']},{r['breath_end']}] "
              f"corrected_onset={r['corrected_speech_onset']}", file=sys.stderr)

    out = {
        "silence_floor_db": silence_floor_db,
        "speech_level_db": speech_level_db,
        "results": results,
    }
    Path(args.out_json).write_text(json.dumps(out, indent=2))
    print(f"[breath-ref] wrote {args.out_json}", file=sys.stderr)


def build_parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--wav", required=True, help="16kHz mono WAV (same file silences.json/tokens are timed against)")
    p.add_argument("--targets", required=True,
                    help="JSON list of {silence_start, silence_end, ...} intervals to analyze")
    p.add_argument("--out-json", required=True)
    p.set_defaults(func=cmd_main)
    return p


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
