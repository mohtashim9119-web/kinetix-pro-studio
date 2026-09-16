#!/usr/bin/env python3
"""Chunk-boundary integrity over a stitched FA word list + chunk plan."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fa_engine import load_vocab, normalize_for_forced_alignment  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--words", required=True)
    parser.add_argument("--chunks", required=True)
    parser.add_argument("--language", default="en")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    words_raw = json.loads(Path(args.words).read_text(encoding="utf-8"))
    words = words_raw["words"] if isinstance(words_raw, dict) else words_raw
    if words and "text" in words[0] and "word" not in words[0]:
        words = [
            {"word": w["text"], "startSec": w["start"], "endSec": w["end"], "wordIndex": i}
            for i, w in enumerate(words)
        ]
    plan = json.loads(Path(args.chunks).read_text(encoding="utf-8"))
    chunks = plan["chunks"] if isinstance(plan, dict) else plan
    vocab = load_vocab(args.language)

    expected: list[str] = []
    per_chunk: list[list[str]] = []
    for chunk in chunks:
        mapped = [
            w["mapped"]
            for w in normalize_for_forced_alignment(chunk["text"], args.language, vocab)
            if w.get("representable")
        ]
        per_chunk.append(mapped)
        expected.extend(mapped)

    got = [(w.get("word") or w.get("text") or "") for w in words]
    duplicates = []
    seen = {}
    for i, w in enumerate(got):
        key = (w, round(float(words[i]["startSec"]), 4))
        if key in seen:
            duplicates.append({"index": i, "word": w, "startSec": words[i]["startSec"]})
        seen[key] = i

    missing = []
    extra = []
    # Sequential compare by representable text
    gi = 0
    for e in expected:
        if gi < len(got) and got[gi] == e:
            gi += 1
        else:
            missing.append(e)
            # skip forward in got if this expected word appears later
            try:
                j = got.index(e, gi)
                extra.extend(got[gi:j])
                gi = j + 1
                missing.pop()
            except ValueError:
                pass
    extra.extend(got[gi:])

    # Gap / overlap between consecutive words (chunk seams included)
    gaps = []
    overlaps = []
    for i in range(1, len(words)):
        prev_end = float(words[i - 1]["endSec"])
        start = float(words[i]["startSec"])
        delta = start - prev_end
        if delta > 0.05:
            gaps.append({"index": i, "gapSec": delta, "prev": words[i - 1].get("word"), "word": words[i].get("word"), "t": start})
        elif delta < -1e-9:
            overlaps.append({"index": i, "overlapSec": -delta, "prev": words[i - 1].get("word"), "word": words[i].get("word")})

    indices = [int(w.get("wordIndex", i)) for i, w in enumerate(words)]
    index_ok = indices == list(range(len(words)))

    payload = {
        "nExpectedRepresentable": len(expected),
        "nGot": len(got),
        "nChunks": len(chunks),
        "everyWordExactlyOnce": len(got) == len(expected) and got == expected,
        "wordIndexGapless": index_ok,
        "nMissing": len(missing),
        "nExtra": len(extra),
        "nDuplicatesByTextAndStart": len(duplicates),
        "nGapsGt50ms": len(gaps),
        "nOverlaps": len(overlaps),
        "missingHead": missing[:20],
        "extraHead": extra[:20],
        "duplicatesHead": duplicates[:20],
        "gapsHead": gaps[:20],
        "overlapsHead": overlaps[:10],
        "firstLast": {
            "first": words[0] if words else None,
            "last": words[-1] if words else None,
        },
    }
    Path(args.out).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps({k: payload[k] for k in payload if not k.endswith("Head") and k != "firstLast"}, indent=2))


if __name__ == "__main__":
    main()
