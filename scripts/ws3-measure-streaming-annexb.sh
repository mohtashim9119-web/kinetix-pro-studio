#!/usr/bin/env bash
# Measures peak RSS (macOS `/usr/bin/time -l`) and wall time for streaming
# count/truncate and native concat at 1.7 GB and 2.3 GB.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CARGO_TARGET_DIR="$ROOT/src-tauri/target"
cd "$ROOT/src-tauri"

echo "ws3-streaming-annexb-measurement (timing via cargo test --release, RSS via time -l)"

/usr/bin/time -l cargo test --release measure_streaming_annexb_at_scale -- \
  --ignored --nocapture 2>&1 | tee /tmp/ws3-streaming-timing.txt

echo "--- native concat at 1.7 GB (actual Rust command, not cat) ---"
/usr/bin/time -l cargo test --release measure_export_scale_native_io_on_disk -- \
  --ignored --nocapture 2>&1 | tee /tmp/ws3-native-io-timing.txt
