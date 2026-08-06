#!/usr/bin/env python3
"""
phase4-step-x-verify.py — Phase 4 Step X: the manual verification harness.
Extended at the K14 implementation commit (Step AD) with a 14th rule, C13.

ONE COMMAND, NO ARGUMENTS. Walks all FOURTEEN structural rules in front of you.
For each rule it says, in plain language, what the rule checks and why that
matters, then runs it TWICE:

    POISON HALF  — a deliberately broken input where the rule MUST fire.
    REAL HALF    — real corpus data where the rule MUST stay quiet.

and prints the rule name, the input, what the rule actually saw, and PASS/FAIL
for each half. Where a rule's defect is audible it exports a short clip so you
can hear what it caught. Where a rule is backed by ear-verified data it cites
the clip and the human timestamp. It finishes with a tally and an honest
evidence-strength grade per rule — including the rules that rest on weaker
evidence than the others, named as such.

Two rules are INVERTED and say so on screen: C11's real half is a live
reproduction of a defect that is STILL present (K13 is unfixed, so "quiet" is
not available), and C12's poison IS healthy data (a rule that fires on it
proves the gate under test is the defect). Neither is finessed. C13 (new)
looks like C11 mechanically — both re-run a live vitest artifact — but is NOT
inverted: K14 is fixed, so its real half genuinely stays quiet.

Run:  .venv-phase4/bin/python scripts/phase4-step-x-verify.py
      (any python3 with no third-party imports works; numpy is not needed here)

Typical runtime: about a minute. Hard budget: 15 minutes.
"""
import csv
import importlib.util
import json
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs"
WORK = REPO / ".work-phase4"
CLIPS = WORK / "step-x-clips"
C11_ARTIFACT = WORK / "step-w-c11-live-repro.json"
K13_TEST = "scripts/phase4-step-w-k13-repro.test.ts"
C13_ARTIFACT = WORK / "step-aa-c13-live-repro.json"
K14_TEST = "scripts/phase4-step-aa-unlock-repro.test.ts"

FFMPEG = REPO / "src-tauri" / "binaries" / "ffmpeg-x86_64-apple-darwin"
AUDIO = {
    "v6": Path("/Users/mohtashim/Downloads/All Projects Test Data/"
               "V6 Natural Long Pause Segs/6.m4a"),
    "173": Path("/Users/mohtashim/Downloads/All Projects Test Data/"
                "173 Segs Project/voiceover.m4a"),
    "spanish": Path("/Users/mohtashim/Downloads/All Projects Test Data/"
                    "Spanish Project/Spanish VOiceover.m4a"),
}

BAR = "=" * 94
SEP = "-" * 94


def load_stepS():
    spec = importlib.util.spec_from_file_location(
        "stepS", REPO / "scripts" / "phase4-step-s-structural-checks.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


S = load_stepS()
CORPORA = {}


def corpus(name):
    if name not in CORPORA:
        CORPORA[name] = S.load_corpus(name)
    return CORPORA[name]


# ------------------------------------------------------------------ audio

_clip_log = []


def export_clip(project, start, end, name, listen_for):
    """Cut [start,end] out of a corpus voiceover. Best-effort: a missing source
    or ffmpeg binary is reported, never fatal."""
    CLIPS.mkdir(parents=True, exist_ok=True)
    src = AUDIO.get(project)
    out = CLIPS / f"{name}.wav"
    if src is None or not src.exists() or not FFMPEG.exists():
        _clip_log.append((name, None, f"source unavailable ({project})", listen_for))
        return None
    start = max(0.0, start)
    cmd = [str(FFMPEG), "-y", "-v", "error", "-ss", f"{start:.3f}",
           "-t", f"{max(0.5, end - start):.3f}", "-i", str(src),
           "-ac", "1", "-ar", "22050", str(out)]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=120)
    except Exception as e:  # noqa: BLE001 — clip export must never break the run
        _clip_log.append((name, None, f"ffmpeg failed: {e}", listen_for))
        return None
    _clip_log.append((name, out, f"{project} {start:.2f}-{end:.2f}s", listen_for))
    return out


# ------------------------------------------------------------------ helpers

def norm_words(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9\s]", " ", s).split()


def seg_by_order(name, order):
    for s in corpus(name).segments:
        if s["order"] == order:
            return s
    return None


def fa_rows(proj, corrected=False):
    return S.load_fa_rows(proj, corrected)


def ear_verified():
    """Latest owner verdict per boundary, resolved to segment indices."""
    rows = list(csv.DictReader((DOCS / "verification-baseline.csv").open()))
    latest = {}
    for r in rows:
        latest[(r["script_word_key"], r["project"])] = r
    proj_map = {"V6-447": "v6", "173-seg": "173"}
    keymaps = {}
    for name in ("v6", "173"):
        segs = corpus(name).segments
        km = {}
        for i in range(1, len(segs)):
            k = (" ".join(norm_words(segs[i - 1]["text"])[-3:]) + " || "
                 + " ".join(norm_words(segs[i]["text"])[:3]))
            km.setdefault(k, []).append(i)
        keymaps[name] = km
    defects, controls, unresolved = {}, {}, []
    for (key, proj), r in latest.items():
        name = proj_map.get(proj)
        if name is None or r["verdict"] == "" or r["verdict"].startswith(("N/A", "unverified")):
            continue
        idxs = keymaps[name].get(key)
        if not idxs:
            unresolved.append((proj, key))
            continue
        (defects if r["verdict"].startswith(("word-shifted", "FAIL")) else controls) \
            .setdefault(name, {}).update({i: (key, r["verdict"]) for i in idxs})
    return defects, controls, unresolved


DEFECTS, CONTROLS, UNRESOLVED = None, None, None


# ------------------------------------------------------------------ reporting

RESULTS = []


def rule(rid, title, what, why, grade, grade_note):
    print("\n" + SEP)
    print(f"RULE {rid} — {title}")
    print(SEP)
    print(f"  WHAT IT CHECKS : {what}")
    print(f"  WHY IT MATTERS : {why}")
    print(f"  EVIDENCE GRADE : {grade} — {grade_note}")


def half(label, must, inp, saw, ok, note=None):
    verdict = "PASS" if ok else "FAIL"
    print(f"\n  {label} (must {must})")
    print(f"    input  : {inp}")
    print(f"    saw    : {saw}")
    if note:
        print(f"    note   : {note}")
    print(f"    result : {verdict}")
    return ok


def record(rid, poison_ok, real_ok, grade, ci, extra=None):
    RESULTS.append(dict(rid=rid, poison=poison_ok, real=real_ok, grade=grade, ci=ci,
                        extra=extra))


def audio_line(clip_name):
    for name, path, where, listen in _clip_log:
        if name == clip_name:
            if path is None:
                print(f"  AUDIO          : not exported — {where}")
            else:
                print(f"  AUDIO          : {path.relative_to(REPO)}  ({where})")
                print(f"                   listen for: {listen}")
            return


def ear_line(text):
    print(f"  EAR-VERIFIED   : {text}")


# ------------------------------------------------------------------ the rules

def poison_for(cid, which=0):
    """Return the nth poison callable registered for a check id."""
    hits = [fn for c, _l, fn in S.build_poisons() if c == cid]
    return hits[which]


def run_c01a():
    rule("C01a", "a segment whose slot contains no spoken words at all",
         "every committed segment's time slot must contain at least one transcribed word",
         "a slot with no words is a scene shown over silence or over someone else's "
         "audio — the\n                   viewer sees a picture with nothing to explain it",
         "C", "clean on all 3 corpora but no LIVE instance exists, so its sensitivity is unproven")
    f = poison_for("C01", 0)()
    zero = [x for x in f if "zero tokens" in x.detail]
    p = half("POISON HALF", "FIRE", "a synthetic 4-segment timeline plus one extra segment "
             "placed 5s past the last word",
             f"{len(zero)} finding(s): {zero[0].detail if zero else 'none'}", bool(zero))
    tot = {n: len([x for x in S.c01_segment_alignability(corpus(n)) if "zero tokens" in x.detail])
           for n in ("v6", "173", "spanish")}
    r = half("REAL HALF", "STAY QUIET", "all 642 committed segments across V6 / 173 / Spanish",
             f"{sum(tot.values())} findings {tot}", sum(tot.values()) == 0)
    record("C01a", p, r, "C", "IN")


def run_c01b():
    rule("C01b", "a segment given far too little time for the words it holds",
         "implied speaking rate must stay under 40 characters/second",
         "if 100 characters are squeezed into 1.3 seconds, the words physically cannot "
         "have been\n                   spoken there — the slot is wrong, and everything "
         "downstream of it inherits that",
         "C", "clean on all 3 corpora; the one real instance (segment 320) is LATENT, "
         "fixed by the\n                   Phase 2a model swap, so it is only demonstrable "
         "on the stale fixture")
    f = poison_for("C01", 1)()
    rate = [x for x in f if "chars/sec" in x.detail]
    p = half("POISON HALF", "FIRE", "the real segment-320 shape: 102 characters in a 1.27s slot",
             f"{len(rate)} finding(s): {rate[0].detail if rate else 'none'}", bool(rate))
    tot = {n: len([x for x in S.c01_segment_alignability(corpus(n)) if "chars/sec" in x.detail])
           for n in ("v6", "173", "spanish")}
    r = half("REAL HALF", "STAY QUIET", "all 642 committed segments; fastest real segment is "
             "28.2 chars/sec",
             f"{sum(tot.values())} findings {tot}", sum(tot.values()) == 0,
             "against the STALE pre-Phase-2a V6 snapshot this rule produces exactly one "
             "finding,\n             and it is segment 320 — perfect precision on the one "
             "corpus where the defect is live")
    record("C01b", p, r, "C", "IN")


def run_c02():
    rule("C02", "words on the audio that appear nowhere in the script",
         "a sustained (>=1.5s) run of transcribed audio with under 25% attribution to the "
         "segment's own text",
         "these are the spoken chapter headings the narrator recites but nobody wrote down. "
         "Their\n                   seconds get shoved onto a neighbour, and that neighbour's "
         "picture holds too long",
         "B", "fires on 6 genuine V6 headings and nothing else; ground truth is this "
         "programme's own\n                   transcript audit, not an independent ear")
    f = [x for x in poison_for("C02")() if x.check == "C02"]
    p = half("POISON HALF", "FIRE", "a synthetic segment with \"level nine the one who waits "
             "beneath\" spoken inside it",
             f"{len(f)} finding(s): {f[0].detail if f else 'none'}", bool(f))
    quiet = {n: len(S.c02_dead_to_script(corpus(n))) for n in ("173", "spanish")}
    v6 = S.c02_dead_to_script(corpus("v6"))
    r = half("REAL HALF", "STAY QUIET", "173 + Spanish — neither project contains an "
             "unscripted heading",
             f"{sum(quiet.values())} findings {quiet}", sum(quiet.values()) == 0,
             f"V6 separately produces {len(v6)} findings and every one is a real heading "
             f"recitation.\n             Recall there is 6 of 10 known headings — the other 4 "
             f"are diluted below the 1.5s floor")
    if v6:
        order = int(v6[0].subject.split("#")[1])
        s = seg_by_order("v6", order)
        if s:
            export_clip("v6", s["start"] - 0.5, min(s["start"] + 7.0, s["end"] + 0.5),
                        "C02_v6_unscripted_heading",
                        "the narrator says a chapter title that is in no script line")
            audio_line("C02_v6_unscripted_heading")
    record("C02", p, r, "B", "IN")


def run_c03():
    rule("C03", "a pause matched to a word that is nowhere near it",
         "the word attributed to a detected pause must begin within 1.0s of that pause ending",
         "if the nearest word is seconds away, either the pause is stale or the words in "
         "between\n                   were never transcribed. Both make every timing derived "
         "from that pause fiction",
         "B", "one finding on V6 and it independently rediscovers the known flash-attention "
         "dropout;\n                   zero elsewhere")
    f = [x for x in poison_for("C03")() if x.check == "C03"]
    p = half("POISON HALF", "FIRE", "a timeline whose only detected silence sits 2.4s before "
             "the nearest word",
             f"{len(f)} finding(s): {f[0].detail if f else 'none'}", bool(f))
    quiet = {n: len(S.c03_attribution_distance(corpus(n))) for n in ("173", "spanish")}
    v6 = S.c03_attribution_distance(corpus("v6"))
    r = half("REAL HALF", "STAY QUIET", "173 + Spanish, every detected pause",
             f"{sum(quiet.values())} findings {quiet}", sum(quiet.values()) == 0,
             f"V6 produces {len(v6)}: {v6[0].detail if v6 else ''} — the known dropout, "
             f"not a false positive")
    export_clip("v6", 78.5, 89.2, "C03_v6_dropout_window",
                "roughly ten seconds where the model transcribed almost nothing that was said")
    audio_line("C03_v6_dropout_window")
    record("C03", p, r, "B", "IN")


def run_c04():
    rule("C04", "a cut placed inside a breath instead of at the real gap",
         "a boundary must not land in a short (<=0.45s) silence sitting between two words of "
         "ONE segment's own run",
         "a breath mid-sentence looks like a pause. Cutting there steals the end of a "
         "sentence onto\n                   the next picture — the single most common "
         "complaint this programme has chased",
         "C", "zero findings on all 3 corpora, which is consistent with the shipped "
         "index-based breath\n                   fix having worked — but it has never been "
         "run against a corpus where the defect is live")
    f = [x for x in poison_for("C04")() if x.check == "C04"]
    p = half("POISON HALF", "FIRE", "a boundary dropped into a 0.20s breath between two words "
             "of the same sentence",
             f"{len(f)} finding(s): {f[0].detail if f else 'none'}", bool(f))
    tot = {n: len(S.c04_breath_boundary(corpus(n))) for n in ("v6", "173", "spanish")}
    r = half("REAL HALF", "STAY QUIET", "every interior boundary in all 3 corpora",
             f"{sum(tot.values())} findings {tot}", sum(tot.values()) == 0,
             "this is the WEAKEST 'quiet' result in the set: quiet here proves the corpus is "
             "clean,\n             not that the rule would catch a dirty one")
    ear_line("173 \u201cThey\u2019re the || worst\u201d (segment 5-6) — owner verdict word-shifted, the exact "
             "fixture the\n                   curr-side seam exemption was disabled over "
             "(docs/verification-baseline.csv)")
    ear_line("Spanish Step U labels — audible breaths at clip3_02 1.571-1.758s, clip3_03 "
             "1.652-1.804s,\n                   clip3_07 1.211-1.423s, clip3_08 1.227-1.375s, "
             "clip3_09 1.240-1.433s (.listening-clips/spanish-batch/)")
    s5 = seg_by_order("173", 5)
    if s5:
        export_clip("173", s5["start"] - 2.5, s5["start"] + 2.5, "C04_173_breath_boundary",
                    "\"They're the worst\" — the cut falls after a breath, not at the sentence gap")
        audio_line("C04_173_breath_boundary")
    record("C04", p, r, "C", "IN")


def run_c05():
    rule("C05", "the measuring tape blaming the wrong word for a pause",
         "a word credited with following a pause must END at or past that pause's midpoint",
         "a 60ms word like \"it.\" can look like it starts a pause when it actually ENDED the "
         "sentence\n                   before it. Every accuracy number this programme reports "
         "is computed off that choice",
         "A", "13 of 13 labelled instances caught, 0 false positives across 696 real scored "
         "pauses")
    f = [x for x in poison_for("C05")() if x.check == "C05"]
    p = half("POISON HALF", "FIRE", "one 60ms word \"it.\" against a 1.35s pause, plus a healthy "
             "control row beside it",
             f"{len(f)} finding(s) (control row correctly ignored): "
             f"{f[0].detail[:88] if f else 'none'}", len(f) == 1)
    tp = fn = fp = tot = 0
    detail = {}
    for proj in ("v6", "173"):
        rows = fa_rows(proj)
        truth = S.c05_labelled_truth(proj)
        found = {round(float(x.subject[1:]), 6) for x in S.c05_scorer_gate(rows)}
        tp += len(truth & found)
        fn += len(truth - found)
        fp += len(found - truth)
        tot += len(rows)
        detail[proj] = f"{len(truth & found)}/{len(truth)} caught, {len(found - truth)} FP"
    r = half("REAL HALF", "STAY QUIET", f"{tot} real forced-alignment attributions "
             "(V6 + 173), of which 13 are labelled defects",
             f"{fp} false positives; recall {tp}/{tp + fn}  {detail}", fp == 0 and fn == 0,
             "ground truth is the diff between the committed pre-fix and post-fix scorer "
             "outputs —\n             independent of this rule's own logic")
    export_clip("v6", 64.1, 67.6, "C05_v6_it_trailing_word",
                "\"...it.\" then a long pause then the next sentence — the 60ms word is the "
                "one that was blamed")
    audio_line("C05_v6_it_trailing_word")
    record("C05", p, r, "A", "IN (measurement-harness CI, not the app's)")


def run_c06():
    rule("C06", "a stretch of script the model simply did not hear",
         "two or more CONSECUTIVE segments with zero matched words",
         "one skipped segment is ordinary. A run of them means the transcript lost content, "
         "and every\n                   boundary in that stretch is being computed from "
         "nothing",
         "B", "one finding on V6 (segments 26-28, the known dropout), zero elsewhere; "
         "corroborated\n                   independently by C03 from a different signal")
    f = [x for x in poison_for("C06")() if x.check == "C06"]
    p = half("POISON HALF", "FIRE", "three consecutive segments with zero matched words",
             f"{len(f)} finding(s): {f[0].detail if f else 'none'}", bool(f))
    quiet = {n: len(S.c06_dropout_run(corpus(n))) for n in ("173", "spanish")}
    v6 = S.c06_dropout_run(corpus("v6"))
    r = half("REAL HALF", "STAY QUIET", "173 + Spanish skip records",
             f"{sum(quiet.values())} findings {quiet}", sum(quiet.values()) == 0,
             f"V6 produces {len(v6)}: {v6[0].detail if v6 else ''}")
    record("C06", p, r, "B", "IN")


def run_c07():
    rule("C07", "the skip rule dropping a segment it should have kept",
         "no segment may be recorded as skipped when its longest matched run already meets "
         "the required length",
         "if the gate contradicts itself, segments vanish from the timeline for no stated "
         "reason and\n                   the user has no way to tell why",
         "C", "clean on all 3 corpora; no live instance has ever been observed, so this is "
         "an invariant\n                   guard rather than a tested detector")
    f = [x for x in poison_for("C07")() if x.check == "C07"]
    p = half("POISON HALF", "FIRE", "a skip recorded for a 6-word segment whose longest run is "
             "5 (required: 2)",
             f"{len(f)} finding(s): {f[0].detail if f else 'none'}", bool(f))
    tot = {n: len(S.c07_run_survival_consistency(corpus(n))) for n in ("v6", "173", "spanish")}
    r = half("REAL HALF", "STAY QUIET", "every skip record in all 3 corpora",
             f"{sum(tot.values())} findings {tot}", sum(tot.values()) == 0)
    record("C07", p, r, "C", "IN")


def run_c08():
    rule("C08", "a word with no duration at all",
         "no real-word token may have start == end",
         "a zero-length word is a corrupt timestamp. It cannot be positioned, and anything "
         "that\n                   averages or interpolates around it produces garbage silently",
         "C", "clean on all 3 corpora; a cheap structural invariant, never yet seen to fire "
         "on real data")
    f = [x for x in poison_for("C08")() if x.check == "C08"]
    p = half("POISON HALF", "FIRE", "one token whose start equals its end",
             f"{len(f)} finding(s): {f[0].detail if f else 'none'}", bool(f))
    tot = {n: len(S.c08_zero_duration_tokens(corpus(n))) for n in ("v6", "173", "spanish")}
    r = half("REAL HALF", "STAY QUIET", "all transcribed tokens in all 3 corpora",
             f"{sum(tot.values())} findings {tot}", sum(tot.values()) == 0)
    record("C08", p, r, "C", "IN")


def run_c09():
    rule("C09", "asking the aligner to fit more letters than there are audio frames",
         "the number of target symbols must not exceed the emission frames the window provides "
         "(one per 20ms)",
         "when it does, the aligner cannot produce a valid path. Today that surfaces as a "
         "crash or a\n                   wild misplacement rather than as a clear 'this slot "
         "is too short' message",
         "C", "clean on all 3 corpora; like C01b its one real instance is latent, provable "
         "only against\n                   the stale pre-Phase-2a fixture")
    f = [x for x in poison_for("C09")() if x.check == "C09"]
    p = half("POISON HALF", "FIRE", "84 target symbols against the 64 frames a 1.27s window has",
             f"{len(f)} finding(s): {f[0].detail if f else 'none'}", bool(f))
    tot = {n: len(S.c09_ctc_fit(corpus(n))) for n in ("v6", "173", "spanish")}
    r = half("REAL HALF", "STAY QUIET", "all 642 committed segments",
             f"{sum(tot.values())} findings {tot}", sum(tot.values()) == 0,
             "on the stale V6 fixture this rule produces exactly one finding, and it is "
             "segment 320")
    record("C09", p, r, "C", "IN")


def run_c10():
    rule("C10", "a cut that puts a word on the wrong side of the seam",
         "the words either side of a boundary should belong to the script text on their own side",
         "this is the word-shift complaint: the cut is clean, but a word or two ends up under "
         "the\n                   wrong picture. It is the defect the owner hears most often",
         "D", "FAILS. Validated against the owner's own listening verdicts and it catches "
         "0 of 4.\n                   A rule that misses every defect it was written for is "
         "not a detector")
    f = [x for x in poison_for("C10")() if x.check == "C10"]
    p = half("POISON HALF", "FIRE", "a boundary deliberately shifted two words to the left",
             f"{len(f)} finding(s): {f[0].detail if f else 'none'}", bool(f))
    found = {}
    for n in ("v6", "173"):
        found[n] = {int(x.subject.split("#")[1]) for x in S.c10_seam_cross_attribution(corpus(n))}
    ctrl_hits = sum(len(found[n] & set(CONTROLS.get(n, {}))) for n in ("v6", "173"))
    def_hits = sum(len(found[n] & set(DEFECTS.get(n, {}))) for n in ("v6", "173"))
    n_def = sum(len(DEFECTS.get(n, {})) for n in ("v6", "173"))
    n_ctrl = sum(len(CONTROLS.get(n, {})) for n in ("v6", "173"))
    r = half("REAL HALF", "STAY QUIET", f"{n_ctrl} boundaries the owner listened to and "
             "called CORRECT",
             f"{ctrl_hits} fires on ear-verified-correct boundaries", ctrl_hits == 0,
             "quiet, but see the third half below — quiet alone is not enough for this rule")
    rec = half("RECALL HALF", "FIND THE KNOWN DEFECTS",
               f"the {n_def} boundaries the owner listened to and called WORD-SHIFTED",
               f"{def_hits} of {n_def} found", def_hits > 0,
               "this is the half that decides it. Quiet AND blind: a rule nobody can act on "
               "is\n             worse than no rule. C10 stays OUT of CI")
    for n in ("v6", "173"):
        for i, (key, verdict) in sorted(DEFECTS.get(n, {}).items())[:3]:
            ear_line(f"{n} #{i} \"{key}\" — owner verdict: {verdict[:44]}")
    v6f = sorted(found["v6"])
    if v6f:
        s = seg_by_order("v6", v6f[0])
        if s:
            export_clip("v6", s["start"] - 3.0, s["start"] + 3.0, "C10_v6_unadjudicated_seam",
                        "the one boundary C10 flags on V6 — no ear verdict exists for it either way")
            audio_line("C10_v6_unadjudicated_seam")
    record("C10", p, r, "D", "OUT", extra=("recall", rec))


def run_c11():
    rule("C11", "a locked segment surviving a re-sync",
         "a segment you locked must keep both its lock flag and its exact position after "
         "Apply Sync",
         "you lock a segment because you fixed it by hand. Losing that silently means your "
         "manual work\n                   is discarded every time you re-sync, with no warning",
         "A", "backed by a LIVE reproduction against production code and the real 173 project, "
         "not a\n                   hand-written fixture")
    f = poison_for("C11")()
    p = half("POISON HALF", "FIRE", "a resync that clears the lock flag and moves the segment",
             f"{len(f)} finding(s): {f[0].detail if f else 'none'}", bool(f))
    print("\n  REAL HALF is INVERTED for this rule, and that is stated rather than finessed:")
    print("  K13 is an OPEN defect, so there is no clean corpus for it to stay quiet on. The")
    print("  real half instead re-runs the live repro and requires it to still reproduce.")
    ok = False
    started = time.time()
    try:
        proc = subprocess.run(["npx", "vitest", "run", K13_TEST], cwd=REPO,
                              capture_output=True, text=True, timeout=420)
        ran = proc.returncode == 0
    except Exception as e:  # noqa: BLE001
        ran = False
        proc = None
        print(f"    (could not run vitest: {e})")
    art = json.loads(C11_ARTIFACT.read_text()) if C11_ARTIFACT.exists() else None
    if art:
        p1, p2 = art["part1"], art["part2"]
        saw = (f"parseProjectData minted {p1['segmentsParsed']} real 173 segments, "
               f"{p1['segmentsCarryingAnyLockField']} carrying any lock field; "
               f"locked vs unlocked timing differs by {p2['divergenceMs']:.0f}ms")
        ok = ran and p1["verdict"] == "DEFECT CONFIRMED" and p2["verdict"] == "FLAG IS LOAD-BEARING"
    else:
        saw = "no artifact produced"
    r = half("REAL HALF", "REPRODUCE THE DEFECT", f"live vitest run of {K13_TEST} "
             f"({time.time() - started:.0f}s)", saw, ok,
             "when Stage 3 fixes K13 this half MUST start failing — that is the signal the "
             "fix landed,\n             not a broken test")
    record("C11", p, r, "A", "IN (as the K13 regression lock)")


def run_c12():
    rule("C12", "the old accuracy gate that could never be passed",
         "whether the '<1% of errors may be negative' gate can accept ANY realistic source",
         "a gate no correct system can pass is not a quality bar, it is a permanent red "
         "light. Acting\n                   on it means rejecting good work forever",
         "B", "the conclusion holds across all 3 corpora and a synthetic accurate source; "
         "it is an\n                   argument about the gate, not a detector of a defect "
         "in the data")
    f = poison_for("C12")()
    print("\n  POISON HALF is INVERTED for this rule, and that is stated rather than finessed:")
    print("  its 'poison' is deliberately HEALTHY data — a perfectly accurate source with")
    print("  symmetric +/-20ms noise. A rule that fires on it proves the GATE is the defect.")
    p = half("POISON HALF", "FIRE", "500 samples of accurate timing, symmetric +/-20ms noise",
             f"{len(f)} finding(s): {f[0].detail if f else 'none'}", bool(f))
    lines = []
    rejects = 0
    for n in ("v6", "173", "spanish"):
        c = corpus(n)
        errs = []
        for s in c.segments[1:]:
            b = s["start"]
            near = min(c.silences, key=lambda iv: min(abs(b - iv[0]), abs(b - iv[1])))
            errs.append(b - near[1])
        neg = sum(1 for e in errs if e < 0) / len(errs)
        got = bool(S.c12_smear_gate_discrimination(errs))
        rejects += got
        lines.append(f"{n} {neg:.1%} negative -> {'REJECTS' if got else 'accepts'}")
    r = half("REAL HALF", "REJECT ALL THREE (that is the finding)",
             "each project's own boundary-vs-nearest-silence signed errors",
             "; ".join(lines), rejects == 3,
             "the gate rejects three real corpora AND a synthetic perfect source, so it "
             "discriminates\n             nothing. This is evidence about the gate, and it "
             "is why the gate is retired")
    record("C12", p, r, "B", "IN (as a standing argument, not a data check)")


def run_c13():
    rule("C13", "a locked segment whose anchorStart drifted from its startTime",
         "a locked segment's anchorStart must equal its startTime, always — this IS the K14 "
         "invariant (INVARIANT L2, docs/sync-pipeline-v2-plan.md Step AB)",
         "K14 was exactly this: a drag left a locked segment's anchor stale without moving "
         "it, and\n                   the next unrelated lock toggle anywhere silently "
         "re-derived its position from that stale\n                   value. This check "
         "catches the staleness directly, at its source",
         "A", "backed by a LIVE reproduction against production code — the same drag + "
         "explicit-lock +\n                   unlock sequence K14's own repro used, now "
         "required to stay clean")
    f = poison_for("C13")()
    p = half("POISON HALF", "FIRE", "a locked segment with anchorStart 3s stale relative to "
             "its startTime, plus a healthy control row",
             f"{len(f)} finding(s) (control row correctly ignored): "
             f"{f[0].detail if f else 'none'}", len(f) == 1)
    print("\n  REAL HALF, unlike C11, is NOT inverted: K14 is fixed, so this genuinely stays")
    print("  quiet. Mechanically it re-uses C11's pattern (a live vitest artifact) — the two")
    print("  rules look alike on screen but assert opposite things about their own defect.")
    ok = False
    started = time.time()
    try:
        proc = subprocess.run(["npx", "vitest", "run", K14_TEST], cwd=REPO,
                              capture_output=True, text=True, timeout=420)
        ran = proc.returncode == 0
    except Exception as e:  # noqa: BLE001
        ran = False
        print(f"    (could not run vitest: {e})")
    art = json.loads(C13_ARTIFACT.read_text()) if C13_ARTIFACT.exists() else None
    if art:
        saw = (f"{art['scenario']} -> "
               f"{len(art['untouchedSegmentsMoved'])} untouched segment(s) moved, "
               f"{len(art['lockedSegmentsWithDriftedAnchor'])} locked segment(s) with a "
               f"drifted anchor, still-locked segment moved: {art['stillLockedSegmentMoved']}")
        ok = ran and art["verdict"] == "FIX CONFIRMED"
    else:
        saw = "no artifact produced"
    r = half("REAL HALF", "STAY QUIET", f"live vitest run of {K14_TEST} "
             f"({time.time() - started:.0f}s)", saw, ok,
             "if this half ever starts failing, K14 has regressed — that is a real defect, "
             "not a\n             broken test, same convention as every other live-repro "
             "rule in this file")
    record("C13", p, r, "A", "IN (as the K14 regression lock)")


# ------------------------------------------------------------------ main

def main():
    global DEFECTS, CONTROLS, UNRESOLVED
    t0 = time.time()
    print(BAR)
    print("STEP X — MANUAL VERIFICATION HARNESS: all 14 structural rules, twice each")
    print(BAR)
    print("""
  Each rule below is run on a deliberately broken input where it MUST fire, and on
  real corpus data where it MUST stay quiet. Two rules are inverted and say so.

  Why 14 rules and not the 12 Step O specified — the count reconciled:
    Step O item 1 is ONE inventory entry covering TWO structurally different
    assertions: "the slot holds no words at all" and "the slot is far too short
    for its words". They share nothing but a paragraph — different inputs,
    different thresholds, different failure modes — so they are poisoned and run
    separately here as C01a and C01b: 12 inventory items, 13 assertions, nothing
    renumbered. C13 is a 14th rule added at the K14 implementation commit (Step
    AD's own recommendation) — "lock isolation across unrelated edits" — scoped
    to a defect Step O never inventoried (K14 was found afterward, addendum
    Step AA), not a further split of an existing item.""")

    CORPORA.clear()
    DEFECTS, CONTROLS, UNRESOLVED = ear_verified()

    for fn in (run_c01a, run_c01b, run_c02, run_c03, run_c04, run_c05,
               run_c06, run_c07, run_c08, run_c09, run_c10, run_c11, run_c12, run_c13):
        try:
            fn()
        except Exception as e:  # noqa: BLE001 — one broken rule must not hide the rest
            print(f"\n  !! rule crashed: {type(e).__name__}: {e}")
            record(fn.__name__.upper().replace("RUN_", ""), False, False, "?", "OUT")

    # ---------------------------------------------------------------- tally
    print("\n" + BAR)
    print("TALLY")
    print(BAR)
    print(f"  {'rule':<7}{'poison':<9}{'real':<8}{'extra':<22}{'grade':<7}{'in CI?'}")
    for r in RESULTS:
        ex = ""
        if r["extra"]:
            ex = f"{r['extra'][0]}: {'PASS' if r['extra'][1] else 'FAIL'}"
        print(f"  {r['rid']:<7}{'PASS' if r['poison'] else 'FAIL':<9}"
              f"{'PASS' if r['real'] else 'FAIL':<8}{ex:<22}{r['grade']:<7}{r['ci']}")
    pp = sum(1 for r in RESULTS if r["poison"])
    rp = sum(1 for r in RESULTS if r["real"])
    ex_fail = [r["rid"] for r in RESULTS if r["extra"] and not r["extra"][1]]
    n = len(RESULTS)
    print(f"\n  poison halves: {pp}/{n} PASS     real halves: {rp}/{n} PASS")
    print(f"  both standard halves pass: "
          f"{sum(1 for r in RESULTS if r['poison'] and r['real'])}/{n}")
    if ex_fail:
        print(f"  FAILS an extra half beyond the standard two: {', '.join(ex_fail)}")
        print(f"  -> the headline {pp}/{n} is TRUE and INCOMPLETE. C10 fires on its poison and")
        print("     stays quiet on healthy data, and is still useless, because it finds none")
        print("     of the real defects it exists for. Read the ranking below, not the count.")

    if _clip_log:
        print("\n  CLIPS EXPORTED (open these to hear what the rules caught)")
        for name, path, where, listen in _clip_log:
            loc = str(path.relative_to(REPO)) if path else "NOT EXPORTED"
            print(f"    {name:<32} {loc}")
            print(f"    {'':<32} {where} — {listen}")

    print("\n" + BAR)
    print("HONEST EVIDENCE RANKING — which rules you should trust least")
    print(BAR)
    print("""
  A  strongest — an independent ground truth says the rule is right
       C05  13/13 labelled instances, 0 false positives over 696 real pauses. The
            labels come from the diff of two committed scorer outputs, so they were
            not produced by the rule being tested.
       C11  a live reproduction against production code and the real 173 project.
       C13  a live reproduction against production code — the same drag + explicit-
            lock + unlock sequence K14's own repro used, run against the real
            applyAnchorBasedTiming. Its own honest caveat, stated rather than
            buried: unlike C11, whose real half runs against a real corpus project,
            C13's scenario is a 6-segment synthetic timeline. It is graded A for
            exercising production code on the exact defect shape, not for corpus
            breadth — no committed baseline contains a locked segment to test
            against (locks are cleared by resync: K13, still open).

  B  good — fires exactly on defects this programme already knew about, and nowhere
     else, but the ground truth is this programme's own analysis, not an outside ear
       C02  6 genuine V6 headings, 0 elsewhere. Recall is 6 of 10 known headings.
       C03  1 finding, the flash-attention dropout, found from a different signal
            than C06 found it — corroboration.
       C06  1 finding, the same dropout.
       C12  an argument about a gate, proved on 3 corpora plus a synthetic source.

  C  weakest that are still worth keeping — clean on real data, but no live instance
     has ever tripped them, so their SENSITIVITY is unproven. Quiet here means the
     corpus is clean; it does not mean the rule would catch a dirty one
       C01a, C01b, C04, C07, C08, C09
       C04 deserves the most suspicion of these: breath misplacement is the dominant
       real-world failure this programme has chased, yet C04 reads zero. That is
       consistent with the shipped index-based breath fix having worked, and it is
       also exactly what a rule that cannot see the defect would print.
       C01b and C09 are only demonstrable against a stale fixture, because the Phase
       2a model swap already repaired their one real instance.

  D  failed validation — do not put it in CI
       C10  0 of 4 against the owner's own word-shift verdicts. Quiet on 37 correct
            controls, blind to every known defect. Its one V6 finding has no ear
            verdict either way and cannot be adjudicated.""")

    print(f"\n  total runtime: {time.time() - t0:.0f}s (budget 900s)")
    print(BAR)
    ci_in = [r["rid"] for r in RESULTS if r["ci"].startswith("IN")]
    print(f"  RECOMMENDED FOR CI ({len(ci_in)}): {', '.join(ci_in)}")
    print(f"  KEPT OUT ({n - len(ci_in)}): "
          f"{', '.join(r['rid'] for r in RESULTS if not r['ci'].startswith('IN'))}")
    print(BAR)
    code = 0 if pp == n and rp == n and not ex_fail else 1
    print(f"  exit code {code} — "
          + ("every half of every rule passed." if code == 0 else
             "NOT a harness error. Some half above genuinely failed "
             f"({', '.join(ex_fail) or 'see the table'}); the exit code reflects the "
             "finding, not a crash."))
    print(BAR)
    return code


if __name__ == "__main__":
    sys.exit(main())
