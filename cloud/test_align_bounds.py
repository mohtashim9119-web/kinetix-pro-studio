"""H3 — alignment must refuse >1h audio and never forward a window past MAX_RUN_SEC."""

from __future__ import annotations

import pytest

import fa_engine
import sync_core as core


def test_align_submit_refuses_over_one_hour_before_gpu():
    with pytest.raises(core.ValidationError) as e:
        core.validate_align_audio(3600 + core.AUDIO_DURATION_TOLERANCE_SEC + 0.1)
    assert e.value.code == "too-long"


def test_one_chunk_covering_an_hour_is_refused_as_too_wide():
    with pytest.raises(core.ValidationError) as e:
        core.canonical_chunks([{"startSec": 0, "endSec": 3600, "text": "whole file"}], 3600.0)
    assert e.value.code == "bad-chunks"


def test_chunked_plan_windows_stay_at_or_under_max_run():
    chunks = [
        {"startSec": i * 30.0, "endSec": (i + 1) * 30.0, "text": f"c{i}"}
        for i in range(4)
    ]
    out = core.canonical_chunks(chunks, 120.0)
    for c in out:
        assert (c["endSec"] - c["startSec"]) <= core.MAX_ALIGN_WINDOW_SEC + 1e-6


def test_forward_never_sees_more_than_max_run_samples():
    cap = fa_engine.max_align_samples()
    fa_engine.guard_align_samples(cap)
    with pytest.raises(core.ValidationError) as e:
        fa_engine.guard_align_samples(cap + 1)
    assert e.value.code == "bad-chunks"
    for span in (30.0, 30.0, 30.0):
        n = int(round(span * fa_engine.FA_SAMPLE_RATE_HZ))
        fa_engine.guard_align_samples(n)
