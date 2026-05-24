# Fidelity Polish — Manual Smoke Tests

> Branch: `fidelity-polish` | Date target: 2026-05-21
> Run after `npm run dev` unless noted otherwise. Each item maps to a plan item.

---

## Prerequisites

1. `npm run dev` — dev server with COOP/COEP headers active
2. Browser: Chrome (primary) or Safari. Firefox is acceptable but canvas `ctx.filter` rendering may differ slightly.
3. Have at least two test assets ready: one **image** (JPEG/PNG) and one **video** (MP4).
4. Optional: a voiceover audio file (MP3/M4A) for transition tests.

---

## Item 5 — trimEnd UI

### 5-A: trimEnd control appears only for video segments

1. Upload one **image** and one **video**.
2. Run sync wizard to create at least one image segment and one video segment.
3. Open SegmentEditorPanel. Expand the image segment — confirm **no "Trim End" slider** is visible.
4. Expand the video segment — confirm a **"Trim End" slider** appears, showing "end of media" as default.

**Pass**: Trim End absent for image; present for video with "end of media" default.

### 5-B: trimEnd clamps playback in preview

1. For the video segment in 5-A, drag the **Trim End** slider left to approximately 50% of the video's duration.
2. Press Play. Watch the preview: the video segment should **stop (freeze or cut)** at the trim point — it must not play past it.
3. Press the **×** reset button next to Trim End. Confirm the label returns to "end of media".
4. Press Play again — the video should now play to its full natural end.

**Pass**: Video stops at trim point; × resets to "end of media"; full play resumes after reset.

### 5-C: trimEnd honoured in export

1. Set Trim End to ~2 s on a 5 s video segment.
2. Export (Settings → Export). Open the MP4 in a media player.
3. The video segment in the exported file should be ≤ 2 s long, not 5 s.

**Pass**: Exported segment duration matches trim point.

---

## Item 1 — AnimationType canvas + live preview

### 1-A: Picker includes KEN_BURNS

1. Open SegmentEditorPanel → expand any segment → find the **Camera Dynamics** (AnimationType) dropdown.
2. Confirm **Ken Burns** is listed (it was previously absent from the picker despite being the default).

**Pass**: "Ken Burns" option visible in the dropdown.

### 1-B: KEN_BURNS animates in preview

1. Set a segment's Camera Dynamics to **Ken Burns**.
2. Press Play. The segment's image/video should **slowly zoom in** over its duration (scale 1.0 → 1.1).

**Pass**: Visible slow zoom-in during playback.

### 1-C: Spot-check other animation types in live preview

| Animation | Expected visual in preview |
|-----------|---------------------------|
| Float | Gentle vertical oscillation (up-down sine) |
| Bounce | Segment drops in with spring overshoot |
| Pulse | Subtle scale throb (1.0 → 1.05 → 1.0 repeat) |
| Rotate | Entry spin (-360° → 0°) over first ~1 s |
| Shake | Rapid horizontal jitter |
| Glitch | Jittery x/y offset + blur flashes |

Test at least 3 from the table.

**Pass**: Each tested animation produces a noticeably distinct visual.

### 1-D: AnimationType applied in canvas export (KEN_BURNS)

1. Set one image segment to **Ken Burns**.
2. Export. Inspect the MP4: the segment should show a slow zoom — static image should not appear completely static.

**Pass**: Zoom-in motion visible in exported segment.

---

## Item 4 — Overlay drag-to-position

### 4-A: Extra overlays are draggable

1. On any segment, add an **extra text overlay** (via "Add Overlay" in SegmentEditorPanel).
2. In the preview, hover over the overlay text — cursor should change to **move** (grab cursor).
3. Click-and-drag the overlay to a new position. Release.
4. The overlay should visually **move** and **stay** at the dropped position.

**Pass**: Overlay moves on drag; stays after release.

### 4-B: Drag clamping prevents escape

1. Drag an overlay to the far **left edge** — it should stop at roughly `halfW/2` percent from left, not disappear off-screen.
2. Drag to the far **right edge** — same; stops before going off-screen.
3. Drag to the **top** — stops at roughly the 10% top boundary.
4. Drag to the **bottom** — stops at the 90% bottom boundary.

**Pass**: Overlay stays visible at all four edges; never clips outside the stage.

### 4-C: Position persists on reload

1. Drag an overlay to a non-center position.
2. Reload the page. Load the saved project.
3. The overlay should appear at the same dragged position.

**Pass**: Position survives reload via localStorage.

---

## Item 2 — KEN_BURNS in ANIMATION_OPTIONS (picker completeness)

Covered by Item 1-A above. No separate test procedure needed.

---

## Item 3 — Preview transitions (partial / known limitation)

Set Transition Style = FADE, Duration = 1.0 s, Apply to All. Play through 2-3 transitions.

Expected:
- Visible cross-fade blend during the transition window (canvas overlay)
- No double cross-fade or stutter from Framer Motion underneath
- **KNOWN LIMITATION:** brief (~100-200ms) black flash at the end of transitions that land on a video segment. See deferred items in project-state.md.
- Exports are unaffected by this preview-only artifact.

### 3-A: Transition window activates canvas overlay

1. Set up **two segments** (at least one with a video asset, or both images — both work).
2. In Settings → Global Transition, choose **Crossfade** (or Fade). Set duration to **1.0 s**.
3. Press Play. As playback reaches the segment boundary, observe the preview.
4. During the transition window, you should see a **smooth blend** from the outgoing frame to the incoming frame — not a hard cut.

**Pass**: Canvas blend is visible. The black flash at video boundaries is acknowledged as a known limitation, not a regression.

### 3-B: Transition types are visually distinct

| Transition | Expected in preview |
|-----------|---------------------|
| Fade | Outgoing fades to black, incoming fades in |
| Crossfade | Direct cross-dissolve between frames |
| Slide | Incoming slides in from the left |
| Slide Up | Incoming slides in from below |
| Zoom | Outgoing zooms out while incoming fades in |
| Blur | Outgoing blurs out, incoming blurs in |

Test at least Crossfade and one spatial transition (Slide or Zoom).

**Pass**: Each tested transition looks distinct and smooth.

### 3-C: No stale overlay after seek

1. During a transition window preview, scrub the playhead **back** (before the transition).
2. The transition canvas overlay should **disappear immediately** — no frozen blended frame lingers.

**Pass**: Canvas overlay clears cleanly after seek-back.

### 3-D: No console errors during repeated playback

1. Play through a transition window 3+ times (loop or repeated play/seek).
2. Open DevTools → Console. Check for:
   - `[useTransitionPreview] snapshot render failed` warnings
   - React state-update-after-unmount errors
   - Any `[transition-debug]`, `[hold-debug]`, or `[black-fade-debug]` logs (must be **absent**)
   - Any uncaught exceptions

**Pass**: Console clean (minor warnings about ffmpeg are acceptable; snapshot/unmount errors are not; diagnostic prefix logs must be absent).

---

## Post-test Checklist

- [ ] All 5 items above have at least one "Pass" verdict recorded
- [ ] `npx tsc --noEmit` exits 0 on the `fidelity-polish` branch
- [ ] `npm run build` exits 0; bundle ≤ 444 kB raw / ≤ 136 kB gzip
- [ ] No regressions in non-Fidelity-Polish features (timeline scrub, export, persistence, stock search modal)
