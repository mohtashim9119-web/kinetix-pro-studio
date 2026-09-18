# Cloud Fast-Path FA / Groq Hybrid — Feasibility & Blocker Audit

> **Purpose:** static, read-only analysis of adding a Cloud Fast-Path
> (Modal.com serverless ONNX FA + Groq Whisper API) beside the existing
> local Tauri/Rust FA engine. Not a status tracker and not a workstream
> ledger — those remain `project-state.md` /
> `docs/archive/history/work-in-progress.md`.
>
> **Companion:** Groq-as-*transcription* is already audited in
> [`transcription-groq-feasibility.md`](transcription-groq-feasibility.md)
> (2026-09-09). This document does **not** reopen that question. It asks
> whether a remote runner can populate the *forced-alignment* state the
> timeline already consumes, and where a `"local_fa"` / `"cloud_fa"`
> toggle should intercept.
>
> **Method:** source reading only. No application code edits, no test
> runs, no network calls, no live Groq or Modal requests. Latency and
> upload times below are arithmetic from on-disk format constants plus
> public API limits — not measured this session.
>
> **Date:** 2026-09-13. Working tree read in place (includes uncommitted
> export-session edits that do not touch the FA path).

---

## 0. Verdict (read this first)

| Question | Answer |
|---|---|
| Can Groq `verbose_json` replace **local ONNX FA**? | **No.** Groq transcribes. FA aligns *known script text* to audio with a wav2vec2 CTC + custom Viterbi. Different job, different output contract. |
| Can Modal (or any HTTP host) run the **same** `model.onnx` + chunk plan and return `FaWordSpan[]`? | **Yes, after a mapper**, if and only if the server runs the same graph, the same vocab/text normalizer, and the same Viterbi merge rules. A generic CTC aligner is not a drop-in. |
| Where should `"local_fa"` / `"cloud_fa"` intercept? | **Rust `resolve_wav_and_align`**, after durable-WAV transcode and *before* `fa_model_path` / `verify_model_manifest` / `fa_align`. JS keeps `FaEvent` + `faWordSpansToTranscriptTokens`. |
| Will a remote HTTP POST lock the WebGL timeline? | **No, if it stays on the Rust `reqwest` + existing Channel path.** Tauri async commands already leave the WebView free; local FA already `spawn_blocking`s. JS `fetch` to Groq/Modal is the path that *would* hurt (CSP, key leak, WKWebView heap). |
| Does a `KinetixData/Temp/` root exist to hang cloud upload files on? | **No.** That path string does not appear anywhere in the repo. Staging today is OS temp; the durable WAV is `app_local_data_dir()/fa-audio-cache/`. |
| Can we “just fall back to local ONNX” on cloud failure? | **Only on an `fa-inference` build with the language pack already installed.** The default `tauri:dev` / `tauri:build` binary returns `notImplemented` for every local FA call. Cloud-without-local is the *common* machine, not the exception. |
| Is this feasible as a subsequent implementation series? | **Yes**, as a hybrid of two already-separated stages: Groq (or local whisper-cli) for `TranscriptToken[]`, Modal (or local ONNX) for `FaWordSpan[]`. Do not collapse them into one API. |

**Recommended product shape:** keep `Project.faHighPrecisionSync` as the
on/off gate. Add a *machine-level* runner preference (`local` / `cloud` /
`auto`) in App Settings, stored off the `Project` JSON, with secrets on
the Rust side. Cloud FA posts **16 kHz mono PCM slices or a compressed
sibling**, never the original blob through JS, and must emit the existing
`FaEvent::Done { words }` shape. Groq stays on the Whisper side of
Apply Sync and never crosses the FA IPC boundary.

---

## PART 1 — Current Local FA Entry Points & Audio Flow

### 1.1 Command surface (`src-tauri/`)

There is one production runner, one dev runner, one shared body, and one
raw-body staging command. All four are registered in
`src-tauri/src/lib.rs` ~506–511.

```
Voiceover blob (IndexedDB / Asset.file)
        │
        ├─ JS: App.tsx handleApplySync  (gate: isFaGateOpenForProject)
        │         runFaPreflight → invoke('fa_preflight')     [observational]
        │         runForcedAlignmentForSync
        │              computeFaChunkPlan(...)                 [TS, mandatory]
        │              invoke('fa_stage_audio_raw', Uint8Array)
        │              invoke('fa_align_production', { inputPath, chunks, language, onEvent })
        │                        │
        │                        ▼
        │              Rust: fa_production.rs → fa_dev::resolve_wav_and_align
        │                1. single-flight claim (keyed by content-addressed path)
        │                2. fa_model_path + verify_model_manifest (~1.26 GiB hash)
        │                3. ensure_durable_wav → whisper::transcode_to_wav
        │                4. fa_align_with_prefix → spawn_blocking → fa_onnx::align_chunked
        │                5. Channel<FaEvent>  Progress / Timing / Done{words} / Error
        │
        └─ DEV: App.tsx window.__faDevAlign
                  same staging command, namespace 'kinetix-fa-dev-inputs'
                  invoke('fa_align_dev') → same resolve_wav_and_align
```

| Piece | File | Role |
|---|---|---|
| Production IPC | `src-tauri/src/fa_production.rs:34–44` `fa_align_production` | Thin wrapper. No gate of its own — frontend owns `faHighPrecisionSync`. |
| Dev IPC | `src-tauri/src/fa_dev.rs:531–541` `fa_align_dev` | Same body as production. Console-only (`__faDevAlign`). |
| Shared body | `src-tauri/src/fa_dev.rs:554–632` `resolve_wav_and_align` | **The real intercept.** Manifest → durable WAV → `fa_align`. |
| Staging | `src-tauri/src/fa_dev.rs:466–502` `fa_stage_audio_raw` | Raw `Uint8Array` → content-addressed file under `temp_dir()/<cache-dir>/`. |
| Core align | `src-tauri/src/fa.rs:960–968` `fa_align` / `fa_align_with_prefix` ~1003 | Feature-gated ONNX loop. `fa-inference` OFF → typed `notImplemented`. |
| Cancel | `src-tauri/src/fa.rs:1159` `fa_cancel` | Flips `FaState` to `Cancelled`. **No caller in `src/`.** Polled at chunk boundaries. |
| Preflight | `src-tauri/src/fa_preflight.rs:59–62` `fa_preflight` | Cheap: model `stat` + ORT `dlopen`. Does **not** hash the 1.26 GiB pack. |
| ONNX + Viterbi | `src-tauri/src/fa_onnx.rs` `align_chunked_timed` ~1528 | Loads whole WAV as `f32`, slices per chunk, custom DP in `fa_viterbi.rs`. |
| Text normalizer | `src-tauri/src/fa/text.rs` (port of `src/services/faTextNormalize.ts`) | Vocab-aware CTC text. Byte-identical fixture vs TS. |
| JS orchestrator | `src/services/forcedAlignmentRun.ts:116–208` | Fail-clean: never throws; `ok` tokens or `fallback` reason. |
| Gate | `src/services/faGate.ts` | `isFaCapable()` (Tauri IPC present) ∧ `isFaEnabledForProject()`. |
| Chunk planner | `src/services/faChunkPlan.ts` + `faAnchors.ts` | `MAX_RUN_SEC = 30` (`syncConstants.ts:528`). Whole-file FA is infeasible (D10: 240 s → 19.5 GiB peak). |
| DTO + mapper | `src/services/faBoundaryTypes.ts:51–58, 133–142` | `FaWordSpan` → `TranscriptToken`. |
| Apply Sync consumer | `src/App.tsx:3706–3810`, persist `faWordTimings` at ~4441 | Replaces Whisper tokens for Hirschberg/snap when FA returns `ok`. |

Capabilities (`src-tauri/capabilities/default.json`) do **not** enumerate
individual `fa_*` commands — they ride `core:default`. Adding a new
`fa_align_cloud` command does not require a capabilities edit unless it
spawns a new sidecar.

### 1.2 Audio extraction format (what `model.onnx` actually sees)

Two hops, two formats, two lifetimes.

**Hop A — stage the source as-is.** `fa_stage_audio_raw` writes the
invoke body’s raw bytes. Extension is a cosmetic hint
(`fa_dev.rs:366–376`): `wav` / `mp3` / `ogg` / `flac` / `m4a` / `aiff` /
`webm` / `bin`. No resample, no channel fold, no decode. The file is
content-addressed (`sha256(bytes)`), so a second Apply Sync of the same
blob is a write-skip.

**Hop B — durable 16 kHz mono PCM WAV.** `ensure_durable_wav`
(`fa.rs:899–913`) cache-misses into `whisper.rs::transcode_to_wav`
(`whisper.rs:728–762`):

```
ffmpeg -hide_banner -y -i <staged> -ar 16000 -ac 1 <cache/key.wav>
```

No explicit `-c:a` / `-f`. ffmpeg’s extension sniffing requires the tmp
name to end in `.wav` (D25 A1 live-corpus finding, `fa.rs:808–826`).
Default encoder for `.wav` on the bundled sidecars is **pcm_s16le**.

`fa_onnx.rs:137–185` `read_wav_mono_16k` / `parse_wav_pcm16_mono_16k`
then **rejects** anything that is not:

| Property | Required | Notes |
|---|---|---|
| Container | RIFF/WAVE | Header-parsed, not ffmpeg |
| Channels | 1 | Stereo is `UnsupportedFormat` |
| Sample rate | 16000 Hz | Hard reject, no resample here |
| Bit depth | 16 | `i16` → `f32` / 32768.0 |
| Sample layout | interleaved PCM | Loaded **entire file** into `Vec<f32>` before the chunk loop (`fa_onnx.rs:1544`) |

Frame clock: `FA_SAMPLE_RATE_HZ = 16_000`, `FA_FRAME_STRIDE_SAMPLES = 320`
(`fa_onnx.rs:715–717`) → **20 ms/frame**. Word times are
`frame_index * 320 / 16000` seconds, then offset by `chunk.start_sec`
(`fa_onnx.rs:1564–1565`).

Whisper’s own temp WAV (`kinetix-whisper-<uuid>/`) is **deleted** when
whisper-cli exits (`whisper.rs:853, 999`). FA cannot reuse it. That is
why the durable cache exists.

### 1.3 Typical payload sizes under the current extraction format

Constants from `fa.rs:665–666`: 16 kHz × 2 bytes × 1 ch =
**1,920,000 bytes/min** ≈ **1.83 MiB/min**. WAV header (~44 B) is noise
at these lengths.

| Duration | 16 kHz mono PCM WAV | vs Groq 25 MB upload cap | vs a 100 MB HTTP body |
|---|---|---|---|
| 5 min | 9,600,044 B ≈ **9.16 MiB / 9.60 MB** | under | under |
| 15 min | 28,800,044 B ≈ **27.47 MiB / 28.80 MB** | **over** | under |
| 30 min | 57,600,044 B ≈ **54.93 MiB / 57.60 MB** | **over** | under |
| 30 s chunk (`MAX_RUN_SEC`) | 960,044 B ≈ **0.92 MiB** | under | under |

Source-blob size (Hop A) is **not** this. A 30-minute voiceover is
usually a compressed m4a/mp3 of a few MB to ~40 MB; that is what crosses
WKWebView IPC today. The WAV is produced on the Rust side after staging.

**Implication for cloud:** uploading the durable WAV is legal for Modal
at 15–30 minutes and illegal for Groq at ≥15 minutes. Groq must never
see this WAV. Modal *may* see it, but per-chunk 30 s slices (~0.92 MiB
each) are the format the local engine already thinks in, and they bound
retry/timeout to one window instead of a 55 MB all-or-nothing POST.

---

## PART 2 — Hybrid Routing & API Integration Touchpoints

### 2.1 What the toggle is *not*

`Project.faHighPrecisionSync` (`types.ts:498`, gate in `faGate.ts`) is
**on/off**, not local/cloud. Reusing it as `"cloud_fa"` would collapse
two independent questions and break the Session G invariant (absent key
= no preference, never written back on load).

Existing UI that must **not** be overloaded:

| Control | File | Meaning today |
|---|---|---|
| New-project FA default | `AppSettingsModal.tsx:278–290` | Seeds `faHighPrecisionSync` on create |
| Per-project FA switch | `ProjectSettingsModal.tsx` + `App.tsx:6934` | Enables `runForcedAlignmentForSync` |
| Manage Models FA rows | `ModelsSection.tsx` | Downloads 1.18 GiB `model.onnx` packs |

A runner preference belongs on **App Settings** (machine, like an API
key), not on `Project` (shared / snapshotted / undoable).

There is **no** `local_fa` / `cloud_fa` string, no keychain, no
Stronghold, and no secret-storage module in `src/` or `src-tauri/`
(grepped). App Settings persistence today is `uiStateStore` JSON
(`appDefaults.ts`). A Groq/Modal key must **not** go there — it would
sit in the WebView-readable store. The Groq transcription audit already
specified the correct pattern: write-only `invoke('set_*_api_key')`,
`0600` file under `app_local_data_dir` (or OS keychain later).

### 2.2 Where to intercept (ordered by fitness)

**1. Recommended — `resolve_wav_and_align` (`fa_dev.rs:554`), after line
616 (`ensure_durable_wav_timed`) and before `fa_model_path` (currently
605, which is *before* the WAV).**

Today the order is: claim → manifest → WAV → `fa_align`. Cloud must
**reorder**: claim → WAV → **branch** → (local: manifest + ONNX) or
(cloud: HTTP). Manifest-hashing 1.26 GiB and requiring `model.onnx` on
disk are local-only costs. Leaving them in front of the cloud arm makes
“cloud so I don’t need the pack” impossible.

What this preserves:

- `fa_stage_audio_raw` + content-addressed key + single-flight
- `computeFaChunkPlan` (still TS, still mandatory — see blocker B3)
- `Channel<FaEvent>` (`Progress` / `Timing` / `Done` / `Error`)
- `faWordSpansToTranscriptTokens` and `App.tsx` commit
- `spawn_blocking` for local; cloud HTTP stays on the async runtime
  (reqwest `.await`), which is what `model_download.rs` already does

**2. Acceptable sibling — new `fa_align_cloud` command**, called from
`forcedAlignmentRun.ts` instead of `fa_align_production` when the
preference is cloud. Same Rust HTTP body, slightly more JS branching.
Use this if we want the local path byte-identical for golden/live tests.

**3. Do not intercept in `fa_onnx.rs` / `align_chunked`.** That is
inside `#[cfg(feature = "fa-inference")]`. Default builds never compile
it. Cloud FA on a default binary is a stated product value; putting the
client there hides it behind a feature the shipped app does not enable
(`appDefaults.ts:55–59`).

**4. Do not intercept in `App.tsx:3745`.** The Apply Sync function is
already the fail-clean consumer. Teaching it about HTTP, keys, or Groq
JSON would leak provider names past the timing interface the v2 plan
exists to protect (`sync-pipeline-v2-plan.md` Part C: one
`TranscriptToken[]` shape, swappable source).

**5. Do not `fetch()` Groq or Modal from the WebView.** CSP
`connect-src` (`tauri.conf.json:26`) has no `api.groq.com` and no Modal
host. Adding them would still put the key and a 10–55 MB body on the
WKWebView heap. `fetch_url_bytes` in `lib.rs:59–81` is a GET that
base64-encodes the response — the opposite of what upload needs, and
already on the wrong side of CLAUDE.md’s “no base64 large blobs” rule.

### 2.3 Bandwidth: local ONNX vs cloud POST

Local inference reads the durable WAV from disk. No upload.

Cloud FA must move audio *plus* the chunk list (text + windows). The
chunk JSON is small (tens of KB). Audio dominates.

| Upload body | 5 min | 15 min | 30 min |
|---|---|---|---|
| Durable WAV (current FA format) | 9.6 MB | 28.8 MB | 57.6 MB |
| 64 kbps mono MP3 (Groq-audit recipe) | ~2.4 MB | ~7.2 MB | ~14.4 MB |
| Per-chunk 30 s WAV, serial | 10 × 0.92 MiB | 30 × 0.92 MiB | 60 × 0.92 MiB |

Upload wall-clock (payload ÷ throughput, headers ignored):

| Body | 50 Mbps | 10 Mbps | 1 Mbps |
|---|---|---|---|
| 9.6 MB (5 min WAV) | ~1.5 s | ~7.7 s | ~77 s |
| 28.8 MB (15 min WAV) | ~4.6 s | ~23 s | ~230 s |
| 57.6 MB (30 min WAV) | ~9.2 s | ~46 s | ~461 s |
| 14.4 MB (30 min 64 kbps) | ~2.3 s | ~12 s | ~115 s |
| 0.92 MiB (one 30 s chunk) | ~0.15 s | ~0.74 s | ~7.4 s |

`reqwest` today (`Cargo.toml:28`) is `{ version = "0.12", features = ["json"] }`.
**No `multipart`.** Groq file upload and most Modal file endpoints need
`multipart`. `model_download.rs` already owns the HTTP stack, connect
timeout (30 s), and read-inactivity timeout (60 s) —
`CONNECT_TIMEOUT` / `READ_TIMEOUT` at `model_download.rs:193–201`,
classifier at `classify_stream_error` ~696. Reuse those constants; do
not invent a second timeout dialect.

### 2.4 Async runtime vs WebGL

Local FA already solved the “don’t park the Tauri worker for minutes”
problem (`fa.rs:1016–1046`, guarded by `fa_timing.rs:796–832`):

- `fa_align_with_prefix` is `async` and immediately `spawn_blocking`s
  the synchronous ONNX loop.
- `fa_cancel` can run on the async runtime while inference holds the
  model-cache mutex on a blocking thread.
- Apply Sync in `App.tsx` `await`s `runForcedAlignmentForSync` but does
  **not** set an `isSyncing` lock that freezes playback or the GL
  preview. `applySyncDisabled` (`App.tsx:5595–5597`) is a
  *transcription-ready* gate, not a mid-sync freeze.

A cloud POST is an `.await` on the same async runtime `model_download`
already uses for multi-minute transfers. That does **not** block the
WebView rAF / WebGL loop. What *would* hitch the UI:

- JS `arrayBuffer()` of a huge file is already paid (staging).
- JS `fetch` of a 55 MB WAV through WKWebView.
- Accidentally running ONNX (or a busy-wait poll) on the async worker
  instead of `spawn_blocking` / `.await`.

Progress: `forcedAlignmentRun.ts:172–177` only resolves on `Done` /
`Error`. `Progress` and `Timing` are ignored (safe — no exhaustiveness
check). Cloud should still emit `Progress` per finished chunk so a later
UI can show upload+infer percent without inventing a second channel.

Cancel: `fa_cancel` is unwired from TS. A cloud job needs an HTTP abort
token registered in the same `FaState` / single-flight slot, or cancel
stays a no-op the way it is today.

---

## PART 3 — Data Invariants & Timestamp Schema Parity

### 3.1 What local FA actually returns (not `start_ms`)

The prompt’s `start_ms` / `end_ms` names **do not exist** on this
boundary. Times are **seconds, `f64`**, camelCased on the wire.

**Internal (never crosses IPC):** `fa_onnx::WordSpan`
(`fa_onnx.rs:970–975`)

```
text: String
start_seconds: f64
end_seconds: f64
score: f32          // mean LOG-probability, ≤ 0
```

Character/`TokenSpan` alignments exist only inside
`merge_tokens` → `merge_char_spans_to_words` (`fa_onnx.rs:977+`). They
are discarded at the word merge. The timeline never sees characters.

**IPC DTO:** `FaWordSpan` (`fa.rs:401–408`, mirrored
`faBoundaryTypes.ts:51–58`)

```
word: string
startSec: number
endSec: number
confidence: number   // exp(score), in [0, 1]
needsReview: boolean // confidence < CONF_MIN (0.3, fa.rs:416)
wordIndex: number    // 0-based in the *chunk-stitched* output
```

**Timeline / persistence:** `TranscriptToken` (`types.ts:347–376`) via
`faWordSpansToTranscriptTokens` — 1:1 map, plus optional
`confidence` / `wordIndex` / `needsReview` that Whisper tokens never
set. `App.tsx:3780` copies the FA array onto `Project.faWordTimings`
at the same commit that writes segments (`App.tsx:4441`). A fallback or
gate-off run **clears** that field (comment at 4435–4440).

Identity rule (`CLAUDE.md` §5, `fa.rs:372–385`): **`wordIndex` is the
join key**. Timestamp proximity must not decide which script word a
span belongs to.

### 3.2 Groq `verbose_json` (transcription — cannot feed FA state)

Canonical OpenAI-compatible word object (from the companion audit;
live Groq nesting was not re-fetched):

```
{ "word": "Hello", "start": 0.00, "end": 0.32, "probability": 0.99 }
```

| Field | Groq word | Local `FaWordSpan` | Action if someone tried to use Groq *as FA* |
|---|---|---|---|
| Time unit | seconds | seconds | Compatible. |
| Names | `start`/`end`/`word` | `startSec`/`endSec`/`word` | Rename. Do not leak Groq names past the adapter. |
| `confidence` | optional `probability` | CTC `exp(score)` vs `CONF_MIN` | **Different meaning.** Mapping Groq ASR probability onto `needsReview` would silently change R.7. |
| `wordIndex` | absent | required | **Cannot invent.** Assigning by array order assumes Groq emitted the *script*, not a transcript. It did not. |
| Gaps | real pauses | non-gapless by design (Phase 3 acceptance) | Superficially similar; still the wrong source. |
| Text | discovered ASR | script-constrained, vocab-normalized (`fa/text.rs`) | Hirschberg already exists for ASR text. FA exists to *throw ASR times away*. |

**Hard failure:** using Groq words as `faTokens` in `App.tsx:3760`
would set `anchorSource: 'forced-alignment'` and persist
`faWordTimings` for a run that never ran FA. That is a product lie and
a golden-replay / R.7 poison. Groq maps only to the Whisper-shaped
`TranscriptToken[]` path (`whisperService` / `useWhisper`), as the
companion audit specified.

### 3.3 Modal custom serverless response

Modal has no FA schema. We define one. The only schema that needs no
normalization *downstream of IPC* is **`FaWordSpan` itself**:

```
{
  "words": [
    { "word": "hello", "startSec": 1.24, "endSec": 1.51,
      "confidence": 0.82, "needsReview": false, "wordIndex": 0 }
  ]
}
```

If Modal returns log-probs or milliseconds, the **Rust adapter** (not
TS, not the timeline) converts once — same place `word_span_to_dto`
(`fa.rs:428–437`) already exponentiates `score` and assigns
`word_index`. Character arrays, if Modal emits them, are dropped.

Parity requirements the Modal container must match, or the mapper
cannot save us:

1. Same `jonatasgrosman/wav2vec2-large-xlsr-53-<lang>` ONNX graph
   (hashes in `scripts/fixtures/fa-onnx-manifest.json`).
2. Same `normalize_for_forced_alignment` rules (`fa/text.rs` /
   `faTextNormalize.ts` + cardinal fixtures).
3. Same Viterbi + `merge_char_spans_to_words` + hyphen-collapse
   (`fa_onnx.rs:1052+`). `torchaudio.functional.forced_align` is a
   different DP; treat it as a **measurement**, not a substitute.
4. Same chunk windows the client already computed. Offsetting by
   `chunk.startSec` is how local times become timeline-absolute
   (`fa_onnx.rs:1564–1565`). A server that realigns the whole file
   ignores R.1/R.5 seams and will disagree on purpose.
5. Infeasible-chunk fallback (`TooManyRepeats` → evenly spaced
   `needsReview` words, `fa_onnx.rs:1570–1578`) must be reproduced or
   the run shape changes.

### 3.4 Normalization layer (one, at the Rust boundary)

```
Groq verbose_json  ──mapper──►  TranscriptToken[]   (Whisper slot)
Modal FaWordSpan[] ──passthrough/minor rename──►  FaEvent::Done
Local WordSpan     ──word_spans_to_dtos──►        FaEvent::Done
                         │
                         ▼
              faWordSpansToTranscriptTokens
                         │
                         ▼
         App.tsx  faTokens ?? project.transcriptTokens
                         │
                         ▼
         alignFromCache / snap / drag word-walls / faWordTimings
```

No second mapper in React. The WebGL preview does not read tokens
(waveform is Web Audio peaks; bars are `VideoSegment.startTime`).
Token times hit the timeline only through segment commit and the drag
word-onset wall (`App.tsx` forwards `transcriptTokens`).

`FaEvent` in TS (`faBoundaryTypes.ts:64–67`) is **missing `Timing`**,
which Rust already emits (`fa.rs:509+`). Harmless today (ignored). A
cloud adapter that adds a new tag the same way stays additive.

---

## PART 4 — Offline Fallback & Failure Modes

### 4.1 What exists today

| Situation | Current behavior |
|---|---|
| No Tauri | `isFaCapable()` false → gate closed, Whisper tokens, `buildFaGateClosedEntry` if capable would have been possible |
| Gate on, no model / ORT / `fa-inference` | `runForcedAlignmentForSync` catch → `{ status: 'fallback', reason: 'inference-error' }` → Whisper tokens, `buildFaFallbackEntry` |
| Unsupported language | `'unsupported-language'` before any IPC |
| Empty chunk plan | `'empty-chunk-plan'` before staging |
| Zero words | `'zero-words'` |
| Cancel | `FaErrorKind::Cancelled`; no TS caller |
| Network | **Unused on the FA path.** `model_download.rs` has the only classified HTTP errors (`Transient` vs permanent, 404, timeout). |

Fail-clean is already the right outer contract. Cloud errors should
become `inference-error` (or a new `FaFallbackReason` member —
`'cloud-unavailable'` / `'cloud-auth'` — so the sync log can tell
“no pack” from “Modal 429”). Adding a member without updating
`forcedAlignmentRun.ts`’s union is a type error by design (`:48–51`).

### 4.2 Required timeout / classification (not present on FA)

Reuse `model_download` dispositions; do not hang on a half-open socket
(the T4.4 incident that created `READ_TIMEOUT`).

| Failure | Detect | Policy |
|---|---|---|
| **a) Mid-run connectivity loss** | `reqwest` `is_timeout()` / connect error / `classify_stream_error` → Transient | Abort the *current* HTTP (no partial `Done`). If local runner is actually available (`fa-inference` + `fa_preflight.ready`), start local ONNX on the **already-built** durable WAV and chunk plan. If not, `fallback` to Whisper tokens. Do not retry Modal in a tight loop. |
| **b) 5xx / 429 / Modal timeout** | HTTP status | 429: one backoff then local-or-Whisper. 5xx: no silent retry storm. Surface status in `detail`. |
| **c) Missing / invalid API key** | Preflight, before staging a second copy | Do not start Apply Sync’s FA arm. `fa_preflight` today reports `modelPresent` / `runtimeOk` only (`faPreflight.ts:35–42`). Cloud must add `cloudAuthOk` / `cloudReachable` or a sibling command. Invalid key is **permanent** — do not fall through to a 60 s TCP hang. |

**Critical constraint on (a) and (b):** default builds cannot “drop
back to Local ONNX.” `NEW_PROJECT_FA_DEFAULT_ON` is false for that
reason (`appDefaults.ts:55–59`). Hybrid fallback is a **three-rung**
ladder, not two:

1. Cloud FA (if preference allows and auth/network ok)
2. Local ONNX (if `fa-inference` + pack + ORT)
3. Whisper tokens (always, already implemented)

Rung 2 is optional. Product copy that says “if the internet drops we
use your local engine” is false on the shipped binary unless the user
installed a pack *and* is on an FA-enabled build.

### 4.3 Preflight must not assume a local pack

`runFaPreflight` (`faPreflight.ts:78+`) + `App.tsx:3734–3736` run
*before* inference and log readiness. If cloud is the selected runner,
`modelPresent: false` must **not** be a blocking “not ready.” Otherwise
every cloud-first user gets a red preflight and then a surprising
success (or the inverse: we skip FA because preflight said no).

### 4.4 Single-flight and attach-on-reload

FA single-flight is keyed by the content-addressed staged path
(`fa.rs:275–283`). A cloud POST under that key is enough to refuse a
second Apply Sync on the same voiceover. Unlike whisper-cli, there is
no child to re-attach after Cmd+R; an in-flight HTTP dies with the
webview unless the request is held in Rust process state (the
`InFlightRegistry` already outlives a reload the way model download
does). Decide explicitly: cloud jobs survive reload (then need
`fa_align_attach`, mirroring `whisper_transcribe_attach`) or they
don’t (simpler; reload → fallback/Whisper).

---

## PART 5 — Storage & Cleanup Integration

### 5.1 `KinetixData/Temp/` does not exist

A repo-wide search for `KinetixData` returns **zero** hits. There is no
single target data root and no `Temp/` policy document. Current homes:

| Artifact | Path | Lifetime |
|---|---|---|
| FA staged source | `std::env::temp_dir()/{kinetix-fa-production-inputs,kinetix-fa-dev-inputs}/<sha256>.<ext>` (`fa_dev.rs:486–493`) | **Never deleted.** Content-addressed cache. Comment at `fa_dev.rs:516–520` says this is deliberate. |
| Durable WAV | `app_local_data_dir()/fa-audio-cache/<identity>.wav` (`fa.rs:640–670, 675–687`) | LRU, **2 GiB** cap, evict on write (`FA_AUDIO_CACHE_MAX_BYTES`). |
| Durable WAV tmp | `fa-audio-cache/.tmp/<key>.<uuid>.wav` | Removed on transcode failure (`fa.rs:908`) or renamed into place. |
| Whisper stage | `temp_dir()/kinetix-whisper-<uuid>/` | `remove_dir_all` when the child exits. |
| Export session | `temp_dir()/kinetix-export-<id>/` (`ffmpeg.rs` / `session_claim.rs`) | Session lifecycle; unrelated to FA. |
| Models | `app_local_data_dir()/fa-models/<lang>/model.onnx` | User-managed. |
| Project mirror | `app_local_data_dir()` via `project_mirror.rs` | Durable projects. |

On macOS, `app_local_data_dir()` is typically
`~/Library/Application Support/com.kinetix.pro-studio/`. OS temp is
`/var/folders/.../T/` (not a stable product folder).

If a later prompt introduces `KinetixData/Temp/` as the *one* scratch
root, FA staging, whisper staging, export temps, and any cloud upload
buffer should move **together**. Doing it only for cloud FA would add
a fourth root, which is the opposite of a single target.

### 5.2 Cloud upload buffers — leak risk

Nothing in `runForcedAlignmentForSync` or `resolve_wav_and_align`
deletes the staged source after a successful run. That is correct for
local FA (the durable WAV key is `name|size|mtime` of that staged
file — `fa.rs:690–722`; a fresh uuid path would bust the cache).

Cloud-specific temps (e.g. a 64 kbps transcode made *only* to upload)
are a new class. They must:

1. Live next to the durable cache (or under a future unified Temp),
   not a one-off `/tmp/kinetix-cloud-*` that no sweeper knows.
2. Be deleted in a `defer`/`Drop` on **every** exit: success, HTTP
   error, cancel, panic. Mirror `ensure_durable_wav`’s
   `remove_file` on transcode failure (`fa.rs:908`).
3. **Not** delete the durable WAV or the content-addressed stage —
   those are the local fallback inputs if rung 2 is available.

`STAGING_RECORD_CAPACITY = 8` (`fa_dev.rs:424`) only parks *timing*
records, not files. A stage-without-align leak is already possible;
cloud must not add a second un-swept encode.

---

## Deliverable 1 — Architectural Map (toggle touchpoints)

Exact places a subsequent implementation would edit. Line numbers
are from this working tree (2026-09-13).

### Settings / preference (new)

| Touchpoint | File:lines | Change |
|---|---|---|
| New-project defaults type | `src/services/appDefaults.ts:73–78` | Do **not** add runner here unless it is a seed for new machines. Prefer a separate App Settings key. |
| App Settings UI | `src/components/AppSettingsModal.tsx:278–290` | Sibling of the FA-on-new-projects toggle: runner + key fields. |
| Per-project FA switch | `src/components/ProjectSettingsModal.tsx`, `src/App.tsx:6934` | Leave as on/off. |
| Secret write | **new** Rust command + `0600` file under `app_local_data_dir` | No `VITE_*`, no `Project` JSON, no `uiStateStore`. |

### Apply Sync (read preference, don’t implement HTTP)

| Touchpoint | File:lines | Change |
|---|---|---|
| Gate | `src/services/faGate.ts:91–125` | Unchanged. |
| Preflight | `src/services/faPreflight.ts:35–120`, `src-tauri/src/fa_preflight.rs:31–62` | Cloud-aware readiness (auth + optional ping). Skip `modelPresent` as blocking when runner is cloud. |
| Orchestrator | `src/services/forcedAlignmentRun.ts:163–185` | Same two invokes, **or** swap the second for `fa_align_cloud`. Extend `FaFallbackReason`. |
| Commit | `src/App.tsx:3745–3810, 4441` | Unchanged if `FaEvent::Done` is preserved. |

### Native runner (where HTTP lives)

| Touchpoint | File:lines | Change |
|---|---|---|
| **Primary intercept** | `src-tauri/src/fa_dev.rs:554–631` `resolve_wav_and_align` | After WAV, branch on runner. Move `fa_model_path` / `verify_model_manifest` into the local arm only. |
| Production wrapper | `src-tauri/src/fa_production.rs:34–44` | Stay thin, or grow a `runner` argument. |
| Staging | `src-tauri/src/fa_dev.rs:466–502` | Reuse. Optional `cache-dir` under a future unified Temp. |
| Transcode | `src-tauri/src/whisper.rs:728–762` | **Do not change the WAV contract.** Add a *sibling* `transcode_to_upload_audio` (64 kbps) if Modal/Groq need it. FA cache stays PCM. |
| HTTP | `src-tauri/src/model_download.rs` timeouts/classifier; `Cargo.toml:28` | Add `multipart`. New module e.g. `fa_cloud.rs` — do not stuff Modal URLs into `fa_onnx.rs`. |
| Events | `src-tauri/src/fa.rs:485–508` `FaEvent` | Reuse. Synthesize `Progress` from upload bytes + per-chunk replies. |
| Command list | `src-tauri/src/lib.rs:506–511` | Register any new command. |
| CSP | `src-tauri/tauri.conf.json:26` | Irrelevant if Rust uploads. Do not add Groq/Modal to `connect-src` as a shortcut. |

### Must not change for cloud FA

`fa_onnx.rs` Viterbi, `fa/text.rs`, `faChunkPlan.ts` / `faAnchors.ts`,
`faWordSpansToTranscriptTokens`, Hirschberg, snap, golden replay
fixtures, `transcode_to_wav` WAV args.

---

## Deliverable 2 — Payload & Speed Analysis

### Local ONNX (baseline, already in-tree)

| Stage | 15–20 min file (comments / prior measures) |
|---|---|
| Stage raw IPC | seconds (same as today) |
| Durable WAV miss | multi-second ffmpeg; hit ≈ 0 |
| Manifest hash | can dominate (~1.26 GiB stream) unless memoized (`fa_dev.rs:609–611`) |
| ONNX + Viterbi | **76–231 s** (`forcedAlignmentRun.ts:85`, Apply Sync comments) |
| Whole-file (forbidden) | 240 s window measured 19.5 GiB peak (D10) |

Local is CPU ORT, `fa-inference` feature, Metal not involved.

### Groq Whisper (transcription only — companion audit)

Not FA. For a 20 min *compressed* upload: ~10–30 s wall on a decent
uplink, LPU claimed ~5–10 s (unverified here). **Does not reduce the
76–231 s FA floor** unless FA is skipped or replaced by Modal.

Groq 25 MB cap: 16 kHz WAV overflows at ~13–15 min. Compressed 64 kbps
fits through ~52 min.

### Modal serverless ONNX (estimates — no live call)

| Stage | Warm container | Cold container (1.26 GiB graph + ORT) |
|---|---|---|
| Upload 15 min WAV @ 10 Mbps | ~23 s | ~23 s |
| Upload 15 min 64 kbps @ 10 Mbps | ~6 s | ~6 s |
| Model load into RAM/GPU | skipped if warm | **tens of seconds to minutes** (dominant risk) |
| Inference | GPU: possibly ~5–30 s; CPU: similar to local 76–231 s | same, after load |
| JSON download | ≪ 1 s (~1–2 k words) | ≪ 1 s |

**End-to-end vs local FA (15 min, 10 Mbps, honest bands):**

| Runner | Likely wall | Beats local 76–231 s? |
|---|---|---|
| Local ONNX (pack hot, WAV cached) | 76–231 s | — |
| Modal GPU **warm** + WAV upload | ~30–60 s | **Yes** |
| Modal GPU **cold** + WAV upload | ~60–180+ s | Maybe / no |
| Modal CPU | upload + ~local infer | **No** (you paid upload to get the same CPU) |
| Groq as FA | n/a | Invalid |
| Groq transcription + local FA | Groq seconds + 76–231 s | Transcription only |

Keep-warm (Modal `min_containers=1`) or baking all five language packs
into the image (~6.3 GiB) is an **ops cost**, not a code comment. Without
it, “cloud fast-path” is a cold-start lottery.

Per-chunk serial HTTP: 30 × (0.7 s upload + infer). Better for timeout
and cancel; worse if Modal bills a cold start *per chunk*. Batch one
POST of `[chunks + audio]` per warm worker.

### Speed claim hygiene

Quote the **stage**. Cloud FA can beat local FA when (warm GPU) ∧
(uplink ≳ 10 Mbps). It cannot make Apply Sync a 5 s operation if
Hirschberg + snap + silence still run, and it cannot make
transcription+FA a 5 s operation if FA is still local.

---

## Deliverable 3 — Identified Blockers

Hard = must resolve before a remote API can populate alignment state.
Soft = design debt that will bite the first implementation PR.

### Hard

**H1. Groq is not an FA engine.** Wiring `verbose_json` words into
`faTokens` / `faWordTimings` / `anchorSource: 'forced-alignment'`
violates the timing-source interface and R.7. Groq belongs only on the
Whisper runner.

**H2. Chunk plan is client-side and mandatory.** `computeFaChunkPlan`
needs Whisper tokens, Web Audio silences, and anchor-timed segments
(`forcedAlignmentRun.ts:135–142`). A Modal endpoint that accepts
“audio + full script” and self-chunks will disagree with R.1/R.5 and
with local fallback on the same file. The request body is
`{ chunks: FaChunkInput[], audio }`, not `{ script, audio }`.

**H3. Local path requires `model.onnx` before it will run.**
`resolve_wav_and_align` calls `fa_model_path` + `verify_model_manifest`
unconditionally (`fa_dev.rs:605–611`). Cloud-first users without a
1.26 GiB pack never reach HTTP unless this moves behind the local arm.

**H4. Default binary has no local ONNX.** `fa-inference` is optional
(`Cargo.toml:31–41`). Fallback-to-local is not a property of the
product as shipped; it is a property of `tauri:dev:fa` + a downloaded
pack. Preflight and UX must tell the truth.

**H5. Schema is seconds + `wordIndex` + CTC confidence, not
`start_ms` and not Groq `probability`.** Any Modal/Groq payload that
is passed through without `word_spans_to_dtos`-equivalent conversion
will fail `filterMalformedTokens` or poison join keys.

**H6. Viterbi is ours.** `fa_viterbi.rs` + hyphen collapse +
infeasible-chunk placeholders. A Python `forced_align` on the same
ONNX is a different function. Ship a golden-vector test
(existing `scripts/fixtures/fa-emission-*.json` / e2e tokens) against
the Modal container before calling it “the same engine.”

**H7. `reqwest` has no `multipart`.** Groq upload and typical Modal
file POST cannot be implemented on the current feature set.

**H8. No secret store.** There is nowhere safe to put a Groq or Modal
token today. Putting it in Vite, `Project`, or `uiStateStore` is a
ship blocker, not a follow-up.

**H9. No `KinetixData/Temp/` root.** Cloud temps cannot “just” join a
single scratch tree that is not implemented. Either introduce the root
as its own slice (export + whisper + FA together) or hang new files on
`fa-audio-cache/.upload/` with `Drop` cleanup.

### Soft / product

**S1. `fa_cancel` has no TS caller.** Cloud abort will be the first
real cancel UX; wire it then, including HTTP abort.

**S2. Staging never swept.** Acceptable for local cache; dangerous if
cloud writes extra compressed copies beside it.

**S3. Two projects, one voiceover hash → one single-flight key**
(`fa.rs:286–290`). Cloud does not make this worse; a `jobKey` =
`projectId` is still the stated fix.

**S4. Gapless-vs-gapped already applies to Groq *transcription***
(companion audit §2.1.1). Unrelated to Modal FA if Modal clones local
spans, but a Groq-then-FA hybrid still changes R.1 anchors because
the *planner* reads Whisper tokens.

**S5. `FaEvent` TS type omits `Timing`.** Additive; fix when touching
the file.

**S6. Modal cold start + 1.26 GiB × 5 languages.** Architectural for
ops, not for the IPC. Without keep-warm, the “fast-path” name is
false on the first run of the day.

**S7. CLAUDE.md local-first line.** A standing cloud dependency is a
product-architecture change, not a flag flip. The companion audit
already said: no baked key, no proxy unless the product grows a
server. Same ruling here.

---

## Deliverable 4 — Step-by-Step Action Plan

Order is dependency order for later prompts. Do not start with UI.

0. **Decide the two-axis settings model.**
   `faHighPrecisionSync` = attempt FA. Machine runner =
   `local` | `cloud` | `auto`. Write the ruling down (this file +
   `project-state.md` Rulings) before code. Confirm whether default
   builds may offer cloud as the *only* FA engine.

1. **Secret + HTTP foundation (Rust only).**
   `reqwest` `multipart`. `set_cloud_fa_key` / `set_groq_api_key`
   write-only. `0600` under `app_local_data_dir`. Reuse
   `CONNECT_TIMEOUT` / `READ_TIMEOUT` / `classify_stream_error`.
   No JS `fetch`. No CSP change.

2. **Groq transcription adapter (if not already scheduled).**
   Implement the companion audit: sibling of `transcode_to_wav`,
   64 kbps, `stat` vs 25 MB, map words → `TranscriptToken`, keep
   `WhisperEvent`. Measure gapless-vs-gapped on one corpus. This is
   *not* Cloud FA; it is the other half of the hybrid.

3. **`FaWordSpan` contract test vector.**
   Freeze a small fixture: chunks + 16 kHz WAV → expected `FaWordSpan[]`
   from local `fa_align`. Modal (and the Rust mapper) must match within
   an agreed epsilon (frame = 20 ms). Do this before writing the client
   so the server cannot “define” a new schema.

4. **Intercept in `resolve_wav_and_align`.**
   Reorder: WAV first; branch; local arm keeps manifest + `fa_align`;
   cloud arm POSTs `{ chunks, audioPath }` (or per-chunk slices), maps
   response → `word_spans_to_dtos` → `FaEvent::Done`. Preserve
   single-flight and `FaEvent::Timing`. Delete any upload-only temp
   on `Drop`.

5. **Preflight + fallback ladder.**
   Extend `FaPreflightReport`. Implement 3-rung fallback
   (cloud → local-if-ready → Whisper). Add
   `FaFallbackReason` values the sync log can display. Invalid key
   fails cheap.

6. **TS orchestration (thin).**
   `forcedAlignmentRun.ts`: pass runner or rely on Rust reading the
   stored preference. Do not parse Groq/Modal JSON in TS.
   Optionally call `fa_cancel` from Apply Sync abort.

7. **App Settings UI last.**
   Runner toggle + key field + copy that default builds cannot
   fall back to local ONNX. Do not put the control on the timeline.
   Do not reuse the High-Precision toggle.

8. **Storage unification (optional, but before calling the root
   `KinetixData/Temp/`).**
   If that directory is a real product decision, migrate whisper
   stage, FA stage, FA upload temps, and export session dirs in one
   slice. Do not invent it only for Modal.

9. **Measurement gate — do not trust green units.**
   Golden replay stops at `snapCoveredBoundaries` and never runs FA
   (`CLAUDE.md` §5). Required: one 15–20 min Apply Sync, FA on,
   local vs Modal on the same chunk plan, plus one offline-drop mid
   POST. Quote times with the stage named.

---

## What this audit did not do

- No live Groq or Modal request (word-array nesting, Modal wall-clock,
  and container cold-start remain unverified).
- No ToS / pricing / rate-limit review.
- No check that the bundled ffmpeg has libmp3lame (AAC `.m4a` is the
  documented fallback in the Groq audit).
- No accuracy comparison of Modal GPU ORT vs local CPU ORT vs
  `torchaudio.functional.forced_align`.
- Did not implement or enable a `KinetixData` root.
- Did not treat uncommitted export-session files as FA-relevant; they
  were not on this path.
