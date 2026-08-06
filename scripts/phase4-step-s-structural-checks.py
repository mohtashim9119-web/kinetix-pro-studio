#!/usr/bin/env python3
"""
phase4-step-s-structural-checks.py — Phase 4 Step S: structural-check harness.

Standalone. Touches no `src/` file and is not part of the production build. It
implements all TWELVE structural checks specified (spec-only) in the Step O
known-defect inventory, so each can be proven to (a) trip on a deliberate poison
case and (b) run clean against the three real corpus projects except where a
known real defect exists.

Inputs are the Step M golden baselines, already committed:
    docs/phase4-baseline-{v6,173,spanish}-{segments,words,skipped,silences}.csv
plus one extra REAL fixture used only by the segment-320 question:
    v6-segments-full.json  (the STALE base.en-era snapshot every Phase 3 forced-
    alignment measurement windowed against)

Subcommands:
    poison  — every check against its own deliberate poison cases (must trip 100%)
    real    — every check against all three real projects (false positives reported)
    seg320  — every check against the stale segment-320 fixture, answering, per
              check, "would this have caught segment 320?"
    all     — all three, in order

THRESHOLD DISCIPLINE. Every numeric threshold below is derived from the clean
population of the three real corpora (stated at each constant) and was fixed
BEFORE the poison cases were written. Where a check produces false positives on
healthy data, the count is reported, not tuned away — per the standing
instruction that a check which fires on healthy data is worse than no check.
"""
import bisect
import csv
import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from statistics import median

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs"
STALE_V6 = Path("/Users/mohtashim/Downloads/All Projects Test Data/"
                "Projects Backend Data/v6-segments-full.json")

# ---------------------------------------------------------------- thresholds

# C1b. Observed max implied speaking rate across all 444+172+26 clean committed
# segments is 28.2 chars/sec (V6 28.1, 173 28.2, Spanish 19.4); p95 is ~19.
# 40 gives a 1.42x margin over the observed maximum and still sits far below any
# physiologically possible sustained rate. NOT fit to the poison case (80.3).
MAX_CHARS_PER_SEC = 40.0

# C2. A dead-to-script run must be sustained to count: the shortest confirmed
# unscripted heading recitation in the corpus consumes 2.79s (Step K's table).
# 1.5s is half that, so a genuine instance cannot slip under it.
DEAD_TO_SCRIPT_MIN_SEC = 1.5
# ...and attribution must be genuinely absent, not merely imperfect. 0.25 means
# fewer than a quarter of the tokens in the window are the segment's own words.
DEAD_TO_SCRIPT_MAX_ATTRIB = 0.25

# C3. Already specified numerically by Step E: 1.0s, taken from the clean
# correctly-matched population's own p99 (~530ms) doubled for margin.
MAX_ATTRIBUTION_DISTANCE_SEC = 1.0

# C4. A silence at or under this length, sitting inside one segment's own token
# run, is breath-shaped rather than boundary-shaped. The production detector's
# own floor is 0.25s (silenceDetector.ts minDurationSec); real inter-sentence
# pauses in this corpus median 0.40-0.70s. 0.45 sits between the two.
BREATH_MAX_SEC = 0.45

# C5. The scorer's own overlap gate, as shipped in measure-word-onset.py: an
# attributed word must reach the silence's own midpoint.
SCORER_MIN_OVERLAP_FRAC = 0.5

# C6. An ASR dropout shows as a RUN of consecutive fully-unmatched segments; an
# isolated skip is ordinary (a title card, a planted string, a one-word segment).
DROPOUT_MIN_RUN = 2

# C7. The shipped run-survival bands (syncConstants.ts).
def required_run_length(word_count: int) -> int:
    if word_count <= 3:
        return 1
    if word_count <= 10:
        return 2
    return 4

# C9. wav2vec2/MMS-FA emit one frame per 20ms (320 samples at 16kHz). CTC needs
# at least one frame per target symbol, plus a blank between any repeated pair.
CTC_FRAME_SEC = 0.02

# C10. A seam word is cross-attributed when it is the other segment's script word
# and not this one's. One such word is ordinary ASR/normalization slop; the check
# fires on the shape, and reports rather than adjudicates (Step O item 10).
SEAM_WINDOW_WORDS = 3
# Function words carry no attribution signal -- they occur in nearly every
# segment on both sides of every seam. English + Spanish, since the corpus spans
# both. Not tuned: this is the standard closed-class set for each language.
STOPWORDS = set("""
the and but for not you your his her its our their that this these those with
from into over under above then than when where what who whom which while
are was were been being have has had does did done will would can could should
que los las una uno del con por para pero como cuando donde sobre entre este
esta esto esos esas son era eran sido siendo tiene tienen habia hacer hace
""".split())

# C12. The gate under test.
NEGATIVE_SMEAR_GATE = 0.01


# ---------------------------------------------------------------- primitives

def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9\s]", " ", s)


def wordset(s: str):
    return set(norm(s).split())


def wordlist(s: str):
    return norm(s).split()


@dataclass
class Finding:
    check: str
    subject: str
    detail: str


@dataclass
class Corpus:
    name: str
    segments: list = field(default_factory=list)   # order,tag,text,start,dur,end
    words: list = field(default_factory=list)      # idx,text,s,e
    silences: list = field(default_factory=list)   # (start,end)
    skipped: list = field(default_factory=list)    # index,tag,text,matched,total,conf,run

    def tokens_in(self, a, b):
        return [w for w in self.words if a <= (w["s"] + w["e"]) / 2 < b]


def load_corpus(name: str) -> Corpus:
    c = Corpus(name)
    with open(DOCS / f"phase4-baseline-{name}-segments.csv") as f:
        c.segments = [dict(order=int(r["order"]), tag=r["tag"], text=r["text"],
                           start=float(r["startTime"]), dur=float(r["duration"]),
                           end=float(r["endTime"])) for r in csv.DictReader(f)]
    with open(DOCS / f"phase4-baseline-{name}-words.csv") as f:
        c.words = [dict(idx=int(r["idx"]), text=r["text"],
                        s=float(r["startSec"]), e=float(r["endSec"])) for r in csv.DictReader(f)]
    with open(DOCS / f"phase4-baseline-{name}-silences.csv") as f:
        c.silences = [(float(r["startSec"]), float(r["endSec"])) for r in csv.DictReader(f)]
    with open(DOCS / f"phase4-baseline-{name}-skipped.csv") as f:
        c.skipped = [dict(index=int(r["segmentIndex"]), tag=r["segmentTag"],
                          text=r["segmentText"], matched=int(r["matchedWords"]),
                          total=int(r["totalWords"]), conf=float(r["confidence"]),
                          run=int(r["longestRun"])) for r in csv.DictReader(f)]
    return c


# ---------------------------------------------------------------- the 12 checks

def c01_segment_alignability(c: Corpus):
    """Item 1 — zero-aligned-token segments AND implausible committed duration."""
    out = []
    mids = sorted((w["s"] + w["e"]) / 2 for w in c.words)
    for s in c.segments:
        if bisect.bisect_left(mids, s["start"]) == bisect.bisect_left(mids, s["end"]):
            out.append(Finding("C01", f"{c.name}#{s['order']}",
                               f"zero tokens inside committed span [{s['start']:.2f},{s['end']:.2f}]"))
        if s["dur"] > 0:
            rate = len(s["text"]) / s["dur"]
            if rate > MAX_CHARS_PER_SEC:
                out.append(Finding("C01", f"{c.name}#{s['order']}",
                                   f"implied {rate:.1f} chars/sec ({len(s['text'])} chars in "
                                   f"{s['dur']:.2f}s) exceeds {MAX_CHARS_PER_SEC}"))
    return out


def c02_dead_to_script(c: Corpus):
    """Item 2 — sustained transcript-covered, zero-script-mapped audio."""
    out = []
    for s in c.segments:
        toks = c.tokens_in(s["start"], s["end"])
        if not toks:
            continue
        # Attribution must be SUBSTRING-based, not word-set based: whisper's
        # `-ml 1` tokenizer routinely splits a word into sub-word fragments
        # ("Humidity" -> "Hum"+"idity", "tiene" -> "T"+"iene"), and a word-set
        # test scores every fragment as unscripted. Measured directly: word-set
        # attribution produced 8 false positives (4 on 173, 4 on Spanish), ALL
        # fragmentation artifacts. Pure-digit tokens are also treated as
        # attributed -- whisper writes spoken number-words as digits ("seis"->"6"),
        # an already-documented writing convention (Step 4's CER analysis), not
        # unscripted content.
        own_txt = " " + " ".join(norm(s["text"]).split()) + " "

        def attrib(t):
            frag = norm(t["text"]).strip()
            if not frag:
                return True
            if frag.isdigit():
                return True
            return frag in own_txt

        attributed = [attrib(t) for t in toks]
        # longest contiguous unattributed run, measured in SECONDS of audio
        best_a = best_b = run_a = None
        best = 0.0
        for i, ok in enumerate(attributed + [True]):
            if i < len(toks) and not ok:
                if run_a is None:
                    run_a = i
            elif run_a is not None:
                span = toks[i - 1]["e"] - toks[run_a]["s"]
                if span > best:
                    best, best_a, best_b = span, run_a, i - 1
                run_a = None
        frac = sum(attributed) / len(attributed)
        if best >= DEAD_TO_SCRIPT_MIN_SEC and frac <= 1 - DEAD_TO_SCRIPT_MAX_ATTRIB:
            heard = " ".join(t["text"] for t in toks[best_a:best_b + 1])[:70]
            out.append(Finding("C02", f"{c.name}#{s['order']}",
                               f"{best:.2f}s unscripted run inside segment "
                               f"(attribution {frac:.0%}): \"{heard}\""))
    return out


def _scorer_walk(c: Corpus, gated: bool = True):
    """The measurement harness's own ordinal greedy silence->word walk
    (measure-word-onset.py's score_onset_errors), reproduced so C03/C05 can be
    exercised against it. `gated=True` is the SHIPPED walk (with Step 1's overlap
    gate); `gated=False` is the PRE-FIX midpoint-only walk C05 audits against.
    Yields (silence, word) attributions."""
    pairs, wi = [], 0
    for (a, b) in c.silences:
        mid = (a + b) / 2
        while wi < len(c.words):
            w = c.words[wi]
            if (w["s"] + w["e"]) / 2 >= a and (w["e"] >= mid or not gated):
                pairs.append(((a, b), w))
                wi += 1
                break
            wi += 1
    return pairs


def c03_attribution_distance(c: Corpus):
    """Item 3 — stale-pause / detector-coverage-gap attribution."""
    out = []
    for (a, b), w in _scorer_walk(c):
        gap = w["s"] - b
        if gap > MAX_ATTRIBUTION_DISTANCE_SEC:
            out.append(Finding("C03", f"{c.name}@{b:.2f}",
                               f"attributed word '{w['text']}' sits {gap:.2f}s past the "
                               f"pause end (> {MAX_ATTRIBUTION_DISTANCE_SEC}s)"))
    return out


def c04_breath_boundary(c: Corpus):
    """Item 4 — breath-vs-boundary misclassification. FLAG FOR REVIEW ONLY."""
    out = []
    for s in c.segments[1:]:
        b = s["start"]
        hit = next((iv for iv in c.silences if iv[0] <= b <= iv[1]), None)
        if hit is None:
            continue
        if (hit[1] - hit[0]) > BREATH_MAX_SEC:
            continue
        # breath-shaped: short, AND sandwiched between two tokens of the SAME
        # segment's own committed span on at least one side
        before = [w for w in c.words if w["e"] <= hit[0]]
        after = [w for w in c.words if w["s"] >= hit[1]]
        if not before or not after:
            continue
        prev_seg = c.segments[c.segments.index(s) - 1]
        pb, na = before[-1], after[0]
        same_side = (prev_seg["start"] <= pb["s"] < prev_seg["end"]
                     and prev_seg["start"] <= na["s"] < prev_seg["end"]) or \
                    (s["start"] <= pb["s"] < s["end"] and s["start"] <= na["s"] < s["end"])
        if same_side:
            out.append(Finding("C04", f"{c.name}#{s['order']}",
                               f"boundary sits in a {hit[1]-hit[0]:.2f}s silence between two "
                               f"tokens of ONE segment's own run ('{pb['text']}'|'{na['text']}') "
                               f"— review, do not auto-correct"))
    return out


def c05_scorer_overlap_gate(c: Corpus):
    """Item 5 — the measurement harness's short-trailing-word misattribution.

    Audits the PRE-FIX (midpoint-only) walk: any attribution it makes that fails
    the shipped overlap gate is an instance of the "it." bug. Firing here means
    the corpus contains material that WOULD be misattributed by an ungated
    scorer — which is the property worth regression-locking, since the fix lives
    in the harness and a future re-measurement could silently drop it.
    """
    out = []
    # The defect is defined over WHOLE words. These baselines are whisper `-ml 1`
    # output, which is sub-word fragmented, so a fragment-vs-fragment
    # disagreement is a tokenizer artifact, not an instance of the "it." bug.
    # Restrict to candidates that are real words of some segment's own script.
    vocab = set()
    for s in c.segments:
        vocab |= set(wordlist(s["text"]))

    def real_word(w):
        t = norm(w["text"]).strip()
        return len(t) >= 2 and t in vocab

    out = []
    gated = {a: w for (a, _b), w in _scorer_walk(c, gated=True)}
    for (a, b), w in _scorer_walk(c, gated=False):
        if not real_word(w):
            continue
        # Only a DISAGREEMENT is a defect instance: the ungated walk attributing
        # a different word than the shipped gated walk. Flagging every
        # gate-failing attribution instead fires 219 times across the three
        # corpora against Step 1's 12 genuine instances -- measured, and
        # rejected as a false-positive machine.
        g = gated.get(a)
        if g is None or g["idx"] == w["idx"]:
            continue
        overlap = max(0.0, min(w["e"], b) - max(w["s"], a))
        frac = overlap / (b - a) if b > a else 0.0
        out.append(Finding("C05", f"{c.name}@{a:.2f}",
                           f"ungated walk picks '{w['text']}' ({frac:.0%} pause overlap); "
                           f"gated walk correctly picks '{g['text']}' — scorer misattribution"))
    return out


def c06_dropout_run(c: Corpus):
    """Item 6 — ASR content dropout (a RUN of consecutive fully-unmatched segments)."""
    out = []
    idxs = sorted(s["index"] for s in c.skipped if s["matched"] == 0)
    run = []
    for i in idxs + [None]:
        if run and i is not None and i == run[-1] + 1:
            run.append(i)
            continue
        if len(run) >= DROPOUT_MIN_RUN:
            out.append(Finding("C06", f"{c.name}#{run[0]}-{run[-1]}",
                               f"{len(run)} consecutive segments with zero matched words — "
                               f"ASR content dropout, not isolated skips"))
        run = [i] if i is not None else []
    return out


def c07_run_survival_consistency(c: Corpus):
    """Item 7 — the run-survival gate skipped only what it should have."""
    out = []
    for s in c.skipped:
        need = required_run_length(s["total"])
        if s["run"] >= need:
            out.append(Finding("C07", f"{c.name}#{s['index']}",
                               f"skipped despite longestRun {s['run']} >= required {need} "
                               f"for a {s['total']}-word segment — gate inconsistency"))
    return out


def c08_zero_duration_tokens(c: Corpus):
    """Item 8 — zero-duration real-word tokens (one of the four shipped gates)."""
    return [Finding("C08", f"{c.name}#tok{w['idx']}",
                    f"token '{w['text']}' has start == end == {w['s']}")
            for w in c.words if w["e"] <= w["s"] and norm(w["text"]).strip()]


def c09_ctc_fit(c: Corpus):
    """Item 9 — CTC constraint violation (target text cannot fit the window)."""
    out = []
    for s in c.segments:
        sym = len(re.sub(r"\s+", "", norm(s["text"])))
        frames = s["dur"] / CTC_FRAME_SEC
        if sym > frames:
            out.append(Finding("C09", f"{c.name}#{s['order']}",
                               f"{sym} CTC target symbols need > {frames:.0f} emission frames "
                               f"available in {s['dur']:.2f}s — must SKIP-AND-FLAG, not crash"))
    return out


def c10_seam_cross_attribution(c: Corpus):
    """Item 10 — script-break vs acoustic-break disagreement. FLAGS, never adjudicates."""
    out = []
    for i in range(1, len(c.segments)):
        prev, cur = c.segments[i - 1], c.segments[i]
        pw, cw = wordset(prev["text"]), wordset(cur["text"])
        tail = c.tokens_in(prev["start"], prev["end"])[-SEAM_WINDOW_WORDS:]
        head = c.tokens_in(cur["start"], cur["end"])[:SEAM_WINDOW_WORDS]
        if not tail or not head:
            continue

        # A seam word counts only if it is DISTINCTIVE: >=3 characters and not a
        # function word. Without this, common words present in both sides' text
        # ("the", "and", "it", "you") dominate and the check fires on 29 of 642
        # boundaries against 3 known defects. Even with it the check over-fires
        # -- see this file's own real-corpus report; C10 is NOT production-ready.
        def distinctive(t, mine, theirs):
            ws = {w for w in wordlist(t["text"]) if len(w) >= 3 and w not in STOPWORDS}
            return bool(ws & theirs) and not (ws & mine)

        bad = [t["text"] for t in tail if distinctive(t, pw, cw)]
        bad += [t["text"] for t in head if distinctive(t, cw, pw)]
        if len(bad) >= 2:
            out.append(Finding("C10", f"{c.name}#{cur['order']}",
                               f"{len(bad)} seam words attributed to the wrong side "
                               f"({' '.join(bad[:4])}) — script break and acoustic break disagree"))
    return out


def c11_lock_preservation(pre, post):
    """Item 11 — locks survive a resync (position AND flag). Pure; synthetic only."""
    out = []
    by_key = {s["key"]: s for s in post}
    for s in pre:
        if not s.get("locked"):
            continue
        p = by_key.get(s["key"])
        if p is None:
            out.append(Finding("C11", s["key"], "locked segment absent after resync"))
            continue
        if not p.get("locked"):
            out.append(Finding("C11", s["key"], "locked flag cleared by resync"))
        if abs(p["start"] - s["start"]) > 1e-6 or abs(p["dur"] - s["dur"]) > 1e-6:
            out.append(Finding("C11", s["key"],
                               f"locked position moved {s['start']:.2f}/{s['dur']:.2f} -> "
                               f"{p['start']:.2f}/{p['dur']:.2f}"))
    return out


def c12_smear_gate_discrimination(errors):
    """Item 12 — the negative-smear gate itself. Returns a finding when the gate
    CANNOT discriminate: i.e. when it rejects the distribution handed to it."""
    frac = sum(1 for e in errors if e < 0) / len(errors)
    if frac > NEGATIVE_SMEAR_GATE:
        return [Finding("C12", "negative-smear gate",
                        f"gate rejects this distribution at {frac:.1%} negative "
                        f"(> {NEGATIVE_SMEAR_GATE:.0%})")]
    return []


CHECKS = [
    ("C01", "zero-token / implausible-duration segment", c01_segment_alignability),
    ("C02", "dead-to-script run (unscripted heading)", c02_dead_to_script),
    ("C03", "stale-pause attribution distance", c03_attribution_distance),
    ("C04", "breath-vs-boundary (flag for review)", c04_breath_boundary),
    ("C05", "scorer short-trailing-word overlap gate", c05_scorer_overlap_gate),
    ("C06", "ASR dropout run", c06_dropout_run),
    ("C07", "run-survival gate consistency", c07_run_survival_consistency),
    ("C08", "zero-duration real-word tokens", c08_zero_duration_tokens),
    ("C09", "CTC target-fits-window precheck", c09_ctc_fit),
    ("C10", "seam cross-attribution (script vs acoustic)", c10_seam_cross_attribution),
]
# C11 and C12 do not take a Corpus — they are exercised separately (see below),
# stated openly rather than faked into the corpus-shaped loop.


# ---------------------------------------------------------------- poison cases

def poison_corpus(**over) -> Corpus:
    """A tiny, deliberately healthy synthetic corpus, then poisoned per check."""
    text = ["the boy walks home alone", "he opens the heavy door",
            "nothing inside has moved", "he sits down and waits"]
    segs, words, sils = [], [], []
    t, idx = 0.0, 0
    for i, tx in enumerate(text):
        dur = len(tx) / 15.0
        segs.append(dict(order=i, tag=f"{i:03d}_x", text=tx, start=t, dur=dur, end=t + dur))
        ws = tx.split()
        step = dur / len(ws)
        for j, w in enumerate(ws):
            words.append(dict(idx=idx, text=w, s=t + j * step, e=t + (j + 1) * step - 0.01))
            idx += 1
        if i < len(text) - 1:
            sils.append((t + dur - 0.30, t + dur + 0.30))
        t += dur
    c = Corpus("poison", segs, words, sils, [])
    for k, v in over.items():
        setattr(c, k, v)
    return c


def build_poisons():
    """(check_id, label, callable -> findings). Each MUST return >=1 finding."""
    cases = []

    # C01a — a segment whose committed span contains no token at all.
    c = poison_corpus()
    c.segments.append(dict(order=99, tag="099_ghost", text="nobody said this",
                           start=c.segments[-1]["end"] + 5.0, dur=1.5,
                           end=c.segments[-1]["end"] + 6.5))
    cases.append(("C01", "zero-token segment", lambda c=c: c01_segment_alignability(c)))

    # C01b — the real segment-320 shape: 102 chars in a 1.27s slot.
    c = poison_corpus()
    c.segments[1] = {**c.segments[1],
                     "text": "The problem is what happens when the body's warning "
                             "triggers a second signal that overrides the first.",
                     "dur": 1.27, "end": c.segments[1]["start"] + 1.27}
    cases.append(("C01", "implausible chars/sec (segment-320 shape)",
                  lambda c=c: c01_segment_alignability(c)))

    # C02 — an unscripted heading recitation spoken inside a segment's span.
    c = poison_corpus()
    s = c.segments[2]
    ins = [dict(idx=900 + k, text=w, s=s["start"] + 0.05 + k * 0.30,
                e=s["start"] + 0.05 + (k + 1) * 0.30 - 0.02)
           for k, w in enumerate("level nine the one who waits beneath".split())]
    s["dur"] += 2.5
    s["end"] += 2.5
    c.words = [w for w in c.words if not (s["start"] <= w["s"] < s["end"])] + ins
    c.words.sort(key=lambda w: w["s"])
    cases.append(("C02", "unscripted heading recitation", lambda c=c: c02_dead_to_script(c)))

    # C03 — the detector-coverage-gap shape: the ONLY detected silence sits well
    # before the true onset, so the walk's nearest available word is 2.4s away
    # and there is no closer candidate anywhere (segments 1/307/383's mechanism).
    c = poison_corpus()
    c.silences = [(1.0, 1.4)]
    c.words = [dict(idx=0, text="alone", s=0.4, e=0.9),
               dict(idx=1, text="he", s=3.8, e=4.0)]
    cases.append(("C03", "stale attribution 2.4s past the pause",
                  lambda c=c: c03_attribution_distance(c)))

    # C04 — the boundary lands in a 0.20s intra-segment breath.
    c = poison_corpus()
    s = c.segments[1]
    inner = [w for w in c.words if s["start"] <= w["s"] < s["end"]]
    br = (inner[1]["e"] + 0.01, inner[1]["e"] + 0.21)
    c.silences.append(br)
    c.segments[2] = {**c.segments[2], "start": (br[0] + br[1]) / 2}
    cases.append(("C04", "boundary inside an intra-segment breath",
                  lambda c=c: c04_breath_boundary(c)))

    # C05 — an "it."-shaped 60ms word barely poking into a 1.35s pause.
    c = poison_corpus()
    a = c.segments[1]["end"] + 0.10
    c.silences = [(a, a + 1.35)]
    c.words = [dict(idx=0, text="it", s=a + 0.02, e=a + 0.08),
               dict(idx=1, text="he", s=a + 1.40, e=a + 1.60)]
    cases.append(("C05", "short trailing word claims a long pause",
                  lambda c=c: c05_scorer_overlap_gate(c)))

    # C06 — three consecutive fully-unmatched segments (the dropout shape).
    c = poison_corpus(skipped=[dict(index=i, tag=f"{i}", text="x", matched=0,
                                    total=5, conf=0.0, run=0) for i in (7, 8, 9)])
    cases.append(("C06", "3-segment consecutive dropout", lambda c=c: c06_dropout_run(c)))

    # C07 — a skip recorded despite the run requirement being met.
    c = poison_corpus(skipped=[dict(index=4, tag="4", text="x", matched=4,
                                    total=6, conf=0.7, run=5)])
    cases.append(("C07", "skip despite a qualifying run",
                  lambda c=c: c07_run_survival_consistency(c)))

    # C08 — a zero-duration real word.
    c = poison_corpus()
    c.words[3] = {**c.words[3], "e": c.words[3]["s"]}
    cases.append(("C08", "zero-duration token", lambda c=c: c08_zero_duration_tokens(c)))

    # C09 — 63 CTC target symbols in a 1.27s window (segment 320's own mechanism).
    c = poison_corpus()
    c.segments[1] = {**c.segments[1],
                     "text": "The problem is what happens when the body's warning "
                             "triggers a second signal that overrides the first.",
                     "dur": 1.27, "end": c.segments[1]["start"] + 1.27}
    cases.append(("C09", "CTC targets exceed available frames", lambda c=c: c09_ctc_fit(c)))

    # C10 — the boundary shifted left by two words, so the seam cross-attributes.
    c = poison_corpus()
    inner = [w for w in c.words if c.segments[1]["start"] <= w["s"] < c.segments[1]["end"]]
    shift = inner[-2]["s"]
    c.segments[1] = {**c.segments[1], "end": shift, "dur": shift - c.segments[1]["start"]}
    c.segments[2] = {**c.segments[2], "start": shift,
                     "dur": c.segments[2]["end"] - shift}
    cases.append(("C10", "boundary shifted two words left",
                  lambda c=c: c10_seam_cross_attribution(c)))

    # C11 — the confirmed K13 repro: resync clears the lock flag and resets position.
    pre = [dict(key="a", locked=True, start=10.0, dur=2.0),
           dict(key="b", locked=True, start=12.0, dur=2.0)]
    post = [dict(key="a", locked=False, start=9.4, dur=2.6),
            dict(key="b", locked=False, start=12.0, dur=2.0)]
    cases.append(("C11", "resync clears lock flag + resets position",
                  lambda: c11_lock_preservation(pre, post)))

    # C12 — the gate handed an ACCURATE, symmetric-noise distribution. The poison
    # here is healthy data: a check that "trips" proves the GATE is the defect.
    import random
    random.seed(1)
    acc = [random.gauss(0, 0.020) for _ in range(500)]
    cases.append(("C12", "gate rejects an accurate symmetric-noise source",
                  lambda acc=acc: c12_smear_gate_discrimination(acc)))
    return cases


# ---------------------------------------------------------------- runners

def cmd_poison():
    print("== POISON CASES (each must trip) ==\n")
    rows, ok_all = [], True
    for cid, label, fn in build_poisons():
        found = [f for f in fn() if f.check == cid] or fn()
        tripped = len(found) > 0
        ok_all &= tripped
        rows.append((cid, label, len(found), tripped))
        print(f"  {cid}  {'TRIP' if tripped else 'MISS':>4}  n={len(found):<3} {label}")
        if found:
            print(f"        e.g. {found[0].detail[:96]}")
    print(f"\nPOISON RESULT: {sum(1 for r in rows if r[3])}/{len(rows)} tripped "
          f"-> {'PASS (100%)' if ok_all else 'FAIL'}")
    return rows


def cmd_real():
    print("\n== REAL CORPORA (clean unless a KNOWN defect exists) ==\n")
    corpora = [load_corpus(n) for n in ("v6", "173", "spanish")]
    table = {}
    for cid, label, fn in CHECKS:
        per = {}
        for c in corpora:
            per[c.name] = fn(c)
        table[cid] = (label, per)
        tot = sum(len(v) for v in per.values())
        print(f"  {cid}  {label}")
        print(f"        v6={len(per['v6']):<4} 173={len(per['173']):<4} "
              f"spanish={len(per['spanish']):<4} total={tot}")
        for name, fs in per.items():
            for f in fs[:6]:
                print(f"          [{name}] {f.subject}: {f.detail[:100]}")
            if len(fs) > 6:
                print(f"          [{name}] ... and {len(fs)-6} more")
    print("\n  C11  lock preservation — NOT RUNNABLE against the three baselines: no")
    print("       committed baseline contains a locked segment (locks are cleared by")
    print("       resync, K13, so a post-sync snapshot structurally cannot carry one).")
    print("       Proven on synthetic fixtures only; stated, not faked.")
    v6 = corpora[0]
    print("\n  C12  negative-smear gate — run against each project's own committed")
    print("       boundary-vs-nearest-silence signed errors:")
    for c in corpora:
        errs = []
        for s in c.segments[1:]:
            b = s["start"]
            near = min(c.silences, key=lambda iv: min(abs(b - iv[0]), abs(b - iv[1])))
            errs.append(b - near[1])
        f = c12_smear_gate_discrimination(errs)
        neg = sum(1 for e in errs if e < 0) / len(errs)
        med = median(abs(e) for e in errs)
        print(f"        {c.name}: negative {neg:.1%}, median |err| {med*1000:.0f}ms -> "
              f"{'GATE REJECTS' if f else 'gate accepts'}")
    return table


def cmd_seg320():
    print("\n== SEGMENT 320, against the STALE base.en-era fixture ==\n")
    segs = json.loads(STALE_V6.read_text())
    stale = Corpus("stale-v6")
    stale.segments = [dict(order=i, tag=f"{i}", text=s.get("text") or "",
                           start=float(s.get("startTime", 0)), dur=float(s.get("duration", 0)),
                           end=float(s.get("startTime", 0)) + float(s.get("duration", 0)))
                      for i, s in enumerate(segs)]
    live = load_corpus("v6")
    stale.words, stale.silences, stale.skipped = live.words, live.silences, live.skipped

    target = 319  # 0-based index of "segment 320" in the stale 447-segment array
    for cid, label, fn in CHECKS:
        fs = fn(stale)
        hit = [f for f in fs if f.subject.endswith(f"#{target}")]
        verdict = "CATCHES" if hit else "no"
        print(f"  {cid}  {verdict:>8}  {label}")
        if hit:
            print(f"            {hit[0].detail[:110]}")
    print("\n  C11  no  — lock preservation is orthogonal to this defect.")
    print("  C12  no  — the smear gate reads sign only, at any magnitude.")


def cmd_csv():
    """Dump every real-corpus finding to docs/ for the record."""
    rows = []
    for name in ("v6", "173", "spanish"):
        c = load_corpus(name)
        for cid, label, fn in CHECKS:
            for f in fn(c):
                rows.append({"check": cid, "check_label": label, "project": name,
                             "subject": f.subject, "detail": f.detail})
    out = DOCS / "phase4-step-s-check-results.csv"
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["check", "check_label", "project", "subject", "detail"])
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {len(rows)} findings -> {out}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd == "csv":
        cmd_csv()
        sys.exit(0)
    if cmd in ("poison", "all"):
        cmd_poison()
    if cmd in ("real", "all"):
        cmd_real()
    if cmd in ("seg320", "all"):
        cmd_seg320()
