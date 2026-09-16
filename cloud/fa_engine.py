"""Production FA pipeline port: Viterbi + tokenize + word merge.

Algorithmic translation of:
  src-tauri/src/fa_viterbi.rs          (torchaudio 2.2.2 CTC Viterbi)
  src-tauri/src/fa_onnx.rs             (log-softmax, frame clock, merge, stitch)
  src/services/faTextNormalize.ts      (source of truth for text mapping)
  src-tauri/src/fa.rs::word_span_to_dto (exp(score), CONF_MIN, wordIndex)

Measurement-only. Not a shipping engine.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

FA_FRAME_STRIDE_SAMPLES = 320
FA_SAMPLE_RATE_HZ = 16_000
CONF_MIN = 0.3
CTC_INFEASIBLE_FALLBACK_SCORE = float("-inf")

NON_CHARACTER_VOCAB_TOKENS = {"<pad>", "<s>", "</s>", "<unk>", "|"}
DIGIT_RE = re.compile(r"[0-9]")
ZERO_WIDTH = dict.fromkeys(map(ord, "\u200b\u200c\u200d\ufeff\u2060"))
BOUNDARY_STRIP = set('.,;:?!«»"()')
FOLD_TARGETS = {
    "\u2018": "'",
    "\u2019": "'",
    "\u02bc": "'",
    "\u2010": "-",
    "\u2011": "-",
    "\u2013": "-",
    "\u2014": "-",
    "\u201c": '"',
    "\u201d": '"',
    "\u201e": '"',
    "\u201f": '"',
}
FRENCH_ELISION_PREFIXES = ("qu", "l", "d", "j", "n", "s", "t", "m", "c")
FRENCH_ELISION_FOLLOWERS = set("aeiouyhàâäéèêëîïôöùûüœ")
JS_WHITESPACE = (
    set(chr(c) for c in range(0x09, 0x0E))
    | {"\u0020", "\u00a0", "\u1680"}
    | set(chr(c) for c in range(0x2000, 0x200B))
    | {"\u2028", "\u2029", "\u202f", "\u205f", "\u3000", "\ufeff"}
)

REPO = Path(__file__).resolve().parent.parent
FIXTURE_DIR = REPO / "scripts" / "fixtures"


@dataclass
class TokenSpan:
    token: int
    start: int
    end: int
    score: float


@dataclass
class AlignOutput:
    path: list[int]
    scores: list[float]


@dataclass
class WordSpan:
    text: str
    start_seconds: float
    end_seconds: float
    score: float


@dataclass
class Vocab:
    char_to_id: dict[str, int]
    chars: set[str]
    blank_id: int
    word_delim_id: int | None
    cardinal: dict[str, Any]


class AlignError(Exception):
    pass


class TooManyRepeats(AlignError):
    def __init__(self, input_length: int, target_length: int, num_repeats: int) -> None:
        super().__init__(
            f"targets length is too long for CTC. Found input length: {input_length}, "
            f"target length: {target_length}, and number of repeats: {num_repeats}"
        )
        self.input_length = input_length
        self.target_length = target_length
        self.num_repeats = num_repeats


class EmptyTargets(AlignError):
    def __init__(self) -> None:
        super().__init__("targets must contain at least one token")


def frame_to_seconds(frame_index: int) -> float:
    return frame_index * (FA_FRAME_STRIDE_SAMPLES / FA_SAMPLE_RATE_HZ)


def zero_mean_unit_var_norm(samples: Any) -> Any:
    """(x - mean) / sqrt(var + 1e-7) with f64 accumulation, f32 output."""
    import numpy as np

    x = np.asarray(samples, dtype=np.float32)
    n = float(x.size)
    if n == 0:
        return x
    mean = float(x.astype(np.float64).sum() / n)
    var = float(((x.astype(np.float64) - mean) ** 2).sum() / n)
    denom = math.sqrt(var + 1e-7)
    return ((x.astype(np.float64) - mean) / denom).astype(np.float32)


def log_softmax_row(row: list[float] | Any) -> list[float]:
    """In-place-style log-softmax matching fa_onnx.rs::log_softmax_row (f32)."""
    vals = [float(v) for v in row]
    if not vals:
        return []
    m = max(vals)
    shifted = [v - m for v in vals]
    total = 0.0
    for v in shifted:
        total += math.exp(v)
    log_sum = math.log(total)
    return [v - log_sum for v in shifted]


def log_softmax_rows(logits: Any) -> list[list[float]]:
    import numpy as np

    arr = np.asarray(logits, dtype=np.float32)
    if arr.ndim == 3:
        arr = arr[0]
    return [log_softmax_row(arr[i]) for i in range(arr.shape[0])]


def count_repeats(targets: list[int]) -> int:
    return sum(1 for a, b in zip(targets, targets[1:]) if a == b)


def forced_align(log_probs: list[list[float]], targets: list[int], blank: int) -> AlignOutput:
    """Line-for-line port of fa_viterbi.rs::forced_align (torchaudio 2.2.2)."""
    t = len(log_probs)
    l = len(targets)
    if l == 0:
        raise EmptyTargets()
    r = count_repeats(targets)
    if t < l + r:
        raise TooManyRepeats(t, l, r)

    s = 2 * l + 1
    neg_inf = float("-inf")

    def label_idx(i: int) -> int:
        return blank if i % 2 == 0 else targets[i // 2]

    alphas = [[neg_inf] * s, [neg_inf] * s]
    back_ptr = [-1] * (t * s)

    start = 0 if t > l + r else 1
    end = 1 if s == 1 else 2
    for i in range(start, end):
        alphas[0][i] = log_probs[0][label_idx(i)]

    for tt in range(1, t):
        if t - tt <= l + r:
            if start % 2 == 1 and targets[start // 2] != targets[start // 2 + 1]:
                start += 1
            start += 1
        if tt <= l + r:
            if end % 2 == 0 and end < 2 * l and targets[end // 2 - 1] != targets[end // 2]:
                end += 1
            end += 1

        start_loop = start
        cur = tt % 2
        prev = (tt - 1) % 2
        for i in range(s):
            alphas[cur][i] = neg_inf

        if start == 0:
            alphas[cur][0] = alphas[prev][0] + log_probs[tt][blank]
            back_ptr[tt * s] = 0
            start_loop += 1

        for i in range(start_loop, end):
            x0 = alphas[prev][i]
            x1 = alphas[prev][i - 1]
            if i % 2 != 0 and i != 1 and targets[i // 2] != targets[i // 2 - 1]:
                x2 = alphas[prev][i - 2]
            else:
                x2 = neg_inf
            if x2 > x1 and x2 > x0:
                result, bp = x2, 2
            elif x1 > x0 and x1 > x2:
                result, bp = x1, 1
            else:
                result, bp = x0, 0
            back_ptr[tt * s + i] = bp
            alphas[cur][i] = result + log_probs[tt][label_idx(i)]

    idx1 = (t - 1) % 2
    ltr_idx = s - 1 if alphas[idx1][s - 1] > alphas[idx1][s - 2] else s - 2
    path = [0] * t
    for tt in range(t - 1, -1, -1):
        path[tt] = blank if ltr_idx % 2 == 0 else targets[ltr_idx // 2]
        if tt > 0:
            ltr_idx -= back_ptr[tt * s + ltr_idx]

    scores = [log_probs[tt][path[tt]] for tt in range(t)]
    return AlignOutput(path=path, scores=scores)


def merge_tokens(tokens: list[int], scores: list[float], blank: int) -> list[TokenSpan]:
    if not tokens:
        return []
    change_points: list[int] = []
    prev: int | None = None
    for i, tok in enumerate(tokens):
        if prev != tok:
            change_points.append(i)
        prev = tok
    change_points.append(len(tokens))
    spans: list[TokenSpan] = []
    for start, end in zip(change_points, change_points[1:]):
        token = tokens[start]
        if token == blank:
            continue
        span_scores = scores[start:end]
        mean = sum(span_scores) / len(span_scores)
        spans.append(TokenSpan(token=token, start=start, end=end, score=mean))
    return spans


def split_js_whitespace(text: str) -> list[str]:
    out: list[str] = []
    buf: list[str] = []
    for ch in text:
        if ch in JS_WHITESPACE:
            if buf:
                out.append("".join(buf))
                buf = []
        else:
            buf.append(ch)
    if buf:
        out.append("".join(buf))
    return out


def joiner_separator(joiner: dict[str, Any] | None) -> str:
    if not joiner or joiner.get("type") == "concatenate":
        return ""
    text = joiner.get("text")
    return f" {text} " if text else " "


def cardinal0to99(n: int, data: dict[str, Any]) -> str:
    word = data["cardinals0to99"].get(str(n))
    if word is None:
        raise ValueError(f"fa cardinal data: cardinals0to99 missing entry for {n}")
    return word


def cardinal_to_words(n: int, data: dict[str, Any]) -> str:
    if n < 100:
        return cardinal0to99(n, data)
    if n < 1000:
        return compose_hundred(n, data)
    levels = sorted(data["scale"], key=lambda x: x["value"], reverse=True)
    for level in levels:
        if n >= level["value"]:
            return compose_scale_level(n, level, data)
    raise ValueError(f"fa cardinal data: no scale level applies to {n}")


def compose_hundred(n: int, data: dict[str, Any]) -> str:
    hundred = data["hundred"]
    multiplier = n // 100
    remainder = n % 100
    if hundred["multiplierForm"] == "fused":
        if multiplier == 1:
            head = hundred["word"] if remainder == 0 else hundred["combiningWord"]
        else:
            fused = (hundred.get("multiplierWords") or {}).get(str(multiplier * 100))
            if fused is None:
                raise ValueError(f"fa cardinal data: hundred.multiplierWords missing {multiplier * 100}")
            head = fused
    else:
        multiplier_part = ""
        if not (multiplier == 1 and hundred["dropsOneMultiplier"]):
            override = hundred.get("countWordOverride") if multiplier == 1 else None
            multiplier_part = (
                override
                or (hundred.get("multiplierWords") or {}).get(str(multiplier))
                or cardinal0to99(multiplier, data)
            )
        hundred_word = hundred["word"]
        if hundred.get("pluralizesWhenExactMultiple") and hundred.get("pluralSuffix") and remainder == 0 and multiplier > 1:
            hundred_word += hundred["pluralSuffix"]
        if multiplier_part == "":
            head = hundred_word
        elif hundred["multiplierForm"] == "concatenate":
            head = multiplier_part + hundred_word
        else:
            head = multiplier_part + joiner_separator(hundred.get("regularMultiplierJoiner")) + hundred_word
    if remainder == 0:
        return head
    return head + joiner_separator(hundred["remainderJoiner"]) + cardinal0to99(remainder, data)


def compose_scale_level(n: int, level: dict[str, Any], data: dict[str, Any]) -> str:
    multiplier = n // level["value"]
    remainder = n % level["value"]
    multiplier_part = ""
    if not (multiplier == 1 and level["dropsOneMultiplier"]):
        override = level.get("countWordOverride") if multiplier == 1 else None
        multiplier_part = override or cardinal_to_words(multiplier, data)
    scale_word = level["word"] if multiplier == 1 else level["pluralWord"]
    if multiplier_part == "":
        head = scale_word
    elif level["joiner"]["type"] == "concatenate":
        head = multiplier_part + scale_word
    else:
        head = multiplier_part + joiner_separator(level["joiner"]) + scale_word
    if remainder == 0:
        return head
    tail = cardinal_to_words(remainder, data)
    return head + tail if level["joiner"]["type"] == "concatenate" else f"{head} {tail}"


def compose_year_reading(n: int, candidate: str, data: dict[str, Any]) -> str:
    if candidate == "compound":
        return cardinal_to_words(n, data)
    high = cardinal0to99(n // 100, data)
    low = cardinal0to99(n % 100, data)
    if candidate == "pair":
        return f"{high} {low}"
    if candidate == "hundertgruppe":
        if data["hundred"]["multiplierForm"] == "concatenate":
            return f"{high}{data['hundred']['word']}{low}"
        return f"{high} {data['hundred']['word']} {low}"
    raise ValueError(f"fa cardinal data: unknown yearReading candidate {candidate!r}")


def select_year_candidate(n: int, policy: Any) -> str:
    if policy is None:
        raise ValueError("fa cardinal data: yearReading.selectionPolicy is unset")
    if isinstance(policy, str):
        return policy
    return policy["atOrAboveThreshold"] if (n % 100) >= policy["threshold"] else policy["belowThreshold"]


def expand_cardinal_token(stripped: str, data: dict[str, Any]) -> str | None:
    if not re.fullmatch(r"[0-9]+", stripped):
        return None
    if len(stripped) > 1 and stripped[0] == "0":
        return None
    n = int(stripped)
    yr = data["yearReading"]
    if len(stripped) == 4 and yr["rangeMin"] <= n <= yr["rangeMax"]:
        return compose_year_reading(n, select_year_candidate(n, yr["selectionPolicy"]), data)
    return cardinal_to_words(n, data)


def fold_french_elision_backtick(word: str, vocab_chars: set[str]) -> str:
    if "'" not in vocab_chars:
        return word
    for prefix in FRENCH_ELISION_PREFIXES:
        if not word.startswith(prefix):
            continue
        if len(word) <= len(prefix) or word[len(prefix)] != "`":
            continue
        follower = word[len(prefix) + 1] if len(word) > len(prefix) + 1 else None
        if follower is None or follower not in FRENCH_ELISION_FOLLOWERS:
            continue
        return word[: len(prefix)] + "'" + word[len(prefix) + 1 :]
    return word


def fold_typographic(word: str, vocab_chars: set[str]) -> str:
    out: list[str] = []
    for ch in word:
        target = FOLD_TARGETS.get(ch)
        if target is None:
            out.append(ch)
        elif target in vocab_chars:
            out.append(target)
    return "".join(out)


def strip_boundary_punct(word: str) -> str:
    start, end = 0, len(word)
    while start < end and word[start] in BOUNDARY_STRIP:
        start += 1
    while end > start and word[end - 1] in BOUNDARY_STRIP:
        end -= 1
    return word[start:end]


def normalize_word(raw: str, language: str, vocab_chars: set[str], cardinal: dict[str, Any]) -> dict[str, Any]:
    lowered = unicodedata.normalize("NFC", raw).lower()
    substituted = lowered.replace("ß", "ss") if language == "de" else lowered
    elision = fold_french_elision_backtick(substituted, vocab_chars) if language == "fr" else substituted
    dezero = elision.translate(ZERO_WIDTH)
    folded = fold_typographic(dezero, vocab_chars)
    stripped = strip_boundary_punct(folded)
    if not stripped:
        return {"input": raw, "representable": False, "reason": "reduced to nothing"}
    expansion = expand_cardinal_token(stripped, cardinal)
    candidate = expansion if expansion is not None else stripped
    if expansion is None and DIGIT_RE.search(stripped):
        return {"input": raw, "representable": False, "reason": "contains a digit"}
    for ch in candidate:
        if ch == " ":
            continue
        if ch not in vocab_chars:
            return {"input": raw, "representable": False, "reason": f"character {ch!r} not in {language} vocab"}
    return {"input": raw, "representable": True, "mapped": candidate}


def normalize_for_forced_alignment(text: str, language: str, vocab: Vocab) -> list[dict[str, Any]]:
    raw_words = split_js_whitespace(text)
    return [normalize_word(w, language, vocab.chars, vocab.cardinal) for w in raw_words]


def tokenize_normalized_words(words: list[dict[str, Any]], vocab: Vocab) -> tuple[list[int], list[int]]:
    ids: list[int] = []
    fragment_counts: list[int] = []
    first = True
    for word in words:
        if not word.get("representable"):
            continue
        mapped = word["mapped"]
        fragments = mapped.split()
        if not fragments:
            raise RuntimeError(f"representable word {mapped!r} produced zero fragments")
        fragment_counts.append(len(fragments))
        for fragment in fragments:
            if not first and vocab.word_delim_id is not None:
                ids.append(vocab.word_delim_id)
            first = False
            for ch in fragment:
                ids.append(vocab.char_to_id[ch])
    return ids, fragment_counts


def merge_char_spans_to_words(char_spans: list[TokenSpan], vocab: Vocab) -> list[WordSpan]:
    id_to_char = {i: c for c, i in vocab.char_to_id.items()}
    words: list[WordSpan] = []
    current: list[TokenSpan] = []

    def flush() -> None:
        if not current:
            return
        text = "".join(id_to_char[s.token] for s in current)
        start = current[0].start
        end = current[-1].end
        total_frames = sum(s.end - s.start for s in current)
        weighted = sum(s.score * (s.end - s.start) for s in current) / total_frames
        words.append(WordSpan(text=text, start_seconds=frame_to_seconds(start), end_seconds=frame_to_seconds(end), score=weighted))
        current.clear()

    for span in char_spans:
        if vocab.word_delim_id is not None and span.token == vocab.word_delim_id:
            flush()
            continue
        current.append(span)
    flush()
    return words


def collapse_word_fragments(fragment_words: list[WordSpan], fragment_counts: list[int]) -> list[WordSpan]:
    total = sum(fragment_counts)
    if len(fragment_words) != total:
        raise RuntimeError(
            f"collapse_word_fragments: merge produced {len(fragment_words)} spans but "
            f"tokenization recorded {total} fragments"
        )
    collapsed: list[WordSpan] = []
    idx = 0
    for count in fragment_counts:
        group = fragment_words[idx : idx + count]
        idx += count
        if count == 1:
            collapsed.append(group[0])
            continue
        text = " ".join(w.text for w in group)
        start = group[0].start_seconds
        end = group[-1].end_seconds
        total_dur = sum(w.end_seconds - w.start_seconds for w in group)
        if total_dur > 0:
            score = sum(w.score * (w.end_seconds - w.start_seconds) for w in group) / total_dur
        else:
            score = sum(w.score for w in group) / len(group)
        collapsed.append(WordSpan(text=text, start_seconds=start, end_seconds=end, score=score))
    return collapsed


def fallback_words_for_infeasible_chunk(chunk: dict[str, Any], language: str, vocab: Vocab) -> list[WordSpan]:
    normalized = normalize_for_forced_alignment(str(chunk.get("text") or ""), language, vocab)
    mapped = [w["mapped"] for w in normalized if w.get("representable")]
    if not mapped:
        return []
    window = max(float(chunk["endSec"]) - float(chunk["startSec"]), 0.0)
    n = len(mapped)
    start0 = float(chunk["startSec"])
    return [
        WordSpan(
            text=text,
            start_seconds=start0 + window * i / n,
            end_seconds=start0 + window * (i + 1) / n,
            score=CTC_INFEASIBLE_FALLBACK_SCORE,
        )
        for i, text in enumerate(mapped)
    ]


def chunk_sample_range(total_samples: int, start_sec: float, end_sec: float) -> tuple[int, int]:
    start = min(max(int(round(start_sec * FA_SAMPLE_RATE_HZ)), 0), total_samples)
    end = min(max(int(round(end_sec * FA_SAMPLE_RATE_HZ)), 0), total_samples)
    if start > end:
        start = end
    return start, end


def word_span_to_dto(span: WordSpan, word_index: int) -> dict[str, Any]:
    confidence = math.exp(span.score)
    return {
        "word": span.text,
        "startSec": span.start_seconds,
        "endSec": span.end_seconds,
        "confidence": confidence,
        "needsReview": confidence < CONF_MIN,
        "wordIndex": word_index,
    }


def load_vocab(language: str, vocab_dir: Path | None = None) -> Vocab:
    root = vocab_dir or FIXTURE_DIR
    parsed = json.loads((root / f"fa-vocab-{language}.json").read_text(encoding="utf-8"))
    vocab_obj = parsed["vocab"]
    chars = {k for k in vocab_obj if k not in NON_CHARACTER_VOCAB_TOKENS}
    char_to_id: dict[str, int] = {}
    blank_id = 0
    word_delim_id = None
    for key, value in vocab_obj.items():
        ident = int(value)
        if key == "<pad>":
            blank_id = ident
        elif key == "|":
            word_delim_id = ident
        elif len(key) == 1:
            char_to_id[key] = ident
    cardinal = json.loads((root / f"fa-cardinal-{language}.json").read_text(encoding="utf-8"))
    return Vocab(char_to_id=char_to_id, chars=chars, blank_id=blank_id, word_delim_id=word_delim_id, cardinal=cardinal)


def align_chunk_samples(
    logits: Any,
    chunk_text: str,
    language: str,
    vocab: Vocab,
) -> list[WordSpan]:
    emission = log_softmax_rows(logits)
    normalized = normalize_for_forced_alignment(chunk_text, language, vocab)
    ids, fragment_counts = tokenize_normalized_words(normalized, vocab)
    if not ids:
        raise EmptyTargets()
    result = forced_align(emission, ids, vocab.blank_id)
    char_spans = merge_tokens(result.path, result.scores, vocab.blank_id)
    fragment_words = merge_char_spans_to_words(char_spans, vocab)
    return collapse_word_fragments(fragment_words, fragment_counts)


def align_chunked(
    samples: Any,
    chunks: list[dict[str, Any]],
    language: str,
    vocab: Vocab,
    run_forward,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """run_forward(normed_f32) -> logits ndarray.

    Returns FaWordSpan dicts and per-run metrics.
    """
    all_words: list[WordSpan] = []
    n_fallback = 0
    for i, chunk in enumerate(chunks):
        start_sec = float(chunk["startSec"])
        end_sec = float(chunk["endSec"])
        text = str(chunk.get("text") or "")
        i0, i1 = chunk_sample_range(len(samples), start_sec, end_sec)
        window = samples[i0:i1]
        if window.size == 0:
            continue
        try:
            normed = zero_mean_unit_var_norm(window)
            logits = run_forward(normed)
            words = align_chunk_samples(logits, text, language, vocab)
            for w in words:
                all_words.append(
                    WordSpan(
                        text=w.text,
                        start_seconds=w.start_seconds + start_sec,
                        end_seconds=w.end_seconds + start_sec,
                        score=w.score,
                    )
                )
        except TooManyRepeats:
            n_fallback += 1
            all_words.extend(fallback_words_for_infeasible_chunk(chunk, language, vocab))
    dtos = [word_span_to_dto(w, idx) for idx, w in enumerate(all_words)]
    return dtos, {"nWords": len(dtos), "nChunks": len(chunks), "nFallbackChunks": n_fallback}
