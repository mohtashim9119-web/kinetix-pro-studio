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
from collections import defaultdict
from pathlib import Path
from dataclasses import dataclass
from typing import Any

SERVICE_SCHEMA = 2
# Engine cache identity stays era-1 so a jobs-API bump does not invalidate
# transcripts/alignments already paid for.
CACHE_KEY_SCHEMA = 1

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

# Third layer: the worker's own execution timeout (Modal counts it from the
# moment the container starts running the call — queue wait for a T4 is not
# in it and is not billed). Sized from the measurements for a full-cap hour:
#   transcribe 110.5 s warm + the 30 s hand-off hold it may carry (the hold
#   is inside the same call) + ~4 s model load  ->  ~145 s; align 66 s warm.
# 600 s is ~4x the slowest honest call: room for a slow T4 or a cold model
# volume, and a hard ceiling of 600 s x USD_PER_WORKER_SEC (~$0.125) on any
# one job, so no job can bill unbounded GPU time. The client's own wall
# limit (cloud_gateway.rs JOB_WALL_LIMIT, 25 min) also covers the GPU queue.
WARM_HOUR_TRANSCRIBE_SEC = 110.5
WARM_HOUR_ALIGN_SEC = 66.0
WORKER_TIMEOUT_SEC = 10 * 60
MAX_CHUNKS = 5000
MAX_CHUNK_TEXT_CHARS = 20_000
# wav2vec2 softmax OOM: a single hour-long window (~16 kHz) is the 607 GiB
# allocator. Lockstep with src/services/syncConstants.ts MAX_RUN_SEC.
MAX_ALIGN_WINDOW_SEC = 30.0

# 1.5.1 — alignment memory, the physical bound behind that policy cap. The
# worker forwards ONE window at a time (batch 1); each encoder layer holds the
# attention scores and their softmax together, each [1, 16, T, T] float32, T
# being the conv stack's frame count (~50/s). So peak memory is the LONGEST
# window's, squared — never the number of windows. Pinned against the two
# production OOMs (job records bf762a2b / 2672bce4): a 231.2 s window asked for
# 8,551,070,976 B and a 194.8 s one 6,072,773,376 B, both reproduced to the
# byte by `align_attention_bytes`; the widest window that ever succeeded on
# the T4 was 130.8 s (~5.5 GB peak). A 30 s window peaks at ~0.29 GB; the
# bound refuses anything past ~58 s, still 5x under the widest success.
ALIGN_SAMPLE_RATE_HZ = 16_000
ALIGN_ATTENTION_HEADS = 16
ALIGN_CONV_LAYERS = ((10, 5), (3, 2), (3, 2), (3, 2), (3, 2), (2, 2), (2, 2))
ALIGN_MEMORY_BOUND_BYTES = 1 << 30

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

    def __init__(self, code: str, detail: str, retry_after_sec: float | None = None) -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail
        # Set when trying again later will work (a quota refusal).
        self.retry_after_sec = retry_after_sec


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


def validate_align_audio(duration_sec: float | None) -> None:
    """Same hour cap as transcribe, on the ALIGN submit path (no GPU boot)."""
    if duration_sec is None:
        return
    if duration_sec > MAX_AUDIO_SEC + AUDIO_DURATION_TOLERANCE_SEC:
        raise ValidationError(
            "too-long", f"audio is {duration_sec:.1f}s; the cap is {MAX_AUDIO_SEC:.0f}s"
        )


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
        if end - start > MAX_ALIGN_WINDOW_SEC + 1e-3:
            raise ValidationError(
                "bad-chunks",
                f"chunk {i} window [{start}, {end}] is longer than {MAX_ALIGN_WINDOW_SEC:.0f}s",
            )
        if not isinstance(text, str) or len(text) > MAX_CHUNK_TEXT_CHARS:
            raise ValidationError("bad-chunks", f"chunk {i} text must be a string under {MAX_CHUNK_TEXT_CHARS} chars")
        out.append({"startSec": start, "endSec": end, "text": text})
    guard_align_memory([window_samples(c["startSec"], c["endSec"]) for c in out])
    return out


def window_samples(start_sec: float, end_sec: float) -> int:
    """Samples in a chunk window, as the worker slices it (unclamped: an upper bound)."""
    rate = ALIGN_SAMPLE_RATE_HZ
    return max(0, int(round(end_sec * rate)) - int(round(start_sec * rate)))


def align_frames(n_samples: int) -> int:
    """Encoder frames wav2vec2's conv stack makes of `n_samples` (~50/s)."""
    n = int(n_samples)
    for kernel, stride in ALIGN_CONV_LAYERS:
        if n < kernel:
            return 0
        n = (n - kernel) // stride + 1
    return n


def align_attention_bytes(n_samples: int) -> int:
    """One [1, heads, T, T] float32 attention buffer for a window."""
    t = align_frames(n_samples)
    return ALIGN_ATTENTION_HEADS * t * t * 4


def align_peak_bytes(n_samples: int) -> int:
    """A window's forward peak: scores and softmax alive together."""
    return 2 * align_attention_bytes(n_samples)


def guard_align_memory(window_sample_counts: list[int]) -> None:
    """Refuse — typed, before any GPU work — a plan whose widest window's
    forward would exceed ALIGN_MEMORY_BOUND_BYTES. The backstop under the
    MAX_ALIGN_WINDOW_SEC policy: it holds even if that cap drifts."""
    for i, n in enumerate(window_sample_counts):
        need = align_peak_bytes(n)
        if need > ALIGN_MEMORY_BOUND_BYTES:
            raise ValidationError(
                "too-large-batch",
                f"chunk {i} window ({n / ALIGN_SAMPLE_RATE_HZ:.2f}s) needs {need / 2**30:.1f} GiB of attention "
                f"memory; the bound is {ALIGN_MEMORY_BOUND_BYTES / 2**30:.1f} GiB",
            )


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
    return sha256_hex(f"transcribe|{CACHE_KEY_SCHEMA}|{audio_hash}|{language}|{TRANSCRIBE_ENGINE_REV}")


def alignment_cache_key(audio_hash: str, plan_hash: str, language: str, pack_rev: str) -> str:
    return sha256_hex(f"align|{CACHE_KEY_SCHEMA}|{audio_hash}|{plan_hash}|{language}|{pack_rev}|{ALIGN_ENGINE_REV}")


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


def validate_owner_id(value: Any, *, field: str) -> str | None:
    """Optional project/row id the client stamps on a job so it can reattach."""
    if value is None or value == "":
        return None
    if not isinstance(value, str) or len(value) > 128 or not value.isascii() or any(c.isspace() for c in value):
        raise ValidationError("bad-owner", f"{field} must be a short ascii id")
    return value


def owner_index_key(member: str, kind: str, owner_id: str) -> str:
    if kind not in ("project", "row", "member"):
        raise ValueError(f"owner kind must be project, row, or member, got {kind!r}")
    return f"owner:{member}:{kind}:{owner_id}"


def member_index_key(member: str) -> str:
    return owner_index_key(member, "member", member)


def owner_ids_append(existing: Any, job_id: str, cap: int = 32) -> list[str]:
    ids = [x for x in (existing or []) if isinstance(x, str)]
    if job_id not in ids:
        ids.append(job_id)
    return ids[-cap:]


def apply_owner_fields(job: dict[str, Any], project_id: str | None, row_id: str | None) -> dict[str, Any]:
    if project_id:
        job["projectId"] = project_id
    if row_id:
        job["rowId"] = row_id
    return job


# App lifecycle (reload, crash, quit) must never cancel a GPU job. Only an
# explicit DELETE from the operator's Cancel control may. The client's poll
# loop dying is a detach, not a cancel.
CLIENT_DISCONNECT_KILLS_JOB = False


def hold_is_open(job: dict[str, Any] | None, handoff_value: Any) -> bool:
    """True while a held job is still waiting for a hand-off or release."""
    if not job or not job.get("hold"):
        return False
    if job.get("status") not in ("queued", "running", "done"):
        return False
    return handoff_value is None


def attach_pause(job: dict[str, Any], pause: dict[str, Any]) -> dict[str, Any]:
    """Store a pause-and-ask on the job. Survives client death; answering is POST."""
    if job.get("status") == "cancelled":
        raise ValidationError("job-cancelled", "cannot pause a cancelled job")
    pause_id = pause.get("id")
    question = pause.get("question")
    options = pause.get("options")
    if not isinstance(pause_id, str) or not pause_id:
        raise ValidationError("bad-pause", "pause id is required")
    if not isinstance(question, str) or not question:
        raise ValidationError("bad-pause", "pause question is required")
    if not isinstance(options, list) or not options:
        raise ValidationError("bad-pause", "pause options must be a non-empty list")
    out = dict(job)
    record = {
        "id": pause_id,
        "kind": pause.get("kind"),
        "question": question,
        "options": options,
        "answer": None,
        "projectId": pause.get("projectId"),
        "host": pause.get("host"),
        "audioHash": pause.get("audioHash"),
        "stage": pause.get("stage"),
        "timestamp": pause.get("timestamp"),
        "detail": pause.get("detail"),
    }
    out["pause"] = record
    out["awaitingAnswer"] = True
    return out


def answer_pause(job: dict[str, Any], pause_id: str, choice: str) -> dict[str, Any]:
    pause = job.get("pause")
    if not isinstance(pause, dict) or pause.get("id") != pause_id:
        raise ValidationError("stale-pause", "this pause is no longer the live question")
    options = pause.get("options") or []
    allowed: list[str] = []
    for opt in options:
        if isinstance(opt, str):
            allowed.append(opt)
        elif isinstance(opt, dict) and isinstance(opt.get("id"), str):
            allowed.append(opt["id"])
    if choice not in allowed:
        raise ValidationError("bad-answer", f"answer must be one of {', '.join(allowed)}")
    if pause.get("answer") is not None:
        return job
    out = dict(job)
    out["pause"] = {**pause, "answer": choice}
    out["awaitingAnswer"] = False
    return out


def pause_dialog_for_job(job: dict[str, Any] | None) -> dict[str, Any] | None:
    """What the app should show. An answered job — even if it later succeeded — is silent."""
    if not job:
        return None
    pause = job.get("pause")
    if not isinstance(pause, dict):
        return None
    if pause.get("answer") is not None or not job.get("awaitingAnswer"):
        return None
    return pause


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
        # Wave 3 U7 — which container: a batch's "one boot" is checkable as
        # one distinct task id across its lines.
        "taskId": job.get("taskId"),
        "workerSec": round(worker_sec, 3),
        "estimatedUsd": round(worker_sec * USD_PER_WORKER_SEC, 6),
        "gpuLane": parse_gpu_lane(job.get("gpuLane")),
        # 1.5.2 — the app row/project it ran for: per-row and per-attempt billing.
        "projectId": job.get("projectId"),
        "rowId": job.get("rowId"),
    }


# ---------------------------------------------------------------------------
# Wave 3 U5 — cancel honesty. Whether a job started is decided by ONE
# put-if-absent on `start_key`: the worker writes the second its billing
# began from, DELETE writes CANCELLED_BEFORE_START. Exactly one wins, so a
# cancel never meters $0 for work that ran and never meters work that didn't.
# ---------------------------------------------------------------------------

CANCELLED_BEFORE_START = "CANCELLED"


def start_key(job_id: str) -> str:
    return f"start:{job_id}"


def cancelled_key(job_id: str) -> str:
    """The cancelled record, kept apart from the job record so a worker's
    late "running" write can never un-cancel a job."""
    return f"cancelled:{job_id}"


def cancel_charge(claim: Any, now: float) -> tuple[bool, float]:
    """(started, billed seconds) for a cancel, from the start claim the
    cancel lost to. A claim DELETE itself won is (False, 0.0)."""
    if isinstance(claim, (int, float)) and not isinstance(claim, bool):
        return True, max(0.0, now - float(claim))
    return False, 0.0


def first_job_billing(booted_at: float, created_at: float | None) -> tuple[float, float]:
    """(billed_from, residue seconds) for a container's first job. The job
    pays for the boot only if the container booted for it: a container Modal
    started for an earlier job (one cancelled while it was starting) and kept
    warm must not bill that job's start-up to the next one. The gap before the
    job existed is residue, metered as its own `boot-unused` line."""
    if created_at is None or created_at <= booted_at:
        return booted_at, 0.0
    return created_at, created_at - booted_at


def boot_residue_line(task_id: str | None, booted_at: float, now: float) -> dict[str, Any]:
    """A GPU container that booted and exited without running a job — the
    usual cause is a job cancelled while its container was still starting.
    No job is charged for it, but the container's seconds were real, so the
    meter shows them under their own outcome instead of hiding them."""
    worker_sec = max(0.0, now - booted_at)
    return {
        "ts": now,
        "jobId": f"boot-{task_id or int(booted_at * 1000)}",
        "member": None,
        "stage": "container",
        "audioHash": None,
        "language": None,
        "audioDurationSec": None,
        "outcome": "boot-unused",
        "taskId": task_id,
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


# ---------------------------------------------------------------------------
# Wave 3 U4.5 — one boot per sync ("sync intent"). A transcription job may ask
# to be HELD: after its transcript is written, its GPU container waits (at
# most HOLD_FOR_PLAN_SEC) for the client's coverage check + chunk plan, then
# runs the alignment in the SAME container. The client releases the hold at
# once when there is nothing to align (spine incomplete, coverage mismatch,
# alignment already cached) — the GPU is never held waiting for FILES, only
# for the seconds the client needs to plan. The hand-off is one atomic
# put-if-absent on `handoff_key`: the worker closing the hold and the gateway
# handing it a job cannot both win, so an alignment is never lost (a closed
# hold just means a normal spawn).
# ---------------------------------------------------------------------------

# P11: orphan / crash floor PLUS the measured in-flight stage gap (client
# poll used to add ~1.5s). Finish/handoff/RELEASE still wait 0. Last row
# hold=false. Kill keeps the record. The window only bridges stage gaps.
HOLD_FOR_PLAN_SEC = 8.0


def hold_wait_budget(*, hold: bool) -> float:
    """Seconds the worker may sit after a job finishes waiting for a hand-off."""
    return HOLD_FOR_PLAN_SEC if hold else 0.0


def post_finish_held_sec(
    *,
    hold: bool,
    handed_off: bool,
    released: bool,
    waited_sec: float = 0.0,
) -> float:
    """Idle GPU seconds billed after the job itself finished.

    Success that handed off or was released has a fixed cost at that instant.
    An orphaned holder (no queued work) is capped at HOLD_FOR_PLAN_SEC.
    A last queue item (hold=false) is 0 — no timeout wait.
    """
    if not hold or handed_off or released:
        return 0.0
    return min(max(waited_sec, 0.0), HOLD_FOR_PLAN_SEC)


def held_after_finish(lines: list[dict[str, Any]], *, job_id: str) -> float:
    """The `held` meter attached to `job_id` after that job's work line."""
    return round(
        sum(
            float(line.get("workerSec") or 0)
            for line in lines
            if line.get("outcome") == "held" and line.get("jobId") in (job_id, f"{job_id}-hold")
        ),
        3,
    )


def kill_gpu_keep_record(store: Any, job_id: str) -> str:
    """Kill = RELEASE the GPU. The job record, billing, and result stay."""
    key = handoff_key(job_id)
    store.put(key, HANDOFF_RELEASE, skip_if_exists=True)
    return HANDOFF_RELEASE

# 1.5.2 — operator ruling (the SaaS model): 1 key = 1 member = ISOLATED lanes.
# Each member owns a bulk lane and an editor lane (1.4.4 semantics, per
# member: each lane serial, bulk + editor parallel — up to 2 containers per
# member). Across members there is no shared serialization, ever: a second
# member's job boots its own container. Before this, both lanes were global:
# live on v19, two of three members syncing at once waited 11.4 s and were
# refused, and a bulk job waited 8.0 s behind another member's.
GPU_LANES = ("bulk", "editor")
# An ABUSE ceiling on GPU calls running at once across the workspace, not a
# queue: a new job over it is refused at once (typed `service-busy`), never
# parked. Real use stays far below it (11 keys x 2 lanes = 22 is the most the
# lanes allow). Modal's own max_containers is the same number, so Modal never
# queues below it either.
GPU_WORKSPACE_CEILING = 24
# A lane entry names the call holding it; a call cannot outlive the worker
# timeout, so an older entry is a dead call's leftover (a hard container death
# runs no `finally`) and stops counting by itself.
LANE_ENTRY_TTL_SEC = WORKER_TIMEOUT_SEC + 120.0


def parse_gpu_lane(value: Any) -> str:
    """Old 1.1.x clients send no lane: their own member's editor lane."""
    if value in GPU_LANES:
        return str(value)
    return "editor"


def lane_key(member: str, lane: Any) -> str:
    return f"gpu-lane:{member}:{parse_gpu_lane(lane)}"


def lane_entries(value: Any, now: float) -> dict[str, float]:
    """The live calls on a lane: {spawned job id: acquired at}."""
    if not isinstance(value, dict):
        return {}
    return {
        k: float(v) for k, v in value.items()
        if isinstance(k, str) and isinstance(v, (int, float)) and not isinstance(v, bool)
        and now - float(v) <= LANE_ENTRY_TTL_SEC
    }


def lane_with(value: Any, job_id: str, now: float) -> dict[str, float]:
    entries = lane_entries(value, now)
    entries[job_id] = now
    return entries


def lane_without(value: Any, job_id: str, now: float) -> dict[str, float]:
    entries = lane_entries(value, now)
    entries.pop(job_id, None)
    return entries


# 1.5.1 — a lane counts the GPU CALLS in flight on it, freed when its call
# ends (`SyncWorker.run`), so a container idling out its scaledown window
# never holds a lane. Inside ONE member a still-busy lane is waited for,
# bounded: the longest a call lingers without work is a hold.
LANE_POLL_SEC = 0.25
LANE_WAIT_SEC = HOLD_FOR_PLAN_SEC + 2.0
# A queued job with no call, no hand-off and older than this was written by a
# submit that never reached its spawn (the gateway died, the request was
# dropped): it is reaped as `worker-lost`, never re-adopted.
ORPHAN_AFTER_SEC = LANE_WAIT_SEC + 20.0


def lane_decision(*, own_live: int, workspace_live: int, waited_sec: float) -> str:
    """`boot` — spawn now; `wait` — this member's own call on the lane may end
    any moment; `refuse-lane` — still busy after LANE_WAIT_SEC;
    `refuse-ceiling` — the workspace abuse ceiling (at once, never queued)."""
    if workspace_live >= GPU_WORKSPACE_CEILING:
        return "refuse-ceiling"
    if own_live <= 0:
        return "boot"
    return "wait" if waited_sec < LANE_WAIT_SEC else "refuse-lane"


@dataclass(frozen=True)
class Refusal:
    status: int
    code: str
    detail: str
    retry_after_sec: float


def lane_refusal(decision: str, lane: Any) -> Refusal:
    """What a refused spawn tells the client. Old clients show `detail`
    verbatim, so it is a plain sentence."""
    if decision == "refuse-ceiling":
        return Refusal(
            429, "service-busy",
            "The cloud sync service is at its safety limit for jobs running at once. "
            "Nothing was charged — try again in about 30 seconds.",
            30.0,
        )
    kind = "bulk" if parse_gpu_lane(lane) == "bulk" else "editor"
    return Refusal(
        409, "gpu-lane-busy",
        f"Your other {kind} cloud sync is still running on your GPU. This one can start as soon as "
        f"it finishes — try again in a few seconds. Nothing was charged.",
        float(LANE_WAIT_SEC),
    )


def lane_refused(job: dict[str, Any], refusal: Refusal, now: float) -> dict[str, Any]:
    """The record of a refused submit: terminal, never started, never billed —
    nothing can re-attach to it."""
    return dict(
        job, status="failed", startedAt=None, finishedAt=now, workerSec=0.0,
        error={"code": refusal.code, "detail": refusal.detail},
    )


def is_orphan(job: dict[str, Any], *, has_call: bool, now: float) -> bool:
    return (
        job.get("status") == "queued"
        and not has_call
        and not job.get("handedOff")
        and now - float(job.get("createdAt") or 0.0) > ORPHAN_AFTER_SEC
    )


def reaped(job: dict[str, Any], now: float) -> dict[str, Any]:
    """A job no worker will ever run: terminal, and retryable on the client."""
    return dict(
        job, status="failed", finishedAt=now, workerSec=0.0,
        error={"code": "worker-lost", "detail": "the job never reached a GPU worker; run it again"},
    )


def submit_interrupted(job: dict[str, Any], exc: BaseException, now: float) -> dict[str, Any]:
    """A submit stopped after its record existed: terminal, never queued."""
    return dict(
        job, status="failed", finishedAt=now, workerSec=0.0,
        error={"code": "worker-lost", "detail": f"the submit was interrupted ({type(exc).__name__}); run it again"},
    )


def worker_error(exc: BaseException) -> dict[str, str]:
    """A worker failure as a typed job error — a typed refusal keeps its code."""
    if isinstance(exc, ValidationError):
        return {"code": exc.code, "detail": exc.detail[:500]}
    return {"code": "worker-error", "detail": f"{type(exc).__name__}: {exc}"[:500]}


# 1.5.2 — per-member GPU budget: an ABUSE guard on a rolling hour, not a
# queue. team-1's real 10-04 bulk batch used ~662 GPU-s in 32 min (~1,240
# GPU-s/hour pace); the suggested 300 s/hour would have refused it at its 5th
# row. 2,400 GPU-s (~$0.50) per member per hour is ~2x that pace — and a
# member can physically run at most 2 containers (7,200 GPU-s/hour). TUNABLE.
MEMBER_QUOTA_GPU_SEC = 2400.0
MEMBER_QUOTA_WINDOW_SEC = 3600.0


def usage_key(member: str) -> str:
    return f"gpu-usage:{member}"


def usage_entries(value: Any, now: float) -> list[list[float]]:
    if not isinstance(value, list):
        return []
    out: list[list[float]] = []
    for item in value:
        if isinstance(item, (list, tuple)) and len(item) == 2 and all(isinstance(x, (int, float)) for x in item):
            if now - float(item[0]) <= MEMBER_QUOTA_WINDOW_SEC:
                out.append([float(item[0]), float(item[1])])
    return out


def usage_with(value: Any, sec: float, now: float) -> list[list[float]]:
    entries = usage_entries(value, now)
    if sec > 0:
        entries.append([now, round(float(sec), 3)])
    return entries


def quota_used(value: Any, now: float) -> float:
    return round(sum(sec for _, sec in usage_entries(value, now)), 3)


def check_member_quota(value: Any, now: float) -> None:
    used = quota_used(value, now)
    if used < MEMBER_QUOTA_GPU_SEC:
        return
    # It frees as the oldest seconds leave the rolling hour.
    excess, frees_at = used - MEMBER_QUOTA_GPU_SEC, now
    for ts, sec in sorted(usage_entries(value, now)):
        excess -= sec
        frees_at = ts + MEMBER_QUOTA_WINDOW_SEC
        if excess < 0:
            break
    retry = max(1.0, frees_at - now)
    raise ValidationError(
        "member-quota",
        f"This key has used its cloud GPU allowance for the past hour ({used:.0f} of "
        f"{MEMBER_QUOTA_GPU_SEC:.0f} GPU-seconds). Nothing was charged — it frees up in about "
        f"{max(1, round(retry / 60))} minute(s).",
        retry_after_sec=retry,
    )


def member_summaries(lines: list[dict[str, Any]], usage: dict[str, Any], now: float) -> list[dict[str, Any]]:
    """Per key: jobs, distinct containers, GPU-seconds, dollars, quota used."""
    by: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for line in lines:
        if line.get("member"):
            by[line["member"]].append(line)
    out = []
    for member in sorted(set(by) | set(usage)):
        group = by.get(member, [])
        sec = sum(float(line.get("workerSec") or 0.0) for line in group)
        out.append({
            "member": member,
            "jobs": sum(1 for line in group if line.get("outcome") != "held"),
            "boots": len({line.get("taskId") for line in group if line.get("taskId")}),
            "workerSec": round(sec, 3),
            "estimatedUsd": round(sec * USD_PER_WORKER_SEC, 6),
            "quotaUsedSec": quota_used(usage.get(member), now),
        })
    return out


# 1.5.2 — retention for the job Dict (job records, their call/start/handoff/
# cancelled keys, inflight pointers). Nothing removed them before: 1,418 keys
# after one week, the first day's records all still there. Results live 30
# days; a finished job's record goes with them.
JOB_RETENTION_SEC = RESULT_RETENTION_SEC
JOB_AUX_PREFIXES = ("call:", "start:", "handoff:", "cancelled:")


def expired_job_keys(items: dict[str, Any], now: float) -> list[str]:
    """Keys to delete: finished jobs past retention with their aux keys and
    the inflight pointers to them, plus the retired global lane counter."""
    expired = {
        k for k, v in items.items()
        if isinstance(v, dict) and v.get("jobId") == k and v.get("status") in TERMINAL_STATUSES
        and now - float(v.get("createdAt") or now) > JOB_RETENTION_SEC
    }
    gone = set(expired)
    for k, v in items.items():
        if any(k.startswith(p) and k[len(p):] in expired for p in JOB_AUX_PREFIXES):
            gone.add(k)
        elif k.startswith("inflight:") and v in expired:
            gone.add(k)
    if "gpu-lanes" in items:
        gone.add("gpu-lanes")
    return sorted(gone)


# Wave 3 U7 — the bulk queue chains many jobs through ONE container: any job
# may be held (not only a transcription) and handed the next. Modal's timeout
# is per CALL, so a chain must stay well inside it: once a call has run this
# long it stops holding, and the queue's next job spawns normally (a second
# boot, said so in the batch report). 300 s of a 600 s timeout leaves room for
# the one job that starts just under the budget (<= ~145 s for a full hour).
CHAIN_BUDGET_SEC = 300.0
HANDOFF_RELEASE = "RELEASE"
HANDOFF_CLOSED = "CLOSED"


def handoff_key(job_id: str) -> str:
    return f"handoff:{job_id}"


def handoff_target(value: Any) -> str | None:
    """The job id a hold was handed, or None for release/closed/absent."""
    if not isinstance(value, str) or not value or value in (HANDOFF_RELEASE, HANDOFF_CLOSED):
        return None
    return value


def can_hold_for(holder: dict[str, Any] | None, member: str, lane: str | None = None) -> bool:
    """A job the next job may be handed to: this member's job (either stage —
    U7 chains a whole queue) that asked to be held and has not been
    released/closed by its own record. Never hands across GPU lanes."""
    return (
        holder is not None
        and holder.get("member") == member
        and holder.get("stage") in STAGES
        and holder.get("status") != "failed"
        and bool(holder.get("hold"))
        and holder.get("status") in ("queued", "running", "done")
        and (lane is None or parse_gpu_lane(holder.get("gpuLane")) == parse_gpu_lane(lane))
    )


async def claim_handoff_key(get: Any, put: Any, holder_job_id: str, new_job_id: str) -> bool:
    """The gateway's (async) claim of `handoff:<holder>` for `new_job_id` —
    the same decisions as `claim_handoff`. True when attached."""
    key = handoff_key(holder_job_id)
    action = decide_handoff_put(await get(key), new_job_id)
    if action == "ok":
        return True
    if action == "spawn":
        return False
    if await put(key, new_job_id, skip_if_exists=True):
        return True
    retry = decide_handoff_retry(await get(key), new_job_id)
    if retry == "ok":
        return True
    if retry == "overwrite":
        await put(key, new_job_id)
        return True
    return False


def chain_fields(body: dict[str, Any]) -> tuple[bool, str | None]:
    """Hold flags from one JSON parse — the last stage of the last row still
    names `holdJobId` even when `hold` is false (nothing sits behind it)."""
    hold = body.get("hold") is True
    raw = body.get("holdJobId")
    hold_job_id = raw if isinstance(raw, str) and raw else None
    return hold, hold_job_id


def decide_handoff_put(existing: Any, new_job_id: str) -> str:
    """How to claim `handoff:<holder>` for `new_job_id`.

    `put` — skip_if_exists write (empty key). `overwrite` — key is a None
    tombstone (some Dict GET of a missing key stores None; skip_if_exists
    then refuses). `ok` — already ours. `spawn` — closed/released/other job.
    """
    if existing == new_job_id:
        return "ok"
    if existing in (HANDOFF_CLOSED, HANDOFF_RELEASE):
        return "spawn"
    if handoff_target(existing):
        return "spawn"
    if existing is None:
        return "put"
    return "spawn"


def decide_handoff_retry(existing_after_skip_fail: Any, new_job_id: str) -> str:
    if existing_after_skip_fail == new_job_id:
        return "ok"
    if existing_after_skip_fail is None:
        return "overwrite"
    return "spawn"


def claim_handoff(store: Any, *, holder: dict[str, Any] | None, member: str, new_job_id: str) -> bool:
    """Last-stage and intermediate handoffs share this claim. Returns True
    when the new job is attached to the live holder (no spawn)."""
    if not can_hold_for(holder, member) or holder is None:
        return False
    key = handoff_key(holder["jobId"])
    existing = store.get(key)
    action = decide_handoff_put(existing, new_job_id)
    if action == "ok":
        return True
    if action == "spawn":
        return False
    put = getattr(store, "put")
    if put(key, new_job_id, skip_if_exists=True):
        return True
    retry = decide_handoff_retry(store.get(key), new_job_id)
    if retry == "ok":
        return True
    if retry == "overwrite":
        put(key, new_job_id, skip_if_exists=False)
        return True
    return False


BATCH_GAP_SEC = 120.0


def batch_summaries(lines: list[dict[str, Any]], gap_sec: float = BATCH_GAP_SEC) -> list[dict[str, Any]]:
    """Wave 3 U7 — the billing report's batches. Meter lines are grouped into
    runs whose consecutive lines are less than `gap_sec` apart (a bulk queue
    finishes jobs back to back). Per batch: projects (distinct audio), GPU
    jobs, distinct containers (`boots` — 1 means the queue rode one cold
    start), the seconds the container was merely held between jobs, the
    unused-boot residue, and the rate-card total."""
    ordered = sorted(lines, key=lambda line: line["ts"])
    groups: list[list[dict[str, Any]]] = []
    for line in ordered:
        if groups and line["ts"] - groups[-1][-1]["ts"] < gap_sec:
            groups[-1].append(line)
        else:
            groups.append([line])
    out: list[dict[str, Any]] = []
    for group in groups:
        work = [line for line in group if line["outcome"] in ("done", "failed", "cancelled")]
        held = sum(line["workerSec"] for line in group if line["outcome"] == "held")
        residue = sum(line["workerSec"] for line in group if line["outcome"] == "boot-unused")
        boots = {line.get("taskId") for line in group if line.get("taskId")}
        total_sec = sum(line["workerSec"] for line in group)
        out.append({
            "from": group[0]["ts"],
            "to": group[-1]["ts"],
            "projects": len({line["audioHash"] for line in work if line.get("audioHash")}),
            "jobs": len(work),
            "cacheHits": sum(1 for line in group if line["outcome"] == "cache-hit"),
            "boots": len(boots),
            "heldSec": round(held, 3),
            "bootResidueSec": round(residue, 3),
            "workerSec": round(total_sec, 3),
            "estimatedUsd": round(total_sec * USD_PER_WORKER_SEC, 6),
        })
    return out


def row_summaries(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One line per audio (a bulk row): boots, hold, unused boot, dollars, cache."""
    by_audio: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for line in lines:
        audio = line.get("audioHash")
        if audio:
            by_audio[audio].append(line)
    rows: list[dict[str, Any]] = []
    for audio, group in by_audio.items():
        work = [line for line in group if line["outcome"] in ("done", "failed", "cancelled", "cache-hit")]
        held = sum(line["workerSec"] for line in group if line["outcome"] == "held")
        sec = sum(line["workerSec"] for line in group)
        cached = bool(work) and all(line["outcome"] == "cache-hit" for line in work)
        free = sec == 0
        rows.append({
            "audioHash": audio,
            "from": min(line["ts"] for line in group),
            "jobs": len(work),
            "boots": len({line.get("taskId") for line in group if line.get("taskId")}),
            "heldSec": round(held, 3),
            "workerSec": round(sec, 3),
            "estimatedUsd": round(sec * USD_PER_WORKER_SEC, 6),
            "cached": cached,
            "free": free,
        })
    rows.sort(key=lambda row: row["from"])
    return rows


def lane_summaries(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-GPU-lane boots, GPU-seconds, and dollars — never cross-billed."""
    by_lane: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for line in lines:
        by_lane[parse_gpu_lane(line.get("gpuLane"))].append(line)
    out: list[dict[str, Any]] = []
    for lane in GPU_LANES:
        group = by_lane.get(lane, [])
        sec = sum(line.get("workerSec") or 0 for line in group)
        out.append({
            "gpuLane": lane,
            "jobs": len(group),
            "boots": len({line.get("taskId") for line in group if line.get("taskId")}),
            "workerSec": round(sec, 3),
            "estimatedUsd": round(sec * USD_PER_WORKER_SEC, 6),
        })
    return out


def may_hold(call_age_sec: float) -> bool:
    """Whether a container whose call has run `call_age_sec` may still wait
    for a hand-off (see CHAIN_BUDGET_SEC)."""
    return call_age_sec < CHAIN_BUDGET_SEC


# 1.5.1 — every job the gateway accepts can run. Before this, a submit wrote
# its record (and inflight + owner index) and THEN met a busy lane: the 409
# left a `queued` job no worker would ever take, and the client's next retry
# re-attached to it. Likewise a holder that stopped for the chain budget left
# its hand-off key open, so the gateway attached the next job to a container
# that had already moved on.


def close_hold(store: Any, job_id: str) -> str | None:
    """Stop holding `job_id`'s container now. Returns a job already handed to
    it (attached to this call — the worker must run it), else None with the
    key CLOSED so the gateway spawns instead of attaching."""
    key = handoff_key(job_id)
    if store.put(key, HANDOFF_CLOSED, skip_if_exists=True):
        return None
    existing = store.get(key)
    if existing is None:  # a None tombstone: claim it the way claim_handoff does
        store.put(key, HANDOFF_CLOSED)
        existing = store.get(key)
    return handoff_target(existing)


def chain_next(store: Any, job: dict[str, Any], call_age_sec: float, wait_for_handoff: Any) -> str | None:
    """After a held `job` finished: the next job this container runs, or None.
    Inside the chain budget it waits (bounded) for the client's hand-off;
    past it, it closes the hold at once and runs only a job already attached."""
    if not job.get("hold"):
        return None
    if may_hold(call_age_sec):
        return wait_for_handoff(job)
    return close_hold(store, job["jobId"])


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


def modal_billing_args(start: str, end: str) -> list[str]:
    """`modal billing report` range flags. Modal refuses an hourly report over
    7 days, so a longer range is asked for in day buckets."""
    from datetime import date

    days = (date.fromisoformat(end) - date.fromisoformat(start)).days
    return ["--start", start, "--end", end, "-r", "h" if days <= 7 else "d"]


def owner_attempts(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """1.5.2 — per app row/project (per member): every billed attempt in
    order — a failure, its fresh-submit retry, the finish — and their sum."""
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for line in lines:
        if line.get("outcome") in ("boot-unused",) or not line.get("member"):
            continue
        owner = line.get("rowId") or line.get("projectId") or "(no owner recorded)"
        groups[(line["member"], owner)].append(line)
    out = []
    for (member, owner), group in sorted(groups.items()):
        group.sort(key=lambda line: line["ts"])
        sec = sum(float(line.get("workerSec") or 0.0) for line in group)
        out.append({
            "member": member, "owner": owner,
            "attempts": [
                {"jobId": line["jobId"], "ts": line["ts"], "stage": line.get("stage"),
                 "outcome": line.get("outcome"), "workerSec": line.get("workerSec")}
                for line in group
            ],
            "workerSec": round(sec, 3),
            "estimatedUsd": round(sec * USD_PER_WORKER_SEC, 6),
        })
    return out


def hit_line(member: str, stage: str, audio_hash: str, language: str, now: float) -> dict[str, Any]:
    """A cache hit served by lookup — counted for the billing report's
    reconciliation, but NOT a meter line: it never spent a GPU-second. Same
    D4 contract as the meter: hashes only, no text."""
    return {"ts": now, "member": member, "stage": stage, "audioHash": audio_hash, "language": language}


def public_job(job: dict[str, Any], *, hold_open: bool | None = None) -> dict[str, Any]:
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
        "estimatedUsd": (
            round(float(job["workerSec"]) * USD_PER_WORKER_SEC, 6) if job.get("workerSec") is not None else None
        ),
        "error": job.get("error"),
        # Wave 3 U4.5 — the container that ran it (None until it ran).
        "taskId": job.get("taskId"),
        "handedOff": bool(job.get("handedOff")),
        "projectId": job.get("projectId"),
        "rowId": job.get("rowId"),
        "pause": job.get("pause"),
        "awaitingAnswer": bool(job.get("awaitingAnswer")),
        "holdOpen": bool(hold_open) if hold_open is not None else bool(job.get("holdOpen")),
    }
