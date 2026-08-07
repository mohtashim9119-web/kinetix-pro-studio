# The Pointercancel Question — RULED: Discard

> Raised by WS2 task 2 (the Route 2 drag-path harness, 2026-08-07) as an observation, not a
> ruling — the harness found and pinned the CURRENT behavior of `dragSession.ts` without
> anyone having decided it was the CORRECT behavior. WS2 task 3 turned it into a decision.
>
> **OWNER RULING, 2026-08-08: discard.** Implemented the same task, with tests — see
> "What was implemented" at the bottom.

---

## The question

When a `pointercancel` fires mid-drag (the browser hands the gesture away — an OS-level
scroll/zoom takeover, a system interruption like an incoming call or notification-center
swipe, or the pointer being invalidated by a device change), `dragSession.ts` currently wires
`pointercancel` to the exact same `handleUp` function `pointerup` uses:

```ts
window.addEventListener('pointerup', handleUp);
// A cancelled pointer (OS gesture takeover, device switch) must not
// leave the drag armed forever; treat it as a release.
window.addEventListener('pointercancel', handleUp);
```

`handleUp` **commits** the drag (unless the move was negligible or a locked neighbour
blocked it, the same two escape hatches a normal release has). So today: **a `pointercancel`
commits the drag at whatever position the pointer last reported, exactly like a normal
release would.**

## Argued both ways

**The case for committing (current behavior).** A drag that has already moved — the user has
visibly dragged an edge, seen the neighbour absorb the change, and the gesture is then cut
off by something outside the app's control — arguably *should* land where it visibly was.
Discarding it would mean the user did real, visible work (dragged the edge, watched the
preview update) and then silently lost it because their OS decided to interrupt the pointer.
From the user's point of view, nothing about *their* intent changed; only the browser's
bookkeeping did. The comment already in the code makes exactly this argument: "must not leave
the drag armed forever; treat it as a release."

**The case for discarding.** `pointercancel`'s defining property is that it means the browser
took the gesture away *involuntarily* — this is not the user's own pointerup, it is the
platform saying "this gesture no longer means what you think it means." The pointer's last
reported position at that moment was never intentionally released there; it's wherever the
interruption happened to catch it. Committing on an event whose entire semantic content is
"this was not a real, user-completed action" changes project state — segment timings, which
this app treats as precise, audio-synced data — off the back of an event the user didn't
choose. A silent timing change with no visible confirmation step is a worse failure mode for
this app specifically than losing an in-progress edit: the user may not even notice the
commit happened, and a shifted segment boundary can desync from its own voiceover exactly the
class of bug `segments-invariant-ruling.md` treats as serious enough to gate exports on.

**Which is safer for this app.** Discarding is safer for *this* app's actual stakes.
Segment timing precision is the core data integrity property under active protection
elsewhere in this codebase — locked segments are refused rather than silently violated, a
gap in the timeline is a compile-time-checked forbidden state, export refuses to run over a
gap. A discarded drag costs the user a re-do of one gesture, which they will notice
immediately because the edge visibly springs back. A committed drag from an involuntary
interruption costs the user a silent, unreviewed timing change they may not notice until
playback or export — closer in kind to the exact failure class this project has spent the
most effort eliminating elsewhere.

## Did the extraction change this? (Stage 2b, task-1 neutrality check)

**No. Checked directly — behavior is byte-identical pre- and post-extraction.**

```
git show pre-dragsession-2026-08-07:src/App.tsx | sed -n '4195,4204p'
```

```ts
                    if (!succeeded) setProject(prev => ({ ...prev, segments: originalSegments }));
                  };
                  isResizingRef.current = true;
                  window.addEventListener('pointermove', handleMove);
                  window.addEventListener('pointerup', handleUp);
                  // A cancelled pointer (OS gesture takeover, device switch) must not
                  // leave the drag armed forever; treat it as a release.
                  window.addEventListener('pointercancel', handleUp);
```

Same wiring, same comment, word for word, as `dragSession.ts`'s current version. **WS2 task
1's neutrality claim holds** — the extraction moved this behavior verbatim; it did not
introduce, change, or newly discover a behavior that used to differ. What WS2 task 2 did was
*observe* pre-existing behavior for the first time via a harness capable of exercising it —
nobody had looked at what `pointercancel` actually did before that task, extraction or not.

## Recommendation

**Discard on `pointercancel`, not commit.** The involuntary nature of the event is the whole
point of its existence as a distinct event from `pointerup`, and a silent, unreviewed
segment-timing change is a worse outcome for this app than losing one in-progress gesture the
user can simply redo (and will immediately see was discarded, since the edge visibly
reverts). This does trade away the "don't leave the drag armed forever" concern the existing
comment raises — but that concern is about *cleanup* (listeners, `resizingId`, the `resizing`
body class), not about *committing*, and a discard path can and should still perform that
same cleanup; it just calls `revertSegments` instead of running the commit branch.

## What was implemented (2026-08-08, same task as the ruling)

`src/services/dragSession.ts`: a new `wasCancelled` flag, set only by a dedicated
`handleCancel` wrapper (`pointercancel` now listens through `handleCancel`, not `handleUp`
directly — `handleUp` alone has no way to tell which event invoked it). Inside `handleUp`,
right after the existing `!hasMoved` early return, a new branch: `if (wasCancelled) {
deps.revertSegments(originalSegments); return; }` — checked *before* the negligible-drag and
commit logic, so a cancelled gesture never reaches either, however far it had moved. The
pre-existing cleanup (clearing `resizingId`/`resizingType`, removing the `resizing` body
class, tearing down all three window listeners) is unconditional and untouched — it still
runs identically on commit, revert, or cancel, so the original comment's concern ("must not
leave the drag armed forever") still holds.

`src/services/dragSessionHarness.ts`: a new `DragOutcomeKind` member,
`'reverted-cancelled'`, distinct from the pre-existing `'reverted-negligible'` — both resolve
through `revertSegments` with `commitAttempted` never set, so a new `cancelledThisGesture`
flag (set by `cancel()`, reset by `grab()`) is what lets `resolveOutcome()` tell them apart.

`src/services/dragSessionHarness.test.ts`: the existing "pointercancel mid-gesture" test
(previously asserting `'committed'`) now asserts `'reverted-cancelled'`, the segment array
reverting to its exact pre-drag spans, and — new — that `resizingIdValue`/
`bodyHasResizingClass` still clear normally afterward, proving the discard path performs the
same cleanup the commit path always did. The "pointercancel with no movement" test was
already correct under either ruling (no revert is ever called when `!hasMoved`, so it stays a
`'no-op-not-moved'`) and needed no change.

Full suite after the change: 1470 tests (1469 passing, 1 pre-existing deliberately-skipped),
`tsc --noEmit` clean — no new tests added, two existing assertions inverted/extended in
place, matching the size of the behavior change.

## Status

**RULED — discard, implemented 2026-08-08.** No longer an open question.
