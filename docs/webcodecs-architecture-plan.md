# WebCodecs Architecture Shift — Phased Migration Plan

**Status:** The core **Phases 0–8** preview migration is **✅ COMPLETE** and archived in full to `docs/history.md` → *WebCodecs Preview Migration Phases 0–8 (Archived)*. This document now tracks only the **follow-on Preview/Export Unification effort (Phases A–C)**: **Quick wins ✅ complete**, **Phase A ✅ complete**, **Phase B ⚠️ BLOCKED-PENDING** (works when tested, but on an unresolved `VideoEncoder` hang-risk on this runtime), **Phase C ⬜ not started**. See the Architectural Context, the Follow-On Effort tracker, and Section 8 below.

**Branch:** `webcodecs-api` (off `main` @ `d8cc5db`). `main` is not touched until this effort is reviewed and merged.

**Scope:** Preview playback only (`PreviewStage.tsx` and the hooks that feed it). The export pipeline (`frameRenderer.ts`, `segmentEncoder.ts`, `exportPipeline.ts`, `plainSegment.ts`, the native ffmpeg sidecar) is out of scope and must not be modified or behaviorally affected by any phase of this work.

**Origin of this effort:** a confirmed, root-caused bug — investigated and documented at the time in a standalone `docs/bugs/preview-cold-start-clock-freeze.md` writeup (that file no longer exists in the repo) — where a `<video>` element that has never played will not reliably start its media clock on `.play()` inside the Tauri webview, even at `readyState=4`. Every patch attempted at the `<video>`-element layer either failed or traded the freeze for a different regression (per that writeup's "Fixes Attempted" log). This plan treats that bug as unfixable at the `<video>`-element layer and replaces the layer instead of patching it further.

---

## Architectural Context (for the follow-on below)

The core migration this document originally described — replacing the dual-`<video>`-slot preview with a WebCodecs `VideoDecoder` decode pool (`videoDecoderPool.ts` / `videoDemuxer.ts`), a windowed decode-ahead + LRU-eviction model, cut over to default on every WebCodecs-capable runtime with the legacy `<video>` path retained as a capability-gated fallback — is **✅ complete (Phases 0–8)** and has been archived in full to `docs/history.md` → *WebCodecs Preview Migration Phases 0–8 (Archived)* (Progress Tracker + detailed Sections 1–7 + Phase 0 Results + WKWebView Cross-Check). Everything below is the **follow-on Preview/Export Unification effort (Phases A–C)**, which layers on top of that shipped preview path: it keeps the single audio master clock (`usePlayback.ts`, unchanged), reuses the decode pool as-is, and aims to put preview *and* export behind ONE shared compositor + a WebCodecs `VideoEncoder`. The locked technical decisions and per-phase status follow.

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
  the harness the same way the WKWebView Cross-Check did — that section is archived in `docs/history.md`) tested real `VideoEncoder.encode()` —
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
  - **Confirms and exceeds `docs/history.md ("Export Rendering Profiling — Phase 7 Task 1", archived)` (“Alternative paths considered and rejected → WebCodecs `VideoEncoder`”)'s earlier rejection.** That
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
    OffscreenCanvas/Worker approach from `docs/history.md ("Export Rendering Profiling — Phase 7 Task 1", archived)`'s own
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

- **B0 CONTRADICTED by a second independent encoder test — 2026-07-09. ⚠️ RECORDED AS AN OPEN
  CONTRADICTION; this does NOT overwrite, resolve, or reverse the B0 finding above.** A fresh,
  independently-written throwaway harness (`spike-webcodecs-audit.html` + `src/dev/webcodecsAuditSpike/`,
  kept, not deleted) tested real `VideoEncoder.encode()`/`flush()` on the same machine (macOS 26.5.2,
  Build 25F84, Intel), in the same real Tauri WKWebView, using the same attribution methodology as the
  WKWebView Cross-Check methodology (archived in `docs/history.md`; temporary `devUrl` repoint; results exfiltrated to a local HTTP listener since
  WKWebView has no automatable devtools). It matched the app's real export target: `avc1.640028`
  (H.264 High @ L4.0), 1920×1080, 30fps, 8 Mbps.
  - **Result: all 4/4 configs (hardware/software × avc/annexb) SUCCEEDED** — `isConfigSupported: true`,
    construct+configure OK, 15 frames → **15 chunks emitted**, `flush()` resolved in ~250–355ms, no
    hang, no `error` callback, no `isConfigSupported`-says-yes-but-fails discrepancy. Output verified as
    real bitstream: exactly 1 keyframe (~10 KB IDR) + 14 delta per config, ~166 KB total; annexb output
    exactly 40 bytes larger than avc (start-codes vs length-prefixes — format honored). This is the exact
    opposite of B0's "all 4/4 hung, `flush()` never resolved, 0 chunks."
  - **Attribution rigor (same bar as B0):** bare `AppleWebKit/605.1.15` UA with no `Chrome`/`Safari`
    token (confirms WKWebView, not Chromium — Chromium would falsely pass); killed the Tauri app and
    confirmed **zero** results posted for 8s (rules out the Launch preview panel or any other renderer);
    reproduced across 3 isolated runs.
  - **This is NOT a "B0 was wrong" claim.** A 3-day-apart "hung 4/4" → "worked 4/4" reversal on the same
    machine, with the original B0 harness unavailable, is an *unresolved contradiction*, not a resolved
    one. B0's finding stands as recorded; this entry records that a second independent test disagrees.
    **VideoEncoder is NOT to be called "viable" on the strength of this alone.** See the reconciliation
    entry immediately below.

- **B0 reconciliation attempt + end-to-end mux/round-trip proof — 2026-07-09.** Two parts.
  - **⚠️ STATUS: WORKS WHEN TESTED, RISK UNRESOLVED — NOT PRODUCTION-VIABLE.** VideoEncoder succeeded
    in every run below (Part 1's 8/8 config sweep + Part 2's full encode/decode/mux/visual proof). It
    also carries an unexplained, unquantified hang risk: B0 recorded a real hang on this same machine
    3 days earlier (`encodeQueueSize` plateau, `flush()` never resolving) that was never reproduced or
    explained — a transient WebKit/VideoToolbox runtime state vs. a stale harness-only bug in B0's
    (unrecoverable) original code, undetermined and neither confirmed nor ruled out. **Do NOT read
    "narrowed, not resolved" below as "safe to ship" or "production-viable."** Treat this as
    blocked-pending until the hang risk is EITHER empirically bounded (many repeated runs across
    sessions/days establishing a hang rate) OR a future hang reproduces with an actual harness to diff
    against.
  - **Part 1 — reconcile with B0's harness.** B0's original harness is **unrecoverable from git**:
    commit `1cd8d03` ("… + remove B0 spike artifacts") is **docs-only** (touches only
    `docs/webcodecs-architecture-plan.md`); the spike files were created, run, and deleted in the working
    tree without ever being committed, and an exhaustive `git rev-list --all --objects` scan finds no
    blob under `webcodecsEncoderSpike`/`spike-webcodecs-encoder`. So the original could not be run
    as-was; it was reconstructed from the writeup (15 synthetic canvas frames, `VideoFrame(canvas,
    {timestamp})`, close-after-encode, hw/sw × avc/annexb, `isConfigSupported` first, timed flush) and a
    matrix was swept over the config fields B0 did **not** record (codec string, resolution, latencyMode),
    polling `encodeQueueSize` during flush to detect B0's specific "15→11 then plateau, 0 chunks"
    signature. Harness kept: `spike-webcodecs-b0repro.html` + `src/dev/webcodecsB0Repro/`.
    - **Result: 8/8 reconstructed variants SUCCEEDED; NONE reproduced the hang.** Tested `avc1.42001f`
      (Baseline L3.1) and `avc1.42E01E` (Baseline L3.0) — the canonical-WebCodecs-sample strings B0's
      "config shape matches the standard sample pattern" most likely used — fed **1080p** frames on both
      hardware and software paths (the leading "level-overflow harness bug" hypothesis), plus Main-profile
      `avc1.4d0028`, the 640×480 sample size, `latencyMode: realtime`, and annexb. Every one emitted 15
      chunks and resolved flush; queue trajectory `[15]` then drained (no partial plateau on any config).
    - **Interpretation (evidence-based, no guess either direction):** the contradiction is **narrowed,
      not resolved.** It is definitively **NOT** a codec-profile / level / resolution / hardware-vs-software
      / bitstream-format / latency-mode config sensitivity — every such variant works on today's runtime.
      That leaves two live hypotheses I **cannot** distinguish with the original harness gone: (a) B0's
      harness had a defect in a dimension the writeup did not capture (frame lifecycle, event-loop/timing,
      or the queue-measurement itself), which no config-shaped reconstruction reproduces; or (b) a
      transient or since-changed WKWebView/VideoToolbox runtime state between the two test dates (OS
      version string is unchanged at 26.5.2, so if it is (b) it is a sub-version/supplemental or transient
      change, not an OS upgrade — weaker, but not excludable). **No harness-bug diff could be produced**
      because no reconstruction hangs; that is itself the finding.
  - **Part 2 — end-to-end mux + round-trip (go/no-go).** Harness kept: `spike-webcodecs-muxproof.html` +
    `src/dev/webcodecsMuxProof/`. In the real Tauri WKWebView: encoded **60** canvas frames (1080p/30,
    `avc1.640028`, annexb) → **60 chunks, 2 keyframes**; **round-tripped those exact chunks back through
    `VideoDecoder` → 60/60 frames decoded, monotonic** (`decoderConfig` from encoder `metadata`, no
    description, as expected for annexb); concatenated the annexb elementary stream (569,378 bytes) and
    muxed it with the **bundled ffmpeg sidecar** (`-f h264 -r 30 -c copy -movflags +faststart`, i.e. the
    "ffmpeg mux-only" shape Phase B envisions — no re-encode). Muxed MP4 verified: **2.00s duration,
    1920×1080, H.264 High/avc1/yuv420p, 30fps, decodes to exactly 60 frames, no corruption**; opens in
    QuickTime; extracted frames 0/30/59 are **visually correct** (hue rotates 0°→180°→354° by frame
    index, "FRAME N" text and a sweeping green marker track frame index left→center→right). This is the
    real playable-file proof, not "a file exists."
  - **Disposition: still BLOCKED-pending, NOT viable.** Per the task's own gate, VideoEncoder is **not**
    declared viable while Part 1's contradiction remains unresolved (it does), even though Part 2 passes
    cleanly. Also still untested by hardware constraint: **macOS arm64** (this machine is Intel x86_64)
    and **Windows/WebView2** (no hardware/VM available) — deliberately not guessed. Next steps to actually
    clear this: run the same audit + b0repro + muxproof harnesses on macOS arm64 and real Windows; and, if
    a definitive reconciliation is wanted, attempt to obtain B0's original harness/config from whoever ran
    it (chat history, local un-committed backups) rather than a reconstruction.
  - **2026-07-09 follow-up — spike harnesses formally committed.** The three harnesses referenced
    above (`spike-webcodecs-audit.html`/`src/dev/webcodecsAuditSpike/`,
    `spike-webcodecs-b0repro.html`/`src/dev/webcodecsB0Repro/`,
    `spike-webcodecs-muxproof.html`/`src/dev/webcodecsMuxProof/`) had actually been sitting untracked
    in the working tree since this investigation, despite being described as "kept, not deleted" —
    they are now committed at `f52ab12` (`docs: retain WebCodecs VideoEncoder investigation spikes`),
    following the existing `src/dev/webcodecsSpike/` precedent for retained investigation artifacts.
    That same commit fixed a wrong DOM-lib type name in two of them (`HardwarePreference`, which was
    never a real TypeScript type, → the actual `HardwareAcceleration`) so full-repo `tsc --noEmit` is
    clean with these files in the tree.
  - **Cross-reference — the legacy-pipeline speedup this section already anticipated has now
    shipped, separately from Phase B.** The "already-recorded next candidate" noted earlier in this
    B0 area (`docs/history.md ("Export Rendering Profiling — Phase 7 Task 1", archived)`'s OffscreenCanvas/Worker approach for the
    I/O-bound `toBlob`/IPC-write bottleneck) was implemented and committed 2026-07-09
    (`cd7ea2b` — worker-pool PNG encode via new `src/services/frameEncodeWorker.ts`, plus a
    raw-binary Tauri IPC frame write replacing the base64 round-trip; see `project-state.md`'s
    Completed Work). This is entirely independent of Phase B's blocked `VideoEncoder` effort — it
    speeds up the same legacy ffmpeg/PNG export path Phase B would have replaced, not a step toward
    Phase B itself. No pipeline-selection/gating logic changed; the legacy path is simply faster now.
  - **No production/pipeline source changed.** `frameRenderer.ts`, `segmentEncoder.ts`,
    `exportPipeline.ts`, `plainSegment.ts`, `useWebCodecsPreview.ts`, `videoDecoderPool.ts` all
    unmodified; `tauri.conf.json`'s temporary `devUrl`/CSP/`beforeDevCommand` edits for the isolated runs
    were reverted (zero git diff). Audit/spike only.
  - Tracked as an Active Task in `project-state.md` ("Export rewrite: WebCodecs pipeline"), sequenced
    after the WebGL/WebGPU effects-engine rebuild.

- **Item 4 (frozen transition frame) — re-audited and re-scoped as a standalone, decode-side fix;
  supersedes the "BLOCKED transitively" disposition above. B1-B3 of 5 ✅ DONE (B3 manually
  verified — frozen frame during transitions confirmed fixed); B4-B5 ⚠️ PARKED/SUPERSEDED, not
  pending (2026-07-07 — see the B4 entry below for what happened and why).** A fresh audit (prompted by B0's finding that Phase B itself is blocked, so Item 4
  can no longer wait on it) determined the frozen-frame fix does NOT actually require Phase B's
  shared compositor — it's achievable using only decode-side infrastructure
  (`VideoDecoderPool.getFrameAt`) that already works today; only `VideoEncoder` (export-side) is
  broken, and this item never touched export. Confirmed reasoning: `useTransitionPreview.ts` renders
  both outgoing/incoming segments to offscreen canvases ONCE per boundary via `frameRenderer.ts`'s
  slow HTML5-`<video>`-seek path, then blends purely as a function of `progress` — the fix is to pull
  LIVE frames from the pool (already cheap, already called every tick by `useWebCodecsPreview.ts` for
  ordinary playback) instead, for the WebCodecs-capable path only; the HTML5 fallback path is
  untouched. Approved as a 5-part sub-task plan, each its own commit:
  - **B1 — Pool API (additive only). ✅ DONE.** `videoDecoderPool.ts` gains a second, independent
    protected-set — `transitionProtectedIds` + `setTransitionProtectedIds(ids)`, same full-replace
    contract as the existing `protectedIds`/`setProtectedIds` — so a caller can keep the OUTGOING
    segment's decode session alive through its own transition window after it stops being
    `{current, next}` (`computeKeepSet`'s pair). Declarative, not TTL-based (a timer-based expiry was
    considered and rejected: it would incorrectly lapse if playback is paused mid-transition).
    `evictionCandidates()` now filters on both protected sets; `dispose()` resets both. Documented the
    pre-existing soft-ceiling implication for `MAX_TOTAL_BUFFERED_FRAMES` (protected sessions were
    already exempt from that ceiling with just 2 slots; a 3rd doesn't add a new risk category).
    3 new unit tests mirroring the existing `setProtectedIds` coverage. Nothing calls
    `setTransitionProtectedIds` yet (confirmed via grep) — zero visual/behavioral change.
    `tsc --noEmit` clean, `vitest run` 162/162 passing (159 + 3 new). Committed in `feat: add
    transition-scoped protected-session slot to VideoDecoderPool (Item 4 fix, B1)`.
  - **B2 — Cross-hook plumbing. ✅ DONE.** `useWebCodecsPreview.ts`'s return object gains `pool:
    VideoDecoderPool` (the same instance it privately drives via `ensureSession`/`getFrameAt`/
    `setProtectedIds` — always the same object across renders regardless of `enabled`), purely
    additive alongside its existing fields. `PreviewStage.tsx` now calls `useWebCodecsPreview` BEFORE
    `useTransitionPreview` (confirmed behavior-neutral reorder — neither hook depends on anything the
    other defines) and threads `webCodecsPreview.pool`/`.frame`/`.frameSegmentId` into
    `useTransitionPreview`'s new, optional `pool`/`incomingFrame`/`incomingFrameSegmentId` params.
    `useTransitionPreview.ts` accepts and stores these in a ref for B3 to read, and imports
    `isWebCodecsPreviewSupported()` (the same capability signal `PreviewStage.tsx` already gates on)
    without branching on it yet. No existing field's shape/behavior changed; nothing reads the new
    params yet — zero visual/behavioral change. `tsc --noEmit` clean, `vitest run` 162/162 passing
    (unchanged — pure plumbing, no new tests needed). Committed in `feat: thread VideoDecoderPool +
    live incoming frame into useTransitionPreview (Item 4 fix, B2)`.
  - **B3 — Live outgoing-side render. ✅ DONE — manually verified (2026-07-06): frozen frame during
    transitions confirmed fixed.** `useTransitionPreview.ts` gains a declarative
    `pool.setTransitionProtectedIds([outgoingSeg.id])` effect (B1's API, finally wired up) plus a
    per-tick live-render effect for the OUTGOING segment: reuses `toSourceTime`/`startChaseIfIdle`/
    `resetChaseMutex` imported read-only from `useWebCodecsPreview.ts` (avoids reintroducing the
    exact "at most one `getFrameAt` in flight per session" race that file's own header already
    documents fixing) to pull a live `VideoFrame` and draw it via
    `ctx.save(); applySegmentAnimation(...); ctx.drawImage(frame,...); ctx.restore()` — the same
    canvas-native camera-dynamics call site `frameRenderer.ts`'s export path uses, not the CSS
    `getAnimationWrapperProps` wrapper. Layered on top of the existing one-shot snapshot effect
    (unchanged, still creates/owns the canvas pair) rather than replacing it, so non-video outgoing
    segments (image/heading) and non-capable runtimes keep today's exact frozen behavior by
    construction. Incoming side: `PreviewStage.tsx`'s draw effect now blits the parent's already-live
    `webCodecsPreview.frame` onto `transitionPreview.incoming`'s persistent canvas (gated on
    `contentCaughtUp`, already computed for Bug 1/2) instead of an independent `getFrameAt` call —
    confirmed `applyTransitionBlend`'s `adjacentCanvas` param is strictly `HTMLCanvasElement` (not
    widened; `frameRenderer.ts` untouched), so the live frame is blitted onto the existing reusable
    canvas rather than passed in directly. `tsc --noEmit` clean, `vitest run` 162/162 passing
    (no dedicated hook test file exists — same DOM/canvas/effect-heavy limitation as this hook's
    prior state; verification here is manual). Committed in `fix: live per-tick outgoing-side
    transition rendering, eliminating frozen frame during transitions (Item 4 fix, B3) - verified`.
  - **B4 — Overlay parity. ⚠️ PARKED/SUPERSEDED — implemented, manually tested, did NOT fix the
    reported symptoms; discarded (2026-07-06/07).** Attempted fix for `renderSegmentFrame` baking
    `segment.extraOverlays` into the one-shot snapshot (the cause of the DOM extra-overlays layer
    fading out during a live transition — a KNOWN regression from B3, not a new/surprise bug). The
    fix was implemented and manually tested against a real project, but did **not** resolve the
    actually-reported symptoms (animation jump/disappear during transitions), and testing surfaced a
    new, unrelated bug: a React "Maximum update depth exceeded" infinite-render loop in
    `usePlayback.ts`. Following this, the decision was made to abandon further patching of the
    CSS/Canvas2D effects-rendering approach **entirely** — not just B4/B5's narrow scope — in favor
    of a WebGL/WebGPU rendering-engine rebuild (see `project-state.md`'s Decisions Log, 2026-07-07,
    and the new WebGL/WebGPU rebuild entry under Active Tasks). All uncommitted B4 work was
    discarded via targeted `git restore` on `PreviewStage.tsx` and `useTransitionPreview.ts`,
    confirmed back to clean B3 state (commit `10410f0`; 162/162 tests passing at the time, now
    216/216 with D16 on top).
  - **B5 — Manual verification. ⚠️ PARKED/SUPERSEDED — moot.** No longer applicable now that B4 is
    not shipping; superseded by the WebGL/WebGPU rebuild decision above.
  - **Current state (2026-07-07):** B1-B3 remain shipped, stable, and unaffected — Item 4's original
    frozen-frame symptom stays fixed. B4/B5 and any further CSS/Canvas2D patching of the effects
    engine are parked, not scheduled to resume; the engine itself is being replaced, not further
    debugged. See the WebGL/WebGPU rebuild task (`project-state.md` Active Tasks) for the
    forward path.

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
- **Phase B — ⚠️ BLOCKED-PENDING on this runtime: works when tested, but on an unresolved,
  unquantified hang-risk contradiction — not simply infeasible (B0 spike + B0 reconciliation both
  complete, see ✅ COMPLETED above).**
  Originally scoped to migrate export onto WebCodecs `VideoEncoder` behind ONE shared compositor,
  retiring the per-frame HTML5-seek → PNG → IPC path. The B0 feasibility spike found real
  `VideoEncoder.encode()` non-functional on this project's real Tauri WKWebView (macOS 26.5.2): all
  4 tested configs (hardware/software × avc/annexb) hung identically — `flush()` never resolved,
  zero chunks ever emitted, no error surfaced. Confirms and exceeds the risk
  `docs/history.md ("Export Rendering Profiling — Phase 7 Task 1", archived)` (“Alternative paths considered and rejected → WebCodecs `VideoEncoder`”) already flagged. A later B0-reconciliation +
  end-to-end mux-proof test (2026-07-09) then SUCCEEDED 8/8 on a reconstructed harness and produced
  a full encode → decode → ffmpeg-mux → playable-MP4 proof, without reproducing the hang — so the
  accurate current status is blocked-pending on that unresolved hang-risk contradiction, "works
  when tested, risk unresolved — not production-viable," rather than the harsher B0-only
  "infeasible." The legacy ffmpeg PNG/IPC export path remains shipped and correct; Phase C (quality
  pass) is moot while Phase B is blocked-pending. See the B0 ✅ COMPLETED entries above (both the
  spike and the reconciliation) for full evidence and disposition.
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

## 8. Follow-On: Preview/Export Unification (Phases A–C)

This section defines the follow-on effort announced in the Progress Tracker above, in the same
phase format as the migration phases (Section 5, archived in `docs/history.md`). Each phase is independently completable, testable, and revertible.
Phases A–C are additive to the shipped WebCodecs preview path; the legacy `<video>` fallback
(Section 1.6, archived in `docs/history.md`) is not touched by any of them.

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
  under `src-tauri/`. Do not convert overlays/captions off the DOM (Section 6 risk 5 — keep overlays/captions on the DOM — stands; the migration risk register is archived in `docs/history.md`).
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

**⚠️ BLOCKED-PENDING on this runtime: works when tested, but on an unresolved, unquantified
hang-risk contradiction — not simply infeasible (see the ✅ COMPLETED / ⬜ NOT STARTED tracker
entries above for full evidence).** The B0 feasibility spike recorded real `VideoEncoder.encode()`
hanging on this project's real Tauri WKWebView (macOS 26.5.2) across all 4 hardware/software ×
avc/annexb configs — `isConfigSupported` reports `true`, but `flush()` never resolves and zero
output chunks are ever emitted. This confirms and exceeds the risk already on record at
`docs/history.md ("Export Rendering Profiling — Phase 7 Task 1", archived)` (“Alternative paths considered and rejected → WebCodecs `VideoEncoder`”). A later B0-reconciliation + mux-proof test
(2026-07-09) then succeeded 8/8 and produced a full encode → decode → ffmpeg-mux → playable-MP4
proof without reproducing the hang, so the accurate current headline is blocked-pending on that
unresolved hang-risk contradiction ("works when tested, risk unresolved — not production-viable"),
not the harsher B0-only "infeasible." The steps below are retained as the ORIGINAL plan for
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

### 8.4 Risk Register additions (follow-on — extend the migration risk register, Section 6, archived in `docs/history.md`)

| Phase | Risk | Why it matters | Mitigation direction |
|---|---|---|---|
| A | Converting wall-clock twins to playhead transforms changes the *look* of FLOAT/SHAKE/etc. (Framer easing ≠ static transform) | A "fix" that visibly alters a shipped animation is a regression to users | Match `canvasAnimations.ts`'s export math exactly — the goal is preview *matching export*, so export is the reference look; diff against an export, not against today's preview |
| B | `VideoEncoder` hardware support/quality varies by engine (WKWebView vs WebView2); `isConfigSupported` may pass but produce poor output | Export quality is the whole point; a silent quality drop is worse than a slow-but-correct export | Probe + software fallback + keep legacy ffmpeg export behind the gate until Phase C validates; per-engine manual export check |
| B | Extracting ONE compositor risks changing preview's proven-correct output | Phases 0–8's preview correctness is hard-won; a refactor could regress it | Extract behaviour-preserving (pure move first, verified against Phase 5/7+8 fixtures), then point export at it — never the reverse order |
| C | `VideoEncoder` timestamp/CFR handling may not cleanly accept audio-master-derived timestamps | Drift correction depends on the encoder honoring supplied timestamps | Validate timestamp fidelity on a synthetic long project early in Phase C, before pinning quality constants |

### 8.5 Merge-gate additions (follow-on — extend the migration merge-gate, Section 7.1, archived in `docs/history.md`)

7. **Preview == export, demonstrated.** For a project exercising animations + a transition + a filter,
   three stills sampled from the live preview match the exported frames at the same timestamps.
8. **Export speed restored.** A 33s clip WITH effects exports in ≈ 40s (not ~6 min), via WebCodecs
   `VideoEncoder`, ffmpeg invoked once for mux only.
9. **Full-HD, correct color, no drift.** Color-bar round-trip shows no gamma/hue shift; a 5-min
   many-segment export stays A/V-locked end to end; output is 1080p with no visible quality loss.
10. **Legacy export path still intact behind its gate** until Phases B/C are cut over — same
    superset-of-current-behavior discipline Section 1.6 (archived in `docs/history.md`) applies to the preview fallback.
