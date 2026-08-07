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
| 4 | Drag the **last segment's right edge**, both growing and shrinking. | Growing extends the timeline's total length smoothly (the scrollable width / total-duration readout updates); shrinking leaves no stray gap after the new end. | Logic only. `dragSessionHarness.test.ts` PART 4 has an explicit "grow AND shrink on the timeline's last segment" case; only the eye confirms the scrollbar/total-width chrome actually updates on screen. |
| 5 | Lock the segment immediately **beside** the one you're dragging, then drag toward it until you'd need to cross into its slot. | The drag stops exactly at the locked neighbour's edge. The locked segment does not move by even a pixel. No console error. Hitting the limit should feel like hitting a wall — no visible jump or desync between the pointer and the edge once it's stopped. | Numbers only. `modelPLockSemantics.test.ts`/`dragCascade.test.ts` assert the numeric floor is respected; only the eye confirms the stop doesn't look broken (a pointer that keeps moving 40px past an edge that stopped moving reads as a bug even when the math is right). |
| 6 | Lock **both** neighbours of the segment you're dragging, then drag each edge toward its limit. | The segment can move only within the space between its two locks. Both locked segments stay visibly immovable. Hitting a limit on either side simply stops the drag — no snapping, no negative-duration flash. | Numbers only. `dragSessionHarness.test.ts` has dedicated "locks on BOTH immediate neighbours" cases (both a left-edge and right-edge shrink variant); the eye confirms no flicker/flash at either limit. |
| 7 | Grab an edge, move the pointer **only a few pixels**, and release. | Nothing commits. The segment snaps back to its exact starting size with no visible flicker, no console error, and — importantly — releasing does **not** trigger an accidental seek or selection change (the ghost-click case). | Numbers only. The negligible-drag threshold and its "reverted" outcome are fully covered by `dragSessionHarness.test.ts`; the ghost-click swallow (`window.addEventListener('click', ..., {capture:true, once:true})`) is real-browser click-synthesis behavior that `jsdom`'s synthetic events don't reproduce — only the eye can confirm no stray seek happens. |
| 8 | **Zoom in** until the timeline overflows its panel, **scroll right**, then drag a segment that is now positioned to the left of the original (unscrolled) viewport. | The drag tracks the pointer correctly relative to the *scrolled* position — no jump the instant the drag starts, and the edge stays under the pointer for the whole gesture. | **Nothing.** `jsdom` has no real scroll-affecting layout; `timelineContentX`'s `scrollLeft` term is only ever exercised with hand-fed numbers in unit tests, never against a real scrolled viewport. This is the single step with the least automated coverage (§4.1) — give it real attention. |
| 9 | While zoomed in, drag a segment's edge **toward and past the visible right edge** of the timeline panel. | The drag keeps tracking correctly (or the timeline auto-scrolls, if that's the intended behavior — note which one actually happens). The UI must not freeze, clip the drag, or lose the pointer. | **Nothing.** This is real-viewport, real-scroll behavior with no `jsdom` equivalent at all. |
| 10 | Start a drag, then force an interruption: release the mouse button **outside the browser window**, or switch applications mid-drag (Cmd+Tab) so the OS takes the gesture away. | See the open pointercancel question below — for now, confirm what **actually happens** (does the drag commit at its last position, or discard?) and report it. Either way: the drag session must end cleanly — no stuck cursor, no stuck "resizing" state that blocks the next drag, no leaked listeners (immediately try a normal drag on another segment right after; it must work normally). | Partial. `dragSessionHarness.test.ts` PART 4 pins the *code path* — a synthetic `pointercancel` event resolves through the identical `handleUp` a `pointerup` does — but it cannot produce a **real** OS-triggered `pointercancel` (window-switch, device change, gesture takeover). This step is the only way to confirm the real trigger fires the same listener at all. |

**Known issue, not a checklist failure:** dragging a segment id that doesn't exist, or
starting a drag before the timeline DOM exists, is a documented, deliberately-unfixed bug
(the "stuck `resizingId`" bug — see `project-state.md`'s Deferred Known Bugs). It is not
reachable through normal UI use (a drag always starts from an already-rendered segment
against an already-rendered timeline), so it is not a checklist step — don't spend time
trying to trigger it here.

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
Step 9  (drag past visible edge):            PASS / FAIL   Notes: __________
Step 10 (interrupted drag / pointercancel):  PASS / FAIL   Notes: __________
                                              Observed behavior: commit / discard (circle one)

Overall: PASS / FAIL
Follow-up filed (if any): __________
```
