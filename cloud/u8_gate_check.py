#!/usr/bin/env python3
"""U8 parity gate — the check. Compares a fresh parity result to the recorded one.

    u8_gate_check.py <fresh.json> <recorded.json>

Fails (exit 1) when the fresh run misses the standing gate (>=95% within 100 ms on
start AND end; identical text for every compared word; equal word counts) or drifts
from the recorded numbers by more than 0.05 percentage points. Prints one line.
"""
import json, sys

fresh, rec = (json.load(open(p)) for p in sys.argv[1:3])
name = sys.argv[1]
problems = []
for side in ("start", "end"):
    f, r = fresh["withinHundredMsPct"][side], rec["withinHundredMsPct"][side]
    if f < 95: problems.append(f"{side} within-100ms {f} < 95 (gate)")
    if abs(f - r) > 0.05: problems.append(f"{side} {f} != recorded {r}")
if fresh["identicalText"] != fresh["nCompared"]: problems.append("text mismatch")
if fresh["nLocal"] != fresh["nCloud"]: problems.append(f"word counts {fresh['nLocal']} vs {fresh['nCloud']}")
if fresh["nCompared"] != rec["nCompared"]: problems.append(f"nCompared {fresh['nCompared']} != recorded {rec['nCompared']}")
w = fresh["withinHundredMsPct"]; rw = rec["withinHundredMsPct"]
print(f"{'FAIL' if problems else 'PASS'} {name}: starts {w['start']:.2f} (recorded {rw['start']:.2f})  "
      f"ends {w['end']:.2f} (recorded {rw['end']:.2f})  words {fresh['nCompared']}  identicalText {fresh['identicalText']}"
      + ("  -- " + "; ".join(problems) if problems else ""))
sys.exit(1 if problems else 0)
