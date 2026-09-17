#!/usr/bin/env python3
"""Local ONNX forced alignment using the production Viterbi port.

Used for Spanish and the five-pack smoke (no dedicated Rust dump test for
those). V6 local parity uses the existing Rust path via run_local_fa.sh.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import wave
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parent
import sys

sys.path.insert(0, str(ROOT))
import fa_engine  # noqa: E402

DEFAULT_MODELS = Path("/Users/mohtashim/Drive/All Data/TEST/models/fa-models")


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as wav:
        if wav.getnchannels() != 1 or wav.getframerate() != 16000:
            raise ValueError(f"expected 16 kHz mono WAV, got {path}")
        raw = wav.readframes(wav.getnframes())
        return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def make_session(onnx_path: Path, intra: int):
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.intra_op_num_threads = intra
    so.inter_op_num_threads = 1
    so.enable_mem_pattern = False
    so.enable_cpu_mem_arena = False
    try:
        so.add_session_config_entry("session.use_deterministic_compute", "1")
    except Exception:  # noqa: BLE001
        pass
    return ort.InferenceSession(
        str(onnx_path),
        sess_options=so,
        providers=["CPUExecutionProvider"],
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--chunks", required=True)
    parser.add_argument("--language", default="en")
    parser.add_argument("--out", required=True)
    parser.add_argument("--models", default=str(DEFAULT_MODELS))
    parser.add_argument("--intra", type=int, default=os.cpu_count() or 4)
    args = parser.parse_args()

    chunks_raw = json.loads(Path(args.chunks).read_text(encoding="utf-8"))
    chunks = chunks_raw["chunks"] if isinstance(chunks_raw, dict) else chunks_raw
    samples = read_wav(Path(args.audio))
    onnx_path = Path(args.models) / args.language / "model.onnx"
    t_load = time.perf_counter()
    session = make_session(onnx_path, args.intra)
    load_sec = time.perf_counter() - t_load
    vocab = fa_engine.load_vocab(args.language)

    def run_forward(normed: np.ndarray) -> np.ndarray:
        return np.asarray(session.run(["logits"], {"input_values": normed.reshape(1, -1)})[0], dtype=np.float32)

    t0 = time.perf_counter()
    words, extra = fa_engine.align_chunked(samples, chunks, args.language, vocab, run_forward)
    processing_sec = time.perf_counter() - t0
    payload: dict[str, Any] = {
        "words": words,
        "metrics": {
            "modelLoadSec": round(load_sec, 3),
            "processingSec": round(processing_sec, 3),
            **extra,
            "intra": args.intra,
            "engine": "python-fa_engine + onnxruntime CPU",
        },
    }
    Path(args.out).write_text(json.dumps(payload), encoding="utf-8")
    print(json.dumps(payload["metrics"], indent=2))


if __name__ == "__main__":
    main()
