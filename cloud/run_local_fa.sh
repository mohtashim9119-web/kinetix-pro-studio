#!/usr/bin/env bash
# Local forced-alignment arm, through the SAME Rust path production uses
# (fa-inference, align_chunked over the whole chunk slice — `session_p_regen`).
#
#   cloud/run_local_fa.sh <corpus: v6|173|spanish> <lang> <plan.json> <out-words.json>
#
# Isolation: the test process runs with HOME pointed at a scratch directory whose
# Library/Application Support/com.kinetix.pro-studio/fa-models links the model
# folder, so the operator's real app data is never read or written. (cargo/rustup
# keep their real homes via CARGO_HOME / RUSTUP_HOME.) Set FA_ISOLATE_HOME=0 to opt
# out. All paths default relative to this checkout — no machine-specific paths.
#
# Env overrides: ORT_DYLIB_PATH, FA_MODELS_SRC (folder holding <lang>/model.onnx),
# FA_ISOLATED_HOME (scratch HOME to use/keep).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORPUS="${1:?corpus (v6|173|spanish)}"; LANG_CODE="${2:?language code}"
PLAN="${3:?plan.json}"; OUT="${4:?out words json}"
case "$PLAN" in /*) ;; *) PLAN="$PWD/$PLAN";; esac
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT";; esac

ORT_DYLIB="${ORT_DYLIB_PATH:-$ROOT/src-tauri/onnxruntime/libonnxruntime.1.23.2.dylib}"
[[ -f "$ORT_DYLIB" ]] || { echo "ORT dylib not found: $ORT_DYLIB (set ORT_DYLIB_PATH)" >&2; exit 2; }

# Models: explicit override, else the operator's storage root, else the default app-data location.
find_models() {
  local c
  for c in "${FA_MODELS_SRC:-}" "${KINETIX_ROOT:-}/models/fa-models" \
           "$HOME/Drive/KINETIX-ROOT/models/fa-models" \
           "$HOME/Library/Application Support/com.kinetix.pro-studio/fa-models"; do
    [[ -n "$c" && -f "$c/$LANG_CODE/model.onnx" ]] && { echo "$c"; return; }
  done
}
MODELS_SRC="$(find_models)"
[[ -n "$MODELS_SRC" ]] || { echo "no $LANG_CODE/model.onnx found; set FA_MODELS_SRC" >&2; exit 2; }

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
export ORT_DYLIB_PATH="$ORT_DYLIB" FA_REQUIRE_ORT=1
export FA_REGEN_CORPUS="$CORPUS" FA_REGEN_LANG="$LANG_CODE" FA_REGEN_PLAN="$PLAN" FA_REGEN_OUT="$OUT"

echo "local FA: corpus=$CORPUS lang=$LANG_CODE models=$MODELS_SRC"
cd "$ROOT/src-tauri"
if [[ "${FA_ISOLATE_HOME:-1}" == "1" ]]; then
  export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}" RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
  if [[ -n "${FA_ISOLATED_HOME:-}" ]]; then SCRATCH="$FA_ISOLATED_HOME"; else
    SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/kinetix-fa-home.XXXXXX")"
    # Only our own scratch tree, and only its symlink + empty dirs — never the linked models.
    trap 'rm -f "$SCRATCH/Library/Application Support/com.kinetix.pro-studio/fa-models"; rmdir "$SCRATCH/Library/Application Support/com.kinetix.pro-studio" "$SCRATCH/Library/Application Support" "$SCRATCH/Library" "$SCRATCH" 2>/dev/null || true' EXIT
  fi
  mkdir -p "$SCRATCH/Library/Application Support/com.kinetix.pro-studio"
  ln -sfn "$MODELS_SRC" "$SCRATCH/Library/Application Support/com.kinetix.pro-studio/fa-models"
  export HOME="$SCRATCH"
  echo "isolated HOME=$HOME"
fi
cargo test --release --features fa-inference --lib \
  -- --ignored --nocapture --exact fa_onnx::session_p_regen::regenerate_fa_against_live_plan
[[ -s "$OUT" ]] || { echo "local arm produced no words file ($OUT) — the test skipped or failed" >&2; exit 3; }
echo "wrote $OUT"
