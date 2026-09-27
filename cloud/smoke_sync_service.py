#!/usr/bin/env python3
"""Live smoke of the deployed kinetix-sync gateway (Wave 3 U0).

    python cloud/smoke_sync_service.py [--member operator]

Drives the real HTTP surface the desktop app will use — auth, upload, both
stages, both cache stages, cancel, typed refusals — against the V6 corpus,
then checks the service's output against the measurement harness's own
results (`cloud/results/cloud_v6_tokens.json`, `fa_cloud_v6.json`) to show
the productionised worker did not change engine behaviour. Spends real
GPU-seconds (~$0.03). Writes `cloud/results/sync_service_smoke.json`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

CLOUD = Path(__file__).resolve().parent
FIXTURES = CLOUD / "fixtures"
RESULTS = CLOUD / "results"
GATEWAY = "https://thekingsmanco99--kinetix-sync.modal.run"


class Client:
    def __init__(self, key: str | None) -> None:
        self.key = key

    def call(self, method: str, path: str, body: bytes | None = None, json_body: Any = None) -> tuple[int, Any, dict]:
        headers = {}
        if self.key:
            headers["Authorization"] = f"Bearer {self.key}"
        if json_body is not None:
            body = json.dumps(json_body).encode()
            headers["Content-Type"] = "application/json"
        elif body is not None:
            headers["Content-Type"] = "application/octet-stream"
        req = urllib.request.Request(GATEWAY + path, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                raw = resp.read()
                return resp.status, (json.loads(raw) if raw else None), dict(resp.headers)
        except urllib.error.HTTPError as err:
            raw = err.read()
            try:
                parsed = json.loads(raw) if raw else None
            except ValueError:
                parsed = raw[:200].decode(errors="replace")
            return err.code, parsed, dict(err.headers)

    def wait(self, job_id: str, poll_sec: float = 2.0) -> tuple[dict, dict]:
        t0 = time.perf_counter()
        seen_running_at = None
        while True:
            status, job, _ = self.call("GET", f"/v1/jobs/{job_id}")
            assert status == 200, (status, job)
            if job["status"] == "running" and seen_running_at is None:
                seen_running_at = time.perf_counter() - t0
            if job["status"] in ("done", "failed", "cancelled"):
                return job, {"clientSec": round(time.perf_counter() - t0, 3), "firstSawRunningSec": seen_running_at}
            time.sleep(poll_sec)


def check(cond: bool, label: str, report: dict) -> None:
    report.setdefault("checks", []).append({"check": label, "ok": bool(cond)})
    print(("PASS " if cond else "FAIL ") + label)


def max_abs(a: list[float], b: list[float]) -> float:
    return max((abs(x - y) for x, y in zip(a, b)), default=0.0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--member", default="operator")
    args = parser.parse_args()
    key = (CLOUD / ".keys" / f"{args.member}.key").read_text().strip()
    api, anon = Client(key), Client(None)
    report: dict[str, Any] = {"gateway": GATEWAY, "startedAt": time.time()}

    status, body, _ = anon.call("GET", "/v1/ping")
    check(status == 401 and body["error"]["code"] == "auth", "no key -> 401 auth", report)
    status, body, _ = Client("kx_wrong").call("GET", "/v1/ping")
    check(status == 401, "wrong key -> 401", report)
    status, ping, _ = api.call("GET", "/v1/ping")
    check(status == 200 and ping["member"] == args.member, "ping as member", report)
    report["ping"] = ping

    audio_hash = hashlib.sha256((FIXTURES / "6.m4a").read_bytes()).hexdigest()
    opus = (FIXTURES / "v6_16k_cbr16k.opus").read_bytes()

    status, body, _ = api.call("POST", "/v1/jobs", json_body={"stage": "align", "audioHash": "f" * 64, "language": "en", "chunks": [{"startSec": 0, "endSec": 1, "text": "x"}]})
    check(status == 409 and body["error"]["code"] == "audio-missing", "align on unknown audio -> 409 audio-missing", report)
    status, body, _ = api.call("PUT", f"/v1/audio/{'e' * 64}", body=b"RIFF not really audio")
    check(status == 400 and body["error"]["code"] == "not-opus", "non-Opus upload -> 400 not-opus", report)
    status, body, _ = api.call("POST", "/v1/jobs", json_body={"stage": "align", "audioHash": audio_hash, "language": "auto", "chunks": []})
    check(status == 400 and body["error"]["code"] == "unsupported-language", "align language auto -> 400", report)

    t0 = time.perf_counter()
    status, body, _ = api.call("PUT", f"/v1/audio/{audio_hash}", body=opus)
    check(status == 200 and abs(body["durationSec"] - 1421.3) < 1, "upload V6 Opus", report)
    report["upload"] = {"bytes": len(opus), "clientSec": round(time.perf_counter() - t0, 3), "response": body}
    status, _, headers = api.call("HEAD", f"/v1/audio/{audio_hash}")
    check(status == 200, "HEAD after upload -> 200", report)

    # Stage 1 — transcription.
    status, job, _ = api.call("POST", "/v1/jobs", json_body={"stage": "transcribe", "audioHash": audio_hash, "language": "en"})
    assert status == 200, job
    transcribe_cold = job["status"] != "done"
    job, timing = api.wait(job["jobId"])
    check(job["status"] == "done", "transcribe V6 -> done", report)
    tokens = job["result"]["tokens"]
    poc = json.loads((RESULTS / "cloud_v6_tokens.json").read_text())["tokens"]
    same_text = [t["text"] for t in tokens] == [t["text"] for t in poc]
    report["transcribe"] = {
        "wasCacheMiss": transcribe_cold,
        "timing": timing,
        "workerSec": job["workerSec"],
        "nTokens": len(tokens),
        "pocTokens": len(poc),
        "identicalTextToPoc": same_text,
        "maxStartDeltaVsPocSec": max_abs([t["startSec"] for t in tokens], [t["startSec"] for t in poc]) if same_text else None,
        "provenance": job["result"]["provenance"],
    }
    check(len(tokens) > 3000, "transcript non-trivial", report)

    status, again, _ = api.call("POST", "/v1/jobs", json_body={"stage": "transcribe", "audioHash": audio_hash, "language": "en"})
    check(again["status"] == "done" and again["cached"], "transcribe resubmit -> cache hit, no GPU", report)

    # Stage 2 — alignment, on the frozen production plan the harness used.
    chunks = json.loads((RESULTS / "chunk_plan_v6.json").read_text())
    chunks = chunks["chunks"] if isinstance(chunks, dict) else chunks
    chunks = [{"startSec": c["startSec"], "endSec": c["endSec"], "text": c["text"]} for c in chunks]
    status, job, _ = api.call("POST", "/v1/jobs", json_body={"stage": "align", "audioHash": audio_hash, "language": "en", "chunks": chunks})
    assert status == 200, job
    align_cold = job["status"] != "done"
    job, timing = api.wait(job["jobId"])
    check(job["status"] == "done", "align V6 -> done", report)
    words = job["result"]["words"]
    poc_words = json.loads((RESULTS / "fa_cloud_v6.json").read_text())["words"]
    same_words = [w["word"] for w in words] == [w["word"] for w in poc_words]
    report["align"] = {
        "wasCacheMiss": align_cold,
        "timing": timing,
        "workerSec": job["workerSec"],
        "nChunks": len(chunks),
        "nWords": len(words),
        "pocWords": len(poc_words),
        "identicalWordsToPoc": same_words,
        "maxStartDeltaVsPocSec": max_abs([w["startSec"] for w in words], [w["startSec"] for w in poc_words]) if same_words else None,
        "nFallbackChunks": job["result"]["nFallbackChunks"],
        "provenance": job["result"]["provenance"],
    }
    check([w["wordIndex"] for w in words] == list(range(len(words))), "wordIndex gapless", report)

    status, again, _ = api.call("POST", "/v1/jobs", json_body={"stage": "align", "audioHash": audio_hash, "language": "en", "chunks": chunks})
    check(again["status"] == "done" and again["cached"], "align resubmit -> cache hit, no GPU", report)
    edited = [dict(c) for c in chunks]
    edited[0]["text"] = edited[0]["text"] + " "
    status, miss, _ = api.call("POST", "/v1/jobs", json_body={"stage": "align", "audioHash": audio_hash, "language": "en", "chunks": edited})
    check(miss["status"] == "queued", "script edit -> alignment cache miss (transcript untouched)", report)
    status, cancelled, _ = api.call("DELETE", f"/v1/jobs/{miss['jobId']}")
    check(cancelled["status"] == "cancelled", "cancel queued job -> cancelled", report)
    report["cancel"] = cancelled

    report["finishedAt"] = time.time()
    out = RESULTS / "sync_service_smoke.json"
    out.write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in ("upload", "transcribe", "align", "cancel")}, indent=2))
    print(f"wrote {out}")
    failed = [c["check"] for c in report["checks"] if not c["ok"]]
    if failed:
        raise SystemExit(f"{len(failed)} check(s) failed: {failed}")


if __name__ == "__main__":
    main()
