# WS1 Task 5 — Open Decisions

> **Purpose.** Every decision currently waiting on the owner, in one place,
> as of 2026-08-14 (`main` at `1cde438`). Each entry states the evidence
> needed to decide and the cost of deciding either way — **no default is
> recommended**; deciding is the owner's call, not this document's. Built
> alongside `task5-status-board.md` during the WS1 docs-sync pass; nothing
> here is new work, only a collection of decisions that already exist
> scattered across other docs.

---

## 1. The proposed 0.3s per-word display-timing gate (D15)

**What it is.** A proposed (not measured, not ratified) tolerance: per-word
timing error ≤ 0.3s (300ms), both start and end, for word-level
highlight/caption display. Proposed at
`measurements/d15-mis-assignment-diagnostic-2026-08-13.md` §2.2 as
"engineering judgment, not measurement" — explicitly flagged there as
requiring owner sign-off before anything is wired to it.

**Not the same number as R.7's `CONF_MIN`.** `CONF_MIN = 0.3`
(`syncConstants.ts:536`, `fa.rs:303`) is a **confidence probability**
threshold, already implemented and wired (D19). The 0.3s gate here is a
**timing-error-in-seconds** threshold for a per-word display feature that
does not exist yet. The two numbers are coincidentally identical and
concern the same general area (R.7/word-level display) but are unrelated
units gating unrelated things — flagging this explicitly since the two are
easy to conflate when read out of context.

**Evidence available to decide:** D15's per-row exceedance table
(`measurements/d15-mis-assignment-diagnostic-2026-08-13.md` §2.3) — at the
proposed gate, only the oracle-text rows (`B`, `B-control-45s`) clear it
outright; the production-realistic `index-45s` row exceeds on ~1% of words
(5-6 of 569, the same set D15's own mis-assignment diagnostic already
explains). No consumer feature (per-word highlight/caption UI) exists yet
to give this number real stakes either way.

**Cost of deciding now vs. later:**
- **Ratify 0.3s now:** gives future windowing work (R.3/R.7-R.9) a concrete
  target to build against immediately; risk is committing to a number
  derived from "engineering judgment," not measurement or user testing —
  could need revisiting once a real per-word UI exists to test it against.
- **Defer:** costs nothing today (no consumer feature is blocked on it —
  D15's own §2.1 found no existing tolerance to inherit, because there is no
  existing consumer). The risk is only that windowing work proceeds without
  a stated target and a later-set number retroactively judges already-shipped
  work.

---

## 2. R.5 — build now, later, or not at all, given verdict (i)

**What's already decided, not open.** The wildcard-gap *destination*
question R.5's own text flags (`sync-pipeline-v2-plan.md:1499`,
"Recommendation, flagged for an owner ruling rather than assumed") **was
already ruled** by **R-E** (`project-state.md`: "Model P outranks R.5" —
the wildcard span is assigned to the preceding segment), recorded
2026-08-11 (commit `ba05be6`), a day before Task 5's first commit. Two WS1
docs — `task5-slice-ledger.md`'s R.5 ruling section and
`task5-integration-scope.md` §2/§4 — describe this destination question as
still open; both are corrected in this docs-sync pass (see the commit's own
list of what changed). **This is not itself an open decision** — it is
flagged here only so the correction has a visible home; nothing below
depends on re-deciding it.

**What is actually open.** Whether/when to build R.5's implementation at
all. Three known facts bear on this call, none of which resolve it by
themselves:
1. **Mandated in-scope** by owner ruling D1 (`task5-integration-scope.md`
   §0: "D1 SCOPE = Option B, full word-level timings... with R.5
   wildcards").
2. **Verdict (i), still fully reachable** (D25 B1,
   `d25-durable-cache-live-wired-r5-scoping-2026-08-14.md`): index
   attribution (D21) did not obviate the condition R.5 exists to handle —
   172 segments across 118 real chunks means most chunks already
   concatenate multiple segments' text today, so real unscripted audio
   between two segments sharing a chunk remains architecturally guaranteed
   to occur, not a rare edge case.
3. **Real implementation cost**, sketched but not built (D25): two layers —
   `faChunkPlan.ts` would need to carry an ordered list of per-segment text
   spans per chunk instead of one joined string (an `FaChunkInput` IPC
   shape change), and `fa_viterbi.rs`/`fa_onnx.rs` would need a genuine
   zero-cost wildcard state in the Viterbi DP, not the standard CTC blank it
   has today.

**Evidence available to decide:** items 1-3 above, plus the existing
"ship without them initially" ruling (`task5-slice-ledger.md` §4, "R.5
wildcards — ship without them initially") that let D17-D25 proceed without
R.5 by relying on Hirschberg's existing degradation behavior as an interim
fallback — that ruling was explicitly framed as revisitable, not permanent,
because R.5 sits behind the same off-by-default capability gate as
everything else in Task 5.

**Cost of deciding either way:**
- **Build R.5 now, alongside the capability-gated production wiring
  slice:** front-loads the two-layer IPC-shape change while that slice is
  already touching `FaChunkInput`/the chunk-planning surface — likely
  cheaper combined than as a separate later slice touching the same files
  twice. Delays the production-wiring slice's own landing by however long
  the wildcard DP state takes to build and verify to the same zero-tolerance
  standard the rest of Task 5 holds itself to.
- **Ship production wiring without R.5, add it later:** gets FA to a real
  production timing source sooner (consumer (1), segment-level timing,
  doesn't need R.5 at all — D13's index-45s is already indistinguishable
  from the whole-file reference against Whisper ground truth for that use).
  Risk: consumer (2) (per-word display, D1's actual mandated scope) ships
  with a known, architecturally-guaranteed gap — real unscripted audio
  silently absorbed into a neighboring word's timing — until a follow-up
  slice closes it.
- **Descope R.5 permanently:** would contradict owner ruling D1's explicit
  scope ("Option B... with R.5 wildcards") — not a unilateral call this
  document or any WS1 doc can make; would need its own explicit reversal of
  D1, not a default.

---

## 3. Branch protection on `main`

**Current state, live-verified this pass:** `main` has no branch protection
at all. `gh api repos/mohtashim9119-web/kinetix-pro-studio/branches/main/protection`
returns `404 "Branch not protected"` (re-run 2026-08-14, unchanged since
D16's own finding). There is therefore no required-status-checks list for
`fa-ort-matrix.yml` (or any other workflow) to be added to.

**Evidence available to decide:** `fa-ort-matrix.yml` has been green on
every run since its D14 B1 fix (`8889a2e`), confirmed non-flaky by a second
independent run at D16. The four project-wide gates (`lint`, `npm test`,
golden replay, `cargo check`) have no CI automation at all — they are run
by hand by whoever makes a change, a standing, accepted state
(`ws1-master-roadmap.md` §9), not unique to Task 5.

**Cost of deciding either way:**
- **Add branch protection (with `fa-ort-matrix.yml` as a required check, at
  minimum):** prevents a future push from silently breaking the FA
  `fa-inference`/ORT matrix unnoticed. Blast radius beyond Task 5: branch
  protection would start gating **every** future push/PR to `main`, not
  just FA-Rust-surface changes — a repo-settings change this documentation
  pass was explicitly told not to make unilaterally (`task5-slice-ledger.md`
  §6's known-gap register: "creating branch protection from scratch... was
  left to the owner rather than done unilaterally").
- **Leave unprotected:** costs nothing today (nothing currently relies on a
  required-checks gate) but means a regression in the FA CI matrix, or in
  any other future workflow, can land on `main` without being blocked, only
  noticed after the fact.

---

## 4. R-M / R-N ratification into `project-state.md`

**What it is.** `project-state.md`'s **R-M** currently reads "Accepted
cost: a from-source onnxruntime build for `x86_64-apple-darwin` in CI" —
this premise was **superseded** by the runtime-unblock investigation
(`measurements/runtime-unblock-2026-08-12.md`, commit `55e2ad5`): disabling
`ort`'s `api-NN` Cargo features drops the onnxruntime minimum-version floor
from 27 to 17, which the prebuilt `onnxruntime-osx-x86_64` 1.23.2 binary
satisfies — no from-source build is required. `src-tauri/Cargo.toml`'s
current `ort` dependency (confirmed by direct read this pass) already
reflects the unblocked configuration. **R-N** ("R-L's packaging reading is
DEFERRED, not decided" — static-link vs. load-dynamic+bundled-dylib) is
unaffected by this and remains genuinely undecided.

**Why this document doesn't just fix it.** `docs/work-in-progress.md`'s
permanent process rule states R-M/R-N ratification is a formal
`project-state.md` edit requiring explicit owner approval, deferred to the
end-of-Task-5 documentation pass. This pass's own constraints (set by the
task that produced this document) explicitly exclude `project-state.md`
from its edit scope. The result: this is the second documentation pass in a
row where the correction is identified but not applied — recorded here so
it isn't lost a third time.

**Evidence available to decide:** `measurements/runtime-unblock-2026-08-12.md`
(the full investigation), `src-tauri/Cargo.toml` (the live, unblocked
configuration, confirmed present this pass), `docs/work-in-progress.md`'s
own note under its R-M/R-N bullet (deferred, pending approval).

**Cost of deciding either way:**
- **Ratify now:** `project-state.md` stops asserting a superseded
  constraint (a from-source build requirement that no longer applies) —
  low cost, the correction is well-evidenced and already implemented in
  code; the only reason it hasn't happened is the process rule requiring
  explicit approval, not any remaining technical uncertainty.
- **Defer again:** costs nothing functionally (the code already reflects
  the unblocked state regardless of what `project-state.md` says), but a
  reader relying on `project-state.md` alone (its own stated purpose as the
  situation-report source of truth) continues to see a stale, more
  pessimistic constraint than reality.

---

## Cross-references

- Status board (source material this document was extracted from) —
  `task5-status-board.md`.
- R.5 reachability scoping — `d25-durable-cache-live-wired-r5-scoping-2026-08-14.md`.
- R-E ruling text — `project-state.md`'s Rulings In Force section.
- R-M/R-N current (stale) text — `project-state.md`'s Rulings In Force
  section; superseding evidence — `measurements/runtime-unblock-2026-08-12.md`.
