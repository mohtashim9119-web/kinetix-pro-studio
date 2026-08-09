# Manual WKWebView Drag Checklist

> **Purpose:** the live manual QA procedure for drag/timeline changes — adopted
> 2026-08-08 (WS2 task 3) because `jsdom` cannot see real WKWebView rendering, paint,
> or event timing. **Permanent, not workstream-scoped** — stays at `docs/` root
> indefinitely, outliving any single workstream. Only executable steps, setup, and
> pass criteria belong here. **Never put here:** run logs, investigation narrative,
> or closed sections — append those to `docs/history.md`'s "WKWebView Drag
> Checklist — Run History and Closed Sections, Folded" entry instead. Run time under
> fifteen minutes once a test project is loaded.

---

## Why this exists

The Route 2 harness (`dragSession.test.ts`, `dragSessionHarness.test.ts`) drives the real
`startDragSession` function against a real `jsdom` `document`/`window`. That is genuine
coverage of the drag *logic*, but `jsdom` has no CSS layout engine, is not WKWebView, its
`requestAnimationFrame` is a `setTimeout` shim, and it has no compositor or paint — so
constant-offset bugs, real WebKit rendering quirks, frame coalescing under a real event
flood, and perceived smoothness are all structurally invisible to the automated suite. A
human watching the real app is the only thing that can currently assert "this looks and
feels right." Full rationale: `docs/history.md`'s "WS2 Task 2" entry.

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
   checklist — it skips exactly the WKWebView-specific gap class this exists to catch.
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
| 1 | Drag a **middle segment's right edge**, a moderate distance (~1s of timeline width). | The dragged edge tracks the pointer with no visible lag or snap. The **next segment's left edge visibly moves during the drag itself**, not only after release. Releasing causes no jump/flash on any segment. | Numbers only. `dragSessionHarness.test.ts`'s live-preview tests assert the DOM style values written per frame are correct; they cannot confirm this *reads* as smooth motion under real paint or that nothing lags under a real event flood. |
| 2 | Drag a **middle segment's left edge**. | Mirrored: the left edge tracks the pointer; the **preceding** segment's right edge visibly follows live; no jump on release. | Numbers only — this is the exact shape of the K16 fault-3 regression (a left-edge drag that silently moved the wrong edge). `dragGeometry.test.ts`/`dragSession.test.ts` assert `style.left` is written correctly; only the eye confirms it doesn't visually lag the pointer. |
| 3 | Drag **segment 0's left edge** (the very first segment — no predecessor). | The edge moves smoothly up to true `t=0` and stops there — no gap opens before segment 0, and nothing glitches or vanishes at the boundary. | Logic only. `dragCascade.test.ts` covers the off-the-end math (this is also where the real K14/K15a gap-collapse bug lived); only the eye confirms the on-screen boundary doesn't visually glitch. |
| 4 | **MANUAL-ONLY (visual).** Drag the **last segment's right edge**, both growing and shrinking. Watch the segment cards against the waveform lane beneath them. | The edge is **inert in both directions** — the last segment's right edge is a hard invariant (`segments[N-1].end === mediaDuration`), not draggable at all. No card drifts, nothing before the dragged segment moves. The last segment's **left** edge still drags normally. | Arithmetic and DOM-level agreement are covered: `dragTriage.test.ts`'s F2 block, `timelineLayout.test.ts`, `timeline.render.test.tsx`, and `dragSessionHarness.test.ts`'s named inert-edge tests. **None of it can see pixels** — `jsdom` has no layout engine, so whether the two lanes LOOK aligned on a real screen is unprovable by the suite. |
| 5 | Lock the segment immediately **beside** the one you're dragging, then drag toward it until you'd need to cross into its slot. | The drag stops exactly at the locked neighbour's edge. The locked segment does not move by even a pixel. No console error. Hitting the limit should feel like hitting a wall. | Numbers only. `modelPLockSemantics.test.ts`/`dragCascade.test.ts` assert the numeric floor is respected; only the eye confirms the stop doesn't look broken. |
| 6 | Lock **both** neighbours of the segment you're dragging, then drag each edge toward its limit. | The segment can move only within the space between its two locks. Both locked segments stay visibly immovable. Hitting a limit on either side simply stops the drag — no snapping, no negative-duration flash. | Numbers only. `dragSessionHarness.test.ts` has dedicated "locks on BOTH immediate neighbours" cases; the eye confirms no flicker/flash at either limit. |
| 7 | Grab an edge, move the pointer **only a few pixels**, and release. | The drag commits at however small the move was — there is no revert-on-negligible-drag (withdrawn by owner ruling). No console error, and releasing does **not** trigger an accidental seek or selection change (the ghost-click case). | Numbers only. Covered by `dragSessionHarness.test.ts`; the ghost-click swallow is real-browser click-synthesis behavior `jsdom` doesn't reproduce — only the eye can confirm no stray seek happens. |
| 8 | **Zoom in** until the timeline overflows its panel, **scroll right**, then drag a segment that is now positioned to the left of the original (unscrolled) viewport. | The drag tracks the pointer correctly relative to the *scrolled* position — no jump the instant the drag starts, and the edge stays under the pointer for the whole gesture. | **Nothing.** `jsdom` has no real scroll-affecting layout; `timelineContentX`'s `scrollLeft` term is only ever exercised with hand-fed numbers in unit tests, never against a real scrolled viewport. This is the step with the least automated coverage — give it real attention. |
| 9 | **MANUAL-ONLY (feel).** While zoomed in, drag a segment's edge **toward and past the visible right edge** of the timeline panel, and hold it there. Then bring it back inside. | **The timeline auto-scrolls** — starts gently near the edge, speeds up further past it, keeps scrolling while the pointer is held still, and stops the moment the pointer comes back inside. The dragged edge stays under the pointer throughout. No freeze, no clipped drag, no lost pointer, and nothing keeps scrolling after you release. | Logic only. `dragTriage.test.ts`'s F3 block covers ramp thresholds, proportionality, direction, clamping, teardown, and scroll/pointer-motion equivalence. `dragGeometry.test.ts` PART 4 unit-tests the velocity curve. **None of it can measure comfort or smoothness** — the ramp constants (48px zone, 1200 px/s ceiling) were chosen, not tuned against a real hand. Say so in Notes if it feels wrong. |
| 10 | Start a drag on a segment edge, keep the mouse button **held down**, then switch applications mid-drag (**Cmd+Tab**) and come back. Also: start a drag, release the button **outside the window**, then move the pointer back over the timeline. | The drag **discards** — the segment springs back to its pre-drag geometry with no timing change — and the session ends cleanly: the `col-resize` cursor is gone, text selection works again, and the next drag behaves normally. | Covered at the logic layer by `dragSessionHarness.test.ts` PART 5 (verified non-vacuous). What remains manual is confirming the real shell still delivers `blur` on Cmd+Tab — the measured premise the fix rests on. Full investigation: `docs/history.md`'s "WKWebView Drag Checklist" folded entry, Step 10 subsection. |
| 11 | Grab a **locked** segment's own edge (not a neighbour's — the segment itself) and try to drag it. | The segment does not move by even a pixel, in the live preview or after release. No console error. | Numbers only. `dragCascade.test.ts`/`dragSessionHarness.test.ts` assert the array and live preview never move; only the eye confirms the stop doesn't look broken. |
| 12 | Drag a boundary between two **video** segments (either edge), then let playback cross into both the segment you shrank and the one you grew, without navigating away from the preview. | Both segments play normally — no frozen/stuck frame on either side of the moved boundary. ⚠️ **This step scores SYMPTOM 1 ONLY** of the three tracked in [`docs/ws3-video-segments/video-segment-investigation.md`](ws3-video-segments/video-segment-investigation.md) — the preview freeze. It does **not** score symptom 2 (the `duration`↔`playbackSpeed` coupling on a video drag: silent, looks correct, needs an owner ruling not a test) and it **cannot reach** symptom 3 (the drawer's slip-trim bar — this step never opens the drawer; that is step 13). A PASS here is not a clean bill of health for the video path. | Nothing. No automated coverage exists for the preview decode pool's response to a segment-timing change at all. Re-run after ANY change to the preview decode path. |
| 13 | Open the segment editor **drawer** on a segment that has **no source clip** — an image segment, or any segment whose `sourceDuration` is unset — and whose duration is **longer than 60 seconds**. (Make one if the project has none: drag an image segment out past 60s, or set the duration numerically in the drawer.) Look at the orange **slip-trim bar** in the drawer's Asset column. | The bar stays **inside its container**. It does not extend past the container's right edge, overflow the drawer, or push the drawer wider than the viewport. | **Nothing, and the mechanism is already identified** — this step exists to confirm or refute it. `BottomDrawer.tsx` computes `widthPct = (duration × playbackSpeed / (sourceDuration ?? 60)) × 100` with **no clamp to 100**. If it overflows, the hypothesis in `docs/ws3-video-segments/video-segment-investigation.md` §3 holds. Record the result there. |

**Note on the video path:** steps 12 and 13 together score two of the three symptoms in
`docs/ws3-video-segments/video-segment-investigation.md`. The third — symptom 2, the
`duration`↔`playbackSpeed` coupling on a video-segment drag — is **not scoreable by any
manual step**, because the behaviour is silent and indistinguishable from correct operation
by eye. It needs an owner product ruling, not a tester. Do not mark the video path clean on
the strength of 12 + 13 alone.

**Known, not a checklist failure:** dragging a segment id that doesn't exist, or starting a
drag before the timeline DOM exists, leaves `resizingId`/the `resizing` body class stuck.
**RULED WONTFIX 2026-08-08** — unreachable through normal UI use; see `project-state.md`'s
Deferred Known Bugs. It is not a checklist step; don't spend time trying to trigger it here.

**Failure numbering: refer to a failure by its checklist step number above, nothing else.**
Ad-hoc "F" labels have drifted across documents before and cost real time reconciling — see
`docs/history.md`'s folded entry for the incident. If a run finds a defect that isn't yet a
step, add the step first, then cite it by that number.

---

## Pass/fail record

Copy this block and fill it in for each run. After the run, append the filled-in block (plus
any notes worth keeping) as a new dated entry under `docs/history.md`'s "WKWebView Drag
Checklist — Run History and Closed Sections, Folded" section — do not accumulate run history
in this file.

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
Step 7  (negligible drag commits):           PASS / FAIL   Notes: __________
Step 8  (drag while scrolled):               PASS / FAIL   Notes: __________
Step 9  (auto-scroll past visible edge):     PASS / FAIL   Notes: __________
Step 10 (interrupted drag / Cmd+Tab):        PASS / FAIL   Notes: __________
Step 11 (locked segment, own edge):          PASS / FAIL   Notes: __________
Step 12 (video boundary, both sides play):   PASS / FAIL   Notes: __________
                                              (scores SYMPTOM 1 ONLY — the preview
                                               freeze. Not symptom 2 or 3.)
Step 13 (drawer slip bar, no sourceDuration): PASS / FAIL   Notes: __________
                                              (scores symptom 3. Record result in
                                               docs/ws3-video-segments/video-segment-investigation.md)

Overall: PASS / FAIL
Follow-up filed (if any): __________
```
