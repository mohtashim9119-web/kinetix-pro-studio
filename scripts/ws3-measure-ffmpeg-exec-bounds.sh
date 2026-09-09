#!/usr/bin/env bash
# Measures remux and mux wall time for WS3 bound sizing. No live export.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  FFMPEG="${FFMPEG:-$ROOT/src-tauri/binaries/ffmpeg-aarch64-apple-darwin}"
else
  FFMPEG="${FFMPEG:-$ROOT/src-tauri/binaries/ffmpeg-x86_64-apple-darwin}"
fi
WORKDIR="${TMPDIR:-/tmp}/kinetix-ws3-bounds-$$"
mkdir -p "$WORKDIR"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

if [[ ! -x "$FFMPEG" ]]; then
  echo "ffmpeg sidecar missing at $FFMPEG" >&2
  exit 1
fi

echo "ws3-ffmpeg-exec-bounds-measurement workdir=$WORKDIR"

# Per-piece remux (≤60 s 1080p30 piece — REMUX_BOUND_MS sizing input)
PIECE_MP4="$WORKDIR/piece_60s.mp4"
/usr/bin/time -p "$FFMPEG" -hide_banner -loglevel error -y \
  -f lavfi -i testsrc=duration=60:size=1920x1080:rate=30 \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$PIECE_MP4" 2>/dev/null

REMUX_OUT="$WORKDIR/piece_annexb.h264"
/usr/bin/time -p "$FFMPEG" -hide_banner -loglevel error -y \
  -i "$PIECE_MP4" -c:v copy -bsf:v h264_mp4toannexb -f h264 "$REMUX_OUT" 2>&1 | awk '/^real /{print "  remux_60s_piece_s:", $2}'

# Full-timeline mux sizing: ~26 min 1080p30 @ ~9 Mbps (~1.7 GB source)
LONG_MP4="$WORKDIR/long_26min.mp4"
echo "  generating ~26 min 1080p30 source (encode once for mux sizing)..."
/usr/bin/time -p "$FFMPEG" -hide_banner -loglevel error -y \
  -f lavfi -i testsrc=duration=1560:size=1920x1080:rate=30 \
  -c:v libx264 -preset ultrafast -b:v 9M -minrate 9M -maxrate 9M -bufsize 18M -pix_fmt yuv420p "$LONG_MP4" 2>&1 | awk '/^real /{print "  long_encode_s:", $2}'

LONG_H264="$WORKDIR/long_annexb.h264"
/usr/bin/time -p "$FFMPEG" -hide_banner -loglevel error -y \
  -i "$LONG_MP4" -c:v copy -bsf:v h264_mp4toannexb -f h264 "$LONG_H264" 2>&1 | awk '/^real /{print "  long_extract_annexb_s:", $2}'

LONG_BYTES=$(stat -f%z "$LONG_H264" 2>/dev/null || stat -c%s "$LONG_H264")
echo "  long_annexb_bytes: $LONG_BYTES"

MUX_OUT="$WORKDIR/mux_out.mp4"
/usr/bin/time -p "$FFMPEG" -hide_banner -loglevel error -y \
  -r 30 -i "$LONG_H264" -c:v copy -movflags +faststart "$MUX_OUT" 2>&1 | awk '/^real /{print "  mux_video_only_s:", $2}'

# With-audio mux (21 min silence WAV — AAC encode is part of the bound)
AUDIO_WAV="$WORKDIR/vo_21min.wav"
/usr/bin/time -p "$FFMPEG" -hide_banner -loglevel error -y \
  -f lavfi -i anullsrc=r=48000:cl=stereo -t 1260 "$AUDIO_WAV" 2>/dev/null

PREMUX="$WORKDIR/premux.mp4"
/usr/bin/time -p "$FFMPEG" -hide_banner -loglevel error -y \
  -r 30 -i "$LONG_H264" -c:v copy "$PREMUX" 2>&1 | awk '/^real /{print "  premux_video_s:", $2}'

MUX_AUDIO="$WORKDIR/mux_with_audio.mp4"
/usr/bin/time -p "$FFMPEG" -hide_banner -loglevel error -y \
  -i "$PREMUX" -i "$AUDIO_WAV" -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "$MUX_AUDIO" 2>&1 | awk '/^real /{print "  mux_with_audio_s:", $2}'
