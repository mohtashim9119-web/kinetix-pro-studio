#!/usr/bin/env python3
"""Wave 3 billing report: the service's own meter against Modal's invoice.

    python cloud/billing_report.py [--since-ts EPOCH]

Two sources, never blended (plus one count that is neither):

- **Meter** — one line per job from the gateway/worker (`meter_lines`):
  worker-seconds measured in-container and a rate-card estimate. Per-job,
  hashes and durations only (operator D4).
- **Modal** — `modal billing report` for the workspace since Wave 3 opened:
  what is actually charged, per app and resource, in whole-hour buckets
  (and lagging by up to an hour). Cumulative spend is checked against the
  operator's $25 Wave 3 cap (D2).
- **Lookup hits** (Wave 3 U3) — cache hits answered by `/v1/cache/lookup`
  before any upload. They spend no GPU-second, so they are NOT meter lines;
  they are counted here so a reconciliation can show the work the cache
  absorbed. Their only real cost is the gateway's CPU time, which appears in
  Modal's `kinetix-sync` row, not per hit.
"""

import argparse
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from decimal import Decimal

import modal

import sync_core

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


def row_section(since_ts: float) -> None:
    lines = modal.Function.from_name("kinetix-sync", "meter_lines").remote(since_ts)
    rows = sync_core.row_summaries(lines)
    unused = [line for line in lines if line["outcome"] == "boot-unused"]
    unused_sec = sum(line["workerSec"] for line in unused)
    unused_usd = sum(line["estimatedUsd"] for line in unused)
    print(f"ROWS — {len(rows)} audio row(s)")
    for row in rows:
        start = datetime.fromtimestamp(row["from"]).strftime("%H:%M:%S")
        flag = "cached" if row["cached"] else ("free" if row["free"] else "fresh")
        print(
            f"  {start}  {row['audioHash'][:8]}  boots={row['boots']:>2}  jobs={row['jobs']:>2}  "
            f"held={row['heldSec']:6.1f} s  worker={row['workerSec']:7.1f} s  "
            f"${row['estimatedUsd']:.4f}  {flag}"
        )
    print(f"  BOOT-UNUSED  containers={len(unused)}  {unused_sec:6.1f} s  ${unused_usd:.4f}")


def lane_section(since_ts: float) -> None:
    lines = modal.Function.from_name("kinetix-sync", "meter_lines").remote(since_ts)
    print("LANES — GPU seconds and dollars by lane (no cross-billing)")
    for row in sync_core.lane_summaries(lines):
        print(
            f"  {row['gpuLane']:<8}  boots={row['boots']:>2}  jobs={row['jobs']:>3}  "
            f"worker={row['workerSec']:7.1f} s  ${row['estimatedUsd']:.4f}"
        )


def batch_section(since_ts: float) -> None:
    """Wave 3 U7 — the bulk queue's batches: projects, GPU jobs, containers
    (boots), held/unused seconds and the batch total, one line each."""
    lines = modal.Function.from_name("kinetix-sync", "meter_lines").remote(since_ts)
    batches = sync_core.batch_summaries(lines)
    print(f"BATCHES — {len(batches)} run(s) of back-to-back jobs (gap < {sync_core.BATCH_GAP_SEC:.0f} s)")
    for b in batches:
        start = datetime.fromtimestamp(b["from"]).strftime("%H:%M:%S")
        print(
            f"  {start}  projects={b['projects']:>2} jobs={b['jobs']:>2} boots={b['boots']:>2}  "
            f"held={b['heldSec']:6.1f} s  unused-boot={b['bootResidueSec']:5.1f} s  "
            f"worker={b['workerSec']:7.1f} s  BATCH TOTAL est=${b['estimatedUsd']:.4f}"
        )


def hits_section(since_ts: float) -> None:
    lines = modal.Function.from_name("kinetix-sync", "hit_lines").remote(since_ts)
    by_stage: dict[str, int] = defaultdict(int)
    for line in lines:
        by_stage[line["stage"]] += 1
    detail = ", ".join(f"{stage}={n}" for stage, n in sorted(by_stage.items())) or "none"
    print(f"LOOKUP HITS — {len(lines)} since {since_ts} ({detail}); $0 GPU, no meter line, no upload")


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
    batch_section(args.since_ts)
    print()
    row_section(args.since_ts)
    print()
    lane_section(args.since_ts)
    print()
    hits_section(args.since_ts)
    print()
    modal_section()


if __name__ == "__main__":
    main()
