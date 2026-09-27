"""Tests for cloud/sync_core.py — run with `python -m pytest cloud/test_sync_core.py`."""

from __future__ import annotations

import json

import pytest

import sync_core as core

KEY = "kx_test-key-not-a-real-credential"
DIGEST = core.sha256_hex(KEY)
AUDIO = "a" * 64


def test_registry_holds_digests_not_keys():
    reg = core.parse_key_registry(json.dumps({DIGEST: "operator"}))
    assert reg == {DIGEST: "operator"}
    with pytest.raises(ValueError):
        core.parse_key_registry(json.dumps({KEY: "operator"}))
    assert core.parse_key_registry(None) == {}


def test_authenticate():
    reg = {DIGEST: "operator"}
    assert core.authenticate(f"Bearer {KEY}", reg) == "operator"
    assert core.authenticate(f"bearer   {KEY}", reg) == "operator"
    assert core.authenticate(f"Bearer {KEY}x", reg) is None
    assert core.authenticate(f"Basic {KEY}", reg) is None
    assert core.authenticate(None, reg) is None
    assert core.authenticate("Bearer ", reg) is None
    # The digest itself is not a credential.
    assert core.authenticate(f"Bearer {DIGEST}", reg) is None


def test_upload_size_cap_is_the_measured_opus_hour():
    core.validate_upload_size(core.OPUS_HOUR_BYTES)
    core.validate_upload_size(core.MAX_UPLOAD_BYTES)
    with pytest.raises(core.ValidationError) as e:
        core.validate_upload_size(core.MAX_UPLOAD_BYTES + 1)
    assert e.value.code == "too-long"
    for bad in (None, 0):
        with pytest.raises(core.ValidationError):
            core.validate_upload_size(bad)


def test_probe_duration_cap():
    assert core.validate_probe("opus", 3600.0065) == 3600.0065
    with pytest.raises(core.ValidationError) as e:
        core.validate_probe("opus", 3601.5)
    assert e.value.code == "too-long"
    with pytest.raises(core.ValidationError) as e:
        core.validate_probe("aac", 10.0)
    assert e.value.code == "not-opus"
    with pytest.raises(core.ValidationError):
        core.validate_probe("opus", float("nan"))


def test_language_sets():
    assert core.validate_language("transcribe", "auto") == "auto"
    assert core.validate_language("align", "pt") == "pt"
    with pytest.raises(core.ValidationError):
        core.validate_language("align", "auto")
    with pytest.raises(core.ValidationError):
        core.validate_language("transcribe", "ja")


def test_chunk_plan_hash_is_stable_and_order_sensitive():
    a = core.canonical_chunks([{"text": "hi", "endSec": 2, "startSec": 0}], 10.0)
    b = core.canonical_chunks([{"startSec": 0.0, "endSec": 2.0, "text": "hi"}], 10.0)
    assert core.chunk_plan_hash(a) == core.chunk_plan_hash(b)
    two = [{"startSec": 0, "endSec": 1, "text": "a"}, {"startSec": 1, "endSec": 2, "text": "b"}]
    swapped = [dict(two[0], text="b"), dict(two[1], text="a")]
    assert core.chunk_plan_hash(core.canonical_chunks(two, 5)) != core.chunk_plan_hash(
        core.canonical_chunks(swapped, 5)
    )


@pytest.mark.parametrize(
    "chunks",
    [
        [],
        "nope",
        [{"startSec": 2, "endSec": 1, "text": "x"}],
        [{"startSec": 0, "endSec": 99, "text": "x"}],
        [{"startSec": 0, "endSec": 1, "text": 5}],
        [{"startSec": True, "endSec": 1, "text": "x"}],
    ],
)
def test_bad_chunks_are_typed_refusals(chunks):
    with pytest.raises(core.ValidationError) as e:
        core.canonical_chunks(chunks, 10.0)
    assert e.value.code == "bad-chunks"


def test_two_cache_stages_are_independent():
    t_en = core.transcript_cache_key(AUDIO, "en")
    t_auto = core.transcript_cache_key(AUDIO, "auto")
    a1 = core.alignment_cache_key(AUDIO, "1" * 64, "en")
    a2 = core.alignment_cache_key(AUDIO, "2" * 64, "en")
    # A script fix changes only the alignment key: the transcript stays cached.
    assert len({t_en, t_auto, a1, a2}) == 4
    assert core.transcript_cache_key(AUDIO, "en") == t_en


def test_engine_revision_is_in_the_key(monkeypatch):
    before = core.transcript_cache_key(AUDIO, "en")
    monkeypatch.setattr(core, "TRANSCRIBE_ENGINE_REV", core.TRANSCRIBE_ENGINE_REV + "+changed")
    assert core.transcript_cache_key(AUDIO, "en") != before


def test_retention_windows():
    now = 1_000_000_000.0
    assert not core.audio_expired(now - 7 * 86_400 + 1, now)
    assert core.audio_expired(now - 7 * 86_400 - 1, now)
    assert not core.result_expired(now - 30 * 86_400 + 1, now)
    assert core.result_expired(now - 30 * 86_400 - 1, now)


def test_meter_line_carries_no_text_and_prices_seconds():
    job = core.new_job("j1", "operator", "align", AUDIO, "en", "k" * 64, 1421.3, 5.0)
    line = core.meter_line(job, "done", 100.0, 6.0)
    assert set(line) == {
        "ts", "jobId", "member", "stage", "audioHash", "language",
        "audioDurationSec", "outcome", "workerSec", "estimatedUsd",
    }
    assert line["estimatedUsd"] == pytest.approx(100.0 * core.USD_PER_WORKER_SEC, abs=1e-6)
    assert core.meter_line(job, "cancelled", -3.0, 6.0)["workerSec"] == 0.0


def test_public_job_hides_member_and_call_id():
    job = core.new_job("j1", "operator", "transcribe", AUDIO, "en", "k" * 64, None, 5.0)
    job["callId"] = "fc-123"
    out = core.public_job(job)
    assert "member" not in out and "callId" not in out
    assert out["status"] == "queued"


def test_provenance_names_pinned_revisions():
    t = core.transcribe_provenance("en")
    assert t["engine"] == "whisper-cloud" and core.WHISPER_REVISION in t["modelVersion"]
    a = core.align_provenance("es")
    assert a["engine"] == "fa-cloud" and a["model"].endswith("/es") and core.FA_REVISION in a["modelVersion"]
