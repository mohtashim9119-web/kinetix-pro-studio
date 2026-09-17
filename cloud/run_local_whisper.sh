#!/usr/bin/env bash
# Local whisper.cpp sidecar, production arguments: -m -f -ml 1 -l <code>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WAV="${1:-$ROOT/cloud/fixtures/v6_16k.wav}"
LANG="${2:-en}"
OUT_DIR="$ROOT/cloud/results"
mkdir -p "$OUT_DIR"

WHISPER="${WHISPER_BIN:-/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio/src-tauri/binaries/whisper-x86_64-apple-darwin}"
MODEL="${WHISPER_MODEL:-/Users/mohtashim/Drive/TEST/models/ggml-large-v3-turbo.bin}"

if [[ ! -x "$WHISPER" ]]; then
  echo "missing whisper-cli: $WHISPER" >&2
  exit 1
fi
if [[ ! -f "$MODEL" ]]; then
  echo "missing ggml weights: $MODEL" >&2
  exit 1
fi
if [[ ! -f "$WAV" ]]; then
  echo "missing wav: $WAV" >&2
  exit 1
fi

STEM="$OUT_DIR/v6_local"
echo "whisper-cli -m ggml-large-v3-turbo.bin -f $(basename "$WAV") -ml 1 -l $LANG"
/usr/bin/time -l "$WHISPER" -m "$MODEL" -f "$WAV" -ml 1 -l "$LANG" \
  > "$STEM.stdout" 2> "$STEM.stderr"

echo "wrote $STEM.stdout"
wc -l "$STEM.stdout"
