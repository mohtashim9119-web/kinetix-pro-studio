#!/usr/bin/env python3
"""Step B: onset phonetic class bucketing, V6, all 502 boundaries.

Buckets each boundary's following word by the ARPAbet class of its FIRST
phoneme (CMU Pronouncing Dictionary): soft/gradual onset (vowel, glide,
nasal, liquid) vs sharp onset (plosive/stop, fricative, affricate).
"""
import csv, re, statistics
import cmudict

CMU = cmudict.dict()

STOPS = {"B", "D", "G", "K", "P", "T"}
AFFRICATES = {"CH", "JH"}
FRICATIVES = {"DH", "F", "S", "SH", "TH", "V", "Z", "ZH", "HH"}
NASALS = {"M", "N", "NG"}
LIQUIDS = {"L", "R"}
GLIDES = {"W", "Y"}
VOWELS = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY",
          "OW", "OY", "UH", "UW"}

SHARP = STOPS | AFFRICATES | FRICATIVES
SOFT = VOWELS | GLIDES | NASALS | LIQUIDS


def phone_class(phone):
    base = re.sub(r"\d", "", phone)  # strip stress digit
    if base in STOPS:
        return "plosive"
    if base in AFFRICATES:
        return "affricate"
    if base in FRICATIVES:
        return "fricative"
    if base in NASALS:
        return "nasal"
    if base in LIQUIDS:
        return "liquid"
    if base in GLIDES:
        return "glide"
    if base in VOWELS:
        return "vowel"
    return "unknown:" + base


def classify_word(word):
    clean = re.sub(r"[^A-Za-z'\-]", "", word).lower()
    if not clean:
        return None, None
    entries = CMU.get(clean)
    if not entries:
        # try stripping a trailing possessive/hyphen part
        clean2 = clean.split("-")[0]
        entries = CMU.get(clean2)
    if not entries:
        return None, None
    phones = entries[0]  # first (most common) pronunciation
    first = phones[0]
    cls = phone_class(first)
    bucket = "soft" if cls in {"vowel", "glide", "nasal", "liquid"} else (
        "sharp" if cls in {"plosive", "affricate", "fricative"} else "other")
    return cls, bucket


def main():
    rows = list(csv.DictReader(open(
        "docs/phase3-onset-v6-fa-step1-2-corrected.csv")))

    out_rows = []
    unknown_words = set()
    for r in rows:
        word = r["token_text"]
        err = float(r["onset_error_sec"])
        cls, bucket = classify_word(word)
        if cls is None:
            unknown_words.add(word)
        out_rows.append({**r, "phone_class": cls, "onset_bucket": bucket})

    print(f"total rows: {len(rows)}")
    print(f"unclassified (not in CMUdict): {sum(1 for o in out_rows if o['phone_class'] is None)}")
    print(f"sample unclassified words: {sorted(unknown_words)[:30]}")

    with open("docs/phase3-step-b-phoneme-bucket.csv", "w", newline="") as f:
        fn = list(out_rows[0].keys())
        w = csv.DictWriter(f, fieldnames=fn)
        w.writeheader()
        for o in out_rows:
            w.writerow(o)

    print()
    print("=== By coarse bucket (soft vs sharp) ===")
    for bucket in ["soft", "sharp", "other"]:
        errs = [abs(float(o["onset_error_sec"])) for o in out_rows if o["onset_bucket"] == bucket]
        if not errs:
            continue
        errs.sort()
        n = len(errs)
        med = statistics.median(errs)
        p95 = errs[int(round(0.95 * (n - 1)))]
        gt250 = sum(1 for e in errs if e > 0.25)
        print(f"  {bucket:>6}  n={n:>4}  median={med*1000:7.1f}ms  p95={p95*1000:8.1f}ms  "
              f">250ms={gt250:>3} ({100*gt250/n:4.1f}%)")

    print()
    print("=== By fine phoneme class ===")
    classes = sorted(set(o["phone_class"] for o in out_rows if o["phone_class"]))
    for cls in classes:
        errs = [abs(float(o["onset_error_sec"])) for o in out_rows if o["phone_class"] == cls]
        errs.sort()
        n = len(errs)
        if n == 0:
            continue
        med = statistics.median(errs)
        p95 = errs[int(round(0.95 * (n - 1)))] if n > 1 else errs[0]
        gt250 = sum(1 for e in errs if e > 0.25)
        print(f"  {cls:>10}  n={n:>4}  median={med*1000:7.1f}ms  p95={p95*1000:8.1f}ms  "
              f">250ms={gt250:>3} ({100*gt250/n:4.1f}%)")

    # restrict to the 40 unresolved failures too, for cross-reference
    print()
    print("=== Among the 40 unresolved failures: bucket membership ===")
    import json
    unresolved = json.load(open("/tmp/phase3/v6/unresolved_40.json"))
    counts = {"soft": 0, "sharp": 0, "other": 0, "unk": 0}
    for u in unresolved:
        word = u["word"]
        cls, bucket = classify_word(word)
        key = bucket if bucket else "unk"
        counts[key] += 1
        print(f"   seg {u['seg_display']:>4}  {word:<14} class={cls}")
    print(counts)


if __name__ == "__main__":
    main()
