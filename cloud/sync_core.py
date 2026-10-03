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

# Two live GPU containers — one per lane (bulk FIFO, editor). A lookup never
# boots one. A job a held container on the SAME lane can run must not boot a
# second on that lane (`boot-unused`). A second lane with none may boot.
GPU_MAX_CONTAINERS = 2
GPU_LANES = ("bulk", "editor")


def parse_gpu_lane(value: Any) -> str:
    if value in GPU_LANES:
        return str(value)
    return "editor"


def gpu_boot_allowed(
    *, lookup: bool, handed_off: bool, live_containers: int, lane_live: int = 0
) -> bool:
    """Whether this submission may start a GPU container."""
    if lookup or handed_off:
        return False
    if lane_live > 0:
        return False
    return live_containers < GPU_MAX_CONTAINERS
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
