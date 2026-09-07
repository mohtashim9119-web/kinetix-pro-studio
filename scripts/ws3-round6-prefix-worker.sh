#!/usr/bin/env bash
# Swap exportWorker.ts to the Round 5 (pre-fix) version for output-equivalence A/B.
# Usage:
#   ./scripts/ws3-round6-prefix-worker.sh save    # stash current → /tmp/ws3-r6-postfix-exportWorker.ts
#   ./scripts/ws3-round6-prefix-worker.sh prefix  # checkout 1b3c03f worker (no release)
#   ./scripts/ws3-round6-prefix-worker.sh restore # put postfix back
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKER="$ROOT/src/services/webcodecsExport/exportWorker.ts"
STASH="/tmp/ws3-r6-postfix-exportWorker.ts"
PREFIX_SHA="1b3c03f"

case "${1:-}" in
  save)
    cp "$WORKER" "$STASH"
    echo "Saved postfix worker → $STASH"
    ;;
  prefix)
    git -C "$ROOT" show "${PREFIX_SHA}:src/services/webcodecsExport/exportWorker.ts" > "$WORKER"
    echo "Installed prefix worker from ${PREFIX_SHA}"
    ;;
  restore)
    if [[ ! -f "$STASH" ]]; then
      echo "Missing $STASH — run 'save' first" >&2
      exit 1
    fi
    cp "$STASH" "$WORKER"
    echo "Restored postfix worker"
    ;;
  *)
    echo "Usage: $0 {save|prefix|restore}" >&2
    exit 1
    ;;
esac
