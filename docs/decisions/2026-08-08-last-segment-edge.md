# The Last Segment's Right Edge — Official and Locked

> **OWNER RULING, 2026-08-08.** Semantic option **(i)**: the last segment's right edge is
> **not draggable, in either direction**. Its left edge remains fully draggable.
>
> Recorded here as the canonical, citable decision record. Cross-links:
> `docs/decisions/2026-08-07-model-p-ruling.md` (the gapless-partition ruling this
> completes), `docs/decisions/segments-invariant-ruling.md` (the analysis behind it), and
> `docs/checklists/wkwebview-drag-checklist.md` step 4 (the manual test that failed twice and
> forced the question).

---

## 0. The question being decided

> **What does dragging the LAST segment's right edge mean?**

Every other segment edge has an unambiguous meaning: it is a *boundary* between two
segments, and moving it trades seconds between them. The last segment's right edge is
not a boundary. It has no neighbour on the far side. So a drag there is not a trade —
it is an assertion about how long the whole timeline is, which is a different kind of
statement and had never been ruled on.

## 1. The three candidate semantics

> **Provenance note, stated plainly:** the original Stage 2a checkpoint that enumerated
> these was a working-session artifact and was never committed to this repository. The
> three below are reconstructed from the ruling's own framing and from the shape of the
> code paths involved (`dragCascade.ts`'s `hi < segs.length - 1` scoping comment names
> exactly this gap). They are faithful to the decision that was made; they are not a
> verbatim quotation of a recorded source, and this document does not claim to be one.

**(i) The edge is fixed. — CHOSEN.**
The last segment's right edge is not grabbable. Total timeline duration becomes
immutable via drag. `segments[N-1].end === mediaDuration` is promoted from a
post-condition that Apply Sync happens to establish, into a hard invariant that no
drag gesture may break.

**(ii) The edge is draggable and total length follows it.**
Growing lengthens the timeline past the media; shrinking ends it early. The timeline
becomes an independent length that can disagree with the voiceover.

**(iii) The edge is draggable but clamped at `mediaDuration`.**
Shrink allowed, grow refused. The timeline may end early but never late.

## 2. Why (i), and why now

The immediate trigger is that **the render fix failed manual retest twice.** Checklist
step 4 reports cards drifting out of alignment with the waveform lane on a
last-segment right-edge drag. The first attempt at a fix was `Timeline.tsx`'s zoom
basis freeze (`zoomBasisDuration`, F2, 2026-08-08), which stops the fit-to-width zoom
term rebasing mid-drag. It is correct as far as it goes — `dragTriage.test.ts`'s F2
block measures the 300px → 259.0909px rescale it prevents — and step 4 still failed
after it. The second attempt failed the same way.

That is the practical argument. The structural one is stronger:

- **(ii) contradicts Model P's tail clause outright.** The ruling states
  `startTime[n-1] + duration[n-1] === audioDuration`. Option (ii) makes that clause
  violable by an ordinary mouse gesture, which would leave the invariant enforced
  nowhere and asserted everywhere.
- **(ii) and (iii) both require the whole timeline to re-lay-out during a drag,** because
  the fit-to-width zoom term reads total duration. That re-layout is precisely the
  visual defect step 4 keeps reporting. Fixing the symptom while keeping the operation
  that causes it means fighting the same class of bug indefinitely.
- **(iii) buys very little for its complexity.** It still moves total duration, so it
  still re-lays-out; it merely bounds the direction. It also invents a new state — a
  timeline that ends before its own audio — with no defined playback, export, or
  re-sync behaviour.
- **The audio is the authority on total length.** That is already true everywhere else
  in this pipeline: `retileCoveredSegments` extends the last survivor to `audioDuration`,
  `applyAnchorBasedTiming` PASS 3 does the same, and `headExtendFirstSegment` performs
  the mirror operation at the head. Option (i) simply stops the editor from contradicting
  that, rather than adding a rule.

## 3. What this makes true

**`segments[N-1].end === mediaDuration` is a hard invariant with respect to drag.**

The generalised statement — and the one that is actually tested — is stronger and
simpler:

> **No drag gesture may change total timeline duration.**

That covers the reported instance and two further entry points to the same defect that
reading (not testing) found, both of which reach it through `computeDragCascade`'s
giveback being scoped `hi < segs.length - 1`:

- a **right-edge drag on segment N-2** that overshoots segment N-1's
  `MIN_SEGMENT_DURATION` floor — the unabsorbed remainder is kept, and total duration
  grows;
- a **left-edge drag on segment 0 in a single-segment timeline**, where the touched
  window is also the last index.

Locking only the affordance would have left both of those live. This is why the ruling
is implemented as a property over all drags rather than as a special case for one edge.

## 4. What this does NOT change

Total timeline duration remains fully mutable by every non-drag path. These were
enumerated before any code changed and are deliberately untouched:

| Path | Still changes total duration |
|---|---|
| Apply Sync commit (`App.tsx`, via `applyAnchorBasedTiming` / `snapCoveredBoundaries` / `headExtendFirstSegment`) | Yes — it *sets* it, to `audioDuration` |
| `retileCoveredSegments` (Apply Sync fallback) | Yes |
| Playback-speed slider (`handlePlaybackSpeedChange`) | Yes, on the last segment |
| Segment edit modal's numeric Duration field | Yes — writes the segment object directly, bypassing the cascade |
| Project hydration / project switch | Yes |
| New Project, DEV scale fixture | Yes |

The playback-speed slider is the one that constrains the implementation: it reaches the
**same** `computeDragCascade` the drag path does, via `applyDurationChange`. So the
conservation rule cannot be a change to the cascade's default behaviour — it is an
explicit, drag-only opt-in (`DragCascadeOptions.conserveTotalDuration`), and every
pre-existing caller keeps byte-identical behaviour by omitting it.

## 5. Consequences the owner accepts

1. **A user who wants a longer or shorter timeline must change the voiceover, re-run
   Apply Sync, or use the segment editor's numeric duration field.** There is no drag
   gesture for it any more.
2. **The last segment's right edge shows no resize affordance at all** — no hit target,
   no `col-resize` cursor, no hover highlight. It is visually apparent that it is fixed,
   which is the point: a disabled-looking handle that silently does nothing is worse
   than no handle.
3. **The last segment's LEFT edge is unaffected** and remains a normal boundary drag
   against segment N-2.
