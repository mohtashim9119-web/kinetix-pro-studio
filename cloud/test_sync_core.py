"""Tests for cloud/sync_core.py — run with `python -m pytest cloud/test_sync_core.py`."""

from __future__ import annotations

import json
import re
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
        "audioDurationSec", "outcome", "taskId", "workerSec", "estimatedUsd", "gpuLane",
        "projectId", "rowId",  # 1.5.2 — owner ids (never text): per-row billing
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
    # U7: a held alignment can hand its container to the next queued job.
    assert core.can_hold_for(dict(held, stage="align"), "operator")
    assert not core.can_hold_for(dict(held, stage="bogus"), "operator")
    # A failed job is never a hold target (queued-forever hazard). Cancelled neither.
    assert not core.can_hold_for(dict(held, status="failed"), "operator")
    assert not core.can_hold_for(dict(held, status="failed", hold=False), "operator")
    assert not core.can_hold_for(dict(held, status="cancelled"), "operator")
    assert not core.can_hold_for(None, "operator")


def test_hold_is_bounded_and_short():
    # P11: the hold window bridges in-flight stage gaps (measured ~1.5s poll +
    # plan), not a 30s dead-man. A last job (hold=false) waits 0.
    assert core.HOLD_FOR_PLAN_SEC == 8.0
    assert core.hold_wait_budget(hold=False) == 0.0
    assert core.hold_wait_budget(hold=True) == 8.0


def test_handoff_gap_inside_window_does_not_second_boot():
    # Measured client gap used to include a 1.5s poll tick (~5s total). That
    # missed a 2s window and paid a second boot. The window must cover it.
    measured_gap_sec = 5.0
    assert measured_gap_sec < core.HOLD_FOR_PLAN_SEC
    # Inside one member's lane a live call (the holder) means wait, not boot.
    assert core.lane_decision(own_live=1, workspace_live=1, waited_sec=0.0) == "wait"


def test_can_hold_for_never_hands_across_lanes():
    held = core.new_job("j1", "operator", "transcribe", AUDIO, "en", "k" * 64, 5.0, 1.0)
    held["hold"] = True
    held["status"] = "done"
    held["gpuLane"] = "bulk"
    assert core.can_hold_for(held, "operator", "bulk")
    assert not core.can_hold_for(held, "operator", "editor")


def test_finished_job_post_finish_held_is_zero_with_wide_window():
    assert core.post_finish_held_sec(hold=True, handed_off=True, released=False, waited_sec=8) == 0.0
    assert core.post_finish_held_sec(hold=True, handed_off=False, released=True, waited_sec=8) == 0.0
    assert core.post_finish_held_sec(hold=False, handed_off=False, released=False, waited_sec=8) == 0.0


def test_orphan_cap_equals_hold_window_never_more():
    assert core.post_finish_held_sec(hold=True, handed_off=False, released=False, waited_sec=30) == core.HOLD_FOR_PLAN_SEC
    assert core.post_finish_held_sec(hold=True, handed_off=False, released=False, waited_sec=core.HOLD_FOR_PLAN_SEC) == core.HOLD_FOR_PLAN_SEC


def test_lane_summaries_never_cross_bill():
    lines = [
        {**_line(1, "done", 10, audio="a" * 64, task="ta-bulk"), "gpuLane": "bulk"},
        {**_line(2, "done", 7, audio="b" * 64, task="ta-edit"), "gpuLane": "editor"},
    ]
    lanes = {row["gpuLane"]: row for row in core.lane_summaries(lines)}
    assert lanes["bulk"]["workerSec"] == 10
    assert lanes["editor"]["workerSec"] == 7
    assert lanes["bulk"]["boots"] == 1 and lanes["editor"]["boots"] == 1


def test_max_align_window_lockstep_with_ts_max_run_sec():
    ts = Path(__file__).resolve().parent.parent / "src" / "services" / "syncConstants.ts"
    m = re.search(r"export const MAX_RUN_SEC = (\d+)", ts.read_text())
    assert m is not None
    assert float(m.group(1)) == core.MAX_ALIGN_WINDOW_SEC


def test_row_summary_splits_boots_hold_and_free_cache():
    lines = [
        _line(1, "done", 10, audio="a" * 64, task="ta-1"),
        _line(2, "held", 3, audio="a" * 64, task="ta-1"),
        _line(3, "cache-hit", 0, audio="b" * 64, task=None),
        _line(4, "boot-unused", 12, audio=None, task="ta-9"),
    ]
    rows = core.row_summaries(lines)
    assert rows[0]["boots"] == 1 and rows[0]["heldSec"] == 3 and rows[0]["free"] is False
    assert rows[1]["cached"] is True and rows[1]["free"] is True and rows[1]["estimatedUsd"] == 0


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


def test_last_stage_with_hold_job_id_claims_holder_held_zero():
    """The last align of the last row (hold=false) still names the live
    transcribe as holdJobId and must attach — not spawn — so held=0."""
    d = _PutIfAbsent()
    holder = dict(
        core.new_job("t-last", "operator", "transcribe", AUDIO, "en", "k" * 64, 10.0, 1.0),
        hold=True, status="done",
    )
    hold, hold_job_id = core.chain_fields({"holdJobId": "t-last", "stage": "align"})
    assert hold is False and hold_job_id == "t-last"
    assert core.claim_handoff(d, holder=holder, member="operator", new_job_id="a-last") is True
    assert d[core.handoff_key("t-last")] == "a-last"
    gap_sec = 0.4
    assert gap_sec < 1.5
    assert core.post_finish_held_sec(hold=True, handed_off=True, released=False, waited_sec=gap_sec) == 0.0
    assert core.hold_wait_budget(hold=False) == 0.0


def test_handoff_overwrites_none_tombstone_so_last_stage_still_attaches():
    d = _PutIfAbsent()
    key = core.handoff_key("t1")
    d[key] = None
    holder = dict(
        core.new_job("t1", "operator", "transcribe", AUDIO, "en", "k" * 64, 10.0, 1.0),
        hold=True, status="done",
    )
    assert core.decide_handoff_put(None, "a1") == "put"
    assert core.decide_handoff_retry(None, "a1") == "overwrite"
    assert core.claim_handoff(d, holder=holder, member="operator", new_job_id="a1") is True
    assert d[key] == "a1"


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


# --- Wave 3 U6: the one-hour cap, gateway + worker layers -----------------


def test_exactly_one_hour_passes_every_gateway_layer():
    core.validate_upload_size(core.OPUS_HOUR_BYTES)
    assert core.validate_probe("opus", core.MAX_AUDIO_SEC) == core.MAX_AUDIO_SEC
    assert core.validate_probe("opus", core.MAX_AUDIO_SEC + core.AUDIO_DURATION_TOLERANCE_SEC)


def test_just_over_one_hour_is_refused_at_both_gateway_layers_with_the_typed_code():
    with pytest.raises(core.ValidationError) as size:
        core.validate_upload_size(core.MAX_UPLOAD_BYTES + 1)
    with pytest.raises(core.ValidationError) as probe:
        core.validate_probe("opus", core.MAX_AUDIO_SEC + core.AUDIO_DURATION_TOLERANCE_SEC + 0.01)
    # The client maps HTTP 413 / `too-long` to FaFailureKind `tooLong`.
    assert size.value.code == probe.value.code == "too-long"


def test_an_honest_hour_inside_the_byte_margin_is_not_refused_by_size():
    # 1% over the nominal hour of bytes: the size rail lets it through, the
    # probe (real duration) is the precise judge.
    core.validate_upload_size(int(core.OPUS_HOUR_BYTES * 1.01))
    assert core.MAX_UPLOAD_BYTES == core.OPUS_HOUR_BYTES + core.OPUS_HOUR_BYTES // 50


def test_worker_timeout_bounds_a_full_hour_job_with_headroom_and_a_cost_ceiling():
    # The slowest honest call: transcribe + its hand-off hold + model load.
    honest = core.WARM_HOUR_TRANSCRIBE_SEC + core.HOLD_FOR_PLAN_SEC + 5
    assert core.WORKER_TIMEOUT_SEC >= 3 * honest
    assert core.WORKER_TIMEOUT_SEC >= 3 * core.WARM_HOUR_ALIGN_SEC
    # ...and no job can bill more than ~13 cents of GPU time.
    assert core.WORKER_TIMEOUT_SEC * core.USD_PER_WORKER_SEC < 0.13
    # The client's wall limit (queue + run) must outlast the worker's.
    rust = (Path(__file__).resolve().parent.parent / "src-tauri/src/cloud_gateway.rs").read_text()
    wall = int(re.search(r"JOB_WALL_LIMIT: Duration = Duration::from_secs\((\d+) \* 60\)", rust).group(1)) * 60
    assert wall > core.WORKER_TIMEOUT_SEC


def test_limits_match_the_client_constants_in_ts():
    ts = (Path(__file__).resolve().parent.parent / "src/services/cloudAudioLimit.ts").read_text()

    def const(name: str) -> int:
        return int(re.search(rf"export const {name} = ([0-9_]+);", ts).group(1).replace("_", ""))

    assert const("OPUS_HOUR_BYTES") == core.OPUS_HOUR_BYTES
    assert const("MAX_AUDIO_SEC") == core.MAX_AUDIO_SEC
    assert const("AUDIO_DURATION_TOLERANCE_SEC") == core.AUDIO_DURATION_TOLERANCE_SEC
    assert "OPUS_HOUR_BYTES + Math.floor(OPUS_HOUR_BYTES / 50)" in ts


# --- Wave 3 U7: a queue rides one container ---------------------------------


def test_chain_budget_stops_holding_well_inside_the_worker_timeout():
    assert core.may_hold(0.0)
    assert core.may_hold(core.CHAIN_BUDGET_SEC - 0.1)
    assert not core.may_hold(core.CHAIN_BUDGET_SEC)
    # The last job admitted just under the budget is a full-hour transcribe
    # (+ its hold): budget + that must still fit in the timeout.
    worst_admitted = core.CHAIN_BUDGET_SEC + core.WARM_HOUR_TRANSCRIBE_SEC + core.HOLD_FOR_PLAN_SEC + 5
    assert worst_admitted < core.WORKER_TIMEOUT_SEC


def _line(ts, outcome, sec, audio="a" * 64, task="ta-1", stage="transcribe"):
    return {"ts": ts, "jobId": f"j{ts}", "stage": stage, "audioHash": audio, "outcome": outcome,
            "workerSec": sec, "taskId": task, "estimatedUsd": 0.0}


def test_batch_summary_shows_one_boot_for_a_chained_queue_and_splits_distant_runs():
    lines = [
        _line(100, "done", 30, audio="a" * 64), _line(101, "held", 2, audio="a" * 64),
        _line(140, "done", 20, audio="a" * 64, stage="align"),
        _line(180, "done", 30, audio="b" * 64), _line(190, "done", 20, audio="b" * 64, stage="align"),
        # An hour later: a separate batch, two containers, one unused boot.
        _line(4000, "done", 30, audio="c" * 64, task="ta-2"),
        _line(4010, "done", 30, audio="d" * 64, task="ta-3"),
        _line(4015, "boot-unused", 12, audio=None, task="ta-4"),
    ]
    first, second = core.batch_summaries(lines)
    assert (first["projects"], first["jobs"], first["boots"], first["heldSec"]) == (2, 4, 1, 2)
    assert first["workerSec"] == 102
    assert first["estimatedUsd"] == pytest.approx(102 * core.USD_PER_WORKER_SEC, abs=1e-6)
    assert (second["projects"], second["boots"], second["bootResidueSec"]) == (2, 3, 12)


# Server-owned jobs: client death is a detach, pause lives on the job.


def test_client_disconnect_does_not_kill_the_job():
    assert core.CLIENT_DISCONNECT_KILLS_JOB is False


def test_kill_client_mid_run_server_job_still_completes():
    """P5 (1): dropping the poller is not a DELETE. The job reaches done."""
    job = core.new_job("j1", "operator", "transcribe", AUDIO, "en", "k" * 64, 10.0, 1.0)
    job["status"] = "running"
    job["taskId"] = "ta-1"
    # Simulate: client process dies. No cancel key is written.
    assert job.get("status") != "cancelled"
    job.update(status="done", finishedAt=20.0, workerSec=8.0)
    assert job["status"] == "done"
    # While it was still running, a relaunch POST reuses it instead of spawning.
    assert core.reusable_inflight(dict(job, status="running"), "operator") is True
    assert core.reusable_inflight(job, "operator") is False


def test_reattach_reuses_one_boot():
    """P5 (2): relaunch polls the same task id — not a second spawn."""
    first = core.new_job("j1", "operator", "transcribe", AUDIO, "en", "k" * 64, 10.0, 1.0)
    first.update(status="running", taskId="ta-1", projectId="proj-a", rowId="row-a")
    core.apply_owner_fields(first, "proj-a", "row-a")
    key = core.owner_index_key("operator", "project", "proj-a")
    assert key == "owner:operator:project:proj-a"
    ids = core.owner_ids_append(None, "j1")
    ids = core.owner_ids_append(ids, "j1")
    assert ids == ["j1"]
    assert first["taskId"] == "ta-1"
    # A second spawn would mint a new task id. Reattach keeps ta-1.
    assert {first["taskId"]} == {"ta-1"}


def test_pause_survives_reload_and_is_answerable():
    """P5 (3): pause is on the job, not the session."""
    job = core.new_job("j1", "operator", "transcribe", AUDIO, "en", "k" * 64, 10.0, 1.0)
    job = core.attach_pause(job, {
        "id": "pause-1",
        "kind": "hopeless-local-coverage",
        "question": "The script and audio do not match.",
        "options": ["retry", "local", "cancel"],
        "projectId": "proj-a",
    })
    assert job["awaitingAnswer"] is True
    assert core.pause_dialog_for_job(job)["id"] == "pause-1"
    # Reload: the in-memory session is gone; the job record still has the ask.
    reloaded = dict(job)
    assert core.pause_dialog_for_job(reloaded)["question"].startswith("The script")
    answered = core.answer_pause(reloaded, "pause-1", "retry")
    assert answered["pause"]["answer"] == "retry"
    assert answered["awaitingAnswer"] is False
    assert core.pause_dialog_for_job(answered) is None


def test_answered_then_succeeded_job_shows_no_dialog():
    """P5 (4): stale-answer class — ghost dialog must not return."""
    job = core.new_job("j1", "operator", "transcribe", AUDIO, "en", "k" * 64, 10.0, 1.0)
    job = core.attach_pause(job, {
        "id": "pause-1",
        "kind": "offline",
        "question": "Could not reach the cloud.",
        "options": ["retry", "cancel"],
    })
    job = core.answer_pause(job, "pause-1", "retry")
    job.update(status="done", workerSec=4.0)
    assert core.pause_dialog_for_job(job) is None


def test_hold_stays_open_when_client_vanishes_until_handoff_or_close():
    job = dict(core.new_job("j1", "operator", "transcribe", AUDIO, "en", "k" * 64, 10.0, 1.0), hold=True, status="done")
    assert core.hold_is_open(job, None) is True
    assert core.hold_is_open(job, core.HANDOFF_CLOSED) is False
    assert core.hold_is_open(job, core.HANDOFF_RELEASE) is False
    assert core.hold_is_open(job, "align-job") is False
    assert core.public_job(job, hold_open=True)["holdOpen"] is True
    assert core.public_job(job)["projectId"] is None


# --- P11: GPU release at finish (no 30s idle hold) -------------------------


def test_p11_finished_job_holds_zero_after_finish():
    # Success + release (or a hand-off to the next job) fixes cost at that
    # instant: nothing is billed as idle after the work itself.
    assert core.post_finish_held_sec(hold=True, handed_off=True, released=False, waited_sec=0.04) == 0.0
    assert core.post_finish_held_sec(hold=True, handed_off=False, released=True, waited_sec=0.01) == 0.0
    assert core.post_finish_held_sec(hold=False, handed_off=False, released=False, waited_sec=30.0) == 0.0
    # An orphaned holder (no queued work, client gone) sits the scaledown
    # floor, never a 30s dead-man.
    assert core.post_finish_held_sec(hold=True, handed_off=False, released=False, waited_sec=30.0) == core.HOLD_FOR_PLAN_SEC


def test_p11_last_row_releases_without_a_timeout_wait():
    assert core.hold_wait_budget(hold=False) == 0.0
    lines = [
        _line(100, "done", 8.0, audio="a" * 64),
        _line(108, "done", 3.0, audio="a" * 64, stage="align"),
    ]
    assert core.held_after_finish(lines, job_id="j108") == 0.0
    batch = core.batch_summaries(lines)[0]
    assert batch["heldSec"] == 0.0


def test_p11_kill_releases_gpu_and_keeps_the_finished_record():
    job = dict(core.new_job("j1", "operator", "transcribe", AUDIO, "en", "k" * 64, 10.0, 1.0),
               status="done", workerSec=4.0, hold=True)
    d = _PutIfAbsent()
    d.put(job["jobId"], job)
    action = core.kill_gpu_keep_record(d, job["jobId"])
    assert action == core.HANDOFF_RELEASE
    assert d[job["jobId"]]["status"] == "done"
    assert d[job["jobId"]]["workerSec"] == 4.0
    assert d[core.handoff_key(job["jobId"])] == core.HANDOFF_RELEASE



# --- 1.5.1 P2: a job the gateway accepted can always run --------------------
#
# Job records 2026-10-04: f16a319b / 53fa8afe / 7b00a719 were written, then
# refused 409 gpu-lane-busy, and sat `queued` with no worker; f8c82e01 was
# handed to a holder (dba20702) whose container had already passed the chain
# budget. Every retry then re-attached to them: "Waiting for a cloud GPU…"
# for 4-16 min until a manual cancel.


def _holder(job_id="t-old", **extra):
    return dict(
        core.new_job(job_id, "operator", "transcribe", AUDIO, "en", "k" * 64, 10.0, 1.0),
        hold=True, status="done", gpuLane="bulk", **extra,
    )


def test_lane_refusal_leaves_no_runnable_record():
    job = core.new_job("j-busy", "operator", "align", AUDIO, "en", "k" * 64, 755.3, 1.0)
    refused = core.lane_refused(job, core.lane_refusal("refuse-lane", "bulk"), 2.0)
    assert refused["status"] == "failed"
    assert refused["error"]["code"] == "gpu-lane-busy"
    assert refused["workerSec"] == 0.0 and refused["finishedAt"] == 2.0
    # Neither re-attach route can adopt it: the gateway's inflight reuse...
    assert not core.reusable_inflight(refused, "operator")
    # ...nor a hand-off naming it.
    assert not core.can_hold_for(dict(refused, hold=True), "operator")
    assert core.public_job(refused)["status"] == "failed"


def test_gateway_records_the_refusal_before_answering_409():
    src = (Path(__file__).parent / "sync_service.py").read_text(encoding="utf-8")
    start = src.index('if decision != "wait":')
    branch = src[start:src.index("raise GatewayError(refused.status", start)]
    assert "core.lane_refused(" in branch


def test_holder_past_the_chain_budget_closes_its_hold_so_no_job_is_orphaned():
    d = _PutIfAbsent()
    holder = _holder()
    waited: list[dict] = []
    # dba20702: its container booted ~02:11:08, the hand-off came at 02:16:49.
    nxt = core.chain_next(d, holder, core.CHAIN_BUDGET_SEC + 34.0, lambda job: waited.append(job))
    assert nxt is None and waited == []  # past the budget: no wait, no idle billing
    assert d[core.handoff_key("t-old")] == core.HANDOFF_CLOSED
    # The client's next job naming it now spawns — it is never attached to a
    # container that will not run it.
    assert core.claim_handoff(d, holder=holder, member="operator", new_job_id="a-new") is False


def test_a_handoff_that_landed_before_the_close_is_run_not_dropped():
    d = _PutIfAbsent()
    d[core.handoff_key("t-old")] = "a-raced"
    assert core.chain_next(d, _holder(), core.CHAIN_BUDGET_SEC + 1.0, lambda job: None) == "a-raced"


def test_close_claims_a_none_tombstone_too():
    d = _PutIfAbsent()
    d[core.handoff_key("t-old")] = None
    assert core.chain_next(d, _holder(), core.CHAIN_BUDGET_SEC + 1.0, lambda job: None) is None
    assert d[core.handoff_key("t-old")] == core.HANDOFF_CLOSED


def test_inside_the_budget_the_holder_waits_for_the_handoff():
    d = _PutIfAbsent()
    assert core.chain_next(d, _holder(), 10.0, lambda job: "a-next") == "a-next"
    assert core.handoff_key("t-old") not in d  # the wait owns the key inside the budget


def test_a_job_that_asked_no_hold_ends_the_chain_untouched():
    d = _PutIfAbsent()
    plain = dict(_holder(), hold=False)
    assert core.chain_next(d, plain, 10.0, lambda job: "never") is None
    assert core.chain_next(d, plain, core.CHAIN_BUDGET_SEC + 1.0, lambda job: "never") is None
    assert d == {}


# --- 1.5.1 P2: a lane counts calls in flight, not containers alive ----------
#
# Live on v18 (2026-10-04 13:06): a bulk job finished (10.2 s) and the next
# bulk job, 3.26 s later, was refused 409 gpu-lane-busy — the finished
# container was idling out its scaledown window, still counted on the lane —
# and left a queued record no worker would take. Every retried row (transcript
# cached: the carried container is released, the align spawns at once) and
# every row after a chain-budget close hit exactly that.


def test_the_wait_covers_a_holders_remaining_hold_and_fits_the_client_timeout():
    # A busy lane frees when its call ends; the longest a call lingers without
    # work is a hold (HOLD_FOR_PLAN_SEC). The wait outlasts it, and the whole
    # submit still answers well inside the client's 60 s request timeout.
    assert core.LANE_WAIT_SEC > core.HOLD_FOR_PLAN_SEC
    rs = (Path(__file__).parent.parent / "src-tauri" / "src" / "cloud_gateway.rs").read_text(encoding="utf-8")
    timeout = int(re.search(r"const REQUEST_TIMEOUT: Duration = Duration::from_secs\((\d+)\)", rs).group(1))
    assert core.LANE_WAIT_SEC + 10 < timeout


def test_the_worker_frees_its_lane_when_the_call_ends():
    src = (Path(__file__).parent / "sync_service.py").read_text(encoding="utf-8")
    run = src[src.index("    def run(self, job_id: str) -> str:"):src.index("    def _hold_for_next(")]
    assert "finally:" in run and "self._release_lane()" in run.split("finally:")[-1]
    assert "laneKey" in run  # it frees exactly the entry the gateway acquired
    # Container exit stays the fallback for a call that never reached its end.
    exit_hook = src[src.index("    def exit_unbilled(self)"):src.index("    def _whisper_model(")]
    assert "self._release_lane()" in exit_hook


# --- 1.5.2 operator ruling: 1 key = 1 member = ISOLATED lanes ---------------
#
# Live on v19 (2026-10-04 13:27): three members submitted at once on the
# editor lane — one booted, two waited 11.4 s and were refused 409; a bulk
# member waited 8.0 s behind another member's bulk job. Lanes were global.

NOW = 1_800_000_000.0


def test_lanes_are_per_member():
    assert core.lane_key("operator", "bulk") != core.lane_key("team-2", "bulk")
    assert core.lane_key("operator", "bulk") != core.lane_key("operator", "editor")
    # An old client (no lane field) lands on ITS OWN member's editor lane.
    assert core.lane_key("team-2", None) == core.lane_key("team-2", "editor")


def test_a_member_never_waits_on_another_member():
    # Another member's live calls are only in the workspace count, which is
    # an abuse ceiling — far above any real load — not a queue.
    for others in (0, 1, 7, core.GPU_WORKSPACE_CEILING - 1):
        assert core.lane_decision(own_live=0, workspace_live=others, waited_sec=0.0) == "boot"


def test_within_a_member_a_lane_stays_serial_then_refuses_typed():
    assert core.lane_decision(own_live=1, workspace_live=1, waited_sec=0.0) == "wait"
    assert core.lane_decision(own_live=1, workspace_live=1, waited_sec=core.LANE_WAIT_SEC - 0.01) == "wait"
    assert core.lane_decision(own_live=1, workspace_live=1, waited_sec=core.LANE_WAIT_SEC) == "refuse-lane"


def test_the_workspace_ceiling_refuses_at_once_and_never_queues():
    assert core.GPU_WORKSPACE_CEILING >= 20
    assert core.lane_decision(own_live=0, workspace_live=core.GPU_WORKSPACE_CEILING, waited_sec=0.0) == "refuse-ceiling"
    assert core.lane_decision(own_live=1, workspace_live=core.GPU_WORKSPACE_CEILING, waited_sec=0.0) == "refuse-ceiling"


def test_lane_entries_name_their_calls_and_self_heal():
    entries = core.lane_with(None, "j1", NOW)
    entries = core.lane_with(entries, "j2", NOW)
    assert set(core.lane_entries(entries, NOW)) == {"j1", "j2"}
    assert set(core.lane_entries(core.lane_without(entries, "j1", NOW), NOW)) == {"j2"}
    assert core.lane_without(None, "missing", NOW) == {}
    # A call cannot outlive its timeout: an entry older than that is a dead
    # call's leftover (hard container death runs no `finally`) and stops counting.
    stale = core.lane_with(None, "dead", NOW - core.LANE_ENTRY_TTL_SEC - 1)
    assert core.lane_entries(stale, NOW) == {}
    assert core.LANE_ENTRY_TTL_SEC > core.WORKER_TIMEOUT_SEC
    assert core.lane_entries({"x": "junk", 5: NOW}, NOW) == {}


def test_member_quota_is_an_abuse_guard_far_above_real_use():
    # team-1's real bulk batch (10-04 02:03-02:35) used ~662 GPU-s in 32 min.
    measured_pace_per_hour = 662.0 * 3600 / (32 * 60)
    assert core.MEMBER_QUOTA_GPU_SEC >= 1.5 * measured_pace_per_hour
    assert core.MEMBER_QUOTA_WINDOW_SEC == 3600.0
    usage = None
    for i in range(10):
        usage = core.usage_with(usage, 100.0, NOW - 60 * i)
    assert core.quota_used(usage, NOW) == 1000.0
    core.check_member_quota(usage, NOW)  # under the cap: no refusal
    old = core.usage_with(None, 9_999.0, NOW - core.MEMBER_QUOTA_WINDOW_SEC - 1)
    assert core.quota_used(old, NOW) == 0.0  # outside the rolling hour


def test_member_quota_refusal_is_typed_with_a_retry_time():
    usage = core.usage_with(None, core.MEMBER_QUOTA_GPU_SEC, NOW - 600)
    with pytest.raises(core.ValidationError) as e:
        core.check_member_quota(usage, NOW)
    assert e.value.code == "member-quota"
    assert e.value.retry_after_sec == pytest.approx(core.MEMBER_QUOTA_WINDOW_SEC - 600, abs=1)
    assert "GPU" in e.value.detail and "hour" in e.value.detail


def test_refusals_are_typed_terminal_and_plain_spoken():
    job = core.new_job("j", "team-2", "align", AUDIO, "en", "k" * 64, 60.0, NOW)
    for decision, code, status in (("refuse-lane", "gpu-lane-busy", 409), ("refuse-ceiling", "service-busy", 429)):
        refusal = core.lane_refusal(decision, "editor")
        assert (refusal.status, refusal.code) == (status, code)
        assert refusal.retry_after_sec > 0
        # 1.1.x clients show `detail` verbatim: no lane/worker jargon.
        assert "worker" not in refusal.detail and "lane" not in refusal.detail
        rec = core.lane_refused(job, refusal, NOW)
        assert rec["status"] == "failed" and rec["error"]["code"] == code and rec["workerSec"] == 0.0
        assert not core.reusable_inflight(rec, "team-2")


def test_an_orphaned_submit_is_reaped_typed_and_never_reused():
    job = core.new_job("j-orph", "operator", "transcribe", AUDIO, "en", "k" * 64, 20.0, NOW - 120)
    # The live probe's record: queued, no call, no hand-off, two minutes old.
    assert core.is_orphan(job, has_call=False, now=NOW)
    reaped = core.reaped(job, NOW)
    assert reaped["status"] == "failed" and reaped["error"]["code"] == "worker-lost"
    assert not core.reusable_inflight(reaped, "operator")
    # Not an orphan: still inside the submit's own lane wait, spawned, handed
    # off, or already running/terminal.
    fresh = dict(job, createdAt=NOW - core.LANE_WAIT_SEC)
    assert not core.is_orphan(fresh, has_call=False, now=NOW)
    assert core.ORPHAN_AFTER_SEC > core.LANE_WAIT_SEC
    assert not core.is_orphan(job, has_call=True, now=NOW)
    assert not core.is_orphan(dict(job, handedOff=True), has_call=False, now=NOW)
    assert not core.is_orphan(dict(job, status="running"), has_call=False, now=NOW)
    assert not core.is_orphan(dict(job, status="done"), has_call=False, now=NOW)


def _src(name="sync_service.py"):
    return (Path(__file__).parent / name).read_text(encoding="utf-8")


def _fn(src, header, nxt):
    return src[src.index(header):src.index(nxt, src.index(header))]


def test_submit_refuses_quota_before_any_record_and_ends_every_path_terminal():
    sub = _fn(_src(), "    async def submit(request: Request)", "    @web.post(\"/v1/jobs/{job_id}/release\")")
    # (A cache hit spends no GPU and is never quota-refused; the queued path is.)
    assert sub.index("core.check_member_quota(") < sub.index("await jobs.put.aio(inflight, job_id)")
    # Anything that stops the submit after the record exists (an exception,
    # the request being cancelled) leaves it terminal, never queued.
    assert "except BaseException" in sub and "core.submit_interrupted(" in sub
    # A cancel that lands during the lane wait is honoured before any spawn.
    loop = sub[sub.index("while True:"):sub.index(".spawn.aio(")]
    assert "core.cancelled_key(job_id)" in loop


def test_the_gateway_never_rewrites_a_record_a_worker_may_own():
    sub = _fn(_src(), "    async def submit(request: Request)", "    @web.post(\"/v1/jobs/{job_id}/release\")")
    # Inflight reuse indexes the owner; it does not rewrite the live job.
    assert 'await jobs.put.aio(existing["jobId"], existing)' not in sub
    # A hand-off's record (and its call) is complete BEFORE the worker can
    # see the target: the hand-off key is written last.
    att = _fn(sub, "        async def attach_if_held()", "        if os.path.isfile(")
    assert att.index("await jobs.put.aio(job_id,") < att.index("core.claim_handoff_key(")


def test_typed_failures_reach_the_client():
    src = _src()
    worker = _fn(src, "    def _execute(self, job_id: str, began: float) -> str:", "# Gateway.")
    assert "core.worker_error(exc)" in worker
    assert core.worker_error(core.ValidationError("too-large-batch", "x"))["code"] == "too-large-batch"
    assert core.worker_error(RuntimeError("boom"))["code"] == "worker-error"
    assert "@web.exception_handler(Exception)" in src  # no bare-text 500


def test_modal_never_queues_below_the_ceiling():
    src = _src()
    assert "max_containers=core.GPU_WORKSPACE_CEILING" in src


def test_meter_lines_carry_their_owner_for_per_row_and_per_attempt_billing():
    job = dict(core.new_job("j", "team-3", "transcribe", AUDIO, "en", "k" * 64, 20.0, NOW), projectId="p1", rowId="r1")
    line = core.meter_line(job, "done", 5.0, NOW)
    assert (line["member"], line["projectId"], line["rowId"]) == ("team-3", "p1", "r1")


def test_member_summaries_split_cost_by_key_with_zero_cross_billing():
    lines = [
        dict(core.meter_line(dict(core.new_job("a1", "operator", "transcribe", AUDIO, "en", "k" * 64, 20.0, NOW), taskId="ta-1"), "done", 6.0, NOW)),
        dict(core.meter_line(dict(core.new_job("b1", "team-2", "transcribe", AUDIO, "en", "k" * 64, 20.0, NOW), taskId="ta-2"), "done", 4.0, NOW)),
        dict(core.meter_line(dict(core.new_job("b2", "team-2", "align", AUDIO, "en", "k" * 64, 20.0, NOW), taskId="ta-2"), "done", 3.0, NOW)),
    ]
    by = {m["member"]: m for m in core.member_summaries(lines, {"team-2": core.usage_with(None, 7.0, NOW)}, NOW)}
    assert by["operator"]["workerSec"] == 6.0 and by["operator"]["boots"] == 1 and by["operator"]["jobs"] == 1
    assert by["team-2"]["workerSec"] == 7.0 and by["team-2"]["boots"] == 1 and by["team-2"]["jobs"] == 2
    assert by["team-2"]["quotaUsedSec"] == 7.0 and by["operator"]["quotaUsedSec"] == 0.0


def test_retention_drops_old_finished_jobs_and_their_keys_only():
    old_done = dict(core.new_job("old", "operator", "align", AUDIO, "en", "k" * 64, 20.0, NOW - core.JOB_RETENTION_SEC - 10), status="done")
    old_live = dict(core.new_job("live", "operator", "align", AUDIO, "en", "q" * 64, 20.0, NOW - core.JOB_RETENTION_SEC - 10), status="running")
    recent = dict(core.new_job("new", "operator", "align", AUDIO, "en", "r" * 64, 20.0, NOW - 60), status="done")
    items = {
        "old": old_done, "call:old": "fc-1", "start:old": 1.0, "handoff:old": "CLOSED", "cancelled:old": old_done,
        core.inflight_key("operator", "k" * 64): "old",
        "live": old_live, "call:live": "fc-2",
        "new": recent, "call:new": "fc-3",
        "gpu-lanes": {"bulk": 0, "editor": 0},
    }
    gone = set(core.expired_job_keys(items, NOW))
    assert gone == {"old", "call:old", "start:old", "handoff:old", "cancelled:old",
                    core.inflight_key("operator", "k" * 64), "gpu-lanes"}
    assert core.JOB_RETENTION_SEC >= core.RESULT_RETENTION_SEC


def test_the_async_handoff_claim_mirrors_the_sync_one():
    import asyncio

    class _Async:
        def __init__(self, d):
            self.d = d

        async def get(self, key):
            return self.d.get(key)

        async def put(self, key, value, skip_if_exists=False):
            return self.d.put(key, value, skip_if_exists=skip_if_exists)

    for existing, expect in ((None, True), ("a1", True), (core.HANDOFF_CLOSED, False),
                             (core.HANDOFF_RELEASE, False), ("other", False)):
        d = _PutIfAbsent()
        if existing is not None:
            d[core.handoff_key("t1")] = existing
        store = _Async(d)
        got = asyncio.run(core.claim_handoff_key(store.get, store.put, "t1", "a1"))
        assert got is expect, existing
        if expect:
            assert d[core.handoff_key("t1")] == "a1"


def test_the_modal_invoice_query_stays_inside_modals_limits():
    # Live 2026-10-04: an hourly report from the Wave 3 start (8+ days) is
    # refused by Modal ("Hourly reports cannot span more than 7 days") and the
    # billing report crashed before printing the invoice section.
    assert core.modal_billing_args("2026-09-27", "2026-10-05")[-1] == "d"
    assert core.modal_billing_args("2026-10-01", "2026-10-05")[-1] == "h"
    assert core.modal_billing_args("2026-09-28", "2026-10-05")[-1] == "h"  # exactly 7 days


def test_owner_attempts_list_every_billed_attempt_of_a_row():
    def line(job_id, stage, outcome, sec, ts, row="r1", member="team-2"):
        job = dict(core.new_job(job_id, member, stage, AUDIO, "en", "k" * 64, 20.0, ts), rowId=row, projectId=row)
        return core.meter_line(job, outcome, sec, ts)

    lines = [
        line("t1", "transcribe", "done", 30.0, NOW),
        line("a1", "align", "failed", 4.0, NOW + 40),      # the failed attempt
        line("a2", "align", "done", 22.0, NOW + 400),      # the fresh-submit retry
        line("x", "transcribe", "done", 9.0, NOW, row="r9", member="operator"),
    ]
    by = {(o["member"], o["owner"]): o for o in core.owner_attempts(lines)}
    r1 = by[("team-2", "r1")]
    assert [a["jobId"] for a in r1["attempts"]] == ["t1", "a1", "a2"]
    assert r1["workerSec"] == 56.0
    assert by[("operator", "r9")]["workerSec"] == 9.0  # never merged across members
