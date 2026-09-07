#!/usr/bin/env bash
# Poll public/_spike/ws3-result.jsonl for Round 6 completion tags.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JSONL="$ROOT/public/_spike/ws3-result.jsonl"
TAG="${1:-round6-equiv-40s}"
TIMEOUT="${2:-900}"
START=$(date +%s)
while true; do
  NOW=$(date +%s)
  if (( NOW - START > TIMEOUT )); then
    echo "TIMEOUT after ${TIMEOUT}s waiting for tag $TAG" >&2
    exit 1
  fi
  if [[ -f "$JSONL" ]]; then
    if grep -q "\"tag\":\"$TAG\"" "$JSONL" 2>/dev/null; then
      grep "\"tag\":\"$TAG\"" "$JSONL" | tail -1
      exit 0
    fi
    LAST=$(grep round6- "$JSONL" 2>/dev/null | tail -1 || true)
    if [[ -n "$LAST" ]]; then
      echo "WAIT $(date +%H:%M:%S) last=$LAST"
    fi
  fi
  sleep 5
done
