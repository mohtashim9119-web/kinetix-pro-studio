# Cloud ASR measurements (Modal proof of concept)

Recorded 2026-09-16. Branch `ws-cloud-asr-plan`. This is a measurement
report, not a description of shipped behaviour. Functions live under
`cloud/` and are not wired into the desktop app.

Plan under test: [`cloud-asr-plan.md`](cloud-asr-plan.md). Where a number
contradicts that plan, it is called out rather than reconciled.

**Workspace:** Modal `thekingsmanco99`. **Cloud:** AWS for T4 (regions
unpinned: `us-west-1`, `us-east-1`, `eu-central-1` all appeared in one
cold-start series); GCP `us-central1` for L4. **GPU tiers:** Nvidia T4
(16 GB, $0.59/h) and Nvidia L4 (24 GB, $0.80/h) from `modal billing rates`
the same day. **Weights:** CTranslate2 `dropbox-dash/faster-whisper-large-v3-turbo`
(public conversion of `openai/whisper-large-v3-turbo`;
`Systran/faster-whisper-large-v3-turbo` returned HTTP 401 without a token).
FA packs from `mohtashim9/kinetix-fa-models` revision
`f618960d71728eba5f12528d5571838a10d262bf`.

---

## Verdicts on the three unknowns

1. **Cold start requires warm containers for anything interactive.** Model
   load from a Modal volume is fast (~3 s whisper, ~4 s FA ONNX). Client-facing
   empty-container time is not: T4 whisper pings were **7.5 s, 155.5 s, 20.1 s**.
   The 155 s run was GPU scheduling (load inside the container was still 3.6 s)
   and landed in `eu-central-1`. Memory snapshots made the three T4 restores
   **more consistent (24.2 / 26.5 / 31.6 s) but not faster than the best empty
   start**, and did not remove the scheduling wait. This **contradicts** a
   reading of the plan that volume-cached weights are the whole cold-start
   problem; they are not. Scheduling is.

2. **Throughput and cost are better than the plan's caution, on T4.** Warm
   T4 faster-whisper ran the 23.7-minute V6 file in **42.0 s processing
   (RTF 33.9×)** and the one-hour file in **110.5 s (RTF 32.6×)**. Peak GPU
   memory was **2.65 GiB of 15.4 GiB**. T4 is the cheapest Modal GPU and it
   is enough; L4 was ~12% faster and ~35% more expensive. Derived warm-hour
   cost at published rates is **~$0.024 per audio hour**. Dashboard
   per-invocation line items do not exist; session totals do (below).

3. **The two engines are not interchangeable for sync.** Local whisper.cpp
   `-ml 1` emitted **4556** tokens; Modal faster-whisper `word_timestamps=True`
   emitted **3960**. Mean |Δstart| on sequentially matched tokens was
   **295 ms**, mean |Δend| **285 ms**, max **8.35 s**. That is not "a few
   tens of milliseconds." The plan's provenance-recording rule is
   **load-bearing**, not precautionary. The plan already predicted this;
   the measurement confirms it rather than contradicting it.

---

## Fixtures (step 1)

Source: V6 corpus `6.m4a`, 32,851,696 bytes, duration 1421.283991 s.
Last baseline token ends at 1420.06 s
(`scripts/fixtures/phase4-baseline-v6-words.csv`). ffmpeg 8.1.1.

Plan per-hour figures: WAV **115,200,078** bytes; Opus CBR 16 kbps
**7,477,405** bytes.

| File | Duration (s) | Bytes | Plan-scaled | Δ |
|---|---:|---:|---:|---:|
| `v6_16k.wav` (`pcm_s16le`, 16 kHz mono) | 1421.293438 | 45,481,468 | 45,481,421 | +47 |
| `v6_16k_cbr16k.opus` (libopus `-b:a 16k -vbr off`) | 1421.299938 | 2,952,316 | 2,952,121 | +195 |
| `hour_16k.wav` | 3600.000000 | 115,200,078 | 115,200,078 | **0** |
| `hour_16k_cbr16k.opus` | 3600.006500 | 7,477,405 | 7,477,405 | **0** |

V6 sizes match the plan's per-hour figures scaled to actual duration
(WAV within 47 bytes; Opus within 0.007%). The one-hour files match the
plan **exactly**. Opus containers report 48 kHz timestamps (libopus
convention) despite `-ar 16000`.

The hour file is V6 concatenated to itself until >3600 s, then trimmed
with `-t 3600`. It exists only to exercise the duration ceiling.

---

## Transcription on Modal (step 2)

Image: `nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04` + ffmpeg +
faster-whisper 1.1.1. First deploy used `debian_slim` and loaded weights
onto the GPU but failed inference (`Library libcublas.so.12 is not found`).
Cold-start **pings** below were taken on that first image (model load only).
Warm transcribes were taken after the CUDA image redeploy. A CUDA-image
warm ping was 14.6 s, inside the empty-container range.

Volume: `kinetix-whisper-weights`. `scaledown_window=2`. A discarded first
ping primed the image; containers were then `modal container stop -y`'d
between measured pings.

### Cold start, empty container, T4, three runs

| Run | Client (s) | Model load inside container (s) | Region |
|---|---:|---:|---|
| prime (discarded, image pull) | 30.224 | 3.062 | us-west-1 |
| 1 | **7.530** | 2.955 | us-west-1 |
| 2 | **155.527** | 3.643 | eu-central-1 |
| 3 | **20.149** | 2.733 | us-east-1 |

GPU memory after load: **2504 MB / 15360 MB** (Tesla T4).

### Cold start, memory snapshots (CPU+GPU snapshot flags), T4, three runs

| Run | Client (s) | Snapshotted loadSec | Region |
|---|---:|---:|---|
| prime (snapshot create) | 30.551 | 2.357 | us-east-1 |
| 1 | 24.226 | 2.357 | us-east-1 |
| 2 | 26.463 | 2.357 | us-east-1 |
| 3 | 31.642 | 2.357 | us-east-1 |

Snapshots reduced variance versus the 155 s empty-container outlier and
did **not** beat the 7.5 s best empty start. `loadSec` is identical across
snapshot restores because it is the time recorded during snapshot
creation, not restore duration.

**Contradiction vs plan:** the plan's cold-start fear was "attaching
1,624,555,275 bytes of weights." Volume attach + GPU load is ~3 s. The
unpredictable part is getting a T4 at all, including a 155 s schedule
onto another continent.

### Warm invocation

| File | GPU | Client (s) | Processing (s) | RTF (audio / processing) | Tokens | GPU used (MB) |
|---|---|---:|---:|---:|---:|---:|
| V6 23.7 min | T4 | 45.611 | 41.971 | **33.86×** | 3960 | 2646 / 15360 |
| 1 hour | T4 | 114.153 | 110.513 | **32.58×** | 9980 | 2646 / 15360 |
| V6 23.7 min | L4 | 40.938 | 36.934 | **38.48×** | 3959 | 2763 / 23034 |

Local whisper.cpp on this machine (production args, CPU/BLAS, 4 threads):
**1018.42 s** wall for V6 (RTF 1.40×). Cloud T4 is ~24× faster than that
local run, not a comment on a Metal-on local binary.

### GPU tier

T4 peak 2.65 GiB. Modal has no cheaper GPU than T4. L4 saved ~5 s on V6
and costs $0.80/h vs $0.59/h. **T4 is the cheapest acceptable tier.**

### Cost

`modal billing report --for today --show-resources` (same data the
dashboard meters) for this workspace, 2026-09-16:

| App | T4 | L4 | CPU | Memory |
|---|---:|---:|---:|---:|
| `kinetix-cloud-asr-poc` | $0.149987 | $0.012444 | $0.028130 | $0.017355 |
| `kinetix-cloud-fa-poc` | $0.017044 | — | $0.004191 | $0.001885 |
| `kinetix-cloud-asr-seed` | — | — | $0.004189 | $0.001389 |

Workspace metered total today: **$0.237** (covered by credits; billed
$0.00). That is a **session total**, not a per-invocation line item.
Per-invocation cost is **unmeasured on the dashboard**. Derived from
published rates × measured client seconds for the warm T4 hour:

| Meter | Rate | 114.153 s | Notes |
|---|---|---:|---|
| T4 | $0.59 / h | $0.01871 | |
| CPU (2 cores) | $0.0473 / core / h | $0.00300 | requested `cpu=2` |
| Memory (8 GiB) | $0.008 / GiB / h | $0.00203 | requested `memory=8192` |
| **Implied / audio hour** | | **~$0.024** | warm, T4, no cold start |

V6 T4 warm, same method: **~$0.0095** per 23.7 min, **~$0.024 / audio hour**.
L4 V6 GPU-only: 40.938 × $0.80 / 3600 = **$0.0091** vs T4 GPU **$0.0075**.

---

## Token parity (step 3)

Local: bundled `whisper-x86_64-apple-darwin`,
`ggml-large-v3-turbo.bin`, args exactly `-m … -f v6_16k.wav -ml 1 -l en`.
Cloud: faster-whisper large-v3-turbo, `word_timestamps=True`, `beam_size=5`,
`vad_filter=False`. Same V6 audio (local on WAV, cloud on Opus CBR 16 kbps).

Sequential match on canonicalized text (`NFKC` + casefold + non-alnum strip),
then exact-text count on those pairs.

| | |
|---|---:|
| Local token count | 4556 |
| Cloud token count | 3960 |
| Sequentially matched | 3830 |
| Identical text (stripped) | 3349 |
| Only in local | 726 |
| Only in cloud | 130 |
| Mean \|Δstart\| (matched) | **0.295 s** |
| Median \|Δstart\| | 0.230 s |
| Max \|Δstart\| | **8.35 s** |
| Mean \|Δend\| | **0.285 s** |
| Median \|Δend\| | 0.220 s |
| Max \|Δend\| | **7.31 s** |

Local `-ml 1` emits punctuation and split fragments (`cover` + `ed`,
standalone `.` / `,` / `-`). Cloud emits whole words, sometimes with
attached punctuation (`hearth.`, `-covered`). Only-local head is almost
all punctuation and splits; only-cloud head is hyphenated/compound words
the local stream broke apart.

Worst matched start: local `You` at 78.97 s vs cloud `You` at 87.32 s
(8.35 s). That is a real alignment divergence, not a tokenizer mismatch.

**Not interchangeable.** A silent engine swap would move Hirschberg,
rescue, and every FA chunk boundary that depends on Whisper tokens. Record
the producing engine on the project.

---

## Chunked parallelism (step 4)

Naive equal splits of the one-hour WAV, re-encoded to Opus CBR 16 kbps,
**no overlap, no silence snap**. Time offsets added after each chunk.
Fan-out via `TranscriberT4.transcribe.spawn` on T4, `max` concurrency
left at Modal default.

| Parallel containers | Wall (s) | Sum processing (s) | Max chunk processing (s) | Tokens |
|---:|---:|---:|---:|---:|
| 1 | 118.494 | 112.289 | 112.289 | 10004 |
| 4 | **52.326** | 115.733 | 32.811 | 10188 |
| 10 | **324.232** | 157.656 | 20.293 | 10015 |

Single-file warm hour was 114.153 s / 9980 tokens (step 2). n=1 here is
the same job plus a ping and is consistent.

**10 containers were slower than 1.** Chunk processing dropped to ~12–20 s
but wall time was 324 s because T4s were queued. This **contradicts** a
plan reading that fan-out of a one-hour file is automatically a win.
Four-way was the only measured win (2.3× wall vs one container).

Cost at each fan-out is **unmeasured as a dashboard line item**. GPU-seconds
are at least the `sumProcessingSec` column plus however long each
container sat waiting for a GPU. n=10's 324 s wall with 10 workers is
why the session T4 meter is $0.15 rather than ~$0.02.

### Seam damage (naive split, reported honestly)

Cuts at exact `i * (3600/n)` seconds.

**n=4**

- t=900: `experience.` then `allow,` — sentence cut, 40 ms gap.
- t=1800: `are` then `you` — a two-word sequence split across the
  boundary (`are you`).
- t=2700: last token `1st.` at 2699.92; next token `you` at 2701.08
  (**1.16 s hole**). The seam detector's 1.0 s window reported
  `firstAfter=None`. Speech after the cut is delayed, not duplicated.
  +184 tokens vs n=1 (10188 vs 10004) — extra fragments at cuts plus
  independent decoding of each 15 min window.

**n=10**

- t=1440: **`night.` duplicated** on both sides of the cut (1439.98 and
  1440.00). Naive splitting cut a word and both chunks emitted it.
- t=2160: 0.92 s gap (`have.` → `run`) — lost or delayed speech.
- Other seams: 0–60 ms gaps, words such as `following` / `you` split
  across the cut.

Boundary handling is the real engineering problem. Overlap + ordinal
dedupe, or silence-snapped cuts, are not in this POC.

---

## Forced alignment (step 5)

License gate, re-checked 2026-09-16: Hugging Face
`GET /api/models/mohtashim9/kinetix-fa-models` now returns
`cardData.license: apache-2.0` at sha `fa3db136daa49d3809e744fb8aacd06430a7442e`.
The plan recorded this tag as **missing**. It is present as of this run,
so the function was deployed. Origin Grosman checkpoints remain Apache-2.0.
ONNX files were still fetched at the pinned revision
`f618960d71728eba5f12528d5571838a10d262bf`. All five packs
(`en es fr de pt`) are in volume `kinetix-fa-weights`. MMS-FA was not
touched.

The aligner loads **English only** at container start (one 1.26 GiB pack,
matching "one language pack per container"). It returns `FaWordSpan`
`{ word, startSec, endSec, confidence, needsReview, wordIndex }`. The
decode is a **POC even-spacing fallback after an ONNX forward**, not the
production Viterbi in `fa_onnx.rs`. Word timings below are therefore
**not** a parity result against local FA.

### FA T4, English pack, first 30 s of V6, one chunk

| | Client (s) | Load inside container (s) | GPU used (MB) |
|---|---:|---:|---:|
| prime (image pull) | 33.949 | 15.984 | 2618 / 15360 |
| cold 1 | 10.505 | 3.645 | 2615 / 15360 |
| cold 2 | 26.611 | 4.382 | 2614 / 15360 |
| cold 3 | 11.190 | 3.435 | 2614 / 15360 |
| warm ping (after stop; really another cold) | 26.820 | 3.133 | 2614 / 15360 |
| warm `align` (model already in that container) | **8.012** | (reuse) | 2624 / 15360 |

Warm align processing **4.662 s** for a 30 s chunk, 24 word spans.
Volume-cached ONNX load after the first pull is **3.4–4.4 s**. That is
fast enough that keeping a container warm *just to avoid re-reading
weights* is unnecessary. Keeping one warm **to skip T4 scheduling
(10–27 s)** is the same story as transcription.

FA app session cost (dashboard report): T4 **$0.017044** + CPU/memory
**$0.006**. Per-invocation dashboard: **unmeasured**.

---

## Unmeasured (not estimated)

- Dashboard **per-invocation** cost. The billing report groups by app /
  resource / hour, not by function call. Session totals and
  rate × GPU-second derivations are what exist.
- Cold-start pings on the CUDA image (three empty + three snapshot were
  taken on `debian_slim` before cublas was added). One CUDA ping (14.6 s)
  sits inside that range; a full re-series was not repeated.
- FA on a full V6 / one-hour chunk plan, and FA vs local ONNX Viterbi
  parity. Out of scope of a load/cost probe; the POC decoder is not the
  production aligner.
- L4 hour file, L4 FA, A10G or anything above L4.
- Pinned Modal region. T4 scheduling across `us-west-1` / `us-east-1` /
  `eu-central-1` was left on Modal's default.
- Upload time from a real user's machine. Fixtures were already on the
  client that called `.remote()`.
- Whisper.cpp with Metal enabled. Production sidecar on this host used
  the BLAS backend (`no GPU found`).
