"""Kinetix cloud sync — pure service logic (Wave 3 U0).

No Modal, no FastAPI, no network. Everything here is imported by
`cloud/sync_service.py` (the deployed gateway + GPU worker) and exercised
directly by `cloud/test_sync_core.py`. Keeping it import-light is what lets
the auth, cache-key, validation, retention, and metering rules be tested on
a laptop without a Modal account.

Cache keys are content hashes end to end (plan-v3 Wave 3 item 2, the
`services/spine.ts` convention): the transcript stage keys on the audio
hash, the alignment stage on the audio hash plus a hash of the chunk plan
actually sent. Both keys fold in the exact engine revision, so a model or
decode-parameter change can never return a stale cached result.

Wave 3 U3 — the alignment key also folds in the language pack's own
revision: the model repo commit AND a digest of the vocab + cardinal files
baked into the image beside it (`pack_digests`). Those files steer the
decoder, and they change in this repo without the model repo moving.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

SERVICE_SCHEMA = 1

# ---------------------------------------------------------------------------
# Engine identity. Every value here is folded into cache keys and returned
# to the desktop app as provenance (`TimingProvenance`, src/types.ts), so a
# change to any of them is, by construction, a cache miss.
# ---------------------------------------------------------------------------

WHISPER_MODEL = "dropbox-dash/faster-whisper-large-v3-turbo"
# Hugging Face commit of the CTranslate2 conversion (license: mit). Pinned
# here and seeded into a revision-named volume directory — the measurement
# harness seeded unpinned, so its provenance could not name the model.
WHISPER_REVISION = "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"
FASTER_WHISPER_VERSION = "1.1.1"
CTRANSLATE2_VERSION = "4.8.2"
# Decode parameters are part of engine identity: the parity measurements in
# docs/architecture/cloud-asr-measurements.md were taken with exactly these.
WHISPER_DECODE = {
    "beam_size": 5,
    "word_timestamps": True,
    "vad_filter": False,
    "condition_on_previous_text": True,
}

FA_REPO = "mohtashim9/kinetix-fa-models"
FA_REVISION = "f618960d71728eba5f12528d5571838a10d262bf"
ORT_VERSION = "1.23.2"
# Bumped whenever cloud/fa_engine.py's algorithm changes.
FA_ENGINE_PORT_VERSION = 1
FA_LANGS = ("en", "es", "fr", "de", "pt")

TRANSCRIBE_ENGINE_REV = (
    f"{WHISPER_MODEL}@{WHISPER_REVISION}"
    f"+faster-whisper-{FASTER_WHISPER_VERSION}+ct2-{CTRANSLATE2_VERSION}"
    f"+{json.dumps(WHISPER_DECODE, sort_keys=True, separators=(',', ':'))}"
)
ALIGN_ENGINE_REV = f"{FA_REPO}@{FA_REVISION}+ort-{ORT_VERSION}+port-{FA_ENGINE_PORT_VERSION}"


def transcribe_provenance(detected_language: str | None) -> dict[str, Any]:
    return {
        "engine": "whisper-cloud",
        "model": WHISPER_MODEL,
        "modelVersion": f"{WHISPER_REVISION}+faster-whisper-{FASTER_WHISPER_VERSION}+ct2-{CTRANSLATE2_VERSION}",
        "language": detected_language,
    }


def align_provenance(language: str) -> dict[str, Any]:
    return {
        "engine": "fa-cloud",
        "model": f"{FA_REPO}/{language}",
        "modelVersion": f"{FA_REVISION}+ort-{ORT_VERSION}+port-{FA_ENGINE_PORT_VERSION}",
        "language": language,
    }


# ---------------------------------------------------------------------------
# Limits. The one-hour cap is enforced here at upload (plan-v3 Wave 3 item
# 9); the client pre-flight and the worker timeout are the other two layers.
# ---------------------------------------------------------------------------

MAX_AUDIO_SEC = 3600.0
# ffprobe on an Opus container reports a few ms past the encoded length
# (the measured one-hour fixture probes at 3600.0065 s).
AUDIO_DURATION_TOLERANCE_SEC = 1.0
# Measured: one hour of 16 kHz mono libopus CBR 16 kbps is exactly 7,477,405
# bytes. CBR makes size a reliable proxy for duration, so an oversize body
# is refused from Content-Length before a byte of it is buffered.
OPUS_HOUR_BYTES = 7_477_405
MAX_UPLOAD_BYTES = OPUS_HOUR_BYTES + OPUS_HOUR_BYTES // 50
MAX_CHUNKS = 5000
MAX_CHUNK_TEXT_CHARS = 20_000

# ---------------------------------------------------------------------------
# Retention (operator D4): cached audio 7 days after last use, results 30
# days, nothing used for training, logs hold hashes/durations/GPU-seconds
# only — never transcript text.
# ---------------------------------------------------------------------------

AUDIO_RETENTION_SEC = 7 * 86_400
RESULT_RETENTION_SEC = 30 * 86_400

# ---------------------------------------------------------------------------
# Cost. Published Modal rates on the measurement day
# (docs/architecture/cloud-asr-measurements.md): T4 $0.59/h, CPU
# $0.0473/core/h, memory $0.008/GiB/h, for the worker's cpu=2, memory=8 GiB.
# A per-job estimate only; `modal billing report` is the source of truth.
# ---------------------------------------------------------------------------

WORKER_CPU_CORES = 2
WORKER_MEMORY_GIB = 8
USD_PER_WORKER_SEC = (0.59 + 0.0473 * WORKER_CPU_CORES + 0.008 * WORKER_MEMORY_GIB) / 3600.0

HEX64 = re.compile(r"^[0-9a-f]{64}$")
TRANSCRIBE_LANGS = ("auto",) + FA_LANGS
STAGES = ("transcribe", "align")
TERMINAL_STATUSES = ("done", "failed", "cancelled")


class ValidationError(ValueError):
    """A request the gateway refuses with a typed 4xx, never a 500."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


def sha256_hex(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# Auth. The Modal Secret holds {sha256(key): member} — never a raw key — so
# the secret itself cannot be replayed as a credential.
# ---------------------------------------------------------------------------


def parse_key_registry(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("key registry must be a JSON object of {sha256: member}")
    out: dict[str, str] = {}
    for digest, member in parsed.items():
        if not isinstance(digest, str) or not HEX64.match(digest):
            raise ValueError(f"key registry entry {digest!r} is not a sha256 hex digest")
        if not isinstance(member, str) or not member:
            raise ValueError(f"key registry entry {digest!r} has no member name")
        out[digest] = member
    return out


def authenticate(authorization: str | None, registry: dict[str, str]) -> str | None:
    """The member name for a valid `Bearer <key>` header, else None."""
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return registry.get(sha256_hex(token.strip()))


# ---------------------------------------------------------------------------
# Request validation.
# ---------------------------------------------------------------------------


def validate_audio_hash(audio_hash: Any) -> str:
    if not isinstance(audio_hash, str) or not HEX64.match(audio_hash):
        raise ValidationError("bad-audio-hash", "audioHash must be a lowercase sha256 hex digest")
    return audio_hash


def validate_upload_size(content_length: int | None) -> None:
    if content_length is None:
        raise ValidationError("length-required", "Content-Length is required")
    if content_length <= 0:
        raise ValidationError("empty-audio", "audio body is empty")
    if content_length > MAX_UPLOAD_BYTES:
        raise ValidationError(
            "too-long",
            f"audio body is {content_length} bytes; the one-hour cap at 16 kbps Opus is {MAX_UPLOAD_BYTES}",
        )


def validate_probe(codec: str | None, duration_sec: float | None) -> float:
    if codec != "opus":
        raise ValidationError("not-opus", f"expected Opus audio, got codec {codec!r}")
    if duration_sec is None or not math.isfinite(duration_sec) or duration_sec <= 0:
        raise ValidationError("bad-duration", "could not read a positive audio duration")
    if duration_sec > MAX_AUDIO_SEC + AUDIO_DURATION_TOLERANCE_SEC:
        raise ValidationError(
            "too-long", f"audio is {duration_sec:.1f}s; the cap is {MAX_AUDIO_SEC:.0f}s"
        )
    return duration_sec


def validate_language(stage: str, language: Any) -> str:
    allowed = TRANSCRIBE_LANGS if stage == "transcribe" else FA_LANGS
    if language not in allowed:
        raise ValidationError(
            "unsupported-language", f"{stage} language must be one of {', '.join(allowed)}; got {language!r}"
        )
    return language


def canonical_chunks(chunks: Any, audio_duration_sec: float | None) -> list[dict[str, Any]]:
    """Validated, key-ordered chunk plan: the exact bytes that get hashed."""
    if not isinstance(chunks, list) or not chunks:
        raise ValidationError("bad-chunks", "chunks must be a non-empty list")
    if len(chunks) > MAX_CHUNKS:
        raise ValidationError("bad-chunks", f"at most {MAX_CHUNKS} chunks")
    ceiling = (audio_duration_sec or MAX_AUDIO_SEC) + AUDIO_DURATION_TOLERANCE_SEC
    out: list[dict[str, Any]] = []
    for i, chunk in enumerate(chunks):
        if not isinstance(chunk, dict):
            raise ValidationError("bad-chunks", f"chunk {i} is not an object")
        start, end, text = chunk.get("startSec"), chunk.get("endSec"), chunk.get("text")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (start, end)):
            raise ValidationError("bad-chunks", f"chunk {i} startSec/endSec must be numbers")
        start, end = float(start), float(end)
        if not (math.isfinite(start) and math.isfinite(end)) or start < 0 or end <= start or end > ceiling:
            raise ValidationError("bad-chunks", f"chunk {i} window [{start}, {end}] is out of range")
        if not isinstance(text, str) or len(text) > MAX_CHUNK_TEXT_CHARS:
            raise ValidationError("bad-chunks", f"chunk {i} text must be a string under {MAX_CHUNK_TEXT_CHARS} chars")
        out.append({"startSec": start, "endSec": end, "text": text})
    return out


def chunk_plan_hash(chunks: list[dict[str, Any]]) -> str:
    return sha256_hex(json.dumps(chunks, sort_keys=True, separators=(",", ":"), ensure_ascii=False))


# ---------------------------------------------------------------------------
# Cache keys — the two stages (plan-v3 Wave 3 item 2: two cached stages,
# not atomic-or-nothing).
# ---------------------------------------------------------------------------


def pack_digests(vocab_dir: str | Path) -> dict[str, str]:
    """Per-language digest of the decoder-side pack files (vocab + cardinal).

    Refuses to guess: a missing file is an error at import, not a key that
    silently stops covering the pack.
    """
    root = Path(vocab_dir)
    out: dict[str, str] = {}
    for lang in FA_LANGS:
        h = hashlib.sha256()
        for name in (f"fa-vocab-{lang}.json", f"fa-cardinal-{lang}.json"):
            data = (root / name).read_bytes()
            h.update(name.encode("utf-8") + b"\0" + len(data).to_bytes(8, "big") + data)
        out[lang] = h.hexdigest()
    return out


def pack_revision(language: str, digests: dict[str, str]) -> str:
    """The revision of ONE language pack: model repo commit + its file digest."""
    return f"{FA_REPO}/{language}@{FA_REVISION}+files-{digests[language]}"


def transcript_cache_key(audio_hash: str, language: str) -> str:
    return sha256_hex(f"transcribe|{SERVICE_SCHEMA}|{audio_hash}|{language}|{TRANSCRIBE_ENGINE_REV}")


def alignment_cache_key(audio_hash: str, plan_hash: str, language: str, pack_rev: str) -> str:
    return sha256_hex(f"align|{SERVICE_SCHEMA}|{audio_hash}|{plan_hash}|{language}|{pack_rev}|{ALIGN_ENGINE_REV}")


def audio_path(root: str, audio_hash: str) -> str:
    return f"{root}/audio/{audio_hash}.opus"


def audio_meta_path(root: str, audio_hash: str) -> str:
    return f"{root}/audio/{audio_hash}.json"


def result_path(root: str, stage: str, cache_key: str) -> str:
    return f"{root}/results/{stage}/{cache_key}.json"


# ---------------------------------------------------------------------------
# Retention.
# ---------------------------------------------------------------------------


def audio_expired(last_used_at: float, now: float) -> bool:
    return now - last_used_at > AUDIO_RETENTION_SEC


def result_expired(created_at: float, now: float) -> bool:
    return now - created_at > RESULT_RETENTION_SEC


# ---------------------------------------------------------------------------
# Jobs and metering. A meter line carries hashes, durations, and seconds —
# the D4 log contract — and never any transcript or script text.
# ---------------------------------------------------------------------------


def new_job(
    job_id: str,
    member: str,
    stage: str,
    audio_hash: str,
    language: str,
    cache_key: str,
    audio_duration_sec: float | None,
    now: float,
) -> dict[str, Any]:
    return {
        "jobId": job_id,
        "member": member,
        "stage": stage,
        "audioHash": audio_hash,
        "language": language,
        "cacheKey": cache_key,
        "audioDurationSec": audio_duration_sec,
        "status": "queued",
        "createdAt": now,
        "startedAt": None,
        "finishedAt": None,
        "callId": None,
        "workerSec": None,
        "error": None,
    }


def meter_line(job: dict[str, Any], outcome: str, worker_sec: float, now: float) -> dict[str, Any]:
    worker_sec = max(0.0, float(worker_sec))
    return {
        "ts": now,
        "jobId": job["jobId"],
        "member": job["member"],
        "stage": job["stage"],
        "audioHash": job["audioHash"],
        "language": job["language"],
        "audioDurationSec": job.get("audioDurationSec"),
        "outcome": outcome,
        "workerSec": round(worker_sec, 3),
        "estimatedUsd": round(worker_sec * USD_PER_WORKER_SEC, 6),
    }


def inflight_key(member: str, cache_key: str) -> str:
    """Wave 3 U4 — the jobs-dict key naming a member's non-terminal job for
    one cache key. A client retry after a lost poll resubmits the SAME
    request; the gateway answers with the job already running instead of
    spawning (and billing) a second one."""
    return f"inflight:{member}:{cache_key}"


def reusable_inflight(job: dict[str, Any] | None, member: str) -> bool:
    return job is not None and job.get("member") == member and job.get("status") not in TERMINAL_STATUSES


def lookup_reply(result: dict[str, Any] | None, audio_duration_sec: float | None) -> dict[str, Any]:
    """Wave 3 U3 — the answer to "is this stage already computed?".

    A hit carries the result itself, so the client needs no job, no upload,
    and no encode: nothing is spawned and nothing is metered. A miss says
    whether the gateway already holds the audio, so the client knows before
    encoding whether it has anything to send at all.
    """
    if result is not None:
        return {"cached": True, "result": result}
    return {
        "cached": False,
        "audioPresent": audio_duration_sec is not None,
        "audioDurationSec": audio_duration_sec,
    }


def hit_line(member: str, stage: str, audio_hash: str, language: str, now: float) -> dict[str, Any]:
    """A cache hit served by lookup — counted for the billing report's
    reconciliation, but NOT a meter line: it never spent a GPU-second. Same
    D4 contract as the meter: hashes only, no text."""
    return {"ts": now, "member": member, "stage": stage, "audioHash": audio_hash, "language": language}


def public_job(job: dict[str, Any]) -> dict[str, Any]:
    """The job as the desktop app sees it: no call ids, no member names."""
    return {
        "jobId": job["jobId"],
        "stage": job["stage"],
        "status": job["status"],
        "cached": bool(job.get("cached")),
        "audioDurationSec": job.get("audioDurationSec"),
        "createdAt": job.get("createdAt"),
        "startedAt": job.get("startedAt"),
        "finishedAt": job.get("finishedAt"),
        "workerSec": job.get("workerSec"),
        "error": job.get("error"),
    }
