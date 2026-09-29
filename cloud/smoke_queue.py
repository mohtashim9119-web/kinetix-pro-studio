#!/usr/bin/env python3
"""Live check of Wave 3 U7's bulk queue chain against the deployed gateway.

    python cloud/smoke_queue.py [--member operator]

The bulk queue drives the gateway exactly like this (see
`src/services/cloudQueueJob.ts`): every job of the batch is submitted
`hold`-ing its container and names the previous job's container
(`holdJobId`), so the whole batch rides ONE cold start.

1. chain — three fresh 20 s clips: transcribe -> align -> transcribe -> align
   -> transcribe -> align. Every job after the first must be handed over and
   report the SAME task id; the last holds nothing.
2. cancel mid-queue — the second project's transcription is cancelled after
   its hand-off; the cancel reply (U5's receipt) prices what ran, and the next
   project still completes (on its own container: the chain broke).
3. the meter's batch view (`sync_core.batch_summaries`, what
   `billing_report.py` prints): batch 1 = 3 projects / 6 jobs / 1 boot.

Spends ~2 cold boots (~$0.03). Writes cloud/results/queue_smoke.json.
"""

from __future__ import annotations

import argparse
import json
import time
import tempfile
from pathlib import Path

import modal

import sync_core as core
from smoke_one_boot import fresh_clip
from smoke_sync_service import CLOUD, RESULTS, Client, check


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--member", default="operator")
    args = parser.parse_args()
    api = Client((CLOUD / ".keys" / f"{args.member}.key").read_text().strip())
    report: dict = {"startedAt": time.time()}
    tmp = Path(tempfile.mkdtemp(prefix="kx-queue-"))

    def upload(tag: str) -> str:
        audio_hash, opus = fresh_clip(tmp, tag)
        status, body, _ = api.call("PUT", f"/v1/audio/{audio_hash}", body=opus)
        assert status == 200, body
        return audio_hash

    def submit(body: dict) -> dict:
        status, job, _ = api.call("POST", "/v1/jobs", json_body=body)
        assert status == 200, job
        return job

    def plan(transcript: dict) -> list[dict]:
        return [{"startSec": 0.0, "endSec": 19.9, "text": " ".join(t["text"] for t in transcript["result"]["tokens"])}]

    # 1 — chain of three.
    hashes = [upload(f"chain{i}") for i in range(3)]
    chain: list[dict] = []
    prev: str | None = None
    for i, h in enumerate(hashes):
        last = i == len(hashes) - 1
        t = submit({"stage": "transcribe", "audioHash": h, "language": "en", "hold": True, **({"holdJobId": prev} if prev else {})})
        t, _ = api.wait(t["jobId"], poll_sec=1.0)
        assert t["status"] == "done", t
        a = submit({"stage": "align", "audioHash": h, "language": "en", "chunks": plan(t), "holdJobId": t["jobId"], **({} if last else {"hold": True})})
        a, _ = api.wait(a["jobId"], poll_sec=1.0)
        assert a["status"] == "done", a
        chain += [t, a]
        prev = a["jobId"]
    tasks = {j["taskId"] for j in chain}
    check(len(tasks) == 1 and None not in tasks, f"6 jobs / 3 projects ran in ONE container ({len(tasks)} task id)", report)
    check(all(j.get("handedOff") is True for j in chain[1:]), "every job after the first was handed over (no spawn)", report)
    report["chainTaskIds"] = sorted(t for t in tasks if t)

    # 2 — cancel mid-queue.
    time.sleep(core.HOLD_FOR_PLAN_SEC + 6)  # let batch 1's container scale down: a distinct batch
    h4, h5, h6 = upload("q4"), upload("q5"), upload("q6")
    t4 = submit({"stage": "transcribe", "audioHash": h4, "language": "en", "hold": True})
    t4, _ = api.wait(t4["jobId"], poll_sec=1.0)
    a4 = submit({"stage": "align", "audioHash": h4, "language": "en", "chunks": plan(t4), "holdJobId": t4["jobId"], "hold": True})
    a4, _ = api.wait(a4["jobId"], poll_sec=1.0)
    t5 = submit({"stage": "transcribe", "audioHash": h5, "language": "en", "hold": True, "holdJobId": a4["jobId"]})
    check(t5.get("handedOff") is True, "project 2 handed project 1's container", report)
    time.sleep(3)  # let it start on the GPU
    status, cancelled, _ = api.call("DELETE", f"/v1/jobs/{t5['jobId']}")
    check(status == 200 and cancelled["status"] == "cancelled", "cancel project 2 mid-queue -> cancelled", report)
    report["cancelReceipt"] = {k: cancelled.get(k) for k in ("status", "startedAt", "workerSec", "estimatedUsd")}
    t6 = submit({"stage": "transcribe", "audioHash": h6, "language": "en"})
    t6, _ = api.wait(t6["jobId"], poll_sec=1.0)
    check(t6["status"] == "done", "the queue continues: project 3 completes after the cancel", report)

    time.sleep(45)
    lines = modal.Function.from_name("kinetix-sync", "meter_lines").remote(report["startedAt"])
    batches = core.batch_summaries(lines)
    report["batches"] = batches
    report["meter"] = lines
    # Batch 1 = the lines of the chain's container (the gap to batch 2 can be
    # under the report's grouping window, which would merge them in the view).
    chain_lines = [line for line in lines if line.get("taskId") in report["chainTaskIds"]]
    b1 = (core.batch_summaries(chain_lines) or [None])[0]
    check(b1 is not None and b1["boots"] == 1 and b1["jobs"] == 6, f"meter: batch 1 = 3 projects / 6 jobs / 1 boot ({b1})", report)
    report["finishedAt"] = time.time()
    (RESULTS / "queue_smoke.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in ("chainTaskIds", "cancelReceipt", "batches")}, indent=2))
    failed = [c["check"] for c in report["checks"] if not c["ok"]]
    if failed:
        raise SystemExit(f"{len(failed)} check(s) failed: {failed}")


if __name__ == "__main__":
    main()
