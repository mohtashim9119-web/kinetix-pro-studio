"""Modal proof-of-concept: ONNX forced alignment with the production Viterbi.

Measurement-only. Returns FaWordSpan dicts matching faBoundaryTypes.ts:51.
Refuses to fetch packs unless mohtashim9/kinetix-fa-models is Apache-2.0.
"""

from __future__ import annotations

import os
import tempfile
import time
import wave
from pathlib import Path
from typing import Any

import modal

APP_NAME = "kinetix-cloud-fa-poc"
FA_REPO = "mohtashim9/kinetix-fa-models"
FA_REVISION = "f618960d71728eba5f12528d5571838a10d262bf"
FA_LANGS = ("en", "es", "fr", "de", "pt")
REQUIRED_LICENSE = "apache-2.0"

CLOUD = Path(__file__).resolve().parent
FIXTURE_DIR = CLOUD.parent / "scripts" / "fixtures"

app = modal.App(APP_NAME)
fa_vol = modal.Volume.from_name("kinetix-fa-weights", create_if_missing=True)

cuda_image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04",
        add_python="3.11",
    )
    .apt_install("ffmpeg")
    .pip_install(
        "onnxruntime-gpu==1.23.2",
        "numpy==2.2.4",
        "huggingface_hub==0.30.2",
        "nvidia-ml-py==12.570.86",
    )
    .add_local_file(str(CLOUD / "fa_engine.py"), "/root/fa_engine.py")
)
for _lang in FA_LANGS:
    cuda_image = cuda_image.add_local_file(
        str(FIXTURE_DIR / f"fa-vocab-{_lang}.json"),
        f"/vocabs/fa-vocab-{_lang}.json",
    ).add_local_file(
        str(FIXTURE_DIR / f"fa-cardinal-{_lang}.json"),
        f"/vocabs/fa-cardinal-{_lang}.json",
    )

cpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "onnxruntime==1.23.2",
        "numpy==2.2.4",
        "huggingface_hub==0.30.2",
    )
    .add_local_file(str(CLOUD / "fa_engine.py"), "/root/fa_engine.py")
)
for _lang in FA_LANGS:
    cpu_image = cpu_image.add_local_file(
        str(FIXTURE_DIR / f"fa-vocab-{_lang}.json"),
        f"/vocabs/fa-vocab-{_lang}.json",
    ).add_local_file(
        str(FIXTURE_DIR / f"fa-cardinal-{_lang}.json"),
        f"/vocabs/fa-cardinal-{_lang}.json",
    )


def hf_license_tag(repo_id: str) -> str | None:
    from huggingface_hub import HfApi

    info = HfApi().model_info(repo_id)
    card = info.card_data
    if card is None:
        return None
    if isinstance(card, dict):
        return card.get("license")
    return getattr(card, "license", None)


def assert_fa_license() -> str:
    tag = hf_license_tag(FA_REPO)
    normalized = (tag or "").strip().lower().replace("_", "-")
    if normalized != REQUIRED_LICENSE:
        raise RuntimeError(
            f"LICENSE GATE: {FA_REPO} card license is {tag!r}, need {REQUIRED_LICENSE}."
        )
    return tag or REQUIRED_LICENSE


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
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


def read_wav_mono_16k(path: str):
    import numpy as np

    with wave.open(path, "rb") as wav:
        if wav.getnchannels() != 1 or wav.getframerate() != 16000:
            raise ValueError(
                f"expected 16 kHz mono WAV, got {wav.getframerate()} Hz "
                f"{wav.getnchannels()} ch"
            )
        raw = wav.readframes(wav.getnframes())
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        return samples, wav.getframerate()


def decode_to_wav(audio_bytes: bytes, suffix: str) -> str:
    import subprocess

    src = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    src.write(audio_bytes)
    src.close()
    dest = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    dest.close()
    subprocess.check_call(
        ["ffmpeg", "-y", "-i", src.name, "-ar", "16000", "-ac", "1", dest.name],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    os.unlink(src.name)
    return dest.name


def session_options(intra: int):
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
    return so


def make_session(onnx_path: str, providers: list[str], intra: int):
    import onnxruntime as ort

    return ort.InferenceSession(
        onnx_path,
        sess_options=session_options(intra),
        providers=providers,
    )


def run_forward(session, normed):
    import numpy as np

    logits = session.run(["logits"], {"input_values": normed.reshape(1, -1)})[0]
    return np.asarray(logits, dtype=np.float32)


class _AlignerBase:
    providers: list[str]
    intra: int

    def _load_one(self, language: str):
        import fa_engine

        onnx_path = f"/models/{language}/model.onnx"
        if not os.path.isfile(onnx_path):
            raise RuntimeError(f"missing {onnx_path}; run cloud/seed.py::seed_fa_weights")
        session = make_session(onnx_path, self.providers, self.intra)
        vocab = fa_engine.load_vocab(language, vocab_dir=Path("/vocabs"))
        return session, vocab

    def load_language(self, language: str) -> None:
        if language not in FA_LANGS:
            raise RuntimeError(f"unsupported FA language {language!r}")
        if language in self.sessions:
            return
        t0 = time.perf_counter()
        session, vocab = self._load_one(language)
        self.sessions[language] = session
        self.vocabs[language] = vocab
        self.load_sec_by_lang[language] = time.perf_counter() - t0

    def ping(self) -> dict[str, Any]:
        return {
            "ok": True,
            "loadSec": round(self.load_sec, 3),
            "loadedLangs": sorted(self.sessions),
            "loadSecByLang": {k: round(v, 3) for k, v in self.load_sec_by_lang.items()},
            "gpuMemory": gpu_mem() if self.providers[0].startswith("CUDA") else None,
            "providers": self.providers,
        }

    def align(
        self,
        audio_bytes: bytes,
        chunks: list[dict[str, Any]],
        language: str = "en",
        suffix: str = ".opus",
    ) -> dict[str, Any]:
        import fa_engine
        import numpy as np

        self.load_language(language)
        t0 = time.perf_counter()
        wav_path = decode_to_wav(audio_bytes, suffix)
        try:
            samples, _sr = read_wav_mono_16k(wav_path)
        finally:
            os.unlink(wav_path)
        session = self.sessions[language]
        vocab = self.vocabs[language]

        def _fwd(normed: np.ndarray):
            return run_forward(session, normed)

        words, extra = fa_engine.align_chunked(samples, chunks, language, vocab, _fwd)
        processing_sec = time.perf_counter() - t0
        return {
            "words": words,
            "metrics": {
                "modelLoadSec": round(self.load_sec_by_lang[language], 3),
                "processingSec": round(processing_sec, 3),
                "gpuMemory": gpu_mem() if self.providers[0].startswith("CUDA") else None,
                "nWords": extra["nWords"],
                "nChunks": extra["nChunks"],
                "nFallbackChunks": extra["nFallbackChunks"],
                "providers": self.providers,
            },
        }


@app.function(image=cuda_image, timeout=30)
def check_fa_license() -> dict[str, Any]:
    tag = hf_license_tag(FA_REPO)
    ok = (tag or "").strip().lower().replace("_", "-") == REQUIRED_LICENSE
    return {"repo": FA_REPO, "license": tag, "ok": ok, "required": REQUIRED_LICENSE}


@app.function(
    image=cuda_image,
    volumes={"/models": fa_vol},
    timeout=60 * 60,
    cpu=2,
    memory=4096,
)
def seed_fa_weights() -> dict[str, Any]:
    from huggingface_hub import hf_hub_download

    license_tag = assert_fa_license()
    t0 = time.perf_counter()
    saved: dict[str, int] = {}
    for lang in FA_LANGS:
        os.makedirs(f"/models/{lang}", exist_ok=True)
        path = hf_hub_download(
            FA_REPO,
            f"{lang}/model.onnx",
            revision=FA_REVISION,
            local_dir="/models",
        )
        saved[lang] = os.path.getsize(path)
    fa_vol.commit()
    return {"license": license_tag, "bytes": saved, "elapsedSec": round(time.perf_counter() - t0, 3)}


@app.cls(
    image=cuda_image,
    gpu="T4",
    volumes={"/models": fa_vol},
    timeout=60 * 60,
    scaledown_window=2,
    memory=8192,
    cpu=2,
)
class AlignerT4(_AlignerBase):
    providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    intra = 1

    @modal.enter()
    def load(self) -> None:
        assert_fa_license()
        self.sessions = {}
        self.vocabs = {}
        self.load_sec_by_lang = {}
        t0 = time.perf_counter()
        self.load_language("en")
        self.load_sec = time.perf_counter() - t0
        self.enter_gpu = gpu_mem()

    @modal.method()
    def ping(self) -> dict[str, Any]:
        out = super().ping()
        out["gpuMemory"] = self.enter_gpu
        return out

    @modal.method()
    def align(
        self,
        audio_bytes: bytes,
        chunks: list[dict[str, Any]],
        language: str = "en",
        suffix: str = ".opus",
    ) -> dict[str, Any]:
        return super().align(audio_bytes, chunks, language, suffix)


@app.cls(
    image=cpu_image,
    volumes={"/models": fa_vol},
    timeout=60 * 90,
    scaledown_window=2,
    memory=8192,
    cpu=4,
)
class AlignerCPU(_AlignerBase):
    providers = ["CPUExecutionProvider"]
    intra = 4

    @modal.enter()
    def load(self) -> None:
        assert_fa_license()
        self.sessions = {}
        self.vocabs = {}
        self.load_sec_by_lang = {}
        t0 = time.perf_counter()
        self.load_language("en")
        self.load_sec = time.perf_counter() - t0

    @modal.method()
    def ping(self) -> dict[str, Any]:
        return super().ping()

    @modal.method()
    def align(
        self,
        audio_bytes: bytes,
        chunks: list[dict[str, Any]],
        language: str = "en",
        suffix: str = ".opus",
    ) -> dict[str, Any]:
        return super().align(audio_bytes, chunks, language, suffix)


if __name__ == "__main__":
    print("deploy with: modal deploy cloud/align.py")
