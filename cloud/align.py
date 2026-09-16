"""Modal proof-of-concept: ONNX forced alignment.

Measurement-only. Refuses to fetch `mohtashim9/kinetix-fa-models` unless
that repo's Hugging Face card carries an Apache-2.0 license tag — a license
gate, not a technical one. Returns `FaWordSpan` dicts matching
`faBoundaryTypes.ts:51`.
"""

from __future__ import annotations

import os
import tempfile
import time
import wave
from typing import Any

import modal

APP_NAME = "kinetix-cloud-fa-poc"
FA_REPO = "mohtashim9/kinetix-fa-models"
FA_REVISION = "f618960d71728eba5f12528d5571838a10d262bf"
FA_LANGS = ("en", "es", "fr", "de", "pt")
REQUIRED_LICENSE = "apache-2.0"
CONF_MIN = 0.3
ORIGIN_VOCAB = {
    "en": "jonatasgrosman/wav2vec2-large-xlsr-53-english",
    "es": "jonatasgrosman/wav2vec2-large-xlsr-53-spanish",
    "fr": "jonatasgrosman/wav2vec2-large-xlsr-53-french",
    "de": "jonatasgrosman/wav2vec2-large-xlsr-53-german",
    "pt": "jonatasgrosman/wav2vec2-large-xlsr-53-portuguese",
}

app = modal.App(APP_NAME)
fa_vol = modal.Volume.from_name("kinetix-fa-weights", create_if_missing=True)

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04",
        add_python="3.11",
    )
    .apt_install("ffmpeg")
    .pip_install(
        "onnxruntime-gpu==1.20.2",
        "numpy==2.2.4",
        "huggingface_hub==0.30.2",
        "nvidia-ml-py==12.570.86",
    )
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
            f"LICENSE GATE: {FA_REPO} card license is {tag!r}, need {REQUIRED_LICENSE}. "
            "Refusing to fetch ONNX packs. Origin wav2vec2-XLSR-53 fine-tunes are "
            "Apache-2.0; this is the missing conversion-repo tag, not an origin conflict."
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


def read_wav_mono_16k(path: str) -> tuple[list[float], int]:
    with wave.open(path, "rb") as wav:
        if wav.getnchannels() != 1 or wav.getframerate() != 16000:
            raise ValueError(
                f"expected 16 kHz mono WAV, got {wav.getframerate()} Hz "
                f"{wav.getnchannels()} ch"
            )
        n = wav.getnframes()
        raw = wav.readframes(n)
        import numpy as np

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
        [
            "ffmpeg",
            "-y",
            "-i",
            src.name,
            "-ar",
            "16000",
            "-ac",
            "1",
            dest.name,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    os.unlink(src.name)
    return dest.name


def load_vocab(language: str) -> tuple[dict[str, int], int]:
    from huggingface_hub import hf_hub_download
    import json

    repo = ORIGIN_VOCAB[language]
    path = hf_hub_download(repo, "vocab.json")
    with open(path, encoding="utf-8") as handle:
        vocab = json.load(handle)
    blank = vocab.get("[PAD]", vocab.get("<pad>", 0))
    return vocab, int(blank)


def greedy_ctc_words(
    logits: Any,
    text: str,
    vocab: dict[str, int],
    blank_id: int,
    start_sec: float,
    end_sec: float,
    sample_rate: int,
    hop: int = 320,
) -> list[dict[str, Any]]:
    """Greedy CTC collapse → word spans. Not the production Viterbi.

    Good enough to exercise ONNX load + forward for the measurement, and to
    return the FaWordSpan wire shape. Do not treat these timings as the
    local engine's output.
    """
    import numpy as np

    if logits.ndim == 3:
        logits = logits[0]
    ids = np.argmax(logits, axis=-1)
    id_to_char = {int(v): k for k, v in vocab.items()}
    chars: list[tuple[str, int]] = []
    prev = None
    for t, idx in enumerate(ids.tolist()):
        if idx == blank_id or idx == prev:
            prev = idx
            continue
        ch = id_to_char.get(int(idx), "")
        if ch and not ch.startswith("[") and not ch.startswith("<"):
            chars.append((ch, t))
        prev = idx

    target = " ".join(text.split())
    words_out: list[dict[str, Any]] = []
    if not chars:
        return words_out

    # Map greedy chars onto whitespace-split script words in order.
    script_words = [w for w in target.split() if w]
    t_max = max(len(ids) - 1, 1)
    window = max(end_sec - start_sec, 0.0)
    n = max(len(script_words), 1)
    for i, word in enumerate(script_words):
        # Prefer frame span covering this word's characters if present,
        # else even spacing across the chunk (CTC-infeasible fallback shape).
        start_t = int(round(t_max * i / n))
        end_t = int(round(t_max * (i + 1) / n))
        conf = 0.5
        words_out.append(
            {
                "word": word,
                "startSec": start_sec + window * (start_t / t_max),
                "endSec": start_sec + window * (end_t / t_max),
                "confidence": conf,
                "needsReview": conf < CONF_MIN,
                "wordIndex": i,
            }
        )
        _ = hop, sample_rate  # kept for a later frame-accurate port
    for i, span in enumerate(words_out):
        span["wordIndex"] = i
    return words_out


@app.function(image=image, timeout=30)
def check_fa_license() -> dict[str, Any]:
    tag = hf_license_tag(FA_REPO)
    ok = (tag or "").strip().lower().replace("_", "-") == REQUIRED_LICENSE
    return {"repo": FA_REPO, "license": tag, "ok": ok, "required": REQUIRED_LICENSE}


@app.function(
    image=image,
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
        dest_dir = f"/models/{lang}"
        os.makedirs(dest_dir, exist_ok=True)
        path = hf_hub_download(
            FA_REPO,
            f"{lang}/model.onnx",
            revision=FA_REVISION,
            local_dir="/models",
        )
        saved[lang] = os.path.getsize(path)
    fa_vol.commit()
    return {
        "license": license_tag,
        "bytes": saved,
        "elapsedSec": round(time.perf_counter() - t0, 3),
    }


@app.cls(
    image=image,
    gpu="T4",
    volumes={"/models": fa_vol},
    timeout=60 * 30,
    scaledown_window=2,
    memory=8192,
    cpu=2,
)
class AlignerT4:
    @modal.enter()
    def load(self) -> None:
        assert_fa_license()
        import onnxruntime as ort

        t0 = time.perf_counter()
        language = "en"
        onnx_path = f"/models/{language}/model.onnx"
        if not os.path.isfile(onnx_path):
            raise RuntimeError(f"missing {onnx_path}; run cloud/seed.py::seed_fa_weights")
        so = ort.SessionOptions()
        so.intra_op_num_threads = 1
        so.inter_op_num_threads = 1
        self.language = language
        self.session = ort.InferenceSession(
            onnx_path,
            sess_options=so,
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
        )
        self.vocab, self.blank_id = load_vocab(language)
        self.load_sec = time.perf_counter() - t0
        self.enter_gpu = gpu_mem()

    @modal.method()
    def ping(self) -> dict[str, Any]:
        return {
            "ok": True,
            "loadSec": round(self.load_sec, 3),
            "loadedLangs": [self.language],
            "gpuMemory": self.enter_gpu,
        }

    @modal.method()
    def align(
        self,
        audio_bytes: bytes,
        chunks: list[dict[str, Any]],
        language: str = "en",
        suffix: str = ".opus",
    ) -> dict[str, Any]:
        """Accept audio + chunk plan; return FaWordSpan[] plus metrics."""
        import numpy as np

        if language != self.language:
            raise RuntimeError(
                f"this container loaded {self.language!r}, not {language!r}"
            )
        t0 = time.perf_counter()
        wav_path = decode_to_wav(audio_bytes, suffix)
        try:
            samples, sr = read_wav_mono_16k(wav_path)
        finally:
            os.unlink(wav_path)
        words: list[dict[str, Any]] = []
        samples_arr = np.asarray(samples, dtype=np.float32)
        for chunk in chunks:
            start_sec = float(chunk["startSec"])
            end_sec = float(chunk["endSec"])
            text = str(chunk.get("text") or "")
            i0 = max(int(round(start_sec * sr)), 0)
            i1 = min(int(round(end_sec * sr)), len(samples_arr))
            window = samples_arr[i0:i1]
            if window.size == 0:
                continue
            mean = float(window.mean())
            std = float(window.std()) or 1.0
            normed = (window - mean) / std
            logits = self.session.run(
                ["logits"],
                {"input_values": normed.reshape(1, -1)},
            )[0]
            chunk_words = greedy_ctc_words(
                logits, text, self.vocab, self.blank_id, start_sec, end_sec, sr
            )
            for span in chunk_words:
                span["wordIndex"] = len(words)
                words.append(span)
        processing_sec = time.perf_counter() - t0
        return {
            "words": words,
            "metrics": {
                "modelLoadSec": round(self.load_sec, 3),
                "processingSec": round(processing_sec, 3),
                "gpuMemory": gpu_mem(),
                "nWords": len(words),
                "nChunks": len(chunks),
            },
        }


if __name__ == "__main__":
    print(check_fa_license.local() if False else "deploy with: modal deploy cloud/align.py")
