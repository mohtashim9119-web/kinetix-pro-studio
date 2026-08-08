# The Model P Revert — What Actually Happened

> Written 2026-08-07, during repository consolidation (Parts 1-2), as Part A of a
> follow-up investigation into the "Model P" revert flagged as an unresolved question
> by an earlier same-day investigation (`docs/context-report-2026-08-07.md`).
> Tags used below: **[MEASURED]** — read directly from git/source. **[ASSERTED]** —
> a claim already recorded somewhere in the tree, cited. **[ASSUMED]** — inference,
> with the reasoning stated so it can be checked.

---

## Context

An earlier report this same day characterized "Model P" as *"a large follow-on
effort... 48 commits / 137 files / +57,423 −1,438 lines... built on top of `HEAD`
and then fully reverted the same day,"* and flagged the revert's rationale as
*"the single largest unresolved question this report surfaces"* — it had deliberately
not read `model-p-editor-work`'s own file contents, including `docs/`.

Part 2 of this consolidation already corrected the headline framing: `model-p-editor-work`
(`210855d`) is not 48 commits of independent work — it is `webgl2-effects-engine`'s tip
(`6eae48e`) **plus exactly one commit**, the "park" commit, whose own message says it
captures uncommitted work *"immediately before `src/` was reverted to `18f5734`."*
This document answers the two questions that framing leaves open: what would that
revert have actually thrown away, and why was it about to happen.

---

## What `18f5734` is

**[MEASURED]** `18f5734` = `"feat(sync): Phase 4 readiness close-out — Steps Y-Z"`
(2026-08-07 00:20), tagged `phase4-implementation-ready-2026-08-07`. It is the close-out
commit for `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`'s Phase 3 (forced-alignment) measurement
programme — at this commit, `sync-pipeline-v2-plan.md`'s own Phase Status table records
Phase 3 as **"IMPLEMENTATION-READY, not started... Integration not started."** Every
commit from Phase 0 through this one is measurement/design only — the phrase "No `src/`
changes" (or equivalent) appears in nearly every one of their bodies.

**[MEASURED]** `18f5734` sits **5 commits behind** the current tip `6eae48e`. The
intervening 5 commits are a *different, explicitly separate* workstream:

| Commit | What |
|---|---|
| `ad70019` | Design doc — manual lock semantics, Steps AA-AD (own message: *"separate workstream from the timing-source swap"*) |
| `c52e67a` | **K14** — lock hard-wall semantics, implementation |
| `f8aef7d` | **K15** — bound and localize the drag cascade (fixes K15a, introduced by K14; and K15b, which predates K14) |
| `0e2ac5b` | **K16** — drag pointer accuracy (3 real, measured pointer-math faults) |
| `6eae48e` | **K17** — move every cascaded segment in the live drag preview |

**So a literal revert of `src/` to `18f5734` would have discarded K14/K15/K16/K17 —
four already-committed, tested, owner-reported-bug-driven fixes — in addition to
whatever uncommitted Model P work existed at park time.** Nothing in any commit body,
doc, or code comment states a defect in K14-K17 themselves. Suite was green (1365
tests) at `6eae48e`.

---

## What the park commit holds — the five named items, checked individually

**[MEASURED]**, via `git diff 6eae48e 210855d` per file:

| Item (from the park commit's own message) | Status |
|---|---|
| Model P gapless timeline partition (`timelinePartition.ts`) | **(i) Only in the park commit.** File does not exist at `6eae48e`. |
| Lock fingerprint (`projectFingerprint.ts` + test) | **(i) Only in the park commit.** File does not exist at `6eae48e`. |
| 50/50 silence split (`snapBoundaries.ts`) | **(iii) Partially both.** The file itself is core, pre-existing sync-engine code; the "50/50 rule" content is new (confirmed: every `50/50`-referencing line in the diff is a `+` addition). |
| Export gap guard (`exportPipeline.ts`, `exportPipelineWebCodecs.ts`) | **(iii) Partially both.** Both files are the established export pipeline; the new `checkTimelineIsGapless` function and its two call sites are new. |
| Writer consolidation (`App.tsx` / `syncEngine.ts` / `dragCascade.ts`) | **(iii) Partially both.** All three files are heavily used at `6eae48e`; the consolidation diffs (App.tsx +209/−, `syncEngine.ts` and `dragCascade.ts` rewrites) are new. |

---

## What the docs ruled

**[MEASURED]** Two companion documents exist **only in the park commit** (not on `main`
as of this consolidation, prior to it being folded in) — `docs/decisions/segments-invariant-ruling.md`
and `docs/drag-path-testability-assessment.md` — both stamped *"Written 2026-08-07, at
HEAD `0e2ac5b` (K16)... Status: AWAITING OWNER RULING. Design only — no code written,
no commit made."*

**`segments-invariant-ruling.md`** poses one question: is `project.segments` a
**gapless partition** ("Model P" — `startTime[i]+duration[i]===startTime[i+1]`) or an
**ordered list of independently positioned slots** ("Model S" — gaps legal)? [ASSERTED,
`segments-invariant-ruling.md` §0-1] Eleven components in the codebase answer this
differently, and the answer had silently flipped five times across recent history with
no decision ever recorded — most recently, K14's lock hard-wall and K15a's
`restackWindow` locality had (unnoticed) adopted Model S, while nine other components,
**including both export paths**, assume Model P and cannot represent a gap at all
[ASSERTED, §1.3]. The doc traces a concrete, sourced (not reproduced end-to-end)
mechanism by which a gap under a locked segment desyncs an exported video — headings
select by `startTime` while export positions by a `duration`-prefix-sum, and with a
gap those disagree [ASSERTED, §1.3].

The doc's own recommendation (§5): **Model P**, with the counter-argument stated in
full (§5.2 — under P a lock can never be unconditionally inert, "the entire point of
K14"). Its migration table (§6.3) states plainly: under Model P, **"K14 — lock hard
wall / growth exemption withdrawn: Needs rework. Must gain the §4.1 filling rule, and
must refuse unsatisfiable locks."** K15a/K15b/K16 all "survive" under P; only K14's
specific hard-wall implementation is named as needing to be rebuilt.

**`drag-path-testability-assessment.md`** is a companion doc, same status/HEAD stamp,
recommending a scoped drag-session test harness ("Route 2") be built **alongside** the
Model-P migration's step 5 (the K17 live-drag-preview fix), not before — because the
harness's central assertion depends on which model is ruled.

**[MEASURED]** `6eae48e` (K17) was committed *after* the ruling doc was written, and its
own message states it needed no ruling: *"An overlap is illegal under BOTH candidate
models of `segments` (`docs/decisions/segments-invariant-ruling.md` §0), so this needed no
ruling."* — consistent with the ruling doc's own §4.4 finding.

**[MEASURED]** The park commit's own new code is written in Model P's vocabulary and
cites numbered owner rulings dated the same day: `projectFingerprint.ts`'s docstring
opens *"OWNER RULING (2026-08-07, task 2)..."*; `exportPipeline.ts`'s new
`checkTimelineIsGapless` is headed *"TASK 4 (2026-08-07) — the export guard the ruling
asked to be made explicit"* and cites `docs/decisions/segments-invariant-ruling.md` §1.3 and §4.1
by name; `snapBoundaries.ts`'s 50/50 rule cites *"owner ruling (2026-08-07, ruling
point 2)."* **This confirms the owner ruled Model P** sometime between the ruling doc's
writing and the park commit (both 2026-08-07), and implementation of that ruling's
migration (§6.1: write the invariant, confirm/refute export desync, rule the
lock-shortfall case, amend `applyAnchorBasedTiming`, fix the live drag preview) is what
the park commit contains in flight. **Also resolves an open question from the earlier
report** — "Model P" is not an internal codename of undocumented origin; it is
literally the "Model P" (gapless-Partition) name from `segments-invariant-ruling.md`
§2, and the branch `model-p-editor-work` is named after implementing it.

The "task N" numbering (`task 2`, `task 4`) does not match `segments-invariant-ruling.md`
§6.1's own step numbering — it most plausibly reflects a separate, session-level
numbered task list (referenced obliquely by `drag-path-testability-assessment.md`'s
own *"working tree clean apart from the `package.json` test-gate change reported in
Part 1"*) that is not itself a committed document in this repository. **[ASSUMED]**
this list existed only in conversation/session context and was never persisted —
flagged, not invented; nothing here should be read as reconstructing its exact contents.

---

## Why the revert happened

**[ASSUMED — inference from the evidence above, not stated verbatim anywhere]**

No commit, doc, or comment states outright "revert to `18f5734` because X." But the
evidence supports a specific, coherent reading over the alternatives:

- **Not a rejection of K14-K17's quality.** All four are real, owner-reported-bug
  fixes with before/after measurement and a green suite; nothing calls their
  correctness into question.
- **Not a rejection of the in-flight Model P work either** — the park commit exists
  specifically so that work is *not* lost.
- **Most consistent reading: `18f5734` (immediately before K14) was chosen as the
  clean starting point to redo lock/drag semantics correctly under the just-ruled
  Model P, rather than patch K14's already-shipped Model-S-flavored implementation.**
  This is exactly what `segments-invariant-ruling.md` §6.3 itself calls for — K14
  specifically ("needs rework... must gain the §4.1 filling rule") — while K15/K16/K17
  are declared to "survive" under P (§6.3), so a clean re-derivation from before K14
  would let their logic be re-applied on top of a correctly-ruled foundation rather
  than layered as further patches on a model nobody had chosen yet.
- **The commit's own framing supports "park the WIP, land it properly later" over
  "reject the work."** *"Not a reviewed commit — a preservation snapshot so nothing
  is lost by the revert"* describes a safety step ahead of an action, not a verdict
  on what was wrong with the thing being reverted.

**This reading is an inference, not a recovered fact.** No text anywhere says "redo
K14 under Model P" in those words. If the owner recalls a different reason, that
should supersede this section — but per the earlier report's own instruction (A6),
this consolidation had a specific, well-cited alternative available and did not need
to stop and ask blind.

**[MEASURED, from Part 1/2 of this consolidation]** The revert-to-`18f5734` was, in
any case, **never carried out as a committed state anywhere in reachable history** —
`model-p-editor-work` stops at the park commit; `main`/`webgl2-effects-engine` sit at
`6eae48e` today, with K14-K17 fully intact.

---

## What is safe to revive

- **`projectFingerprint.ts`** (lock-fingerprint persistence across resync) — additive,
  narrowly scoped, cites its own owner ruling verbatim in its doc comment. Also closes
  the pre-existing "K13" bug (`project-state.md`'s Deferred Known Bugs: lock
  preservation is broken across resync) — a real, independently-tracked defect, not
  invented for Model P.
- **`docs/decisions/segments-invariant-ruling.md`'s Model P ruling itself** — the underlying
  architectural question is real, well-evidenced (§1.3's export-desync trace), and
  independent of whether any specific patch survives. Re-implementing its migration
  steps (§6.1) cleanly, starting from the current `main` tip rather than a discarded
  branch, is lower-risk than reviving the park commit's diff wholesale (which predates
  K17's already-shipped drag-preview fix by one commit and was never reviewed).
- **`timelinePartition.ts`'s `enforceGaplessPartition`/`findPartitionViolations`** and
  the export gap guard concept — both implement §6.1 steps 1/3/4, but should be
  re-derived against current `main` (which now includes K17) rather than cherry-picked,
  since the park commit's own diff base (`6eae48e`) is now `main`'s own tip and a clean
  re-apply is low-cost.

## What must not be retried and why

- **A blanket revert of K14-K17 to reach `18f5734`.** Per the evidence above, this
  would discard four tested, owner-verified bug fixes with no stated defect in them.
  If lock semantics need rework under Model P, that is scoped to K14's *lock hard-wall
  branch* specifically (`segments-invariant-ruling.md` §6.3), not the whole cluster.
- **Reviving Model S ("independent slots") without first re-reading §5.2's
  counter-argument in full.** The ruling doc itself states Model S is the only model
  that makes a lock genuinely inert — a real, stated trade-off, not a settled loss.
- **Committing the park commit's diff as-is.** It predates K17 by one commit
  chronologically in the sense that it was written on top of `6eae48e` before that
  commit was `main`'s tip in this consolidated history, was never reviewed, and its
  own message explicitly disclaims review ("Not a reviewed commit").
