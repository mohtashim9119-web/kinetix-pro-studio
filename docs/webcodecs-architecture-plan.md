# WebCodecs Architecture Shift — Phased Migration Plan

**Status:** **The entire phased migration plan (Phases 0 through 7+8) is now complete.** Phase 0 (proof-of-concept spike) confirmed GO on **both** Chromium and the real Tauri app's WKWebView. Phase 1+2 (combined) built real single- and multi-segment WebCodecs playback into `PreviewStage.tsx`, originally gated behind a capability check + an explicit dev-only toggle. Phase 3 (audio-sync integration hardening) proved the currentTime-to-frame mapping drift-free by construction (stateless, tested), verified pause/resume and per-segment speed changes correct, and fixed a real latency defect in rapid short-segment boundary crossing in `videoDecoderPool.ts`. Phase 4+6 (combined, scrubbing/seeking + frame cache/eviction for 500+ segment scale) rewrote `videoDecoderPool.ts` around a real windowed decode-ahead model with scrub-seek reset, pool-wide LRU eviction, and decoder-instance reuse by asset id, validated at 500-segment scale. Phase 5 (overlays/filters/animations/captions parity on the canvas path) found filters/overlays/captions/animations all needed no new code (inherited via existing style-prop passthrough, DOM layering, and the shared CSS wrapper), while manual testing surfaced and fixed four real pre-existing decode-session-lifecycle bugs plus a deeper architectural gap in the windowed decode-ahead model's use of `flush()` — initially only contained, then properly root-caused and fixed in a dedicated follow-up. **Phase 7+8 (combined, completed 2026-07-05) is the final cutover:** the dev-only toggle is now removed — `isWebCodecsPreviewSupported()` alone decides the path for every user, unconditionally, on every supported runtime — and a full regression pass plus 500-segment performance validation re-ran against this real default path, finding no code regressions (only a preview-tooling artifact and a pre-existing, unrelated heading-video bug, both correctly out-of-scope). All 6 of Section 7.1's merge-gate criteria pass. See "Phase 0 Results", "WKWebView Cross-Check" below, and the Progress Tracker immediately below this line for current state at a glance.

**Branch:** `webcodecs-api` (off `main` @ `d8cc5db`). `main` is not touched until this effort is reviewed and merged.

**Scope:** Preview playback only (`PreviewStage.tsx` and the hooks that feed it). The export pipeline (`frameRenderer.ts`, `segmentEncoder.ts`, `exportPipeline.ts`, `plainSegment.ts`, the native ffmpeg sidecar) is out of scope and must not be modified or behaviorally affected by any phase of this work.

**Origin of this effort:** `docs/bugs/preview-cold-start-clock-freeze.md` — a confirmed, root-caused bug where a `<video>` element that has never played will not reliably start its media clock on `.play()` inside the Tauri webview, even at `readyState=4`. Every patch attempted at the `<video>`-element layer either failed or traded the freeze for a different regression (see that doc's "Fixes Attempted" log). This plan treats that bug as unfixable at the `<video>`-element layer and replaces the layer instead of patching it further.

---

## Progress Tracker — Read This First

This section is the single source of truth for where this effort stands, independent of any chat session or Claude Code instance. Read this first before reading anything else in the document or in past chat history. The detailed sections below (numbered 1–7, plus "Phase 0 Results" and "WKWebView Cross-Check") hold the full reasoning and evidence — this tracker only summarizes and points to them; it does not replace their detail, and it is not itself a substitute for reading Section 5 before implementing a phase.

### ✅ COMPLETED

- **Phase 0 — Proof-of-concept spike.** Full detail in the "Phase 0 Results" and "WKWebView Cross-Check" sections below. Concrete outcomes:
  - `VideoDecoder`/`EncodedVideoChunk` confirmed present and a real `configure()`/`decode()` cycle confirmed working, on **both** Chromium and the real Tauri app's WKWebView.
  - `mp4box.js` integrated as the demuxer (chosen per Section 1.4, no alternative needed). Two non-obvious integration bugs found and fixed — both documented inline in `src/dev/webcodecsSpike/main.ts` for whoever builds Phase 1: (1) calling `flush()` after a single whole-file `appendBuffer()` caused mp4box to discard buffered `mdat` bytes before extraction ran — fixed by calling `setExtractionOptions()`/`start()` from inside `onReady` and never calling `flush()` for a single-shot append; (2) `createFile()`'s default `keepMdatData: false` discards the bytes a non-streamed caller needs back — fixed with `createFile(true)`.
  - Decoded `VideoFrame`s paint correctly to canvas on both engines (312/312 real frames from a real Pexels H.264 asset, visually confirmed via screenshot on Chromium and via Console-log readback on WKWebView).
  - **B-frame reordering confirmed correct (monotonic presentation-order output) on both Chromium and WKWebView** — this was the single biggest open risk this plan flagged (Sections 1.1, 1.2, and the Section 6 risk register), and it is now resolved for both engines this app ships to.
  - Throughput measured: ~365–380 fps on Chromium, ~303 fps on WKWebView (both comfortably above 10× the source's 30fps — not a feasibility concern at this single-video scale; says nothing yet about Phase 6's multi-segment decode-ahead load).
  - **Read this if you find old logs/screenshots that look like a failure:** an intermediate WKWebView run appeared to show "Check 4: false" with "936 chunks fed" instead of the real 312. This was **never a WKWebView defect** — it was a test-harness bug (the harness's `result` object was declared at module scope and never reset between repeated manual "Re-run" clicks, so three runs' worth of samples concatenated into one array and broke monotonicity at the run boundaries, purely as an artifact of the harness, not the decoder). The harness was fixed (fresh `SpikeResult` object constructed inside every `runSpike()` call, plus a logged per-run invocation counter) before the clean, trusted result was captured. If you encounter any earlier artifact claiming WKWebView reordering failed, it predates this fix — trust the "Clean single-run WKWebView result" table in the "WKWebView Cross-Check" section instead, not any "936"/`false` reading.
  - Committed together with this tracker entry in the commit titled `docs+spike: Phase 0 WebCodecs feasibility spike complete (Chromium + WKWebView confirmed) + progress tracker` — run `git log --oneline -- docs/webcodecs-architecture-plan.md` for the exact hash (not embedded literally here since this tracker entry is itself part of that same commit's content).

- **Phase 1+2 (combined) — Single- and multi-segment WebCodecs playback, dev-toggle-gated, first real integration into `PreviewStage.tsx`.** Built per Section 3.2's module list; all five new files plus the `PreviewStage.tsx` integration are real, become-permanent code (not a throwaway harness like Phase 0), gated off by default. Concrete outcomes:
  - **`src/services/webcodecsSupport.ts`** — `isWebCodecsPreviewSupported()`, memoized `'VideoDecoder' in window` check, exactly as Section 3.2 specifies.
  - **`src/services/videoDemuxer.ts`** — wraps mp4box.js; `getOrCreateDemux(url)` caches one demux per unique asset URL (mirrors `frameRenderer.ts`'s `getOrCreateVideo` dedup pattern), returning `{ config, chunks, durationSec }`. Carries forward both Phase 0 spike fixes verbatim: `setExtractionOptions()`/`start()` called from inside `onReady` with no `mp4boxFile.flush()` call anywhere, and `createFile(true)` for `keepMdatData`.
  - **`src/services/videoDecoderPool.ts`** — `VideoDecoderPool` class; one `VideoDecoder` session per segment id, keyed and cached independently of the demux cache (so two segments trimming the same source file each get their own decode session/cursor). Decode-ahead scope is exactly "current + next segment" per Phase 1+2's stated scope, not the full seconds-windowed cache Section 4 describes for Phase 6 — each session decodes its whole trimmed frame range up front (capped at `MAX_SESSION_FRAMES` = ~600 frames as a safety net), and `getFrameAt()` closes every buffered frame it supersedes plus the previously displayed frame, immediately, every call. `releaseSession()`/`dispose()` close every remaining buffered `VideoFrame` and the underlying decoder. This whole-segment-up-front approach is a deliberate, documented simplification versus Section 4.2's rolling few-second window — correct and leak-free at today's typical segment lengths, but Phase 6 is expected to replace it with real LRU windowing before 500+ segment scale.
  - **`src/hooks/useWebCodecsPreview.ts`** — takes `segments`, `assets`, `currentTime`, and (deviation from the plan's literal wording, see below) `currentSegment` directly, plus an `enabled` flag. Implements Section 3.5's boundary-crossing model: releases any session that isn't the current or next segment, ensures a session for the current segment and preemptively for the next, and pulls the frame at the current playhead's mapped source-time out of the (already warm) current session. `enabled: false` makes the hook fully inert (no session creation, no decode) — this is what keeps the new path from ever activating for a real user when the dev toggle is off, even on a WebCodecs-capable runtime.
  - **`src/components/PreviewCanvas.tsx`** — minimal, as scoped: draws whatever `VideoFrame` it's given via `object-cover`-equivalent crop math, accepts an optional `style` prop so the existing CSS clip-effect filters keep applying. No overlays/filters/animations/captions baked in (Phase 5, per the plan).
  - **`PreviewStage.tsx` integration** — a **scoped** branch, not a wholesale top-level duplicate of the ~1000-line component. `isWebCodecsPreviewSupported() && webCodecsDevToggle` (persisted to `localStorage['kinetix:dev:webcodecsPreview']`, toggled via a dev-only floating button, `import.meta.env.DEV`-gated) gates: (1) a single early-return line inside the existing dual-`<video>`-slot segment-change effect (`if (useWebCodecsPathRef.current) { setCoverState(null); return; }`, read via ref so toggling mid-session doesn't need a `currentSegment` change to take effect) so the legacy machinery stops touching the `<video>` elements for a video segment when the new path owns it, and (2) an additional `<PreviewCanvas>` layer painted above the (now-inert) legacy video slots and cover. Everything else in `PreviewStage.tsx` — heading rendering, captions, extra overlays, the transition overlay canvas, fullscreen, corner stats — is untouched and shared by both paths. This is a deliberate interpretation of Section 3.3's "capability-gated branch" language: Section 3.3 itself says "actual line-level changes happen gradually across Phases 1–7, not in one shot," and overlays/captions/headings are explicitly out of scope until Phase 5, so branching only the video-paint mechanism (rather than duplicating ~1000 lines of unrelated JSX two ways) keeps the legacy path's behavior verifiably unchanged by inspection while still satisfying "new path only activates when both capability and dev toggle are true."
  - **Deviation — `useWebCodecsPreview.ts` takes `currentSegment` as a parameter instead of re-deriving it from `segments`/`currentTime`.** Documented in the hook's own file header. Reason: `App.tsx` already computes `currentSegment` via `useMemo` with resize-drag-freeze semantics (`isResizingRef`/`lastStableSegmentRef`, see CLAUDE.md's App.tsx entry) and passes it down to `PreviewStage.tsx` as a prop; re-deriving it with a plain `.find()` inside the new hook would silently diverge from that during a timeline resize-drag — the exact class of bug the D12 fix (`be45b07`) exists to prevent for the legacy path. Taking the already-correct value as a parameter avoids reintroducing that bug class in the new path.
  - **`useTransitionPreview.ts` compatibility (Section 3.3's open question) — confirmed compatible, zero changes needed.** `useTransitionPreview` never reads from `useWebCodecsPreview`'s frame output or from `PreviewStage`'s `<video>` slots at all — it renders its own outgoing/incoming snapshots independently via `frameRenderer.ts`'s `renderSegmentFrame()` (which seeks its own offscreen `<video>` elements via `getOrCreateVideo`, a completely separate code path from both the legacy dual-slot machinery and the new WebCodecs decoder pool). Since `frameRenderer.ts` is on this plan's explicit do-not-touch list, `useTransitionPreview.ts` is guaranteed byte-for-byte unmodified in behavior regardless of which video path is currently painting the live segment. Verified in the manual test below: transitions were not exercised (test fixture used `TransitionType.NONE`), but the code-path independence is structural, not timing-dependent — no further validation is needed to trust this finding. Section 3.3's speculative "may need a WebCodecs-aware variant" concern does not apply; no fix is needed, now or in a later phase, for this specific compatibility question.
  - **Unit tests** — `src/services/videoDemuxer.test.ts` (4 tests: `createFile(true)` called, `setExtractionOptions()`/`start()` sequencing from `onReady` with implicit flush()-regression protection since the mock has no `flush` method to call, per-URL caching, reject-without-poisoning-cache on a trackless asset) and `src/services/videoDecoderPool.test.ts` (10 tests: `findChunkRange`'s keyframe-backup/margin/empty-list logic, plus `VideoDecoderPool` frame selection, supersession-closes-the-old-frame, `releaseSession`/`dispose` closing every buffered frame and the decoder, and `ensureSession` idempotency/replacement). All mock-based (`vi.mock('mp4box', ...)`, a hand-rolled `MockVideoDecoder`/`MockVideoFrame`, no real video files) — 16 new tests, all passing. Full suite: 76/76 passing, `tsc --noEmit` clean.
  - **Manual verification (Chromium, via this environment's browser-preview tooling)** — a real two-segment project was fabricated (both segments trimming different halves of the same real Pexels H.264 asset from the Phase 0 spike, `public/_spike/sample.mp4`, via a direct IndexedDB + localStorage fixture — no UI file-upload automation was available in this environment) and driven through the actual running app:
    1. Toggling the dev flag ON showed the "WEBCODECS PREVIEW (DEV)" badge and produced a canvas with real, non-blank decoded pixel data (sampled via `getImageData`) — confirmed via console log inspection that only one `fetch` of the shared source asset occurred despite two segments referencing it (demux cache dedup working) and zero console errors.
    2. Clicking to segment 2's start (t=5.00s, the segment boundary) showed a **different** decoded frame than segment 1's frame (confirmed via pixel sampling), with no black flash and no console errors — Section 3.5's boundary-crossing model verified working end-to-end in the real app for the first time.
    3. Toggling the dev flag OFF immediately reverted to the legacy dual-`<video>`-slot rendering (badge disappeared, correct frame still displayed, playback still functioned), confirming zero regression to the default path.
  - **What was deferred / simplified, on purpose, per the judgment calls this task authorized:**
    - Real seconds-windowed decode-ahead + LRU eviction (Section 4) — not built; Phase 1+2 uses whole-segment-up-front decode (see `videoDecoderPool.ts` note above). Explicitly Phase 6 scope per the plan's own phase breakdown.
    - Scrubbing/rapid-seek robustness (Phase 4) — `useWebCodecsPreview.ts` will correctly decode a fresh session if `currentTime` jumps to an untracked segment (since `ensureSession` is keyed by segment id + range), but rapid back-and-forth scrubbing within a session's already-decoded range hasn't been stress-tested; that hardening is explicitly Phase 4 scope.
    - Overlays/filters/animations/captions on the canvas path (Phase 5) — not built; `PreviewCanvas.tsx` paints the bare frame only, exactly as scoped. The surrounding DOM layers (captions, extra overlays, headings) still render correctly since they're shared, untouched code — only the video pixels themselves come from the new path.
    - Long-run audio/drift hardening (Phase 3) — not exercised beyond the ~10s manual test above; dedicated long-timeline drift testing remains Phase 3 scope.

- **Phase 3 — Audio-sync integration hardening.** `usePlayback.ts` confirmed unmodified (diff-checked before and after this phase). Concrete outcomes:
  - **Tolerance defined and verified: one source-frame duration (1/fps — ≈0.033s at the sample asset's ~29.97fps).** This is not an arbitrary choice — `videoDecoderPool.ts`'s `getFrameAt` has always resolved "the latest decoded frame at or before the requested target," so the best any currentTime→frame mapping can do is bounded by the gap between two consecutive decoded frames. `toSourceTime`/`sourceRange` (`useWebCodecsPreview.ts`) are pure, stateless functions — every call recomputes purely from the segment object and the `currentTime` value handed in, with no accumulator or internal clock — so there is no mechanism by which repeated calls over a long playback run could accumulate drift; each call is independently correct to within that one-frame bound or it is wrong outright (a mapping bug), never "slightly more wrong than last time." This is proven directly (not just argued) in `src/hooks/useWebCodecsPreview.test.ts`'s "long-timeline, no accumulating drift" tests, which simulate a steady 60fps tick across a synthetic 10-minute, 8-segment timeline and assert zero growth in mapping error.
  - **Long-timeline drift — verified via the stateless-mapping tests above, not a real long-duration asset.** Scope limitation: this repo's only available real test asset is the Phase 0 spike's `public/_spike/sample.mp4` (10.4s, H.264, 1280×720, ~29.97fps). There is no multi-minute real asset available in this environment to drive an actual wall-clock long-run. Given `toSourceTime`/`sourceRange` are pure and stateless (no per-tick accumulator anywhere in the currentTime→frame path), a synthetic long-duration test of the mapping math is representative of the real risk (accumulating error), which by construction cannot occur here — but this has not been confirmed by an actual multi-minute decode run against real video data (decoder throughput/memory behavior over minutes of real frames, as opposed to the mapping math, remains empirically unverified). Flagged as a residual scope limitation for whoever next has access to a longer real asset, or for Phase 6's synthetic 500-segment project work, to close.
  - **Play/pause/scrub interleaving — verified manually and via tests.** Manually: built a real 6-segment, ~10.4s fixture from `sample.mp4` (via direct IndexedDB/localStorage injection, same approach as Phase 1+2's manual test) with three consecutive short segments (1.1s/1.2s/1.3s, matching the original cold-start bug's scale) in the middle. Played the full timeline start-to-finish (loops back to 0 cleanly, matching `usePlayback.ts`'s no-voiceover end-of-timeline behavior — this repo has no long/short voiceover asset available either, so the no-voiceover `setInterval` clock path was exercised rather than the rAF/audio-clock path; the two paths differ only in how `currentTime` advances, not in how this hook consumes it, so this is not expected to be a meaningfully different case for the hook, but is noted as the same asset-availability limitation as above). Paused mid-segment and resumed repeatedly, including one resume that landed inside a short segment shortly after a boundary crossing — no stale frame, no skip-ahead, no re-decode glitch, zero console errors across the whole session. Proven structurally via `useWebCodecsPreview.test.ts`'s "pause/resume" tests: a `currentTime` held constant across repeated calls (simulating a pause of any length) always maps to the identical source time, and a resume at the same or a nearby `currentTime` maps correctly relative to it — there is no timer or interval owned by this hook that could produce a "stale" or "skipped" read independent of what `currentTime` itself reports.
  - **playbackRate / speed changes — investigated; no code change needed; finding documented in `useWebCodecsPreview.ts`.** Two speed knobs exist in this codebase: `globalPlaybackSpeed` (per-project) and `segment.playbackSpeed` (per-segment). Investigation finding, added as a comment directly on `toSourceTime`: `globalPlaybackSpeed` needs no reinterpretation in the WebCodecs path because this hook has no internal clock to keep in step with real wall time — every call is a pull ("what frame corresponds to this `currentTime`"), and `currentTime` already reflects whatever real-time pace `usePlayback.ts`'s `audioRef.current.playbackRate = globalPlaybackSpeed` produces. The legacy `<video>`-element path needs `activeEl.playbackRate = segment.playbackSpeed * globalPlaybackSpeed` (`PreviewStage.tsx`) only because a `<video>` element runs its own internal clock that has to be told to advance at the same real-time pace — a problem this hook does not have. `segment.playbackSpeed` (the per-segment source-time stretch) was already correctly handled pre-Phase-3, unchanged in this phase. **Scope limitation discovered during investigation, not introduced by it:** as of this phase, `globalPlaybackSpeed`'s setter (`setGlobalPlaybackSpeed`, `App.tsx`) is never called from any UI control — the feature is fully unwired app-wide (consistent with the `MIN_PLAYBACK_SPEED`/`MAX_PLAYBACK_SPEED` "UI is hidden — feature deferred" comment at `App.tsx`), and the per-segment `editingSegment` modal that exposes `segment.playbackSpeed`'s +/- controls is likewise never opened by any reachable click handler in the current build. Neither speed control could be manually exercised live, in-app, for this reason (pre-existing to this phase, not a regression). Verified instead via: (a) the architectural analysis above, (b) direct unit tests of `toSourceTime` reacting correctly and immediately to a changed `segment.playbackSpeed`, and (c) a manual end-to-end check with a segment's `playbackSpeed`/`trimEnd` pre-set to 2×/6.9s in the fixture (not changed live) — played across its boundaries cleanly with no errors, confirming the wider-than-1:1 decode range this produces (`sourceRange`) decodes and paints correctly.
  - **Rapid segment-boundary crossing (short segments, ~1.09-1.3s range) — one real fix made, in `videoDecoderPool.ts`.** Static analysis of the pre-Phase-3 code found the boundary-crossing/eviction/generation-guard logic already correct (no frame is ever shown for the wrong `currentTime`, verified by tracing every `await` point in `startSession`/`getFrameAt`/`ensureSession`/`releaseSession` against every interleaving a fast crossing could produce) — but found one real latency defect: `getFrameAt` unconditionally awaited the *entire* session's decode (`session.ready`, i.e. every frame up to `MAX_SESSION_FRAMES`) before returning a frame, even when the frame answering the current query had already arrived. For a short segment whose decode-ahead hadn't finished by the time playback reached it, this meant freezing on the outgoing segment's last frame for the *whole remaining decode* of the next one, not just until its own target frame was ready — exactly the "falls behind" failure mode this item asked to be hardened against. **Fix:** added `VideoDecoderPool.waitForCoverage()` — `getFrameAt` now resolves as soon as a frame strictly past the requested target has been buffered (which fully determines the "latest at-or-before" answer), falling back to waiting for the full session only when the target is beyond everything decoded so far. `releaseSession`/`closeSession` explicitly settle any in-flight waiters (returning `null`, matching existing behavior) so a session evicted mid-decode by a fast crossing can never leave a caller hanging. Regression-tested in `videoDecoderPool.test.ts` with a new `ControllableVideoDecoder` mock that separates `output` events from `flush()` settlement (the existing `MockVideoDecoder` couldn't represent this — it always emits everything synchronously inside `flush()`, which is exactly why every pre-Phase-3 test hit the fast path and never exercised this bug): one test proves the pre-fix code times out (verified by temporarily reverting the fix and confirming the exact new test fails on a 3s timeout, then re-confirming it passes with the fix restored — not just "written to pass"), plus tests for the exactly-at-target boundary case and for eviction settling a pending call. Manually verified end-to-end: the three consecutive short segments (1.1s/1.2s/1.3s) in the fixture above played through with no visible freeze or console error, both at 1× and with one of them reconfigured to a 2× per-segment `playbackSpeed` (wider decode range, same short on-timeline duration).
  - **Testability refactor (no behavior change):** `toSourceTime`, `sourceRange`, and a new pure `computeKeepSet()` (extracted from the eviction effect's inline `Set` construction, same logic, just named and exported) are now exported from `useWebCodecsPreview.ts` — this repo has no React hook-testing harness (`jsdom`/`@testing-library/react` are not installed, and this phase deliberately did not add them, consistent with "mirroring the mock approach already used in Phase 1+2's `videoDecoderPool.test.ts`" rather than introducing new test infra), so the currentTime-to-frame mapping and the boundary-crossing keep-set are tested as pure functions directly rather than through a rendered hook.
  - **New tests:** `src/hooks/useWebCodecsPreview.test.ts` (18 tests — long-timeline/no-drift, pause/resume, speed-change-invariance, rapid short-segment mapping, `computeKeepSet` eviction policy) + 4 new tests in `src/services/videoDecoderPool.test.ts` (early-coverage resolution, still-waits-when-uncovered, release-settles-pending-waiter, exactly-at-target). Full suite: 95/95 passing (was 76/76 before this phase), `tsc --noEmit` clean.
  - **Manual verification (Chromium, via this environment's browser-preview tooling)** — real 6-segment fixture built from `public/_spike/sample.mp4` (same fixture technique as Phase 1+2): full playthrough start-to-finish with no errors; seek-to-segment + pause + resume repeated across several segments including short ones; a segment's `playbackSpeed=2`/wider `trimEnd` variant played cleanly across its own boundaries. Toggling the dev flag on/off confirmed the badge and canvas behavior matched Phase 1+2's already-verified findings (not re-litigated here). No console errors, no failed-request anomalies beyond the pre-existing, unrelated `useFirstFrameCache.ts` offscreen-video abort noise (present on `main` today, not introduced or touched by this phase).
  - **What remains explicitly out of scope / carried forward:** real multi-minute asset drift validation (scope limitation above, no such asset available in this environment); scrubbing/rapid-seek stress (unchanged from Phase 1+2's note — still Phase 4); the `MAX_SESSION_FRAMES` (600-frame) cap can still under-decode a segment whose `duration × playbackSpeed` source range exceeds ~20s at 30fps, freezing on the last decoded frame for the remainder — this is pre-existing, orthogonal to the four items this phase targeted (it's about segment *length* combined with per-segment speed, not `globalPlaybackSpeed` or boundary-crossing pacing), not hit by this app's typical short/voiceover-paced segments, and squarely Phase 6's real-windowing scope to fix properly rather than a band-aid here.

- **Phase 4+6 (combined) — Scrubbing/seeking support + frame cache/eviction for 500+ segment scale.** `videoDecoderPool.ts` rewritten (Phase 1-3's whole-segment-up-front decode model replaced outright, not extended) per Section 4's exact design; `useWebCodecsPreview.ts` updated to drive it. Concrete outcomes:
  - **Windowed decode-ahead (Section 4.2).** A session no longer decodes its entire trimmed range up front — it feeds the decoder a rolling `WINDOW_AHEAD_SEC = 1.5`s window around whatever source time was last requested, extending forward as playback advances (no reset needed for steady progress) and re-seeding to the nearest keyframe on a genuine jump (see below). Verified via a new `makeLongDemuxed()`-based test suite: a 6-second/180-frame synthetic segment feeds only ~45 frames (one window) up front, not all 180 — the exact scaling property Section 4.1 needed (memory bounded by window size, not segment length).
  - **Scrub-seek reset, both directions.** `needsReset()`/`resetSessionWindow()` detect when a requested target falls behind what's still retained (backward scrub) or beyond the fed-plus-lookahead frontier (a jump bigger than steady playback ever produces), and re-seek to the nearest keyframe at-or-before the new target rather than decoding everything in between. This also **fixes a real pre-existing correctness bug**: the Phase 1-3 model's per-call eviction (close every frame older than the current selection) had no way to answer a backward-scrub query once those frames were closed — it would have silently returned a later, wrong frame. Now regression-tested directly (`videoDecoderPool.test.ts`'s "re-seeks correctly on a backward scrub" test) and confirmed via a from-scratch reset trace that a large forward jump feeds roughly one GOP's worth of new chunks, not everything between the old and new position.
  - **LRU eviction across all sessions, not just hard-release-outside-current/next.** `setProtectedIds()` marks {current, next} as exempt; anything else is eligible once the pool exceeds `MAX_CACHED_SESSIONS = 3` or `MAX_TOTAL_BUFFERED_FRAMES = 150` (Section 4.3's literal "3 segments' worth of window" starting point), evicted least-recently-used first. This is *more* permissive than Phase 1-3 (which released non-current/next immediately) — deliberately, per the Section 6 risk register's own instruction to design the window/eviction policy against scrub-stress from the start: a small number of recently-visited-but-not-current sessions now survive long enough that back-and-forth scrubbing across neighboring segments doesn't force a cold reseek every time.
  - **Decoder-instance reuse by asset id (Section 4.2, previously only achieved for the demuxer).** A small per-asset-URL idle pool of `DecoderHandle`s: a released (non-errored) decoder is `reset()` and parked for the next session needing the same asset, instead of being closed and reconstructed. Because a real `VideoDecoder`'s `output`/`error` callbacks are fixed at construction, reuse is implemented via a stable per-handle wrapper callback that dispatches to whichever session currently owns the handle (`handle.activeSession`), proven correct via a "same decoder instance reused" test and a "does NOT share a decoder between two simultaneously-active sessions of the same asset" test.
  - **A real concurrency bug found and fixed during this rewrite:** a session evicted while its own `feedWindow()`/`flush()` batch was still in flight could have its decoder handle handed to a brand-new session before the old batch's output was guaranteed to have stopped — `closeSession()` now closes such a handle outright instead of pooling it for reuse, accepting the lost reuse opportunity in that one case in exchange for correctness. Documented inline in `videoDecoderPool.ts`.
  - **`VideoFrame.close()` discipline audited and extended**, not just carried forward: eviction now closes every buffered frame of an evicted session (proven via a dedicated test asserting frames *ahead* of the display position — not just the displayed one — get closed too), and the decoder-handle idle pool is bounded (`MAX_IDLE_DECODER_HANDLES_PER_ASSET = 2`) and fully drained on `dispose()`.
  - **Scrub coalescing (Phase 4, Part A).** Timeline.tsx's mousemove-driven drag-to-seek calls `onSeek`/`setCurrentTime` synchronously and unthrottled (confirmed by reading the file — not touched, per the file-scope restriction), so a fast drag can produce dozens of `currentTime` updates per second. `useWebCodecsPreview.ts`'s frame-pull effect no longer issues one `pool.getFrameAt` call per tick; it records the latest requested target and runs a "chase latest target" loop (`chaseLatestTarget`, extracted as a pure, directly-testable function) that keeps at most one decode call in flight, always chasing the newest position — every intermediate scrub position in between is skipped rather than separately decoded. A real VideoDecoder decode can't be cancelled once issued, so this is what "deprioritize decode work for positions the playhead has already moved past" means in practice.
  - **A real deadlock found and fixed in the coalescing mutex.** An earlier version reset the "chase in flight" mutex only when a staleness (generation) check passed — mirroring the guard used to avoid *painting* a stale result, but wrongly applied to the *mutex release* too. Since the mutex already guarantees at most one chase is ever in flight, gating its release on anything else could leave it permanently stuck `true` if a segment change happened while the chase was still resolving — freezing the WebCodecs canvas permanently (found via manual scrub-stress testing: canvas went black mid-playback and never recovered, no thrown error). Fixed by extracting the mutex logic as its own function, `startChaseIfIdle`, whose release is unconditional; pinned directly with a dedicated regression test ("releases the mutex even when onSettled reports the caller considers its own result stale — the exact deadlock scenario").
  - **A real crash found and fixed in `PreviewCanvas.tsx`.** Under load, a `VideoFrame` handed to the component via props could be closed (by pool eviction/scrub-reset elsewhere) before the paint effect actually ran `ctx.drawImage`, throwing `"Failed to execute 'drawImage' ... The VideoFrame has been closed"` and crashing the whole preview via `ErrorBoundary`. This is an inherent hazard of any pool-managed `VideoFrame` crossing an async render boundary, not a bug isolable to one call site — fixed by treating a closed-frame draw as "nothing to paint this tick" (try/catch around the draw, plus a `0x0`-dimension check for engines that report a closed frame's size as zero instead of throwing) rather than trying to eliminate the race at its source.
  - **Cold-scrub initial-window seeding.** `ensureSession()` gained an `initialTargetSec` parameter (defaults to the segment's own start): the *current* segment's decode-ahead call seeds its first window at the actual playhead position (read once, at the render where `currentSegment` itself changed) instead of the segment's start, so a cold scrub landing mid-segment doesn't waste a decode-from-start pass immediately superseded by a reset. Decode-ahead for the *next* segment still seeds at its own start (correct for normal forward-boundary-crossing).
  - **Synthetic 500-segment fixture — `src/dev/buildScaleFixture.ts` (new, reusable for Phase 8 per the plan).** Not imported by any real app file (same throwaway-tool convention as Phase 0's spike). Builds and persists a project with N segments (exercised at 500), all sharing one `Asset` (the Phase 0 spike's `public/_spike/sample.mp4`, 10.4s H.264 — **scope note, same limitation as Phase 0/3: no other/longer real video asset is available in this environment**, so segments cycle through ~17 rotating `[trimStart, trimEnd]` windows of the same 10.4s source rather than each having distinct real footage), and sets it as the last-opened project so a reload opens it directly. Invoked via dynamic `import()` from the browser devtools console against the running dev server.
  - **Manual verification (Chromium, via this environment's browser-preview tooling), and where it stopped.** Early in this testing session, cold scrub-seeks to arbitrary, never-visited positions across the real 500-segment/300s fixture were confirmed working end-to-end via screenshots (correct, distinct decoded frames painted at both t=172.38s and t=66.42s, no black flash, no console errors) — this is the same class of verification Phase 1+2 did at 2-segment scale, now confirmed at the target 500-segment scale. Memory was measured via `performance.memory` across repeated scrub-stress rounds: a narrow-band rapid back-and-forth thrash (the case the windowed/LRU model specifically targets) cost **~2.4MB** above a ~36MB baseline and stayed flat; a full-timeline wide sweep touching most of the 500 segments peaked **~22.5MB** above baseline and settled back down to baseline within a few seconds of the scrubbing stopping in every trial — no unbounded growth, consistent with the windowed+LRU design. **However**, later in this same long session — after very heavy, sustained, repeated stress testing (many fixture reloads, many full-timeline sweeps, hundreds of `VideoDecoder` constructions) — this specific browser session's video decode pipeline degraded to the point where even a bare, app-code-free `new VideoDecoder().configure()+decode()+flush()` call (no app code involved at all) hung indefinitely and never produced output. This was confirmed to affect the pre-existing, unrelated `useFirstFrameCache.ts` legacy `<video>`-element mechanism identically, and to persist across page reloads and across restarting the dev preview server — implicating the underlying browser/GPU process on this machine from cumulative decode load across the session, not application code. **This means the two bug fixes above (the crash and the deadlock) were verified correct by code inspection, targeted unit tests, and the mechanism's proven-working state earlier in the same session, but could not get a final clean end-to-end re-confirmation after being applied, in that session.**

  - **Fresh-session re-verification (2026-07-04) — both fixes confirmed holding.** A genuinely fresh dev server and fresh browser session were started (not a reload of the degraded session above) specifically to rule out that prior finding. The exact sequence was re-run: rebuilt the real 500-segment/300s fixture via `buildScaleFixture(500)`, toggled the WebCodecs dev flag on, and let `useFirstFrameCache`'s warm-up run to completion undisturbed (498-500/500 frames cached, matching the earlier clean run) before any stress. Heavy, sustained scrub-stress was then driven via synthetic `mousedown`/`mousemove`/`mouseup` sequences on the timeline (the same code path a real drag exercises, since `Timeline.tsx`'s handler is unthrottled and synchronous): 7 rounds of narrow-band boundary-crossing thrash (~4s bands centered on 7 different timeline positions including the very start and end, ~1050 dispatched moves total), multiple full-timeline wide sweeps end-to-end (0→300s and back, ~245 dispatched moves), and an interleaved tight-thrash/random-wide-jump round (~800 dispatched moves) — roughly 2,100 scrub events in total, well beyond the load that originally surfaced both the crash and the deadlock. Result: zero crashes, zero frozen/black canvas, zero console errors or warnings at any point (only the pre-existing, unrelated `useFirstFrameCache` `//FFCACHE` diagnostic logging and its already-documented blob-fetch abort noise appeared). Playback was resumed after the stress sequence (seek + spacebar play) and advanced correctly across multiple segment boundaries with correct, changing decoded frames and no residual errors. `performance.memory` stayed in a bounded ~34-40MB band throughout the entire session (fixture-load baseline ~13MB → post-warm-up ~40MB → after all stress rounds, settled ~37MB) — a narrow-band thrash round measured in isolation cost **~4.6MB** above its immediate pre-thrash reading (same single-digit-MB order as the original ~2.4MB reading; heap-measurement noise accounts for the difference) and stayed flat afterward, with no unbounded growth observed across the whole run. This confirms the VideoFrame-closed-before-paint crash fix and the scrub-coalescing mutex deadlock fix both hold under fresh-session conditions, closing the residual verification gap the previous session's browser/GPU degradation had left open. Full unit suite re-confirmed **113/113 passing**, `tsc --noEmit` clean.
  - **Cold scrub-seek latency target: under ~250ms to first correct frame.** Derived from Phase 0's measured decode throughput (~300-380fps) applied to one window's worth of frames (~45 @ 30fps ≈ 120-150ms of pure decode compute) plus keyframe-seek overhead — not independently stopwatched in this session, because this environment's canvas pixel readback (`getImageData`) returned all-zero data even for content visibly correct in screenshots (confirmed via a direct pixel-value check against known-visible content), which is what a frame-arrival timing probe would have needed; this is a tooling/sandboxing limitation of this specific preview environment (canvas readback is a common target for privacy/fingerprinting protections in automated browser contexts), not a product issue — `drawImage`-for-display (unlike readback) is unaffected and is what all the screenshot-based correctness verification above relied on.
  - **Section 4.3 estimate vs. measured reality.** The plan's own rough estimate ("~360MB worst case if every frame were kept simultaneously... realistic target closer to tens of MB") is **confirmed and refined**: measured deltas were single-digit-to-tens of MB (2.4MB narrow-band, 22.5MB full-sweep peak), an order of magnitude better than the 360MB worst-case and squarely in the "tens of MB" realistic band the plan predicted. `MAX_CACHED_SESSIONS = 3` / `MAX_TOTAL_BUFFERED_FRAMES = 150` were not further tuned beyond Section 4.3's own suggested starting values, since measurement confirmed they're already comfortably under budget — no evidence emerged that they need to be tightened, and loosening them was not attempted given the confirmed headroom is a buffer against exactly this kind of environment/scale variance, not slack to spend.
  - **New tests:** `src/services/videoDecoderPool.test.ts` grew from 16 to 26 tests in its base description blocks (updated 2 pre-existing tests whose asserted behavior legitimately changed — decoder reuse instead of close-and-reconstruct — plus new windowed-decode, scrub-reset, and LRU-eviction/close-discipline suites) and `src/hooks/useWebCodecsPreview.test.ts` grew from 18 to 23 (new `chaseLatestTarget` and `startChaseIfIdle` suites, including the deadlock regression). Full suite: **113/113 passing** (was 95/95 before this phase), `tsc --noEmit` clean.
  - **What remains explicitly out of scope / carried forward:** `useFirstFrameCache.ts`'s own scaling cost (Section 4.1's originally-flagged "500 concurrent offscreen `<video>` decodes" problem) is confirmed still present at 500-segment scale (500 `<video>` elements accumulate in the DOM and are not cleaned up) and was **not** touched — it's outside this phase's file scope (`useWebCodecsPreview.ts`, `videoDecoderPool.ts`, `videoDemuxer.ts`, `PreviewCanvas.tsx` only) and Section 3.3/4.2 both already say it's expected to be subsumed later (Phase 7), not fixed here. The fresh-session re-verification above (2026-07-04) closes the Section 7.1 gate #2 evidence gap — no further re-run is required before relying on this phase as complete.

- **Phase 5 — Overlays/filters/animations/captions re-integration onto the canvas paint step.** Per Section 3.6/6's stated defaults, three of the four sub-features needed **zero new code** — reading `PreviewStage.tsx` closely showed they already work structurally, and manual testing confirmed it:
  - **Filters** — already applied. `PreviewCanvas.tsx` (Phase 1+2) already accepted a `style` prop and passed it straight to the underlying `<canvas>` element, and `PreviewStage.tsx` already called it with `style={getClipEffectStyle(currentSegment.effectAnimation)}` — the exact same CSS filter string the legacy `<video>`/`<img>` elements receive. CSS `filter` applies identically to a `<canvas>` element as to a `<video>`/`<img>` (it's a standard CSS property, element-type-agnostic), so this was already pixel-for-pixel consistent with the legacy path. No `ctx.filter` (canvas-2D-context) port was needed or added — the plan's own phrasing ("port the equivalent filter application onto the canvas context") turned out to have a simpler-than-expected resolution once the CSS-property mechanism was traced through. Verified manually: `sepia`/`gaussian-blur` effectAnimation slugs render identically on both paths.
  - **Overlays and captions** — already applied, exactly per the plan's stated default. Both are live DOM layers (`currentSegment.extraOverlays`, the global `textLayers`, and the main caption block) rendered as siblings *outside* the video-paint layer (the conditional `<video>`/`<PreviewCanvas>` block), inside the same outer per-segment `motion.div`. They were never conditioned on which video path is active, so they already rendered identically regardless of legacy vs. WebCodecs — nothing to port. Verified manually: extra-overlay text and the main caption both render correctly, positioned and styled identically, above the WebCodecs canvas.
  - **Animations** — already applied, and the "reuse `canvasAnimations.ts`" default from the task was deliberately **not** taken, documented here as the considered alternative: `PreviewCanvas` is mounted *inside* the same `motion.div` wrapper that carries `getAnimationWrapperProps(...)` (Framer Motion props / CSS `transform` for `KEN_BURNS`/`ZOOM_IN`/`ZOOM_OUT`) — the identical wrapper the legacy `<video>`/`<img>` elements sit inside. Since CSS transforms on a parent apply uniformly to every child regardless of element type, the canvas already inherits the exact same animation the legacy path gets, through the exact same code, with no possibility of preview/canvas divergence. Reusing `canvasAnimations.ts`'s `applySegmentAnimation()` (export-path, `ctx`-transform-based) instead would have required *unmounting* the canvas from this wrapper and reimplementing the transform math a third time inside `PreviewCanvas.tsx` — strictly more code, a new place for preview-vs-export drift to creep in, and explicitly optional/nice-to-have per Section 3.2/6. Verified manually: `BOUNCE` and `WOBBLE` (via the legacy `animation` field) and `KEN_BURNS` (via `effectAnimation`) all animate the WebCodecs canvas identically to the legacy path.
  - **Combined effects** — manually verified on segments combining filter+overlay+caption, animation+overlay+caption, and (separately, since the legacy field-precedence rules make filter+true-animation on the same segment mutually exclusive — an existing, pre-Phase-5 legacy-path behavior, not something this phase changed) each individually with overlay+caption layered on top.
  - **Real bugs found and fixed, unrelated to overlays/filters/animations/captions themselves — discovered because manual verification of the above required actually getting a frame to paint on the WebCodecs canvas reliably, which surfaced that the decode-session plumbing underneath was not reliable enough to test against yet:**
    1. **`resetSessionWindow` didn't clear `feedInFlight`, stranding a passive waiter forever.** A prior `feedWindow()` batch can still be "in flight" (its `flush()` not yet settled) at the exact moment a reset happens — e.g. `ensureSession`'s own initial `fillWindow` resolves early the instant a satisfying frame is buffered, while its `flush()` keeps running in the background; a `getFrameAt` call landing moments later triggers a reset (see finding #4 below) before that background `flush()` settles. Without a fix, the next `fillWindow` call sees `feedInFlight` still `true` and passively awaits a waiter nothing will ever settle — permanent blank canvas, no error. **Fix:** added `feedGeneration`, bumped on every `resetSessionWindow` call; `resetSessionWindow` now also force-clears `feedInFlight`, and `fillWindow`'s own batch-completion `.finally()` only clears `feedInFlight` if `feedGeneration` still matches what it captured at start — so a stale, superseded batch's later settlement can't stomp a newer batch's legitimately-true flag.
    2. **`getFrameAt` could be called before `startSession`'s `seedWindow` had ever run, reading placeholder state.** `useWebCodecsPreview.ts`'s decode-ahead effect calls `ensureSession` fire-and-forget; a separate effect in the same render calls `getFrameAt` independently, which can execute before `startSession`'s async chain has reached `seedWindow` — reading the `DecodeSession` object literal's still-placeholder `fullyFed: true` and returning null immediately instead of waiting. If the caller wasn't actively ticking `currentTime` (e.g. paused right after a seek), nothing ever retried. **Fix:** `getFrameAt` now `await session.ready` first (a no-op once already resolved) before evaluating `needsReset`/`fillWindow`.
    3. **React StrictMode's dev-only double-invoke stranded the chase mutex, and so did every genuine segment change during continuous playback.** `useWebCodecsPreview.ts`'s frame-pull effect coalesces rapid ticks through a single-flight "chase" mutex (`ChaseMutex`, Phase 4). Two related bugs: (a) StrictMode double-invokes every effect once at mount; the pool-dispose cleanup fires between the two passes, but the mutex — a ref shared across both passes — was still `true` from the first pass's still-settling chase, so the second pass's `startChaseIfIdle` call silently no-op'd, and nothing ever called `getFrameAt` again for the fresh session the second pass created (blank canvas at mount until the user switched segments). (b) During real continuous playback, `chaseLatestTarget`'s `fetch` closure captures a segment id once at the moment a chase starts; the loop's exit condition (`getLatestTarget() === target`) almost never matches mid-playback (the target keeps advancing every tick), so a chase started for segment N can still be "chasing" well after the real current segment has moved to N+1, N+2, etc. — silently starving every later segment's own chase attempt (mutex busy) until the stale one happens to catch up, which can take a while. **Fix:** added `ChaseMutex.epoch` + `resetChaseMutex()`, which force the mutex open and bump its epoch (so a later stale settlement can't re-lock it out from under a newer chase); called both from the pool-dispose cleanup (mount/unmount case) and on every genuine segment change (the continuous-playback case) in the frame-pull effect.
    4. **A pre-existing, deliberately-not-fixed quirk in `needsReset`'s "backward scrub" check made every segment's very first `getFrameAt` call reset unnecessarily.** `retainedFloorUs` is seeded to the real first-decodable frame's presentation timestamp (not `0`) — for assets with encoder delay (confirmed on the real Pexels test asset: first frame's pts is ~67ms, not 0ms), a segment's own `target=0` call reads as "before the floor," triggering a reset that lands on the exact same window. This is self-correcting and harmless in isolation (confirmed via code trace and testing) — flagged here because it interacts with finding #1 above (a reset while a batch is in flight) on the very common "segment just became current, target=0" path use, making #1 not just a theoretical race but the default happy-path timing. Not changed in this phase (the reset itself is not wrong, just avoidable); worth revisiting only if further profiling shows it matters.
  - **A deeper issue found, contained but explicitly NOT fixed at the time — since properly fixed, see the dedicated "Phase 4+6/5 design gap — flush-strategy fix" entry below (2026-07-05); this bullet is kept verbatim as the historical record of the finding.** a real Chromium `VideoDecoder` throws **synchronously** — confirmed independent of any of this pool's own code, via a bare `configure()`/`decode()`/`flush()` sequence typed directly into the browser — "A key frame is required after configure() or flush()" the moment `decode()` is called with a non-keyframe chunk immediately after a `flush()` has settled. `videoDecoderPool.ts`'s entire windowed decode-ahead model (Phase 4+6) calls `flush()` at the end of **every** `feedWindow()` batch, then continues feeding delta frames from wherever `feedCursor` was left on the *next* window extension — which is essentially never a keyframe. This means **any segment whose own playback needs to extend its decode window a second time (i.e. any segment played continuously past its own first ~`WINDOW_AHEAD_SEC` (1.5s) of content without an intervening scrub-reset) hits this on a real browser.** `MockVideoDecoder` (this file's whole existing test suite) never enforced this constraint, so Phase 4+6's own "extends the window forward ... without ever resetting" test passed convincingly against the mock while being a false positive against real decoder behavior — this was not a Phase 5 regression, it was always broken, just never exercised by a test capable of catching it. **What this phase did about it (containment, not a fix):** wrapped `feedWindow`'s decode loop in a `try`/`catch`; on catch, marks the `DecoderHandle` `errored` (never pooled for reuse) and the session `fullyFed = true`. Without the second part specifically, `feedCursor` is never advanced past the offending chunk, so the very next `fillWindow` call (once `feedInFlight` clears) retries the identical `decode()` call and throws again — forever, in a **tight synchronous loop with no `await` between attempts**, which is strictly worse than a hung promise (confirmed directly: a version of this fix missing only that one line reproducibly locked up the Node test process, requiring `pkill`, and would very likely lock up a real browser tab's main thread the same way). With both parts, the affected segment freezes on its last successfully-decoded frame for the remainder of its time on screen — a real, visible degradation, but a bounded and safe one (no hang, no crash, no busy-loop). **Root-cause fix is out of scope for this phase** — it needs a feed/flush strategy redesign (e.g. never calling `flush()` for continuation batches and relying purely on `output` callbacks, or always re-seeding at a keyframe boundary on every window extension instead of continuing mid-GOP) plus a `MockVideoDecoder` update that actually enforces the real keyframe-after-`flush()` constraint so this class of bug can never again pass the mock suite while failing on real hardware. Recommended as a required item before Section 7's merge-to-`main` gate.
  - **Manually verified (Chromium, via this environment's browser-preview tooling, across multiple genuinely fresh browser sessions — not just fresh reloads of an already-stressed session, per Phase 4+6's own precedent for this class of finding):** a 6-segment fixture (`src/dev/buildPhase5Fixture.ts`, new — same throwaway-tool convention as `buildScaleFixture.ts`) with segments covering: filter only (`sepia`), true camera-dynamics animation only (`BOUNCE`), `KEN_BURNS` zoom, overlay+caption only, animation+overlay+caption combined (`WOBBLE`), and filter+overlay+caption combined (`gaussian-blur`). On a fresh page load (no click needed) the first segment now renders correctly immediately (previously black until any segment change, per finding #3). All six segments individually confirmed correct while paused/scrubbed, matching the legacy path's known-correct appearance. Continuous playback through a full loop confirmed: no hangs, no crashes, no permanently-stuck-black segments (the deeper flush/keyframe issue manifests as an occasional frozen frame partway through a longer segment, not a black canvas or a freeze of the whole app) — overlays and captions kept updating correctly throughout since they don't depend on this hook at all. `getImageData`-based canvas pixel sampling was attempted for automated black/non-black verification but (consistent with the Phase 4+6 tracker's own note) reads back all-zero in this sandboxed preview tooling regardless of actual content — all verification here is screenshot/visual, same limitation as previous phases.
  - **Automated tests added:** `src/services/videoDecoderPool.test.ts` gained a `ControllableVideoDecoder`-based regression test for finding #1 (proves the pre-fix code hangs — verified directly by temporarily reverting the fix and confirming the test times out, then confirming it passes with the fix restored) and a new `KeyframeStrictVideoDecoder` mock + suite pinning the keyframe-after-`flush()` containment behavior (also verified to reproduce a genuine infinite hang — confirmed by temporarily removing just the `fullyFed = true` line and observing the test process itself lock up and require `pkill`). `src/hooks/useWebCodecsPreview.test.ts` gained a `resetChaseMutex` suite (2 tests) pinning the epoch-guarded forced-reopen behavior independent of the React/StrictMode plumbing that motivated it. Full suite: **117/117 passing** (was 113/113 before this phase), `tsc --noEmit` clean.
  - **What was deliberately not attempted:** full automated/unit coverage of "a filter/animation renders the expected pixels on the canvas" — this is inherently a visual-rendering correctness question, not something meaningfully expressible as a fast, deterministic unit test in this codebase's existing conventions (no visual-regression/screenshot-diffing infrastructure exists here), so it was verified manually only, consistent with how the legacy path's own visual correctness has never had automated pixel tests either.

- **Phase 4+6/5 design gap — flush-strategy fix (2026-07-05).** This closes the "real-decoder keyframe-after-`flush()`" architectural gap logged directly above: a **Phase 4+6 design flaw** (the windowed decode-ahead model's original feed strategy), **found during Phase 5's manual testing** (getting a real frame to paint reliably on the canvas surfaced it), previously only contained. It is now root-caused and fixed, not just contained.
  - **Root cause.** Per the WebCodecs spec, `VideoDecoder.flush()` is not a harmless "drain the pipe" checkpoint — settling it **invalidates the decoder's internal reference-frame state**, which is exactly why the spec then requires the next `decode()` call to be a keyframe. This is documented, expected browser behavior — confirmed independently against a real Chromium decoder via a bare `configure()`/`decode()`/`flush()` sequence, with no app code involved at all — not a bug in this codebase's own logic. The pre-fix `feedWindow()` called `flush()` at the end of **every** batch, including routine mid-GOP window extensions, so it was asking the decoder to guarantee a property (delta-frame continuation) the spec explicitly says `flush()` itself destroys.
  - **The fix (`videoDecoderPool.ts`).** `flush()` is now reserved for genuine discontinuities only: true session teardown (`closeSession`) and backward/hard-seek resets (`resetSessionWindow`), both of which already re-seed at a keyframe via `seedWindow` before the next `decode()`, exactly as the spec permits. Routine window-extension — the common case, playback continuing forward mid-GOP — no longer flushes at all; `feedWindow` just calls `decode()` and returns, and only issues a real `flush()` when the batch reaches the session's true end (`fullyFed` becomes true, meaning no future `feedWindow` call will ever run again for that session). `fillWindow` was restructured around this: the new `startFeedBatch` helper paces batches off real decoder `output` events and the furthest still-pending waiter's target instead of off a `flush()` promise that (correctly) no longer settles on any predictable cadence for a routine batch. `MockVideoDecoder` (`videoDecoderPool.test.ts`) now enforces the real "keyframe required immediately after `configure()`/`flush()`" constraint itself (it previously didn't, which is why the pre-fix code could pass this whole suite while throwing on real hardware) — this made the separate `KeyframeStrictVideoDecoder` mock from Phase 5's containment work redundant, so it was deleted; the same regression coverage now lives directly against the file's one shared mock.
  - **Verification.** Full suite **118/118 passing** (was 117/117 before this fix — net one new test added, several rewritten in place for the new model, none deleted), `tsc --noEmit` clean. Manually verified across **3 fresh-reload + full-playthrough cycles** against the `buildPhase5Fixture.ts` 6-segment fixture (Chromium, via this environment's browser-preview tooling): all 6 segments (filter-only, `BOUNCE` animation, `KEN_BURNS`, overlay+caption, animation+overlay+caption, filter+overlay+caption) individually confirmed correct, and — the specific case this fix targets — continuous full-timeline playthroughs no longer produce the occasional frozen frame Phase 5's containment-only fix still allowed; zero errors, zero freezes, zero console warnings across all 3 cycles.
  - **Net effect on the Phase 5 tracker entry above:** its "deeper issue" bullet is kept verbatim as the historical record of the original finding (per that bullet's own note); this entry is the resolution. The "Required before Phase 7+8" gate item this created (previously listed under ⬜ NOT STARTED / PENDING) is now closed — see that section below.

- **Phase 7+8 (combined) — Full cutover + regression pass/performance validation at scale (completed 2026-07-05).** This is the final step of the entire migration: the new path stops being an opt-in experiment and becomes real, permanent default behavior for every user.
  - **The cutover itself (Phase 7).** The dev-only toggle built in Phase 1+2 (`webCodecsDevToggle`, `localStorage['kinetix:dev:webcodecsPreview']`, the floating dev-only `<Zap>` button) is removed from `PreviewStage.tsx` entirely — `isWebCodecsPreviewSupported()` is now the **sole** gate deciding `useWebCodecsPath`. This is not a flag being flipped to a new default while the toggle still exists as an escape hatch — the toggle code, its `localStorage` key, its read/write helpers, and its UI button are all gone. Every runtime that passes the capability check now gets the WebCodecs path unconditionally; every runtime that fails it (old macOS below the 13.3 floor, per Section 1.2/1.6) gets the legacy `<video>`-element path, which remains in the tree untouched, exactly as Section 1.6/7 specify. The dev-only "WebCodecs Preview" badge (`import.meta.env.DEV && useWebCodecsPath`) is kept as a harmless debugging indicator — it has no effect on which path runs, only on-screen text.
  - **Full regression re-verification (Phase 8), against the real default path, not a toggle-gated experiment.** Every phase's manual-testing claims (Phase 1+2's boundary crossing, Phase 3's audio-sync/speed/short-segment hardening, Phase 4+6's scrub/LRU/scale behavior, Phase 5's overlays/filters/animations/captions parity) were originally verified with the dev toggle manually switched on. This pass re-ran the same categories of manual checks with the toggle gone — i.e. verifying the behavior a real, unmodified build now gives every capability-supported user by default, using fresh fixtures built for this checkpoint (`src/dev/buildCheckpoint2Fixture.ts`'s `buildSingleSegmentFixture`/`buildBoundaryFixture`, alongside the still-valid `buildScaleFixture.ts`/`buildPhase5Fixture.ts` from earlier phases). **Result: no code regressions found in any of Phases 1+2/3/4+6/5's behavior under the real default path.** Two things were found and are logged below as explicitly out-of-scope, not fixed here — a preview-tooling artifact (this environment's canvas `getImageData` readback returning all-zero regardless of real content, already documented as a sandboxing limitation as far back as the Phase 4+6 entry above) and a pre-existing, unrelated heading-video bug (see below) — neither is a WebCodecs-path regression.
  - **The `.play()` guard cleanup (Checkpoint 5 follow-up).** Removing the dev toggle means `useWebCodecsPathRef.current` can now be `true` for a real user's session in a way it structurally couldn't be before (the toggle defaulted off), so every place in `PreviewStage.tsx` that still unconditionally touches the legacy `<video>` elements needed a second look for correctness now that "the WebCodecs path is active" is a real, common case rather than a dev-only curiosity:
    - **Fixed:** the isPlaying-sync effect (`PreviewStage.tsx`, the `useEffect` a few lines below the segment-change effect, keyed on `isPlaying` alone) called `activeEl.play()`/`.pause()` on `videoARef`/`videoBRef` unconditionally. Because the segment-change effect already early-returns before touching those elements when `useWebCodecsPathRef.current` is true (Phase 1+2's original design), this call was already a no-op in practice whenever the WebCodecs path owned the segment — but only *incidentally*, by relying on those elements never having received a `src`/`load()`/seek in the first place. That's an implicit invariant, not an enforced one, and nothing stopped a future edit to either effect from breaking it silently. **Fix:** added an explicit `if (useWebCodecsPathRef.current) return;` guard at the top of this effect, so it's inert by construction, matching the segment-change effect's own explicit guard, rather than inert by accident.
    - **Deliberately NOT guarded: the heading-background-video effect** (`PreviewStage.tsx`, "Sync heading background video to isPlaying", keyed on `currentSegment?.isHeading`/`currentSegment?.heading`, driving `headingVideoRef`). This effect was audited for the same class of bug and found not to need it: `isVideoAsset` (the flag that decides whether `PreviewCanvas`/WebCodecs paints at all) is computed as `!isHeadingSegment && !!(asset?.url && asset.type === 'video')` — heading segments are unconditionally excluded from the WebCodecs video-paint branch regardless of the underlying asset's type. `headingVideoRef` is a wholly separate `<video>` element from `videoARef`/`videoBRef`, used only for a heading's own background video, and is never touched by `useWebCodecsPathRef`'s gated code at all. Heading segments are therefore architecturally excluded from the WebCodecs path entirely, not just incidentally inert today — guarding this effect would be defensive code against a case that cannot occur, which this codebase's conventions (CLAUDE.md: "don't add error handling... for scenarios that can't happen") direct against adding.
  - **The cold-start bug's confirmed status.** Re-attempted against the real default path (Section 7.1 gate #3) using the original bug doc's (`docs/bugs/preview-cold-start-clock-freeze.md`) reproduction steps: **fails to reproduce on WebCodecs-capable runtimes.** This is not "we replaced the mechanism so it should be gone" — it's architecturally guaranteed: the cold-start bug is specifically about a never-yet-played `<video>` element's media clock failing to start reliably on `.play()`; on the WebCodecs path, video frames are painted by `PreviewCanvas` from decoded `VideoFrame`s pulled out of `videoDecoderPool.ts` — there is no `<video>`-element `.play()` call anywhere in that path for the segment actually being displayed (`videoARef`/`videoBRef` sit inert per the guards above). A bug rooted in `<video>`-element clock behavior cannot manifest through a code path that never calls `.play()` on a `<video>` element. **On the legacy fallback path** (capability-unsupported runtimes, e.g. macOS below 13.3), the bug is **unchanged and still present** — this is not a new regression, it's the pre-existing, already-documented, accepted limitation Section 1.6 describes: unsupported runtimes get "today's dual `<video>`-slot path, cold-start bug and all," which is explicitly "a strict superset of current behavior," not a new failure mode.
  - **Section 7.1 merge-gate criteria — all 6 PASS:**
    1. **Full regression pass clean.** PASS — re-verified above; no code regressions found across Phases 1+2/3/4+6/5 against the real default (non-toggle-gated) path.
    2. **500-segment project plays back smoothly, within memory ceiling, scrubs responsively.** PASS — carried forward from Phase 4+6's fresh-session re-verification (2026-07-04): 500-segment/300s fixture, ~2,100 scrub events across narrow-band and full-sweep stress, zero crashes/freezes, memory bounded in a ~34-40MB band; re-spot-checked during this checkpoint's regression pass with the toggle gone (same fixture, same result).
    3. **Cold-start bug confirmed gone on the new path specifically.** PASS — explicit repro attempt against the real default path fails to reproduce, per the architectural reasoning above (not merely assumed from the mechanism swap).
    4. **`tsc` clean, full `vitest` suite green.** PASS — `tsc --noEmit`: zero errors. `vitest run`: **118/118 passing**, matching the count already established after the Phase 4+6/5 flush-strategy fix (no tests added or removed by the cutover itself, since Phase 7+8 changed gating logic in `PreviewStage.tsx`/`webcodecsSupport.ts`, not decoder/hook logic already covered by existing suites).
    5. **Legacy `<video>`-element fallback verified still functional end-to-end for the capability-unsupported case.** PASS — manually verified by forcing `isWebCodecsPreviewSupported()` to return `false` (simulating an unsupported runtime) and confirming the dual-`<video>`-slot path plays, seeks, and transitions correctly exactly as it did before this branch existed, with the WebCodecs canvas never mounting.
    6. **Export pipeline untouched.** PASS — `git diff` against `main` for `frameRenderer.ts`, `segmentEncoder.ts`, `exportPipeline.ts`, `plainSegment.ts`, and everything under `src-tauri/` shows zero changes across the entire branch's history, confirmed at this final checkpoint.
  - **Two items explicitly logged as separate, out-of-scope, NOT fixed on this branch:**
    (a) **An animation-wrapper missing React `key` bug**, found during Checkpoint 3 of this regression pass (the same category of manual testing that exercises `motion.div`/`getAnimationWrapperProps` wrappers). Reproduces identically on the legacy `<video>`-element path with the WebCodecs path fully disabled — it is a pre-existing bug in the shared animation-wrapper JSX, unrelated to which video path paints the frame, and out of scope for this migration per this plan's own scope statement (Section "Scope": preview *video path* only). Left unfixed, flagged here for separate follow-up work.
    (b) **A heading-video `.play()` StrictMode-related flakiness**, found during the Checkpoint 5 `.play()`-guard follow-up audit above. This is a pre-existing timing interaction between React StrictMode's dev-only double-invoke behavior and `headingVideoRef`'s own effect/ref lifecycle — unrelated to the WebCodecs cutover (the effect in question is not gated by `useWebCodecsPathRef` at all, per the "deliberately NOT guarded" finding above, and the flakiness was present before this checkpoint's changes). Not caused by this branch, left unfixed, flagged here for separate follow-up work.
  - **Verification:** `tsc --noEmit` clean, `vitest run` **118/118 passing** (final count, unchanged from the Phase 4+6/5 flush-strategy fix — this checkpoint's changes are gating/cleanup only, no new hook/decoder logic requiring new tests). Manually verified in Chromium via this environment's browser-preview tooling: real default-path playback (no toggle), forced-unsupported legacy-path fallback, and the two fixtures in `src/dev/buildCheckpoint2Fixture.ts` all confirmed working as described above.
  - **This closes the entire `webcodecs-architecture-plan.md` migration.** All of Phases 0–7+8 are now ✅ COMPLETED; nothing remains under 🟡 or the blocking part of ⬜ (see below) for this branch.

- **Post-cutover fix — transition flash-back (S2 → S1 → S2) on cross-dissolve boundaries, root-caused and fixed (2026-07-05).** Found during manual post-cutover testing of the default WebCodecs preview path: playing through a cross-dissolve boundary between two video segments occasionally showed a brief snap back to the outgoing segment's content right as the dissolve resolved, before snapping forward to the correct incoming segment.
  - **Root cause:** a React effect/paint-ordering race between `PreviewCanvas.tsx` and `PreviewStage.tsx`'s transition-overlay canvas — not a bug in `useTransitionPreview.ts`'s snapshot capture/staleness handling, which was audited and confirmed sound (`snapshotsReady` re-validates its stored key against freshly-recomputed `currentSeg`/`nextSeg` every render, closing off every stale-overwrite race considered). `useWebCodecsPreview.ts` sets `frame` and `frameSegmentId` together in the same commit once real decoded content for the new segment arrives — that same catch-up is what flips `PreviewStage`'s `showTransitionOverlay` to `false`, fading out its overlay canvas (z-45) to reveal `PreviewCanvas` underneath. `PreviewCanvas`'s frame-draw was a plain `useEffect` (a passive effect, guaranteed to run only *after* the browser paints the commit), while the overlay's opacity style is applied synchronously as part of that same commit's render — so the browser could paint the overlay already fading toward transparent *before* `PreviewCanvas` had redrawn its own bitmap with the new segment's frame, briefly revealing the previous segment's stale content.
  - **Fix:** `src/components/PreviewCanvas.tsx` — converted the frame-draw effect from `useEffect` to `useLayoutEffect`, so the canvas bitmap is guaranteed current before the same commit paints. No timer, no new gating logic — the existing `frameSegmentId`-based reveal gate (already correct) now has a bitmap that's actually ready by the time it fires.
  - **Verification:** `tsc --noEmit` clean, `vitest run` 135/135 passing. Manually verified in the real Tauri app (`npm run tauri dev`) against a 2+ video-segment project with a cross-dissolve boundary, played through repeatedly at normal speed — no reversion observed with the fix applied; confirmed via a control test that temporarily reverting to `useEffect` reproduces the flash and re-applying `useLayoutEffect` resolves it again.
  - Committed in the commit titled `fix: close paint-ordering race in PreviewCanvas frame draw (useEffect -> useLayoutEffect) — resolves transition flash-back (Bug 1)`.

### 🟡 IN PROGRESS / PARTIAL

None — Phase 0, Phase 1+2, Phase 3, Phase 4+6, Phase 5, the Phase 4+6/5 flush-strategy fix, and Phase 7+8 fully closed as scoped. **The entire migration plan is complete; nothing in this document is mid-flight.**

### ⬜ NOT STARTED / PENDING

Nothing remains that blocks this branch. Everything below is known follow-up work, explicitly out of scope for `webcodecs-api`, not a gate on merging it:

- **An animation-wrapper missing React `key` bug** (found during Phase 7+8's Checkpoint 3 regression pass) — pre-existing, reproduces identically on the legacy `<video>`-element path with WebCodecs disabled, unrelated to which video path paints the frame. See the Phase 7+8 tracker entry above for detail.
- **A heading-video `.play()` StrictMode-related flakiness** (found during Phase 7+8's Checkpoint 5 `.play()`-guard follow-up) — pre-existing timing interaction in `headingVideoRef`'s effect/ref lifecycle, unrelated to the WebCodecs cutover (that effect is deliberately not gated by `useWebCodecsPathRef` at all — heading segments are architecturally excluded from the WebCodecs path). See the Phase 7+8 tracker entry above for detail.
- **Deferred/open items carried forward from Phase 0**, re-classified here as accepted residual risk rather than a merge blocker, now that Section 7.1's fallback-functionality gate (#5) has passed structurally (the capability check, not manual per-platform verification, is what protects an unsupported/untested runtime): older macOS versions below the tested floor, Windows/WebView2, and arbitrary/non-clean user-uploaded container or codec shapes remain **not manually re-tested on real hardware/files** beyond this branch's Chromium/WKWebView-on-current-macOS testing. Any of these failing at runtime falls back to the legacy `<video>`-element path per Section 1.6's capability-gated design (the same protection an untested-but-unsupported runtime already gets) — this is a monitoring/telemetry follow-up, not a defect in this branch's own testing scope.

**Maintenance instruction:** update this tracker at the end of every phase, before committing that phase's work, so this document alone reflects true project state without needing chat history. Move completed items into ✅, update 🟡 to reflect whatever is genuinely mid-flight, and keep the "committed in commit ___" reference current.

---

## Follow-On Effort — Preview/Export Unification (Phases A–C)

**Status:** IN PROGRESS. Quick wins (Section 8.0) are fully COMPLETE — 3 of 3 sub-items done, see
✅ COMPLETED below. **Phase A is now fully ✅ COMPLETE — 3 of 3 steps done (A1 animation-twin
conversion, A2 boundary-frame pre-pull, A3 transition-window realignment + caption-hold
companion).** Phases B and C are NOT STARTED. This is a distinct, second effort layered on top of
the now-complete Phases 0–8. Phases 0–8 replaced the *preview* video path with WebCodecs and left
the export pipeline untouched by hard gate (7.1 #6). This follow-on removes that firewall
deliberately: it adapts **export** to WebCodecs too, unifies preview and export behind ONE
compositor, and closes the preview-side timing/quality gaps 0–8 mitigated but did not root-fix.

Post-A3 manual testing (2026-07-06) surfaced 3 residual preview issues, none of them caused by
Phase A — tracked as separate follow-on items, not reopening A: (1) a pre-existing animation
"snap-back" on content-catch-up-hold release, newly exposed (not caused) by A1's timeInSegment
conversion — **✅ FIXED (2026-07-06), see the new Follow-On item below Phase A's entry**; (2) the
known static-snapshot transition-blend limitation (frozen frame for the full transition window) —
unchanged by A3 — **🔶 AUDITED, DEFERRED TO PHASE B (2026-07-06), see the new Follow-On item below
Phase A's entry**: a completed audit concluded the real ("live blend") fix requires the
preview/export-unification work Phase B (Section 8.2) already scopes to do properly, so this is
deliberately not being fixed standalone; (3) general preview playback lag/smoothness unrelated to
segment boundaries — root cause unconfirmed, needs runtime profiling, not a code-review-fixable
issue. See each item's own entry below for detail.

**Locked technical decisions (do not re-litigate during implementation):**
- Single master clock = the audio playhead (`usePlayback.ts`, UNCHANGED) for BOTH preview and export.
- ONE shared compositor drives both paths (built in Phase B; today preview and export composite separately).
- Decode: the existing `videoDecoderPool.ts` / `videoDemuxer.ts` (WebCodecs `VideoDecoder`), reused as-is.
- Export encode: WebCodecs `VideoEncoder` (hardware-accelerated first, software fallback), quality-pinned.
- ffmpeg sidecar retained for the FINAL audio+video mux ONLY (once per export, never per-frame).
- OUT OF SCOPE for this whole effort: the sync system, timeline/editing, `App.tsx` orchestration
  state. Do not touch them.

### ✅ COMPLETED

- **Quick win 1 of 3 — hot-path `[DIAG]` + live `//FFCACHE` log strip (completed 2026-07-05).**
  Per Section 8.0 steps 1–2. Removed all 6 `[DIAG]` sites: `useWebCodecsPreview.ts`'s segment-flip
  and frame-settled logs (single log+comment lines inside larger effects, removed in place), and
  `PreviewStage.tsx`'s four DIAG effects (`currentSegment ->`, `transitionPreview.isActive ->`,
  `webCodecsPreview.frame changed`, `showTransitionOverlay ->`) — each of these four had a
  `useEffect` whose *entire* body was the log call, so the whole effect was removed rather than
  left behind as an empty shell. Also removed the 4 *live* `//FFCACHE` logs in
  `useFirstFrameCache.ts` (warm-start, per-decode success/fail, capture-threw, warm-complete),
  which fire on every warm pass on the default path; narrowed `catch (err)` to `catch` there since
  `err` was only read by the removed `console.warn`.
  - **Deliberately NOT touched (separate, later concern):** the 4 `//FFCACHE` logs inside
    `PreviewStage.tsx`'s legacy dual-`<video>`-slot cover effect (Section 8.0 step 2's named
    targets) are dormant dead code — that whole effect early-returns
    (`if (useWebCodecsPathRef.current) { setCoverState(null); return; }`) before reaching them on
    every WebCodecs-capable runtime (the default today). Stripping just their logs without
    addressing the dead code block itself was judged out of scope for a log-only pass; the legacy
    cover path is the real follow-up unit of work, not its logging. Step 2 is therefore only
    half-closed: the live FFCACHE logs it didn't originally name (in `useFirstFrameCache.ts`) are
    gone; the dormant ones it did name are still there, untouched.
  - **Also NOT touched, explicitly out of scope for this sub-item:** Section 8.0 step 3's
    `console.debug` lines in `frameRenderer.ts`/`segmentEncoder.ts` — export pipeline.
  - **Remaining:** quick win 3 of 3 (image-dip, step 5) has since landed — see below; Section 8.0
    is fully closed.
  - **Verification:** `tsc --noEmit` clean, `vitest run` 135/135 passing (count unchanged — pure
    log removal, no tests added/removed). Committed in `chore: remove Bug1/Bug2 investigation
    logging (8.0 quick win 1)`.

- **Quick win 2 of 3 — black-flash guard on hard-cut video boundaries (completed 2026-07-05).**
  Per Section 8.0 step 4. `PreviewCanvas.tsx`'s null-frame branch no longer `clearRect`s when
  `frame` is null — it now returns without touching the canvas, retaining the last painted
  bitmap until a real frame supersedes it (the real-frame branch already `clearRect`s
  immediately before its own `drawImage`, so replacement is atomic). Mirrors the identical
  "don't clear on nothing" pattern already used by `PreviewStage.tsx`'s transition-overlay
  canvas. Root cause: `frame` (from `useWebCodecsPreview.ts`) goes null transiently on hard-cut
  (`TransitionType.NONE`) boundaries between two video segments whenever decode-ahead hasn't
  produced a buffered frame yet for the new segment (`videoDecoderPool.ts` `getFrameAt`: no
  session, closed, or zero buffered frames) — previously this painted straight through to
  bg-black for that gap.
  - **Scope — same-project hard cuts only (Design A):** a same-file, subtractive change; no new
    state, no cross-file plumbing. A related but distinct edge case was identified during design
    and deliberately deferred, NOT fixed here: a project switch (`App.tsx`
    `handleSwitchProject`) where both the outgoing and incoming current segment are video does
    not remount `PreviewStage`/`PreviewCanvas` (no `key` prop on either), so this same
    null-frame branch also covers that boundary. Pre-fix, that case already black-flashed the
    same way; post-fix it instead briefly retains the abandoned project's last frame until the
    new project's cold-started decode session produces one. Left open deliberately — it is not
    the confirmed bug this quick win targets, it is bounded/self-healing exactly like the case
    that IS fixed, and closing it needs new cross-file plumbing (a project-identity `resetToken`
    threaded through `PreviewStage` into `PreviewCanvas`) disproportionate to this commit. **Do
    not treat this as closed by quick win 2.**
  - **Remaining:** quick win 3 of 3 (image-dip, step 5) has since landed — see below; Section 8.0
    is fully closed. The cross-project-switch edge case above is also not started and not
    currently scheduled.
  - **Verification:** `tsc --noEmit` clean, `vitest run` 135/135 passing (count unchanged — no
    tests added/removed). Committed in `fix: retain last frame instead of black-flashing on
    hard-cut video boundaries (8.0 quick win 2)`.

- **Quick win 3 of 3 — image fade replay on image→image hard-cut boundaries (completed 2026-07-05).**
  Per Section 8.0 step 5, implemented as **option (a) — remount-triggered fade reuse**, NOT the
  dip-black/dip-white blend step 5's own text originally sketched (that alternative was considered
  and explicitly rejected in favor of reusing the already-working fade with minimal new visual
  behavior). Root cause: `PreviewStage.tsx`'s image element (`motion.img`, ~line 902) had no `key`
  tied to `currentSegment.id`, so an image→image boundary with `transition=NONE` was a same-node
  prop update (instant `src` swap) rather than a remount — Framer's coded entrance fade
  (`initial:{opacity:0} -> animate:{opacity:1}`, 0.4s) never replayed. Fixed by adding
  `key={currentSegment.id}` to that one element, forcing a genuine remount at every segment
  boundary. The outer segment `motion.div` was deliberately left unkeyed (keying it would remount
  the persistent dual-`<video>` slots the Bug 1/Bug 2 fixes and D10 depend on); overlay/caption
  layers were deliberately left unkeyed too (existing by-design "steady, no re-animate" behavior —
  see the body-caption comment in `PreviewStage.tsx`). Image↔video boundaries were already correct
  before this fix (mount/unmount driven by the `asset?.url && !isVideoAsset` conditional, not a
  key) and are unaffected by it.
  - **Audit-flagged edge cases — accepted as non-issues, not fixed further:**
    - Two adjacent image segments sharing the exact same asset will still replay the fade (the key
      is `currentSegment.id`, not asset identity) — by design; a segment boundary is treated as a
      real "beat" change regardless of whether the picture repeats.
    - A heading segment whose `assetId` resolves to an image mounts this same (now-keyed) element
      underneath the heading's own background layer — already fully obscured pre-fix (the heading
      container is `absolute z-30`; the image block itself isn't positioned), unaffected by this
      change either way.
  - **Remaining:** none for this sub-item — quick win 3 of 3 was the last of the three. **Section
    8.0 Quick Wins is now fully closed.** Two threads carved out of quick-win scope from the start
    remain open, tracked where first flagged (not part of this closure): the dormant `//FFCACHE`
    dead-code block and the export `console.debug` lines (both noted under quick win 1 above), and
    the cross-project-switch black-flash edge case (noted under quick win 2 above).
  - **Verification:** `tsc --noEmit` clean, `vitest run` 135/135 passing (count unchanged — no
    tests added/removed; this repo has no jsdom/@testing-library/react, so nothing renders
    `PreviewStage`'s JSX in a test). Committed in `fix: replay image fade on image-to-image
    hard-cut boundaries (8.0 quick win 3/3 — closes Quick Wins)`.

- **Phase A1 of 3 — animation-twin conversion (completed 2026-07-06).**
  Per Section 8.1 step 1 ("Playhead animation twins"). Converted all 10 remaining `AnimationType`
  cases in `PreviewStage.tsx`'s `getAnimationWrapperProps` (FLOAT, SHAKE, PULSE, WOBBLE, HEARTBEAT,
  BOUNCE, ROTATE, SKEW, GLITCH, NEON_FLICKER) from Framer Motion wall-clock keyframes/mount-triggered
  tweens to `{ style }` objects computed fresh from `timeInSegment` every render — the same pattern
  KEN_BURNS/ZOOM_IN/ZOOM_OUT already used. Reuses `canvasAnimations.ts`'s own exported helper
  functions (`oscillate`, `interpKeyframes`, `easeInOutSine`, `easeOutQuad`, `springApprox`) via
  direct import rather than reimplementing the math, so preview and export cannot drift apart on
  these formulas going forward.
  - **Root cause closed:** the wrapper `motion.div`s (~807, ~817) have no `key` tied to segment
    identity, so React never remounts them on a segment change — `repeat: Infinity` keyframe
    animations (7 types) free-ran on Framer's own wall clock forever, independent of
    play/pause/seek, and one-shot entry animations (BOUNCE/ROTATE/SKEW, 3 types) only ever fired
    once, on the very first segment ever displayed. Both are now moot: every case is a pure
    function of `timeInSegment`, so pausing freezes it, seeking snaps it, and re-entering any
    segment replays its entry animation correctly — no `key` prop needed (confirmed during audit:
    adding one would have been redundant for the inner wrapper once time-driven, and risked
    activating the outer transition wrapper's dormant `exit`/`initial` CSS crossfade — that risk is
    explicitly A3's territory, not A1's, and was avoided by design).
  - **Accepted, explicit behavior changes** (preview now matches export, which was already correct
    — not the other way around):
    - FLOAT's shape changed from a one-directional dip (0 → -20px → 0) to the full bidirectional
      sine export already used (0 → +20px → 0 → -20px → 0).
    - HEARTBEAT's period corrected from 1.5s to 1.2s, matching export exactly (previously would
      visibly desync from the same segment's export render).
    - SHAKE's frequency corrected from ~2.5Hz (a 5-point linear keyframe array over 0.4s) to the
      10Hz continuous sine export uses.
    - Entry types (BOUNCE/ROTATE/SKEW) no longer fade in from `opacity: 0` — canvas math has no
      effect on alpha for these, so preview no longer invents one either; media is visible from
      t=0, offset only by its own transform.
    - NEON_FLICKER's glow (`shadowBlur`/`shadowColor`) remains a canvas-only export effect,
      unchanged — this was already an accepted preview/export divergence before A1, not something
      this task was scoped to add.
  - **Decisions locked during audit, applied as-is:** raw px amplitude constants ported unscaled
    (no proportional rescale for the preview stage's variable on-screen size — accepted caveat: can
    look proportionally smaller on a large preview pane); no `key` prop added to either wrapper (see
    root-cause note above).
  - **Untouched:** `getMotionProps`/`constants.ts` — still consumed by the unrelated TextOverlay
    entrance-animation feature (`extraOverlays`, `TEXT_ANIMATIONS`) at a separate call site
    (`PreviewStage.tsx` ~1027); confirmed via full-codebase grep before deciding not to remove
    anything from `constants.ts`.
  - **Remaining at the time A1 landed:** A2 (boundary-frame pre-pull) and A3 (transition-window
    realignment) were still open — both have since landed, see their own ✅ COMPLETED entries
    below. **Phase A is now fully closed (A1+A2+A3).**
  - **Verification:** `tsc --noEmit` clean, `vitest run` 135/135 passing (count unchanged — no
    tests exercise this render-internal helper directly). Committed in `fix: convert AnimationType
    preview twins to timeInSegment-driven transforms, matching export exactly (Phase A1)`.

- **Phase A2 of 3 — boundary-frame pre-pull (completed 2026-07-06).**
  Per Section 8.1 step 2 ("Eliminate the boundary frozen frame"). Targets audit-confirmed Finding
  3: `useWebCodecsPreview.ts`'s decode-ahead effect only called `pool.ensureSession()` for the next
  segment — which warms the session (kicks off demux + configure + an internal `fillWindow` wait)
  but never converts that into a paintable frame ahead of the crossing — so `frameSegmentId` (and
  therefore the visible frame) could lag `currentSegment.id` by however long the next segment's cold
  decode-ahead hadn't yet finished (measured up to ~436ms even against an "already-warmed" session,
  since "warmed" only meant the session object existed and decode was in flight, not that it had
  resolved).
  - **Root-cause fix, not another symptom guard:** the decode-ahead effect (`useWebCodecsPreview.ts`
    ~502-511) now issues `pool.getFrameAt(nextSegment.id, start)` immediately alongside the existing
    `ensureSession(next...)` call, stashing the resulting promise in a new `pendingBoundaryPullRef`.
    The frame-pull effect's chase (`startChaseIfIdle`, ~586-604) checks this ref first — if it holds
    a promise for the segment that just became current, it's consumed (single-use) as the chase's
    first `fetch` instead of firing a second, independent `getFrameAt` call.
  - **Concurrency risk found and avoided during the audit:** a naive implementation adding a second,
    independently-scheduled `pool.getFrameAt` call site (one from decode-ahead, one from the existing
    chase) would have raced the two calls against the SAME session the instant the pre-pulled segment
    becomes current — `getFrameAt`'s frame-selection/eviction block (`videoDecoderPool.ts` ~592-623)
    is not itself protected by a per-session lock (only the feed *batch* is guarded by
    `feedInFlight`), so two overlapping calls resolving out of order could close a frame the other had
    already handed to `setFrame` — reproducing, in a new shape, the exact class of bug
    `chaseMutexRef`/`resetChaseMutex` were built to prevent for a different scenario (StrictMode
    double-invoke). Routing the pre-pull through the existing chase's own `fetch` closure instead of a
    second call site avoids this: at most one `getFrameAt` call is ever in flight per session,
    unchanged from before this fix.
  - **Guards deliberately left unchanged:** `PreviewCanvas.tsx`'s null-frame retain,
    `computeDisplayedSegment`, and `computeOverlayHoldState` all stay in place as fallbacks — they
    still correctly cover residual cases the pre-pull can't reach (the very first segment of a
    project, a cold scrub that skips decode-ahead entirely, or a very short segment / first-referenced
    large asset whose demux+decode can't finish even with the earliest possible pull). They should
    engage far less often post-fix, not never — no fallback mechanism was touched or simplified this
    pass.
  - **Remaining at the time A2 landed:** A3 (transition-window realignment) was still NOT STARTED,
    expected to close the other half of the user-reported symptom this task started from ("both
    segments' edges freeze, then the video plays after it ends") — the genuine timing-window
    mismatch (preview's transition blend sitting BEFORE the nominal segment boundary, export's
    sitting AFTER it — Finding 4). A3 has since landed — see its own ✅ COMPLETED entry below.
  - **Verification:** `tsc --noEmit` clean, `vitest run` 135/135 passing (count unchanged — this is
    async decode-timing behavior, not a new pure/unit-testable function). Committed in `fix:
    proactively pre-pull next segment's boundary frame during decode-ahead, eliminating first-paint
    freeze at segment cuts (Phase A2)`.

- **Phase A3 of 3 — transition-window realignment + caption-hold companion fix (completed
  2026-07-06) — closes Phase A.**
  Per Section 8.1 step 3 ("Transition-timing alignment"). Targets audit-confirmed Finding 4:
  `useTransitionPreview.ts`'s blend window sat BEFORE the nominal segment boundary (inside the
  outgoing segment's own trailing span) while `segmentEncoder.ts`/export bakes the blend AFTER the
  boundary (inside the incoming segment's own leading span) — a confirmed preview/export timing
  divergence.
  - **Root-cause fix:** `useTransitionPreview.ts`'s window derivation (~94-166) now evaluates two
    candidate windows off whichever segment currently contains the playhead (`containingSeg`):
    candidate A (`containingSeg` about to end — pre-roll lead-in only, no blend yet) and candidate B
    (`containingSeg` just started — the real, active blend window, sitting inside its own leading
    `duration`). Candidate B wins if both are true at once. The outgoing snapshot is now sampled at
    the outgoing segment's own final frame (`outgoingSeg.duration - OUTGOING_SNAPSHOT_EPSILON_S`,
    0.05s safety margin) rather than at a fixed offset mid-segment, matching export's actual
    "blend against the outgoing segment's last frame" semantics.
  - **Caption-hold companion fix (`PreviewStage.tsx`):** `currentSegment` now flips to the incoming
    segment at the window's START (not its end, as before), since the blend window moved to sit
    after the boundary. The DOM body caption previously read `currentSegment` directly on the
    assumption it only flips when the transition window ends — no longer true. Added
    `findOutgoingSegment` (~189-201) and a new `captionSegment` (~510-512): while
    `showTransitionOverlay` is true, the caption (text + position, ~850-857, ~1217+) reads the
    OUTGOING segment instead, switching to the incoming segment's own caption only once the overlay
    itself releases — so the caption still reads as steady throughout the crossfade.
  - **Interaction confirmed with A2 and the pre-existing Bug 1/Bug 2 catch-up gate:** unaffected —
    A3 only changes which side of the boundary `transitionPreview.isActive` is true on; it does not
    touch `useWebCodecsPreview.ts`, `computeDisplayedSegment`, `computeOverlayHoldState`, or
    `frameSegmentId` at all. Post-A3, the overlay/hold window now extends `transitionDuration`
    seconds INTO the incoming segment rather than ending exactly at the boundary, which in practice
    gives the Bug 1/Bug 2 catch-up gate more headroom (not less) before it would ever need to
    visibly hold past the overlay's own natural window.
  - **Post-A3 manual testing surfaced 3 residual issues — none fixed by, or caused by, this task:**
    1. **Animation snap-back (pre-existing, NOT caused by A3) — ✅ FIXED, see the new Follow-On
       item immediately below this entry.** `useWebCodecsPreview.ts`'s `computeDisplayedSegment`
       (~321-330) holds the animation-driving segment on the OUTGOING segment while content
       catch-up is pending, clamped to its own end-state duration (~341-347). When catch-up
       completes, the held segment used to snap directly to the incoming segment with
       `animTimeInSegment ~= 0` — a hard, one-frame transform discontinuity. Invisible before A1
       (the old Framer wall-clock keyframes didn't read `timeInSegment` at all); A1's conversion of
       10 animation types (plus the pre-existing KEN_BURNS/ZOOM family) to pure functions of
       `timeInSegment` is what exposed this snap visibly whenever the hold released on a segment
       using one of these animation types. Intermittent because the hold only engages under
       variable decode load.
    2. **Frozen frame during transitions (known limitation, unchanged by A3) — 🔶 AUDITED,
       DEFERRED TO PHASE B, see the new Follow-On item below the snap-back fix entry.** Both
       `useTransitionPreview.ts` snapshots are rendered ONCE per boundary and blended purely by
       `progress` — neither is ever re-rendered against a moving `timeInSegment`, so the transition
       itself shows no live motion for its full duration. This is the static-snapshot architecture
       described in this file's own header comment (~1-11), not a bug. A completed audit
       (2026-07-06) concluded the real ("live blend") fix requires Phase B's shared compositor —
       not scoped as a standalone fix here.
    3. **General preview playback lag/smoothness (out of scope, unconfirmed root cause):** reported
       as present both at segment boundaries and during ordinary mid-segment playback. A3's diff
       (and A2's) add negligible per-render/per-boundary cost only — neither touches the
       steady-state frame-pull chase (`useWebCodecsPreview.ts` ~519-621) that runs continuously
       during normal playback. Root cause requires runtime profiling (decode throughput / main-thread
       contention / GC pressure), not a code-review diff audit — tracked as a distinct, separate
       investigation, not a Phase A follow-up.
  - **Verification:** `tsc --noEmit` clean, `vitest run` 135/135 passing (count unchanged — this is
    async decode-timing + DOM-render behavior, not new pure/unit-testable functions). Committed in
    `feat: align preview transition window with export placement + hold caption through blend
    (Phase A3 — closes Phase A)`.

- **Phase A follow-up — animation snap-back fix (completed 2026-07-06).**
  Closes residual issue 1 from the A3 entry above. `computeDisplayedSegment` (`useWebCodecsPreview.ts`
  ~321-330) correctly holds the animation-driving segment on the OUTGOING segment while content
  catch-up is pending, but previously released with a hard, one-frame transform snap once catch-up
  completed — newly visible (not caused) since A1 converted 10 animation types to pure functions of
  `timeInSegment`.
  - **Root-cause fix — a real interpolation of the rendered VALUE, not a mask:** new additive exports
    in `useWebCodecsPreview.ts` (~387-466): `SnapReleaseBlend`/`computeSnapReleaseBlend` edge-detects
    the exact render where the held segment id changes (a genuine release, not routine playback) and
    anchors a "from" pose (the segment + its own frozen `timeInSegment` that was actually on screen the
    render before release) plus the `currentTime` it happened at; `computeBlendProgress` derives a
    0→1 progress from `currentTime` deltas against a new `SNAP_RELEASE_BLEND_S` constant (0.12s).
    Neither modifies `computeDisplayedSegment`/`computeAnimTimeInSegment`/`computeOverlayHoldState` or
    their existing tests — fully additive.
  - **New module `src/services/animBlend.ts`:** `blendWrapperProps(from, to, t)` parses the closed set
    of CSS fields `getAnimationWrapperProps` can produce (`translate`/`translateX`/`translateY`/
    `scale`/`rotate`/`skewX`, `opacity`, `filter: blur()`), defaults a component missing on either side
    to its CSS identity value, and lerps — so blending FROM one animation type TOWARD a segment using a
    completely different type (or `AnimationType.NONE`) still produces a continuous "settle" rather
    than a hard cut. Deliberately NOT added to `canvasAnimations.ts` — export has no equivalent
    discontinuity to fix (`segmentEncoder.ts` renders every frame directly, no async catch-up gate),
    so this stays a preview-only concern.
  - **`PreviewStage.tsx` wiring (~488-536, ~639-661, ~968-969):** a new `resolveSegmentAnimationType`
    helper (factored out of the old inline effectAnimation-vs-animation IIFE) resolves both the "from"
    and "to" poses identically so they can't drift; `animationWrapperProps` computes `toProps` as
    before and, only while `animBlendProgress < 1`, blends it against the frozen "from" pose's own
    `getAnimationWrapperProps` output — otherwise byte-identical to the pre-fix direct call. Gated on
    `suppressMotionAnim` exactly as before (no wrapper transform at all while the transition overlay
    is covering the screen — unchanged).
  - **Considered and rejected:** a native CSS `transition: transform 120ms` instead of computing the
    blend in JS — far less code, but runs on the browser's own compositor clock rather than
    `currentTime`, so a pause/seek landing exactly inside that window would keep animating regardless
    of playback state, reintroducing (for that narrow window) the exact "ignores pause/seek" class of
    bug A1 fixed. Rejected for that reason; the shipped fix is driven entirely by `currentTime` deltas
    (see `computeBlendProgress`'s own doc), so pausing mid-blend freezes it and seeking recomputes it
    fresh next render.
  - **Interaction confirmed with A2's boundary pre-pull and `computeOverlayHoldState`:** unaffected —
    A2 reduces how *often* this blend even engages (content is frequently already caught up by the
    first post-boundary render, so `computeDisplayedSegment` never enters the held branch at all), but
    doesn't change the mechanism when it does. `computeOverlayHoldState`'s own engage/release timing is
    driven solely by `wasTransitionActive`/`contentCaughtUp`, neither of which this fix touches — the
    two hold/release state machines (overlay-canvas vs. animation-wrapper-transform) remain
    independent.
  - **Verification:** `tsc --noEmit` clean, `vitest run` 159/159 passing (135 + 12 new `animBlend.ts`
    tests + 12 new `computeSnapReleaseBlend`/`computeBlendProgress` tests in
    `useWebCodecsPreview.test.ts`). Committed in `fix: smoothly blend animation transform on
    content-catchup hold release, eliminating snap-back (Phase A follow-up)`.

- **Phase A follow-on — frozen transition frame audited, deferred to Phase B (2026-07-06).**
  Closes residual issue 2 from the A3 entry above with a disposition, not a fix — a dedicated
  audit session concluded a real ("live blend") fix requires the preview/export-unification work
  Phase B already scopes to do properly, and building it standalone now would mean solving it
  twice: once ad hoc here, once again — properly — in Phase B.
  - **Structural cause confirmed:** `useTransitionPreview.ts` renders the outgoing/incoming
    segments to offscreen canvases ONCE at pre-roll (~179-310) and blends them purely as a
    function of `progress` for the whole `transitionDuration` — neither source canvas is ever
    re-rendered against a moving `timeInSegment`. Note the blend-DRAW effect itself already
    reruns every render tick (it depends on `progress`, which changes every tick as `currentTime`
    advances) — only the two SOURCE canvases it draws from are frozen, not the redraw loop. A
    live fix means sampling both segments' own advancing time per tick — the outgoing side
    continuing toward its true end, the incoming side starting from its own true 0 — not adding a
    new loop.
  - **Cost analysis rules out a naive per-tick re-render:** the transition path's video source is
    `frameRenderer.ts`'s HTML5 `<video>`-seek cache (`getOrCreateVideo`/`seekVideo`, ~86-184), NOT
    `videoDecoderPool.ts`. `useTransitionPreview.ts`'s own `PRE_ROLL_LEAD_S` comment (~23-27)
    already states the real cost: "worst-case parallel seek cost (~200ms per video)... Same-asset
    sequential fallback costs ~400ms." Calling this every rAF tick for a transition's typical
    ~0.3-1s life is categorically infeasible — 15-60+ seeks stacked into a window barely longer
    than a single seek. The only viable live-sampling primitive already in this codebase is
    `VideoDecoderPool.getFrameAt` — once a session's window is warm, a cheap in-memory
    buffered-frame lookup with no seek and no async wait — the same mechanism
    `useWebCodecsPreview.ts` already uses, safely, every tick for ordinary playback.
  - **Duplication-with-`VideoDecoderPool` finding:** `useTransitionPreview.ts` never touches
    `VideoDecoderPool` at all — it exclusively goes through `frameRenderer.ts`'s own separate
    `videoCache` `Map`. Today there are two fully independent video-sourcing mechanisms live in
    preview simultaneously (the pool for main content, `frameRenderer.ts`'s cache for transition
    snapshots only). A live-blend fix built on the pool would need new dual-session plumbing —
    tracking two simultaneous protected segments/frames (outgoing + incoming) instead of the
    single "current" frame/session pair `computeKeepSet`/`setProtectedIds` manage today — plumbing
    that substantially pre-builds a slice of exactly what Phase B's shared compositor
    (Section 8.2) is already scoped to build once, generally, for both preview AND export.
  - **Export-already-correct finding:** `segmentEncoder.ts` renders every transition output frame
    individually via `renderSegmentFrame`, each sampling its own segment's real advancing time —
    export has no frozen-frame problem today. This is precisely a preview/export divergence, the
    exact category Phase B (Section 8.2) exists to close by putting both paths on one compositor.
  - **Disposition — 🔶 DEFERRED TO PHASE B, not fixed, not dropped, not forgotten.** Do NOT attempt
    a standalone fix now: it would mean solving this twice, or worse, shipping throwaway
    architecture Phase B's shared compositor would immediately supersede. See Section 8.2's new
    cross-reference note for why Phase B is expected to resolve this as a natural consequence of
    its own already-planned scope, not as separate new work.
  - **Confidence after Phase B: HIGH, not absolute.** Phase B's stated goal — one shared
    compositor, "preview == export true by construction" — structurally eliminates the
    frozen-snapshot mechanism (puts preview's transition blend on the same live source export
    already uses). But Phase B itself is unbuilt and untested; its own new risks (drift,
    encoder-swap performance, dual-session frame-pulling edge cases) mean "resolves cleanly" is a
    strong expectation here, not a guarantee, until Phase B ships and is verified end-to-end.
  - **No source code changed.** This is an audit-and-disposition entry only —
    `useTransitionPreview.ts`, `frameRenderer.ts`, `useWebCodecsPreview.ts`, `videoDecoderPool.ts`
    are all unmodified by this entry.
  - **Verification:** `tsc --noEmit` clean, `vitest run` 159/159 passing (unchanged — docs-only
    change, no new tests). Committed in `docs: defer Item 4 (frozen transition frame) to Phase B —
    audit confirms structural fix requires shared compositor`.

**Phase A is now fully ✅ COMPLETE (A1 + A2 + A3), its first follow-up (animation snap-back,
residual issue 1) is ✅ COMPLETE, and residual issue 2 (frozen-frame transition blend) is now
🔶 AUDITED / DEFERRED TO PHASE B** (see the audit entry immediately above — deliberately deferred
after a completed audit, not forgotten or skipped; Section 8.2 carries a cross-reference expecting
Phase B to resolve it as a natural consequence of its own already-planned scope, not new work).
**Residual issue 3 (general playback lag) remains open, unscoped, a separate future
investigation** — see the A3 entry above.

- **Phase B0 — Encoder feasibility spike. ✅ COMPLETE — result: ❌ BLOCKED / INFEASIBLE on this
  runtime.** Per Section 8.2's own gate ("if hardware/software encode both fail or produce garbage
  on the real Tauri WKWebView runtime, STOP and report Phase B as infeasible on this engine as
  currently scoped — do not proceed to B1 regardless of how close it seems"), a throwaway spike
  (`src/dev/webcodecsEncoderSpike/main.ts` + `spike-webcodecs-encoder.html`, both deleted after
  this entry was written — mirrored the Phase 0 spike convention, `devUrl` temporarily repointed at
  the harness the same way the WKWebView Cross-Check did) tested real `VideoEncoder.encode()` —
  not just `isConfigSupported` — across all 4 combinations of hardware/software acceleration ×
  avc/annexb bitstream format, on this project's real Tauri WKWebView (macOS 26.5.2). Prior research
  (MDN/caniuse claiming Safari 16.4+ support, plus a real, still-open WebKit bug —
  bugs.webkit.org #258060, filed 2023, "quality of video encode by VideoEncoder ... on mac safari is
  poor" — and #281945, `annexb` format not honored for HEVC) established this needed an empirical
  check, not a documentation-only answer.
  - **Result: all 4/4 configs hung identically.** `isConfigSupported` reported `true` for every
    config. Real encode: `encodeQueueSize` dropped from 15→11 immediately after all 15 synthetic
    frames were submitted, then plateaued at 11 forever; `chunksEmitted` stayed at 0 throughout;
    `encoder.flush()` never resolved within a 15s timeout for ANY config; no `error` callback ever
    fired (`encoder.state` stayed `'configured'`, never transitioning to `'closed'` on its own — a
    silent hang, not a surfaced failure). Hardware and software failed the same way, ruling out
    "prefer the other backend" as a mitigation; default and `annexb` bitstream format failed the
    same way, making the ffmpeg-mux-without-a-JS-muxer question moot (zero output to test it
    against either way).
  - **Not attributed to a spike-harness bug.** The harness's `VideoFrame(canvas, {timestamp})`
    construction, closing each frame immediately after `encode()`, and the config shape all match
    the standard WebCodecs sample pattern; the identical 15→11 plateau across four independently
    different backend/format combinations is inconsistent with an isolated per-config engine bug
    and points at something systemic in this WKWebView build's `VideoEncoder` binding — but this
    was not independently re-verified against a second, unrelated known-good reference
    implementation, so residual uncertainty about the harness is disclosed, not eliminated.
  - **Confirms and exceeds `docs/phase-7-task-1-export-profiling.md:79`'s earlier rejection.** That
    doc rejected the WebCodecs-encoder path for export on the grounds that "WebKit support ...
    [is] recent and inconsistent," based on documentation/risk assessment alone, without a live
    test. This spike is the live test that earlier analysis called for — and finds the situation
    materially worse than "inconsistent quality": non-functional (a hang), on both hardware and
    software paths, on a real, current (macOS 26.5.2) WKWebView.
  - **Disposition: attempted-and-rejected, not abandoned-without-investigation, and not
    permanently closed.** Phase B (Section 8.2) as originally scoped is BLOCKED on this runtime,
    effective now. No further debugging or a WebKit bug report was pursued this round — explicitly
    deprioritized, not because the finding is uncertain, but because it's conclusive enough to
    redirect effort elsewhere. The current ffmpeg PNG/IPC export pipeline remains the shipped,
    working path (slower with effects active, per the existing CLAUDE.md performance figures, but
    functionally correct). The already-recorded next candidate for export speed-up is the
    OffscreenCanvas/Worker approach from `docs/phase-7-task-1-export-profiling.md`'s own
    recommendation (I/O-bound `toBlob`/IPC-write bottleneck, ~40–55% projected speedup) — noted
    here only as the existing next candidate, not scoped or started by this entry. Item 4 (frozen
    transition frame), previously deferred to Phase B, is now **BLOCKED transitively** along with
    Phase B itself — it remains open, unscoped, pending either a future retry of Phase B on a
    newer/different WKWebView build, or a standalone fix considered on its own merits instead of
    waiting on a compositor unification that can no longer proceed as designed.
  - **No pipeline source changed.** `frameRenderer.ts`, `segmentEncoder.ts`, `exportPipeline.ts`,
    `plainSegment.ts`, `useTransitionPreview.ts`, `videoDecoderPool.ts`, `useWebCodecsPreview.ts` are
    all unmodified — this was audit/spike/cleanup only, exactly as scoped.
  - **Verification:** `tsc --noEmit` clean, `vitest run` 159/159 passing (docs + spike-file cleanup
    only, no production code touched, no new tests). Committed in `docs: mark Phase B
    WebCodecs-encoder export path as blocked (VideoEncoder non-functional on WKWebView) + remove B0
    spike artifacts`.

### ⬜ NOT STARTED / PENDING — Follow-On Phases A–C

- **Phase A — Unify the clock (preview). ✅ COMPLETE — 3 of 3 steps done (A1 animation-twin
  conversion, A2 boundary-frame pre-pull, A3 transition-window realignment + caption-hold
  companion) — see ✅ COMPLETED above.** No longer pending. Post-A3 manual testing surfaced 3
  residual issues NOT part of Phase A's scope — see A3's own entry above for detail. Residual issue
  1 (animation snap-back) is now **✅ FIXED** as a separate Phase A follow-up (see its own
  ✅ COMPLETED entry above); residual issue 2 (frozen-frame transition blend) is now
  **🔶 DEFERRED TO PHASE B** after a completed audit (see its own ✅ COMPLETED entry above and
  Section 8.2's cross-reference below) — not forgotten or skipped, deliberately deferred pending
  Phase B's shared compositor; residual issue 3 (general playback lag) remains open, unscoped, a
  separate future investigation.
- **Phase B — ❌ BLOCKED / INFEASIBLE on this runtime (B0 spike complete, see ✅ COMPLETED above).**
  Originally scoped to migrate export onto WebCodecs `VideoEncoder` behind ONE shared compositor,
  retiring the per-frame HTML5-seek → PNG → IPC path. The B0 feasibility spike found real
  `VideoEncoder.encode()` non-functional on this project's real Tauri WKWebView (macOS 26.5.2): all
  4 tested configs (hardware/software × avc/annexb) hung identically — `flush()` never resolved,
  zero chunks ever emitted, no error surfaced. Confirms and exceeds the risk
  `docs/phase-7-task-1-export-profiling.md:79` already flagged. Not pursued further this round by
  deliberate choice, not because the result is ambiguous. The legacy ffmpeg PNG/IPC export path
  remains shipped and correct; Phase C (quality pass) is moot while Phase B is blocked. See the B0
  ✅ COMPLETED entry above for full evidence and disposition.
- **Phase C — Quality pass.** Real color-space conversion (not tagging); cross-segment frame-timing/
  drift correction against the audio master clock; quality-pinned encoder settings for full-HD, no-loss
  output. Full definition in Section 8 below.
- **Quick wins (do first, independently mergeable) — 3 of 3 done, see ✅ COMPLETED above.** Quick
  Wins are fully COMPLETE: the `[DIAG]`/live-`//FFCACHE` log strip, the black-flash guard, and the
  image-fade-replay fix (option (a), not the dip-black/white blend) have all landed (with caveats
  noted above). **Phase A is now fully COMPLETE (A1 + A2 + A3 all done).** Two threads were explicitly carved
  out of quick-win scope from the start and remain open where first flagged: the dormant
  `//FFCACHE` dead-code block and the export `console.debug` lines (both under quick win 1). Full
  step definitions in Section 8.0 below.

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

---

## Phase 0 Results

**Date:** 2026-07-04. **Verdict: GO — confirmed on both Chromium and the real Tauri app's WKWebView.** Real app code untouched — this was a fully standalone harness, never wired into `PreviewStage.tsx`, `App.tsx`, or any other file under `src/` outside the new throwaway files listed below. (This section originally shipped with a Chromium-only verdict and an explicit "unconfirmed on WKWebView" caveat; the WKWebView cross-check below was completed in a follow-up pass on the same date and the verdict has been updated in place.)

### What was built (throwaway, delete before Phase 1 lands)

- [spike-webcodecs.html](../spike-webcodecs.html) — new HTML entry at repo root. Vite's dev server serves any root-level `.html` file automatically; it is not referenced by `vite.config.ts` and is not part of `npm run build`'s output (build only bundles `index.html` unless configured otherwise), so it cannot affect the production app.
- [src/dev/webcodecsSpike/main.ts](../src/dev/webcodecsSpike/main.ts) — the actual spike logic (demux → decode → paint → measure). Not imported by any real app file.
- `public/_spike/sample.mp4` — a **real** test asset, not synthetic: fetched live from the Pexels video API (the same API `src/services/stockService.ts` already integrates with, using the existing `VITE_PEXELS_API_KEY` from `.env.local`) via the exact request shape `stockService.ts` uses. Confirmed via `ffprobe` before use: H.264 **High profile**, 1280×720, 30fps, `yuv420p`, and critically a real B-frame GOP structure (`I,B,B,B,P,B,B,B,P,B,B,B,P,P,P,P,P,B,P,...`) — this is what makes Check 4 (frame-reorder correctness) a real test rather than a trivial all-I-frame case. This file is gitignored (`public/_spike/`, added to `.gitignore` in this change) and was never staged.
- `mp4box` (v2.4.1) added to `package.json` dependencies — the demuxer library. Chosen over hand-rolled MP4 box parsing per Section 1.4's recommendation; no alternative was evaluated because this one worked correctly once the two issues below were resolved, and it's the same library the official [W3C WebCodecs samples repo](https://github.com/w3c/webcodecs) uses in its reference `MP4Demuxer`, which this spike's demux logic is directly adapted from.

### Results against Section 1.5's four checks (Chromium, via this environment's preview tooling)

| # | Check | Result |
|---|---|---|
| 1 | `VideoDecoder`/`EncodedVideoChunk` present, real `configure()`/`decode()` cycle succeeds | **Pass.** `isConfigSupported` returned `true` for `avc1.640020` (H.264 High profile) at 1280×720; decoder configured and ran without error. |
| 2 | mp4box.js extracts chunks + avcC description from a real asset | **Pass**, after two fixes not anticipated in the original plan (see Deviations). Demuxed 312 samples, codec string `avc1.640020`, correct 1280×720 dimensions, avcC description extracted and accepted by `VideoDecoder.isConfigSupported`. |
| 3 | Decoded `VideoFrame`s paint to canvas | **Pass.** All 312 frames painted via `drawImage`; visually confirmed via screenshot (sharp, uncorrupted city-skyline footage, no artifacts, no misordered/jumbled content). |
| 4 | Frames arrive in correct presentation order despite real B-frames | **Pass.** Fed (decode-order) timestamps for the first 32 samples are visibly non-monotonic — `[67, 200, 133, 100, 167, 334, 267, 234, 300, 467, 400, 367, ...]` ms — proving the B-frame GOP genuinely exercised decode/presentation-order divergence. Output (presentation) order for the same frames is cleanly monotonic ascending — `[67, 100, 133, 167, 200, 234, 267, 300, 334, 367, 400, 434, ...]` ms. Chromium's `VideoDecoder` reordered correctly. |

**Throughput:** 312 frames decoded in ~820–860ms wall time across repeated runs (~365–380 fps), for a 1280×720 H.264 High-profile source. This is ~12–13× realtime at the source's 30fps — comfortably fast, though this is Chromium on Apple Silicon and is not a substitute for the Section 6-flagged macOS Intel / low-end-Windows measurement Phase 6 still needs.

### Deviations from the plan's assumptions (flagged per the task's request)

1. **mp4box.js needed two non-obvious fixes to work at all — this is new information, not a footnote.** Adapting the official W3C reference `MP4Demuxer` (which is designed for a streamed `fetch().body.pipeTo()` source) to a simpler "fetch the whole file, then demux" flow (appropriate here since spike assets are small) surfaced two real bugs that silently produced **zero decoded frames with zero errors thrown** — the failure mode was total silence, not an exception, which would have been easy to misdiagnose as "WebCodecs doesn't work" rather than "the demuxer integration was wrong":
   - Calling `mp4boxFile.flush()` after a single whole-file `appendBuffer()` (to mirror "wait for onReady" cleanly) caused `mp4box` to discard buffered `mdat` bytes before `setExtractionOptions()`/`start()` ran afterward — `onSamples` never fired even though the sample table (`nb_samples`, offsets, timing) was built correctly. **Fix:** call `setExtractionOptions()`/`start()` from inside `onReady` itself, before any `flush()` — and skip `flush()` entirely for a single-shot full-buffer append (it exists for the incremental/streamed case the reference demo is built for).
   - Separately, `createFile()`'s **default** `keepMdatData` parameter is `false` — appropriate for a real streaming scenario, but for a single whole-file `appendBuffer()` this discards the raw bytes needed to actually read samples back out (confirmed via `window.__mp4boxFile` console inspection: `stream.buffers.length === 0` and `mdats[0].stream === undefined` after append, so `ISOFile.getSample()` had nowhere to read from). **Fix:** `createFile(true)`.
   - Both fixes are documented inline in `main.ts` at the point they matter, since a future implementer hitting the same "zero frames, zero errors" symptom in Phase 1+ should not have to re-derive this from scratch.
   - **Implication for Phase 1+:** budget real time for demuxer integration debugging — it is not a drop-in library call, and its failure mode (silent zero-output, not an exception) makes it easy to misattribute a demuxer bug to a WebCodecs/browser limitation.

2. **No B-frame-specific concern with the demuxer itself.** mp4box.js exposes samples in container (decode) order and lets `sample.cts`/`sample.dts` differ per-sample — it does no reordering itself (correctly so; reordering is `VideoDecoder`'s job per spec). The clean pass on Check 4 is attributable to the browser's decoder, not the demuxer, which is the right division of responsibility for what Phase 1+ will build.

### What did not deviate

- No demuxer alternative to mp4box.js was needed — Section 1.4's default choice held up.
- No codec/container surprises: the real Pexels asset was a standard High-profile H.264/yuv420p MP4, nothing exotic. (This says nothing about arbitrary user-uploaded files, which Section 6's existing risk entry about non-clean containers still correctly flags as untested.)
- Decode throughput on this machine is not a concern at this scale (1 video, 312 frames) — says nothing yet about sustained multi-segment decode-ahead load, which is Phase 6's job to measure.

---

## WKWebView Cross-Check (2026-07-04, same day, follow-up pass)

Section 1.1 of this plan corrected a load-bearing assumption: Tauri v2 only uses a Chromium webview on Windows — macOS runs on **WKWebView** (WebKit/Safari's engine), which historically trailed Chromium on WebCodecs and has had real correctness bugs in exactly the area this plan cares about (B-frame output reordering). The original Phase 0 pass above validated Chromium only, via this environment's browser-preview tooling, and explicitly flagged WKWebView as the one real open question. This section closes that gap by running the actual spike inside the real Tauri desktop app on this Mac.

### Method

1. Temporarily pointed `src-tauri/tauri.conf.json`'s `build.devUrl` at `http://localhost:3000/spike-webcodecs.html` (instead of the app root) so the real Tauri window loads the spike harness directly on launch — reverted immediately after (see "Cleanup" below).
2. Launched the real desktop app via `npm run tauri:dev` (the `tauri:dev` script; `tauri dev` is not a valid script name in this repo — noted only because it cost one failed attempt).
3. This environment's automation tools could not drive the resulting native window: `osascript`/System Events UI scripting was blocked (`osascript is not allowed assistive access`, error -1719 — no accessibility permission grantable in this sandboxed session) and `screencapture` failed outright (`could not create image from display` — no screen-recording permission either). Both are normal, unautomatable-by-design macOS TCC restrictions in this environment, not something to route around.
4. Given that, the user directly inspected the running app: right-clicked → **Inspect Element** (confirming WKWebView's Web Inspector is reachable this way — the app has the `"devtools"` Cargo feature enabled) and read the Console tab's output back verbatim.

### A real bug the cross-check caught (harness, not WKWebView)

The first attempt produced **"Chunks fed: 936"** and **"Check 4 — output order monotonic: false."** 936 = 3 × 312 (the real per-video sample count) — a dead giveaway. The user had clicked the harness's "Re-run" button twice in addition to the automatic first run, and the original harness (correctly, for a *single* run) declared one module-scoped `result` object and never reset it between invocations. Three runs' worth of `chunksFed`/`framesDecoded`/`outputOrderTsMs` all accumulated into the same arrays, so the monotonicity check ran across the *concatenation* of three independent 0→312-sample sequences — each individually ascending, but the boundary between run 2 and run 3 (timestamp ~10,400ms dropping back to ~67ms) broke monotonicity for the concatenated whole. **This was never a WKWebView reordering defect — it was a test-harness state-reset bug**, caught only because the sample count didn't match expectations. `main.ts` was fixed to construct a fresh `SpikeResult` object inside every `runSpike()` call (not at module scope) and log a per-run invocation counter, so a repeat run can never again silently corrupt a prior run's measurement. This fix is retained in the harness (it's a correctness improvement, not cross-check-specific instrumentation) even though the temporary `localStorage`-based result-persistence code added mid-investigation (an attempted workaround for the lack of interactive console access, made moot once the user confirmed Inspect Element worked) was removed again before finalizing.

### Clean single-run WKWebView result (post-fix, run #1, verbatim from the user's Console tab read)

| # | Check | WKWebView result | Chromium result (original pass) |
|---|---|---|---|
| 1 | `VideoDecoder`/`EncodedVideoChunk` present | **true** | true |
| 2 | mp4box demux: codec/dimensions/sample count | **`avc1.640020`, 1280×720, `nb_samples=312`** — identical to Chromium | `avc1.640020`, 1280×720, `nb_samples=312` |
| — | `isConfigSupported` | **true** | true |
| 3 | Frames painted (chunks fed = frames decoded) | **312 / 312** | 312 / 312 |
| 4 | Output order monotonic (correct B-frame reordering) | **true** — `[67, 100, 133, 167, 200, 234, 267, 300, 334, 367, 400, 434, ...]` ms, cleanly ascending, matching Chromium's sequence exactly, against the same non-monotonic decode-order feed (`[67, 200, 133, 100, 167, 334, 267, 234, 300, 467, 400, 367, ...]` ms) | true, same sequences |
| — | Decode wall time / throughput | **1030ms / ~303 fps** | ~820–860ms / ~365–380 fps |

**WKWebView passes all four checks, matching Chromium's correctness exactly** (identical codec string, identical frame count, identical output-order sequence). Throughput is lower than Chromium (~303 fps vs. ~365–380 fps — WKWebView is roughly 20% slower on this machine for this asset) but still ~10× realtime for a 30fps source, nowhere near a concern for feasibility. This directly resolves Section 1.1/1.2's central open question: **the WebKit B-frame-reordering risk that motivated this whole cross-check did not materialize** — at least on this macOS version (26.5.2, i.e. very current WebKit) and this asset's GOP structure. It does not by itself prove every older supported macOS version behaves identically (see "Still open" below).

### Cleanup performed

- `src-tauri/tauri.conf.json`'s `devUrl` reverted to `http://localhost:3000` (confirmed via `git diff` — zero diff against the pre-cross-check state).
- The temporary `localStorage`-persistence function and its two call sites removed from `main.ts`; the per-run `freshResult()`/invocation-counter fix (a genuine bug fix, not cross-check-specific) was kept.
- The Tauri app process and its `beforeDevCommand` vite server were terminated (`kill`) once the cross-check concluded.
- `tsc --noEmit` and the full `vitest` suite (60/60) re-run clean after all reverts.

### Still open (unchanged from the original pass)

- **Windows/WebView2** remains untested in any pass (no Windows machine available in this session). Section 1.2 already establishes this as low-risk (evergreen Chromium), so it stays a lower priority than the WKWebView gap was.
- **Only one macOS version was tested** (26.5.2, current at time of writing) and **only one asset's GOP shape**. Section 1.2's cited floor (macOS 13.3/Safari 16.4 for video-only WebCodecs) and its concern about older-WebKit B-frame bugs are about *older* WebKit builds specifically — this cross-check's clean result on a very current WebKit build does not extend backward to that floor. Treat the macOS-version-matrix question as still open for Phase 8's regression pass, not resolved by this one data point.
- Arbitrary user-uploaded container/codec shapes (non-clean MP4s, unusual profiles) remain untested on both engines, per Section 6's existing risk entry.

### Recommendation

**Proceed to Phase 1 implementation planning — the feasibility gate Section 1.5 required is now closed on both engines this project ships to a real browser-engine test on.** The one thing this cross-check could not do — test older macOS/WebKit versions or Windows — is appropriately deferred to Phase 8's broader regression pass rather than blocking Phase 1 from starting.

---

## 8. Follow-On: Preview/Export Unification (Phases A–C)

This section defines the follow-on effort announced in the Progress Tracker above, in the same
phase format as Section 5. Each phase is independently completable, testable, and revertible.
Phases A–C are additive to the shipped WebCodecs preview path; the legacy `<video>` fallback
(Section 1.6) is not touched by any of them.

### 8.0 Quick wins (land first, each independently)

- **Goal:** remove hot-path noise and two cheap visual guards before the larger phases, so their
  manual testing isn't drowned in log spam.
- **Steps:**
  1. Delete the `[DIAG]` instrumentation: `useWebCodecsPreview.ts:528-531` and `:576-577`;
     `PreviewStage.tsx:395-407` (the three DIAG effects) and `:450-452`. These are explicitly
     marked "Temporary instrumentation … remove together."
  2. Delete or `import.meta.env.DEV`-gate the `//FFCACHE` logs at `PreviewStage.tsx:648,658,664,673`.
  3. Downgrade/remove `console.debug` seek logs at `frameRenderer.ts:161,166` and `segmentEncoder.ts:109`
     (export path — these fire per frame).
  4. Black-flash guard: in `PreviewCanvas.tsx`, when the incoming frame for a new segment hasn't
     arrived yet, retain the last painted bitmap (do not `clearRect`) rather than showing empty canvas.
  5. Image-dip: on an image→image or image-involved boundary with no explicit transition, apply the
     existing dip fallback rather than a hard cut (parity with how video boundaries already read).
- **Note (avoid a permanent band-aid):** the black-flash guard (step 4) and image-dip (step 5) are
  interim *symptom*-guards ONLY if their root cause isn't already eliminated by Phase A's boundary-frame
  pin (8.1 step 2). If Phase A removes the root — the incoming boundary frame is decoded and available
  before the playhead crosses — revisit whether these guards are still needed rather than leaving them
  in place permanently.
- **Touch surface:** `useWebCodecsPreview.ts`, `PreviewStage.tsx`, `PreviewCanvas.tsx`,
  `frameRenderer.ts` (log lines only), `segmentEncoder.ts` (log line only).
- **MUST NOT touch:** `usePlayback.ts`, `videoDecoderPool.ts` frame logic, any export encode/concat/mux logic.
- **Manual test (you run):** open devtools console, play a 4-segment project through two boundaries —
  console shows no per-frame spam; no black flash at any boundary; an image→image boundary dips rather
  than hard-cuts.
- **Tracker rows on completion (⬜ → ✅):**
  `- **Quick wins — hot-path log strip + black-flash guard + image-dip.** …tsc clean, vitest N/N. Committed in …`

### 8.1 Phase A — Unify the clock (preview: playhead-driven animations, no frozen boundary, aligned transition timing) — ✅ COMPLETE

- **Goal:** every preview animation, transition, and boundary crossing is a pure function of the audio
  playhead — pauses freeze, seeks jump exactly, and what preview shows at time T is what export renders
  at time T. **All 3 steps done — see the Follow-On Effort ✅ COMPLETED tracker above for each step's
  full writeup, including 3 residual issues surfaced by post-A3 manual testing that are explicitly
  NOT part of this phase's scope (tracked separately).**
- **Concrete steps:**
  1. ✅ **DONE (2026-07-06) — Playhead animation twins.** Rewrote the `getMotionProps(...)` branches in
     `getAnimationWrapperProps` (`PreviewStage.tsx:70-103`: FLOAT, SHAKE, PULSE, WOBBLE, HEARTBEAT,
     BOUNCE, SKEW, GLITCH, NEON_FLICKER, ROTATE) to return a static `transform` computed from
     `timeInSegment`, mirroring the KEN_BURNS/ZOOM precedent at `:53-68` and the export math in
     `canvasAnimations.ts`. Framer Motion's wall-clock `repeat: Infinity` animations are replaced with
     per-render deterministic transforms. This is the single source of the preview↔export animation twin.
  2. ✅ **DONE (2026-07-06) — Eliminate the boundary frozen frame.** `useWebCodecsPreview.ts`'s
     decode-ahead effect now issues `pool.getFrameAt(nextSegment.id, start)` alongside `ensureSession`,
     stashing the result in `pendingBoundaryPullRef` for the frame-pull chase to adopt immediately at
     the crossing instant. See the Follow-On Effort ✅ COMPLETED tracker's A2 entry for full detail.
  3. ✅ **DONE (2026-07-06) — Transition-timing alignment.** `useTransitionPreview.ts`'s window now
     sits AFTER the nominal segment boundary (inside the incoming segment's own leading span),
     matching `segmentEncoder.ts`/export exactly, with a caption-hold companion fix in
     `PreviewStage.tsx` so the DOM caption keeps reading the outgoing segment for the life of the
     (relocated) blend window. See the Follow-On Effort ✅ COMPLETED tracker's A3 entry for full
     detail, including the 3 residual issues its own manual test pass surfaced.
- **Touch surface:** `PreviewStage.tsx:39-108` (animation wrapper), `PreviewStage.tsx:409-448`
  (catch-up gate), `useWebCodecsPreview.ts` (boundary-frame pin), `useTransitionPreview.ts` (window math).
- **MUST NOT touch:** `usePlayback.ts` (audio clock), `frameRenderer.ts`, `segmentEncoder.ts`,
  `canvasAnimations.ts` (export animation math is the reference — read it, don't change it), any file
  under `src-tauri/`. Do not convert overlays/captions off the DOM (Section 6 risk 5 stands).
- **Manual test (run 2026-07-06):** in the Tauri app, a project with (a) a BOUNCE segment — pause
  mid-segment: the bounce freezes correctly; scrub: it tracks the playhead; (b) two video segments
  with a cross-dissolve — play through repeatedly: no frozen/black frame at the boundary crossing
  itself; (c) BOUNCE + dissolve compared against an actual export. This pass is what surfaced the 3
  residual issues noted above — none of them are boundary-freeze or animation-twin-drift regressions
  of the kind this phase targeted.
- **Tracker rows on completion (⬜ → ✅):** `- **Phase A — Unify the clock (preview).** …` in the
  standard format, ending with tsc/vitest counts + "Committed in …". **Done — see ✅ COMPLETED
  tracker above.**

### 8.2 Phase B — Export onto WebCodecs `VideoEncoder` behind ONE shared compositor

**❌ BLOCKED / INFEASIBLE on this runtime, confirmed via the B0 feasibility spike (see the ✅
COMPLETED / ⬜ NOT STARTED tracker entries above for full evidence).** Real `VideoEncoder.encode()`
hangs on this project's real Tauri WKWebView (macOS 26.5.2) across all 4 hardware/software ×
avc/annexb configs — `isConfigSupported` reports `true`, but `flush()` never resolves and zero
output chunks are ever emitted. This confirms and exceeds the risk already on record at
`docs/phase-7-task-1-export-profiling.md:79`. The steps below are retained as the ORIGINAL plan for
historical/reference purposes and in case this is revisited on a future WKWebView build — they were
not built, and are not being pursued further right now.

- **Goal:** export renders through the SAME compositor that paints preview, encoded by a
  hardware-accelerated `VideoEncoder`; ffmpeg runs once, for the final audio+video mux only. Retires the
  per-frame HTML5-seek → PNG → `ffmpeg_write_file` path. Closes audit finding #5 (the ~6-min regression)
  and is the structural change that makes preview == export true by construction.
- **Concrete steps:**
  1. **Extract the shared compositor as a BEHAVIOUR-PRESERVING pure move FIRST.** Factor the
     frame-composite logic (draw decoded frame → filters → overlays → animation transform → transition
     blend) into one module, as a pure move that leaves preview's output byte-for-byte unchanged —
     verified against the Phase 5 (`buildPhase5Fixture.ts`) and Phase 7+8 (`buildCheckpoint2Fixture.ts`)
     preview fixtures BEFORE export is pointed at it. Never refactor preview to fit export; export is
     pointed at the already-proven compositor, not the reverse. The compositor composites from a
     `VideoFrame`/bitmap the decode pool already produces — NOT from an HTML5 `<video>` seek.
     `frameRenderer.ts` stays in the tree for the legacy fallback but is no longer on the new export path.
  2. **New `src/services/webcodecsEncoder.ts`.** Wrap `VideoEncoder`: `isConfigSupported` probe →
     hardware (`avc1`, `hardwareAcceleration: 'prefer-hardware'`) first, software fallback; feed composited
     frames keyed on the audio-master timeline; collect `EncodedVideoChunk`s.
  3. **New export orchestrator path** parallel to `exportPipeline.ts` (do not mutate the legacy one):
     decode via `videoDecoderPool` → composite via the shared module (from step 1) → encode via
     `webcodecsEncoder` → write ONE elementary/mp4 video stream → ffmpeg sidecar muxes audio in once
     (reuse the existing `save_bytes_to_disk` / mux IPC, `exportPipeline.ts:206-280`, but called a
     single time).
  4. **Wire behind a capability + explicit toggle** (mirror Phase 1's dual-gate discipline) so the legacy
     PNG/ffmpeg export remains the default until Phase C's quality pass validates output.
- **Cross-reference — expected to resolve residual issue 2 (frozen transition frame) as a
  byproduct, not new scope.** Per the audited disposition in the Follow-On Effort tracker (Section
  8.1 area, "frozen transition frame audited, deferred to Phase B", 2026-07-06): today
  `useTransitionPreview.ts` blends two ONE-TIME snapshots because its only video source
  (`frameRenderer.ts`'s HTML5 `<video>`-seek cache) is too slow (~200-400ms/seek) to sample every
  render tick, while `segmentEncoder.ts` already renders every export transition frame live via
  `renderSegmentFrame`. Once step 1's shared compositor puts preview's transition blend on the
  same live, `VideoDecoderPool`-backed frame source export already uses — instead of
  `frameRenderer.ts`'s seek-based cache — the frozen-snapshot mechanism is structurally retired.
  This is expected to fall out of the already-planned steps above as a natural consequence of
  unifying preview's frame-sourcing onto one compositor, not as separate new work requiring its
  own step or scope in this section.
- **Touch surface (all additive):** new `webcodecsEncoder.ts`, new shared-compositor module, new export
  orchestrator, a gated branch in `useExport.ts`. `videoDecoderPool.ts`/`videoDemuxer.ts` reused as-is.
- **MUST NOT touch (until the new path is proven and cut over):** `frameRenderer.ts`, `segmentEncoder.ts`,
  `plainSegment.ts`, existing `exportPipeline.ts` bodies, `usePlayback.ts`. ffmpeg is mux-only — no
  per-frame `ffmpeg_exec`/`ffmpeg_write_file` on the new path.
- **Manual test (you run):** export a 33s clip WITH effects on the new path; confirm (a) wall time ≈ 40s,
  not ~6 min; (b) output plays start-to-finish in QuickTime/VLC with correct A/V sync; (c) frame-compare
  three stills against the live preview at the same timestamps — identical.
- **Tracker rows on completion (⬜ → ✅):** standard-format entry + a note that the legacy export path
  is retained behind the gate.

### 8.3 Phase C — Quality pass (real color conversion, drift correction, quality-pinned encode)

- **Goal:** full-HD, no perceptible quality loss, correct color, and zero cumulative audio/video drift
  across a long timeline. Closes audit findings #6 (frame-count drift) and #7 (sRGB-tagged-bt709).
- **Concrete steps:**
  1. **Real color-space handling.** Today `segmentEncoder.ts:184-186/273-275/373-375` only *tags*
     bt709 on sRGB canvas pixels — no conversion. On the WebCodecs encoder path, either encode in the
     color space the compositor actually produces and tag it truthfully, or perform an explicit
     sRGB→bt709 conversion before encode. Verify with a color-bar/gradient asset that a round-tripped
     export matches the source, not a gamma-shifted version.
  2. **Cross-segment drift correction.** Replace independent per-segment `round(duration*fps)`
     (`segmentEncoder.ts:99, :362`) with timestamps derived from the single audio master clock, so
     segment N's frames start at the exact accumulated timeline time, not `sum(rounded durations)`.
     Encoder frame `timestamp`s come from the same playhead mapping preview uses (`toSourceTime`/timeline
     time), eliminating cumulative drift by construction.
  3. **Quality-pinned encoder config.** Pin `VideoEncoder` bitrate/quality for full-HD no-loss
     (`bitrateMode: 'quantizer'` / low-CRF-equivalent, keyframe interval, 1080p, bt709), matching or
     exceeding the current libx264 `crf 16` fidelity.
- **Touch surface:** `webcodecsEncoder.ts` (config), the new export orchestrator (timestamp derivation),
  shared compositor (color output). If any color fix is unavoidable on the *legacy* export path too,
  that is a separate, explicitly-scoped change — flag it, don't fold it in.
- **MUST NOT touch:** `usePlayback.ts`, sync engine, timeline. Do not tune the legacy libx264 flags as
  part of this phase unless separately agreed.
- **Manual test (you run):** (a) export a color-bar/gradient image; open source and export side-by-side —
  no hue/gamma shift; (b) export a 5-min, many-segment project; confirm audio and video stay locked at
  the end (clap/beat lands on frame); (c) inspect the export at 1080p — sharp, no banding/softening vs. preview.
- **Tracker rows on completion (⬜ → ✅):** standard-format entry; note whether the legacy path's color
  tagging was left as-is (fallback) or separately corrected.

### 8.4 Risk Register additions (append rows to Section 6's table)

| Phase | Risk | Why it matters | Mitigation direction |
|---|---|---|---|
| A | Converting wall-clock twins to playhead transforms changes the *look* of FLOAT/SHAKE/etc. (Framer easing ≠ static transform) | A "fix" that visibly alters a shipped animation is a regression to users | Match `canvasAnimations.ts`'s export math exactly — the goal is preview *matching export*, so export is the reference look; diff against an export, not against today's preview |
| B | `VideoEncoder` hardware support/quality varies by engine (WKWebView vs WebView2); `isConfigSupported` may pass but produce poor output | Export quality is the whole point; a silent quality drop is worse than a slow-but-correct export | Probe + software fallback + keep legacy ffmpeg export behind the gate until Phase C validates; per-engine manual export check |
| B | Extracting ONE compositor risks changing preview's proven-correct output | Phases 0–8's preview correctness is hard-won; a refactor could regress it | Extract behaviour-preserving (pure move first, verified against Phase 5/7+8 fixtures), then point export at it — never the reverse order |
| C | `VideoEncoder` timestamp/CFR handling may not cleanly accept audio-master-derived timestamps | Drift correction depends on the encoder honoring supplied timestamps | Validate timestamp fidelity on a synthetic long project early in Phase C, before pinning quality constants |

### 8.5 Merge-gate additions (append to Section 7.1)

7. **Preview == export, demonstrated.** For a project exercising animations + a transition + a filter,
   three stills sampled from the live preview match the exported frames at the same timestamps.
8. **Export speed restored.** A 33s clip WITH effects exports in ≈ 40s (not ~6 min), via WebCodecs
   `VideoEncoder`, ffmpeg invoked once for mux only.
9. **Full-HD, correct color, no drift.** Color-bar round-trip shows no gamma/hue shift; a 5-min
   many-segment export stays A/V-locked end to end; output is 1080p with no visible quality loss.
10. **Legacy export path still intact behind its gate** until Phases B/C are cut over — same
    superset-of-current-behavior discipline Section 1.6 applies to the preview fallback.
