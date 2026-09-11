# WS3 Export Speed Architecture Audit

> **Purpose:** static, read-only feasibility analysis of four candidate export-speed
> optimizations against the shipped WebCodecs+WebGL2 pipeline. Not a status tracker
> and not a workstream ledger — those remain `project-state.md` / `docs/work-in-progress.md`.
>
> **Method:** source reading only. No code edits, no test runs, no live exports.
> FPS numbers other than the stated baseline are **estimates**, not measurements.
>
> **Date:** 2026-09-09. **Branch:** `ws3-export-liveness-occlusion`.

---

## 0. Baseline (stated, not re-measured)

| Quantity | Value |
|---|---|
| Workload | Full-effects export, 447 segments, 42,638 frames @ 1080p30 |
| Timeline | ≈ 23.7 minutes of output (`42638 / 30`) |
| Architecture | One WebGL2 dedicated worker, sequential frame loop, one `VideoEncoder` |
| Stated throughput | **~19 fps** |
| Stated wall time | **~37 minutes** (`42638 / 19 ≈ 37.4 min`) |

Normalized “23-minute video” used in Part 2 rankings: `23 × 60 × 30 = 41,400` frames. At the stated 19 fps that job is **36.3 minutes**.

### 0.1 What the current pipeline actually does

End-to-end path for a GL-eligible project:

1. **Route + piece-plan** (`exportPipelineWebCodecs.ts`) — per-segment tier `plain` / `gl` / `canvas`; adjacent GL segments sharing a real transition are unioned into **one** GL piece (`groupConnectedComponents`, lines 276–304). A full-effects 447-segment project with a transition on every boundary is therefore **one GL piece**, not 447.
2. **Drive that piece with exactly one worker** (`driveGlRun`, lines 588–962) — `new Worker(exportWorker.ts)`, `activeWorker` is a module singleton (line 163). The orchestrator’s piece loop is `for (let pieceIndex = 0; …)` awaited sequentially (lines 1316–1448).
3. **Inside the worker** (`exportWorker.ts` `runExport` / `runFrameLoopTick`) — for each frame: await slot decode → `texImage2D` upload → multi-pass GL composite → text overlay → `new VideoFrame(canvas)` → `VideoEncoder.encode` (annexb) → `postMessage` chunk.
4. **Main thread** serializes `ffmpeg.appendFileRaw` onto one piece file (`driveGlRun` `appendQueue`, lines 618–813).
5. **Concat** raw AnnexB piece files with `ffmpeg.concatAnnexbPieces` (Rust byte-copy, 2 FDs) → **frame-count guard** → **mux** (`muxOnly.ts`) to MP4 with `-c:v copy`.

The worker itself refuses a second `init` while `running` (`exportWorker.ts` lines 1127–1128). Plan §9.3 / the orchestrator comment: one export at a time.

### 0.2 Where the 19 fps almost certainly is *not*

The WebGL2 feasibility spike (`docs/archive/history/history.md`, engine-decision section) measured WKWebView `VideoFrame` → `texImage2D` + draw at **~531 fps** single-slot and **~411 fps** dual-upload+blend. Shader fill-rate is therefore not the 19 fps cap. The sequential export loop adds decode-cursor management, a multi-pass transition/zoom/grade chain, Canvas2D text atlases, `VideoFrame(OffscreenCanvas)` capture, hardware/software encode, and per-chunk IPC append. Those later stages, plus the fully-`await`ed tick, are the plausible 52 ms/frame.

This matters: an optimization that only makes the compositor faster (Option 3’s main pitch) has a **low expected speedup** unless it also removes a GPU-sync or copy that `VideoFrame(canvas)` currently forces.

---

## PART 1 — Individual Feasibility

Verdict vocabulary:

- **FEASIBLE** — can be built on the current architecture without replacing it; remaining work is implementation, not a missing primitive.
- **PARTIALLY FEASIBLE** — a real subset is buildable; a stated form of the option is blocked or already partly present.
- **BLOCKED** — a standing invariant, missing native surface, or product-floor constraint prevents the option as stated.

---

### Option 1 — Multi-Worker Parallel Segment Rendering (Chunked Session Splitting)

**Verdict: PARTIALLY FEASIBLE**

#### What already exists (concat without re-encode)

The production concat path does **not** join MP4s. It joins **raw AnnexB H.264 elementary streams**, then muxes once.

| Primitive | Where | What it guarantees |
|---|---|---|
| Streamed per-piece `.h264` | `driveGlRun` → `appendFileRaw` → `ffmpeg_append_file_raw` (`ffmpeg.rs` 135–166) | One file per piece; append-only; no container |
| Byte concat | `ffmpeg_concat_annexb_pieces` (`ffmpeg.rs` 263–346), wrapped by `TauriFfmpeg.concatAnnexbPieces` (`tauriFfmpeg.ts` 214–235) | `-c copy` equivalent: raw byte append, **no re-encode**, 2 FDs regardless of piece count |
| Frame-count guard | `ffmpeg_count_annexb_frames` + `exportPipelineWebCodecs.ts` 1471–1486 | Concat result’s NAL-1/5 count must equal `sum(expectedFrames)` or the export aborts |
| Final mux | `muxOnly.ts` `buildVideoRemuxArgs` | `-r <fps> -i annexb -c:v copy` into MP4 (never `-framerate`; never concat-protocol) |

`remuxMp4ToAnnexb` (`exportPipelineWebCodecs.ts` 980–984) already does `-c copy -bsf:v h264_mp4toannexb` for Tier 1/C MP4 pieces. Joining **muxed MP4s** with ffmpeg’s concat demuxer would also be `-c copy` *if* every MP4 shared codec, size, timebase, and started on an IDR — but that path is unused, strictly worse (an extra remux per chunk), and unnecessary. **Use the existing AnnexB concat.**

Rust comment (`ffmpeg.rs` 276–280): raw AnnexB concatenation is treated as spec-valid because every NAL is start-code prefixed; the helper is deliberately not NAL-aware. Correctness of the *joined bitstream* still depends on each piece being independently decodable (below).

#### Architectural blockers (why not a straight “FEASIBLE”)

**1. The orchestrator is a single-worker sequential machine.**

- `activeWorker: Worker | null` (`exportPipelineWebCodecs.ts` 163) and `cancelExportWebCodecs` (177–191) assume one worker.
- Piece encode is `await driveGlRun(...)` inside a serial `for` (1316+).
- `exportWorker.ts` 1127–1128: `if (running) return`.
- `ffmpeg.rs` 14–15: “a session runs its ffmpeg calls sequentially (segment encode, concat, mux — never concurrently).” Concurrent `ffmpeg.exec` is not in the contract. Concurrent `appendFileRaw` to **different** piece files is a different command (plain `OpenOptions::append` I/O, no child process) and is the parallel-write primitive you would use.

**2. A full-effects timeline is one GL piece, so “split by segment” is illegal as currently planned.**

`groupConnectedComponents` unions every adjacent pair whose effective transition has `duration > 0` and a GL slug. A 447-segment project with a transition on every boundary becomes **one** `PiecePlan` with `segments.length === 447`. Splitting that array between workers at an interior segment index is exactly the bug that function exists to prevent (header comment lines 36–49, assertion at 328–342): a real transition would be dropped or double-rendered.

The viable split is **time-windowed**, not segment-sliced:

- Pass the same GL run (or a neighborhood of segments covering the window) to N workers.
- Each worker walks `currentTime ∈ [t0, t1)` with `totalFrames = round((t1 - t0) * fps)`.
- Worker *k*’s first encoded frame is a keyframe (`isKeyFrame(0)` is already true: `i % gop === 0` at `i = 0`, `exportWorker.ts` 959–961).
- Concat `piece_0.h264` … `piece_{N-1}.h264` in timeline order.
- Frame-count guard still applies to the sum of windows.

That requires new fields on `ExportWorkerInitMessage` (run-local time/frame window), a non-singleton `activeWorker[]`, per-worker `appendQueue`s onto distinct files, and cancel-all. It does **not** require a new concat implementation.

**3. Hardware encoder session ceiling — 2–3 workers is the safe cap.**

Each worker constructs one `VideoEncoder` via the hardware-first ladder (`exportWorker.ts` 563, 572–627: `prefer-hardware` → `no-preference` → `prefer-software`, codec `avc1.640028`, `avc: { format: 'annexb' }`). Consumer NVIDIA NVENC historically hard-caps simultaneous encode sessions at **3** (some 40-series SKUs advertise 5; treat 5 as unverified for this fleet). Each worker also opens up to **two** `VideoDecoder`s (`MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS = 2`, `decodeCursorLifetime.ts` 21) which may consume NVDEC/VideoToolbox decode sessions.

Safe ceiling for this codebase: **2 workers default, 3 maximum**, with an immediate software-ladder fallback if the second/third `configure()` throws (the ladder already exists per worker). Four or more is not a throughput plan; it is a session-exhaustion plan. On VideoToolbox (macOS WKWebView) the numeric cap is softer than NVENC, but GPU memory and the 2-cursor invariant still bound N.

**4. Keyframe / AnnexB parameter-set rules at chunk boundaries.**

Seam-free concat of independently encoded AnnexB pieces requires all of:

| Rule | Current code | Gap for parallel chunks |
|---|---|---|
| Piece starts with IDR | `isKeyFrame(0)` true (GOP and/or `i === 0`) | Keep: force `keyFrame: true` on each worker’s frame 0 (already true) |
| In-band SPS/PPS before first slice | WebCodecs annexb output typically repeats parameter sets on keyframes; mux never inspects them (`muxOnly.ts` 80–82) | **Unverified across two encoder instances.** Same `EXPORT_CODEC` / W / H / fps should produce compatible SPS. The frame-count guard does **not** check SPS identity |
| No cross-piece references | Each worker `encoder.flush()` then `close()` (`exportWorker.ts` 1031–1049) | Satisfied if each window is its own encoder session |
| Identical coded size | Orchestrator evens W/H once and passes them to every piece (`exportPipelineWebCodecs.ts` 1214–1225) | Satisfied |
| Timestamps | Run-local `Math.round(i * 1e6 / fps)` (`exportWorker.ts` 782–785, 985–992). Raw annexb carries no container PTS; mux synthesizes from `-r` | Satisfied — do **not** try to make per-worker timestamps global |
| Split not inside a half-open frame | Worker uses `Math.round((runEnd - runStart) * fps)` | Windows must be partitioned on **integer frame indices** so `sum(windowFrames) === totalExpectedFrames` |

AUD/SEI differences between two hardware encoder sessions are the residual seam risk. Mitigation already in tree: post-concat `countAnnexbFrames`. A stronger gate (decode-round-trip of the join, or SPS comparison) does not exist today.

**5. Memory / demux duplication.**

`videoDemuxer.ts`’s `demuxCache` is a **per-worker-module** `Map` (line 53). Parallel workers do not share it. Each worker that is handed the full asset list will fetch+parse every blob again. `DECODE_AHEAD_CAP = 8` live `VideoFrame`s per cursor × 2 cursors × N workers is the GPU-memory multiplier. WS3 just made `peakOpenCursors: 2` a liveness invariant; N workers must each still honor that cap, not a shared global of 2.

#### Feasibility summary

| Sub-claim | Result |
|---|---|
| Concat chunked H.264 without re-encode | **Yes**, AnnexB byte concat already ships |
| Concat chunked **MP4** without re-encode | Possible via ffmpeg concat demuxer + `-c copy`, **not** the production path; do not build it |
| 2–3 parallel GL workers | **Yes**, with time-window splits, multi-worker orchestrator, distinct piece files |
| Split a fully-transitioned 447-segment run by segment index | **No** — violates connected-component routing |
| N > 3 on consumer NVENC | **Unsafe** |

**Implementation complexity if pursued:** High. **Stability risk:** High (encoder-session exhaustion, 2×/3× demux RAM, cancel/watchdog fan-out, silent-gap attribution across workers). Concat itself is the low-risk part.

---

### Option 2 — Pipelined Pre-Decoding (Asynchronous Lookahead Ring-Buffer)

**Verdict: PARTIALLY FEASIBLE**

#### What the frame loop actually waits on

The tick (`exportWorker.ts` `runFrameLoopTick`, 709–803) is:

```
await resolveSlotSource(plan.a)     // may await frameAt → gen.next()
uploadSlot A
await resolveSlotSource(plan.b)?    // second sequential await during transitions
uploadSlot B
compositor.renderFrame              // sync GL
textRenderer.renderFrame            // sync GL + cached 2D atlases
maybe await waitForDequeue          // only if encodeQueueSize > 4
new VideoFrame(canvas); encode(); close()
await releaseStaleCursors
```

`VideoDecoder.decode()` is **not** called from this loop. It is called inside `sequentialDecode.ts`’s concurrent feed IIFE (lines 231–255): `decoder.decode(chunks[i])` is fire-and-forget; the function then `await`s only when `outputQueue.length >= DECODE_AHEAD_CAP`. The tick’s `await` is `frameAt` → `cursor.gen.next()` (`exportWorker.ts` 364–392), which waits if the generator’s `outputQueue` is empty.

So the user’s “frame requests block synchronously on `VideoDecoder.decode()`” is **almost** right about the *symptom* (the tick cannot GL until a `VideoFrame` is in hand) and **wrong** about the *call*. Decode is already asynchronous relative to GL **once the cursor is open and the ahead queue is warm**.

#### What is already a lookahead ring-buffer

`sequentialDecode.ts` 37–43 and 220–238:

- `DECODE_AHEAD_CAP = 8` undelivered `VideoFrame`s.
- Feed loop pauses at the cap and resumes when the consumer `yield`s (which `signalChange()`s).
- That **is** a 5–10 frame decode-ahead ring, already sized at 8.

While the consumer is inside `renderFrame` / `encode`, the feed loop can keep filling up to 8. At 19 fps (~52 ms/tick) a hardware decoder that produces a frame in a few milliseconds should keep that queue non-empty **after first open**. Adding another 5–10 frame buffer **on top of** cap=8 is unlikely to be the 19→60 fps lever.

#### What is *not* pipelined (the remaining Option-2 surface)

1. **Cold cursor open is on the tick.** First touch of a segment enters `'demux'`, constructs the generator, and `await frameAt` before any GL (`exportWorker.ts` 486–496). 447 segments ⇒ 447 configure/preroll stalls on the critical path. Demux cache hits skip fetch/parse (`onDemuxTiming` cache-hit zeros) but **not** `VideoDecoder.configure` + keyframe preroll.
2. **Slot A and slot B resolve serially.** A transition tick cannot upload A until A’s `frameAt` resolves, then starts B. The two cursors’ feed loops can run concurrently once both exist, but the **first** B-open is still inside the same tick as A.
3. **No next-segment prefetch.** `DecodeCursorRegistry.releaseStale` closes a cursor the moment `currentTime >= cursorLastNeededSec` (decodeCursorLifetime.ts 67–74). Nothing opens the *upcoming* segment before `deriveSlotPlan` names it. Incoming lookahead is documented as “the first-open case, not a reopen” (file header lines 7–8).
4. **Compositor textures are single-buffered.** `uploadFrame` overwrites `texA`/`texB` (`glCompositor.ts` 372–378). You cannot hold decoded N+1 in GPU textures while encoding N without a second pair of slots or keeping extra `VideoFrame`s alive — which collides with the cursor-close protocol (`frameAt` owns `current`/`pending` and closes superseded frames).

A useful Option-2 design is therefore **not** “raise DECODE_AHEAD_CAP from 8 to 10”. It is:

- Prefetch-open the next segment’s cursor **before** the playhead enters its incoming transition half-window, while still never exceeding `MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS = 2` (open next only after releasing the segment-before-last, or only during the two-slot transition when the cap is already 2).
- Optionally overlap `resolveSlotSource` A and B with `Promise.all` on ticks where `plan.b` is set (both cursors already open).
- Do **not** hold 5–10 extra composited canvases; encode backpressure is already `BACKPRESSURE_HIGH_WATER = 4` (`exportWorker.ts` 564–566).

#### Blockers

- **Cursor-cap invariant.** WS3 closed a decode-cursor leak at `peakOpenCursors: 2`. A prefetch that opens cursor 3, even briefly, reopens that class of bug. Any lookahead must be proven against `probeFrameLoopCursorPeak` (`exportWorker.ts` 1070–1100) and the existing `decodeCursorLifetime` tests.
- **Diminishing returns vs 19 fps.** If the 52 ms is dominated by `VideoFrame(canvas)` + encode + IPC, warmer decode queues buy ~0–15%. If it is dominated by per-segment configure stalls, prefetch buys more, but still not 2× — 447 × 50 ms opens would be ~22 s, not 37 minutes.

**Implementation complexity:** Medium. **Stability risk:** Medium (exactly the liveness surface WS3 just closed). **Expected speedup alone:** modest.

---

### Option 3 — WebGL2 → WebGPU Upgrade for the Compositor

**Verdict: PARTIALLY FEASIBLE** (technically on newest OS) **and a poor speed bet for this export**

#### Current shader/canvas pipeline (what would be rewritten)

| Layer | File | Role |
|---|---|---|
| Offscreen GL | `exportWorker.ts` 867–877; `glContext.ts` `acquireOffscreenGlContext` 154–174 | `new OffscreenCanvas(w,h)` + `getContext('webgl2', { desynchronized: true })`. Context loss is a **hard fail** (no `preventDefault`, no restore). |
| Compositor | `glCompositor.ts` | Two content textures; up to three RGBA8 FBOs at frame size; six GLSL ES 3.0 programs (blit, cross-dissolve, dip, light-leak, zoom, grade). `uploadFrame` is a single `texImage2D(..., VideoFrame\|ImageBitmap\|HTMLImageElement)`. `renderFrame` is a **synchronous multi-pass** chain (single-slot skip path vs full transition prep+blend+grade, lines 520–602). |
| Shaders | `gl/shaders.ts` | `#version 300 es`, flipped vs straight vertex shaders (flip-parity is a known landmine; Bug 2). |
| Uniforms | `gl/compositeParams.ts` | Stays. CPU-side; engine-agnostic. |
| Text | `textRenderer.ts` | Canvas2D atlas on `OffscreenCanvas` + GL textured quad **after** grade. Atlas path can stay 2D; the blit-to-frame must move. |
| Routing predicate | `glCompositable.ts` | **Not** a shader file. Unchanged by a GPU-API swap. |
| Preview | `useGlPreview.ts` | Same `GlCompositor`. A worker-only WebGPU path would fork preview vs export unless preview is upgraded too. |

Rewrite surface if export-only: `glContext.ts` (new acquire), `glCompositor.ts` (all of it), `shaders.ts` (all of it → WGSL), `textRenderer.ts` (quad path), `exportWorker.ts` (context + `VideoFrame` capture). That is the entire GPU compositing engine, plus a parity re-verification of every effect the GLSL spike pixel-checked. **Structural overhaul**, even if `compositeParams.ts` / routing / concat stay.

#### OffscreenCanvas + WebGPU + `importExternalTexture` in *this* app’s webviews

Recorded in-tree (`docs/archive/history/history.md` §2 Engine Decision, WebGL2 over WebGPU):

- `navigator.gpu` **is** present and `requestAdapter()` succeeds on macOS 26.x WKWebView (spike data point, §2.3). That **contradicted** earlier third-party claims that WKWebView lacked WebGPU.
- WebGPU’s install-base floor is **macOS 26 / Safari 26**. WebGL2 adds nothing above the existing WebCodecs floor (macOS 13.3). The fleet is 5–10 unmanaged channel machines. A no-fallback WebGPU compositor **bricks** every Mac still on Sequoia/Sonoma/Ventura.
- WebView2 WebGPU default-enablement was **unverified** in that spike (flag-gating history: WebView2Feedback #2233, tauri-apps/tauri #6381).
- The same writeup already dismissed `importExternalTexture` as the reason to switch: WebKit’s WebGL `texImage2D(VideoFrame)` fast path “already provides internally where possible.”

This audit did not re-probe `GPUCanvasContext` on `OffscreenCanvas` inside a dedicated worker, nor `importExternalTexture(VideoFrame)` on WKWebView/WebView2. Those are the two APIs Option 3 actually needs for a worker export. Absence of a worker+OffscreenCanvas+WebGPU spike in this repo is itself a blocker to calling Option 3 FEASIBLE.

Even if both APIs work on macOS 26:

- Zero-copy import removes a `texImage2D` copy the spike already measured as **not** the 19 fps bottleneck (~411 fps dual-upload+blend).
- Encoder input is still `new VideoFrame(canvas)` from an `OffscreenCanvas` (`exportWorker.ts` 782–794). A WebGPU swap must also define a zero-copy (or cheaper) **canvas → VideoEncoder** path or the copy just moves.
- Color-space tagging remains mux-time only (`muxOnly.ts` 60–92); canvas-source `VideoFrameInit` has no `colorSpace`. Unchanged.

#### Product-floor blocker

The standing engine ruling is WebGL2, explicitly because WebGPU raises the OS floor. Option 3 as a **default** export path is blocked for the same reason it lost in 2026-07. Option 3 as a **dev-gated newest-OS experiment** is PARTIALLY FEASIBLE and still a weak speed play.

**Implementation complexity:** Structural overhaul. **Stability risk:** High (pixel-parity, flip-parity, context loss, WebView2 flags). **Expected export-FPS gain:** low (0–30%) unless a later measurement shows `texImage2D`/`VideoFrame(canvas)` dominating the 52 ms — which the 411 fps spike argues against for the upload half.

---

### Option 4 — Direct Native Hardware Pass-Through (Tauri / Rust Layer)

**Verdict: BLOCKED** (as stated: move texture composition + encode into Rust)

#### What the Rust layer actually is

`src-tauri/src/ffmpeg.rs` is an **ffmpeg sidecar session**: temp dir, raw/append file I/O, `ffmpeg_exec` of the bundled binary, AnnexB concat/count, save-to-disk. `src-tauri/Cargo.toml` has **no** `wgpu`, Metal, DirectX, NVENC SDK, or VideoToolbox encode bindings. The only optional native ML dep is `ort` behind `fa-inference`. `lib.rs` modules: fa*, ffmpeg, whisper, model_download, project_mirror — nothing resembling a compositor.

Hardware encode that already happens:

- **In the worker:** Chromium/WebKit `VideoEncoder` with `prefer-hardware` (VideoToolbox on macOS, Media Foundation/NVENC on Windows).
- **In ffmpeg, for other tiers:** sidecar `exec` of whatever the bundled ffmpeg was built with. There is **zero** in-tree use of `-c:v h264_videotoolbox`, `h264_nvenc`, `filter_complex`, or `xfade` (`src-tauri` grep: no matches).

Tier 1 **already is** native pass-through of source video: `encodePlainVideoSegment` + `remuxMp4ToAnnexb` (`-c copy`). Full-effects frames cannot use that path; they exist because the frame is not the source file.

#### Serialization boundary (why “just send textures to Rust” fails)

Current boundary for encoded output (already the cheap direction):

```
Worker VideoEncoder
  → EncodedVideoChunk.copyTo(ArrayBuffer)
  → postMessage(transfer)
  → main thread Uint8Array
  → invoke ffmpeg_append_file_raw (Tauri v2 raw body, not base64)
  → session_dir append
```

That path exists because **compressed annexb** is small. The standing IPC rule (`CLAUDE.md` do-not list): never base64-encode a large binary to cross the bridge (~5–8× heap inflation). Even **raw** IPC of uncompressed 1080p RGBA is `1920×1080×4 ≈ 8.3 MB/frame × 30 fps ≈ 249 MB/s` into the webview bridge — the exact class of failure that made `saveSessionFile` replace a renderer-side MP4 pull (`tauriFfmpeg.ts` 249–256).

To compose in Rust you would need one of:

| Approach | Status in this repo |
|---|---|
| Ship decoded `VideoFrame` pixels over IPC | Blocked by size; violates the large-payload rule in spirit even if raw |
| Ship source file **paths** into ffmpeg `filter_complex` | Assets are IndexedDB blobs with `blob:` URLs, not session-dir files. Would need a new stage-to-session-dir step (whisper/FA already have `*_stage_audio_raw` precedents for audio, not for every video asset) |
| GPU shared memory / IOSurface / DXGI shared handle from WKWebView/WebView2 into Rust | No bindings, no design |
| Reimplement blit/zoom/4 transitions/grade/text in ffmpeg filters | Would not match `GlCompositor` pixel-for-pixel; grade is GL-only today (legacy canvas path already drops it — `exportPipelineWebCodecs.ts` 269–274) |
| Reimplement the compositor in Metal/D3D | New native engine; no code to extend |

`ffmpeg_exec` is also specified as **one child per session at a time** (`ffmpeg.rs` 14–15). A native parallel-encode design would have to lift that.

#### What is *not* blocked

Keeping composition in the worker and using Rust only for concat/mux/count/save — **already shipped**. Option 4’s remaining value is a **new product** (native compositor + native encoder), not a patch to `ffmpeg.rs`.

**Implementation complexity:** Structural overhaul. **Stability risk:** Critical (new encoder, new color path, new text path, IPC, session concurrency). **Do not combine with Options 1–3** as an incremental stack; it replaces them.

---

## PART 2 — Valid Combinations and Ranking

### 2.1 Conflict rules

| Pair | Conflict? | Why |
|---|---|---|
| Opt1 × Opt2 | No | Each parallel worker can prefetch within the 2-cursor cap |
| Opt1 × Opt3 | No in theory | N WebGPU workers; **worse** GPU-memory and OS-floor profile |
| Opt2 × Opt3 | No in theory | Lookahead is decode-side; API swap is upload/draw |
| Opt1 × Opt2 × Opt3 | No in theory | Same caveats compounded |
| Opt4 × {1,2,3} | **Yes** | Replaces the worker/GL/WebCodecs encode path. Native parallel chunking would be a *new* Option 1, not a combo |
| Opt1 at N>3 | Invalid | Encoder-session ceiling |

Standalone Option 4 is omitted from the speed ranking because it is **BLOCKED**. Option 3 is included only as a gated/newest-OS variant.

Valid ranked set:

1. Option 1 (N=3) + Option 2
2. Option 1 (N=2) + Option 2
3. Option 1 (N=3)
4. Option 1 (N=2)
5. Option 2 alone
6. Option 1 (N=2) + Option 3 *(newest-OS only)*
7. Option 3 + Option 2 *(newest-OS only)*
8. Option 3 alone *(newest-OS only)*

N=3 vs N=2 is listed separately because the third encoder session is the first one that hits consumer NVENC folklore; treat N=3 as “try, degrade to 2”.

### 2.2 Ranking by estimated export FPS (highest first)

**Estimate method (state this so it cannot be cited as a measurement):**

- Baseline **19 fps** is the user’s stated full-effects number; not re-measured here.
- GL spike **411 fps** ⇒ compositor fill-rate is not the cap ⇒ Option 3’s upload win is small.
- `DECODE_AHEAD_CAP = 8` ⇒ extra decode ring-buffer is small; Option 2’s remaining win is prefetch + A/B overlap.
- Two hardware encoders on one GPU are **not** 2×; use **1.6–1.8×** for N=2, **2.0–2.3×** for N=3 before other limits. If the cap is IPC-serialized `appendFileRaw` on one main thread, N=2 still helps (two files, two invoke streams) but less than encoder-bound 1.7×.
- 23-minute video = 41,400 frames. Wall = `41400 / fps / 60` minutes.
- All non-baseline FPS figures are **rounded estimate bands**, not promises.

---

#### Rank 1 — Option 1 (3 workers) + Option 2 (prefetch)

| Field | Value |
|---|---|
| Estimated render FPS | **38–44 fps** (≈ 2.0–2.3× baseline, plus ~10% prefetch) |
| Time for 23-min video | **≈ 16–18 min** (42,638-frame job ≈ 16–19 min) |
| Implementation complexity | **High** (windowed multi-worker + cursor prefetch under cap=2) |
| Risk to stability / memory cap | **High** — 3× `VideoEncoder` sessions (NVENC cliff), 3× demux caches, 3× OffscreenCanvas GL, watchdog/cancel fan-out. Prefetch must not raise `peakOpenCursors` above 2 **per worker**. |

Highest estimated throughput among options that do not replace the engine. First implementation should still **ship N=2 and probe N=3**, not start at 3.

---

#### Rank 2 — Option 1 (2 workers) + Option 2 (prefetch)

| Field | Value |
|---|---|
| Estimated render FPS | **32–38 fps** (≈ 1.6–1.8× × ~1.1) |
| Time for 23-min video | **≈ 18–22 min** |
| Implementation complexity | **High** |
| Risk to stability / memory cap | **Medium–High** — 2 encoder sessions is the safe NVENC/VideoToolbox default; 2× demux RAM still matters on 447 unique assets. Same concat guard. |

Best **risk-adjusted** speed play. This is the combination to design first if WS3 moves from audit to implementation.

---

#### Rank 3 — Option 1 (3 workers) alone

| Field | Value |
|---|---|
| Estimated render FPS | **36–42 fps** |
| Time for 23-min video | **≈ 16–19 min** |
| Implementation complexity | **High** |
| Risk to stability / memory cap | **High** — same session/memory profile as Rank 1 without prefetch’s extra cursor-state machine. Slightly less logic risk than Rank 1, worse hardware-session risk than Rank 2. |

---

#### Rank 4 — Option 1 (2 workers) alone

| Field | Value |
|---|---|
| Estimated render FPS | **30–34 fps** |
| Time for 23-min video | **≈ 20–23 min** |
| Implementation complexity | **High** |
| Risk to stability / memory cap | **Medium–High** — concat is proven; concurrency, time-window splits, and dual GL contexts are not. |

Still the largest single-option jump. Does not require touching `decodeCursorLifetime.ts`.

---

#### Rank 5 — Option 2 alone

| Field | Value |
|---|---|
| Estimated render FPS | **21–24 fps** |
| Time for 23-min video | **≈ 29–33 min** |
| Implementation complexity | **Medium** |
| Risk to stability / memory cap | **Medium** — directly adjacent to the WS3 cursor-leak / silent-gap surface. Cap=8 decode-ahead already exists; over-building a second ring-buffer wastes GPU `VideoFrame`s for little FPS. |

Worth doing as a **prerequisite hygiene** pass (prefetch next cursor, `Promise.all` A/B) even if Option 1 ships later. Not worth doing as a 5–10 frame composited-frame ring.

---

#### Rank 6 — Option 1 (N=2) + Option 3 (WebGPU workers, newest OS only)

| Field | Value |
|---|---|
| Estimated render FPS | **32–40 fps** (Option 1 dominates; WebGPU ±0–15%) |
| Time for 23-min video | **≈ 17–22 min** |
| Implementation complexity | **Structural overhaul + High** |
| Risk to stability / memory cap | **High** — OS floor, WebView2 unknown, 2× WebGPU devices, pixel-parity. Unlikely to beat Rank 2 on the same hardware. |

Do not take this path for speed. Only if a later measurement shows `texImage2D`/`VideoFrame(canvas)` as the 52 ms majority **and** the fleet is macOS 26+ / WebGPU-on-WebView2.

---

#### Rank 7 — Option 3 + Option 2 (newest OS only)

| Field | Value |
|---|---|
| Estimated render FPS | **22–28 fps** |
| Time for 23-min video | **≈ 25–31 min** |
| Implementation complexity | **Structural overhaul** |
| Risk to stability / memory cap | **High** (parity + floor) with Medium cursor risk |

---

#### Rank 8 — Option 3 alone (newest OS only)

| Field | Value |
|---|---|
| Estimated render FPS | **19–25 fps** |
| Time for 23-min video | **≈ 28–36 min** |
| Implementation complexity | **Structural overhaul** |
| Risk to stability / memory cap | **High**; **install-base blocker** for default-on |

---

### 2.3 Explicitly not ranked as a speed option

**Option 4 (native composition + NVENC/VideoToolbox in Rust)** — BLOCKED. Theoretical ceiling if it existed would sit above Rank 1 (native encoder + no per-frame JS/IPC of pixels), but there is no compositor, no GPU API, and no legal pixel IPC path to extend. Tier-1 file pass-through already ships and does not apply to full-effects.

---

## 3. Recommended reading of the ranking

If the goal is **highest FPS that this codebase can actually grow into**:

1. **Design Option 1 at N=2** (time-window split of the single GL run, two workers, existing AnnexB concat + frame-count guard). Treat N=3 as a measured extra, not an architecture.
2. **Fold Option 2 prefetch into those workers** (Rank 2), without raising per-worker cursor peak above 2 and without a second decode ring-buffer.
3. **Do not** start a WebGPU compositor for export speed (Option 3). The in-tree engine ruling and the 411 fps GL spike both argue it will not move the 19 fps needle enough to justify the floor and rewrite.
4. **Do not** move composition into Rust (Option 4). Keep Rust on concat/mux/append, where it already is.

A measurement that would change this: a phase-attributed 42k-frame run showing `phaseMs` dominated by `texImage2D` / canvas capture rather than encode/IPC. That instrumentation exists (`ExportPhaseTracker`) but was not run in this audit.

---

## 4. File index (primary citations)

| Concern | Path |
|---|---|
| Sequential GL worker loop | `src/services/webcodecsExport/exportWorker.ts` |
| Single-worker orchestrator, piece loop, concat guard | `src/services/webcodecsExport/exportPipelineWebCodecs.ts` |
| Decode-ahead cap = 8 | `src/services/webcodecsExport/sequentialDecode.ts` |
| Cursor peak = 2 | `src/services/webcodecsExport/decodeCursorLifetime.ts` |
| GL compositable routing (not shaders) | `src/services/webcodecsExport/glCompositable.ts` |
| WebGL2 compositor + `texImage2D` | `src/services/gl/glCompositor.ts` |
| Offscreen WebGL2 acquire | `src/services/gl/glContext.ts` |
| GLSL sources | `src/services/gl/shaders.ts` |
| Text atlas + GL quad | `src/services/webcodecsExport/textRenderer.ts` |
| AnnexB concat / count / append | `src-tauri/src/ffmpeg.rs`, `src/services/tauriFfmpeg.ts` |
| Mux `-r` / two-step audio | `src/services/webcodecsExport/muxOnly.ts` |
| Per-worker demux cache | `src/services/videoDemuxer.ts` |
| WebGL2-over-WebGPU ruling + 411 fps spike | `docs/archive/history/history.md` (engine-decision section) |
| Export liveness / cursor cap history | `docs/work-in-progress.md` WS3; `docs/archive/history/history-2.md` |
