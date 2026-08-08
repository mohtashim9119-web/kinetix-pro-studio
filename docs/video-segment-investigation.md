# Video-segment path — standing investigation

> Opened 2026-08-08 (WS2 manual-triage re-scope, Stage 4). Parks manual checklist
> **step 12** with somewhere for its findings to live. **No fix is attempted in this
> document** — it exists so the symptoms stop being a single line in a run log.

---

## Status summary — READ THIS BEFORE CITING THIS DOCUMENT

**This document is NOT resolved.** One of its three symptoms is; the other two are
open. The distinction matters because step 12's PASS on the 2026-08-08 manual run has
already been read once as closing the whole video path, and it does not.

| # | Symptom | Status as of 2026-08-08 |
|---|---|---|
| 1 | Preview freeze after a boundary edit | **VERIFIED RESOLVED** — manual step 12 PASS. Cause **not determined**; see the honesty note in §1. |
| 2 | `duration` ↔ `playbackSpeed` coupling on a video-segment drag | **OPEN — RULED A BUG** (owner, 2026-08-08). Deliberately NOT fixed in that run; scoped in §2, roadmapped at `roadmap-2026-08-07.md` § D12. Predates all recent work. |
| 3 | Drawer slip-trim bar overflows the viewport | **OPEN** — never manually exercised, by anyone, ever. See §3. **Fix this with or before symptom 2** — the coupling is currently what contains it for video segments. |

**What step 12 actually covers: symptom 1 only.** It drives a boundary drag between
two video segments and watches playback cross it. That gesture cannot reach symptom 3
(which needs the segment *drawer* opened on a segment with no `sourceDuration`), and it
cannot *score* symptom 2 (the speed coupling is silent and by-design-looking — a tester
watching for a freeze will not notice a clip re-timing unless told to look). A new
manual step exists for symptom 3 as of this revision; symptom 2 needs a ruling, not a
test.

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

**Status: VERIFIED RESOLVED**, manual checklist step 12, 2026-08-08, real Tauri/
WKWebView shell, owner-run. Both adjacent video segments now play normally across a
dragged boundary.

### The honest part: nothing was fixed on purpose, and the cause is not known

**No commit in WS2 touched either implicated module** [MEASURED]:

```
git log --oneline -- src/hooks/useWebCodecsPreview.ts
  → newest is 2015218 "WebGL2 Phase 5 cutover" — long predates WS2
git log --oneline -- src/services/videoDecoderPool.ts
  → newest is e1f6985 "stop caching rejected session promises" — likewise
```

So this is **resolved by incidental change, not by a fix**, and it is tagged that way
deliberately. The candidate explanations, none of them confirmed:

- The drag path now commits *different* timings than it did when the freeze was
  observed — K15b's yield-floor re-derivation, K16's pointer geometry, the step-10
  interrupted-drag discard, and the last-segment edge lock all changed what lands in
  the segment array after a drag. A decode session invalidated by a *wrong* commit
  would stop being invalidated once the commit became right.
- The original observation was made during a triage session in which several drag
  defects were live at once (steps 1, 2, 4, 10, 11 all failing). It may have been a
  downstream symptom of one of those rather than an independent defect.

**What this does NOT license.** The gap that made this hard to diagnose is still
exactly as wide as it was:

- [ASSERTED] **There is still no automated coverage of the decode pool's response to
  a segment-timing change.** Not thin — none. `videoDecoderPool.test.ts` covers the
  pool's own session/eviction/coverage logic against a mock decoder; nothing exercises
  "the segment array changed underneath a live session."
- [ASSERTED] The pool has a documented history of *mock-invisible* defects. `getFrameAt`
  awaiting a whole session's decode rather than enough coverage to answer the query
  presented as a freeze on the outgoing segment's last frame, and was only caught once
  a mock could separate `output` events from `flush()` settlement (`docs/history.md`,
  Phase 3). The keyframe-after-`flush()` constraint was invisible to the mock suite
  entirely while failing on real hardware. **A green `videoDecoderPool.test.ts` is weak
  evidence about this module, and a single manual PASS is not strong evidence either.**

**Therefore: treat this as resolved, but treat a recurrence as expected rather than
surprising**, and re-run step 12 after any change to the preview decode path. If it
recurs, the next step is unchanged from the original investigation: write a test that
changes segment timings under a live decode session, and if it cannot be written
against the current mock, *that is the finding* — extend the mock first, exactly as the
Phase 3 fix had to.

### Original report, retained

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

**Status: OPEN — RULED A BUG by the owner, 2026-08-08. NOT FIXED IN THIS RUN, by
instruction.** Scoped below and carried on the roadmap.

The earlier assessment in this document — "probably not a bug in the code… working as
designed" — is **superseded**. The mechanism was correctly identified; the judgement
that it was therefore acceptable was the owner's to make, and the owner has made the
opposite one. Option 3 of the three below (decouple) is the ruled direction.

### Scope of the fix — read before attempting it

This is deliberately not a small change, which is why it was not attempted in the
close-out run that received the ruling.

**Where it lives.** `resolveDragEdge` (`src/services/dragGeometry.ts`), the block gated
on `isVideo && srcDur > 0`. It does **two** things, and they are separable:

```
clipLen = (trimEnd ?? srcDur) - trimStart
(a) duration      = clamp(duration, clipLen/MAX_SPEED, clipLen/MIN_SPEED)   // 0.5x..2.0x window
(b) playbackSpeed = clamp(clipLen / duration, MIN_SPEED, MAX_SPEED)
```

(b) is the reported symptom. **(a) is the part that will surprise whoever fixes this:**
a video segment's drag range is currently bounded by its clip length and the speed
clamps, *not* by `MIN_SEGMENT_DURATION`. Remove (b) but keep (a) and the speed stops
changing while the drag mysteriously refuses to go past 2× the clip length. Remove both
and video segments become as freely draggable as images.

**The open product question the fix inherits.** If a video segment can be dragged
*longer than its own clip* with speed held at 1×, what plays in the tail? Freeze the
last frame, loop, or black? **There is no defined behaviour for this today**, in either
preview or either export path, because (a) has always made the state unreachable. This
question must be answered before the code change, not discovered after it.

**What it will break, and how to break it honestly.** `dragGeometry.test.ts` **PART 1**
pins `resolveDragEdge` byte-identical to the pre-K16 expression across a 30-case sweep
*including video fixtures*. A decoupling **will** fail that block — and that is PART 1
working, not PART 1 being in the way: its entire job is to make a change in what an
`edgeContentX` *means* impossible to land silently. Update it deliberately and visibly,
with the old values retained in comments as the record of what changed. **Do not weaken
or delete it.**

**The golden replay will not protect you here.** No corpus project exercises an
interactive drag, so a decoupling can change every future video drag's committed timing
with the replay still 3/3 byte-identical. This is the one change in the drag path with
no automated backstop.

**Interaction with symptom 3 — do not miss this.** The slip-trim bar overflow in §3 is
currently *contained* for video segments precisely **because** of the coupling: while
(a)+(b) are engaged, `duration × playbackSpeed === clipLen`, so `widthPct ≤ 100` holds
by construction. Decoupling removes that guarantee and **makes symptom 3 reachable for
video segments too**, not just for segments with no `sourceDuration`. §3's clamp should
therefore land *before or with* this fix, not after.

**Explicitly NOT closed by step 12's PASS.** Step 12 watches for a freeze. The speed
coupling is silent, produces a perfectly smooth playing clip, and looks like correct
behaviour to a tester who has not been told to look for it — so a step-12 PASS carries
no information about this symptom at all.

**Not introduced by any recent work** [MEASURED]. The coupling predates all K16/K17/WS2
work and is pinned as timing-neutral by `dragGeometry.test.ts` PART 1, which asserts
`resolveDragEdge` byte-identical to the pre-K16 commit expression across a 30-case
sweep including video fixtures. Had any recent change introduced or altered it, that
block would have failed.

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

**Assessment — SUPERSEDED, retained for the record.** [ASSUMED at the time] "Probably
not a bug in the code. It is plausibly a bug in the product: a user dragging a segment
to re-time the timeline may not expect the clip to also play faster, and nothing in the
UI signals that a video edge-drag means something different from an image edge-drag.
There is a speed badge, but it is not adjacent to the gesture."

The second half of that read correctly. The first half was a judgement the owner has
since overturned: **ruled a bug, 2026-08-08.**

**The ruling.** These were the three options put forward:

1. Keep as-is (speed coupling is the point — it is how you fit a clip to a slot).
2. Keep, but surface it during the drag (live speed readout on the dragged card).
3. Decouple, and require speed to be set explicitly.

**Owner ruled: it is a bug** — i.e. option 3, decouple. Not fixed in the run that
received the ruling, by explicit instruction: *scope it and roadmap it*. See "Scope of
the fix" at the top of this section for what that fix actually entails, and
`docs/roadmap-2026-08-07.md` § D12 for its place in the queue.

The original warning still stands and is now more relevant, not less: silently
decoupling would change committed timings for every video drag, and **the golden replay
would not catch it** — no corpus project exercises an interactive drag.

---

## Symptom 3 — drawer duration slider overflows the viewport

**Status: OPEN, and — the point worth recording — NEVER MANUALLY EXERCISED BY ANYONE.**

This is not "unreproduced." It is untested. Until this revision there was **no manual
step that opens the segment drawer at all**, so no run of the checklist could have
found, confirmed, or refuted it, and its absence from a run log meant nothing. It has
been sitting behind a step-12 entry that cannot reach it: step 12 is a boundary drag
plus playback, and never opens the drawer.

**Fixed as of this revision:** `docs/wkwebview-drag-checklist.md` **step 13** now
exercises the drawer's slip-trim bar directly, against a segment with no
`sourceDuration` and a duration past the hardcoded `?? 60` fallback — the exact
condition the mechanism below predicts will overflow. Symptom 3 is therefore
*scoreable* from the next manual run onward. It has not yet been scored.

A concrete, checkable mechanism is identified below.

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
