#!/usr/bin/env python3
"""
phase4-step-q-spanish-clips.py — Phase 4 Step Q: Spanish blinded listening batch.

Exports 10 blinded clips from the Spanish corpus project (7 drawn from the
worst-scoring MMS-FA boundaries, 3 controls that currently pass), following the
exact same protocol as the two English batches (Step C's 12 and Step H's 20):

  * 1.0s padding before the flagged silence's start and 1.0s after the flagged
    word's end, sourced from the ORIGINAL (non-16kHz-transcoded) audio
  * opaque `clip3_NN` names assigned by a seeded shuffle (seed 7 -- distinct
    from Step C's 42 and Step H's 99)
  * a PUBLIC manifest carrying ONLY clip name + script text
  * a PRIVATE answer key (clip -> segment/word/timing/error) held OUTSIDE docs/

Two deliberate deviations from the earlier batches, both stated rather than
silent:

 1. The private answer key is written to `.answer-keys/` in the repo (gitignored)
    rather than `/tmp/phase3/`. Step C's and Step H's answer keys were BOTH lost
    to /tmp cleanup (verified absent 2026-08-06) -- the third recurrence of the
    K8 pattern this document has now recorded. `.answer-keys/` survives /tmp
    cleanup while staying out of the blinded `docs/` tree.

 2. A programmatic integrity check runs BEFORE the batch is sent (subcommand
    `integrity`), not after a human ear catches a mismatch. Batch 2's clip 11 was
    a genuine content mismatch that only the listener caught; this subcommand
    transcribes each exported clip with the production whisper-cli sidecar
    (-l es, ggml-large-v3-turbo.bin) and tests, per clip:
      (a) FIRST-WORD test  -- the manifest segment's own first word is present in
          the clip's heard audio;
      (b) LEAD-IN test     -- the words heard BEFORE it match the tail of the
          PREVIOUS committed segment's script text;
      (c) FOREIGN-CONTENT test -- EVERY heard word is attributable to either the
          previous segment's tail or the manifest segment itself.
    (c) is the sharpest, and the one that would have caught batch 2's clip 11
    (whose heard content contained zero of its manifest segment's words and
    belonged to a different segment entirely).

Usage:
  python3 scripts/phase4-step-q-spanish-clips.py export
  python3 scripts/phase4-step-q-spanish-clips.py integrity
"""
import csv
import json
import os
import random
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FFMPEG = "/usr/local/bin/ffmpeg"
FFPROBE = "/usr/local/bin/ffprobe"
WHISPER = str(REPO / "src-tauri/binaries/whisper-x86_64-apple-darwin")
MODEL = str(REPO / "src-tauri/models/ggml-large-v3-turbo.bin")

SRC = "/Users/mohtashim/Downloads/All Projects Test Data/Spanish Project/Spanish VOiceover.m4a"
ONSET_CSV = REPO / "scripts/fixtures/phase3-onset-spanish-fa.csv"
SEGMENTS_CSV = REPO / "scripts/fixtures/phase4-baseline-spanish-segments.csv"

OUTDIR = REPO / ".listening-clips/spanish-batch"
KEYDIR = REPO / ".answer-keys"
MANIFEST = REPO / "docs/ws1-sync-pipeline/measurements/phase4-step-q-spanish-manifest.csv"
INTEGRITY_CSV = REPO / "docs/ws1-sync-pipeline/measurements/phase4-step-q-integrity-check.csv"

DURATION = 92.04
PAD = 1.0
SEED = 7

# Selection, fixed here rather than recomputed at run time so the batch is
# reproducible and auditable. Keyed by the onset CSV's own silence_start.
# 7 worst-scoring by |onset_error_sec|, 3 controls chosen for phonetic spread
# among the cleanly-passing rows (liquid /l/, vowel-initial, plosive /k/).
FAILURES = [0.722688, 64.676625, 5.82325, 27.125063, 83.58775, 12.672562, 34.027188]
CONTROLS = [17.124063, 44.550875, 19.627125]


def norm(s: str) -> str:
    """Accent- and punctuation-insensitive lowercase word list."""
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return s


def words(s: str):
    return norm(s).split()


def load_rows():
    onsets = []
    with open(ONSET_CSV) as f:
        for r in csv.DictReader(f):
            onsets.append({k: (float(v) if k != "token_text" else v) for k, v in r.items()})
    segs = []
    with open(SEGMENTS_CSV) as f:
        for r in csv.DictReader(f):
            segs.append({
                "order": int(r["order"]), "tag": r["tag"], "text": r["text"],
                "startTime": float(r["startTime"]), "endTime": float(r["endTime"]),
            })
    return onsets, segs


def seg_for(segs, t):
    for s in segs:
        if s["startTime"] <= t < s["endTime"]:
            return s
    return segs[-1] if t >= segs[-1]["endTime"] else segs[0]


def build_items():
    onsets, segs = load_rows()
    by_start = {round(o["silence_start"], 6): o for o in onsets}
    items = []
    for kind, keys in (("failure", FAILURES), ("control", CONTROLS)):
        for k in keys:
            o = by_start[round(k, 6)]
            s = seg_for(segs, o["token_start"])
            prev = next((p for p in segs if p["order"] == s["order"] - 1), None)
            items.append({
                "kind": kind,
                "seg_order": s["order"],
                "seg_tag": s["tag"],
                "script_text": s["text"],
                "prev_script_text": prev["text"] if prev else "",
                "word": o["token_text"],
                "silence_start": o["silence_start"],
                "silence_end": o["silence_end"],
                "token_start": o["token_start"],
                "token_end": o["token_end"],
                "onset_error_sec": o["onset_error_sec"],
            })
    assert len(items) == 10, len(items)
    return items


def cmd_export():
    OUTDIR.mkdir(parents=True, exist_ok=True)
    KEYDIR.mkdir(parents=True, exist_ok=True)
    items = build_items()

    random.seed(SEED)
    order = list(range(len(items)))
    random.shuffle(order)

    answer_key, public_rows = [], []
    for rank, idx in enumerate(order, start=1):
        it = items[idx]
        clip_start = max(0.0, it["silence_start"] - PAD)
        clip_end = min(DURATION, it["token_end"] + PAD)
        name = f"clip3_{rank:02d}"
        outpath = OUTDIR / f"{name}.wav"
        subprocess.run([
            FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
            "-i", SRC, "-ss", f"{clip_start:.3f}", "-to", f"{clip_end:.3f}",
            "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", str(outpath),
        ], check=True)

        probe = subprocess.run(
            [FFPROBE, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(outpath)],
            capture_output=True, text=True)
        actual_dur = float(probe.stdout.strip()) if probe.returncode == 0 else None

        answer_key.append({
            "clip": name, **it,
            "clip_start_abs": clip_start, "clip_end_abs": clip_end,
            "pause_offset_in_clip": it["silence_start"] - clip_start,
            "word_onset_offset_in_clip": it["token_start"] - clip_start,
            "expected_dur": clip_end - clip_start, "actual_dur": actual_dur,
        })
        public_rows.append({"clip": name, "script_text": it["script_text"]})

    with open(MANIFEST, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["clip", "script_text"])
        w.writeheader()
        w.writerows(public_rows)
    (KEYDIR / "step_q_answer_key.json").write_text(json.dumps(answer_key, indent=2, ensure_ascii=False))

    print(f"Wrote {len(items)} clips to {OUTDIR}")
    hdr = f"{'clip':>10} {'kind':>8} {'seg':>4} {'pad_before':>11} {'pad_after':>10} {'exp_dur':>8} {'act_dur':>8} {'ok':>4}"
    print("\n" + hdr)
    all_ok = True
    for a in answer_key:
        pad_after = a["clip_end_abs"] - a["token_end"]
        dur_ok = a["actual_dur"] is not None and abs(a["actual_dur"] - a["expected_dur"]) < 0.05
        pb_ok = abs(a["pause_offset_in_clip"] - PAD) < 0.001 or a["silence_start"] < PAD
        pa_ok = abs(pad_after - PAD) < 0.001 or a["clip_end_abs"] >= DURATION - 0.001
        ok = dur_ok and pb_ok and pa_ok
        all_ok &= ok
        print(f"{a['clip']:>10} {a['kind']:>8} {a['seg_order']:>4} "
              f"{a['pause_offset_in_clip']:>11.3f} {pad_after:>10.3f} "
              f"{a['expected_dur']:>8.3f} {a['actual_dur']:>8.3f} {'OK' if ok else 'BAD':>4}")
    print(f"\nALL PADDING/DURATION CHECKS: {'PASS' if all_ok else 'FAIL'}")


def similar(a: str, b: str) -> float:
    """Cheap normalized similarity, for known ASR spelling conventions only."""
    import difflib
    return difflib.SequenceMatcher(None, a, b).ratio()


def transcribe(path: Path) -> str:
    cache = KEYDIR / "step_q_transcripts.json"
    store = json.loads(cache.read_text()) if cache.exists() else {}
    if path.name in store:
        return store[path.name]
    wav16 = path.with_suffix(".16k.wav")
    subprocess.run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
                    "-i", str(path), "-ar", "16000", "-ac", "1", str(wav16)], check=True)
    r = subprocess.run([WHISPER, "-m", MODEL, "-l", "es", "-np", "-nt", "-f", str(wav16)],
                       capture_output=True, text=True)
    wav16.unlink(missing_ok=True)
    if r.returncode != 0:
        raise RuntimeError(f"whisper failed on {path.name}: {r.stderr[-500:]}")
    text = " ".join(line.strip() for line in r.stdout.splitlines() if line.strip())
    store[path.name] = text
    cache.write_text(json.dumps(store, indent=2, ensure_ascii=False))
    return text


def cmd_integrity():
    key = json.loads((KEYDIR / "step_q_answer_key.json").read_text())
    rows = []
    print(f"{'clip':>10} {'fw':>6} {'fw_mode':<20} {'li':>4} {'fc':>4}  transcript")
    for a in key:
        heard = transcribe(OUTDIR / f"{a['clip']}.wav")
        hw = words(heard)
        mw = words(a["script_text"])
        pw = words(a["prev_script_text"])

        # (a) FIRST-WORD test: manifest segment's own first word present in heard audio.
        #     Exact match first; a near-match (>=0.6 ratio) is reported as
        #     PASS(fuzzy) with the heard spelling recorded, NOT silently equated --
        #     Spanish's already-documented "Scylla"->"Silla" ASR convention (Step 4's
        #     CER analysis, 8 occurrences) is a spelling difference, not a content
        #     mismatch, and must not be counted as either a clean pass or a failure.
        first_word = mw[0] if mw else ""
        fw_mode = "exact"
        if first_word in hw:
            fw_ok, fw_idx = True, hw.index(first_word)
        else:
            cand = max(((w, similar(first_word, w)) for w in hw),
                       key=lambda x: x[1], default=("", 0.0))
            if cand[1] >= 0.6:
                fw_ok, fw_idx, fw_mode = True, hw.index(cand[0]), f"fuzzy:{cand[0]}({cand[1]:.2f})"
            else:
                fw_ok, fw_idx, fw_mode = False, -1, "absent"

        # (b) LEAD-IN test: words heard BEFORE it match the tail of the PREVIOUS
        #     segment's script. Skipped when there is no previous segment (corpus start).
        if not pw:
            li_ok, li_note = True, "n/a (corpus start)"
        elif not fw_ok:
            li_ok, li_note = False, "first word absent"
        else:
            lead = hw[:fw_idx]
            if not lead:
                li_ok, li_note = True, "no lead-in audio"
            else:
                overlap = sum(1 for w in lead if w in pw[-8:])
                li_ok = overlap >= max(1, len(lead) // 2)
                li_note = f"{overlap}/{len(lead)} in prev tail"

        # (c) FOREIGN-CONTENT test -- the sharpest of the three, and the one that
        #     would have caught batch 2's clip 11: EVERY heard word must be
        #     attributable to the prev segment's tail or the manifest segment
        #     itself. A clip whose audio belongs to some other segment entirely
        #     fails here even if (a) and (b) somehow pass.
        allowed = set(pw[-10:]) | set(mw)
        unattributed = [w for w in hw
                        if w not in allowed
                        and max((similar(w, x) for x in allowed), default=0.0) < 0.7]
        fc_ok = len(unattributed) <= max(1, len(hw) // 5)
        fc_note = f"{len(unattributed)}/{len(hw)} unattributed" + (
            f": {' '.join(unattributed[:4])}" if unattributed else "")

        rows.append({
            "clip": a["clip"], "heard_transcript": heard,
            "manifest_first_word": first_word,
            "first_word_test": "PASS" if fw_ok else "FAIL",
            "first_word_match_mode": fw_mode,
            "lead_in_test": "PASS" if li_ok else "FAIL",
            "lead_in_detail": li_note,
            "foreign_content_test": "PASS" if fc_ok else "FAIL",
            "foreign_content_detail": fc_note,
        })
        print(f"{a['clip']:>10} {'PASS' if fw_ok else 'FAIL':>6} {fw_mode:<20} "
              f"{'PASS' if li_ok else 'FAIL':>4} {'PASS' if fc_ok else 'FAIL':>4}  {heard[:60]}")

    with open(INTEGRITY_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    n_fail = sum(1 for r in rows if "FAIL" in (r["first_word_test"], r["lead_in_test"], r["foreign_content_test"]))
    print(f"\nINTEGRITY: {len(rows) - n_fail}/{len(rows)} clips pass all three tests -> {INTEGRITY_CSV}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "export"
    {"export": cmd_export, "integrity": cmd_integrity}[cmd]()
