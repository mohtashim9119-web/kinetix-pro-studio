# WebGL2 Effects Engine — Root-Cause Audit & Phased Migration Plan

**Status:** Audit (Section 1) and engine decision + feasibility spike (Sections 2–3) are **COMPLETE** — produced as part of writing this document, 2026-07-10. **Phase 1 (Section 6, core compositor module) is COMPLETE** as of 2026-07-10 — see the Progress Tracker below. **Phases 2–6 are NOT STARTED.** The verdict: rebuild the effects-rendering engine (transitions, animations, and the new color-grading feature area) on **WebGL2**, not WebGPU — GO confirmed empirically on both Chromium and this project's real Tauri WKWebView, including the single most important integration question (WebCodecs `VideoFrame` → GPU texture upload), which passed 312/312 frames with zero GL errors on both engines.

**Branch:** `webgl2-effects-engine` (off `webcodecs-api` @ `fd6c1d2` — verified via `git log`, not trusted from any doc). `webcodecs-api`/`main` are not touched until this effort is reviewed and merged. This branch depends on the shipped WebCodecs decode work (`videoDecoderPool.ts`/`videoDemuxer.ts`), which is why it forks from `webcodecs-api`, not `main`.

**Scope:** The effects-rendering layer only — 4 transitions (dip-to-black, dip-to-white, cross-dissolve, light-leak), 2 animations (zoom in, zoom out), and a NEW color-grading feature area (auto-adjust + manual controls; the manual control set proposed in Section 5.3 is a **proposal, not a final spec**). Explicitly OUT of scope: the overlay text/positioning system (`SegmentControls.tsx`/`ReviewMappingModal.tsx`/the DOM caption+overlay layers in `PreviewStage.tsx`) — it stays as-is; GPU-compositing overlays is possible future work, not this plan. Also out of scope: the export pipeline files (`frameRenderer.ts`, `segmentEncoder.ts`, `exportPipeline.ts`, `plainSegment.ts`, anything under `src-tauri/`), `usePlayback.ts` (audio clock), sync/timeline, and the still-blocked WebCodecs `VideoEncoder` effort (referenced as a design constraint in Section 4, never touched).

**Origin of this effort:** the 2026-07-07 decision (project-state.md Decisions Log; `docs/webcodecs-architecture-plan.md` Item 4 B4 entry) to stop patching the mixed DOM/CSS + Canvas2D effects engine. The precipitating incident: Item 4's B4 sub-fix (overlay parity during live transitions) was implemented and manually tested, did **not** fix the reported symptom (animation jump/disappear during transitions), and surfaced an unrelated React "Maximum update depth exceeded" infinite-render loop in `usePlayback.ts` — the second structural surprise from this rendering approach, after Phase B's `VideoEncoder` dead end. Section 1 documents *why* this architecture keeps producing these surprises, not just that it does.

**Hard constraint — no fallback path:** per explicit user decision, once this ships there is NO fallback to the current CSS/Canvas2D effects path. This is a controlled desktop app for 5–10 internal YouTube channel teams, not a public product. Section 3.4 documents the actual minimum runtime requirement this implies (short version: **WebGL2 adds no new floor — the already-shipped WebCodecs decode dependency's macOS 13.3 floor remains the binding constraint**; WebGPU would have raised it to macOS 26, which is why it lost).

---

## Progress Tracker — Read This First

This section is the single source of truth for where this effort stands, independent of any chat session. Update it at the end of every phase, before committing that phase's work.

### ✅ COMPLETED

- **Part 1 — Root-cause audit of the CSS/Canvas2D effects engine.** Full findings in Section 1. Key outcomes: (a) confirmed the dual-implementation and dual-video-sourcing structural problems with file/line evidence; (b) traced four shipped historical bugs to the same layer-synchronization root cause and explained the mechanism in each; (c) **corrected** the export-side slowness claim — Canvas2D *drawing* was never the bottleneck (measured 0.1% of frame time in `docs/phase-7-task-1-export-profiling.md`); the export cost is the readback→PNG→IPC architecture *around* the canvas plus `<video>`-element seeking, most of which commit `cd7ea2b` already addressed (pending re-benchmark). The WebGL rebuild's export value is architectural (a `VideoFrame`-native compositor an encoder can consume directly), not "faster drawImage."
- **Part 2 — Engine decision: WebGL2, with empirical feasibility spike on the real Tauri WKWebView.** Full evidence in Sections 2–3. Concrete outcomes:
  - Real WebGL2 context confirmed on the real Tauri WKWebView (macOS 26.5.2, Intel i9/UHD 630): `WebGL 2.0`, GLSL ES 3.00, `Apple GPU` renderer (ANGLE-on-Metal), max texture 16384.
  - **`VideoFrame` → `gl.texImage2D` upload confirmed working and fast on both engines** — 312/312 real decoded H.264 frames (the same `public/_spike/sample.mp4` asset and mp4box demux path the shipped decode pipeline uses), 0 GL errors, pixel readbacks non-black and varying across frames, matching Chromium's readback values within ±1: WKWebView ~531 fps single upload+draw, ~411 fps worst-case dual-upload+blend (two `texImage2D` uploads + blended draw per frame — the live-transition load); Chromium ~5,856 / ~3,165 fps.
  - **All 6 scoped effects compile and render pixel-correct as GLSL ES 3.0 shaders on both engines**: cross-dissolve, dip-to-black (progress 0.5 reads back exactly `[0,0,0]`), dip-to-white (exactly `[255,255,255]`), light-leak (screen-blend bloom measurably brighter at progress 0.5 than 0), zoom (UV-scale), color grading (brightness/contrast/saturation/temperature — brightness +0.3 raised center pixel 78→154, temperature shifted R up/B down).
  - **WebGPU data point, recorded accurately:** `navigator.gpu` IS present and `requestAdapter()` DOES return an adapter on this macOS 26.5.2 WKWebView (contradicting the researched claim that WKWebView doesn't ship WebGPU — at least on this OS version). WebGPU still loses on the install-base floor: it requires macOS 26 (Safari 26, shipped fall 2025), which would hard-exclude every not-yet-upgraded Mac in the 5–10 target channels. See Section 2.3.
  - Attribution rigor (same bar as the B0/audit spikes): bare `AppleWebKit/605.1.15` UA with no `Chrome` token (real WKWebView, not the Chromium preview pane — which was stopped before the run); app killed afterward and the exfil listener confirmed **zero** further posts in a 9s window; `tauri.conf.json`'s temporary `devUrl`/CSP edits reverted to zero git diff.
  - Spike harness **kept, committed** (`spike-webgl.html` + `src/dev/webglFeasibilitySpike/main.ts`), following the `f52ab12` precedent for retained investigation artifacts — justification in Section 8 (it must be re-run on macOS arm64 and Windows/WebView2, both still open).
- **Phase 1 — Core compositor module** (Section 6). Built `src/services/gl/{glContext.ts, shaders.ts, glCompositor.ts, compositeParams.ts}` as pure additive modules — zero imports from any existing app file (`grep -rn "services/gl/" src` outside the new directory returns nothing) and zero modifications to any tracked file (`git status --short` shows only the new untracked `src/services/gl/` directory). No `PreviewStage.tsx`/UI/EffectsPanel wiring, per this phase's scope. Concrete outcomes:
  - `glContext.ts`: `isWebGL2Supported()` (memoized, mirrors `webcodecsSupport.ts`'s `isWebCodecsPreviewSupported()` cache pattern exactly) + `acquireGlContext(canvas, options)`, which calls `canvas.getContext('webgl2', {...})` and wires `webglcontextlost` (`event.preventDefault()`, required by spec to keep the context restorable) / `webglcontextrestored` listeners via caller-supplied callbacks. Defaults `alpha: true` — documented rationale: image segments and possible future overlay-layer compositing (out of scope for this plan's scoped effects, but not architecturally precluded) may need per-pixel alpha, and the cost of `alpha:true` on otherwise-opaque video content is negligible.
  - `shaders.ts`: the exact 6 GLSL ES 3.0 shaders already pixel-verified on both engines by the Phase 0 spike (`src/dev/webglFeasibilitySpike/main.ts`) — promoted with cleaned-up comments, math unchanged, not re-derived: blit, cross-dissolve, dip (dip-black/dip-white share one shader via a `u_dipColor` uniform), light-leak (`progress*(1-progress)*4` bloom shaping ported verbatim from `frameRenderer.ts`'s `applyTransitionBlend` 'light-leak' case), zoom (`1.0 ± 0.05*t` ported verbatim from `canvasAnimations.ts`'s ZOOM_IN/ZOOM_OUT cases), color-grade (brightness/contrast/saturation/temperature, normalized-RGB math per Section 4's export-readiness constraint).
  - `glCompositor.ts`: `GlCompositor` class — `constructor(gl)`/private `setup()` compiles all 6 programs + the fullscreen-triangle VAO + 2 content texture slots (`'a'`/`'b'`); `uploadFrame(slot, source)` (`VideoFrame | ImageBitmap | HTMLImageElement`); `renderFrame(params: CompositeParams)` — synchronous, no rAF/async, a short fixed pass chain (transition-or-blit → zoom → grade) via a lazily-allocated, size-tracked ping-pong FBO pair, skipping offscreen passes entirely (straight to the canvas backbuffer) whenever zoom/grade are neutral; `handleContextRestored()` re-runs `setup()` and resets the render-target pair to force fresh allocation (old handles are invalid post-loss even though the same `gl` object reference survives restoration per spec); explicit `dispose()` deletes every program/texture/framebuffer/buffer/VAO it owns.
    - **Pass-chain design note, since it's new structure beyond what the spike tested:** the spike (Section 2.2) pixel-verified each of the 6 shaders standalone; it never chained one shader's output through an offscreen render target into another. The ping-pong FBO chain here was reasoned from the spike's single-pass throughput numbers (531–5,856 fps per pass, comfortably beneath the 30fps budget for up to 3 chained passes) and verified via the mock-based tests below for call-sequencing/resource-lifecycle correctness only — it has **not** been run against a real GPU. This is explicitly flagged, not claimed as pixel-verified; a manual real-Tauri-app check of the chained output is deferred to before Phase 3 integration.
  - `compositeParams.ts`: `deriveCompositeParams(segments, currentTime, config)` — pure, no React/DOM/pool dependency (same role `toSourceTime`/`computeKeepSet` play for the decode side, `src/hooks/useWebCodecsPreview.ts`). Reuses `resolveEffectiveTransition` (`src/services/transitionResolver.ts`, imported unmodified) for transition selection so this can't drift from the legacy Canvas2D path's own selection logic, and replicates `useTransitionPreview.ts`'s active-blend window math (minus that hook's pre-roll/pool-prefetch bookkeeping, which is a preview-buffering concern, not a per-tick compositing one). Scoped to exactly the 4 transitions + 2 zooms Section 5 lists — a resolved legacy-enum transition, an unscoped slug, or any of the other 11 `AnimationType`s all resolve to `null`/neutral (`animScale: 1`) by design, since the GL compositor doesn't implement them. Deliberately does not decide which content belongs in texture slot 'a' vs 'b' — that's a Phase 3 integration concern.
  - **Tests: 51 new, 328/328 total repo-wide** (up from 277 pre-branch). `compositeParams.test.ts` (22 tests) — pure, mock-free, mirrors `useWebCodecsPreview.test.ts`'s `toSourceTime`/`computeKeepSet` style: ordinary mid-segment time (including outside-every-segment), transition progress at a window's start/mid/near-end, the exact-boundary edge case (a transition's `[start, start+duration)` window is half-open, matching `findContainingSegment`/`transitionResolver.ts`'s existing convention elsewhere in this codebase — exactly at the boundary belongs to the next segment), zoom scale at segment start/near-end for both zoom-in and zoom-out, legacy-`AnimationType`/unscoped-transition-slug fallback-to-neutral, `globalTransitionDuration` fallback plumbing, and grade passthrough (with and without a config override).
  - **Testing approach for `glContext.ts`/`glCompositor.ts` — option (a) chosen, not option (b):** hand-rolled mock `WebGL2RenderingContext`/canvas objects, mirroring `videoDecoderPool.test.ts`'s `MockVideoDecoder`/`MockVideoFrame` precedent exactly (a plain object satisfying only the interface subset actually called). Chosen because this repo's vitest was confirmed (not assumed) to run in plain Node — no jsdom, no `environment` key in any vitest config — so there is no real DOM/WebGL to test against under either option; the mock gives durable, automated, re-runnable coverage of call sequencing and resource lifecycle (program/texture/FBO creation counts, dispose cleanup, context-loss re-creation), which a throwaway browser harness (deleted before commit, per option (b)'s own description) could not provide on every future CI run. `glContext.test.ts` (14 tests): capability-check memoization/reset, `acquireGlContext`'s option defaults/overrides, listener registration, and — the **required forced-loss test** — a mock canvas that records registered listeners and lets the test invoke them directly to simulate `webglcontextlost` (asserting `preventDefault()` fires) and `webglcontextrestored` (asserting the callback fires), including a full loss→restore cycle in order. `glCompositor.test.ts` (15 tests): program/shader/geometry/texture creation counts on construction, compile/link failure surfaces a thrown error (no silent fallback, per the plan's no-fallback stance), `uploadFrame` texture routing, the pass-chain's draw-call count and render-target allocation for all 4 neutral/transition/zoom/grade combinations, render-target reuse-vs-reallocation on drawing-buffer resize, `handleContextRestored()` re-running full setup and correctly discarding (not reusing) stale render-target handles afterward, and `dispose()`'s deletion counts with and without render targets ever allocated. **What this does NOT prove** (stated explicitly, not silently skipped): real-GPU shader pixel-correctness — that remains the Phase 0 spike's job, already done for the 6 standalone shaders; the chained pass output specifically is unverified on real hardware (see the pass-chain design note above).
  - `tsc --noEmit`: clean. `vitest`: 328/328.

### 🟡 IN PROGRESS / PARTIAL

None.

### ⬜ NOT STARTED / PENDING

- **Phase 2 — Effects build-out**: 4 transitions + 2 animations as shaders behind the compositor's uniform interface.
- **Phase 3 — Preview integration** behind a dev toggle (dual-gate discipline, mirroring the WebCodecs migration's Phase 1).
- **Phase 4 — Color grading** (new feature area): manual controls + auto-adjust heuristic + UI.
- **Phase 5 — Cutover + legacy-path removal** for the scoped effects (the no-fallback step).
- **Phase 6 — Export-readiness proof + regression/perf validation at scale**, including the runtime-floor re-verification on macOS arm64 and Windows/WebView2 that Phase 0's single-machine spike could not do.

---

## 1. Root-Cause Audit — Why CSS/Canvas2D Effects Rendering Is Structurally Bug-Prone (Part 1)

The current effects engine is not one engine. Every visual effect exists as **two to three independent implementations across three rendering technologies** (DOM/CSS transforms via Framer Motion wrappers, Canvas2D `ctx` transforms, and offscreen-canvas snapshot blending), and those implementations are synchronized against playback state (play/pause/seek/boundary-crossing) by hand-written React effect choreography. Each finding below is evidenced from shipped code and this repo's own bug history.

### 1.1 The dual-implementation problem: every animation exists twice

- **Preview:** `PreviewStage.tsx:54` (`getAnimationWrapperProps`) — 13 `AnimationType` cases emitting CSS `transform`/`opacity`/`filter` strings applied to a wrapper `motion.div` around the media element.
- **Export:** `canvasAnimations.ts:118` (`applySegmentAnimation`) — the same 13 cases as Canvas2D `ctx.translate/scale/rotate/transform` calls inside `frameRenderer.ts`'s per-frame render.

Two code paths, one visual contract, no mechanism enforcing they agree. This is not hypothetical drift — it shipped and had to be found by eye. **Phase A1** (2026-07-06, `docs/webcodecs-architecture-plan.md` Section 8.1 area) found and fixed exactly this class of divergence: preview's FLOAT ran a one-directional dip while export ran a bidirectional sine; preview's HEARTBEAT period was 1.5s vs export's 1.2s (visibly desyncing the same segment's preview from its own export); preview's SHAKE ran ~2.5Hz vs export's 10Hz; and preview's `repeat: Infinity` Framer keyframes free-ran on Framer's **wall clock** — ignoring pause, seek, and playback position entirely — while export was a pure function of frame time. A1's fix (share the math helpers, drive both from `timeInSegment`) narrowed the gap but did not remove the structure that produces it: the *property assignment* (CSS transform string vs `ctx` transform matrix) is still written twice, per effect, forever. The file header at `PreviewStage.tsx:33-40` now literally instructs future authors to hand-port each new animation between the two files — a standing invitation for the next A1.

The same duplication exists for transitions: `frameRenderer.ts:674` (`applyTransitionBlend`) is nominally shared by export and preview, but preview reaches it through an entirely different sourcing/compositing stack (Section 1.2), and for filters: preview applies CSS `filter` strings to elements while export sets `ctx.filter` — same string, different rasterizer, close-but-not-guaranteed-identical output.

### 1.2 The dual video-sourcing problem: transitions blend stale pixels in preview, live pixels in export

Two fully independent video-frame-sourcing mechanisms are live in preview simultaneously:

- The **WebCodecs decode pool** (`videoDecoderPool.ts`) feeds ordinary playback — cheap per-tick `getFrameAt()` lookups once a window is warm.
- `frameRenderer.ts`'s **HTML5 `<video>`-seek cache** (`getOrCreateVideo`/`seekVideo`, `frameRenderer.ts:115/198`) feeds `useTransitionPreview.ts`'s transition snapshots — a seek-and-wait path costing **~200ms per video, ~400ms for the same-asset sequential fallback** (the hook's own `PRE_ROLL_LEAD_S` comment, `useTransitionPreview.ts:42-46`, documents these numbers; they're why pre-roll leads the window by 0.8s).

Because a ~200–400ms seek cannot run per render tick, `useTransitionPreview.ts` renders each boundary's outgoing/incoming frames to offscreen canvases **once** at pre-roll and blends those static snapshots as a pure function of `progress` for the whole transition window. That is the documented root cause of the "frozen transition frame" symptom (project-state.md / webcodecs-architecture-plan.md, "frozen transition frame audited, deferred to Phase B", 2026-07-06): the blend-draw loop reruns every tick, but the two source canvases it draws from never advance. Export never had this problem — `segmentEncoder.ts` renders every transition frame live via `renderSegmentFrame`, each sampling its own segment's advancing time — so preview and export disagree *by construction* during every transition.

The Item 4 B1–B3 fixes (shipped 2026-07-06) patched the outgoing side onto live pool pulls for WebCodecs-capable runtimes — at the cost of cross-hook plumbing (a second protected-session set in the pool, `pool`/`incomingFrame` params threaded through `PreviewStage.tsx`, reuse of another hook's chase-mutex primitives) layered **on top of** the still-present snapshot machinery, with image segments and the HTML5 path keeping frozen behavior by design. The result is a hybrid: one-shot snapshots + per-tick live pool pulls + a DOM overlay canvas + hold/release gating, coordinated across three hooks. B4 — the next patch on this stack — failed to fix its target symptom and surfaced an unrelated infinite-render loop, which is what triggered this plan.

A GPU compositor removes the *reason* the snapshot mechanism exists: both segments' frames are just two textures, uploaded per tick from the decode pool (the spike measured this exact worst case at ~411 fps on WKWebView — ~13× faster than the 30fps it needs to be), and the blend is one draw call.

### 1.3 Why hand-synchronized DOM+CSS+Canvas2D layers are inherently fragile

At any moment during playback, the preview stage composites: the WebCodecs `PreviewCanvas` (or dual `<video>` slots on the legacy path), a first-frame-cache cover canvas, a transition-overlay canvas (z-45), Framer Motion animation wrapper divs (inner intra-segment + outer cross-segment), DOM caption/overlay/heading layers, and CSS filter styles. None of these share a clock or a compositor; every one has its own notion of "what time is it / which segment is current," updated by separate React effects with no ordering guarantee beyond what each fix hand-builds. Four shipped bugs are direct symptoms:

1. **D10 — black flash on video→video transition boundaries (fixed 2026-06-30).** The idle `<video>` slot was byte-preloaded but not pre-seeked, and the reveal was gated on `canplay` — an event that fires before the engine has *painted* a frame. The DOM gives no synchronous "a frame is now visible" signal, so the fix had to gate on `requestVideoFrameCallback` plus a `seeked`+rAF fallback plus a 400ms failsafe. Mechanism: **the layer being revealed and the layer being hidden have independent, unobservable paint states.** In a GPU compositor there is no reveal to gate — the next frame is drawn when its texture is ready, atomically, in one draw.
2. **D12 — preview/playhead jump on timeline resize-drag (fixed 2026-07-01, `be45b07`).** Beyond the ghost-click root cause, the fix required **three separate hardening guards in three different layers** — `PreviewStage.tsx`'s seek effect skipping while `isResizingRef` is true, `useTransitionPreview.ts` force-suppressing its window during a drag (because transient boundary geometry could sweep `currentTime` into a bogus transition window and swap in the *wrong segment's snapshot*), and `App.tsx` freezing `currentSegment` at the source. Mechanism: **every layer independently derives state from `currentTime`/`currentSegment`, so every layer needs its own defensive guard against transient inputs.** A single stateless `render(t)` function has exactly one place to guard.
3. **Bug 1 — transition flash-back S2→S1→S2 on cross-dissolve (fixed 2026-07-05).** A React effect/paint-ordering race: `PreviewCanvas`'s frame-draw was a passive `useEffect` (runs after paint) while the transition overlay's opacity was applied synchronously in the same commit — so the browser could paint the overlay fading out *before* the canvas underneath had redrawn, flashing the previous segment's stale bitmap. Fixed by converting to `useLayoutEffect`. Mechanism: **when "what's on screen" is the composition of multiple independently-painted DOM layers, correctness depends on React's effect-timing internals** — a category of bug that cannot exist when one draw call produces the whole frame.
4. **Item 4 B4 + the A-series residuals (the terminal incident, 2026-07-06/07).** After A1–A3 unified the animation clock and B1–B3 made the outgoing transition side live, the *interaction* of the remaining layers still produced the reported animation jump/disappear during transitions. The codebase at this point contains two independent hold/release state machines (overlay-canvas hold vs. animation-wrapper-transform hold — `computeOverlayHoldState` and `computeSnapReleaseBlend` in `useWebCodecsPreview.ts`, whose own doc notes they "remain independent"), a suppress flag (`suppressMotionAnim`) so the wrapper transform doesn't fight the overlay canvas, and a blend that reconstructs the frozen "from" pose by re-calling `getAnimationWrapperProps` with stale inputs. B4's overlay-parity patch on top of this did not fix the symptom and its testing surfaced an unrelated `usePlayback.ts` infinite-render loop. This is what "structurally bug-prone" means concretely: **each fix adds another state machine that future fixes must also synchronize with.**

### 1.4 The export-side slowness claim — verified, and corrected

The claim "Canvas2D per-frame compositing makes export slow" is **wrong in its specifics and right in its architecture**, and the distinction matters for what this rebuild promises:

- `docs/phase-7-task-1-export-profiling.md` (measured, macOS Intel, 355-frame project): `renderDraw` — the actual Canvas2D compositing including filters, overlays, and animation transforms — was **0.3ms/frame, 0.1% of frame-loop time**. The bottleneck was everything around it: `toBlob` PNG encode 47.2%, `ipcWrite` 29.2%, `b64encode` 10.2%, `videoSeek` 13.3%.
- Commits **`cd7ea2b`** (worker-pool pipelined PNG encode + raw-binary IPC write — eliminates the base64 round-trip and moves PNG encode off-thread, overlapping it with the next frame's render) and **`d033cb1`** (isolated blend-video cache — removes the same-URL seek thrash during transition windows) landed 2026-07-09 and target exactly those measured costs. **No post-fix end-to-end benchmark has been run** (project-state.md's Quick Stats flags the old figures as stale), so the residual export cost is currently unquantified — but by the profile's own shares, the remaining structural costs are `videoSeek` (~57ms mean/frame, a `<video>`-element seek discipline the WebCodecs decode pool would replace with sequential decode) and whatever PNG/IPC cost pipelining couldn't hide.
- **Therefore this plan does NOT claim the WebGL compositor speeds up today's export path.** Swapping `ctx.drawImage` for a GPU draw inside the existing PNG→IPC→ffmpeg pipeline would save ~0.1% and add a GPU readback. The export value of this rebuild is architectural and conditional: a compositor whose input is `VideoFrame`s and whose output surface can feed `VideoEncoder` directly (Section 4) eliminates the PNG/disk/seek architecture *entirely* — but only once the separately-tracked, still-blocked `VideoEncoder` hang risk (project-state.md Active Tasks, "Export rewrite: WebCodecs pipeline") is resolved. Until then, export stays on the existing (now-faster) pipeline, untouched by this branch.

### 1.5 Root cause, stated once

Effects are implemented N times across DOM/CSS, Canvas2D, and snapshot layers that each hold their own state and repaint on their own schedule, so every playback-state change (play/pause/seek/boundary/drag) must be manually re-synchronized across all of them — and each synchronization fix is itself a new layer to synchronize. The fix is not another patch; it is making the frame a **single pure function**: `composite(textures, t, params) → pixels`, evaluated once per tick on the GPU, identical for preview and (eventually) export.

---

## 2. Engine Decision: WebGL2 over WebGPU (Part 2)

### 2.1 Support floors — researched (sources cited; independently spot-verified where marked)

| Capability | WKWebView (macOS) | WebView2 (Windows) | Evidence class |
|---|---|---|---|
| WebGL2 | Safari 15 era WebKit (Sept 2021; ANGLE-on-Metal backend) — i.e. any macOS able to run Safari 15+, well below this app's existing floor | Chromium since 56 (2017); WebView2 is evergreen | Researched (khronos.org "WebGL 2.0 Achieves Pervasive Support", caniuse, webkit.org release notes) + **empirically verified on this machine's WKWebView (Section 2.2)** |
| WebGPU | Safari 26 / macOS Tahoe 26 (fall 2025) in Safari proper; third-party research claims WKWebView does *not* ship it by default | Chromium 113+ (2023) in-browser; default-enabled status **inside WebView2** historically unclear (MicrosoftEdge/WebView2Feedback #2233, tauri-apps/tauri #6381 discuss flags) | Researched (webkit.org Safari 26.0 release notes, gpuweb wiki, web.dev) + **one data point empirically corrected on this machine (Section 2.3)** |
| WebCodecs `VideoDecoder` (already shipped in this app) | macOS 13.3 / Safari 16.4 | evergreen Chromium | Established in `docs/webcodecs-architecture-plan.md` Section 1.2 — **this is the app's existing runtime floor** |

The decisive structural fact: **this app's preview already requires WebCodecs (macOS 13.3+) on its default path, and the new compositor's native input is `VideoFrame` — so the effects engine can never be *more* available than WebCodecs. WebGL2's floor (Safari 15 / ~macOS 10.15–11) is strictly below that. WebGL2 therefore adds zero new runtime requirement.** WebGPU would raise the macOS floor from 13.3 (Ventura, 2022, runs on 2017+ hardware) to 26 (Tahoe, 2025) — on a fleet of 5–10 channels' machines that are explicitly not centrally managed or updated.

### 2.2 Feasibility spike — empirical results (real runtimes, not assumptions)

**Harness:** `spike-webgl.html` + `src/dev/webglFeasibilitySpike/main.ts` (kept — Section 8). Method mirrors the WebCodecs plan's Phase 0 / WKWebView Cross-Check / B0-audit methodology: demux `public/_spike/sample.mp4` (real Pexels H.264 High-profile 1280×720/30fps asset with real B-frames, 312 samples) via mp4box exactly as the shipped `videoDemuxer.ts` does, decode via `VideoDecoder`, and for every decoded `VideoFrame`: upload via `gl.texImage2D(gl.TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, frame)` and draw a fullscreen-triangle blit; frames 100–199 instead take the worst-case live-transition path (TWO uploads + a cross-dissolve blended draw). Pixel readbacks (`gl.readPixels`) at frames 10/100/250 prove real, varying, non-black content. Then all six scoped effects render with characteristic uniforms and are pixel-verified. Results exfiltrated via HTTP POST to a local listener (WKWebView has no automatable devtools); the definitive run executed inside the real Tauri app via a temporary `devUrl` repoint (reverted to zero diff).

**Chromium (this environment's preview pane, ANGLE Metal / Intel UHD 630) — 2026-07-10:**

| Check | Result |
|---|---|
| WebGL2 context | ✅ `WebGL 2.0 (OpenGL ES 3.0 Chromium)`, ANGLE Metal, max texture 16384 |
| `VideoFrame` → texture, 312 frames | ✅ 312/312, 0 GL errors, readbacks vary + non-black |
| Throughput | ~5,856 fps single upload+draw; ~3,165 fps dual-upload+blend |
| 6 effect shaders (7 programs incl. blit) | ✅ all compile, all pixel checks pass |
| `navigator.gpu` | present, adapter returned |

**Real Tauri WKWebView (macOS 26.5.2 Build 25F84, Intel i9 / UHD 630) — 2026-07-10, the definitive run:**

| Check | Result |
|---|---|
| Attribution | UA `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)` — no `Chrome`/`Safari` token (real WKWebView); Chromium preview pane stopped before the run; app killed afterward → **0** further exfil posts in 9s |
| WebGL2 context | ✅ `WebGL 2.0`, `WebGL GLSL ES 3.00`, unmasked `Apple Inc. / Apple GPU`, max texture 16384 |
| `VideoFrame` → texture, 312 frames | ✅ **312/312, 0 GL errors**; readbacks `[84,87,84]`/`[84,98,96]`/`[79,99,99]` at frames 10/100/250 — non-black, varying, matching Chromium's values within ±1 (cross-engine correctness, not just "no crash") |
| Throughput | **~531 fps single upload+draw (~1.9ms/frame); ~411 fps dual-upload+blend (~2.4ms/frame)** — 17.7×/13.7× the 30fps requirement; the dual number is the exact per-tick cost of a live two-sided transition |
| dip-to-black @ progress 0.5 | ✅ reads back exactly `[0,0,0,255]`; @ 0 reads texA content |
| dip-to-white @ progress 0.5 | ✅ exactly `[255,255,255,255]` |
| cross-dissolve @ 0.5 | ✅ non-black blended content |
| light-leak | ✅ screen-blend bloom brighter at progress 0.5 (745) than 0 (607) — the `alpha*(1-alpha)*4` shaping ported from `applyTransitionBlend` works as a shader |
| zoom (UV scale 1.5) | ✅ renders correct content |
| color grade | ✅ brightness +0.3: center 78→154; temperature +1: R up, B down |
| `navigator.gpu` | **present, adapter returned** (see 2.3) |

**What was empirically verified vs. researched/assumed:** everything in the two tables above is measured first-hand. NOT verified empirically (open, carried to Phase 6): macOS arm64 (this machine is Intel; no arm64 hardware in this session), Windows/WebView2 (no Windows machine; the Chromium result is a strong proxy since WebView2 is evergreen Chromium, but it is a proxy), and older macOS versions down to the 13.3 floor (this machine runs very current WebKit; WebGL2-on-WKWebView at 13.3–15.x is researched-only). Same residual pattern, explicitly, as the WebCodecs plan's Phase 0 left open — and resolvable with the same kept harness.

### 2.3 The WebGPU data point — recorded accurately, and why WebGPU still loses

The spike found `navigator.gpu` present with a working adapter on this macOS 26.5.2 WKWebView — **contradicting** the researched claim that WKWebView doesn't ship WebGPU by default. Record this honestly: on the very newest macOS, WebGPU appears reachable inside this app today. It changes nothing about the decision:

1. **Install-base floor.** WebGPU-in-WKWebView means macOS 26 at minimum (it shipped in Safari 26). The task's own constraint stands: the 5–10 channels' Macs are not centrally updated, and a hard macOS 26 requirement with **no fallback** would brick the effects engine on every Mac still on Sequoia/Sonoma/Ventura — machines that today run the app perfectly. WebGL2 requires nothing those machines don't already have. This is the flip-condition scenario already realized: the minimum viable WebGPU floor IS "newest macOS only," so WebGL2 is the only viable no-fallback choice.
2. **Windows uncertainty.** WebGPU default-enablement *inside WebView2* (vs. Edge the browser) has a history of flag-gating; verifying it would cost a Windows spike this session couldn't run. WebGL2 in WebView2 is unconditional.
3. **Maturity/precedent for this workload.** Two-texture dissolves, dip-throughs, screen-blend light leaks, UV zooms, and color matrices are the *canonical* WebGL tutorial workload — 10+ years of precedent (glsl-transitions/gl-transitions library, every WebGL video editor). WebGPU precedent for this exact niche is thinner and its WKWebView implementation is months old (and its `importExternalTexture` fast path matters for zero-copy, which WebKit's WebGL `VideoFrame` upload already provides internally where possible). Fewer novel failure modes on the engine this plan is specifically trying to de-risk.
4. **Nothing in scope needs WebGPU.** No compute shaders, no storage buffers — 6 fragment-shader effects and texture uploads. WebGPU's advantages are irrelevant at this scope.

**Recommendation: WebGL2.** Conditions under which this would flip: (a) the scoped effects grow to need compute (e.g. optical-flow-based transitions, real-time scopes/histograms for grading at scale) *and* (b) the actual fleet is confirmed all-macOS-26+/WebGPU-verified-on-WebView2 — both must hold, and neither holds today. Revisiting is cheap later because the compositor's public interface (Section 4) is engine-agnostic: `VideoFrame`s in, canvas surface out.

---

## 3. Target Architecture

### 3.1 Design principle

One GPU compositor, one clock, zero retained per-layer state: `renderFrame({ textures, timelineTime, effectParams }) → drawn canvas`. Every scoped effect is a fragment shader selected + parameterized by uniforms derived purely from `(segment, currentTime)` — the same derivation for preview and, later, export. Pausing freezes it, seeking snaps it, and there is no second implementation to drift, no reveal to gate, no hold/release state machine to synchronize, because there are no layers: the transition, the animation transform, and the grade are applied in a single draw (or a short fixed chain) into one canvas.

### 3.2 New modules (all additive until the Phase 5 cutover)

```
src/services/gl/
  glContext.ts        — WebGL2 context acquisition on a dedicated canvas; context-loss/restore
                        handling (webglcontextlost/restored — re-create programs+textures);
                        capability probe (isWebGL2Supported(), memoized, mirrors webcodecsSupport.ts)
  glCompositor.ts     — the compositor class: owns programs, textures (2 video slots + image
                        textures), the fullscreen-triangle VAO; public API:
                        uploadFrame(slot, source: VideoFrame|ImageBitmap|HTMLImageElement),
                        renderFrame(params: CompositeParams) — synchronous, one draw
  shaders.ts          — GLSL ES 3.0 sources: blit, cross-dissolve, dip (parameterized color),
                        light-leak, zoom (UV transform), color-grade (brightness/contrast/
                        saturation/temperature) — the exact shaders the spike already proved
  compositeParams.ts  — PURE derivation: (segments, currentTime, projectEffectConfig) →
                        CompositeParams {transition?, progress, animScale, grade}. This is the
                        unit-testable heart — the same role toSourceTime/computeKeepSet play for
                        the decode side, tested the same mock-free way
src/hooks/
  useGlPreview.ts     — thin driver: pulls VideoFrames from the EXISTING videoDecoderPool
                        (unchanged), uploads to the compositor, calls renderFrame per tick;
                        replaces useTransitionPreview + the animation wrapper transform for
                        the scoped effects at cutover
```

### 3.3 Files modified (not replaced) at integration/cutover

`PreviewStage.tsx` — mount the compositor's canvas where `PreviewCanvas` sits today; at Phase 5 cutover, remove the transition-overlay canvas, `useTransitionPreview` wiring, and the zoom cases from the animation wrapper for the scoped effects. `EffectsPanel.tsx`/`effectsOptions.ts` — the 4 transition + 2 animation slugs map onto the new engine; color-grade controls added (Phase 4). `videoDecoderPool.ts`/`videoDemuxer.ts`/`usePlayback.ts` — **reused as-is, unmodified**; the pool's `getFrameAt` is already the per-tick frame source, and Item 4 B1's `transitionProtectedIds` API already keeps the outgoing segment's session alive through a transition window — the compositor consumes both without new pool surface.

### 3.4 Minimum runtime requirement (the no-fallback constraint, answered)

- **macOS: 13.3 (Ventura) — unchanged.** Set by the already-shipped WebCodecs decode dependency, not by WebGL2 (whose own floor is years lower). Machines below 13.3 today already don't get the WebCodecs preview path; after the no-fallback cutover the effects engine (like the default preview path before it) simply requires 13.3+. Ventura runs on ~2017+ Macs — a realistic floor for working YouTube-production machines, and one the fleet already lives under. **Flagged plainly:** if any of the 5–10 channels still runs a pre-2017 Mac / pre-Ventura macOS, it loses effects preview when the legacy CSS path is deleted; confirm the fleet before Phase 5's deletion step (this is a one-question survey, not telemetry).
- **Windows: any WebView2-capable Windows 10/11** — unchanged; WebGL2 is unconditional in evergreen Chromium.
- **GPU baseline:** anything with a working Metal/D3D11 driver (ANGLE's requirement — the same machines that run the app's existing GPU-accelerated `<video>`/canvas stack). Max-texture-size 16384 measured on the weakest current dev machine (Intel UHD 630) comfortably covers 4K.
- **What "no fallback" means precisely:** at Phase 5, the CSS/Framer transition+zoom preview paths and `useTransitionPreview.ts`'s snapshot machinery are **deleted** for the scoped effects, not gated. `isWebGL2Supported()` remains as a diagnostic (a clear error surface beats silent black), not as a router to a maintained second path.

---

## 4. Export-Readiness — Designing for the Unified WebCodecs Pipeline Without Building It (Part 4)

The end goal after this plan: decode (`VideoDecoder`, shipped) → composite (this engine) → encode (`VideoEncoder`, **BLOCKED** — unresolved, unquantified WKWebView hang risk; see `docs/webcodecs-architecture-plan.md` B0 entries + 2026-07-09 follow-ups and project-state.md's "Export rewrite: WebCodecs pipeline" Active Task). Sequencing this rebuild first only avoids building two rendering pipelines in parallel — **it does not reduce or resolve the `VideoEncoder` hang risk, which remains its own separately-tracked empirical problem.** This plan must not preclude the unification:

- **Input contract: `VideoFrame` (or `ImageBitmap`/`HTMLImageElement` for stills), never an HTML5 `<video>` seek.** Already satisfied by design — the spike proved the upload path, and the compositor takes decoded frames from the pool. This is the single property that makes the compositor reusable for export: an export orchestrator can drive the identical `uploadFrame`/`renderFrame` calls from a sequential decode loop instead of the playhead.
- **Output contract: a rendered canvas (WebGL2-backed) from which `new VideoFrame(canvas, {timestamp})` can be constructed** — the exact construction the B0-repro/mux-proof spikes already used successfully on this WKWebView to feed `VideoEncoder`. No PNG, no readback-to-CPU in the contract (readPixels exists for tests only).
- **What must be true for unmodified reuse once/if `VideoEncoder` unblocks** (design constraints actively adopted, not afterthoughts): (1) `renderFrame` stays synchronous and stateless per call — no internal rAF loop, no dependence on being driven at wall-clock rate, so an export loop can call it as fast as decode allows; (2) `compositeParams.ts` derivation depends only on `(segments, timelineTime, config)` — never on preview-only React state — so export derives identical params from the same function; (3) render resolution is a constructor/param concern (preview at stage size, export at 1920×1080), never hard-coded; (4) color: the compositor renders in sRGB exactly as the current canvas path does (export today *tags* bt709 without converting — `segmentEncoder.ts`; Phase C of the WebCodecs plan owns real color conversion, and this engine must simply not make that harder: keep the grade shader's math in normalized RGB so a color-managed variant can be slotted in).
- **Explicitly not built now:** no encoder wiring, no export orchestrator branch, no `useExport.ts` changes. Phase 6 includes a *proof* (composite a frame → construct a `VideoFrame` from the canvas → decode-verify its pixels) to keep the contract honest without touching export.

---

## 5. Feature Scope (Part 3 — confirmed, do not expand)

### 5.1 Transitions (4)
dip-to-black, dip-to-white, cross-dissolve, light-leak — all four already compile and pixel-verify on both engines (Section 2.2). Timing/progress semantics: driven by the same `resolveEffectiveTransition` + window math preview uses today; the known 100/0-split timing question (D7) is not re-litigated here.

### 5.2 Animations (2)
zoom in, zoom out — the `1.0 ± 0.05·t` scale math shared today by `getAnimationWrapperProps`/`canvasAnimations.ts`, as a UV transform (spike-verified). The other 11 `AnimationType`s stay on their current (post-A1, time-driven) implementations — out of scope for this cut.

### 5.3 Color grading (NEW feature area)
- **Manual controls — PROPOSAL, flagged as such:** brightness, contrast, saturation, temperature (each −1..+1, 0-neutral — the exact uniform set the spike's grade shader verified). Candidates deliberately deferred from v1: tint (green–magenta), highlights/shadows, vibrance. Per-segment first (matches every other effect field's granularity), with an "apply to all" following the `EffectsPanel` pattern.
- **Auto-adjust — PROPOSAL:** a simple histogram-based heuristic — sample the segment's first decoded frame (a small readback at analysis time only, never per-tick), compute luma percentiles, derive brightness/contrast offsets that stretch p2–p98 toward full range plus a gray-world temperature nudge; store the result as ordinary manual-control values the user can then edit. Keeps "auto" as a one-shot parameter generator, not a per-frame pipeline stage.

### 5.4 Explicitly out of scope
Overlay text/positioning (existing `SegmentControls.tsx`/DOM system stays untouched); the remaining 11 animations; filters (`getFilterStyle` CSS filters); heading overlays; any export-pipeline change.

---

## 6. Migration Phases

Each phase independently completable, testable, revertible; nothing deletes the legacy path before Phase 5.

- **Phase 0 — Feasibility spike. ✅ COMPLETE** (Section 2.2; produced with this document). GO on Chromium + real WKWebView; harness kept for the arm64/Windows re-runs.
- **Phase 1 — Core compositor.** Build `glContext.ts`/`glCompositor.ts`/`shaders.ts`/`compositeParams.ts` as pure additive modules with unit tests on `compositeParams` (mock-free, same style as `toSourceTime`'s tests) and context-loss handling proven by a forced `WEBGL_lose_context` test. No `PreviewStage.tsx` changes.
- **Phase 2 — Effects build-out.** All 4 transitions + 2 zooms behind the compositor API, pixel-verified against the spike's assertions promoted into repeatable checks; image-segment (still) texture path included — transitions must blend video↔image↔color segments, not just video↔video.
- **Phase 3 — Preview integration, dual-gated.** `useGlPreview.ts` drives the compositor from the existing pool behind `isWebGL2Supported() && devToggle` (the WebCodecs migration's proven Phase 1 discipline). Legacy path remains the shipped default. Verify: boundary crossings, pause/seek inside a transition window (the exact D12/B4 failure surface), drag-resize suppression, image↔video boundaries.
- **Phase 4 — Color grading.** Grade uniforms + manual controls UI + auto-adjust one-shot; per-segment persistence fields (`types.ts` addition).
- **Phase 5 — Cutover + deletion (the no-fallback step).** Dev toggle removed; `useTransitionPreview.ts` snapshot machinery, the transition-overlay canvas, and the wrapper zoom cases deleted for scoped effects. **Gate before deletion:** fleet confirmation per Section 3.4, and export parity spot-check (export still uses `frameRenderer.ts` unchanged — confirm preview-vs-export for the 6 scoped effects is not *worse* than today's parity).
- **Phase 6 — Regression + perf validation + export-readiness proof.** Manual regression pass on the real app (transitions across asset-type pairs, zooms with grades stacked, 500-segment fixture scrub-stress via `buildScaleFixture.ts`); the Section 4 canvas→`VideoFrame` proof; **re-run `spike-webgl.html` on macOS arm64 and a real Windows/WebView2 machine** — the two open platform gaps this session could not close.

---

## 7. Risk Register

| Phase | Risk | Why it matters | Mitigation direction |
|---|---|---|---|
| 1 | WebGL context loss (GPU reset, memory pressure) has no Canvas2D analogue — an unhandled loss is a permanently black preview | No-fallback means no second path hides it | `glContext.ts` handles `webglcontextlost/restored` from day one; forced-loss test in Phase 1, not discovered in production |
| 1/3 | A second GPU consumer (compositor) alongside the decode pool changes memory behavior vs. today's measured ~40MB band | The pool's LRU tuning (MAX_TOTAL_BUFFERED_FRAMES=150) was validated without a texture-holding neighbor | Textures are overwritten in place (2 video slots), never accumulated; re-measure with the 500-segment fixture in Phase 6 |
| 2 | Shader output ≠ today's Canvas2D output for the same effect (e.g. light-leak gradient shape, blend precision) | Users know today's look; a silently different render is a regression even if "prettier" | Spike already ported `alpha*(1-alpha)*4` shaping; Phase 2 diffs stills against the Canvas2D render per effect and accepts/documents each delta explicitly (A1's "export is the reference" discipline, adapted) |
| 3 | Per-tick `VideoFrame` upload during transitions doubles pool pull rate (both segments live) — the B1 `transitionProtectedIds` path gets its first heavy consumer | A pool starvation/eviction edge under dual-pull was exactly the class B3's chase-mutex reuse guarded against | Reuse the existing chase/protected-set primitives (do not build parallel ones — the B3 lesson); scrub-stress inside transition windows in Phase 3 |
| 3/5 | Preview/export parity for scoped effects *changes shape*: preview moves to GPU while export stays Canvas2D until the (blocked) VideoEncoder unification | The whole point is fewer divergences, not a new one | Keep shader math byte-portable from the shared formulas; Phase 5's parity spot-check gates cutover; the divergence window closes when export unifies (Section 4) |
| 5 | Deleting the CSS/Canvas2D path strands any fleet machine below macOS 13.3 | No-fallback is deliberate but must not be accidental for a real user | Section 3.4's one-question fleet survey is a hard Phase 5 gate |
| 6 | macOS arm64 / Windows WebView2 behavior unverified (this session: Intel Mac only) | 2 of 3 shipped binary targets lack first-hand GPU-path evidence | Kept spike harness re-run on both before merge — same closure path Phase 0's WKWebView gap used |
| all | `PreviewStage.tsx`/hooks keep evolving on `webcodecs-api`/`main` during this branch | Long-lived branch drift produced painful merges before | Rebase at phase boundaries; re-diff Section 1's file/line cites at each phase kickoff |

---

## 8. Rollback Plan

**What "rollback" means here — stated explicitly, since there is no fallback path once shipped:** through Phase 4, rollback is the same as the WebCodecs migration's: **don't merge the branch** — `webcodecs-api`/`main` still carry the fully-working current CSS/Canvas2D effects engine, untouched, and can stay on it indefinitely if this proves infeasible. The point of no return is **Phase 5's deletion commit**: after it, "rollback" means reverting that specific commit on this branch (the deleted code is additive-inverse recoverable from git), which is why Phase 5 is deliberately the *second-to-last* phase — cutover happens only after Phases 1–4 have run the new engine dual-gated against the old one in the real app, and Phase 6's validation runs against the post-cutover state before any merge.

**Merge-to-`webcodecs-api`/`main` gate criteria (all must hold):**
1. All 4 transitions + 2 zooms + grading verified in the real Tauri app across video↔video, video↔image, image↔image boundaries, including pause/seek/drag inside transition windows (the historical failure surface from Section 1.3).
2. The Item-4 symptom set (animation jump/disappear during transitions — the bug B4 could not fix) is confirmed **gone** on the new engine by explicit repro attempt.
3. 500-segment fixture: playback + scrub-stress with no context loss, no unbounded memory growth beyond the decode pool's established band.
4. Spike harness GO on macOS arm64 and Windows/WebView2 (or an explicit, documented decision to ship with one pending).
5. `tsc` clean, full `vitest` green, and a diff review confirming zero changes to the export pipeline files and `usePlayback.ts` (hard gate, as in the WebCodecs plan's 7.1 #6).
6. Fleet floor confirmed (Section 3.4).

---

## 9. Spike Artifacts — Kept, With Justification

**Kept and committed** (following the `f52ab12` precedent of retaining investigation harnesses): `spike-webgl.html` + `src/dev/webglFeasibilitySpike/main.ts`. Justification: (a) Section 2.2's GO verdict must be reproducible — the harness *is* the evidence chain; (b) Phase 6 and merge-gate #4 require re-running it unchanged on macOS arm64 and Windows/WebView2, exactly the role the retained B0-repro/mux-proof harnesses serve for the encoder question; (c) it is `tsc`-clean, imports nothing from app code paths, and is not part of any build output (root-level spike HTML files are dev-server-only, per the Phase 0 precedent). Deleted/not-committed: nothing else was created (the exfil listener + results live in the session scratchpad, outside the repo; the raw WKWebView result payloads are transcribed in Section 2.2's table).

**To re-run on a new platform:** start a local listener on `127.0.0.1:8799` (any HTTP server that logs POST bodies), temporarily set `tauri.conf.json`'s `devUrl` to `http://localhost:3000/spike-webgl.html` and add `http://127.0.0.1:8799` to the CSP's `connect-src`, run `npm run tauri:dev`, collect the `DONE` payload, kill the app, **revert both config edits** (verify zero git diff). On Chromium/WebView2 the on-page log + `window.__webglSpikeResult` suffice.
