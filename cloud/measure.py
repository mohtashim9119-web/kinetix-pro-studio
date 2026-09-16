#!/usr/bin/env python3
"""Client-side measurement runner for the Modal ASR proof of concept.

Requires `modal token new` first. Deploy with `modal deploy cloud/app.py`,
then run steps:

  python cloud/measure.py seed
  python cloud/measure.py cold-empty
  python cloud/measure.py cold-snapshot
  python cloud/measure.py warm
  python cloud/measure.py gpu-l4
  python cloud/measure.py chunked
  python cloud/measure.py license
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
FIXTURES = ROOT / "fixtures"
RESULTS = ROOT / "results"
RESULTS.mkdir(exist_ok=True)

V6_OPUS = FIXTURES / "v6_16k_cbr16k.opus"
HOUR_OPUS = FIXTURES / "hour_16k_cbr16k.opus"
HOUR_WAV = FIXTURES / "hour_16k.wav"
V6_DURATION = 1421.293438
HOUR_DURATION = 3600.0

# Published Modal on-demand GPU rates (modal.com/pricing, 2026). Used only
# as a fallback label when the dashboard line-item cannot be read. The
# measurements doc must mark dashboard-missing cost as unmeasured.
GPU_RATE_PER_SEC = {"T4": 0.000164, "L4": 0.000222}


def _modal_bin() -> str:
    env = os.environ.get("MODAL_BIN")
    if env:
        return env
    candidate = Path("/tmp/kinetix-cloud-venv/bin/modal")
    if candidate.exists():
        return str(candidate)
    return "modal"


def _python() -> str:
    return sys.executable


def save(name: str, payload: Any) -> Path:
    path = RESULTS / name
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    print(f"wrote {path}")
    return path


def load_bytes(path: Path) -> bytes:
    return path.read_bytes()


def wait_scale_down(seconds: float = 12.0) -> None:
    """scaledown_window=2; wait longer so the next call is a true cold start."""
    print(f"waiting {seconds:.0f}s for scale-down")
    time.sleep(seconds)


def stop_containers(app_name: str | None = None) -> None:
    proc = subprocess.run(
        [_modal_bin(), "container", "list", "--json"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        print("container list failed:", proc.stderr.strip())
        return
    try:
        rows = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError:
        print("container list not JSON; raw:", proc.stdout[:500])
        return
    if isinstance(rows, dict):
        rows = rows.get("containers") or rows.get("items") or []
    for row in rows:
        if app_name and row.get("app_name") != app_name:
            continue
        cid = row.get("container_id") or row.get("id")
        if not cid:
            continue
        subprocess.run(
            [_modal_bin(), "container", "stop", "-y", cid],
            check=False,
            capture_output=True,
            text=True,
        )
    wait_scale_down(8)


def cls_lookup(name: str) -> Any:
    import modal

    return modal.Cls.from_name("kinetix-cloud-asr-poc", name)


def time_call(fn: Any, *args: Any, **kwargs: Any) -> tuple[float, Any]:
    t0 = time.perf_counter()
    result = fn.remote(*args, **kwargs)
    return time.perf_counter() - t0, result


def step_seed() -> None:
    import modal

    fn = modal.Function.from_name("kinetix-cloud-asr-seed", "seed_whisper_weights")
    elapsed, result = time_call(fn)
    save("seed_whisper.json", {"clientSec": elapsed, **result})


def step_cold(kind: str) -> None:
    name = "TranscriberT4Snapshot" if kind == "snapshot" else "TranscriberT4"
    cls = cls_lookup(name)
    runs: list[dict[str, Any]] = []
    # Discarded first ping: image pull / snapshot creation.
    print(f"{name}: discarded first ping (image/snapshot prime)")
    prime_sec, prime = time_call(cls().ping)
    stop_containers("kinetix-cloud-asr-poc")
    for i in range(3):
        print(f"{name}: cold ping {i + 1}/3")
        elapsed, payload = time_call(cls().ping)
        runs.append({"clientSec": round(elapsed, 3), "payload": payload})
        print(f"  clientSec={elapsed:.3f} loadSec={payload.get('loadSec')}")
        stop_containers("kinetix-cloud-asr-poc")
    save(
        f"cold_{kind}.json",
        {
            "className": name,
            "primeSec": round(prime_sec, 3),
            "prime": prime,
            "runs": runs,
        },
    )


def step_warm() -> None:
    cls = cls_lookup("TranscriberT4")
    inst = cls()
    print("warming T4 container with ping")
    ping_sec, ping = time_call(inst.ping)
    v6 = load_bytes(V6_OPUS)
    hour = load_bytes(HOUR_OPUS)
    print("warm transcribe v6")
    v6_sec, v6_out = time_call(inst.transcribe, v6, "en", 0.0, ".opus")
    print("warm transcribe hour")
    hour_sec, hour_out = time_call(inst.transcribe, hour, "en", 0.0, ".opus")
    v6_tokens = v6_out["tokens"]
    hour_tokens = hour_out["tokens"]
    save("cloud_v6_tokens.json", {"tokens": v6_tokens, "metrics": v6_out["metrics"]})
    save(
        "cloud_hour_tokens.json",
        {"tokens": hour_tokens, "metrics": hour_out["metrics"]},
    )
    save(
        "warm_t4.json",
        {
            "pingSec": round(ping_sec, 3),
            "ping": ping,
            "v6": {
                "clientSec": round(v6_sec, 3),
                "processingSec": v6_out["metrics"]["processingSec"],
                "audioDurationSec": V6_DURATION,
                "rtf": V6_DURATION / v6_out["metrics"]["processingSec"],
                "nTokens": v6_out["metrics"]["nTokens"],
                "gpuMemory": v6_out["metrics"]["gpuMemory"],
                "host": v6_out["metrics"]["host"],
            },
            "hour": {
                "clientSec": round(hour_sec, 3),
                "processingSec": hour_out["metrics"]["processingSec"],
                "audioDurationSec": HOUR_DURATION,
                "rtf": HOUR_DURATION / hour_out["metrics"]["processingSec"],
                "nTokens": hour_out["metrics"]["nTokens"],
                "gpuMemory": hour_out["metrics"]["gpuMemory"],
                "host": hour_out["metrics"]["host"],
            },
        },
    )


def step_gpu_l4() -> None:
    cls = cls_lookup("TranscriberL4")
    inst = cls()
    print("warming L4")
    ping_sec, ping = time_call(inst.ping)
    v6 = load_bytes(V6_OPUS)
    print("warm transcribe v6 on L4")
    v6_sec, v6_out = time_call(inst.transcribe, v6, "en", 0.0, ".opus")
    save(
        "warm_l4.json",
        {
            "pingSec": round(ping_sec, 3),
            "ping": ping,
            "v6": {
                "clientSec": round(v6_sec, 3),
                "processingSec": v6_out["metrics"]["processingSec"],
                "audioDurationSec": V6_DURATION,
                "rtf": V6_DURATION / v6_out["metrics"]["processingSec"],
                "nTokens": v6_out["metrics"]["nTokens"],
                "gpuMemory": v6_out["metrics"]["gpuMemory"],
                "host": v6_out["metrics"]["host"],
            },
        },
    )


def split_hour_naive(n: int) -> list[tuple[float, bytes]]:
    """Naive equal splits of the one-hour WAV, re-encoded to Opus.

    Cuts on exact time boundaries with no overlap and no silence snap —
    words on a seam will be sliced. That damage is the measurement.
    """
    chunk_dir = FIXTURES / f"hour_chunks_{n}"
    chunk_dir.mkdir(exist_ok=True)
    length = HOUR_DURATION / n
    out: list[tuple[float, bytes]] = []
    for i in range(n):
        start = i * length
        opus_path = chunk_dir / f"chunk_{i:02d}.opus"
        if not opus_path.exists():
            subprocess.check_call(
                [
                    "ffmpeg",
                    "-y",
                    "-ss",
                    f"{start:.6f}",
                    "-t",
                    f"{length:.6f}",
                    "-i",
                    str(HOUR_WAV),
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    "-c:a",
                    "libopus",
                    "-b:a",
                    "16k",
                    "-vbr",
                    "off",
                    str(opus_path),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        out.append((start, opus_path.read_bytes()))
    return out


def seam_report(tokens: list[dict[str, Any]], n: int) -> dict[str, Any]:
    length = HOUR_DURATION / n
    seams = []
    for i in range(1, n):
        t = i * length
        before = [tok for tok in tokens if tok["endSec"] <= t + 0.05 and tok["endSec"] >= t - 1.0]
        after = [tok for tok in tokens if tok["startSec"] >= t - 0.05 and tok["startSec"] <= t + 1.0]
        last = before[-1] if before else None
        first = after[0] if after else None
        gap = None
        overlap = None
        if last and first:
            gap = first["startSec"] - last["endSec"]
            overlap = last["endSec"] - first["startSec"]
        seams.append(
            {
                "t": t,
                "lastBefore": last,
                "firstAfter": first,
                "gapSec": gap,
                "overlapSec": overlap,
            }
        )
    return {"n": n, "seams": seams}


def step_chunked() -> None:
    cls = cls_lookup("TranscriberT4")
    summary: dict[str, Any] = {}
    for n in (1, 4, 10):
        print(f"chunked n={n}")
        chunks = split_hour_naive(n)
        inst = cls()
        # One ping so at least one container is warm; the rest of a fan-out
        # still cold-starts. That is the honest parallel-wall-clock number.
        if n == 1:
            time_call(inst.ping)
        t0 = time.perf_counter()
        handles = [
            inst.transcribe.spawn(blob, "en", offset, ".opus")
            for offset, blob in chunks
        ]
        parts = [h.get() for h in handles]
        wall = time.perf_counter() - t0
        tokens: list[dict[str, Any]] = []
        for part in parts:
            tokens.extend(part["tokens"])
        tokens.sort(key=lambda tok: (tok["startSec"], tok["endSec"]))
        save(f"chunked_{n}_tokens.json", {"tokens": tokens})
        proc_secs = [p["metrics"]["processingSec"] for p in parts]
        summary[str(n)] = {
            "n": n,
            "wallSec": round(wall, 3),
            "sumProcessingSec": round(sum(proc_secs), 3),
            "maxProcessingSec": round(max(proc_secs), 3),
            "nTokens": len(tokens),
            "seams": seam_report(tokens, n),
            "perChunkProcessingSec": proc_secs,
        }
        print(f"  wall={wall:.3f}s tokens={len(tokens)}")
        stop_containers("kinetix-cloud-asr-poc")
    save("chunked.json", summary)


def step_license() -> None:
    import urllib.request

    url = "https://huggingface.co/api/models/mohtashim9/kinetix-fa-models"
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.load(resp)
    card = data.get("cardData") or {}
    tag = card.get("license") if isinstance(card, dict) else None
    payload = {
        "repo": "mohtashim9/kinetix-fa-models",
        "sha": data.get("sha"),
        "license": tag,
        "cardData": card,
        "ok": (tag or "").strip().lower().replace("_", "-") == "apache-2.0",
        "gate": "stop FA deploy unless ok",
    }
    save("fa_license.json", payload)
    print(json.dumps(payload, indent=2))


def step_fa() -> None:
    import modal

    cls = modal.Cls.from_name("kinetix-cloud-fa-poc", "AlignerT4")
    inst = cls()
    print("FA discarded first ping (image prime)")
    prime_sec, prime = time_call(inst.ping)
    stop_containers("kinetix-cloud-fa-poc")
    runs: list[dict[str, Any]] = []
    for i in range(3):
        print(f"FA cold ping {i + 1}/3")
        elapsed, payload = time_call(cls().ping)
        runs.append({"clientSec": round(elapsed, 3), "payload": payload})
        stop_containers("kinetix-cloud-fa-poc")
    print("FA warm ping + align first 30s of V6")
    inst = cls()
    warm_ping_sec, warm_ping = time_call(inst.ping)
    audio = load_bytes(V6_OPUS)
    chunks = [
        {
            "startSec": 0.0,
            "endSec": 30.0,
            "text": (
                "Level one. The child who does not yet know what dark means, "
                "you are seven years old. You live inside a skin covered house."
            ),
        }
    ]
    align_sec, aligned = time_call(inst.align, audio, chunks, "en", ".opus")
    save(
        "fa_t4.json",
        {
            "primeSec": round(prime_sec, 3),
            "prime": prime,
            "coldRuns": runs,
            "warmPingSec": round(warm_ping_sec, 3),
            "warmPing": warm_ping,
            "alignClientSec": round(align_sec, 3),
            "align": {
                "nWords": aligned.get("metrics", {}).get("nWords"),
                "processingSec": aligned.get("metrics", {}).get("processingSec"),
                "modelLoadSec": aligned.get("metrics", {}).get("modelLoadSec"),
                "gpuMemory": aligned.get("metrics", {}).get("gpuMemory"),
                "wordsHead": (aligned.get("words") or [])[:12],
            },
        },
    )


STEPS = {
    "seed": step_seed,
    "cold-empty": lambda: step_cold("empty"),
    "cold-snapshot": lambda: step_cold("snapshot"),
    "warm": step_warm,
    "gpu-l4": step_gpu_l4,
    "chunked": step_chunked,
    "license": step_license,
    "fa": step_fa,
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("step", choices=[*STEPS, "all"])
    args = parser.parse_args()
    if args.step == "all":
        for name, fn in STEPS.items():
            print(f"===== {name} =====")
            fn()
        return
    STEPS[args.step]()


if __name__ == "__main__":
    main()
