#!/usr/bin/env python3
"""ws1-whisper-raw-tokens.py — WS1 Session P, the RAW whisper-token arm.

WHY THIS EXISTS (Session P, Step 1 measurement). The harness's existing
whisper input, `transcript_tokens.json`, is the POST-`filterMalformedTokens`
array (v6: 3989 tokens) recovered from the Phase 2a inspector export. The
shipped app does not hand that array to the rule stage.

`src/hooks/useWhisper.ts` stores `transcriptTokens: tokens` — the RAW,
UNFILTERED array (v6: 4556 tokens). `filtered.tokens` is used for ALIGNMENT
ONLY and is never persisted. `src/App.tsx` then passes
`projectRef.current.transcriptTokens!` — the raw array — to R.10, R.11, R.12
and R.13.

MEASURED delta on v6: 4556 raw vs 3989 filtered = 567 tokens
(493 `empty-text`, 74 `inverted-or-zero-duration`). `empty-text` does NOT mean
the string is empty — `parse_stdout_tokens` in `src-tauri/src/whisper.rs`
already drops literally-empty text. It means `normalize(text).length === 0`,
i.e. PUNCTUATION-ONLY tokens (`,` `.` `?`), which carry real timestamps.

Why that matters, structurally: R.11's `fit` is
`scriptWordCount / tokenOnsetCount`, and its denominator counts WHISPER token
onsets inside the chunk window. Feeding 3989 tokens where production feeds
4556 inflates `fit` by ~14%, which moves `fitDeviation` across
`R11_MIN_FIT_DEVIATION`. R.12's `computeUnscriptedRuns` reads the same array.
So the pre-filtered arm does not merely perturb the rules — it changes which
of them fire.

DERIVATION. Reproduces the app's own chain exactly: whisper-cli invoked with
`src-tauri/src/whisper.rs`'s arguments (`-ml 1 -l <lang>`, model
`ggml-large-v3-turbo.bin`) against the same 16 kHz mono transcode the Rust
side makes (`-ar 16000 -ac 1`), then parsed by a line-for-line port of that
file's `parse_stdout_tokens`. The token COUNT is asserted against the count
the live app logged, so a silently-different transcript cannot pass unnoticed.

NOTE: the 16 kHz transcode is CORRECT here. whisper.rs genuinely feeds
whisper-cli a 16 kHz mono wav. That is a different question from the silence
arm (`ws1-native-silences.py`), where the app decodes the original at native
rate and the 16 kHz transcode was the defect.

Usage:
    python3 scripts/ws1-whisper-raw-tokens.py \
        --stdout .work-phase4/replay/v6/whisper_raw.stdout \
        --out .work-phase4/replay/v6/whisper_raw_tokens.json \
        --expect 4556
"""
import argparse
import json


def parse_timestamp(ts: str) -> float:
    """Port of whisper.rs's parse_timestamp (HH:MM:SS.mmm / HH:MM:SS,mmm)."""
    ts = ts.strip().replace(",", ".")
    parts = ts.split(":")
    if len(parts) != 3:
        return 0.0
    try:
        h, m, s = float(parts[0]), float(parts[1]), float(parts[2])
    except ValueError:
        return 0.0
    return h * 3600.0 + m * 60.0 + s


def parse_stdout_tokens(lines) -> list:
    """Line-for-line port of whisper.rs's parse_stdout_tokens.

    Including its final `if !text.is_empty()` guard — which drops LITERALLY
    empty text only. Punctuation-only tokens survive here, exactly as they do
    in production, and are dropped later by filterMalformedTokens' normalize()
    check (which the rule stage never sees).
    """
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
            tokens.append({"text": text, "startSec": start_sec, "endSec": end_sec})
    return tokens


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stdout", required=True, help="captured whisper-cli stdout")
    ap.add_argument("--out", required=True)
    ap.add_argument("--expect", type=int, default=None,
                    help="token count the live app logged; hard-fails on mismatch")
    args = ap.parse_args()

    with open(args.stdout, encoding="utf-8", errors="replace") as f:
        lines = f.read().splitlines()
    tokens = parse_stdout_tokens(lines)

    if args.expect is not None and len(tokens) != args.expect:
        raise SystemExit(
            f"token count mismatch: parsed {len(tokens)}, live app logged {args.expect}.\n"
            "The raw arm must reproduce the live array exactly; investigate before using it."
        )

    with open(args.out, "w") as f:
        json.dump({"n_tokens": len(tokens), "tokens": tokens}, f, indent=2)
    print(f"[whisper-raw] {len(tokens)} raw tokens -> {args.out}")


if __name__ == "__main__":
    main()
