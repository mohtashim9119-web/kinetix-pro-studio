#!/usr/bin/env bash
# U8 parity gate, end to end, one command, from a clean checkout:
#
#     cloud/u8_gate.sh              # all three corpora: spanish, 173, v6
#     cloud/u8_gate.sh spanish      # one corpus
#
# Standing ruling: no engine-default change ships without this green.
#
# Per corpus: build the production chunk plan (cloud/build_chunk_plan.ts) -> align it locally
# (cloud/run_local_fa.sh, isolated HOME) -> fetch the cloud alignment (cloud/u8_cloud_align.py;
# a cache HIT costs nothing, a miss is REFUSED unless U8_ALLOW_CLOUD_SPEND=1) -> compare
# (cloud/compare_fa.py) -> check against cloud/results/u8_parity_<corpus>.json (u8_gate_check.py).
#
# Prerequisites: `npm ci`; cloud/.venv (python); cloud/.keys/operator.key; the source voiceovers
# (override with U8_AUDIO_SPANISH / U8_AUDIO_173 / U8_AUDIO_V6, or U8_TESTDATA=<folder>);
# FA models + ORT dylib (see cloud/run_local_fa.sh). Working files: $U8_WORK (default
# .work-phase4/u8-gate, git-ignored). Recorded results are never overwritten; U8_RECORD=1 does that.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
U8_WORK="${U8_WORK:-$ROOT/.work-phase4/u8-gate}"
export U8_WORK U8_OUT_DIR="$U8_WORK"
PY="${U8_PYTHON:-$ROOT/cloud/.venv/bin/python}"
[[ -x "$PY" ]] || PY="$(command -v python3)"
TESTDATA="${U8_TESTDATA:-$HOME/Downloads/All Projects Test Data}"
# (no bash-4 features: macOS ships bash 3.2)
audio_for() { case "$1" in
  spanish) echo "${U8_AUDIO_SPANISH:-$TESTDATA/Spanish Project/Spanish VOiceover.m4a}";;
  173)     echo "${U8_AUDIO_173:-$TESTDATA/173 Segs Project/voiceover.m4a}";;
  v6)      echo "${U8_AUDIO_V6:-$TESTDATA/V6 Natural Long Pause Segs/Voice.m4a}";;
  *) echo "unknown corpus $1 (spanish|173|v6)" >&2; exit 2;; esac; }
lang_for() { case "$1" in spanish) echo es;; *) echo en;; esac; }
CORPORA=("$@"); [[ ${#CORPORA[@]} -gt 0 ]] || CORPORA=(spanish 173 v6)

cd "$ROOT"
fail=0
for c in "${CORPORA[@]}"; do
  echo "=== $c ==="
  d="$U8_WORK/$c"; mkdir -p "$d"
  audio="$(audio_for "$c")"; lang="$(lang_for "$c")"
  [[ -f "$audio" ]] || { echo "voiceover not found: $audio (set U8_AUDIO_$(echo "$c" | tr a-z A-Z))" >&2; exit 2; }
  npx --yes tsx cloud/build_chunk_plan.ts "$c" --out "$d/u8_plan.json"
  cloud/run_local_fa.sh "$c" "$lang" "$d/u8_plan.json" "$d/u8_local_words.json"
  "$PY" cloud/u8_cloud_align.py "$c" "$lang" "$audio"
  "$PY" cloud/compare_fa.py --local "$d/u8_local_words.json" --cloud "$d/u8_cloud_words.json" --out "$d/u8_parity.json" >/dev/null
  "$PY" cloud/u8_gate_check.py "$d/u8_parity.json" "cloud/results/u8_parity_$c.json" || fail=1
  [[ "${U8_RECORD:-0}" == "1" ]] && cp "$d/u8_parity.json" "cloud/results/u8_parity_$c.json"
done
[[ $fail -eq 0 ]] && echo "U8 GATE: GREEN" || { echo "U8 GATE: RED" >&2; exit 1; }
