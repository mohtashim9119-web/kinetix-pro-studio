"""M4 — plan hash and alignment-key record (Python arm) — `python -m pytest cloud/test_plan_hash_keys.py`.

`scripts/fixtures/m4-chunk-plan-digests.json` records, per corpus, the chunk-plan
hash the client sends the gateway and the alignment cache key the gateway derives
from it (`sync_core.alignment_cache_key`). `src/services/chunkPlanM4.test.ts`
checks the TypeScript arm of the same constants. Together they pin, on BOTH sides
of the wire: v6 / 173 / Spanish keys did not move; only amount-bearing plans did.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sync_core as core  # noqa: E402

FIXTURES = Path(__file__).resolve().parent.parent / "scripts" / "fixtures"
M4 = json.loads((FIXTURES / "m4-chunk-plan-digests.json").read_text(encoding="utf-8"))
DIGESTS = core.pack_digests(FIXTURES)


def _key(audio_hash: str, plan_hash: str, language: str) -> str:
    return core.alignment_cache_key(audio_hash, plan_hash, language, core.pack_revision(language, DIGESTS))


def test_corpus_alignment_keys_are_the_recorded_ones():
    for name, rec in M4["corpora"].items():
        assert _key(rec["audioHash"], rec["planHash"], rec["language"]) == rec["alignmentKey"], name


def test_amount_bearing_plans_hash_to_the_recorded_values_and_change_key():
    for name, rec in M4["amountBearing"].items():
        for side in ("before", "after"):
            chunks = rec[side]["chunks"]
            assert core.chunk_plan_hash(chunks) == rec[side]["planHash"], (name, side)
            assert _key(rec["audioHash"], rec[side]["planHash"], rec["language"]) == rec[side]["alignmentKey"], (name, side)
        # Only the chunks that carry an amount moved; the keys differ because the plan did.
        assert rec["before"]["planHash"] != rec["after"]["planHash"], name
        assert rec["before"]["alignmentKey"] != rec["after"]["alignmentKey"], name
        moved = [i for i, (a, b) in enumerate(zip(rec["before"]["chunks"], rec["after"]["chunks"])) if a != b]
        assert moved == rec["changedChunkIndexes"], name


def test_the_amount_words_file_is_outside_the_pack_digests(tmp_path: Path):
    """Adding/changing fa-amount-words.json must not move any alignment key of a
    plan that carries no amount — the whole reason it is a separate file."""
    for lang in core.FA_LANGS:
        for name in (f"fa-vocab-{lang}.json", f"fa-cardinal-{lang}.json"):
            shutil.copy(FIXTURES / name, tmp_path / name)
    (tmp_path / "fa-amount-words.json").write_text('{"languages": {}}', encoding="utf-8")
    assert core.pack_digests(tmp_path) == DIGESTS


def test_restart_stability_two_fresh_interpreters_agree():
    code = (
        "import json,sys;sys.path.insert(0,'cloud');import sync_core as c;"
        f"m=json.load(open('{FIXTURES / 'm4-chunk-plan-digests.json'}'));d=c.pack_digests('{FIXTURES}');"
        "print(json.dumps({k:c.alignment_cache_key(v['audioHash'],v['planHash'],v['language'],c.pack_revision(v['language'],d)) for k,v in m['corpora'].items()},sort_keys=True))"
    )
    root = Path(__file__).resolve().parent.parent
    a = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True, check=True).stdout
    b = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True, check=True).stdout
    assert a == b
    assert json.loads(a) == {k: v["alignmentKey"] for k, v in M4["corpora"].items()}
