"""Kinetix cloud sync service — gateway + GPU worker (plan-v3 Wave 3, U0).

Unlike the measurement harness beside it (`app.py`, `align.py`,
`measure.py`), this is the deployed service the desktop app talks to:

    modal deploy cloud/sync_service.py

One Modal app, one deployment (operator D1 / Amendment 2):

- `gateway` — a FastAPI ASGI endpoint, the ONLY thing the desktop app
  calls. Bearer key per team member (Modal Secret `kinetix-gateway-keys`,
  holding sha256 digests only). Stores uploaded Opus audio by content hash,
  answers result-cache hits without touching a GPU, and spawns worker jobs.
  Wave 3 U3: `POST /v1/cache/lookup` answers "is this stage already
  computed?" BEFORE the client encodes or uploads anything — a hit returns
  the result with no job, no GPU, and no meter line.
- `SyncWorker` — one T4 class that serves BOTH stages (faster-whisper
  transcription and ONNX forced alignment), loading each model lazily on
  first use. One class, not two, so a batch of transcribe+align jobs can
  run back to back in one container on one cold start.
- `purge_expired` — daily retention sweep (operator D4).
- `seed_whisper_pinned` — one-time weight seed at the pinned revision.

Pure logic (auth, validation, cache keys, retention, metering) lives in
`sync_core.py` and is unit-tested by `test_sync_core.py`.
"""

import asyncio
import json
import os
import tempfile
import time
import uuid
import wave
from pathlib import Path
from typing import Any

import modal

import sync_core as core

APP_NAME = "kinetix-sync"

# Operator D1 (Wave 3): no idle warm window — every sync pays its own cold
# start (typically 7-30 s of machine wait, unbilled, plus ~3 s of billed
# model load). Modal refuses 0 (`scaledown_window must be > 0`), so this is
# the smallest value it accepts: the container exits as soon as its job is
# done. TUNABLE — revisit with week-one usage data. Logged operator note: 60
# (~$0.01/session) would cover the tweak-script-then-resync pattern if the
# re-waits annoy the team.
GPU_SCALEDOWN_WINDOW_SEC = int(core.HOLD_FOR_PLAN_SEC)

# The gateway is a small CPU container; staying up between a job's polls
# costs fractions of a cent and saves a CPU cold start on every poll.
GATEWAY_SCALEDOWN_WINDOW_SEC = 60

# Third layer of the one-hour cap: a job that runs past this is killed by
# Modal. The number and its reasoning live in `sync_core.WORKER_TIMEOUT_SEC`.
JOB_TIMEOUT_SEC = core.WORKER_TIMEOUT_SEC

CACHE_ROOT = "/cache"
WHISPER_ROOT = "/whisper"
FA_ROOT = "/fa"
WHISPER_DIR = f"{WHISPER_ROOT}/faster-whisper-large-v3-turbo@{core.WHISPER_REVISION}"

CLOUD = Path(__file__).resolve().parent
FIXTURE_DIR = CLOUD.parent / "scripts" / "fixtures"

app = modal.App(APP_NAME)

whisper_vol = modal.Volume.from_name("kinetix-whisper-weights", create_if_missing=True)
fa_vol = modal.Volume.from_name("kinetix-fa-weights", create_if_missing=True)
cache_vol = modal.Volume.from_name("kinetix-sync-cache", create_if_missing=True)
jobs = modal.Dict.from_name("kinetix-sync-jobs", create_if_missing=True)
# Wave 3 U3 — lookup hits, for the billing report's reconciliation only.
# Not the meter: a hit spends no GPU-second, so it has no meter line.
hits = modal.Dict.from_name("kinetix-sync-hits", create_if_missing=True)
keys_secret = modal.Secret.from_name("kinetix-gateway-keys")

gpu_image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.11")
    .apt_install("ffmpeg")
    # onnxruntime-gpu provides the `onnxruntime` module. faster-whisper
    # declares the CPU `onnxruntime` wheel (used only by its Silero VAD,
    # which WHISPER_DECODE keeps off); installing both clobbers one package
    # with the other, so faster-whisper goes in with --no-deps and its real
    # dependencies are listed here.
    .pip_install(
        f"onnxruntime-gpu=={core.ORT_VERSION}",
        "numpy==2.2.4",
        f"ctranslate2=={core.CTRANSLATE2_VERSION}",
        "tokenizers>=0.13,<1",
        "av>=11",
        "huggingface_hub==0.30.2",
        "tqdm",
    )
    .pip_install(f"faster-whisper=={core.FASTER_WHISPER_VERSION}", extra_options="--no-deps")
    .add_local_file(str(CLOUD / "fa_engine.py"), "/root/fa_engine.py")
)
for _lang in core.FA_LANGS:
    gpu_image = gpu_image.add_local_file(
        str(FIXTURE_DIR / f"fa-vocab-{_lang}.json"), f"/vocabs/fa-vocab-{_lang}.json"
    ).add_local_file(str(FIXTURE_DIR / f"fa-cardinal-{_lang}.json"), f"/vocabs/fa-cardinal-{_lang}.json")
# Amount words (fa-amount-words.json) ride with the worker only — the gateway
# never normalizes text, and pack_digests deliberately excludes this file.
gpu_image = gpu_image.add_local_file(str(FIXTURE_DIR / "fa-amount-words.json"), "/vocabs/fa-amount-words.json")
gpu_image = gpu_image.add_local_python_source("sync_core")

gateway_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("fastapi[standard]==0.115.12", "huggingface_hub==0.30.2")
)
# Wave 3 U3 — the gateway computes the alignment cache key, which folds in
# each pack's vocab + cardinal digest, so it carries the SAME files the
# worker decodes with (one source: scripts/fixtures).
for _lang in core.FA_LANGS:
    gateway_image = gateway_image.add_local_file(
        str(FIXTURE_DIR / f"fa-vocab-{_lang}.json"), f"/vocabs/fa-vocab-{_lang}.json"
    ).add_local_file(str(FIXTURE_DIR / f"fa-cardinal-{_lang}.json"), f"/vocabs/fa-cardinal-{_lang}.json")
gateway_image = gateway_image.add_local_python_source("sync_core")

_PACK_DIGESTS: dict[str, str] | None = None


def pack_digests() -> dict[str, str]:
    """In a container the image's /vocabs; on the deploying laptop the repo
    fixtures (the same bytes — the image is built from them)."""
    global _PACK_DIGESTS
    if _PACK_DIGESTS is None:
        _PACK_DIGESTS = core.pack_digests("/vocabs" if os.path.isdir("/vocabs") else FIXTURE_DIR)
    return _PACK_DIGESTS


# ---------------------------------------------------------------------------
# Shared file helpers (gateway, worker, and purge all see /cache).
# ---------------------------------------------------------------------------


def _read_json(path: str) -> dict[str, Any] | None:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return None


def _write_json_atomic(path: str, payload: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{uuid.uuid4().hex}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    os.replace(tmp, path)


def _write_meter(line: dict[str, Any]) -> None:
    day = time.strftime("%Y-%m-%d", time.gmtime(line["ts"]))
    _write_json_atomic(f"{CACHE_ROOT}/meter/{day}/{line['jobId']}.json", line)


def _note_usage(line: dict[str, Any]) -> None:
    """1.5.2 — every billed second counts toward its member's rolling-hour
    GPU budget (the worker's side; the gateway uses `note_usage`)."""
    member, sec = line.get("member"), float(line.get("workerSec") or 0.0)
    if member and sec > 0:
        key = core.usage_key(member)
        jobs.put(key, core.usage_with(jobs.get(key), sec, line["ts"]))


# ---------------------------------------------------------------------------
# GPU worker.
# ---------------------------------------------------------------------------


@app.cls(
    image=gpu_image,
    gpu="T4",
    volumes={WHISPER_ROOT: whisper_vol, FA_ROOT: fa_vol, CACHE_ROOT: cache_vol},
    timeout=JOB_TIMEOUT_SEC,
    scaledown_window=GPU_SCALEDOWN_WINDOW_SEC,
    # 1.5.2 — Modal must never queue below the abuse ceiling (per-member lanes).
    max_containers=core.GPU_WORKSPACE_CEILING,
    buffer_containers=0,
    cpu=core.WORKER_CPU_CORES,
    memory=core.WORKER_MEMORY_GIB * 1024,
    retries=0,
)
class SyncWorker:
    @modal.enter()
    def boot(self) -> None:
        self.booted_at = time.time()
        # Wave 3 U5 — false until a job claims its start; the boot is billed
        # to that first job, or metered on exit as residue if none ever does.
        self.billed = False
        self.whisper = None
        self.fa: dict[str, tuple[Any, Any]] = {}
        # (lane key, spawned job id): the entry this call holds on its member's lane.
        self.lane: tuple[str, str] | None = None

    def _release_lane(self) -> None:
        """1.5.1 — the lane entry is this call's: freed the moment the call ends."""
        if self.lane:
            key, job_id = self.lane
            jobs.put(key, core.lane_without(jobs.get(key), job_id, time.time()))
            self.lane = None

    @modal.exit()
    def exit_unbilled(self) -> None:
        # Fallback for a call that never reached its own end (timeout, stop).
        self._release_lane()
        if self.billed:
            return
        now = time.time()
        _write_meter(core.boot_residue_line(os.environ.get("MODAL_TASK_ID"), self.booted_at, now))
        cache_vol.commit()

    def _whisper_model(self) -> Any:
        if self.whisper is None:
            from faster_whisper import WhisperModel

            if not os.path.isdir(WHISPER_DIR):
                raise RuntimeError(f"missing {WHISPER_DIR}; run seed_whisper_pinned")
            self.whisper = WhisperModel(WHISPER_DIR, device="cuda", compute_type="float16")
        return self.whisper

    def _fa_pack(self, language: str) -> tuple[Any, Any]:
        if language not in self.fa:
            import fa_engine
            import onnxruntime as ort

            onnx_path = f"{FA_ROOT}/{language}/model.onnx"
            if not os.path.isfile(onnx_path):
                raise RuntimeError(f"missing {onnx_path}; FA weights are not seeded")
            so = ort.SessionOptions()
            so.intra_op_num_threads = 1
            so.inter_op_num_threads = 1
            so.enable_mem_pattern = False
            so.enable_cpu_mem_arena = False
            try:
                so.add_session_config_entry("session.use_deterministic_compute", "1")
            except Exception:  # noqa: BLE001 — best-effort, as in the harness
                pass
            session = ort.InferenceSession(
                onnx_path, sess_options=so, providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
            )
            vocab = fa_engine.load_vocab(language, vocab_dir=Path("/vocabs"))
            self.fa[language] = (session, vocab)
        return self.fa[language]

    def _transcribe(self, job: dict[str, Any]) -> dict[str, Any]:
        model = self._whisper_model()
        lang = None if job["language"] == "auto" else job["language"]
        segments, info = model.transcribe(
            core.audio_path(CACHE_ROOT, job["audioHash"]), language=lang, **core.WHISPER_DECODE
        )
        tokens: list[dict[str, Any]] = []
        for segment in segments:
            for word in segment.words or []:
                text = (word.word or "").strip()
                if text:
                    tokens.append({"startSec": float(word.start), "endSec": float(word.end), "text": text})
        detected = getattr(info, "language", None)
        return {
            "tokens": tokens,
            "detectedLanguage": detected,
            "provenance": core.transcribe_provenance(detected if lang is None else lang),
        }

    def _align(self, job: dict[str, Any]) -> dict[str, Any]:
        import subprocess

        import fa_engine
        import numpy as np

        session, vocab = self._fa_pack(job["language"])
        with tempfile.TemporaryDirectory() as tmp:
            wav_path = os.path.join(tmp, "audio.wav")
            subprocess.check_call(
                ["ffmpeg", "-y", "-i", core.audio_path(CACHE_ROOT, job["audioHash"]), "-ar", "16000", "-ac", "1", wav_path],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            with wave.open(wav_path, "rb") as wav:
                raw = wav.readframes(wav.getnframes())
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

        def forward(normed: Any) -> Any:
            logits = session.run(["logits"], {"input_values": normed.reshape(1, -1)})[0]
            return np.asarray(logits, dtype=np.float32)

        words, extra = fa_engine.align_chunked(samples, job["chunks"], job["language"], vocab, forward)
        return {
            "words": words,
            "nChunks": extra["nChunks"],
            "nFallbackChunks": extra["nFallbackChunks"],
            "provenance": core.align_provenance(job["language"]),
        }

    @modal.method()
    def run(self, job_id: str) -> str:
        # The first job in a container is charged from container boot, so
        # model load and volume attach land on the meter, not in a gap.
        began = self.booted_at if not self.billed else time.time()
        call_started = time.time()
        first_job = jobs.get(job_id) or {}
        if first_job.get("laneKey"):
            self.lane = (first_job["laneKey"], job_id)
        try:
            outcome = self._execute(job_id, began)
            first = outcome
            # Wave 3 U7 — a held job hands its container to the next job,
            # which may itself be held: a bulk queue rides ONE container. Once
            # this call has used its budget the hold is CLOSED at once (1.5.1:
            # never left open for a hand-off this container would not run —
            # the next job then spawns normally). Any hold that was not handed
            # a job ends the loop.
            current = jobs.get(job_id) or {}
            while outcome == "done":
                target = core.chain_next(jobs, current, time.time() - call_started, self._hold_for_next)
                if not target:
                    break
                outcome = self._execute(target, time.time())
                current = jobs.get(target) or {}
            return first
        finally:
            self._release_lane()

    def _hold_for_next(self, job: dict[str, Any]) -> str | None:
        """Wave 3 U4.5 — wait (bounded) for the client's hand-off: the
        alignment for a held transcription, or (U7) the next queued job.

        The idle seconds are real GPU time, so they get their own meter line
        (`held`) rather than hiding in a gap the reconciliation can't explain.
        """
        key = core.handoff_key(job["jobId"])
        held_from = time.time()
        target: str | None = None
        released = False
        while True:
            value = jobs.get(key)
            if value == core.HANDOFF_RELEASE:
                released = True
                break
            target = core.handoff_target(value)
            if target:
                break
            if time.time() - held_from >= core.hold_wait_budget(hold=True):
                break
            time.sleep(0.05)
        if target is None and not released and not jobs.put(key, core.HANDOFF_CLOSED, skip_if_exists=True):
            # Lost the race to a hand-off that landed as the hold expired.
            target = core.handoff_target(jobs.get(key))
        now = time.time()
        waited = now - held_from
        billed = core.post_finish_held_sec(
            hold=True, handed_off=bool(target), released=released, waited_sec=waited,
        )
        if billed > 0:
            held_line = core.meter_line(dict(job, jobId=f"{job['jobId']}-hold"), "held", billed, now)
            _write_meter(held_line)
            _note_usage(held_line)
        cache_vol.commit()
        return target

    def _execute(self, job_id: str, began: float) -> str:
        job = jobs.get(job_id)
        if job is None or job["status"] != "queued":
            return "skipped"
        residue_sec = 0.0
        if not self.billed:
            began, residue_sec = core.first_job_billing(began, job.get("createdAt"))
        if not jobs.put(core.start_key(job_id), began, skip_if_exists=True):
            return "skipped"  # DELETE claimed it first: never started, never charged
        self.billed = True
        if residue_sec > 0:
            _write_meter(core.boot_residue_line(os.environ.get("MODAL_TASK_ID"), began - residue_sec, began))
        job["status"] = "running"
        job["startedAt"] = time.time()
        jobs.put(job_id, job)
        try:
            cache_vol.reload()
            result = self._transcribe(job) if job["stage"] == "transcribe" else self._align(job)
            result["createdAt"] = time.time()
            # Wave 3 U4.5 — which container ran it: two stages of one sync
            # sharing a task id is the "one boot" claim, checkable.
            job["taskId"] = os.environ.get("MODAL_TASK_ID")
            _write_json_atomic(core.result_path(CACHE_ROOT, job["stage"], job["cacheKey"]), result)
            # Committed BEFORE the job flips to done: the gateway serves a
            # done job by reading this file, so it must already be visible.
            cache_vol.commit()
            outcome, error = "done", None
        except Exception as exc:  # noqa: BLE001 — every failure becomes a typed job state
            outcome, error = "failed", core.worker_error(exc)
        now = time.time()
        latest = jobs.get(job_id) or job
        if latest["status"] == "cancelled" or jobs.get(core.cancelled_key(job_id)) is not None:
            # DELETE already metered the time this job burned; the result
            # (if any) stays cached so a retry is a cache hit, not a re-bill.
            return "cancelled"
        latest.update(
            status=outcome, finishedAt=now, workerSec=round(now - began, 3), error=error, taskId=job.get("taskId"),
        )
        if job.get("hold"):
            latest["hold"] = True
        line = core.meter_line(latest, outcome, now - began, now)
        _write_meter(line)
        cache_vol.commit()
        jobs.put(job_id, latest)
        _note_usage(line)
        return outcome


# ---------------------------------------------------------------------------
# Gateway.
# ---------------------------------------------------------------------------


@app.function(
    image=gateway_image,
    volumes={CACHE_ROOT: cache_vol},
    secrets=[keys_secret],
    scaledown_window=GATEWAY_SCALEDOWN_WINDOW_SEC,
    cpu=0.5,
    memory=1024,
    timeout=300,
)
@modal.concurrent(max_inputs=32)
@modal.asgi_app(label=APP_NAME)
def gateway() -> Any:
    from fastapi import FastAPI, Request, Response
    from fastapi.responses import JSONResponse

    from fastapi.middleware.gzip import GZipMiddleware

    web = FastAPI(title="Kinetix cloud sync", docs_url=None, redoc_url=None, openapi_url=None)
    # Wave 3 U3 — results are 200-500 KB of JSON numbers (~5x compressible),
    # and on a high-RTT link TCP slow start, not bandwidth, sets the time of
    # a cache hit. Only for clients that send Accept-Encoding: gzip.
    web.add_middleware(GZipMiddleware, minimum_size=4096)
    registry = core.parse_key_registry(os.environ.get("KINETIX_GATEWAY_KEYS"))
    # One volume op at a time per container: Modal's reload() refuses to run
    # with files open, and concurrent commits race.
    vol_lock = asyncio.Lock()
    # Strong refs to fire-and-forget tasks (asyncio keeps only weak ones).
    background: set[asyncio.Task[Any]] = set()

    class GatewayError(Exception):
        def __init__(self, status: int, code: str, detail: str, retry_after_sec: float | None = None) -> None:
            self.status, self.code, self.detail, self.retry_after_sec = status, code, detail, retry_after_sec

    STATUS_FOR_CODE = {"too-long": 413, "length-required": 411, "member-quota": 429}

    def refusal(status: int, code: str, detail: str, retry_after_sec: float | None) -> JSONResponse:
        body: dict[str, Any] = {"code": code, "detail": detail}
        headers: dict[str, str] = {}
        if retry_after_sec is not None:
            body["retryAfterSec"] = round(retry_after_sec)
            headers["Retry-After"] = str(max(1, round(retry_after_sec)))
        return JSONResponse({"error": body}, status_code=status, headers=headers)

    @web.exception_handler(GatewayError)
    async def _gateway_error(_: Request, exc: GatewayError) -> JSONResponse:
        return refusal(exc.status, exc.code, exc.detail, exc.retry_after_sec)

    @web.exception_handler(core.ValidationError)
    async def _validation_error(_: Request, exc: core.ValidationError) -> JSONResponse:
        return refusal(STATUS_FOR_CODE.get(exc.code, 400), exc.code, exc.detail, exc.retry_after_sec)

    @web.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        # 1.5.2 — never a bare-text 500: typed, and transient on the client.
        print(f"[gateway] unexpected {type(exc).__name__}: {exc}")
        return refusal(500, "gateway-error", f"{type(exc).__name__}: {exc}"[:300], None)

    def member_of(request: Request) -> str:
        member = core.authenticate(request.headers.get("authorization"), registry)
        if member is None:
            raise GatewayError(401, "auth", "missing or unknown API key")
        return member

    async def reload() -> None:
        async with vol_lock:
            await cache_vol.reload.aio()

    async def commit() -> None:
        async with vol_lock:
            await cache_vol.commit.aio()

    async def touch_audio(audio_hash: str) -> None:
        meta_path = core.audio_meta_path(CACHE_ROOT, audio_hash)
        meta = _read_json(meta_path)
        if meta is not None:
            meta["lastUsedAt"] = time.time()
            _write_json_atomic(meta_path, meta)

    async def probe(path: str) -> tuple[str | None, float | None]:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error", "-show_entries", "stream=codec_name:format=duration", "-of", "json", path,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await proc.communicate()
        try:
            parsed = json.loads(out or b"{}")
            codec = (parsed.get("streams") or [{}])[0].get("codec_name")
            duration = float(parsed.get("format", {}).get("duration"))
        except (ValueError, TypeError, IndexError):
            return None, None
        return codec, duration

    async def owned_job(job_id: str, member: str) -> dict[str, Any]:
        job = await jobs.get.aio(job_id)
        if job is None or job.get("member") != member:
            raise GatewayError(404, "not-found", "no such job")
        # Wave 3 U5 — a cancel is final even if a worker's write raced it.
        cancelled = await jobs.get.aio(core.cancelled_key(job_id))
        return cancelled if cancelled is not None else job

    async def view_job(job: dict[str, Any]) -> dict[str, Any]:
        handoff = await jobs.get.aio(core.handoff_key(job["jobId"]))
        return core.public_job(job, hold_open=core.hold_is_open(job, handoff))

    async def note_usage(line: dict[str, Any]) -> None:
        """1.5.2 — billed seconds count toward the member's GPU budget."""
        member, sec = line.get("member"), float(line.get("workerSec") or 0.0)
        if member and sec > 0:
            key = core.usage_key(member)
            await jobs.put.aio(key, core.usage_with(await jobs.get.aio(key), sec, line["ts"]))

    async def call_state(call_id: str) -> tuple[bool, dict[str, str] | None]:
        """(finished, failure) for a worker call. A timed-out or crashed call
        is finished with a typed failure; a running/queued one is not."""
        try:
            await modal.FunctionCall.from_id(call_id).get.aio(timeout=0)
            return True, None
        except modal.exception.FunctionTimeoutError:
            return True, {"code": "worker-timeout", "detail": f"job exceeded {JOB_TIMEOUT_SEC}s"}
        except modal.exception.OutputExpiredError:
            return True, {"code": "worker-lost", "detail": "worker output expired before it reported"}
        except (TimeoutError, modal.exception.TimeoutError):
            return False, None  # still queued or running
        except Exception as exc:  # noqa: BLE001 — container crash, OOM, preemption
            return True, {"code": "worker-crashed", "detail": f"{type(exc).__name__}: {exc}"[:300]}

    async def settle_if_dead(job: dict[str, Any]) -> dict[str, Any]:
        """1.5.2 — a non-terminal job no worker will ever finish becomes
        terminal (typed, retryable): never queued forever, never re-adopted.
        Covers a submit that died before its spawn (no call), a worker that
        crashed or timed out, and a call that ended without finishing it."""
        if job["status"] in core.TERMINAL_STATUSES:
            return job
        job_id = job["jobId"]
        call_id = await jobs.get.aio(f"call:{job_id}")
        if call_id is None:
            if not core.is_orphan(job, has_call=False, now=time.time()):
                return job
            failure: dict[str, str] | None = core.reaped(job, time.time())["error"]
        else:
            finished, failure = await call_state(call_id)
            if not finished:
                return job
        latest = await jobs.get.aio(job_id) or job
        cancelled = await jobs.get.aio(core.cancelled_key(job_id))
        if cancelled is not None or latest["status"] in core.TERMINAL_STATUSES:
            return cancelled if cancelled is not None else latest
        now = time.time()
        if failure is None:  # the call ended without ever finishing this job
            settled = core.reaped(latest, now)
        else:
            started = latest.get("startedAt") or now
            settled = dict(latest, status="failed", finishedAt=now, workerSec=round(now - started, 3), error=failure)
        await jobs.put.aio(job_id, settled)
        if settled["workerSec"] > 0:
            line = core.meter_line(settled, "failed", settled["workerSec"], now)
            async with vol_lock:
                _write_meter(line)
                await cache_vol.commit.aio()
            await note_usage(line)
        return settled

    async def live_lane(key: str) -> dict[str, float]:
        """1.5.2 — this member's live calls on one lane, healed: an entry whose
        call has ended (a container that died without its `finally`) or that
        never got a call is dropped and written back."""
        now = time.time()
        raw = await jobs.get.aio(key)
        entries = core.lane_entries(raw, now)
        for jid, at in list(entries.items()):
            call_id = await jobs.get.aio(f"call:{jid}")
            if call_id is None:
                if now - at > core.ORPHAN_AFTER_SEC:
                    entries.pop(jid)
            elif (await call_state(call_id))[0]:
                entries.pop(jid)
        if not isinstance(raw, dict) or len(raw) != len(entries):
            await jobs.put.aio(key, entries)
        return entries

    members = sorted(set(registry.values()))

    async def workspace_live() -> int:
        """GPU calls running across every member — the abuse ceiling's count."""
        now = time.time()
        keys = [core.lane_key(m, lane) for m in members for lane in core.GPU_LANES]
        values = await asyncio.gather(*(jobs.get.aio(k) for k in keys))
        return sum(len(core.lane_entries(v, now)) for v in values)

    async def index_owner(job: dict[str, Any]) -> None:
        member = job["member"]
        member_key = core.member_index_key(member)
        existing_member = await jobs.get.aio(member_key)
        await jobs.put.aio(member_key, core.owner_ids_append(existing_member, job["jobId"], cap=256))
        for kind, field in (("project", "projectId"), ("row", "rowId")):
            owner_id = job.get(field)
            if not owner_id:
                continue
            key = core.owner_index_key(member, kind, owner_id)
            existing = await jobs.get.aio(key)
            await jobs.put.aio(key, core.owner_ids_append(existing, job["jobId"]))

    @web.get("/v1/ping")
    async def ping(request: Request) -> dict[str, Any]:
        member = member_of(request)
        return {
            "ok": True,
            "member": member,
            "schema": core.SERVICE_SCHEMA,
            "engines": {"transcribe": core.TRANSCRIBE_ENGINE_REV, "align": core.ALIGN_ENGINE_REV},
            "limits": {"maxAudioSec": core.MAX_AUDIO_SEC, "maxUploadBytes": core.MAX_UPLOAD_BYTES},
        }

    @web.head("/v1/audio/{audio_hash}")
    async def audio_head(audio_hash: str, request: Request) -> Response:
        member_of(request)
        core.validate_audio_hash(audio_hash)
        await reload()
        meta = _read_json(core.audio_meta_path(CACHE_ROOT, audio_hash))
        if meta is None or not os.path.isfile(core.audio_path(CACHE_ROOT, audio_hash)):
            return Response(status_code=404)
        return Response(status_code=200, headers={"x-audio-duration-sec": str(meta["durationSec"])})

    @web.put("/v1/audio/{audio_hash}")
    async def audio_put(audio_hash: str, request: Request) -> dict[str, Any]:
        member_of(request)
        core.validate_audio_hash(audio_hash)
        length = request.headers.get("content-length")
        core.validate_upload_size(int(length) if length and length.isdigit() else None)
        body = await request.body()
        core.validate_upload_size(len(body))
        with tempfile.NamedTemporaryFile(suffix=".opus", delete=False) as fh:
            fh.write(body)
            staged = fh.name
        try:
            codec, duration = await probe(staged)
            duration = core.validate_probe(codec, duration)
            dest = core.audio_path(CACHE_ROOT, audio_hash)
            now = time.time()
            async with vol_lock:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                tmp_dest = f"{dest}.{uuid.uuid4().hex}.tmp"
                with open(staged, "rb") as src, open(tmp_dest, "wb") as out:
                    out.write(src.read())
                os.replace(tmp_dest, dest)
                _write_json_atomic(
                    core.audio_meta_path(CACHE_ROOT, audio_hash),
                    {"bytes": len(body), "durationSec": duration, "uploadedAt": now, "lastUsedAt": now},
                )
                await cache_vol.commit.aio()
        finally:
            os.unlink(staged)
        return {"audioHash": audio_hash, "durationSec": duration, "bytes": len(body)}

    async def resolve(request: Request, *, fresh: bool = True) -> dict[str, Any]:
        """Validate a stage request and compute its cache key — the ONE
        derivation both lookup and submit use, so a lookup miss and the
        submit that follows it can never disagree about the key.

        `fresh=False` skips the volume reload (lookup's fast path). The key
        never depends on it: the audio duration only bounds chunk windows."""
        try:
            body = await request.json()
        except ValueError:
            raise GatewayError(400, "bad-json", "request body must be JSON")
        stage = body.get("stage")
        if stage not in core.STAGES:
            raise GatewayError(400, "bad-stage", f"stage must be one of {', '.join(core.STAGES)}")
        audio_hash = core.validate_audio_hash(body.get("audioHash"))
        language = core.validate_language(stage, body.get("language"))
        if fresh:
            await reload()
        meta = _read_json(core.audio_meta_path(CACHE_ROOT, audio_hash))
        if meta is not None and not os.path.isfile(core.audio_path(CACHE_ROOT, audio_hash)):
            meta = None
        duration = meta["durationSec"] if meta else None
        if stage == "align":
            core.validate_align_audio(duration)
        chunks: list[dict[str, Any]] | None = None
        if stage == "transcribe":
            cache_key = core.transcript_cache_key(audio_hash, language)
        else:
            chunks = core.canonical_chunks(body.get("chunks"), duration)
            cache_key = core.alignment_cache_key(
                audio_hash, core.chunk_plan_hash(chunks), language, core.pack_revision(language, pack_digests())
            )
        hold, hold_job_id = core.chain_fields(body)
        return {
            "stage": stage, "audioHash": audio_hash, "language": language,
            "chunks": chunks, "cacheKey": cache_key, "meta": meta, "duration": duration,
            "hold": hold, "holdJobId": hold_job_id,
        }

    def read_result_bytes(stage: str, cache_key: str) -> bytes | None:
        try:
            with open(core.result_path(CACHE_ROOT, stage, cache_key), "rb") as fh:
                return fh.read()
        except FileNotFoundError:
            return None

    @web.post("/v1/cache/lookup")
    async def lookup(request: Request) -> Response:
        member = member_of(request)
        # Results are content-addressed and never rewritten, so a result this
        # container can already see is the answer — no reload. Only a miss
        # pays for a fresh view (another container may have just written it).
        req = await resolve(request, fresh=False)
        raw = read_result_bytes(req["stage"], req["cacheKey"])
        if raw is None:
            req = await resolve(request, fresh=True)
            raw = read_result_bytes(req["stage"], req["cacheKey"])
        if raw is not None:
            # Off the response path: the hit log must never slow the hit.
            task = asyncio.create_task(
                hits.put.aio(
                    f"{time.time():.6f}:{uuid.uuid4().hex[:8]}",
                    core.hit_line(member, req["stage"], req["audioHash"], req["language"], time.time()),
                )
            )
            background.add(task)
            task.add_done_callback(background.discard)
            # The stored result is already JSON (written by `_write_json_atomic`);
            # splicing its bytes skips a parse + re-encode of every token.
            return Response(content=b'{"cached":true,"result":' + raw + b"}", media_type="application/json")
        return JSONResponse(core.lookup_reply(None, req["duration"]))

    @web.post("/v1/jobs")
    async def submit(request: Request) -> dict[str, Any]:
        member = member_of(request)
        req = await resolve(request)
        stage, audio_hash, language = req["stage"], req["audioHash"], req["language"]
        chunks, cache_key, meta, duration = req["chunks"], req["cacheKey"], req["meta"], req["duration"]
        hold, hold_job_id = req["hold"], req["holdJobId"]
        body_owners = await request.json()
        project_id = core.validate_owner_id(body_owners.get("projectId"), field="projectId")
        row_id = core.validate_owner_id(body_owners.get("rowId"), field="rowId")

        job_id = uuid.uuid4().hex
        now = time.time()
        job = core.new_job(job_id, member, stage, audio_hash, language, cache_key, duration, now)
        core.apply_owner_fields(job, project_id, row_id)
        if hold:
            job["hold"] = True
        # 1.5.2 — this member's own lane (an old client sends none: its editor lane).
        lane = core.parse_gpu_lane(body_owners.get("gpuLane"))
        job["gpuLane"] = lane

        async def attach_if_held() -> bool:
            """Hand this job to a held container of the same member and lane.
            1.5.2 — the record (handedOff, the holder's call) is complete
            BEFORE the hand-off key lets the worker see it, so no later write
            here can overwrite the worker's own; a failed claim rolls back."""
            if not hold_job_id:
                return False
            holder = await jobs.get.aio(hold_job_id)
            if holder is None or not core.can_hold_for(holder, member, lane):
                return False
            holder_call = await jobs.get.aio(f"call:{hold_job_id}")
            await jobs.put.aio(job_id, dict(job, handedOff=True))
            if holder_call:
                await jobs.put.aio(f"call:{job_id}", holder_call)
            if await core.claim_handoff_key(jobs.get.aio, jobs.put.aio, hold_job_id, job_id):
                job["handedOff"] = True
                return True
            await jobs.put.aio(job_id, job)
            if holder_call:
                await jobs.pop.aio(f"call:{job_id}", None)
            return False

        if os.path.isfile(core.result_path(CACHE_ROOT, stage, cache_key)):
            # Result-cache hit: no GPU, no charge — metered at zero seconds
            # so the billing report shows the hit rather than hiding it.
            job.update(status="done", cached=True, startedAt=now, finishedAt=now, workerSec=0.0)
            await jobs.put.aio(job_id, job)
            await attach_if_held()
            await index_owner(job)
            async with vol_lock:
                await touch_audio(audio_hash)
                _write_meter(core.meter_line(job, "cache-hit", 0.0, now))
                await cache_vol.commit.aio()
            return await view_job(job)

        # Wave 3 U4 — a retry of a request whose job is still queued/running
        # (the client lost a poll, not the job) re-attaches to that job. 1.5.2:
        # only a job that can still finish, and without rewriting its record
        # (its worker owns it) — the new owner is indexed instead.
        inflight = core.inflight_key(member, cache_key)
        existing_id = await jobs.get.aio(inflight)
        existing = await jobs.get.aio(existing_id) if existing_id else None
        if core.reusable_inflight(existing, member):
            existing = await settle_if_dead(existing)
        if core.reusable_inflight(existing, member):
            await index_owner(core.apply_owner_fields(dict(existing), project_id, row_id))
            return await view_job(existing)

        if meta is None:
            raise GatewayError(409, "audio-missing", "upload the audio for this hash before submitting")
        # 1.5.2 — the member's rolling-hour GPU budget, refused before any
        # record exists (no record, no zombie).
        core.check_member_quota(await jobs.get.aio(core.usage_key(member)), now)

        if chunks is not None:
            job["chunks"] = chunks
        await jobs.put.aio(job_id, job)
        await jobs.put.aio(inflight, job_id)
        await index_owner(job)
        lane_held: str | None = None
        spawned = False
        try:
            if await attach_if_held():
                # The held container runs it: no spawn, no second boot. Its
                # FunctionCall is the holder's, so crash detection still works.
                return await view_job(job)
            # 1.5.1 / 1.5.2 — only THIS member's own call on the lane can make
            # it wait (bounded); other members never do. The workspace ceiling
            # is an abuse guard that refuses at once and never queues.
            own_key = core.lane_key(member, lane)
            waited_from = time.time()
            while True:
                if await jobs.get.aio(core.cancelled_key(job_id)) is not None:
                    # Cancelled during the wait: nothing spawns, nothing bills.
                    return await view_job(await owned_job(job_id, member))
                own = await live_lane(own_key)
                decision = core.lane_decision(
                    own_live=len(own), workspace_live=await workspace_live(), waited_sec=time.time() - waited_from,
                )
                if decision == "boot":
                    break
                if decision != "wait":
                    refused = core.lane_refusal(decision, lane)
                    await jobs.put.aio(job_id, core.lane_refused(job, refused, time.time()))
                    raise GatewayError(refused.status, refused.code, refused.detail, refused.retry_after_sec)
                await asyncio.sleep(core.LANE_POLL_SEC)
            job["laneKey"] = own_key
            await jobs.put.aio(job_id, job)
            await jobs.put.aio(own_key, core.lane_with(own, job_id, time.time()))
            lane_held = own_key
            call = await SyncWorker().run.spawn.aio(job_id)
            spawned = True
            # Stored under its own key: the worker rewrites the job record as
            # it runs, and a second put of the whole record here could race it.
            await jobs.put.aio(f"call:{job_id}", call.object_id)
        except GatewayError:
            raise
        except BaseException as exc:
            # 1.5.2 — a submit stopped after its record exists (an exception,
            # the request cancelled) leaves it terminal, never queued, and
            # gives back the lane entry it took. A spawned job is the worker's.
            if not spawned:
                await asyncio.shield(abandon_submit(job, exc, lane_held))
            raise
        async with vol_lock:
            await touch_audio(audio_hash)
            await cache_vol.commit.aio()
        return await view_job(job)

    async def abandon_submit(job: dict[str, Any], exc: BaseException, lane_held: str | None) -> None:
        now = time.time()
        latest = await jobs.get.aio(job["jobId"]) or job
        if latest.get("status") == "queued" and not latest.get("handedOff"):
            await jobs.put.aio(job["jobId"], core.submit_interrupted(job, exc, now))
        if lane_held:
            await jobs.put.aio(lane_held, core.lane_without(await jobs.get.aio(lane_held), job["jobId"], now))

    @web.post("/v1/jobs/{job_id}/release")
    async def release(job_id: str, request: Request) -> dict[str, Any]:
        """Wave 3 U4.5 — nothing to align for this held transcription (the
        client's coverage check failed, the spine is incomplete, or the
        alignment was already cached): let its container exit now."""
        member = member_of(request)
        job = await owned_job(job_id, member)
        released = await jobs.put.aio(core.handoff_key(job_id), core.HANDOFF_RELEASE, skip_if_exists=True)
        return {"jobId": job["jobId"], "released": bool(released)}

    @web.get("/v1/jobs/{job_id}")
    async def status(job_id: str, request: Request) -> dict[str, Any]:
        member = member_of(request)
        job = await owned_job(job_id, member)
        # 1.5.2 — a job no worker will finish is settled typed (never polled forever).
        job = await settle_if_dead(job)
        out = await view_job(job)
        if job["status"] == "done":
            await reload()
            result = _read_json(core.result_path(CACHE_ROOT, job["stage"], job["cacheKey"]))
            if result is None:
                raise GatewayError(410, "result-expired", "the cached result is gone; resubmit")
            out["result"] = result
        return out

    @web.delete("/v1/jobs/{job_id}")
    async def cancel(job_id: str, request: Request) -> dict[str, Any]:
        member = member_of(request)
        job = await owned_job(job_id, member)
        if job["status"] in core.TERMINAL_STATUSES:
            # P11: kill = RELEASE the GPU. The finished record + billing +
            # result stay so reattach/history still work.
            await jobs.put.aio(core.handoff_key(job_id), core.HANDOFF_RELEASE, skip_if_exists=True)
            return await view_job(job)
        # Wave 3 U5 — one atomic claim decides "started?" (see core.start_key).
        # Un-started work is never charged. A started job is charged from the
        # second its billing began — container boot for a container's first
        # job, exactly as a finished job would be (operator U5 ruling).
        key = core.start_key(job_id)
        won = await jobs.put.aio(key, core.CANCELLED_BEFORE_START, skip_if_exists=True)
        claim = core.CANCELLED_BEFORE_START if won else await jobs.get.aio(key)
        now = time.time()
        started, spent = core.cancel_charge(claim, now)
        call_id = await jobs.get.aio(f"call:{job_id}")
        # A handed-off job that never started must not kill its holder: the
        # holder finds the lost claim, meters its held seconds, and exits.
        if call_id and (started or not job.get("handedOff")):
            await modal.FunctionCall.from_id(call_id).cancel.aio()
        job.update(
            status="cancelled",
            finishedAt=now,
            startedAt=float(claim) if started else None,
            workerSec=round(spent, 3),
        )
        await jobs.put.aio(core.cancelled_key(job_id), job)
        await jobs.put.aio(job_id, job)
        line = core.meter_line(job, "cancelled", spent, now)
        async with vol_lock:
            _write_meter(line)
            await cache_vol.commit.aio()
        await note_usage(line)
        return await view_job(job)

    @web.get("/v1/jobs")
    async def list_jobs(request: Request) -> dict[str, Any]:
        """Jobs for this member matching projectId and/or rowId. Pure GET."""
        member = member_of(request)
        project_id = core.validate_owner_id(request.query_params.get("projectId"), field="projectId")
        row_id = core.validate_owner_id(request.query_params.get("rowId"), field="rowId")
        ids: list[str] = []
        if not project_id and not row_id:
            ids.extend(await jobs.get.aio(core.member_index_key(member)) or [])
        if project_id:
            ids.extend(await jobs.get.aio(core.owner_index_key(member, "project", project_id)) or [])
        if row_id:
            ids.extend(await jobs.get.aio(core.owner_index_key(member, "row", row_id)) or [])
        seen: set[str] = set()
        out: list[dict[str, Any]] = []
        for jid in ids:
            if not isinstance(jid, str) or jid in seen:
                continue
            seen.add(jid)
            job = await jobs.get.aio(jid)
            if job is None or job.get("member") != member:
                continue
            cancelled = await jobs.get.aio(core.cancelled_key(jid))
            listed = cancelled if cancelled is not None else await settle_if_dead(job)
            out.append(await view_job(listed))
        return {"jobs": out}

    @web.post("/v1/jobs/{job_id}/pause")
    async def pause_job(job_id: str, request: Request) -> dict[str, Any]:
        member = member_of(request)
        job = await owned_job(job_id, member)
        try:
            body = await request.json()
        except ValueError:
            raise GatewayError(400, "bad-json", "request body must be JSON")
        updated = core.attach_pause(job, body if isinstance(body, dict) else {})
        await jobs.put.aio(job_id, updated)
        return await view_job(updated)

    @web.post("/v1/jobs/{job_id}/answer")
    async def answer_job(job_id: str, request: Request) -> dict[str, Any]:
        member = member_of(request)
        job = await owned_job(job_id, member)
        try:
            body = await request.json()
        except ValueError:
            raise GatewayError(400, "bad-json", "request body must be JSON")
        pause_id = body.get("id") if isinstance(body, dict) else None
        choice = body.get("answer") if isinstance(body, dict) else None
        if not isinstance(pause_id, str) or not isinstance(choice, str):
            raise GatewayError(400, "bad-answer", "id and answer are required strings")
        updated = core.answer_pause(job, pause_id, choice)
        await jobs.put.aio(job_id, updated)
        return await view_job(updated)

    return web


# ---------------------------------------------------------------------------
# Retention and operations.
# ---------------------------------------------------------------------------


@app.function(image=gateway_image, volumes={CACHE_ROOT: cache_vol}, schedule=modal.Period(days=1), timeout=600)
def purge_expired() -> dict[str, int]:
    """Operator D4: audio 7 days after last use, results 30 days after creation."""
    cache_vol.reload()
    now = time.time()
    removed = {"audio": 0, "results": 0}
    audio_dir = Path(CACHE_ROOT) / "audio"
    if audio_dir.is_dir():
        for meta_path in audio_dir.glob("*.json"):
            meta = _read_json(str(meta_path)) or {}
            if core.audio_expired(float(meta.get("lastUsedAt", 0)), now):
                meta_path.with_suffix(".opus").unlink(missing_ok=True)
                meta_path.unlink(missing_ok=True)
                removed["audio"] += 1
    results_dir = Path(CACHE_ROOT) / "results"
    if results_dir.is_dir():
        for result_file in results_dir.glob("*/*.json"):
            if core.result_expired(result_file.stat().st_mtime, now):
                result_file.unlink(missing_ok=True)
                removed["results"] += 1
    cache_vol.commit()
    # 1.5.2 — the job Dict too: finished jobs past retention, their aux keys
    # and inflight pointers; owner indexes keep only jobs that still exist.
    items = dict(jobs.items())
    gone = set(core.expired_job_keys(items, now))
    for key in gone:
        jobs.pop(key, None)
    for key, value in items.items():
        if key.startswith("owner:") and isinstance(value, list) and any(v in gone for v in value):
            jobs.put(key, [v for v in value if v not in gone])
    removed["jobKeys"] = len(gone)
    return removed


@app.function(image=gateway_image, volumes={CACHE_ROOT: cache_vol}, timeout=120)
def meter_lines(since_ts: float = 0.0) -> list[dict[str, Any]]:
    """Every meter line at or after `since_ts` — the billing report's input."""
    cache_vol.reload()
    lines: list[dict[str, Any]] = []
    for path in sorted((Path(CACHE_ROOT) / "meter").glob("*/*.json")):
        line = _read_json(str(path))
        if line and line.get("ts", 0) >= since_ts:
            lines.append(line)
    return sorted(lines, key=lambda line: line["ts"])


@app.function(image=gateway_image, timeout=120)
def hit_lines(since_ts: float = 0.0) -> list[dict[str, Any]]:
    """Every lookup hit at or after `since_ts` (billing reconciliation)."""
    return sorted((v for _, v in hits.items() if v.get("ts", 0) >= since_ts), key=lambda v: v["ts"])


@app.function(image=gateway_image, volumes={WHISPER_ROOT: whisper_vol}, timeout=30 * 60, cpu=2, memory=4096)
def seed_whisper_pinned() -> dict[str, Any]:
    from huggingface_hub import snapshot_download

    t0 = time.perf_counter()
    snapshot_download(core.WHISPER_MODEL, revision=core.WHISPER_REVISION, local_dir=WHISPER_DIR)
    whisper_vol.commit()
    return {
        "dir": WHISPER_DIR,
        "files": {p.name: p.stat().st_size for p in Path(WHISPER_DIR).iterdir() if p.is_file()},
        "elapsedSec": round(time.perf_counter() - t0, 3),
    }
