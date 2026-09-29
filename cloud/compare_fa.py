#!/usr/bin/env python3
"""Compare two FaWordSpan streams (local vs cloud)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def load_words(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data
    if "words" in data:
        words = data["words"]
        # cargo sweep arm_*.json uses {text, start, end}
        if words and "text" in words[0] and "word" not in words[0]:
            return [
                {
                    "word": w["text"],
                    "startSec": w["start"],
                    "endSec": w["end"],
                    "wordIndex": i,
                }
                for i, w in enumerate(words)
            ]
        return words
    raise ValueError(f"no words in {path}")


def compare(local: list[dict[str, Any]], cloud: list[dict[str, Any]]) -> dict[str, Any]:
    n_local = len(local)
    n_cloud = len(cloud)
    n = min(n_local, n_cloud)
    identical_text = 0
    start_diffs: list[float] = []
    end_diffs: list[float] = []
    mismatches: list[dict[str, Any]] = []
    for i in range(n):
        a, b = local[i], cloud[i]
        ta = (a.get("word") or a.get("text") or "").lower()
        tb = (b.get("word") or b.get("text") or "").lower()
        ds = abs(float(a["startSec"]) - float(b["startSec"]))
        de = abs(float(a["endSec"]) - float(b["endSec"]))
        start_diffs.append(ds)
        end_diffs.append(de)
        if ta == tb:
            identical_text += 1
        else:
            if len(mismatches) < 20:
                mismatches.append({"index": i, "local": ta, "cloud": tb, "dStartSec": ds, "dEndSec": de})

    def dist(diffs: list[float]) -> dict[str, int]:
        return {
            "le10ms": sum(1 for d in diffs if d <= 0.010),
            "le50ms": sum(1 for d in diffs if d <= 0.050),
            "gt50ms": sum(1 for d in diffs if d > 0.050),
            # Wave 3 U8 parity gate: the owner's bar is "within 100 ms". Rounded to
            # milliseconds first so an exactly-100ms difference (0.1000000000000005
            # in floating point) is not tipped over the line by representation noise.
            "le100ms": sum(1 for d in diffs if round(d * 1000) <= 100),
            "gt100ms": sum(1 for d in diffs if round(d * 1000) > 100),
        }

    mean_start = sum(start_diffs) / len(start_diffs) if start_diffs else None
    mean_end = sum(end_diffs) / len(end_diffs) if end_diffs else None
    max_start = max(start_diffs) if start_diffs else None
    max_end = max(end_diffs) if end_diffs else None
    interchangeable = (
        mean_start is not None
        and mean_start < 0.010
        and max_start is not None
        and max_start < 0.050
        and n_local == n_cloud
        and identical_text == n
    )
    return {
        "nLocal": n_local,
        "nCloud": n_cloud,
        "nCompared": n,
        "identicalText": identical_text,
        "onlyLocal": n_local - n,
        "onlyCloud": n_cloud - n,
        "meanAbsStartSec": mean_start,
        "meanAbsEndSec": mean_end,
        "maxAbsStartSec": max_start,
        "maxAbsEndSec": max_end,
        "startDistribution": dist(start_diffs),
        "endDistribution": dist(end_diffs),
        "withinHundredMsPct": {
            "start": round(100.0 * dist(start_diffs)["le100ms"] / len(start_diffs), 3) if start_diffs else None,
            "end": round(100.0 * dist(end_diffs)["le100ms"] / len(end_diffs), 3) if end_diffs else None,
        },
        "interchangeableUnderOwnerThreshold": interchangeable,
        "textMismatchesHead": mismatches,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", required=True)
    parser.add_argument("--cloud", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    result = compare(load_words(Path(args.local)), load_words(Path(args.cloud)))
    Path(args.out).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
