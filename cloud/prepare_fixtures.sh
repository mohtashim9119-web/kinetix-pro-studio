#!/usr/bin/env bash
# Prepare V6 and one-hour measurement fixtures under cloud/fixtures/.
# Audio is gitignored. Requires ffmpeg with libopus.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/cloud/fixtures"
mkdir -p "$OUT"

SRC="${V6_M4A:-/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a}"
if [[ ! -f "$SRC" ]]; then
  echo "missing V6 voiceover: $SRC" >&2
  exit 1
fi

echo "WAV 16 kHz mono pcm_s16le (production flags -ar 16000 -ac 1)"
ffmpeg -y -i "$SRC" -ar 16000 -ac 1 "$OUT/v6_16k.wav"

echo "Opus CBR 16 kbps (plan-specified upload setting)"
ffmpeg -y -i "$SRC" -ar 16000 -ac 1 -c:a libopus -b:a 16k -vbr off "$OUT/v6_16k_cbr16k.opus"

WAV="$OUT/v6_16k.wav"
LIST="$OUT/concat-v6.txt"
{
  echo "file '$WAV'"
  echo "file '$WAV'"
  echo "file '$WAV'"
} > "$LIST"

echo "one-hour WAV: concat-to-exceed then -t 3600"
ffmpeg -y -f concat -safe 0 -i "$LIST" -t 3600 -ar 16000 -ac 1 "$OUT/hour_16k.wav"
rm -f "$LIST"

echo "one-hour Opus CBR 16 kbps"
ffmpeg -y -i "$OUT/hour_16k.wav" -ar 16000 -ac 1 -c:a libopus -b:a 16k -vbr off "$OUT/hour_16k_cbr16k.opus"

python3 - <<'PY'
import os, subprocess
from pathlib import Path
out = Path("cloud/fixtures")
plan_wav, plan_opus = 115_200_078, 7_477_405
for name in ["v6_16k.wav", "v6_16k_cbr16k.opus", "hour_16k.wav", "hour_16k_cbr16k.opus"]:
    p = out / name
    size = p.stat().st_size
    dur = float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(p),
    ]))
    print(f"{name}: {size} bytes, {dur:.6f}s")
    print(f"  plan-scaled wav={plan_wav * dur/3600:.1f} opus={plan_opus * dur/3600:.1f}")
    if abs(dur - 3600) < 0.05:
        print(f"  vs plan hour wav Δ={size - plan_wav} opus Δ={size - plan_opus}")
PY
