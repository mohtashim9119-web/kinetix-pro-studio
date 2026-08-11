# WS1 Master Roadmap

> **Purpose.** This is the single sequenced source of truth for WS1 (the sync-pipeline
> forced-alignment rewrite) execution order: what's done, what's next, what blocks what, and
> why. It answers "where does WS1 stand and what do I do next," end to end. It does **not**
> replace `docs/work-in-progress.md` — day-to-day task churn (checking a box, adding a note)
> still happens there. This roadmap gets updated when the *shape* of the plan changes (a phase
> lands, a gate passes, a new defect reopens a stage), not on every commit.
>
> Built 2026-08-11 from a full read of `sync-pipeline-v2-plan.md` (4,310 lines),
> `ws1-readiness-2026-08-08.md`, `boundary-drift-investigation.md`, `roadmap-2026-08-07.md`,
> `docs/history.md`'s WS1/Model-P sections, `project-state.md`, `docs/work-in-progress.md`,
> `scripts/fixtures/README.md`, and direct verification against source on `main` (grep, test
> runs, and the actual measurement scripts). Every status below carries its evidence — a file,
> a line number, a commit sha, or a command you can re-run.

---

## NEXT UP (updated 2026-08-11, after the K13 close-out)

**Task 5 — Rust integration for forced alignment (Phase 3), not Slice 2.** Phase 3 is the
"real timing-source upgrade" (§2) that fixes the underlying smear defect, and per §7 it sits
first in the "ready now, in parallel" list — it unblocks the most downstream work (task 4 as a
side effect, task 6 transitively, Stage 1 locking once 3c also lands) and, unlike Slice 2, was
gated on the Spanish accuracy gate, which closed 2026-08-11 (below). This is readiness, not a
prompt — do not start the work from this block alone; it still needs its own scoping pass.

**Goal.** Replace Whisper's word timestamps with forced alignment (a CTC acoustic model aligning
the known script text to the audio at the phoneme level), bundled as a Rust sidecar addition,
slotted behind the existing Stage 1 timing interface so nothing downstream of it changes shape.

**Entry conditions (all met):**
- Spanish accuracy gate closed — corrected p95 50.4ms vs. the approved 250ms gate (1 of 22 pauses
  over). Evidence: `docs/ws1-sync-pipeline/spanish-gate-scoring.md`, Step U in
  `sync-pipeline-v2-plan.md`.
- Structural checks gate closed — C05/C11 CI-IN, C10 knowingly CI-OUT by name (not a blocker).
  Evidence: `scripts/phase4-step-w-trust.py`, `scripts/phase4-step-x-verify.py` (13/13 poison +
  13/13 real, C10's exclusion by design), §4 Step W/X above.
- Heading assignment gate closed — Option A decided (owner decision 8). Evidence: Steps Y-Z,
  `sync-pipeline-v2-plan.md`.
- DTW eliminated as an alternative (measured zero effect, Phase 2b) — forced alignment is the
  only remaining timing-source candidate. Evidence: §2 above, `sync-pipeline-v2-plan.md:406-462`.
- CTC model viability spot-verified (not just license-checked) — `jonatasgrosman/wav2vec2-large-xlsr-53-english`
  loads and greedy-decodes real corpus audio accurately. Evidence: `sync-pipeline-v2-plan.md:569`.

**Files expected to change (per the plan's own Step R/H.3 design — not yet fully scoped at the
file level; a scoping pass is part of this task, not skippable):**
- `src-tauri/src/` — new module bundling ONNX Runtime + the CTC model, implementing the Viterbi
  alignment pass (mirrors `src-tauri/src/whisper.rs`'s sidecar-command shape).
- `src-tauri/Cargo.toml` — new ONNX Runtime dependency; `src-tauri/binaries/README.md` — model
  provisioning docs (mirrors the existing whisper-model pattern).
- `src/services/whisperService.ts` / `src/hooks/useWhisper.ts` — swap the timing source behind
  the Stage 1 interface these already expose; per H.3, model is multilingual, so per-language
  behavior must stay keyed the same way it is today.
- `src/constants.ts` — model distribution/provisioning constants if on-demand download (Step T
  design) lands alongside, per owner ruling R-B.

**Acceptance criteria:**
- Golden-baseline replay (`scripts/phase4-handoff-replay-sync.test.ts`) run and reviewed
  per-boundary — a deliberate diff review, never a blind re-baseline (§7, task 2's own rule
  applies equally here since Phase 3 changes the timing source).
- `scripts/phase4-step-x-verify.py` still passes its non-C10 checks after the swap.
- fr/de/pt "unvalidated language" warning (Step T.7) ships in this same task/release per R-B.
- All four project gates pass (below).

**Gates, starting baseline (this commit):** `npm run lint` clean; `npm test` 72 files / 1803
passed / 1 skipped / 0 failed; golden replay 3/3; `cargo check` clean. Task 5 will add new
tests — 1803 is the floor to not regress below, not a ceiling to match exactly.

**Out of scope for this task:** Slice 2 (task 2, independent); the 2 remaining word-shift cases
(task 4 — expected to resolve as a side effect, verify after, don't chase separately); Resume
Pipeline Contract Program (task 6, blocked behind this task); Phase 4's 4-stage restructure
(blocked on Stage 1 locking, which this task only partially clears — 3c still gates it); Phase
3b/3c themselves (currently unowned on the ledger, §6 — a separate scheduling decision).

**Hazards / invariants this must not break:** boundary/breath classification must stay on token
*indices*, never raw timestamps (CLAUDE.md §4); `anchorSource` provenance only ever demotes
`'whisper'` → `'estimate'`, never promotes back — a new `'forced-alignment'` source (if added)
needs its own place in that ordering, not a silent insertion; `Project.language` stays sticky
once set; Part F's stated non-goals apply (`sync-pipeline-v2-plan.md` Part F) — no merging
duration floors, no retuning the 250ms/1% thresholds, no touching the Hirschberg alignment pass,
no resolving R5/N4 here; `-nfa`/flash-attention stays un-adopted (§13) — this is a different,
already-decided axis, don't conflate it with the FA-vs-DTW decision this task executes on.

---

## 1. Status at a glance

| | |
|---|---|
| Programme status | "Accepted architecture — pending implementation" (plan doc's own header, line 1) |
| Phases fully shipped | 0, 1, 1b, 2a, 2b (research/design phases only — see §2; no stage has *locked*) |
| Phases explicitly skipped | 3d (conditional phase, condition didn't trigger) |
| Phases implementation-ready, not started | 3 (forced alignment — all 3 Rust gates now closed) |
| Phases not started, no gate blocker | 3b, 3c |
| Phases blocked on Stage 1 locking | 4, 5, 6, 6b, 7 |
| Stage locks passed | **0 of 4** — Stage 1, 2, 3, 4 all "NOT PASSED" |
| Open, confirmed-live defect | None — K13 (lock preservation across resync), the last one, was fixed 2026-08-11 (see §5) |
| Live WS1 task ledger | 10 tasks, `docs/work-in-progress.md` — 2 done (slice 1, K13), 4 not-blocked, 1 blocked-behind-another, 1 reference-only, 2 unowned (3b/3c, see §6) |
| CI | None. All four project gates (`lint`, `npm test`, golden replay, `cargo check`) are run by hand — see §9. |

---

## 2. Full phase / stage status table

Two status sources exist in the plan document itself: a **top summary table** (its lines 10-29) and a **detailed section** later in the document. Where they disagree, the detailed section is later and more specific, and is authoritative here — disagreements are called out explicitly, not silently resolved.

| Phase | Stage | What it does | Status | Evidence |
|---|---|---|---|---|
| 0 | Programme (pre-stage) | Safety net: back up both corpus projects, freeze transcripts, verify whisper-cli determinism, define a 40-boundary verification set | **DONE**, verified by owner 2026-08-04 | `sync-pipeline-v2-plan.md:207` |
| 1 | Stage 2 (neutrality-exempt) | Delete a redundant gap-fill in `alignScenestoTranscript` (dead code — nothing downstream reads its output) | **DONE**, byte-identical harness pass both projects | `sync-pipeline-v2-plan.md:215-218` |
| 1b | Stage 1 | Build a dev-only Transcript Inspector; measure smear distribution on a tight-pause and a long-pause project | **DONE**, owner ran it on both corpus projects 2026-08-04 | `sync-pipeline-v2-plan.md:222-293` |
| 2a | Stage 1 | Swap to the multilingual `ggml-large-v3-turbo` model, add per-project language override | **DONE**, gate passed 38/44, owner listened all 47 boundaries | `sync-pipeline-v2-plan.md:295-378` |
| 2b | Stage 1 | Measure DTW vs. no-DTW on the production model | **DONE** — **DTW is dead.** Measured to change timestamps by exactly `0.000000000s` across 4,579 + 2,080 tokens. Decision: "DTW IS ABANDONED PERMANENTLY... do not revisit it without new evidence that overturns the zero-delta measurement." | `sync-pipeline-v2-plan.md:406-462, 555` |
| **3** | Stage 1 | **Forced alignment — the real timing-source upgrade.** This is the phase that actually fixes the smear defect. | **IMPLEMENTATION-READY, not started.** All 3 Rust gates closed (Spanish accuracy — Step U; structural checks — Steps W/X; heading assignment — owner decision 8). Zero `src/`/Rust changes anywhere in Phase 3's own text — every measurement so far is design/scoring only. | `roadmap-2026-08-07.md` §D2; `sync-pipeline-v2-plan.md` Steps M-Z |
| 3b | Stage 1 | Language-keyed text normalization (contractions, numbers) for fr/de/pt | **NOT STARTED.** Not on the current WS1 task ledger under its own name — see the gap flagged in §6. | `sync-pipeline-v2-plan.md:3721-3723` |
| 3c | Stage 1 | Hyphen-asymmetry fix (`textNormalize.ts` glues a hyphenated word Whisper emits as two tokens) — **the last event that shifts English token/word indices in Stage 1** | **NOT STARTED.** Blocks Stage 1 locking directly (see §3). Not on the current WS1 task ledger under its own name — same gap as 3b. | `sync-pipeline-v2-plan.md:3725-3726`, K1 audit `:4239` |
| 3d | Stage 1 | Adaptive (noise-floor) silence thresholds, conditional on Phase 2b showing the fixed −45dB threshold costs accuracy | **SKIPPED.** Phase 2b's own finding: the threshold isn't the binding constraint (spot-verified against a waveform; the failure is entirely token-side). Reopens only if Phase 3's post-FA measurement shows a silence-side cost. ⚠ *The plan doc's own top table still lists this as "NOT STARTED" — a real internal contradiction; the detailed section (dated, reasoned, with a reopening trigger) is authoritative.* | `sync-pipeline-v2-plan.md:3731` vs. `:20` |
| — | **STAGE 1 LOCK** | — | **NOT PASSED.** Six blockers as of 2026-08-05; see §3 for the up-to-date read on each. | `sync-pipeline-v2-plan.md:3741-3747` |
| **4** | restructure (touches all 4 stages) | **The literal restructure**: reorganize the pipeline into 4 stages, make Stage 2's output timing-free, thread Stage 1's output as one object, collapse `distributeSegmentTimes`/`applyAnchorBasedTiming` into Stage 3. A move, not a behavior change — byte-identical resync is the pass bar. | **NOT STARTED.** Blocked on Stage 1 locking. *Careful: a large body of Phase-4-*labeled* research (Steps M through AD) already shipped as measurement/design — that is not this restructure; see §4.* | `sync-pipeline-v2-plan.md:3751-3754` |
| — | **STAGE 2 LOCK** | — | **NOT PASSED** | `sync-pipeline-v2-plan.md:3756-3759` |
| 5 | Stage 3 | Replace the boundary picker with Part C's 4-line "fence" rule; delete the picker heuristics it replaces. **Scope also includes implementing heading-wildcard Option A** (unscripted spoken audio absorbed entirely by the preceding segment, logged as an explicit `unscripted-gap` entry) — decided (owner decision 8, plan doc Step V / Steps Y-Z) but not yet coded anywhere; this is the phase that must build it. | **NOT STARTED.** Needs Stage 1 + Stage 2 locked first, and needs heading-wildcard Option A's logic coded in (decided, not yet built). | `sync-pipeline-v2-plan.md:3763-3766` |
| 6 | Stage 3 | Deprecate the compensation layer (`isBreathSilence`, seam exemption, contention assignment) if the 8 seam-exemption cases still hold without it | **NOT STARTED** | `sync-pipeline-v2-plan.md:3768-3771` |
| 6b | Stage 3 | Verify the 173-project's known `pairIdx-20` boundary defect, likely resolved by Phase 5 | **NOT STARTED** | `sync-pipeline-v2-plan.md:3773-3774` |
| — | **STAGE 3 LOCK** | — | **NOT PASSED** | `sync-pipeline-v2-plan.md:3776-3780` |
| 7 | Stage 4 | Observability: every clamp/floor/fallback logs a plain-language hint; fixes the `boundaryUsedFallback` 4-arg bug (self-resolves if Phase 6 already deleted the exemption it's about) | **NOT STARTED** | `sync-pipeline-v2-plan.md:3784-3786` |
| — | **STAGE 4 LOCK** (= programme close) | — | **NOT PASSED** | `sync-pipeline-v2-plan.md:3788-3793` |

**A note on "Phase 4."** The label is overloaded in the source document. "Phase 4 — Restructure into four stages" (the row above) is the *structural move*. Separately, a large, fully-shipped body of pre-implementation research is headed "Phase 4 pre-implementation" (Steps M through T) and "Phase 4 readiness close-out" (Steps Y-Z) — these are golden-baseline captures, defect inventories, and readiness statements, explicitly disclosed throughout as measurement/design with **zero** `src/` changes. Treat "Phase 4 the restructure" (not started) and "Phase-4-labeled research" (done) as two different things with the same name — see §4 for the research steps.

**Dissolved phase numbers.** "Old Phase 2" was superseded by 2a. "Old Phase 8" was dissolved — its four items redistributed to 3b, 3c, 3d, and 6b (K1 audit finding, `sync-pipeline-v2-plan.md:4239`).

---

## 3. Stage-lock gates — what must be true to pass each

A stage is **LOCKED** only when all four hold (`sync-pipeline-v2-plan.md:146-150`): its Part J contract is written; every producer guarantee in that contract is verified by owner inspection (not asserted from memory, not inferred from green tests); every unenforced consumer assumption is either closed or explicitly accepted in writing with a reason; no known defect in that stage is deferred to a later stage.

**Ordering rule:** no phase that changes stage N's behavior begins until every stage before N is locked. Two exemptions: a behavior-neutral phase proven so by a byte-identical gate (Phase 1, Phase 4) may run anytime; read-only measurement (Phase 2b) may run anytime. **The hard rule:** a defect found in an already-locked stage reopens it and blocks all later work until closed or accepted in writing — "we'll handle it downstream" is explicitly forbidden (it's how the current picker/breath-detector/seam-exemption compensation stack was built in the first place).

### Stage 1 — Prepare (blocking WS1's actual next implementation step)

| Blocker (as of 2026-08-05) | Current read (2026-08-11) |
|---|---|
| (a) Smear thresholds unmet | **Still open, and sharpened.** Not "smear is too high" — the timing source is fundamentally "of the wrong kind": Whisper emits gapless word spans (93-98% of transitions) and silently deletes words via zero-duration timestamps. DTW can't fix this (§2). Only forced alignment (Phase 3) clears it. |
| (b) No non-English corpus project | **Partially resolved.** Spanish corpus exists and transcribed cleanly (Phase 2a), but its *boundaries* are unlistened — accepted in writing, reopens the moment Spanish-specific code ships (Phase 3b). French/Portuguese/German remain completely absent from the corpus, also accepted in writing per H.8's dormant-rules allowance. |
| (c) 3 short-segment-run boundaries missing from the verification set | **Resolved** 2026-08-04 — 5 added (Part L). |
| (d) Contract IN / 1→2 not yet verified guarantee-by-guarantee | **Still open** — a procedural step, not yet run. |
| (e) Cross-cutting regression checklist not yet run | **Still open** — a procedural step, not yet run (the 9-item checklist at `sync-pipeline-v2-plan.md:156-165`: locks, skipped segments, headings, no-voiceover path, silence-scan failure, empty-token fallback, persistence/reload, export/preview consumers, DEV harnesses). |
| (f) `verification-baseline.csv` carried 69 blank `phase-2a` verdict cells | **Resolved by Phase 2a's own closure** — Phase 2a is DONE, owner listened all 47 boundaries (§2). The blocker-list text itself was never explicitly rewritten to say so, which is why it's called out here rather than left silently assumed. |

**Bottom line:** Stage 1 locks once Phase 3 lands and passes its own verification (clearing blocker a), Phase 3c lands (the last Stage-1 index-shifting event — see §5), and the two procedural steps (d, e) are actually run. Nothing is waiting on a decision; everything left is implementation + process.

### Stage 2 — Align and Select
Needs: Contract 2→3 verified guarantee-by-guarantee (the timing-free Stage-2 output type actually compiles the old duplication away; partition order preserved; skip semantics pinned); the three surviving Stage 2 risks (R6 vacuous forward bound, R10 run-survival calibration including the new model, R12 no DP cost bound) each closed or accepted in writing; regression checklist clean. Not passed — Phase 4 (the restructure) hasn't happened yet.

### Stage 3 — Place
Needs: Contract 3→4 verified (fence-inside-gap property, contiguity-by-arithmetic, a single lock-handling site, no clamps in Stage 3); `pairIdx-20` closed or accepted in writing; the 8 seam-exemption cases plus the 20 controls still hold per Phase 6; regression checklist clean. Not passed — Phases 5/6/6b haven't happened yet.

### Stage 4 — Finalize and Report (= programme close)
Needs: Contract OUT verified (severity taxonomy, emptied gap list); the 6-question reader rubric passes; the 96.2%-correct-cuts figure formally retired in favor of `verification-baseline.csv`'s verdict counts; regression checklist clean; all standing docs (`CLAUDE.md`, `project-state.md`, this file's tables) updated. Not passed — Phase 7 hasn't happened yet.

---

## 4. Phase-4-labeled research steps (Steps A through AD)

All dated 2026-08-05 through 2026-08-07. Every one of these is explicitly disclosed as measurement/design work with **no** `src/` change — except Steps AA-AD, whose follow-on design work *did* ship as real code (K14, see §5). All are **DONE** unless noted.

| Step | What it did | Result |
|---|---|---|
| A-D | Reference-validity pass: threshold sweep, phonetic-class analysis, 12 clips exported for owner listening, negative-smear audit | Most of the 40 unresolved boundary errors are reference bias, not FA error. **The negative-smear `<1%` gate is proven structurally unpassable by an accurate source** — the gate itself needed re-scoping, not the pipeline. |
| E-H | Reference-correction pass: stale-pause audit (95% correct), breath-aware acoustic reference built, corpus re-scored | p95 error 338.2ms → 82.2ms. One genuine FA residual found (segment 307/clip 11, an interposed unscripted heading). |
| I-L | Blinded-batch scoring (32 clips total) | Confirms the breath-aware reference is a net win; formalizes "unscripted spoken headings" as its own defect class (10 found in V6). |
| M | Golden baseline captured (Phase 3→4 handoff) | Real-pipeline vitest replay of current shipped behavior, all 3 corpus projects — see `scripts/fixtures/README.md` for full methodology. |
| N-P | Spanish FA run (first time, raw p95 282.1ms — fails), commercial CTC model viability, cost/rollback analysis | FA adds +18-42% wall-clock; reversibility argued sound. |
| Q | 10 Spanish clips exported, integrity-checked | Export/check done 2026-08-06; **scoring deferred to Step U.** |
| R | Production windowing design (run-based alignment, 3-source anchors, wildcard for unscripted audio) | Design only, not implemented. |
| S | All 12 structural checks built as a standalone harness | Built — but its own "13/13 poison cases trip" claim was **later found false** (Step W: actually 12/13) and self-corrected in the same document. |
| T | Model-distribution design (on-demand download, SHA-256 pinning) | Design only. **fr/de/pt marked UNVALIDATED** — ships alongside Phase 3/task 5 per owner ruling R-B (§7). |
| U | Spanish scored against human ground truth | **Reference bias confirmed** — corrected p95 = 50.4ms, clears the 250ms gate (1 of 22 pauses over). One genuine FA error found (clip3_06, −1084ms). **Closes Rust gate 1 of 3.** |
| V | Heading-wildcard options A-E laid out | Originally undecided — **closed 2026-08-07, owner ruled Option A** (see §5). |
| W | Corrects Step S; makes C05/C10/C11 trustworthy or says so | C05 → **CI-IN** (recovered FA arrays). C10 → **CI-OUT** (0/4 ear recall regardless of tuning). C11 → **CI-IN** (live K13 repro — correctly flags the defect today, designed to flip when fixed). Re-verified directly 2026-08-11 by running `scripts/phase4-step-w-trust.py` — see §8. |
| X | Manual verification harness, single command | 13/13 poison + 13/13 real pass; exits 1 by design (C10's 3rd check fails on purpose). **Closes Rust gate 2 of 3.** |
| Y | Golden-baseline replay harness restored (4th `/tmp`-loss recurrence) | Proven faithful 3 ways; new tripwire test added so this can't silently recur a 5th time. |
| Z | Full pre-implementation readiness statement | Per-language evidence table, CI in/out list, 7 named post-ship risks. **Closes Rust gate 3 of 3** (heading assignment, via Option A). |
| AA-AD | Diagnoses K14 (in-editor lock-toggle bug, distinct from K13); designs its fix | Design work — but K14 itself **was then actually implemented**, 2026-08-07 (see §5). |

---

## 5. K-series defect / fix registry

Part K (`sync-pipeline-v2-plan.md:4235-4279`) is the plan document's own self-audit, run 2026-08-03. K14-K17 came later, found and fixed the same week.

| ID | What it was | Disposition |
|---|---|---|
| K1-K12 | Structural/process gaps in the *plan document itself* (illegal phase ordering, missing corpus, an unfalsifiable gate, etc.) | All fixed by editing the plan — no runtime code involved. |
| **K13** | **Lock preservation is broken across resync.** Clean-slate resync's `parseProjectData` has no `locked` field, so a locked segment silently loses both position and lock flag on the next Apply Sync. | **FIXED, 2026-08-11.** `preserveSegmentLocks` (`src/App.tsx`) restores `locked`/`startTime`/`duration` onto the freshly-committed array by matching old→new segments on unique `assetId` *after* `autoMatchSegments`/`preserveEffectFields` have run, then validates each restore (bound-check against `audioDuration`, then iterative `findPartitionViolations`, dropping the later segment of any violating pair first) before committing it — a dropped restore silently leaves the naturally-synced value in place and logs a `lock-not-restored` sync-log entry (`buildLockNotRestoredLogEntries`). Fixed fresh directly against `main` per owner ruling R-C — ported only the logic/idea from the parked `model-p-editor-work` branch, never its stale code; that branch stays unmerged permanently. Verified: 11 unit tests (`src/services/preserveSegmentLocks.test.ts`), the inverted live-corpus regression test (`scripts/phase4-step-w-k13-repro.test.ts`, 3/3 — now proves the fix holds instead of the defect), 5 manual tests. Was WS1 task 8, now done. |
| K14 | In-editor lock-toggle bug: `handleToggleLock` → `applyAnchorBasedTiming` re-derived off a stale `anchorStart`, moving unrelated (even locked) segments | **FIXED**, 2026-08-07, `src/App.tsx` + `src/services/syncEngine.ts` |
| K15 | Drag cascade: gap-collapse over-absorption (introduced by K14) + a pre-existing unbounded neighbour-absorption bug | **FIXED**, 2026-08-07, extracted to `src/services/dragCascade.ts` |
| K16 | Drag pointer accuracy (stale 24px constant, missing grab offset, left-edge drag not tracking the pointer) | **FIXED**, 2026-08-07, new `src/services/dragGeometry.ts` |
| K17 | Frozen-neighbour overlap in the *live drag preview* (distinct from K15 — a rendering-only mismatch between what's drawn during a drag and what commits) | **FIXED and shipped on `main`**, commit `6eae48e` — `dragCascade.ts`'s `resolveDragPreview`, regression-tested (`dragCascade.test.ts`, 37/37 passing, re-run to confirm this session). Independently verified: not a mis-citation. |

**Branch disposition, updated 2026-08-11.** `wip/preserve-2026-08-07`'s previously-unique data is now fully rescued onto `main`, byte-for-byte — all 39 files it alone held (Spanish blinded-listening answer keys/clips, Phase 4 golden-baseline replay snapshots, K13/K14 live-repro evidence, 5 structural-check audio clips) were copied via `git show`/`git cat-file` and verified byte-identical against their source blob SHAs (commit `bb7b0f8`; manifest at `docs/ws1-sync-pipeline/measurements/rescued-2026-08-07-model-p-park/PROVENANCE.md`). The branch itself is now safe to delete (owner action — not deleted as part of this consolidation). `model-p-editor-work` stays parked, unmerged, permanently, per ruling R-C (§8) — the rescue doesn't change that; its logic/ideas were ported fresh into the K13 fix (below), never its code.

⚠ **Caution when citing `docs/history.md` on K13 (historical note — K13 is now fixed).** Its park-commit entry (`docs/history.md:2794-2804`) describes the parked `model-p-editor-work` branch as containing "a lock-fingerprint persistence rule closing the pre-existing K13 bug" — quoted alone, out of context, that used to read as K13 being fixed when it wasn't (that fix existed only on the unmerged, permanently-parked branch and was never merged to `main`). As of 2026-08-11 this distinction is moot for current status — K13 **is** fixed on `main` — but the caution stands for anyone reading the parked branch's commit history: that branch's own fix was never the one that shipped.

**K13 fix — design notes (recorded so they aren't re-litigated).**

*Ordering.* `preserveSegmentLocks` runs on `committed` — AFTER `autoMatchSegments`/`preserveEffectFields`, once every segment has its real `assetId` and the timing pipeline has already produced a known-valid gapless array — NOT through `applyAnchorBasedTiming`'s earlier hard-wall pass. Two reasons: that earlier point doesn't have every segment's `assetId` yet, and a lock that fails validation before timing runs would need the entire async, Whisper-driven timing pipeline re-run to cleanly revert it. Running post-hoc instead makes a dropped lock free to revert — the naturally-synced value the pipeline already computed is simply left in place, untouched. Anyone reading the K14/Model P hard-wall code later should not assume it is the lock-restore entry point; it isn't.

*Tie-break rules (undocumented elsewhere, pin them here).* (1) When a restored lock's tentative position collides with a neighbour per `findPartitionViolations`, the **later** segment of the violating pair is dropped first (matching `findPartitionViolations`' own "measured at the later of the two" convention); the earlier one is only dropped if it alone is a restore candidate. (2) The validation loop's iteration cap equals the starting candidate count — each pass removes exactly one candidate, so it can never run more than `candidates.size` times — and if it is ever somehow exhausted without stabilizing, the function fails safe by reverting **all** restores for that run rather than committing a partial, unresolved state.

---

## 6. Current WS1 task ledger, cross-referenced

The live ledger is `docs/work-in-progress.md` (8 tasks). Mapped against the phase/stage structure above:

| Task | Maps to | Blocked? |
|---|---|---|
| 1. Apply Sync history-entry fix | WS1 "slice 1," outside the phase numbering — fixed the double-history-push bug found at WS1 readiness check | **Done**, commit `1b16a50` |
| 2. Slice 2 — 50/50 silence-split re-derivation | `snapBoundaries.ts` rewrite from the parked branch, re-derived against `main`. Outside the phase numbering (predates the fence-rule work in Phase 5) | **Not blocked** — confirmed cleanly decoupled from the editor path twice (`roadmap-2026-08-07.md` §D4, re-checked at `ws1-readiness-2026-08-08.md` §1/§3) |
| 3. Stale-anchor scroll degradation test | Test-debt item, outside the phase numbering | **Not blocked** |
| 4. Word-shift defect (2 remaining cases) | Addressed by Phase 3 + Phase 5 per `boundary-drift-investigation.md`'s own note | **Not standalone work** — expected to resolve as a side effect of task 5 landing (`roadmap-2026-08-07.md` §D2); do not work this before task 5 |
| 5. Rust integration for forced alignment | **= Phase 3** | **Not blocked** — all 3 Rust gates closed (§4) |
| 6. Resume Pipeline Contract Program | Part J | Blocked on task 4 — which per the row above really means blocked *behind task 5* |
| 7. Re-attempt boundary-quality watcher | Not phase-numbered; a live in-app UI feature, not part of the plan document's own scope | Reference-only — prior attempt reverted (safety-bound failure, uncalibrated formula); `watcher-revert-2026-08-03.diff` is a resumption pointer, **not** source to reintroduce as-is |
| 8. K13 fix | **Nominally Stage 3** per the plan document's own fix-path text, but owner ruling R-C pulled it forward as an independent fix against `main`, not gated on Phase 4's restructure landing first | **Done, 2026-08-11** |

**A gap this cross-reference surfaces:** Phase 3b (language normalization) and Phase 3c (hyphen-asymmetry fix — the one that must land before Stage 1 can lock, §3) have **no task of their own** on the 8-item ledger. Task 5 covers Phase 3 specifically ("Rust integration for forced alignment"); nothing currently tracks 3b or 3c. Since 3c gates Stage 1 locking directly, this is worth a deliberate scheduling decision, not an oversight left implicit.

---

## 7. Sequenced execution order

Numbered start to finish. Items at the same number can run in parallel — nothing between them shares a file or a data dependency.

**Ready now, in parallel, nothing blocking any of them:**

1. **Task 5 — Rust integration for forced alignment (Phase 3).** All 3 gates closed. Per owner ruling R-B, the fr/de/pt unvalidated-language warning surfaces (Step T.7) ship in this same task/release, not after. Unblocks: task 4 (as a side effect), task 6 (transitively), Stage 1 locking (once 3c also lands).
2. **Task 2 — Slice 2, the 50/50 silence-split re-derivation.** Cleanly decoupled from the editor path (verified twice). Will deliberately break the golden replay — budget a per-boundary review, never a blind re-baseline.
3. **Task 3 — stale-anchor scroll degradation test.** Independent test-debt item.
4. **Phase 3b and 3c** (language normalization; hyphen-asymmetry fix) — currently un-owned on the task ledger (§6). 3c specifically blocks Stage 1 locking. Recommend scheduling explicitly rather than assuming task 5 covers it.

**Done:**

- **Task 8 — K13 fix.** Fixed fresh against `main` per R-C, 2026-08-11 (§5). No longer blocks or gates anything below.

**Do not start yet — genuinely sequenced:**

6. Task 4 (the 2 remaining word-shift cases) — wait for task 5 (#1) to land; work this only if it *doesn't* resolve as a side effect.
7. Task 6 (Resume Pipeline Contract Program) — blocked behind task 5 (#1), not task 4.
8. **Stage 1 lock** — needs #1 (Phase 3) and #5 (Phase 3c) landed, plus the two procedural steps (Contract verification, regression checklist) actually run (§3).
9. **Phase 4 — the 4-stage restructure** — blocked on #8. Also needs a scoping call: architect "Place" around the gapless-partition invariant from the start (recommended, cheaper now than retrofitting) or defer that decision.
10. **Stage 2 lock** — after #9 lands and its own contract/risk items (§3) are closed.
11. **Phase 5 — replace the picker with the fence rule** — blocked on #10, and needs heading-wildcard Option A's logic actually coded (decided already, owner decision 8 — just not built yet, §2 Step V).
12. **Phase 6 — deprecate the compensation layer** (conditional on the 8 seam-exemption cases surviving without it) and **Phase 6b — verify `pairIdx-20`** — both after #11, both Stage 3.
13. **Stage 3 lock** — after #12.
14. **Phase 7 — Observability**, including the `boundaryUsedFallback` fix (moot if #12's Phase 6 already deleted the exemption it's about) — after #13.
15. **Stage 4 lock** — programme close.

Everything from #6 onward is strictly sequenced by the stage-locking rule (§3) — none of it can be pulled forward regardless of who's available, except by explicitly reopening the ordering rule in writing.

---

## 8. Owner rulings (recorded verbatim, 2026-08-11)

**R-A.** The 22 blank `boundary-quality-flag` rows in `scripts/fixtures/verification-baseline.csv` are DEFERRED / non-blocking. WS1 does not pause for an ear-listening pass.

**R-B.** The fr/de/pt "unvalidated language" warning surfaces (Step T.7) SHIP WITH Phase 3 (Rust forced alignment) — same release, not after.

**R-C.** Branch `model-p-editor-work` stays UNMERGED and is never merged. K13 (segment locks lost on Apply Sync) will be fixed as a FRESH bug fix written directly against current `main`, porting only the logic/idea, never the stale branch code. K13 is its own numbered WS1 task (task 8).

None of these are re-litigated by this document or by the doc edits that accompanied it.

---

## 9. Known edge cases and standing exceptions

Things a reader needs to know that don't fit the phase/stage table above.

- **The 3rd word-shift case** (`seasons than you‖can count and`) is a script-vs-narration authority conflict — the script and what was actually said genuinely disagree about where the boundary is. **Not fixable by any timing-source change**, including Phase 3's forced alignment. The other 2 cases are expected to resolve as a side effect of task 5 (§6, §7).
- **R5/N4** (a mid-line bracket split case) is explicitly deferred pending a product ruling, recorded as a written acceptance at Contract IN — not a bug, a deliberately parked decision.
- **The negative-smear `<1%` gate was re-scoped, not met.** Step D proved that gate is structurally unpassable by an accurate timing source — some negative smear is expected, correct behavior, not a defect signal. Treat the original `<1%` figure as retired, not as an outstanding failure.
- **C05 / C10 / C11 structural checks — real state as of 2026-08-11** (verified by running `scripts/phase4-step-w-trust.py` directly, not by reading a status doc): **C05 is CI-IN** (FA token arrays were recovered at Step W, re-scored against the shipped gate). **C11 is CI-IN**, and as of K13's fix this same day its live repro has flipped from red-flagging the defect to proving the fix holds (3/3, inverted — see §5); `scripts/phase4-step-w-trust.py`/`phase4-step-x-verify.py`'s own prose narrative still describes the pre-fix defect-trap framing, which is a separate deferred item (§13). **C10 is CI-OUT** and looks likely to stay that way — ear-verified recall against real corpus cases is 0/4 no matter how the predicate is tuned; a quieter false-positive rate isn't the same as a working check.
- **The 22 deferred `boundary-quality-flag` rows** (R-A, above) live in `scripts/fixtures/verification-baseline.csv` and are explicitly out of scope for WS1's current slice.
- **No automated CI exists for this repository.** `.github/workflows/build.yml` is `workflow_dispatch`-only and cross-builds installers; it contains no `npm test`/`vitest`/`cargo test`/`tsc` step. All four of this project's real gates — `npm run lint`, `npm test`, the golden-replay test, `cargo check` — are run by hand, by whoever is making the change. There is no safety net catching a regression that isn't run for.

---

## 10. Cross-reference note

This roadmap was checked against `docs/work-in-progress.md` and `project-state.md` for contradictions before being committed. One was found (C05/C11's real CI status, §9) and fixed in `project-state.md` directly, per this project's own rule that the perishable doc yields to newly-discovered reality, not the roadmap.

---

## 11. Parts A-L reference

The plan document is organized into lettered Parts underneath the Phase/Stage structure in §2-§4. These aren't phases with a status of their own — they're the spec, the contracts, and the audit trail the phases are built from. Listed here so nothing is left unaccounted for.

| Part | What it is |
|---|---|
| A | Diagnosis: Whisper's word timestamps smear across pauses (~190ms average, up to 900ms) — the one root problem everything else in the old pipeline compensates for. |
| B | The architecture: the four stages (Prepare / Align and Select / Place / Finalize and Report). |
| C | The boundary rule itself (the 4-line "fence") and why it can't ship yet — walked through on a real segment-96 example. |
| D | Container for every Phase entry, grouped by stage, each stage behind a lock gate. §2-§3 of this roadmap are built from Part D. |
| E | Risk register — roughly 20 "here's how this plan could fail, and how the architecture prevents it" entries. |
| F | Explicit non-goals: no merging duration floors, no retuning constants, no touching the Hirschberg alignment, no resolving R5/N4 here, unit tests are not treated as correctness evidence. |
| G | What "100%" means: structural correctness is 100%-achievable; perceptual placement's "100%" means "correct or flagged," not literally perfect. The old 96.2%-correct-cuts figure is to be retired (§3, Stage 4 lock; §12). |
| H | Multilingual production support spec (H.0-H.9): supported languages, target model, forced-alignment spec, language detection, corpus requirements. Mostly resolved/measured already; H.5 (language-keyed normalization) is Phase 3b's full scope. |
| I | Reviewer notes — 3 flags from an earlier revision of the plan, all marked resolved in the current one. |
| J | The formal stage contracts (Contract IN, 1→2, 2→3, 3→4, OUT): producer guarantees and consumer assumptions, a severity taxonomy, the 6-question reader rubric, a legacy-risk (R1-R14) mapping. All five contracts are written; none are yet verified — that verification is what "locking" a stage means (§3). |
| K | The plan document's own adversarial self-audit (2026-08-03) — 13 findings (K1-K13), all fixed by editing the plan itself except K13, which named a real code defect and is still open (§5). |
| L | The "short-segment cascade" finding (2026-08-04) — a defect class distinct from the picker's over-reach, later amended for bidirectionality. |

---

## 12. Retired, skipped, superseded & descoped items

So no reader wonders where something went.

| Item | Disposition | Why |
|---|---|---|
| Phase 2b configs (c) large-v3 raw, (d) large-v3+DTW | **SKIPPED** by owner decision, 2026-08-05 | The accuracy question they existed to answer is explicitly left unmeasured/open — a deliberate scope cut, not an oversight. |
| Phase 3d — adaptive silence thresholds | **SKIPPED** | See §2 — Phase 2b's own measurement showed the fixed threshold wasn't the binding constraint. Has a reopening trigger (§2). |
| "Old Phase 2" | **SUPERSEDED** by Phase 2a | Model swap subsumed it. |
| Old Phase 8 | **DISSOLVED** | Redistributed into Phases 3b, 3c, 3d, and 6b (K1 audit finding). |
| H.2's original DTW-vs-large-v3 reasoning | **SUPERSEDED** | By the stronger, model-independent finding that Whisper's `-ml 1` output is gapless by construction. |
| Part C's original "~190ms → ~80ms" DTW improvement estimate | **MEASURED AND FALSIFIED**, Phase 2b, 2026-08-05 | DTW changes timestamps by exactly zero — the estimate wasn't just imprecise, it was wrong. |
| Russian | **DESCOPED**, 2026-08-03, product decision | Not "untested" — no content is produced in it, so it was never in scope to test. |
| The 96.2%-correct-cuts figure | **To be RETIRED** | Required for Stage 4 lock, in favor of `verification-baseline.csv`'s verdict counts (§3) — not yet executed, since Stage 4 hasn't locked. |
| R5/N4 (mid-line bracket split) | **DEFERRED**, written acceptance at Contract IN | Pending a product ruling — see §9. |
| Parakeet's CTC-extractability; CJK/Thai/Vietnamese/RTL languages | **OUT OF SCOPE** | Never in scope to begin with — not a cut from an existing plan. |

**Self-corrections inside the plan document itself** — worth knowing before quoting an early section in isolation: Step S's claim of "13/13 poison cases caught" was false when written and is corrected two steps later by Step W to the real 12/13 (§4). Phase 2a's original root-cause for the 173-project's segment 112 ("turbo drops the word") is corrected by Phase 2b's Finding 4 (turbo emits it with a zero-duration timestamp, which a later filter then drops — same downstream consequence, different mechanism). Segment 320's "4.5x duration undercount," discussed as a live defect through most of Phase 3, was later found to be a stale-measurement artifact — latent, not live, in the currently-shipped pipeline. In all three cases the *later* passage is the document correcting itself in the open, not a silent contradiction — but a reader citing only the earlier passage would be citing something the document itself has already disclaimed.

---

## 13. Deferred, with reason

Explicitly parked, not forgotten. Recorded here so the next reader doesn't have to re-derive why each is sitting idle, and doesn't re-litigate any of them.

- **Stage 1 blockers (d) and (e)** — Contract IN/1→2 guarantee-by-guarantee verification and the cross-cutting regression checklist (§3). Procedural; deferred until Phase 3 (and 3c) actually ship, so they're run once against the landed state instead of twice.
- **Stage 1 blocker (b), French/Portuguese/German corpus absence** (§3) — no fr/de/pt corpus project exists. Already accepted in writing, per H.8's dormant-rules allowance: those languages' rules ship dormant behind their language keys and are verified when corpus material arrives.
- **`boundaryUsedFallback` 4-arg bug** (§4 Step Z risks; `snapBoundaries.ts` — defaults the seam exemption off in every boundary-quality reading) — scheduled for Phase 7, may self-resolve at Phase 6 if that phase deletes the seam exemption first.
- **C10 structural check, 0/4 ear-verified recall** (§9) — accepted as CI-OUT regardless of predicate tuning; a quieter false-positive rate isn't the same as a working check.
- **No automated test CI** (§9) — all four project gates (`lint`, `npm test`, golden replay, `cargo check`) are run by hand; accepted, no CI pipeline planned.
- **3rd word-shift case**, `seasons than you‖can count and` (§9) — a script-vs-narration authority conflict, structurally unfixable by any timing-source change; accepted.
- **Phase 4 design call: architect "Place" gapless-aware from the start, or retrofit later** (§7 item 9) — deferred to Stage 1 lock time, when the call actually has to be made. Noted here that deciding it now is cheaper than retrofitting after Phase 4 lands.
- **22 blank `boundary-quality-flag` verification rows** (§8 R-A, §9) — deferred, non-blocking, by owner ruling R-A, 2026-08-11. WS1 does not pause for an ear-listening pass to fill them in.
- **`-nfa` (disables flash attention) is not adopted**, despite Phase 2b finding it recovers a real content dropout (V6 segments 27-29, `sync-pipeline-v2-plan.md:511-515`) — costs roughly 25-33% wall-clock, and adopting it would need its own verification pass (a fresh transcript era per K9, plus a re-listen). Recorded as a finding only, no code changed; left for a future phase to weigh deliberately.
- **`scripts/phase4-step-w-trust.py`/`phase4-step-x-verify.py`'s C11 narrative text** still describes the pre-fix defect-trap framing ("C11 must keep failing until K13 is fixed") even though the underlying repro test it reads (`scripts/phase4-step-w-k13-repro.test.ts`) flipped on 2026-08-11 to prove the fix holds. The filename and artifact key shape were kept unchanged deliberately so these two scripts don't KeyError (see that test file's own header). Updating their prose to match is separate, deferred work — not done as part of the K13 close-out.
