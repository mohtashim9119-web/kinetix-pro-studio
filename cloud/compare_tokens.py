#!/usr/bin/env python3
"""Compare local whisper.cpp tokens against Modal faster-whisper tokens.

Reports total counts, identical-text matches, mean/max absolute start/end
deltas on matched tokens, and tokens present in only one stream.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

STDOUT_RE = re.compile(
    r"^\[(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\]\s*(.*)$"
)


def hms_to_sec(h: str, m: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


def parse_whisper_cpp_stdout(text: str) -> list[dict[str, Any]]:
    tokens: list[dict[str, Any]] = []
    for line in text.splitlines():
        match = STDOUT_RE.match(line.strip())
        if not match:
            continue
        body = match.group(9).strip()
        if not body:
            continue
        tokens.append(
            {
                "startSec": hms_to_sec(*match.group(1, 2, 3, 4)),
                "endSec": hms_to_sec(*match.group(5, 6, 7, 8)),
                "text": body,
            }
        )
    return tokens


def canonicalize(text: str) -> str:
    folded = unicodedata.normalize("NFKC", text).casefold().strip()
    return re.sub(r"[^\w']+", "", folded, flags=re.UNICODE)


def load_tokens(path: Path) -> list[dict[str, Any]]:
    raw = path.read_text(encoding="utf-8")
    if path.suffix == ".json":
        data = json.loads(raw)
        if isinstance(data, dict) and "tokens" in data:
            return data["tokens"]
        if isinstance(data, list):
            return data
        raise ValueError(f"unrecognized JSON token file: {path}")
    return parse_whisper_cpp_stdout(raw)


def compare(local: list[dict[str, Any]], cloud: list[dict[str, Any]]) -> dict[str, Any]:
    local_keys = [canonicalize(t["text"]) for t in local]
    cloud_keys = [canonicalize(t["text"]) for t in cloud]
    matcher = SequenceMatcher(a=local_keys, b=cloud_keys, autojunk=False)

    matched: list[dict[str, Any]] = []
    only_local: list[dict[str, Any]] = []
    only_cloud: list[dict[str, Any]] = []
    identical_text = 0

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for i, j in zip(range(i1, i2), range(j1, j2)):
                lt, ct = local[i], cloud[j]
                if lt["text"].strip() == ct["text"].strip():
                    identical_text += 1
                matched.append(
                    {
                        "local": lt,
                        "cloud": ct,
                        "dStart": abs(lt["startSec"] - ct["startSec"]),
                        "dEnd": abs(lt["endSec"] - ct["endSec"]),
                    }
                )
        elif tag == "delete":
            only_local.extend(local[i1:i2])
        elif tag == "insert":
            only_cloud.extend(cloud[j1:j2])
        else:
            only_local.extend(local[i1:i2])
            only_cloud.extend(cloud[j1:j2])

    def stats(values: list[float]) -> dict[str, float]:
        if not values:
            return {"mean": 0.0, "max": 0.0, "median": 0.0}
        return {
            "mean": statistics.fmean(values),
            "max": max(values),
            "median": statistics.median(values),
        }

    start_stats = stats([m["dStart"] for m in matched])
    end_stats = stats([m["dEnd"] for m in matched])
    interchangeable = (
        len(matched) > 0
        and start_stats["mean"] <= 0.050
        and end_stats["mean"] <= 0.050
        and identical_text / max(len(local), 1) >= 0.90
    )
    return {
        "localCount": len(local),
        "cloudCount": len(cloud),
        "matchedCount": len(matched),
        "identicalTextCount": identical_text,
        "onlyLocalCount": len(only_local),
        "onlyCloudCount": len(only_cloud),
        "startAbsDiffSec": start_stats,
        "endAbsDiffSec": end_stats,
        "interchangeableForSync": interchangeable,
        "onlyLocalHead": only_local[:20],
        "onlyCloudHead": only_cloud[:20],
        "worstStart": sorted(matched, key=lambda m: m["dStart"], reverse=True)[:5],
        "worstEnd": sorted(matched, key=lambda m: m["dEnd"], reverse=True)[:5],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", required=True, type=Path)
    parser.add_argument("--cloud", required=True, type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    report = compare(load_tokens(args.local), load_tokens(args.cloud))
    text = json.dumps(report, indent=2)
    print(text)
    if args.out:
        args.out.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
