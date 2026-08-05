#!/usr/bin/env python3
"""
extract-full-transcript.py — Phase 3 data-cleaning pass, Step 4 helper
(sync-pipeline-v2-plan.md).

The Phase 2a transcript-inspector CSV exports (docs/{V6,173,Spanish}-Smear-
Phase2a.csv) each contain TWO sections: a UI-table section capped at 1000
rows (the inspector's own on-screen table limit), then a full raw
console-log dump — one browser console.log call's worth of CSV text pasted
as a single quoted field per "row" — that holds the COMPLETE token list.
Reading only the first section silently truncates every project's transcript
to 1000 words (measured: V6/173 both silently cap at exactly 1000 normalized
words this way, invisible unless the row count is cross-checked against the
inspector's own logged "N kept" figure). This script extracts the complete
second section into a flat {text, start, end} JSON array — the shape
measure-forced-alignment-whisper-text.py's --whisper-tokens-json expects,
and the same shape a WER/CER comparison against script text needs to avoid
under-counting.
"""
import argparse
import json
import re


def parse_full_transcript(csv_path: str) -> list:
    text = open(csv_path, encoding="utf-8").read()
    marker = text.find('[Log] index,text,startSec')
    if marker == -1:
        raise ValueError(f"{csv_path}: full-transcript log-dump marker not found — "
                          "is this a transcript-inspector CSV export?")
    tail = text[marker:]
    lines = tail.splitlines()[1:]  # skip the marker line itself
    row_re = re.compile(r'^"(\d+),(.*?),([\d.]+),([\d.]+),([\d.]+),([^,]*),([^,]*),([^"]*)",+$')
    tokens = []
    for line in lines:
        m = row_re.match(line)
        if not m:
            continue
        tokens.append({"idx": int(m.group(1)), "text": m.group(2),
                        "start": float(m.group(3)), "end": float(m.group(4))})
    return tokens


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--csv", required=True, help="a docs/*-Smear-Phase2a.csv transcript-inspector export")
    p.add_argument("--out", required=True, help="output path for the flat {text,start,end} JSON array")
    args = p.parse_args()

    tokens = parse_full_transcript(args.csv)
    with open(args.out, "w") as f:
        json.dump(tokens, f, indent=2)
    print(f"wrote {len(tokens)} tokens -> {args.out}")


if __name__ == "__main__":
    main()
