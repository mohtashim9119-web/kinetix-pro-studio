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
GPU_SCALEDOWN_WINDOW_SEC = 2

# The gateway is a small CPU container; staying up between a job's polls
# costs fractions of a cent and saves a CPU cold start on every poll.
GATEWAY_SCALEDOWN_WINDOW_SEC = 60

# Third layer of the one-hour cap: a job that runs past this is killed by
# Modal. A warm hour measured 110 s (transcribe) and 66 s (align) on T4.
JOB_TIMEOUT_SEC = 20 * 60

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


# ---------------------------------------------------------------------------
# GPU worker.
# ---------------------------------------------------------------------------


@app.cls(
    image=gpu_image,
    gpu="T4",
    volumes={WHISPER_ROOT: whisper_vol, FA_ROOT: fa_vol, CACHE_ROOT: cache_vol},
    timeout=JOB_TIMEOUT_SEC,
    scaledown_window=GPU_SCALEDOWN_WINDOW_SEC,
    cpu=core.WORKER_CPU_CORES,
    memory=core.WORKER_MEMORY_GIB * 1024,
    retries=0,
)
class SyncWorker:
    @modal.enter()
    def boot(self) -> None:
        self.booted_at = time.time()
        self.first_job = True
        self.whisper = None
        self.fa: dict[str, tuple[Any, Any]] = {}

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
        began = self.booted_at if self.first_job else time.time()
        self.first_job = False
        job = jobs.get(job_id)
        if job is None or job["status"] != "queued":
            return "skipped"
        job["status"] = "running"
        job["startedAt"] = time.time()
        jobs.put(job_id, job)
        try:
            cache_vol.reload()
            result = self._transcribe(job) if job["stage"] == "transcribe" else self._align(job)
            result["createdAt"] = time.time()
            _write_json_atomic(core.result_path(CACHE_ROOT, job["stage"], job["cacheKey"]), result)
            # Committed BEFORE the job flips to done: the gateway serves a
            # done job by reading this file, so it must already be visible.
            cache_vol.commit()
            outcome, error = "done", None
        except Exception as exc:  # noqa: BLE001 — every failure becomes a typed job state
            outcome, error = "failed", {"code": "worker-error", "detail": f"{type(exc).__name__}: {exc}"[:500]}
        now = time.time()
        latest = jobs.get(job_id) or job
        if latest["status"] == "cancelled":
            # DELETE already metered the time this job burned; the result
            # (if any) stays cached so a retry is a cache hit, not a re-bill.
            return "cancelled"
        latest.update(status=outcome, finishedAt=now, workerSec=round(now - began, 3), error=error)
        _write_meter(core.meter_line(latest, outcome, now - began, now))
        cache_vol.commit()
        jobs.put(job_id, latest)
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
        def __init__(self, status: int, code: str, detail: str) -> None:
            self.status, self.code, self.detail = status, code, detail

    STATUS_FOR_CODE = {"too-long": 413, "length-required": 411}

    @web.exception_handler(GatewayError)
    async def _gateway_error(_: Request, exc: GatewayError) -> JSONResponse:
        return JSONResponse({"error": {"code": exc.code, "detail": exc.detail}}, status_code=exc.status)

    @web.exception_handler(core.ValidationError)
    async def _validation_error(_: Request, exc: core.ValidationError) -> JSONResponse:
        status = STATUS_FOR_CODE.get(exc.code, 400)
        return JSONResponse({"error": {"code": exc.code, "detail": exc.detail}}, status_code=status)

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
        return job

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
        chunks: list[dict[str, Any]] | None = None
        if stage == "transcribe":
            cache_key = core.transcript_cache_key(audio_hash, language)
        else:
            chunks = core.canonical_chunks(body.get("chunks"), duration)
            cache_key = core.alignment_cache_key(
                audio_hash, core.chunk_plan_hash(chunks), language, core.pack_revision(language, pack_digests())
            )
        return {
            "stage": stage, "audioHash": audio_hash, "language": language,
            "chunks": chunks, "cacheKey": cache_key, "meta": meta, "duration": duration,
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

        job_id = uuid.uuid4().hex
        now = time.time()
        job = core.new_job(job_id, member, stage, audio_hash, language, cache_key, duration, now)

        if os.path.isfile(core.result_path(CACHE_ROOT, stage, cache_key)):
            # Result-cache hit: no GPU, no charge — metered at zero seconds
            # so the billing report shows the hit rather than hiding it.
            job.update(status="done", cached=True, startedAt=now, finishedAt=now, workerSec=0.0)
            await jobs.put.aio(job_id, job)
            async with vol_lock:
                await touch_audio(audio_hash)
                _write_meter(core.meter_line(job, "cache-hit", 0.0, now))
                await cache_vol.commit.aio()
            return core.public_job(job)

        if meta is None:
            raise GatewayError(409, "audio-missing", "upload the audio for this hash before submitting")

        if chunks is not None:
            job["chunks"] = chunks
        await jobs.put.aio(job_id, job)
        call = await SyncWorker().run.spawn.aio(job_id)
        # Stored under its own key: the worker rewrites the job record as it
        # runs, and a second put of the whole record here could race it.
        await jobs.put.aio(f"call:{job_id}", call.object_id)
        async with vol_lock:
            await touch_audio(audio_hash)
            await cache_vol.commit.aio()
        return core.public_job(job)

    @web.get("/v1/jobs/{job_id}")
    async def status(job_id: str, request: Request) -> dict[str, Any]:
        member = member_of(request)
        job = await owned_job(job_id, member)
        if job["status"] not in core.TERMINAL_STATUSES:
            call_id = await jobs.get.aio(f"call:{job_id}")
            if call_id:
                failure: dict[str, str] | None = None
                try:
                    await modal.FunctionCall.from_id(call_id).get.aio(timeout=0)
                except modal.exception.FunctionTimeoutError:
                    failure = {"code": "worker-timeout", "detail": f"job exceeded {JOB_TIMEOUT_SEC}s"}
                except modal.exception.OutputExpiredError:
                    failure = {"code": "worker-lost", "detail": "worker output expired before it reported"}
                except (TimeoutError, modal.exception.TimeoutError):
                    pass  # still queued or running
                except Exception as exc:  # noqa: BLE001 — container crash, OOM, preemption
                    failure = {"code": "worker-crashed", "detail": f"{type(exc).__name__}: {exc}"[:300]}
                job = await owned_job(job_id, member)
                if failure is not None and job["status"] not in core.TERMINAL_STATUSES:
                    now = time.time()
                    started = job.get("startedAt") or now
                    job.update(status="failed", finishedAt=now, workerSec=round(now - started, 3), error=failure)
                    await jobs.put.aio(job_id, job)
                    async with vol_lock:
                        _write_meter(core.meter_line(job, "failed", now - started, now))
                        await cache_vol.commit.aio()
        out = core.public_job(job)
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
            return core.public_job(job)
        call_id = await jobs.get.aio(f"call:{job_id}")
        if call_id:
            await modal.FunctionCall.from_id(call_id).cancel.aio()
        now = time.time()
        # Un-started work is never charged. A running job's seconds were
        # really spent, and the meter says so (operator U5 clarification).
        started = job.get("startedAt")
        spent = (now - started) if started else 0.0
        job.update(status="cancelled", finishedAt=now, workerSec=round(spent, 3))
        await jobs.put.aio(job_id, job)
        async with vol_lock:
            _write_meter(core.meter_line(job, "cancelled", spent, now))
            await cache_vol.commit.aio()
        return core.public_job(job)

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
