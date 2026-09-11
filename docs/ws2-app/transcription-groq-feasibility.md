# WS3 Groq Transcription Architecture Audit

> **Purpose:** static, read-only feasibility analysis of migrating (or adding)
> an online Groq LPU Speech path in place of local `whisper-cli` +
> `ggml-large-v3-turbo.bin`. Not a status tracker and not a workstream ledger
> — those remain `project-state.md` / `docs/work-in-progress.md`.
>
> **Method:** source reading only. No code edits besides this file, no test
> runs, no network calls, no live Groq requests. Groq request/response
> shapes below are the OpenAI-compatible Speech API contract Groq documents
> as implementing; live field presence was **not** re-fetched this session.
>
> **Date:** 2026-09-09. **Requested branch:** `ws3-export-liveness-occlusion`.
> **Working tree actually read:** `main`.

---

## 0. Verdict (read this first)

| Question | Answer |
|---|---|
| Can Groq replace the **local whisper-cli spawn**? | **Yes**, behind a thin adapter that emits the existing `TranscriptToken[]` + `WhisperEvent` IPC. |
| Does Groq `verbose_json` + word timestamps match the downstream parser? | **Yes, after a mapper.** The live parser is **not** JSON — it is whisper-cli stdout. The mapper is required. Schema is compatible at the *word* grain the aligner actually consumes. |
| Can Groq replace **Forced Alignment**? | **No.** FA is a separate ONNX pipeline. It consumes Whisper *tokens as data*, never the whisper-cli process. |
| Can we delete the 1.51 GiB GGML weights if Groq is the only transcription path? | **Yes.** |
| Can we delete the ~6.3 GiB FA language packs as a consequence? | **No.** Those are wav2vec2 ONNX packs, not Whisper weights. |
| Does the “~100×+ speedup” hold end-to-end in *this* app? | **Transcription-only, on a decent uplink: plausible. Apply Sync with FA on: no — FA is 76–231 s and is untouched.** |

**Recommended product shape (not an implementation plan):** a **hybrid**. Groq as the transcription runner when a user-supplied API key is present and the machine is online; keep the existing whisper-cli path as the offline / no-key fallback. Do not bake a Groq key into the client bundle. Do not stand up a proxy unless the product is leaving the “everything runs locally, no server” architecture.

---

## PART 1 — Current Local Transcription Architecture

### 1.1 Where execution, download, and language packs live

There is **no JS Whisper worker**. Transcription is a Tauri sidecar child process. Forced alignment is a separate native ONNX path. The two share one audio-normalization helper and one download engine; they do not share weights, a process, or an output parser.

```
Voiceover File (IndexedDB / staging)
        │
        ├─ JS: useWhisper.startTranscription
        │         whisperService.transcribeWithProgress
        │              │
        │              ├─ invoke('whisper_stage_audio_raw', Uint8Array)   ← raw IPC, not base64
        │              └─ invoke('whisper_transcribe', { audioPath, durationSecs, language, onEvent, jobKey })
        │                        │
        │                        ▼
        │              Rust: whisper.rs
        │                1. transcode_to_wav  (ffmpeg sidecar, 16 kHz mono PCM WAV)
        │                2. spawn sidecar "whisper"  (whisper-cli, ggml-large-v3-turbo.bin)
        │                3. parse stdout lines → Vec<TranscriptToken>
        │                4. Channel<WhisperEvent>  Progress{percent} / Done{tokens, detectedLanguage} / Error
        │
        └─ (later, Apply Sync, FA gate open)
              JS: runForcedAlignmentForSync
                    computeFaChunkPlan(segments, whisperTokens, silences, duration)
                    invoke('fa_stage_audio_raw') + invoke('fa_align_production')
                          │
                          ▼
                    Rust: fa.rs / fa_production.rs / fa_onnx.rs
                      transcode_to_wav AGAIN (durable WAV cache, independent of the Whisper temp dir)
                      per-chunk wav2vec2 ONNX forward pass
                      FaWordSpan[] → faWordSpansToTranscriptTokens → TranscriptToken[]
```

**Native execution (whisper.cpp)**

| Piece | Location | Role |
|---|---|---|
| Sidecar binary | `src-tauri/binaries/whisper-<triple>` (gitignored). Declared in `tauri.conf.json` `bundle.externalBin` and `capabilities/default.json` `shell:allow-execute`. Built from whisper.cpp **v1.9.1** (`f049fff9`). Metal is **off**. Intel builds are AVX2, AVX-512 off. | The process `whisper_transcribe` spawns. |
| Spawn + parse | `src-tauri/src/whisper.rs` (`whisper_transcribe`, `transcode_to_wav`, `parse_stdout_tokens`, `parse_detected_language`, `whisper_cancel`, `whisper_transcribe_attach`, `whisper_stage_audio_raw`) | Whole local runner. |
| CLI args actually used | `-m <ggml-large-v3-turbo.bin> -f <input_16k.wav> -ml 1 -l <code\|auto>` | `-ml 1` = one token per stdout line. `-np` dropped (it hid the auto-detect line). `--dtw` permanently abandoned (Phase 2b: 0.000 s timestamp change under gapless `-ml 1` spans). |
| Model resolver | `whisper.rs::model_path` | Prefers `app_local_data_dir()/models/ggml-large-v3-turbo.bin`, then bundle / exe-relative / `src-tauri/models/` dev fallback. |
| Command registration | `src-tauri/src/lib.rs` (~457–464) | `whisper_transcribe`, `whisper_stage_audio_raw`, `whisper_cancel`, `whisper_transcribe_attach`, plus the four `whisper_model_*` download commands. |

**JS orchestration**

| Piece | Location | Role |
|---|---|---|
| Hook | `src/hooks/useWhisper.ts` | Single-flight per `Project.id`, abort, progress UI, writes `Project.transcriptTokens` / `language` / `detectedLanguage` / `unappliedTranscript`. |
| IPC client | `src/services/whisperService.ts` `transcribeWithProgress` | Attach-before-start, raw-body staging, Channel listener. **Does not parse timestamps** — it receives already-parsed tokens from Rust. |
| Apply Sync consumer | `src/App.tsx` `handleApplySyncFromFiles` | Uses cached tokens (`cachedTokensReady`); never re-spawns whisper-cli on Apply Sync. |
| Alignment | `whisperService.ts` `alignScenestoTranscript` / `extractSegmentAlignments` / `filterMalformedTokens` | Hirschberg on canonicalized token text + `startSec`. |
| Silence | `src/services/silenceDetector.ts` | Web Audio API `decodeAudioData` on the **original** voiceover blob. Independent of whisper-cli. |
| Duration | `src/services/tauriFfmpeg.ts` `probeAudioDuration` → `ffmpeg.rs` `probe_audio_duration` | ffmpeg sidecar stderr `Duration:` parse. Still base64 IPC (separate debt). |

**GGML model download (~1.51 GiB)**

| Piece | Location |
|---|---|
| Engine | `src-tauri/src/model_download.rs` — `MODEL_URL` HuggingFace `ggerganov/whisper.cpp/.../ggml-large-v3-turbo.bin`, `MODEL_SIZE_BYTES = 1_624_555_275`, `MODEL_SHA256 = 1fc70f77…e2bc69`, `GGML_MAGIC = lmgg`. Resumable `.part` + Range + sha256 + atomic rename. Shared with FA downloads via `stream_download_verified`. |
| Commands | `whisper_model_status` / `whisper_model_download` / `_cancel` / `_attach` |
| JS wrappers | `src/services/modelDownload.ts`, `src/services/models.ts` (`checkInstalledModels`, `importLocalModel`, `deleteInstalledModel`) |
| UI | `src/components/ModelsSection.tsx` “Transcription Engine” row, mounted from `AppSettingsModal` (and Manage Models / Project Settings FA detector). Module store: `src/services/modelDownloadStore.ts`. |
| On-disk | `app_local_data_dir()/models/ggml-large-v3-turbo.bin` (+ `.sha256` sidecar). Dev hand-place: `src-tauri/models/` (gitignored; README still describes curl provisioning). |
| Import | `models.rs` `import_local_model("whisper")` — GGML magic + size + sha256. |

**FA “language packs” (~1.18 GiB × 5 ≈ 6.3 GiB) — NOT Whisper**

These are **not** whisper.cpp language models. They are per-language wav2vec2-XLSR ONNX graphs (`jonatasgrosman/wav2vec2-large-xlsr-53-<lang>`), downloaded from `mohtashim9/kinetix-fa-models`, documented in `docs/ws2-app/fa-models-manage-models.md`.

| Lang | Expected size (bytes) |
|---|---|
| en | 1,262,512,711 |
| es | 1,262,545,511 |
| fr | 1,262,619,311 |
| de | 1,262,533,211 |
| pt | 1,262,566,011 |

A machine with Whisper + all five FA packs is ~1.51 + 6.31 = **~7.8 GiB**. That is the 1.5–7.5 GiB range in the prompt. **Only the Whisper 1.51 GiB row is in scope for a Groq transcription migration.** Deleting FA packs is a separate product decision (turn high-precision sync off, or replace FA — neither is implied by Groq).

**ffmpeg** stays regardless: export mux, duration probe, Whisper *and* FA 16 kHz transcode all use it.

### 1.2 Exact data contract produced by the local runner

The runner does **not** emit OpenAI/Groq JSON. It emits whisper-cli **stdout lines**, parsed in Rust, then a camelCase IPC payload.

#### Wire: `WhisperEvent` (`whisper.rs`, mirrored in `whisperService.ts`)

```
Progress { percent: u8 }                         // 0–100 from last stdout end-timestamp / durationSecs
Done     { tokens: TranscriptToken[],
           detectedLanguage?: string }           // only when -l auto AND stderr printed a detect line
Error    { message: string }
```

Progress is **percent-only**. Tokens arrive only on `Done`. That is the standing Transcription Req 2 gap (`docs/work-in-progress.md` WS2 Next tasks): there is no partial-token IPC variant today. Groq is the same shape (all-or-nothing), so it does not make that gap worse; it also does not close it.

Cancel is silent (exit 130/143): no retained terminal event. Attach-before-start (`whisper_transcribe_attach`) exists because the child outlives a Cmd+R.

#### Token object: `TranscriptToken` (`src/types.ts`)

| Field | Local Whisper sets it? | Type | Meaning |
|---|---|---|---|
| `startSec` | **yes** | `number` (seconds, f64) | Inclusive start of this token’s span. |
| `endSec` | **yes** | `number` | Exclusive-ish end. Under `-ml 1`, spans are **gapless**: token *i+1* starts where token *i* ended. Pauses are absorbed into the following word. Measured Phase 2b. |
| `text` | **yes** | `string` | Trailing text after `[HH:MM:SS.mmm --> HH:MM:SS.mmm]`. Example fixture: `"[00:00:00.000 --> 00:00:01.000]   hello"` → `text = "hello"` (whitespace trimmed). May still canonicalize to **multiple** words; the aligner expands them. |
| `confidence` | **no** | `number?` in `[0,1]` | FA-only (`faWordSpansToTranscriptTokens`). |
| `wordIndex` | **no** | `number?` | FA-only script-word join key. |
| `needsReview` | **no** | `boolean?` | FA-only, `confidence < CONF_MIN`. |

Rust serde names are snake_case (`start_sec`) and rename to camelCase on the wire. JS never sees the stdout brackets.

#### What the parser requires (and what it ignores)

`filterMalformedTokens` (`whisperService.ts`) is the only gate before alignment. A token is dropped if **any** of:

- `startSec` / `endSec` non-finite
- `startSec < 0`
- `startSec >= endSec` (zero or inverted duration)
- `endSec > audioDuration + MALFORMED_TOKEN_DURATION_TOLERANCE_SEC`
- `normalize(text)` is empty (punctuation-only / whitespace)

There is **no** schema field for segment id, avg_logprob, no_speech_prob, token ids, or word probability. Segment-level Whisper output is not consumed at all. Confidence is ignored on the Whisper path.

#### How tokens are consumed downstream

1. **Hirschberg alignment** (`extractSegmentAlignments`): each token’s `text` is `normalize()`d into one or more canonical words; `startSec` of the *owning token* is the word’s time. Query side is scene-doc words. Identity is **token index in this array**, never timestamp proximity (`CLAUDE.md` §4).
2. **`distributeSegmentTimes` / `applyAnchorBasedTiming`**: uses alignment `t0`/`t1` derived from those token times.
3. **`snapCoveredBoundaries`**: refines boundaries against **Web Audio silences**, using token spoken edges as the search-window centre / midpoint fallback. Designed around Whisper’s ~300 ms smear and gapless spans.
4. **Forced alignment chunk plan** (`faChunkPlan.ts` / `faAnchors.ts`): `whisperTokens` is one of three sources (alignment + tokens + silences) for R.1 anchors and unscripted-run excision. Comment in `forcedAlignmentRun.ts`: the array is used **only to derive chunk boundaries, never returned or merged** with FA output. Passed **raw** (unfiltered), matching the DEV harness.
5. **Timeline UI**: does **not** render tokens. Waveform is `waveformPipeline` / Web Audio peaks. Segment bars read `VideoSegment.startTime`/`duration`.
6. **Drag cascade**: `App.tsx` forwards `transcriptTokens` so a head/tail-yielding neighbor cannot be stripped of all its own words (word-onset wall). Consumes token times, not whisper-cli.
7. **Persistence**: `Project.transcriptTokens` in project JSON / IndexedDB snapshot. Cache key is `getFileIdentity(file) = name|size|lastModified`, not asset id.

**Language contract.** Codes are whisper.cpp ISO 639-1 (`en`/`es`/`fr`/`pt`/`de` in `constants.ts`), passed straight as `-l`. `Project.language` is sticky once set; a later run never silently re-detects. `Project.detectedLanguage` is the durable auto-detect record for the FA gate when sticky language is still unset. Detection source today: whisper-cli stderr `auto-detected language: en (p = 0.999905)`.

### 1.3 GGML asset surface that could be removed or bypassed

If Groq is the **only** transcription path (no local fallback):

| Can go | Why | Coupled leftovers |
|---|---|---|
| `ggml-large-v3-turbo.bin` download / import / delete | Nothing else reads this file. | `ModelsSection` Whisper row, `modelDownload.ts` whisper wrappers, `whisper_model_*` commands, `models.rs` `ModelId::Whisper` arm, `whisper.rs::model_path` / `MODEL_FILENAME`. FA download engine (`stream_download_verified`) **stays** — FA packs still use it. |
| `binaries/whisper-*` sidecar | Only `whisper_transcribe` spawns it. | `tauri.conf.json` `externalBin`, capabilities allow-list, `src-tauri/binaries/README.md` whisper section, CI whisper-cli build. ffmpeg sidecar **stays**. |
| `src-tauri/models/` GGML provisioning | Dev-only fallback. | README is already stale vs on-demand download. |

If Groq is **added** as an online path (hybrid): keep all of the above; gate which runner `whisper_transcribe` (or a sibling command) uses.

**Must not be deleted as a Groq side-effect:** FA ONNX packs, `onnxruntime/` bundle resources, `fa_*` commands, `transcode_to_wav`, ffmpeg sidecar, silence detector, Hirschberg aligner, `TranscriptToken` type.

---

## PART 2 — Groq API Compatibility & Integration Delta

### 2.1 API format and timestamps

**Our parser today:** Rust `parse_stdout_tokens` over `[HH:MM:SS.mmm --> HH:MM:SS.mmm]  text` lines. Groq never produces that. Compatibility is therefore **not** “does Groq JSON parse in `parse_stdout_tokens`?” — it does not, and should not be forced to. Compatibility is “can Groq word objects be mapped onto `TranscriptToken` so `filterMalformedTokens` + Hirschberg + snap + FA chunking still run?”

**Canonical OpenAI-compatible `verbose_json` (what Groq’s Speech API claims to implement), with `timestamp_granularities=["word","segment"]`:**

```
{
  "task": "transcribe",
  "language": "en",          // ISO 639-1 in the OpenAI shape; verify live — some providers emit a name
  "duration": 1234.5,
  "text": "...",
  "words": [
    { "word": "Hello", "start": 0.00, "end": 0.32, "probability": 0.99 }
  ],
  "segments": [
    { "id": 0, "start": 0.0, "end": 3.5, "text": "...", "words": [ ... ] }
  ]
}
```

Word objects may live at the top level, under each segment, or both, depending on provider. **This session did not fetch Groq’s live schema.** An implementation must assert the live payload once, then lock the mapper to that nest.

#### Mapper (required)

```
Groq word { word, start, end, probability? }
  → TranscriptToken { startSec: start, endSec: end, text: word.trim() }
```

| Topic | Local today | Groq word object | Action |
|---|---|---|---|
| Time unit | seconds, f64 | seconds, f64 | None. |
| Field names | `startSec`/`endSec`/`text` after serde rename | `start`/`end`/`word` | Rename in the adapter. Do not leak Groq names past `whisper.rs` / a sibling module. |
| Confidence | unset | optional `probability` | **Leave unset** on the Whisper-shaped path. Downstream treats confidence as FA-only. Mapping it would silently change `needsReview` semantics if anyone starts reading it on cached tokens. |
| `wordIndex` | unset | absent | Leave unset. FA overwrites the array when it succeeds. |
| Segment array | unused | present if requested | **Ignore.** Aligner’s subject is words, not phrases. |
| Word-internal spaces | `-ml 1` usually one token; aligner still splits via `normalize()` | typically one word; leading space is common (`" Hello"`) | `trim()` then existing `normalize()`. Already handles multi-word text. |
| Gapless spans | **yes** (Phase 2b) | **no** — words have real gaps at silence | Semantic delta. See §2.1.1. |
| Empty / inverted | filtered | possible if a word has `start==end` | Existing `filterMalformedTokens` already drops these. |
| Language | ISO 639-1 on stderr | `language` field | Normalize to ISO 639-1 before writing `detectedLanguage`. If Groq returns `"english"`, map to `"en"` — `Project.language` / FA gate / `-l` are codes, not names. |
| Progress | last token end / duration | typically none until the HTTP body completes | Synthesize from upload bytes + a post-upload “waiting” phase. Do not invent token-based percents. |

**Hard failure, not a fallback:** if word timestamps were requested and the `words` array is missing or empty, that is an `Error`, not “use segments and whitespace-split.” Segment text has no per-word times; faking them would poison Hirschberg and snap the same way a zero-token whisper-cli success used to.

`distil-whisper-large-v3-en` is English-only. This product’s verified languages are five (`en/es/fr/pt/de`). Distil is an English fast-path **option**, not a default. Default online model must be `whisper-large-v3-turbo` to stay on the same multilingual family as `ggml-large-v3-turbo`.

#### 2.1.1 Gapless vs gapped — the real compatibility risk

Local `-ml 1` absorbs pauses into the next word’s `[startSec, endSec]`. Snap and FA anchors were measured against that smear. Groq words typically **end before** a pause and **start after** it.

This is not a schema break. It is a **distribution** change in the same fields:

- Snap’s spoken-edge midpoint may sit *in* the pause instead of *into* the following word — often closer to what ears want, but **unmeasured** on these corpora.
- FA’s three-source-agreement (`faAnchors.ts`) uses token times plus silences. Different smear → different R.1 anchors → different chunk seams. FA inference itself does not care how Whisper smeared; the **planner** does.
- Golden replay (`scripts/phase4-handoff-replay-sync.test.ts`) never calls whisper-cli or Groq. A green 6/6 after a Groq mapper lands is **not** evidence the mapper is safe (`CLAUDE.md` §4: golden replay’s reach stops at `snapCoveredBoundaries` and never runs FA).

Treat one corpus Apply Sync with Groq tokens (FA off, then FA on) as a **measurement**, not a code-review conclusion.

### 2.2 Payload optimization and the 25 MB limit

#### What we already extract

| Step | Implementation | Output today |
|---|---|---|
| Stage | `whisper_stage_audio_raw`: raw `Uint8Array` body → temp `kinetix-whisper-<uuid>/input.<ext>` (magic-byte sniff: wav/mp3/m4a/ogg/flac/aiff/webm) | Original bytes, any size. |
| Normalize | `transcode_to_wav`: ffmpeg `-ar 16000 -ac 1` **uncompressed WAV** (implicit pcm_s16le) | 16 kHz mono PCM. |
| FA (separate) | `fa.rs` durable WAV cache, **reuses** `whisper.rs::transcode_to_wav` | Same WAV math, different directory, content-addressed. Unchanged by Groq. |
| Silence / waveform | Web Audio on the **original** blob | Independent. |

PCM size (from `fa.rs`’s own comment, 16 kHz × 2 bytes): **~1.83 MiB/minute ≈ 1,920,000 bytes/min**.

| Duration | 16 kHz mono WAV | vs Groq 25 MB |
|---|---|---|
| 13 min | ~24.0 MB | borderline / over |
| 15 min | ~27.5 MB | **over** |
| 20 min | ~36.6 MB | **over** |
| 30 min | ~54.9 MB | **over** |

**The current transcode cannot be uploaded to Groq for the stated 15–20 minute workload.** Compression is not an optimization; it is a gate.

#### Required pre-process (before upload)

Reuse the ffmpeg sidecar, change codec/container, keep 16 kHz mono (Whisper-family models resample to 16 kHz internally anyway):

```
ffmpeg -hide_banner -y -i <staged> -ar 16000 -ac 1 -b:a 64k <out.mp3 or out.m4a>
```

| Duration | 64 kbps mono | vs 25 MB |
|---|---|---|
| 20 min | ~9.6 MB | under |
| 30 min | ~14.4 MB | under (matches the prompt’s ~14 MB) |
| 52 min | ~25.0 MB | limit |
| 90 min | ~43.2 MB | **over → chunk** |

Prefer MP3 if the bundled ffmpeg has libmp3lame (GPL evermeet/gyan/osxexperts builds used here typically do — **verify on the actual sidecar**, not assumed). Else native AAC → `.m4a`, which Groq lists as accepted. Do **not** upload the WAV.

If the *source* is already a small compressed file and `stat` ≤ 25 MB, uploading as-is is legal; 16 kHz/mono/64k still recommended so a stereo 320 kbps 20-minute MP3 does not blow the cap. Always `stat` the **upload bytes**, not the source.

Do not send the file through JS `fetch` as base64. Staging is already raw IPC. Keep that. Groq upload should be **Rust `reqwest`** from the temp file (see §2.3).

`probeAudioDuration` is a separate base64 path (`tauriFfmpeg.ts:45-72`); it is not on the transcription hot path except as the duration that drives progress percent. Out of scope to fix here; WIP already flags it.

#### Fallback chunking (> 25 MB after 64 kbps)

Trigger: `upload_bytes > 25_000_000` (use the advertised 25 MB decimal cap, not 25 MiB).

At 64 kbps that is ≳ 52 minutes of audio — outside the 15–20 minute stated job, but a 90-minute lecture is a real file this app will accept (`AUDIO_EXTENSIONS`).

Strategy (aligned with existing invariants):

1. **Split on already-detected silences**, not on a raw timestamp grid. Silence detection already exists and is the app’s notion of a seam. A fixed N-second slice can cut a word in half; a silence-bounded slice cannot.
2. Each chunk **including headers** must be ≤ 25 MB. Pack greedily; if a single silence-bounded region still exceeds 25 MB (pathological continuous speech), fall back to a time split **inside** that region and accept a possible torn word at that one cut.
3. **Overlap is optional.** If used, stitch by **token order**, not by “nearest timestamp” (`CLAUDE.md` do-not: raw-timestamp proximity must not decide identity). Drop the overlapping tail of chunk *k* once chunk *k+1*’s first kept word’s text/order continues the transcript; offset every timestamp by `chunkStartSec`.
4. Pass the same `language` on every chunk once known. If the first chunk ran `auto`, pin later chunks to the detected code (mirrors sticky `Project.language`).
5. Concatenate `TranscriptToken[]` in chunk order. Re-run `filterMalformedTokens` on the stitched array once.
6. Failure of any chunk fails the job (no partial `Done`). Same as today’s whisper-cli: one child, one terminal event.

Do not parallelize chunks against a free-tier rate limit until measured. Serial is the conservative default and still seconds-per-chunk on an LPU.

### 2.3 Implementation points

#### Replace the spawn, keep the IPC

Smallest coherent change: **keep `WhisperEvent` and `transcribeWithProgress`**, replace the body of `whisper_transcribe` after `transcode_to_wav` (or a sibling `transcode_to_upload_audio`).

| File / function | Change |
|---|---|
| `src-tauri/src/whisper.rs` `whisper_transcribe` | After staging: transcode to 64 kbps 16 kHz mono → size check → Groq POST (or local spawn if hybrid and no key / offline) → map words → `WhisperEvent::Done`. Cancel becomes HTTP abort, not `CommandChild::kill`. |
| `src-tauri/src/whisper.rs` `transcode_to_wav` | **Do not break FA.** FA and the durable WAV cache call this. Add a sibling, or a parameter, for compressed output. |
| `src-tauri/Cargo.toml` `reqwest` | Today: `reqwest = { version = "0.12", features = ["json"] }` (default TLS + json). **No `multipart` feature.** Groq file upload is `multipart/form-data`. Add `multipart`. `reqwest` is already used by `model_download.rs`; this is not a new HTTP stack. |
| `src/services/whisperService.ts` `transcribeWithProgress` | Unchanged if the Channel contract is preserved. Do not put the API key or Groq URLs here. |
| `src/hooks/useWhisper.ts` | Unchanged except possibly progress copy (“Uploading…” vs “Transcribing…”). |
| `src/App.tsx` Apply Sync | Unchanged. It reads `transcriptTokens`, never spawns whisper. |
| `src-tauri/capabilities/default.json` | Whisper sidecar permission can remain for hybrid; drop only if the binary is removed. |
| `src-tauri/tauri.conf.json` CSP `connect-src` | **Irrelevant if Rust uploads.** If anyone `fetch`es Groq from the WebView, `https://api.groq.com` must be added — and the key would sit in the renderer. Do not do that. Stock keys (`api.pexels.com` etc.) are the precedent for JS-side public keys; Groq is a secret. |

**Do not implement the client in JS `fetch`.** CSP, key exposure, and the 25 MB body on the WKWebView heap are all worse than `reqwest` from a temp file the staging command already wrote. CLAUDE.md already forbids baking secrets into `vite.config.ts` `define`.

**Hybrid sketch:** `whisper_transcribe` branches on (key present ∧ not forced-local). Local path stays byte-identical. Online path never looks for `ggml-large-v3-turbo.bin`, so a fresh machine with a key can transcribe without the 1.51 GiB download.

#### API key security

The app has **no** keychain/stronghold plugin today. Settings exist (`AppSettingsModal`) and the live-feedback criterion says a control with no visible effect at point of use **belongs** on that surface. An API key has no live preview — it belongs in App Settings, not on the timeline.

| Option | Fits this architecture? | Notes |
|---|---|---|
| **User-supplied key in App Settings, stored only on the Rust side** (`app_local_data_dir` file with `0600`, or OS keychain later) | **Yes — recommended.** | JS `invoke('set_groq_api_key', { key })` write-only; transcription reads it in-process. Never persist on `Project` (projects are shared / snapshotted). Never log it. |
| Vite / `.env` `VITE_GROQ_API_KEY` | **No.** | Bundled into the client; same class as the forbidden AI-key-in-`define` rule. `VITE_PEXELS_*` are optional public search keys, not a paid inference credential. |
| Backend proxy | **Only if the product grows a server.** | CLAUDE.md: “there is no server and no AI API calls, everything runs locally.” A proxy is a standing service, billing, and an always-on network dependency the desktop app does not have. Correct for a future SaaS; out of scope for a drop-in desktop path. |
| Key in `Project` JSON | **No.** | Travels with the project file. |

Offline + no key: refuse with a clear Error (“no API key” / “offline”) or fall back to local whisper-cli. Do not hang on a TCP timeout without a classified error (`model_download.rs` already has a `classify_stream_error` pattern to reuse).

---

## PART 3 — Speed realism and downstream impact

### 3.1 Budget for a 15–20 minute file

Stated local baseline (not re-measured): **20–30 minutes** wall (~0.5×–0.75× realtime). That matches CPU-only whisper.cpp (`GGML_METAL=OFF`) on `large-v3-turbo`.

Online path, **estimates** (no live Groq call this session):

| Stage | Who | 20 min file, estimate |
|---|---|---|
| Read blob + raw IPC stage | existing | ~1–3 s (tens of MB). Same as today. |
| ffmpeg 16 kHz mono 64 kbps | existing sidecar, new args | ~1–5 s |
| Upload ~10 MB | network | ~1.6 s @ 50 Mbps; ~8 s @ 10 Mbps; ~80 s @ 1 Mbps |
| LPU inference | Groq | claimed ~5–10 s for this class of model/length (**unverified here**) |
| JSON parse + mapper | Rust | ≪ 1 s for ~4–8 k words (local V6-scale stdout was 4,639 lines) |
| `filterMalformedTokens` + Hirschberg | existing JS | typically sub-second to a few seconds; **unchanged** |
| Silence detect | Web Audio, existing | a few seconds; **unchanged**, still on the original blob |

**Transcription-only (stage → Done tokens):**

| Uplink | Estimated wall | vs 20–30 min local | Factor |
|---|---|---|---|
| Fast (50 Mbps) | ~10–20 s | 20–30 min | **~60–180×** |
| Typical (10 Mbps) | ~15–30 s | 20–30 min | **~40–120×** |
| Slow (1 Mbps) | ~1.5–2 min | 20–30 min | **~10–20×** |

The “~100×+ / 5–10 s round trip” claim is **inference + a fast uplink**, not a guaranteed end-to-end number. Upload can dominate. A 5–10 s *API* time that ignores transcode and upload will miss the budget the user actually watches (the progress bar in `useWhisper`).

### 3.2 Does ~100× hold inside the *app* pipeline?

**Split the pipeline. Apply Sync is not transcription.**

Today’s user-visible sequence:

1. **Stage voiceover** → `startTranscription` → 20–30 min local whisper-cli → `Project.transcriptTokens` written. Apply Sync button waits for this (`cachedTokensReady`).
2. **Apply Sync** → parse scenes → Hirschberg → optional **FA (76–231 s of ONNX, `forcedAlignmentRun.ts` comment)** → snap → commit. Does **not** re-run whisper-cli.

| Path | Today | After Groq | ~100×? |
|---|---|---|---|
| Staging transcription (the 20–30 min pain) | whisper-cli | Groq + transcode + upload | **Plausible on a decent link** |
| Apply Sync, FA **off** | seconds (align + snap + silence) | seconds (same) | N/A — already fast |
| Apply Sync, FA **on** (default is project-gated; capability + `faHighPrecisionSync`) | 76–231 s FA dominates | **same 76–231 s** + Groq already finished | **No.** ~8–15× vs a run that included local Whisper in the same sitting; FA is the new floor |
| Timeline playback / export | no Whisper | no Whisper | none |

So: migrating transcription to Groq **does** attack the stated 20–30 minute wait. It does **not** make “high-precision” Apply Sync a 5–10 second operation. Anyone quoting 100× for “sync” is mixing stage 1 with stage 2.

### 3.3 Hidden dependencies on *local Whisper execution*

**None in FA inference. None in the timeline renderer.** Both depend on **token data** (and, for FA, on ONNX + a 16 kHz WAV FA builds itself).

| Consumer | Depends on whisper-cli process? | Depends on `TranscriptToken[]`? | Groq impact |
|---|---|---|---|
| Hirschberg / snap / anchors | no | yes | mapper + gapless/gapped measurement |
| `runForcedAlignmentForSync` | no | yes (chunk plan only) | same; FA still needs its own models and still calls `transcode_to_wav` |
| `fa_align_production` / `fa_onnx.rs` | no | no (script text + WAV) | none |
| Timeline waveform | no | no | none |
| Drag word-walls | no | yes | gapped tokens may change onset walls slightly |
| Golden replay | no | fixture tokens | **will not move** |
| Language sticky / FA preflight | detect line from stderr | `Project.language` | Groq `language` field must map to ISO 639-1 |
| Models UI Whisper row | download of GGML | no | hide/disable if online-only |
| Single-flight / attach-on-reload | child process lifetime | no | HTTP request lifetime is shorter; attach-on-reload is less load-bearing but the registry can stay |
| `whisper:already-running:` refusal | yes | no | keep; Groq jobs can still overlap if not gated |

**FA is not a hidden Whisper spawn.** It is a second, slower, local engine. Replacing Whisper with Groq leaves FA’s 1.18 GiB/language download and 76–231 s runtime in place.

---

## 4. Architectural requirements (if this is built)

1. **Preserve `TranscriptToken` and `WhisperEvent`.** All of sync sits on that pair. Groq JSON must not leak past the native adapter.
2. **Never upload 16 kHz PCM WAV** for a ≥15 min file. 16 kHz mono **64 kbps** MP3/AAC, then `stat` against 25 MB, then silence-bounded chunk.
3. **HTTP from Rust (`reqwest` + `multipart`).** User API key stored off the `Project` and out of the Vite bundle. No proxy unless the product adds a server.
4. **Default model `whisper-large-v3-turbo`.** Distil only as an English opt-in. Language codes stay ISO 639-1.
5. **Word timestamps are mandatory.** Empty `words` → `Error`, not a segment split.
6. **Do not delete FA packs, ffmpeg, or `transcode_to_wav` as part of this.** Optionally delete GGML + whisper-cli only if local fallback is explicitly dropped.
7. **Do not treat golden replay or a green unit suite as Groq-timing evidence.** Measure: one real 15–20 min file, FA off and FA on, against the same ear-checked boundaries used for Whisper.
8. **Quote speedups with the stage named.** Transcription-only ~40–180× depending on uplink; Apply Sync with FA on remains FA-bound.

---

## 5. What this audit did not do

- No Groq live request, so word-array nesting, `language` name-vs-code, and true LPU wall-clock are unverified.
- No check that the bundled ffmpeg actually contains libmp3lame (AAC is the fallback).
- No rate-limit / pricing / ToS review.
- No corpus accuracy comparison (Groq turbo vs local ggml-large-v3-turbo vs FA-corrected boundaries). Same model *family* is not the same decoder, tokenizer, or VAD.
- Working tree was `main`, not `ws3-export-liveness-occlusion`. Transcription sources cited here are the standing pipeline on `main`; they are not export-liveness code.
