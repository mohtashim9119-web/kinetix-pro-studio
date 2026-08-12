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

DEPENDENCIES: torch, torchaudio, onnxruntime, soundfile, numpy (all already in
`.venv-phase4-fa`), plus a working `npx tsx` (already a repo devDependency,
see `scripts/generate-fa-text-fixture.ts`).

USAGE
  .venv-phase4-fa/bin/python3 scripts/capture-fa-e2e-reference.py

---------------------------------------------------------------------------
WS1 Task 5, Slice D5 addendum -- fr/de/pt via RAW_CLIP_CASES
---------------------------------------------------------------------------
No `fa-onnx-emission-*.json` D2 fixture exists for fr/de/pt (D2 only
captured en/en/es), and no MMS_FA `fa-emission-*.json` fixture exists to
window against either. Real fr/de/pt audio was also unavailable anywhere in
this repo/private corpus until three short, real utterances were sourced
from google/fleurs (CC-BY-4.0, HF-hosted, validation split) for this slice
(see docs/ws1-sync-pipeline/fa-text-to-spans-seam-d5-2026-08-12.md for the
investigation). RAW_CLIP_CASES below therefore runs the ONNX forward pass
itself (via onnxruntime, same preprocessing as `capture-fa-onnx-reference.py`)
directly against the whole real clip (no windowing -- each clip already is a
short standalone utterance), keeping the SAME per-case output schema and the
SAME independent-torchaudio-DP step as `capture_one` above -- the only
difference is where the emission matrix comes from (computed inline here
instead of read from a committed D2 fixture), because committing an
intermediate `fa-onnx-emission-{fr,de,pt}-*.json` fixture would itself run
well over the 2 MB per-fixture budget (T*C emission floats dominate; T=~300
frames * C up to 59 classes as text). The final `fa-e2e-alignment-*.json`
fixture (input_samples + target_token_ids + blank_id + expected_spans, no
emission matrix) stays well under that budget, same as the three D2-sourced
cases.
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf
import torch
import torchaudio

REPO_ROOT = Path(__file__).resolve().parent.parent
APP_IDENTIFIER = "com.kinetix.pro-studio"
SAMPLE_RATE = 16000

# (file key, source D2 onnx-emission fixture name)
CASES = [
    ("en-deep-night", "fa-onnx-emission-en-deep-night.json"),
    ("en-mother-look", "fa-onnx-emission-en-mother-look.json"),
    ("es-resultan-inutiles", "fa-onnx-emission-es-resultan-inutiles.json"),
]

# (file key, language, source_audio relative path) -- see module doc comment
RAW_CLIP_CASES = [
    ("fr-pas-juste", "fr", ".work-phase4/replay/fr/audio_16k.wav"),
    ("de-nicht-fair", "de", ".work-phase4/replay/de/audio_16k.wav"),
    ("pt-site-publico", "pt", ".work-phase4/replay/pt/audio_16k.wav"),
]


def default_fa_models_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_IDENTIFIER / "fa-models"
    if sys.platform.startswith("linux"):
        import os
        xdg = os.environ.get("XDG_DATA_HOME")
        base = Path(xdg) if xdg else Path.home() / ".local" / "share"
        return base / APP_IDENTIFIER / "fa-models"
    if sys.platform == "win32":
        import os
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        return base / APP_IDENTIFIER / "fa-models"
    raise RuntimeError(f"no fa-models mapping for platform {sys.platform!r}")


def zero_mean_unit_var_norm(x: np.ndarray) -> np.ndarray:
    return (x - x.mean()) / np.sqrt(x.var() + 1e-7)


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
            "targetTokenIdsRole": (
                "target_token_ids is the EXPECTED, TS-normalizer-derived output of the "
                "text->tokens step -- src-tauri/src/fa_onnx.rs's e2e_parity test re-derives its "
                "own sequence from this fixture's _provenance.text via production "
                "text_to_token_ids() and asserts it equals this field before using its OWN "
                "derived sequence (not this field) for the forward pass/Viterbi/merge below. "
                "This field is ALSO passed to torchaudio.functional.forced_align() below as that "
                "DP's required target-sequence argument -- an unavoidable second role, since CTC "
                "forced alignment cannot compute spans without a target sequence input. That reuse "
                "does not make this field 'input data' in the sense of being independently "
                "sourced -- it remains the derived, expected output of tokenization, asserted "
                "against, not assumed."
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


def capture_one_raw_clip(file_key: str, language: str, source_audio_rel: str, tokens: dict, fa_models_dir: Path) -> dict:
    source_audio = REPO_ROOT / source_audio_rel
    if not source_audio.exists():
        raise SystemExit(
            f"source audio not found: {source_audio} -- STOP condition (g): suitable {language} "
            "audio must be sourced and placed here before this case can run"
        )

    model_path = fa_models_dir / language / "model.onnx"
    if not model_path.exists():
        raise SystemExit(
            f"ONNX model not found: {model_path} — run scripts/export-fa-onnx.py --language "
            f"{language} first (see that script's own docstring)"
        )

    audio, sr = sf.read(str(source_audio), dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    assert sr == SAMPLE_RATE, f"expected {SAMPLE_RATE}Hz source audio, got {sr}Hz ({source_audio})"

    normed = zero_mean_unit_var_norm(audio).astype(np.float32)

    sess = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    logits = sess.run(None, {"input_values": normed[None, :]})[0]  # (1, T, C)
    logits = logits.squeeze(0)  # (T, C)

    # log_softmax -- same convention capture_one's D2-sourced emissions already use.
    shifted = logits - logits.max(axis=-1, keepdims=True)
    log_probs_np = shifted - np.log(np.exp(shifted).sum(axis=-1, keepdims=True))

    emission = torch.tensor(log_probs_np, dtype=torch.float32).unsqueeze(0)  # [1, T, C]

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
            "generatedBy": "scripts/capture-fa-e2e-reference.py (RAW_CLIP_CASES, D5 addendum)",
            "note": (
                "Full end-to-end forced-alignment reference for fr/de/pt: real jonatasgrosman "
                "ONNX model, forward pass computed inline via onnxruntime over a whole real "
                "utterance sourced from google/fleurs (CC-BY-4.0) -- no D2 fa-onnx-emission-*.json "
                "fixture exists for these languages (see this script's module doc comment for why) "
                "-- tokenized via the live TS faTextNormalize.ts module "
                "(scripts/generate-fa-e2e-tokens.ts), aligned via REAL torchaudio 2.2.2 "
                "forced_align/merge_tokens (an independent implementation of the same DP "
                "src-tauri/src/fa_viterbi.rs hand-ports) -- NOT sourced from Rust output at any "
                "step. Distinct fixture family from fa-emission-*.json (MMS_FA DP fixtures) and "
                "fa-onnx-emission-*.json (D2 forward-pass-only fixtures); neither is modified by "
                "this script."
            ),
            "sourceCorpus": "google/fleurs (CC-BY-4.0), validation split",
            "targetTokenIdsRole": (
                "target_token_ids is the EXPECTED, TS-normalizer-derived output of the "
                "text->tokens step -- src-tauri/src/fa_onnx.rs's e2e_parity test re-derives its "
                "own sequence from this fixture's _provenance.text via production "
                "text_to_token_ids() and asserts it equals this field before using its OWN "
                "derived sequence (not this field) for the forward pass/Viterbi/merge below. "
                "This field is ALSO passed to torchaudio.functional.forced_align() below as that "
                "DP's required target-sequence argument -- an unavoidable second role, since CTC "
                "forced alignment cannot compute spans without a target sequence input. That reuse "
                "does not make this field 'input data' in the sense of being independently "
                "sourced -- it remains the derived, expected output of tokenization, asserted "
                "against, not assumed."
            ),
            "language": language,
            "text": token_entry["text"],
            "normalizedText": token_entry["normalizedText"],
            "sourceAudio": source_audio_rel,
            "sampleRate": SAMPLE_RATE,
            "onnxruntimeVersion": ort.__version__,
            "torchVersion": torch.__version__,
            "torchaudioVersion": torchaudio.__version__,
        },
        "input_samples": audio.tolist(),
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

    fa_models_dir = default_fa_models_dir()
    for file_key, language, source_audio_rel in RAW_CLIP_CASES:
        print(f"=== {file_key} ({language}) ===", file=sys.stderr)
        result = capture_one_raw_clip(file_key, language, source_audio_rel, tokens, fa_models_dir)
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
