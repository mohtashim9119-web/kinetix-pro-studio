# The `segments` Invariant — Ruling Document

> **Provenance:** originally authored on commit `210855d` (`model-p-editor-work`'s "park"
> commit), which was never merged to `main`. Brought onto `main` 2026-08-07 as a docs-only
> change — content unmodified, byte-identical to the source, no code landed alongside it.
> See `docs/decisions/2026-08-07-model-p-revert.md` for the full context.

> **Status: AWAITING OWNER RULING. Design only — no code written, no commit made.**
> Written 2026-08-07, at HEAD `0e2ac5b` (K16), working tree clean.
>
> This document exists because the question below has never been decided, and
> eleven components in this codebase answer it differently. Every one of K14,
> K15a, K15b and K16 is downstream of it. Reverting them does not resolve it.

---

## 0. The question being decided

> **Is `project.segments` a GAPLESS PARTITION of the timeline — `startTime[0] === 0`
> and `startTime[i] + duration[i] === startTime[i+1]` for every `i` — or is it an
> ORDERED LIST OF INDEPENDENTLY POSITIONED SLOTS, in which a gap between two
> segments is legal and meaningful?**

Call them **Model P** (partition) and **Model S** (slots). Overlaps are illegal
under both; only gaps are in question.

This is not a style preference. The two models make different things impossible,
require different enforcement, and — as §1.3 shows — one of them is already
being violated in shipping code in a way that can corrupt an export.

---

## 1. Why this needs a ruling

### 1.1 Eleven components, five silent flips

| # | Component | Its implicit answer | When |
|---|---|---|---|
| 1 | `recomputeStartTimes` (original) | **P, and I enforce it** — rebuilds every `startTime` from a running duration sum from 0. Deleting gaps is its purpose, not a bug. | original |
| 2 | `applyAnchorBasedTiming`, locked branch, pre-K14 | **P** — `duration = max(preserved, nextAnchor - startTime)`. The growth exemption exists *precisely* to keep output contiguous. | pre-K14 |
| 3 | `snapCoveredBoundaries` | **P** — carries an explicit appended contiguity fix. | 2026-07-31 |
| 4 | `headExtendFirstSegment` | **P** — deliberately holds the segment's END fixed "so this can never ripple." | 2026-07-31 |
| 5 | Timeline flexbox layout | **P, structurally** — a card's left edge *was* the sum of predecessors' widths. Violations were unrepresentable. | pre-2026-07-31 |
| 6 | **Export pipeline (both paths)** | **P, as a hard requirement** — see §1.3. Cannot represent a gap at all. | original |
| 7 | Timeline absolute positioning | **Neutral** — renders each card at its own `startTime`. Exposes violations; prevents none. | 2026-07-31 |
| 8 | Live drag preview (`f4da926`) | **Violates both, transiently** — moves one card, freezes neighbours, for the duration of the gesture. | 2026-07 |
| 9 | Preview `currentSegment` lookup | **S-shaped read** — derives the active segment from `currentTime` against `startTime`, never a prefix sum. | original |
| 10 | `applyAnchorBasedTiming`, locked branch, post-K14 | **S** — a lock is a hard wall and may leave a real gap. | K14 |
| 11 | `restackWindow` (K15a) | **S, emphatically** — restacks only the touched window *so that a gap outside it survives*. The exact opposite of #1. | K15a |

Read the "answer" column top to bottom. It flips five times. **Not one flip was
recorded as a decision** — each was a local consequence of a local fix.

### 1.2 Consequence: K15a is not really a cascade bug

Under #1's own frame, the global re-flow is correct behaviour. What made it
"catastrophic" was #10 changing the answer underneath it. K15a fixed the writer
that was still obeying the old contract, rather than the change that broke the
contract. That is why the fix felt disproportionate to the defect.

### 1.3 The finding that was not in the original audit — export cannot represent a gap

I verified this directly in the source rather than inferring it.

**Export determines a segment's frame count from `duration` alone:**
- `segmentEncoder.ts:528` — `totalFrames = max(1, round(segment.duration * fps))`
- `exportPipeline.ts:139` — `round((segment.duration - startTimeOffset + trailingExtension) * fps)`
  (`startTimeOffset` here is a *transition-window* offset, not the segment's timeline position)

**Segments are then concatenated back to back.** So a segment's position in the
exported video is `Σ durations[0..i-1]` — a prefix sum. **`segment.startTime` is
never consulted to position anything in the output.**

Two consequences follow, and both are live at HEAD:

1. **Editor/export divergence.** The editor preview locates the playhead's
   segment via `startTime` (#9). The export locates it via prefix sum (#6). These
   agree if and only if Model P holds. With a gap present, every segment after
   the gap appears **earlier in the exported video than in the editor**, by the
   gap's width, while the voiceover — muxed whole — does not move. That is
   straightforward audio/video desync. K15a's own measured gap was **3.000s**.

2. **Headings drift within the export itself.** `segmentEncoder.ts` passes
   `absoluteTime: segment.startTime + timeInSegment` into the renderer, and
   `frameRenderer.ts:459` uses it to select the active heading
   (`getActiveHeadingAt`). So inside a single export, *video position* uses the
   prefix sum while *heading selection* uses `startTime`. With a gap, headings
   land on the wrong frames.

**This is the sharpest argument in the document.** K14 made gaps producible;
K15a made them persist. Neither considered export. The result is a shipping path
where a locked segment can silently desync an exported video — a defect nobody
has reported yet only because locks are rare and K13 clears them on every Apply
Sync.

> I have **not** reproduced this end-to-end with a real export. It is derived
> from the source, and stated at that strength. Confirming it would take one
> locked segment positioned to leave a gap, then an export — worth doing before
> ruling, if you want it at ear-verified strength.

---

## 2. Model P — Gapless Partition

**Statement.** `startTime[0] === 0`; `startTime[i] + duration[i] === startTime[i+1]`
for all `i`; `Σ duration === audioDuration`. `startTime` is a **derived cache** of
the prefix sum, never an independent fact.

### What it makes true by construction
- Editor preview and export agree, always and trivially — both are prefix sums.
- Heading `absoluteTime` selection is correct in export by definition.
- `Σ duration === timeline length === audio length`. Key Invariant (b) holds for free.
- The question "what is on screen during a gap?" cannot be asked.
- The entire K14 stale-anchor defect family becomes **unrepresentable**: if
  `startTime` is derived, it cannot go stale relative to `duration`.

### What it makes impossible
- Gaps. K15a is unreachable by construction, not by patch.
- **A lock that is simultaneously (a) an immovable anchor and (b) free of side
  effects on its neighbours.** Under P these cannot both hold. This is P's real
  cost and it is discussed at §4.1.

### What enforces it, and where
One chokepoint. Exactly one function converts `(durations, constraints)` into a
positioned array, and it is the **only** writer of `startTime` in the codebase.
`recomputeStartTimes` is that function, promoted from drag-local helper to
canonical constructor.

Strongest available form: remove `startTime` from the persisted `VideoSegment`
shape entirely and derive it on read. That makes violation a type error rather
than a convention. It is also the largest migration; it is not required for the
ruling and can be a later step.

Cheap immediate form: a dev-only assertion run after every array write, which
fires on the first violation. This alone would have caught K14's gap the day it
shipped.

### Effect on the four named components
| Component | Under P |
|---|---|
| `recomputeStartTimes` | **Promoted.** Becomes the single enforcement point. Its global re-flow is *correct*, not catastrophic. |
| `applyAnchorBasedTiming` | Must always emit contiguous output. Needs an explicit rule for the lock-shortfall case (§4.1). |
| Drag cascade | Must conserve the touched window's total duration — **K15b's give-back already does this.** Note: *when the total is conserved, `restackWindow` and a global `recomputeStartTimes` produce identical results.* So K15a's locality can stay as an optimisation; only its justification changes. |
| Live preview | Must move every segment the cascade touches, every frame. Frozen neighbour is an **unambiguous bug**. |

### What breaks on adoption
- K14's hard-wall lock, in the shortfall case, must gain a filling rule.
- Two adjacent locks with a gap between them become **unsatisfiable** (§4.1).
- Nothing else. Components 1–6 already assume P.

---

## 3. Model S — Independent Slots

**Statement.** Segments are ordered and non-overlapping. `startTime` is
authoritative and independent of neighbours' durations. A gap is legal and means
"no segment is on screen here."

### What it makes true by construction
- Decision 9 is honoured **literally**: a locked segment is immovable in both
  directions with zero side effects on any neighbour.
- Every segment's slot can match its own audio exactly, regardless of what its
  neighbours do. No segment is ever forced to hold silence that belongs to a
  neighbour's shortfall.
- Component #9's `startTime`-based preview lookup becomes correct by definition.
- A drag that shrinks a segment can simply leave a gap — no forced cascade.

### What it makes impossible
- Concatenation-based export, **as currently built**. Export must become
  timeline-positioned.
- The assumption `Σ duration === timeline length`, which several call sites make.

### What enforces it, and where
A **validator**, not a constructor: assert ordering and non-overlap; permit
gaps. Cheaper to write than P's chokepoint — but the enforcement burden moves
downstream, into export.

### Effect on the four named components
| Component | Under S |
|---|---|
| `recomputeStartTimes` | **Must be deleted.** It is unconditionally wrong under S — it destroys the very thing S declares meaningful. |
| `applyAnchorBasedTiming` | Largely correct already. Each segment takes its anchor; K14's hard wall is S's natural expression. |
| Drag cascade | K15a's locality is **correct and principled.** K15b's give-back becomes optional — a refused shrink could legitimately open a gap instead. |
| Live preview | Moving only the dragged segment is **defensible on the shrink side** (an opening gap is honest). Overlap on the grow side remains a bug — S forbids overlaps too. |

### What breaks on adoption
- **Both export paths** — legacy `exportPipeline.ts` and
  `webcodecsExport/exportPipelineWebCodecs.ts` — need gap semantics: what is
  rendered, for how many frames, in a gap. This is the highest-verified,
  highest-risk code in the project (frame-count guards, annexb concat, the
  macOS EMFILE fix).
- `absoluteTime`/heading selection needs re-derivation against real output
  position.
- Every site assuming `Σ duration === timeline length` must be audited.

---

## 4. The four specific questions

### 4.1 Decision 9's immovable lock, under Model P: what fills the shortfall?

**Answer: the following segment starts early, at the lock's actual end, and
absorbs the space.** Its own first word does not move — it simply acquires
leading silence.

This is not an invention; it is the rule this codebase already applies twice:
- `headExtendFirstSegment` gives segment 1 the entire lead-in silence.
- **Decision 8 / Option A** gives unscripted-heading audio to the preceding
  segment, which is the same operation in the other direction.

So P's fill rule is: **the neighbour adjacent to the shortfall absorbs it, and
absorbing silence is normal in this pipeline.**

**When neighbours cannot stretch — stated plainly, because this is P's genuine
weakness.** The rule fails when the segment on the other side of the gap is
*also* locked. Lock A ends at 10.0, lock B starts at 15.0, and both are declared
immovable. Under P that array is **unsatisfiable**. Three resolutions, none free:

| Resolution | Cost |
|---|---|
| (a) **Refuse the second lock** at toggle time, with a clear message naming the conflict. | Locks become conditionally available. Honest and cheap, but the user can be told "no." |
| (b) **Let the earlier lock's slot grow** to meet the later one. | Directly re-opens the pre-K14 growth exemption that K14 withdrew on purpose. Contradicts decision 9. |
| (c) **Permit a gap between two locks as an explicit, first-class exception.** | This is Model S admitted through a side door. If you take (c), take S honestly instead. |

**My reading: (a) is the only resolution consistent with both P and decision 9.**
It is also the only one that fails loudly rather than silently. But it does mean
that under P, *a lock is not unconditionally grantable* — and you should rule
knowing that.

### 4.2 Is Option A consistent with both models, or does it presuppose one?

**It is implementable under both, but it is written in P's vocabulary and its
stated guarantees only hold under P.**

Decision 8's own words: *"the preceding segment **absorbs** the full duration…
**Total timeline length unchanged.** Segment count unchanged."*

- Under **P**, that is the complete set of available answers: the space must go
  to *someone*, and A says who. "Total length unchanged" is automatic.
- Under **S**, A is still expressible — extend the preceding segment — but it is
  now one of *three* options, because S makes available a third that P forbids:
  **leave the unscripted audio as a genuine gap and render nothing (or a held
  frame).** Step V enumerated five options and none of them was "leave it
  empty," because under P that is not a thing you can do.

So: **Option A does not force the ruling, and it survives either way.** But the
framing that produced it assumed P. If you rule S, decision 8 should be
re-examined — not reversed, but re-asked with the third option on the table.

### 4.3 Does absolute positioning force the answer?

**No. It is independent, and this is worth being precise about.**

The 2026-07-31 renderer change **removed a constraint; it did not express a
preference.** Flexbox could *only* render P — a violation was unrepresentable.
Absolute positioning can render either faithfully: adjacent boxes under P,
visible holes under S.

What it did do is **surface the question**: the frozen-neighbour drag preview and
K14's gaps were both invisible before it and visible after. It is the reason you
are seeing the problem, not the reason the problem exists.

One caveat in the other direction: absolute positioning made S *cheap to render*,
which may be why K14/K15a drifted toward S without anyone noticing they had. A
constraint that used to fail loudly now fails quietly.

### 4.4 Correct live-drag preview per model — and is frozen-neighbour overlap a bug?

**The most useful finding in this section: frozen-neighbour overlap is a bug
under BOTH models.** Overlap is illegal in P (violates contiguity) and illegal in
S (S permits gaps, not overlaps). So **fixing the drag preview does not depend on
this ruling** and can proceed independently.

| | Model P | Model S |
|---|---|---|
| **Grow side** (dragged segment expands into neighbour) | Neighbour must visibly shrink/shift in the same frame. Run the real cascade per frame and write geometry for the whole touched window. | Same — the neighbour must move or the drag must stop at its edge. Overlap is never acceptable. |
| **Shrink side** (dragged segment contracts) | Neighbour must visibly grow to close the space, same frame. | Neighbour *may* stay put and a gap opens — showing that gap live is **honest and correct**. |
| **Frozen neighbour** | **Bug**, both directions. | **Bug on grow. Correct on shrink.** |
| **Implementation** | Per-frame `computeDragCascade` over the touched window, writing `left`/`width` for every touched segment. This is exactly what the abandoned K17 attempt was building. | Per-frame cascade on grow only; shrink writes the dragged segment alone. |

Note that the uncommitted K17 attempt — the one that broke the tree — was
building P's version. Whoever wrote it had implicitly ruled P.

---

## 5. Recommendation

> ### ⭐ RECOMMENDATION: **Model P — gapless partition.**
> Marked clearly as a recommendation. The counter-argument is at §5.2 and it is
> real.

### 5.1 The argument for P

1. **Export already is P, and cannot be anything else without a rewrite** (§1.3).
   Model S requires touching both export paths — the most heavily verified,
   highest-consequence code in the project. Model P requires touching none of it.
2. **The product has no meaning for a gap.** This is a slideshow over one
   continuous voiceover. There is no editorial concept of "nothing on screen for
   3 seconds"; the audio never stops. S buys expressive power the product does
   not use.
3. **6 of the 11 components already implement P**, several with explicit,
   deliberate machinery to maintain it (`snapCoveredBoundaries`'s appended
   contiguity fix; `headExtendFirstSegment`'s fixed END). Only #10 and #11 — both
   from the last 48 hours, both implicated in the breakage you reported — move
   toward S.
4. **P eliminates a whole bug family by construction.** If `startTime` is
   derived, K14's stale-anchor mechanism cannot exist. That is a structurally
   better outcome than K14's fix, which keeps two facts in sync by discipline.
5. **Decision 8 is already ruled in P's vocabulary**, and Key Invariant (b)
   ("total timeline length unchanged") is a P statement.

### 5.2 The strongest argument AGAINST P — stated fully

**Under P, a lock can never be inert, and that was the entire point of K14.**

Decision 9 says a locked segment is an immovable anchor. P can deliver
immovability, but only by making *some neighbour* move — and in the
two-adjacent-locks case it cannot deliver it at all without refusing the lock
(§4.1(a)). So under P:

- "This segment is locked" always carries an implicit "…and something else will
  be adjusted to make that possible."
- The user can be told **no** when locking a second segment near the first.
- The pre-K14 growth exemption — withdrawn deliberately, for good reasons
  documented across Steps AA-AD — is arguably the *natural* P solution, which
  means P pulls back toward the very behaviour that produced the original
  lock-overlap complaints.

If your priority is that **a lock be a genuinely inert, side-effect-free
declaration** — which is a defensible and arguably correct product position, and
is what K14 was reaching for — then **Model S is the only model that delivers
it**, and the price is an export rewrite. That is a real trade, not a technicality.

**In short:** P is right if the timeline is fundamentally a continuous filmstrip.
S is right if locks are fundamentally inviolable. You cannot have both.

---

## 6. Migration

### 6.1 Under Model P — in order

| Step | Action | Risk |
|---|---|---|
| 1 | **Write the invariant down** and add a dev-only assertion after every `segments` write. Nothing else changes. Immediately catches every future violation. | None |
| 2 | Run it against a real project with a lock. **Confirm or refute §1.3's export desync** empirically. | None |
| 3 | Rule the lock-shortfall case: adopt §4.1(a) — next segment absorbs; refuse a lock that would create an unsatisfiable gap; log it. | Behavioural, lock-only |
| 4 | Amend `applyAnchorBasedTiming`'s locked branch to emit contiguous output under that rule. | Medium — this is K14's site |
| 5 | Fix the live drag preview to move the whole touched window (K17 done properly). | Low, self-contained |
| 6 | *(Optional, later)* Derive `startTime` rather than store it — makes violation a type error. | Large, deferrable |

`recomputeStartTimes`/`restackWindow` need **no change** — they are equivalent
whenever the cascade conserves the window total, which K15b already guarantees.

### 6.2 Under Model S — in order

| Step | Action | Risk |
|---|---|---|
| 1 | Write the invariant down; add a validator (ordering + non-overlap; gaps legal). | None |
| 2 | **Define gap semantics for export**: what renders, for how many frames. | Design |
| 3 | Rework `exportPipeline.ts` to position rather than concatenate. | **High** |
| 4 | Rework `exportPipelineWebCodecs.ts` likewise, including its frame-count guard. | **High** |
| 5 | Re-derive `absoluteTime`/heading selection against true output position. | Medium |
| 6 | Delete `recomputeStartTimes`. Audit every `Σ duration === length` assumption. | Medium |
| 7 | Re-ask decision 8 with the third option available (§4.2). | Design |

### 6.3 Which of K14 / K15a / K15b / K16 survive

| Fix | Under **P** | Under **S** |
|---|---|---|
| **K14** — anchorStart lockstep | **Survives.** Becomes redundant at step 6 (derived `startTime` makes staleness impossible) but is correct meanwhile. | **Survives.** |
| **K14** — lock hard wall / growth exemption withdrawn | **Needs rework.** Must gain the §4.1 filling rule, and must refuse unsatisfiable locks. | **Survives as-is.** S is its natural home. |
| **K15a** — `restackWindow` locality | **Survives as code, discarded as rationale.** Equivalent to a global restack under conserved totals; the gap-preservation justification is void. | **Survives, and is correct.** |
| **K15b** — word-onset yield floor | **Survives.** Orthogonal to gaps — it bounds how much a neighbour yields, not whether space is left behind. And its give-back is what makes P's locality safe. | **Survives**, though give-back becomes optional. |
| **K16** — pointer geometry | **Survives entirely.** Pure coordinate math, invariant-independent. | **Survives entirely.** |

**Note the asymmetry:** under S everything survives and the cost lands on export.
Under P the recent lock work needs rework and export is untouched. That is the
clearest way to see what you are actually choosing between.

---

## 7. What I could not determine

Stated so it is not assumed settled:

1. **§1.3's export desync is derived from source, not reproduced.** I read the
   frame-count and concat logic and traced `absoluteTime`; I did not run an
   export with a gap present. Migration step 2 exists to close this.
2. **Whether any shipped project currently contains a gap.** K13 clears locks on
   every Apply Sync, so gaps may be unreachable in practice today — which would
   mean K14's defect is latent rather than active. I did not audit saved projects.
3. **Whether decision 9 was intended to survive contact with §4.1(a).** "Immovable
   anchor" may or may not have been meant to include "and may therefore be
   refused." That is yours to say, not mine to infer.

---

## 8. What I need from you

1. **P or S.**
2. If **P**: confirm §4.1(a) — refuse a lock that would create an unsatisfiable
   gap — as the lock-shortfall rule.
3. If **S**: confirm you accept an export rewrite, and that decision 8 gets
   re-asked.
4. Independently of 1–3: **the drag-preview fix (§4.4) is a bug under both
   models** and can be authorised now without pre-empting the ruling.
