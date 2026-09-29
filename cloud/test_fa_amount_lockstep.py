"""Python arm of the three-way AMOUNT lockstep — run with `python -m pytest cloud/test_fa_amount_lockstep.py`.

`scripts/fixtures/fa-amount-lockstep.json` is ONE corpus read by three
independent suites (`src/services/faAmountLockstep.test.ts`,
`src-tauri/src/fa/text.rs` `amount_lockstep`, and this file). Each must
reproduce it per word (`representable` + `mapped`) and as the joined chunk
text. Reason strings are deliberately not compared.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fa_engine import load_vocab, normalize_for_forced_alignment  # noqa: E402

FIXTURES = Path(__file__).resolve().parent.parent / "scripts" / "fixtures"
CORPUS = json.loads((FIXTURES / "fa-amount-lockstep.json").read_text(encoding="utf-8"))["entries"]


def _normalize(language: str, text: str) -> tuple[list[dict], str]:
    words = normalize_for_forced_alignment(text, language, load_vocab(language))
    joined = " ".join(w["mapped"] for w in words if w.get("representable"))
    return words, joined


def test_corpus_covers_all_five_languages():
    assert {e["language"] for e in CORPUS} == {"en", "es", "fr", "de", "pt"}
    assert len(CORPUS) >= 40


def test_python_reproduces_the_shared_amount_corpus_for_every_entry():
    mismatches = []
    for e in CORPUS:
        words, joined = _normalize(e["language"], e["input"])
        if joined != e["text"]:
            mismatches.append(f"{e['language']} {e['input']!r}: text {joined!r} != {e['text']!r}")
        got = [
            {"input": w["input"], "representable": w["representable"], "mapped": w.get("mapped")}
            for w in words
        ]
        if got != e["words"]:
            mismatches.append(f"{e['language']} {e['input']!r}: words {got!r} != {e['words']!r}")
    assert not mismatches, "Python diverged from the shared amount corpus:\n" + "\n".join(mismatches)


def test_the_headline_amounts_read_as_words():
    def t(s: str) -> str:
        return _normalize("en", s)[1]

    assert t("you have in your savings account $11,000.") == "you have in your savings account eleven thousand dollars"
    assert t("you pay $9,400 in cash.") == "you pay nine thousand four hundred dollars in cash"
    assert t("2001") == "two thousand one"  # bare integer unchanged
    assert t("$") == ""  # a lone symbol is still not an amount


def test_a_vocab_dir_without_the_amount_file_keeps_the_pre_amount_behavior(tmp_path):
    import shutil

    for name in ("fa-vocab-en.json", "fa-cardinal-en.json"):
        shutil.copy(FIXTURES / name, tmp_path / name)
    vocab = load_vocab("en", vocab_dir=tmp_path)
    words = normalize_for_forced_alignment("account $11,000.", "en", vocab)
    assert [w["representable"] for w in words] == [True, False]  # dropped, exactly as before
