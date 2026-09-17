#!/usr/bin/env python3
"""Prove the Python Viterbi port matches fa_viterbi.rs fixture output."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fa_engine import forced_align, merge_tokens, normalize_for_forced_alignment, load_vocab  # noqa: E402

FIXTURES = ROOT / "scripts" / "fixtures"
EMISSIONS = [
    "fa-emission-en-deep-night.json",
    "fa-emission-en-mother-look.json",
    "fa-emission-es-resultan-inutiles.json",
]


def run_emission(name: str) -> None:
    v = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    blank = int(v["blank_id"])
    targets = [int(x) for x in v["target_token_ids"]]
    emission = [[float(x) for x in row] for row in v["emission_log_probs"]]
    result = forced_align(emission, targets, blank)
    expected_path = [int(x) for x in v["expected_path"]]
    if result.path != expected_path:
        for i, (got, want) in enumerate(zip(result.path, expected_path)):
            if got != want:
                raise SystemExit(f"{name}: path diverges at frame {i}: got {got} want {want}")
        raise SystemExit(f"{name}: path length {len(result.path)} vs {len(expected_path)}")
    for i, (got, want) in enumerate(zip(result.scores, v["expected_per_frame_scores"])):
        if abs(got - float(want)) > 1e-5:
            raise SystemExit(f"{name}: score diverges at frame {i}: got {got} want {want}")
    spans = merge_tokens(result.path, result.scores, blank)
    expected = v["expected_merged_spans"]
    if len(spans) != len(expected):
        raise SystemExit(f"{name}: span count {len(spans)} vs {len(expected)}")
    for got, want in zip(spans, expected):
        if got.token != int(want["token"]) or got.start != int(want["start"]) or got.end != int(want["end"]):
            raise SystemExit(f"{name}: span mismatch {got} vs {want}")
        if abs(got.score - float(want["score"])) > 1e-5:
            raise SystemExit(f"{name}: span score {got.score} vs {want['score']}")
    print(f"ok {name} path={len(result.path)} spans={len(spans)}")


def run_normalizer_sample() -> None:
    vocab = load_vocab("en")
    words = normalize_for_forced_alignment("You are seven years old.", "en", vocab)
    mapped = [w["mapped"] for w in words if w.get("representable")]
    if mapped != ["you", "are", "seven", "years", "old"]:
        raise SystemExit(f"en normalize mismatch: {mapped}")
    vocab_es = load_vocab("es")
    es = normalize_for_forced_alignment("Scylla es un monstruo.", "es", vocab_es)
    mapped_es = [w["mapped"] for w in es if w.get("representable")]
    if mapped_es != ["scylla", "es", "un", "monstruo"]:
        raise SystemExit(f"es normalize mismatch: {mapped_es}")
    print("ok normalizer sample en/es")


def main() -> None:
    for name in EMISSIONS:
        run_emission(name)
    run_normalizer_sample()
    print("all decoder fixtures passed")


if __name__ == "__main__":
    main()
