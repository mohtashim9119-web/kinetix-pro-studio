#!/usr/bin/env python3
"""
measure-word-onset.py — Phase 2b word-onset-error measurement (sync-pipeline-v2-plan.md).

Committed per Part K's K8: the original investigation's harness lived in /tmp
and was lost (docs/audit-verification-2026-08-03.md §C.7). This is its
replacement, meant to be re-run without archaeology — see
scripts/measure-word-onset.md for the exact invocations used for the Phase 2b
measurement.

Ground truth: ffmpeg's `silencedetect` filter run on the SAME 16kHz mono WAV
whisper-cli consumes (so ground truth and model timestamps share one time
base). For each detected silence, the "word following the pause" is the
first not-yet-consumed token whose declared END extends past the silence's
START (this correctly attributes a negatively-smeared token — one whose
declared start precedes the true pause's end — to the pause it smeared
across, which a naive "first token with start >= silence_end" filter would
miss entirely). word-onset-error = token.start - silence.end (signed;
negative = the token's declared start precedes the true end of the pause
before it — the segment-96 pathology).

No dependencies beyond the Python 3 standard library.
"""

import argparse
import json
import math
import re
import statistics
import subprocess
import sys
import time
from pathlib import Path


# ---------------------------------------------------------------------------
# ffmpeg helpers
# ---------------------------------------------------------------------------

def transcode_to_wav(ffmpeg_bin: str, input_path: Path, output_path: Path,
                      sample_rate: int = 16000, channels: int = 1) -> None:
    """Mirrors src-tauri/src/whisper.rs's transcode_to_wav exactly (-ar/-ac)."""
    cmd = [
        ffmpeg_bin, "-hide_banner", "-y",
        "-i", str(input_path),
        "-ar", str(sample_rate),
        "-ac", str(channels),
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg transcode failed ({result.returncode}):\n{result.stderr[-2000:]}")


_SILENCE_START_RE = re.compile(r"silence_start:\s*(-?[\d.]+)")
_SILENCE_END_RE = re.compile(r"silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)")


def run_silencedetect(ffmpeg_bin: str, wav_path: Path, noise_db: float = -45.0,
                       min_duration_sec: float = 0.25) -> list:
    """Runs ffmpeg silencedetect on wav_path. Returns a list of {start, end} dicts,
    ascending, disjoint (matches Contract 1->2 P4's assumed shape). Mirrors
    silenceDetector.ts's defaults (-45dB / 0.25s) so this ground truth is
    comparable to what production's own silence scan would find."""
    cmd = [
        ffmpeg_bin, "-hide_banner",
        "-i", str(wav_path),
        "-af", f"silencedetect=noise={noise_db}dB:d={min_duration_sec}",
        "-f", "null", "-",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    # silencedetect writes to stderr regardless of exit status; -f null has no
    # output file so a 0 exit is expected.
    log = result.stderr
    silences = []
    pending_start = None
    for line in log.splitlines():
        m = _SILENCE_START_RE.search(line)
        if m:
            pending_start = float(m.group(1))
            continue
        m = _SILENCE_END_RE.search(line)
        if m:
            end = float(m.group(1))
            if pending_start is not None:
                silences.append({"start": pending_start, "end": end})
                pending_start = None
    # A trailing, unterminated silence_start (audio ends mid-silence) is
    # dropped rather than guessed — an open interval has no "pause end" to
    # measure onset error against anyway.
    silences.sort(key=lambda s: s["start"])
    return silences


def probe_duration_sec(ffmpeg_bin: str, path: Path) -> float:
    result = subprocess.run([ffmpeg_bin, "-hide_banner", "-i", str(path)],
                             capture_output=True, text=True)
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", result.stderr)
    if not m:
        raise RuntimeError(f"could not parse duration from ffmpeg -i output:\n{result.stderr[-1000:]}")
    h, mnt, s = m.groups()
    return int(h) * 3600 + int(mnt) * 60 + float(s)


# ---------------------------------------------------------------------------
# whisper-cli invocation
# ---------------------------------------------------------------------------

def parse_timestamp(ts: str) -> float:
    """Port of whisper.rs's parse_timestamp: HH:MM:SS.mmm or HH:MM:SS,mmm."""
    ts = ts.strip().replace(",", ".")
    parts = ts.split(":")
    if len(parts) != 3:
        return 0.0
    h, m, s = parts
    try:
        return float(h) * 3600.0 + float(m) * 60.0 + float(s)
    except ValueError:
        return 0.0


def parse_stdout_tokens(lines) -> list:
    """Port of whisper.rs's parse_stdout_tokens — bracket-line stdout format,
    the exact format production's TranscriptToken parsing consumes."""
    tokens = []
    for line in lines:
        trimmed = line.strip()
        if not trimmed.startswith("["):
            continue
        close = trimmed.find("]")
        if close == -1:
            continue
        ts_part = trimmed[1:close]
        arrow = ts_part.find(" --> ")
        if arrow == -1:
            continue
        start_sec = parse_timestamp(ts_part[:arrow])
        end_sec = parse_timestamp(ts_part[arrow + 5:])
        text = trimmed[close + 1:].strip()
        if text:
            tokens.append({"start": start_sec, "end": end_sec, "text": text})
    return tokens


def parse_json_tokens(json_path: Path) -> list:
    """Parses whisper.cpp's -oj/-ojf output. Uses the millisecond 'offsets'
    field (integer ms) in preference to the SRT-style 'timestamps' strings,
    for sub-ms precision; falls back to 'timestamps' if 'offsets' is absent.
    With -ml 1 upstream, each 'transcription' entry is one word, so this is
    already word-level regardless of DTW; DTW (when enabled) refines the
    SAME offsets/timestamps fields in place rather than adding a parallel
    structure — confirmed against this run's own output shape, not assumed."""
    data = json.loads(json_path.read_text())
    tokens = []
    for seg in data.get("transcription", []):
        text = seg.get("text", "").strip()
        if not text:
            continue
        offsets = seg.get("offsets")
        if offsets and "from" in offsets and "to" in offsets:
            start_sec = offsets["from"] / 1000.0
            end_sec = offsets["to"] / 1000.0
        else:
            ts = seg.get("timestamps", {})
            start_sec = parse_timestamp(ts.get("from", "0:0:0.0"))
            end_sec = parse_timestamp(ts.get("to", "0:0:0.0"))
        tokens.append({"start": start_sec, "end": end_sec, "text": text})
    return tokens


def run_whisper(whisper_bin: str, model: str, wav_path: Path, language: str,
                 max_len: int, nfa: bool, dtw: str, json_out: bool,
                 out_prefix: Path, extra_threads: int = None):
    """Runs whisper-cli once, timing ONLY the subprocess itself (not any
    transcode/prep). Returns (elapsed_sec, tokens, returncode, stdout_lines).

    Deliberately does NOT pass -t (thread count) unless explicitly requested —
    production's real invocation (whisper.rs) never passes -t either, so the
    default leaves this run's wall-clock time representative of what a real
    user's app actually experiences, which is the whole point of measuring it
    (H.2's accuracy-vs-speed tradeoff needs a real number, not a
    best-case-hardware number)."""
    cmd = [
        whisper_bin,
        "-m", model,
        "-f", str(wav_path),
        "-ml", str(max_len),
        "-l", language,
    ]
    if extra_threads:
        cmd += ["-t", str(extra_threads)]
    if nfa:
        cmd.append("-nfa")
    if dtw:
        cmd += ["-dtw", dtw]
    if json_out:
        cmd += ["-oj", "-of", str(out_prefix)]

    start = time.perf_counter()
    result = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = time.perf_counter() - start

    if result.returncode != 0:
        raise RuntimeError(
            f"whisper-cli exited {result.returncode}\ncmd: {' '.join(cmd)}\n"
            f"stderr tail:\n{result.stderr[-3000:]}"
        )

    stdout_lines = result.stdout.splitlines()
    if json_out:
        json_path = out_prefix.with_suffix(".json")
        if not json_path.exists():
            raise RuntimeError(f"expected JSON output at {json_path}, not found")
        tokens = parse_json_tokens(json_path)
    else:
        tokens = parse_stdout_tokens(stdout_lines)

    return elapsed, tokens, result.returncode, stdout_lines, cmd


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def percentile(data, pct):
    if not data:
        return None
    data = sorted(data)
    k = (len(data) - 1) * (pct / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return data[int(k)]
    return data[f] * (c - k) + data[c] * (k - f)


def normalize_token_text(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def filter_word_tokens(tokens: list) -> list:
    """Drops tokens whose text normalizes to nothing — i.e. pure punctuation
    ('.', ',', etc.), which whisper-cli emits as their own timestamped
    segments under -ml 1. Mirrors production's own filterMalformedTokens
    empty-text drop reason (whisperService.ts): the real pipeline never
    aligns against these either, and leaving them in corrupts "the word
    following a detected pause" — a punctuation mark's timestamp routinely
    wins the next-token slot ahead of the real following word, since it gets
    attached to whichever side the tokenizer felt like. Confirmed empirically
    on the smoke-test corpus file before this filter was added: EVERY scored
    pause resolved to a comma/period token, not the real next word."""
    return [t for t in tokens if normalize_token_text(t["text"])]


def score_onset_errors(tokens: list, silences: list) -> list:
    """For each silence (ascending, disjoint), find the first not-yet-consumed
    token whose declared MIDPOINT falls at or after the silence's START — that
    token is a CANDIDATE for "the word following this pause." A candidate is
    only accepted once it also clears the OVERLAP GATE below; the first
    candidate that clears both is "the word following this pause."

    Why midpoint, not "first token whose end pokes past the silence start"
    (the first version of this function, kept here as a cautionary note
    rather than deleted silently): that looser rule was tested against real
    V6 turbo output and produced a false attribution on the very first
    silence in the file — a token ("The") whose END overlapped the silence's
    START by a trivial 13ms (out of the token's own ~110ms span and the
    silence's own ~760ms span) was selected as "the following word," when it
    was actually the tail of the PRECEDING word with ordinary edge blur, not
    a smeared following word. The real next word was one token later. Using
    the token's temporal midpoint as the test correctly excludes a token that
    is only trivially poking into a silence's leading edge (assigns it to
    "before"), while still correctly catching a genuinely, substantially
    smeared token — verified against the committed segment-96 fixture
    (silence [289.380, 289.960]; token "predator" [289.260, 289.800] has
    midpoint 289.530, which is >= 289.380, so it is correctly selected even
    though its own declared START (289.260) precedes the silence's START).

    OVERLAP GATE (Phase 3 data-cleaning pass, 2026-08-05 — the "it." scorer
    bug fix). The midpoint test alone is not scale-invariant: it only asks
    whether a token's own center of mass sits past the silence's start, so
    for a VERY SHORT trailing token (a one-syllable sentence-final word like
    "it.", "hard.", "right.", "Yaro" — typically ~60-100ms long) even a few
    tens of milliseconds of ordinary trailing edge blur is enough to push the
    token's own midpoint past a silence's start, exactly the same failure
    mode the "The" case above was built to reject, just at a shorter token
    duration than the original fix anticipated. Found on V6/fa2: 8 sentence-
    final tokens spelled "it."/"It" plus 4 more short trailing words
    ("hard.", "Yaro", "temporary.", "right.") were each misattributed to the
    pause that immediately FOLLOWED them (not preceded them) — e.g. silence
    [65.101, 66.452]: "it." [65.067, 65.147] pokes only 46ms into this
    1.35s-long silence's leading edge (its own midpoint crosses the start by
    a mere 5.8ms), yet under the plain midpoint test it was picked as "the
    word following the pause," producing a fabricated onset_error of -1.385s.
    The real following word is "You," a full 1.37s later, at the very end of
    the silence. Distinguishing signal: what FRACTION of the SILENCE ITSELF
    does the candidate's span actually cover? "it."'s ~46ms is ~3% of that
    1.35s silence; "predator"'s smear, by contrast, consumes 0.42s of the
    segment-96 fixture's 0.58s silence — 72%, a clear majority of the pause.
    That is the operative difference between "brushing a pause's leading
    edge" and "smeared substantially across it": the gate requires a
    candidate's declared END to reach at least the silence's own MIDPOINT
    (equivalent to covering at least half the silence), not merely poke past
    its start. "The" (13ms into a ~760ms silence, ~2%) and "it." (~3%) both
    fail this gate and are correctly skipped; "predator" (72%) clears it and
    is still correctly selected, exactly as before.

    onset_error = token.start - silence.end (signed; negative = the token's
    declared start precedes the true end of the pause before it).

    Dedup: if two consecutive silences resolve to the same token (a
    real-speech-free gap split into two silencedetect events, or a stray
    sub-threshold blip), only the LATER (closer) silence's attribution is
    kept — that pairing is the one that's actually "immediately before" the
    word once a closer gap is known to also precede it with nothing between.
    This can also fire as a side effect of the overlap gate: rejecting a
    trailing-edge candidate for an earlier of two adjacent silence blips can
    make both blips resolve to the same later, real word, correctly
    collapsing them into one attribution (measured on V6: one such pair,
    502 -> 501 scored pauses)."""
    tokens_sorted = sorted(tokens, key=lambda t: t["start"])
    results = []
    token_idx = 0
    last_assigned_idx = -1
    n = len(tokens_sorted)

    def midpoint(t):
        return (t["start"] + t["end"]) / 2.0

    for sil in silences:
        s0, s1 = sil["start"], sil["end"]
        silence_midpoint = (s0 + s1) / 2.0
        while token_idx < n and midpoint(tokens_sorted[token_idx]) < s0:
            token_idx += 1
        if token_idx >= n:
            break
        # Overlap gate: skip past any candidate whose declared span doesn't
        # reach at least this silence's own midpoint — a token that only
        # brushes the leading edge is the PRECEDING word's ordinary trailing
        # blur, not the following word smeared across the pause.
        cand_idx = token_idx
        while cand_idx < n and tokens_sorted[cand_idx]["end"] < silence_midpoint:
            cand_idx += 1
        if cand_idx >= n:
            continue
        tok = tokens_sorted[cand_idx]
        row = {
            "silence_start": s0,
            "silence_end": s1,
            "token_text": tok["text"],
            "token_start": tok["start"],
            "token_end": tok["end"],
            "onset_error_sec": tok["start"] - s1,
        }
        if cand_idx == last_assigned_idx and results:
            results[-1] = row
        else:
            results.append(row)
        last_assigned_idx = cand_idx
    return results


def summarize(results: list) -> dict:
    errors = [r["onset_error_sec"] for r in results]
    abs_errors = [abs(e) for e in errors]
    neg = [e for e in errors if e < 0]
    return {
        "n_scored_pauses": len(results),
        "median_abs_onset_error_sec": statistics.median(abs_errors) if abs_errors else None,
        "p95_abs_onset_error_sec": percentile(abs_errors, 95) if abs_errors else None,
        "negative_smear_count": len(neg),
        "negative_smear_fraction": (len(neg) / len(errors)) if errors else None,
    }


def score_tokens_against_silences(all_tokens: list, silences: list) -> dict:
    """Full pipeline: filter to word tokens, score, summarize. all_tokens is
    the RAW parsed list (whatever whisper-cli emitted, punctuation included) —
    callers that need the raw count (e.g. "total transcribed token count")
    should read len(all_tokens) separately before calling this."""
    word_tokens = filter_word_tokens(all_tokens)
    results = score_onset_errors(word_tokens, silences)
    summary = summarize(results)
    summary["word_token_count"] = len(word_tokens)
    return results, summary


# ---------------------------------------------------------------------------
# CLI subcommands
# ---------------------------------------------------------------------------

def cmd_prepare(args):
    workdir = Path(args.workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    wav_path = workdir / "audio_16k.wav"
    print(f"[prepare] transcoding {args.audio} -> {wav_path} ...", file=sys.stderr)
    transcode_to_wav(args.ffmpeg_bin, Path(args.audio), wav_path,
                      args.sample_rate, args.channels)
    duration = probe_duration_sec(args.ffmpeg_bin, wav_path)
    print(f"[prepare] duration: {duration:.3f}s. running silencedetect "
          f"(noise={args.noise_db}dB, min_dur={args.min_duration}s) ...", file=sys.stderr)
    silences = run_silencedetect(args.ffmpeg_bin, wav_path, args.noise_db, args.min_duration)
    out = {
        "source_audio": str(args.audio),
        "wav_path": str(wav_path),
        "duration_sec": duration,
        "noise_db": args.noise_db,
        "min_duration_sec": args.min_duration,
        "silences": silences,
    }
    (workdir / "silences.json").write_text(json.dumps(out, indent=2))
    print(f"[prepare] {len(silences)} silences detected. wrote {workdir / 'silences.json'}", file=sys.stderr)


def cmd_transcribe(args):
    workdir = Path(args.workdir)
    wav_path = workdir / "audio_16k.wav"
    if not wav_path.exists():
        sys.exit(f"error: {wav_path} not found — run `prepare` first")

    out_prefix = workdir / f"whisper_out_{args.label}"
    elapsed, tokens, returncode, stdout_lines, cmd = run_whisper(
        whisper_bin=args.whisper_bin,
        model=args.model,
        wav_path=wav_path,
        language=args.language,
        max_len=args.max_len,
        nfa=args.nfa,
        dtw=args.dtw,
        json_out=args.json,
        out_prefix=out_prefix,
        extra_threads=args.threads,
    )

    (workdir / f"tokens_{args.label}.json").write_text(json.dumps(tokens, indent=2))
    if not args.json:
        (workdir / f"stdout_{args.label}.txt").write_text("\n".join(stdout_lines))

    meta = {
        "label": args.label,
        "cmd": cmd,
        "elapsed_sec": elapsed,
        "returncode": returncode,
        "token_count": len(tokens),
        "model": args.model,
        "nfa": args.nfa,
        "dtw": args.dtw,
        "json": args.json,
        "language": args.language,
    }
    (workdir / f"meta_{args.label}.json").write_text(json.dumps(meta, indent=2))

    print(f"[transcribe:{args.label}] elapsed={elapsed:.1f}s tokens={len(tokens)} "
          f"-> {workdir / f'tokens_{args.label}.json'}", file=sys.stderr)


def cmd_score(args):
    workdir = Path(args.workdir)
    silences = json.loads((workdir / "silences.json").read_text())["silences"]
    tokens = json.loads((workdir / f"tokens_{args.label}.json").read_text())
    meta = json.loads((workdir / f"meta_{args.label}.json").read_text())

    results, summary = score_tokens_against_silences(tokens, silences)
    summary["label"] = args.label
    summary["total_token_count"] = len(tokens)
    summary["elapsed_sec"] = meta["elapsed_sec"]

    if args.out_csv:
        import csv
        with open(args.out_csv, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=[
                "silence_start", "silence_end", "token_text",
                "token_start", "token_end", "onset_error_sec"])
            w.writeheader()
            for r in results:
                w.writerow(r)
        print(f"[score:{args.label}] wrote {len(results)} rows -> {args.out_csv}", file=sys.stderr)

    print(json.dumps(summary, indent=2))


def cmd_check_word(args):
    workdir = Path(args.workdir)
    tokens = json.loads((workdir / f"tokens_{args.label}.json").read_text())

    def norm(t):
        return re.sub(r"[^a-z0-9]", "", t.lower())

    target = norm(args.word)
    window = None
    if args.window:
        tmin, tmax = (float(x) for x in args.window.split(":"))
        window = (tmin, tmax)

    hits = []
    for t in tokens:
        if window and not (window[0] <= t["start"] <= window[1]):
            continue
        if target in norm(t["text"]):
            hits.append(t)

    result = {
        "label": args.label,
        "word": args.word,
        "window": window,
        "present": len(hits) > 0,
        "hits": hits,
    }
    print(json.dumps(result, indent=2))


def cmd_report(args):
    workdir = Path(args.workdir)
    rows = []
    for label in args.labels.split(","):
        label = label.strip()
        meta_path = workdir / f"meta_{label}.json"
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text())
        silences = json.loads((workdir / "silences.json").read_text())["silences"]
        tokens = json.loads((workdir / f"tokens_{label}.json").read_text())
        results, summary = score_tokens_against_silences(tokens, silences)
        rows.append({
            "label": label,
            "elapsed_sec": meta["elapsed_sec"],
            "token_count": len(tokens),
            **summary,
        })

    header = ["label", "elapsed_sec", "token_count", "word_token_count", "n_scored_pauses",
              "median_abs_onset_error_sec", "p95_abs_onset_error_sec",
              "negative_smear_count", "negative_smear_fraction"]
    widths = {h: max(len(h), 10) for h in header}
    print(" | ".join(h.ljust(widths[h]) for h in header))
    print("-+-".join("-" * widths[h] for h in header))
    for row in rows:
        cells = []
        for h in header:
            v = row.get(h)
            if isinstance(v, float):
                v = f"{v:.4f}"
            cells.append(str(v).ljust(widths[h]))
        print(" | ".join(cells))


def build_parser():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)

    pp = sub.add_parser("prepare", help="transcode audio + run silencedetect ground truth")
    pp.add_argument("--audio", required=True, help="source audio file (any ffmpeg-readable container)")
    pp.add_argument("--workdir", required=True)
    pp.add_argument("--ffmpeg-bin", default="ffmpeg")
    pp.add_argument("--sample-rate", type=int, default=16000)
    pp.add_argument("--channels", type=int, default=1)
    pp.add_argument("--noise-db", type=float, default=-45.0,
                     help="matches silenceDetector.ts's thresholdDb default")
    pp.add_argument("--min-duration", type=float, default=0.25,
                     help="matches silenceDetector.ts's minDurationSec default")
    pp.set_defaults(func=cmd_prepare)

    pt = sub.add_parser("transcribe", help="run whisper-cli once against the prepared WAV")
    pt.add_argument("--workdir", required=True)
    pt.add_argument("--whisper-bin", required=True)
    pt.add_argument("--model", required=True)
    pt.add_argument("--label", required=True, help="short config tag, e.g. a/b/c/d")
    pt.add_argument("--language", default="en")
    pt.add_argument("--max-len", type=int, default=1, help="whisper-cli -ml; production always uses 1")
    pt.add_argument("--nfa", action="store_true", help="pass -nfa (required for --dtw to take effect)")
    pt.add_argument("--dtw", default=None, help="DTW preset name, e.g. large.v3.turbo or large.v3")
    pt.add_argument("--json", action="store_true", help="pass -oj and parse the JSON output instead of stdout")
    pt.add_argument("--threads", type=int, default=None,
                     help="only for deliberate experiments — omit to match production's default (unset -> 4)")
    pt.set_defaults(func=cmd_transcribe)

    ps = sub.add_parser("score", help="compute word-onset-error stats for one config's tokens")
    ps.add_argument("--workdir", required=True)
    ps.add_argument("--label", required=True)
    ps.add_argument("--out-csv", default=None)
    ps.set_defaults(func=cmd_score)

    pc = sub.add_parser("check-word", help="check whether a word is present, optionally within a time window")
    pc.add_argument("--workdir", required=True)
    pc.add_argument("--label", required=True)
    pc.add_argument("--word", required=True)
    pc.add_argument("--window", default=None, help="TMIN:TMAX in seconds, e.g. 435:450")
    pc.set_defaults(func=cmd_check_word)

    pr = sub.add_parser("report", help="print a combined comparison table across configs")
    pr.add_argument("--workdir", required=True)
    pr.add_argument("--labels", required=True, help="comma-separated, e.g. a,b,c,d")
    pr.set_defaults(func=cmd_report)

    return p


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
