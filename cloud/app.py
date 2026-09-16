"""Modal proof-of-concept: faster-whisper large-v3-turbo transcription.

Measurement-only. Does not ship to users. Weights live in a Modal Volume,
not in the image. Returns tokens shaped like `types.ts` TranscriptToken:
`{ startSec, endSec, text }`.
"""

from __future__ import annotations

import os
import tempfile
import time
from typing import Any

import modal

APP_NAME = "kinetix-cloud-asr-poc"
MODEL_DIR = "/models/faster-whisper-large-v3-turbo"
# See cloud/seed.py — Systran/faster-whisper-large-v3-turbo is 401 without a token.
HF_MODEL = "dropbox-dash/faster-whisper-large-v3-turbo"

app = modal.App(APP_NAME)

whisper_vol = modal.Volume.from_name("kinetix-whisper-weights", create_if_missing=True)

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04",
        add_python="3.11",
    )
    .apt_install("ffmpeg")
    .pip_install(
        "faster-whisper==1.1.1",
        "huggingface_hub==0.30.2",
        "nvidia-ml-py==12.570.86",
    )
)


def gpu_mem() -> dict[str, Any]:
    try:
        import pynvml

        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        info = pynvml.nvmlDeviceGetMemoryInfo(handle)
        name = pynvml.nvmlDeviceGetName(handle)
        if isinstance(name, bytes):
            name = name.decode("utf-8", errors="replace")
        return {
            "name": name,
            "usedMb": round(info.used / (1024 * 1024), 1),
            "totalMb": round(info.total / (1024 * 1024), 1),
        }
    except Exception as exc:  # noqa: BLE001 — measurement helper, never raise
        return {"error": str(exc)}


def host_info() -> dict[str, Any]:
    return {
        "modalRegion": os.environ.get("MODAL_REGION"),
        "modalCloud": os.environ.get("MODAL_CLOUD_PROVIDER"),
        "cudaVisible": os.environ.get("CUDA_VISIBLE_DEVICES"),
    }


def transcribe_file(
    model: Any, path: str, language: str, offset_sec: float
) -> tuple[list[dict[str, Any]], str | None]:
    lang = None if language in ("", "auto", "None") else language
    segments, info = model.transcribe(
        path,
        language=lang,
        word_timestamps=True,
        vad_filter=False,
        beam_size=5,
        condition_on_previous_text=True,
    )
    tokens: list[dict[str, Any]] = []
    for segment in segments:
        for word in segment.words or []:
            text = (word.word or "").strip()
            if not text:
                continue
            tokens.append(
                {
                    "startSec": float(word.start) + offset_sec,
                    "endSec": float(word.end) + offset_sec,
                    "text": text,
                }
            )
    return tokens, getattr(info, "language", None)


def load_model() -> tuple[Any, float]:
    from faster_whisper import WhisperModel

    t0 = time.perf_counter()
    source = MODEL_DIR if os.path.isdir(MODEL_DIR) else "large-v3-turbo"
    model = WhisperModel(
        source,
        device="cuda",
        compute_type="float16",
        download_root="/models" if source == "large-v3-turbo" else None,
    )
    return model, time.perf_counter() - t0


def run_transcribe(
    model: Any,
    load_sec: float,
    audio_bytes: bytes,
    language: str,
    offset_sec: float,
    suffix: str,
    gpu_name: str,
    snapshots: bool,
    host: dict[str, Any],
) -> dict[str, Any]:
    t0 = time.perf_counter()
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as handle:
        handle.write(audio_bytes)
        handle.flush()
        tokens, detected = transcribe_file(model, handle.name, language, offset_sec)
    processing_sec = time.perf_counter() - t0
    return {
        "tokens": tokens,
        "detectedLanguage": detected,
        "metrics": {
            "modelLoadSec": round(load_sec, 3),
            "processingSec": round(processing_sec, 3),
            "gpuMemory": gpu_mem(),
            "host": host,
            "gpu": gpu_name,
            "snapshots": snapshots,
            "nTokens": len(tokens),
            "audioBytes": len(audio_bytes),
            "offsetSec": offset_sec,
        },
    }


@app.function(
    image=image,
    volumes={"/models": whisper_vol},
    timeout=60 * 30,
    cpu=2,
    memory=4096,
)
def seed_whisper_weights() -> dict[str, Any]:
    """Download CTranslate2 large-v3-turbo into the volume (CPU, once)."""
    from huggingface_hub import snapshot_download

    t0 = time.perf_counter()
    os.makedirs("/models", exist_ok=True)
    path = snapshot_download(HF_MODEL, local_dir=MODEL_DIR)
    whisper_vol.commit()
    entries = sorted(os.listdir(MODEL_DIR)) if os.path.isdir(MODEL_DIR) else []
    return {
        "path": path,
        "elapsedSec": round(time.perf_counter() - t0, 3),
        "entries": entries,
    }


@app.cls(
    image=image,
    gpu="T4",
    volumes={"/models": whisper_vol},
    timeout=60 * 60,
    scaledown_window=2,
    memory=8192,
    cpu=2,
)
class TranscriberT4:
    @modal.enter()
    def load(self) -> None:
        self.model, self.load_sec = load_model()
        self.enter_gpu = gpu_mem()
        self.host = host_info()

    @modal.method()
    def ping(self) -> dict[str, Any]:
        return {
            "ok": True,
            "loadSec": round(self.load_sec, 3),
            "gpuMemory": self.enter_gpu,
            "host": self.host,
            "gpu": "T4",
            "snapshots": False,
        }

    @modal.method()
    def transcribe(
        self,
        audio_bytes: bytes,
        language: str = "en",
        offset_sec: float = 0.0,
        suffix: str = ".opus",
    ) -> dict[str, Any]:
        return run_transcribe(
            self.model,
            self.load_sec,
            audio_bytes,
            language,
            offset_sec,
            suffix,
            "T4",
            False,
            self.host,
        )


@app.cls(
    image=image,
    gpu="T4",
    volumes={"/models": whisper_vol},
    timeout=60 * 60,
    scaledown_window=2,
    memory=8192,
    cpu=2,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
class TranscriberT4Snapshot:
    @modal.enter(snap=True)
    def load(self) -> None:
        self.model, self.load_sec = load_model()
        self.enter_gpu = gpu_mem()
        self.host = host_info()

    @modal.method()
    def ping(self) -> dict[str, Any]:
        return {
            "ok": True,
            "loadSec": round(self.load_sec, 3),
            "gpuMemory": self.enter_gpu,
            "host": self.host,
            "gpu": "T4",
            "snapshots": True,
        }

    @modal.method()
    def transcribe(
        self,
        audio_bytes: bytes,
        language: str = "en",
        offset_sec: float = 0.0,
        suffix: str = ".opus",
    ) -> dict[str, Any]:
        return run_transcribe(
            self.model,
            self.load_sec,
            audio_bytes,
            language,
            offset_sec,
            suffix,
            "T4",
            True,
            self.host,
        )


@app.cls(
    image=image,
    gpu="L4",
    volumes={"/models": whisper_vol},
    timeout=60 * 60,
    scaledown_window=2,
    memory=8192,
    cpu=2,
)
class TranscriberL4:
    @modal.enter()
    def load(self) -> None:
        self.model, self.load_sec = load_model()
        self.enter_gpu = gpu_mem()
        self.host = host_info()

    @modal.method()
    def ping(self) -> dict[str, Any]:
        return {
            "ok": True,
            "loadSec": round(self.load_sec, 3),
            "gpuMemory": self.enter_gpu,
            "host": self.host,
            "gpu": "L4",
            "snapshots": False,
        }

    @modal.method()
    def transcribe(
        self,
        audio_bytes: bytes,
        language: str = "en",
        offset_sec: float = 0.0,
        suffix: str = ".opus",
    ) -> dict[str, Any]:
        return run_transcribe(
            self.model,
            self.load_sec,
            audio_bytes,
            language,
            offset_sec,
            suffix,
            "L4",
            False,
            self.host,
        )
