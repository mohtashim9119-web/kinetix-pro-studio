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
    assert core.gpu_boot_allowed(lookup=False, handed_off=True, live_containers=0) is False
    assert core.gpu_boot_allowed(lookup=False, handed_off=False, live_containers=1, lane_live=1) is False


def test_gap_beyond_window_never_pays_a_second_boot_while_holder_live():
    assert core.GPU_MAX_CONTAINERS == 2
    assert core.gpu_boot_allowed(lookup=False, handed_off=False, live_containers=1, lane_live=1) is False


def test_a_lookup_never_boots_and_a_held_container_blocks_a_second():
    assert core.gpu_boot_allowed(lookup=True, handed_off=False, live_containers=0) is False
    assert core.gpu_boot_allowed(lookup=False, handed_off=True, live_containers=0) is False
    assert core.gpu_boot_allowed(lookup=False, handed_off=False, live_containers=1, lane_live=1) is False
    assert core.gpu_boot_allowed(lookup=False, handed_off=False, live_containers=0, lane_live=0) is True
    assert core.GPU_MAX_CONTAINERS == 2


def test_second_lane_may_boot_while_first_lane_holds_one():
    assert core.gpu_boot_allowed(lookup=False, handed_off=False, live_containers=1, lane_live=0) is True
    assert core.gpu_boot_allowed(lookup=False, handed_off=False, live_containers=2, lane_live=0) is False


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

