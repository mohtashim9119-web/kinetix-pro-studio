#!/usr/bin/env python3
"""Live check of Wave 3 U7.5's Bulk Projects flow against the deployed gateway.

    python cloud/smoke_bulk.py [--member operator] [--projects 3]

The bulk modal drives the gateway exactly like this (`src/services/bulkRows.ts`
then `cloudQueueJob.ts`):

1. STAGING WINDOW — every voiceover is PUT to the audio cache the moment it
   lands in a row, with NO job. Checked against the service's own meter: zero
   lines since the window opened, and `/v1/cache/lookup` says the audio is held
   (`audioPresent`) for every project.
2. BATCH — the chain of `smoke_queue.py` (transcribe -> align -> transcribe ->
   align ..., `hold` + `holdJobId`), but with NO audio upload during it: each
   job finds its audio via lookup. One container for the whole batch.
3. The meter's batch view (`sync_core.batch_summaries`, what
   `billing_report.py` prints under BATCHES): projects / jobs / boots=1.

Spends ~1 cold boot (~$0.02). Writes cloud/results/bulk_smoke.json.
"""

from __future__ import annotations

import argparse
import json
import tempfile
import time
from pathlib import Path

import modal

import sync_core as core
from smoke_one_boot import fresh_clip
from smoke_sync_service import CLOUD, RESULTS, Client, check


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--member", default="operator")
    parser.add_argument("--projects", type=int, default=3)
    args = parser.parse_args()
    api = Client((CLOUD / ".keys" / f"{args.member}.key").read_text().strip())
    report: dict = {"startedAt": time.time()}
    tmp = Path(tempfile.mkdtemp(prefix="kx-bulk-"))
    puts: list[str] = []
    real_call = api.call

    def counting_call(method: str, path: str, *a, **k):
        if method == "PUT":
            puts.append(path)
        return real_call(method, path, *a, **k)

    api.call = counting_call  # type: ignore[method-assign]

    def submit(body: dict) -> dict:
        status, job, _ = api.call("POST", "/v1/jobs", json_body=body)
        assert status == 200, job
        return job

    def plan(transcript: dict) -> list[dict]:
        return [{"startSec": 0.0, "endSec": 19.9, "text": " ".join(t["text"] for t in transcript["result"]["tokens"])}]

    # 1 — staging window: audio only, no job.
    hashes: list[str] = []
    for i in range(args.projects):
        audio_hash, opus = fresh_clip(tmp, f"bulk{i}")
        status, body, _ = api.call("PUT", f"/v1/audio/{audio_hash}", body=opus)
        assert status == 200, body
        hashes.append(audio_hash)
    time.sleep(20)  # the meter is written at job end; give any stray line time to land
    window_lines = modal.Function.from_name("kinetix-sync", "meter_lines").remote(report["startedAt"])
    check(len(window_lines) == 0, f"staging window: {args.projects} uploads, ZERO meter lines ({len(window_lines)})", report)
    present = []
    for h in hashes:
        status, look, _ = api.call("POST", "/v1/cache/lookup", json_body={"stage": "transcribe", "audioHash": h, "language": "en"})
        present.append(status == 200 and look.get("cached") is False and look.get("audioPresent") is True)
    check(all(present), "the gateway confirms every pre-staged audio present (lookup: audioPresent)", report)

    # 2 — the batch, no uploads.
    batch_started = time.time()
    puts.clear()
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
    check(len(tasks) == 1 and None not in tasks, f"{2 * len(hashes)} jobs / {len(hashes)} projects ran in ONE container", report)
    check(all(j.get("handedOff") is True for j in chain[1:]), "every job after the first was handed over (no spawn)", report)
    check(len(puts) == 0, "no audio upload during the batch (pre-staged audio: lookup-hit-skip-upload)", report)

    time.sleep(45)
    lines = modal.Function.from_name("kinetix-sync", "meter_lines").remote(batch_started)
    batches = core.batch_summaries(lines)
    report["batches"] = batches
    report["meter"] = lines
    b = (batches or [None])[0]
    check(b is not None and b["boots"] == 1 and b["jobs"] == 2 * len(hashes), f"meter: BATCHES = {len(hashes)} projects / {2 * len(hashes)} jobs / boots=1 ({b})", report)
    report["finishedAt"] = time.time()
    (RESULTS / "bulk_smoke.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"batches": batches}, indent=2))
    failed = [c["check"] for c in report["checks"] if not c["ok"]]
    if failed:
        raise SystemExit(f"{len(failed)} check(s) failed: {failed}")


if __name__ == "__main__":
    main()
