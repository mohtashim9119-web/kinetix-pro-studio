#!/usr/bin/env python3
"""Live check of Wave 3 U5's cancel honesty against the deployed gateway.

    python cloud/smoke_cancel.py [--member operator]

Fresh clips of the V6 corpus (a random window each run, so every job is a
genuine cache miss):

1. cancel while queued — submit, DELETE at once: the job reads cancelled with
   0 s and no start; its meter line is 0 s. A container Modal had already
   started for it shows up as its own `boot-unused` meter line (container-level
   residue, never charged to the job).
2. cancel mid-run — a 10-minute clip, DELETE a few seconds after `running`:
   the job's seconds include the container boot (as a finished first job's
   would), the meter line matches, and the job STAYS cancelled (no late `done`
   line, no double charge).
3. cancel a handed-off alignment — the held container claims a hand-off
   within 0.25 s, so a DELETE usually finds it already started and bills what
   ran. Whichever way the race goes, the held container meters its `held`
   seconds, and the meter matches what the cancel reply told the app.

Spends two or three cold boots plus a few seconds of transcription (~$0.02).
Writes cloud/results/cancel_smoke.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import subprocess
import tempfile
import time
from pathlib import Path

import modal

import sync_core as core
from smoke_one_boot import OPUS_ARGS
from smoke_sync_service import CLOUD, FIXTURES, RESULTS, Client, check


def clip(tmp: Path, tag: str, seconds: float) -> tuple[str, bytes]:
    start = random.uniform(0, max(1.0, 1400 - seconds))
    wav, opus = tmp / f"{tag}.wav", tmp / f"{tag}.opus"
    subprocess.check_call(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-t", str(seconds),
                           "-i", str(FIXTURES / "v6_16k.wav"), str(wav)])
    subprocess.check_call(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), *OPUS_ARGS, str(opus)])
    return hashlib.sha256(wav.read_bytes()).hexdigest(), opus.read_bytes()


def meter(since: float) -> list[dict]:
    return modal.Function.from_name("kinetix-sync", "meter_lines").remote(since)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--member", default="operator")
    args = parser.parse_args()
    api = Client((CLOUD / ".keys" / f"{args.member}.key").read_text().strip())
    report: dict = {"startedAt": time.time()}
    tmp = Path(tempfile.mkdtemp(prefix="kx-cancel-"))

    def upload(tag: str, seconds: float) -> str:
        audio_hash, opus = clip(tmp, tag, seconds)
        status, body, _ = api.call("PUT", f"/v1/audio/{audio_hash}", body=opus)
        assert status == 200, body
        return audio_hash

    def submit(body: dict) -> dict:
        status, job, _ = api.call("POST", "/v1/jobs", json_body=body)
        assert status == 200, job
        return job

    # 1 — cancel while queued.
    h1 = upload("queued", 20)
    j1 = submit({"stage": "transcribe", "audioHash": h1, "language": "en"})
    status, c1, _ = api.call("DELETE", f"/v1/jobs/{j1['jobId']}")
    check(status == 200 and c1["status"] == "cancelled", "queued cancel -> cancelled", report)
    check(c1["workerSec"] == 0.0 and c1["startedAt"] is None, "queued cancel -> 0 s, never started", report)
    report["queued"] = c1

    # 2 — cancel mid-run.
    h2 = upload("midrun", 600)
    j2 = submit({"stage": "transcribe", "audioHash": h2, "language": "en"})
    t_submit = time.time()
    while True:
        status, view, _ = api.call("GET", f"/v1/jobs/{j2['jobId']}")
        if view["status"] != "queued":
            break
        time.sleep(0.5)
    check(view["status"] == "running", "long clip reaches running", report)
    time.sleep(4)
    status, c2, _ = api.call("DELETE", f"/v1/jobs/{j2['jobId']}")
    t_cancel = time.time()
    check(status == 200 and c2["status"] == "cancelled", "mid-run cancel -> cancelled", report)
    check(c2["startedAt"] is not None and c2["workerSec"] > 4, "mid-run cancel -> billed seconds reported", report)
    check(c2["startedAt"] <= view.get("startedAt", c2["startedAt"]), "billing starts at or before the job's own start (boot included)", report)
    check(c2["workerSec"] <= t_cancel - t_submit + 1, "never billed for more than the job existed", report)
    check(c2["estimatedUsd"] == round(c2["workerSec"] * core.USD_PER_WORKER_SEC, 6), "reply prices the seconds at the rate card", report)
    report["midRun"] = c2

    # 3 — cancel a handed-off alignment before it starts.
    h3 = upload("handoff", 20)
    t3 = submit({"stage": "transcribe", "audioHash": h3, "language": "en", "hold": True})
    t3, _ = api.wait(t3["jobId"], poll_sec=1.0)
    assert t3["status"] == "done", t3
    text = " ".join(t["text"] for t in t3["result"]["tokens"])
    a3 = submit({"stage": "align", "audioHash": h3, "language": "en",
                 "chunks": [{"startSec": 0.0, "endSec": 19.9, "text": text}], "holdJobId": t3["jobId"]})
    status, c3, _ = api.call("DELETE", f"/v1/jobs/{a3['jobId']}")
    check(a3["handedOff"] is True, "alignment handed to the held container", report)
    check(status == 200 and c3["status"] == "cancelled", "handed-off cancel -> cancelled", report)
    report["handoff"] = c3

    # Let containers scale down (exit hooks write boot residue) and the
    # cancelled jobs prove they stay cancelled.
    time.sleep(45)
    for job_id in (j1["jobId"], j2["jobId"], a3["jobId"]):
        status, view, _ = api.call("GET", f"/v1/jobs/{job_id}")
        check(view["status"] == "cancelled", f"{job_id[:8]} still cancelled after 45 s", report)
    lines = meter(report["startedAt"])
    by_job: dict[str, list[dict]] = {}
    for line in lines:
        by_job.setdefault(line["jobId"], []).append(line)
    for job_id, told in ((j1["jobId"], c1), (j2["jobId"], c2), (a3["jobId"], c3)):
        mine = by_job.get(job_id, [])
        check(len(mine) == 1 and mine[0]["outcome"] == "cancelled", f"{job_id[:8]} has exactly one meter line (cancelled)", report)
        if mine:
            check(mine[0]["workerSec"] == told["workerSec"], f"{job_id[:8]} meter = what the app was told ({told['workerSec']} s)", report)
    check(c3["workerSec"] == 0.0 or c3["startedAt"] is not None, "a billed hand-off cancel says it started", report)
    held = by_job.get(f"{t3['jobId']}-hold", [])
    check(len(held) == 1 and held[0]["workerSec"] < core.HOLD_FOR_PLAN_SEC, "held container metered its hold and was not killed early", report)
    residue = [line for line in lines if line["outcome"] == "boot-unused"]
    report["bootResidue"] = residue
    report["meter"] = lines
    report["finishedAt"] = time.time()
    (RESULTS / "cancel_smoke.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in ("queued", "midRun", "handoff", "bootResidue")}, indent=2))
    failed = [c["check"] for c in report["checks"] if not c["ok"]]
    if failed:
        raise SystemExit(f"{len(failed)} check(s) failed: {failed}")


if __name__ == "__main__":
    main()
