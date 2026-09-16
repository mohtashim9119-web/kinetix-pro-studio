#!/usr/bin/env bash
# Live local FA through the existing Rust path (fa-inference, production load_session).
# Dumps words to $OUT_DIR/arm_prod.json via intra_thread_sweep_arm_v6.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${FA_SWEEP_OUT_DIR:-$ROOT/cloud/results/local_fa_v6}"
ORT_DYLIB="${ORT_DYLIB_PATH:-/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio/.work-phase4/spike-runtime/onnxruntime-osx-x86_64-1.23.2/lib/libonnxruntime.dylib}"
REPLAY_SRC="${FA_REPLAY_SRC:-/Users/mohtashim/Drive/Vibe Coding Projects/4.kinetix-pro-studio/.work-phase4/replay}"
MODELS_SRC="${FA_MODELS_SRC:-/Users/mohtashim/Drive/All Data/TEST/models/fa-models}"
MODELS_DST="$HOME/Library/Application Support/com.kinetix.pro-studio/fa-models"

mkdir -p "$OUT_DIR"
mkdir -p "$ROOT/.work-phase4"
if [[ ! -e "$ROOT/.work-phase4/replay" ]]; then
  ln -s "$REPLAY_SRC" "$ROOT/.work-phase4/replay"
fi
mkdir -p "$MODELS_DST"
if [[ ! -e "$MODELS_DST/en/model.onnx" ]]; then
  ln -sfn "$MODELS_SRC/en" "$MODELS_DST/en"
fi
if [[ ! -e "$MODELS_DST/es/model.onnx" ]]; then
  ln -sfn "$MODELS_SRC/es" "$MODELS_DST/es"
fi

export ORT_DYLIB_PATH="$ORT_DYLIB"
export FA_SWEEP_OUT_DIR="$OUT_DIR"
export FA_SWEEP_INTRA="${FA_SWEEP_INTRA:-prod}"

echo "ORT_DYLIB_PATH=$ORT_DYLIB_PATH"
echo "FA_SWEEP_OUT_DIR=$FA_SWEEP_OUT_DIR"
echo "running intra_thread_sweep_arm_v6 (production load_session)"

cd "$ROOT/src-tauri"
cargo test --release --features fa-inference --lib \
  -- --ignored --nocapture --exact \
  fa_onnx::intra_thread_sweep::intra_thread_sweep_arm_v6

echo "wrote $OUT_DIR"
ls -l "$OUT_DIR"
