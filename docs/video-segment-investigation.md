# Video-segment path — standing investigation

> Opened 2026-08-08 (WS2 manual-triage re-scope, Stage 4). Parks manual checklist
> **step 12** with somewhere for its findings to live. **No fix is attempted in this
> document** — it exists so the symptoms stop being a single line in a run log.

---

## Why this is one document and not one bug

Manual checklist step 12 ("drag a boundary between two **video** segments, then let
playback cross into both sides") was added on 2026-08-08 from a failure the tester
found that was not yet a checklist step. It has been carried since as a single
DEFERRED entry, which is misleading: **at least three distinct symptoms have been
observed on the video path, and there is no evidence they share a cause.** They are
listed separately below and should be investigated separately.

What they have in common is only the trigger context — a video segment whose timing
was changed by a drag — and that is not enough to assume one root cause. Two of the
three do not involve the preview player at all.

**Nothing in the drag path itself is implicated.** This was checked, repeatedly and
from both directions: `dragCascade.ts` and `dragSession.ts` commit correct, gapless
timing on every check made during the 2026-08-08 triage, and the Stage 1′–3 work in
this re-scope did not change that. The gapless invariant is asserted after every
individual frame of a multi-frame drag (`dragSessionHarness.test.ts` PART 4), not
just at release. Whatever these are, they are downstream of a correct commit.

---

## Symptom 1 — preview freeze after a boundary edit

**Status:** investigated 2026-08-08, NOT fixed. Root cause located to a module, not
to a line.

**Reported behaviour.** After dragging a boundary that touches two video segments,
**both** adjacent segments freeze in the preview player when playback crosses into
them. Not one side — both.

**What is known.**

- [ASSERTED] Traced out of the drag path and into
  `src/hooks/useWebCodecsPreview.ts`'s decode-pool frame-pull / decode-ahead
  effects — `ensureSession` / `getFrameAt` / the chase-mutex machinery.
- [ASSERTED] **There is no automated coverage of the decode pool's response to a
  segment-timing change at all.** Not thin coverage — none. `videoDecoderPool.test.ts`
  covers the pool's own session/eviction/coverage logic against a mock decoder, but
  nothing exercises "the segment array changed underneath a live session."
- [ASSERTED] The pool has a documented history of this exact failure *shape*. A
  previous defect — `getFrameAt` awaiting an entire session's decode rather than just
  enough coverage to answer the query — presented as a freeze on the outgoing
  segment's last frame, and was only caught once a mock was written that could
  separate `output` events from `flush()` settlement (`docs/history.md`, Phase 3).
  A second one, the keyframe-after-`flush()` constraint, was invisible to the mock
  suite entirely while failing on real hardware. **Both were mock-invisible.** That is
  the relevant prior: a green `videoDecoderPool.test.ts` is weak evidence here.

**Leading hypothesis** [ASSUMED]. A timing change invalidates the decode window a
live session was built against, and the session is neither reset nor re-derived — so
both adjacent segments end up served by sessions whose ranges no longer match their
new bounds. That would explain the symmetry (both sides freeze), which a
one-sided decode stall would not.

**Next step.** Before any fix: write a test that changes segment timings under a live
decode session. If it cannot be written against the current mock, that is the finding
— extend the mock first, exactly as the Phase 3 fix had to.

---

## Symptom 2 — playback speed changes when a video segment is dragged

**Status:** unreproduced here. Mechanism identified and it appears to be **working as
designed**, which would make this a UX/discoverability problem rather than a defect.

**Reported behaviour.** Dragging a video segment's edge changes its playback speed.

**What is known.**

- [ASSERTED] This is deliberate, and it is not new. `resolveDragEdge`
  (`src/services/dragGeometry.ts`) couples duration to `playbackSpeed` for any
  segment where `isVideo && sourceDuration > 0`: resizing a video segment holds its
  source clip length fixed and re-times it, clamping speed to
  `[MIN_PLAYBACK_SPEED, MAX_PLAYBACK_SPEED]` = `[0.5, 2.0]` and duration to the
  corresponding window.
- [MEASURED] The coupling predates all K16/K17/WS2 work and is pinned as
  timing-neutral by `dragGeometry.test.ts` PART 1, which asserts `resolveDragEdge`
  byte-identical to the pre-K16 commit expression across a 30-case sweep including
  video fixtures. **So this behaviour cannot have been introduced by any recent drag
  work** — the tests would have failed.

**Assessment** [ASSUMED]. Probably not a bug in the code. It is plausibly a bug in
the product: a user dragging a segment to re-time the timeline may not expect the
clip to also play faster, and nothing in the UI signals that a video edge-drag means
something different from an image edge-drag. There is a speed badge, but it is not
adjacent to the gesture.

**Next step.** This needs an **owner ruling**, not an investigation:

1. Keep as-is (speed coupling is the point — it is how you fit a clip to a slot).
2. Keep, but surface it during the drag (live speed readout on the dragged card).
3. Decouple, and require speed to be set explicitly.

Do not "fix" this without a ruling — silently decoupling would change committed
timings for every video drag, and the golden replay would not catch it (no corpus
project exercises an interactive drag).

---

## Symptom 3 — drawer duration slider overflows the viewport

**Status:** unreproduced here. A concrete, checkable mechanism is identified below.

**Reported behaviour.** The segment drawer's duration control overflows the viewport.

**What is known.**

- [ASSERTED] The control is `BottomDrawer.tsx`'s **slip-trim bar**, not a
  `<input type="range">` — there is no range input in that file. It is a
  percentage-width div inside a fixed-width container:

  ```
  srcDur   = s.sourceDuration ?? 60          // note the fallback
  widthPct = (s.duration * (s.playbackSpeed ?? 1) / srcDur) * 100
  leftPct  = (trimStart / srcDur) * 100
  ```

- [ASSERTED] Nothing clamps `widthPct` to 100. When speed coupling **is** engaged
  the product `duration × playbackSpeed` equals the clip length, so `widthPct ≤ 100`
  and the bar behaves. The overflow needs a case where coupling did **not** engage.
- [ASSERTED] Two such cases exist, and a drag can reach both:
  - **`sourceDuration` is undefined or 0.** `resolveDragEdge`'s coupling is gated on
    `srcDur > 0`, so duration is then bounded only by `MIN_SEGMENT_DURATION` — while
    this bar falls back to a hardcoded `?? 60`. Drag such a segment past 60s and the
    bar is wider than its container by construction.
  - **A non-video segment.** Same `?? 60` fallback, same unbounded duration.

**Leading hypothesis** [ASSUMED]. The `?? 60` fallback is the bug. It invents a
source duration for a segment that has none, and the bar is then drawn as a fraction
of a number that means nothing. The honest rendering for "no source duration" is
probably to not draw a slip bar at all — slip-trimming a segment with no source clip
is not a meaningful gesture.

**Next step.** Cheap to confirm: open the drawer on an image segment (or any segment
with no `sourceDuration`) that is longer than 60s. If the bar overflows, the
hypothesis holds and the fix is local to `BottomDrawer.tsx` — it touches no timing
code and needs no ruling.

---

## What is NOT in scope here

- The drag path (`dragSession.ts`, `dragCascade.ts`, `dragGeometry.ts`). Covered,
  and cleared — see above.
- The export path. None of these symptoms have been observed in an export; both
  export paths derive their own frame timing and do not share the preview decode
  pool.

---

## Related

- `docs/wkwebview-drag-checklist.md` — step 12, and the 2026-08-08 run log.
- `project-state.md` — Deferred Known Bugs ("known video-path gap").
- `docs/history.md` — the 2026-08-08 triage record (symptom 1 as "F6"), and the two
  prior mock-invisible decode-pool defects.
- `src/hooks/useWebCodecsPreview.ts`, `src/services/videoDecoderPool.ts` — symptom 1.
- `src/services/dragGeometry.ts` — symptom 2's speed coupling.
- `src/components/BottomDrawer.tsx` — symptom 3's slip bar.
