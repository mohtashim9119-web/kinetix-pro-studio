#!/usr/bin/env python3
"""
capture-fa-onnx-reference.py — Python reference emission matrices for the
real shipping FA ONNX models (WS1 Task 5, Slice D2).

WHY THIS EXISTS
The three existing `scripts/fixtures/fa-emission-*.json` fixtures (consumed
by `src-tauri/src/fa_viterbi.rs`'s tests) were captured from torchaudio's
MMS_FA bundle — a DP-correctness reference only (see those fixtures' own
`_caveat`), NOT the shipping jonatasgrosman per-language ONNX models this
slice wires up via `ort`. MMS_FA and jonatasgrosman models have different
vocabularies and different output class counts (MMS_FA C=29 vs jonatasgrosman
en C=33 / es C=41), so a real ONNX forward pass can never reproduce an
MMS_FA fixture's `emission_log_probs` — that would be comparing two
different models' output, not a parity check.

This script instead reuses those three fixtures' own `_provenance`
(`source_audio`, `audio_window_sec`, `pad_sec`, `language`) — the same real
audio windows — and runs them through the REAL exported ONNX model
(`scripts/export-fa-onnx.py`'s output, resolved from the same
app_local_data_dir()/fa-models/<lang>/model.onnx convention `fa.rs` uses) via
Python's onnxruntime, producing new reference emission matrices for the
correct model. `src-tauri/src/fa_onnx.rs`'s feature-gated Rust test loads
these and asserts the real `ort`-Rust-binding forward pass reproduces them
(0 argmax mismatches — the hard gate; max abs diff reported as an
observation only, mirroring `scripts/export-fa-onnx.py`'s own
torch-vs-onnxruntime fidelity check).

PREPROCESSING
Matches transformers' Wav2Vec2FeatureExtractor(do_normalize=True) exactly:
zero-mean/unit-variance per utterance, `(x - x.mean()) / sqrt(x.var() +
1e-7)` (population variance, no attention mask — single-utterance batch).
Verified against
.venv-phase4-fa/lib/python3.11/site-packages/transformers/models/wav2vec2/
feature_extraction_wav2vec2.py's own `zero_mean_unit_var_norm`. The Rust
side (`fa_onnx.rs`) re-implements this identical formula rather than
depending on a fixture-supplied precomputed tensor, so the test also
exercises Rust's own audio-loading/windowing/normalization code, not just
`ort`'s ability to run a session.

WINDOWING
window_start_sample = round((audio_window_sec[0] - pad_sec) * sample_rate)
window_end_sample   = round((audio_window_sec[1] + pad_sec) * sample_rate)
both clamped to [0, len(audio)] — identical formula used on the Rust side.

DEPENDENCIES: onnxruntime, soundfile, numpy — all already in
.venv-phase4-fa (no torch/transformers network dependency needed; the
zero-mean/unit-var formula is applied directly rather than routed through a
downloaded Wav2Vec2Processor).

USAGE
  .venv-phase4-fa/bin/python3 scripts/capture-fa-onnx-reference.py
"""

import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf

REPO_ROOT = Path(__file__).resolve().parent.parent
APP_IDENTIFIER = "com.kinetix.pro-studio"

SOURCE_FIXTURES = [
    ("fa-emission-en-deep-night.json", "fa-onnx-emission-en-deep-night.json"),
    ("fa-emission-en-mother-look.json", "fa-onnx-emission-en-mother-look.json"),
    ("fa-emission-es-resultan-inutiles.json", "fa-onnx-emission-es-resultan-inutiles.json"),
]

SAMPLE_RATE = 16000


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


def sha256_of(path: Path) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def zero_mean_unit_var_norm(x: np.ndarray) -> np.ndarray:
    return (x - x.mean()) / np.sqrt(x.var() + 1e-7)


def load_window(source_audio: Path, window_sec, pad_sec: float):
    audio, sr = sf.read(str(source_audio), dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    assert sr == SAMPLE_RATE, f"expected {SAMPLE_RATE}Hz source audio, got {sr}Hz ({source_audio})"

    start_sample = round((window_sec[0] - pad_sec) * sr)
    end_sample = round((window_sec[1] + pad_sec) * sr)
    start_sample = max(0, min(start_sample, len(audio)))
    end_sample = max(0, min(end_sample, len(audio)))
    assert end_sample > start_sample, f"empty window for {source_audio}"

    return audio[start_sample:end_sample], start_sample, end_sample


def capture_one(src_name: str, out_name: str, fa_models_dir: Path) -> dict:
    src_path = REPO_ROOT / "scripts" / "fixtures" / src_name
    src = json.loads(src_path.read_text())
    prov = src["_provenance"]

    language = prov["language"]
    source_audio = REPO_ROOT / prov["source_audio"]
    if not source_audio.exists():
        raise SystemExit(
            f"source audio not found: {source_audio} — this fixture's audio lives in the "
            "gitignored .work-phase4/replay/ scratch dir; re-run from a machine that still has it"
        )

    model_path = fa_models_dir / language / "model.onnx"
    if not model_path.exists():
        raise SystemExit(
            f"ONNX model not found: {model_path} — run scripts/export-fa-onnx.py --language "
            f"{language} first (see that script's own docstring)"
        )

    window, start_sample, end_sample = load_window(
        source_audio, prov["audio_window_sec"], prov["pad_sec"]
    )
    normed = zero_mean_unit_var_norm(window).astype(np.float32)

    sess = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    logits = sess.run(None, {"input_values": normed[None, :]})[0]  # (1, T, C)
    logits = logits.squeeze(0)  # (T, C)

    # log_softmax, matching torchaudio.functional.forced_align's own expected
    # input convention (measure-forced-alignment-hf.py:181) — NOT raw logits.
    shifted = logits - logits.max(axis=-1, keepdims=True)
    log_probs = shifted - np.log(np.exp(shifted).sum(axis=-1, keepdims=True))

    out = {
        "_provenance": {
            "generatedBy": "scripts/capture-fa-onnx-reference.py",
            "sourceFixture": src_name,
            "note": (
                "Python (onnxruntime) reference emission matrix for the REAL shipping "
                "jonatasgrosman ONNX model, over the identical audio window the "
                "MMS_FA-based DP fixture of the same base name uses. NOT comparable to that "
                "fixture's own emission_log_probs (different model/vocab) — this is a "
                "standalone ort-vs-onnxruntime parity reference."
            ),
            "language": language,
            "sourceAudio": prov["source_audio"],
            "audioWindowSec": prov["audio_window_sec"],
            "padSec": prov["pad_sec"],
            "windowStartSample": start_sample,
            "windowEndSample": end_sample,
            "sampleRate": SAMPLE_RATE,
            "modelPath": str(model_path),
            "modelSha256": sha256_of(model_path),
            "onnxruntimeVersion": ort.__version__,
        },
        "input_samples": window.tolist(),
        "shape": {"T": int(log_probs.shape[0]), "C": int(log_probs.shape[1])},
        "emission_log_probs": log_probs.tolist(),
    }
    return out


def main() -> int:
    fa_models_dir = default_fa_models_dir()
    for src_name, out_name in SOURCE_FIXTURES:
        print(f"=== {src_name} -> {out_name} ===", file=sys.stderr)
        result = capture_one(src_name, out_name, fa_models_dir)
        out_path = REPO_ROOT / "scripts" / "fixtures" / out_name
        out_path.write_text(json.dumps(result) + "\n")
        print(f"-> {out_path} (T={result['shape']['T']}, C={result['shape']['C']})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
