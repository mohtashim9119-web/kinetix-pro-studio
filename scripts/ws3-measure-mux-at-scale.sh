#!/usr/bin/env bash
# Measure the real two-pass muxOnly path at 1.7 GB and 2.3 GB Annex-B.
# Real encoded H.264 (whole GOP tiles), not 0xFF padding, no mid-NAL trim.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export TMPDIR="${TMPDIR:-/var/folders/39/r5vx27154l74y4c2_hp625_w0000gn/T}"
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  FFMPEG="${FFMPEG:-$ROOT/src-tauri/binaries/ffmpeg-aarch64-apple-darwin}"
else
  FFMPEG="${FFMPEG:-$ROOT/src-tauri/binaries/ffmpeg-x86_64-apple-darwin}"
fi
WORKDIR="$TMPDIR/kinetix-ws3-mux-at-scale-$$"

if [[ ! -x "$FFMPEG" ]]; then
  echo "ffmpeg sidecar missing at $FFMPEG" >&2
  exit 1
fi

echo "=== purge stale mux/scale scratch ==="
FREED=0
shopt -s nullglob
for d in "$TMPDIR"/kinetix-ws3-mux-at-scale-* "$TMPDIR"/kinetix-ws3-bounds-*; do
  if [[ -e "$d" ]]; then
    sz=$(du -sk "$d" 2>/dev/null | awk '{print $1}')
    rm -rf "$d"
    FREED=$((FREED + ${sz:-0}))
    echo "  removed $d (${sz:-0} KiB)"
  fi
done
shopt -u nullglob
echo "  purged_kib=$FREED"

mkdir -p "$WORKDIR"
cleanup() {
  if [[ -d "$WORKDIR" ]]; then
    sz=$(du -sk "$WORKDIR" 2>/dev/null | awk '{print $1}')
    rm -rf "$WORKDIR"
    echo "cleanup_freed_kib=${sz:-0} path=$WORKDIR"
  fi
}
trap cleanup EXIT

echo "ws3-mux-at-scale workdir=$WORKDIR ffmpeg=$FFMPEG"

echo "=== encode a real 4s 1080p30 GOP (libx264 annexb) ==="
SEED_MP4="$WORKDIR/seed.mp4"
SEED_H264="$WORKDIR/seed.h264"
"$FFMPEG" -hide_banner -loglevel error -y \
  -f lavfi -i testsrc=duration=4:size=1920x1080:rate=30 \
  -c:v libx264 -preset ultrafast -b:v 12M -pix_fmt yuv420p "$SEED_MP4"
"$FFMPEG" -hide_banner -loglevel error -y \
  -i "$SEED_MP4" -c:v copy -bsf:v h264_mp4toannexb -f h264 "$SEED_H264"
python3 -c "import os,sys; p=sys.argv[1]; fd=os.open(p, os.O_RDONLY); os.fsync(fd); os.close(fd); print('seed_annexb_bytes', os.path.getsize(p))" "$SEED_H264"

echo "=== 21 min silence WAV (AAC mix is part of pass-2) ==="
AUDIO_WAV="$WORKDIR/vo_21min.wav"
"$FFMPEG" -hide_banner -loglevel error -y \
  -f lavfi -i anullsrc=r=48000:cl=stereo -t 1260 "$AUDIO_WAV"

repeat_to_size() {
  local src="$1"
  local dest="$2"
  local target="$3"
  local tmp="$dest.part"
  rm -f "$tmp"
  local written=0
  while true; do
    cat "$src" >> "$tmp"
    written=$(stat -f%z "$tmp")
    if (( written >= target )); then
      break
    fi
  done
  mv "$tmp" "$dest"
  python3 -c "import os,sys; fd=os.open(sys.argv[1], os.O_RDONLY); os.fsync(fd); os.close(fd)" "$dest"
}

measure_two_pass() {
  local label="$1"
  local h264="$2"
  local bytes
  bytes=$(stat -f%z "$h264")
  local premux="$WORKDIR/${label}.premux.mp4"
  local out="$WORKDIR/${label}.mp4"
  local tfile1="$WORKDIR/${label}-pass1.time"
  local tfile2="$WORKDIR/${label}-pass2.time"

  echo "=== two-pass mux $label bytes=$bytes ==="
  /usr/bin/time -l "$FFMPEG" -hide_banner -loglevel error -y \
    -r 30 -i "$h264" -c:v copy -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
    -movflags +faststart "$premux" >"$tfile1" 2>&1
  /usr/bin/time -l "$FFMPEG" -hide_banner -loglevel error -y \
    -i "$premux" -i "$AUDIO_WAV" -c:v copy -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
    -c:a aac -b:a 192k -shortest -movflags +faststart "$out" >"$tfile2" 2>&1

  python3 - "$label" "$bytes" "$tfile1" "$tfile2" <<'PY'
import math, re, sys
label, bytes_s, f1, f2 = sys.argv[1:5]
b = int(bytes_s)
def parse(path):
    text = open(path).read()
    real = re.search(r"([0-9.]+)\s+real", text) or re.search(r"real\s+([0-9.]+)", text)
    rss = re.search(r"(\d+)\s+maximum resident set size", text) or re.search(r"maximum resident set size\s+(\d+)", text)
    return float(real.group(1) if real else 0), int(rss.group(1) if rss else 0)
p1, rss1 = parse(f1)
p2, rss2 = parse(f2)
total_ms = (p1 + p2) * 1000.0
rss = max(rss1, rss2)
bound = math.ceil(total_ms * 25)
print(f"ws3-mux-measurement label={label} bytes={b} pass1_s={p1:.3f} pass2_s={p2:.3f} total_s={p1+p2:.3f} total_ms={total_ms:.1f} peak_rss_bytes={rss} computeMuxBoundMs_from_this={bound}")
PY
}

echo "=== build 1.7 GB real Annex-B (repeated seed GOPs) ==="
H17="$WORKDIR/annexb_1_7gb.h264"
repeat_to_size "$SEED_H264" "$H17" 1700000000
echo "  actual_bytes=$(stat -f%z "$H17")"

echo "=== build 2.3 GB real Annex-B (repeated seed GOPs) ==="
H23="$WORKDIR/annexb_2_3gb.h264"
repeat_to_size "$SEED_H264" "$H23" 2300000000
echo "  actual_bytes=$(stat -f%z "$H23")"

measure_two_pass "1_7gb" "$H17"
measure_two_pass "2_3gb" "$H23"
echo "ws3-mux-at-scale done"
