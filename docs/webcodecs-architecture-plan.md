# WebCodecs Architecture Shift — Phased Migration Plan

**Status:** Planning only. No implementation has started. This document is the deliverable of a planning task; Phase 0 (spike) begins in a follow-up session after this plan is reviewed.

**Branch:** `webcodecs-api` (off `main` @ `d8cc5db`). `main` is not touched until this effort is reviewed and merged.

**Scope:** Preview playback only (`PreviewStage.tsx` and the hooks that feed it). The export pipeline (`frameRenderer.ts`, `segmentEncoder.ts`, `exportPipeline.ts`, `plainSegment.ts`, the native ffmpeg sidecar) is out of scope and must not be modified or behaviorally affected by any phase of this work.

**Origin of this effort:** `docs/bugs/preview-cold-start-clock-freeze.md` — a confirmed, root-caused bug where a `<video>` element that has never played will not reliably start its media clock on `.play()` inside the Tauri webview, even at `readyState=4`. Every patch attempted at the `<video>`-element layer either failed or traded the freeze for a different regression (see that doc's "Fixes Attempted" log). This plan treats that bug as unfixable at the `<video>`-element layer and replaces the layer instead of patching it further.

---

## 1. Feasibility Confirmation

### 1.1 Correcting a load-bearing assumption: Tauri's webview is *not* uniformly Chromium

The task that produced this plan, and the existing bug report, both describe the environment as "Tauri webview (Chromium-based)." **This is only true on Windows.** Tauri v2 (via its `wry` webview abstraction) uses the *platform-native* webview, not a bundled Chromium, on every OS except Windows:

| Platform | Webview engine | Update model |
|---|---|---|
| Windows | WebView2 (Chromium/Edge) | Evergreen — auto-updates with the OS, always near-latest Chromium |
| macOS (Intel + arm64) | **WKWebView (WebKit/Safari engine)** | Tied to the installed macOS version — does *not* auto-update independently |
| Linux | WebKitGTK | Tied to distro package version (not a current build target per `src-tauri/binaries/`, no Linux sidecar exists) |

This matters enormously for this plan: two of the three shipped binary targets (`ffmpeg-x86_64-apple-darwin`, `ffmpeg-aarch64-apple-darwin`) run inside **WebKit, not Chromium**, and WebKit's WebCodecs implementation has trailed Chromium's significantly. Any feasibility claim must be verified against WebKit, not assumed from Chromium behavior. This is exactly the kind of assumption the task asked to be confirmed rather than taken for granted — confirmed here via direct research, not inferred from the bug report's (incorrect) header.

### 1.2 WebCodecs support by engine, verified

**Chromium / WebView2 (Windows target):** Full WebCodecs support (`VideoDecoder`, `VideoEncoder`, `VideoFrame`, `EncodedVideoChunk`, `AudioDecoder`, `AudioEncoder`) has been available since Chrome 94 (2021). WebView2's evergreen update model means the Windows build always has a current Chromium underneath. **No feasibility risk on Windows.**

**WebKit / WKWebView (macOS Intel + arm64 targets):**
- `VideoDecoder`, `VideoEncoder`, `EncodedVideoChunk`, `VideoFrame` — **video-only WebCodecs** landed as a partial implementation starting **Safari 16.4** (macOS 13.3 Ventura, March 2023). This is the piece this plan actually needs (decode-only, video-only — see 1.3).
- `AudioDecoder` / `AudioEncoder` — **not added to WebKit until Safari 26.0** (2026). Full WebCodecs (audio + video) is only complete on very recent macOS.
- A previously open WebKit bug produced out-of-order frames for B-frame-containing video via `VideoDecoder` — reported fixed in recent WebKit builds, but it is evidence that WebKit's implementation has had real correctness bugs distinct from Chromium's, not just a later start date.
- WKWebView's version is **pinned to the host macOS version** and does not auto-update the way WebView2 does. A user on macOS 13.2 (pre-Ventura-point-release) or older has **no `VideoDecoder` at all**. The dev machine used for this plan is on macOS 26.5.2 (very current), which is not representative of the install base this app may ship to, especially on the Intel target (older hardware skews toward older, un-upgraded macOS).

**Practical floor:** macOS 13.3+ (Ventura) for video-only WebCodecs. This should be treated as a hard minimum-OS requirement for the new preview path, to be enforced by the runtime capability check in 1.4.

### 1.3 Why AudioDecoder's late arrival does not block this plan

The task constraint that "audio sync must be preserved... audio as the timing source of truth" turns out to *reduce* risk here rather than add to it: this plan does not need `AudioDecoder` at all. The existing `<audio>` element (`usePlayback.ts`) already works correctly today — the cold-start bug is specific to `<video>` elements, not `<audio>` elements (the bug doc's root-cause section is explicit: it's about a `<video>` element's media clock, and the audio element has never been implicated in any of the investigation's findings). The target architecture (Section 3) keeps the native `<audio>` element exactly as-is and only replaces the **visual** decode/paint path with WebCodecs `VideoDecoder`. This means the macOS feasibility floor is "video-only WebCodecs" (Safari 16.4+/macOS 13.3+), not "full WebCodecs" (Safari 26+) — a materially lower bar.

### 1.4 What WebCodecs does *not* give us for free: demuxing

`VideoDecoder.decode()` consumes `EncodedVideoChunk` objects — raw encoded bitstream chunks with explicit timestamps and a codec description (e.g. the H.264 `avcC` box). WebCodecs has **no container parser**. Our asset files are MP4 (occasionally MOV) containers; something must pull H.264 (or HEVC/VP9/AV1, whatever a user's uploaded/stock asset is encoded as) NAL units and timing metadata out of the MP4 box structure before we can call `decoder.decode()`. This is a real, non-trivial new component — not a footnote. Section 3 designates a new `videoDemuxer.ts` module for this, most likely wrapping a proven JS MP4 demuxer (e.g. `mp4box.js`, widely used in WebCodecs reference implementations) rather than hand-rolling MP4 box parsing. This is a new runtime dependency to evaluate in Phase 0.

### 1.5 Required early spike output (Phase 0 will produce, this plan only specifies)

Before committing further phases, Phase 0 (Section 5) must empirically confirm, on all three real binary targets (Windows, macOS Intel, macOS arm64):
1. `typeof VideoDecoder !== 'undefined'` and a real `.configure()`/`.decode()` cycle succeeds for at least one representative H.264 MP4 asset.
2. Demuxer (`mp4box.js` or equivalent) correctly extracts chunks + `avcC` description for our actual asset shapes (variable frame rate, B-frames, different resolutions).
3. Decoded `VideoFrame`s paint to a `<canvas>` via `drawImage` (or `createImageBitmap`) at acceptable latency.
4. Rough decode throughput (frames/sec) on the lowest-spec real target — macOS Intel is the likely floor, not arm64 or Windows.

If (1) fails on any shipped target, that platform falls back to the current `<video>`-element path (Section 1.6) rather than blocking the others.

### 1.6 Fallback strategy if unsupported on a target platform

Because support is confirmed to be uneven by design (Section 1.2), the migration must be capability-gated, not version-gated by a build flag:

- Runtime feature detection (`'VideoDecoder' in window`) decides which playback path mounts, evaluated once at `PreviewStage` mount, not at build time — the same compiled app binary must work correctly whether or not the runtime webview supports WebCodecs.
- If unsupported (old macOS, or any unforeseen future platform), **silently fall back to today's dual `<video>`-slot path**, cold-start bug and all. This is a strict superset of current behavior (nothing regresses for users who can't get the new path) — it is not a new failure mode, it is the status quo.
- This fallback must remain in the codebase through Phase 7 (full cutover) at minimum for macOS versions below the 13.3 floor, and is revisited only once telemetry/support data justifies dropping it. Section 7 defines exactly when it's safe to delete.

---

## 2. Current Architecture Summary (self-contained reference)

This section exists so whoever implements this plan does not need to re-derive it from source.

### 2.1 `PreviewStage.tsx` (1,053 lines)

- Maintains **two persistent `<video>` elements** (`videoARef`, `videoBRef`) that ping-pong: at any time one is "active" (visible, `activeSlot: 'a' | 'b'`) and one is "idle" (preloading the next segment, `opacity-0 pointer-events-none`).
- A `headingVideoRef` handles heading-segment background video separately.
- Main effect (~line 462–599, keyed on `currentSegment` change): on segment change, promotes the idle slot to active, computes the correct in-source seek time (`trimStart + segmentProgress * playbackSpeed`), decides whether to reveal immediately or gate behind a cover (see 2.3), and kicks off preloading + pre-seeking the *next* segment into the now-idle slot.
- `warmedSegmentIdRef` and a per-slot `videoOpGenerationRef` counter prevent a stale async warm/reveal from clobbering a newer one (classic race-guard pattern used throughout this file).
- `isResizingRef` (owned by `App.tsx`) freezes segment-boundary-driven effects while a timeline resize-drag is in progress, since segment geometry is transiently wrong mid-drag (see CLAUDE.md's App.tsx entry, D12 fix).
- Renders an `overlayCanvasRef` canvas above the video slots for the transition blend (`useTransitionPreview`, Section 2.4) and draws text overlays as live DOM elements (`overlayRefs`) positioned by percentage, draggable via Pointer Events (Fidelity Polish Item 4).
- Filters are applied via CSS `ctx.filter`/style string (`getClipEffectStyle`, `computedFilter`) directly on the `<video>`/`<img>` element in the preview path (distinct from the canvas-based filter application in the export path's `frameRenderer.ts` — the two are separate implementations that must produce visually consistent, not identical-code, results).
- Canvas-based animations (`canvasAnimations.ts`, `applySegmentAnimation`) are applied in the **export** path only; the **preview** path currently uses a `motion.div` wrapper (`getAnimationWrapperProps`) driving CSS transforms for a lighter-weight live-preview approximation of the same `AnimationType` enum. These two implementations (canvas transform math vs. CSS/motion transform) are already a known duplication — not introduced by this plan, but relevant background for Section 3's design of the new canvas-based preview animation layer, which has an opportunity to converge them.

### 2.2 First-frame cache (`useFirstFrameCache.ts`, 220 lines)

- On every segments/assets change, asynchronously decodes each **video** segment's frame at its `trimStart` (via an offscreen throttled `<video>` + canvas `drawImage` + `toDataURL('image/jpeg', 0.82)`), keyed by segment id, capped at `MAX_CAPTURE_DIM=1280`px, `CONCURRENCY=2` at a time, `DECODE_TIMEOUT_MS=6000` per decode.
- Purely a correctness layer for the *current* `<video>`-based approach: it exists because the live dual-slot system cannot guarantee the visible slot has painted the *correct* segment's frame at the exact moment a boundary is crossed (this is a downstream symptom of the same class of `<video>`-element unreliability the cold-start bug belongs to). `PreviewStage` paints the cached JPEG as an opaque cover layer above both video slots (`coverState`) until the live slot is confirmed to have painted the right frame, then cross-swaps cover→live.
- This entire mechanism — offscreen decode, JPEG cache, cover/reveal cross-swap — is a workaround for `<video>`-element unpredictability. **Section 3.4 explains why it is expected to become unnecessary** (not literally deleted on day one, but its cover/gate purpose is subsumed) once frames are decoded and painted deterministically by our own code.

### 2.3 `usePlayback.ts` (137 lines) — the audio clock, unaffected by this plan

- `isPlaying=true` + a voiceover asset present → a `requestAnimationFrame` loop (~16ms) reads `audioRef.current.currentTime` every tick and calls `setCurrentTime(audio.currentTime)`. **The `<audio>` element's own internal clock is the single source of truth for `currentTime`.** Nothing in `PreviewStage` or any hook drives time independently of this readout.
- No voiceover present → falls back to a `setInterval(100ms)` manual advance of `currentTime` (unaffected either way).
- Also owns audio pause-on-stop and `playbackRate` sync.
- **This file is not modified by this plan.** The new WebCodecs decode/paint path is a *consumer* of `currentTime`, exactly like the current `<video>`-element path is — it seeks/decodes to whatever `currentTime` says, it does not produce `currentTime`.

### 2.4 `useTransitionPreview.ts` (279 lines)

- Pre-renders two offscreen canvas snapshots (960×540, `SNAP_W`/`SNAP_H`) — the outgoing segment's frame at the transition-start instant and the incoming segment's frame at time 0 — starting `PRE_ROLL_LEAD_S=0.8`s before the transition window, via the **export-path** `renderSegmentFrame` (from `frameRenderer.ts`) with `skipCaption: true` (captions are live DOM, composited separately).
- During the transition window (`inTransitionWindow`), `PreviewStage` blends these two static snapshots via `applyTransitionBlend` (also from `frameRenderer.ts`) onto `overlayCanvasRef`, giving all 10 transition slugs (fade, dissolve, zoom, dip-black/white, slide-push, whip-pan, wipe, glitch-rgb, light-leak — Effects Step 8) visual parity between preview and export without re-implementing per-transition math twice.
- **Reuses export-path code** (`renderSegmentFrame`, `applyTransitionBlend`) for its rendering — this is a case where the preview path already leans on `frameRenderer.ts` as a shared library. This plan must preserve that reuse (it's how preview/export visual parity for transitions is achieved) without ever modifying `frameRenderer.ts` itself.
- Suppressed entirely (`isActive`/`needsPreRoll`/`inTransitionWindow` all forced false) while `isResizingRef.current` is true (D12 fix) — a plain per-render read, not an effect dependency, deliberately to avoid ordering bugs.

### 2.5 Export pipeline (reference only — untouched by this plan)

`frameRenderer.ts` → `segmentEncoder.ts` → `exportPipeline.ts`, with `plainSegment.ts`'s Tier-1 fast path bypassing the canvas pipeline for plain segments. All native, via the ffmpeg sidecar. This pipeline is the source of truth this plan's preview output must visually match, but it is not a place this plan is allowed to make changes. See CLAUDE.md's "Export Pipeline" section for the full chain if deeper detail is ever needed.

---

## 3. Target Architecture

### 3.1 Design principle

Replace "the browser owns a black-box media clock and we hope it behaves" with "we own the decode loop and paint whatever frame the audio clock says we should be at, every tick, deterministically." The `<audio>` element keeps owning *time*; our code now owns *pixels*.

### 3.2 New modules

| New file | Responsibility |
|---|---|
| `src/services/videoDemuxer.ts` | Wraps a container demuxer (evaluate `mp4box.js` in Phase 0) to turn an asset URL/blob into a seekable sequence of `EncodedVideoChunk`s + codec `description` (avcC/hvcC) + track timing. One demuxer instance per unique asset source, cached/reused across segments that reference the same file (mirrors the current `getOrCreateVideo` dedup pattern in `frameRenderer.ts`). |
| `src/services/videoDecoderPool.ts` | Owns `VideoDecoder` instance lifecycle: create/configure per active decode needed, decode-ahead scheduling, output frame queueing, explicit `VideoFrame.close()` discipline (frames are GPU-backed and leak if not closed — this is the single most important correctness rule in the new system). This is the module the frame cache (Section 4) lives inside or alongside. |
| `src/hooks/useWebCodecsPreview.ts` | The replacement for the dual-slot `<video>` orchestration currently inline in `PreviewStage.tsx`. Given `segments`, `assets`, `currentTime` (from the *unchanged* `usePlayback.ts`/audio clock), returns the currently-decoded `VideoFrame`/`ImageBitmap` (or cached bitmap) to paint for the active segment, plus prefetch/decode-ahead state. This hook is the direct functional replacement for the `videoARef`/`videoBRef`/`warmedSegmentIdRef`/`coverState` machinery in `PreviewStage.tsx` §2.1. |
| `src/services/webcodecsSupport.ts` | Single source of truth for the capability check (Section 1.6) — `isWebCodecsPreviewSupported(): boolean`, memoized, called once at `PreviewStage` mount to pick a path. |
| `src/components/PreviewCanvas.tsx` (new, or a mode within `PreviewStage.tsx`) | The `<canvas>`-based paint surface: draws the current `VideoFrame`/`ImageBitmap`, then overlays/filters/animations/captions on top — this is the natural home for converging the CSS-transform preview animation path with the canvas-transform export animation path (`canvasAnimations.ts`), since both now target a canvas. Convergence is a nice-to-have opportunity, not a requirement of this migration — flagged in Section 6 as a scope-creep risk to resist until the core replacement is stable. |

### 3.3 Files modified (not replaced)

- `PreviewStage.tsx` — gains a capability-gated branch: `isWebCodecsPreviewSupported() ? <WebCodecsPreviewPath/> : <LegacyVideoElementPath/>`. The legacy path is the current code, moved but not rewritten, so it keeps working for unsupported runtimes (Section 1.6) with zero behavior change. This is the only intended change to this file's shape at a high level — actual line-level changes happen gradually across Phases 1–7, not in one shot.
- `useTransitionPreview.ts` — target time source and asset lookup are unchanged; only the *implementation* of how a "frame at time T for segment S" is obtained during pre-roll needs a WebCodecs-aware variant when the new path is active (still calling into `frameRenderer.ts`'s `renderSegmentFrame`, or a preview-local equivalent — decided in Phase 5, see risk in Section 6). The pre-roll snapshot *strategy* (offscreen canvas, blend on a transition-window canvas) does not need to change; it already treats frames as static bitmaps, which composes naturally with WebCodecs' `VideoFrame` output.
- `useFirstFrameCache.ts` — expected to become **dead code once the WebCodecs path is the only active path** (Phase 7), because deterministic frame decode removes the need for a "paint something plausible while we don't know if the live slot painted the right thing" cover layer. It is *not* deleted early — it stays serving the legacy fallback path (Section 1.6) for as long as that path exists.

### 3.4 What "eliminates the cold-start bug at its root" means concretely

The cold-start bug is a property of `<video>.play()`'s internal clock state machine, which we have zero visibility or control over. `VideoDecoder.decode()` has no such state machine — every call is a synchronous request against an explicit queue, and every output `VideoFrame` arrives with an explicit `timestamp` we chose. There is no "has this element played before" hidden state to get stuck in, because there is no element — there is a decode queue we feed and a canvas we paint to, both on our clock (Section 3.2's `useWebCodecsPreview.ts` polling `currentTime` from the unchanged audio-driven `usePlayback.ts`, same shape as the current `<video>` approach but painting our own decoded frame instead of trusting a `<video>` element's paint).

### 3.5 Segment boundaries, seeking, and dual-slot semantics under the new model

The "dual-slot ping-pong" concept doesn't disappear — it becomes "decode-ahead for segment N+1 while displaying segment N," which is a strict generalization (Section 4 extends this from 1 look-ahead segment to a small window). Segment boundary crossing becomes: stop pulling frames for the outgoing segment's decoder session (do not necessarily destroy it — see eviction policy, Section 4), start pulling from the (already warm, per decode-ahead) incoming segment's decoder session. No `<video>` `seeked` event race, no `readyState` polling, no cover-layer guess — the frame for `currentTime` is looked up directly from what we've already decoded or requested.

### 3.6 Rough module/data-flow diagram

```
usePlayback.ts (UNCHANGED)
  audio.currentTime  ──────────────────────────────┐
                                                     ▼
                                          currentTime (App.tsx state)
                                                     │
                          ┌──────────────────────────┴───────────────────────────┐
                          ▼                                                      ▼
              isWebCodecsPreviewSupported()?                         (legacy path, unchanged,
                          │ yes                                       Section 2.1/2.2 machinery,
                          ▼                                            kept for capability fallback)
              useWebCodecsPreview(segments, assets, currentTime)
                          │
          ┌───────────────┼────────────────────┐
          ▼               ▼                    ▼
  videoDemuxer.ts   videoDecoderPool.ts   (frame cache / eviction — Section 4)
  (per unique asset) (per active decode,
                      decode-ahead window)
                          │
                          ▼
              current VideoFrame / cached ImageBitmap
                          │
                          ▼
              PreviewCanvas (new) ── draws frame, then:
                  overlays (existing DOM or canvas-ported)
                  filters (ported from CSS string → canvas, or kept CSS on a canvas-backed <img>-like layer — TBD Phase 5)
                  animations (canvasAnimations.ts-style transforms, converging preview+export — Phase 5)
                  captions (existing DOM layer, unchanged in position, or canvas — TBD Phase 5)
                          │
                          ▼
              useTransitionPreview.ts blend (unchanged strategy,
              still consumes frameRenderer.ts for pre-roll snapshots)

Export pipeline (frameRenderer.ts / segmentEncoder.ts / exportPipeline.ts / plainSegment.ts / ffmpeg sidecar):
  UNTOUCHED, not part of this diagram's data flow.
```

---

## 4. Frame Cache & Memory Strategy for 500+ Segments

### 4.1 Why "cache everything up front" (today's model) cannot scale

`useFirstFrameCache.ts` today decodes and caches **one JPEG per video segment, for every segment, as soon as segments/assets change** — a fixed, small, one-frame-per-segment cost that was fine at the scale it was designed for. Two problems appear at 500+ segments:
1. Even a lightweight one-frame-per-segment JPEG cache means 500 concurrent/queued offscreen `<video>` decodes (throttled at `CONCURRENCY=2`, so ~250 sequential waves) — a real startup/re-sync latency cost that grows linearly with project size, with no eviction (it's a "first frame only" cache so it's small, but it's still O(segments) work done unconditionally).
2. A WebCodecs decode-ahead system that tried to naively extend this "decode everything" model to full playable frame sequences (not just first frames) would be catastrophically worse — a `VideoFrame` is an uncompressed, GPU/CPU-backed bitmap (e.g. a 1080p frame is ~3MB uncompressed at 4:2:0), so decoding and holding even a few seconds of every one of 500 segments simultaneously is not viable memory-wise. This is the core scaling problem this section exists to solve.

### 4.2 Model: decode-ahead window, not project-wide preload

Real NLEs (Premiere, CapCut, Resolve) do not decode the whole timeline into memory — they maintain a small rolling window of decoded frames around the playhead and a much larger index of *where to seek* (keyframe/GOP index) without holding decoded pixels for anything outside that window. This plan adopts the same shape:

- **Decode-ahead window:** decode frames for the *current* segment plus the *next* segment (mirrors today's 2-slot ping-pong exactly), plus a small time-buffer ahead within the current segment (e.g. next ~1–2 seconds of frames queued, not the whole segment) — this bounds memory to "a couple seconds of decoded video" regardless of project length, whether the project has 5 segments or 5,000.
- **First-frame index, not first-frame cache, for segments outside the window:** for the "correctness while decoding" problem that `useFirstFrameCache.ts` solves today (showing *something* correct while a live slot warms), the replacement only needs a single decoded+encoded (small JPEG, same as today) thumbnail per segment for scrubbing/timeline-preview purposes — this part of the existing cache's *shape* (small, per-segment, JPEG) is actually fine at 500+ scale and can be kept close to as-is, it's the *live playback* frame supply that must become windowed rather than kept as "decode nothing until you're live, then cover-and-hope" (today's actual mechanism per Section 2.2).
- **Eviction policy:** LRU by segment id, bounded by a frame-count or byte-size ceiling (concrete number to be tuned empirically in Phase 6 against real memory profiling — start with a conservative ceiling like "decoded frames for at most 3 segments' worth of window at any time" and measure from there, not guess a number now and defend it later).
- **Decoder instance reuse, not one-VideoDecoder-per-segment:** `VideoDecoder` construction/configuration has real overhead; segments that share the same source asset (a common case — one uploaded video split across several segments) should share a decoder/demuxer session keyed by asset id (mirrors `getOrCreateVideo`'s existing dedup pattern in `frameRenderer.ts`, and `useTransitionPreview.ts`'s existing `sharesAsset` sequential-seek special case). At 500+ segments this reuse matters far more than at current scale, since asset reuse across many short segments becomes more likely as project size grows.
- **Explicit `VideoFrame.close()` discipline:** every decoded frame not currently in the active window or the small pinned cache must be closed immediately — this is not an optimization, it's a correctness requirement (unclosed `VideoFrame`s are a hard memory leak, not just inefficiency, since they hold GPU-backed buffers the GC does not reliably reclaim promptly).

### 4.3 Memory ceiling target (starting point for Phase 6 tuning)

A rough back-of-envelope ceiling to validate against in Phase 6, not a hard spec: at 1080p, an uncompressed 4:2:0 frame is roughly 3MB. A decode-ahead window holding ~2 seconds × 2 segments (current + next) at 30fps is ~120 frames × 3MB ≈ 360MB worst case if every frame were kept simultaneously uncompressed — in practice only a handful of frames need to be *decoded and held* at once (we paint one, buffer a few ahead, discard behind), so the realistic target is closer to tens of MB, not hundreds. This must be measured, not assumed — Phase 6 is where a synthetic 500-segment project (Section 5, Phase 8) makes this real.

### 4.4 How this differs fundamentally from today

| | Today (`useFirstFrameCache.ts` + dual `<video>` slots) | Target (windowed WebCodecs) |
|---|---|---|
| What's decoded up front | First frame of *every* video segment, unconditionally, on any segments/assets change | Nothing decoded until the playhead approaches; only a small thumbnail index built lazily/incrementally |
| What's held during playback | 2 live `<video>` elements' internal buffers (opaque, browser-managed) + the full first-frame JPEG cache (all segments) | A bounded decode-ahead window (current + next segment, few seconds), explicit and inspectable |
| Scaling behavior at 500+ segments | Linear unconditional cost at every sync (first-frame cache) regardless of whether those segments are ever played; browser-managed `<video>` memory is opaque and untuned | Cost is bounded by window size, not project size; eviction is explicit and tunable |

---

## 5. Migration Phases

Each phase is independently completable, testable, and revertible (feature-flagged or additive-only until Phase 7). No phase deletes the legacy path before Phase 7.

- **Phase 0 — Proof-of-concept spike.** Standalone (not integrated into `PreviewStage.tsx`): decode one real H.264 MP4 asset from this project via `mp4box.js` (or chosen demuxer) + `VideoDecoder`, paint frames to a bare `<canvas>` in a throwaway test harness. Confirms Section 1.5's four checks on all three real binary targets (Windows, macOS Intel, macOS arm64— the actual shipped `src-tauri/binaries/` targets). Output: a written go/no-go per platform, and the chosen demuxer library. **No PreviewStage.tsx changes in this phase.**
- **Phase 1 — Single-segment playback via WebCodecs, feature-flagged.** Build `useWebCodecsPreview.ts` and `PreviewCanvas.tsx` for the simplest case: one video segment, no transitions, no overlays, no next-segment preload. Mount behind the Section 3.2 capability flag *and* an additional explicit dev-only toggle (both must be true), old path remains the shipped default. Test: does it decode, seek, and paint correctly for a single segment, driven by the existing audio clock?
- **Phase 2 — Multi-segment playback + boundary/transition handling.** Extend to real segment sequences: decode-ahead for "next" segment (the direct generalization of today's slot ping-pong), boundary crossing logic (Section 3.5), and verify `useTransitionPreview.ts`'s existing pre-roll/blend strategy still works unmodified in shape against the new frame source.
- **Phase 3 — Audio-sync integration hardening.** `usePlayback.ts` itself is not touched, but this phase is dedicated to proving the *coupling* is solid over real playback runs: no drift over long timelines, correct behavior on play/pause/scrub interleaved with segment boundaries, correct behavior when `globalPlaybackSpeed` changes mid-playback (today's `playbackRate` sync, Section 2.3).
- **Phase 4 — Scrubbing/seeking support.** Timeline drag-to-seek and click-to-seek (`Timeline.tsx`'s `onSeek`) must resolve to the right decoded frame promptly even when scrubbing rapidly across many segments (a pattern that stresses the decode-ahead window differently than steady forward playback — a scrub can jump far outside the current window, forcing a cold seek+decode on a new segment, which is exactly the scenario Section 4's window/eviction design must handle gracefully, not just steady playback).
- **Phase 5 — Overlays/filters/animations/captions re-integration.** Port each onto the canvas paint step (Section 3.2's `PreviewCanvas.tsx`): text overlays (currently live DOM, decide DOM-over-canvas vs canvas-drawn per overlay — dragging/positioning UX must not regress), filters (currently CSS `ctx.filter` string on the element — canvas equivalent), animations (currently `motion.div` CSS transform approximation — opportunity to converge with `canvasAnimations.ts`'s export-path canvas transform math, explicitly optional/nice-to-have, not required for this phase to close), captions (currently live DOM, likely stays DOM layered above the canvas — lowest risk choice). Each sub-feature is its own testable unit within this phase.
- **Phase 6 — Frame cache + eviction for scale.** Implement Section 4's windowed decode-ahead + LRU eviction + decoder/demuxer reuse-by-asset-id in full; build the synthetic 500-segment test project (Phase 8 needs this artifact too, build it here); measure actual memory against Section 4.3's rough ceiling and tune.
- **Phase 7 — Full cutover.** Remove the dev-only toggle from Phase 1 so the capability flag (Section 1.6) alone decides the path (WebCodecs-supported runtimes get the new path unconditionally). Legacy `<video>`-element path code stays in the tree (serving unsupported runtimes) — it is not deleted in this phase; deletion criteria are in Section 7. Remove now-dead pieces of `useFirstFrameCache.ts`'s live-playback cover/reveal logic if Phase 6's thumbnail-index replacement has fully subsumed it (Section 3.3), but only within the new path — the legacy path's use of it is untouched.
- **Phase 8 — Regression pass + performance validation at scale.** Re-run every existing manual smoke-test doc (`docs/*smoke-tests.md` equivalents — note two of the four listed in this repo's `docs/` are currently showing as locally-deleted/uncommitted on `main`, worth confirming their intended fate before treating them as the regression baseline) against the new path. Validate the Phase 6 synthetic 500-segment project for real playback smoothness, memory ceiling adherence, and scrub responsiveness.

---

## 6. Risk Register

| Phase | Risk | Why it matters | Mitigation direction |
|---|---|---|---|
| 0 | WebKit `VideoDecoder` has real correctness bugs distinct from Chromium's (e.g. the B-frame reordering issue found in research for this plan) — decode may "work" but produce visually wrong output on some macOS versions | macOS is 2 of 3 shipped targets; a subtly-wrong frame order is worse than a clean unsupported-fallback, because it wouldn't be caught by a simple capability check | Phase 0's spike must visually inspect decoded frame *order/content*, not just confirm decode doesn't throw; add a targeted test asset with B-frames |
| 0 | Demuxer library choice (`mp4box.js` or alternative) may not handle every container/codec shape our assets can have (user uploads are not guaranteed clean MP4 — could be MOV, variable frame rate, odd codec profiles) | A demuxer failure on an unusual user file is a playback failure the user directly hits | Phase 0 tests against a range of real asset shapes, not just one clean file; design for graceful per-segment fallback to legacy path if a specific asset fails to demux, not just a global capability flag |
| 0/6 | Decode throughput on macOS Intel (the oldest/slowest shipped target, explicitly called out in CLAUDE.md's performance notes as "pending measurement" even for the *existing* pipeline) may be too slow for smooth playback | The whole point is to fix a reliability bug without introducing a performance regression on the weakest hardware target | Measure early (Phase 0), not late; if Intel is untenable, scope the capability flag to exclude it (falls back to legacy path, per Section 1.6 — a per-platform, not just per-OS-version, gate) |
| 2/3 | Audio/video drift over long timelines — the new decode-ahead window logic must re-derive "what frame for this currentTime" every tick without accumulating error, unlike a `<video>` element which (when it works) has its own internal frame-accurate clock | A slow drift is much harder to notice/debug than an outright freeze — could ship a subtle sync bug that only shows up on long projects | Phase 3 is dedicated specifically to long-run drift testing, not folded into Phase 2's basic correctness pass |
| 4 | Rapid scrubbing invalidates the decode-ahead window constantly, potentially thrashing decoder reconfiguration if not designed for it from the start | A design that only considered steady forward playback (the common case) could perform badly exactly when a user is actively editing (scrubbing), which is disproportionately high-visibility | Explicitly design the eviction/window logic in Phase 6 against Phase 4's scrub-stress pattern, not just steady playback — consider whether Phase 4 and Phase 6 need to be reordered or done together if scrubbing proves to need the windowing design earlier than planned |
| 5 | Overlay/caption drag-and-drop UX (`handleOverlayPointerDown/Move/Up`, Fidelity Polish Item 4) currently relies on DOM element geometry (`overlayRefs`, `offsetWidth/Height`) — moving overlays onto canvas would require reimplementing hit-testing and drag math that today comes free from the DOM | This is a working, previously-shipped feature (Fidelity Polish Item 4) — regressing drag precision is a real user-facing risk, not a hypothetical | Default recommendation: keep overlays as live DOM layered above the canvas (only the video frame itself moves to canvas), not canvas-drawn — re-evaluate only if compositing order/z-index with the new canvas paint proves incompatible |
| 5 | Scope creep: converging the CSS-transform preview animation path with the canvas-transform export path (`canvasAnimations.ts`) is architecturally attractive (Section 3.2) but is a second migration bundled into this one | Could balloon Phase 5 and delay the actual bug fix this whole effort exists to deliver | Treat convergence as explicitly optional/deferred; Phase 5's required deliverable is "animations don't regress," not "animations are unified with export" |
| 6 | Section 4.3's memory ceiling is a rough estimate, not measured; real GPU-backed `VideoFrame` memory behavior (and whether it's even accurately reportable via `performance.memory` or similar in a Tauri webview) is unconfirmed | An eviction policy tuned against wrong assumptions could still leak or could evict too aggressively and hurt playback smoothness | Phase 6 must measure with the actual synthetic 500-segment project before finalizing constants, not carry Section 4.3's estimate forward as fact |
| 7 | Removing the dev-only toggle makes the new path load-bearing for every supported user immediately, including any macOS version just barely above the 13.3 floor that Phase 0 didn't specifically test | A capability check that says "supported" isn't the same as "well-tested on this exact version" | Consider whether the capability check should incorporate a tested-version allowlist/floor rather than a bare feature-detect, informed by whatever version spread Phase 0's spike environment can access |
| all | This plan's own current-architecture summary (Section 2) is accurate as of `d8cc5db` but `PreviewStage.tsx`/hooks will keep evolving on `main` while this branch is in progress (per CLAUDE.md's active refactor cadence) | A long-lived feature branch risks drifting from `main` and producing a painful merge, or implementing against a stale mental model of files that changed underneath it | Rebase/merge from `main` periodically per phase boundary (not continuously mid-phase); re-diff Section 2's summary against `main` at each phase kickoff rather than trusting this document indefinitely |

---

## 7. Rollback Plan

### 7.1 Merge-to-`main` gate criteria

`webcodecs-api` is mergeable to `main` only when **all** of the following hold:

1. Phase 8's full regression pass is clean: every existing manual smoke-test procedure (transitions, overlays, filters, animations, captions, timeline scrub/seek, segment-boundary crossing) passes on the new path, on all WebCodecs-supported platforms, with no observed regression versus current `main` behavior.
2. The synthetic 500-segment project (built in Phase 6) plays back smoothly, stays within the memory ceiling validated in Phase 6, and scrubs responsively — this is the actual justification for the whole migration and must be demonstrated, not assumed from smaller-scale testing.
3. The cold-start bug (`docs/bugs/preview-cold-start-clock-freeze.md`) is confirmed gone on the new path specifically (not just "we replaced the mechanism so it should be gone" — an explicit repro attempt against the new path, using whatever reproduction steps that bug doc's investigation established, must fail to reproduce).
4. `tsc` clean, full `vitest` suite green, exactly as every other merge in this repo's history requires (per CLAUDE.md's status table conventions).
5. The legacy `<video>`-element fallback path (Section 1.6) is verified still functional end-to-end for the capability-unsupported case — merging this branch must not silently break the fallback for users on old macOS.
6. Export pipeline untouched: a diff review confirms zero changes to `frameRenderer.ts`, `segmentEncoder.ts`, `exportPipeline.ts`, `plainSegment.ts`, or anything under `src-tauri/` — this is a hard gate given the task's explicit constraint, not just a preference.

### 7.2 What happens if a phase proves infeasible

Because `main` is never touched during this effort, infeasibility at any phase has a clean, low-cost exit: **stop advancing this branch; `main` already has the fully-working current `<video>`-based system** (dual-slot ping-pong + first-frame cache cover, cold-start bug and all — a known, already-shipped quantity) with no partial migration ever having been merged into it. Specific fallback points:

- **If Phase 0 fails on a given platform** (e.g. WebKit decode is too slow or visually wrong on macOS Intel, per the Section 6 risk): that platform is simply excluded from the capability flag (Section 1.6) permanently — it keeps using the legacy path forever, and this plan's benefit is scoped to the platforms where it does work. This is not a failure of the whole effort, it's exactly what the capability-gated design (rather than a hard cutover) is for.
- **If Phase 0 fails on all platforms** (unlikely given Windows/Chromium's mature support, but the honest worst case): the branch is parked, `docs/bugs/preview-cold-start-clock-freeze.md` reverts to "Direction B" (reveal-first, hide-after-motion — the pragmatic mitigation that bug doc already identified as a fallback if a deeper fix isn't viable) as the interim mitigation on `main`, applied as a separate, much smaller piece of work outside this branch.
- **If a mid-range phase (2–6) proves infeasible** (e.g. audio drift can't be eliminated, or memory ceiling can't be hit at 500+ segments): the capability flag (Section 1.6) can be shipped as permanently "off" (or scoped to only the specific case that does work, e.g. "only for projects under N segments") without discarding the completed earlier phases' code — Phase 0–1's proof-of-concept work and Phase 2's boundary-handling logic remain valid, reusable groundwork even if the full 500-segment scaling goal (Phase 6) doesn't pan out on the original timeline.
- In every case, rollback is "don't merge this branch" — there is no `main`-side revert needed, because `main` was never modified. This is the direct benefit of the dedicated-branch approach requested for this effort.
