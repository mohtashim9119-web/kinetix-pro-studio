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


# --- 1.5.1 P1: alignment memory is per WINDOW, never per window count --------
#
# The two production OOMs (job records bf762a2b / 2672bce4, 2026-10-03) were
# ONE oversized window each, forwarded at batch 1 — not many windows batched.


class _Audio:
    """`n` samples of synthetic audio, never allocated: slicing yields only
    the window length, which is all the memory property depends on."""

    def __init__(self, n: int) -> None:
        self.n = n

    def __len__(self) -> int:
        return self.n

    def __getitem__(self, s: slice) -> "_Window":
        i0, i1, _ = s.indices(self.n)
        return _Window(max(0, i1 - i0))


class _Window:
    def __init__(self, size: int) -> None:
        self.size = size

    def __len__(self) -> int:
        return self.size


def _run(monkeypatch, chunks, audio_sec):
    """align_chunked with the model stubbed out: returns the sample count of
    every window that reached the forward."""
    forwarded: list[int] = []
    monkeypatch.setattr(fa_engine, "zero_mean_unit_var_norm", lambda w: w)
    monkeypatch.setattr(fa_engine, "align_chunk_samples", lambda logits, text, lang, vocab: [])

    def forward(normed):
        forwarded.append(len(normed))
        return None

    fa_engine.align_chunked(_Audio(int(audio_sec * fa_engine.FA_SAMPLE_RATE_HZ)), chunks, "en", None, forward)
    return forwarded


# The failing plan of job bf762a2b (row 20bba5a8, 755.3 s): 12 windows.
BF762A2B = [(0.0, 37.9), (37.9, 269.1), (269.1, 274.84), (274.84, 282.92), (282.92, 292.78),
            (292.78, 365.1), (365.1, 369.48), (369.48, 543.0), (543.0, 575.54), (575.54, 586.4),
            (586.4, 746.04), (746.04, 755.25)]


def test_the_production_ooms_were_one_window_each_reproduced_to_the_byte():
    def arena(n_samples):  # ORT's BFC arena rounds every request up to 256 B
        return -(-core.align_attention_bytes(n_samples) // 256) * 256

    assert core.align_frames(3_699_200) == 11_559  # bf762a2b chunk 1: [37.9, 269.1]
    assert arena(3_699_200) == 8_551_070_976  # "Failed to allocate 8551070976"
    assert core.align_frames(3_117_440) == 9_741  # 2672bce4 chunk 0: [0.0, 194.84]
    assert arena(3_117_440) == 6_072_773_376  # "Failed to allocate 6072773376"


def test_memory_guard_refuses_the_failing_plan_even_if_the_window_cap_drifts(monkeypatch):
    # The window cap is policy (lockstep with the client planner); the memory
    # bound is physics. Raise the policy and the bound must still refuse,
    # typed and before any job exists (the gateway calls canonical_chunks).
    monkeypatch.setattr(core, "MAX_ALIGN_WINDOW_SEC", 1000.0)
    plan = [{"startSec": s, "endSec": e, "text": "w"} for s, e in BF762A2B]
    with pytest.raises(core.ValidationError) as e:
        core.canonical_chunks(plan, 755.3)
    assert e.value.code == "too-large-batch"
    assert "chunk 1" in e.value.detail


def test_worker_refuses_before_any_forward(monkeypatch):
    monkeypatch.setattr(core, "MAX_ALIGN_WINDOW_SEC", 1000.0)
    plan = [{"startSec": s, "endSec": e, "text": "w"} for s, e in BF762A2B]
    forwarded: list[int] = []
    monkeypatch.setattr(fa_engine, "zero_mean_unit_var_norm", lambda w: w)
    monkeypatch.setattr(fa_engine, "align_chunk_samples", lambda logits, text, lang, vocab: [])
    with pytest.raises(core.ValidationError) as e:
        fa_engine.align_chunked(_Audio(int(755.3 * 16_000)), plan, "en", None, lambda n: forwarded.append(len(n)))
    assert e.value.code == "too-large-batch"
    assert forwarded == []  # chunk 0 (37.9 s) never ran either: no GPU work on a doomed plan


def test_long_audio_with_many_windows_never_forwards_a_buffer_over_the_bound(monkeypatch):
    # A full hour at the planner's cap: 120 windows — far more than any plan
    # that ever failed. Every forward stays under the bound.
    hour = [{"startSec": i * 30.0, "endSec": (i + 1) * 30.0, "text": "w"} for i in range(120)]
    forwarded = _run(monkeypatch, hour, 3600.0)
    assert len(forwarded) == 120
    assert max(core.align_peak_bytes(n) for n in forwarded) <= core.ALIGN_MEMORY_BOUND_BYTES


def test_peak_memory_is_independent_of_window_count_property(monkeypatch):
    import random

    rng = random.Random(151)
    cap = core.MAX_ALIGN_WINDOW_SEC
    for count in (1, 2, 7, 49, 120, 1000, core.MAX_CHUNKS):
        widest = 0.0
        plan, t = [], 0.0
        for _ in range(count):
            w = rng.uniform(0.2, cap)
            plan.append({"startSec": t, "endSec": t + w, "text": "w"})
            widest = max(widest, w)
            t += w
        forwarded = _run(monkeypatch, plan, t)
        assert len(forwarded) == count
        peak = max(core.align_peak_bytes(n) for n in forwarded)
        assert peak <= core.ALIGN_MEMORY_BOUND_BYTES
        # The peak is the widest window's alone (±1 sample of rounding):
        # the count never enters it.
        assert peak <= core.align_peak_bytes(int(round(widest * 16_000)) + 1)
    # And the policy cap itself sits well inside the bound.
    assert core.align_peak_bytes(fa_engine.max_align_samples()) <= core.ALIGN_MEMORY_BOUND_BYTES
