"""CPU-only volume seeders. No GPU — can run before a payment method exists."""

from __future__ import annotations

import os
import time
from typing import Any

import modal

whisper_vol = modal.Volume.from_name("kinetix-whisper-weights", create_if_missing=True)
fa_vol = modal.Volume.from_name("kinetix-fa-weights", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("huggingface_hub==0.30.2")
)

app = modal.App("kinetix-cloud-asr-seed", image=image)

# Official faster-whisper alias `large-v3-turbo` now points at
# mobiuslabsgmbh/faster-whisper-large-v3-turbo, which redirects here.
# Systran/faster-whisper-large-v3-turbo returns 401 without a token (2026-09-16).
HF_WHISPER = "dropbox-dash/faster-whisper-large-v3-turbo"
MODEL_DIR = "/models/faster-whisper-large-v3-turbo"
FA_REPO = "mohtashim9/kinetix-fa-models"
FA_REVISION = "f618960d71728eba5f12528d5571838a10d262bf"
FA_LANGS = ("en", "es", "fr", "de", "pt")
REQUIRED_LICENSE = "apache-2.0"


def assert_fa_license() -> str:
    from huggingface_hub import HfApi

    info = HfApi().model_info(FA_REPO)
    card = info.card_data
    tag = None
    if isinstance(card, dict):
        tag = card.get("license")
    else:
        tag = getattr(card, "license", None)
    normalized = (tag or "").strip().lower().replace("_", "-")
    if normalized != REQUIRED_LICENSE:
        raise RuntimeError(
            f"LICENSE GATE: {FA_REPO} card license is {tag!r}, need {REQUIRED_LICENSE}."
        )
    return tag or REQUIRED_LICENSE


@app.function(volumes={"/models": whisper_vol}, timeout=60 * 40, cpu=2, memory=4096)
def seed_whisper_weights() -> dict[str, Any]:
    from huggingface_hub import snapshot_download

    t0 = time.perf_counter()
    os.makedirs("/models", exist_ok=True)
    path = snapshot_download(HF_WHISPER, local_dir=MODEL_DIR)
    whisper_vol.commit()
    entries = sorted(os.listdir(MODEL_DIR)) if os.path.isdir(MODEL_DIR) else []
    return {
        "path": path,
        "elapsedSec": round(time.perf_counter() - t0, 3),
        "entries": entries,
        "bytes": sum(
            os.path.getsize(os.path.join(MODEL_DIR, name))
            for name in entries
            if os.path.isfile(os.path.join(MODEL_DIR, name))
        ),
    }


@app.function(volumes={"/models": fa_vol}, timeout=60 * 90, cpu=2, memory=4096)
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
    return {
        "license": license_tag,
        "bytes": saved,
        "elapsedSec": round(time.perf_counter() - t0, 3),
        "revision": FA_REVISION,
    }
