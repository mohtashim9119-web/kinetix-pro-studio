#!/usr/bin/env bash
# One-shot Mac helper for Round 6 live proof. Does NOT start Tauri — run in another terminal.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SPIKE="$ROOT/public/_spike"
mkdir -p "$SPIKE"

export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/src-tauri/target}"

PHASE="${1:-equiv-40s}"
LABEL="${2:-post-fix}"

cp "$ROOT/src/dev/exportLivenessProbe/ws3-autorun.example.json" "$SPIKE/ws3-autorun.json"
node -e "
const fs=require('fs');
const p='$SPIKE/ws3-autorun.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.phase='$PHASE';
j.label='$LABEL';
j.run=true;
fs.writeFileSync(p, JSON.stringify(j, null, 2)+'\n');
"

echo "Wrote $SPIKE/ws3-autorun.json (phase=$PHASE label=$LABEL)"
echo "CARGO_TARGET_DIR=$CARGO_TARGET_DIR"
echo ""
echo "In another terminal:"
echo "  cd \"$ROOT\""
echo "  export CARGO_TARGET_DIR=\"$CARGO_TARGET_DIR\""
echo "  npm run tauri:dev"
echo ""
echo "Then reload the app once. Tail results:"
echo "  tail -f \"$SPIKE/ws3-result.jsonl\""
echo ""
echo "Pre-fix A/B:"
echo "  ./scripts/ws3-round6-prefix-worker.sh save"
echo "  ./scripts/ws3-round6-prefix-worker.sh prefix"
echo "  ./scripts/ws3-round6-mac-run.sh equiv-40s pre-fix"
echo "  ./scripts/ws3-round6-prefix-worker.sh restore"
echo "  npx tsx scripts/ws3-round6-diff-jsonl.ts post-fix pre-fix"
