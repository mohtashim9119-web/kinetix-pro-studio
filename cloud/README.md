# Cloud ASR proof of concept

Measurement-only Modal functions. Nothing here is a production service and
nothing ships in the desktop app. The three questions this answers are
recorded in [`docs/architecture/cloud-asr-measurements.md`](../docs/architecture/cloud-asr-measurements.md).

Work stays under `cloud/` plus that one measurements document. Audio fixtures
are gitignored.

## Prerequisites

- ffmpeg with libopus (Homebrew `ffmpeg` 8.x is fine)
- Python 3.11+ and the Modal CLI (`pip install modal`)
- A Modal account: `modal token new`
- The V6 corpus voiceover `6.m4a` (documented path in `prepare_fixtures.sh`)
- For local parity: the bundled `whisper-cli` binary and
  `ggml-large-v3-turbo.bin` (see `run_local_whisper.sh`)

## Fixtures

```sh
./cloud/prepare_fixtures.sh
```

Writes four files under `cloud/fixtures/` (not committed):

| File | What |
|---|---|
| `v6_16k.wav` | V6 voiceover, production flags `-ar 16000 -ac 1` → `pcm_s16le` |
| `v6_16k_cbr16k.opus` | same audio, libopus CBR 16 kbps (`-b:a 16k -vbr off`) |
| `hour_16k.wav` | V6 concatenated until >3600 s, then trimmed to exactly 1 hour |
| `hour_16k_cbr16k.opus` | that hour, same Opus setting |

Plan per-hour sizes (from `docs/architecture/cloud-asr-plan.md`): WAV
115,200,078 bytes; Opus CBR 16 kbps 7,477,405 bytes. The hour fixtures
must match those exactly. V6 sizes should match the same figures scaled
to the file's actual duration.

## Deploy transcription

Weights are not baked into the image. `cloud/seed.py` writes
`dropbox-dash/faster-whisper-large-v3-turbo` (the public CTranslate2
conversion of `openai/whisper-large-v3-turbo`; the Systran-named repo
returns 401 without a token) into the `kinetix-whisper-weights` volume.
GPU classes load from `/models/faster-whisper-large-v3-turbo`.

The runtime image is `nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04`.
`debian_slim` plus a GPU is not enough: CTranslate2 loads weights then
dies at encode with `libcublas.so.12 is not found`.

```sh
modal deploy cloud/app.py
modal run cloud/seed.py::seed_whisper_weights
```

Classes:

- `TranscriberT4` — T4, no snapshot
- `TranscriberT4Snapshot` — T4, CPU+GPU memory snapshots
- `TranscriberL4` — L4, no snapshot

Each `transcribe` method accepts Opus (or WAV) bytes and returns
`{ startSec, endSec, text }` tokens plus a `metrics` block (load time,
processing time, nvidia-smi used/total MB, Modal region).

## Measure

```sh
python cloud/measure.py cold-empty      # 3 empty-container pings, T4
python cloud/measure.py cold-snapshot   # 3 snapshot-restore pings, T4
python cloud/measure.py warm            # V6 + 1-hour warm transcribe, T4
python cloud/measure.py gpu-l4          # V6 warm transcribe, L4
python cloud/measure.py chunked         # 1 / 4 / 10 naive splits of the hour
python cloud/measure.py fa              # legacy even-spacing 30 s probe (superseded)
python cloud/measure.py fa-cold         # T4 empty-container pings, real Viterbi image
python cloud/measure.py fa-v6           # full V6 production chunk plan, T4
python cloud/measure.py fa-spanish      # Spanish fixture + 5-chunk plan, T4
python cloud/measure.py fa-hour         # tiled one-hour plan, T4
python cloud/measure.py fa-cpu          # V6 on CPU-only
python cloud/measure.py fa-packs        # load+align all five language packs
```

JSON dumps land in `cloud/results/` (gitignored). `scaledown_window=2` plus
an explicit `modal container stop -y` sits between cold-start runs so each
ping is a real empty container.

Billing is `modal billing report --for today -r h --show-resources`. There
is no per-invocation dashboard row; session totals plus rate × GPU-seconds
are what this POC can report.

## Local whisper.cpp parity

Production arguments, nothing else:

```sh
./cloud/run_local_whisper.sh            # defaults to V6 WAV, language en
python cloud/compare_tokens.py \
  --local cloud/results/v6_local.stdout \
  --cloud cloud/results/cloud_v6_tokens.json \
  --out cloud/results/parity.json
```

`run_local_whisper.sh` invokes the sidecar as the app does:
`-m ggml-large-v3-turbo.bin -f <wav> -ml 1 -l en`.

## Forced alignment

`cloud/align.py` is the second Modal function: ONNX packs from
`mohtashim9/kinetix-fa-models` at revision `f618960d71728eba5f12528d5571838a10d262bf`,
chunk plan in, `FaWordSpan` (`word`, `startSec`, `endSec`, `confidence`,
`needsReview`, `wordIndex`) out. English loads at container start; other
packs lazy-load from the volume. The decoder in `cloud/fa_engine.py` is
the production CTC Viterbi (`fa_viterbi.rs`) plus the ONNX word-merge
path, not the 2026-09-16 even-spacing placeholder.

Hard gate: do **not** seed or deploy unless the conversion repo's Hugging
Face card carries an Apache-2.0 license tag:

```sh
python cloud/measure.py license
# only if that reports ok=true:
modal run cloud/seed.py::seed_fa_weights
modal deploy cloud/align.py
```

Local English parity (existing FA path, `fa-inference`, production
`load_session`):

```sh
./cloud/run_local_fa.sh
python cloud/compare_fa.py \
  --local cloud/results/local_fa_v6/arm_prod.json \
  --cloud cloud/results/fa_cloud_v6.json \
  --out cloud/results/fa_parity_v6.json
```

Chunk plans consumed by both sides are the frozen production dumps
(`.work-phase4/replay/{v6,spanish}/fa_production_chunks.json`). Rebuild
the live TypeScript planner with `npx vite-node cloud/build_chunk_plan.ts v6`
if you need to see planner drift (273 vs 280 chunks on 2026-09-17).

Viterbi fixture check (no ONNX): `python3 cloud/test_fa_decoder.py`.

Origin Grosman wav2vec2-XLSR-53 checkpoints are already Apache-2.0. The
gate is the conversion-repo tag. MMS-FA remains barred.
