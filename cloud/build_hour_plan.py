#!/usr/bin/env python3
"""Tile a V6 chunk plan across the one-hour concatenated fixture."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
V6_DUR = 1421.29
HOUR = 3600.0


def main() -> None:
    src = json.loads((ROOT / "cloud/results/chunk_plan_v6.json").read_text(encoding="utf-8"))
    chunks = src["chunks"]
    tiled = []
    offset = 0.0
    while offset < HOUR:
        for c in chunks:
            start = c["startSec"] + offset
            end = c["endSec"] + offset
            if start >= HOUR:
                break
            tiled.append(
                {
                    "startSec": start,
                    "endSec": min(end, HOUR),
                    "text": c["text"],
                }
            )
            if end >= HOUR:
                break
        offset += V6_DUR
    payload = {
        "audioDuration": HOUR,
        "language": "en",
        "source": "v6 tiled",
        "v6Duration": V6_DUR,
        "nChunks": len(tiled),
        "chunks": tiled,
    }
    dest = ROOT / "cloud/results/chunk_plan_hour.json"
    dest.write_text(json.dumps(payload), encoding="utf-8")
    print(f"hour plan: {len(tiled)} chunks, last end={tiled[-1]['endSec']:.2f} -> {dest}")


if __name__ == "__main__":
    main()
