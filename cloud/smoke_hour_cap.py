#!/usr/bin/env python3
"""Live smoke of the one-hour cap on the deployed gateway (Wave 3 U6).

    python cloud/smoke_hour_cap.py [--member operator]

Layer 2 (gateway) against the real HTTP surface, no GPU:

- exactly one hour of 16 kbps Opus (the measured 7,477,405-byte fixture) is
  accepted;
- one byte past the byte cap is refused 413 `too-long` from Content-Length;
- a 3650 s Opus (7.59 MB — under the byte cap, so only the probe can catch
  it) is refused 413 `too-long`;
- none of it spawns a GPU worker or writes a meter line.

Layer 3 (the worker timeout) is read off the live deployment's config, not
provoked: a job is never allowed to run long on purpose.
"""

from __future__ import annotations

import argparse
import hashlib
import subprocess
import tempfile
import time
from pathlib import Path

import modal

import sync_core as core
from smoke_sync_service import GATEWAY, Client, check

CLOUD = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--member", default="operator")
    args = parser.parse_args()
    key = (CLOUD / ".keys" / f"{args.member}.key").read_text().strip()
    api = Client(key)
    report: dict = {"gateway": GATEWAY, "startedAt": time.time()}

    def meter_count() -> int:
        return len(modal.Function.from_name("kinetix-sync", "meter_lines").remote(report["startedAt"]))

    status, ping, _ = api.call("GET", "/v1/ping")
    check(status == 200, "ping", report)
    check(ping["limits"] == {"maxAudioSec": core.MAX_AUDIO_SEC, "maxUploadBytes": core.MAX_UPLOAD_BYTES},
          f"deployed limits = {ping['limits']}", report)

    hour = (CLOUD / "fixtures" / "hour_16k_cbr16k.opus").read_bytes()
    check(len(hour) == core.OPUS_HOUR_BYTES, "fixture is the measured one-hour Opus", report)
    status, body, _ = api.call("PUT", f"/v1/audio/{hashlib.sha256(hour).hexdigest()}", body=hour)
    check(status == 200 and abs(body["durationSec"] - 3600.0) < 0.5, f"exactly 1 h accepted ({body})", report)

    # The gateway answers 413 from Content-Length and stops reading, so urllib
    # (which abandons the response when its write breaks) sees a broken pipe;
    # curl, like the app's hyper client, reads the answer.
    over_bytes = b"\0" * (core.MAX_UPLOAD_BYTES + 1)
    with tempfile.NamedTemporaryFile(suffix=".bin") as fh:
        fh.write(over_bytes)
        fh.flush()
        out = subprocess.run(
            ["curl", "-s", "-w", "\n%{http_code}", "-X", "PUT", "--data-binary", f"@{fh.name}",
             "-H", f"Authorization: Bearer {key}", "-H", "Content-Type: application/octet-stream",
             f"{GATEWAY}/v1/audio/{hashlib.sha256(over_bytes).hexdigest()}"],
            capture_output=True, text=True, check=True,
        ).stdout
    text, _, code = out.rpartition("\n")
    check(code == "413" and '"too-long"' in text, f"one byte past the cap -> 413 too-long ({text[:90]})", report)

    with tempfile.TemporaryDirectory() as tmp:
        long_opus = Path(tmp) / "3650.opus"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anoisesrc=d=3650:c=pink:r=16000",
             "-ar", "16000", "-ac", "1", "-c:a", "libopus", "-b:a", "16k", "-vbr", "off", str(long_opus)],
            check=True,
        )
        blob = long_opus.read_bytes()
    check(len(blob) <= core.MAX_UPLOAD_BYTES, f"3650 s Opus is {len(blob)} bytes, under the byte cap", report)
    status, body, _ = api.call("PUT", f"/v1/audio/{hashlib.sha256(blob).hexdigest()}", body=blob)
    check(status == 413 and body["error"]["code"] == "too-long", f"3650 s (under the byte cap) -> 413 via probe ({body})", report)

    time.sleep(2)
    check(meter_count() == 0, "no worker was spawned and no meter line was written", report)

    print(f"worker timeout configured in code: {core.WORKER_TIMEOUT_SEC}s (deployed by `modal deploy cloud/sync_service.py`)")
    failed = [c["check"] for c in report["checks"] if not c["ok"]]
    if failed:
        raise SystemExit(f"{len(failed)} check(s) failed: {failed}")


if __name__ == "__main__":
    main()
