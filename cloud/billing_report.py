#!/usr/bin/env python3
"""Wave 3 billing report: the service's own meter against Modal's invoice.

    python cloud/billing_report.py [--since-ts EPOCH]

Two sources, never blended:

- **Meter** — one line per job from the gateway/worker (`meter_lines`):
  worker-seconds measured in-container and a rate-card estimate. Per-job,
  hashes and durations only (operator D4).
- **Modal** — `modal billing report` for the workspace since Wave 3 opened:
  what is actually charged, per app and resource, in whole-hour buckets
  (and lagging by up to an hour). Cumulative spend is checked against the
  operator's $25 Wave 3 cap (D2).
"""

import argparse
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from decimal import Decimal

import modal

WAVE3_START_DATE = "2026-09-27"
WAVE3_CAP_USD = Decimal("25")


def modal_bin() -> str:
    return os.environ.get("MODAL_BIN", "modal")


def meter_section(since_ts: float) -> None:
    lines = modal.Function.from_name("kinetix-sync", "meter_lines").remote(since_ts)
    print(f"METER — {len(lines)} job line(s) since {since_ts}")
    by_key: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for line in lines:
        by_key[(line["stage"], line["outcome"])].append(line)
    total_sec = total_usd = 0.0
    for (stage, outcome), group in sorted(by_key.items()):
        sec = sum(line["workerSec"] for line in group)
        usd = sum(line["estimatedUsd"] for line in group)
        audio_h = sum((line.get("audioDurationSec") or 0) for line in group) / 3600
        total_sec += sec
        total_usd += usd
        print(f"  {stage:<10} {outcome:<10} jobs={len(group):>3}  audio={audio_h:6.3f} h  worker={sec:8.1f} s  est=${usd:.4f}")
    print(f"  {'TOTAL':<21} worker={total_sec:8.1f} s  est=${total_usd:.4f}")


def modal_section() -> None:
    # An explicit end past today: with `--start` alone Modal reports only
    # complete intervals and drops the hour in progress.
    end = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
    proc = subprocess.run(
        [modal_bin(), "billing", "report", "--start", WAVE3_START_DATE, "--end", end, "-r", "h", "--show-resources", "--json"],
        capture_output=True, text=True, check=True,
    )
    rows = json.loads(proc.stdout or "[]")
    by_app: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    for row in rows:
        by_app[row["description"]][row["resource"]] += Decimal(row["cost"])
    total = Decimal(0)
    print(f"MODAL — workspace charges since {WAVE3_START_DATE} (hour buckets, may lag ~1 h)")
    for app_name, resources in sorted(by_app.items()):
        app_total = sum(resources.values(), Decimal(0))
        total += app_total
        detail = ", ".join(f"{r} ${c:.4f}" for r, c in sorted(resources.items()) if c)
        print(f"  {app_name:<24} ${app_total:.4f}  ({detail})")
    print(f"  WAVE 3 CUMULATIVE ${total:.4f} of ${WAVE3_CAP_USD} cap ({total / WAVE3_CAP_USD:.1%})")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--since-ts", type=float, default=0.0)
    args = parser.parse_args()
    meter_section(args.since_ts)
    print()
    modal_section()


if __name__ == "__main__":
    main()
