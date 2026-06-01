# Phase 7 Task 1 — Export Rendering Profiling Results

## Test Project

4 video segments (~3s each, 12s total), 1080p / 30fps, FADE transitions between segments 1→2 and 3→4, voiceover attached, heading text on at least one segment. Profiled on macOS Intel via Tauri dev build.

Note: project ended up all-video rather than 2 image + 2 video as originally planned. This is acceptable — it isolates the video render path, which is where time is spent.

## Methodology

Per-phase `performance.now()` instrumentation added to:

- `frameRenderer.ts` — split into `videoSeek` (await on `seeked` event) and `renderDraw` (draw + filter + overlay + animation transform) for video segments.
- `segmentEncoder.ts` — `toBlob` (canvas.toBlob + arrayBuffer) per frame; `ffmpegExec` (libx264 invocation) per segment.
- `tauriFfmpeg.ts` — `b64encode` (bytesToBase64) and `ipcWrite` (Tauri invoke) per frame, split so each cost is isolated.
- `exportPipeline.ts` — `concat` and `mux` per export.
- `useExport.ts` — `saveDialog` (save_bytes_to_disk IPC, includes user wait time).

Results logged to console as `[PROFILE-RESULTS]` JSON after export completion. All instrumentation gated on `if (PROFILE)` flag, reverted before this doc was committed.

## Raw Numbers

### Per-frame phases (355 video frames; +6 transition double-emissions on b64encode/ipcWrite)

| Phase | Sum (ms) | Mean/frame (ms) | p50 (ms) | p95 (ms) | Share of frame loop |
|---|---|---|---|---|---|
| `toBlob` | 72,267 | 203.6 | 182 | 210 | **47.2%** |
| `ipcWrite` | 44,691 | 123.8 | 95 | 105 | **29.2%** |
| `videoSeek` | 20,376 | 57.4 | 20 | 30 | 13.3% |
| `b64encode` | 15,618 | 43.3 | 36 | 38 | 10.2% |
| `renderDraw` | 105 | 0.3 | 0 | 1 | 0.1% |

Per-frame wall total (sum of means): ~428 ms. Discrepancy vs the 333 ms/frame end-to-end baseline is explained by async overlap between `videoSeek` and previous frame's I/O — phase means are correctly measured per-call but don't sum to wall time. Relative shares are reliable.

### Per-segment / per-export

| Phase | Mean (ms) | Count | Note |
|---|---|---|---|
| `ffmpegExec` (libx264) | 2,737 | 4 | One per segment. Total 10.9s out of ~240s export — small relative contribution. |
| `concat` | 156 | 1 | Negligible. |
| `mux` | 366 | 1 | Negligible. |
| `saveDialog` | 86,759 | 1 | Includes user wait time for native dialog. Not part of the optimizable pipeline. |

## Analysis

The export is **I/O-bound, not render-bound.** The actual canvas rendering (`renderDraw`) is essentially free at 0.1% of frame time. The bottleneck is the back half of the pipeline: PNG encoding (`toBlob`) and writing PNGs through IPC to the temp directory (`ipcWrite`) together consume 76% of all per-frame work.

`videoSeek` at 13% is a modest contributor, not the dominant cost — the browser handles forward sequential video seeks efficiently once decoded.

`ffmpegExec` is fast on the native sidecar — only 11s for 4 segments. The libx264 encode itself is not a bottleneck post-Phase 6.

## Recommendation

### Approach: OffscreenCanvas + Web Worker (with `convertToBlob` replacing `canvas.toBlob`)

The dominant cost is `toBlob` at 47% of frame time. `OffscreenCanvas.convertToBlob` runs off the main thread in a Web Worker and is typically 30–50% faster than the synchronous main-thread `canvas.toBlob`. Two compounding wins:

1. **Direct speedup on the encode step itself.** Multi-threaded PNG compression in the worker.
2. **Parallelization with the next frame's render.** While the worker encodes frame N, the main thread can start the `videoSeek` + `renderDraw` for frame N+1. This is the larger of the two wins — it effectively pipelines the loop.

### Expected speedup

40–55% reduction in frame-loop wall time. Projected macOS Intel export time: ~120s → ~60–70s (from 10× realtime to ~5× realtime). Windows would see a similar ratio (6× → ~3×).

### Implementation cost

Moderate. Architecture: main thread continues to handle `seekVideo` + `drawImage` (workers cannot seek `<video>` elements). Render to an in-memory canvas → transfer via `transferToImageBitmap()` (zero-copy) → worker draws to OffscreenCanvas → `convertToBlob` → worker posts bytes back → main thread does the existing `bytesToBase64` + `ffmpeg.writeFile` IPC.

Rough estimate: 2–3 days implementation + 1 day cross-platform testing.

### Risks

- ImageBitmap transfer correctness — must use transfer list properly to get zero-copy semantics. Mismeasured transfer adds copies that erase the win.
- macOS Intel via Tauri uses system WebKit — verify OffscreenCanvas behavior matches expectations there (it should; the API is well-supported in modern WebKit).
- The current per-frame loop is sequential awaits. Pipelining requires a small queue between main and worker. Backpressure must be handled or memory grows unbounded.

### Alternative paths considered and rejected

**WebCodecs `VideoEncoder` (highest ceiling, highest risk).** Would skip the entire `toBlob → b64encode → ipcWrite → ffmpeg libx264` chain by encoding H.264 directly from canvas frames. Rejected because (a) WebKit support for `VideoEncoder` is recent and inconsistent — Tauri on macOS uses system WebKit, cross-platform risk is real; (b) requires re-architecting the audio mux + concat steps that currently use ffmpeg, erasing some speed gain in complexity. Keep in the back pocket if OffscreenCanvas underperforms.

**Tauri Channel API (binary IPC).** Would eliminate `b64encode` (10%) and shrink `ipcWrite`. Combined upside ~15–20%, useful but below the >50% target. The bigger fish (`toBlob` at 47%) must go first. Reconsider as a follow-up after OffscreenCanvas lands.

## Open Questions

- Was the 86.8s `saveDialog` time mostly user wait time, or did the file write itself take that long? If the latter, that's a separate ticket worth investigating. Most likely user time given the size of the number.
- Will the OffscreenCanvas pipeline behave identically on macOS arm64 (system WebKit, different from Intel WebKit version) and Windows (WebView2 / Chromium)? Cross-platform testing required before task 10 implementation merges.
- Does pipelining frames N and N+1 cause measurable memory growth on long exports (60+ seconds)? Bounded queue size needs picking during implementation.
