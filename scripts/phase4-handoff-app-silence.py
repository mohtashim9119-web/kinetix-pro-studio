#!/usr/bin/env python3
"""Phase 3->4 handoff, Step M — a byte-faithful Python port of
src/services/silenceDetector.ts's detectSilences() frame-RMS/dB scan.

Why this exists: the app's OWN silence source for boundary-snapping
(snapCoveredBoundaries) is silenceDetector.ts's Web Audio RMS scan, which is
a DIFFERENT algorithm from ffmpeg's `silencedetect` filter that
measure-word-onset.py's `prepare` step uses as an independent ground-truth
reference for Phase 1b-3's scoring. Re-using the ffmpeg-silencedetect output
as an input to a "what does the shipped app actually commit" replay would be
measuring the wrong silence source. This script replicates
silenceDetector.ts's exact frame loop (20ms frames, -45dB threshold, 0.25s
minimum duration, RMS -> dB, same boundary conditions including the trailing
open-silence case) against the already-transcoded 16kHz mono WAV, so the
committed-segment replay harness (phase4-handoff-replay-sync.mjs /
.test.ts) snaps against the same shape of silence array the real app would
produce.

Known, disclosed approximation: the app decodes the ORIGINAL voiceover file
(m4a, native sample rate) via AudioContext.decodeAudioData; this script reads
the already-produced 16kHz mono WAV transcode instead (the same file
measure-word-onset.py's `prepare` step already made, reused rather than
re-decoded a second way). Since every threshold in the algorithm is
time-based (ms/seconds), not sample-based, results at 16kHz vs. the source's
native rate differ only by sub-frame quantization noise -- not a source of
disagreement large enough to move a boundary discussion.

Usage:
    python3 phase4-handoff-app-silence.py --wav /tmp/phase3/v6/audio_16k.wav --out /tmp/phase3/v6/silences_app.json
"""
import argparse
import json
import math
import wave
import struct


def read_mono_pcm(wav_path: str):
    with wave.open(wav_path, "rb") as w:
        assert w.getnchannels() == 1, f"expected mono WAV, got {w.getnchannels()} channels"
        assert w.getsampwidth() == 2, f"expected 16-bit PCM, got {w.getsampwidth()*8}-bit"
        sample_rate = w.getframerate()
        n_frames = w.getnframes()
        raw = w.readframes(n_frames)
    samples = struct.unpack(f"<{n_frames}h", raw)
    # normalize int16 -> float32 [-1, 1], matching Web Audio's AudioBuffer.getChannelData
    channel_data = [s / 32768.0 for s in samples]
    return channel_data, sample_rate


def detect_silences(channel_data, sample_rate, threshold_db=-45.0, min_duration_sec=0.25, frame_size_ms=20):
    frame_size_samples = math.floor((frame_size_ms / 1000) * sample_rate)
    if frame_size_samples < 1:
        raise ValueError(f"frame size {frame_size_ms}ms is below one sample at {sample_rate}Hz")

    total_frames = len(channel_data) // frame_size_samples
    silences = []
    silence_start = None

    for f in range(total_frames):
        offset = f * frame_size_samples
        frame = channel_data[offset:offset + frame_size_samples]
        sum_sq = sum(s * s for s in frame)
        rms = math.sqrt(sum_sq / frame_size_samples)
        db = -math.inf if rms == 0 else 20 * math.log10(rms)
        frame_sec = (f * frame_size_samples) / sample_rate

        if db < threshold_db:
            if silence_start is None:
                silence_start = frame_sec
        else:
            if silence_start is not None:
                if frame_sec - silence_start >= min_duration_sec:
                    silences.append({"startSec": silence_start, "endSec": frame_sec})
                silence_start = None

    if silence_start is not None:
        end_sec = (total_frames * frame_size_samples) / sample_rate
        if end_sec - silence_start >= min_duration_sec:
            silences.append({"startSec": silence_start, "endSec": end_sec})

    return silences


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--threshold-db", type=float, default=-45.0)
    ap.add_argument("--min-duration-sec", type=float, default=0.25)
    ap.add_argument("--frame-size-ms", type=float, default=20)
    args = ap.parse_args()

    channel_data, sample_rate = read_mono_pcm(args.wav)
    silences = detect_silences(
        channel_data, sample_rate,
        threshold_db=args.threshold_db,
        min_duration_sec=args.min_duration_sec,
        frame_size_ms=args.frame_size_ms,
    )
    with open(args.out, "w") as f:
        json.dump({
            "source_wav": args.wav,
            "sample_rate": sample_rate,
            "threshold_db": args.threshold_db,
            "min_duration_sec": args.min_duration_sec,
            "frame_size_ms": args.frame_size_ms,
            "n_silences": len(silences),
            "silences": silences,
        }, f, indent=2)
    print(f"[app-silence] {len(silences)} silences written to {args.out}")


if __name__ == "__main__":
    main()
