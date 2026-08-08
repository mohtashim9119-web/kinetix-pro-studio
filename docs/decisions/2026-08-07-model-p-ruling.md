# The Model P Ruling — Official and Locked

> **OWNER RULING, 2026-08-07.** Recorded here as the canonical, citable decision record.
> Full analysis and the reasoning that led here: `docs/decisions/segments-invariant-ruling.md`
> (updated the same day to point back at this doc). Context on the parked in-flight
> implementation attempt and why it was never merged: `docs/decisions/2026-08-07-model-p-revert.md`.

---

## The ruling

**Model P (gapless partition) is OFFICIAL and LOCKED. Model S (independent slots) is
REJECTED.**

## The invariant, stated precisely

For `project.segments`, an ordered array indexed `0..n-1`:

```
startTime[0] === 0
startTime[i] + duration[i] === startTime[i+1]     for every i in [0, n-2]
startTime[n-1] + duration[n-1] === audioDuration
```

`startTime` is a **derived cache** of the running prefix-sum of durations, never an
independent fact that can drift from it. Overlaps were already illegal under both
candidate models and remain illegal. What this ruling settles is narrower and was
previously undecided: **a gap — `startTime[i] + duration[i] < startTime[i+1]` — is now
also illegal**, for every adjacent pair, unconditionally.

## What it forbids

- Any transformation of `segments` that leaves `startTime[i] + duration[i] < startTime[i+1]`
  for any `i`, even transiently as a committed (non-preview) state.
- A locked segment whose position leaves a shortfall that nothing absorbs (see the
  lock-shortfall rule below — this is now a **refusal**, not a silent gap).
- Treating `startTime` as independently authoritative anywhere it is *written* — it may
  still be *read* directly (most call sites do, and that's fine) as long as nothing
  ever writes a `startTime` that isn't the prefix sum of everything before it.

## The lock-shortfall rule (§4.1(a), now confirmed)

When a locked segment's hard-wall position would leave an unsatisfiable shortfall against
an adjacent locked segment (lock A ends before lock B starts, with no unlocked segment
between them to absorb the gap), **the second lock is refused at toggle time**, with a
clear message naming the conflict. This was `segments-invariant-ruling.md` §4.1's
resolution (a), the only one of the three offered resolutions consistent with both Model P
and owner decision 9 ("a locked segment is an immovable anchor"). Resolutions (b) (let the
earlier lock's slot grow — reopens the pre-K14 growth exemption K14 withdrew on purpose)
and (c) (permit a gap between two locks as a first-class exception — Model S through a side
door) are both rejected.

In the ordinary, satisfiable case — one lock, or two locks with room between them — the
segment adjacent to the shortfall absorbs it as leading/trailing silence. This is not a new
mechanism; it is the same operation `headExtendFirstSegment` already performs for segment 1
against the timeline start, and the same operation Option A (owner decision 8) performs for
unscripted-heading audio in the other direction.

## Which components already assume Model P

Per `segments-invariant-ruling.md` §1.1's inventory, **9 of 11 named components already
implement or assume Model P** — this ruling formalizes what most of the codebase already
does, not a departure from it:

| # | Component | Model P status |
|---|---|---|
| 1 | `recomputeStartTimes` (legacy global re-flow) | Assumes P — deleting gaps was its stated purpose |
| 2 | `applyAnchorBasedTiming`, locked branch, **pre-K14** | Assumed P (growth exemption existed to keep output contiguous) |
| 3 | `snapCoveredBoundaries` (`src/services/snapBoundaries.ts`) | Assumes P — carries an explicit appended contiguity fix |
| 4 | `headExtendFirstSegment` (`src/services/syncEngine.ts`) | Assumes P — holds the segment's END fixed so nothing ripples |
| 5 | Timeline flexbox layout (pre-2026-07-31) | Assumed P structurally — a gap was unrepresentable |
| 6 | **Both export paths** — `src/services/exportPipeline.ts` and `src/services/webcodecsExport/exportPipelineWebCodecs.ts` | Assume P as a hard requirement — position a segment by prefix-sum of `duration`, never consult `startTime` to place output. Cannot represent a gap at all; see §1.3 of the ruling doc for the concrete editor/export desync and heading-drift mechanism this produces if a gap ever reaches export. |
| 7 | Timeline absolute positioning (2026-07-31 redesign) | Neutral reader — renders each card at its own `startTime`; exposes a violation, prevents none |
| 9 | Preview `currentSegment` lookup (playback) | S-shaped *read* only (derives active segment from `currentTime` against `startTime`) — becomes provably correct once P holds everywhere `startTime` is written |

Named 9 components (not 11) above because #8 (live drag preview) and #10/#11 (K14's lock
hard wall, K15a's `restackWindow`) are exactly the components this ruling requires rework
of — see the compliance backlog below, not this "already compliant" list.

## What must be reworked to comply

**K14's lock hard-wall semantics is the known, named case.** `applyAnchorBasedTiming`'s
locked branch (`src/services/syncEngine.ts`, the `if (seg.locked) { ...; continue; }`
block) currently pins a locked segment's `startTime`/`duration` unconditionally and never
makes it absorb or be absorbed by a neighbour's shortfall — that is Model S's hard-wall
behaviour, adopted silently when K14 withdrew the pre-K14 growth exemption to stop a lock
from being pushed around by neighbours. Under Model P this must change to:

1. On an ordinary (satisfiable) shortfall, the adjacent unlocked segment absorbs the gap
   (extends to meet the lock), per the rule above.
2. On an unsatisfiable shortfall (locked segment on both sides of the gap), the second
   lock-toggle is refused outright rather than allowed to create a gap.

K15a's `restackWindow` locality (`src/services/dragCascade.ts`) is *not* broken by this
ruling — per `segments-invariant-ruling.md` §2's own table, "when the total is conserved,
`restackWindow` and a global `recomputeStartTimes` produce identical results," so K15a's
locality survives **as an optimisation**; only its justification changes, from "preserves a
legitimate gap" (Model S framing, no longer valid) to "produces the same contiguous result
as a full re-flow, cheaper." It remains correct only because nothing upstream is allowed to
hand it a pre-existing gap to preserve — which is exactly what closing K14's compliance gap
guarantees.

K15b (word-onset yield floor) and K16 (drag pointer geometry) require no change — both are
already orthogonal to the gap question (§6.3 of the ruling doc).

The compliance backlog — every site currently capable of creating or silently propagating a
gap — is enumerated with file:line in `project-state.md`'s Open Decisions section (moved
there from this ruling doc so it has one home); see that list before starting any of this
rework.

## Consequences

- `docs/decisions/segments-invariant-ruling.md`'s status is now RULED, not AWAITING OWNER RULING (§0
  updated in place, full analysis retained).
- `docs/drag-path-testability-assessment.md`'s Route 2 recommendation is now unconditionally
  approved, sequenced at step 5 of the P migration (`segments-invariant-ruling.md` §6.1),
  alongside — not before — the K14 rework above, per that document's own sequencing
  argument (the harness's central assertion needs to encode Model P's shrink-side behaviour,
  which was only just settled).
- The park commit's (`210855d`, `model-p-editor-work`) in-flight rework —
  `timelinePartition.ts`'s gapless-partition enforcer, the export gapless-timeline guard,
  the `snapBoundaries.ts` 50/50 silence-split rule — is now confirmed as work in the
  *correct* direction, but per `docs/decisions/2026-08-07-model-p-revert.md`'s own
  recommendation, should be **re-derived against current `main`** (which already includes
  K17) rather than cherry-picked from a diff that predates it and was never reviewed.
- No `src/` change lands as part of this ruling. This document records the decision only;
  implementation is tracked separately (see `project-state.md`'s Active Tasks and the
  compliance backlog in Open Decisions).
