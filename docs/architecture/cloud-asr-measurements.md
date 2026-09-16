# Cloud ASR measurements (Modal proof of concept)

Recorded 2026-09-16; FA Viterbi section added 2026-09-17. Branch `ws-cloud-asr-plan`. This is a measurement
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

## Forced alignment — placeholder run (2026-09-16, superseded)

The 2026-09-16 FA numbers below measured ONNX **load and forward only**.
The decoder was an even-spacing placeholder after the logits. Those
figures are **not real alignment**. They are kept so the contradiction
with the 2026-09-17 Viterbi run is visible.

License was already `apache-2.0` on the conversion repo. English pack
only at enter. Warm 30 s chunk: **4.662 s** processing, 24 even-spaced
spans, T4 peak ~2.6 GiB, implied RTF **6.4×**. That 6.4× is
overhead-dominated on a tiny clip and **does not describe** production
Viterbi throughput (see the next section).

Cold pings from that run: 10.5 / 26.6 / 11.2 s client, 3.4–4.4 s load.

---

## Forced alignment — production Viterbi (2026-09-17)

Recorded 2026-09-17. Same Modal workspace `thekingsmanco99`, AWS T4,
onnxruntime 1.23.2 (GPU and CPU). Weights still the pinned revision
`f618960d71728eba5f12528d5571838a10d262bf` in volume `kinetix-fa-weights`.
HF card license re-checked the same day: **`apache-2.0`** (head sha
`fa3db136daa49d3809e744fb8aacd06430a7442e`). Gate passed.

**Parity verdict:** cloud FA is **not interchangeable** with local FA
under the owner's threshold (mean < 10 ms **and** max < 50 ms).
English V6: 3874/3874 identical text, mean |Δstart| **8.16 ms** (under
the mean bar), max |Δstart| **1.84 s** (fails the max bar); 108 words
beyond 50 ms. Spanish: interchangeable (mean 0.88 ms, max 20 ms, 249/249
identical). The Viterbi port itself is frame-identical to
`fa_viterbi.rs` on the three emission fixtures. Modal T4 and Modal CPU
are bit-identical to each other. The remaining English outliers are
therefore **ONNX-runtime numeric differences** (Python onnxruntime 1.23.2
vs the bundled Rust `ort` C API 1.23.2), not a decoder-translation bug
and not CUDA vs CPU.

### Algorithm as ported

Read-only from `fa_viterbi.rs` / `fa_onnx.rs` / `faTextNormalize.ts`
(not `fa_dev.rs` — that file is the IPC wrapper; the DP lives in
`fa_viterbi.rs`).

- **Emissions:** zero-mean/unit-variance on the chunk PCM
  (`(x-mean)/sqrt(var+1e-7)`, f64 accum, f32 out), ONNX `input_values` →
  `logits`, then per-row log-softmax. Viterbi consumes log-probabilities,
  never raw logits.
- **Targets:** `normalizeForForcedAlignment` then characters mapped
  through the committed `fa-vocab-<lang>.json`, with `|` inserted between
  fragments. Blank is `<pad>`. Unrepresentable words are dropped.
- **Transition model:** CTC lattice `S = 2L+1`
  (blank/label/blank/…/blank). From state `i` the DP considers stay
  (`x0`), previous (`x1`), and skip-a-blank (`x2`) only when `i` is a
  label, `i != 1`, and `targets[i/2] != targets[i/2-1]`. Ties prefer
  stay. `T >= L+R` or `TooManyRepeats`.
- **Blank handling:** blank states on even `i`. `merge_tokens` drops
  blank runs only; `|` delimiter runs survive and become word boundaries.
  Immediate character repeats keep a mandatory blank between them.
- **Backtrack:** pick the better of the last two states, then walk
  `back_ptr` from `t=T-1` down to `t=1` (`t=0` is unwritten, skipped as
  in the Rust port). Path labels become per-frame scores gathered from
  the emission, not alpha totals.
- **Frame clock:** `frame_to_seconds(i) = i * 320 / 16000` (exactly
  0.02 s/frame). Chunk-local seconds plus `chunk.startSec`.
  `confidence = exp(score)`, `needsReview = confidence < 0.3`.

Choices that were not a line-for-line copy:

1. **NFC.** Python `unicodedata.normalize('NFC')` matches the TypeScript
   source of truth. Rust uses a scoped compose table because std has no
   NFC; on the five shipped vocabs they agree.
2. **log-softmax / Viterbi arithmetic** uses Python float (f64) rather
   than Rust `f32`. Emission fixtures still matched at `1e-5`. This is
   the one arithmetic deviation that could still move a DP tie.
3. **ONNX session.** Python `onnxruntime==1.23.2` with
   `enable_mem_pattern=False`, intra-op 1 (T4) or 4 (CPU). Local uses
   `ort` 1.23.2 C API, intra-op = physical cores, `deterministic_compute`.
   The Python `session.use_deterministic_compute` config key is best-effort.
4. **Infeasible chunks.** Python applies the production even-spacing
   `TooManyRepeats` fallback. The cargo dump test panics instead. V6 and
   Spanish had **zero** fallbacks, so the paths are comparable.
5. **Chunk plan.** Both engines used the frozen production plan
   `fa_production_chunks.json` (V6 280 chunks, Spanish 5). The live
   TypeScript planner on 2026-09-17 emits **273** V6 chunks
   (`cloud/results/chunk_plan_v6_live.json`). That planner drift is a
   separate finding; mixing the two plans would invalidate parity.

### Accuracy

Local English is a live `cargo test --features fa-inference` of
`intra_thread_sweep_arm_v6` with `FA_SWEEP_INTRA=prod` (real
`load_session`). That dump is bit-identical to the stored
`.work-phase4/replay/v6/fa_production_words.json` (mean |Δ|
`1.4e-14` s). Spanish local is that same stored production-path dump;
V6 proves the capture is still today's engine.

| Corpus | Local n | Cloud n | Identical text | Mean \|Δstart\| | Max \|Δstart\| | ≤10 ms | ≤50 ms | >50 ms | Interchangeable? |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| V6 English, 280-chunk plan | 3874 | 3874 | 3874 | **8.16 ms** | **1.84 s** | 3588 | 3766 | **108** | **no** |
| Spanish, 5-chunk plan | 249 | 249 | 249 | **0.88 ms** | **20 ms** | 238 | 249 | 0 | **yes** |

V6 outliers cluster; they are not randomly sprinkled:

- i=330–331 `are` / `eleven` around 126–128 s (max 1.84 s)
- i=1666–1669 `you` / `only` / `know` / `you` around 629–631 s (max 1.08 s)

92.6% of V6 words are within 10 ms, 97.2% within 50 ms. The owner's max
bar still fails. Mixing cloud and local FA on English would produce
measurably different sync on those words. Provenance-recording is
load-bearing for FA the same way it already is for transcription.

Modal T4 vs Modal CPU on V6: **0.0 ms everywhere** (bit-identical). GPU
is not the source of the local/cloud gap.

### Duration and cost

Published rates the same day: T4 **$0.59/h**, CPU **$0.0473/core/h**,
memory **$0.008/GiB/h**. Dashboard per-invocation: **unmeasured**.

| Job | Device | Processing (s) | Client (s) | RTF | Words | Peak mem |
|---|---|---:|---:|---:|---:|---|
| V6 23.7 min, 280 chunks | T4 | **25.819** | 32.522 | **55.05×** | 3874 | 4696 / 15360 MB (en+es cached) |
| V6 | Modal CPU, 4 cores | **179.058** | 193.947 | **7.94×** | 3874 | (no GPU) |
| V6 | local Rust `load_session` | **275.95** loop (forward 275.58, Viterbi 0.156) | — | **5.16×** | 3874 | 2081 MiB RSS |
| Hour tiled plan, 702 chunks | T4 | **66.495** | 103.732 | **54.14×** | 9757 | 2628 / 15360 MB |
| Spanish 92 s, 5 chunks | T4 | **3.087** | 19.929 | **29.8×** | 249 | 4684 / 15360 MB |

**The 6.4× placeholder RTF does not hold.** It was worse because a 30 s
clip is overhead. Real Viterbi on T4 is **~55×**, about 8.5× faster than
that placeholder implied. Viterbi itself is 156 ms on the whole V6 file
locally; the cost is the ONNX forward.

Derived FA cost from published rates (GPU-seconds only unless noted):

| | Per invocation | Per audio hour | Per 30-min video |
|---|---:|---:|---:|
| T4 V6 | $0.00423 | $0.0107 | $0.0054 |
| T4 hour file | $0.0109 | $0.0109 | $0.0054 |
| Modal CPU V6 (4 cores + 8 GiB) | $0.0126 | $0.0319 | $0.0160 |

CPU **is viable** (still 8× realtime on V6) and **is not cheaper**. T4
is both faster (~7×) and cheaper (~3×) per audio hour. That **changes
the cost picture relative to a guess that the small ONNX graph would
make CPU the winner**. It does not.

Peak GPU 2.6 GiB with one pack, 4.7 GiB with two, **10.9 GiB with all
five packs loaded in one container**. T4 16 GiB is enough. Nothing
cheaper than T4 exists on Modal's GPU list.

### Chunk boundary integrity

Alignment is driven by the chunk plan, not naive audio splits. On the
real V6 plan and the tiled hour plan:

| | V6 cloud | V6 local | Spanish | Hour tiled |
|---|---|---|---|---|
| Expected representable words | 3874 | 3874 | 249 | 9757 |
| Got | 3874 | 3874 | 249 | 9757 |
| Every word exactly once | yes | yes | yes | yes |
| `wordIndex` gapless | yes | yes | yes | yes |
| Duplicates | 0 | 0 | 0 | 0 |
| Missing | 0 | 0 | 0 | 0 |
| Overlaps | 0 | 0 | 0 | 0 |
| CTC fallback chunks | 0 | 0 | 0 | 0 |

No word appears twice or not at all. Gaps > 50 ms between adjacent
words are speech pauses, not seam holes — consecutive words never
overlap, and hour tile seams at 1421.29 s / 2842.58 s have no word
sitting on them. **The naive-split damage from the transcription POC
does not appear here**, because the planner assigns each script word to
exactly one chunk before inference. That is the engineering the
transcription fan-out still lacks.

### Five packs

Each pack loaded from the volume and completed an alignment on a short
chunk in one warm T4 container (languages cached after first use):

| Pack | Load (s) | Align processing (s) | Words | GPU after load (MB) |
|---|---:|---:|---:|---:|
| en | 4.021 | 4.102 | 12 | 2624 / 15360 |
| es | 2.276 | 0.577 | 10 | 4694 / 15360 |
| fr | 4.145 | 3.744 | 4 | 6764 / 15360 |
| de | 4.787 | 3.883 | 4 | 8842 / 15360 |
| pt | 11.977 | 3.852 | 3 | 10912 / 15360 |

fr/de/pt used a few seconds of English audio with language-appropriate
text — enough to prove the pack loads and the forward+Viterbi run, **not**
a quality claim. Apache-2.0 tag present (above).

### Cold start (T4, Viterbi image)

| | Client (s) | Load in container (s) |
|---|---:|---:|
| empty 1 / 2 / 3 | 7.310 / 26.514 / 29.622 | 3.718 / 3.558 / 3.404 |

Volume load is still ~3.5 s. Client-facing time is still T4 scheduling.
**Warm containers remain necessary for interactive FA**, not because
ONNX is slow to read.

---

## Unmeasured (not estimated)

- Dashboard **per-invocation** cost. The billing report groups by app /
  resource / hour, not by function call. Session totals and
  rate × GPU-second derivations are what exist.
- Cold-start pings on the CUDA image (three empty + three snapshot were
  taken on `debian_slim` before cublas was added). One CUDA ping (14.6 s)
  sits inside that range; a full re-series was not repeated.
- A live Spanish `cargo test` dump. Spanish local used the stored
  production-path JSON; V6 showed that capture is bit-identical to
  today's `fa-inference` `load_session`, so it is a valid baseline, but
  a same-day Spanish cargo run was not executed.
- fr/de/pt parity against local on real audio of those languages. Pack
  smoke used short English audio plus target-language text.
- L4 FA, A10G or anything above L4.
- Pinned Modal region. T4 scheduling across `us-west-1` / `us-east-1` /
  `eu-central-1` was left on Modal's default.
- Upload time from a real user's machine. Fixtures were already on the
  client that called `.remote()`.
- Whisper.cpp with Metal enabled. Production sidecar on this host used
  the BLAS backend (`no GPU found`).
- Why 108 English words exceed 50 ms: logits were not dumped per chunk,
  so the split between f64 log-softmax and ORT kernel differences is
  **unmeasured**. The decoder fixtures and the T4==CPU identity bound it
  to the emission, not to CTC logic.
