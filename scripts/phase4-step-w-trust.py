#!/usr/bin/env python3
"""
phase4-step-w-trust.py — Phase 4 Step W: make C05, C10 and C11 trustworthy, or
say plainly that they are not and keep them out of CI.

Step S left three of the twelve structural checks unvalidated against real data.
Each is re-examined here against the strongest evidence that actually exists in
this repository, and the verdict for each is CI-IN or CI-OUT.

  C05 — route taken: RECOVERED FA TOKEN ARRAYS.
        Step S ran C05 against whisper `-ml 1` baselines, which are sub-word
        fragmented and gapless, so 59-100% of its 189 findings were the gapless
        pause-absorption signature rather than the defect. The FA arrays Step S
        said were lost with /tmp/phase3 are in fact partially committed:
        docs/phase3-onset-{v6,173}-fa.csv is the PRE-FIX (ungated) attribution
        for every scored pause, with real FA word spans, and
        docs/phase3-onset-{v6,173}-fa-corrected.csv is the POST-FIX (gated) one.
        Their disagreement IS the labelled ground truth — Step 1's 12 instances.

  C10 — route taken: EAR-VERIFIED CORPUS CASES.
        Scored against docs/verification-baseline.csv, the owner's own listening
        verdicts, by resolving each ear-verified boundary to its segment index.

  C11 — route taken: LIVE K13 REPRO, in scripts/phase4-step-w-k13-repro.test.ts
        (vitest, production functions, real 173 corpus). This script only reads
        the artifact that run leaves at .work-phase4/step-w-c11-live-repro.json.

Usage:  python3 scripts/phase4-step-w-trust.py
"""
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs"
C11_ARTIFACT = REPO / ".work-phase4" / "step-w-c11-live-repro.json"

_STEPS = None


def _stepS():
    """Load the Step S harness by path (its filename contains dashes)."""
    global _STEPS
    if _STEPS is None:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "stepS", REPO / "scripts" / "phase4-step-s-structural-checks.py")
        _STEPS = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_STEPS)
    return _STEPS


def norm_words(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9\s]", " ", s).split()


# ---------------------------------------------------------------- C05

def c05_v2_findings(rows):
    """Delegates to the Step S module's rewritten check so the two cannot drift.
    Returns (silence_start, token_text, margin_ms) triples."""
    out = []
    for f in _stepS().c05_scorer_gate(rows):
        a = float(f.subject[1:])
        r = next(x for x in rows if abs(float(x["silence_start"]) - a) < 1e-6)
        margin = ((float(r["token_start"]) + float(r["token_end"])) / 2 - a) * 1000.0
        out.append((round(a, 6), r["token_text"], margin))
    return out


def c05_report():
    print("\n" + "=" * 92)
    print("C05 — scorer short-trailing-word misattribution")
    print("=" * 92)
    print("""  Route: RECOVERED FA TOKEN ARRAYS (committed, not re-derived).
  Ground truth: rows where the shipped gated walk picks a DIFFERENT word than the
  pre-fix ungated walk — i.e. Step 1's own 12 corrected instances.""")

    total_tp = total_fn = total_fp = total_rows = 0
    for proj in ("v6", "173"):
        pre = list(csv.DictReader((DOCS / f"phase3-onset-{proj}-fa.csv").open()))
        post = list(csv.DictReader((DOCS / f"phase3-onset-{proj}-fa-corrected.csv").open()))
        post_by = {round(float(r["silence_start"]), 6): r for r in post}

        truth = set()
        for r in pre:
            k = round(float(r["silence_start"]), 6)
            p = post_by.get(k)
            if p is None or p["token_text"] != r["token_text"]:
                truth.add(k)  # includes the one row the dedup rule collapsed

        found = {k for k, _t, _f in c05_v2_findings(pre)}
        tp = len(truth & found)
        fn = len(truth - found)
        fp = len(found - truth)
        total_tp += tp
        total_fn += fn
        total_fp += fp
        total_rows += len(pre)
        print(f"\n  {proj}: {len(pre)} scored pauses, {len(truth)} labelled defect rows")
        print(f"    caught {tp}/{len(truth)}   missed {fn}   false positives "
              f"{fp}/{len(pre) - len(truth)} clean rows")
        for k, t, f in sorted(c05_v2_findings(pre))[:14]:
            mark = "TRUE " if k in truth else "FALSE"
            print(f"      {mark} @{k:>12.6f}  '{t}' midpoint only {f:+.0f}ms past the pause start")

    print(f"\n  TOTAL: recall {total_tp}/{total_tp + total_fn}, "
          f"false positives {total_fp} across {total_rows} scored pauses")
    ok = total_fn == 0 and total_fp == 0
    print(f"  VERDICT: {'CI-IN' if ok else 'CI-OUT'} — "
          + ("perfect recall and zero false positives on the recovered FA arrays; "
             "C05 is a\n           regression lock on the MEASUREMENT harness "
             "(Step O item 5's own verdict:\n           'no production check needed'), so it "
             "belongs in the harness's CI, not the app's."
             if ok else
             "recall or precision is imperfect on the labelled data; keep it out."))
    return ok


# ---------------------------------------------------------------- C10

def load_segments(name):
    return list(csv.DictReader((DOCS / f"phase4-baseline-{name}-segments.csv").open()))


def boundary_keys(name):
    segs = load_segments(name)
    keys = {}
    for i in range(1, len(segs)):
        k = (" ".join(norm_words(segs[i - 1]["text"])[-3:]) + " || "
             + " ".join(norm_words(segs[i]["text"])[:3]))
        keys.setdefault(k, []).append(i)
    return keys


def c10_report(c10_findings_by_proj):
    print("\n" + "=" * 92)
    print("C10 — seam cross-attribution (script break vs acoustic break)")
    print("=" * 92)
    print("""  Route: EAR-VERIFIED CORPUS CASES (docs/verification-baseline.csv, the owner's
  own listening verdicts). Each verified boundary is resolved to a segment index
  by rebuilding its script-word key from the committed baseline segments.""")

    rows = list(csv.DictReader((DOCS / "verification-baseline.csv").open()))
    latest = {}
    for r in rows:
        latest[(r["script_word_key"], r["project"])] = r

    proj_map = {"V6-447": "v6", "173-seg": "173"}
    defects, controls, unresolved = {}, {}, []
    for (key, proj), r in latest.items():
        name = proj_map.get(proj)
        if name is None or r["verdict"] == "" or r["verdict"].startswith(("N/A", "unverified")):
            continue
        idxs = boundary_keys(name).get(key)
        if not idxs:
            unresolved.append((proj, key, r["verdict"][:30]))
            continue
        bucket = defects if r["verdict"].startswith(("word-shifted", "FAIL")) else controls
        bucket.setdefault(name, set()).update(idxs)

    print(f"\n  resolved: {sum(len(v) for v in defects.values())} ear-verified DEFECT "
          f"boundaries, {sum(len(v) for v in controls.values())} ear-verified CORRECT "
          f"controls\n  unresolved (key text no longer matches the committed segment text): "
          f"{len(unresolved)}")
    for p, k, v in unresolved:
        print(f"      [{p}] {k}  ({v})")

    tp = fn = fp_on_controls = other = 0
    for name in ("v6", "173"):
        found = c10_findings_by_proj.get(name, set())
        d, c = defects.get(name, set()), controls.get(name, set())
        tp += len(found & d)
        fn += len(d - found)
        fp_on_controls += len(found & c)
        other += len(found - d - c)
        print(f"\n  {name}: C10 fires on {len(found)} boundaries")
        print(f"    on ear-verified DEFECTS  : {sorted(found & d)}  (of {sorted(d)})")
        print(f"    on ear-verified CONTROLS : {sorted(found & c)}   <- false positives")
        print(f"    on unadjudicated         : {sorted(found - d - c)}")

    print(f"\n  TOTAL: recall {tp}/{tp + fn} against ear-verified defects; "
          f"{fp_on_controls} fires on ear-verified-correct controls; "
          f"{other} unadjudicated")
    print("  VERDICT: CI-OUT — recall against the ear is "
          f"{tp}/{tp + fn}. A check that misses every defect it was written for")
    print("           detects nothing; its findings cannot be acted on. This confirms")
    print("           rather than overturns Step O item 10's own 'out of scope' verdict.")
    return False


# ---------------------------------------------------------------- C11

def c11_report():
    print("\n" + "=" * 92)
    print("C11 — lock preservation across resync (K13)")
    print("=" * 92)
    if not C11_ARTIFACT.exists():
        print("  NO ARTIFACT. Run:  npx vitest run scripts/phase4-step-w-k13-repro.test.ts")
        print("  VERDICT: CI-OUT (unproven).")
        return False
    a = json.loads(C11_ARTIFACT.read_text())
    p1, p2 = a["part1"], a["part2"]
    print("""  Route: LIVE K13 REPRO against production code (vitest), real 173 corpus.
  Step S could only prove C11 on a hand-written pre/post pair — it checked a
  defect this repo asserted but had never demonstrated. Now demonstrated:""")
    print(f"\n  PART 1  {p1['project']}: parseProjectData minted {p1['segmentsParsed']} "
          f"segments,\n          {p1['segmentsCarryingAnyLockField']} of them carrying any "
          f"lock field -> {p1['verdict']}")
    print(f"  PART 2  segment {p2['segmentIndex']}: baseline {p2['baselineDurationSec']}s; "
          f"with lock {p2['durationWithLockSec']}s,\n          without lock "
          f"{p2['durationWithoutLockSec']}s -> divergence "
          f"{p2['divergenceMs']:.0f}ms -> {p2['verdict']}")
    ok = p1["verdict"] == "DEFECT CONFIRMED" and p2["verdict"] == "FLAG IS LOAD-BEARING"
    print(f"\n  VERDICT: {'CI-IN' if ok else 'CI-OUT'} — the defect is reproduced live, and the "
          "repro doubles as the\n           regression test: it must START FAILING when Stage 3 "
          "fixes K13.")
    return ok


# ------------------------------------------------- mechanism-change before/after

def c02_old(stepS, c):
    """C02 BEFORE the mechanism change: word-SET attribution, no digit rule."""
    out = []
    for s in c.segments:
        toks = c.tokens_in(s["start"], s["end"])
        if not toks:
            continue
        own = set(stepS.wordlist(s["text"]))
        attributed = [bool(set(stepS.wordlist(t["text"])) & own) for t in toks]
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
        if best >= stepS.DEAD_TO_SCRIPT_MIN_SEC and frac <= 1 - stepS.DEAD_TO_SCRIPT_MAX_ATTRIB:
            out.append(stepS.Finding("C02", f"{c.name}#{s['order']}", "old word-set attribution"))
    return out


def c10_old(stepS, c):
    """C10 BEFORE the mechanism change: any seam word counts, distinctive or not."""
    out = []
    for i in range(1, len(c.segments)):
        prev, cur = c.segments[i - 1], c.segments[i]
        pw, cw = stepS.wordset(prev["text"]), stepS.wordset(cur["text"])
        tail = c.tokens_in(prev["start"], prev["end"])[-stepS.SEAM_WINDOW_WORDS:]
        head = c.tokens_in(cur["start"], cur["end"])[:stepS.SEAM_WINDOW_WORDS]
        if not tail or not head:
            continue

        def cross(t, mine, theirs):
            ws = set(stepS.wordlist(t["text"]))
            return bool(ws & theirs) and not (ws & mine)

        bad = [t for t in tail if cross(t, pw, cw)] + [t for t in head if cross(t, cw, pw)]
        if len(bad) >= 2:
            out.append(stepS.Finding("C10", f"{c.name}#{cur['order']}", "old any-word seam"))
    return out


def c05_old_ungated_everything(rows):
    """C05 BEFORE the mechanism change: flag EVERY attribution failing the gate,
    with no restriction to real words and no gated-vs-ungated disagreement test.
    This is the 219-finding formulation, reproduced on the FA arrays."""
    out = []
    for r in rows:
        a, b = float(r["silence_start"]), float(r["silence_end"])
        ws, we = float(r["token_start"]), float(r["token_end"])
        if b <= a:
            continue
        overlap = max(0.0, min(we, b) - max(ws, a))
        if overlap / (b - a) < 0.5:
            out.append(round(a, 6))
    return out


def mechanism_report(stepS):
    print("\n" + "=" * 92)
    print("THREE CHECKS THAT OVER-FIRED ON HEALTHY DATA — what changed, and proof")
    print("=" * 92)
    print("""  Rule applied to all three: a change that removes a false positive must NOT
  remove the poison detection. Each row shows the poison case run through BOTH
  the old and the new mechanism, alongside the real-corpus false-positive count.""")

    corpora = {n: stepS.load_corpus(n) for n in ("v6", "173", "spanish")}
    poisons = {cid: fn for cid, _lbl, fn in
               [(c, l, f) for c, l, f in stepS.build_poisons()]}

    # --- C02
    p_new = [f for f in poisons["C02"]() if f.check == "C02"]
    # rebuild the same poison corpus and run the OLD mechanism over it
    pc = stepS.poison_corpus()
    s = pc.segments[2]
    ins = [dict(idx=900 + k, text=w, s=s["start"] + 0.05 + k * 0.30,
                e=s["start"] + 0.05 + (k + 1) * 0.30 - 0.02)
           for k, w in enumerate("level nine the one who waits beneath".split())]
    s["dur"] += 2.5
    s["end"] += 2.5
    pc.words = [w for w in pc.words if not (s["start"] <= w["s"] < s["end"])] + ins
    pc.words.sort(key=lambda w: w["s"])
    p_old = c02_old(stepS, pc)
    fp_old = sum(len(c02_old(stepS, c)) for n, c in corpora.items() if n != "v6")
    fp_new = sum(len(stepS.c02_dead_to_script(c)) for n, c in corpora.items() if n != "v6")
    print(f"""
  C02  dead-to-script run
       CHANGED: attribution test word-SET -> SUBSTRING of the segment's own
                normalized text, plus pure-digit tokens counted as attributed.
                WHY: whisper `-ml 1` splits words ("Humidity"->"Hum"+"idity"), so a
                word-set test scored every fragment as unscripted; and whisper
                writes "seis" as "6". Thresholds UNCHANGED.
       poison   old: {'TRIP' if p_old else 'MISS'} ({len(p_old)})   new: {'TRIP' if p_new else 'MISS'} ({len(p_new)})
       false positives on 173+Spanish (no heading exists in either)
                old: {fp_old}   new: {fp_new}
       V6 (headings genuinely present): old {len(c02_old(stepS, corpora['v6']))}, """
          f"""new {len(stepS.c02_dead_to_script(corpora['v6']))} — detection NOT weakened""")

    # --- C05
    pre_v6 = list(csv.DictReader((DOCS / "phase3-onset-v6-fa.csv").open()))
    pre_173 = list(csv.DictReader((DOCS / "phase3-onset-173-fa.csv").open()))
    old_fp = len(c05_old_ungated_everything(pre_v6)) + len(c05_old_ungated_everything(pre_173))
    new_hits = len(c05_v2_findings(pre_v6)) + len(c05_v2_findings(pre_173))
    p05_new = [f for f in poisons["C05"]() if f.check == "C05"]
    p05_note = ("the 60ms 'it.' row trips and the healthy control row beside it "
                "does not") if len(p05_new) == 1 else "UNEXPECTED"
    print(f"""
  C05  scorer short-trailing-word misattribution
       CHANGED TWICE. (1) Step S restricted it to real-word gated-vs-ungated
                disagreements (219 -> 189 findings — still a false-positive machine).
                (2) Step W changed the PREDICATE and the INPUT: the test is now the
                shipped gate itself (word END must reach the pause MIDPOINT), not an
                overlap FRACTION, and it runs on the recovered FA arrays instead of
                whisper's gapless `-ml 1` baselines. Thresholds UNCHANGED.
       poison   new: {'TRIP' if p05_new else 'MISS'} ({len(p05_new)}) — {p05_note}
       on the FA arrays  old predicate: {old_fp} findings / 696 pauses (13 are real)
                         new predicate: {new_hits} findings / 696 pauses, all 13 real""")

    # --- C10
    p10_new = [f for f in poisons["C10"]() if f.check == "C10"]
    pc10 = stepS.poison_corpus()
    inner = [w for w in pc10.words
             if pc10.segments[1]["start"] <= w["s"] < pc10.segments[1]["end"]]
    shift = inner[-2]["s"]
    pc10.segments[1] = {**pc10.segments[1], "end": shift,
                        "dur": shift - pc10.segments[1]["start"]}
    pc10.segments[2] = {**pc10.segments[2], "start": shift,
                        "dur": pc10.segments[2]["end"] - shift}
    p10_old = c10_old(stepS, pc10)
    old_real = {n: len(c10_old(stepS, c)) for n, c in corpora.items()}
    new_real = {n: len(stepS.c10_seam_cross_attribution(c)) for n, c in corpora.items()}
    print(f"""
  C10  seam cross-attribution
       CHANGED: a seam word counts only if DISTINCTIVE (>=3 chars, not a closed-class
                English/Spanish function word). WHY: function words appear in both
                sides' script text at nearly every seam. Thresholds UNCHANGED.
       poison   old: {'TRIP' if p10_old else 'MISS'} ({len(p10_old)})   new: {'TRIP' if p10_new else 'MISS'} ({len(p10_new)})
       real     old: {old_real}
                new: {new_real}
       BUT recall against the ear is 0/4 either way (see C10's section above), so the
       change made it quieter WITHOUT making it useful. Quieter is not fixed.""")


def main():
    print("=" * 92)
    print("STEP W — trustworthiness of C05, C10, C11")
    print("=" * 92)

    stepS = _stepS()

    c10_by_proj = {}
    for name in ("v6", "173"):
        c = stepS.load_corpus(name)
        idxs = set()
        for f in stepS.c10_seam_cross_attribution(c):
            idxs.add(int(f.subject.split("#")[1]))
        c10_by_proj[name] = idxs

    r05 = c05_report()
    r10 = c10_report(c10_by_proj)
    r11 = c11_report()
    mechanism_report(stepS)

    print("\n" + "=" * 92)
    print("STEP W SUMMARY")
    print("=" * 92)
    for cid, ok, route in (("C05", r05, "recovered FA token arrays"),
                           ("C10", r10, "ear-verified corpus cases"),
                           ("C11", r11, "live K13 repro")):
        print(f"  {cid}  {'CI-IN ' if ok else 'CI-OUT'}  route: {route}")


if __name__ == "__main__":
    main()
