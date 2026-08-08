# Manual WKWebView Drag Checklist

> Adopted 2026-08-08, WS2 task 3, per `docs/drag-path-testability-assessment.md` §6 Q3
> ("Approve the manual WKWebView checklist as a standing complement"). Run this in the
> packaged/dev Tauri app, on a real machine, with your own hands. Total time: **under
> fifteen minutes** once a test project is loaded (setup below is one-time per session).

---

## Why this exists

The Route 2 harness (`dragSession.test.ts`, `dragSessionHarness.test.ts`) drives the real
`startDragSession` function against a real `jsdom` `document`/`window`. That is genuine
coverage, and it is enough to lock in the *logic* of a drag. It is not enough to lock in
whether a drag *feels right* in the actual app, because `jsdom` is missing two things no
amount of test-writing can substitute for:

1. **`jsdom` has no CSS layout engine.** `getBoundingClientRect()` returns zeros;
   `offsetWidth`/`clientWidth`/computed padding are zero or default. Every geometric fact
   in a `jsdom` test is *supplied by the test author*, which means the harness can only
   confirm the code is self-consistent with numbers it was handed — it cannot discover a
   wrong constant the way the real K16 investigation did (a stale 24px container-padding
   offset, found by measuring the *real* container in a *real* browser). **Any future
   constant-offset bug of that shape is structurally invisible to the automated suite.**
   (Assessment §4.1.)
2. **`jsdom` is not WKWebView, and this project has already been burned by that gap
   concretely.** The WebKit `overflow:hidden` + `border-radius` + `transform`-child bug
   that rendered timeline cards fully black (documented in `Timeline.tsx`'s
   lane-border-as-overlay workaround) has no `jsdom` equivalent, and neither does its
   sibling class — real pointer-capture quirks, `touchAction` handling, and real OS
   gesture takeover. (Assessment §4.2, §4.5.)

Two further gaps the assessment names, both unreachable by any headless-DOM test:

- **`requestAnimationFrame` is a `setTimeout` shim in `jsdom`.** Frame *coalescing* under a
  real flood of `pointermove` events — whether frames get dropped, whether the rAF batching
  actually keeps up — is not reproduced. (§4.3.)
- **No compositor, no paint.** Jank, dropped frames, "the edge lags the pointer" — none of
  this is measurable in a headless DOM. Perceived smoothness is not a testable property
  without a real screen. (§4.4.)

The assessment's own conclusion is the reason this checklist is short and eye-driven rather
than another test suite: *"Fidelity was never the binding constraint. The assertion was."*
A human watching the real app is the only thing that can currently assert "this looks and
feels right."

**This checklist does not re-litigate what the automated suite already proves.** Each step
below states what CI already covers so nobody re-derives it by hand, and names the specific
slice only a real run can confirm.

---

## When to run it

- **Before any release** (a DMG/installer build, or before merging to `main` if that's the
  release gate).
- **After any change to** `src/services/dragSession.ts`, `src/services/dragCascade.ts`,
  `src/services/dragGeometry.ts`, or any CSS/layout affecting the timeline (`Timeline.tsx`'s
  lane classes, `index.css`, or a Tailwind config change touching timeline spacing).

If none of those changed, this checklist is not required for the change — don't run it as a
reflex on every PR.

---

## Setup (one-time per session)

1. Run the **real Tauri app** — `npm run tauri:dev` at minimum. If this is a pre-release
   check, test the packaged `.app`/installer build instead of the dev shell; the dev shell
   is still a real WKWebView, but a packaged build is the closer match to what ships.
   A plain browser tab (`npm run dev` opened in Chrome/Safari) does **not** satisfy this
   checklist — it skips exactly the WKWebView-specific gap class (§4.2) this exists to catch.
2. Open or create a project with **at least 4–5 segments of visibly different lengths**, a
   synced voiceover (so both the thumbnail lane and the waveform lane render real content —
   an empty/unsynced project can hide a lane-disagreement bug).
3. Lock one segment ahead of time (via the segment's editor drawer or the Segments-tab lock
   icon) — steps 5 and 6 below need it already in place.
4. Set the timeline zoom (the "zoom" slider next to the timeline) to a middle value to
   start; a few steps below call out changing it.

---

## Checklist steps

Each step: what to do, the expected result (a "no" answer must be unambiguous), and what the
automated suite already covers so you're not re-checking it by eye.

| # | Step | Expected result (a "no" is a fail) | Already covered by automated tests? |
|---|---|---|---|
| 1 | Drag a **middle segment's right edge**, a moderate distance (~1s of timeline width). | The dragged edge tracks the pointer with no visible lag or snap. The **next segment's left edge visibly moves during the drag itself**, not only after release. Releasing causes no jump/flash on any segment. | Numbers only. `dragSessionHarness.test.ts`'s live-preview tests assert the DOM style values written per frame are correct; they cannot confirm this *reads* as smooth motion under real paint (§4.4) or that nothing lags under a real event flood (§4.3). |
| 2 | Drag a **middle segment's left edge**. | Mirrored: the left edge tracks the pointer; the **preceding** segment's right edge visibly follows live; no jump on release. | Numbers only — this is the exact shape of the K16 fault-3 regression (a left-edge drag that silently moved the wrong edge). `dragGeometry.test.ts`/`dragSession.test.ts` assert `style.left` is written correctly; only the eye confirms it doesn't visually lag the pointer. |
| 3 | Drag **segment 0's left edge** (the very first segment — no predecessor). | The edge moves smoothly up to true `t=0` and stops there — no gap opens before segment 0, and nothing glitches or vanishes at the boundary. | Logic only. `dragCascade.test.ts` covers the off-the-end math (this is also where the real K14/K15a gap-collapse bug lived); only the eye confirms the on-screen boundary doesn't visually glitch. |
| 4 | **MANUAL-ONLY (visual).** Drag the **last segment's right edge**, both growing and shrinking. Watch the segment cards against the waveform lane beneath them. | Growing extends the timeline's total length smoothly (the scrollable width / total-duration readout updates); shrinking leaves no stray gap after the new end. **No card drifts out of alignment with the waveform**, and nothing before the dragged segment moves at all. | Arithmetic only, and that is now well covered: `dragTriage.test.ts`'s F2 block pins the rendered position of earlier segments and the measured 300px → 259.0909px rescale; `timelineLayout.test.ts` and `timeline.render.test.tsx` add cross-layer agreement guards (2026-08-08). **None of it can see pixels.** `jsdom` has no layout engine, so whether the two lanes LOOK aligned on a real screen is unprovable by the suite — this step is the only check of that. |
| 5 | Lock the segment immediately **beside** the one you're dragging, then drag toward it until you'd need to cross into its slot. | The drag stops exactly at the locked neighbour's edge. The locked segment does not move by even a pixel. No console error. Hitting the limit should feel like hitting a wall — no visible jump or desync between the pointer and the edge once it's stopped. | Numbers only. `modelPLockSemantics.test.ts`/`dragCascade.test.ts` assert the numeric floor is respected; only the eye confirms the stop doesn't look broken (a pointer that keeps moving 40px past an edge that stopped moving reads as a bug even when the math is right). |
| 6 | Lock **both** neighbours of the segment you're dragging, then drag each edge toward its limit. | The segment can move only within the space between its two locks. Both locked segments stay visibly immovable. Hitting a limit on either side simply stops the drag — no snapping, no negative-duration flash. | Numbers only. `dragSessionHarness.test.ts` has dedicated "locks on BOTH immediate neighbours" cases (both a left-edge and right-edge shrink variant); the eye confirms no flicker/flash at either limit. |
| 7 | Grab an edge, move the pointer **only a few pixels**, and release. | Nothing commits. The segment snaps back to its exact starting size with no visible flicker, no console error, and — importantly — releasing does **not** trigger an accidental seek or selection change (the ghost-click case). | Numbers only. The negligible-drag threshold and its "reverted" outcome are fully covered by `dragSessionHarness.test.ts`; the ghost-click swallow (`window.addEventListener('click', ..., {capture:true, once:true})`) is real-browser click-synthesis behavior that `jsdom`'s synthetic events don't reproduce — only the eye can confirm no stray seek happens. |
| 8 | **Zoom in** until the timeline overflows its panel, **scroll right**, then drag a segment that is now positioned to the left of the original (unscrolled) viewport. | The drag tracks the pointer correctly relative to the *scrolled* position — no jump the instant the drag starts, and the edge stays under the pointer for the whole gesture. | **Nothing.** `jsdom` has no real scroll-affecting layout; `timelineContentX`'s `scrollLeft` term is only ever exercised with hand-fed numbers in unit tests, never against a real scrolled viewport. This is the single step with the least automated coverage (§4.1) — give it real attention. |
| 9 | **MANUAL-ONLY (feel).** While zoomed in, drag a segment's edge **toward and past the visible right edge** of the timeline panel, and hold it there. Then bring it back inside. | **The timeline auto-scrolls** (implemented 2026-08-08 — this previously did nothing, which is what the last run found). It should start gently near the edge and speed up the further past it you go, keep scrolling while the pointer is held still, and stop the moment the pointer comes back inside. The dragged edge stays under the pointer throughout. No freeze, no clipped drag, no lost pointer, and nothing keeps scrolling after you release. | Logic only. `dragTriage.test.ts`'s F3 block covers ramp thresholds, proportionality, direction, clamping at both ends of the scroll range, teardown on all three resolutions, and the property that a drag reaching a content-x by scrolling commits identically to one reaching it by pointer motion. `dragGeometry.test.ts` PART 4 unit-tests the velocity curve. **None of it can measure comfort or smoothness** — the ramp constants (48px zone, 1200 px/s ceiling) were chosen, not tuned against a real hand. Say so in Notes if it feels wrong. |
| 10 | **REOPENED AND FIXED (2026-08-08).** Start a drag on a segment edge, keep the mouse button **held down**, then switch applications mid-drag (**Cmd+Tab**) and come back. Also: start a drag, release the button **outside the window**, then move the pointer back over the timeline. | The drag **discards** — the segment springs back to its pre-drag geometry with no timing change — and the session ends cleanly: the `col-resize` cursor is gone, text selection works again, and the next drag behaves normally. | Now covered at the logic layer by `dragSessionHarness.test.ts` PART 5 (6 tests, verified non-vacuous: 4 of 6 fail with the fix reverted). What remains manual is confirming the real shell still delivers `blur` on Cmd+Tab — that is the measured premise the fix rests on, and only the real shell can confirm it has not changed. |
| 11 | Grab a **locked** segment's own edge (not a neighbour's — the segment itself) and try to drag it. | The segment does not move by even a pixel, in the live preview or after release. No console error. (Found 2026-08-08 by a manual run: `computeDragCascade` checked a locked absorbing NEIGHBOUR but never the dragged segment's own lock, so this drag silently succeeded — fixed in `dragCascade.ts`.) | Numbers only, as of the 2026-08-08 fix. `dragCascade.test.ts`/`dragSessionHarness.test.ts` assert the array and live preview never move; only the eye confirms the stop doesn't look broken. |
| 12 | **SCOREABLE as of 2026-08-08** (was DEFERRED). Drag a boundary between two **video** segments (either edge), then let playback cross into both the segment you shrank and the one you grew, without navigating away from the preview. | Both segments play normally — no frozen/stuck frame on either side of the moved boundary. **PASSED 2026-08-08.** ⚠️ **This step scores SYMPTOM 1 ONLY** of the three tracked in [`docs/video-segment-investigation.md`](video-segment-investigation.md) — the preview freeze. It does **not** score symptom 2 (the `duration`↔`playbackSpeed` coupling on a video drag: silent, looks correct, needs an owner ruling not a test) and it **cannot reach** symptom 3 (the drawer's slip-trim bar — this step never opens the drawer; that is now **step 13**). A PASS here is not a clean bill of health for the video path. | Nothing. No automated coverage exists for the preview decode pool's response to a segment-timing change at all — and symptom 1's resolution has no identified cause, so a recurrence is expected rather than surprising. Re-run after ANY change to the preview decode path. |
| 13 | **NEW 2026-08-08. MANUAL-ONLY.** Open the segment editor **drawer** on a segment that has **no source clip** — an image segment, or any segment whose `sourceDuration` is unset — and whose duration is **longer than 60 seconds**. (Make one if the project has none: drag an image segment out past 60s, or set the duration numerically in the drawer.) Look at the orange **slip-trim bar** in the drawer's Asset column. | The bar stays **inside its container**. It does not extend past the container's right edge, overflow the drawer, or push the drawer wider than the viewport. | **Nothing, and the mechanism is already identified** — this step exists to confirm or refute it. `BottomDrawer.tsx` computes `widthPct = (duration × playbackSpeed / (sourceDuration ?? 60)) × 100` with **no clamp to 100**. For a segment with no `sourceDuration`, the `?? 60` fallback invents a denominator, so any duration past 60s makes the bar wider than its container *by construction*. If it overflows, the hypothesis in `docs/video-segment-investigation.md` §3 holds and the fix is local to that file — it touches no timing code and needs no ruling. Record the result there. |

### Step 10 — REOPENED AND FIXED (2026-08-08), by instrumenting instead of guessing

**Status: fixed.** Previously closed as an accepted limitation. Reopened for one timeboxed
attempt whose first action was to **stop patching and start measuring**, and that is what
resolved it.

**Why three previous attempts failed.** All three edited the `pointercancel` handler. The
real gesture never reaches it. Instrumenting the live Tauri/WKWebView shell for one Cmd+Tab
away-and-back mid-drag produced this log [MEASURED, 2026-08-08]:

```
+0ms     gesture-start        startDragSession entered
+5236ms  tauri:onFocusChanged focused=false
+5239ms  window:blur          document.hasFocus()=false
+5996ms  pointerup            buttons=0 type=mouse target=div
+5997ms  TEARDOWN RAN         hasMoved=true wasCancelled=false
```

Two findings, both of which invalidate the earlier diagnosis:

1. **No `pointercancel` is delivered at all.** The hypothesis was right. Every fix that
   edited `handleCancel` was editing dead code for this gesture, which is exactly why each
   one passed its synthetic test and failed the manual retest.
2. **Teardown was NOT missed — the drag was COMMITTED.** The release eventually arrived as a
   plain `pointerup` about 760ms later, on return, so `handleUp` ran with
   `wasCancelled === false` and took the commit branch. The 2026-08-08 discard ruling was
   therefore never in force on this path: an interrupted drag silently changed segment
   timings, which is the precise outcome that ruling exists to prevent. The earlier
   description of this step ("neither cleanly committed nor cleanly discarded") was wrong; it
   was cleanly committed, which is worse.

**The fix — two signals, both in `dragSession.ts`:**

- **`window` `blur` → discard.** This is the signal that actually arrives, and it arrives
  immediately (+5239ms, i.e. at the Cmd+Tab, not 760ms later). Chosen over Tauri's
  `onFocusChanged` — which fired 3ms *earlier* — because registering the Tauri listener needs
  an `await` on a dynamic import and so cannot be guaranteed attached for a gesture
  interrupted immediately, whereas the DOM listener is synchronous; it also keeps working
  outside the Tauri shell. Non-capture, plus a target check, so an element focus change
  inside the page can never resolve a drag.
- **A universal backstop: a `pointermove` with `buttons === 0` → discard.** Covers the case
  no OS signal reaches — the user releases the button in another application, so no
  `pointerup` is ever delivered here, and only moves the pointer back afterwards. Derived
  purely from the event already being handled, so it holds on any platform regardless of what
  else is or is not emitted. (`pointerdown` with `buttons === 0` is also wired, per the
  brief; honest note: it is unreachable in practice, since a `pointerdown` carries the button
  being pressed.)

Both resolve as a **discard**, applying the existing pointercancel ruling to the signals that
actually arrive. The `pointercancel` handler is retained unchanged — it is still correct for
genuine cancels (touch, stylus, gesture takeover).

**The stuck cursor is covered by the same teardown.** `body.resizing` carries *both*
`cursor: col-resize !important` and `user-select: none` (`src/index.css:99-103`), so the
single `classList.remove('resizing')` already in `teardown()` reverts both. There is no
separate cursor or selection mutation to undo.

**A harness fidelity bug found on the way.** `dragSessionHarness.ts` dispatched every
simulated pointer event with `buttons` left at `MouseEventInit`'s default of **0** — which for
a `pointermove` is not what a real drag looks like (a move with the primary button held
reports `1`; `0` specifically means no button is down). It went unnoticed because nothing read
the field; the moment the backstop did, 22 existing tests failed. `pointermove` now carries
`buttons: 1`. That makes the harness **more** faithful, not more permissive — and all 22 were
restored byte-identical, none weakened.

**A jsdom trap worth remembering.** `e.target === window` is **false** in jsdom under vitest
even for an event dispatched directly on `window`. The obvious form of the blur guard is
therefore correct in a real browser and silently always-false under test — a guard no test can
exercise. It is written as "the target is not an `Element`" instead, which is correct in both.

**Retained in full:** every pre-existing `pointercancel` test, and the universal
post-condition every harness test runs (listener balance, swallower count, auto-scroll
teardown, residual session state). Nothing was deleted or weakened.

**Not the same bug as the stuck-`resizingId` pin.** Same *residue class* — `resizingId` and
the body class left set — but a different root cause, and this fix provably does not touch it
[MEASURED: the skipped pin still fails after the fix]. The pin's path sets that state and
then early-returns **before any listener is installed**, so no signal — `blur`,
`pointercancel`, or `buttons === 0` — can ever reach it. It remains open and **unruled**.

---

**Known issue, not a checklist failure — RULED WONTFIX 2026-08-08:** dragging a segment id
that doesn't exist, or starting a drag before the timeline DOM exists, leaves `resizingId`
and the `resizing` body class stuck (the "stuck `resizingId`" bug). This is now a **closed
owner decision**, not an open bug — it is unreachable through normal UI use (a drag always
starts from an already-rendered segment against an already-rendered timeline), and a fix
would contradict a passing characterization pin. See `project-state.md`'s Deferred Known
Bugs and `dragSession.ts`'s header for the full reasoning. It is not a checklist step —
don't spend time trying to trigger it here.

---

## Pass/fail record

Copy this block and fill it in for each run.

```
Date:          ____________________
Build:         ____________________   (dev shell / packaged .app version / commit sha)
Platform:      ____________________   (macOS Intel / macOS arm64 / Windows + WebView2)
Tester:        ____________________

Step 1  (middle segment, right edge):        PASS / FAIL   Notes: __________
Step 2  (middle segment, left edge):         PASS / FAIL   Notes: __________
Step 3  (segment 0, left edge):              PASS / FAIL   Notes: __________
Step 4  (last segment, right edge):          PASS / FAIL   Notes: __________
Step 5  (single locked neighbour):           PASS / FAIL   Notes: __________
Step 6  (locks on both sides):               PASS / FAIL   Notes: __________
Step 7  (negligible drag reverts):           PASS / FAIL   Notes: __________
Step 8  (drag while scrolled):               PASS / FAIL   Notes: __________
Step 9  (auto-scroll past visible edge):     PASS / FAIL   Notes: __________
Step 10 (interrupted drag / Cmd+Tab):        PASS / FAIL   Notes: __________
                                              (reopened and FIXED 2026-08-08 — score it)
Step 11 (locked segment, own edge):          PASS / FAIL   Notes: __________
Step 12 (video boundary, both sides play):   PASS / FAIL   Notes: __________
                                              (scores SYMPTOM 1 ONLY — the preview
                                               freeze. Not symptom 2 or 3.)
Step 13 (drawer slip bar, no sourceDuration): PASS / FAIL   Notes: __________
                                              (NEW 2026-08-08 — scores symptom 3.
                                               Record result in
                                               docs/video-segment-investigation.md)

Overall: PASS / FAIL
Follow-up filed (if any): __________
```

**Note on the video path:** steps 12 and 13 together score two of the three symptoms in
`docs/video-segment-investigation.md`. The third — symptom 2, the `duration`↔
`playbackSpeed` coupling on a video-segment drag — is **not scoreable by any manual
step**, because the behaviour is silent and indistinguishable from correct operation by
eye. It needs an owner product ruling, not a tester. Do not mark the video path clean on
the strength of 12 + 13 alone.

---

## Failure numbering — ONE scheme, and it is the step number

**Refer to a failure by its CHECKLIST STEP NUMBER. Nothing else.**

This is a ruling, not a preference, because three incompatible numbering schemes have
already been in simultaneous use for the same defects:

| Defect | Checklist step (**use this**) | Repo's own "F" number | A later brief's "F" number |
|---|---|---|---|
| Pointercancel left state dirty | **10** | F4 (commit `38fad08`) | F10 |
| Last segment drag rescaled the timeline | **4** | F2 (commit `9cd7b4f`) | F4 |
| No auto-scroll past the viewport edge | **9** | F3 | F9 |

Note what that table shows: **"F4" means two different defects** depending on which
document you are reading, and the repo's F2 is another document's F4. This cost real
time on 2026-08-08 — a re-scoped brief was written against failure numbers that had
drifted, and the mismatch was only caught by a baseline test-count check.

The "F" numbers were per-run labels for one triage session's findings. They were never
stable identifiers and should not be treated as such. Step numbers are stable, they are
what a tester actually reads off the table above, and they are what commit messages,
`project-state.md`, and `docs/history.md` should cite from here on.

If a future run finds a defect that is not yet a checklist step, **add the step first**,
then refer to it by its new number — exactly as steps 11 and 12 were added on 2026-08-08.

---

## Run log

### 2026-08-08 — first real manual run

The first actual manual run against this checklist, performed by the app owner. Found **seven
real defects** the fully-green automated suite (1470 tests) had not caught — direct
confirmation of why this checklist exists at all (see "Why this exists" above). Steps 11 and
12 above were added AFTER this run, from failures the tester found that weren't yet checklist
steps — the checklist itself was gapped, not just the automated suite.

| # | Step | Result | Outcome |
|---|---|---|---|
| 1 | Middle segment, right edge (outward) | FAIL | Stalled after a few px. Fixed 2026-08-08 — the K15b neighbour yield floor was bounded at the neighbour's OUTERMOST word (its leading/trailing silence only, ~0.15s on real synced material), not its innermost. See `dragCascade.ts`'s `neighbourYieldableSec`. |
| 2 | Middle segment, left edge (outward) | FAIL | Same root cause as step 1 — fixed by the same change. |
| 4 | Last segment, right edge | FAIL | Grew the segment correctly but visibly moved every EARLIER segment too. Not data corruption — the committed array was untouched outside the dragged index. Cause: `Timeline.tsx`'s zoom formula read live `totalDuration`, so lengthening the timeline rescaled `pixelsPerSecond` and re-laid out every card. Fixed 2026-08-08 by freezing the zoom basis across a resize drag. |
| 7 | Negligible drag reverts | RULING | Not a bug — owner ruled the revert-on-negligible-drag behavior should be REMOVED. Implemented 2026-08-08: `NEGLIGIBLE_DRAG_SEC` withdrawn: a drag that moved commits however small. |
| 9 | Drag past visible edge | FAIL | No auto-scroll. Confirmed as a real, unimplemented capability — scoped as separate follow-up work (continuous scroll-ramp logic while the pointer holds at an edge is more than a small change; not attempted in the 2026-08-08 triage). |
| 10 | Interrupted drag / pointercancel | FAIL (partial) | The discard itself (landed the task before this run, per the 2026-08-08 pointercancel ruling) worked correctly, but left two pieces of state dirty: a ghost-click swallower stayed armed (pre-existing — present since before the discard ruling too) and the playback-speed baseline was never cleared (newly introduced by the discard implementation, since it added an early return that skipped the existing clear). Both fixed 2026-08-08. |
| 11 (new) | Locked segment, own edge | FAIL | Not a prior checklist step. A locked segment could be freely resized by grabbing its own edge — `computeDragCascade` only ever checked a locked NEIGHBOUR. Fixed 2026-08-08. |
| 12 (new) | Video boundary, both sides play | FAIL | Not a prior checklist step. Both adjacent video segments froze in preview after a boundary drag. Investigated 2026-08-08 — traced to `src/hooks/useWebCodecsPreview.ts`'s decode pool, outside the drag path proper. NOT fixed as part of this triage; needs its own investigation. |

Steps 3, 5, 6, 8 were not reported as failing in this run.

Follow-up filed: step 9 (auto-scroll) needs separate scoping; step 12 (video freeze) needs its
own investigation into the WebCodecs preview decode pool. A second manual run against the
fixes above (plus the two new steps 11/12) is warranted before the next release.

### 2026-08-08 (later the same day) — automated follow-up pass, no new manual run

Not a manual run. A follow-up work session against the failures the run above left
open, plus the structural gaps that run exposed in the automated suite itself. Recorded
here because it changes what several steps are worth and what still needs a human.

**Standing status after this pass: 8 PASS (from the run above, unchanged) / 1 step
implemented and awaiting its first manual confirmation (9) / 1 step DEFERRED (12) /
2 steps needing re-confirmation by hand (4, 10).**

| Step | What changed | Still needs a human? |
|---|---|---|
| 4 | Already fixed in the earlier pass. Now *locked*: cross-layer agreement guards added in `timelineLayout.test.ts` (pure arithmetic, incl. a divergence test proving the guard has teeth) and `timeline.render.test.tsx` (both lanes place each segment identically). The render-level guard's scope was mutation-tested and its limits written into the test file rather than assumed. | **Yes** — visual alignment. `jsdom` has no layout engine; the suite asserts arithmetic, never pixels. |
| 9 | **Implemented.** Edge auto-scroll now exists (`dragSession.ts` + `computeAutoScrollVelocity` in `dragGeometry.ts`). The `it.fails` placeholder is now a real 8-test passing suite, including the property that a drag reaching a content-x by scrolling commits identically to one reaching it by pointer motion. | **Yes** — feel. The ramp constants were chosen, not tuned against a real hand. |
| 10 | Already fixed in the earlier pass. The *credibility* gap it exposed is now closed: teardown in `dragSession.ts` is one function called from a `finally` shared by commit/revert/discard, and every harness test now runs a universal post-condition auditing listener balance, swallower count, auto-scroll teardown and residual session state. Verified non-vacuous by reverting the fix and confirming the audit fires. | **Yes** — only a real OS interruption can prove the real trigger reaches that listener. |
| 12 | **DEFERRED properly.** Parked in `docs/video-segment-investigation.md` with its three symptoms separated. Do not score this step. | No — do not run it as pass/fail; add observations to that document. |

**A finding worth keeping.** When the universal post-condition was switched on for the
first time, **exactly one existing test failed** — the one that deliberately pins the
known early-bail stuck-`resizingId` bug. No hidden leaks existed anywhere else in the
harness suite. That is a genuinely good result for the suite, and it is also the reason
the audit had to be validated separately by reverting a real fix: a post-condition that
finds nothing is indistinguishable from one that checks nothing until you make it fail
on purpose.

**Still open, unchanged by this pass:** the early-bail stuck-`resizingId` bug (see the
"Known issue, not a checklist failure" note above). The skipped test asserting the
desired behaviour was re-measured and still fails. It was left skipped deliberately:
fixing it means reordering the guards at the top of `startDragSession`, which would
contradict a *passing* test that pins the current behaviour — a test change that needs a
ruling rather than a drive-by edit.

### 2026-08-08 (third pass) — manual retest of steps 4/5/6/10, and step 10 fixed by measurement

A real manual run by the owner against the previous pass's fixes, followed by one timeboxed
work session on the single remaining failure.

| Step | Manual result | Outcome |
|---|---|---|
| 4 — last segment, right edge | **PASS** | Inert in both directions, no card shift anywhere in the timeline. The owner's semantic ruling (option (i): the last segment's right edge is not draggable at all — `docs/decisions/2026-08-08-last-segment-edge.md`) holds in the real shell. The last segment's **left** edge still drags normally, as intended. |
| 5 — single locked neighbour | **PASS** | |
| 6 — locks on both sides | **PASS** | |
| 10 — interrupted drag (Cmd+Tab) | **FAIL → FIXED** | Failed a fourth time. Given one final timeboxed attempt whose first action was to instrument the real shell rather than patch the handler again — which is what resolved it. See the step 10 note above for the captured event log and the fix. |

**The methodological lesson, stated plainly because it cost four attempts:** three prior fixes
edited the `pointercancel` handler on the assumption that the event fires. Ten minutes of
DEV-only instrumentation in the real shell showed it never does, and that the gesture was
being **committed** rather than left dangling — a different defect from the one being fixed.
Every one of those three attempts passed its synthetic test. **When a manual step fails
repeatedly while its automated coverage is green, the next action is to measure what the
platform actually delivers, not to edit the handler again.**

**Test count after this pass: 1536 (1535 pass, 0 fail, 1 skip)**, from 1530. `tsc` clean,
golden replay 3/3 byte-identical.

---

## Undo / redo manual steps (added 2026-08-08)

Built in WS2 stages 3-5. Run these in the real Tauri app alongside the drag steps
above — the automated suite covers the logic (150 tests across `history.test.ts`,
`historyPersist.test.ts`, `historyStage3.test.ts`, `undoShortcut.test.ts`,
`appShortcuts.test.ts`, `dragSessionHarness.test.ts` PART 6) but cannot see the
shell, the OS menu, or a flash on a real screen.

| # | Step | Expected result (a "no" is a fail) | Already covered by automated tests? |
|---|---|---|---|
| U1 | Resize a segment edge, then press **⌘Z**. | The segment returns to its exact previous size, and so does every neighbour the cascade moved. One press undoes the WHOLE gesture, not one frame of it. | Entry accounting is covered through the real drag session (`dragSessionHarness.test.ts` PART 6: one commit = exactly 1 entry across 60 preview frames). Only the eye confirms the restored geometry looks right on screen. |
| U2 | Press **⌘⇧Z**, then **⌘Y**. | Both redo. The segment returns to the resized state. | Chord table swept exhaustively (`undoShortcut.test.ts`). Confirmed once already in QA — re-check after any keydown-handler change. |
| U3 | Make ~8 separate edits, then hold **⌘Z** through all of them and back with **⌘⇧Z**. | Every state comes back in order, nothing jumps or is skipped, and the timeline never shows a gap or an overlap between cards. | Round-trip identity and the gapless invariant on every reachable state are property-tested (42-case sweep). The **visual** gapless check is the part only you can do. |
| U4 | Drag a segment, then **⌘+Tab away mid-drag** (button still held). Come back and press **⌘Z**. | The drag already discarded (step 10), so there is nothing to undo from it — undo reaches the edit BEFORE the drag. It must not undo a phantom entry. | `dragSessionHarness.test.ts` PART 6 asserts a blur-interrupted gesture pushes **zero** entries. |
| U5 | **Lock** a segment, resize a DIFFERENT segment so the cascade would move the locked one, then try to undo back past a change that moved it. | The undo is **refused**: the locked segment is scrolled to and flashed, and a toast says "Segment N is locked. Unlock to undo this change." with an **Unlock** button. Click Unlock, press ⌘Z again — now it works, and the entry was not consumed by the refused attempt. | The decision is unit-tested (`historyStage3.test.ts` PART 1). Only the eye confirms the toast, the scroll, and that the flash lands on the right card. |
| U6 | Undo an edit on a segment that is **scrolled off-screen**, then one that is **already visible**. | Off-screen: the timeline scrolls to reveal it. Already visible: **no scroll at all**, but it still **flashes**. A scroll you did not need is the failure mode here. | Pure decision unit-tested. The flash timing and whether it reads as a flash rather than a glitch are visual only. |
| U7 | Drag a **grade slider** (Effects tab) across its range in one gesture, release, then press **⌘Z** once. | The grade returns to its pre-drag value in ONE press. Not thirty presses, and not a press that lands halfway through the drag. | Coalescing is unit-tested at exact millisecond boundaries, including the 120ms trailing debounced write. Only a real gesture confirms the wiring reaches it. |
| U8 | Type in a text field, then press **⌘Z** while it still has focus. | The **field's own** text undo runs — the project is NOT undone. Click away first and ⌘Z undoes the project edit. | Suppression is unit-tested; confirmed once in QA. |
| U9 | Make an edit, then **right-click → Reload**. After it comes back, press **⌘Z**. | History SURVIVED the reload and the undo works. | Persistence round-trip incl. the session-token gate is unit-tested, and was verified end-to-end in a dev-server reload. The real WKWebView reload is the part only you can run. |
| U10 | Make an edit, **quit the app entirely**, relaunch, open the same project. | History is **EMPTY** — undo is greyed out. An app restart starts fresh (owner ruling); only a reload preserves. | The token gate is unit-tested and verified non-vacuous. Whether the real Rust process token behaves as expected across a genuine quit/relaunch is only checkable here. |
| U11 | Go **back to the dashboard** and re-open the same project. | History is **EMPTY**. Re-opening a project starts fresh. | Clearing is wired; not render-tested. |
| U12 | Make **more than 20** edits, then undo as far as it will go. | You get 20 undos and then the button greys out. The oldest states are silently gone — no warning, no error. | Depth cap and eviction unit-tested. |
| U13 | Start a drag and, **without releasing**, press **⌘Z**. | Nothing happens. The drag continues normally and completes on release. | `dragging` stand-down unit-tested; only a real gesture confirms the ref is live at that moment. |
| U14 | Press **⌘R** (and **F5**) with no export running, then again **during an export**. | No export: the app reloads. During an export: it does **NOT** reload, and toasts "Cancel the export before reloading." | Unit-tested. The export-in-flight case needs a real export. |
| U15 | Press **⌘⌥I** (and **F12**). | The Web Inspector opens; pressing again closes it. | Cannot be tested — it is a Rust call into the OS webview. |
| U16 | With an undo available, hover both toolbar buttons. | The tooltip NAMES the edit ("Undo resize segment 12"), and the button face shows only an icon — the row must not reflow as the label changes. | Static markup asserts the tooltip and the absence of face text. |

### Scoring

```
U1  (drag undo, whole gesture):        PASS / FAIL   Notes: __________
U2  (redo, both chords):               PASS / FAIL   Notes: __________
U3  (8 deep, round trip, no gaps):     PASS / FAIL   Notes: __________
U4  (interrupted drag pushes nothing): PASS / FAIL   Notes: __________
U5  (locked segment blocks undo):      PASS / FAIL   Notes: __________
U6  (scroll only if off-screen):       PASS / FAIL   Notes: __________
U7  (slider = one entry):              PASS / FAIL   Notes: __________
U8  (text field keeps native undo):    PASS / FAIL   Notes: __________
U9  (history survives reload):         PASS / FAIL   Notes: __________
U10 (app restart clears):              PASS / FAIL   Notes: __________
U11 (dashboard return clears):         PASS / FAIL   Notes: __________
U12 (20-deep cap):                     PASS / FAIL   Notes: __________
U13 (undo inert mid-drag):             PASS / FAIL   Notes: __________
U14 (reload; blocked during export):   PASS / FAIL   Notes: __________
U15 (devtools toggle):                 PASS / FAIL   Notes: __________
U16 (tooltips name the edit):          PASS / FAIL   Notes: __________
```

### Known, and NOT a failure

- **The undo/redo BUTTONS are only on the Files tab** (they sit in the row with
  Apply sync, per the owner's placement ruling, and that row is that tab's pinned
  footer). The keyboard shortcuts work on every tab, so undo is never unreachable.
  If always-visible buttons are wanted, the right panel header is the
  always-mounted spot — that is a ruling, not a bug.
- **Windows is unverified** for every shortcut in this section. `tauri.conf.json`
  bundles a Windows ffmpeg sidecar so it is a real target, but no Windows hardware
  has exercised any of this.

---

### 2026-08-08 (close-out) — FULL PASS, first fully-green run

**The first run in this checklist's history where every scoreable step passed.**

```
Date:          2026-08-08
Build:         dev shell (npm run tauri:dev), commit 432a224
Platform:      macOS Intel (x86_64)
Tester:        app owner

Step 1  (middle segment, right edge):        PASS
Step 2  (middle segment, left edge):         PASS
Step 3  (segment 0, left edge):              PASS
Step 4  (last segment, right edge):          PASS  — see note below
Step 5  (single locked neighbour):           PASS
Step 6  (locks on both sides):               PASS
Step 7  (negligible drag reverts):           PASS
Step 8  (drag while scrolled):               PASS
Step 9  (auto-scroll past visible edge):     PASS
Step 10 (interrupted drag / Cmd+Tab):        PASS
Step 11 (locked segment, own edge):          PASS
Step 12 (video boundary, both sides play):   PASS  — SYMPTOM 1 ONLY
Step 13 (drawer slip bar):                   NOT RUN — added after this run

U1-U16 (undo / redo):                        ALL PASS

Overall: PASS (12 of 12 scoreable steps; step 13 postdates the run)
```

**Automated gates at the same commit** [MEASURED]: 66 files, 1688 tests
(1687 pass / 0 fail / 1 skip), `tsc --noEmit` clean, `cargo check` clean, golden replay
(`scripts/phase4-handoff-replay-sync.test.ts`) 3/3 byte-identical.

Tagged **`verified-baseline-2026-08-08`** — the first state where the automated suite AND
the full manual checklist are both green in the real shell, which is what distinguishes it
from every earlier green-suite tag.

#### Three things this PASS does NOT mean

Recorded because a 12/12 is exactly the kind of result that gets over-read.

1. **Step 4's PASS is the LEFT edge behaving, not the right edge being tested.** The
   original report — *"Left edge/inward drag resizes normally"* — was ambiguous and was
   resolved before this run was accepted. The last segment's **right edge is inert in both
   directions**, by construction, not by behaviour: `isDragEdgeLocked`
   (`dragCascade.ts:100-108`) takes no direction or delta argument, and is evaluated at
   gesture *start* (`dragSession.ts:161`) before a pointer has moved. Two independent layers
   enforce it — `Timeline.tsx:730` renders no hit target, and `dragSession.ts:161` refuses
   before wiring a listener. Directly pinned by name in `dragSessionHarness.test.ts`: *"a
   GROW … is inert"* and *"a SHRINK … is equally inert"*, plus *"the final segment's LEFT
   edge is unaffected and still drags normally"*. What step 4 confirms is that third test's
   behaviour on a real screen.

2. **Step 12 scores symptom 1 only.** It does not score the `duration`↔`playbackSpeed`
   coupling (silent, looks correct by eye — ruled a bug 2026-08-08, queued at roadmap § D12)
   and it cannot reach the drawer slip-bar overflow (step 12 never opens the drawer). See
   `docs/video-segment-investigation.md`. Symptom 1's own resolution has **no identified
   cause** — no commit touched either implicated module — so a recurrence is expected rather
   than surprising.

3. **Step 13 has never been run by anyone.** It was added *after* this run precisely because
   the drawer had no manual coverage at all, which is why symptom 3's absence from every
   prior run log meant nothing. Its first score is still outstanding.

**Windows remains unverified** for every drag step and every keyboard shortcut.
