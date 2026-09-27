#!/usr/bin/env python3
"""Live check of Wave 3 U4.5's one-boot sync against the deployed gateway.

    python cloud/smoke_one_boot.py [--member operator]

Three fresh 20 s clips of the V6 corpus (a random window each run, so every
transcription is a genuine cache miss):

1. held session — transcribe with hold, then align naming the held job: the
   alignment must be handed off and run in the SAME container (task id).
2. release — transcribe with hold, then release (what a coverage mismatch or
   an incomplete spine does): the hold ends at once, no alignment runs.
3. closed hold — wait past the hold window, then align naming it: a normal
   spawn (own boot) that still completes — a late plan is never lost.

Spends three cold boots (~$0.01-0.02). Writes cloud/results/one_boot_smoke.json.
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
from smoke_sync_service import CLOUD, FIXTURES, RESULTS, Client, check

OPUS_ARGS = ["-vn", "-map", "0:a:0", "-map_metadata", "-1", "-ar", "16000", "-ac", "1",
             "-c:a", "libopus", "-b:a", "16k", "-vbr", "off", "-compression_level", "4", "-f", "opus"]


def fresh_clip(tmp: Path, tag: str) -> tuple[str, bytes]:
    start = random.uniform(30, 1300)
    wav, opus = tmp / f"{tag}.wav", tmp / f"{tag}.opus"
    subprocess.check_call(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-t", "20",
                           "-i", str(FIXTURES / "v6_16k.wav"), str(wav)])
    subprocess.check_call(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), *OPUS_ARGS, str(opus)])
    return hashlib.sha256(wav.read_bytes()).hexdigest(), opus.read_bytes()


def meter_for(prefix: str, since: float) -> list[dict]:
    lines = modal.Function.from_name("kinetix-sync", "meter_lines").remote(since)
    return [line for line in lines if line["jobId"].startswith(prefix)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--member", default="operator")
    args = parser.parse_args()
    api = Client((CLOUD / ".keys" / f"{args.member}.key").read_text().strip())
    report: dict = {"startedAt": time.time()}
    tmp = Path(tempfile.mkdtemp(prefix="kx-one-boot-"))

    def transcribe_held(tag: str) -> tuple[str, dict]:
        audio_hash, opus = fresh_clip(tmp, tag)
        status, body, _ = api.call("PUT", f"/v1/audio/{audio_hash}", body=opus)
        assert status == 200, body
        status, job, _ = api.call("POST", "/v1/jobs", json_body={"stage": "transcribe", "audioHash": audio_hash, "language": "en", "hold": True})
        assert status == 200 and job["status"] == "queued", job
        job, timing = api.wait(job["jobId"], poll_sec=1.0)
        assert job["status"] == "done", job
        return audio_hash, dict(job, timing=timing)

    def plan_for(transcript: dict) -> list[dict]:
        text = " ".join(t["text"] for t in transcript["result"]["tokens"])
        return [{"startSec": 0.0, "endSec": 19.9, "text": text}]

    # 1 — held session.
    h1, t1 = transcribe_held("held")
    t0 = time.perf_counter()
    status, a1, _ = api.call("POST", "/v1/jobs", json_body={"stage": "align", "audioHash": h1, "language": "en", "chunks": plan_for(t1), "holdJobId": t1["jobId"]})
    check(status == 200 and a1["handedOff"] is True, "align naming a held transcription -> handed off (no spawn)", report)
    a1, a1_timing = api.wait(a1["jobId"], poll_sec=1.0)
    check(a1["status"] == "done" and len(a1["result"]["words"]) > 0, "handed-off alignment -> done with words", report)
    check(a1["taskId"] is not None and a1["taskId"] == t1["taskId"], "transcribe and align ran in the SAME container (one boot)", report)
    report["held"] = {"transcribeTask": t1["taskId"], "alignTask": a1["taskId"], "transcribeWorkerSec": t1["workerSec"],
                      "alignWorkerSec": a1["workerSec"], "alignClientSec": round(time.perf_counter() - t0, 3), "alignTiming": a1_timing}

    # 2 — release.
    h2, t2 = transcribe_held("release")
    status, rel, _ = api.call("POST", f"/v1/jobs/{t2['jobId']}/release")
    check(status == 200 and rel["released"] is True, "release a held transcription", report)
    status, a2, _ = api.call("POST", "/v1/jobs", json_body={"stage": "align", "audioHash": h2, "language": "en", "chunks": plan_for(t2), "holdJobId": t2["jobId"]})
    check(status == 200 and a2["handedOff"] is False, "align after release -> NOT handed to the released container", report)
    api.call("DELETE", f"/v1/jobs/{a2['jobId']}")

    # 3 — closed hold (the staggered-upload physics).
    h3, t3 = transcribe_held("closed")
    time.sleep(core.HOLD_FOR_PLAN_SEC + 8)
    status, a3, _ = api.call("POST", "/v1/jobs", json_body={"stage": "align", "audioHash": h3, "language": "en", "chunks": plan_for(t3), "holdJobId": t3["jobId"]})
    check(status == 200 and a3["handedOff"] is False, "align after the hold expired -> normal spawn", report)
    a3, _ = api.wait(a3["jobId"], poll_sec=1.0)
    check(a3["status"] == "done" and a3["taskId"] != t3["taskId"], "late alignment still completes, in its own container", report)

    time.sleep(3)
    held_lines = {t["jobId"]: meter_for(f"{t['jobId']}-hold", report["startedAt"]) for t in (t1, t2, t3)}
    secs = {k: (v[0]["workerSec"] if v else None) for k, v in held_lines.items()}
    report["heldSec"] = secs
    check(all(v is not None for v in secs.values()), "every hold writes a `held` meter line", report)
    check(secs[t2["jobId"]] is not None and secs[t2["jobId"]] < 5, "a released hold idles < 5 s", report)
    check(secs[t3["jobId"]] is not None and abs(secs[t3["jobId"]] - core.HOLD_FOR_PLAN_SEC) < 3, "an unanswered hold ends at the window", report)

    report["finishedAt"] = time.time()
    out = RESULTS / "one_boot_smoke.json"
    out.write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in ("held", "heldSec")}, indent=2))
    failed = [c["check"] for c in report["checks"] if not c["ok"]]
    if failed:
        raise SystemExit(f"{len(failed)} check(s) failed: {failed}")


if __name__ == "__main__":
    main()
