#!/usr/bin/env python3
"""
capture-fa-e2e-reference.py — full end-to-end forced-alignment reference
(WS1 Task 5, Slice D4).

WHY THIS EXISTS
D2 (`scripts/capture-fa-onnx-reference.py`) proved the Rust `ort` forward
pass reproduces a Python (onnxruntime) emission matrix for the real
jonatasgrosman ONNX models. D3 (`src-tauri/src/fa/text.rs`) proved the Rust
text normalizer is byte-identical to the live TS `faTextNormalize.ts`
module. Neither proved the full PIPELINE — model -> forward pass -> tokenize
-> Viterbi -> merged token spans — produces identical frame boundaries to a
real, independent reference implementation. This script produces that
reference, for the same three real audio windows the D2/D3 fixtures already
use.

WHAT IT DOES, PER FIXTURE CASE
  1. Reuses `scripts/fixtures/fa-onnx-emission-<case>.json`'s own
     `input_samples` (raw, unnormalized audio window) and `emission_log_probs`
     (the D2 onnxruntime-captured, log_softmax'd emission matrix for the real
     jonatasgrosman model) VERBATIM — not recomputed, not modified. This
     script does not touch that fixture.
  2. Shells out to `npx tsx scripts/generate-fa-e2e-tokens.ts`, which drives
     the live `src/services/faTextNormalize.ts` module (the D3-proven source
     of truth) over the case's fixed target text and maps the result to
     per-language vocab token ids — the same tokenization contract
     `src-tauri/src/fa_onnx.rs`'s `text_to_token_ids` implements in Rust.
  3. Runs REAL torchaudio 2.2.2's `torchaudio.functional.forced_align` +
     `torchaudio.functional.merge_tokens` over (emission, target_token_ids)
     — an INDEPENDENT C++ implementation of the exact same CTC forced-
     alignment DP `src-tauri/src/fa_viterbi.rs` was hand-ported from (see
     that file's own module doc comment), not derived from or run against
     any Rust output at any step.
  4. Writes `scripts/fixtures/fa-e2e-alignment-<case>.json`: input_samples,
     target_token_ids, blank_id, and the resulting per-token spans (token id,
     start frame inclusive, end frame exclusive, mean log-prob score).

A NEW fixture family, distinct from and never overwriting:
  - `fa-emission-*.json` — MMS_FA DP-correctness-only fixtures (different
    model/vocab entirely, see `capture-fa-onnx-reference.py`'s own docstring)
  - `fa-onnx-emission-*.json` — D2's forward-pass-only fixtures (no
    tokenization/alignment; this script reads but never writes these)

DEPENDENCIES: torch, torchaudio (already in `.venv-phase4-fa`, the same env
`scripts/measure-forced-alignment-hf.py` uses), plus a working `npx tsx`
(already a repo devDependency, see `scripts/generate-fa-text-fixture.ts`).

USAGE
  .venv-phase4-fa/bin/python3 scripts/capture-fa-e2e-reference.py
"""

import json
import subprocess
import sys
from pathlib import Path

import torch
import torchaudio

REPO_ROOT = Path(__file__).resolve().parent.parent

# (file key, source D2 onnx-emission fixture name)
CASES = [
    ("en-deep-night", "fa-onnx-emission-en-deep-night.json"),
    ("en-mother-look", "fa-onnx-emission-en-mother-look.json"),
    ("es-resultan-inutiles", "fa-onnx-emission-es-resultan-inutiles.json"),
]


def load_target_tokens() -> dict:
    proc = subprocess.run(
        ["npx", "tsx", str(REPO_ROOT / "scripts" / "generate-fa-e2e-tokens.ts")],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise SystemExit(
            f"generate-fa-e2e-tokens.ts failed (exit {proc.returncode}):\n{proc.stderr}"
        )
    data = json.loads(proc.stdout)
    return {entry["file"]: entry for entry in data}


def capture_one(file_key: str, onnx_emission_name: str, tokens: dict) -> dict:
    onnx_path = REPO_ROOT / "scripts" / "fixtures" / onnx_emission_name
    onnx = json.loads(onnx_path.read_text())

    emission = torch.tensor(onnx["emission_log_probs"], dtype=torch.float32).unsqueeze(0)  # [1, T, C]

    token_entry = tokens[file_key]
    target_ids = token_entry["targetTokenIds"]
    blank_id = token_entry["blankId"]
    targets = torch.tensor([target_ids], dtype=torch.int32)  # [1, L]

    path, scores = torchaudio.functional.forced_align(emission, targets, blank=blank_id)
    spans = torchaudio.functional.merge_tokens(path[0], scores[0], blank=blank_id)

    expected_spans = [
        {"token": int(s.token), "start": int(s.start), "end": int(s.end), "score": float(s.score)}
        for s in spans
    ]

    out = {
        "_provenance": {
            "generatedBy": "scripts/capture-fa-e2e-reference.py",
            "note": (
                "Full end-to-end forced-alignment reference: real jonatasgrosman ONNX "
                f"emission (reused verbatim from scripts/fixtures/{onnx_emission_name}, itself "
                "an onnxruntime capture -- see capture-fa-onnx-reference.py), tokenized via the "
                "live TS faTextNormalize.ts module (scripts/generate-fa-e2e-tokens.ts), aligned "
                "via REAL torchaudio 2.2.2 forced_align/merge_tokens (an independent "
                "implementation of the same DP src-tauri/src/fa_viterbi.rs hand-ports) -- NOT "
                "sourced from Rust output at any step. Distinct fixture family from "
                "fa-emission-*.json (MMS_FA DP fixtures) and fa-onnx-emission-*.json (D2 "
                "forward-pass-only fixtures); neither is modified by this script."
            ),
            "language": onnx["_provenance"]["language"],
            "text": token_entry["text"],
            "normalizedText": token_entry["normalizedText"],
            "sourceOnnxEmissionFixture": onnx_emission_name,
            "torchVersion": torch.__version__,
            "torchaudioVersion": torchaudio.__version__,
        },
        "input_samples": onnx["input_samples"],
        "target_token_ids": target_ids,
        "blank_id": blank_id,
        "expected_spans": expected_spans,
    }
    return out


def main() -> int:
    tokens = load_target_tokens()
    for file_key, onnx_emission_name in CASES:
        print(f"=== {file_key} ===", file=sys.stderr)
        result = capture_one(file_key, onnx_emission_name, tokens)
        out_path = REPO_ROOT / "scripts" / "fixtures" / f"fa-e2e-alignment-{file_key}.json"
        out_path.write_text(json.dumps(result) + "\n")
        print(
            f"-> {out_path} ({len(result['target_token_ids'])} target tokens, "
            f"{len(result['expected_spans'])} merged spans)",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
