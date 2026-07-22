# WebCodecs + WebGL2 Worker Export — Architecture Plan (reviewed)

> **Working doc — delete after implementation complete (Step 9).**
>
> Status: reviewed against the codebase 2026-07-21 (every load-bearing claim
> verified by reading source; corrections applied — see "Adjustments from
> review" at the end). Step 0 (WKWebView measurement gate) PASSED on macOS
> Intel x86_64.
>
> **Update, 2026-07-22 — Steps 1-8 of the 9-step Implementation Order (§13)
> below are now DONE and verified on macOS Intel x86_64.** This document
> remains the live architecture reference — it is intentionally NOT rewritten
> into past tense, and stays in the repo (per the note above) until Step 9
> (production-build verification, `tauri build`) closes it out. The as-built
> record of what Steps 1-8 actually did, found, and verified — including any
> point where the shipped code diverged from this plan — lives separately in
> `docs/history.md` → *WebCodecs + WebGL2 Worker Export — Implementation
> Record*. See also `CLAUDE.md`'s Export Pipeline section and
> `project-state.md`'s Active Tasks for current status. Cross-platform
> verification (macOS arm64, Windows/WebView2) and Step 9 itself remain open —
> §12/§14 below are still accurate on that point.
>
> Goal: fastest-possible export with **no output regression versus the legacy
> export** for any effect the app renders today, via a permanent architecture
> that puts preview and export on one compositing path for everything the GL
> engine implements, and routes everything else through the proven legacy
> canvas encoder.

---

## 1. Architecture Overview

```
MAIN THREAD                          WORKER (OffscreenCanvas + WebGL2)
===========                          ======
useExport.ts
  │
  ├─ capability + toggle gate
  │   (isWebCodecsSupported && isWebGL2Supported && module-worker probe
  │    && user toggle)
  │
  ├─ Segment ROUTING (pure predicates, decided up front):
  │    Tier 1  plainSegment.ts predicates      → ffmpeg-direct (existing code)
  │    Tier GL isGlCompositableSegment (NEW)   → worker pipeline below
  │    Tier C  everything else                 → legacy canvas encoder
  │                                              (encodeSegment, UNCHANGED)
  │    Runs are split ONLY at boundaries where no transition crosses
  │    (resolved duration 0), so no transition window ever spans two
  │    pipelines.
  │
  ├─ new ExportWorker()  (only for the GL-compositable runs)
  │   postMessage({type:'init', project config, asset blob URLs, options})
  │                                    ┌─────────────────────────────────────┐
  │                                    │  exportWorker.ts                    │
  │                                    │                                     │
  │                                    │  for each frame at absolute index N:│
  │                                    │    1. DECODE                        │
  │                                    │       video: sequentialDecode()     │
  │                                    │             → VideoFrame            │
  │                                    │       image: createImageBitmap()    │
  │                                    │             → ImageBitmap (cached)  │
  │                                    │                                     │
  │                                    │    2. COMPOSITE (GlCompositor —     │
  │                                    │       the real production class)    │
  │                                    │       deriveSlotPlan +              │
  │                                    │       deriveCompositeParams         │
  │                                    │       uploadFrame slot A (+B) with  │
  │                                    │         computeObjectCoverUvRect    │
  │                                    │       renderFrame (blend/zoom/grade)│
  │                                    │       TEXT PASS (GL text renderer — │
  │                                    │         atlas quads, static text,   │
  │                                    │         parity with legacy export)  │
  │                                    │                                     │
  │                                    │    3. ENCODE                        │
  │                                    │       backpressure: await 'dequeue' │
  │                                    │         while encodeQueueSize > 4   │
  │                                    │       new VideoFrame(glCanvas, {    │
  │                                    │         timestamp:                  │
  │                                    │           Math.round(N*1e6/fps) })  │
  │                                    │       encoder.encode(frame,         │
  │                                    │         {keyFrame: isKey(N)})       │
  │                                    │       frame.close()                 │
  │                                    │                                     │
  │                                    │    4. STREAM (annexb — encoder is   │
  │                                    │       configured avc:{format:       │
  │  ◄─────────────────────────────────│       'annexb'})                    │
  │  postMessage transfers ArrayBuffer │       postMessage({type:'chunk',    │
  │  (zero-copy)                       │         bytes}, [bytes])            │
  │                                    │                                     │
  │  ffmpeg_append_file_raw(path,      │    encoder.flush() at run end       │
  │    bytes) → appends to run_K.h264  │    postMessage({type:'done'})       │
  │                                    └─────────────────────────────────────┘
  │
  ├─ Tier 1 plain segments: encodePlainVideoSegment/encodeStaticImageSegment
  │    (UNCHANGED — still trim+scale+libx264 crf16 MP4), then one cheap remux:
  │    ffmpeg -i seg_N.mp4 -c copy -bsf:v h264_mp4toannexb -f h264 seg_N.h264
  │
  ├─ Tier C canvas-fallback segments: encodeSegment (UNCHANGED → MP4), then
  │    the same -c copy remux to annexb. Output byte-equivalent to today's
  │    video stream for these segments.
  │
  ├─ Concat: ffmpeg concat protocol over the annexb pieces in timeline order
  │    → video_all.h264, then LOUD-FAILURE GUARD: ffmpeg/ffprobe frame count
  │    of video_all.h264 must equal Σ expected frames or export fails with a
  │    typed 'concat' error (never ship silently corrupt output).
  │
  ├─ Mux (one ffmpeg call, audio re-encode only — same flags as today):
  │    ffmpeg -framerate <fps> -i video_all.h264 -i voiceover_audio
  │           -c:v copy -c:a aac -b:a 192k -shortest
  │           -movflags +faststart -y export_final.mp4
  │
  ├─ save_session_file → user's chosen path (REUSED — 2026-07-14 native save)
  │
  └─ teardown (session dir delete)
```

**Where the speedup comes from (per-frame, GL-compositable path):**

| Cost in current pipeline | Cost in new pipeline | Eliminated? |
|---|---|---|
| Canvas2D composite (render) | GL composite (GPU) — same effects, faster | Reduced (GPU vs CPU) |
| PNG encode (off-thread) | VideoFrame wrap (GPU texture, ~0ms) | **Eliminated** |
| Per-frame IPC file write (MB-scale PNG) | EncodedVideoChunk transfer (KB-scale, zero-copy) | **Eliminated** |
| Per-segment libx264 re-encode | VideoEncoder (hardware VideoToolbox) | **Replaced** (HW vs SW) |
| `<video>`-element seek-per-frame decode | Sequential WebCodecs decode | **Replaced** (major win) |
| Concat demuxer (N segments) | One continuous stream per run + concat of runs | Reduced |
| ffmpeg mux (audio re-encode) | ffmpeg mux (audio re-encode) | Unchanged |

Tier 1 and Tier C segments run at exactly today's speed (plus one negligible
`-c copy` remux each). The speedup applies to the composited segments that are
GL-expressible — which is every effect selectable in today's UI dropdowns
(4 transitions, 2 zooms, grade, captions/overlays/headings). Segments carrying
legacy/hidden effects (filters, clip-effect slugs, legacy animation enums,
legacy transition enums) keep today's speed AND today's exact output.

---

## 2. What's Reused (Proven Code, Unchanged)

All claims below were verified against source during review.

| File | Role | Verification |
|---|---|---|
| `src/services/gl/glCompositor.ts` | GL compositor (4 transitions, per-slot zoom, grade) | Constructor takes a raw `WebGL2RenderingContext` (line 257). File header (lines 36–39): "No rAF loop, no async work anywhere in this class… an export loop must be able to drive this identically to a playhead-driven preview loop." `UploadSource = VideoFrame \| ImageBitmap \| HTMLImageElement` (line 91) — the worker uses the first two arms; **no type change needed at all** (the `HTMLImageElement` arm is unused in the worker, which is legal, not an error). Worker-safe as-is. |
| `src/services/gl/compositeParams.ts` | Pure param derivation + slot planning | Imports only `types`, `effectsOptions`, `transitionResolver`, `zoomScale` (lines 23–26). Its own docs (lines 19–20, 336–337) state it was built so "a future sequential export loop can call this per-frame … and get byte-identical parameters to whatever preview showed." Worker-safe as-is. |
| `src/services/gl/shaders.ts` | GLSL sources | Static strings. Unchanged. |
| `src/services/transitionResolver.ts` | Transition + centered-window progress resolution | Pure (imports `types`, `effectsOptions` only). Note: lives in `services/`, not `services/gl/`. |
| `src/services/zoomScale.ts` | Zoom scale math | Pure functions. |
| `src/services/videoDemuxer.ts` | MP4 demuxer | Uses `fetch` + `mp4box` only — both worker-safe. Blob URLs created on the main thread are fetchable from a same-origin dedicated worker. |
| `src/services/videoDecoderPool.ts` | Source of `findChunkRange` (exported, line 190) | The pool class itself is NOT used by export (its windowing/LRU model is preview-shaped); only the exported pure helper is imported. |
| `src/services/headingLayer.ts` | `getActiveHeadingAt` heading lookup | Pure (types-only import). Needed by the GL text renderer for the Path B heading layer. Worker-safe as-is. |
| `src/services/plainSegment.ts` | Tier 1 fast-path predicates | Pure predicates (verified: no I/O, no DOM). Unchanged. |
| `src/services/tauriFfmpeg.ts` (existing methods) | `writeFileRaw`, `saveSessionFile`, `exec`, `kill` | All reused as-is. |
| `src/services/ffmpegBackend.ts` (existing methods) | `saveOutputToDisk`, `cancel` | Reused as-is. |
| `src/services/exportPipeline.ts` | Legacy export pipeline | Preserved as the default path. Unchanged. |
| `src/services/segmentEncoder.ts` | Legacy per-segment encode — ALSO reused by the new path for Tier C canvas-fallback segments | Unchanged. `encodeSegment`/`encodePlainVideoSegment`/`encodeStaticImageSegment` are called with the same signatures; only their MP4 outputs get an extra `-c copy` remux to annexb in the new orchestrator. |
| `src/services/frameRenderer.ts` | Legacy Canvas2D render (Tier C segments + legacy path) | Unchanged. Its text-drawing code is the parity reference for the GL text renderer. |
| `src/services/frameEncodeWorker.ts` | Legacy PNG encode worker | Unchanged. |

**The legacy PNG/ffmpeg export path is fully preserved as the default.** The
new path is additive — a sibling pipeline behind a capability + toggle gate.
If the new path fails on any runtime, the legacy path is still there.

---

## 3. Effects Coverage and Segment Routing (corrected in review)

### 3.1 The coverage reality

The GL engine implements exactly: `cross-dissolve`, `dip-black`, `dip-white`,
`light-leak`, `zoom-in`, `zoom-out`, and per-segment grade
(`compositeParams.ts` GL_TRANSITION_SLUGS, `resolveEffectiveAnimation`).

The legacy export path additionally renders, today, for real segments:

- **Color filters** — `segment.overlayFilter` / `project.globalOverlayFilter`
  via `getFilterStyle` (24 named filters, `constants.ts:94–120`). Still
  user-settable: the Effects tab's global filter + "apply filter to all"
  (`App.tsx:2570`).
- **Clip-effect slugs** — `color-grade`, `gaussian-blur`, `sepia`, `invert`
  (CSS-filter based) and `duotone` (pixel op) via
  `frameRenderer.ts:resolveClipEffectFilter`/`applyDuotone`. Hidden from the
  picker but explicitly kept working: `effectsOptions.ts:61–70` — "fully
  implemented on both paths right now; do not delete them."
- **`ken-burns`** and the legacy `AnimationType` enums implemented in
  `canvasAnimations.ts` (KEN_BURNS, FLOAT, BOUNCE, PULSE, HEARTBEAT, WOBBLE,
  ROTATE, …).
- **Legacy `TransitionType` enums** (FADE, SLIDE, SLIDE_UP, BLUR, WIPE, ZOOM,
  …) via `applyTransitionBlend` — reachable through `segment.transition` or
  `project.globalTransition` (the Settings dropdown still emits enum values;
  `resolveEffectiveTransition`'s legacy branch passes them through).

Routing every segment through GlCompositor would silently drop all of the
above from exports — a silent visual regression versus the legacy path. The
original draft of this plan did not address this. **Corrected as follows.**

### 3.2 `isGlCompositableSegment` — the routing predicate (new pure file)

`src/services/webcodecsExport/glCompositable.ts` — a sibling of
`plainSegment.ts`, same philosophy: *conservative by design; anything not
certain to be GL-expressible routes to the proven canvas path.*

A segment is GL-compositable when ALL of:

- Effective animation resolves to `zoom-in` / `zoom-out` / none
  (`compositeParams.ts:resolveEffectiveAnimation` logic — legacy enums other
  than ZOOM_IN/ZOOM_OUT, `ken-burns`, and the filter/pixel slugs all fail).
- No color filter: `segment.overlayFilter` unset/none AND
  `project.globalOverlayFilter` unset/none.
- No clip-effect filter slug (`color-grade`, `gaussian-blur`, `sepia`,
  `invert`, `duotone`).
- Transitions on BOTH edges resolve (via `resolveEffectiveTransition`) to a
  GL slug, hard-cut, or NONE. A legacy enum transition on either edge fails
  the predicate for both segments sharing that edge.
- Text is NOT a disqualifier — captions, extra overlays, global text layers,
  and headings are all handled by the GL text renderer (§5).
- `playbackSpeed` ≠ 1 is NOT a disqualifier — sequential decode maps source
  time exactly like `toSourceTime` does for preview.

Grade never disqualifies (GL-native). Note the known pre-existing divergence:
preview already shows a hard cut for legacy enum transitions while legacy
export renders the canvas blend — this routing preserves the *export*
behavior for those segments, which is the non-regression contract.

### 3.3 Run splitting

The timeline is partitioned into maximal contiguous **runs** of same-tier
segments, splitting only at boundaries whose resolved transition duration is
0 (a hard cut). Because `plainSegment.ts` already requires zero transitions on
both edges, and `isGlCompositableSegment` requires a *GL* transition or none,
the only cross-tier boundaries possible are zero-duration ones — a concat at
such a boundary is exactly a hard cut, which is what the timeline specifies.
Each run becomes one annexb piece:

- GL run → the worker encodes it as one continuous VideoEncoder stream
  (`run_K.h264`, streamed via `appendFileRaw`).
- Plain segment → existing fast-path MP4 + `-c copy` annexb remux.
- Canvas run → existing `encodeSegment` MP4(s) + `-c copy` annexb remux.

This is a permanent design, not a stopgap: as GL passes are added (the
"Filters tab" TODO in `effectsOptions.ts` is the natural next one), the
predicate widens and Tier C shrinks — with zero orchestration changes.

---

## 4. What's New (Permanent Files)

### 4.1 `src/services/webcodecsExport/exportWorker.ts`

Module worker entry point (`new Worker(new URL('./exportWorker.ts',
import.meta.url), { type: 'module' })`). Owns the per-frame loop for GL runs:
decode → composite → text → encode → stream.

- Receives `init` with: segments (the GL runs), the `ProjectEffectConfig`
  (globalTransition, globalTransitionDuration, project grade fallback), the
  text/global config (see §8 for the exact field list), asset blob URLs,
  export options (width, height, fps, codec, bitrate/quantizer).
- Creates `OffscreenCanvas(width, height)` + WebGL2 context via the new
  `acquireOffscreenGlContext` (§6, glContext.ts addition). Constructs the
  real `GlCompositor`.
- Per tick: `deriveCompositeParams` + `deriveSlotPlan`
  (compositeParams.ts, unmodified) → source each slot (video via
  `sequentialDecode`, image via cached `createImageBitmap`) → `uploadFrame`
  with `computeObjectCoverUvRect` (§4.5 — **cover**, matching legacy export's
  `drawImageCover`, NOT preview's contain) → `renderFrame` → GL text pass.
- `VideoEncoder` config: `avc: { format: 'annexb' }` (**required** — the
  WebCodecs default is AVCC with out-of-band description; concatenating AVCC
  chunk payloads as a raw `.h264` file produces an undecodable stream),
  explicit profile/level (High, level chosen from res/fps), `framerate: fps`,
  `latencyMode: 'quality'`, hardware-first ladder: `prefer-hardware` →
  `no-preference` → `prefer-software`, each probed via `isConfigSupported`.
- **Backpressure (required for the bounded-memory claim):** before each
  `encode()`, if `encoder.encodeQueueSize > 4`, await a `dequeue` event.
  Without this, GL compositing (fast) outruns the encoder and queues
  unbounded in-flight VideoFrames.
- Timestamps: `Math.round(frameIndex * 1_000_000 / fps)` where `frameIndex`
  is the **absolute frame index across the whole timeline** (see §7.1 — note
  the rounding is applied to the product, not to the per-frame step).
- Frame lifecycle: `frame.close()` immediately after `encode()` returns
  (encode snapshots/refs the frame synchronously per spec); decoded source
  `VideoFrame`s closed by `sequentialDecode`'s consumer contract.
- Chunk callback: `chunk.copyTo(buf)` → `postMessage({type:'chunk', runId,
  bytes: buf}, [buf])` (zero-copy transfer).
- `encoder.flush()` at each run end → `postMessage({type:'run-done'})`; all
  runs done → `{type:'done'}`.
- On `cancel` message: `encoder.reset()` → `encoder.close()` → abort decode →
  `{type:'cancelled'}`.
- Errors (`VideoEncoder` error callback, decode error, GL `contextlost`) →
  `postMessage({type:'error', …})`. Worker OffscreenCanvas context loss is a
  hard fail (typed export error), never a silent restore-and-continue.

Worker import graph (all verified worker-safe): `glCompositor` → 
`compositeParams` → (`types`, `effectsOptions`, `transitionResolver`,
`zoomScale`); `shaders`; `glContext` (new offscreen acquire only);
`sequentialDecode` → (`videoDemuxer`, `findChunkRange` from
`videoDecoderPool`); `textRenderer` → (`headingLayer`, `constants`' pure text
helpers as ported logic); `uvRect` (§4.5). No React, no DOM module in the
graph.

### 4.2 `src/services/webcodecsExport/sequentialDecode.ts`

Sequential-decode helper for straight-through, in-order frame delivery.
Deliberately NOT a retrofit of `videoDecoderPool.ts` (whose windowing / LRU /
protected-set machinery is preview-shaped and ships in production).

- `async function* decodeSegmentFrames(assetUrl, startSec, endSec):
  AsyncGenerator<VideoFrame>` — reuses `getOrCreateDemux` (videoDemuxer) and
  `findChunkRange` (videoDecoderPool export), drives a dedicated
  `VideoDecoder` per segment.
- `flush()` only at true end-of-range (the flush-after-continuation-keyframe
  hazard documented in docs/history.md, 2026-07-05, and in
  `videoDecoderPool.ts`'s feedWindow redesign comment).
- Decoder startup cost per segment ≈ one `configure()` + keyframe-to-target
  preroll — microseconds-to-ms scale, once per segment, negligible against
  seconds of per-segment encode work (and strictly cheaper than today's
  `<video>` seek-per-frame).
- Internal decode-ahead cap (e.g. ≤ 8 undelivered frames) so decode can't
  outrun the consumer — pairs with the encoder backpressure to bound worker
  memory end-to-end.
- Note: `getOrCreateDemux` holds each demuxed asset's full chunk array in
  worker memory for the export's duration (same model the preview demux cache
  uses on the main thread today — encoded size, not decoded).

### 4.3 `src/services/webcodecsExport/textRenderer.ts`

The GL text renderer — permanent, single-renderer text for the worker path.
**Parity reference is `frameRenderer.ts`'s text code, which renders STATIC
text** — the original draft's "text animations become GL transforms (FADE_IN,
SLIDE_IN)" was wrong: `TEXT_ANIMATIONS`/`getMotionProps` are preview-DOM-only;
`drawExtraOverlay` does not animate. The GL renderer therefore renders static
quads, exactly matching legacy export output. (Adding animated export text
later is a feature, not part of this parity-driven work.)

Design — Canvas2D text atlas + GL textured quad:

1. **Atlas building (once per unique text config, cached):** render the text
   block to an `OffscreenCanvas` 2D context using logic ported line-for-line
   from `frameRenderer.ts` — `wrapText` (line 315), the caption pill/refScale
   math (lines 565–603: `refScale = h/1080`, `bodyPx`, 70%-width wrap, padX/Y
   20/12·refScale, radius 24·refScale, position-aware anchor
   `boxX = xPct*(w-boxW)`), `drawExtraOverlay` (line 332, incl. pill bg +
   shadow + textAlign), `drawHeadingLayerOverlay` (line 370, incl. full-frame
   `backgroundColor` fill and 90%-width wrap), `applyTextShadow`/`clearShadow`
   (shadow rendered INTO the atlas). Cache key: full config tuple (text, font
   family/size/weight/style, color, bg, shadow, position type, render size).
   **Bounded LRU** (~50 entries; GL texture + canvas released on eviction) so
   a 500-segment export can't grow the cache unboundedly.
2. **Per-frame rendering:** bind the atlas texture, draw one alpha-blended
   textured quad at the element's position on the GL canvas, after the grade
   pass. Full-frame heading background fills are a solid-color quad drawn
   before the heading text quad.
3. **Element set per frame** (mirrors `renderSegmentFrame` order and
   visibility rules):
   - `segment.extraOverlays` (each an atlas + quad),
   - `project.textLayers` (global layers) — skipping any layer whose
     `hiddenOnSegments` includes the current segment id,
   - body caption — only when `segment.showOverlay && segment.text`, with
     `segment.overlayConfig` falling back per-field to the global
     `overlayConfig`,
   - Path B heading — `getActiveHeadingAt(headings, absoluteTime)`
     (headingLayer.ts, pure), composited last, on top of everything.
4. **Fonts in the worker:** `self.fonts.add(await new FontFace(family,
   url).load())` — confirmed working in the WKWebView worker by Step 0. Font
   family → URL resolution must be established at Step 6 (verify how
   `FONT_FAMILIES` fonts are actually loaded — bundled files vs system vs
   remote CSS — and pass concrete URLs from the main thread; a family the
   worker cannot load falls back exactly like `ensureFont`'s non-fatal catch
   does today).

There is no `hideAllText` flag anywhere in the export config — the original
draft (and a stale CLAUDE.md note) referenced one; `FrameGlobalConfig`
(frameRenderer.ts:8–15) has no such field. Removed from scope.

### 4.4 `src/services/webcodecsExport/exportPipelineWebCodecs.ts`

Main-thread orchestrator — sibling of `exportPipeline.ts`, same contract:
`exportProjectWebCodecs(project, ffmpeg, options, onProgress):
Promise<ExportResult>`; **never throws**; reuses the existing `ExportError` /
`ExportErrorKind` from exportPipeline.ts (which includes `'cancelled'` — the
original draft's kind list omitted it).

- Partition the timeline into runs (§3.3).
- Tier 1 / Tier C runs: call the UNCHANGED `encodePlainVideoSegment` /
  `encodeStaticImageSegment` / `encodeSegment`, `writeFile` the MP4 into the
  session dir (exactly as `exportPipeline.ts` does today), then remux to
  annexb: `ffmpeg -i seg_N.mp4 -c copy -bsf:v h264_mp4toannexb -f h264
  seg_N.h264`. Stream-copy: no re-encode, no quality change, milliseconds per
  segment. (Note: the original draft claimed the plain-video fast path could
  become `-c copy -f h264` with "no re-encode" — wrong: `encodePlainVideoSegment`
  necessarily re-encodes (scale/crop to target W×H, `-r fps` CFR, libx264
  crf16 — segmentEncoder.ts:424–441) and must keep doing so; only the
  container changes, via the remux, with zero source-code changes to the fast
  path.)
- GL runs: drive the worker; on each `chunk` message append to that run's
  `run_K.h264` via `ffmpeg.appendFileRaw` (writes serialized through a simple
  promise queue so append order matches chunk order).
- Concat all annexb pieces in timeline order (ffmpeg concat, `-f h264` in /
  `-c copy` out) → `video_all.h264`.
- **Silent-corruption guard (loud failure):** probe `video_all.h264`
  (`ffmpeg -i` frame count via the existing exec + stderr parse pattern, or
  `-c copy -f null -` packet count) and fail with a typed `'concat'` error if
  the frame count ≠ Σ expected frames. Mixed-encoder concat problems must
  fail the export, never ship.
- Mux-only call (§7.2), return `{ ok: true, outputFile: 'export_final.mp4' }`.
- Watchdog: if the worker posts no `chunk`/`progress` for 30s, terminate and
  return a typed error.
- Progress: per-run frame counts are known up front; worker `progress`
  messages + Tier 1/C completion events feed one frames-weighted percentage
  compatible with `useExport`'s existing stage mapping.

### 4.5 `src/services/gl/uvRect.ts` (extraction — see Modified files)

`computeObjectCoverUvRect` and `computeObjectContainUvRect` currently live in
`src/hooks/useGlPreview.ts` (lines 138, 174) — a React hook module the worker
must not import (it would drag React into the worker bundle). They move
verbatim to `src/services/gl/uvRect.ts`; `useGlPreview.ts` imports them from
there. Pure move, behavior-identical, and it gives the worker the exact same
cover math the GL engine already pixel-verified.

**Export uses COVER** (`computeObjectCoverUvRect`) — matching legacy export's
`drawImageCover`. Preview uses contain (D11). That preview/export fit
divergence is pre-existing, deliberate (CLAUDE.md: "Export is unchanged —
frameRenderer.ts still uses drawImageCover"), and explicitly out of scope
here; the new path must match the *legacy export*, which is the A/B
verification baseline.

---

## 5. GL Text Renderer — Why GL, Not Canvas2D-on-Top

Step 0 measured `drawImage(glCanvas→2dCanvas)` at 8ms median / 10ms p95 per
frame on WKWebView — a per-frame GPU→2D readback tax (~4.8s per 600 frames)
and a permanent hybrid-renderer wart. The GL text pass eliminates the hop:
text shaping/wrapping/metrics stay Canvas2D (in the atlas builder, built once
per text config — proven identical to current export), only the final
per-frame placement is a GL quad. No Canvas2D-on-top fallback exists in this
design, by intent.

Atlas rebuild frequency: a segment's caption/overlay/heading text and styling
are constant across its frames (nothing in the per-frame loop mutates the
config), so each atlas is built once per unique config and reused for every
frame that shows it — never per frame.

What this does NOT change: preview text stays DOM-based; legacy path text
stays Canvas2D via frameRenderer.ts. Both unchanged.

---

## 6. What's Modified (Existing Files, Minimal Touches)

| File | Change | Why | Risk |
|---|---|---|---|
| `src/services/gl/glContext.ts` | **Add** `acquireOffscreenGlContext(canvas: OffscreenCanvas, opts)` — new function; `acquireGlContext` untouched. OffscreenCanvas fires `contextlost`/`contextrestored` (different event names from `webglcontextlost`/`webglcontextrestored`), so a signature-widening of the existing function (the original draft's approach) is wrong — it would wire listeners that never fire. Worker context loss = hard fail. `isWebGL2Supported()` already returns `false` when `typeof document === 'undefined'` (line 30) — no guard change needed; the worker never calls it. | Worker GL acquisition. | **None to preview** — purely additive; the only production caller of `acquireGlContext` is `useGlPreview.ts:290`, untouched. |
| `src/hooks/useGlPreview.ts` | Move `computeObjectCoverUvRect`/`computeObjectContainUvRect` bodies to `src/services/gl/uvRect.ts`; re-export/import from there. | Worker needs the cover math without importing a React module. | **Minimal** — verbatim move; preview behavior identical; its unit tests (if referencing the hook module) update imports. |
| `src/services/gl/glCompositor.ts` | **No change.** (Original draft anticipated a possible `UploadSource` narrowing — unnecessary: passing only `VideoFrame`/`ImageBitmap` to a union that also allows `HTMLImageElement` typechecks fine in a worker.) | — | None. |
| `src/hooks/useExport.ts` | In `runExport`, branch at the `exportProject(...)` call (line 152): when the gate is open, call `exportProjectWebCodecs(...)` instead — same `ExportResult` contract, same downstream save/teardown flow. In `cancelExport` (lines 250–274): post `cancel` to the worker and `worker.terminate()` FIRST, then the existing `backend.cancel()` → `teardown()` sequence (worker ref threaded via the pipeline's returned cancel handle rather than a raw Worker ref in the hook). | Gate + cancel wiring. | **None to legacy** — gate closed ⇒ byte-identical flow to today. |
| `src/services/tauriFfmpeg.ts` | Add `appendFileRaw(path, bytes)` — same raw-body invoke shape as `writeFileRaw` (line 130: raw body, `session-id`/`path` headers), targeting new `ffmpeg_append_file_raw`. | Stream chunks to disk; bounds renderer memory (the 2026-07-14 OOM lesson). | None — new method. |
| `src-tauri/src/ffmpeg.rs` | Add `ffmpeg_append_file_raw`: same header extraction + `validate_path` + `session_dir` as `write_file_raw` (lines 102–124), but `fs::OpenOptions::new().create(true).append(true)`. | Rust side of streaming append. | None — new command. |
| `src-tauri/src/lib.rs` | Register `ffmpeg_append_file_raw` in the invoke_handler. | — | None — one line. |
| `vite.config.ts` | Add `worker: { format: 'es' }` (verified absent today). | Production ESM worker chunks. | None — dev already works (Step 0); build-only. |
| `tsconfig.json` | **No `lib` change.** (Original draft added `"WebWorker"` to the global `lib` — that conflicts with `"DOM"` globals project-wide. Instead: `/// <reference lib="webworker" />` at the top of each worker-scoped file + `declare const self: DedicatedWorkerGlobalScope`.) | Worker types without polluting app-wide type space. | None. |
| `src/components/DropZonePanel.tsx` (Effects tab) | Additive toggle for the new export path (mirrors how WebGL2 shipped dev-gated, then cut over). | Gate control. | None — additive UI. |

**Files explicitly NOT modified:** `exportPipeline.ts`, `segmentEncoder.ts`,
`frameRenderer.ts`, `frameEncodeWorker.ts`, `videoDecoderPool.ts`,
`videoDemuxer.ts`, `compositeParams.ts`, `shaders.ts`, `glCompositor.ts`,
`plainSegment.ts`, `transitionResolver.ts`, `zoomScale.ts`, `headingLayer.ts`,
`capabilities/default.json` (existing `shell:allow-execute` covers all ffmpeg
calls; append is a plain invoke command, no new capability).

---

## 7. Frame Timing, Streaming, and Mux

### 7.1 Timestamps and keyframes

- `timestamp = Math.round(frameIndex * 1_000_000 / fps)` µs, absolute
  timeline index. (NOT `frameIndex × Math.round(1e6/fps)` — at 30fps that
  step-rounds to 33333µs and drifts 10µs/s, ~12ms over 20 min; rounding the
  product keeps every timestamp within 0.5µs of exact, zero cumulative
  drift.) `duration` per frame: `timestamp(N+1) − timestamp(N)`.
- This replaces today's per-segment `Math.round(duration * fps)` frame counts
  (exportPipeline.ts:137–140, segmentEncoder.ts:150) whose independent
  roundings accumulate across a long timeline. Run boundaries are computed in
  absolute frame indices too (a run covers `[firstFrame, lastFrame]` of the
  timeline grid), so concat cannot double- or drop-count frames.
- Keyframes: first frame of every segment + a 2s GOP cap
  (`encode(frame, { keyFrame: true })`, confirmed working by Step 0).
- CFR at the configured fps throughout — matches `VideoEncoder` expectations
  (Step 0: 600 frames @30fps, monotonic, clean).

### 7.2 Streaming and mux

Per chunk: `copyTo` → transfer to main → `appendFileRaw` (serialized queue).
Renderer memory is bounded by a few in-flight chunks (KB–~100KB each); worker
memory is bounded by decode-ahead cap + `encodeQueueSize` backpressure (§4.1,
§4.2). ~30 IPC appends/sec at 30fps — the same call rate as today's per-frame
PNG writes but with payloads ~100× smaller; per-call overhead is already
proven acceptable by the current pipeline. (If profiling ever says otherwise,
coalescing appends to ≥256KB batches in the worker is a two-line change —
noted, not needed.)

Mux (identical flags to today's `exportPipeline.ts:264–274`, plus the input
framerate raw H.264 needs since annexb carries no timing):

```bash
# concat runs (all annexb, in timeline order) → video_all.h264, then verify
# frame count (loud-failure guard, §4.4), then:
ffmpeg -framerate <fps> -i video_all.h264 -i voiceover_audio \
       -c:v copy -c:a aac -b:a 192k -shortest \
       -movflags +faststart -y export_final.mp4
# no-audio case: drop the second input + audio flags, keep -c:v copy +faststart
```

- `-c:a aac` (re-encode), not copy: uploads are arbitrary containers; the
  legacy pipeline already re-encodes. Unchanged.
- `-shortest`: unchanged from today. Video length = timeline duration; the
  sync engine's last segment extends to `audioDuration`, so the two match to
  within a frame, exactly as they do now. No new drift source: video PTS are
  exact by construction (§7.1).
- `save_session_file` native copy + `ffmpeg_destroy_session` teardown: reused
  unchanged.

---

## 8. Config Threading (exact field list, verified)

What the worker/orchestrator must receive — derived from what
`exportPipeline.ts:82–87` + `encodeSegment` options actually consume today:

| Field | Source | Consumer |
|---|---|---|
| `width`, `height`, `fps` | export options (`useExport`: 1080p/4k, 24/30/60) | canvas size, timestamps, encoder config |
| `globalTransition`, `globalTransitionDuration` | project | `ProjectEffectConfig` → compositeParams / routing predicate |
| project-level grade fallback | `ProjectEffectConfig.grade` (currently unset in preview usage — thread as undefined for parity) | compositeParams |
| `globalOverlayConfig` | project | caption per-field fallback (text renderer) |
| `globalOverlayFilter` | project | **routing only** — any value ⇒ segment is Tier C (GL path never renders it) |
| `textLayers` | project | text renderer (with `hiddenOnSegments`) |
| `headings` | project | text renderer via `getActiveHeadingAt(absoluteTime)` |
| per-segment: `effectTransition(+Duration)`, `transition(+Duration)`, `effectAnimation`, `animation`, `effectAnimationScaleRate`, `effectGrade`, `overlayFilter`, `trimStart`, `trimEnd`, `playbackSpeed`, `text`, `showOverlay`, `overlayConfig`, `extraOverlays`, `startTime`, `duration`, `assetId` | segments | routing + compositeParams + decode mapping + text renderer |

Not in scope (verified absent from the export path today): `hideAllText`
(no such field in `FrameGlobalConfig`), `globalAnimation` (never passed to
export), `effectOverlay` (no renderer on any path — `effectsOptions.ts:98`).
Segment `locked` is a re-sync-time concept; export consumes final
`startTime`/`duration` and needs no lock awareness.

---

## 9. Cancel, Errors, Concurrency

### 9.1 Cancel sequence

```
User clicks Cancel (useExport.cancelExport)
  1. generationRef++ (existing — stale callbacks no-op)
  2. pipeline.cancel(): postMessage({type:'cancel'}) → encoder.reset()/close();
     then worker.terminate() (hard stop, in case the worker is wedged)
  3. backend.cancel() → ffmpeg_kill_session (D13 — kills any in-flight
     remux/concat/mux sidecar)
  4. teardown() → ffmpeg_destroy_session (partial run_K.h264 files die with
     the session dir)
```

`VideoEncoder.reset()` is the abort primitive; `flush()` is never called on
cancel. Legacy-path cancel is byte-identical to today when the gate is closed.

### 9.2 Errors

Worker `error` messages, watchdog timeouts, encoder-config failures at
runtime (not just probe time — `isConfigSupported` can pass and `configure`
still fail; both routes map to the same typed error), decode failures, GL
context loss, disk-full on append (the invoke rejects → typed error), and
missing assets (checked up front, same `asset_missing` contract as
exportPipeline.ts:99–104) all resolve to `{ok:false, error}` with the
existing `ExportErrorKind` values. Never throws, never silently continues.

### 9.3 Concurrency

Single export at a time — same as today (the export UI already prevents
re-entry while `isExporting`; `startExport` has no additional guard today and
this work adds none — parity, not regression). The pipeline holds exactly one
worker; `retryExport` reuses the existing snapshot flow and constructs a
fresh worker.

---

## 10. Color Space (deferred, unchanged from today)

The GL compositor renders sRGB, untagged — same as the current canvas path
(sRGB pixels tagged bt709 by libx264 flags without real conversion).
`VideoFrame`/`VideoEncoder` colorSpace tags are set consistently with what
ships today. Real sRGB→bt709 conversion is Phase C scope; the grade shader
stays in normalized RGB so a color-managed variant slots in later. The new
path is exactly as truthful as today's — no worse, deliberately not fixed
here.

---

## 11. Quality Verification

### 11.1 Hardware encoder vs CRF16

Legacy: libx264 crf16 (fast paths) / crf-based canvas encodes. Hardware
encoders differ per platform and are historically weaker at equal bitrate.
Step 8: export one project three ways (legacy, VideoEncoder-hardware,
VideoEncoder-software); frame-extract at 0/25/50/75/100%; compare. If
hardware is materially worse: try `bitrateMode: 'quantizer'` with a low QP
(verify VideoToolbox accepts it); else a high bitrate ceiling; else default
that platform to software. The ladder stays hardware-first because the
quality gate is empirical, per-platform, and enforced before cutover.

### 11.2 Preview/export parity + legacy parity

- GL transitions/zoom/grade: identical to preview by construction (same
  compositor, same params).
- Cover-fit, text, filters-routing: identical to LEGACY EXPORT by
  construction (cover rect; text logic ported from frameRenderer; non-GL
  effects routed to the unchanged canvas encoder). A/B frame-compare against
  legacy export at segment boundaries, transition midpoints, and text-heavy
  frames is the Step 5/6 acceptance test.

---

## 12. Cross-Platform Verification

| Runtime | Step 0 | Cutover requirement |
|---|---|---|
| macOS Intel x86_64 (WKWebView) | ✅ PASSED (worker+GL+VideoFrame+VideoEncoder, 600/600 chunks, clean flush) | verify end-to-end each step |
| macOS arm64 (WKWebView) | ❌ unverified (no hardware) | **blocking** before cutover |
| Windows / WebView2 | ⚠️ Chromium proxy only | **blocking** — verify on real WebView2 |
| Production build (`tauri build`) | dev-only verified | verify ESM worker chunk loads (Step 9) |

The new path stays behind the gate until all three runtimes pass end-to-end.
Legacy remains the default.

---

## 13. Implementation Order

Each step compiles, is independently verifiable, and never modifies the
legacy export path. Highest-risk/most-novel pieces (encoder annexb, mixed
concat) are verified with loud checks the moment they exist.

1. **Sequential decode** — new `sequentialDecode.ts`. Verify: frame count +
   timestamps vs mp4box sample count for a trimmed range; frames arrive in
   presentation order. (Pure new code.)
2. **uvRect extraction + worker composite (no encode, no text)** — new
   `uvRect.ts` (move from useGlPreview) + `exportWorker.ts` skeleton +
   `acquireOffscreenGlContext`. Verify: preview unchanged (manual +
   existing tests); worker composites one segment and transfers a few frames
   out; pixel-check against the Phase 6 GL pixel-proof fixture; cover-fit
   frames match legacy export's `drawImageCover` geometry.
3. **Worker encode + annexb streaming** — `avc:{format:'annexb'}` config,
   backpressure, `appendFileRaw` (TS + Rust + registration). Verify: ffprobe
   confirms a valid annexb H.264 stream, exact frame count, monotonic timing;
   kill/cancel mid-stream leaves no orphaned session files after teardown.
4. **Mux-only** — orchestrator skeleton. Verify: one run + voiceover →
   playable MP4 (QuickTime), A/V sync, duration exact.
5. **Full timeline: routing + runs + concat** — `glCompositable.ts`
   predicate + run splitting + Tier 1/C remuxes + concat + the frame-count
   loud-failure guard + absolute-index timestamps + per-segment keyframes.
   Verify: mixed project (GL + plain + canvas-fallback segments) A/B-matches
   legacy export frame-by-frame at boundaries; concat guard trips when fed a
   deliberately corrupted piece (negative test).
6. **GL text renderer** — atlas + quads + fonts-in-worker + heading layer.
   Verify: captions/extra overlays/global layers/headings pixel-compare
   against legacy export; `hiddenOnSegments` respected; atlas LRU bounded on
   a 500-segment fixture (dev test panel exists, Ctrl/Cmd+Shift+D).
7. **Gate + cancel + progress** — useExport branch, toggle UI, cancel chain,
   frames-weighted progress. Verify: toggle off ⇒ legacy byte-path; cancel
   kills worker + sidecar + session dir; progress monotonic across tiers.
8. **Quality + cross-platform** — §11.1 comparison; macOS arm64 + real
   Windows end-to-end. Decision point: cutover default vs stay gated.
9. **Production build** — `worker:{format:'es'}`; `tauri build` on all
   verified platforms; worker loads and exports in the bundled app.

Silent-corruption analysis: the two places a wrong implementation could
produce output that *plays but is wrong* are (a) AVCC-vs-annexb chunk format
(guarded: Step 3's ffprobe gate, and misformatted streams fail the concat
frame-count guard) and (b) mixed-encoder concat seams (guarded: frame-count
check + Step 5 A/B boundary frame-compare + the §14 fallback). Timestamp bugs
surface as duration mismatch in Step 4's verification. Effects coverage bugs
are prevented structurally by conservative routing (an unknown effect fails
the predicate and takes the proven canvas path).

---

## 14. Risks and Unknowns

| Risk | Status | Mitigation |
|---|---|---|
| VideoEncoder hang on WKWebView | Resolved on Intel macOS (Step 0: 600/600, clean flush, 0 errors) | arm64/Windows still gate cutover |
| Hardware quality < CRF16 | Unmeasured | §11.1 ladder: quantizer mode → bitrate ceiling → software default per platform |
| macOS arm64 unverified | No hardware | Blocking before cutover |
| Windows/WebView2 unverified | Chromium proxy only | Blocking before cutover |
| Concat seams (VideoToolbox + libx264 annexb) | Theoretical | Pin profile/level/res/fps/colors; frame-count guard; **permanent fallback if seams are visible: route Tier 1/C video through VideoEncoder too (decode via sequentialDecode → encode), eliminating mixed encoders at the cost of re-encoding plain segments — a measured decision at Step 5/8, not a silent compromise** |
| AVCC instead of annexb | Designed out | `avc:{format:'annexb'}` + Step 3 ffprobe gate |
| Unbounded memory (long export) | Designed out | chunk streaming + encoder backpressure + decode-ahead cap + atlas LRU |
| Fonts unavailable in worker | API confirmed (Step 0); URL sourcing unverified | Step 6 verifies FONT_FAMILIES → URL mapping; non-fatal fallback identical to `ensureFont` today |
| GL text parity | New code | Step 6 pixel-compare vs legacy |
| Worker chunk emission in `tauri build` | Build unverified | Step 9 |
| Color space | Known, unchanged from today | Phase C |

---

## 15. What This Does NOT Change

- **Legacy export path** — default, byte-identical when the gate is closed;
  `exportPipeline.ts` / `segmentEncoder.ts` / `frameRenderer.ts` /
  `frameEncodeWorker.ts` untouched.
- **Preview** — `useGlPreview.ts` gets only the verbatim uvRect move;
  `PreviewStage.tsx`, `PreviewCanvas.tsx`, `useWebCodecsPreview.ts`,
  `videoDecoderPool.ts` untouched; preview behavior identical.
- **Export output semantics** — same MP4 (H.264+AAC), same `export_final.mp4`
  → `save_session_file` flow, same effect rendering for every segment (GL
  segments match preview+legacy; non-GL segments match legacy exactly).
- **Sync engine, timeline/editing, persistence, Tauri capabilities** — all
  untouched.

---

## 16. Honest Speed Expectation

The floor is the per-frame GL composite (strictly faster than the Canvas2D
composite it replaces). The realistic win is everything after the composite:
PNG encode eliminated; MB-scale per-frame IPC replaced by KB-scale zero-copy
chunks; per-segment libx264 software encode replaced by in-process hardware
encode; `<video>` seek-per-frame decode replaced by sequential WebCodecs
decode. Step 0 measured 65fps hardware encode submit rate on WKWebView.
Tier 1/C segments run at today's speed. The end-to-end number comes from
Step 5 measurement, not prediction — but the dominant cost of a composited
export shifts from "software-encode every frame + write every frame over IPC"
to "hardware-encode every frame in-process."

---

## 17. Adjustments from Review (2026-07-21)

Everything below was changed from the pre-review draft, with the evidence:

1. **Effects coverage / routing tier added (§3) — the material correction.**
   The draft routed all composited segments through GlCompositor, which
   implements only 4 transitions + 2 zooms + grade. Verified still-rendered
   export effects it would have silently dropped: `overlayFilter` /
   `globalOverlayFilter` (24 filters, still user-settable — App.tsx:2570),
   clip-effect slugs incl. duotone (effectsOptions.ts:61–70 "fully
   implemented … do not delete"), ken-burns + legacy AnimationType enums
   (canvasAnimations.ts), legacy TransitionType enums (applyTransitionBlend).
   Fix: `isGlCompositableSegment` predicate + run splitting; non-GL segments
   go through the unchanged legacy canvas encoder + `-c copy` annexb remux.
   Conservative-predicate architecture identical to the shipped Tier 1 design
   — permanent, and it widens as GL passes land.
2. **`hideAllText` removed; config list corrected (§8).** `FrameGlobalConfig`
   (frameRenderer.ts:8–15) has no `hideAllText`; the real fields are
   `overlayConfig`, `globalOverlayFilter`, `globalTextLayers`, `headings`.
   The draft also omitted `globalTextLayers`/`hiddenOnSegments` from the text
   scope — added. `globalAnimation` confirmed not part of export.
3. **Text animations removed from the GL text renderer (§4.3).** Export text
   is static today (`drawExtraOverlay` has no animation; TEXT_ANIMATIONS is
   preview-DOM-only). The draft's "FADE_IN/SLIDE_IN as GL transforms"
   described a feature legacy export doesn't have; parity means static.
4. **Plain-segment `-c copy` claim corrected (§4.4).**
   `encodePlainVideoSegment` re-encodes by necessity (scale/crop/CFR,
   segmentEncoder.ts:424–441). Fast paths stay byte-identical; a stream-copy
   remux to annexb replaces the draft's incorrect direct-`-c copy` plan.
5. **Cover-vs-contain decision made explicit (§4.5).** Preview is contain
   (D11); legacy export is cover. New path: cover, matching legacy export.
   UV-rect helpers extracted from `useGlPreview.ts` to `services/gl/uvRect.ts`
   because a worker cannot import a React hook module.
6. **glContext change redesigned (§6).** OffscreenCanvas uses
   `contextlost`/`contextrestored` event names, so widening
   `acquireGlContext`'s signature (the draft) would wire dead listeners. New
   additive `acquireOffscreenGlContext` instead; existing function untouched.
7. **`avc: { format: 'annexb' }` made explicit (§4.1).** WebCodecs defaults
   to AVCC; cat'ing AVCC payloads as `.h264` is undecodable. The draft never
   specified the format.
8. **Timestamp formula fixed (§7.1).** Draft's `frameIndex ×
   Math.round(1e6/fps)` drifts 10µs/s at 30fps; use
   `Math.round(frameIndex·1e6/fps)`.
9. **Encoder backpressure added (§4.1)** (`encodeQueueSize`/`dequeue`) and a
   decode-ahead cap (§4.2) — without them the bounded-memory claim was
   unsound. Atlas cache made a bounded LRU (§4.3).
10. **Concat frame-count loud-failure guard added (§4.4)** — mixed-encoder
    concat was the plan's main silent-corruption candidate.
11. **tsconfig approach changed (§6).** Global `lib: ["WebWorker"]` conflicts
    with `"DOM"`; per-file `/// <reference lib="webworker" />` instead.
12. **Smaller factual fixes:** `transitionResolver.ts` lives in `services/`
    not `services/gl/` and contains no localStorage reference;
    `ExportErrorKind` includes `'cancelled'` (exportPipeline.ts:27); the
    worker imports `findChunkRange` from videoDecoderPool (not the pool
    class); `glCompositor.ts` needs no modification at all; segment `locked`
    is sync-time-only and needs no export handling; `-shortest`/audio
    behavior confirmed unchanged (exportPipeline.ts:264–274).

**Design decisions reviewed (user's four):**
- **D2 GL text:** confirmed (with the static-text parity correction). The
  8ms/frame readback alternative is both slower and a permanent hybrid wart.
- **H1/H2 hardware-first ladder:** confirmed. Quality is enforced empirically
  per platform at Step 8 with quantizer/bitrate/software fallbacks; defaulting
  to software everywhere would forfeit the primary speedup on platforms where
  hardware quality is fine.
- **J1b mixed pipelines + concat:** confirmed in shape, extended (Tier C) and
  corrected (remux instead of `-c copy` fast path). The all-VideoEncoder
  alternative is documented as the standing fallback if seams appear —
  a measured decision, not a silent one.
- **F1 per-chunk streaming append:** confirmed. Same IPC call rate as today's
  per-frame PNG writes with ~100× smaller payloads; batching noted as an
  available knob, not needed.
