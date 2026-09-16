# Cloud transcription and alignment — compatibility and prerequisites

Recorded 2026-09-16. Investigated SHA `c463814` (branch `ws3-export-integration` tip, worktree `ws-cloud-asr-plan`). Amended 2026-09-16 against that same SHA, from the investigation findings: two independently invocable Modal functions rather than one co-located call; content-hash cache keys; cloud FA as first delivery of an unshipped capability; Apache-2.0 tag on the conversion repo as a hard prerequisite; a one-hour gateway cap and a one-hour end-to-end test as launch requirements; storage-path divergence as a blocker on local fallback; measured payload and weight sizes in place of estimates. This is a plan, not a description of current behaviour. Nothing below is implemented.

A prior static audit of a Groq-as-transcription path lives at `docs/ws2-editing-pipeline/transcription-groq-feasibility.md`. This plan does not adopt Groq. It evaluates self-hosting whisper large-v3-turbo and the five forced-alignment language packs on Modal.com as the primary path, with the existing local pipeline as offline or unreachable-network fallback. Video never leaves the machine. Audio is extracted and compressed locally, then uploaded.

Cloud forced alignment is not a migration of a live feature. `FA_PROJECT_DEFAULT_ON` is false (`faGate.ts:91`) and `fa-inference` is off in every shipped Cargo build (`Cargo.toml:110`), so every installer produced to date returns `notImplemented` from `fa_align`. Word-level precision sync has never reached a user. The product consequence of this plan is that it becomes available for the first time, and it arrives without requiring users to download 1,262,512,711 to 1,262,619,311 bytes per language (6,312,776,755 bytes for all five packs).

---

## Current pipeline inventory

Transcription and forced alignment are two sequential stages that share a 16 kHz mono WAV convention and a download engine, and otherwise share nothing: different weights, different processes, different output parsers, and different moments in the product flow.

Voiceover audio enters as an `Asset` whose `file` is the original user blob (typically m4a/AAC in the measured corpora). Staging-time transcription, in `App.tsx` around the `startTranscription` call at line 3569, reads that blob, probes duration via `probeAudioDuration` (`tauriFfmpeg.ts:167` → ffmpeg sidecar), and hands the asset to `useWhisper.startTranscription` (`useWhisper.ts:308`). That hook calls `transcribeWithProgress` (`whisperService.ts:1717`), which sends the original bytes as a raw IPC body to `whisper_stage_audio_raw` (`whisper.rs:715`). Rust sniffs a container extension from magic bytes (`whisper.rs:662`) and writes `input.<ext>` under a per-call temp directory. `whisper_transcribe` (`whisper.rs:856`, registered at `lib.rs:590`) then runs `transcode_to_wav` (`whisper.rs:743`): the bundled ffmpeg sidecar with `-ar 16000 -ac 1` and no explicit codec, which ffmpeg's WAV default realises as `pcm_s16le`. That was confirmed this session by running the same flags: 16 kHz, 1 channel, 16-bit little-endian PCM. The FA decoder (`fa_onnx.rs:137`, error text at line 131) will accept only that format. Whisper's temp WAV is deleted when the sidecar exits (`whisper.rs:780` and the `TmpDirCleanupGuard`). FA later transcodes again into a durable cache.

The whisper implementation is the bundled whisper.cpp sidecar, pinned to v1.9.1 (`src-tauri/binaries/README.md`), Metal off, declared in `tauri.conf.json` `bundle.externalBin`. Arguments actually used (`whisper.rs:973`): `-m ggml-large-v3-turbo.bin -f <input_16k.wav> -ml 1 -l <code|auto>`. The model file is OpenAI whisper large-v3-turbo converted to ggml, published at `ggerganov/whisper.cpp`, size `MODEL_SIZE_BYTES = 1_624_555_275` (`model_download.rs:140`), SHA-256 pinned next to that constant. It is not bundled: `tauri.conf.json` resources ship only `onnxruntime/*`. Acquisition is on-demand via `whisper_model_download` (`model_download.rs:921`) into `storage_root::models_dir` (`model_download.rs:408`). At this SHA, `whisper.rs::model_path` (line 590) still prefers `app_local_data_dir()/models/` then resource-dir, exe-relative, and `src-tauri/models/` for a hand-placed dev file. When the storage root has never been relocated those two locations coincide; after a relocation, downloads write to the new root and this resolver may not see them. That is the overlap with the concurrent storage work.

Stdout lines of the form `[HH:MM:SS.mmm --> HH:MM:SS.mmm]  text` are parsed by `parse_stdout_tokens` (`whisper.rs:1159`) into `TranscriptToken { start_sec, end_sec, text }` (`whisper.rs:65`). Progress is percent-only (`WhisperEvent::Progress`, `whisper.rs:73`). Tokens arrive only on `Done`. Language is `project.language` when set, else `"auto"` (`whisperService.ts:1802`); detection from stderr (`parse_detected_language`, `whisper.rs:1136`) is written once into sticky `Project.language` and unconditionally into `Project.detectedLanguage` (`useWhisper.ts:480–487`). The five verified codes are English, Spanish, French, Portuguese, German (`constants.ts:35`). Cancel is `whisper_cancel` (`whisper.rs:1107`) from the hook's `AbortSignal` (`whisperService.ts:1762`). On failure the promise rejects and `useWhisper` sets `transcriptionStatus` to `{ phase: 'error', message }` (`useWhisper.ts:543`); on abort it returns to idle. An empty token array is a warning, not a hard fail, at staging time; Apply Sync later hard-aborts on an empty transcript (`App.tsx:3859`).

Forced alignment runs later, on Apply Sync, and only when `isFaGateOpenForProject` is true (`faGate.ts:174`). The project switch `faHighPrecisionSync` defaults off at read time (`FA_PROJECT_DEFAULT_ON = false`, `faGate.ts:91`). The Cargo feature `fa-inference` is also off by default (`Cargo.toml:110`); a shipped build without that feature returns `notImplemented` from `fa_align`. When the gate is open, `App.tsx:3961` calls `runForcedAlignmentForSync` (`forcedAlignmentRun.ts:116`) with the voiceover asset, already-anchor-timed segments, cached Whisper tokens, duration, and `resolveFaLanguage` (`faGate.ts:140`: sticky language, else detected). Language packs exist only for `en es fr de pt` (`FA_SUPPORTED_LANGUAGES`, `forcedAlignmentRun.ts:45`; `FA_LANGUAGES`, `models.rs:224`). Any other code returns `'unsupported-language'` and never calls native code.

The JS runner detects silences on the original blob (`silenceDetector.ts:37`, Web Audio `decodeAudioData`, independent of the 16 kHz WAV), builds a chunk plan in TypeScript (`computeFaChunkPlan`), stages the original bytes again via `fa_stage_audio_raw` (`fa_dev.rs`, content-addressed by SHA-256 of the body), and invokes `fa_align_production` (`fa_production.rs:34`, registered at `lib.rs:610`). That command is a thin wrapper around `resolve_wav_and_align` (`fa_dev.rs:611`): single-flight claim, `fa_model_path` (`fa.rs:617`) with storage-root-first candidates (`fa.rs:571`), a full-file SHA-256 of `model.onnx` (1,262,512,711 to 1,262,619,311 bytes depending on language), `ensure_durable_wav` (`fa.rs:916`) which reuses `transcode_to_wav` into `app_local_data_dir()/fa-audio-cache/` keyed on hashed `name|size|mtime` (`fa.rs:731`), then `fa_align` / `align_chunked`. Each pack is `fa-models/<lang>/model.onnx`, downloaded from `mohtashim9/kinetix-fa-models` at pinned revision `f618960d71728eba5f12528d5571838a10d262bf` (`models.rs:83`), produced by exporting `jonatasgrosman/wav2vec2-large-xlsr-53-<lang>` through `scripts/export-fa-onnx.py`. Events are `FaEvent` Progress `{index, total}` / Done `{words}` / Error (`faBoundaryTypes.ts:64`). `fa_cancel` exists (`fa.rs:1176`) and has zero frontend callers.

`runForcedAlignmentForSync` never throws. Every failure — unsupported language, empty chunk plan, zero words, IPC/inference error — resolves to `{ status: 'fallback', reason, detail? }`. Apply Sync then uses the cached Whisper tokens and logs the fallback. Success maps `FaWordSpan[]` through `faWordSpansToTranscriptTokens` and persists them as `Project.faWordTimings` (`App.tsx:4656`).

Output structures. A Whisper token (`types.ts:359`) is `{ startSec, endSec, text }` with optional `confidence`, `wordIndex`, `needsReview` that only the FA reshape sets. An FA word (`faBoundaryTypes.ts:51`) is `{ word, startSec, endSec, confidence, needsReview, wordIndex }`. Results live on the `Project` JSON (`projectStore.ts:268`, native OS store in the Tauri app, localStorage in plain-browser dev): `transcriptTokens`, `lastTranscribedFileIdentity`, `lastTranscribedAssetId`, `language`, `detectedLanguage`, `unappliedTranscript`, and `faWordTimings`. They are not recomputed on load. Apply Sync reuses `transcriptTokens` when `cachedTokensReady` (`App.tsx:3849`) finds a matching file identity and a non-empty token array. It does re-run FA on every gated Apply Sync; `faWordTimings` is rewritten or cleared each time, never reused as an input.

Caching, plainly. There is result caching for transcription, and it is not a content hash. `getFileIdentity` (`syncEngine.ts:383`) is `` `${file.name}|${file.size}|${file.lastModified}` ``, stored as `Project.lastTranscribedFileIdentity`. Same name, size, and mtime skips whisper-cli; a byte-identical file with a different name does not. FA word timings are persisted after a successful run but are not a cache that Apply Sync reads back. The durable FA WAV cache (`fa.rs:678`, 2 GiB LRU) caches transcoded audio, not alignment output, and is keyed on the same name|size|mtime identity hashed, not on file bytes. Whisper's own 16 kHz WAV is not cached at all.

---

## The seam

There is no single function today that both transcribes and aligns. The two stages fire at different times: transcription at voiceover staging, FA at Apply Sync, and FA's chunk plan is computed in TypeScript from the script's segments plus the Whisper tokens that staging already produced. A Modal function that does both in one upload cannot be dropped onto those call sites. That finding is why the design is two independently invocable functions, not one.

The narrowest existing substitution points are these two.

Transcription: `transcribeWithProgress` (`whisperService.ts:1717`). Inputs: `Asset` (original audio blob), `durationSecs`, `language | undefined`, `onProgress`, `AbortSignal`, optional `jobKey`. Output: `{ tokens: TranscriptToken[]; detectedLanguage?: string }`. Asynchronous. Progress is a 0–100 percent callback. Cancellation is already wired (`whisper_cancel`). Failure rejects; the hook surfaces an error banner and does not write tokens.

Forced alignment: `runForcedAlignmentForSync` (`forcedAlignmentRun.ts:116`), which is the fail-clean JS wrapper, or one layer down, `resolve_wav_and_align` (`fa_dev.rs:611`), which is the native body after the original bytes have been staged. JS inputs: voiceover `Asset`, `VideoSegment[]` (already anchor-timed), cached Whisper `TranscriptToken[]`, `audioDuration`, language code. JS output: `FaRunResult` (tokens plus unscripted runs, or a named fallback). Native inputs after staging: filesystem path, `FaChunkInput[]` `{startSec, endSec, text}`, language, event channel. Native output: `FaEvent::Done { words: FaWordSpan[] }`. Asynchronous. Progress is per-chunk. Cancellation exists natively and is not connected to any UI control. Failure never aborts Apply Sync; the caller falls back to Whisper tokens.

The current shape allows two adapters, one per stage, because both JS entry points are already async, already return a stable data contract, and already isolate failure. That is the primary cloud shape as well: two independently invocable Modal functions, not one co-located call. Transcription at staging cannot carry a chunk plan or a final script; FA at Apply Sync already has both. Audio is uploaded once, on the transcription call, and cached server-side keyed on a content hash of the audio bytes. The alignment call then names that hash and does not re-upload. The honest cost is two cold starts rather than one; warm containers matter more under this design than a single combined function would have required. A combined single call, used only when transcript and script are both already available, is a later optimisation, not the primary path. The local fallback keeps today's split (staging-time whisper-cli, Apply-Sync FA).

---

## License audit

Whisper large-v3-turbo weights are MIT (`openai/whisper-large-v3-turbo`, Hugging Face `cardData.license`, fetched 2026-09-16). whisper.cpp is MIT. Hosting and commercial use of the transcription side are unrestricted.

The five shipping FA packs are ONNX exports of Jonatas Grosman's wav2vec2-XLSR-53 fine-tunes, themselves fine-tunes of `facebook/wav2vec2-large-xlsr-53` (Apache-2.0, Hugging Face API, same day). Each Grosman checkpoint's Hugging Face card and `license:` tag is Apache-2.0. Apache-2.0 §2 permits reproduction, derivative works, public performance, and distribution, including commercially hosted inference, with attribution. The conversion repo `mohtashim9/kinetix-fa-models` currently publishes the five `model.onnx` files with no license field on the Hugging Face API. That is a missing tag on the conversion repo, not a licensing conflict with the origin models.

Hard prerequisite, before any Modal function loads FA weights: `mohtashim9/kinetix-fa-models` must carry an Apache-2.0 license tag with attribution to the `jonatasgrosman/wav2vec2-large-xlsr-53-*` originals. Until that tag is present, Modal must not fetch those URLs.

MMS-FA (torchaudio `MMS_FA`, Meta, CC-BY-NC-4.0) was considered in Phase 3 and barred by Decision 3 / ruling R-Q. It is not shipped, must not be hosted, and is permanently barred.

| Language | Pack / model name | Origin | License | Commercial hosted serving |
|---|---|---|---|---|
| English | `model.onnx` from `jonatasgrosman/wav2vec2-large-xlsr-53-english` (revision `569a6236`, 1,262,512,711 bytes) | Hugging Face checkpoint, ONNX-exported by `scripts/export-fa-onnx.py`; served from `mohtashim9/kinetix-fa-models` | Apache-2.0 (origin card, HF API 2026-09-16). Conversion repo license tag: none | **Permitted** |
| Spanish | `model.onnx` from `jonatasgrosman/wav2vec2-large-xlsr-53-spanish` (revision `96d7e9b4`, 1,262,545,511 bytes) | same path | Apache-2.0 (origin). Conversion repo license tag: none | **Permitted** |
| French | `model.onnx` from `jonatasgrosman/wav2vec2-large-xlsr-53-french` (revision `7c79e105`, 1,262,619,311 bytes) | same path | Apache-2.0 (origin). Conversion repo license tag: none | **Permitted** |
| German | `model.onnx` from `jonatasgrosman/wav2vec2-large-xlsr-53-german` (revision `4b8a0295`, 1,262,533,211 bytes) | same path | Apache-2.0 (origin). Conversion repo license tag: none | **Permitted** |
| Portuguese | `model.onnx` from `jonatasgrosman/wav2vec2-large-xlsr-53-portuguese` (revision `634ac655`, 1,262,566,011 bytes) | same path | Apache-2.0 (origin). Conversion repo license tag: none | **Permitted** |
| (not shipped) | torchaudio MMS-FA / Meta MMS | measurement-only, Decision 3 | CC-BY-NC-4.0 | **Not permitted** — remains barred |

Overall verdict: the planned hosted feature is not blocked on origin license. Every currently shipped or downloadable FA pack is an Apache-2.0 derivative and may be served commercially once the conversion repo carries the Apache-2.0 tag required above. No pack in the shipping set is unknown at origin. MMS-FA remains permanently barred under CC-BY-NC-4.0.

---

## Audio payload sizing

The pipeline's actual working format, after `transcode_to_wav`, is 16 kHz mono `pcm_s16le` WAV. One hour of that format was generated this session with ffmpeg 8.1.1 using the production flags: **115,200,078 bytes** (115,200,000 bytes of PCM plus a 78-byte WAV header), which is 109.8634 MiB, 256 kbps.

The same one-hour 16 kHz mono signal compressed with libopus, CBR 16 kbps, measured **7,477,405 bytes** (7.1310 MiB). CBR 24 kbps measured **11,077,425 bytes** (10.5643 MiB). ffmpeg's libopus default without a bitrate (measured on a 60-second clip, 589,516 bytes) is substantially larger and is the wrong setting for speech. **16 kbps CBR is the specified upload setting.** Size quotas and the gateway cap against that measured 7,477,405 bytes per hour, not against WAV and not against libopus defaults.

Original user files are whatever was staged, not the 16 kHz WAV. The V6 corpus voiceover is documented as `6.m4a` at 32,851,696 bytes for 1,420.06 s of aligned audio (last token end in `scripts/fixtures/phase4-baseline-v6-words.csv`); that is the longest measured project. The 173 corpus is 708.609 s (`phase4-fa-baseline-173-words.csv`). The Spanish fixture is 91.05 s.

No maximum voiceover duration exists anywhere in application code. The longest tested voiceover is 1,420.06 s (~23.7 min). Nothing in the tree has been exercised at one hour. A one-hour gateway cap is a launch requirement. A deliberate one-hour end-to-end test is a prerequisite before the feature is exposed to users. Export elapsed-time formatters already render hours (`useExport.ts`); that is display code, not a duration limit and not a test.

---

## Offline fallback

Nothing in the app currently determines whether the machine is online. `navigator.onLine` is unused. "Offline" in the UI means an unresolved media asset (`DropZonePanel` badge), not network reachability. Stock-search CSP entries (`tauri.conf.json` `connect-src`) are the only outbound HTTP the WebView is allowed; a gateway origin is not among them. A cloud-primary path therefore has to grow an explicit online probe (a cheap authenticated gateway ping from Rust, not a JS `fetch` that would also need a CSP change and would put the session token in the WebView) and a fallback policy for timeout, 5xx, and quota exhaustion.

What must persist locally for fallback to work. The whisper.cpp sidecar binary is already bundled. The ggml weights are not: `ggml-large-v3-turbo.bin` is 1,624,555,275 bytes, downloaded on demand. The five FA packs total 6,312,776,755 bytes (per-pack sizes in the license table). A machine with Whisper plus every FA pack holds 7,937,332,030 bytes of weights, none of them in the installer. ONNX Runtime is bundled as a resource but unused unless `fa-inference` is compiled in. ffmpeg is bundled and is required even when the cloud path is used, because extraction and compression stay local.

Local fallback cannot be implemented until model path resolution is unified. At the investigated SHA, downloads write through `storage_root::models_dir` (`model_download.rs:408`) while `whisper.rs::model_path` (`whisper.rs:590`) reads from `app_local_data_dir()/models/`. After a relocated storage root those paths diverge, so a downloaded ggml file can be present on disk and still look missing to transcription. This is being fixed concurrently in the storage work. Both call sites must be re-read before implementing the fallback path; do not implement fallback against `c463814` as if the resolver already agreed with the downloader.

If cloud becomes primary, local models can be made optional at install time. They already are: a fresh install has no ggml file and no FA packs until the user downloads them. What breaks if a user never downloads them is exactly the fallback. Staging-time transcription fails with the existing "model not found" error when the gateway is unreachable and no local ggml is present. Apply Sync then hard-aborts if `transcriptTokens` is empty. Preview, editing, and export of a project that already has tokens continue to work. FA without a local pack already fail-cleans to Whisper timing, so an optional FA download is the current behaviour. The whisper-cli sidecar would still ship in the bundle unless a later packaging change removes it; leaving it in costs little compared with the 1,624,555,275-byte weights. A settings row that downloads the local engine when the user wants offline use is the right shape, not a mandatory first-run fetch of 7,937,332,030 bytes.

---

## Proposed design

A thin gateway service is the only thing the desktop app calls. The gateway authenticates the account, enforces per-account quotas and a one-hour maximum job length, meters usage, and forwards to Modal. The app never holds Modal credentials. The WebView never sees those credentials either; the Rust shell holds the user's session token and posts the already-compressed audio as a raw body, the same discipline `whisper_stage_audio_raw` already uses to avoid base64 inflation.

Transcription and alignment are two separate Modal functions, each independently invocable, matching the two existing seams (`transcribeWithProgress` at staging, `runForcedAlignmentForSync` at Apply Sync). The transcription function receives 16 kHz Opus at the specified CBR 16 kbps setting, plus the project's language code, and returns `TranscriptToken[]` (and a detected language when asked). Audio is stored server-side keyed on a content hash of the audio bytes. The alignment function does not take a second upload: it receives that hash, the language, and the script/segment text the chunk planner needs, loads the cached audio, and returns `FaWordSpan[]`. Apply Sync consumes both through the existing mappers (`faWordSpansToTranscriptTokens`, `alignScenestoTranscript`).

This is two cold starts, not one. Warm containers matter more under this design than the original co-located function assumed, because staging-time transcribe and Apply-Sync FA are separated by user work and will not share a just-started container. A combined single call, used only when transcript and script are both already available, is a later optimisation, not the primary path.

faster-whisper on the GPU is the cloud throughput path. whisper.cpp remains the local fallback. Same weights in both is a necessary condition for comparable text, not a guarantee of identical timestamps; see risks. Audio longer than a single container's comfortable window is chunked and fanned across containers. Weights live in a Modal volume, not baked into the image, so a pack or ggml update is a volume write rather than a rebuild.

Both the local result cache and the server-side audio cache key on a content hash of the audio bytes. That is one hash, used twice: it is how the alignment call finds the audio that transcription already uploaded, and it is how the project decides a result is already in hand. Today's `name|size|lastModified` key (`syncEngine.ts:383`) is volatile — it changes on file copy, cloud sync, and restore from backup — so identical audio can miss its own cache and be re-transcribed at cost. The FA durable WAV cache (`fa.rs:731`) uses the same identity and has the same defect. The planned key replaces both. This is adjacent to the timeline hash stability defect currently being fixed in the storage work; the two should use consistent hashing conventions. The producing engine is recorded on the project (`whisper.cpp` / `faster-whisper`, plus FA pack revision). A later fallback run against the same audio must not silently replace cloud tokens, and a later cloud run must not silently replace local ones; the user, or an explicit re-run, chooses.

Per-account quotas and the one-hour job-length cap are enforced at the gateway before Modal is invoked. Failed or cancelled jobs do not consume the alignment quota; a second submit of the same content hash against a still-valid cached result is a cache hit, not a new bill.

---

## Phased plan

Gateway first: authenticate, reject oversize jobs, meter, and return a stub so the desktop client can be wired against a real URL without Modal behind it.

Then audio extraction and compression: a local ffmpeg path that produces 16 kHz mono Opus CBR 16 kbps from the staged voiceover, alongside the existing WAV transcode the local engines still need.

Then the two Modal functions: faster-whisper for transcription, FA in a second function that loads cached audio by content hash; weights from a volume; each returning the existing token or word-span shape. A combined call is not in this phase.

Then chunked parallelism: split long audio, fan across containers, merge in ordinal order, never by timestamp proximity.

Then caching and provenance: one content hash of the audio bytes keys both the local result cache and the server-side audio cache, producing engine recorded, no silent engine swap. Do not inherit `name|size|lastModified`.

Then offline detection and fallback: gateway ping from Rust, timeout and error classes, local whisper.cpp when the ggml file is present, existing FA fail-clean when the pack is present, clear UI when neither cloud nor local can run. Blocked on unified model path resolution; re-read `model_download.rs:408` and `whisper.rs:590` before this phase.

Then metering: account quotas, one-hour job-length cap, usage surfaced in settings. The one-hour end-to-end test is a prerequisite for exposing the feature, not a follow-up.

---

## Open questions and risks

Cold start latency. Two independently invocable functions means two cold starts on the primary path. A transcription container attaching 1,624,555,275 bytes of weights, then later an FA container attaching one language pack (1,262,512,711 to 1,262,619,311 bytes), will not be interactive on a true cold start, and the two calls are separated by user work so they will not share a just-started container. Warm containers matter more under this design than the original co-located function assumed. Whether they are required is a measurement. Until that number exists, do not promise staging-time transcription that feels like today's local model-already-loaded path.

License. Hard prerequisite: `mohtashim9/kinetix-fa-models` must carry an Apache-2.0 license tag with attribution to the `jonatasgrosman/wav2vec2-large-xlsr-53-*` originals before any Modal function loads those weights. Origin models are Apache-2.0; the issue is the missing conversion-repo tag, not a conflict. MMS-FA remains permanently barred under CC-BY-NC-4.0 and is not in the plan.

Determinism between engines. faster-whisper (CTranslate2) and whisper.cpp do not produce identical token strings or timestamps on the same weights. Hirschberg alignment, rescue, and every FA chunk boundary that depends on Whisper tokens will move if the engine moves. Provenance on the project is the mitigation; a silent swap is the failure mode. A golden-replay-style fixture that asserts cloud versus local identity will fail, and that failure is information, not a reason to re-baseline.

Privacy. User audio leaves the machine. Video does not, provided extraction stays local and the client never uploads the original container when that container is a video file with an audio track — the current staging path sends the whole voiceover asset, which for a true audio file is correct and for a video-as-voiceover would send pictures. The extraction step must emit audio-only before the gateway sees bytes. Retention at the gateway and on Modal (delete after result persist, no training use) needs a written policy before the first real upload. CSP and the "everything runs locally, no server" product claim in CLAUDE.md both change; the latter is an architecture change, not a footnote.

Combined call. The primary path is two functions. A combined single call for the case where transcript and script are both already available is a later optimisation, not a reason to delay staging-time transcription until Apply Sync.

Online detection does not exist. Fallback cannot be "if the fetch throws" without also defining timeout, partial upload, and "tokens already cached from last week" behaviour.

Storage-path divergence. Downloads write through `storage_root::models_dir` (`model_download.rs:408`) while `whisper.rs::model_path` (`whisper.rs:590`) reads from `app_local_data_dir()/models/`. Local fallback cannot be implemented until those are unified. Concurrent storage work is fixing this. Re-read both call sites before implementing the fallback path.
