#!/usr/bin/env python3
import subprocess, random, csv, json, os

FFMPEG = "/usr/local/bin/ffmpeg"
SRC = "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
OUTDIR = "/tmp/phase3/v6/clips"
DURATION = 1421.29
PAD = 1.0

os.makedirs(OUTDIR, exist_ok=True)

# 8 from the 40 unresolved (mix: 4 flat/threshold-invariant outliers, 2 that
# resolve under a looser floor, 2 mid-range) + 4 passing controls.
items = [
    # (kind, seg_display, word, silence_start, silence_end, token_start, token_end, script_text)
    ("unresolved", 383, "You", 1190.602375, 1191.070125, 1192.522, 1192.622, "You are sixty-four."),
    ("unresolved", 307, "You", 926.76625, 927.196375, 929.335, 929.897, "You are forty-nine."),
    ("unresolved", 1, "You", 0.647, 1.404937, 2.409, 4.275, "You are seven years old."),
    ("unresolved", 442, "They", 1403.24125, 1403.90175, 1404.223, 1404.323,
     "They will carry a torch in both hands and guard it with their body against the wind."),
    ("unresolved", 21, "It", 59.412688, 59.775063, 60.156, 60.217, "It has weight."),
    ("unresolved", 301, "Accepting", 904.49475, 905.2805, 905.811, 906.312,
     "Accepting that without it hollowing out your readiness is harder than any technique."),
    ("unresolved", 169, "He", 503.086437, 503.586625, 503.994, 504.054, "He finds you at your post afterward."),
    ("unresolved", 154, "When", 455.451875, 455.845687, 456.245, 456.346, "When the night birds cut off mid-call"),
    # controls (currently passing, |err| < 30ms)
    ("control", "c1", "You", 5.359938, 5.9595, 5.961, 6.061,
     "You live inside a skin-covered shelter at the edge of a shallow valley."),
    ("control", "c2", "The", 9.609813, 10.2365, 10.211, 10.291,
     "The fire your mother tends smells like pine resin and scorched bone."),
    ("control", "c3", "and", 52.46625, 53.034438, 53.047, 53.127,
     "You watch her face and you learn your first lesson without a word being spoken."),
    ("control", "c4", "Behind", 154.276688, 155.018125, 154.991, 155.392,
     "Behind you, two of the most experienced men walk the rear with thrusting spears angled outward into the dark."),
]

random.seed(42)
order = list(range(len(items)))
random.shuffle(order)

answer_key = []
public_rows = []
for rank, idx in enumerate(order, start=1):
    kind, seg, word, sstart, send, tstart, tend, text = items[idx]
    clip_start = max(0.0, sstart - PAD)
    clip_end = min(DURATION, tend + PAD)
    name = f"clip_{rank:02d}"
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
    dur = clip_end - clip_start
    answer_key.append({
        "clip": name, "kind": kind, "seg_display": seg, "word": word,
        "silence_start": sstart, "silence_end": send,
        "token_start": tstart, "token_end": tend,
        "clip_start_abs": clip_start, "clip_end_abs": clip_end,
        "pause_offset_in_clip": sstart - clip_start,
        "word_onset_offset_in_clip": tstart - clip_start,
    })
    public_rows.append({"clip": name, "script_text": text})

with open(os.path.join(OUTDIR, "clips_manifest.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["clip", "script_text"])
    w.writeheader()
    for r in public_rows:
        w.writerow(r)

with open("/tmp/phase3/v6/step_c_answer_key.json", "w") as f:
    json.dump(answer_key, f, indent=2)

print("Wrote", len(items), "clips to", OUTDIR)
for a in answer_key:
    print(a["clip"], a["kind"], a["seg_display"], a["word"], f"pause_in_clip={a['pause_offset_in_clip']:.2f}s",
          f"dur={a['clip_end_abs']-a['clip_start_abs']:.2f}s")
