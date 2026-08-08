# Video-segment path — standing investigation

> Opened 2026-08-08 (WS2 manual-triage re-scope, Stage 4). Parks manual checklist
> **step 12** with somewhere for its findings to live. **No fix is attempted in this
> document** — it exists so the symptoms stop being a single line in a run log.

---

## Status summary — READ THIS BEFORE CITING THIS DOCUMENT

**This document is NOT resolved.** One of its three symptoms is; the other two are
open. The distinction matters because step 12's PASS on the 2026-08-08 manual run has
already been read once as closing the whole video path, and it does not.

| # | Symptom | Status as of 2026-08-09 |
|---|---|---|
| 1 | Preview freeze after a boundary edit | **VERIFIED RESOLVED** — manual step 12 PASS. Cause **not determined**; see the honesty note in §1. |
| 2 | `duration` ↔ `playbackSpeed` coupling on a video-segment drag | **OPEN — RULED A BUG** (owner, 2026-08-08). Deliberately NOT fixed in that run; scoped in §2, roadmapped at `roadmap-2026-08-07.md` § D12. Predates all recent work. |
| 3 | Drawer slip-trim bar overflows the viewport | **OPEN — CONFIRMED BY SCREENSHOT, previous fix did not resolve it.** A 2026-08-08 run (commit `a7044c1`) fixed one root cause (an unknown `sourceDuration` fabricating a 60s denominator) and left a second, independent root cause untouched (an out-of-range `trimStart` committed by the live Timeline left-edge drag, with no clamp anywhere on the commit path). The owner's screenshot is the second cause, not the first. See §3 — rewritten this revision with a live, reproduced repro. |

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

**Status: OPEN — CONFIRMED BY SCREENSHOT, previous fix did not resolve it.**

### What last run actually did, and why it didn't land

The 2026-08-08 run (commit `a7044c1`, "fix(drawer): clamp slip-bar width and stop
guessing an unknown source duration") was a real fix for a real, confirmed FAIL
(manual step 13) — but it closed exactly one of **two independent root causes** that
both produce the identical visual symptom in the identical control. It closed the
`sourceDuration ?? 60` fabrication (an *unknown* source duration guessed as 60s). It
did not touch, and could not have touched, an *out-of-range* `trimStart` committed by
the live Timeline drag path against a perfectly well-known `sourceDuration`. The
owner's screenshot is the second cause. **This is a fix that did not fix the reported
symptom — not "partially addressed," not "mostly resolved."** The control still
overflows, today, on the current `main`, via an ordinary left-edge drag on a video
segment.

### 1a — Which component actually overflows

**`BottomDrawer.tsx`'s Clip Trim bar — the same component and the same control last
run touched.** There is no fourth site and no misapplied-clamp confusion: the clamp
last run added (`computeSlipBarGeometry`'s `widthPct`/`leftPct`, each individually
bounded to `[0, 100]`) is applied to the right element. The gap is that **the right
edge of the bar is a third, separate quantity — `leftPct + widthPct` — computed
inline in `BottomDrawer.tsx` and never clamped at all**:

```tsx
// src/components/BottomDrawer.tsx — the active-zone fill div
style={{ left: `${leftPct}%`, width: `${widthPct}%` }}

// the right-edge drag handle, a few lines later
style={{ left: `calc(${leftPct + widthPct}% - 5px)`, width: '10px' }}
```

`leftPct` and `widthPct` are each clamped to `[0, 100]` by `computeSlipBarGeometry` —
that part of the 2026-08-08 fix works exactly as intended. But their **sum** is not
clamped anywhere, by either the fix or anything that predates it, and can reach up to
200%. When it exceeds 100%, the fill bar's right edge and the right-edge drag handle
both render past the track's right edge — and, at a large enough sum, past the
drawer's own right edge, into the surrounding page background. That is "running
off-screen, out of sight": not a bar that's merely too wide for its track, but a
drag handle that leaves the visible panel entirely.

[MEASURED] Confirmed live, in the real (non-mock) app, via the Vite dev server
(`kinetix-dev`, port 5180) with a hand-built project injected into
`localStorage`/IndexedDB to match the exact state a real drag can produce (see 1b/1c
below for why this state is reachable, not synthetic-only). One video segment:
`duration: 5`, `sourceDuration: 60` (**known**, not the `?? 60` case), `trimStart:
500`, `playbackSpeed: undefined`. Opening the drawer and reading the live DOM:

```
leftPct  = min(100, 500/60*100)      = 100      (clamped correctly)
widthPct = min(100, 5*1/60*100)      = 8.333    (clamped correctly)
sum      = leftPct + widthPct        = 108.333  (NOT clamped — this is the bug)

drawer's own right edge (getBoundingClientRect):  x = 902.25px
right-edge handle's rendered position:             x = 924.0–934.0px
```

The handle renders **21.75–31.75px outside the drawer panel itself**, not just outside
the trim track — past the drawer's own right border, into the black page background.
This is the exact symptom the owner described, reproduced against the shipped
control, not a mock.

[MEASURED] `git log -S "leftPct + widthPct" -- src/components/BottomDrawer.tsx`
shows this line was introduced by `7141e34` ("redesign BottomDrawer from ~38 controls
to 8"), long before the 2026-08-08 fix, and `git show a7044c1` confirms its diff never
touches this line — the fix commit's own patch clamps `widthPct`/`leftPct` inside
`slipBarGeometry.ts` and gates the whole bar on `hasKnownSourceDuration`, but does not
add or change anything about the handle's `left: calc(...)` expression. **The residual
bug was never addressed because it wasn't the bug that was being fixed** — it's a
different arithmetic gap in the same file, invisible to a fix aimed at the `?? 60`
fallback because it doesn't require an unknown `sourceDuration` at all.

[ASSERTED] No test exercises this. `slipBarGeometry.test.ts` asserts `widthPct` and
`leftPct` individually never exceed 100 — correctly, and those assertions still pass —
but nothing in the suite asserts `leftPct + widthPct <= 100`, and nothing renders
`BottomDrawer.tsx` itself to check the handle's actual DOM position. A green
`slipBarGeometry.test.ts` was accurate about the function it tests and silent about
the bug in the component that consumes it.

### 1b — The unreachable-UI finding: re-verified, and it HOLDS

Last run's most load-bearing claim — that `isAdjustingTrim`/`trimmingSegmentId`
(`App.tsx`, passed into `Timeline.tsx`) and `editingSegment` (`App.tsx`'s own inline
full-edit modal) are **never set to a live value anywhere in the shipped app** — was
re-checked from scratch this run, independently, because the owner's screenshot
initially looked like it could falsify it (a reachable overflow would seem to argue a
reachable trigger). It does not falsify it. Fresh greps against current `main`:

```
$ grep -rn "setTrimmingSegmentId(\|setIsAdjustingTrim(" src/ | grep -v test
src/App.tsx:1246:  const [isAdjustingTrim, setIsAdjustingTrim] = useState(false);
src/App.tsx:1492:  const [trimmingSegmentId, setTrimmingSegmentId] = useState<string | null>(null);
# — no other call site. Both stay at their initial false/null forever.

$ grep -n "editingSegment" src/App.tsx | grep -v "editingSegment\." | grep -v "{\.\.\.editingSegment"
src/App.tsx:1248:  const [editingSegment, setEditingSegment] = useState<VideoSegment | null>(null);
src/App.tsx:4817:        {editingSegment && (
# every setEditingSegment(...) call site either passes null, or spreads the
# ALREADY-non-null editingSegment — none ever opens the modal with a fresh segment.
```

**[MEASURED] Both dead-code claims are correct, unchanged from last run.** The
`Timeline.tsx` in-place trim-drag block and `App.tsx`'s inline full-edit modal
(including its own, separately-clamped `maxTrimStartSec`-bounded range sliders — the
*other* thing last run fixed) genuinely cannot open in the shipped app. The owner's
screenshot is not evidence against this; it is evidence of a *third*, independent
thing: `BottomDrawer.tsx`'s own Clip Trim bar, which is very much reachable, is the
sole live segment-editing surface, and has its own unclamped arithmetic that neither
of the two "?? 60" fixes touched. **All three findings are simultaneously true**: the
dead code is dead, the dead code's fix was harmless-but-moot, and the live control
still has a real, unfixed bug of a different shape.

### 1c — Was this UI ever wired, and where did it die?

[MEASURED] It was wired, and functional, at the initial commit. `git show
7c17c5f:src/App.tsx` (the "Initial commit: migrated from Google AI Studio") contains
both live triggers that are absent today:

```
1299:  onClick={() => setEditingSegment(s)}                    // "Expand to Full Edit Mode" button
2384:  setTrimmingSegmentId(s.id);                              // Timeline row click
2385:  setIsAdjustingTrim(true);
```

Both were lost the same day, three weeks before `BottomDrawer.tsx` existed, in two
back-to-back component-extraction refactors:

- **`1c8abf1`** ("refactor(components): extract SegmentEditorPanel", 2026-05-16
  20:11) — moves the full-edit modal into its own `SegmentEditorPanel.tsx` file. The
  diff for `src/App.tsx` shows the `setEditingSegment(s)` trigger button as a removed
  (`-`) line, with no replacement added anywhere in the same commit. `git log -S
  "setEditingSegment(s)"` confirms this is the last commit that ever added or removed
  a call passing a *live* segment — every commit since only touches the
  already-non-null spread form.
- **`8182cba`** ("refactor(components): extract Timeline", 2026-05-16 20:20, nine
  minutes later) — extracts `Timeline.tsx`. Same pattern: the diff shows
  `setTrimmingSegmentId(s.id)`/`setIsAdjustingTrim(true)` as removed lines, no
  replacement.

Both commit messages describe mechanical "extract this JSX into its own file" moves
with no mention of disabling or removing a trigger — this reads as **refactor
collateral damage, not a deliberate removal**. `SegmentEditorPanel.tsx` (the extracted
file) was itself later deleted as confirmed dead code by `209a8ef` ("refactor: remove
dead components, unreachable handlers, and wire frame-cache purge", 2026-06-30 —
"Delete SegmentEditorPanel.tsx and SettingsPanel.tsx (only reachable via `{false &&}`
block)"). `App.tsx`'s own separate inline `editingSegment && (...)` block (today's
~4817–5000) was never part of that extraction and was left behind, still compiling,
still gated on the same never-set state — which is why it's still in `App.tsx` today
and still dead.

Separately, and **not** a reaction to the modal's death — `4ed6a04` ("feat(ux):
unified drop zone + bottom drawer segment editor (task 9b-0)", 2026-06-04, three weeks
*after* the modal's trigger was already gone) deliberately introduces
`BottomDrawer.tsx` as the new, intended, sole segment-editing surface ("Adds
BottomDrawer component — segment editor slides up from bottom when a segment is
clicked on timeline or mapping list"). By the time this shipped, the old modal hadn't
been openable for three weeks; `BottomDrawer.tsx` wasn't built to replace a working
thing, it was built into a gap that already existed.

**This refines, not just confirms, last run's framing.** Last run fixed the dead
sites anyway and justified it by pointing at `CLAUDE.md`'s Target Structure section,
which names `SegmentEditorModal.tsx` as a planned future extraction target — reading
that as "this block is intended to stay/return, not vestigial cruft." The git history
says otherwise: `CLAUDE.md`'s Target Structure is a forward-looking decomposition
wishlist (a file that *should* exist after some future App.tsx breakup), not a claim
about *this specific* mid-2026 code path, which is a fully superseded design that
`BottomDrawer.tsx` already replaced in practice. The formula fix itself was harmless
to keep either way — it just wasn't preserving a future feature, it was polishing
code that has been unreachable since 2026-05-16 and whose job was already reassigned
to the file this document is actually about.

### Fix shape (not attempted this run, by instruction)

Two candidates, not mutually exclusive:

1. **Clamp the sum, in `BottomDrawer.tsx` or in `slipBarGeometry.ts`.** Cheapest,
   most local, matches the existing "hard backstop regardless of input" precedent
   `computeSlipBarGeometry` already sets for `widthPct`/`leftPct` individually — e.g.
   clamp the handle's `left` to `min(leftPct + widthPct, 100)`. This alone stops the
   handle (and the fill bar) from ever rendering outside the track, but leaves the
   underlying `trimStart` value itself nonsensical (500s into a 60s clip) — cosmetic,
   not a correctness fix.
2. **Bound `trimStart` at the point it's committed, in `resolveDragEdge`
   (`dragGeometry.ts`).** The real root cause: a left-edge (`'start'`) drag computes
   `trimStart = Math.max(0, originalTrimStart + rawDelta)` with no upper bound tied to
   `sourceDuration` or `trimEnd` at all — unlike `duration`, which the speed-coupling
   block clamps into `[clipLen/MAX_SPEED, clipLen/MIN_SPEED]` when it engages.
   `dragSession.ts`'s pointer-up handler (~line 552) passes `resolveDragEdge`'s
   `trimStart` straight into `commitDurationChange` → `computeDragCascade`
   (`dragCascade.ts:315`, `segs[draggedIdx] = { ...dragged, trimStart: finalTrimStart
   }`) with no clamp anywhere on that path. This is the fix that actually prevents an
   invalid `trimStart` from being committed in the first place, not just from being
   drawn wrong — but it touches the same live drag-timing surface `dragGeometry.test.ts`
   PART 1 pins byte-identical (see §2's own warning about this), so it needs the same
   "update the pin deliberately, don't weaken it" discipline symptom 2's fix will need,
   and arguably belongs in the same pass as that fix rather than a separate one.

Recorded, not ruled on: which of these (or both) to do is a product/scope decision,
not a technical one — (1) alone ships a UI patch over a data bug; (2) alone doesn't
need (1) since a correctly-bounded `trimStart` makes the sum-overflow unreachable by
construction (the same "coupling engaged ⇒ product ≤ srcDur" argument §2 already
makes for the `'end'`-edge case would then also hold for `'start'`-edge). Doing (2)
without (1) is the more complete fix; doing (1) without (2) is the faster one.

**Manual checklist step 13** (`docs/wkwebview-drag-checklist.md`) currently exercises
only the `?? 60` / unknown-`sourceDuration` case last run fixed. It does not exercise
a known-`sourceDuration` segment whose `trimStart` a left-edge drag has pushed out of
range, so it would PASS today despite this symptom being open — the checklist itself
needs a new step for this case before it can be trusted to catch a regression here.

---

## What is NOT in scope here

- The drag path's **gapless-timing invariant** (`dragSession.ts`, `dragCascade.ts`,
  segment-to-segment contiguity). Covered, and cleared — see above. **Correction,
  this revision:** `dragGeometry.ts`'s `resolveDragEdge` is NOT cleared as a whole —
  see §3's 1a/fix-shape. Its `trimStart` computation on a `'start'`-edge drag is
  implicated in symptom 3 as a live, reachable root cause. This was missed in the
  earlier "cleared" pass because that pass checked timing/contiguity (the gapless
  invariant), not `trimStart` bounds against `sourceDuration` — a different property
  of the same function that nothing was asserting.
- The export path. None of these symptoms have been observed in an export; both
  export paths derive their own frame timing and do not share the preview decode
  pool.

---

## Related

- `docs/wkwebview-drag-checklist.md` — step 12 (symptom 1), step 13 (symptom 3, only
  the `?? 60` case — see §3's fix-shape note on why it needs a second case).
- `project-state.md` — Deferred Known Bugs ("known video-path gap"); WS3 (Video
  Segments) as of the 2026-08-09 restructure.
- `docs/history.md` — the 2026-08-08 triage record (symptom 1 as "F6"), and the two
  prior mock-invisible decode-pool defects.
- `src/hooks/useWebCodecsPreview.ts`, `src/services/videoDecoderPool.ts` — symptom 1.
- `src/services/dragGeometry.ts` — symptom 2's speed coupling, AND (2026-08-09)
  symptom 3's actual root cause: `resolveDragEdge`'s unbounded `trimStart` on a
  `'start'`-edge drag.
- `src/services/dragSession.ts:552` — where `resolveDragEdge`'s `trimStart` is
  committed with no intervening clamp.
- `src/services/dragCascade.ts:315` — where the unclamped `trimStart` is written
  onto the segment array.
- `src/components/BottomDrawer.tsx` — symptom 3's slip bar; the `?? 60` case (fixed)
  and the `leftPct + widthPct` sum (not fixed) are both here.
- `src/services/slipBarGeometry.ts` — the 2026-08-08 fix; correctly clamps
  `widthPct`/`leftPct` individually, does not (and structurally cannot, from where
  it's called) clamp their sum.
