"""Tests for cloud/sync_core.py — run with `python -m pytest cloud/test_sync_core.py`."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

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


FIXTURES = Path(__file__).resolve().parent.parent / "scripts" / "fixtures"
DIGESTS = core.pack_digests(FIXTURES)
REV_EN = core.pack_revision("en", DIGESTS)


def test_two_cache_stages_are_independent():
    t_en = core.transcript_cache_key(AUDIO, "en")
    t_auto = core.transcript_cache_key(AUDIO, "auto")
    a1 = core.alignment_cache_key(AUDIO, "1" * 64, "en", REV_EN)
    a2 = core.alignment_cache_key(AUDIO, "2" * 64, "en", REV_EN)
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


# ---------------------------------------------------------------------------
# Wave 3 U3 — pack revision in the alignment key; lookup contract.
# ---------------------------------------------------------------------------


def test_every_pack_has_a_distinct_digest_from_the_real_fixtures():
    assert set(DIGESTS) == set(core.FA_LANGS)
    assert all(core.HEX64.match(d) for d in DIGESTS.values())
    assert len(set(DIGESTS.values())) == len(core.FA_LANGS)
    assert core.FA_REVISION in REV_EN and DIGESTS["en"] in REV_EN


def test_pack_file_edit_misses_alignment_but_not_transcript(tmp_path):
    for f in FIXTURES.glob("fa-vocab-*.json"):
        shutil.copy(f, tmp_path / f.name)
    for f in FIXTURES.glob("fa-cardinal-*.json"):
        shutil.copy(f, tmp_path / f.name)
    assert core.pack_digests(tmp_path) == DIGESTS
    before_t = core.transcript_cache_key(AUDIO, "en")
    before_a = core.alignment_cache_key(AUDIO, "1" * 64, "en", REV_EN)
    card = tmp_path / "fa-cardinal-en.json"
    card.write_text(card.read_text() + " ")
    edited = core.pack_digests(tmp_path)
    assert edited["en"] != DIGESTS["en"]
    assert {k: v for k, v in edited.items() if k != "en"} == {k: v for k, v in DIGESTS.items() if k != "en"}
    assert core.alignment_cache_key(AUDIO, "1" * 64, "en", core.pack_revision("en", edited)) != before_a
    assert core.transcript_cache_key(AUDIO, "en") == before_t


def test_missing_pack_file_refuses_rather_than_guessing(tmp_path):
    with pytest.raises(FileNotFoundError):
        core.pack_digests(tmp_path)


def test_alignment_key_covers_language_and_model_revision(monkeypatch):
    rev_es = core.pack_revision("es", DIGESTS)
    base = core.alignment_cache_key(AUDIO, "1" * 64, "en", REV_EN)
    assert core.alignment_cache_key(AUDIO, "1" * 64, "es", rev_es) != base
    monkeypatch.setattr(core, "FA_REVISION", "0" * 40)
    assert core.alignment_cache_key(AUDIO, "1" * 64, "en", core.pack_revision("en", DIGESTS)) != base


def test_lookup_hit_carries_the_result_and_nothing_else():
    result = {"tokens": [{"startSec": 0.0, "endSec": 0.5, "text": "hi"}]}
    assert core.lookup_reply(result, 12.0) == {"cached": True, "result": result}


def test_lookup_miss_says_whether_audio_must_be_sent():
    assert core.lookup_reply(None, 1421.3) == {"cached": False, "audioPresent": True, "audioDurationSec": 1421.3}
    assert core.lookup_reply(None, None) == {"cached": False, "audioPresent": False, "audioDurationSec": None}


def test_inflight_dedup_only_reuses_this_members_live_job():
    key = core.inflight_key("operator", "k" * 64)
    assert key != core.inflight_key("other", "k" * 64)
    job = core.new_job("j1", "operator", "align", AUDIO, "en", "k" * 64, 10.0, 1.0)
    assert core.reusable_inflight(job, "operator")
    assert not core.reusable_inflight(job, "other")
    for terminal in core.TERMINAL_STATUSES:
        assert not core.reusable_inflight(dict(job, status=terminal), "operator")
    assert core.reusable_inflight(dict(job, status="running"), "operator")
    assert not core.reusable_inflight(None, "operator")


def test_hit_line_is_not_a_meter_line_and_carries_no_text():
    line = core.hit_line("operator", "align", AUDIO, "en", 7.0)
    assert set(line) == {"ts", "member", "stage", "audioHash", "language"}
    assert "workerSec" not in line and "estimatedUsd" not in line


# ---------------------------------------------------------------------------
# Wave 3 U4.5 — held transcription, one-boot hand-off.
# ---------------------------------------------------------------------------


def test_handoff_target_only_names_a_real_job():
    assert core.handoff_target("abc123") == "abc123"
    for not_a_job in (core.HANDOFF_RELEASE, core.HANDOFF_CLOSED, None, 5, ""):
        assert core.handoff_target(not_a_job) is None
    assert core.handoff_key("j1") == "handoff:j1"


def test_only_this_members_held_transcription_can_take_an_alignment():
    held = dict(core.new_job("t1", "operator", "transcribe", AUDIO, "en", "k" * 64, 20.0, 1.0), hold=True)
    assert core.can_hold_for(held, "operator")
    assert core.can_hold_for(dict(held, status="done"), "operator")
    assert not core.can_hold_for(held, "someone-else")
    assert not core.can_hold_for(dict(held, hold=False), "operator")
    assert not core.can_hold_for(dict(held, stage="align"), "operator")
    for dead in ("failed", "cancelled"):
        assert not core.can_hold_for(dict(held, status=dead), "operator")
    assert not core.can_hold_for(None, "operator")


def test_hold_is_bounded_and_short():
    # Held for the client's planning seconds, never for files to arrive.
    assert 0 < core.HOLD_FOR_PLAN_SEC <= 60


def test_public_job_reports_the_container_and_handoff():
    job = core.new_job("j1", "operator", "align", AUDIO, "en", "k" * 64, None, 5.0)
    out = core.public_job(dict(job, taskId="ta-123", handedOff=True))
    assert out["taskId"] == "ta-123" and out["handedOff"] is True
    assert core.public_job(job)["taskId"] is None


# Wave 3 U5 — cancel honesty.


class _PutIfAbsent(dict):
    """Modal Dict's `put(..., skip_if_exists=True)` semantics, in memory."""

    def put(self, key, value, skip_if_exists=False):
        if skip_if_exists and key in self:
            return False
        self[key] = value
        return True


def test_cancel_before_start_is_free_and_blocks_the_start():
    d = _PutIfAbsent()
    key = core.start_key("j1")
    assert d.put(key, core.CANCELLED_BEFORE_START, skip_if_exists=True)  # DELETE wins
    assert not d.put(key, 100.0, skip_if_exists=True)  # the worker then refuses to run
    assert core.cancel_charge(d[key], 130.0) == (False, 0.0)


def test_cancel_mid_run_bills_from_the_workers_billing_start():
    d = _PutIfAbsent()
    key = core.start_key("j1")
    assert d.put(key, 100.0, skip_if_exists=True)  # worker wins (100 = container boot)
    assert not d.put(key, core.CANCELLED_BEFORE_START, skip_if_exists=True)
    started, sec = core.cancel_charge(d[key], 112.5)
    assert started and sec == pytest.approx(12.5)
    # Clock skew never produces a negative charge.
    assert core.cancel_charge(200.0, 150.0) == (True, 0.0)
    # Only a number is a start; anything else is "never started".
    for not_a_start in (None, True, "100", core.CANCELLED_BEFORE_START):
        assert core.cancel_charge(not_a_start, 150.0) == (False, 0.0)


def test_cancel_keys_are_per_job():
    assert core.start_key("j1") == "start:j1"
    assert core.cancelled_key("j1") == "cancelled:j1"
    assert core.start_key("j1") != core.start_key("j2")


def test_boot_residue_is_metered_under_its_own_outcome():
    line = core.boot_residue_line("ta-9", 100.0, 118.0)
    assert line["outcome"] == "boot-unused" and line["stage"] == "container"
    assert line["jobId"] == "boot-ta-9"
    assert line["workerSec"] == pytest.approx(18.0)
    assert line["estimatedUsd"] == pytest.approx(18.0 * core.USD_PER_WORKER_SEC, abs=1e-6)
    assert line["member"] is None and line["audioHash"] is None  # no job, no member, no audio
    assert core.boot_residue_line(None, 100.0, 90.0)["workerSec"] == 0.0


def test_public_job_prices_its_seconds():
    job = core.new_job("j1", "operator", "transcribe", AUDIO, "en", "k" * 64, None, 5.0)
    assert core.public_job(job)["estimatedUsd"] is None
    out = core.public_job(dict(job, status="cancelled", workerSec=10.0))
    assert out["estimatedUsd"] == pytest.approx(10.0 * core.USD_PER_WORKER_SEC, abs=1e-6)


def test_a_warm_container_never_bills_an_earlier_jobs_boot_to_the_next_job():
    # Booted for this job: the job pays from boot, as a finished first job does.
    assert core.first_job_billing(100.0, 95.0) == (100.0, 0.0)
    assert core.first_job_billing(100.0, None) == (100.0, 0.0)
    # Booted for an earlier (cancelled) job, then kept warm: this job pays
    # from the moment it existed; the 18 s before it are residue.
    billed_from, residue = core.first_job_billing(100.0, 118.0)
    assert billed_from == 118.0 and residue == pytest.approx(18.0)
