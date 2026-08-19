#!/usr/bin/env python3
"""ws1-native-silences.py — WS1 Session P, the LIVE-FIDELITY silence arm.

WHY THIS EXISTS (Session P, Step 1 measurement). The harness's existing
silence input, `silences_app.json`, is produced by
`scripts/phase4-handoff-app-silence.py` from a 16 kHz MONO ffmpeg transcode.
The shipped app does not do that. `src/services/silenceDetector.ts`'s
`detectSilences()` runs `AudioContext.decodeAudioData` on the ORIGINAL
voiceover and reads `getChannelData(0)` — i.e. the file's NATIVE sample rate,
LEFT CHANNEL ONLY. All three corpus voiceovers are stereo (v6 44100 Hz,
173 48000 Hz, Spanish 44100 Hz), so the harness array and the live array are
computed from two different signals.

MEASURED consequence on v6 (Session P, Step 1): 547 harness silences vs 546
live, 33 of 546 matched entries differing (start deltas to 180 ms), plus one
harness-only phantom silence at [1128.68, 1129.04]. That is not noise: R.11's
corrected value IS a silence midpoint, so a 20 ms shift in a silence edge is a
10 ms shift in a committed boundary. It is exactly why the harness committed
671.18 where the live app committed 671.17.

The 16 kHz transcode's own docstring called the difference "sub-frame
quantization noise". That reasoning is about TIME quantization and is wrong
about AMPLITUDE: resampling to 16 kHz low-passes at 8 kHz (removing HF energy
from the frame RMS) and `-ac 1` averages L+R (a different signal from L
alone). Both move per-frame RMS across the -45 dB threshold.

RULING (Session P, Option 2). This is an ADDITIVE second arm. The 16 kHz
`silences_app.json` is UNCHANGED and remains what the golden replay
(`scripts/phase4-handoff-replay-sync.test.ts`) snaps against, so
`scripts/fixtures/phase4-baseline-*-silences.csv` stays byte-identical. The
native-rate array written here is consumed only by the R-AO production-path
gate, whose whole job is to be the live path.

ALGORITHM IDENTITY. This script does not reimplement the frame scan. It
imports `detect_silences` from `phase4-handoff-app-silence.py` by path and
calls it, so the two arms provably differ in INPUT ONLY.

DISCLOSED ASSUMPTION (inferred, bounded by measurement). `decodeAudioData`
resamples to the AudioContext's own sampleRate, which is the output device's
rate and is not observable from here; this script uses the FILE's native rate.
Measured sensitivity on v6: decoding at 48000 instead of 44100 changes exactly
1 of 546 entries, so the arm is insensitive to that uncertainty.

Usage:
    python3 scripts/ws1-native-silences.py --project v6
    python3 scripts/ws1-native-silences.py --all
"""
import argparse
import array
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WORKROOT = REPO / ".work-phase4" / "replay"
CORPUS = Path("/Users/mohtashim/Downloads/All Projects Test Data")
FFMPEG = REPO / "src-tauri" / "binaries" / "ffmpeg-x86_64-apple-darwin"

PROJECTS = {
    "v6":      {"audio": CORPUS / "V6 Natural Long Pause Segs" / "6.m4a",        "rate": 44100},
    "173":     {"audio": CORPUS / "173 Segs Project" / "voiceover.m4a",          "rate": 48000},
    "spanish": {"audio": CORPUS / "Spanish Project" / "Spanish VOiceover.m4a",   "rate": 44100},
}


def load_detect_silences():
    """Import the EXISTING scan out of its dashed-name sibling, by path."""
    path = REPO / "scripts" / "phase4-handoff-app-silence.py"
    spec = importlib.util.spec_from_file_location("phase4_handoff_app_silence", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.detect_silences


def decode_left_channel(audio: Path, rate: int) -> list:
    """ffmpeg -> raw float32 LEFT channel at the file's native rate.

    `pan=mono|c0=c0` takes channel 0 VERBATIM. It is NOT `-ac 1`, which would
    average L+R and reproduce the very defect this arm exists to remove.
    """
    proc = subprocess.run(
        [str(FFMPEG), "-hide_banner", "-loglevel", "error", "-i", str(audio),
         "-af", "pan=mono|c0=c0", "-ar", str(rate),
         "-f", "f32le", "-acodec", "pcm_f32le", "-"],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise SystemExit(f"ffmpeg decode failed for {audio}:\n{proc.stderr.decode()[-2000:]}")
    samples = array.array("f")
    samples.frombytes(proc.stdout)
    return samples


def generate(key: str) -> None:
    p = PROJECTS[key]
    if not p["audio"].exists():
        raise SystemExit(
            f"missing corpus audio: {p['audio']}\n"
            "The corpus lives outside the repo (docs/sync-pipeline-v2-plan.md Part D.0)."
        )
    if not FFMPEG.exists():
        raise SystemExit(f"missing ffmpeg sidecar: {FFMPEG} (gitignored; see src-tauri/binaries/README.md)")

    detect_silences = load_detect_silences()
    rate = p["rate"]
    channel_data = decode_left_channel(p["audio"], rate)
    silences = detect_silences(channel_data, rate)

    outdir = WORKROOT / key
    outdir.mkdir(parents=True, exist_ok=True)
    out = outdir / "silences_native.json"
    with open(out, "w") as f:
        json.dump({
            "source_audio": str(p["audio"]),
            "arm": "native-rate-left-channel",
            "sample_rate": rate,
            "channel": "getChannelData(0) equivalent (pan=mono|c0=c0)",
            "threshold_db": -45.0,
            "min_duration_sec": 0.25,
            "frame_size_ms": 20,
            "n_silences": len(silences),
            "silences": silences,
        }, f, indent=2)
    print(f"[native-silence] {key}: {len(silences)} silences @ {rate}Hz left -> {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", choices=sorted(PROJECTS))
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    keys = sorted(PROJECTS) if args.all else ([args.project] if args.project else [])
    if not keys:
        raise SystemExit("pass --project <key> or --all")
    for k in keys:
        generate(k)


if __name__ == "__main__":
    main()
