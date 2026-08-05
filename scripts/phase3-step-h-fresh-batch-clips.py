#!/usr/bin/env python3
"""
phase3-step-h-fresh-batch-clips.py — Phase 3 Step H fresh confirmation batch.

Exports a SECOND, independent blinded listening batch (20 clips: 12 from the
worst-remaining residuals under the Step E/F corrected reference, 8 controls)
to confirm the corrected reference against human ground truth without reusing
any of the original Step C 12 clips (which already informed Step F's sanity
check and would make a second check circular).

Same protocol as the original Step C export
(phase3-reference-validity-step-c-clips.py): 1.0s padding before the flagged
silence's start and 1.0s after the flagged word's end, sourced from V6's
original (not 16kHz-transcoded) audio, opaque clip_NN names via a seeded
shuffle, a public manifest carrying ONLY clip name + script text, and a
private answer key (clip -> segment/word/timing) held outside docs/.
"""
import subprocess
import random
import csv
import json
import os
from pathlib import Path

FFMPEG = "/usr/local/bin/ffmpeg"
SRC = "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
OUTDIR = "/tmp/phase3/v6/clips_batch2"
DURATION = 1421.283991
PAD = 1.0
SEED = 99  # distinct from Step C's seed 42 -- a genuinely separate shuffle

os.makedirs(OUTDIR, exist_ok=True)

items = json.loads(Path("/tmp/phase3/v6/step_h_batch20_items.json").read_text())
assert len(items) == 20, f"expected 20 items, got {len(items)}"

random.seed(SEED)
order = list(range(len(items)))
random.shuffle(order)

answer_key = []
public_rows = []
for rank, idx in enumerate(order, start=1):
    it = items[idx]
    sstart, send = it["silence_start"], it["silence_end"]
    tstart, tend = it["token_start"], it["token_end"]
    clip_start = max(0.0, sstart - PAD)
    clip_end = min(DURATION, tend + PAD)
    name = f"clip2_{rank:02d}"
    outpath = os.path.join(OUTDIR, f"{name}.wav")
    cmd = [
        FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
        "-i", SRC,
        "-ss", f"{clip_start:.3f}",
        "-to", f"{clip_end:.3f}",
        "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le",
        outpath,
    ]
    subprocess.run(cmd, check=True)

    actual_dur = None
    probe = subprocess.run(
        ["/usr/local/bin/ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", outpath],
        capture_output=True, text=True)
    if probe.returncode == 0:
        actual_dur = float(probe.stdout.strip())

    answer_key.append({
        "clip": name, "kind": it["kind"], "seg_display": it["seg_display"], "word": it["word"],
        "silence_start": sstart, "silence_end": send,
        "token_start": tstart, "token_end": tend,
        "clip_start_abs": clip_start, "clip_end_abs": clip_end,
        "pause_offset_in_clip": sstart - clip_start,
        "word_onset_offset_in_clip": tstart - clip_start,
        "expected_dur": clip_end - clip_start,
        "actual_dur": actual_dur,
    })
    public_rows.append({"clip": name, "script_text": it["script_text"]})

with open(os.path.join(OUTDIR, "clips_manifest.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["clip", "script_text"])
    w.writeheader()
    for r in public_rows:
        w.writerow(r)

with open("/tmp/phase3/v6/step_h_answer_key.json", "w") as f:
    json.dump(answer_key, f, indent=2)

print(f"Wrote {len(items)} clips to {OUTDIR}")
print(f"\n{'clip':>10} {'kind':>10} {'seg':>5} {'pad_before':>11} {'pad_after':>10} {'expected_dur':>13} {'actual_dur':>11} {'ok':>4}")
all_ok = True
for a in answer_key:
    pad_after = a["clip_end_abs"] - a["token_end"]
    dur_ok = a["actual_dur"] is not None and abs(a["actual_dur"] - a["expected_dur"]) < 0.05
    pad_before_ok = abs(a["pause_offset_in_clip"] - PAD) < 0.001 or a["silence_start"] < PAD
    pad_after_ok = abs(pad_after - PAD) < 0.001 or a["clip_end_abs"] >= DURATION - 0.001
    ok = dur_ok and pad_before_ok and pad_after_ok
    all_ok = all_ok and ok
    print(f"{a['clip']:>10} {a['kind']:>10} {str(a['seg_display']):>5} "
          f"{a['pause_offset_in_clip']:>11.3f} {pad_after:>10.3f} "
          f"{a['expected_dur']:>13.3f} {str(a['actual_dur']):>11} {'OK' if ok else 'BAD':>4}")
print(f"\nALL PADDING/DURATION CHECKS: {'PASS' if all_ok else 'FAIL -- investigate before sending'}")
